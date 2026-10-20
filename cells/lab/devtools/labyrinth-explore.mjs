// The labyrinth explored without a renderer (node cells/lab/devtools/labyrinth-explore.mjs --out=DIR): many worlds
// (lands, the bare stone, the stories), on each a run of random gestures made one after another on what the last
// left, every one read through the production gesture.ts and model.ts as the page reads it (a stroke's end counts
// only if it rests on a top; a pause where the finger paused). Each outcome is checked for what a hand wouldn't want:
// nothing at all, or nothing said; something already there destroyed; a roof lost; a way that stops short, or is
// stone in the air on the land; far more stone than the stroke asked for; nothing near where the stroke ended; a stair
// where the finger paused; a ring drawn round and not read as one. What's flagged is written case by case, its before
// and after apart (plans, and the world to replay in the browser), for reading blind: the before first, what the hand
// must have meant written down, then the after. Only cases where seeing it drawn could matter go to WebGL.
//   --worlds=N   --runs=N (runs a world)   --n=N (gestures a run)   --seed=N   --sample=N (cases written per flag)   --cases=id,id (written too)
import './labyrinth-node.mjs';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const { World, key, unkey } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const { story } = await import('../client/labyrinth/demo.ts');
const { buildings } = await import('../client/labyrinth/buildings.ts');
const { rng, column, state, gesture, read } = await import('./labyrinth-gestures.mjs');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const OUT = opt.out ?? 'explore-out', RUNS = Number(opt.runs) || 3, N = Number(opt.n) || 8, SAMPLE = Number(opt.sample) || 6;
if (existsSync(OUT) && readdirSync(OUT).length) throw new Error('Use a fresh --out directory');
mkdirSync(OUT, { recursive: true });


// (the worlds: lands of many seeds, the bare stone, and the stories, already built on)
const WORLDS = [
  ...Array.from({ length: Number(opt.worlds) || 16 }, (_, n) => ({ name: `land${n + 1}`, make: () => new World(1, n + 1), intent: n % 4 === 3 ? 'mass' : 'way' })),
  { name: 'stone', make: () => new World(1), intent: 'mass' },
  ...[4, 8, 12, 15].map((s) => ({ name: `story${s}`, make: () => story(s), intent: s >= 12 ? 'way' : 'mass' })),
];

/** roofed buildings that, after, stand unroofed (the same columns, the building still there, its roof gone: walked on, or
 * read as something else). One grown taller and roofed again isn't one */
const unroofed = (w0, w1) => {
  const after = buildings(w1);
  return buildings(w0).list.filter((b) => b.roof).some((b) => { const [i, j] = b.cols[0], n = after.list.find((c) => c.cols.some((q) => q[0] === i && q[1] === j)); return n && !n.roof && n.h >= b.h; });
};

/** what a hand wouldn't want, in what came of it */
function judge(w0, w1, g, op) {
  const flags = [];
  if (!op) { flags.push('silent'); return flags; }
  if ('refused' in op) { flags.push('refused'); return flags; }
  const a = state(w0), b = state(w1), added = [...b.keys()].filter((k) => !a.has(k));
  // (gone, and nothing in its place: a pier become solid stone, a stair become a landing, is a change, not a loss; and
  // a pier is the rules' to place, where something's to be carried: one no longer needed isn't lost)
  const held = new Set([...b.keys()].map((k) => k.slice(1))), removed = [...a.keys()].filter((k) => !b.has(k) && !held.has(k.slice(1)) && k[0] !== 'r');
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
// (what was built against what was drawn: how often, and how, the reading took liberties with the gesture (`Op.took`))
const took = {}, authorship = { built: 0, literal: 0, liberty: 0, otherKind: 0, refused: 0, offered: 0 };
const OTHER_KIND = ['tower-instead', 'walkway-instead', 'wall-instead', 'court-instead', 'chosen-instead', 'jetty'];
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
      if (op && 'refused' in op) { authorship.refused++; if (op.alts?.length) authorship.offered++; }
      else if (op) {
        authorship.built++;
        const t = op.took ?? [];
        if (!t.length) authorship.literal++; else authorship.liberty++;
        if (t.some((x) => OTHER_KIND.includes(x))) authorship.otherKind++;
        for (const x of t) took[x] = (took[x] ?? 0) + 1;
      }
      w = w1;
    } catch (e) { err = String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '); flags = ['crash']; }
    n++;
    const kindKey = `${g.intent}:${g.kind}`;
    byKind[kindKey] = byKind[kindKey] ?? { n: 0, flagged: 0 };
    byKind[kindKey].n++;
    if (flags.length) byKind[kindKey].flagged++;
    for (const f of flags) tally[f] = (tally[f] ?? 0) + 1;
    if (flags.length) flagged.push({ id: `${W.name}-r${run}-g${s}`, world: W.name, step: s, gesture: g, flags, why: op && !('refused' in op) ? op.why : null, took: op && !('refused' in op) ? op.took : undefined, said: op ? ('refused' in op ? op.refused : op.note ?? op.reading ?? '') : '', err, before, after: w.encode() });
  }
}
const secs = (Date.now() - t0) / 1000;
const summary = { gestures: n, seconds: secs, perGestureMs: Math.round((secs * 1000) / n), flaggedGestures: flagged.length, tally, authorship, took, byKind };
writeFileSync(join(OUT, 'summary.json'), `${JSON.stringify(summary, null, 1)}\n`);
// (a sample of each flag, written apart: what's to be read blind, and what's revealed after)
const picked = new Set();
for (const f of Object.keys(tally)) for (const c of flagged.filter((c) => c.flags.includes(f)).slice(0, SAMPLE)) picked.add(c);
// (and any asked for by name: --cases=land2-r0-g1,story8-r0-g4)
for (const c of flagged) if ((opt.cases ?? '').split(',').includes(c.id)) picked.add(c);
for (const c of picked) {
  const dir = join(OUT, 'cases', c.id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'before.json'), `${JSON.stringify({ id: c.id, world: c.before, gesture: c.gesture }, null, 1)}\n`);
  writeFileSync(join(dir, 'sealed.json'), `${JSON.stringify(c, null, 1)}\n`);
}
writeFileSync(join(OUT, 'flagged.json'), `${JSON.stringify(flagged.map(({ before, after, ...c }) => c), null, 1)}\n`);
console.log(`${n} gestures in ${secs.toFixed(1)}s (${summary.perGestureMs}ms each) · ${flagged.length} flagged · ${JSON.stringify(tally)} · ${picked.size} cases written to ${OUT}/cases`);
console.log(`authorship: ${authorship.built} built, ${authorship.literal} as drawn, ${authorship.liberty} with liberties (${authorship.otherKind} another kind of thing); ${authorship.refused} refused (${authorship.offered} offering another reading) · ${JSON.stringify(took)}`);
