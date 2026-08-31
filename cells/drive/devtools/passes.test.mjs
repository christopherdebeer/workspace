/**
 * A DIAL SET TO OFF MUST NOT STILL COST WHAT ON COSTS.
 *
 *   node cells/drive/devtools/passes.test.mjs
 *
 * The composite runs a fixed chain of full-screen passes every frame: four
 * depth-of-field blurs, a bright pass, two bloom blurs, the final composite,
 * and a motion-blur pass when the shutter is open. The bloom dial set `uBloom`
 * to zero and left its three passes running — so BLOOM: OFF paid in full and
 * got a result the composite then multiplied by zero.
 *
 * This matters more on a phone than the pass sizes suggest. A tile-based GPU
 * pays a fixed cost to begin and end each pass whatever its area, which is the
 * best explanation on the table for a frame that costs the same with the world
 * hidden: measured on an iPhone, hiding 82% of the draw calls and 85% of the
 * triangles moved the median frame by 0ms, and the floor is there when parked.
 *
 * THIS TEST ASSERTS THE COUNT, NOT THE FRAME TIME. The harness renders in
 * software at under 1fps, where pass overhead means nothing; whether the count
 * is what sets the floor is measured on a device, through the probe channel.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON&mblur=0',
  tag: 'passes', settle: 6000,
});

const read = async () => {
  await d.page.waitForTimeout(1200);
  return d.page.evaluate(() => window.__passes());
};

// The dial is live, so this is an A/B on one running page.
await d.page.evaluate(() => window.__dial('bloom', 2));
const on = await read();
check('the pass counter is reporting', (on.lastFrame ?? 0) > 0, on);
check('bloom is on for the control', on.bloom > 0, on);

await d.page.evaluate(() => window.__dial('bloom', 0));
const off = await read();
check('BLOOM OFF ACTUALLY SKIPS ITS PASSES', off.lastFrame === on.lastFrame - 3,
  { on: on.lastFrame, off: off.lastFrame });
check('…and the dial really is off', off.bloom === 0, off);

await d.page.evaluate(() => window.__dial('bloom', 2));
const back = await read();
check('turning it back on restores them', back.lastFrame === on.lastFrame,
  { on: on.lastFrame, back: back.lastFrame });
console.log(`      passes per frame: bloom on ${on.lastFrame}, off ${off.lastFrame}`);

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
