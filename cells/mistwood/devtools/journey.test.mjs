/**
 * THE JOURNEY IN THE ADDRESS — kept as you walk, resumed on reload, changed without one.
 *
 *   node cells/mistwood/devtools/journey.test.mjs
 *
 * 1. Walking (?walk=1) writes x, y and heading into the address.
 * 2. Reloading that address stands you exactly there.
 * 3. In the same page, setting x, y, heading moves you at once (no reload), and the view settles.
 * 4. Setting the seed in the same page makes another wood.
 */
import { withWood, checks } from './harness.mjs';

const c = checks();
await withWood(async (wood) => {
  const page = await wood.open('seed=moss-ford-7&fixed&hour=11&walk=1');
  // (the headless clock is slow: wait until the walk has shown in the address)
  await page.waitForFunction(() => new URL(location.href).searchParams.has('x') && window.__mistwood.walked > 0.2, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const url = new URL(page.url());
  const s1 = await wood.state(page);
  c.ok('walking writes x, y, heading into the address', ['x', 'y', 'heading'].every((k) => url.searchParams.has(k)), url.search);
  const x = Number(url.searchParams.get('x'));
  const y = Number(url.searchParams.get('y'));
  c.ok('the address is where you are (within a step)', Math.hypot(x - s1.at[0], y - s1.at[1]) < 1.5, { url: [x, y], at: s1.at });

  url.searchParams.delete('walk');
  const back = await wood.open(url.search.slice(1));
  const s2 = await wood.state(back);
  c.ok('a reload goes on from there', Math.hypot(s2.at[0] - x, s2.at[1] - y) < 0.11 && s2.heading === Number(url.searchParams.get('heading')), { at: s2.at, heading: s2.heading, url: url.search });

  const reloads = [];
  back.on('framenavigated', (f) => f === back.mainFrame() && reloads.push(f.url()));
  await wood.go(back, { x: 120, y: -40, heading: 90 });
  await back.waitForTimeout(800);
  const s3 = await wood.state(back);
  c.ok('setting x, y, heading moves you there now', s3.at[0] === 120 && s3.at[1] === -40 && s3.heading === 90, s3);
  c.ok('… without reloading the page', reloads.length === 0, reloads);
  c.ok('… and the view settles', await wood.settle(back));
  await wood.shot(back, 'journey-there');

  await wood.go(back, { seed: 'fern-hollow-3' });
  await back.waitForFunction(() => window.__mistwood.seed === 'fern-hollow-3', null, { timeout: 60000 });
  c.ok('setting the seed makes another wood, still without a reload', reloads.length === 0, reloads);
  c.ok('… and it settles', await wood.settle(back));
  await wood.shot(back, 'journey-other-wood');
  c.ok('no errors in the page', back.errors.length === 0 && page.errors.length === 0, [...page.errors, ...back.errors]);
});
c.done();
