/**
 * THE BLACK RECTANGLES, HUNTED. At the user's stormy Val Müstair spot the
 * screen carries large dithered black blocks that jitter and fly. Put the
 * world in WIRE, list the scene, then stand each scene-level system down
 * (through material.visible, which nothing reasserts) and photograph —
 * whichever removal deletes the blocks is the culprit.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=46.5932&lon=10.4308&h=179&cam=chase&wx=storm&sunalt=35', tag: 'hunt' });
await d.page.waitForTimeout(30000);
console.log('scene:', JSON.stringify(await d.page.evaluate(() => window.__sceneList())));
await d.page.evaluate(() => { window.__dial('xray', 2); });
await d.page.waitForTimeout(6000);
await d.shot('hunt-wire');
for (const name of ['rain', 'dust', 'birds', 'herds', 'sward']) {
  const n = await d.page.evaluate((q) => window.__matShow(q, false), name);
  await d.page.waitForTimeout(4000);
  await d.shot(`hunt-no-${name}`);
  await d.page.evaluate((q) => window.__matShow(q, true), name);
  console.log(`stood down ${name}: ${n} materials`);
}
await d.page.evaluate(() => { window.__dial('xray', 0); });
await d.page.waitForTimeout(3000);
await d.shot('hunt-solid');
console.log(`-> ${join(WORK, 'hunt-*.png')}`);
report(d.errors);
await d.close();
