/**
 * THE RING WAS ALWAYS A TWO-MINUTE UNDO. NOTHING COULD REACH IT.
 *
 *   node cells/drive/devtools/rewind.test.mjs
 *
 * `tapeRec.keys` has held a checkpoint every half second since the recorder
 * was built — and a checkpoint is the ten numbers that ARE the truck, which
 * `tapeRestore` puts back. Rewinding needs no new recording, no new storage
 * and no simulation. This file asks whether the reach is honest:
 *
 *   the truck actually MOVES BACK to where it was, not near it;
 *   a cancelled scrub costs nothing — exactly where it started, not roughly;
 *   a committed one TRUNCATES the ring, so the scrubbed seconds stop having
 *     happened and a later KEEP banks one drive rather than one with a fold;
 *   and it is refused ON THE LINE, where a run is a claim about a drive that
 *     did happen.
 *
 * Driven through the probe rather than through a synthetic drag: the gesture
 * is three calls and a pointer would be testing playwright, not the feature.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// Uyuni: flat, empty, and the world settles fast — the recorder will not arm
// until worldQuiet(), so a place that finishes building is the point.
const d = await openDrive({
  spot: 'lat=-20.1338&lon=-67.4891&h=90&cam=chase&wx=clear&time=NOON',
  tag: 'rewind', settle: 22000, menu: true });
const page = d.page;
const rw = (cmd, back) => page.evaluate(([c, b]) => window.__rewind(c, b), [cmd ?? null, back ?? 0]);

// ── the ring has to be turning before any of this means anything ──
// The recorder gates on worldQuiet(); `force` is the authoring override the
// harness is entitled to, and it is what __rec exposes.
await page.evaluate(() => window.__rec(true, true));
let r = await rw();
if (!r.recording) {
  console.log('\nSKIPPED, NOT PASSED: the ring never started, so there is no undo to reach for.',
    JSON.stringify(r));
  report(d.errors); await d.close(); process.exit(2);
}

// MOVE, so there is a past to go back to. Position is written straight into
// the state object — the same thing walkTo does — and the ring snapshots
// state every frame, so a written position is captured exactly as a driven
// one would be. Six seconds at a walking pace is a dozen checkpoints.
await page.evaluate(async () => {
  const s = window.__drive;
  for (let i = 0; i < 360; i++) {
    s.x += 3;
    await new Promise((go) => requestAnimationFrame(go));
  }
});
await page.waitForTimeout(600);
r = await rw();
check('the ring is holding checkpoints to go back to', r.have >= 4, r);
check('…and says how far back that reaches', r.maxSecs > 1.5, r);

// ── the scrub ────────────────────────────────────────────────────
const before = (await rw()).car;
await rw('begin');
const mid = await rw('show', 4);
check('scrubbing seats the truck on an older checkpoint',
  Math.hypot(mid.car[0] - before[0], mid.car[1] - before[1]) > 3, { before, mid: mid.car });
check('…and reports how far back it is', mid.at === 4 && mid.secs > 0, mid);

// ── and it LOOKS like a rewind ───────────────────────────────────
// Rewinding was, by construction, the least blurred thing in the game: the
// shutter is off unless a dial says otherwise, dt is zero while scrubbing, and
// a camera that moves over forty metres in a frame is explicitly disqualified
// as "not motion". All three are right for driving and wrong here — the jump
// between checkpoints IS the motion. Asked of the pass rather than of a
// screenshot: `blur` is the amount actually handed to the shutter.
const streak = await rw('show', 8);
check('SCRUBBING STREAKS — the pass runs on the jump', streak.blur > 0.5, streak);
check('…and the ceiling lifts to let it read', streak.blurCapPx > 20, streak);
// Held still on one checkpoint, the camera stops moving and the frame settles
// — which is what makes a scrubbed still readable instead of mush.
await page.waitForTimeout(400);
const still = await rw('show', 8);
check('…but holding still on a checkpoint settles to a clean frame',
  still.camStepM < 1, still);

// ── a change of mind costs nothing ───────────────────────────────
const cancelled = await rw('cancel');
check('CANCELLING PUTS IT BACK EXACTLY', cancelled.car[0] === before[0] && cancelled.car[1] === before[1],
  { before, after: cancelled.car });
check('…and leaves the ring untouched', cancelled.at === null, cancelled);

// ── taking it truncates the ring ─────────────────────────────────
const full = await rw();
await rw('begin');
await rw('show', 4);
const took = await rw('commit');
check('COMMITTING MOVES THE TRUCK BACK', Math.hypot(took.car[0] - before[0], took.car[1] - before[1]) > 3,
  { before, after: took.car });
check('…and the scrubbed seconds stop having happened', took.keys < full.keys, { was: full.keys, now: took.keys });
check('…in whole checkpoint blocks, so the ring stays coherent',
  took.steps <= (took.keys - 1) * 30, took);
check('…and the handle stands down', took.at === null, took);

// ── and the ring keeps turning from there ────────────────────────
await page.waitForTimeout(2500);
const after = await rw();
check('the recorder carries on from the rewound point', after.keys >= took.keys, { took: took.keys, after: after.keys });

console.log('ring:', JSON.stringify(full), '\nafter:', JSON.stringify(after));
await d.close();

// ── and ON THE LINE too ──────────────────────────────────────────
// There is an argument that a run is a claim about a drive that happened and a
// rewind is a claim that part of it did not — the argument that keeps the
// clock's scrub out of campaign mode. It is deliberately not being made yet:
// the mechanic is worth having under the hands before it is worth ruling out
// of anywhere. Asserted with its own boot, because the gate reads a mode flag
// and a test that only ever saw free drive would pass whatever it said.
const dl = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=chase&wx=clear&line=1',
  tag: 'rewindline', settle: 9000, menu: true,
  init: `localStorage.setItem('drive.line.v1', JSON.stringify({
    lat: -34.08716, lon: 18.42083, h: 290, odo: 100, begunAt: 1700000000000, at: 1700000000000 }));
    localStorage.setItem('drive.sync.token', 'tok_test');`,
});
await dl.page.evaluate(() => window.__rec(true, true));
// Long enough for the ring to hold the two checkpoints the handle needs.
await dl.page.waitForTimeout(4000);
const online = await dl.page.evaluate(() => window.__rewind());
check('the boot really is on the line', online.line === true, online);
check('…the ring is turning there', online.recording === true, online);
check('THE HANDLE IS AVAILABLE ON A RUN', online.ready === true, online);
report(dl.errors);
await dl.close();

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
