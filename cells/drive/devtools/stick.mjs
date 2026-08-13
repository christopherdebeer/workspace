/**
 * WHAT DOES THE CONTROL GATE OFFER A THUMB?
 *
 *   node cells/drive/devtools/stick.mjs [--cx=195 --cy=620]
 *
 * Plants a real pointer and sweeps it around the gate at several reaches,
 * reading `__input()` back at each stop. The questions are the ones a thumb
 * actually asks: sweeping across at a comfortable reach, does the throttle stay
 * put? Can you hold throttle and lock at once? How much lock survives with the
 * throttle shut?
 *
 * THROUGH THE LIVE HANDLERS, deliberately. An earlier version of this drove a
 * pure `__stickAt` map instead, which was faster and exhaustive — and could
 * report a perfect gate while setStickFrom fed it the wrong numbers. Those
 * probes were also removed with the steering experiment they were written for,
 * which is the other half of the argument: a tool aimed at the shipped surface
 * survives a revert, and one aimed at scaffolding does not.
 */
import { openDrive, report } from './harness.mjs';

const args = process.argv.slice(2);
const num = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : Number(a.slice(k.length + 3));
};
const cx = num('cx', 195), cy = num('cy', 620);

const d = await openDrive({ tag: 'stick' });

for (const R of [24, 40, 56]) {
  console.log(`\nreach r=${R}px`);
  console.log('   deg   throttle   steer   brake');
  await d.page.mouse.move(cx, cy);
  await d.page.mouse.down();
  for (const deg of [0, 20, 40, 60, 80, 100, 120, 150, 180]) {
    const a = (deg * Math.PI) / 180;
    await d.page.mouse.move(cx + R * Math.sin(a), cy - R * Math.cos(a));
    await d.page.waitForTimeout(120);
    const i = await d.page.evaluate(() => window.__input());
    const brake = i.brakeF ?? (i.brake ? 1 : 0);
    console.log(`  ${String(deg).padStart(4)}    ${i.throttle.toFixed(2).padStart(5)}`
      + `   ${i.steer.toFixed(2).padStart(5)}   ${brake.toFixed(2).padStart(5)}`);
  }
  await d.page.mouse.up();
  await d.page.waitForTimeout(200);
}

// STRAIGHT DOWN, which is the brake axis, at increasing pull — the shape that
// says whether braking is a magnitude or a switch.
console.log('\nstraight down (the brake axis)');
console.log('   px   throttle   steer   brake');
await d.page.mouse.move(cx, cy);
await d.page.mouse.down();
for (const dy of [8, 16, 24, 32, 40, 48, 56]) {
  await d.page.mouse.move(cx, cy + dy);
  await d.page.waitForTimeout(120);
  const i = await d.page.evaluate(() => window.__input());
  const brake = i.brakeF ?? (i.brake ? 1 : 0);
  console.log(`  ${String(dy).padStart(3)}    ${i.throttle.toFixed(2).padStart(5)}`
    + `   ${i.steer.toFixed(2).padStart(5)}   ${brake.toFixed(2).padStart(5)}`);
}
await d.shot('stick-gate');
await d.page.mouse.up();
report(d.errors);
await d.close();
