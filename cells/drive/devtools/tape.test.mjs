/**
 * A RECORDED DRIVE MUST DRIVE ITSELF AGAIN.
 *
 *   node cells/drive/devtools/tape.test.mjs
 *
 * Record a run, replay it through the simulation, and compare the two tracks
 * metre by metre. Everything else about the tape — its size, its format, where
 * it is stored — is a detail beside this.
 *
 * WHY IT IS A TAPE THAT IS CORRECTED RATHER THAN ONE THAT IS TRUSTED, in one
 * line: two identical drives from one spawn, inputs keyed to step index so the
 * schedule cannot drift, finish 136m apart, because two page loads do not put
 * the same ground under the wheels. determinism.test.mjs has the whole trail.
 * So the replay re-simulates — the truck leans and slides and throws dust as
 * it did — and a state checkpoint every half second stops the error
 * compounding. THE DRIFT AT THOSE CHECKPOINTS IS THE NUMBER THAT MATTERS, and
 * the tape reports it rather than quietly swallowing it.
 *
 * The recording is made THROUGH __hold, which sets the same held input a thumb
 * would, so the tape is written from the ordinary input path and not from a
 * back door that only the test can reach.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const STEPS = 200;
/** Drives a course and logs where the truck went, whether it is being recorded
 *  or replayed — the same instrument on both passes, so a difference between
 *  the tracks is a difference in the DRIVING and not in the measuring. */
const WATCH = `(() => {
  const S = window.__drive;
  window.__trace = [];
  window.__done = false;
  let n = 0;
  const step = () => {
    if (window.__driveMe) {
      const steer = n < 60 ? 0 : n < 140 ? 0.45 : -0.35;
      window.__hold(steer, 0.8, 0);
    }
    window.__trace.push([S.x, S.z, S.speed]);
    if (++n >= ${STEPS}) { window.__done = true; return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
})()`;

const d = await openDrive({
  spot: 'lat=-30.6944&lon=27.7642&h=90&cam=chase&wx=clear&t=NOON&fixdt=0.02',
  tag: 'tape', settle: 40000,
});
const page = d.page;
const settle = async () => {
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => window.__done === true)) break;
    await page.waitForTimeout(2000);
  }
};

// THE WORLD HAS TO HAVE FINISHED ARRIVING. A tape started while tiles are
// still landing records a drive over ground that was changing underneath it.
for (let i = 0; i < 40; i++) {
  if (await page.evaluate(() => window.__tape().quiet)) break;
  await page.waitForTimeout(3000);
}
check('the world went quiet, so a tape is eligible',
  await page.evaluate(() => window.__tape().quiet), await page.evaluate(() => window.__tape()));

const started = await page.evaluate(() => window.__rec(true));
check('recording started', started.ok === true, started);

await page.evaluate((w) => { window.__driveMe = true; eval(w); }, WATCH);
await settle();
const live = await page.evaluate(() => window.__trace);
const stopped = await page.evaluate(() => window.__rec(false));
check('recording stopped and banked',
  stopped.ok === true && stopped.steps >= STEPS - 5, stopped);
console.log(`      ${stopped.steps} steps, ${stopped.secs}s, ${stopped.bytes} bytes`
  + ` — ${(stopped.bytes / Math.max(0.01, stopped.secs) * 3600 / 1e6).toFixed(2)} MB/hour`);

// Hands off the wheel: the tape drives now.
await page.evaluate(() => { window.__driveMe = false; window.__hold(0, 0, 1); });
await page.waitForTimeout(6000);
const playing = await page.evaluate(() => window.__play());
check('the tape played back', playing.ok === true, playing);
check('and it is the build that recorded it', playing.sameBuild === true, playing);

await page.evaluate((w) => { eval(w); }, WATCH);
await settle();
const again = await page.evaluate(() => window.__trace);
const tape = await page.evaluate(() => window.__tape());

// THE COMPARISON. Sampled at matched step indices, because both passes ran the
// same number of steps by construction — the replay takes its timestep from
// the tape, so it cannot run at a different rate than the recording did.
const n = Math.min(live.length, again.length);
let worst = 0, worstAt = 0;
for (let i = 0; i < n; i++) {
  const g = Math.hypot(live[i][0] - again[i][0], live[i][1] - again[i][1]);
  if (g > worst) { worst = g; worstAt = i; }
}
for (const i of [25, 50, 100, 150, n - 5]) {
  if (i < n && i > 0) {
    const g = Math.hypot(live[i][0] - again[i][0], live[i][1] - again[i][1]);
    console.log(`      step ${String(i).padStart(3)} (${(i * 0.02).toFixed(1)}s) — replay is ${g.toFixed(3)}m off the run it is replaying`);
  }
}

check(`the replay drives the run it recorded (worst ${worst.toFixed(3)}m at step ${worstAt})`,
  n >= STEPS - 5 && worst < 1.0, { worst: +worst.toFixed(3), at: worstAt, steps: n });
// …and the checkpoints were not carrying it. If this climbs, the replay has
// stopped re-simulating and started being dragged, which is the failure the
// whole design is arranged to make visible rather than to hide.
check(`the checkpoints nudged rather than hauled (worst ${tape.worstDrift}m)`,
  tape.worstDrift < 0.5, tape);

report(d.errors);
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — a run can be recorded and driven again');
if (bad) process.exitCode = 1;
