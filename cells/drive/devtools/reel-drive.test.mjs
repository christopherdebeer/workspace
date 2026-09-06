/**
 * THE REEL DRIVES ITSELF NOW.
 *
 *   node cells/drive/devtools/reel-drive.test.mjs
 *
 * The two authored tapes were 21.25 and 18.9 seconds of recorded input, so
 * forty seconds was the whole house programme and every extra minute had to be
 * driven by hand and pasted into the bundle as base64. A reel entry is a PLACE
 * AND A GOAL now, and the autopilot drives it live.
 *
 * Three things have to be true and only one of them is about driving:
 *
 *   1. the programme is the drive list, and the carousel counts it
 *   2. a slot ARMS: it hops, sets the goal, waits for a road, engages
 *   3. it GIVES THE WHEEL BACK. `travelTo` calls `attractStop` on every tap,
 *      so a reel that leaves the autopilot on and a goal set hands the player
 *      a truck that drives itself to Noordhoek. That is the one that would be
 *      unforgivable, and it is the cheapest to check.
 *
 * Driven live rather than on a fixture: a fixture declares no ecoregion and,
 * more to the point, has no OSM survey to route over — the thing under test is
 * the autopilot finding a real road.
 */
import { openDrive } from './harness.mjs';

/** menu.ts's DRIVES tab. The reel is the splash's show and runs nowhere else. */
const T_DRIVE = 0;

let bad = 0;
const ok = (n, c, saw) => {
  if (!c) bad++;
  console.log(`${c ? 'ok   ' : 'FAIL '} ${n}${c ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// The reel's own opening postcard, so the test drives what a player would see.
const d = await openDrive({
  spot: 'lat=-34.0745&lon=18.3590&h=190&cam=chase&wx=clear&time=NOON&nodraw=1',
  tag: 'reel-drive', settle: 0, bootTimeout: 120000,
});

// ── 1. the programme ─────────────────────────────────────────────────────
const reel = await d.page.evaluate(() => window.__reel());
console.log(`\nprogramme: ${reel.n} slots · src ${reel.src}`);
console.log(`  ${JSON.stringify(reel.names)}`);
ok('the reel is driven, not taped', reel.src === 'drive', reel.src);
ok('…and has more than the two tapes did', reel.n > 2, reel.n);
ok('every slot is named', (reel.names ?? []).every((x) => typeof x === 'string' && x.length), reel.names);

// ── 2. a slot arms and engages ───────────────────────────────────────────
//
// THE REEL ONLY RUNS ON THE HUB. `stepAttract` stands the whole thing down
// unless the DRIVES tab is open and the camera is not the chart — "leaving the
// hub mid-reel means the player chose THIS place". The first cut of this test
// opened the world in chase view with no menu, so every slot armed correctly
// and was stood down on the very next frame, and the probe read `drive: null`
// six times over. Correct behaviour; a test driving it from outside the state
// the feature lives in.
await d.page.evaluate((tab) => { window.__menutab(tab); }, T_DRIVE);
ok('the hub is open, which is where the reel lives',
  await d.page.evaluate(() => window.__menutab()) === T_DRIVE);
// Jump straight into slot 0 rather than waiting out the 90s idle.
await d.page.evaluate(() => { window.__reel(0); });
const armed = await d.page.evaluate(() => new Promise((r) => {
  const t0 = performance.now();
  const w = () => {
    const s = window.__reel();
    // Engaged, or long enough that it never will be.
    if (s.drive?.auto || performance.now() - t0 > 150000) return r(s);
    requestAnimationFrame(w);
  };
  requestAnimationFrame(w);
}));
console.log(`\narmed: ${JSON.stringify(armed.drive)}`);
ok('the slot armed as a drive', !!armed.drive, armed);
ok('…with a goal set', !!armed.drive?.goal, armed.drive);
ok('…and the roads arrived', (armed.drive?.roads ?? 0) > 0, armed.drive?.roads);
ok('…so the autopilot engaged', armed.drive?.auto === true, armed.drive);

// It should then actually MOVE. The stall rule exists because an autopilot
// with no road under it sits still while the orbit circles it.
const moved = await d.page.evaluate(() => new Promise((r) => {
  const t0 = performance.now();
  let best = 0;
  const w = () => {
    const s = window.__reel();
    best = Math.max(best, Math.abs(s.drive?.speed ?? 0));
    if (best > 2 || performance.now() - t0 > 90000) return r({ best, drive: s.drive });
    requestAnimationFrame(w);
  };
  requestAnimationFrame(w);
}));
console.log(`\nmoving: peak ${moved.best.toFixed(1)} · ${JSON.stringify(moved.drive)}`);
ok('the rig actually drives', moved.best > 2, moved);
ok('…and is closing on its goal', (moved.drive?.goalM ?? 1e9) < 40000, moved.drive?.goalM);

// ── AND IT IS A TRAILER, NOT A DRIVE ─────────────────────────────────────
// The odometer is the player's record of what THEY drove, and `drive.odo`
// persists for the life of the device. Caught in a frame: the splash orbit
// reading "111 M TRIP · 111 M TOTAL" while the reel drove Chapman's Peak on
// its own. A recorded tape leaked the same way and never showed it, because
// twenty-one seconds is two hundred metres — a driven slot runs for two and a
// half minutes and the reel cycles for as long as the machine is left alone.
const odo = await d.page.evaluate(() => window.__odo?.() ?? null);
if (odo) {
  ok('the reel did not drive the player\'s odometer', odo.trip < 5, odo);
} else {
  console.log('NOTE: no __odo probe — the odometer leak was not checked here.');
}

// ── 3. IT GIVES THE WHEEL BACK ───────────────────────────────────────────
const after = await d.page.evaluate(() => {
  window.__attractstop();
  return { reel: window.__reel(), auto: window.__auto(), goal: window.__goal?.() ?? null };
});
console.log(`\nafter stop: ${JSON.stringify(after)}`);
ok('the reel stood down', after.reel.drive === null && after.reel.at === -1, after.reel);
ok('the autopilot is OFF', after.auto.on === false, after.auto);
ok('and the goal is cleared', after.goal === null || after.goal.name === null, after.goal);

console.log('\npage errors:', d.errors.length, d.errors.slice(0, 3));
ok('no page errors', d.errors.length === 0, d.errors.slice(0, 3));
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
