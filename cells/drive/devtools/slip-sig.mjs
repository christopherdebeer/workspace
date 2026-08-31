/**
 * THE SLIP SIGNAL, ROW BY ROW. Build speed straight on the tarmac, then
 * slalom the way a thumb does — alternating lock — and read skid, slideV,
 * spin and the squeal gain at each beat. This decides whether the silence
 * is the MIXER (signal present, gain absent) or the MODEL (no signal on
 * arcade tarmac at all).
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&sunalt=45&wx=clear', tag: 'sig' });
await d.page.waitForTimeout(22000);
console.log('arm:', await d.page.evaluate(() => window.__armAudio()));
await d.page.evaluate(() => { window.__hold(0, 1); });
await d.simWait(5);                                 // straight, up to speed
for (let i = 0; i < 10; i++) {
  const s = i % 2 ? 0.75 : -0.75;
  await d.page.evaluate((q) => { window.__hold(q, 0.8); }, s);
  await d.simWait(0.9);
  const r = await d.page.evaluate(() => ({ ...window.__slip(), squeal: window.__mix().squeal, eng: window.__mix().eng }));
  console.log(`t${i} steer=${s}`, JSON.stringify(r));
}
await d.page.evaluate(() => { window.__hold(null); });
report(d.errors);
await d.close();
