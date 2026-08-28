/**
 * THE X-RAY DIAL, PHOTOGRAPHED: DEPTH paints the occlusion map under the
 * live HUD; WIRE strips the world to its collision geometry. One spot,
 * three frames — OFF, DEPTH, WIRE.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&sunalt=45&wx=clear', tag: 'xray' });
await d.page.waitForTimeout(25000);
await d.shot('xray-off');
await d.page.evaluate(() => { window.__dial('xray', 1); });
await d.page.waitForTimeout(2000);
await d.shot('xray-depth');
await d.page.evaluate(() => { window.__dial('xray', 2); });
await d.page.waitForTimeout(6000);           // the sweep catches streamed tiles
await d.shot('xray-wire');
await d.page.evaluate(() => { window.__dial('xray', 0); });
console.log(`-> ${join(WORK, 'xray-off.png')} / xray-depth.png / xray-wire.png`);
report(d.errors);
await d.close();
