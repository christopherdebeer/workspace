/**
 * A SUMMIT MARKER IS A LABEL ON SOMETHING YOU CAN SEE.
 *
 * Two ways to fail that, and this file now holds both. A peak can be out of
 * FRAME — turn away and it must go, with no chip stuck to the rim. And a peak
 * can be behind a MOUNTAIN, which no frustum and no horizon test can see:
 * reported from the seat in Romsdalen, three summits fifty kilometres off
 * written across the valley wall that was the only thing in the picture.
 *
 *   node cells/drive/devtools/peaks-inview.test.mjs
 *
 * Unlike a destination — a thing you are travelling TO, which wants a bearing
 * even when it is behind you — a peak marker only means anything while the
 * peak is in frame. So: turn to face one and it appears; turn away and it is
 * gone, with no chip left stuck to the rim.
 *
 * Summits are injected at real coordinates so the run needs no Overpass slot
 * and says the same thing every time.
 */
import { openDrive, report } from './harness.mjs';

// Big Sur, facing OUT TO SEA. The frustum law wants a sight line with nothing
// in it, and the Pacific is the only direction from this coast that has one:
// face east and the Santa Lucia wall rises a kilometre within five, which
// hides everything behind it and is a fact about occlusion rather than about
// the frustum. So the in-frame fixtures are invented seamounts to the WEST,
// and the range inland becomes this file's occlusion control.
const FIXTURE = [
  // Dead ahead facing west, above the horizon, and nothing but water between.
  ['West Ridge', 36.3745, -122.41, 1600],
  // 330km west and ~8.5km under the earth's curve. Dead ahead too; it used to
  // draw as a ghosted bearing. A label on something the earth is in front of
  // is not a view.
  ['Deep Ridge', 36.3745, -125.60, 4421],
  // Two invented giants due NORTH and SOUTH — out of frame while facing west,
  // and steep enough (about 2.9deg) to outrank everything that IS in frame.
  // They are the regression: rank-then-filter picked these plus one more from
  // all around the rig, found none of them on the glass, and drew nothing.
  ['North Sentinel', 36.6450, -121.9043, 1500],
  ['South Sentinel', 36.1040, -121.9043, 1500],
  // THE OCCLUSION CONTROL. Above the horizon, dead ahead facing east, in
  // frame, and comprehensively behind the coastal range — reported from the
  // seat in Romsdalen, where three summits fifty kilometres off were written
  // across the valley wall that was the only thing in the picture.
  ['East Ridge', 36.3745, -121.40, 1600],
  ['Junipero Serra Peak', 36.1447, -121.4225, 1787],
  ['Cone Peak', 36.0505, -121.5085, 1571],
];

// BOOTED FACING THE THING IT MEASURES FIRST. The chase camera EASES toward a
// new heading, and headless renders this world at two to four frames a second
// — so the first reading after a 180-degree turn can be taken mid-swing, with
// the summit still off the side of the glass. Booting on the measured heading
// costs nothing and removes a whole class of false failure.
const d = await openDrive({ spot: 'lat=36.3745&lon=-121.9043&h=270&cam=chase&time=NOON&sunalt=45&wx=clear', tag: 'inview' });
await d.page.waitForTimeout(30000);
await d.page.evaluate((fx) => { for (const [n, la, lo, e] of fx) window.__peakadd(n, la, lo, e); }, FIXTURE);

/** Every peak marker currently drawn, with the edge it is stuck to (0 = in frame). */
const shown = async (headingDeg) => {
  await d.page.evaluate((h) => { window.__drive.heading = (h * Math.PI) / 180; window.__drive.speed = 0; }, headingDeg);
  await d.page.waitForTimeout(3000);      // frames, not milliseconds: see the boot heading
  return d.page.evaluate(() => window.__pins().drawn
    .filter((p) => /\d+M /.test(p.t))
    .map((p) => ({ t: p.t.replace(/[<>]/g, '').trim(), edge: p.edge })));
};

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// Facing the open water (west): the seamounts should be on screen.
const facing = await shown(270);
check('facing an unobstructed summit, it is drawn', facing.length > 0, facing);
// The point of the ordering fix: the in-frame summits are outranked by two
// bigger ones off the sides, and must be drawn anyway.
check('an in-frame summit is not crowded out by bigger ones off-screen',
  facing.some((p) => /WEST RIDGE/.test(p.t)), facing);
check('a summit below the horizon is not drawn at all — the earth is in front of it',
  !facing.some((p) => /DEEP RIDGE/.test(p.t)), facing);
check('the off-screen giants are nowhere on the HUD',
  !facing.some((p) => /SENTINEL/.test(p.t)), facing);
check('…and every one of them is IN FRAME, not on the rim',
  facing.every((p) => p.edge === 0), facing);
console.log(`        ${facing.map((p) => p.t).join(' | ')}`);

// Facing inland (east): the summits are above the horizon, dead ahead and in
// frame — and every one of them is behind a mountain. A marker here is the
// Romsdalen fault, where a valley wall wore three names it could not show.
const inland = await shown(90);
check('a summit with a mountain in the way is not drawn',
  !inland.some((p) => /EAST RIDGE|SERRA|CONE PEAK/.test(p.t)), inland);

// And back again, so this is a live test of the frustum rather than of order.
const back = await shown(270);
check('turning back brings them home', back.length > 0 && back.every((p) => p.edge === 0), back);

console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
