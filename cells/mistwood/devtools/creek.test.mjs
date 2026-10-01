/**
 * THE CREEK — you come to its edge and no further; a ford takes you over.
 *
 *   node cells/mistwood/devtools/creek.test.mjs
 *
 * 1. On its bank (`find=creek`), facing it, walking on: you never stand in its deep water (you are
 *    held at the edge, and slide along it), and the creek is heard (it is near).
 * 2. On the path before a ford (`find=ford`), walking on: you cross, on the stones, to the far side.
 * 3. Flying, the water does not hold you.
 */
import { withWood, checks } from './harness.mjs';

const c = checks();
const SEED = process.env.SEED ?? 'moss-ford-7';
await withWood(async (wood) => {
  const game = async (page, secs) => {
    const from = (await wood.state(page)).clock;
    await page.waitForFunction((t) => window.__mistwood.clock >= t, from + secs, { timeout: 900000, polling: 200 });
  };
  const depthHere = (page) => page.evaluate(() => { const [x, z] = window.__mistwood.at; return window.__wood().creekDepth(x, z); });

  // 1. the bank: held at the edge
  {
    const page = await wood.open(`seed=${SEED}&hour=11&find=creek`, { width: 200, height: 430 });
    await page.waitForTimeout(2000);
    const start = await wood.state(page);
    c.ok('find=creek stands you on the bank, out of the water', (await depthHere(page)) < 0.2, await depthHere(page));
    c.ok('… and the creek is heard near', start.creek !== null && start.creek < 12, start.creek);
    await page.keyboard.down('ArrowUp');
    let deepest = 0;
    const t0 = start.clock;
    while ((await wood.state(page)).clock < t0 + 14) {
      deepest = Math.max(deepest, await depthHere(page));
      await page.waitForTimeout(300);
    }
    await page.keyboard.up('ArrowUp');
    const end = await wood.state(page);
    const moved = Math.hypot(end.at[0] - start.at[0], end.at[1] - start.at[1]);
    c.ok('walking at it, you reach the edge (you moved)', moved > 3, { moved });
    c.ok('… and never stand in its deep water', deepest < 0.25, { deepest });
    c.ok('no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 2. the ford: across
  {
    const page = await wood.open(`seed=${SEED}&hour=11&find=ford`, { width: 200, height: 430 });
    await page.waitForTimeout(2000);
    const start = await wood.state(page);
    const ford = await page.evaluate(() => { const [x, z] = window.__mistwood.at; const f = window.__wood().fordsNear(x, z, 14); return f[0] ?? null; });
    c.ok('find=ford stands you before a ford', !!ford, start.at);
    if (ford) {
      const dir = [ford.x - start.at[0], ford.z - start.at[1]];
      const L = Math.hypot(dir[0], dir[1]);
      await page.keyboard.down('ArrowUp');
      let wettest = 0;
      let beyond = -L;
      const t0 = start.clock;
      while ((await wood.state(page)).clock < t0 + 22 && beyond < 4) {
        wettest = Math.max(wettest, await depthHere(page));
        const at = (await wood.state(page)).at;
        beyond = ((at[0] - ford.x) * dir[0] + (at[1] - ford.z) * dir[1]) / L;
        await page.waitForTimeout(300);
      }
      await page.keyboard.up('ArrowUp');
      c.ok('walking on, you cross the ford to the far side', beyond >= 4, { beyond });
      c.ok('… over shallows and stones (never deep)', wettest < 0.25, { wettest });
    }
    c.ok('no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 3. flying: over anything
  {
    const page = await wood.open(`seed=${SEED}&hour=11&find=creek&fly`, { width: 200, height: 430 });
    await page.waitForTimeout(2000);
    const start = await wood.state(page);
    await page.keyboard.down('ArrowUp');
    await game(page, 6);
    await page.keyboard.up('ArrowUp');
    const end = await wood.state(page);
    c.ok('flying, the creek does not hold you', Math.hypot(end.at[0] - start.at[0], end.at[1] - start.at[1]) > 12, { from: start.at, to: end.at });
    await page.close();
  }
});
c.done();
