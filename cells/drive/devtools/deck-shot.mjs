/**
 * EYE CHECK for the deck (client/hud-deck.ts): DRONE AUTO CAM NAV (free) VIEW,
 * the two trays up in turn, the baseline, the chart and the drone, upright and turned, on the Camps Bay fixture at noon.
 * No assertions — hud-deck.test.mjs holds the behaviour; this is the frames
 * for judging the look against the mock.
 *
 *   node cells/drive/devtools/deck-shot.mjs            → $DRIVE_WORK/deck-*.png
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'fixture=at-campsbay&cam=chase&time=NOON&wx=clear', tag: 'deckshot' });
await d.page.waitForTimeout(20000);
await d.page.evaluate(() => { document.querySelector('.m-x, .m-close')?.click(); window.__dial('auto', 1); });
const snap = async (name) => {
  await d.page.waitForTimeout(3500);
  await d.page.screenshot({ path: join(WORK, `${name}.png`), timeout: 240000 });
  console.log(`-> ${join(WORK, `${name}.png`)}`, JSON.stringify(await d.page.evaluate(() => window.__deck())));
};
const tap = (t) => d.page.evaluate((x) => document.querySelector(`[data-deck-tab="${x}"]`).click(), t);
await snap('deck-base');
await tap('auto'); await tap('nav'); await snap('deck-nav-auto');
await tap('auto');
await d.page.evaluate(() => window.__setcam('top')); await snap('deck-nav-chart');
await tap('nav'); await snap('deck-chart');
await d.page.evaluate(() => window.__setcam('chase'));
await tap('cam'); await snap('deck-cab');
await tap('cam');
await tap('view'); await snap('deck-view');
await tap('view');
await tap('drone'); await d.page.waitForTimeout(8000); await snap('deck-drone');
await tap('drone'); await d.page.waitForTimeout(8000);
await d.page.setViewportSize({ width: 844, height: 390 });
await tap('view'); await snap('deck-view-turned');
report(d.errors);
await d.close();
