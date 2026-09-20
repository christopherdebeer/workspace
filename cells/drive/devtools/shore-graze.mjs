#!/usr/bin/env node
/**
 * THE SHORE FROM A GRAZING CAMERA, AND THE BED UNDER IT AS NUMBERS.
 *
 * Written for the Romsdalen report — ground-view frames of the fjord showed
 * "horizontal terracing / sawtooth bands, quantised in world space" — and the
 * mechanism turned out to be the terrain under the water, not the water: the
 * kernel dropped the sea bed SEA_BED per vertex on the nearest cover pixel's
 * word, so a 38 m raster stamped a 6 m plateau with pixel-shaped holes in it,
 * lone vertices standing proud of the sea, and bilinear ramps between them.
 *
 * Two witnesses, because a frame cannot say which layer a ledge belongs to:
 *
 *   1. A TRANSECT from the truck through the nearest drawn water and on,
 *      every 3 m: the DEM, the drawn mesh, the cover class and the water's
 *      resting level. It FAILS when a sample with drawn water (coverage at the
 *      cut or over, past the first texel of shore) has its mesh above the
 *      resting level — a ledge through the water — or when two adjacent
 *      samples inside the water step by more than STEP_M, which is the
 *      sawtooth stated in metres.
 *   2. THE GRAZING CAMERA: the god camera at water level (`EL` degrees up,
 *      `DIST` metres back) looking along the shore from `AZ` azimuths, drawn,
 *      HUD and tile key off. `SHOTS=0` keeps the numbers alone.
 *
 * FIX=at-romsdalen is the case that found it; at-senqu-ford and at-glencairn
 * are the river and the lagoon. A live SPOT= works but is not a control: two
 * boots stream two worlds.
 */
import { openDrive, WORK } from './harness.mjs';
const FIX = process.env.FIX || 'at-romsdalen';
const SPOT = process.env.SPOT ? `${process.env.SPOT}&time=NOON&wx=clear&nodraw=1&wxlive=0` : `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1&wxlive=0`;
const EL = Number(process.env.EL ?? 3), DIST = Number(process.env.DIST ?? 50);
const AZ = String(process.env.AZ ?? '60,240').split(',').map(Number);
const SHOTS = process.env.SHOTS !== '0';
const STEP_M = Number(process.env.STEP_M ?? 2.5);
const REACH = Number(process.env.REACH ?? 240);
const d = await openDrive({ spot: SPOT, tag: 'shore' });
const p = d.page;
let settled = false;
for (let i = 0; i < 120; i++) {
  const s = await p.evaluate(() => ({ dirty: window.__tstats().dirty, builds: window.__tstats().builds }));
  if (i > 10 && s.dirty === 0) { settled = true; break; }
  await p.waitForTimeout(2000);
}
console.log(settled ? 'settled' : 'NOT SETTLED — numbers below are of a partial world');
// The nearest drawn water on the wet map, and a transect through it.
const map = await p.evaluate(() => window.__wetmap(384, 65));
const n = 65, half = 384, cell = 2 * half / (n - 1);
let best = null;
map.forEach((row, iz) => [...row].forEach((c, ix) => {
  if (c !== 'W') return;
  const x = -half + ix * cell, z = -half + iz * cell, dd = Math.hypot(x, z);
  if (!best || dd < best.dd) best = { x, z, dd };
}));
if (!best) { console.log('no drawn water within 384 m of the truck — nothing to measure'); await d.close(); process.exit(2); }
const rows = await p.evaluate(([dx, dz, reach]) => {
  const out = [];
  const L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
  for (let s = 0; s <= reach; s += 3) {
    const x = window.__drive.x + ux * s, z = window.__drive.z + uz * s;
    const g = window.__ground(x, z); const c = window.__coverAt(x, z);
    out.push({ s, x, z, dem: g.dem, mesh: g.mesh, cov: c?.truth ?? null,
      kind: g.water?.kind ?? null, lvl: g.water?.resting ?? null, coverage: g.water?.coverage ?? null });
  }
  return out;
}, [best.x, best.z, REACH]);
let ledges = 0, steps = 0, wetSamples = 0, firstWet = -1;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const wet = r.kind && r.coverage !== null && r.coverage >= 0.5;
  if (wet && firstWet < 0) firstWet = r.s;
  const inside = wet && firstWet >= 0 && r.s - firstWet > 20;
  const flag = [];
  if (inside) {
    wetSamples++;
    if (r.mesh !== null && r.lvl !== null && r.mesh > r.lvl + 0.05) { ledges++; flag.push('LEDGE'); }
    const q = rows[i - 1];
    if (q && q.mesh !== null && r.mesh !== null && Math.abs(r.mesh - q.mesh) > STEP_M) { steps++; flag.push(`STEP ${(r.mesh - q.mesh).toFixed(2)}`); }
  }
  console.log(String(r.s).padStart(4), 'dem', String(r.dem).padStart(7), 'mesh', String(r.mesh).padStart(7),
    'cov', String(r.cov).padEnd(4), (r.kind ? `${r.kind} lvl ${r.lvl} cov ${r.coverage}` : '-').padEnd(30), flag.join(' '));
}
console.log(`transect: ${rows.length} samples, first wet at ${firstWet} m, ${wetSamples} inside the water · ledges ${ledges} · steps>${STEP_M}m ${steps}`);
let shots = [];
if (SHOTS) {
  const truck = await p.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
  const tx = truck.x + best.x, tz = truck.z + best.z;
  const lvl = rows.find((r) => r.lvl !== null)?.lvl ?? 0;
  await p.evaluate(() => { window.__hud(false); window.__tiledbg(false); window.__draw(true); });
  for (const az of AZ) {
    await p.evaluate(([x, z, y, az, el, dist]) => window.__godcam({ x, z, y, az, el, dist, fov: 50 }), [tx, tz, lvl + 0.6, az, EL, DIST]);
    await p.waitForTimeout(3000);
    const name = `shore-${FIX}-az${az}`;
    await d.shot(name); shots.push(`${WORK}/${name}.png`);
  }
  console.log('shots', shots.join(' '));
}
console.log('errors', JSON.stringify(d.errors));
await d.close();
const fail = ledges > 0 || steps > 0 || d.errors.length > 0;
console.log(fail ? 'FAIL' : 'ok');
process.exit(fail ? 1 : 0);
