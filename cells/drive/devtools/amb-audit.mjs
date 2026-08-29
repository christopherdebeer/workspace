/**
 * THE IGNITION AND THE WORLD'S BED, PROBED. Yosemite valley floor: trees
 * and the Merced nearby, daylight. Expects: engine OFF at boot with a live
 * ambience mix (birds/veg/wind), CRANK then ON on the first throttle,
 * thrust actually moving the truck, and OFF again ~5s after parking.
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({ spot: 'lat=37.70564&lon=-119.67737&h=64&cam=chase&sunalt=40&wx=clear', tag: 'amb' });
await d.page.waitForTimeout(25000);
const boot = await d.page.evaluate(() => ({ eng: window.__engine(), amb: window.__amb() }));
console.log('boot:', JSON.stringify(boot));

await d.page.evaluate(() => { window.__hold(0, 0.7); });
await d.page.waitForTimeout(400);
console.log('asked:', JSON.stringify(await d.page.evaluate(() => window.__engine())));
await d.simWait(4);
const driving = await d.page.evaluate(() => ({ eng: window.__engine(), kmh: window.__real().kmh, amb: window.__amb() }));
console.log('driving:', JSON.stringify(driving));

await d.page.evaluate(() => { window.__hold(0, 0, 1); });   // brake to a stop, hold it
await d.simWait(9);
const parked = await d.page.evaluate(() => ({ eng: window.__engine(), kmh: window.__real().kmh, amb: window.__amb() }));
console.log('parked:', JSON.stringify(parked));
await d.simWait(6);                          // past the 5s idle window
const off = await d.page.evaluate(() => ({ eng: window.__engine(), amb: window.__amb() }));
console.log('off:', JSON.stringify(off));
await d.page.evaluate(() => { window.__hold(null); });
report(d.errors);
await d.close();
