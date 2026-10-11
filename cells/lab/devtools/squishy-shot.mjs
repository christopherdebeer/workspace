/**
 * Squishy in the browser: the dumpling at rest, wound up with the aiming line, in the air,
 * landed on the next top; a close look; and the index's preview, playing itself.
 *
 *   node cells/lab/devtools/squishy-shot.mjs            screenshots to devtools/out/
 *   node cells/lab/devtools/squishy-shot.mjs --test     and the checks
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'squishy';
process.env.READY = '__squishy';

const test = process.argv.includes('--test');
const c = checks();
await withWood(async (lab) => {
  const page = await lab.open('level=2', { width: 390, height: 844, hasTouch: false });
  page.on('console', (m) => m.type() === 'warning' && page.errors.push(m.text()));
  const st = () => lab.state(page);
  const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(2500);
  await frames();
  let s = await st();
  console.log('rest', JSON.stringify(s), await lab.shot(page, 'squishy-rest'));
  c.ok('no errors', page.errors.filter((e) => !e.includes('404')).length === 0, page.errors);
  c.ok('at rest on the start, its volume kept', s.check === 0 && s.speed < 5 && s.canFlick && Math.abs(s.volume - 1) < 0.03, s);
  // a drag off the dumpling turns the camera, and doesn't flick it
  const where = () => page.evaluate(() => window.__squishyAt());
  let w = await where();
  const yaw0 = w.camYaw;
  await page.mouse.move(60, 140);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(60 + i * 12, 140);
  await page.mouse.up();
  await frames();
  w = await where();
  s = await st();
  c.ok('a drag off it turns the camera, and leaves it be', Math.abs(w.camYaw - yaw0) > 0.3 && s.contacts > 0 && s.speed < 10, { yaw0, w, s });
  // a tap on it pokes it
  w = await where();
  await page.mouse.click(w.at[0], w.at[1] - 6);
  await page.waitForTimeout(400);
  await frames();
  s = await st();
  c.ok('a tap on it pokes it: a dent, a wobble', s.deform > 0.05 || s.speed > 5, s);
  await page.waitForFunction(() => window.__squishy.speed < 3 && window.__squishy.contacts > 0, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(600);
  await frames();
  // take hold of it and pull back toward the bottom of the screen: it should stretch and wind up, and the line show it landing ahead
  w = await where();
  await page.mouse.move(w.at[0], w.at[1] - 4);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(w.at[0], w.at[1] - 4 + i * 11);
  await page.waitForTimeout(600);
  await frames();
  s = await st();
  const held = (await where()).grabbed;
  console.log('aim', JSON.stringify({ aiming: s.aiming, power: s.power, squeeze: s.squeeze, deform: s.deform, held }), await lab.shot(page, 'squishy-aim'));
  c.ok('taking hold and pulling back stretches it and winds it up', held && s.aiming && s.squeeze && s.power > 0.1, s);
  await page.mouse.up();
  await page.waitForFunction(() => window.__squishy.contacts === 0, null, { timeout: 20000, polling: 30 });
  await page.waitForTimeout(150);
  s = await st();
  console.log('air', JSON.stringify({ com: s.com, speed: s.speed }), await lab.shot(page, 'squishy-air'));
  c.ok('flicked: off and flying', s.contacts === 0 && s.speed > 50, s);
  await page.waitForFunction(() => window.__squishy.contacts > 0 && window.__squishy.speed < 10, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(800);
  s = await st();
  console.log('landed', JSON.stringify(s), await lab.shot(page, 'squishy-landed'));
  c.ok('it came down somewhere and kept its volume', Math.abs(s.volume - 1) < 0.05, s);
  // a close look
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -500);
  await page.waitForTimeout(1500);
  console.log(await lab.shot(page, 'squishy-close'));
  if (!test) return;
  // the autopilot plays a level home
  const pv = await lab.open('auto&level=1', { width: 390, height: 844 });
  await pv.waitForFunction(() => window.__squishy.home >= 0, null, { timeout: 600000, polling: 500 });
  const h = await lab.state(pv);
  console.log('auto', JSON.stringify(h), await lab.shot(pv, 'squishy-home'));
  c.ok('the autopilot gets home', h.home > 0 && h.falls === 0, h);
  // a wall: however the camera's turned toward it, by mistake or on purpose, it stays this side of it
  const wl = await lab.open('level=3', { width: 390, height: 844 });
  await wl.waitForTimeout(3000);
  for (let i = 0; i < 4; i++) await wl.mouse.wheel(0, 500);
  let worst = -1e9;
  for (let round = 0; round < 3; round++) {
    await wl.mouse.move(40, 400); await wl.mouse.down();
    for (let i = 1; i <= 20; i++) await wl.mouse.move(40 + i * 15, 400 - i * 4);
    await wl.mouse.up();
    for (let w = 0; w < 6; w++) { await wl.waitForTimeout(300); worst = Math.max(worst, (await lab.state(wl)).eye[2]); }
  }
  c.ok('turned hard toward the wall, the camera stays this side of it', worst < 64, { worst });
  await wl.close();
  // the title: with nothing asked for, the name and what to do; New Game starts the first place
  const ti = await lab.open('', { width: 390, height: 844 });
  await ti.waitForTimeout(3000);
  let t = await lab.state(ti);
  console.log('title', await lab.shot(ti, 'squishy-title'));
  c.ok('the title, with the two of them on it', t.mode === 'title' && (await ti.evaluate(() => document.body.classList.contains('title') && !!document.querySelector('#logo svg'))), t);
  // (the two of them to play with: take hold of one and pull, and it stretches after the finger, staying where it sits; a tap pokes it)
  await ti.waitForFunction(() => window.__squishyAt().title.length === 2, null, { timeout: 30000, polling: 250 });
  // (the camera comes in to its place: until the two are still on the glass)
  await ti.waitForFunction(() => { const w = window.__squishyAt().title[0].at, l = window.__lastAt ?? w; window.__lastAt = w; return Math.hypot(w[0] - l[0], w[1] - l[1]) < 0.5 && w !== l; }, null, { timeout: 60000, polling: 400 }).catch(() => {});
  const seat = (await ti.evaluate(() => window.__squishyAt())).title;
  const reach0 = seat[0].reach;
  await ti.mouse.move(seat[0].top[0], seat[0].top[1]);
  await ti.mouse.down();
  for (let i = 1; i <= 10; i++) await ti.mouse.move(seat[0].top[0] + i * 6, seat[0].top[1] - i * 12);
  await ti.waitForFunction((r) => window.__squishyAt().title[0].reach > r + 1.5, reach0, { timeout: 60000, polling: 100 }).catch(() => {});
  let tt = (await ti.evaluate(() => window.__squishyAt())).title;
  console.log('title stretch', JSON.stringify(tt), await lab.shot(ti, 'squishy-title-stretch'));
  c.ok('on the title, held and pulled: drawn out after the finger, where it sits', tt[0].held && tt[0].reach > reach0 + 1.5 && tt[0].moved < 2, { reach0, tt });
  await ti.mouse.up();
  await ti.waitForFunction((r) => window.__squishyAt().title[0].reach < r + 0.8 && window.__squishyAt().title[0].moved < 1, reach0, { timeout: 60000, polling: 100 }).catch(() => {});
  tt = (await ti.evaluate(() => window.__squishyAt())).title;
  c.ok('let go, it comes back, and stays put', !tt[0].held && tt[0].reach < reach0 + 0.8 && tt[0].moved < 1.5, { reach0, tt });
  const was = tt[1];
  await ti.mouse.click(was.at[0], was.at[1]);
  await ti.waitForFunction((d0) => window.__squishyAt().title[1].peak > d0 + 30, was.peak, { timeout: 30000, polling: 30 }).catch(() => {});
  tt = (await ti.evaluate(() => window.__squishyAt())).title;
  c.ok('a tap pokes the other: it jiggles, and doesn\'t roll off', tt[1].peak > was.peak + 30 && tt[1].moved < 1.5, { was, tt });
  t = await lab.state(ti);
  c.ok('still the title', t.mode === 'title', t);
  await ti.click('#new');
  // (its state is written each frame, and frames are slow without a graphics card: waited for)
  await ti.waitForFunction(() => window.__squishy.mode === 'play', null, { timeout: 60000, polling: 250 });
  t = await lab.state(ti);
  c.ok('New Game: the first level, the title gone', t.mode === 'play' && t.level === 1 && !(await ti.evaluate(() => document.body.classList.contains('title'))), t);
  c.ok('title: no errors', ti.errors.filter((e) => !e.includes('404')).length === 0, ti.errors);
  const pre = await lab.open('preview', { width: 300, height: 375 });
  await pre.waitForTimeout(3000);
  console.log('preview', await lab.shot(pre, 'squishy-preview'));
  c.ok('preview: no errors', pre.errors.filter((e) => !e.includes('404')).length === 0, pre.errors);
});
c.done();
