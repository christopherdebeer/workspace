/**
 * THE AUTOPILOT, DRIVEN — no browser, no renderer, no terrain service.
 *
 *   node cells/drive/devtools/autopilot.test.mjs
 *
 * A controller cannot be tested by reading it. Every assertion here closes the
 * loop: a stand-in for the game's own arcade bicycle model (thrust, grade
 * gravity, drag, the first-order steering rack and the speed-decayed yaw
 * authority — the `tractionMode === 0` branch of tick(), which is what ships)
 * is integrated at 50Hz under whatever the controller asks for, over synthetic
 * ground whose right answer is known in closed form.
 *
 * SYNTHETIC ON PURPOSE. A captured hillside cannot say what speed a corner
 * SHOULD have been taken at. A circular arc of radius R under μ can: it is
 * √(latMargin·μg/κ), and a controller that exceeds it is one that would have
 * run wide on the real thing.
 *
 * The interesting assertions are the CONTRASTS, because a single number is
 * usually just the tune restated. Same corner, flat and downhill: the descent
 * must brake earlier, and that is g·sinθ off the deceleration budget, not a
 * constant somebody picked. Same corner, tarmac and dirt: entry speed must
 * fall with √μ. Straight then corner: it must have been FAST on the straight,
 * or "arrived slowly" proves nothing.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'autopilot-'));
const built = join(tmp, 'autopilot.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/autopilot.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const A = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── the game's own numbers, so the stand-in is not a different vehicle ──
const CAR = { accel: 16, brake: 26, maxRev: 9, wheelbase: 2.9, steerMax: 0.6 };
const SURF = {
  road: { max: 50, drag: 0.28, mu: 1.05 },
  ground: { max: 32, drag: 0.5, mu: 0.6 },
};
const G = 9.81;

/** The corner speed the physics actually permits, in closed form. */
const vCorner = (r, mu, T = A.AUTO) => Math.sqrt((T.latMargin * mu * G) * r);

// ── courses ──
const straight = (len, step = 20) => {
  const p = [];
  for (let d = 0; d <= len; d += step) p.push([0, -d]);   // due north: −z is forward
  return p;
};
/**
 * A straight run-in of `lead` metres, then a constant-radius left arc that
 * CONTINUES it.
 *
 * The sweep is −sin, and that is not cosmetic. Written the other way round,
 * the arc's tangent leaves the junction pointing back up the straight — a 180°
 * reversal, which the controller read as a four-metre corner and braked to
 * walking pace for. It was right to. The course was wrong.
 */
function straightThenArc(lead, r, sweep = Math.PI / 2, step = 8) {
  const p = [];
  for (let d = 0; d <= lead; d += step) p.push([0, -d]);
  // Travel is −z, so the left of travel is −x: that is where the centre goes.
  const cx = -r, cz = -lead;
  for (let a = 0; a <= sweep; a += step / r) {
    p.push([cx + r * Math.cos(a), cz - r * Math.sin(a)]);
  }
  return p;
}
const arc = (r, sweep, step = 6) => {
  const p = [];
  for (let a = 0; a <= sweep; a += step / r) p.push([-r + r * Math.cos(a), r * Math.sin(a) - 0]);
  return p;
};

/** Flat tarmac. */
const flat = (mu = SURF.road.mu) => ({ height: () => 0, grip: () => mu });
/**
 * A constant grade along −z, the direction the courses run. `s` is rise per
 * metre TRAVELLED, so negative is downhill — and the sign matters twice over:
 * written the other way round this fixture is a climb, the plan brakes LATER
 * (uphill gravity helps you stop), and the test reads as the controller
 * getting the grade term backwards when it was the ground that was upside
 * down.
 */
const slope = (s, mu = SURF.road.mu) => ({ height: (x, z) => -z * s, grip: () => mu });

/**
 * The arcade bicycle model, as tick() runs it. Not the tyre model — the
 * shipped default is `tractionMode === 0`, and that is the branch every
 * campaign number is tuned against.
 */
function sim(course, ground, opts = {}) {
  const T = opts.tune ?? A.AUTO;
  const surf = opts.surf ?? SURF.road;
  const dt = 1 / 50;
  const rig = { x: opts.x0 ?? 0, z: opts.z0 ?? 0, heading: opts.h0 ?? 0, speed: opts.v0 ?? 0 };
  const mem = A.autoMem();
  mem.lastHeading = rig.heading;
  let steerCur = 0;
  const log = [];
  const steps = Math.round((opts.secs ?? 60) / dt);
  for (let n = 0; n < steps; n++) {
    const out = A.autoDrive(rig, course, ground, mem, dt, { endsHere: !!opts.endsHere }, T);
    log.push({ t: n * dt, x: rig.x, z: rig.z, v: rig.speed, ...out });
    if (opts.pinned) continue;                       // a truck against a wall
    const thrust = out.brake
      ? -Math.sign(rig.speed) * CAR.brake * 1.4 * out.brakeF
      : out.throttle >= 0 ? out.throttle * CAR.accel : out.throttle * CAR.brake;
    rig.speed += thrust * dt;
    // Grade gravity, off the ground the truck is actually on.
    const fx = Math.sin(rig.heading), fz = -Math.cos(rig.heading);
    const rise = ground.height(rig.x + fx, rig.z + fz) - ground.height(rig.x, rig.z);
    rig.speed -= G * Math.sin(Math.atan(rise)) * dt;
    rig.speed -= rig.speed * surf.drag * dt;
    if (out.brake && out.brakeF > 0.5 && Math.abs(rig.speed) < 1.2) rig.speed = 0;
    rig.speed = Math.max(-CAR.maxRev, Math.min(surf.max, rig.speed));
    steerCur += Math.max(-7 * dt, Math.min(7 * dt, out.steer - steerCur));
    if (Math.abs(rig.speed) > 0.1) {
      const authority = 1 / (1 + Math.abs(rig.speed) / 12);
      rig.heading += (steerCur * CAR.steerMax * authority * rig.speed) / CAR.wheelbase * dt;
    }
    rig.x += Math.sin(rig.heading) * rig.speed * dt;
    rig.z -= Math.cos(rig.heading) * rig.speed * dt;
  }
  return log;
}

/** Cross-track distance of a logged position from a course, unsigned. */
const offOf = (course, e) => Math.abs(A.seekPath(A.resample(course, A.AUTO.step), e.x, e.z).off);
/**
 * Only the frames that are still ON the course.
 *
 * A fixture's course is a fixed array and it runs out; the game's does not —
 * `wayAhead` re-supplies the road ahead every frame, and a leg's course runs
 * to its destination. So what the truck does after the last vertex is a
 * property of the fixture, not of the controller, and folding it into a
 * cross-track maximum would fail every one of these on an artefact.
 */
function onCourse(course, log, margin = 20) {
  const path = A.resample(course, A.AUTO.step);
  const total = A.pathLength(path);
  return log.filter((e) => A.seekPath(path, e.x, e.z).along < total - margin);
}

console.log('── the pieces ──');
{
  // Spacing is measured on a SMOOTH course. Across a hard vertex the gap is a
  // chord and legitimately shorter than the step — resampling walks arc length,
  // and asserting otherwise would be asserting that corners do not cut.
  const p = A.resample(arc(80, Math.PI * 0.8), 8);
  const gaps = [];
  for (let i = 1; i < p.length - 1; i++) gaps.push(Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  check('resample lays a constant step', gaps.every((g) => near(g, 8, 0.06)),
    gaps.map((g) => +g.toFixed(3)));
  // …and it must not LOSE the course while doing it: a resample that quietly
  // drops the tail shortens every plan that reads to the end of one.
  // Across a hard vertex the resample cuts the corner, and the length it loses
  // is bounded by that — but it must never lose the TAIL, because a plan that
  // reads to the end of a course would then stop short of the destination.
  const raw = [[0, 0], [0, -37], [61, -37]];
  const rs = A.resample(raw, 8);
  const tip = rs[rs.length - 1];
  check('…and keeps the far end exactly',
    near(tip[0], 61, 1e-9) && near(tip[1], -37, 1e-9), tip);
  check('…losing only what one corner cuts',
    A.pathLength(raw) - A.pathLength(rs) < 8, +(A.pathLength(raw) - A.pathLength(rs)).toFixed(2));

  // A circle's curvature is 1/R, and that is the number the speed plan divides
  // into μg — so an error here is an error in every corner speed.
  const c = A.resample(arc(50, Math.PI), 8);
  const ks = [];
  for (let i = 2; i < c.length - 2; i++) ks.push(A.curvatureAt(c, i));
  const kMean = ks.reduce((a, b) => a + b, 0) / ks.length;
  check('curvature of a 50m arc reads 1/50', near(kMean, 1 / 50, 0.0012), +kMean.toFixed(5));
  check('…and a straight reads zero',
    A.resample(straight(200), 8).slice(2, -2).every((_, i) => A.curvatureAt(A.resample(straight(200), 8), i + 2) < 1e-6), null);

  const s = A.seekPath([[0, 0], [0, -100]], 7, -50);
  check('cross-track is signed to the RIGHT of travel', near(s.off, 7, 0.001), s.off);
}

console.log('\n── holding a line ──');
{
  const c = straight(1400);
  const log = sim(c, flat(), { secs: 55 });
  const settled = onCourse(c, log).filter((e) => e.t > 4);
  const worst = Math.max(...settled.map((e) => offOf(c, e)));
  check('a straight is held to under a metre', settled.length > 0 && worst < 1.0, +worst.toFixed(3));
  const vEnd = log[log.length - 1].v;
  check('…at the ceiling it was told to hold', near(vEnd, A.AUTO.vMax, 1.5), +vEnd.toFixed(2));
}
{
  // Twelve metres off, pointing straight down the course — the geometry that
  // makes a naive proportional controller weave.
  const c = straight(1400);
  const log = sim(c, flat(), { secs: 45, x0: 12 });
  const back = log.find((e) => e.t > 2 && offOf(c, e) < 1.5);
  check('twelve metres off, it converges', !!back && back.t < 18, back ? +back.t.toFixed(1) : null);
  const after = log.filter((e) => back && e.t > back.t);
  const over = after.length ? Math.max(...after.map((e) => offOf(c, e))) : Infinity;
  check('…and does not weave once it is back', over < 3.0, +over.toFixed(3));
}

console.log('\n── the speed plan ──');
{
  const R = 60;
  const c = arc(R, Math.PI * 0.9);
  const log = sim(c, flat(), { secs: 60, h0: Math.PI });
  const settled = onCourse(c, log).filter((e) => e.t > 6);
  const worst = Math.max(...settled.map((e) => offOf(c, e)));
  const vTop = Math.max(...settled.map((e) => e.v));
  const lim = vCorner(R, SURF.road.mu);
  check(`a ${R}m arc is held on the line`, worst < 4.0, +worst.toFixed(2));
  check('…and never above the speed the tyres allow there',
    vTop <= lim * 1.15, { vTop: +vTop.toFixed(2), lim: +lim.toFixed(2) });
}
{
  // THE ONE THAT MATTERS. Fast on the straight, slow at the corner — and the
  // first half is what makes the second half mean anything.
  const R = 40, LEAD = 420;
  const c = straightThenArc(LEAD, R);
  const log = sim(c, flat(), { secs: 70 });
  const path = A.resample(c, A.AUTO.step);
  const entry = log.find((e) => A.seekPath(path, e.x, e.z).along >= LEAD);
  const before = log.filter((e) => A.seekPath(path, e.x, e.z).along < LEAD - 60);
  const vFast = Math.max(...before.map((e) => e.v));
  const lim = vCorner(R, SURF.road.mu);
  check('it ran the straight at speed', vFast > 20, +vFast.toFixed(2));
  check('…and arrived at the corner already slow enough',
    !!entry && entry.v <= lim * 1.15, entry ? { v: +entry.v.toFixed(2), lim: +lim.toFixed(2) } : null);
  const inCorner = onCourse(c, log).filter((e) => A.seekPath(path, e.x, e.z).along >= LEAD);
  const worst = inCorner.length ? Math.max(...inCorner.map((e) => offOf(c, e))) : Infinity;
  check('…and stayed on the road through it', worst < 5.0, +worst.toFixed(2));
}
{
  // GRADE. The same corner at the bottom of a 10% descent. Braking downhill is
  // worse by g·sinθ, so the plan must start it further out.
  // A TIGHTER CORNER THAN THE OTHERS, on purpose. At r=40 the envelope only
  // bites in the last twenty metres, and comparing two runs that are both
  // still at cruise compares nothing. At r=20 both are on the brakes where
  // they are read, which is where the grade term lives.
  const R = 20, LEAD = 420;
  const c = straightThenArc(LEAD, R);
  const path = A.resample(c, A.AUTO.step);
  // "BRAKES EARLIER", stated as something measurable. On a descent the truck
  // is ALSO braking against gravity to hold its ceiling, so "the first brake
  // application" says nothing at all. What does: at a fixed distance out it is
  // already slower, and it still arrives at the same corner speed. Together
  // those are the whole claim, and neither is a constant I picked.
  // Measured on the PLAN rather than on the achieved speed, because gravity
  // also raises the descent's cruise: it arrives at the braking zone faster,
  // so "is it slower yet" confounds the two. How far out the plan first bites
  // is the claim, and nothing else moves it.
  const planBites = (log, thresh) => {
    const e = log.find((q) => {
      const a = A.seekPath(path, q.x, q.z).along;
      return a > 200 && a < LEAD && q.want < thresh;
    });
    return e ? LEAD - A.seekPath(path, e.x, e.z).along : -1;
  };
  const lvl = sim(c, flat(), { secs: 70 });
  const dn = sim(c, slope(-0.12), { secs: 70 });
  const dLvl = planBites(lvl, 25), dDn = planBites(dn, 25);
  check('downhill, the plan starts shedding further from the corner',
    dDn > dLvl + 8, { flat: +dLvl.toFixed(0), down: +dDn.toFixed(0) });
  const entryDn = dn.find((e) => A.seekPath(path, e.x, e.z).along >= LEAD);
  const lim = vCorner(R, SURF.road.mu);
  check('…and it still arrives at the corner speed',
    !!entryDn && entryDn.v <= lim * 1.2, entryDn ? +entryDn.v.toFixed(2) : null);
}
{
  // GRIP. The same corner on open ground. √μ is the whole story and it should
  // show up as one.
  const R = 40, LEAD = 420;
  const c = straightThenArc(LEAD, R);
  const path = A.resample(c, A.AUTO.step);
  const road = sim(c, flat(SURF.road.mu), { secs: 70 });
  const dirt = sim(c, flat(SURF.ground.mu), { secs: 90, surf: SURF.ground });
  const vAt = (log) => {
    const e = log.find((q) => A.seekPath(path, q.x, q.z).along >= LEAD);
    return e ? e.v : -1;
  };
  const vR = vAt(road), vD = vAt(dirt);
  const limD = vCorner(R, SURF.ground.mu);
  check('on loose ground it takes the same corner slower', vD > 0 && vD < vR - 2,
    { road: +vR.toFixed(2), dirt: +vD.toFixed(2) });
  check('…by about the ratio of the square roots of grip',
    vD <= limD * 1.15, { dirt: +vD.toFixed(2), lim: +limD.toFixed(2) });
}

console.log('\n── when it goes wrong ──');
{
  // A truck against a wall: the throttle is open and nothing moves.
  const log = sim(straight(600), flat(), { secs: 6, pinned: true });
  const rev = log.find((e) => e.mode === 'reverse');
  check('open throttle and no movement is read as stuck', !!rev, rev ? +rev.t.toFixed(2) : null);
  check('…and it backs off with the wheel over',
    !!rev && rev.throttle < 0 && Math.abs(rev.steer) > 0.9, rev ? [rev.throttle, rev.steer] : null);
  check('…after about the time the tune says, not instantly',
    !!rev && rev.t > A.AUTO.stuckS - 0.05 && rev.t < A.AUTO.stuckS + 1.5, rev ? +rev.t.toFixed(2) : null);
}
{
  // Thrown 40m off, well outside the corridor, into a bend — the case where
  // the lookahead points across the inside of the corner.
  const c = straightThenArc(200, 30);
  const log = sim(c, flat(), { secs: 60, x0: 40, z0: -180 });
  const lost = log[0];
  check('outside the corridor it says so', lost.mode === 'recover', lost.mode);
  check('…and crawls while it recovers', lost.want <= 5.01, lost.want);
  const back = log.find((e) => e.t > 1 && e.mode === 'run');
  check('…then rejoins the course', !!back && back.t < 25, back ? +back.t.toFixed(1) : null);
}
{
  // A course that genuinely ENDS — a destination, not the edge of the streamed
  // road. It has to stop, not drive off the end of the data.
  const c = straight(300);
  const log = sim(c, flat(), { secs: 60, endsHere: true });
  const last = log[log.length - 1];
  const path = A.resample(c, A.AUTO.step);
  const left = A.pathLength(path) - A.seekPath(path, last.x, last.z).along;
  check('at the end of a finite course it stops', Math.abs(last.v) < 1.0, +last.v.toFixed(2));
  check('…at the end of it, not short of it and not past it',
    Math.abs(left) < 12, +left.toFixed(1));
}
{
  // …and the same course when it merely ran out of streamed road must NOT be
  // braked for: the road continues, the data does not.
  const c = straight(300);
  const path = A.resample(c, A.AUTO.step);
  const log = sim(c, flat(), { secs: 30, endsHere: false });
  // Read it 25m from the last vertex — where the endsHere run has already
  // stopped — and it must still be travelling.
  const nearEnd = log.find((e) => A.pathLength(path) - A.seekPath(path, e.x, e.z).along < 25);
  check('the edge of the streamed road is not a reason to stop',
    !!nearEnd && nearEnd.v > 8, nearEnd ? +nearEnd.v.toFixed(2) : null);
}

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
