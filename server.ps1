# LAN Chess server. Serves ./public and a small JSON API for game rooms.
# Uses only built-in Windows PowerShell / .NET - nothing to install.
param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
$PublicDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'public'))
$Rooms = @{}
$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'application/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.ico' = 'image/x-icon'; '.json' = 'application/json; charset=utf-8'
}
$StatusText = @{ 200 = 'OK'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 409 = 'Conflict'; 500 = 'Internal Server Error' }

function Get-LanAddresses {
  try {
    $list = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
      Where-Object { $_.OperationalStatus -eq 'Up' -and $_.NetworkInterfaceType -ne 'Loopback' -and $_.Description -notmatch 'Virtual|VMware|Hyper-V|vEthernet|WSL|Loopback' } |
      ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
      Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' -and -not $_.Address.ToString().StartsWith('169.254.') } |
      ForEach-Object { $_.Address.ToString() }
    @($list | Sort-Object { if ($_ -like '192.168.*') { 0 } elseif ($_ -like '10.*') { 1 } else { 2 } })
  } catch { @() }
}

function New-Code { -join (1..4 | ForEach-Object { 'ABCDEFGHJKLMNPQRSTUVWXYZ'[(Get-Random -Maximum 24)] }) }
function New-Token { [guid]::NewGuid().ToString('N') }
function Clean-Name($n) {
  $n = ([string]$n) -replace '[^\p{L}\p{N} _\-\.]', ''
  $n = $n.Trim()
  if ($n.Length -gt 20) { $n = $n.Substring(0, 20) }
  if (-not $n) { $n = 'Player' }
  $n
}

function New-JsonResponse($Object, [int]$Status = 200) {
  $json = ConvertTo-Json -InputObject $Object -Depth 6 -Compress
  @{ Status = $Status; Type = 'application/json; charset=utf-8'; Body = [Text.Encoding]::UTF8.GetBytes($json) }
}
function New-ErrorResponse($Message, [int]$Status = 400) { New-JsonResponse @{ error = $Message } $Status }

function Read-Request($stream) {
  $buf = New-Object byte[] 8192
  $ms = New-Object System.IO.MemoryStream
  $headerEnd = -1
  while ($headerEnd -lt 0) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { return $null }
    $ms.Write($buf, 0, $n)
    if ($ms.Length -gt 65536) { return $null }
    $headerEnd = [Text.Encoding]::ASCII.GetString($ms.ToArray()).IndexOf("`r`n`r`n")
  }
  $all = $ms.ToArray()
  $lines = [Text.Encoding]::ASCII.GetString($all, 0, $headerEnd) -split "`r`n"
  $first = $lines[0] -split ' '
  $headers = @{}
  foreach ($l in ($lines | Select-Object -Skip 1)) {
    $i = $l.IndexOf(':')
    if ($i -gt 0) { $headers[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() }
  }
  $len = 0
  if ($headers['content-length']) { $len = [int]$headers['content-length'] }
  if ($len -gt 65536) { return $null }
  $bodyStart = $headerEnd + 4
  while (($ms.Length - $bodyStart) -lt $len) {
    $n = $stream.Read($buf, 0, $buf.Length)
    if ($n -le 0) { break }
    $ms.Write($buf, 0, $n)
  }
  $all = $ms.ToArray()
  $body = ''
  if ($len -gt 0) { $body = [Text.Encoding]::UTF8.GetString($all, $bodyStart, [Math]::Min($len, $all.Length - $bodyStart)) }

  $target = $first[1]
  $path = $target; $query = @{}
  $q = $target.IndexOf('?')
  if ($q -ge 0) {
    $path = $target.Substring(0, $q)
    foreach ($pair in $target.Substring($q + 1) -split '&') {
      $kv = $pair -split '=', 2
      if ($kv[0]) { $query[[Uri]::UnescapeDataString($kv[0])] = if ($kv.Length -gt 1) { [Uri]::UnescapeDataString($kv[1]) } else { '' } }
    }
  }
  @{ Method = $first[0]; Path = $path; Query = $query; Body = $body }
}

function Send-Response($stream, $resp) {
  $status = $resp.Status
  $head = "HTTP/1.1 $status $($StatusText[$status])`r`nContent-Type: $($resp.Type)`r`nContent-Length: $($resp.Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($resp.Body.Length) { $stream.Write($resp.Body, 0, $resp.Body.Length) }
  $stream.Flush()
}

function Get-Seat($room, $token) {
  if ($token) {
    if ($room.white -and $room.white.token -eq $token) { return 'w' }
    if ($room.black -and $room.black.token -eq $token) { return 'b' }
  }
  return $null
}

function Get-RoomState($room, $seat) {
  $now = [DateTime]::UtcNow
  $wName = $null; $bName = $null; $wOn = $false; $bOn = $false
  if ($room.white) { $wName = $room.white.name; $wOn = ($now - $room.white.seen).TotalSeconds -lt 6 }
  if ($room.black) { $bName = $room.black.name; $bOn = ($now - $room.black.seen).TotalSeconds -lt 6 }
  @{
    code = $room.code; you = $seat; gameNo = $room.gameNo
    white = $wName; black = $bName; whiteOnline = $wOn; blackOnline = $bOn
    moves = [object[]]@($room.moves)
    result = $room.result; reason = $room.reason; drawOffer = $room.drawOffer
    rematch = [object[]]@($room.rematch.Keys)
  }
}

function Invoke-Api($req) {
  $name = $req.Path.Substring(5)
  $data = $null
  if ($req.Method -eq 'POST' -and $req.Body) { $data = $req.Body | ConvertFrom-Json }

  if ($name -eq 'info') { return New-JsonResponse @{ ips = [object[]]@(Get-LanAddresses); port = $Port } }

  if ($name -eq 'create' -and $req.Method -eq 'POST') {
    $color = [string]$data.color
    if ($color -ne 'w' -and $color -ne 'b') { $color = @('w', 'b') | Get-Random }
    do { $code = New-Code } while ($Rooms.ContainsKey($code))
    $player = @{ name = Clean-Name $data.name; token = New-Token; seen = [DateTime]::UtcNow }
    $room = @{ code = $code; white = $null; black = $null; moves = New-Object System.Collections.ArrayList
      result = $null; reason = $null; drawOffer = $null; gameNo = 1; rematch = @{} }
    if ($color -eq 'w') { $room.white = $player } else { $room.black = $player }
    $Rooms[$code] = $room
    Write-Host "[$code] created by $($player.name) ($color)"
    return New-JsonResponse @{ code = $code; token = $player.token; color = $color }
  }

  # Everything below needs a room.
  $code = ''
  if ($data -and $data.code) { $code = [string]$data.code } elseif ($req.Query['code']) { $code = $req.Query['code'] }
  $code = $code.Trim().ToUpper()
  if (-not $Rooms.ContainsKey($code)) { return New-ErrorResponse 'Game not found. Check the code.' 404 }
  $room = $Rooms[$code]
  $token = if ($data) { [string]$data.token } else { $req.Query['token'] }
  $seat = Get-Seat $room $token
  if ($seat -eq 'w') { $room.white.seen = [DateTime]::UtcNow } elseif ($seat -eq 'b') { $room.black.seen = [DateTime]::UtcNow }

  switch ($name) {
    'join' {
      $player = @{ name = Clean-Name $data.name; token = New-Token; seen = [DateTime]::UtcNow }
      if (-not $room.white) { $room.white = $player; $c = 'w' }
      elseif (-not $room.black) { $room.black = $player; $c = 'b' }
      else { return New-ErrorResponse 'That game already has two players.' 409 }
      Write-Host "[$code] $($player.name) joined ($c)"
      return New-JsonResponse @{ code = $code; token = $player.token; color = $c }
    }
    'state' { return New-JsonResponse (Get-RoomState $room $seat) }
  }

  if (-not $seat) { return New-ErrorResponse 'You are not a player in this game.' 403 }

  switch ($name) {
    'move' {
      if ($room.result) { return New-ErrorResponse 'The game is over.' 409 }
      if (-not $room.white -or -not $room.black) { return New-ErrorResponse 'Waiting for an opponent.' 409 }
      $ply = [int]$data.ply
      if ($ply -ne $room.moves.Count) { return New-ErrorResponse 'Out of sync - reloading the game.' 409 }
      $turn = if ($ply % 2 -eq 0) { 'w' } else { 'b' }
      if ($seat -ne $turn) { return New-ErrorResponse 'Not your turn.' 409 }
      $uci = [string]$data.uci
      if ($uci -notmatch '^[a-h][1-8][a-h][1-8][qrbn]?$') { return New-ErrorResponse 'Bad move.' 400 }
      [void]$room.moves.Add($uci)
      $room.drawOffer = $null
      $res = [string]$data.result
      if ($res -eq '1-0' -or $res -eq '0-1' -or $res -eq '1/2-1/2') {
        $room.result = $res
        $room.reason = (([string]$data.reason) -replace '[^a-zA-Z0-9 \-]', '')
        Write-Host "[$code] game over: $res ($($room.reason))"
      }
    }
    'resign' {
      if (-not $room.result) {
        $room.result = if ($seat -eq 'w') { '0-1' } else { '1-0' }
        $room.reason = 'resignation'
        Write-Host "[$code] $seat resigned"
      }
    }
    'draw' {
      if ($room.result) { break }
      $action = [string]$data.action
      if ($action -eq 'offer') { $room.drawOffer = $seat }
      elseif ($action -eq 'accept' -and $room.drawOffer -and $room.drawOffer -ne $seat) {
        $room.result = '1/2-1/2'; $room.reason = 'agreement'; $room.drawOffer = $null
      }
      elseif ($action -eq 'decline') { $room.drawOffer = $null }
    }
    'rematch' {
      if ($room.result) {
        $room.rematch[$seat] = $true
        if ($room.rematch.Count -ge 2) {
          $w = $room.white; $room.white = $room.black; $room.black = $w
          $room.moves.Clear(); $room.result = $null; $room.reason = $null; $room.drawOffer = $null
          $room.rematch = @{}; $room.gameNo++
          Write-Host "[$code] rematch started (game $($room.gameNo))"
        }
      }
    }
    default { return New-ErrorResponse 'Unknown request.' 404 }
  }
  return New-JsonResponse (Get-RoomState $room (Get-Seat $room $token))
}

function Invoke-Route($req) {
  if ($req.Path.StartsWith('/api/')) { return Invoke-Api $req }
  $rel = [Uri]::UnescapeDataString($req.Path.TrimStart('/'))
  if (-not $rel) { $rel = 'index.html' }
  $full = [IO.Path]::GetFullPath((Join-Path $PublicDir $rel))
  if ($full.StartsWith($PublicDir) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
    $type = $Mime[[IO.Path]::GetExtension($full).ToLower()]
    if (-not $type) { $type = 'application/octet-stream' }
    return @{ Status = 200; Type = $type; Body = [IO.File]::ReadAllBytes($full) }
  }
  @{ Status = 404; Type = 'text/plain'; Body = [Text.Encoding]::ASCII.GetBytes('Not found') }
}

# Start listening (try a few ports if the first is busy).
$listener = $null
foreach ($p in $Port..($Port + 10)) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Any), $p
    $l.Start(); $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "Could not open a port between $Port and $($Port + 10)."; exit 1 }

Write-Host ''
Write-Host '  LAN Chess is running!' -ForegroundColor Green
Write-Host "  On this computer:      http://localhost:$Port"
foreach ($ip in Get-LanAddresses) { Write-Host "  On your network:       http://${ip}:$Port" -ForegroundColor Cyan }
Write-Host ''
Write-Host '  If Windows asks about the firewall, allow access on Private networks.'
Write-Host '  Press Ctrl+C to stop the server.'
Write-Host ''

$clients = New-Object System.Collections.ArrayList
try {
  while ($true) {
    $busy = $false
    while ($listener.Pending()) {
      $c = $listener.AcceptTcpClient()
      $c.ReceiveTimeout = 2000; $c.SendTimeout = 2000
      [void]$clients.Add(@{ c = $c; t = [DateTime]::UtcNow })
      $busy = $true
    }
    # Serve whichever connections have data; drop idle ones (browsers pre-open sockets).
    for ($i = $clients.Count - 1; $i -ge 0; $i--) {
      $e = $clients[$i]; $c = $e.c; $remove = $false
      try {
        if ($c.Available -gt 0) {
          $busy = $true; $remove = $true
          $stream = $c.GetStream()
          $req = Read-Request $stream
          if ($req) {
            try { $resp = Invoke-Route $req }
            catch { Write-Host "Error: $_" -ForegroundColor Red; $resp = New-ErrorResponse 'Server error.' 500 }
            Send-Response $stream $resp
          }
        } elseif (([DateTime]::UtcNow - $e.t).TotalSeconds -gt 15 -or -not $c.Connected) { $remove = $true }
      } catch { $remove = $true }
      if ($remove) { try { $c.Close() } catch { }; $clients.RemoveAt($i) }
    }
    if (-not $busy) { Start-Sleep -Milliseconds 8 }
  }
} finally {
  $listener.Stop()
}
