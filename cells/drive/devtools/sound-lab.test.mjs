/**
 * THE SOUND LAB, DRIVEN WITHOUT A FINGER. Opens /lab/sound, holds it to
 * the same "it put a canvas up" as every lab, then arms the mixer and
 * walks the scenes: a still bank must put the river on the meter, open
 * ground must put the grit and the rattle on it, a thud must leave a peak,
 * a mute must take a voice away, and the A/B must not throw.
 *
 *   node cells/drive/devtools/sound-lab.test.mjs
 */
import { openDrive, report } from './harness.mjs';

let fails = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(detail)}`); if (!cond) fails++; };

const d = await openDrive({ pagePath: '/lab/sound', tag: 'lab-sound', settle: 2500, bootTimeout: 60000 });
const seen = await d.page.evaluate(() => {
  const c = document.querySelector('canvas');
  let painted = false;
  if (c) { const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 60) { painted = true; break; } }
  return { canvases: document.querySelectorAll('canvas').length, painted, boot: !!document.getElementById('boot'), dials: document.querySelectorAll('.lab-dials input, .lab-dials select').length, buttons: document.querySelectorAll('#main button').length };
});
ok('it put a painted canvas up', seen.canvases > 0 && seen.painted, seen);
ok('the boot splash is gone', !seen.boot, seen);
ok('the dials and the buttons are there', seen.dials >= 36 && seen.buttons >= 50, seen);

const armed = await d.page.evaluate(() => window.__soundlab.arm());
ok('the mixer arms in the lab', armed === 'running', armed);
const scene = async (name, ms = 2500) => { await d.page.evaluate((n) => window.__soundlab.preset(n), name); await d.page.waitForTimeout(ms); return d.page.evaluate(() => window.__soundlab.levels()); };

const bank = await scene('STILL BANK');
console.log('  still bank:', JSON.stringify(bank));
ok('a still bank puts the river on the meter near its target', bank.river > -34 && bank.river < -18 && bank.world > -34, bank);
const ground = await scene('OPEN GROUND 60');
console.log('  open ground 60:', JSON.stringify(ground));
ok('open ground puts the grit, the rattle and the engine on the meter', ground.grit > -40 && ground.rattle > -40 && ground.eng > -30, ground);
const drone = await scene('DRONE ON BOARD');
console.log('  drone on board:', JSON.stringify(drone));
ok('the drone on board is near its target', drone.drone > -28 && drone.drone < -14, drone);

await scene('SILENCE', 1500);
await d.page.evaluate(() => window.__soundlab.shot('THUD 3'));
await d.page.waitForTimeout(400);
const peaks = await d.page.evaluate(() => window.__soundlab.peaks());
ok('a thud leaves a peak on the truck bus', peaks.truck > -40, peaks);

const swapped = await d.page.evaluate(() => { try { window.__soundlab.audio.pattern('grit', 'b'); window.__soundlab.audio.pattern('rattle', 'b'); window.__soundlab.audio.pattern('grit', 'a'); window.__soundlab.audio.pattern('rattle', 'a'); return true; } catch (e) { return String(e); } });
ok('the A/B swaps without throwing', swapped === true, swapped);

await d.page.evaluate(() => { window.__soundlab.preset('STILL BANK'); window.__soundlab.audio.mute('river', true); });
await d.page.waitForTimeout(3000);
const muted = await d.page.evaluate(() => window.__soundlab.levels());
ok('a mute takes the river away', muted.river < -70, muted);
await d.page.evaluate(() => window.__soundlab.audio.mute('river', false));

await d.page.setViewportSize({ width: 390, height: 844 });
await d.page.waitForTimeout(500);
await d.shot('sound-lab-phone');
report(d.errors);
if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('sound lab: all ok');
await d.close();
