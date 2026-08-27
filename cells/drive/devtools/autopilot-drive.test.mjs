/**
 * THE AUTOPILOT, IN THE WORLD — the half `autopilot.test.mjs` cannot reach.
 *
 *   node cells/drive/devtools/autopilot-drive.test.mjs
 *
 * The pure test proves the CONTROLLER: hand it a course and a ground and it
 * plans and steers correctly. It cannot prove the ADAPTER, and the adapter is
 * where this would actually fail — the course coming out of `wayAhead` in the
 * wrong frame, the grip sampler clobbering `surfQ` on its way past, the whole
 * thing wired somewhere the tick never reaches it. Every one of those reads as
 * a truck that sits still, or one that drives into a hillside, and none of
 * them is visible from a unit test.
 *
 * So this boots the real cell, on a real road, and lets it drive.
 *
 * THE CLOCK IS SIM TIME. Headless renders this world at two to four frames a
 * second and dt is capped at 50ms, so wall time is not distance — every wait
 * here is on integrated seconds.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ON A CARRIAGEWAY, and the coordinate is a way's own vertex rather than a
// place name. The first cut used the deck-roll corridor, which is where every
// other tool here measures — and it is 200m off the nearest tarmac. `__way()`
// came back null, the autopilot correctly did nothing, and the run said
// nothing at all about the autopilot. This is Silvermine Road (OSM way
// 8093756, tertiary, asphalt) out of the same already-banked z16 tile, at its
// own first vertex, pointed down it.
const d = await openDrive({
  spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&wx=clear&time=NOON',
  tag: 'autopilot', settle: 14000,
});

// The world has to have arrived before any of this means anything: an
// autopilot with no road under it is correctly doing nothing.
let road = null;
for (let i = 0; i < 20; i++) {
  road = await d.page.evaluate(() => window.__way());
  if (road?.way?.on) break;
  await d.page.waitForTimeout(2000);
}
check('there is a road under the truck to drive', !!road?.way?.on, road);

const on = await d.page.evaluate(() => window.__auto(true));
check('it arms', on.on === true, on);
// The course comes from `wayAhead`, which chains the way under the wheels —
// so a named road here means the adapter handed the controller real geometry
// in the truck's own frame, which is the thing most likely to be wrong.
let armed = null;
for (let i = 0; i < 15; i++) {
  armed = await d.page.evaluate(() => window.__auto());
  if (armed.pts >= 2) break;
  await d.page.waitForTimeout(1000);
}
check('…and finds a course on the road it is standing on',
  armed.pts >= 2 && armed.src !== 'none', armed);

const before = await d.page.evaluate(() => ({ ...window.__odo(), ...window.__way() }));
await d.simWait(25);
const after = await d.page.evaluate(() => ({
  ...window.__odo(), ...window.__way(), auto: window.__auto(), input: window.__input(),
}));

// THE ONE THAT MATTERS: it moved. Everything else here is a refinement of a
// truck that is at least driving.
const ran = after.total - before.total;
check('it drives', ran > 90, { metres: Math.round(ran) });
check('…on the throttle, not coasting off a hill',
  Math.abs(after.input.throttle) > 0.01 || after.input.brakeF > 0.01, after.input);
check('…and is still following a course when it gets there',
  after.auto.on === true && after.auto.pts >= 2, after.auto);
// Off the carriageway is the failure that looks like success: it kept moving,
// through a field, into the sea. The way line says which.
check('…and is on a road at the end of it, not in a field',
  after.way?.on === true, after.way);
// A plan with a REASON. `limit: 'none'` means it never found a course; 'cap'
// on a coast road for forty-five seconds would mean the curvature term never
// engaged, which is the whole speed plan not working.
check('…having planned for something real', after.auto.limit !== 'none'
  && typeof after.auto.want === 'number' && after.auto.want > 0, after.auto);

// THE THUMB WINS. The one moment you most want the wheel is the moment it is
// going somewhere you did not intend, so a key is enough to end it.
await d.page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); });
await d.page.waitForTimeout(900);
const gone = await d.page.evaluate(() => {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w' }));
  return window.__auto();
});
check('a hand on the controls stands it down', gone.on === false, gone);

report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
