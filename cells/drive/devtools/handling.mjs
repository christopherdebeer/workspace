/**
 * DOES THE TRUCK CORNER LIKE A VEHICLE?
 *
 *   node cells/drive/devtools/handling.mjs [--rev=HEAD~3] [--spot=...]
 *
 * Holds full lock at a series of speeds on flat ground and reads the
 * steady-state corner back: radius, lateral g, and how far the truck is
 * travelling from where it is pointing. The two failure shapes to tell apart —
 *
 *   SPIN        tiny radius, absurd lateral g, big slip angle. The nose whips
 *               round while the velocity carries straight on.
 *   UNDERSTEER  radius grows with speed, lateral g pinned at about the
 *               surface's mu, slip angle small. The truck runs wide, pointing
 *               where you steered it.
 *
 * NO THROTTLE, AND A SHORT WINDOW. A first version of this held 'w' too, and
 * the truck was doing 71km/h by the time the 15km/h row was read — every number
 * in that row was about a corner the test never took. The rack reaches full
 * lock in 0.14s and the slide settles in about 0.45s, so 0.55s is three time
 * constants while drag has taken a tenth of the speed.
 */
import { openDrive, report } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
// Flat open ground beside the road at Noordhoek, so a side slope does not eat
// the cornering budget and confuse what is being measured.
const spot = arg('spot', 'lat=-34.09905&lon=18.37835&h=0&cam=chase');
const rev = arg('rev', '');

// An older build has no integrated-time counter, and waiting in wall time at
// three frames a second lets drag eat the speed under test. Same rAF cadence
// and the same 50ms dt cap as tick(), so it counts the same seconds.
const CLOCK_SHIM = `
let __bsim = 0, __blast = performance.now();
(function loop(): void {
  const n = performance.now();
  __bsim += Math.min(0.05, (n - __blast) / 1000); __blast = n;
  requestAnimationFrame(loop);
})();
(window as unknown as { __clock?: object }).__clock = (): object => ({ simS: +__bsim.toFixed(2) });
`;

const d = await openDrive({ spot, tag: `handling${rev ? '-old' : ''}`, rev, shim: rev ? CLOCK_SHIM : '' });

const rows = [];
for (const kmh of [15, 30, 55, 80, 110]) {
  // Set the speed directly and hold full lock: the question is what the chassis
  // does at that speed, not how long the engine takes to get there.
  await d.page.evaluate((v) => {
    window.__drive.speed = v / 3.6;
    window.__drive.heading = 0;
    dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
  }, kmh);
  await d.simWait(0.55);
  rows.push({ kmh, ...(await d.page.evaluate(() => window.__phys())) });
  await d.page.evaluate(() => {
    dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
    window.__drive.speed = 0;
  });
  await d.simWait(1);
}

console.log(rev ? `rev ${rev}` : 'working tree');
console.log(' set    v    steer  yawWant  yawRate   radius    latG   askG   slip    mu');
for (const r of rows) {
  console.log(`  ${String(r.kmh).padStart(3)}  ${(r.v * 3.6).toFixed(0).padStart(4)}`
    + `  ${r.steerCur.toFixed(2).padStart(5)}`
    + `  ${((r.yawWant * 180) / Math.PI).toFixed(0).padStart(6)}°/s`
    + ` ${((r.yawRate * 180) / Math.PI).toFixed(0).padStart(6)}°/s`
    + ` ${(r.radius > 9999 ? '   inf' : r.radius.toFixed(0).padStart(6))}m`
    + ` ${r.latG.toFixed(2).padStart(6)}g ${r.askG.toFixed(2).padStart(5)}g`
    + ` ${r.slipDeg.toFixed(1).padStart(6)}° ${(r.mu ?? 0).toFixed(2)}`);
}
report(d.errors);
await d.close();
