// How steady a reading is (node cells/lab/devtools/labyrinth-stability.mjs --out=DIR): on worlds already built on
// purpose (the stories), and the bare land and stone to compare, many gestures made each on its own, and each made again
// a little differently, one thing changed at a time: its end a cell over, a cell of its course nudged aside, a pause
// added or taken away, begun a cell along, drawn a cell longer or shorter; a tap a cell over. Each is read through the
// production gesture.ts as the page reads it, and what kind of thing it comes to (a wall, a way, a bridge, a flight,
// a tower, refused...) is compared with what the gesture itself came to. A small change of hand that makes another kind
// of thing is a flip. A flip where the change also changed what was touched (its end now on a top, not the ground; a
// top of another height) is the world answering differently, and may be right; a flip where it didn't is the reading
// being unsteady. Each flip is written as a pair, the gesture and its variant, for reading blind.
//   --seed=N   --n=N (gestures a world)   --sample=N (pairs written per kind of flip)
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { rng, column, gesture, read } from './labyrinth-gestures.mjs';
const { World } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const { story } = await import('../client/labyrinth/demo.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const OUT = opt.out ?? 'stability-out', N = Number(opt.n) || 30, SAMPLE = Number(opt.sample) || 3, R0 = Number(opt.seed) || 1;
if (existsSync(OUT) && readdirSync(OUT).length) throw new Error('Use a fresh --out directory');
mkdirSync(OUT, { recursive: true });

// (built on purpose: the stories, each a place made gesture by gesture; and the bare land and stone, to compare)
const BASES = [
  ...Array.from({ length: 15 }, (_, n) => ({ name: `story${n + 1}`, make: () => story(n + 1), built: true })),
  ...[1, 2, 3, 4].map((s) => ({ name: `land${s}`, make: () => new World(1, s), built: false })),
  { name: 'stone', make: () => new World(1), built: false },
];

/** what kind of thing an outcome is: refused, nothing, or what it builds (a connection that stops short, so marked) */
function kind(w, op) {
  if (!op) return 'nothing';
  if ('refused' in op) return 'refused';
  let k = op.why ?? '?';
  if (op.connect) { const sim = new World(w.seed, w.landSeed); sim.ops = [...w.ops, op]; sim.rebuild(); if (!sim.reached.get(op)?.reached && op.connect.to) k += ':short'; }
  return k;
}
/** what a gesture touched: where it began and where it ended, as the page tells them (top or ground, and how high) */
const touched = (w, g) => {
  const at = (c) => { const q = column(w, ...c); return `${q.built ? 'top' : 'ground'}${q.built ? q.top : q.g}`; };
  return g.path ? `${at(g.path[0])}>${at(g.path.at(-1))}` : at(g.at);
};

/** the gesture again, one thing changed (each variant named for what changed) */
function variants(w, g) {
  const out = [], inside = (c) => w.onSlab?.(...c) ?? true, D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (!g.path) { for (const [a, b] of D) { const at = [g.at[0] + a, g.at[1] + b]; if (inside(at)) out.push({ change: 'tap a cell over', g: { ...g, at } }); } return out; }
  const P = g.path, join = (...pts) => G.connect(pts), last = P.at(-1), prev = P.at(-2) ?? P[0];
  // (its end a cell over: each way it could be)
  for (const [a, b] of D) {
    const e = [last[0] + a, last[1] + b];
    if (!inside(e) || P.some((c) => c[0] === e[0] && c[1] === e[1])) continue;
    out.push({ change: 'end a cell over', g: { ...g, path: [...P.slice(0, -1), ...join(prev, e).slice(1)] } });
  }
  // (a cell of its course nudged aside)
  if (P.length >= 5) {
    const q = Math.floor(P.length / 2), [x, z] = P[q], [px, pz] = P[q - 1], [nx, nz] = P[q + 1], d = [nz - pz === 0 ? 1 : 0, nx - px === 0 ? 1 : 0];
    for (const s of [1, -1]) { const c = [x + d[0] * s, z + d[1] * s]; if (inside(c)) out.push({ change: 'nudged aside', g: { ...g, path: [...P.slice(0, q - 1), ...join(P[q - 1], c, P[q + 1]), ...P.slice(q + 2)], rests: [] } }); }
  }
  // (a pause, added or taken away)
  if (P.length > 3) out.push({ change: g.rests?.length ? 'pause taken away' : 'pause added', g: { ...g, rests: g.rests?.length ? [] : [P[Math.floor(P.length / 2)]] } });
  // (begun a cell along; drawn a cell longer, and shorter)
  if (P.length > 3) out.push({ change: 'begun a cell along', g: { ...g, path: P.slice(1) } });
  if (P.length > 3) out.push({ change: 'a cell shorter', g: { ...g, path: P.slice(0, -1) } });
  const e = [2 * last[0] - prev[0], 2 * last[1] - prev[1]];
  if (inside(e)) out.push({ change: 'a cell longer', g: { ...g, path: [...P, e] } });
  return out;
}

// ─── the runs ───
const t0 = Date.now(), flips = [], byChange = {}, byBase = {}, pairs = {};
let gestures = 0, tried = 0;
for (const B of BASES) {
  const w = B.make(), R = rng(R0 * 7919 + B.name.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const intent = w.land ? 'way' : 'mass';
  byBase[B.name] = { gestures: 0, variants: 0, steady: 0, flips: 0, unsteady: 0 };
  for (let n = 0; n < N; n++) {
    const g = gesture(w, R, R() < 0.75 ? intent : intent === 'way' ? 'mass' : 'way');
    let k0;
    try { k0 = kind(w, read(w, g)); } catch { continue; }
    gestures++; byBase[B.name].gestures++;
    const here = touched(w, g);
    for (const [q, v] of variants(w, g).entries()) {
      let k1;
      try { k1 = kind(w, read(w, v.g)); } catch { k1 = 'crash'; }
      tried++; byBase[B.name].variants++;
      const same = touched(w, v.g) === here, c = (byChange[v.change] ??= { variants: 0, flips: 0, unsteady: 0 });
      c.variants++;
      if (k1 === k0) { byBase[B.name].steady++; continue; }
      c.flips++; byBase[B.name].flips++;
      if (same) { c.unsteady++; byBase[B.name].unsteady++; }
      const pair = `${k0} → ${k1}`;
      pairs[pair] ??= { all: 0, unsteady: 0 };
      pairs[pair].all++; if (same) pairs[pair].unsteady++;
      flips.push({ id: `${B.name}-g${n}-${v.change.replace(/ /g, '-')}-${q}`, base: B.name, built: B.built, change: v.change, same, from: k0, to: k1, gesture: g, variant: v.g, world: w.encode() });
    }
  }
}
const secs = (Date.now() - t0) / 1000;
const rate = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const built = Object.entries(byBase).filter(([k]) => k.startsWith('story')).reduce((a, [, v]) => ({ variants: a.variants + v.variants, flips: a.flips + v.flips, unsteady: a.unsteady + v.unsteady }), { variants: 0, flips: 0, unsteady: 0 });
const bare = Object.entries(byBase).filter(([k]) => !k.startsWith('story')).reduce((a, [, v]) => ({ variants: a.variants + v.variants, flips: a.flips + v.flips, unsteady: a.unsteady + v.unsteady }), { variants: 0, flips: 0, unsteady: 0 });
const summary = {
  gestures, variants: tried, seconds: secs,
  flipRate: rate(flips.length, tried), unsteadyRate: rate(flips.filter((f) => f.same).length, tried),
  builtOn: { ...built, flipRate: rate(built.flips, built.variants), unsteadyRate: rate(built.unsteady, built.variants) },
  bare: { ...bare, flipRate: rate(bare.flips, bare.variants), unsteadyRate: rate(bare.unsteady, bare.variants) },
  byChange: Object.fromEntries(Object.entries(byChange).map(([k, v]) => [k, { ...v, unsteadyRate: rate(v.unsteady, v.variants) }])),
  pairs: Object.fromEntries(Object.entries(pairs).sort((a, b) => b[1].unsteady - a[1].unsteady)),
  byBase,
};
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
writeFileSync(join(OUT, 'flips.json'), `${JSON.stringify(flips.map(({ world, ...f }) => f), null, 1)}\n`);
// (the unsteady flips, a few of each kind, written as pairs: the world, the gesture and its variant, to read blind; what
// each came to sealed apart)
const picked = [];
for (const p of Object.keys(pairs)) picked.push(...flips.filter((f) => f.same && `${f.from} → ${f.to}` === p).slice(0, SAMPLE));
for (const f of picked) {
  const dir = join(OUT, 'pairs', f.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'before.json'), `${JSON.stringify({ id: f.id, world: f.world, gesture: f.gesture, variant: f.variant, change: f.change }, null, 1)}\n`);
  writeFileSync(join(dir, 'sealed.json'), `${JSON.stringify({ from: f.from, to: f.to }, null, 1)}\n`);
}
console.log(`${gestures} gestures, ${tried} variants in ${secs.toFixed(1)}s · a small change made another kind of thing ${summary.flipRate}% of the time; with what was touched the same, ${summary.unsteadyRate}%`);
console.log(`built on: ${summary.builtOn.unsteadyRate}% unsteady (${summary.builtOn.flipRate}% flips) · bare: ${summary.bare.unsteadyRate}% unsteady (${summary.bare.flipRate}% flips)`);
console.log(`by change: ${Object.entries(summary.byChange).map(([k, v]) => `${k} ${v.unsteadyRate}%`).join(' · ')}`);
console.log(`unsteadiest: ${Object.entries(summary.pairs).slice(0, 8).map(([k, v]) => `${k} ×${v.unsteady}`).join(' · ')}`);
console.log(`${picked.length} pairs written to ${OUT}/pairs`);
