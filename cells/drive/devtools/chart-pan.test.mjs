/**
 * DOES THE CHART GO WHERE YOUR FINGER PUTS IT?
 *
 *   node cells/drive/devtools/chart-pan.test.mjs
 *
 * A drag on a map has exactly one contract, and it needs no theory to state:
 * the ground you grabbed is still under your finger when you let go. So the
 * test grabs a pixel, reads the world point under it, drags, and reads the
 * world point under the finger's NEW position. Direct manipulation means the
 * two are the same place.
 *
 * Run in both map orientations and on both axes, because the fault this was
 * written for was a MIRRORED gesture — horizontal behaved, vertical inverted —
 * which no single-axis check in north-up would have caught.
 */
import { openDrive, report } from './harness.mjs';

// Default: the Uyuni salt flat. FLAT ON PURPOSE — the chart camera rides at a
// height taken from the ground under its target, so panning across real relief
// moves the view along the tilt axis as well, and a cliff makes the terrain
// under the finger jump. Both are the world behaving, not the gesture
// misbehaving, and they would drown the signal this test is here for.
const spot = process.argv.find((a) => a.startsWith('--spot='))?.slice(7)
  ?? 'lat=-20.1338&lon=-67.4891&h=45&cam=top&z=8&wx=clear';
const d = await openDrive({ spot, tag: 'pan' });
await d.page.waitForTimeout(35000);
// Park it: a rolling truck drags the chart home under you (by design), and
// that is a different behaviour from the one under test.
await d.page.evaluate(() => { window.__drive.speed = 0; });

const W = 390, H = 844;
/** Wait until the ground under a pixel STOPS MOVING. The chart camera rides a
 *  height read from the terrain under its target, so while tiles are still
 *  arriving the whole projection creeps — and a gesture measured across that
 *  creep reads as a gesture that missed. Measured: the first drag of a run
 *  erred 123m and the two identical ones after it 3.5m, with the SAME pan
 *  delta applied all three times. */
async function settleGround(x, y) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const p = await d.page.evaluate(([px, py]) => window.__chartat(px, py), [x, y]);
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) return true;
    last = p;
    await d.page.waitForTimeout(1000);
  }
  return false;
}

async function drag(dx, dy) {
  // AWAY FROM THE TRUCK. The chart centres on the rig and the rig carries an
  // invisible steering zone; a drag that starts on it is meant to steer, not
  // to pan, so the pan contract is tested where a pan is what was asked for.
  const x0 = Math.round(W * 0.24), y0 = Math.round(H * 0.26);
  await d.page.evaluate(() => { window.__drive.speed = 0; });
  await settleGround(x0, y0);
  const floorAt = () => d.page.evaluate(() => {
    const p = window.__pan(), s = window.__drive;
    return { floor: window.__probe(s.x + p.x, s.z + p.z).terrain };
  });
  const before1 = await floorAt();
  const before = await d.page.evaluate(([x, y]) => window.__chartat(x, y), [x0, y0]);
  await d.page.mouse.move(x0, y0);
  await d.page.mouse.down();
  // In steps, the way a finger moves — one big jump is not a drag.
  for (let i = 1; i <= 8; i++) {
    await d.page.mouse.move(x0 + (dx * i) / 8, y0 + (dy * i) / 8);
    await d.page.waitForTimeout(30);
  }
  await d.page.mouse.up();
  await d.page.waitForTimeout(500);
  const after = await d.page.evaluate(([x, y]) => window.__chartat(x, y), [x0 + dx, y0 + dy]);
  const after1 = await floorAt();
  const err = Math.hypot(after[0] - before[0], after[1] - before[1]);
  // HOW COMPARABLE ARE THE TWO SAMPLES. Both are TERRAIN hits, and the drag
  // resolves against a horizontal plane, so where the gesture crosses a
  // coastline or a cliff the two are not measuring the same surface: at Big
  // Sur a westward drag off the coast road leaves the road at +1.4m and lands
  // on seabed at -104m, and 74m of "error" is that step, not the gesture. The
  // question stops being answerable there, so the test says so rather than
  // failing on ground it cannot judge.
  // …and the confound is the ground under the chart's TARGET, not under the
  // finger: the camera stands a fixed height above it, so a target that pans
  // across a shoreline takes the whole view down with it.
  const step = Math.abs(after1.floor - before1.floor);
  return { before, after, err, step };
}

let bad = 0;
for (const headingUp of [false, true]) {
  await d.page.evaluate((hu) => window.__mapup(hu ? 'heading' : 'north'), headingUp);
  await d.page.waitForTimeout(600);
  const rot = (await d.page.evaluate(() => window.__pan())).rot;
  console.log(`\n${headingUp ? 'HEADING-UP' : 'NORTH-UP'} (chart turned ${(rot * 180 / Math.PI).toFixed(0)}deg)`);
  for (const [name, dx, dy] of [['drag right', 90, 0], ['drag down', 0, 90], ['drag diagonal', 70, 70]]) {
    const r = await drag(dx, dy);
    // 12m on a ~150m drag. Not zero: the two samples march the heightfield at
    // different pixels, and the pan resolves on the frame after the gesture.
    if (r.step > 25) {
      console.log(`  skip ${name.padEnd(14)} the chart floor moved ${r.step.toFixed(0)}m under the target `
        + `(a shoreline or a cliff) — the camera legitimately descends with it, so the gesture cannot be judged here`);
      continue;
    }
    const ok = r.err < 12;
    if (!ok) bad++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(14)} the grabbed ground ended ${r.err.toFixed(1)}m from the finger`);
  }
}
console.log(bad ? `\n${bad} FAILED — the chart does not follow the finger` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
