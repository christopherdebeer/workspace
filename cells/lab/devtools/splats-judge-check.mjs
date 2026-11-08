// The judging page at a phone's size (node cells/lab/devtools/splats-judge-check.mjs): a pair shown, one chosen, the next shown.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const page = await wood.open(`scene=composed&judge`);
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.composed?.judge?.stage === 'shown', null, { timeout: 180000 });
  await page.waitForTimeout(800);
  console.log(await wood.shot(page, 'judge-phone'));
  await page.evaluate(() => window.__splats.composed.judge.choose('A'));
  await page.waitForFunction(() => window.__splats.composed.judge.stage === 'shown', null, { timeout: 120000 });
  await page.waitForTimeout(800);
  console.log(await wood.shot(page, 'judge-phone2'), await page.evaluate(() => window.__splats.composed.judge.count));
}, { width: 390, height: 760 });
