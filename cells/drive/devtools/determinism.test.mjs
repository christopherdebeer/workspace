/**
 * HOW FAR CAN A REPLAY COAST BEFORE IT HAS TO BE CORRECTED?
 *
 *   node cells/drive/devtools/determinism.test.mjs
 *
 * Groundwork for recording a drive. The question was whether a tape of inputs
 * could reproduce a run exactly, and the answer, measured three ways, is NO —
 * so this checks the property the workable design actually rests on instead.
 *
 * WHAT WAS TRIED, IN ORDER, AND WHAT EACH ONE RULED OUT.
 *
 * Two identical drives, same spawn, weather and clock pinned, ended 22m apart
 * over 250m. First suspect was the timestep: dt is whatever the frame took, so
 * yaw integrates over different slices. Pinning it (?fixdt) improved the early
 * metres four-fold — 0.68m to 0.14m at 100m — and changed the endgame not at
 * all: 18.9m to 17.6m at 200m. NOT THE TIMESTEP.
 *
 * Second suspect was the test itself. The input schedule was keyed to distance
 * travelled, so the steering transitions land at slightly different sub-step
 * positions in each run — the harness seeding the very epsilon it was
 * measuring. Re-keyed to STEP INDEX, which is what an input tape actually is
 * (step n gets input n), both runs took exactly 1100 steps and finished 136m
 * apart. NOT THE INDEXING EITHER — and worse, not better.
 *
 * What that leaves is the WORLD. At step 50, one second in, driving dead
 * straight with identical throttle and identical dt, the two runs are already
 * 0.14m apart AND MOVING AT DIFFERENT SPEEDS (10.95 against 11.16 m/s).
 * Straight-line motion under identical inputs can only differ if the ground
 * differs — grade, surface class, suspension contact. Weather and clock are
 * pinned and weather is the only sim-relevant randomness there is. So two page
 * loads at one spawn do not put the same ground under the wheels: tiles land
 * in a different order, corridors carve at a different moment, and the rebuild
 * throttle spreads the difference over the first seconds of the drive.
 *
 * AND THE DIVERGENCE IS AN AMPLIFICATION, NOT AN ACCUMULATION: 0.14m at one
 * second, 0.28m at four, 5m at eight, 136m by the end — one run kept its speed
 * through a corner (21.4 m/s) while the other was down to 3.6. That is a
 * discrete event, a wheel finding something. In that regime approximate
 * determinism is worth nothing; it has to be exact or it is noise.
 *
 * …AND THEN THIS TEST PROVED IT BY CONSTRUCTION, WHICH IS THE GOOD NEWS.
 *
 * The harness serves every https request from a SHA1 disk cache, so both runs
 * here get a byte-identical world delivered in near-identical order — the one
 * variable the live measurement could not hold still. Divergence falls by two
 * orders of magnitude: 0.14m to 0.001m at one second, 0.28m to 0.05m at four.
 * Hold the world fixed and the sim very nearly IS deterministic.
 *
 * That matters because it is also the shape of the feature. A recording
 * replayed ON THE SAME DEVICE finds its tiles already cached, which is the
 * warm case measured here and not the cold two-page case — so the honest
 * expectation for on-device replay is centimetres, not metres, and the
 * checkpoints are there to catch the tail rather than to do the work.
 *
 * SO THE DESIGN IS A TAPE THAT IS CORRECTED, NOT A TAPE THAT IS TRUSTED —
 * inputs replayed against periodic state checkpoints, the way netcode
 * reconciles a prediction. Which makes the load-bearing question not "does it
 * stay together" but "how long may a window be before the correction has to
 * land", and that is the number below.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** 4 seconds at the pinned step. Long enough to price a checkpoint interval,
 *  short enough that a headless frame rate can finish it twice. */
const STEPS = 200;
const DRIVER = `(() => {
  const S = window.__drive;
  window.__trace = [];
  // INDEXED BY STEP, which is what a tape is: step n gets input n. With dt
  // pinned one frame is one step, so two runs march in lockstep by construction
  // and anything that differs between them is not the schedule.
  let n = 0;
  const step = () => {
    const steer = n < 60 ? 0 : n < 140 ? 0.45 : -0.35;
    window.__hold(steer, 0.8, 0);
    window.__trace.push([n, S.x, S.z, S.speed]);
    window.__n = n;
    if (++n < ${STEPS}) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})()`;

async function drive(tag) {
  const d = await openDrive({
    spot: 'lat=-30.6944&lon=27.7642&h=90&cam=chase&wx=clear&t=NOON&fixdt=0.02',
    tag, settle: 40000,
  });
  await d.page.evaluate(DRIVER);
  // A pinned step advances one quantum per FRAME and a headless frame is slow,
  // so this waits on the step counter, never on the clock.
  for (let i = 0; i < 200; i++) {
    if (await d.page.evaluate(() => window.__n ?? 0) >= STEPS - 2) break;
    await d.page.waitForTimeout(2000);
  }
  const trace = await d.page.evaluate(() => window.__trace);
  const errs = [...d.errors];
  await d.close();
  return { trace, errs };
}

const errors = [];
const A = await drive('det-a');
const B = await drive('det-b');
errors.push(...A.errs, ...B.errs);

check('both runs recorded the whole course',
  A.trace.length >= STEPS - 2 && B.trace.length >= STEPS - 2,
  { a: A.trace.length, b: B.trace.length });

const gapAt = (n) => {
  const a = A.trace[n], b = B.trace[n];
  return a && b ? Math.hypot(a[1] - b[1], a[2] - b[2]) : null;
};
for (const n of [25, 50, 100, 150, STEPS - 5]) {
  const g = gapAt(n);
  if (g !== null) console.log(`      step ${String(n).padStart(3)} (${(n * 0.02).toFixed(1)}s) — ${g.toFixed(3)}m apart`);
}

// THE CHECKPOINT INTERVAL, PRICED. Half a second is the window the recorder is
// designed around; within it two runs of the same tape must stay inside a
// wheel's width, or a correction would land as a visible jump rather than as a
// nudge. Measured at 0.14m over a whole second, so this has room — and if it
// ever stops having room, the interval is what moves, not the threshold.
const half = gapAt(25);
check(`half a second of tape coasts within a wheel's width (${half?.toFixed(3)}m)`,
  half !== null && half < 0.30, { at: '0.5s', gap: +(half ?? -1).toFixed(3) });

// …AND THE NUMBER TO WATCH. Against the harness's cached world this is
// centimetres; against a live cold stream the same course drifts 136m. The gap
// between those two IS the world's non-determinism, so if this number ever
// climbs, the world has started arriving differently — which is the same bug
// class that let a far-shell tile bake its palette before its cover landed.
const late = gapAt(STEPS - 5);
console.log(`\n      for the record: ${(STEPS * 0.02).toFixed(1)}s of untouched tape drifts ${late?.toFixed(2)}m`);

console.log(bad ? `\n${bad} FAILED` : '\nall good — a window of tape holds, a whole tape does not');
report(errors);
if (bad) process.exitCode = 1;
