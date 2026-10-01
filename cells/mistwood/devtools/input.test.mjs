/**
 * WHERE YOU TOUCH SAYS WHAT YOU MEAN — real touches (Chrome's touch emulation), not clicks.
 *
 *   node cells/mistwood/devtools/input.test.mjs
 *
 * 1. A touch on the ground (below the horizon) walks, at once; held right of the middle, it
 *    keeps bearing right (a tiller), held in the middle, straight on.
 * 2. A touch on the sky (above it) does not walk; dragging it across turns you, up tilts.
 * 3. Letting go, the tilt eases back level (not at once).
 * 4. Two fingers spreading look closer; letting go eases back out.
 */
import { withWood, checks } from './harness.mjs';

const c = checks();
await withWood(async (wood) => {
  const page = await wood.open('seed=moss-ford-7&fixed&hour=11&time=5', { hasTouch: true });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const s = () => wood.state(page);
  const wait = (ms) => page.waitForTimeout(ms);
  // (headless frames are slow and the clock is capped per frame: wait in game seconds)
  const game = async (secs) => {
    const from = (await s()).clock;
    await page.waitForFunction((t) => window.__mistwood.clock >= t, from + secs, { timeout: 600000, polling: 200 });
  };
  const W = 390;
  const H = 844;

  // 1. the ground: walking, at once
  await touch('touchStart', [[W / 2, H * 0.85]]);
  await page.waitForFunction(() => window.__mistwood.pace > 0.05, null, { timeout: 30000 }).catch(() => {});
  c.ok('a touch on the ground walks', (await s()).pace > 0.05, await s());
  const straight = (await s()).heading;
  await game(1.5);
  c.ok('… held in the middle, straight on', Math.abs((await s()).heading - straight) <= 1, { from: straight, to: (await s()).heading });
  await touch('touchEnd', []);
  await game(3);
  // held right of the middle, without moving: it keeps bearing right
  await touch('touchStart', [[W * 0.9, H * 0.85]]);
  const h1 = (await s()).heading;
  await game(2);
  const h2 = (await s()).heading;
  await game(2);
  const h3 = (await s()).heading;
  const turn = (a, b) => ((b - a + 540) % 360) - 180;
  c.ok('… held right of the middle, it keeps bearing right', turn(h1, h2) > 5 && turn(h2, h3) > 5, { h1, h2, h3 });
  await touch('touchEnd', []);
  await game(5);

  // 2. the sky: no walking; across turns, up tilts
  const h0 = (await s()).heading;
  await touch('touchStart', [[W / 2, H * 0.15]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[W / 2 - i * 12, H * 0.15 + i * 14]]);
  await game(1.5);
  const looking = await s();
  c.ok('a touch on the sky does not walk', looking.pace < 0.05, looking);
  c.ok('… dragging it across turns you', Math.abs(((looking.heading - h0 + 540) % 360) - 180) > 5, { from: h0, to: looking.heading });
  c.ok('… and down tilts the view up', looking.pitch > 0.1, looking.pitch);
  // 3. let go: it eases back, not at once
  await touch('touchEnd', []);
  await game(0.4);
  const easing = (await s()).pitch;
  c.ok('letting go, the tilt eases back (still on its way)', easing > 0.02 && easing < looking.pitch, { held: looking.pitch, after: easing });
  await game(5);
  c.ok('… and comes level', Math.abs((await s()).pitch) < 0.01, (await s()).pitch);

  // 4. two fingers: closer, then back out
  await touch('touchStart', [[W / 2 - 30, H / 2], [W / 2 + 30, H / 2]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[W / 2 - 30 - i * 15, H / 2], [W / 2 + 30 + i * 15, H / 2]]);
  await game(1);
  const z = (await s()).zoom;
  c.ok('two fingers spreading look closer', z > 1.8, z);
  await touch('touchEnd', []);
  await game(5);
  c.ok('… and letting go eases back out', (await s()).zoom < 1.05, (await s()).zoom);
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
});
c.done();
