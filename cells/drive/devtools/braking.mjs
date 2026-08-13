/**
 * IS THE BRAKE A MAGNITUDE, AND DOES TURNING SURVIVE IT?
 *
 *   node cells/drive/devtools/braking.mjs [--rev=HEAD~5]
 *
 * Plants the thumb, holds a lock by pushing sideways, then pulls DOWN by a
 * series of distances and measures what the truck actually does: how much speed
 * it sheds, and whether the steering moved. A binary brake gives one
 * deceleration whatever the pull; a modulated one trails near the dead zone and
 * stops hard at the rim.
 *
 * MEASURE A RATE, AND FROM HIGH SPEED. A first version held each pull for a
 * full second from 50km/h; the truck stopped, the held input took up reverse
 * the way an automatic does, and the table reported shedding 32km/h more than
 * it started with. Measure before the thing under test can run out of road.
 */
import { openDrive, report } from './harness.mjs';

const args = process.argv.slice(2);
const rev = (args.find((a) => a.startsWith('--rev=')) ?? '').slice(6);
const CLOCK_SHIM = `
let __bsim = 0, __blast = performance.now();
(function loop(): void {
  const n = performance.now();
  __bsim += Math.min(0.05, (n - __blast) / 1000); __blast = n;
  requestAnimationFrame(loop);
})();
(window as unknown as { __clock?: object }).__clock = (): object => ({ simS: +__bsim.toFixed(2) });
`;

const d = await openDrive({ tag: `braking${rev ? '-old' : ''}`, rev, shim: rev ? CLOCK_SHIM : '' });
const TX = 195, TY = 560, ACROSS = 26;   // a held lock, off to the right

console.log(rev ? `rev ${rev}` : 'working tree');
console.log('  pull   brakeF    decel        in g     steer');
for (const dy of [10, 18, 26, 34, 42, 50, 56]) {
  await d.page.mouse.move(TX, TY);
  await d.page.mouse.down();
  await d.page.mouse.move(TX + ACROSS, TY + dy);
  await d.page.waitForTimeout(150);
  await d.page.evaluate(() => { window.__drive.speed = 90 / 3.6; window.__drive.heading = 0; });
  const t0 = await d.page.evaluate(() => window.__clock().simS);
  const v0 = await d.page.evaluate(() => window.__drive.speed);
  await d.simWait(0.3);
  const t1 = await d.page.evaluate(() => window.__clock().simS);
  const [v1, i] = await d.page.evaluate(() => [window.__drive.speed, window.__input()]);
  await d.page.mouse.up();
  const a = (v0 - v1) / Math.max(t1 - t0, 0.01);
  console.log(`  ${String(dy).padStart(3)}px   ${(i.brakeF ?? (i.brake ? 1 : 0)).toFixed(2)}`
    + `    ${a.toFixed(1).padStart(5)} m/s2   ${(a / 9.81).toFixed(2).padStart(4)}g    ${Math.abs(i.steer).toFixed(2)}`);
  await d.simWait(0.3);
}

// The original complaint, directly: a small pull from a cruise, held. It should
// be slower, not stopped.
for (const [label, dy] of [['small pull', 14], ['firm pull', 50]]) {
  await d.page.mouse.move(TX, TY);
  await d.page.mouse.down();
  await d.page.mouse.move(TX + ACROSS, TY + dy);
  await d.page.waitForTimeout(150);
  await d.page.evaluate(() => { window.__drive.speed = 40 / 3.6; });
  await d.simWait(1.5);
  const v = await d.page.evaluate(() => window.__drive.speed);
  await d.page.mouse.up();
  console.log(`  ${label} (${dy}px) from 40km/h, held 1.5s -> ${(v * 3.6).toFixed(1)} km/h`);
  await d.simWait(0.4);
}
report(d.errors);
await d.close();
