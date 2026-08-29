/**
 * EYE CHECK for sward flower diversity: rare, clumped colour in the grass
 * that differs by habitat (open meadow / woodland floor / water's edge /
 * cliff / ruins) rather than one uniform wildflower everywhere.
 *
 *   node cells/drive/devtools/flower-shot.mjs [spot-tag]
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const SPOTS = {
  meadow: 'lat=-30.6944&lon=27.7642&h=90&cam=cab&wx=clear&t=NOON',   // open highland grassland
  river: 'lat=47.06552&lon=2.03928&h=90&cam=cab&wx=clear&t=NOON',    // French river bank
  ruin: 'lat=-30.69248&lon=27.76397&h=6&cam=cab&wx=clear&t=MORNING', // known ruin-dense spot
};
const which = process.argv[2] ?? 'meadow';
const d = await openDrive({ spot: SPOTS[which] ?? SPOTS.meadow, tag: `flower-${which}`, settle: 45000 });
await d.page.evaluate(() => window.__hide('critters'));
await d.page.waitForTimeout(6000);
const ctx = await d.page.evaluate(() => window.__swardctx(220, 14));
console.log(`      habitat mix near ${which}:`, JSON.stringify(ctx.counts), `of ${ctx.n} samples`);
await d.shot(`flower-${which}`, { timeout: 90000 });
console.log(`-> ${join(WORK, `flower-${which}.png`)}`);
report(d.errors);
await d.close();
