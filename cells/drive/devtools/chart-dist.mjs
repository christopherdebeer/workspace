// Does the chart's stand-off still move with speed?
//
// TWO TIME SCALES, AND THEY HAVE TO BE KEPT APART. The zoom is a TARGET that
// `zoomCur` eases toward at 8/s, so changing it needs frames to pass; the speed
// term, if it were still there, is applied per frame from `state.speed`, so
// proving it gone needs NO frame to pass — `__drive` IS the sim's state object,
// and setting `speed` on it and reading `__cam()` in the same evaluate means
// the sim never gets a chance to put the speed back. So: set the zoom and wait
// for it, then sweep the speed synchronously. The first cut of this ran the
// whole thing in one block and read zoom 1 / dist 175 in all six rows — a real
// pass on the speed question and no test of the zoom question at all.
import { openDrive } from './harness.mjs';

const { page, close } = await openDrive({ spot: 'at-simonstown', tag: 'chartdist', settle: 0, dpr: 2 });

async function atZoom(z) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  // Frames, not a timeout: the harness paints at 2-4fps, so wall time says
  // nothing about how far an 8/s ease has got. Poll until it has arrived.
  for (let i = 0; i < 60; i++) {
    const got = await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.05, zz * 0.02), z);
    if (got) break;
    await new Promise((s) => setTimeout(s, 250));
  }
  return page.evaluate(() => {
    const w = window, rows = [];
    for (const kmh of [0, 60, 120, 180]) {
      w.__drive.speed = kmh / 3.6;
      const c = w.__cam();
      rows.push({ kmh, zoom: c.zoom, dist: c.dist, viewR: w.__ov ? w.__ov().viewR : null });
    }
    w.__drive.speed = 0;
    return rows;
  });
}

let bad = 0;
for (const z of [0.125, 2.2, 20]) {
  const rows = await atZoom(z);
  console.log(`\nzoom asked ${z} -> ${rows[0].zoom}   (CAM.base 175 x zoom = ${Math.round(175 * rows[0].zoom)}m expected)`);
  for (const r of rows) console.log('  ', JSON.stringify(r));
  const d = new Set(rows.map((r) => r.dist)), v = new Set(rows.map((r) => r.viewR));
  if (d.size !== 1) { console.log(`  FAIL stand-off moves with speed: ${[...d]}`); bad++; }
  if (v.size !== 1) { console.log(`  FAIL streaming radius moves with speed: ${[...v]}`); bad++; }
}
console.log(bad ? `\n${bad} FAILURES` : '\nPASS  the stand-off and the streaming radius are the zoom\'s alone, at every zoom');
const errs = await page.evaluate(() => window.__pageErrors ?? []);
console.log('pageerrors:', errs.length, errs.slice(0, 3));
await close();
