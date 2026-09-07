/**
 * BOTH ENDS OF THE CHART'S ZOOM, measured rather than typed.
 *
 * The range was doubled from the seat's request — pull in twice as close and
 * twice as far — and each end is a different question. The NEAR end is a
 * picture: does a junction read at 0.125, or is the frame a truck-sized
 * smear? So `NEAR=1` boots a capture, opens the chart over the origin and
 * photographs it at the old floor and the new one. The FAR end is a ladder:
 * SIGHT_MAX picks the shell level, the shell's ring picks the cover level,
 * and the chart's roads follow on their own rungs — so the default mode
 * boots a live spot, pulls the chart out to the ceiling and reads `__far()`
 * and `__ovroads()` until the rings have landed, then says which level each
 * layer chose and whether its ring actually reaches the frame (`radius`
 * against 2.5 tiles at the level). Two spots by default, because the rungs
 * that matter are latitude: the z7 shell ring reaches 600km at the Cape and
 * not at Paris, which is what the z6 rung is for.
 *
 *   NEAR=1 node devtools/zoom-reach.mjs
 *   node devtools/zoom-reach.mjs                 # Cape Town, then Paris
 *   SPOTS=cape node devtools/zoom-reach.mjs      # one of them
 *   ZOOM_OUT=… REV=<sha> …
 *
 * A live run streams 25 coarse DEM tiles per level through the curl relay,
 * so budget five to ten minutes a spot cold and seconds warm.
 */
import { openDrive, WORK } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.env.ZOOM_OUT ?? join(WORK, 'zoom-reach');
mkdirSync(OUT, { recursive: true });
const REV = process.env.REV || '';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const q = (d, fn, ...a) => d.page.evaluate(fn, ...a);
const shot = (d, f) => d.page.screenshot({ timeout: 120000 }).then((b) => writeFileSync(f, b));

if (process.env.NEAR === '1') {
  const FIX = process.env.FIX ?? 'at-simonstown';
  const d = await openDrive({ spot: `fixture=${FIX}&cam=chase&time=NOON&nodraw=1`, tag: `zoom-near-${FIX}`, settle: 0, bootTimeout: 240000, dpr: 2, rev: REV });
  let quiet = 0, pw = -1, pc = -1;
  for (let i = 0; i < 120; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(d, () => window.__tstats());
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells;
    if (quiet >= 5) { console.log(`[${el()}] settled roadCells=${t.roadCells}`); break; }
  }
  await q(d, () => window.__draw(true));
  await q(d, () => { window.__place(0, 0, (246 * Math.PI) / 180); window.__drive.speed = 0; window.__cam('top'); });
  for (const z of [0.5, 0.25, 0.125, 0.05]) {
    await q(d, (z) => window.__zoom(z), z);
    await d.page.waitForTimeout(5000);
    const got = await q(d, () => ({ radius: window.__far().radius, farPlane: window.__far().farPlane }));
    await shot(d, `${OUT}/near-${z}.png`);
    console.log(`[${el()}] asked ${z}: viewRadius ${got.radius}m farPlane ${got.farPlane} → ${OUT}/near-${z}.png`);
  }
  console.log(`[${el()}] errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
  await d.close();
} else {
  const SPOTS = {
    cape: ['-34.19511', '18.44192', 'Simon\'s Town, 34°S — a z7 shell ring reaches 600km here'],
    paris: ['48.77736', '2.22332', 'Vélizy, 49°N — a z7 ring falls short of 600km; the z6 rung should engage'],
  };
  const want = (process.env.SPOTS ?? 'cape,paris').split(',');
  const report = {};
  for (const name of want) {
    const [lat, lon, why] = SPOTS[name];
    console.log(`[${el()}] ${name}: ${why}`);
    const d = await openDrive({ spot: `lat=${lat}&lon=${lon}&cam=top&time=NOON&nodraw=1`, tag: `zoom-far-${name}`, settle: 0, bootTimeout: 240000, rev: REV });
    await q(d, () => window.__zoom(1e9));
    let last = null, still = 0;
    for (let i = 0; i < 60; i++) {
      await d.page.waitForTimeout(10000);
      const f = await q(d, () => ({ far: window.__far(), ov: window.__ovroads() }));
      const key = JSON.stringify([f.far.level, f.far.tiles, f.far.asked, f.ov.level, f.ov.tiles]);
      still = key === last ? still + 1 : 0; last = key;
      console.log(`[${el()}] ${name} t+${(i + 1) * 10}s shell z${f.far.level} ${f.far.tiles}/${f.far.asked} tiles inFlight ${f.far.inFlight} queued ${f.far.queued} cover ${JSON.stringify(f.far.cover)} | ov z${f.ov.level} tiles ${f.ov.tiles} ways ${f.ov.ways} | radius ${f.far.radius}m`);
      if (f.far.tiles >= 25 && f.far.inFlight === 0 && f.far.queued === 0 && still >= 2) { report[name] = f; break; }
      report[name] = f;
    }
    await q(d, () => window.__draw(true));
    await d.page.waitForTimeout(6000);
    await shot(d, `${OUT}/far-${name}.png`);
    console.log(`[${el()}] ${name}: errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))} → ${OUT}/far-${name}.png`);
    await d.close();
  }
  writeFileSync(join(OUT, 'far.json'), JSON.stringify(report, null, 1));
}
console.log(`total ${el()} → ${OUT}`);
