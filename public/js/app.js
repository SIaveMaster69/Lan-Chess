(() => {
  'use strict';
  const { Game, START_FEN } = window.ChessLib;
  const $ = s => document.querySelector(s);
  const FILES = 'abcdefgh';
  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const VS = '︎';
  const SVGNS = 'http://www.w3.org/2000/svg';
  const MATE = 100000;
  const LABEL = { best: 'Best', excellent: 'Excellent', good: 'Good', forced: 'Forced', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', missedmate: 'Missed mate' };
  const SYM = { best: '★', excellent: '!', good: '✓', forced: '□', inaccuracy: '?!', mistake: '?', blunder: '??', missedmate: 'M' };
  const BAD = ['inaccuracy', 'mistake', 'blunder', 'missedmate'];

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const other = c => (c === 'w' ? 'b' : 'w');
  const colorName = c => (c === 'w' ? 'White' : 'Black');

  function pieceEl(p) {
    const s = document.createElement('span');
    s.className = 'piece ' + p.c;
    s.textContent = GLYPH[p.t] + VS;
    return s;
  }

  // ---------------------------------------------------------------- Board view
  class BoardView {
    constructor(wrap) {
      this.el = document.createElement('div');
      this.el.className = 'board';
      wrap.appendChild(this.el);
      this.cells = [];
      for (let i = 0; i < 64; i++) this.cells.push(this.el.appendChild(document.createElement('div')));
      this.svg = document.createElementNS(SVGNS, 'svg');
      this.svg.setAttribute('viewBox', '0 0 800 800');
      this.svg.setAttribute('class', 'board-svg');
      this.el.appendChild(this.svg);
      Object.assign(this, { flipped: false, game: null, lastMove: null, arrows: [], badge: null, selected: null, targets: [], ctl: null, drag: null });
      this.el.addEventListener('pointerdown', e => this.down(e));
      this.el.addEventListener('pointermove', e => this.move(e));
      this.el.addEventListener('pointerup', e => this.up(e));
      this.el.addEventListener('pointercancel', () => this.cancelDrag());
      this.el.addEventListener('contextmenu', e => e.preventDefault());
    }
    nameAt(i) {
      const r = Math.floor(i / 8), f = i % 8;
      return FILES[this.flipped ? 7 - f : f] + ((this.flipped ? r : 7 - r) + 1);
    }
    xy(name) {
      const file = FILES.indexOf(name[0]), rank = +name[1] - 1;
      return [(this.flipped ? 7 - file : file) * 100 + 50, (this.flipped ? rank : 7 - rank) * 100 + 50];
    }
    set(opts) { Object.assign(this, opts); this.render(); }
    render() {
      const g = this.game;
      const checkSq = g && g.inCheck() ? g.kingSquare(g.turn()) : null;
      this.cells.forEach((d, i) => {
        const name = this.nameAt(i);
        const light = (FILES.indexOf(name[0]) + +name[1] - 1) % 2 === 1;
        let cls = 'sq ' + (light ? 'light' : 'dark');
        if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) cls += ' last';
        if (this.selected === name) cls += ' sel';
        if (checkSq === name) cls += ' check';
        d.className = cls;
        d.dataset.sq = name;
        d.textContent = '';
        if (i % 8 === 0) addCoord(d, 'r', name[1]);
        if (i >= 56) addCoord(d, 'f', name[0]);
        const p = g && g.pieceAt(name);
        if (p) {
          const pe = pieceEl(p);
          if (this.ctl && this.ctl.canSelect(name)) pe.classList.add('movable');
          d.appendChild(pe);
        }
        if (this.targets.includes(name)) {
          const h = document.createElement('div');
          h.className = 'hint' + (p ? ' cap' : '');
          d.appendChild(h);
        }
        if (this.badge && this.badge.sq === name) {
          const b = document.createElement('div');
          b.className = 'badge ' + this.badge.cls;
          b.textContent = SYM[this.badge.cls];
          b.title = LABEL[this.badge.cls];
          d.appendChild(b);
        }
      });
      this.drawArrows();
    }
    drawArrows() {
      this.svg.textContent = '';
      for (const a of this.arrows) {
        const [x1, y1] = this.xy(a.from), [x2, y2] = this.xy(a.to);
        const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
        if (!L) continue;
        const ux = dx / L, uy = dy / L, px = -uy, py = ux;
        const tip = L - 10, hb = tip - 36;
        const P = (t, s) => `${(x1 + ux * t + px * s).toFixed(1)},${(y1 + uy * t + py * s).toFixed(1)}`;
        const poly = document.createElementNS(SVGNS, 'polygon');
        poly.setAttribute('points', [P(16, -9), P(hb, -9), P(hb, -26), P(tip, 0), P(hb, 26), P(hb, 9), P(16, 9)].join(' '));
        poly.setAttribute('fill', a.color);
        poly.setAttribute('opacity', a.opacity || 0.82);
        this.svg.appendChild(poly);
      }
    }
    down(e) {
      if (e.button !== 0 || !this.ctl) return;
      const cell = e.target.closest('.sq');
      if (!cell) return;
      const sq = cell.dataset.sq;
      if (this.selected && sq !== this.selected && this.targets.includes(sq)) {
        const from = this.selected;
        this.clearSel();
        this.ctl.tryMove(from, sq);
        return;
      }
      if (!this.ctl.canSelect(sq)) { this.clearSel(); return; }
      e.preventDefault();
      const already = this.selected === sq;
      this.selected = sq;
      this.targets = this.ctl.targetsFor(sq);
      this.render();
      const cellNow = this.el.querySelector(`[data-sq="${sq}"]`);
      const pe = cellNow.querySelector('.piece');
      const size = cellNow.getBoundingClientRect().width;
      const ghost = pe.cloneNode(true);
      ghost.classList.add('ghost');
      ghost.style.fontSize = size * 0.82 + 'px';
      ghost.style.webkitTextStroke = (ghost.classList.contains('w') ? size * 0.045 : size * 0.02) + 'px #2b2b2b';
      ghost.style.left = e.clientX + 'px';
      ghost.style.top = e.clientY + 'px';
      ghost.style.display = 'none';
      document.body.appendChild(ghost);
      this.drag = { from: sq, ghost, piece: pe, x0: e.clientX, y0: e.clientY, moved: false, already };
      try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    }
    move(e) {
      const d = this.drag;
      if (!d) return;
      d.ghost.style.left = e.clientX + 'px';
      d.ghost.style.top = e.clientY + 'px';
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 5) {
        d.moved = true;
        d.ghost.style.display = '';
        d.piece.classList.add('lifted');
      }
    }
    up(e) {
      const d = this.drag;
      if (!d) return;
      this.drag = null;
      d.ghost.remove();
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const cell = t && t.closest('.sq');
      const to = cell && this.el.contains(cell) ? cell.dataset.sq : null;
      if (d.moved && to && to !== d.from && this.targets.includes(to)) {
        this.clearSel();
        this.ctl.tryMove(d.from, to);
        return;
      }
      if (!d.moved && d.already) { this.clearSel(); return; }
      this.render();
    }
    cancelDrag() {
      if (!this.drag) return;
      this.drag.ghost.remove();
      this.drag = null;
      this.render();
    }
    clearSel() { this.selected = null; this.targets = []; this.render(); }
  }
  function addCoord(d, cls, text) {
    const s = document.createElement('span');
    s.className = 'coord ' + cls;
    s.textContent = text;
    d.appendChild(s);
  }

  // ---------------------------------------------------------------- State
  const S = {
    mode: null, game: new Game(), my: null, names: { w: 'White', b: 'Black' }, online: { w: true, b: true },
    result: null, reason: null, code: null, token: null, gameNo: 0, drawOffer: null, rematch: [],
    pending: false, seq: 0, pollTimer: null, flipped: false, view: 'play', started: false
  };
  const board = new BoardView($('#board-wrap'));

  function showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
  }
  function setConn(ok) {
    const c = $('#conn');
    if (S.mode !== 'online') { c.textContent = S.mode === 'local' ? 'Local game' : ''; c.classList.remove('bad'); return; }
    c.textContent = ok ? `● Connected · game ${S.code}` : 'Reconnecting to server…';
    c.classList.toggle('bad', !ok);
  }

  function modal(html, buttons) {
    const card = $('#modal-card');
    card.innerHTML = html + '<div class="actions"></div>';
    const act = card.querySelector('.actions');
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      if (b.primary) el.className = 'primary';
      el.onclick = () => { closeModal(); if (b.onClick) b.onClick(); };
      act.appendChild(el);
    }
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  $('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeModal(); });

  function askPromotion(color) {
    return new Promise(resolve => {
      const card = $('#promo-card'), box = $('#promo');
      card.textContent = '';
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = document.createElement('button');
        b.appendChild(pieceEl({ t, c: color }));
        b.onclick = () => { box.classList.add('hidden'); resolve(t); };
        card.appendChild(b);
      }
      box.onpointerdown = e => { if (e.target === box) { box.classList.add('hidden'); resolve(null); } };
      box.classList.remove('hidden');
    });
  }

  // ---------------------------------------------------------------- Server API
  async function api(path, body) {
    const opts = body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {};
    let r;
    try { r = await fetch('/api/' + path, opts); } catch (_) { throw Object.assign(new Error('Cannot reach the chess server.'), { network: true }); }
    let j = {};
    try { j = await r.json(); } catch (_) { /* empty */ }
    if (!r.ok) throw Object.assign(new Error(j.error || 'Server error ' + r.status), { status: r.status });
    return j;
  }
  const post = (path, extra) => api(path, Object.assign({ code: S.code, token: S.token }, extra));

  function saveSession() {
    try { sessionStorage.setItem('chess-session', JSON.stringify({ code: S.code, token: S.token })); } catch (_) { /* ignore */ }
  }
  function clearSession() { try { sessionStorage.removeItem('chess-session'); } catch (_) { /* ignore */ } }

  function startOnline(code, token) {
    stopReview();
    Object.assign(S, { mode: 'online', code, token, gameNo: 0, started: false, result: null, pending: false });
    saveSession();
    poll();
  }

  async function poll() {
    clearTimeout(S.pollTimer);
    if (S.mode !== 'online') return;
    const seq = S.seq;
    try {
      const st = await api(`state?code=${encodeURIComponent(S.code)}&token=${encodeURIComponent(S.token)}`);
      setConn(true);
      if (seq === S.seq && !S.pending && S.mode === 'online') applyState(st);
    } catch (e) {
      if (e.status === 404) { leaveOnline('That game no longer exists (the server may have been restarted).'); return; }
      setConn(false);
    }
    if (S.mode === 'online') S.pollTimer = setTimeout(poll, 700);
  }

  function leaveOnline(msg) {
    clearTimeout(S.pollTimer);
    S.mode = null;
    clearSession();
    stopReview();
    closeModal();
    setConn(true);
    showScreen('lobby');
    $('#lobby-err').textContent = msg || '';
  }

  function applyState(st) {
    S.my = st.you;
    S.names = { w: st.white || 'Waiting…', b: st.black || 'Waiting…' };
    S.online = { w: !!st.whiteOnline, b: !!st.blackOnline };
    S.rematch = st.rematch || [];
    S.drawOffer = st.drawOffer;
    if ((!st.white || !st.black) && !S.started) { showWaiting(st); return; }
    if (st.gameNo !== S.gameNo) {
      S.gameNo = st.gameNo;
      S.started = true;
      showScreen('game');
      newGame();
    }
    const g = S.game, moves = st.moves || [];
    const diverged = moves.length < g.moves.length || g.moves.some((m, i) => i < moves.length && m.uci !== moves[i]);
    if (diverged) S.game = Game.fromMoves(moves);
    else for (let i = g.moves.length; i < moves.length; i++) {
      if (!g.move(moves[i])) { S.game = Game.fromMoves(moves); break; }
    }
    if (!S.result) {
      if (st.result) finish(st.result, st.reason);
      else { const s = S.game.status(); if (s.over) finish(s.result, s.reason); }
    }
    if (S.view === 'play') renderPlay();
  }

  function showWaiting(st) {
    showScreen('waiting');
    $('#wait-code').textContent = st.code;
    $('#wait-color').textContent = colorName(st.you);
    api('info').then(info => {
      const links = info.ips.length ? info.ips.map(ip => `http://${ip}:${info.port}/?join=${st.code}`) : [location.origin + '/?join=' + st.code];
      $('#wait-links').innerHTML = links.map(l => `<code>${esc(l)}</code>`).join('');
    }).catch(() => {});
  }

  // ---------------------------------------------------------------- Playing
  const playCtl = {
    canSelect(sq) {
      if (!canMoveNow()) return false;
      const p = S.game.pieceAt(sq);
      return !!p && p.c === S.game.turn();
    },
    targetsFor(sq) { return [...new Set(S.game.legal().filter(m => m.from === sq).map(m => m.to))]; },
    tryMove(from, to) {
      const opts = S.game.legal().filter(m => m.from === from && m.to === to);
      if (!opts.length) return;
      if (opts.length > 1) askPromotion(S.game.turn()).then(t => { if (t) commitMove(from + to + t); });
      else commitMove(opts[0].uci);
    }
  };

  function canMoveNow() {
    if (!S.game || S.result || S.view !== 'play') return false;
    if (S.mode === 'local') return true;
    return S.mode === 'online' && S.my === S.game.turn() && !S.pending && S.started;
  }

  function newGame() {
    stopReview();
    Object.assign(S, { game: new Game(), result: null, reason: null, drawOffer: null, view: 'play' });
    S.flipped = S.mode === 'online' && S.my === 'b';
    closeModal();
    showPlayPanel();
    renderPlay();
  }

  function commitMove(u) {
    const rec = S.game.move(u);
    if (!rec) return;
    const st = S.game.status();
    if (S.mode === 'online') {
      S.seq++;
      S.pending = true;
      post('move', { ply: S.game.moves.length - 1, uci: u, result: st.over ? st.result : null, reason: st.over ? st.reason : null })
        .then(s => { S.pending = false; S.seq++; applyState(s); })
        .catch(err => {
          S.pending = false; S.seq++;
          toast(err.message);
          if (!st.over) { S.game = Game.fromMoves(S.game.moves.slice(0, -1).map(m => m.uci)); renderPlay(); }
          poll();
        });
    }
    if (st.over) finish(st.result, st.reason);
    else renderPlay();
  }

  function resultText(result, reason) {
    if (result === '1/2-1/2') return { title: 'Draw', sub: 'by ' + reason };
    const winner = result === '1-0' ? 'w' : 'b';
    let title = `${colorName(winner)} wins`;
    if (S.mode === 'online' && (S.my === 'w' || S.my === 'b')) title = S.my === winner ? 'You won!' : 'You lost';
    const how = reason === 'checkmate' ? 'by checkmate' : reason === 'resignation' ? `${S.names[other(winner)]} resigned` : 'by ' + reason;
    return { title, sub: how };
  }

  function finish(result, reason) {
    if (S.result) return;
    S.result = result;
    S.reason = reason;
    if (S.view !== 'play') return;
    renderPlay();
    const t = resultText(result, reason);
    setTimeout(() => {
      if (S.view !== 'play' || S.result !== result) return;
      modal(`<h2>${esc(t.title)}</h2><p>${esc(t.sub)}</p>`, [
        { label: 'Game review', primary: true, onClick: enterReview },
        { label: S.mode === 'online' ? 'Rematch' : 'New game', onClick: rematch },
        { label: 'Close' }
      ]);
    }, 350);
  }

  function rematch() {
    if (S.mode === 'local') { newGame(); return; }
    post('rematch').then(applyState).catch(e => toast(e.message));
    toast('Rematch requested – waiting for your opponent.');
  }

  function renderPlayers(g, names, showOnline) {
    const top = S.flipped ? 'w' : 'b', bottom = other(top);
    const mat = g.material();
    for (const [id, c] of [['#top-player', top], ['#bottom-player', bottom]]) {
      const row = $(id);
      const taken = mat.lost[other(c)].map(t => GLYPH[t] + VS).join('');
      const adv = c === 'w' ? mat.diff : -mat.diff;
      row.className = 'player-row' + (S.view === 'play' && !S.result && g.turn() === c ? ' to-move' : '');
      row.innerHTML = `<span class="swatch ${c}"></span>` +
        (showOnline ? `<span class="dot ${S.online[c] ? '' : 'off'}" title="${S.online[c] ? 'Connected' : 'Disconnected'}"></span>` : '') +
        `<span class="pname">${esc(names[c])}</span>` +
        `<span class="caps">${taken}${adv > 0 ? `<small>+${adv}</small>` : ''}</span>`;
    }
  }

  function renderPlay() {
    const g = S.game;
    const last = g.moves[g.moves.length - 1] || null;
    board.set({ game: g, lastMove: last, arrows: [], badge: null, ctl: playCtl, flipped: S.flipped });
    renderPlayers(g, S.names, S.mode === 'online');

    let status, small = '';
    const turn = g.turn();
    if (S.result) {
      const t = resultText(S.result, S.reason);
      status = t.title; small = t.sub;
    } else if (S.mode === 'local') {
      status = `${colorName(turn)} to move`;
    } else if (S.my !== 'w' && S.my !== 'b') {
      status = 'Spectating'; small = `${colorName(turn)} to move`;
    } else if (S.my === turn) {
      status = 'Your move';
    } else {
      status = `Waiting for ${S.names[turn]}…`;
      if (!S.online[turn]) small = 'Your opponent seems to be disconnected.';
    }
    if (!S.result && g.inCheck()) status += ' — check!';
    $('#status').innerHTML = esc(status) + (small ? `<small>${esc(small)}</small>` : '');

    const isPlayer = S.mode === 'local' || S.my === 'w' || S.my === 'b';
    $('#draw-banner').classList.toggle('hidden', !(S.mode === 'online' && !S.result && S.drawOffer && S.drawOffer !== S.my && isPlayer));
    $('#play-actions').classList.toggle('hidden', !!S.result || !isPlayer);
    $('#over-actions').classList.toggle('hidden', !S.result);
    const drawBtn = $('#btn-draw');
    drawBtn.textContent = S.mode === 'local' ? 'Agree draw' : S.drawOffer === S.my ? 'Draw offered' : 'Offer draw';
    drawBtn.disabled = S.mode === 'online' && S.drawOffer === S.my;
    const rm = $('#btn-rematch');
    rm.classList.toggle('hidden', S.mode === 'online' && !isPlayer);
    if (S.mode === 'online') {
      rm.textContent = S.rematch.includes(S.my) ? 'Rematch requested' : S.rematch.length ? 'Accept rematch' : 'Rematch';
      rm.disabled = S.rematch.includes(S.my);
    } else { rm.textContent = 'New game'; rm.disabled = false; }

    renderMoveList($('#move-list'), g.moves, null, null);
  }

  function renderMoveList(box, moves, cls, cur, onPick) {
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.textContent = '';
    for (let i = 0; i < moves.length; i += 2) {
      const no = document.createElement('div');
      no.className = 'no';
      no.textContent = i / 2 + 1 + '.';
      box.appendChild(no);
      for (let j = i; j < i + 2; j++) {
        const d = document.createElement('div');
        d.className = 'mv';
        if (j < moves.length) {
          d.appendChild(document.createTextNode(moves[j].san));
          const c = cls && cls[j];
          if (c && c.cls !== 'good' && c.cls !== 'excellent') {
            const t = document.createElement('span');
            t.className = 'tag ' + c.cls;
            t.textContent = SYM[c.cls];
            t.title = LABEL[c.cls];
            d.appendChild(t);
          }
          if (cur === j + 1) d.classList.add('cur');
          if (onPick) d.onclick = () => onPick(j + 1);
        }
        box.appendChild(d);
      }
    }
    if (cur != null) {
      const el = box.querySelector('.cur');
      if (el) el.scrollIntoView({ block: 'nearest' });
    } else if (atBottom) box.scrollTop = box.scrollHeight;
  }

  function showPlayPanel() {
    $('#play-panel').classList.remove('hidden');
    $('#review-panel').classList.add('hidden');
    $('#evalbar').classList.add('hidden');
  }

  // ---------------------------------------------------------------- Review
  const R = { key: null, worker: null, data: [], cls: [], fens: [], moves: [], ply: 0, done: false, progress: 0, names: {}, result: null, line: null };
  const isMate = s => Math.abs(s) > MATE - 1000;
  const mateIn = s => Math.ceil((MATE - Math.abs(s)) / 2);
  const winP = s => (isMate(s) ? (s > 0 ? 100 : 0) : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * s)) - 1));
  const whiteScore = i => (R.data[i] ? (i % 2 === 0 ? R.data[i].score : -R.data[i].score) : null);
  const fmt = ws => {
    if (ws == null) return '';
    if (isMate(ws)) { const n = mateIn(ws); return n === 0 ? (ws > 0 ? '1-0' : '0-1') : (ws > 0 ? '+' : '-') + 'M' + n; }
    const v = ws / 100;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  };

  function enterReview() {
    closeModal();
    S.view = 'review';
    stopLine();
    $('#play-panel').classList.add('hidden');
    $('#review-panel').classList.remove('hidden');
    $('#evalbar').classList.remove('hidden');
    const key = S.game.moves.map(m => m.uci).join(' ') + '|' + S.result;
    if (R.key !== key) {
      R.key = key;
      R.moves = S.game.moves.map(m => Object.assign({}, m));
      R.result = S.result;
      R.names = Object.assign({}, S.names);
      const g = new Game();
      R.fens = [g.fen()];
      for (const m of R.moves) { g.move(m.uci); R.fens.push(g.fen()); }
      R.ply = 0;
      startAnalysis();
    }
    renderReview();
  }

  function startAnalysis() {
    if (R.worker) R.worker.terminate();
    R.data = new Array(R.moves.length + 1).fill(null);
    R.cls = [];
    R.done = false;
    R.progress = 0;
    const w = new Worker('js/engine.js');
    R.worker = w;
    w.onmessage = e => {
      const msg = e.data;
      if (msg.type === 'progress') {
        R.data[msg.i] = msg.data;
        R.progress = (msg.i + 1) / msg.total;
        R.cls = R.moves.map((_, i) => classify(i));
      } else if (msg.type === 'done') {
        R.done = true;
        w.terminate();
        if (R.worker === w) R.worker = null;
      }
      if (S.view === 'review') renderReview();
    };
    w.onerror = e => toast('Analysis failed: ' + (e.message || 'unknown error'));
    w.postMessage({ type: 'review', moves: R.moves.map(m => m.uci), movetime: +$('#review-depth').value, startFen: START_FEN, result: R.result });
  }

  function stopReview() {
    stopLine();
    if (R.worker) { R.worker.terminate(); R.worker = null; }
    R.key = null;
  }

  function classify(i) {
    const a = R.data[i], b = R.data[i + 1];
    if (!a || !b) return null;
    const mv = R.moves[i];
    const before = a.score, after = -b.score;
    const drop = Math.max(0, winP(before) - winP(after));
    const c = { drop, before, after, allowsMate: false };
    if (a.legalCount === 1) c.cls = 'forced';
    else if (mv.uci === a.best || mv.san.endsWith('#')) c.cls = 'best';
    else if (isMate(before) && before > 0 && !(isMate(after) && after > 0)) c.cls = 'missedmate';
    else if (drop < 2) c.cls = 'excellent';
    else if (drop < 5) c.cls = 'good';
    else if (drop < 10) c.cls = 'inaccuracy';
    else if (drop < 20) c.cls = 'mistake';
    else c.cls = 'blunder';
    if (isMate(after) && after < 0 && !(isMate(before) && before < 0)) {
      c.allowsMate = true;
      if (c.cls !== 'missedmate') c.cls = 'blunder';
    }
    c.acc = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * drop) - 3.1669));
    return c;
  }

  function lineText(line, startPly) {
    let s = '';
    line.forEach((m, k) => {
      const p = startPly + k;
      if (p % 2 === 0) s += `${p / 2 + 1}. `;
      else if (k === 0) s += `${(p - 1) / 2 + 1}… `;
      s += m.san + ' ';
    });
    return s.trim();
  }
  const moveLabel = i => (i % 2 === 0 ? `${i / 2 + 1}. ` : `${(i - 1) / 2 + 1}… `);
  const uciArrow = (u, color, opacity) => ({ from: u.slice(0, 2), to: u.slice(2, 4), color, opacity });

  function goto(ply) {
    stopLine();
    R.ply = Math.max(0, Math.min(R.moves.length, ply));
    renderReview();
  }

  function renderReview() {
    const ply = R.ply;
    if (R.line) {
      const L = R.line;
      board.set({ game: L.game, lastMove: L.game.moves[L.game.moves.length - 1] || null, arrows: [], badge: null, ctl: null, selected: null, targets: [], flipped: S.flipped });
    } else {
      const g = new Game(R.fens[ply]);
      const mv = ply > 0 ? R.moves[ply - 1] : null;
      const c = ply > 0 ? R.cls[ply - 1] : null;
      const arrows = [];
      const prev = ply > 0 ? R.data[ply - 1] : null;
      if (c && c.cls !== 'best' && c.cls !== 'forced' && prev && prev.best && prev.best !== mv.uci) arrows.push(uciArrow(prev.best, '#4f9b3a'));
      if ($('#rv-show-best').checked && R.data[ply] && R.data[ply].best) arrows.push(uciArrow(R.data[ply].best, '#3d7fd1', 0.6));
      board.set({ game: g, lastMove: mv, arrows, badge: c ? { sq: mv.to, cls: c.cls } : null, ctl: null, selected: null, targets: [], flipped: S.flipped });
    }
    renderPlayers(R.line ? R.line.game : new Game(R.fens[ply]), R.names, false);

    // Eval bar
    const ws = whiteScore(ply);
    const fill = document.querySelector('.evalfill'), txt = document.querySelector('.evaltext');
    const wp = ws == null ? 50 : winP(ws);
    fill.style.height = (S.flipped ? 100 - wp : wp) + '%';
    fill.style.background = S.flipped ? '#3b3b3b' : '#f2f0eb';
    $('#evalbar').style.background = S.flipped ? '#f2f0eb' : '#3b3b3b';
    txt.textContent = fmt(ws);
    const whiteAhead = ws == null || ws >= 0;
    txt.classList.toggle('top', whiteAhead === S.flipped);
    txt.style.color = whiteAhead ? '#333' : '#eee';

    // Progress
    const pr = $('#review-progress');
    pr.classList.toggle('hidden', R.done);
    pr.querySelector('div').style.width = Math.round(R.progress * 100) + '%';
    pr.querySelector('span').textContent = `Analyzing… ${Math.round(R.progress * 100)}%`;

    renderSummary();
    renderGraph();
    renderComment();
    renderMoveList($('#review-moves'), R.moves, R.cls, ply, goto);
  }

  function renderSummary() {
    const out = [];
    for (const c of ['w', 'b']) {
      const mine = R.cls.filter((x, i) => x && R.moves[i].color === c);
      const scored = mine.filter(x => x.cls !== 'forced');
      const acc = scored.length ? scored.reduce((s, x) => s + x.acc, 0) / scored.length : null;
      const count = k => mine.filter(x => x.cls === k).length;
      out.push(`<div class="side">
        <div class="who"><span class="swatch ${c}" style="width:12px;height:12px;border-radius:3px;display:inline-block;background:${c === 'w' ? '#f4f1ea' : '#1a1a1a'};border:1px solid #777"></span>${esc(R.names[c])}</div>
        <div class="acc">${acc == null ? '–' : acc.toFixed(1)}<small> accuracy</small></div>
        <div class="row"><span>Best / excellent</span><b>${count('best') + count('excellent')}</b></div>
        <div class="row"><span style="color:var(--c-inaccuracy)">Inaccuracies</span><b>${count('inaccuracy')}</b></div>
        <div class="row"><span style="color:var(--c-mistake)">Mistakes</span><b>${count('mistake')}</b></div>
        <div class="row"><span style="color:var(--c-blunder)">Blunders</span><b>${count('blunder')}</b></div>
        <div class="row"><span style="color:var(--c-missedmate)">Missed mates</span><b>${count('missedmate')}</b></div>
      </div>`);
    }
    $('#review-summary').innerHTML = out.join('');
  }

  function renderGraph() {
    const svg = $('#eval-graph'), W = 300, H = 70, N = Math.max(1, R.moves.length);
    const pts = [];
    for (let i = 0; i <= R.moves.length; i++) {
      const ws = whiteScore(i);
      if (ws == null) break;
      pts.push([(i / N) * W, H * (1 - winP(ws) / 100)]);
    }
    let html = `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#777" stroke-width="0.6"/>`;
    if (pts.length) {
      const lastX = pts[pts.length - 1][0];
      html += `<polygon fill="#f2f0eb" points="0,${H} ${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')} ${lastX.toFixed(1)},${H}"/>`;
      R.cls.forEach((c, i) => {
        if (!c || !['mistake', 'blunder', 'missedmate'].includes(c.cls) || !pts[i + 1]) return;
        html += `<circle cx="${pts[i + 1][0].toFixed(1)}" cy="${pts[i + 1][1].toFixed(1)}" r="2.6" fill="var(--c-${c.cls})" stroke="#222" stroke-width="0.6"/>`;
      });
    }
    const cx = (R.ply / N) * W;
    html += `<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="#7fb35a" stroke-width="1.5"/>`;
    svg.innerHTML = html;
  }
  $('#eval-graph').addEventListener('click', e => {
    const r = e.currentTarget.getBoundingClientRect();
    goto(Math.round(((e.clientX - r.left) / r.width) * Math.max(1, R.moves.length)));
  });

  function renderComment() {
    const box = $('#review-comment'), ply = R.ply;
    if (R.line) {
      box.innerHTML = `<div class="head">Best line</div><div>${esc(lineText(R.line.moves, R.line.start))}</div><button id="btn-stop-line" class="small">Back to the game</button>`;
      $('#btn-stop-line').onclick = () => goto(R.ply);
      return;
    }
    if (ply === 0) {
      const d = R.data[0];
      box.innerHTML = `<div class="head">Starting position</div>` +
        (d ? `<div class="line">Engine suggests <b>${esc(d.bestSan)}</b>.</div>` : '<div class="line">Analyzing…</div>') +
        `<div class="line">Use ← → or click a move to step through the game.</div>`;
      return;
    }
    const mv = R.moves[ply - 1], c = R.cls[ply - 1], a = R.data[ply - 1];
    let head = `<div class="head">${esc(moveLabel(ply - 1) + mv.san)}`;
    if (!c) { box.innerHTML = head + '</div><div class="line">Analyzing…</div>'; return; }
    head += ` <span class="tag ${c.cls}">${LABEL[c.cls]}</span></div>`;
    const better = a.bestSan ? ` The best move was <b>${esc(a.bestSan)}</b>.` : '';
    let text;
    switch (c.cls) {
      case 'best':
        text = mv.san.endsWith('#') ? 'Checkmate!'
          : isMate(c.before) && c.before > 0 ? `The best move – it keeps a forced mate in ${mateIn(c.after)}.` : 'The best move in this position.';
        break;
      case 'excellent': text = 'An excellent move, practically as good as the best.'; break;
      case 'good': text = 'A good move.' + better; break;
      case 'forced': text = 'The only legal move.'; break;
      case 'inaccuracy': text = 'An inaccuracy.' + better; break;
      case 'mistake': text = 'A mistake.' + better; break;
      case 'blunder': text = 'A blunder!' + better; break;
      case 'missedmate': text = `<b>Missed checkmate!</b> ${esc(a.bestSan)} forces mate in ${mateIn(c.before)}.`; break;
    }
    if (c.allowsMate) text += ` This allows ${esc(R.names[other(mv.color)])} to force mate in ${mateIn(c.after)}.`;
    const sign = mv.color === 'w' ? 1 : -1;
    let html = head + `<div>${text}</div><div class="line">Evaluation: <b>${fmt(sign * c.before)}</b> → <b>${fmt(sign * c.after)}</b></div>`;
    const showLine = !['best', 'forced', 'excellent'].includes(c.cls) && a.line && a.line.length;
    if (showLine) {
      html += `<div class="line">Best line: <b>${esc(lineText(a.line, ply - 1))}</b></div><button id="btn-play-line" class="small">▶ Play best line</button>`;
    }
    box.innerHTML = html;
    if (showLine) $('#btn-play-line').onclick = () => playLine(ply - 1, a.line);
  }

  function playLine(startPly, line) {
    stopLine();
    const game = new Game(R.fens[startPly]);
    R.line = { game, moves: line, start: startPly, step: 0 };
    renderReview();
    R.line.timer = setInterval(() => {
      const L = R.line;
      if (!L || L.step >= L.moves.length) { if (L) clearInterval(L.timer); return; }
      L.game.move(L.moves[L.step++].uci);
      renderReview();
    }, 750);
  }
  function stopLine() {
    if (R.line) { clearInterval(R.line.timer); R.line = null; }
  }

  // ---------------------------------------------------------------- Wiring
  let pickedColor = 'r';
  for (const b of document.querySelectorAll('#color-pick button')) {
    b.onclick = () => {
      pickedColor = b.dataset.color;
      for (const x of document.querySelectorAll('#color-pick button')) x.classList.toggle('on', x === b);
    };
  }
  const nameInput = $('#name');
  try { nameInput.value = localStorage.getItem('chess-name') || ''; } catch (_) { /* ignore */ }
  const myName = () => {
    const n = nameInput.value.trim() || 'Player';
    try { localStorage.setItem('chess-name', n); } catch (_) { /* ignore */ }
    return n;
  };

  $('#btn-create').onclick = async () => {
    $('#lobby-err').textContent = '';
    try {
      const r = await api('create', { name: myName(), color: pickedColor === 'r' ? 'random' : pickedColor });
      startOnline(r.code, r.token);
    } catch (e) { $('#lobby-err').textContent = e.message; }
  };
  const joinCode = $('#join-code');
  const doJoin = async () => {
    $('#lobby-err').textContent = '';
    const code = joinCode.value.trim().toUpperCase();
    if (code.length !== 4) { $('#lobby-err').textContent = 'Enter the 4-letter game code.'; return; }
    try {
      const r = await api('join', { code, name: myName() });
      startOnline(r.code, r.token);
    } catch (e) { $('#lobby-err').textContent = e.message; }
  };
  $('#btn-join').onclick = doJoin;
  joinCode.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });
  $('#btn-local').onclick = () => {
    stopReview();
    clearTimeout(S.pollTimer);
    Object.assign(S, { mode: 'local', names: { w: 'White', b: 'Black' }, my: null });
    setConn(true);
    showScreen('game');
    newGame();
  };
  $('#btn-cancel-wait').onclick = () => leaveOnline();

  $('#btn-flip').onclick = $('#btn-flip2').onclick = () => {
    S.flipped = !S.flipped;
    if (S.view === 'review') renderReview(); else renderPlay();
  };
  $('#btn-resign').onclick = () => {
    if (S.result) return;
    if (S.mode === 'local') {
      const c = S.game.turn();
      modal(`<h2>Resign?</h2><p>${colorName(c)} resigns the game.</p>`, [
        { label: 'Resign', primary: true, onClick: () => finish(c === 'w' ? '0-1' : '1-0', 'resignation') }, { label: 'Cancel' }]);
    } else {
      modal('<h2>Resign?</h2><p>Your opponent wins the game.</p>', [
        { label: 'Resign', primary: true, onClick: () => post('resign').then(applyState).catch(e => toast(e.message)) }, { label: 'Cancel' }]);
    }
  };
  $('#btn-draw').onclick = () => {
    if (S.result) return;
    if (S.mode === 'local') {
      modal('<h2>Agree to a draw?</h2><p>Both players agree to end the game as a draw.</p>', [
        { label: 'Draw', primary: true, onClick: () => finish('1/2-1/2', 'agreement') }, { label: 'Cancel' }]);
    } else {
      post('draw', { action: 'offer' }).then(s => { applyState(s); toast('Draw offered.'); }).catch(e => toast(e.message));
    }
  };
  $('#btn-draw-accept').onclick = () => post('draw', { action: 'accept' }).then(applyState).catch(e => toast(e.message));
  $('#btn-draw-decline').onclick = () => post('draw', { action: 'decline' }).then(applyState).catch(e => toast(e.message));
  $('#btn-review').onclick = enterReview;
  $('#btn-rematch').onclick = rematch;
  $('#btn-lobby').onclick = () => { if (S.mode === 'online') leaveOnline(); else { S.mode = null; stopReview(); setConn(true); showScreen('lobby'); } };
  $('#btn-pgn').onclick = () => {
    const pgn = S.game.pgn({ White: S.names.w, Black: S.names.b, Result: S.result || '*' });
    const fallback = () => {
      modal(`<h2>PGN</h2><textarea readonly style="width:100%;height:160px;background:#24272c;color:inherit;border-radius:8px;border:1px solid var(--line);padding:8px">${esc(pgn)}</textarea>`, [{ label: 'Close' }]);
      const ta = $('#modal-card textarea');
      ta.focus(); ta.select();
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(pgn).then(() => toast('PGN copied to clipboard.'), fallback);
    else fallback();
  };
  $('#btn-back-game').onclick = () => {
    stopLine();
    S.view = 'play';
    showPlayPanel();
    renderPlay();
  };
  $('#btn-reanalyze').onclick = () => { if (R.moves.length || R.key) { startAnalysis(); renderReview(); } };
  $('#review-depth').onchange = () => { startAnalysis(); renderReview(); };
  $('#rv-first').onclick = () => goto(0);
  $('#rv-prev').onclick = () => goto(R.ply - 1);
  $('#rv-next').onclick = () => goto(R.ply + 1);
  $('#rv-last').onclick = () => goto(R.moves.length);
  $('#rv-mistake').onclick = () => {
    for (let i = R.ply; i < R.moves.length; i++) if (R.cls[i] && BAD.includes(R.cls[i].cls)) { goto(i + 1); return; }
    toast(R.done ? 'No more mistakes after this point.' : 'No mistakes found yet – analysis is still running.');
  };
  $('#rv-show-best').onchange = () => renderReview();
  document.addEventListener('keydown', e => {
    if (S.view !== 'review' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'ArrowLeft') { goto(R.ply - 1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { goto(R.ply + 1); e.preventDefault(); }
    else if (e.key === 'Home') goto(0);
    else if (e.key === 'End') goto(R.moves.length);
  });

  // ---------------------------------------------------------------- Startup
  api('info').then(info => {
    if (!info.ips.length) return;
    $('#lan-info').innerHTML = 'Others on your network can open: ' + info.ips.map(ip => `<code>http://${esc(ip)}:${info.port}</code>`).join(' ');
  }).catch(() => { $('#lan-info').textContent = 'Not connected to the chess server – online play is unavailable (local play still works).'; });

  const params = new URLSearchParams(location.search);
  if (params.get('join')) { joinCode.value = params.get('join').toUpperCase(); history.replaceState(null, '', location.pathname); }

  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('chess-session') || 'null'); } catch (_) { /* ignore */ }
  if (saved && saved.code && saved.token) startOnline(saved.code, saved.token);
  else showScreen('lobby');

  // Expose for debugging / testing.
  window.__chess = { S, R, board };
})();
