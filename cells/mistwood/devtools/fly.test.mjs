/**
 * FLYING (dev, ?fly) — twin sticks, real touches.
 *
 *   node cells/mistwood/devtools/fly.test.mjs
 *
 * 1. The left thumb pushed up moves you on, the way you look — without touching the ground.
 * 2. The right thumb dragged down tilts you up, and the tilt stays when let go.
 * 3. Then the stick pushed on climbs (you fly the way you look).
 */
import { withWood, checks } from './harness.mjs';

const c = checks();
await withWood(async (wood) => {
  const page = await wood.open('seed=moss-ford-7&fixed&hour=11&time=5&fly', { hasTouch: true, width: 390, height: 844 });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const s = () => wood.state(page);
  const game = async (secs) => {
    const from = (await s()).clock;
    await page.waitForFunction((t) => window.__mistwood.clock >= t, from + secs, { timeout: 600000, polling: 200 });
  };
  const eyeOf = () => page.evaluate(() => window.__wood && window.__mistwood.eye);
  const a0 = (await s()).at;
  // 1. left stick, pushed up (high on the screen: it would be "sky" when walking)
  await touch('touchStart', [[100, 200]]);
  await touch('touchMove', [[100, 140]]);
  await game(2);
  await touch('touchEnd', []);
  const a1 = (await s()).at;
  c.ok('the left stick pushed on moves you (from anywhere on its half)', Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) > 3, { from: a0, to: a1 });
  // 2. right thumb dragged down: tilt up, and it stays
  await touch('touchStart', [[300, 600]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[300, 600 + i * 25]]);
  await game(1);
  await touch('touchEnd', []);
  await game(2);
  const p = (await s()).pitch;
  c.ok('the right thumb tilts the view, and the tilt stays when let go', p > 0.3, p);
  // 3. on again: up
  const e0 = await eyeOf();
  await touch('touchStart', [[100, 400]]);
  await touch('touchMove', [[100, 330]]);
  await game(2);
  await touch('touchEnd', []);
  const e1 = await eyeOf();
  c.ok('pushed on, tilted up, you climb', e1 - e0 > 3, { from: e0, to: e1 });
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
});
c.done();
