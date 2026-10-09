/**
 * Technic in the browser: the demos drawn, a piece dragged from the tray onto the board, a run.
 *
 *   node cells/lab/devtools/technic-shot.mjs            screenshots of the demos to devtools/out/
 *   node cells/lab/devtools/technic-shot.mjs --test     and the hands: drag, select, run, the hub
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'technic';
process.env.READY = '__technic';

const test = process.argv.includes('--test');
const c = checks();
await withWood(async (lab) => {
  for (const [name, q] of [['technic-gears', 'demo=gears'], ['technic-crank-run', 'auto&demo=crank'], ['technic-car-run', 'auto&demo=car'], ['technic-marble-run', 'auto&demo=marble'], ['technic-swing', 'demo=swing'], ['technic-preview', 'preview&demo=crank']]) {
    const page = await lab.open(q, name.includes('preview') ? { width: 300, height: 375 } : {});
    await page.waitForTimeout(name.includes('run') ? 3500 : 800);
    const s = await lab.state(page);
    console.log(name, JSON.stringify({ pieces: s.pieces, running: s.running, motion: Number(s.motion.toFixed(2)) }), await lab.shot(page, name));
    c.ok(`${name}: no errors`, page.errors.length === 0, page.errors);
    c.ok(`${name}: pieces`, s.pieces > 5, s.pieces);
    if (name.includes('run')) c.ok(`${name}: it moves`, s.running && s.motion > 0.05, s.motion);
    await page.close();
  }
  if (!test) return;
  const page = await lab.open('', { hasTouch: true });
  await page.waitForTimeout(600);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const drag = async (from, to, steps = 12) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) await touch('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
    await page.waitForTimeout(100);
    await touch('touchEnd', []);
    await page.waitForTimeout(200);
  };
  // (what the page reports is refreshed each frame: wait for one after each thing done)
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tap = async (sel) => {
    const at = await page.evaluate((sel) => { const el = document.querySelector(sel); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
    await touch('touchStart', [at]);
    await touch('touchEnd', []);
    await page.waitForTimeout(150);
    await frames();
  };
  // the start screen: nothing yet; start from the gear train
  let s = await lab.state(page);
  c.ok('the start screen opens first', s.start && s.builds.length === 0, { start: s.start, builds: s.builds });
  await lab.shot(page, 'technic-start');
  await page.click('.starter[data-from="gears"]');
  await frames();
  s = await lab.state(page);
  c.ok('a starter opens as a new build', !s.start && s.pieces === 12 && s.builds.length === 1 && s.current === s.builds[0].id, { start: s.start, pieces: s.pieces, builds: s.builds });
  const before = s.pieces;
  // the drawer: open it, take a ramp
  await page.click('#pieces');
  await page.waitForTimeout(400);
  await frames();
  s = await lab.state(page);
  c.ok('the drawer opens', s.drawer, s.drawer);
  await lab.shot(page, 'technic-drawer');
  await tap('.tile[data-i="10"]');
  s = await lab.state(page);
  c.ok('a tile tapped is in hand, and the drawer closes', !s.drawer && s.hand === 'ramp 8·6', { drawer: s.drawer, hand: s.hand });
  // the piece in hand dragged from its corner onto an empty part of the board
  const corner = await page.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await drag(corner, [60, 300]);
  await frames();
  s = await lab.state(page);
  c.ok('a ramp dragged from its corner went on', s.pieces === before + 1, { before, after: s.pieces });
  c.ok('and is selected', s.selected >= 0 && s.sel && s.sel.kind === 'ramp', s.sel);
  c.ok('and the build is kept', s.builds[0].pieces === before + 1, s.builds);
  await lab.shot(page, 'technic-placed');
  // undo takes it back
  await page.click('#undo');
  await frames();
  s = await lab.state(page);
  c.ok('undo took it back', s.pieces === before, s.pieces);
  // a ball from the drawer, dragged straight out of it onto the board
  await page.click('#pieces');
  await page.waitForTimeout(400);
  await frames();
  const ballTile = await page.evaluate(() => { const el = document.querySelector('.tile[data-i="25"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  // (sideways first: up and down the drawer scrolls it)
  await touch('touchStart', [ballTile]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [[ballTile[0] + i * 8, ballTile[1]]]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[ballTile[0] + 48 + ((300 - ballTile[0] - 48) * i) / 12, ballTile[1] + ((300 - ballTile[1]) * i) / 12]]);
  await page.waitForTimeout(100);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  await frames();
  s = await lab.state(page);
  c.ok('a ball dragged out of the drawer went on', s.pieces === before + 1 && s.sel && s.sel.kind === 'ball' && !s.drawer, { pieces: s.pieces, sel: s.sel, drawer: s.drawer });
  await page.click('#undo');
  await frames();
  // run: it goes; stop: it's back
  await page.click('#run');
  await page.waitForTimeout(2500);
  await frames();
  s = await lab.state(page);
  c.ok('run: the motor turns the train', s.running && s.motion > 0.5, s.motion);
  await lab.shot(page, 'technic-running');
  await page.click('#run');
  await frames();
  s = await lab.state(page);
  c.ok('stop: back as built', !s.running && s.pieces === before, { running: s.running, pieces: s.pieces });
  // the start screen again: the build is there; a second starter makes a second build
  await page.click('#builds');
  await frames();
  s = await lab.state(page);
  c.ok('builds shows the start screen with the build', s.start && s.builds.length === 1 && s.builds[0].pieces === before, s.builds);
  await page.click('.starter[data-from="marble"]');
  await frames();
  s = await lab.state(page);
  c.ok('a second build, the marble run, is current', s.builds.length === 2 && s.current === s.builds[0].id && s.pieces > 10, { builds: s.builds, pieces: s.pieces });
  await page.reload();
  await page.waitForFunction(() => window.__technic, null, { timeout: 600000 });
  await frames();
  s = await lab.state(page);
  c.ok('after a reload both builds are there, the marble run current', s.builds.length === 2 && s.current === s.builds[0].id, s.builds);
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
});
c.done();
