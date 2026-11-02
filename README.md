# LAN Chess

Two-player chess for your home network, with a post-game review that flags
blunders, mistakes, inaccuracies and **missed checkmates**, and shows the best move and line.

## Start it

Double-click **`start-chess.bat`** (Windows; nothing to install). The window prints addresses like:

```
On this computer:   http://localhost:8080
On your network:    http://192.168.1.17:8080
```

- You open the `localhost` address; the other player opens the `On your network` address
  on their computer (same Wi-Fi/LAN).
- The first time, Windows Firewall may ask about PowerShell — click **Allow** for *Private networks*.
  If the other computer can't connect, make sure your network is set to *Private* in Windows settings.
- Use a different port with: `start-chess.bat -Port 9000`

## Play

- **Host a game** → share the 4-letter code (or the link shown).
- **Join a game** → enter the code.
- **Same computer** → pass-and-play on one screen.
- Drag or click pieces to move. Offer draws, resign, request rematches (colors swap).

## Game review

After a game, click **Game review**. A built-in engine analyzes every move (Fast / Normal / Deep):

- Accuracy and blunder/mistake/inaccuracy/missed-mate counts for each player
- Evaluation bar and clickable evaluation graph
- Green arrow = what you should have played; ▶ *Play best line* animates the engine's line
- **Missed mate** (purple **M**) marks moves where a forced checkmate was available
- *Next mistake* jumps straight to the next error; ← / → step through moves
