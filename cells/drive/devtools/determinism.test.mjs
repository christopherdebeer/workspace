/**
 * THE SAME DRIVE TWICE MUST BE THE SAME DRIVE.
 *
 *   node cells/drive/devtools/determinism.test.mjs
 *
 * The precondition for recording a run and replaying it. A tape of inputs can
 * only reproduce a drive if the same inputs, from the same place, produce the
 * same trajectory — and until this passes, nothing downstream of it is worth
 * building.
 *
 * Measured before any of it was designed, and the answer was no: two identical
 * drives ended 22m apart over 250m, which is off the road and into the veld.
 * The suspect was the timestep. dt is whatever the frame happened to take, so
 * yaw integrates over different slices and the same steering traces a
 * different curve — and the two runs did not even agree on how many frames
 * they took (311 against 314). Pinning dt is what this checks.
 *
 * THE SCHEDULE IS A FUNCTION OF DISTANCE TRAVELLED, NOT OF TIME. Keyed to the
 * clock, the harness's own jitter would be baked into the input stream and the
 * test would be measuring itself. Keyed to the odometer, both runs get the
 * same steering at the same place whatever the frame rate — which is exactly
 * the property a replay needs, so the test is shaped like the feature.
 *
 * The driver lives in the PAGE, on requestAnimationFrame. Driving it from node
 * would put a round trip between reading the odometer and setting the wheel.
 *
 * Weather and clock are pinned: both are legitimately random, and neither is
 * what this is about. Weather is the only sim-relevant randomness there is —
 * of 51 Math.random() calls in the client, 45 are audio, critters, dust and
 * vegetation, which is to say presentation.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** How far the course runs, and where the wheel moves. Short on purpose: the
 *  divergence this is looking for shows up within a few tens of metres of the
 *  first steering input, and a headless frame is expensive. */
const COURSE = 120;
const DRIVER = `(() => {
  const S = window.__drive;
  window.__trace = [];
  // Its own odometer — state carries x/z/heading/speed and nothing cumulative.
  let d = 0, px = S.x, pz = S.z;
  const step = () => {
    d += Math.hypot(S.x - px, S.z - pz); px = S.x; pz = S.z;
    const steer = d < 10 ? 0 : d < 40 ? 0.45 : d < 70 ? -0.5 : d < 100 ? 0.3 : 0;
    window.__hold(steer, d < ${COURSE - 20} ? 0.8 : 0, d > ${COURSE - 20} ? 0.4 : 0);
    window.__trace.push([d, S.x, S.z, S.speed]);
    window.__odo = d;
    if (d < ${COURSE}) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})()`;

async function drive(spot, tag) {
  const d = await openDrive({ spot, tag, settle: 40000 });
  await d.page.evaluate(DRIVER);
  // A pinned step advances the sim one quantum per FRAME, and a headless frame
  // is slow — so this waits on the odometer, never on the clock.
  for (let i = 0; i < 400; i++) {
    if (await d.page.evaluate(() => window.__odo ?? 0) > COURSE - 2) break;
    await d.page.waitForTimeout(2000);
  }
  const trace = await d.page.evaluate(() => window.__trace);
  const errs = [...d.errors];
  await d.close();
  return { trace, errs };
}

/** Both runs sampled at the same ODOMETER marks, so the comparison is between
 *  the same points on the course rather than the same instants. */
const at = (tr, m) => {
  for (let i = 1; i < tr.length; i++) if (tr[i][0] >= m) return tr[i];
  return tr[tr.length - 1];
};

const errors = [];
// A pinned timestep, which is the whole point. Without fixdt this same course
// diverges by metres — see the note above.
const SPOT = 'lat=-30.6944&lon=27.7642&h=90&cam=chase&wx=clear&t=NOON&fixdt=0.02';
const A = await drive(SPOT, 'det-a');
const B = await drive(SPOT, 'det-b');
errors.push(...A.errs, ...B.errs);

check('both runs completed the course',
  A.trace.at(-1)?.[0] > COURSE - 5 && B.trace.at(-1)?.[0] > COURSE - 5,
  { a: +(A.trace.at(-1)?.[0] ?? 0).toFixed(1), b: +(B.trace.at(-1)?.[0] ?? 0).toFixed(1) });

let worst = 0, worstAt = 0;
for (const m of [20, 40, 60, 80, 100, COURSE - 5]) {
  const a = at(A.trace, m), b = at(B.trace, m);
  if (!a || !b) continue;
  const gap = Math.hypot(a[1] - b[1], a[2] - b[2]);
  if (gap > worst) { worst = gap; worstAt = m; }
  console.log(`      ${String(m).padStart(4)}m driven — the two runs are ${gap.toFixed(3)}m apart`);
}
// A HAND'S BREADTH OVER A HUNDRED METRES. Not zero: the two runs still take
// different NUMBERS of steps (the sim advances one fixed quantum per frame,
// and a headless frame rate wanders), so they are compared at matched
// odometer marks rather than matched steps, and the sampling itself costs a
// few centimetres. What must not survive is drift that GROWS.
check(`the same drive twice stays together (worst ${worst.toFixed(3)}m at ${worstAt}m)`,
  worst < 0.25, { worst: +worst.toFixed(3), at: worstAt });

console.log(bad ? `\n${bad} FAILED` : '\nall good — a drive is repeatable, so it can be recorded');
report(errors);
if (bad) process.exitCode = 1;
