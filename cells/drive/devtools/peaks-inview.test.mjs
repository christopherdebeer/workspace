/**
 * A SUMMIT MARKER IS A LABEL ON SOMETHING YOU CAN SEE.
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

// Big Sur, facing the Santa Lucia range: everything inland is roughly east.
const FIXTURE = [
  ['Junipero Serra Peak', 36.1447, -121.4225, 1787],
  ['Cone Peak', 36.0505, -121.5085, 1571],
  // The one summit that is dead ahead facing east AND above the horizon: an
  // invented ridge 45km out. (The real Santa Lucia summits sit 30-50deg off
  // the east axis — outside a portrait phone's ~28deg of field — so the
  // in-frame duty falls to this one.)
  ['East Ridge', 36.3745, -121.40, 1600],
  // Whitney is 330km east and ~8.5km under the earth's curve from this coast.
  // It is dead ahead too, and it used to draw as a ghosted bearing; now it is
  // the negative control — a label on something the earth is in front of is
  // not a view.
  ['Mount Whitney', 36.5785, -118.2923, 4421],
  // Two invented giants due NORTH and SOUTH — out of frame while facing east,
  // and steep enough (about 2.9deg) to outrank everything that IS in frame.
  // They are the regression: rank-then-filter picked these plus one more from
  // all around the rig, found none of them on the glass, and drew nothing.
  ['North Sentinel', 36.6450, -121.9043, 1500],
  ['South Sentinel', 36.1040, -121.9043, 1500],
];

const d = await openDrive({ spot: 'lat=36.3745&lon=-121.9043&h=90&cam=chase&time=NOON&sunalt=45&wx=clear', tag: 'inview' });
await d.page.waitForTimeout(30000);
await d.page.evaluate((fx) => { for (const [n, la, lo, e] of fx) window.__peakadd(n, la, lo, e); }, FIXTURE);

/** Every peak marker currently drawn, with the edge it is stuck to (0 = in frame). */
const shown = async (headingDeg) => {
  await d.page.evaluate((h) => { window.__drive.heading = (h * Math.PI) / 180; window.__drive.speed = 0; }, headingDeg);
  await d.page.waitForTimeout(1200);
  return d.page.evaluate(() => window.__pins().drawn
    .filter((p) => /\d+M /.test(p.t))
    .map((p) => ({ t: p.t.replace(/[<>]/g, '').trim(), edge: p.edge })));
};

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// Facing the range (east): the near summits should be on screen.
const facing = await shown(90);
check('facing the range, summits are drawn', facing.length > 0, facing);
// The point of the ordering fix: the in-frame summits are outranked by two
// bigger ones off the sides, and must be drawn anyway.
check('an in-frame summit is not crowded out by bigger ones off-screen',
  facing.some((p) => /EAST RIDGE/.test(p.t)), facing);
check('a summit below the horizon is not drawn at all — the earth is in front of it',
  !facing.some((p) => /WHITNEY/.test(p.t)), facing);
check('the off-screen giants are nowhere on the HUD',
  !facing.some((p) => /SENTINEL/.test(p.t)), facing);
check('…and every one of them is IN FRAME, not on the rim',
  facing.every((p) => p.edge === 0), facing);
console.log(`        ${facing.map((p) => p.t).join(' | ')}`);

// Facing out to sea (west): the range is behind us and must be gone entirely.
const away = await shown(270);
check('facing away, no summit markers at all', away.length === 0, away);

// And back again, so this is a live test of the frustum rather than of order.
const back = await shown(90);
check('turning back brings them home', back.length > 0 && back.every((p) => p.edge === 0), back);

console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
