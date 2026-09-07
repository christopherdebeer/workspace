/**
 * THE SOUNDSCAPE, IN DECIBELS. Reads `__levels()` — dBFS at every tap of
 * the mixer — through the states the targets were written for: parked with
 * the engine off beside a river, driving on open ground, and the drone up
 * (heard from the rack, then from on board). Yosemite valley floor: trees,
 * grass, and the Merced 67 m off — the spot the ring could not hear until
 * it reached 220 m. Numbers or it did not happen: `__mix()` reports what
 * the gain nodes were told, this reports what comes out.
 *
 *   node devtools/soundscape-audit.mjs
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({ spot: 'lat=37.70564&lon=-119.67737&h=64&cam=chase&sunalt=40&wx=clear', tag: 'sound', bootTimeout: 120000 });
await d.page.waitForTimeout(12000);
console.log('arm:', await d.page.evaluate(() => window.__armAudio()));
const read = () => d.page.evaluate(() => ({ lv: window.__levels(), amb: window.__amb(), eng: window.__engine(), kmh: Math.round(window.__real().kmh),
  surf: window.__surfaceAt(window.__drive.x, window.__drive.z) }));
const show = (label, r) => console.log(`${label}: kmh ${r.kmh} eng ${r.eng.st} surf ${r.surf} shake ${r.amb.shake} (raw ${r.amb.shakeRaw} m/s) grass ${r.amb.grass} river ${r.amb.riverRaw}@${r.amb.riverAt}\n   ${JSON.stringify(r.lv)}`);

await d.simWait(3);
show('rest, engine off', await read());

// STRAIGHT AHEAD, hard, on the valley floor (the spawn heading is not on
// the road): the rattle and grit are what rough ground sounds like now, and
// the shake's raw rate is the number its knee was set from. (Steering hard
// at speed spun the truck out and reversed it — measured, so gently.)
await d.page.evaluate(() => { window.__hold(0, 0.9); });
let peak = -99;
for (let i = 0; i < 8; i++) {
  await d.simWait(1);
  const r = await read();
  peak = Math.max(peak, r.lv.truck ?? -99);
  if (i === 2 || i === 5 || i === 7) show(`open ground t${i + 1}`, r);
}
console.log('truck bus peak while driving:', peak);
// Wall-clock from here: the sim clock is DRIVING time and a stopped truck
// does not advance it, which is where two earlier runs sat until the fuse.
await d.page.evaluate(() => { window.__hold(0, 0, 1); });
await d.page.waitForTimeout(5000);
show('braked', await read());

// THE DRONE: launched from a standing truck, heard first from the rack and
// then from on board. Wall-clock waits here: the truck's sim clock does not
// advance while the drone is being flown, and `simWait` would sit on it
// until the fuse (it did, for ten minutes).
await d.page.evaluate(() => { window.__hold(null); window.__droneGo(); });
await d.page.waitForTimeout(7000);
const dr = await d.page.evaluate(() => window.__drone());
console.log('drone:', JSON.stringify({ up: dr.up, spool: dr.spool, fromRig: dr.fromRig, cam: dr.cam }));
show('drone up, from the rack', await read());
await d.page.evaluate(() => window.__cam('drone'));
await d.page.waitForTimeout(3000);
show('drone up, on board', await read());
await d.page.evaluate(() => window.__cam('chase'));
report(d.errors);
await d.close();
