/**
 * GOOGLE MAPS LINKS, BOTH WAYS.
 *
 *   node cells/drive/devtools/gmaps.test.mjs
 *
 * There is no single Google Maps URL format — the phone app, the desktop site
 * and the share sheet each write a different one, and a `place` link carries
 * TWO coordinates: the pin (`!3d!4d`, inside the `data=` blob) and the camera
 * (`@lat,lon,zoom`), which can be streets apart. Every shape below was taken
 * from a real link, so this is a fixture list rather than a guess at a grammar.
 *
 * The shortener hop is not exercised here — it needs the deployed `/gmaps`
 * route, and `--live` checks that end separately.
 */
import { openDrive, report } from './harness.mjs';

const CASES = [
  // [what it is, the link, expected lat/lon or null]
  ['app share, resolved', 'https://maps.google.com/?q=-30.5894240,27.7293145&entry=gps&g_st=ic', [-30.589424, 27.7293145]],
  ['desktop viewport', 'https://www.google.com/maps/@36.3745,-121.9043,15z', [36.3745, -121.9043]],
  ['place: pin beats camera', 'https://www.google.com/maps/place/Bixby+Creek+Bridge/@36.3712,-121.9019,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d36.3714!4d-121.9016', [36.3714, -121.9016]],
  ['q=loc: prefix', 'https://www.google.com/maps?q=loc:-34.08531,18.35561', [-34.08531, 18.35561]],
  ['maps search api', 'https://www.google.com/maps/search/?api=1&query=64.048%2C-16.18', [64.048, -16.18]],
  ['directions destination', 'https://www.google.com/maps/dir/?api=1&destination=51.5074,-0.1278', [51.5074, -0.1278]],
  ['ll param', 'https://maps.google.com/maps?ll=48.8584,2.2945&z=17', [48.8584, 2.2945]],
  ['country domain', 'https://www.google.co.uk/maps/@53.4808,-2.2426,12z', [53.4808, -2.2426]],
  ['a bare coordinate paste', '-30.5894, 27.7293', [-30.5894, 27.7293]],
  ['place name only — no coordinate', 'https://www.google.com/maps/place/Big+Sur/', null],
  ['not google at all', 'https://example.com/?q=1,2', [1, 2]],   // parsed, but the caller gates on host
  ['null island is not a fix', 'https://maps.google.com/?q=0,0', null],
  ['out of range', 'https://maps.google.com/?q=95.2,700.1', null],
  ['nonsense', 'https://maps.app.goo.gl/NnqHXgwN6T4PJnyL7', null],  // short: needs the server hop
];

const d = await openDrive({ spot: 'lat=36.3745&lon=-121.9043&h=0&cam=chase', tag: 'gmaps' });
let bad = 0;
for (const [name, link, want] of CASES) {
  const got = await d.page.evaluate((u) => window.__gmap(u), link);
  const ok = want === null
    ? got === null
    : got !== null && Math.abs(got.lat - want[0]) < 1e-6 && Math.abs(got.lon - want[1]) < 1e-6;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}\n        ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
}
// …and the way back out: the link this spot hands to someone else must parse
// back to the same place, or the round trip is not one.
const link = await d.page.evaluate(() => window.__gmaplink());
const back = await d.page.evaluate((u) => window.__gmap(u), link);
const at = await d.page.evaluate(() => window.__toll(window.__drive.x, window.__drive.z));
const trip = back && Math.abs(back.lat - at[0]) < 1e-4 && Math.abs(back.lon - at[1]) < 1e-4;
if (!trip) bad++;
console.log(`${trip ? 'ok  ' : 'FAIL'}  round trip\n        ${link} -> ${JSON.stringify(back)} vs ${JSON.stringify(at)}`);
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
