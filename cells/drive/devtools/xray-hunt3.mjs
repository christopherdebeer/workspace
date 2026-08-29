/**
 * THE WIRE-MODE BLACK BOXES. User reports: with X-RAY WIRE on at this spot
 * the boxes look like CRITTER boxes, and vegetation joined them once the
 * sweep started touching scene-level meshes. Reproduce in wire, then stand
 * veg / birds / herds down in turn — and pick through a box to name it.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=46.60810&lon=10.43658&h=39&cam=chase&sunalt=45&wx=clear', tag: 'hunt3' });
await d.page.waitForTimeout(30000);
await d.page.evaluate(() => { window.__dial('xray', 2); });
await d.page.waitForTimeout(6000);
await d.shot('hunt3-wire');
for (const name of ['veg', 'birds', 'herds']) {
  const n = await d.page.evaluate((q) => window.__matShow(q, false), name);
  await d.page.waitForTimeout(4000);
  await d.shot(`hunt3-no-${name}`);
  await d.page.evaluate((q) => window.__matShow(q, true), name);
  console.log(`stood down ${name}: ${n} materials`);
}
// A vertical strip of picks up the middle — if a box is geometry it names
// itself; span/tris tell an instanced field from a tile.
const picks = await d.page.evaluate(() => {
  const out = [];
  for (let ny = -0.8; ny <= 0.9; ny += 0.25) out.push({ ny: +ny.toFixed(2), hits: window.__pick(0, ny).slice(0, 2) });
  return out;
});
for (const q of picks) {
  console.log(`ny=${q.ny}`, JSON.stringify(q.hits.map((x) => ({ p: x.parent, d: x.dist, span: x.span, tris: x.tris }))));
}
await d.page.evaluate(() => { window.__dial('xray', 0); });
console.log(`-> ${join(WORK, 'hunt3-*.png')}`);
report(d.errors);
await d.close();
