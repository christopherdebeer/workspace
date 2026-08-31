/**
 * THE HEDGE, DRIVEN THROUGH. Yosemite valley floor, off the road into the
 * stands: expects brushAmt > 0 somewhere along the run (foliage drag + leaf
 * hiss), possibly 'wood' knocks in the ledger, and NO push-out — the truck
 * keeps moving through it all.
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({ spot: 'lat=37.70564&lon=-119.67737&h=20&cam=chase&sunalt=40&wx=clear', tag: 'brush' });
await d.page.waitForTimeout(25000);
await d.page.evaluate(() => { window.__hold(0.05, 0.8); });
let maxBrush = 0, minKmh = 1e9, maxKmh = 0;
for (let i = 0; i < 10; i++) {
  await d.simWait(1.6);
  const s = await d.page.evaluate(() => ({ amb: window.__amb(), kmh: window.__real().kmh }));
  maxBrush = Math.max(maxBrush, s.amb.brushPeak ?? s.amb.brush ?? 0);
  minKmh = Math.min(minKmh, s.kmh); maxKmh = Math.max(maxKmh, s.kmh);
}
const impacts = await d.page.evaluate(() => window.__impacts());
const wood = impacts.filter((q) => q.kind === 'wood').length;
console.log(`maxBrush=${maxBrush} wood=${wood} kmh=[${minKmh.toFixed(0)}..${maxKmh.toFixed(0)}] impacts=${impacts.length}`);
console.log('tail:', JSON.stringify(impacts.slice(-5)));
await d.page.evaluate(() => { window.__hold(null); });
await d.shot('brush-run');
report(d.errors);
await d.close();
