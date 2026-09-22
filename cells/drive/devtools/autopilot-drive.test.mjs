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
 * THE CLOCK IS SIM TIME, AND IT IS SLOW. Headless renders this world at two
 * to four frames a second and dt is capped at 50ms, so wall time is not
 * distance — every wait here is on integrated seconds. MEASURED on this rig:
 * about 0.15 sim seconds per SIX wall seconds, and five metres of road in
 * fifty. A first cut asked for twenty-five sim seconds and ninety metres, and
 * timed out at ten wall minutes having proved nothing; every other tool in
 * this folder asks for between 0.12 and 1.5. Three seconds is enough to see
 * the truck accelerate off the mark under its own control, which is the claim.
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

// ── ON DEVICE: the dial and the tab ──
// The probe is how a tool arms it; the TAB is how a person does, on a phone,
// on the road, with no console. Those are different code paths and the tab's
// is the one nobody would notice was broken.
const dials = await d.page.evaluate(() => window.__dial('auto', 1));
check('the AUTOPILOT dial offers the tab', dials.auto === 'HUD TAB', dials.auto);
// Tapped where a thumb lands on the deck's AUTO button (the DRIVE sheet,
// client/hud-deck.ts) — found by elementFromPoint, so a button covered by
// something else fails here rather than being clicked through its handler.
const tapAuto = async () => {
  if ((await d.page.evaluate(() => window.__deck().open)) !== 'drive') {
    await d.page.evaluate(() => window.__deck('drive'));
    await d.page.waitForTimeout(1500);
  }
  return d.page.evaluate(() => {
    const r = window.__autorect();
    if (!r) return { on: null, why: 'no AUTO button on the glass' };
    document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2)?.closest('[data-deck-item]')?.click();
    return window.__auto();
  });
};
const tapped = await tapAuto();
check('a tap on the tab engages it', tapped.on === true, tapped);
const off = await tapAuto();
check('…and the same tap hands it back', off.on === false, off);

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
// Sampled rather than waited-then-read, because the interesting evidence is a
// TRANSITION — `limit` leaving 'cap' the moment a real bend enters the plan
// window is what says the curvature term is reading streamed geometry and not
// a constant. A single reading at the end cannot show it.
// Speed and throttle are taken as PEAKS over the window, not read at the end:
// the course's last vertex is a stop-by point, and once the tick clamp let
// the sim cover real ground during the test's wall-clocked stretches, the
// final instant landed in the braking-for-the-end phase — 2.4m/s, throttle
// zero, both honest and both failing checks that meant "it got up to speed
// under its own throttle at SOME point", which is what a peak actually says.
const seen = new Set();
let vPeak = 0, pedalPeak = 0;
for (let i = 0; i < 8; i++) {
  await d.simWait(0.4);
  const s = await d.page.evaluate(() => ({ limit: window.__auto().limit, inp: window.__input() }));
  seen.add(s.limit);
  vPeak = Math.max(vPeak, s.inp.speed);
  pedalPeak = Math.max(pedalPeak, Math.abs(s.inp.throttle) + s.inp.brakeF);
}
const after = await d.page.evaluate(() => ({
  ...window.__odo(), ...window.__way(), auto: window.__auto(), input: window.__input(),
}));

// THE ONE THAT MATTERS: it moved, under its own throttle. Everything else
// here is a refinement of a truck that is at least driving.
const ran = after.total - before.total;
check('it drives', ran > 12, { metres: Math.round(ran) });
check('…and got up to speed doing it', vPeak > 6, +vPeak.toFixed(2));
check('…on the throttle, not coasting off a hill', pedalPeak > 0.01, +pedalPeak.toFixed(3));
check('…and is still following a course when it gets there',
  after.auto.on === true && after.auto.pts >= 2, after.auto);
// Off the carriageway is the failure that looks like success: it kept moving,
// through a field, into the sea. The way line says which.
check('…and is on a road at the end of it, not in a field',
  after.way?.on === true, after.way);
// A plan with a REASON, and one that CHANGED. `limit: 'none'` would mean it
// never found a course at all; 'cap' and nothing else, on a road that bends,
// would mean the curvature term never engaged — the whole speed plan inert
// while the truck merely happened to be pointing the right way.
check('…having planned for something real', !seen.has('none') && seen.size >= 1
  && typeof after.auto.want === 'number' && after.auto.want > 0, [...seen]);
check('…and the ground actually bound the plan at some point',
  seen.has('curve') || seen.has('grip') || seen.has('end'), [...seen]);

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
