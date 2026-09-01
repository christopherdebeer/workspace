/**
 * THE DOCK'S SKY IS HUNG ON THE DOCK'S EYE.
 *
 *   node cells/drive/devtools/dock-sky.test.mjs
 *
 * Reported from the chart: "as I zoom the main viewport in and out I can see
 * the sky lifting and dropping" in the POV dock. The dock previews the seat a
 * tap drops you back into — the truck has not moved and neither has the POV
 * camera, so nothing in that little window is a function of how far out the
 * CHART is pulled.
 *
 * It was, because the sky is not in the world. The dome is a 20km shell hung
 * around ONE eye, and all three of its numbers — centre, scale, and the cloud
 * deck's ray origin — were set from the main camera once a frame and then
 * inherited by the dock's blit of the same scene. At reading zoom that put the
 * dome's centre 3km above a preview standing at 1.3m; at the widest zoom, 80km.
 *
 * So the law is a distance, and it is zero:
 *
 *   AT THE DOCK'S RENDER, THE DOME IS ON THE DOCK'S EYE, AT EVERY CHART ZOOM.
 *
 * `__docksky` reports it from inside `blitPixelated` — at the render, not
 * beside the assignment, because a value asserted next to where it is set
 * proves nothing. `rev` runs the identical measurement against the build
 * before the fix: a regression test that does not fail on the bug it names is
 * decoration.
 */
import { openDrive, report, CELL, ROOT } from './harness.mjs';
import { writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// A fixture world, so this costs no network and the same ground is under the
// truck every run. NOON because the dome's numbers are the point and a night
// sky hides its own faults.
const SPOT = 'fixture=crossroads&cam=chase&time=NOON';
const ZOOMS = [40, 200, 600];

const errors = [];

/**
 * The old build has no `__docksky` — it has the bug the probe was written to
 * name — so the control gets one grafted in, reporting the same four numbers:
 * where the dome stands and where the dock's eye stands, in a frame the dock
 * was drawn in. Nothing in that build moves the dome after the chart camera
 * sets it, so this is exactly what its blit saw.
 *
 * NOT the harness's `shim`, which appends: almost all of main.ts lives inside
 * one route branch, and `miniCam` and `skyDome` are its locals — a probe past
 * the closing brace cannot see either of them, which is a ReferenceError at
 * the first read. It goes in just INSIDE that brace instead.
 */
const PROBE = `
;(window).__docksky = () => ({
  camY: +miniCam.position.y.toFixed(2),
  domeY: +skyDome.position.y.toFixed(2),
  scale: +skyDome.scale.x.toFixed(3),
  gap: Math.round(Math.abs(skyDome.position.y - miniCam.position.y)),
});
`;
const BLOCK_END = '} // HYDRO_LAB route branch';
// Beside the real main.ts, because main.ts imports ./menu and ./overlays by
// relative path — a copy bundled out of a temp directory resolves neither.
const OLD_SRC = join(CELL, 'client/__docksky-rev.ts');
/**
 * A PINNED COMMIT, NOT `HEAD`. This read HEAD when it was written, which is
 * only correct while the fix is uncommitted — and road-hole.test.mjs was
 * caught by exactly that: its fix was committed between the two boots, so its
 * control built the FIXED code, reported it as the before, and passed
 * vacuously. `ef99d69` is the commit before aimSky existed.
 */
const CONTROL_REV = 'ef99d69';

function buildControl() {
  const src = execSync(`git show ${CONTROL_REV}:cells/drive/client/main.ts`,
    { cwd: ROOT, maxBuffer: 64e6 }).toString();
  const at = src.lastIndexOf(BLOCK_END);
  if (at < 0) throw new Error(`cannot graft the probe: no ${JSON.stringify(BLOCK_END)} in ${CONTROL_REV}'s main.ts`);
  writeFileSync(OLD_SRC, src.slice(0, at) + PROBE + src.slice(at));
  return OLD_SRC;
}

/** One boot: sit in a seat, chart, then read the dock's sky at each zoom. */
async function run(rev) {
  const d = await openDrive({
    spot: SPOT, tag: `dock-sky-${rev ? 'before' : 'after'}`,
    settle: 7000, bootTimeout: 90000, ...(rev ? { src: buildControl() } : {}),
  });
  await d.page.waitForTimeout(3000);
  // `lastPov` is what the dock previews, and it is only set by sitting in a
  // seat — chart straight from boot and the dock shows the default.
  await d.page.evaluate(() => window.__cam('chase'));
  await d.page.waitForTimeout(1200);
  await d.page.evaluate(() => window.__cam('top'));
  await d.page.waitForTimeout(2500);

  const seen = [];
  for (const z of ZOOMS) {
    await d.page.evaluate((zz) => window.__zoom(zz), z);
    // The zoom EASES, so the chart camera is still climbing for a while after
    // the target is set; read the sky once it has arrived, not on the way.
    await d.page.waitForTimeout(2500);
    seen.push({ z, chartY: Math.round((await d.page.evaluate(() => window.__camPos()))[1]),
      ...(await d.page.evaluate(() => window.__docksky())) });
  }
  errors.push(...d.errors);
  await d.close();
  return seen;
}

const after = await run('');
console.log('');
for (const s of after) {
  console.log(`after   z${String(s.z).padEnd(4)} chart ${String(s.chartY).padStart(6)}m up  `
    + `dock eye ${String(s.camY).padStart(7)}m  dome ${String(s.domeY).padStart(9)}m  `
    + `scale ${s.scale}  gap ${s.gap}m`);
}
console.log('');

check('the chart climbs hard across these zooms (so there is a fault to catch)',
  after[after.length - 1].chartY > after[0].chartY * 4,
  after.map((s) => s.chartY));
check('the dock is previewing a seat, not the chart camera',
  after.every((s) => s.camY > 0 && s.camY < 200), after.map((s) => s.camY));
check('the dome sits on the dock\'s own eye at every zoom',
  after.every((s) => s.gap <= 1), after.map((s) => ({ z: s.z, gap: s.gap })));
check('and at its natural 20km radius, not the chart\'s inflated one',
  after.every((s) => Math.abs(s.scale - 1) < 0.001), after.map((s) => s.scale));

// ── the control: the same measurement on the build before the fix ──
let before;
try {
  before = await run('HEAD');
} finally {
  // Or a stray __docksky-rev.ts is left in the cell — and cell-sync push sends
  // every file in the cell.
  rmSync(OLD_SRC, { force: true });
}
console.log('');
for (const s of before) {
  console.log(`before  z${String(s.z).padEnd(4)} chart ${String(s.chartY).padStart(6)}m up  `
    + `dock eye ${String(s.camY).padStart(7)}m  dome ${String(s.domeY).padStart(9)}m  `
    + `scale ${s.scale}  gap ${s.gap}m`);
}
console.log('');

check('…and before the fix the dome followed the CHART, kilometres off',
  before.some((s) => s.gap > 1000), before.map((s) => ({ z: s.z, gap: s.gap })));
check('…by more the further the chart was pulled out, which is the lift and drop',
  before[before.length - 1].gap > before[0].gap * 4,
  before.map((s) => ({ z: s.z, gap: s.gap })));

console.log(bad ? `\n${bad} FAILED` : '\nall good — the dock previews the seat, not the chart');
report(errors);
if (bad) process.exitCode = 1;
