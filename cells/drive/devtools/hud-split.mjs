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

// ── THE GATE, AND WHY IT IS SLOW HERE ──
//
// The POI lane solver, the chart's place names and the tile-debug grid all
// scale with what has streamed, so a half-arrived world reports them as free.
// THE FIRST RUN OF THIS TOOL DID EXACTLY THAT: it passed at 39 s on 269 road
// cells of a fixture that settles at 3,138, and four sections read ~0 ms. Two
// quiet polls is not a settle when drawing is on — the harness paints at three
// frames a second and the world build is paced by the frame loop, so progress
// is slow rather than finished. Four quiet polls, a poll budget that allows
// six minutes, and the counts printed so a reader can judge the run rather
// than trust the word `settled`.
let quiet = 0, pb = -1, pc = -1, pw = -1;
for (let i = 0; i < 120; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.roadCells === pc && t.seenWays === pw && t.builds > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pc = t.roadCells; pw = t.seenWays;
  if (quiet >= 4) break;
  if (i % 8 === 0) console.log(`[${el()}] dirty ${t.dirty} builds ${t.builds} ways ${t.seenWays} cells ${t.roadCells}`);
}
const settled = quiet >= 4;
console.log(`[${el()}] ${settled ? 'SETTLED' : 'NOT SETTLED'} · builds ${pb} ways ${pw} cells ${pc}`);

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
console.log(`\npage errors ${errs} · world ${settled ? 'settled' : 'NOT SETTLED'}` + ` · ${pw} ways ${pc} road cells`);
