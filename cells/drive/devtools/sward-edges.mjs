/**
 * ── ARE THE SWARD'S EDGES THE RASTER'S? ──
 *
 *   node cells/drive/devtools/sward-edges.mjs
 *   SPOT='lat=37.5&lon=-119.9' node .../sward-edges.mjs
 *   FIX=at-campsbay node .../sward-edges.mjs
 *
 * Reported from the seat as hard rectilinear boundaries in the grass. The
 * claim under test is that they are the z12 cover raster's ~30 m texels
 * arriving in the world undisguised, through
 * `density = GRASS_M2[sampleCover(x, z)]`, and not the blade lattice or any
 * fade downstream.
 *
 * ── AND THE MEASUREMENT IS NOT PIXELS ──
 *
 * A categorical raster boundary is AXIS-ALIGNED BY CONSTRUCTION: WorldCover is
 * a lat/lon grid and the sward field is in local metres off the same
 * projection, so a step inherited from the raster runs exactly north-south or
 * east-west while an ecological gradient points wherever the ground does.
 * `__swardedge` reports the field's own gradient directions as |cos 2θ| — 1 on
 * an axis, 0 on a diagonal, and 2/π ≈ 0.637 for no preference at all. That is
 * a statement about the DENSITY FIELD rather than about a frame, so it cannot
 * be confounded by where a tile happened to land or which way the camera was
 * pointing.
 *
 * ── ONE BOOT, BECAUSE THE FIELD IS A SWEEP AND NOT A BOOT-TIME CONST ──
 *
 * `__swardev(0|1)` re-sweeps synchronously, so both readings come off one
 * settled world with one thing changed. Every other sward switch here is read
 * once at boot and has had to be measured across two boots under two skies;
 * this one does not, and a claim about a hard EDGE is exactly the claim two
 * boots would blur.
 */
import { openDrive } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

// Yosemite's north rim above the valley: granite, meadow and forest inside a
// few hundred metres, which is where WorldCover draws its hardest lines.
const SPOT = process.env.SPOT ?? 'lat=37.73606&lon=-119.63732';
const FIX = process.env.FIX ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/swardedge';
const SHOTS = process.env.SHOTS !== '0';
mkdirSync(OUT, { recursive: true });

const d = await openDrive({
  spot: (FIX ? `fixture=${FIX}` : SPOT) + '&cam=chase&time=NOON&wx=clear'
    + (SHOTS ? '' : '&nodraw=1'),
  tag: 'sward-edges', settle: 0, bootTimeout: 300000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pb = -1, pw = -1, pc = -1;
for (let i = 0; i < 80; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.builds > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; pc = t.roadCells;
  if (quiet >= 3) break;
}
console.log(`settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);

// ── THE FIELD'S OWN GEOMETRY, BOTH WAYS ──
const rows = [];
for (const ev of [0, 1, 0, 1]) {
  await q((v) => window.__swardev(v), ev);
  rows.push(await q(() => window.__swardedge()));
}
const fmt = (r) => `ev ${r.ev} · texels ${r.n} · axis ${r.axisAlignment}`
  + ` · steps ${(r.strongShare * 100).toFixed(2)}% of them, aligned ${r.strongAlignment}`
  + ` · mean gradient ${r.meanGradient} · sweep ${r.sweepMs} ms`;
for (const r of rows) console.log(`  ${fmt(r)}`);
console.log(`  a field with NO directional preference would score ${rows[0].randomBaseline}`);
// The repeats are the determinism check: the sweep is deterministic in world
// space, so the two readings at each setting must be identical, and a pair
// that is not means something else moved between them.
const same = JSON.stringify(rows[0]) === JSON.stringify(rows[2])
  && JSON.stringify(rows[1]) === JSON.stringify(rows[3]);
console.log(`  the repeats agree: ${same ? 'yes' : 'NO — something else is moving'}`);

if (SHOTS) {
  await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
  for (const [tag, ev, cam, zoom] of [
    ['top-ev0', 0, 'top', 1.1], ['top-ev1', 1, 'top', 1.1],
    ['top-ev0-b', 0, 'top', 1.1],
    ['chase-ev0', 0, 'chase', null], ['chase-ev1', 1, 'chase', null],
  ]) {
    await q((m) => window.__cam(m), cam);
    if (zoom !== null) {
      let pd = -1;
      for (let i = 0; i < 30; i++) {
        await q((z) => window.__zoom(z), zoom);
        await d.page.waitForTimeout(500);
        const c = await q(() => window.__cam());
        if (c.dist !== null && c.dist === pd) break;
        pd = c.dist;
      }
    }
    await q((v) => window.__swardev(v), ev);
    await d.page.waitForTimeout(5000);
    writeFileSync(`${OUT}/${tag}.png`, await d.page.screenshot({ timeout: 240000 }));
    console.log(`  shot ${tag}`);
  }
  // The band that MOVED, scanned — never a crop stated in window fractions,
  // which has been wrong twice in this repo for the same reason.
  const box = await q(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const diff = (a, b, label, crop) => {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/${a}.png`, `${OUT}/${b}.png`, `${OUT}/d-${a}-${b}.png`, crop, '--gain=8'],
      { encoding: 'utf8' });
    const m = out.match(/mean luma delta[^\n]*/);
    console.log(`  ${label.padEnd(22)} ${m ? m[0].trim() : out.trim().split('\n').pop()}`);
  };
  const H = 40, x0 = Math.round(box.w * 0.1), w0 = Math.round(box.w * 0.8);
  let lo = -1, hi = -1;
  for (let y = 0; y + H <= box.h; y += H) {
    const out = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
      `${OUT}/chase-ev0.png`, `${OUT}/chase-ev1.png`, `${OUT}/scan.png`,
      `--crop=${x0},${y},${w0},${H}`, '--gain=8'], { encoding: 'utf8' });
    const m = out.match(/mean luma delta ([\d.]+)\/255/);
    if (m && Number(m[1]) > 0.02) { if (lo < 0) lo = y; hi = y + H; }
  }
  const chaseCrop = `--crop=${x0},${lo < 0 ? Math.round(box.h * 0.3) : lo},${w0},`
    + `${Math.max(40, (hi < 0 ? Math.round(box.h * 0.75) : hi) - (lo < 0 ? Math.round(box.h * 0.3) : lo))}`;
  console.log(`  the chase band that moved: rows ${lo}-${hi}`);
  const topCrop = `--crop=${x0},${Math.round(box.h * 0.15)},${w0},${Math.round(box.h * 0.6)}`;
  diff('top-ev0', 'top-ev0-b', 'floor (chart)', topCrop);
  diff('top-ev0', 'top-ev1', 'SIGNAL (chart)', topCrop);
  diff('chase-ev0', 'chase-ev1', 'SIGNAL (seat)', chaseCrop);
}
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
console.log(`  harness errors: ${d.errors.length}${d.errors.length ? ' ' + JSON.stringify(d.errors.slice(0, 4)) : ''}`);
await d.close();
