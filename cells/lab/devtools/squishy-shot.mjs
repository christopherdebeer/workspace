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
  // pull back toward the bottom of the screen: it should wind up, and the line show it landing ahead
  await page.mouse.move(195, 420);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(195, 420 + i * 11);
  await page.waitForTimeout(600);
  await frames();
  s = await st();
  console.log('aim', JSON.stringify({ aiming: s.aiming, power: s.power, squeeze: s.squeeze, deform: s.deform }), await lab.shot(page, 'squishy-aim'));
  c.ok('pulling back winds it up', s.aiming && s.squeeze && s.power > 0.1, s);
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
  const pre = await lab.open('preview', { width: 300, height: 375 });
  await pre.waitForTimeout(3000);
  console.log('preview', await lab.shot(pre, 'squishy-preview'));
  c.ok('preview: no errors', pre.errors.filter((e) => !e.includes('404')).length === 0, pre.errors);
});
c.done();
