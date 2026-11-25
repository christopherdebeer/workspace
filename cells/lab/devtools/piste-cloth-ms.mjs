// Piste's cloth, timed (node cells/lab/devtools/piste-cloth-ms.mjs): two stand-ins fence; each frame both fencers'
// garments are stepped and both are dressed, as the renderer does. Prints the mean and worst ms a frame.
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './ai'; export * from './look/figure'; export * from './look/mesh'; export * from './look/cloth';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const b = new M.Bout({ weapon: M.EPEE, to: 5 }), ai = [new M.Opponent(b, 0, M.SPARRING, 3), new M.Opponent(b, 1, M.SPARRING, 4)];
const w = b.fencers.map((f) => new M.Wardrobe(f)), m = new M.Mesh();
const ms = [], split = [];
for (let i = 0; i < 60 * 20; i++) {
  for (const k of [0, 1]) b.fencers[k].intent = { ...ai[k].intent(1 / 60) };
  b.advance(1 / 60); b.drain();
  const t0 = performance.now();
  m.reset();
  b.fencers.forEach((f, k) => w[k].update(f, b.t));
  const t1 = performance.now();
  b.fencers.forEach((f, k) => M.dressFencer(m, f, k === 0, k, w[k]));
  if (i > 60) { ms.push(performance.now() - t0); split.push([t1 - t0, performance.now() - t1]); }
}
ms.sort((a, c) => a - c);
const particles = w[0].garments.reduce((s, g) => s + g.n, 0);
const avg = (k) => (split.reduce((s2, x) => s2 + x[k], 0) / split.length).toFixed(2);
console.log(`(cloth ${avg(0)} ms, dressing ${avg(1)} ms) cloth + dressing, both fencers: mean ${(ms.reduce((s, x) => s + x, 0) / ms.length).toFixed(2)} ms, 95th ${ms[Math.floor(ms.length * 0.95)].toFixed(2)} ms, worst ${ms[ms.length - 1].toFixed(2)} ms; ${particles} particles a figure; ${m.n / 3} triangles`);
