// Piste's kit, checked at its seams (node cells/lab/devtools/piste-seams.mjs [clay|dressed]): the figure from the angles
// and in the poses where a loose edge shows (from in front, front-left, behind and the side; guard, the arm extended,
// a lunge, mid-retreat). Every garment's pieces should meet where they're sewn: an armhole to its sleeve, a sleeve's
// cuff onto the wrist, the jacket's hem over the breeches, the sock into the shoe. Also prints where the armholes were
// cut. Writes devtools/out/seams.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
import { build } from 'esbuild';
const look = process.argv[2] === 'dressed' ? '' : '&clay';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/athlete';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
M.buildAthlete();
for (const s of M.SEAMS) console.log(`${s.what}: rows ${s.rows.join('–')} (${s.heights.map((h) => (h * 100).toFixed(0)).join('–')} cm above the pelvis), columns ${s.cols.join('–')}`);
const { withWood } = await import('./harness.mjs');
const W = { width: 844, height: 390 };
const SHOTS = [
  ['auto&view=side&t=6&still&mask=0&orbit=3.0,0.05,0.42,0.75,0,0', W, 'guard, from in front'],
  ['auto&view=side&t=6&still&mask=0&orbit=2.4,0.1,0.42,0.75,0,0', W, 'guard, front-left'],
  ['auto&view=side&t=6&still&mask=0&orbit=0.4,0.15,0.5,0.75,0,0', W, 'guard, from behind'],
  ['study=retreat&view=side&t=1.08&still&mask=0', W, 'mid-retreat, side'],
  ['study=cloth&t=2.2&still&mask=0', { width: 420, height: 520 }, 'arm extended'],
  ['auto&view=side&t=32.8&still&mask=0', W, 'a lunge'],
];
await withWood(async (lab) => {
  const ps = [], labels = [];
  for (const [q, size, label] of SHOTS) {
    const p = await lab.open(q + look, { ...size, dpr: 1 }); await p.waitForTimeout(1300);
    if (p.errors.length) console.log(label, p.errors.slice(0, 2));
    const path = `${process.cwd()}/devtools/out/seams-${ps.length}.png`; await p.screenshot({ path }); ps.push(path); labels.push(label); await p.close();
  }
  console.log(await lab.montage(ps, 'seams', { height: 390, labels, columns: 3 }));
});
