/**
 * WHAT THE CHART SHOWS AT EACH ZOOM — the wide-view survey.
 *
 *   node cells/drive/devtools/chart.mjs [--spot='lat=..&lon=..&h=..'] \
 *        [--zooms=8,60,400] [--dwell=12000]
 *
 * Boots in the top (chart) camera, steps the zoom out through the given
 * levels, gives streaming a moment to chase each one, and screenshots every
 * step. This is the instrument that showed the chart's real ceiling: at zoom
 * 60 the view is pure landform — the fine OSM ring (OSM_RING_MAX) stops at
 * ~5.4km and nothing coarser exists — and at 400 the far shell lags the zoom
 * and the frame is an island of terrain in the sea plane. Any work on a
 * coarse overview layer starts and ends with these pictures.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const spot = arg('spot', 'lat=62.4498&lon=7.6684&h=27&cam=top&time=NOON&sunalt=40');
const zooms = arg('zooms', '8,60,400').split(',').map(Number);
const dwell = Number(arg('dwell', 12000));

const d = await openDrive({ spot, tag: 'chart' });
await d.page.waitForTimeout(20000);
for (const z of zooms) {
  await d.page.evaluate((zz) => window.__zoom(zz), z);
  await d.page.waitForTimeout(dwell);   // let streaming chase the view out
  await d.shot(`chart-z${z}`);
  console.log(`z${z} -> ${join(WORK, `chart-z${z}.png`)}`);
}
report(d.errors);
await d.close();
