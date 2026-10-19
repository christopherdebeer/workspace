// The labyrinth explored without a renderer (node cells/lab/devtools/labyrinth-explore.mjs --out=DIR): many worlds
// (lands, the bare stone, the stories), on each a run of random gestures made one after another on what the last
// left, every one read through the production gesture.ts and model.ts as the page reads it (a stroke's end counts
// only if it rests on a top; a pause where the finger paused). Each outcome is checked for what a hand wouldn't want:
// nothing at all, or nothing said; something already there destroyed; a roof lost; a way that stops short, or is
// stone in the air on the land; far more stone than the stroke asked for; nothing near where the stroke ended; a stair
// where the finger paused; a ring drawn round and not read as one. What's flagged is written case by case, its before
// and after apart (plans, and the world to replay in the browser), for reading blind: the before first, what the hand
// must have meant written down, then the after. Only cases where seeing it drawn could matter go to WebGL.
//   --worlds=N   --runs=N (runs a world)   --n=N (gestures a run)   --seed=N   --sample=N (cases written per flag)
import './labyrinth-node.mjs';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { World, key, unkey } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const { story } = await import('../client/labyrinth/demo.ts');
const { buildings } = await import('../client/labyrinth/buildings.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const OUT = opt.out ?? 'explore-out', RUNS = Number(opt.runs) || 3, N = Number(opt.n) || 8, SAMPLE = Number(opt.sample) || 6;
if (existsSync(OUT) && readdirSync(OUT).length) throw new Error('Use a fresh --out directory');
mkdirSync(OUT, { recursive: true });
const rng = (s) => () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// (the worlds: lands of many seeds, the bare stone, and the stories, already built on)
const WORLDS = [
  ...Array.from({ length: Number(opt.worlds) || 16 }, (_, n) => ({ name: `land${n + 1}`, make: () => new World(1, n + 1), intent: n % 4 === 3 ? 'mass' : 'way' })),
  { name: 'stone', make: () => new World(1), intent: 'mass' },
  ...[4, 8, 12, 15].map((s) => ({ name: `story${s}`, make: () => story(s), intent: s >= 12 ? 'way' : 'mass' })),
];

/** what's there at a column: its ground, and the top of what stands on it */
const column = (w, i, j) => { const g = w.ground(i, j); let k = g; while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++; return { g, top: k, built: k > g }; };
/** where a touch lands on a column: its top, or the ground */
const pickAt = (w, i, j) => { const c = column(w, i, j); return c.built ? { face: 'top', hit: [c.top - 1, i, j], to: [c.top, i, j] } : { face: 'ground', hit: [c.g - 1, i, j], to: [c.g, i, j] }; };
const spline = (P, n) => {
  const out = [];
  for (let s = 0; s < P.length - 1; s++) {
    const p0 = P[Math.max(0, s - 1)], p1 = P[s], p2 = P[s + 1], p3 = P[Math.min(P.length - 1, s + 2)];
    for (let k = 0; k < n; k++) { const t = k / n, t2 = t * t, t3 = t2 * t; out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3))); }
  }
  out.push(P[P.length - 1]);
  return out;
};
/** everything that stands, by cell, for telling what a gesture added and took away */
const state = (w) => {
  const s = new Map();
  for (const [v] of w.mass) s.set(`m${v}`, 1);
  for (const [v, st] of w.stairs) s.set(`s${v}`, st.d);
  for (const v of w.paving) s.set(`p${v}`, 1);
  for (const [v] of w.piers) s.set(`r${v}`, 1);
  return s;
};
/** roofed buildings that, after, stand unroofed (the same columns, the building still there, its roof gone: walked on, or
 * read as something else). One grown taller and roofed again isn't one */
const unroofed = (w0, w1) => {
  const after = buildings(w1);
  return buildings(w0).list.filter((b) => b.roof).some((b) => { const [i, j] = b.cols[0], n = after.list.find((c) => c.cols.some((q) => q[0] === i && q[1] === j)); return n && !n.roof && n.h >= b.h; });
};

/** a gesture, as a hand might make it, in the world's own cells */
function gesture(w, R, intent) {
  const e = w.extent(), box = w.land ? { i0: Math.max(e.i0, -1), i1: Math.min(e.i1, 12), j0: Math.max(e.j0, -1), j1: Math.min(e.j1, 12) } : e;
  const cells = [];
  for (let i = box.i0; i <= box.i1; i++) for (let j = box.j0; j <= box.j1; j++) cells.push({ i, j, ...column(w, i, j) });
  const built = cells.filter((c) => c.built), pickC = (from = cells) => from[Math.floor(R() * from.length)];
  const near = (c, d0, d1) => cells.filter((q) => { const d = Math.hypot(q.i - c.i, q.j - c.j); return d >= d0 && d <= d1; });
  const kinds = [['tap', 2], ['sweep', 3], ['meander', 1.5], ['loop', 1.5], ['pause', 1], ...(built.length ? [['tapTop', 1.5], ['fromTop', 2.5], ['lift', 0.8]] : [])];
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
function read(w, g) {
  if (g.kind === 'tap' || g.kind === 'tapTop') return G.tap(w, pickAt(w, ...g.at), 0, false, g.intent);
  if (g.kind === 'lift') return G.lift(w, pickAt(w, ...g.at), g.by, 0);
  const start = pickAt(w, ...g.path[0]), last = g.path.at(-1), endCol = column(w, ...last);
  // (the page holds a destination only when the stroke rests on a top: an end over the ground is no destination)
  const end = g.path.length > 1 && endCol.built && (last[0] !== g.path[0][0] || last[1] !== g.path[0][1]) ? pickAt(w, ...last) : null;
  return G.trace(w, start, g.path, end, () => 0, 0, g.rests, g.intent);
}

/** what a hand wouldn't want, in what came of it */
function judge(w0, w1, g, op) {
  const flags = [];
  if (!op) { flags.push('silent'); return flags; }
  if ('refused' in op) { flags.push('refused'); return flags; }
  const a = state(w0), b = state(w1), added = [...b.keys()].filter((k) => !a.has(k)), removed = [...a.keys()].filter((k) => !b.has(k));
  if (!added.length && !removed.length) flags.push('no-change');
  const meant = g.kind === 'lift' && g.by < 0;
  if (removed.length && !meant) flags.push('destroyed');
  if (!meant && unroofed(w0, w1)) flags.push('unroofed');
  const r = w1.reached.get(w1.ops.at(-1));
  if (op.connect && r) { if (!r.reached && !r.cells.length && !added.some((k) => k[0] === 'p')) flags.push('empty-way'); else if (!r.reached && r.stopped >= 0 && r.stopped < (op.connect.path.length - 1) * 0.5) flags.push('stopped-short'); }
  if (op.connect?.follow && w1.land && r?.cells.length >= 3) { const up = r.cells.filter(([k, i, j]) => k > w1.ground(i, j) && w1.stone(k, i, j)).length; if (up / r.cells.length > 0.5) flags.push('raised-way'); }
  if (g.path) {
    const stone = added.filter((k) => k[0] === 'm' || k[0] === 's').length;
    if (stone > Math.max(6, g.path.length * 3)) flags.push('heavy');
    const cells = added.map((k) => unkey(Number(k.slice(1)))).map(([, i, j]) => [i, j]), [ei, ej] = g.path.at(-1);
    if (cells.length && Math.min(...cells.map(([i, j]) => Math.abs(i - ei) + Math.abs(j - ej))) > 2 && g.kind !== 'loop') flags.push('not-there');
    for (const [i, j] of g.rests ?? []) for (let k = 0; k < 12; k++) if (w1.stair(k, i, j) >= 0 && w0.stair(k, i, j) < 0) flags.push('stair-at-pause');
    const [si, sj] = g.path[0];
    if (g.kind === 'loop' && g.path.length >= 10 && Math.max(Math.abs(ei - si), Math.abs(ej - sj)) <= 2 && !/court|round|terrace|walk/.test(op.note ?? op.reading ?? '')) flags.push('ring-missed');
  }
  return [...new Set(flags)];
}

// ─── the runs ───
const R0 = Number(opt.seed) || 1, tally = {}, byKind = {}, flagged = [];
let n = 0, t0 = Date.now();
for (const W of WORLDS) for (let run = 0; run < RUNS; run++) {
  const R = rng(R0 * 7919 + run * 104729 + W.name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  let w = W.make();
  for (let s = 0; s < N; s++) {
    const intent = R() < 0.75 ? W.intent : W.intent === 'way' ? 'mass' : 'way';
    const g = gesture(w, R, intent), before = w.encode(), w0 = w;
    let op, flags, err = null;
    try {
      op = read(w, g);
      const w1 = new World(w.seed, w.landSeed); w1.ops = [...w.ops]; w1.rebuild(0);
      if (op && !('refused' in op)) w1.apply({ ...op, alts: undefined }, 0);
      flags = judge(w0, w1, g, op);
      w = w1;
    } catch (e) { err = String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '); flags = ['crash']; }
    n++;
    const kindKey = `${g.intent}:${g.kind}`;
    byKind[kindKey] = byKind[kindKey] ?? { n: 0, flagged: 0 };
    byKind[kindKey].n++;
    if (flags.length) byKind[kindKey].flagged++;
    for (const f of flags) tally[f] = (tally[f] ?? 0) + 1;
    if (flags.length) flagged.push({ id: `${W.name}-r${run}-g${s}`, world: W.name, step: s, gesture: g, flags, why: op && !('refused' in op) ? op.why : null, said: op ? ('refused' in op ? op.refused : op.note ?? op.reading ?? '') : '', err, before, after: w.encode() });
  }
}
const secs = (Date.now() - t0) / 1000;
const summary = { gestures: n, seconds: secs, perGestureMs: Math.round((secs * 1000) / n), flaggedGestures: flagged.length, tally, byKind };
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
// (a sample of each flag, written apart: what's to be read blind, and what's revealed after)
const picked = new Set();
for (const f of Object.keys(tally)) for (const c of flagged.filter((c) => c.flags.includes(f)).slice(0, SAMPLE)) picked.add(c);
for (const c of picked) {
  const dir = join(OUT, 'cases', c.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'before.json'), `${JSON.stringify({ id: c.id, world: c.before, gesture: c.gesture }, null, 1)}\n`);
  writeFileSync(join(dir, 'sealed.json'), `${JSON.stringify(c, null, 1)}\n`);
}
writeFileSync(join(OUT, 'flagged.json'), `${JSON.stringify(flagged.map(({ before, after, ...c }) => c), null, 1)}\n`);
console.log(`${n} gestures in ${secs.toFixed(1)}s (${summary.perGestureMs}ms each) · ${flagged.length} flagged · ${JSON.stringify(tally)} · ${picked.size} cases written to ${OUT}/cases`);
