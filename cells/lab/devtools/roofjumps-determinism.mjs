// The figure the same however often it's drawn: each scene run at the fixed 120 Hz, its bones read every tick in one run
// and every fourth (30 Hz) in another; at the moments both read them, every bone must be where it was. Drawing is reading.
//   node cells/lab/devtools/roofjumps-determinism.mjs [scene keys…]
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes'; export * from './city'; export * from './runner'; export * from './rig';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const DT = 1 / 120, keys = process.argv.slice(2).length ? process.argv.slice(2) : M.SCENES.map((s) => s.key);
let worstAll = 0;
for (const key of keys) {
  const sc = M.SCENES.find((s) => s.key === key), runs = {};
  for (const every of [1, 4]) {
    const city = new M.City(1, false, sc.course), r = new M.Runner(city), rig = new M.Rig(); rig.update(1, r); const mem = {}; runs[every] = [];
    for (let i = 0; i < sc.seconds / DT; i++) { r.step(DT, sc.input(i * DT, r, mem)); rig.update(DT, r); if (i % every === 0) { const b = rig.bones(r); if (i % 4 === 0) runs[every].push(b.map((o) => [o.m[12], o.m[13], o.m[14]])); } }
  }
  let d = 0, at = 0; runs[1].forEach((a, k) => a.forEach((p, j) => { const q = runs[4][k][j], e = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (e > d) { d = e; at = k * 4 * DT; } }));
  worstAll = Math.max(worstAll, d);
  if (d > 1e-6) console.log(`${key}: ${(d * 100).toFixed(2)} cm apart at ${at.toFixed(2)} s`);
}
console.log(`${keys.length} scenes: drawn at 30 Hz against 120 Hz, worst ${(worstAll * 100).toFixed(4)} cm`);
process.exitCode = worstAll > 1e-6 ? 1 : 0;
