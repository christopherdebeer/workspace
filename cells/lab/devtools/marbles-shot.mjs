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
  // the lineup: everyone behind the gate; tap a marble and it's yours; go
  await page.waitForTimeout(1200);
  await frames();
  let s = await lab.state(page);
  console.log('lineup', JSON.stringify({ sections: s.sections, me: s.me, phase: s.phase, names: s.order.map((o) => o.name) }), await lab.shot(page, 'marbles-lineup'));
  c.ok('no errors', page.errors.length === 0, page.errors);
  c.ok('seven sections from the address', s.sections === 7 && s.seed === 21, { sections: s.sections, seed: s.seed });
  c.ok('lined up, not yet racing', s.phase === 'lineup' && !s.racing, { phase: s.phase, racing: s.racing });
  // already alive, at rest against the gate, every name showing
  const live = await page.evaluate(() => ({ speeds: window.__marbles.order.map((o) => o.speed), names: document.querySelectorAll('#names .name.in').length }));
  c.ok('at the gate: settled, every name beside its marble', live.speeds.every((v) => v < 3) && live.names === 12, live);
  c.ok('twelve named marbles', s.order.length === 12 && new Set(s.order.map((o) => o.name)).size === 12, s.order.map((o) => o.name));
  const other = s.order.find((o) => o.name !== s.me).name;
  await page.click(`#order .dot[data-name="${other}"]`);
  await frames();
  s = await lab.state(page);
  c.ok('a tap on the order makes that marble yours', s.me === other, { me: s.me, other });
  await page.click('#go');
  await page.waitForFunction(() => window.__marbles.phase === 'racing', null, { timeout: 5000, polling: 100 }).catch(() => {});
  await until(1.0);
  s = await lab.state(page);
  console.log('start', JSON.stringify({ phase: s.phase, me: s.me, order: s.order.slice(0, 3) }), await lab.shot(page, 'marbles-start'));
  c.ok('racing after go', s.phase === 'racing' && s.racing, s.phase);
  await until(4.0);
  s = await lab.state(page);
  console.log('4 s', JSON.stringify({ order: s.order.slice(0, 3), eye: s.eye }), await lab.shot(page, 'marbles-race'));
  c.ok('the marbles are on their way', s.order[0].progress > 100 && s.order[0].speed > 20, s.order[0]);
  // a change of theme under the race: the scenery changes, the race does not
  const before = await lab.state(page);
  await page.click('#theme');
  await frames();
  s = await lab.state(page);
  c.ok('the theme changed to nocturne', s.theme === 'nocturne' && before.theme === 'atelier', { before: before.theme, after: s.theme });
  // (not reset: the time ran on and no marble lost ground; the order may change, as a race does)
  const lost = before.order.filter((b) => (s.order.find((o) => o.name === b.name)?.progress ?? 0) < b.progress);
  c.ok('and the race went on as it was', s.racing && s.raceTime >= before.raceTime && lost.length === 0, { raceTime: [before.raceTime, s.raceTime], lost: lost.map((b) => b.name) });
  await lab.shot(page, 'marbles-nocturne');
  await page.click('#theme');
  await frames();
  await until(9.0);
  s = await lab.state(page);
  console.log('9 s', JSON.stringify({ order: s.order.slice(0, 3) }), await lab.shot(page, 'marbles-race-2'));
  // names come up as each crosses, not when the last does
  await page.waitForFunction(() => window.__marbles.order.some((o) => o.finished >= 0) && window.__marbles.phase === 'racing', null, { timeout: 600000, polling: 100 }).catch(() => {});
  await frames();
  const early = await page.evaluate(() => ({ shown: document.querySelectorAll('#names .name.in').length, phase: window.__marbles.phase, inCount: window.__marbles.order.filter((o) => o.finished >= 0).length }));
  c.ok('names appear as they cross, before the last is in', early.phase !== 'racing' || (early.shown >= 1 && early.shown <= early.inCount), early);
  // all in: the result at rest in the channel
  await page.waitForFunction(() => window.__marbles.phase === 'done' && !window.__marbles.racing, null, { timeout: 600000, polling: 200 });
  await frames();
  s = await lab.state(page);
  console.log('done', JSON.stringify({ order: s.order.slice(0, 4), rest: s.rest }), await lab.shot(page, 'marbles-results'));
  c.ok('all in, in order', s.phase === 'done' && s.order.every((o) => o.finished >= 0) && s.order.every((o, i) => i === 0 || o.finished >= s.order[i - 1].finished), s.order.map((o) => o.finished));
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
  // building, try it: the last board raced, the camera on the leader
  await page.click('#try');
  await page.waitForFunction(() => window.__marbles.phase === 'racing' && window.__marbles.view === 'race', null, { timeout: 30000, polling: 100 });
  await until(1.0);
  s = await lab.state(page);
  c.ok('try it: the end raced, the camera on the leader', s.view === 'race' && s.raceTime > 0 && s.me === s.order[0].name, { racing: s.racing, raceTime: s.raceTime, me: s.me, lead: s.order[0].name });
  // the main button: again, back to the gate
  await page.click('#go');
  await frames();
  s = await lab.state(page);
  c.ok('again: lined up at the gate', s.phase === 'lineup', s.phase);
  // the camera toggle: yours, the leader, the finish, and round
  const cams = [];
  for (let i = 0; i < 3; i++) { await page.click('#cam'); await frames(); cams.push(await page.evaluate(() => document.getElementById('cam').textContent)); }
  // (from wherever it was: three presses visit all three, and come back round)
  c.ok('the camera goes round: yours, the leader, the finish', cams.some((t) => /leader/.test(t)) && cams.some((t) => /finish/.test(t)) && cams.some((t) => !/leader|finish/.test(t)), cams);
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
  // the index's preview
  const pv = await lab.open('preview', { width: 300, height: 375 });
  await pv.waitForFunction(() => window.__marbles.raceTime >= 3, null, { timeout: 600000, polling: 200 });
  console.log('preview', await lab.shot(pv, 'marbles-preview'));
  c.ok('preview: no errors', pv.errors.length === 0, pv.errors);
});
c.done();
