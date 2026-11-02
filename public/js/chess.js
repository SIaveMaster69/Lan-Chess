// Chess rules: 0x88 board, move generation, make/unmake, SAN, game status.
// Shared by the page (window.ChessLib) and the analysis worker (self.ChessLib).
(function (root) {
  'use strict';

  const WHITE = 0, BLACK = 8;
  const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT_D = [33, 31, 18, 14, -33, -31, -18, -14];
  const KING_D = [16, -16, 1, -1, 17, 15, -17, -15];
  const BISHOP_D = [17, 15, -17, -15];
  const ROOK_D = [16, -16, 1, -1];
  const PIECE_CHARS = ' pnbrqk';

  // Move = from | to<<7 | promo<<14 | flags<<17
  const mkMove = (from, to, promo, flags) => from | (to << 7) | (promo << 14) | (flags << 17);
  const mFrom = m => m & 127;
  const mTo = m => (m >> 7) & 127;
  const mPromo = m => (m >> 14) & 7;
  const mFlags = m => m >> 17;

  const sqName = sq => 'abcdefgh'[sq & 7] + ((sq >> 4) + 1);
  const sqParse = s => (s.charCodeAt(1) - 49) * 16 + (s.charCodeAt(0) - 97);
  const uci = m => sqName(mFrom(m)) + sqName(mTo(m)) + (mPromo(m) ? PIECE_CHARS[mPromo(m)] : '');

  // Zobrist keys (deterministic xorshift)
  let seed = 0x2545f491;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed | 0; }
  const Z_PIECE = new Int32Array(16 * 128);
  for (let i = 0; i < Z_PIECE.length; i++) Z_PIECE[i] = rnd();
  const Z_CASTLE = new Int32Array(16);
  for (let i = 0; i < 16; i++) Z_CASTLE[i] = rnd();
  const Z_EP = new Int32Array(128);
  for (let i = 0; i < 128; i++) Z_EP[i] = rnd();
  const Z_SIDE = rnd();

  // Castling rights: 1=K 2=Q 4=k 8=q
  const CASTLE_MASK = new Uint8Array(128).fill(15);
  CASTLE_MASK[0] = 13; CASTLE_MASK[7] = 14; CASTLE_MASK[4] = 12;
  CASTLE_MASK[112] = 7; CASTLE_MASK[119] = 11; CASTLE_MASK[116] = 3;

  class Position {
    constructor(fen) {
      this.board = new Int8Array(128);
      this.kings = [0, 0];
      this.load(fen || START_FEN);
    }

    load(fen) {
      const b = this.board;
      b.fill(0);
      const parts = fen.trim().split(/\s+/);
      let r = 7, f = 0;
      for (const c of parts[0]) {
        if (c === '/') { r--; f = 0; }
        else if (c >= '1' && c <= '8') f += +c;
        else {
          const lower = c.toLowerCase();
          const t = PIECE_CHARS.indexOf(lower);
          const col = c === lower ? BLACK : WHITE;
          b[r * 16 + f] = t | col;
          if (t === KING) this.kings[col >> 3] = r * 16 + f;
          f++;
        }
      }
      this.turn = parts[1] === 'b' ? BLACK : WHITE;
      const c = parts[2] || '-';
      this.castle = (c.includes('K') ? 1 : 0) | (c.includes('Q') ? 2 : 0) | (c.includes('k') ? 4 : 0) | (c.includes('q') ? 8 : 0);
      this.ep = parts[3] && parts[3] !== '-' ? sqParse(parts[3]) : -1;
      this.half = +parts[4] || 0;
      this.full = +parts[5] || 1;
      this.stack = [];
      this.hist = [];
      this.hash = this.computeHash();
    }

    computeHash() {
      let h = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = this.board[sq];
        if (p) h ^= Z_PIECE[p * 128 + sq];
      }
      h ^= Z_CASTLE[this.castle];
      if (this.ep >= 0) h ^= Z_EP[this.ep];
      if (this.turn === BLACK) h ^= Z_SIDE;
      return h;
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let empty = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.board[r * 16 + f];
          if (!p) { empty++; continue; }
          if (empty) { s += empty; empty = 0; }
          const ch = PIECE_CHARS[p & 7];
          s += p & BLACK ? ch : ch.toUpperCase();
        }
        if (empty) s += empty;
        if (r) s += '/';
      }
      let c = '';
      if (this.castle & 1) c += 'K';
      if (this.castle & 2) c += 'Q';
      if (this.castle & 4) c += 'k';
      if (this.castle & 8) c += 'q';
      return `${s} ${this.turn === WHITE ? 'w' : 'b'} ${c || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    }

    attacked(sq, by) {
      const b = this.board;
      let s;
      if (by === WHITE) {
        s = sq - 15; if (!(s & 0x88) && b[s] === PAWN) return true;
        s = sq - 17; if (!(s & 0x88) && b[s] === PAWN) return true;
      } else {
        s = sq + 15; if (!(s & 0x88) && b[s] === (PAWN | BLACK)) return true;
        s = sq + 17; if (!(s & 0x88) && b[s] === (PAWN | BLACK)) return true;
      }
      const kn = KNIGHT | by, kg = KING | by;
      for (let i = 0; i < 8; i++) {
        s = sq + KNIGHT_D[i];
        if (!(s & 0x88) && b[s] === kn) return true;
        s = sq + KING_D[i];
        if (!(s & 0x88) && b[s] === kg) return true;
      }
      const bi = BISHOP | by, ro = ROOK | by, qu = QUEEN | by;
      for (let i = 0; i < 4; i++) {
        let d = BISHOP_D[i];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === bi || p === qu) return true; break; }
          s += d;
        }
        d = ROOK_D[i];
        s = sq + d;
        while (!(s & 0x88)) {
          const p = b[s];
          if (p) { if (p === ro || p === qu) return true; break; }
          s += d;
        }
      }
      return false;
    }

    inCheck(color) { return this.attacked(this.kings[color >> 3], color ^ BLACK); }

    // Pseudo-legal moves. capsOnly: captures and promotions only.
    genMoves(capsOnly) {
      const out = [];
      const b = this.board, us = this.turn, them = us ^ BLACK;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p || (p & BLACK) !== us) continue;
        const t = p & 7;
        if (t === PAWN) {
          const dir = us === WHITE ? 16 : -16;
          const r = sq >> 4;
          const promoRank = us === WHITE ? 6 : 1;
          const startRank = us === WHITE ? 1 : 6;
          let to = sq + dir;
          if (!b[to]) {
            if (r === promoRank) addPromos(out, sq, to, 0);
            else if (!capsOnly) {
              out.push(mkMove(sq, to, 0, 0));
              if (r === startRank && !b[to + dir]) out.push(mkMove(sq, to + dir, 0, F_DOUBLE));
            }
          }
          for (let k = 0; k < 2; k++) {
            to = sq + dir + (k ? 1 : -1);
            if (to & 0x88) continue;
            const q = b[to];
            if (q && (q & BLACK) === them) {
              if (r === promoRank) addPromos(out, sq, to, F_CAP);
              else out.push(mkMove(sq, to, 0, F_CAP));
            } else if (to === this.ep) {
              out.push(mkMove(sq, to, 0, F_CAP | F_EP));
            }
          }
        } else if (t === KNIGHT || t === KING) {
          const D = t === KNIGHT ? KNIGHT_D : KING_D;
          for (let i = 0; i < 8; i++) {
            const to = sq + D[i];
            if (to & 0x88) continue;
            const q = b[to];
            if (!q) { if (!capsOnly) out.push(mkMove(sq, to, 0, 0)); }
            else if ((q & BLACK) === them) out.push(mkMove(sq, to, 0, F_CAP));
          }
        } else {
          const D = t === BISHOP ? BISHOP_D : t === ROOK ? ROOK_D : KING_D;
          for (let i = 0; i < D.length; i++) {
            const d = D[i];
            let to = sq + d;
            while (!(to & 0x88)) {
              const q = b[to];
              if (!q) { if (!capsOnly) out.push(mkMove(sq, to, 0, 0)); }
              else { if ((q & BLACK) === them) out.push(mkMove(sq, to, 0, F_CAP)); break; }
              to += d;
            }
          }
        }
      }
      if (!capsOnly && this.castle) {
        if (us === WHITE) {
          if ((this.castle & 1) && !b[5] && !b[6] && b[7] === ROOK && !this.attacked(4, BLACK) && !this.attacked(5, BLACK))
            out.push(mkMove(4, 6, 0, F_CASTLE));
          if ((this.castle & 2) && !b[3] && !b[2] && !b[1] && b[0] === ROOK && !this.attacked(4, BLACK) && !this.attacked(3, BLACK))
            out.push(mkMove(4, 2, 0, F_CASTLE));
        } else {
          if ((this.castle & 4) && !b[117] && !b[118] && b[119] === (ROOK | BLACK) && !this.attacked(116, WHITE) && !this.attacked(117, WHITE))
            out.push(mkMove(116, 118, 0, F_CASTLE));
          if ((this.castle & 8) && !b[115] && !b[114] && !b[113] && b[112] === (ROOK | BLACK) && !this.attacked(116, WHITE) && !this.attacked(115, WHITE))
            out.push(mkMove(116, 114, 0, F_CASTLE));
        }
      }
      return out;
    }

    make(m) {
      const b = this.board;
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
      const us = this.turn, p = b[from];
      const capSq = (fl & F_EP) ? (us === WHITE ? to - 16 : to + 16) : to;
      const cap = b[capSq];
      this.stack.push(m, cap, this.castle, this.ep, this.half);
      this.hist.push(this.hash);
      let h = this.hash ^ Z_PIECE[p * 128 + from];
      if (cap) { h ^= Z_PIECE[cap * 128 + capSq]; b[capSq] = 0; }
      const placed = promo ? (promo | us) : p;
      b[from] = 0;
      b[to] = placed;
      h ^= Z_PIECE[placed * 128 + to];
      if (fl & F_CASTLE) {
        const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
        const rook = b[rf];
        b[rf] = 0; b[rt] = rook;
        h ^= Z_PIECE[rook * 128 + rf] ^ Z_PIECE[rook * 128 + rt];
      }
      if ((p & 7) === KING) this.kings[us >> 3] = to;
      h ^= Z_CASTLE[this.castle];
      this.castle &= CASTLE_MASK[from] & CASTLE_MASK[to];
      h ^= Z_CASTLE[this.castle];
      if (this.ep >= 0) h ^= Z_EP[this.ep];
      this.ep = (fl & F_DOUBLE) ? (from + to) >> 1 : -1;
      if (this.ep >= 0) h ^= Z_EP[this.ep];
      this.half = ((p & 7) === PAWN || cap) ? 0 : this.half + 1;
      if (us === BLACK) this.full++;
      this.turn = us ^ BLACK;
      this.hash = h ^ Z_SIDE;
    }

    unmake() {
      const s = this.stack;
      const half = s.pop(), ep = s.pop(), castle = s.pop(), cap = s.pop(), m = s.pop();
      this.hash = this.hist.pop();
      const b = this.board;
      const from = m & 127, to = (m >> 7) & 127, promo = (m >> 14) & 7, fl = m >> 17;
      this.turn ^= BLACK;
      const us = this.turn;
      if (us === BLACK) this.full--;
      const p = promo ? (PAWN | us) : b[to];
      b[from] = p;
      if (fl & F_EP) { b[to] = 0; b[us === WHITE ? to - 16 : to + 16] = cap; }
      else b[to] = cap;
      if (fl & F_CASTLE) {
        const rf = to > from ? to + 1 : to - 2, rt = to > from ? to - 1 : to + 1;
        b[rf] = b[rt]; b[rt] = 0;
      }
      if ((p & 7) === KING) this.kings[us >> 3] = from;
      this.castle = castle; this.ep = ep; this.half = half;
    }

    legalMoves() {
      const us = this.turn;
      return this.genMoves(false).filter(m => {
        this.make(m);
        const ok = !this.inCheck(us);
        this.unmake();
        return ok;
      });
    }

    // Two-fold repetition since the last irreversible move (used inside search).
    isRepetition() {
      const h = this.hist, n = h.length, stop = Math.max(0, n - this.half);
      for (let i = n - 2; i >= stop; i -= 2) if (h[i] === this.hash) return true;
      return false;
    }

    insufficientMaterial() {
      let minors = 0, bishopColors = 0, knights = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = this.board[sq] & 7;
        if (t === PAWN || t === ROOK || t === QUEEN) return false;
        if (t === KNIGHT) { minors++; knights++; }
        if (t === BISHOP) { minors++; bishopColors |= (((sq >> 4) + (sq & 7)) & 1) ? 2 : 1; }
      }
      if (minors <= 1) return true;
      return knights === 0 && bishopColors !== 3;
    }

    san(m, legal) {
      legal = legal || this.legalMoves();
      const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m);
      const p = this.board[from], t = p & 7;
      let s;
      if (fl & F_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
      else if (t === PAWN) {
        s = (fl & F_CAP) ? 'abcdefgh'[from & 7] + 'x' : '';
        s += sqName(to);
        if (promo) s += '=' + PIECE_CHARS[promo].toUpperCase();
      } else {
        s = PIECE_CHARS[t].toUpperCase();
        let ambig = false, sameFile = false, sameRank = false;
        for (const o of legal) {
          const of = mFrom(o);
          if (o === m || mTo(o) !== to || of === from || this.board[of] !== p) continue;
          ambig = true;
          if ((of & 7) === (from & 7)) sameFile = true;
          if ((of >> 4) === (from >> 4)) sameRank = true;
        }
        if (ambig) {
          const n = sqName(from);
          s += !sameFile ? n[0] : !sameRank ? n[1] : n;
        }
        if (fl & F_CAP) s += 'x';
        s += sqName(to);
      }
      this.make(m);
      if (this.inCheck(this.turn)) s += this.legalMoves().length ? '+' : '#';
      this.unmake();
      return s;
    }
  }

  function addPromos(out, from, to, flags) {
    out.push(mkMove(from, to, QUEEN, flags), mkMove(from, to, KNIGHT, flags),
      mkMove(from, to, ROOK, flags), mkMove(from, to, BISHOP, flags));
  }

  // High-level game wrapper used by the UI.
  class Game {
    constructor(fen) {
      this.startFen = fen || START_FEN;
      this.pos = new Position(this.startFen);
      this.moves = [];
      this.keys = [this.posKey()];
    }
    static fromMoves(list, fen) {
      const g = new Game(fen);
      for (const u of list) if (!g.move(u)) break;
      return g;
    }
    posKey() { return this.pos.fen().split(' ').slice(0, 4).join(' '); }
    fen() { return this.pos.fen(); }
    turn() { return this.pos.turn === WHITE ? 'w' : 'b'; }
    inCheck() { return this.pos.inCheck(this.pos.turn); }
    kingSquare(c) { return sqName(this.pos.kings[c === 'w' ? 0 : 1]); }
    pieceAt(name) {
      const p = this.pos.board[sqParse(name)];
      return p ? { t: PIECE_CHARS[p & 7], c: p & BLACK ? 'b' : 'w' } : null;
    }
    legal() {
      return this.pos.legalMoves().map(m => ({
        from: sqName(mFrom(m)), to: sqName(mTo(m)),
        promo: mPromo(m) ? PIECE_CHARS[mPromo(m)] : null, uci: uci(m)
      }));
    }
    move(u) {
      const L = this.pos.legalMoves();
      const m = L.find(x => uci(x) === u);
      if (m === undefined) return null;
      const rec = { uci: u, san: this.pos.san(m, L), color: this.turn(), from: sqName(mFrom(m)), to: sqName(mTo(m)) };
      this.pos.make(m);
      this.moves.push(rec);
      this.keys.push(this.posKey());
      return rec;
    }
    status() {
      const pos = this.pos;
      if (!pos.legalMoves().length) {
        if (pos.inCheck(pos.turn)) return { over: true, result: pos.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate' };
        return { over: true, result: '1/2-1/2', reason: 'stalemate' };
      }
      if (pos.insufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
      if (pos.half >= 100) return { over: true, result: '1/2-1/2', reason: '50-move rule' };
      const k = this.keys[this.keys.length - 1];
      if (this.keys.filter(x => x === k).length >= 3) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
      return { over: false };
    }
    material() {
      // Captured-material summary for the UI: pieces each side has lost.
      const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
      const have = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = this.pos.board[sq];
        if (!p || (p & 7) === KING) continue;
        have[p & BLACK ? 'b' : 'w'][PIECE_CHARS[p & 7]]++;
      }
      const val = { p: 1, n: 3, b: 3, r: 5, q: 9 };
      const lost = { w: [], b: [] }, score = { w: 0, b: 0 };
      for (const c of ['w', 'b']) {
        for (const t of ['q', 'r', 'b', 'n', 'p']) {
          for (let i = have[c][t]; i < start[t]; i++) lost[c].push(t);
          score[c] += have[c][t] * val[t];
        }
      }
      return { lost, diff: score.w - score.b };
    }
    pgn(headers) {
      const h = Object.assign({ Event: 'LAN Chess game', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.') }, headers);
      let s = Object.entries(h).map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`).join('\n') + '\n\n';
      const parts = [];
      this.moves.forEach((m, i) => { if (i % 2 === 0) parts.push((i / 2 + 1) + '.'); parts.push(m.san); });
      parts.push(h.Result || '*');
      return s + parts.join(' ') + '\n';
    }
  }

  root.ChessLib = {
    Position, Game, START_FEN, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
    F_CAP, F_EP, F_CASTLE, F_DOUBLE, mkMove, mFrom, mTo, mPromo, mFlags, sqName, sqParse, uci
  };
})(typeof self !== 'undefined' ? self : this);
