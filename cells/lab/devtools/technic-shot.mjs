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
  for (const [name, q] of [['technic-gears', 'demo=gears'], ['technic-crank-run', 'auto&demo=crank'], ['technic-car-run', 'auto&demo=car'], ['technic-swing', 'demo=swing'], ['technic-preview', 'preview&demo=crank']]) {
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
  const page = await lab.open('demo=gears', { hasTouch: true });
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
  const before = (await lab.state(page)).pieces;
  // the piece in hand (beam 3, first in the tray) dragged from its corner onto an empty part of the board
  const corner = await page.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await drag(corner, [120, 330]);
  await frames();
  let s = await lab.state(page);
  c.ok('a beam dragged from its corner went on', s.pieces === before + 1, { before, after: s.pieces });
  c.ok('and is selected', s.selected >= 0 && s.sel && s.sel.kind === 'beam', s.sel);
  await lab.shot(page, 'technic-placed');
  // undo takes it back
  await page.click('#undo');
  await frames();
  s = await lab.state(page);
  c.ok('undo took it back', s.pieces === before, s.pieces);
  // a chip tapped is taken in hand
  const chip = await page.evaluate(() => { const b = document.querySelectorAll('#chips button')[11]; b.scrollIntoView(); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, b.textContent]; });
  await touch('touchStart', [[chip[0], chip[1]]]);
  await touch('touchEnd', []);
  await frames();
  s = await lab.state(page);
  c.ok(`a chip tapped is in hand (${chip[2]})`, s.hand === chip[2], s.hand);
  // run: it goes; stop: it's back
  await page.click('#run');
  await page.waitForTimeout(2500);
  s = await lab.state(page);
  c.ok('run: the motor turns the train', s.running && s.motion > 0.5, s.motion);
  await lab.shot(page, 'technic-running');
  await page.click('#run');
  await frames();
  s = await lab.state(page);
  c.ok('stop: back as built', !s.running && s.pieces === before, { running: s.running, pieces: s.pieces });
  c.ok('no errors in the page', page.errors.length === 0, page.errors);
});
c.done();
