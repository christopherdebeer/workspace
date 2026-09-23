/**
 * THE CHART'S KEY (T5–T10 in chart-vocab.md), photographed in named states.
 *
 *   node cells/drive/devtools/chart-key-shot.mjs [tag]   → $DRIVE_WORK/key-<tag>-<state>.png
 *
 * Boots the Camps Bay fixture on the chart, then for each STATE runs its
 * setup in the page and crops the top of the frame, where the key lives.
 * STATES=name1,name2 narrows the list. A reference for judging the key's
 * layout from the seat, not a measurement.
 */
import { join } from 'node:path';
import { openDrive, WORK } from './harness.mjs';

const TAG = process.argv[2] ?? 'now';
const ALL = {
  // What a player who has never touched the key sees.
  default: 'window.__chartlayers?.()',
  // Every checkbox chip on and a ground view up.
  busy: `(() => { const L = window.__chartlayers; for (const id of ['tiles','stream','cover']) { try { L(id, true); } catch {} } })()`,
};
const want = process.env.STATES ? process.env.STATES.split(',') : Object.keys(ALL);
const d = await openDrive({ spot: 'fixture=at-campsbay&cam=top&time=NOON&wx=clear', tag: 'chartkey', settle: 0, bootTimeout: 180000 });
await d.page.waitForTimeout(15000);
await d.page.evaluate(() => document.querySelector('.m-x, .m-close')?.click());
for (const name of want) {
  await d.page.evaluate(ALL[name]);
  await d.page.waitForTimeout(6000);
  const p = join(WORK, `key-${TAG}-${name}.png`);
  await d.page.screenshot({ path: p, timeout: 240000, clip: { x: 0, y: 0, width: 390, height: 300 } });
  console.log('->', p);
}
console.log('errors', JSON.stringify(d.errors ?? []));
await d.close();
