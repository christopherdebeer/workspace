// Bamboo's flow audit (node cells/lab/devtools/bamboo-flow.mjs [seeds]): what the rock offers a runner, measured, not
// looked at. Round crests of the escarpment on each seed, the footing is laid out on a 0.2 m grid and read as tops: each
// connected level surface standing clear of the ground. A top is runnable if a stance fits on it (a disc 0.8 m across,
// level to a hand); one with none is a sliver. Two runnable tops are linked if a bound reaches between their cores (1.2
// to 3.8 m, up 1.1 m or down 1.6 m); a line is three tops linked on, keeping about one way (turning under 40°). Checks
// that little of the tops' area is slivers and there are lines to run.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const seeds = (process.argv[2] ?? '1,2,3').split(',').map(Number);
const S = 0.2, W = 24, N = Math.round(W / S), DISC = 2, STEP = 0.25; // (cells of 0.2 m: a disc of radius 0.4 m; a step a runner runs over, not an edge)

function audit(world, me, cx, cz) {
  const F = me.feet, x0 = cx - W / 2, z0 = cz - W / 2, y = new Float32Array(N * N), on = new Uint8Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = x0 + i * S, z = z0 + j * S, u = F.at(x, z), k = i * N + j;
    y[k] = u.y; on[k] = u.kind === 'stone' && u.y - F.groundAt(x, z) > 0.4 ? 1 : 0;
  }
  // (tops: connected stone cells, neighbours within a hand's height)
  const id = new Int32Array(N * N).fill(-1), tops = [];
  for (let k0 = 0; k0 < N * N; k0++) {
    if (!on[k0] || id[k0] >= 0) continue;
    const t = { cells: [], core: [] }, st = [k0]; id[k0] = tops.length;
    while (st.length) {
      const k = st.pop(), i = (k / N) | 0, j = k % N; t.cells.push(k);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b, kk = ii * N + jj;
        if (ii < 0 || jj < 0 || ii >= N || jj >= N || !on[kk] || id[kk] >= 0 || Math.abs(y[kk] - y[k]) > STEP) continue;
        id[kk] = tops.length; st.push(kk);
      }
    }
    tops.push(t);
  }
  // (each top's stances: cells round which a disc of the same top fits, level to a hand)
  for (const t of tops) for (const k of t.cells) {
    const i = (k / N) | 0, j = k % N; let ok = true;
    for (let a = -DISC; a <= DISC && ok; a++) for (let b = -DISC; b <= DISC && ok; b++) {
      if (a * a + b * b > DISC * DISC) continue;
      const ii = i + a, jj = j + b, kk = ii * N + jj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N || id[kk] !== id[k] || Math.abs(y[kk] - y[k]) > STEP) ok = false;
    }
    if (ok) t.core.push(k);
  }
  const big = tops.filter((t) => t.cells.length * S * S >= 0.15);
  const run = big.filter((t) => t.core.length > 0), slivers = big.length - run.length;
  // (links between runnable tops: their nearest stances within a bound)
  const pos = (k) => [x0 + ((k / N) | 0) * S, z0 + (k % N) * S, y[k]];
  const cores = run.map((t) => { const step = Math.max(1, Math.floor(t.core.length / 24)); return t.core.filter((_, n) => n % step === 0).map(pos); });
  const links = run.map(() => []);
  for (let a = 0; a < run.length; a++) for (let b = 0; b < run.length; b++) {
    if (a === b) continue;
    let best = null;
    for (const p of cores[a]) for (const q of cores[b]) {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]), dy = q[2] - p[2];
      if (d < 1.2 || d > 3.8 || dy > 1.1 || dy < -1.6) continue;
      if (!best || d < best.d) best = { d, dir: Math.atan2(q[0] - p[0], q[1] - p[1]) };
    }
    if (best) links[a].push({ to: b, dir: best.dir });
  }
  let pairs = 0, lines = 0;
  for (let a = 0; a < run.length; a++) {
    pairs += links[a].length;
    for (const l1 of links[a]) for (const l2 of links[l1.to]) {
      if (l2.to === a) continue;
      let d = l2.dir - l1.dir; d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 0.7) { lines++; break; }
    }
  }
  const area = run.reduce((s, t) => s + t.cells.length, 0) * S * S, thin = big.filter((t) => !t.core.length).reduce((s, t) => s + t.cells.length, 0) * S * S;
  return { tops: big.length, run: run.length, slivers, pairs: pairs / 2, lines, area, thin };
}

let fails = 0;
const tot = { tops: 0, run: 0, slivers: 0, pairs: 0, lines: 0, area: 0, thin: 0, windows: 0 };
for (const seed of seeds) {
  const world = new B.World(seed), me = new B.Runner(world);
  // (crests to look round: the escarpment's, near the start, spread apart)
  const crests = [];
  for (let ci = -6; ci <= 6 && crests.length < 10; ci++) for (let cj = -6; cj <= 6 && crests.length < 10; cj++) {
    for (const b of world.rocks(ci, cj)) if (b.role === 'crest' && crests.every((c) => Math.hypot(c[0] - b.c[0], c[1] - b.c[2]) > 40)) { crests.push([b.c[0], b.c[2]]); break; }
  }
  const s = { tops: 0, run: 0, slivers: 0, pairs: 0, lines: 0, area: 0, thin: 0 };
  for (const [cx, cz] of crests) { me.stream(cx, cz, 60); const r = audit(world, me, cx, cz); for (const k in s) s[k] += r[k]; }
  console.log(`seed ${seed}: ${crests.length} windows · tops ${s.tops} · runnable ${s.run} (${((100 * s.run) / Math.max(1, s.tops)).toFixed(0)}%) · slivers ${s.slivers} (${s.thin.toFixed(0)} m²) · runnable area ${s.area.toFixed(0)} m² · links ${s.pairs} · lines ${s.lines}`);
  for (const k in s) tot[k] += s[k]; tot.windows += crests.length;
}
// (judged by area: a top's worn edge or a cut's strip beside it counts for little; what matters is how much of the rock you
// can stand on is only slivers)
const thinPct = tot.thin / Math.max(1e-6, tot.thin + tot.area), linesPer = tot.lines / Math.max(1, tot.windows);
console.log(`all: of the tops' area ${(100 * (1 - thinPct)).toFixed(0)}% runnable, ${(100 * thinPct).toFixed(0)}% slivers (${tot.slivers} of them) · lines per window ${linesPer.toFixed(1)}`);
// (today about 14% of it: carve's shelves, shoulders and joints now leave steps a stance deep or none; what's left is
// mostly strips along the lip between a column's tiers (each tier's front set on its own) and along tops' edges (worn
// bevels, cut fronts). Held there, to be brought down)
const ok = [thinPct < 0.16, linesPer >= 4];
console.log(ok.every(Boolean) ? 'ok' : `FAIL ${JSON.stringify(ok)}`);
process.exit(ok.every(Boolean) ? 0 : 1);
