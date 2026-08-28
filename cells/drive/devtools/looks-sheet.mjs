/**
 * A CONTACT SHEET OF THE PRESETS. One boot, one scene, the PRESET dial
 * cycled through its stamps — so the frames differ by the rack and nothing
 * else. Also the plain 1-bit with each PATTERN, for judging the dither
 * algorithms against each other on identical ground.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({
  spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&wx=clear&wet=0&fog=0',
  tag: 'looks', settle: 16000,
});
const setDial = async (key, i) => {
  await d.page.evaluate(([k, j]) => window.__dial(k, j), [key, i]);
  await d.page.waitForTimeout(1200);
};
const snap = async (name) => { await d.shot(name); console.log(`-> ${join(WORK, `${name}.png`)}`); };

for (const [i, name] of [[1, 'look-stock'], [2, 'look-print'], [3, 'look-xerox'], [4, 'look-etch'], [5, 'look-term']]) {
  await setDial('look', i);
  await snap(name);
}
// Pattern row: true 1-bit MONO, HARD contrast, each threshold pattern.
await setDial('look', 1);
await setDial('pal', 0);
await setDial('ink', 1);
await setDial('con', 2);
for (const [i, name] of [[0, 'pat-bayer4'], [1, 'pat-bayer8'], [2, 'pat-check'], [3, 'pat-grain'], [4, 'pat-lines']]) {
  await setDial('dpat', i);
  await snap(name);
}
report(d.errors);
await d.close();
