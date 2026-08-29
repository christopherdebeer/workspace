/**
 * THE BLACK RECTANGLES, NAMED. Same stormy spot; take a frame, then ask
 * the renderer what is drawn across a grid of screen points — the blocks
 * occupy regions that should be sky or far slope, so any near hit there
 * names the culprit object directly.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=46.5932&lon=10.4308&h=179&cam=chase&wx=storm&sunalt=35', tag: 'hunt2' });
await d.page.waitForTimeout(30000);
await d.shot('hunt2-frame');
console.log(`-> ${join(WORK, 'hunt2-frame.png')}`);
const grid = await d.page.evaluate(() => {
  const out = [];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      const nx = -0.8 + gx * 0.4, ny = 0.9 - gy * 0.3;
      const hits = window.__pick(nx, ny);
      out.push({ nx: +nx.toFixed(1), ny: +ny.toFixed(1), hits });
    }
  }
  return out;
});
for (const q of grid) {
  const h = q.hits.map((x) => `${x.n}${x.p ? '<' + x.p : ''}@${x.d}m/${x.m}`).join(' | ');
  console.log(`(${q.nx},${q.ny}) ${h || 'sky'}`);
}
report(d.errors);
await d.close();
