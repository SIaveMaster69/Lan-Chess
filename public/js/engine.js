// Analysis worker: alpha-beta search (PVS, transposition table, check extensions,
// quiescence) used for post-game review. Scores are centipawns from the side to move;
// mate scores are MATE - plies.
importScripts('chess.js');
const { Position, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_CAP, F_EP, mFrom, mTo, mPromo, mFlags, uci } = self.ChessLib;

const MATE = 100000, INF = 1000000, MAX_PLY = 64;
const isMate = s => Math.abs(s) > MATE - 1000;
const VAL = [0, 100, 320, 330, 500, 900, 0];

// Piece-square tables, a8..h8 first (White's view).
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20]
];
const KING_MG = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const KING_EG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

function evaluate(pos) {
  const b = pos.board;
  let mg = 0, eg = 0, phase = 0, wb = 0, bb = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = b[sq];
    if (!p) continue;
    const t = p & 7, white = !(p & BLACK);
    const idx = white ? (7 - (sq >> 4)) * 8 + (sq & 7) : (sq >> 4) * 8 + (sq & 7);
    let vm, ve;
    if (t === KING) { vm = KING_MG[idx]; ve = KING_EG[idx]; }
    else {
      vm = ve = VAL[t] + PST[t][idx];
      if (t === PAWN) ve += 20;
      else if (t === ROOK) phase += 2;
      else if (t === QUEEN) phase += 4;
      else phase += 1;
      if (t === BISHOP) { if (white) wb++; else bb++; }
    }
    if (white) { mg += vm; eg += ve; } else { mg -= vm; eg -= ve; }
  }
  if (wb >= 2) { mg += 30; eg += 40; }
  if (bb >= 2) { mg -= 30; eg -= 40; }
  if (phase > 24) phase = 24;
  const s = ((mg * phase + eg * (24 - phase)) / 24) | 0;
  return pos.turn === WHITE ? s : -s;
}

const TT_SIZE = 1 << 20, TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE), ttMove = new Int32Array(TT_SIZE), ttScore = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE), ttFlag = new Uint8Array(TT_SIZE); // 1 exact, 2 lower, 3 upper
const history = new Int32Array(16 * 128);
const killers = Array.from({ length: MAX_PLY }, () => [0, 0]);
const pvTable = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_PLY));
const pvLen = new Int32Array(MAX_PLY);
let nodes = 0, deadline = 0, stopped = false, canStop = false;

const toTT = (s, ply) => s > MATE - 1000 ? s + ply : s < -MATE + 1000 ? s - ply : s;
const fromTT = (s, ply) => s > MATE - 1000 ? s - ply : s < -MATE + 1000 ? s + ply : s;

function scoreMoves(pos, moves, ttm, ply) {
  const b = pos.board, sc = new Int32Array(moves.length);
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i], fl = mFlags(m);
    if (m === ttm) sc[i] = 3000000;
    else if (fl & F_CAP) sc[i] = 2000000 + ((fl & F_EP) ? PAWN : b[mTo(m)] & 7) * 100 - (b[mFrom(m)] & 7);
    else if (mPromo(m)) sc[i] = 1900000 + mPromo(m);
    else if (ply < MAX_PLY && killers[ply][0] === m) sc[i] = 1800000;
    else if (ply < MAX_PLY && killers[ply][1] === m) sc[i] = 1700000;
    else sc[i] = history[b[mFrom(m)] * 128 + mTo(m)];
  }
  return sc;
}

function pick(moves, sc, i) {
  let bi = i;
  for (let j = i + 1; j < moves.length; j++) if (sc[j] > sc[bi]) bi = j;
  if (bi !== i) {
    const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
    const ts = sc[i]; sc[i] = sc[bi]; sc[bi] = ts;
  }
  return moves[i];
}

function tick() {
  if ((++nodes & 2047) === 0 && canStop && Date.now() > deadline) stopped = true;
}

function quiesce(pos, alpha, beta, ply) {
  pvLen[ply] = ply;
  tick();
  if (stopped) return 0;
  const stand = evaluate(pos);
  if (ply >= MAX_PLY - 1 || stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  const moves = pos.genMoves(true), sc = scoreMoves(pos, moves, 0, MAX_PLY), us = pos.turn;
  for (let i = 0; i < moves.length; i++) {
    const m = pick(moves, sc, i);
    pos.make(m);
    if (pos.inCheck(us)) { pos.unmake(); continue; }
    const s = -quiesce(pos, -beta, -alpha, ply + 1);
    pos.unmake();
    if (stopped) return 0;
    if (s > alpha) { alpha = s; if (alpha >= beta) return alpha; }
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply) {
  pvLen[ply] = ply;
  if (ply > 0 && (pos.half >= 100 || pos.isRepetition())) return 0;
  if (ply >= MAX_PLY - 1) return evaluate(pos);
  const us = pos.turn, inCheck = pos.inCheck(us);
  if (inCheck) depth++;
  if (depth <= 0) return quiesce(pos, alpha, beta, ply);
  tick();
  if (stopped) return 0;

  const alpha0 = alpha, idx = pos.hash & TT_MASK;
  let ttm = 0;
  if (ttFlag[idx] && ttKey[idx] === pos.hash) {
    ttm = ttMove[idx];
    if (ply > 0 && ttDepth[idx] >= depth) {
      const s = fromTT(ttScore[idx], ply), f = ttFlag[idx];
      if (f === 1 || (f === 2 && s >= beta) || (f === 3 && s <= alpha)) return s;
    }
  }

  const moves = pos.genMoves(false), sc = scoreMoves(pos, moves, ttm, ply);
  let best = -INF, bestMove = 0, legal = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = pick(moves, sc, i);
    pos.make(m);
    if (pos.inCheck(us)) { pos.unmake(); continue; }
    legal++;
    let s;
    if (legal === 1) s = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    else {
      s = -negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1);
      if (s > alpha && s < beta && !stopped) s = -negamax(pos, depth - 1, -beta, -alpha, ply + 1);
    }
    pos.unmake();
    if (stopped) return 0;
    if (s > best) {
      best = s; bestMove = m;
      if (s > alpha) {
        alpha = s;
        const row = pvTable[ply], child = pvTable[ply + 1];
        row[ply] = m;
        for (let j = ply + 1; j < pvLen[ply + 1]; j++) row[j] = child[j];
        pvLen[ply] = Math.max(ply + 1, pvLen[ply + 1]);
        if (alpha >= beta) {
          if (!(mFlags(m) & F_CAP)) {
            if (killers[ply][0] !== m) { killers[ply][1] = killers[ply][0]; killers[ply][0] = m; }
            history[pos.board[mFrom(m)] * 128 + mTo(m)] += depth * depth;
          }
          break;
        }
      }
    }
  }
  if (!legal) return inCheck ? -MATE + ply : 0;

  ttKey[idx] = pos.hash; ttMove[idx] = bestMove; ttScore[idx] = toTT(best, ply);
  ttDepth[idx] = depth; ttFlag[idx] = best <= alpha0 ? 3 : best >= beta ? 2 : 1;
  return best;
}

function analyze(pos, movetime) {
  const legal = pos.legalMoves();
  if (!legal.length) return { score: pos.inCheck(pos.turn) ? -MATE : 0, best: 0, pv: [], depth: 0, legalCount: 0 };
  deadline = Date.now() + movetime;
  stopped = false; canStop = false; nodes = 0;
  history.fill(0);
  for (const k of killers) { k[0] = 0; k[1] = 0; }
  let res = { score: 0, best: legal[0], pv: [legal[0]], depth: 0 };
  for (let d = 1; d <= 40; d++) {
    const s = negamax(pos, d, -INF, INF, 0);
    if (stopped) break;
    res = { score: s, best: pvTable[0][0], pv: Array.from(pvTable[0].slice(0, pvLen[0])), depth: d };
    canStop = true;
    if (isMate(s) && d > MATE - Math.abs(s)) break;
    if (legal.length === 1 && d >= 4) break;
    if (Date.now() > deadline) break;
  }
  res.legalCount = legal.length;
  return res;
}

// Convert a PV to UCI + SAN, extending it through the TT, verifying legality.
function describeLine(pos, pv) {
  const out = [];
  let made = 0;
  const line = pv.slice();
  for (let i = 0; i < 16; i++) {
    let m = line[i];
    if (m === undefined) {
      const idx = pos.hash & TT_MASK;
      if (!(ttFlag[idx] && ttKey[idx] === pos.hash) || i >= 10) break;
      m = ttMove[idx];
    }
    const L = pos.legalMoves();
    if (!L.includes(m)) break;
    out.push({ uci: uci(m), san: pos.san(m, L) });
    pos.make(m); made++;
    if (pos.isRepetition()) break;
  }
  while (made--) pos.unmake();
  return out;
}

self.onmessage = e => {
  const { type, moves, movetime, startFen, result } = e.data;
  if (type !== 'review') return;
  ttFlag.fill(0);
  const pos = new Position(startFen);
  for (let i = 0; i <= moves.length; i++) {
    let r;
    if (i === moves.length && result === '1/2-1/2' && pos.legalMoves().length) {
      r = { score: 0, best: 0, pv: [], depth: 0, legalCount: pos.legalMoves().length };
    } else {
      r = analyze(pos, movetime);
    }
    const line = r.best ? describeLine(pos, r.pv.length ? r.pv : [r.best]) : [];
    self.postMessage({
      type: 'progress', i, total: moves.length + 1,
      data: { score: r.score, best: line[0] ? line[0].uci : null, bestSan: line[0] ? line[0].san : null, line, depth: r.depth, legalCount: r.legalCount }
    });
    if (i < moves.length) {
      const m = pos.legalMoves().find(x => uci(x) === moves[i]);
      if (m === undefined) break;
      pos.make(m);
    }
  }
  self.postMessage({ type: 'done' });
};
