/**
 * A TILE MAY NOT HOLD THE FRAME.
 *
 *   node cells/drive/devtools/build-budget.test.mjs
 *   REV=<sha> node cells/drive/devtools/build-budget.test.mjs    # the old way
 *
 * Measured on a phone, mid-drive: stalls of 160-450ms, and the split said
 * inRender 5-16ms of them. The draw was never the problem — the tile build
 * was, running to completion inside whatever frame it landed in and adding
 * 8-15 objects at a time. Nothing bounded it, anywhere.
 *
 * So the claim is not "the game is fast". It is that BUILDING A TILE NO LONGER
 * STOPS THE WORLD — the work is sliced across frames — and that slicing it did
 * not cost the world itself, which is the failure mode worth fearing: a build
 * that yields can be re-entered, and renderWays keeps a module-level ribbon
 * batch that a second entry would throw away.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const rev = process.env.REV ?? '';
// Cape Town's corridor: dense enough that tiles carry real work, and the same
// ground every other tool here measures.
const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON',
  tag: `budget${rev ? '-old' : ''}`, rev, settle: 6000,
});

// Watch the frames WHILE tiles land, which is the only moment the fault
// exists. __frames is a ring of raw samples, so read it after the streaming.
// POLLED, not sampled once. This harness renders in software at well under
// 1fps, so "is there road under the car right now" is a coin toss at any
// single instant — an earlier cut of this test flaked on exactly that. What
// matters is that the road ARRIVES, so wait for it and fail only if it never
// does.
let worst = 0, over100 = 0, n = 0;
let field = null;
for (let i = 0; i < 20; i++) {
  await d.page.waitForTimeout(2000);
  const f = await d.page.evaluate(() => window.__frames());
  if (f.worstMs > worst) worst = f.worstMs;
  over100 = Math.max(over100, f.over33);
  n = f.n;
  field = await d.page.evaluate(() => window.__field());
  if (field.state === 'done' && (field.segsNear ?? 0) > 0) break;
}
const gpu = await d.page.evaluate(() => window.__gpu());

// The world still has to arrive — a budget that starves the build is not a fix.
check('the tile under the car built', field.state === 'done' && field.ways > 0, field);
check('…and its roads reached the ground', (field.segsNear ?? 0) > 0, field.segsNear);
check('…and the map knows them', (field.mapKnown ?? 0) > 0, field.mapKnown);
check('…and geometry actually exists to draw', gpu.tris > 0 && gpu.calls > 0, gpu);

// THE MECHANISM, because the BENEFIT cannot be measured here. This harness
// renders in software at well under 1fps — worst frames of 1.6-1.7s, on the
// old build and the new one alike — so a frame-time assertion would be
// measuring the environment, not the change. What is testable is that the
// build hands the thread back at all, and how long it holds it between
// yields; the frame-rate win itself is measured on a device, through the
// probe channel, which is where the fault was found in the first place.
const build = gpu.build ?? {};
check('THE BUILD SLICES rather than running to completion in one go',
  (build.yields ?? 0) > 0, build);
check('…and never holds the thread far past its slice',
  (build.longestMs ?? 0) < 120, build);
console.log(`      ${build.yields} yields, longest hold ${build.longestMs}ms`
  + ` | worst frame ${worst}ms over ${n} samples (software render, not the change)`);
const roadPlan = gpu.roadPlan ?? {};
check('the road planner ran through its measured path',
  (roadPlan.syncJobs ?? 0) + (roadPlan.jobs ?? 0) > 0, roadPlan);
check('the road profile worker did not fall back or fail',
  (roadPlan.fallbacks ?? 0) === 0 && (roadPlan.failures ?? 0) === 0, roadPlan);

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
