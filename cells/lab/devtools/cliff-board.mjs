// The cliff village board (node cells/lab/devtools/cliff-board.mjs [blocks|labyrinth]): the target (devtools/targets/
// cliff-village.jpg, a village stacked on a cliff over a harbour, as a tabletop piece) beside Blocks' cliff demo and
// Labyrinth's harbour village, each from a pinned eye framing the same composition. Writes devtools/out/cliff-*.png
// and devtools/out/cliff-board.png. Blocks is judged as a diorama; Labyrinth as a place that thins out into lines on
// the paper at its edges (it is never cut into a block).
import { join } from 'node:path';
import { withWood } from './harness.mjs';
const out = new URL('./out', import.meta.url).pathname;
const only = process.argv[2];
const shots = [];
if (!only || only === 'blocks') {
  process.env.EXPERIMENT = 'blocks'; process.env.READY = '__blocks';
  await withWood(async (wood) => {
    const page = await wood.open('demo=cliff');
    await page.evaluate(() => window.__blocks.view(-2.75, 0.55, 17, [7, 2.5, 10]));
    await page.waitForFunction(() => window.__blocks.settled() && window.__blocks.frames > 3, null, { timeout: 300000 });
    await page.waitForTimeout(800);
    shots.push(await wood.shot(page, 'cliff-blocks'));
    await page.close();
  });
}
if (!only || only === 'labyrinth') {
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  await withWood(async (wood) => {
    const page = await wood.open('demo=village&cam=cliff');
    await page.waitForTimeout(6000);
    shots.push(await wood.shot(page, 'cliff-labyrinth'));
    await page.close();
  });
}
process.env.EXPERIMENT = 'blocks';
await withWood(async (wood) => {
  const target = join(new URL('.', import.meta.url).pathname, 'targets/cliff-village.jpg');
  await wood.montage([target, ...shots], 'cliff-board', { height: 640, labels: ['target', ...shots.map((p) => p.split('/').pop().replace('.png', ''))] });
});
