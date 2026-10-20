// What the labyrinth's headless tools share (the explorer, the stability runs): a hand's gestures as it might make them, in
// a world's own cells, and each read through the production gesture.ts as the page reads it.
import './labyrinth-node.mjs';
const G = await import('../client/labyrinth/gesture.ts');

/** a seeded random source */
export const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** what's there at a column: its ground, and the top of what stands on it */
export const column = (w, i, j) => { const g = w.ground(i, j); let k = g; while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++; return { g, top: k, built: k > g }; };
/** where a touch lands on a column: its top, or the ground */
export const pickAt = (w, i, j) => { const c = column(w, i, j); return c.built ? { face: 'top', hit: [c.top - 1, i, j], to: [c.top, i, j] } : { face: 'ground', hit: [c.g - 1, i, j], to: [c.g, i, j] }; };
export const spline = (P, n) => {
  const out = [];
  for (let s = 0; s < P.length - 1; s++) {
    const p0 = P[Math.max(0, s - 1)], p1 = P[s], p2 = P[s + 1], p3 = P[Math.min(P.length - 1, s + 2)];
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3))); }
  }
  out.push(P[P.length - 1]);
  return out;
};
/** everything that stands, by cell, for telling what a gesture added and took away */
export const state = (w) => {
  const s = new Map();
  for (const [v] of w.mass) s.set(`m${v}`, 1);
  for (const [v, st] of w.stairs) s.set(`s${v}`, st.d);
  for (const v of w.paving) s.set(`p${v}`, 1);
  for (const [v] of w.piers) s.set(`r${v}`, 1);
  return s;
};
/** a gesture, as a hand might make it, in the world's own cells */
export function gesture(w, R, intent) {
  const e = w.extent(), box = w.land ? { i0: Math.max(e.i0, -1), i1: Math.min(e.i1, 12), j0: Math.max(e.j0, -1), j1: Math.min(e.j1, 12) } : e;
  const cells = [];
  for (let i = box.i0; i <= box.i1; i++) for (let j = box.j0; j <= box.j1; j++) cells.push({ i, j, ...column(w, i, j) });
  const built = cells.filter((c) => c.built), pickC = (from = cells) => from[Math.floor(R() * from.length)];
  const near = (c, d0, d1) => cells.filter((q) => { const d = Math.hypot(q.i - c.i, q.j - c.j); return d >= d0 && d <= d1; });
  const kinds = [['tap', 2], ['sweep', 3], ['meander', 1.5], ['loop', 1.5], ['pause', 1], ...(built.length ? [['tapTop', 1.5], ['fromTop', 2.5], ...(intent === 'mass' ? [['lift', 0.8]] : [])] : [])];
  let r = R() * kinds.reduce((a, k) => a + k[1], 0), kind = kinds[0][0];
  for (const [k, wgt] of kinds) { if ((r -= wgt) <= 0) { kind = k; break; } }
  if (kind === 'tap' || kind === 'tapTop' || kind === 'lift') { const c = pickC(kind === 'tap' ? cells : built); return { kind, intent, at: [c.i, c.j], ...(kind === 'lift' ? { by: R() < 0.7 ? 1 + Math.floor(R() * 3) : -1 - Math.floor(R() * 2) } : {}) }; }
  let pts;
  if (kind === 'loop') {
    const c = pickC(), rad = 1.6 + R() * 1.6, a0 = R() * 6.28, close = R() < 0.6 ? 0.95 + R() * 0.12 : 0.8, ring = [];
    for (let q = 0; q <= 7; q++) { const a = a0 + (q / 7) * 6.28 * close, rr = rad * (0.8 + R() * 0.4); ring.push([c.i + Math.cos(a) * rr, c.j + Math.sin(a) * rr]); }
    pts = spline(ring, 8);
  } else {
    const a = kind === 'fromTop' ? pickC(built) : pickC(), far = near(a, kind === 'meander' ? 4 : 2.5, kind === 'meander' ? 9 : 7), b = far.length ? pickC(far) : pickC();
    const L = Math.hypot(b.i - a.i, b.j - a.j), nx = -(b.j - a.j) / (L || 1), ny = (b.i - a.i) / (L || 1), mids = kind === 'meander' ? 3 : 1 + (R() < 0.5 ? 1 : 0), ctl = [[a.i, a.j]];
    for (let q = 1; q <= mids; q++) { const t = q / (mids + 1), off = (R() - 0.5) * L * (kind === 'meander' ? 0.5 : 0.22); ctl.push([a.i + (b.i - a.i) * t + nx * off, a.j + (b.j - a.j) * t + ny * off]); }
    ctl.push([b.i, b.j]);
    pts = spline(ctl, 10);
  }
  const path = [];
  for (const [x, z] of pts) { const c = [Math.round(x), Math.round(z)]; if (!path.length || path.at(-1)[0] !== c[0] || path.at(-1)[1] !== c[1]) path.push(c); }
  const rests = kind === 'pause' && path.length > 3 ? [path[Math.floor(path.length * (0.35 + R() * 0.3))]] : [];
  return { kind, intent, path, rests };
}

/** the gesture read as the page reads it */
export function read(w, g) {
  if (g.kind === 'tap' || g.kind === 'tapTop') return G.tap(w, pickAt(w, ...g.at), 0, false, g.intent);
  if (g.kind === 'lift') return G.lift(w, pickAt(w, ...g.at), g.by, 0);
  const start = pickAt(w, ...g.path[0]), last = g.path.at(-1), endCol = column(w, ...last);
  // (the page holds a destination only when the stroke rests on a top: an end over the ground is no destination)
  const end = g.path.length > 1 && endCol.built && (last[0] !== g.path[0][0] || last[1] !== g.path[0][1]) ? pickAt(w, ...last) : null;
  return G.trace(w, start, g.path, end, () => 0, 0, g.rests, g.intent);
}

