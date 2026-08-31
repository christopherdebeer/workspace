// EYE CHECK at the user's own Monument Valley photograph: heading 285 at the
// spot where The Setting Hen and Eagle Mesa filled the frame with no names.
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=37.0491&lon=-110.0978&h=14&cam=chase&sunalt=55&wx=clear', tag: 'peak' });
await d.page.waitForTimeout(35000);      // let peak tiles + far shell stream
const peaks = await d.page.evaluate(() => window.__peaks ? window.__peaks() : null);
console.log('peaks probe:', JSON.stringify(peaks)?.slice(0, 400));
const strip = await d.page.evaluate(() => {
  const out = [];
  for (let y = 20; y <= 200; y += 10) out.push([y, window.__luma(97, y)]);
  return out;
});
console.log('depth strip (centre column):', JSON.stringify(strip));
const dv = await d.page.evaluate(() => ({
  east: window.__dvis('Bears Ears East'), toe: window.__dvis('The Toe') }));
console.log('dvis:', JSON.stringify(dv));
await d.shot('peaks-285');
console.log(`-> ${join(WORK, 'peaks-285.png')}`);
// The Bears Ears bearing from the first photograph.
await d.page.evaluate(() => { window.__drive.heading = (300 * Math.PI) / 180; });
await d.page.waitForTimeout(9000);
await d.shot('peaks-285b');
console.log(`-> ${join(WORK, 'peaks-285b.png')}`);
report(d.errors);
await d.close();
