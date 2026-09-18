/**
 * ── IS THE DEM NORMAL A RESIDUAL ON THE MESH, AND IS nscale A CONTROL ──
 *
 *   node cells/drive/devtools/normal-ab.mjs
 *   SPOT='lat=46.5302&lon=10.4547' node .../normal-ab.mjs
 *   FIX=at-campsbay node .../normal-ab.mjs
 *
 * Two claims, and only one of them is a number.
 *
 * THE FIRST IS THAT THE MATERIAL NO LONGER CHANGES WITH THE DIAL, which is
 * what makes every other reading here mean what it says. `?nscale=0` used to
 * swap every terrain tile onto the shared `terrainMat`, and that material
 * carries a GENERIC TILED PROCEDURAL normal map at 0.32 — so the A/B everyone
 * reached for was "repeating procedural normal against DEM normal", not "flat
 * against normal-mapped terrain", and anything tuned on it was tuned against
 * the wrong comparison. `__tdetail().nrm` reports tiles against tiles wearing
 * their OWN per-tile material, at both ends of the dial, and the tool fails if
 * that count moves. A pixel measurement cannot witness this: a swap and a
 * strength change both move pixels.
 *
 * THE SECOND IS WHAT THE RESIDUAL IS WORTH, interleaved on ONE settled world
 * (nrm1, nrm0, nrm1-b, nrm0-b — the repeats are the same setting at the same
 * temporal separation as the cross pairs, so their diff is the floor), cropped
 * to the near field, because the residual is ~8 m detail and a full-frame mean
 * of a near-field term divides the signal by the sky. `nrm0.35` is the old
 * default's strength for scale, and `flat` is the residual and the substrate's
 * own relief both out — the ground lit by its geometry alone.
 */
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// The Stelvio: a bare alpine pass, which is where the mesh's own lattice has
// the most detail to have dropped and where phase C measured a floor of
// exactly zero — no sward, no wildlife, nothing left streaming.
const SPOT = process.env.SPOT ?? 'lat=46.5302&lon=10.4547';
const FIX = process.env.FIX ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/normal';
const CAMS = (process.env.CAMS ?? 'chase,top').split(',');
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: (FIX ? `fixture=${FIX}` : SPOT) + '&cam=chase&time=NOON&wx=clear&nodraw=1',
  tag: 'normal-ab', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.builds > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

// THE CONTROL CLAIM, BEFORE ANY PIXEL. Read at both ends of the dial, because
// what is being asserted is that the dial does not reach the material.
const mats = [];
for (const k of [1, 0, 1]) {
  await q((v) => window.__tdetail({ nrm: v }), k);
  await d.page.waitForTimeout(400);
  mats.push(await q(() => window.__tdetail().nrm));
}
console.log(`  materials: ${mats.map((m) => `k=${m.k} own ${m.own}/${m.tiles}`).join(' · ')}`);
const swapped = mats.some((m) => m.own !== mats[0].own || m.tiles !== mats[0].tiles);
console.log(`  ${swapped ? 'FAIL  the dial still swaps the material — nscale is not a control'
  : 'ok    the material is the same at every strength — nscale is flat against residual'}`);
if (swapped) process.exitCode = 1;

await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
for (const cam of CAMS) {
  await q((m) => window.__cam(m), cam);
  if (cam === 'top') await q(() => window.__zoom(0.6));
  await d.page.waitForTimeout(9000);
  const legs = [['nrm1', { nrm: 1 }], ['nrm0', { nrm: 0 }], ['nrm1-b', { nrm: 1 }], ['nrm0-b', { nrm: 0 }],
    ['nrm035', { nrm: 0.35 }], ['flat', { nrm: 0, relief: 0 }], ['nrm2', { nrm: 2 }]];
  for (const [tag, o] of legs) {
    await q((v) => window.__tdetail(v), o);
    await d.page.waitForTimeout(500);
    writeFileSync(`${OUT}/${cam}-${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
  }
  await q(() => window.__tdetail({ nrm: 1, relief: 0.35 }));
  const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const crop = `--crop=${Math.round(box.w * 0.12)},${Math.round(box.h * 0.5)},`
    + `${Math.round(box.w * 0.76)},${Math.round(box.h * 0.46)}`;
  const pairs = [['nrm1', 'nrm1-b', 'floor-on'], ['nrm0', 'nrm0-b', 'floor-off'],
    ['nrm0', 'nrm1', 'SIGNAL  the residual'], ['nrm0', 'nrm035', 'the old 0.35'],
    ['nrm1', 'nrm2', 'twice the residual'], ['nrm0', 'flat', 'the substrate relief alone']];
  for (const [a, b, label] of pairs) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/${cam}-${a}.png`, `${OUT}/${cam}-${b}.png`, `${OUT}/${cam}-d-${a}-${b}.png`,
      crop, '--gain=8'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  [${cam}] ${label.padEnd(26)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  }
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(`  harness errors: ${d.errors.length}${d.errors.length ? ' ' + JSON.stringify(d.errors.slice(0, 4)) : ''}`);
await d.close();
