/**
 * M5 AND THE SCRUB RAIL, through the pointer a finger would use.
 *
 *   node cells/drive/devtools/pause-rail.test.mjs
 *
 * PAUSE holds the world and opens a rail on the left edge; dragging the rail
 * seats the truck on an older checkpoint; PLAY takes it (the ring is cut back)
 * and runs on. A second pause with no scrub, then play, is a no-op.
 * rewind.test.mjs covers the ring itself through the probe.
 */
import { openDrive } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const d = await openDrive({ spot: 'lat=-20.1338&lon=-67.4891&h=90&cam=chase&wx=clear&time=NOON', tag: 'pauserail', settle: 0, bootTimeout: 180000 });
await d.page.waitForTimeout(20000);
const page = d.page;
const rw = () => page.evaluate(() => window.__rewind());
const tapAt = (x, y, id) => page.evaluate(([x, y, id]) => {
  const c = document.querySelector('canvas');
  for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: id, bubbles: true }));
}, [x, y, id]);
const mid = (r, s) => [(r.x + r.w / 2) * s, (r.y + r.h / 2) * s];

await page.evaluate(async () => {
  const s = window.__drive;
  for (let i = 0; i < 360; i++) { s.x += 3; await new Promise((go) => requestAnimationFrame(go)); }
});
await page.waitForTimeout(600);
let r = await rw();
check('the ring has a past to scrub', r.have >= 4, r);
const before = r.car;
await tapAt(...mid(r.cell, r.s), 21);
await page.waitForTimeout(400);
r = await rw();
check('PAUSE holds the world', r.held === true, r);
check('…and opens the rail', r.open === true && r.rail.w > 0, r);
// Drag the rail from its bottom (now) to the top (oldest).
const [rx] = mid(r.rail, r.s);
const y0 = (r.rail.y + r.rail.h) * r.s, y1 = r.rail.y * r.s;
await page.evaluate(([x, y0, y1]) => {
  const c = document.querySelector('canvas');
  c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y0, pointerId: 22, bubbles: true }));
  for (let i = 1; i <= 10; i++) c.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y0 + (y1 - y0) * i / 10, pointerId: 22, bubbles: true }));
  c.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y1, pointerId: 22, bubbles: true }));
}, [rx, y0, y1]);
await page.waitForTimeout(400);
r = await rw();
check('the rail seats the truck on an older checkpoint', r.at > 0 && Math.hypot(r.car[0] - before[0], r.car[1] - before[1]) > 3, { r, before });
check('…and the world is still held', r.held === true, r);
const keysBefore = r.keys;
await tapAt(...mid(r.cell, r.s), 23);
await page.waitForTimeout(400);
r = await rw();
check('PLAY lets the world go', r.held === false && r.open === false, r);
check('…and takes the scrub: the ring is cut back', r.keys < keysBefore, { keysBefore, r });
// Pause and play with no scrub in between costs nothing.
const car0 = r.car;
await tapAt(...mid(r.cell, r.s), 24);
await page.waitForTimeout(300);
await tapAt(...mid(r.cell, r.s), 25);
await page.waitForTimeout(300);
r = await rw();
check('pause then play with no scrub is a no-op', r.held === false && Math.hypot(r.car[0] - car0[0], r.car[1] - car0[1]) < 3, { r, car0 });
check('no page errors', d.errors.length === 0, d.errors);
await page.screenshot({ path: '/tmp/drive-tools/pause-rail.png', timeout: 240000 }).catch(() => {});
await d.close();
console.log(bad ? `\npause-rail: ${bad} FAILED` : '\npause-rail: all ok');
process.exit(bad ? 1 : 0);
