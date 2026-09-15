/**
 * ── WHERE THE HUD'S MILLISECONDS GO ──
 *
 *   node cells/drive/devtools/hud-split.mjs
 *   FIX=at-campsbay node .../hud-split.mjs
 *
 * `drawHud` reached 11.0% of a device session at 6.7 ms a call, drawing on
 * 1,383 of 1,566 frames — the third largest phase after the gap and
 * terrainApply. Its own note records 1.9 ms when the half-rate gate was
 * written and 4.5 when the gate was widened, so the gate is doing what it was
 * designed to do and the design's assumption is what failed.
 *
 * One number over 1,500 lines cannot say which of a luma map, a scale bar, a
 * tile-debug grid, a POI lane solver, a compass and a live minimap to cut —
 * and this file has twice recorded a guess at such a split being wrong. So
 * `hudLap` prices the sections at their own comment headers and this reads
 * them back, in BOTH cameras, because the chart draws four things the seat
 * never does and the seat is where a driver is.
 *
 * DRAWING IS ON, deliberately, unlike every other CPU measurement here: the
 * HUD is a 2D canvas and `nodraw` skips it entirely, so a nodraw run would
 * report a HUD that never ran. The harness's frames are seconds apart, which
 * changes how OFTEN drawHud is called and not what one call costs.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-paris-west';
const SPOT = process.env.SPOT ?? '';
const SECS = Number(process.env.SECS ?? 40);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const where = SPOT ? SPOT : `fixture=${FIX}`;

const d = await openDrive({
  spot: `${where}&cam=chase&time=NOON&wx=clear`,
  tag: 'hud-split', settle: 0, bootTimeout: 420000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// A settle gate, so the HUD is drawing a world rather than a loading screen:
// the POI lane solver and the chart's place names both scale with what has
// streamed, and measuring them half-arrived measures the streaming.
let quiet = 0, pb = -1, pc = -1;
for (let i = 0; i < 60; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.roadCells === pc && t.builds > 0) ? quiet + 1 : 0;
  pb = t.builds; pc = t.roadCells;
  if (quiet >= 2) break;
}
console.log(`[${el()}] settled · builds ${pb} cells ${pc}`);

async function window_(cam, secs) {
  await q((c) => window.__cam(c), cam);
  await d.page.waitForTimeout(2000);
  await q(() => window.__hudprof(true));           // reset AFTER the camera settles
  await d.page.waitForTimeout(secs * 1000);
  return q(() => window.__hudprof());
}

const out = {};
for (const cam of ['chase', 'top']) out[cam] = await window_(cam, SECS);
const errs = d.errors.length;
await d.close();

for (const cam of ['chase', 'top']) {
  const H = out[cam];
  console.log(`\n── ${cam.toUpperCase()} · ${H.calls} draws · ${H.msPerCall.toFixed(2)} ms a call`);
  if (!H.calls) { console.log('  NOT DRAWN — nothing to attribute'); continue; }
  const rows = Object.entries(H.rows);
  for (const [k, v] of rows) {
    const pct = 100 * v / Math.max(0.001, H.msPerCall);
    if (v < 0.005) continue;
    console.log(`  ${k.padEnd(9)} ${v.toFixed(3).padStart(7)} ms ${`${pct.toFixed(0)}%`.padStart(5)}`
      + ` ${'█'.repeat(Math.round(pct / 3))}`);
  }
  console.log(`  ${'other'.padEnd(9)} ${H.other.toFixed(3).padStart(7)} ms`
    + ` — the residual no lap covers`);
}
console.log(`\npage errors ${errs}`);
