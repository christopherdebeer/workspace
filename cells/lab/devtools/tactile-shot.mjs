/**
 * Look at Tactile in a phone-sized browser: the device mid-tutorial, a turn in progress, the
 * narrative entered, and the quiet preview. Shots go to devtools/out/tactile-*.png.
 *
 *   EXPERIMENT=tactile READY=__tactile node cells/lab/devtools/tactile-shot.mjs
 */
import { withWood } from './harness.mjs';

process.env.EXPERIMENT ??= 'tactile';
process.env.READY ??= '__tactile';

await withWood(async (lab) => {
  const until = async (page, test, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await page.evaluate(test)) return true; await page.waitForTimeout(250); }
    return false;
  };
  // first use: the tutorial asks for a clockwise turn; drag to give it one
  const page = await lab.open('tutorial=1', { dpr: 2 });
  await until(page, () => window.__tactile.state?.stage === 'faster');
  await lab.shot(page, 'tactile-tutorial');
  const box = await page.locator('#stage').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(cx + i * 6, cy); await page.waitForTimeout(30); }
  await page.waitForTimeout(700);
  await lab.shot(page, 'tactile-turning');
  const turned = await lab.state(page);
  await page.mouse.up();
  console.log(`turning: stage ${turned.state.stage}, rate ${turned.state.rate.toFixed(2)}, roll ${(turned.state.roll * 57.3).toFixed(1)}°, hint "${turned.frame.hint}"`);
  if (page.errors.length) console.log('errors:', page.errors);
  await page.close();

  // watched: the operator completes the tutorial and enters a word
  const auto = await lab.open('auto&tutorial=1', { dpr: 2 });
  const entered = await until(auto, () => window.__tactile.depth?.length > 1, 120000);
  await auto.waitForTimeout(600);
  await lab.shot(auto, 'tactile-entered');
  const s = await lab.state(auto);
  console.log(`auto: entered ${entered} depth ${s.depth.join(' › ')} word "${s.frame.word}" events ${s.events} at t=${s.t.toFixed(1)}s`);
  await auto.click('#tabs button[data-tab=measure]');
  await auto.waitForTimeout(400);
  await lab.shot(auto, 'tactile-measure');
  if (auto.errors.length) console.log('errors:', auto.errors);
  await auto.close();

  const pv = await lab.open('preview', { width: 360, height: 280, dpr: 1 });
  await pv.waitForTimeout(3000);
  await lab.shot(pv, 'tactile-preview');
  await pv.close();
});
