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
  // a mission: it opens with its ask, the drawer offers its pieces only
  await page.click('.mission[data-mission="turn"]');
  await frames();
  s = await lab.state(page);
  c.ok('a mission opens', !s.start && s.mission === 'turn' && s.pieces > 5 && /big gear/.test(s.why), { mission: s.mission, why: s.why });
  await page.click('#pieces');
  await page.waitForTimeout(400);
  const later = await page.evaluate(() => [document.querySelectorAll('.tile.later').length, document.querySelectorAll('.tile').length]);
  c.ok('the drawer keeps the rest for later', later[0] > 10 && later[0] < later[1], later);
  await lab.shot(page, 'technic-mission-drawer');
  // the 24 tapped, then dragged from its corner between the 8 and the 40: it snaps to mesh
  await tap('.tile[data-i="10"]');
  s = await lab.state(page);
  c.ok('gear 24 in hand', s.hand === 'gear 24', s.hand);
  const corner0 = await page.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  // (where the gap is on screen: ask the page for the 8's and 40's screen places via a probe)
  // (the view leans back as a piece is carried: start the drag, let it settle, then find the gap)
  await touch('touchStart', [corner0]);
  for (let i = 1; i <= 4; i++) await touch('touchMove', [[corner0[0] - i * 10, corner0[1] + i * 10]]);
  await page.waitForTimeout(900);
  await frames();
  const gap = await page.evaluate(() => window.__technic.probe ? window.__technic.probe(15, 8, 0) : null);
  if (gap) {
    const from = [corner0[0] - 40, corner0[1] + 40];
    for (let i = 1; i <= 14; i++) await touch('touchMove', [[from[0] + ((gap[0] - from[0]) * i) / 14, from[1] + ((gap[1] + 44 - from[1]) * i) / 14]]);
    await frames();
    s = await lab.state(page);
    c.ok('carried near the 8 and the 40, it meshes (the caption says so)', /meshes/.test(s.why), s.why);
    await lab.shot(page, 'technic-meshing');
    await touch('touchEnd', []);
    await page.waitForTimeout(200);
    await frames();
    s = await lab.state(page);
    c.ok('dropped, it went on with its axle', s.sel && s.sel.kind === 'gear' && s.sel.n === 24, s.sel);
    console.log('  the build now:', JSON.stringify(s.list.filter(Boolean).map((p) => `${p.kind}${p.n}@${p.at}/${p.z}`)));
    await page.click('#run');
    // (a whole turn of the big gear: a few seconds of machine time, longer in software frames)
    await page.waitForFunction(() => window.__technic.goalDone, null, { timeout: 120000 }).catch(() => {});
    await frames();
    s = await lab.state(page);
    c.ok('run: the big gear turns and the mission is done', s.goalDone, { goalDone: s.goalDone, why: s.why });
    await lab.shot(page, 'technic-mission-done');
    await page.click('#run');
    await frames();
  } else c.ok('a probe to find the gap', false, gap);
  await page.click('#builds');
  await frames();

  await page.click('.starter[data-from="gears"]');
  await frames();
  s = await lab.state(page);
  c.ok('a starter opens as a new build', !s.start && s.mission === null && s.pieces === 12 && s.builds.length === 1 && s.current === s.builds[0].id, { start: s.start, pieces: s.pieces, builds: s.builds });
  const before = s.pieces;
  // the drawer: open it, take a ramp
  await page.click('#pieces');
  await page.waitForTimeout(400);
  await frames();
  s = await lab.state(page);
  c.ok('the drawer opens', s.drawer, s.drawer);
  await lab.shot(page, 'technic-drawer');
  await tap('.tile[data-i="22"]');
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
  // a ramp carried off the board: red, and said; let go, it goes back to the tray
  const corner2 = await page.evaluate(() => { const r = document.getElementById('next').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await touch('touchStart', [corner2]);
  for (let i = 1; i <= 12; i++) await touch('touchMove', [[corner2[0] + ((40 - corner2[0]) * i) / 12, corner2[1] + ((640 - corner2[1]) * i) / 12]]);
  await frames();
  s = await lab.state(page);
  c.ok('off the board: the ghost is blocked and the caption says why', s.blocked && /board|way|room/.test(s.why), { blocked: s.blocked, why: s.why });
  await lab.shot(page, 'technic-blocked');
  await touch('touchEnd', []);
  await page.waitForTimeout(200);
  await frames();
  s = await lab.state(page);
  c.ok('let go nowhere: nothing added, and it says so', s.pieces === before + 1 && /back to the tray/.test(s.why), { pieces: s.pieces, why: s.why });
  // undo takes it back
  await page.click('#undo');
  await frames();
  s = await lab.state(page);
  c.ok('undo took it back', s.pieces === before, s.pieces);
  // a ball from the drawer, dragged straight out of it onto the board
  await page.click('#pieces');
  await page.waitForTimeout(400);
  await frames();
  await page.evaluate(() => document.querySelector('.tile[data-i="19"]').scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const ballTile = await page.evaluate(() => { const r = document.querySelector('.tile[data-i="19"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
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
