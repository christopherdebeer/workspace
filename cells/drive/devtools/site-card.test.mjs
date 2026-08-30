/**
 * A MARK ASKS BEFORE IT MOVES.
 *
 *   node cells/drive/devtools/site-card.test.mjs
 *
 * Free drive's double tap used to drop a fix silently, and a tap on that fix
 * teleported on the spot — one stray thumb from a pin that is deliberately
 * always live, with nothing said about the place either time. THE LINE has
 * answered the same gesture with a record since the field query landed; this
 * asserts free drive now does too, and that the travel moved INTO that record
 * rather than staying on the pin.
 *
 * THREE CLAIMS:
 *   1. the double tap drops a mark AND opens its record
 *   2. the record actually reads the ground — elevation, cover, biome
 *   3. tapping the fix opens the record and does NOT move the truck; the
 *      record's own RELOCATE is what travels.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
// Synthetic PointerEvents, two ids — the dispatch fix-place proved works on
// this canvas. page.mouse produces no gesture here.
const tap = (page, x, y, id) => page.evaluate(({ x, y, id }) => {
  const cv = document.querySelector('#scene');
  const ev = (type) => new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerType: 'touch' });
  cv.dispatchEvent(ev('pointerdown')); cv.dispatchEvent(ev('pointerup'));
}, { x, y, id });
// BOTH TAPS IN ONE EVALUATE. Two round trips to the page can exceed the
// gesture's own 450ms window, and then the second tap opens a fresh gesture
// instead of completing the first — the first cut of this test failed for
// exactly that reason and looked like a broken feature.
const dbl = (page, x, y) => page.evaluate(({ x, y }) => {
  const cv = document.querySelector('#scene');
  const ev = (type, id) => new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true, pointerType: 'touch' });
  cv.dispatchEvent(ev('pointerdown', 7)); cv.dispatchEvent(ev('pointerup', 7));
  cv.dispatchEvent(ev('pointerdown', 8)); cv.dispatchEvent(ev('pointerup', 8));
}, { x, y });

const errors = [];
const d = await openDrive({
  spot: 'lat=-30.6944&lon=27.7642&h=120&cam=cab&wx=clear&t=NOON',
  tag: 'site-card', settle: 30000,
});
await dbl(d.page, 195, 250);
await d.page.waitForTimeout(700);

const card = await d.page.evaluate(() => window.__site());
check('the double tap opened a record', !!card, card);
check('the record belongs to the mark it dropped', !!card && card.fix === card.name, card);
if (card) {
  const rows = card.rows ?? {};
  console.log(`      ${card.name} · ${card.status}`);
  for (const [k, v] of Object.entries(rows)) console.log(`        ${k.padEnd(8)} ${v}`);
  check('elevation is surveyed, not blank', /\d+M/.test(rows.ELEV ?? ''), rows.ELEV);
  check('cover names a class', !!rows.COVER && rows.COVER !== 'NO RASTER', rows.COVER);
  check('biome is named with a weight', /%$/.test(rows.BIOME ?? ''), rows.BIOME);
  check('the ground is described', !!rows.GROUND, rows.GROUND);
  check('water answers either way', !!rows.WATER, rows.WATER);
  const json = JSON.parse(card.json);
  check('the copied record carries lat/lon', Array.isArray(json.at) && json.at.length === 2, json.at);
  check('the copied record carries the biome weights', !!json.biome?.w?.alpine !== undefined, json.biome);
}

// Close it, then tap the pin itself: that must OPEN, not travel.
await d.page.evaluate(() => window.__site('close'));
const before = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
const pin = (await d.page.evaluate(() => window.__poirects())).find((r) => r.kind === 'survey');
check('the fix has a live tap target', !!pin, pin);
if (pin) {
  await tap(d.page, pin.cx, pin.cy, 11);
  await d.page.waitForTimeout(500);
  const reopened = await d.page.evaluate(() => window.__site());
  const after = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
  const moved = Math.hypot(after.x - before.x, after.z - before.z);
  check('tapping the fix opened its record', !!reopened, reopened);
  check('tapping the fix did NOT move the truck', moved < 5, { moved: +moved.toFixed(1) });
  // …and the record's own action is what travels.
  await d.page.evaluate(() => window.__site('go'));
  await d.page.waitForTimeout(600);
  const done = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
  const went = Math.hypot(done.x - before.x, done.z - before.z);
  console.log(`      RELOCATE moved the truck ${went.toFixed(0)}m`);
  check('RELOCATE moved the truck', went > 20, { went: +went.toFixed(1) });
  check('the record closed behind it', !(await d.page.evaluate(() => window.__site())), null);
}
errors.push(...d.errors);
await d.close();

console.log(bad ? `\n${bad} FAILED` : '\nall good — a mark asks before it moves');
report(errors);
if (bad) process.exitCode = 1;
