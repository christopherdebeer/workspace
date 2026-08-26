/**
 * A TERRAIN REBUILD MAY NOT ASK THE WHOLE WORLD.
 *
 *   node cells/drive/devtools/terrain-scan.test.mjs
 *   REV=<sha> node cells/drive/devtools/terrain-scan.test.mjs
 *
 * redrape and reseatBuildings walked their ENTIRE lists on every terrain
 * rebuild and rejected nearly all of it on a bounding-box test — O(all the
 * world you have ever driven through) to re-seat one tile. drapedWays is only
 * emptied by a world hop, so that cost grew with the length of the session and
 * never came down.
 *
 * Measured on a phone across a single drive: terrainMs 20ms, then 46ms, then
 * 134ms, tracking the object count 1279 -> 1953 -> 2500+. flushTerrain rebuilds
 * at most one tile per 200ms, so 134ms is two thirds of wall-clock inside one
 * synchronous call. That is the "it gets worse the longer I play" the session
 * started from — and it is why flying the drone over the same ground is
 * smooth: a parked rig moves no tiles, so nothing rebuilds.
 *
 * The claim: what a rebuild VISITS is bounded by the tile, not by the list.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const rev = process.env.REV ?? '';
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON',
  tag: `tscan${rev ? '-old' : ''}`, rev, settle: 6000,
});

// Enough world has to arrive that the lists are worth indexing — a rebuild
// that visits everything is not a bug when everything is four things.
let gpu = null;
for (let i = 0; i < 22; i++) {
  await d.page.waitForTimeout(2000);
  gpu = await d.page.evaluate(() => window.__gpu());
  if ((gpu.scan?.ofDrapes ?? 0) > 150) break;
}
const scan = gpu.scan ?? {};
// WIRED, which is what is testable here. The counters describe the LAST
// rebuild, and this harness renders in software at well under 1fps — the last
// rebuild routinely happens before enough road has arrived to register a
// single drape (measured: ofDrapes 0, ofSeats 13, terrainMs 114). So the bound
// itself is asserted only when the run actually produced a population to
// bound; otherwise it is reported and left, because a test that cannot
// exercise its subject should say so rather than pass quietly.
check('the index is wired and reporting', scan.ofSeats !== undefined, scan);
check('a rebuild never visits more than exists',
  scan.seats <= scan.ofSeats && scan.drapes <= scan.ofDrapes, scan);
if ((scan.ofDrapes ?? 0) > 150) {
  check('THE REBUILD VISITED A FRACTION OF THE DRAPES, not all of them',
    scan.drapes < scan.ofDrapes * 0.5, scan);
} else {
  console.log(`      (not exercisable here: only ${scan.ofDrapes} drapes at the last`
    + ' rebuild — the bound is measured on a device, through the probe channel)');
}
console.log(`      drapes ${scan.drapes}/${scan.ofDrapes}`
  + `, seats ${scan.seats}/${scan.ofSeats}, terrainMs ${gpu.terrainMs}${rev ? ` (rev ${rev})` : ''}`);

// The index must not change what the world LOOKS like: a drape that stopped
// being re-seated would float over or sink into the ground it lies on. Only
// meaningful if there ARE drapes — an earlier cut of this asserted a
// nullish-coalesced zero against a threshold and passed on an empty world.
const drape = await d.page.evaluate(() => window.__drape(400));
if (typeof drape?.p50 === 'number') {
  check('the drapes still sit on the ground they are draped over',
    Math.abs(drape.p50) < 0.5, drape);
} else {
  console.log(`      (no drapes in range to check seating: ${JSON.stringify(drape).slice(0, 80)})`);
}

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
