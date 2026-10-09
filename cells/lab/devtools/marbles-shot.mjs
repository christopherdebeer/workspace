/**
 * Marble Run in the browser: the race drawn as it runs, build mode with its three on offer.
 *
 *   node cells/lab/devtools/marbles-shot.mjs            screenshots to devtools/out/
 *   node cells/lab/devtools/marbles-shot.mjs --test     and the hands: build, add, undo, follow
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'marbles';
process.env.READY = '__marbles';

const test = process.argv.includes('--test');
const c = checks();
await withWood(async (lab) => {
  const page = await lab.open('seed=21&run=0.1.2.0.1.2.0');
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // (software frames are slow and the race runs in fixed steps per frame: wait on race time, not the clock)
  const until = (t) => page.waitForFunction((t) => window.__marbles.raceTime >= t || !window.__marbles.racing, t, { timeout: 600000, polling: 200 });
  await until(1.0);
  let s = await lab.state(page);
  console.log('start', JSON.stringify({ sections: s.sections, me: s.me, order: s.order.slice(0, 3) }), await lab.shot(page, 'marbles-start'));
  c.ok('no errors', page.errors.length === 0, page.errors);
  c.ok('seven sections from the address', s.sections === 7 && s.seed === 21, { sections: s.sections, seed: s.seed });
  await until(4.0);
  s = await lab.state(page);
  console.log('4 s', JSON.stringify({ order: s.order.slice(0, 3), eye: s.eye }), await lab.shot(page, 'marbles-race'));
  c.ok('the marbles are on their way', s.order[0].progress > 100 && s.order[0].speed > 50, s.order[0]);
  await until(9.0);
  s = await lab.state(page);
  console.log('9 s', JSON.stringify({ order: s.order.slice(0, 3) }), await lab.shot(page, 'marbles-race-2'));
  if (!test) return;
  // build: three on offer; add one; the run is longer and the address says so
  await page.click('#build');
  await page.waitForTimeout(1500);
  await frames();
  s = await lab.state(page);
  c.ok('build mode offers three', s.view === 'build' && s.offered.length === 3 && s.chosen === 0, { view: s.view, offered: s.offered });
  await lab.shot(page, 'marbles-build');
  await page.click('.offer[data-i="2"]');
  await frames();
  s = await lab.state(page);
  c.ok('the third chosen', s.chosen === 2, s.chosen);
  await page.click('#add');
  await frames();
  s = await lab.state(page);
  c.ok('added: eight sections, the choice recorded', s.sections === 8 && s.choices[7] === 2 && s.offered.length === 3, { sections: s.sections, choices: s.choices });
  c.ok('the address carries the run', /run=0\.1\.2\.0\.1\.2\.0\.2/.test(await page.evaluate(() => location.search)), await page.evaluate(() => location.search));
  await page.click('#more');
  await frames();
  s = await lab.state(page);
  c.ok('three more are other ones', s.offered.length === 3, s.offered);
  await page.click('#undo');
  await frames();
  s = await lab.state(page);
  c.ok('the last taken off', s.sections === 7, s.sections);
  // race from the end, following the leader
  await page.click('#here');
  await page.click('#follow');
  await until(1.5);
  s = await lab.state(page);
  c.ok('from the end: raced, following the leader', s.view === 'race' && s.raceTime > 0 && s.me === s.order[0].name, { racing: s.racing, raceTime: s.raceTime, me: s.me, lead: s.order[0].name });
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
  // the index's preview
  const pv = await lab.open('preview', { width: 300, height: 375 });
  await pv.waitForFunction(() => window.__marbles.raceTime >= 3, null, { timeout: 600000, polling: 200 });
  console.log('preview', await lab.shot(pv, 'marbles-preview'));
  c.ok('preview: no errors', pv.errors.length === 0, pv.errors);
});
c.done();
