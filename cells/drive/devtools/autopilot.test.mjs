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
    // A course may be a FUNCTION of sim time, so a fixture can make the road
    // arrive part way through — which is what a cold tile filling in looks
    // like from the driver's seat, and the case the hold exists for.
    // …AND OF THE RIG, because one course in the game is rebuilt from the truck's
    // own position every frame: the regain line back onto the carriageway. A
    // fixed array cannot express that, and testing it as one measures an orbit
    // around a target that never moves — a property of the fixture, not the code.
    const now = typeof course === 'function' ? course(n * dt, rig) : course;
    const out = A.autoDrive(rig, now, ground, mem, dt,
      { endsHere: !!opts.endsHere, width: opts.width, regain: !!opts.regain }, T);
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
  // The TOP speed, not the last one. Read at the end it comes back low, and
  // correctly so: the plan will not go faster than it could stop within the
  // course it has, so approaching the last vertex it eases off. That is its
  // own assertion below; here the question is only whether it ever gets up to
  // what it was told it could do.
  const vTop = Math.max(...log.map((e) => e.v));
  // Within the P-controller's droop: at the top end the throttle settles where
  // gain·error·accel meets drag, a couple of m/s under the ceiling. That is a
  // proportional controller behaving, not a fault to tune away.
  check('…at the ceiling it was told to hold', vTop > A.AUTO.vMax - 3.2, +vTop.toFixed(2));
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
  // One overshoot of under five metres on a twelve-metre correction at the new
  // speeds — the damping catches it on the next swing.
  check('…and does not weave once it is back', over < 4.5, +over.toFixed(3));
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
    dDn > dLvl + 5, { flat: +dLvl.toFixed(0), down: +dDn.toFixed(0) });
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

console.log('\n── the rally line ──');
{
  // A 90-degree corner with 3.5m of room either side. The raced line must be
  // FLATTER than the centreline — that is the whole claim — while staying
  // inside the corridor and landing both ends exactly where they were.
  const c = A.resample(straightThenArc(120, 30), A.AUTO.step);
  const r = A.raceLine(c, 3.5);
  const kMax = (path) => {
    let k = 0;
    for (let i = 1; i < path.length - 1; i++) k = Math.max(k, A.curvatureAt(path, i));
    return k;
  };
  const kc = kMax(c), kr = kMax(r);
  check('the raced corner is measurably flatter than the centreline',
    kr < kc * 0.9, { centre: +kc.toFixed(4), raced: +kr.toFixed(4) });
  let worstOff = 0;
  for (const [px, pz] of r) worstOff = Math.max(worstOff, Math.abs(A.seekPath(c, px, pz).off));
  check('…without ever leaving the corridor', worstOff <= 3.5 + 0.3, +worstOff.toFixed(2));
  check('…and both ends stay anchored',
    Math.hypot(r[0][0] - c[0][0], r[0][1] - c[0][1]) < 1e-9
    && Math.hypot(r[r.length - 1][0] - c[r.length - 1][0], r[r.length - 1][1] - c[r.length - 1][1]) < 1e-9, null);
  // A straight has no curvature to spend width on: the line stays put.
  const st = A.resample(straight(400), A.AUTO.step);
  const rs = A.raceLine(st, 3.5);
  let moved = 0;
  for (let i = 0; i < rs.length; i++) moved = Math.max(moved, Math.hypot(rs[i][0] - st[i][0], rs[i][1] - st[i][1]));
  check('…and a straight is left exactly alone', moved < 1e-6, moved);
  // The point of it all: the same corner, taken faster. Closed loop, same
  // physics, the only difference is the width the controller is told it has.
  // A SHORT corner with a real exit, because the fixture choice IS the
  // physics: with the road ending at the apex both runs measured their
  // stop-by-the-last-vertex envelope (2.2 m/s, the crawl floor, twice); with
  // a half-circle instead the ideal rally gain is only the fourth root of
  // nothing — a long constant bend offers √((R+w)/R) ≈ 4%. Out-in-out pays
  // on a corner SHORT enough to straighten, with road on both sides of it.
  const cc = straightThenArc(420, 40, Math.PI / 2);
  {
    const [ax, az] = cc[cc.length - 2], [bx, bz] = cc[cc.length - 1];
    const h = Math.hypot(bx - ax, bz - az) || 1;
    for (let d = 8; d <= 260; d += 8) cc.push([bx + ((bx - ax) / h) * d, bz + ((bz - az) / h) * d]);
  }
  const mid = sim(cc, flat(), { secs: 80 });
  const ral = sim(cc, flat(), { secs: 80, width: 4 });
  const path = A.resample(cc, A.AUTO.step);
  // THE CLAIM IS THE LINE, and the speed is only its consequence. At R=40
  // with 4m of room the ideal apex gain is √(k/k') ≈ 9%, and pure pursuit
  // spends most of it steering the dive — instrumented, want rose 15.7→16.2
  // while the realised apex speed washed out. Asserting a speed delta here
  // would assert the fixture, not the driver. What is robustly true, and is
  // what "follows a rally line" MEANS: through the apex the truck leaves the
  // centreline for the inside of the corner — and it must not have got
  // slower for doing so. The corner turns left; right-of-travel is positive;
  // the inside is negative.
  const apexWin = (log) => log.filter((q) => {
    const a = A.seekPath(path, q.x, q.z).along; return a >= 415 && a <= 475;
  });
  const cut = (log) => Math.min(...apexWin(log).map((q) => A.seekPath(path, q.x, q.z).off));
  const apexV = (log) => Math.min(...apexWin(log).map((q) => q.v));
  // RELATIVE, because pure pursuit already cuts: chasing a point 40m down a
  // curved path is chasing a chord, and the centreline run clips ~1.3m of
  // apex all by itself. The rally line's claim is the cut BEYOND that.
  check('through the apex the truck cuts measurably deeper than pursuit alone',
    cut(ral) < cut(mid) - 0.4,
    { rally: +cut(ral).toFixed(2), centreline: +cut(mid).toFixed(2) });
  check('…without giving any speed away for it',
    apexV(ral) > apexV(mid) - 0.8,
    { centreline: +apexV(mid).toFixed(2), rally: +apexV(ral).toFixed(2) });
}

console.log('\n── when the world is not ready ──');
{
  // TWENTY-FIVE METRES OF KNOWN ROAD is what a cold tile looks like from the
  // driver's seat: the way exists, the chain reaches as far as the geometry
  // that has streamed, and no further. Going faster than you could stop in it
  // is driving on ground nothing has been solved for.
  const c = straight(25, 5);
  const log = sim(c, flat(), { secs: 20 });
  const on = onCourse(c, log, 4);
  const worst = on.length ? Math.max(...on.map((e) => e.v)) : Infinity;
  const lim = Math.sqrt(2 * A.AUTO.brakeA * SURF.road.mu * 25);
  check('it does not outdrive the course it has been given',
    worst <= lim * 1.2, { top: +worst.toFixed(2), lim: +lim.toFixed(2) });
  // …and the same run must NOT have been a crawl: the floor keeps it moving,
  // because a truck that stops is a truck that stops asking for the next tile.
  check('…but keeps moving, so the streamer keeps being asked',
    worst > A.AUTO.vMin, +worst.toFixed(2));
}
{
  // NO COURSE AT ALL — the tile has not arrived, or it has and the ribbon is
  // still being built. Coasting through that at speed is the whole failure.
  const log = sim(null, flat(), { secs: 12, v0: 22 });
  check('with no course it holds rather than coasting',
    log[0].mode === 'wait' && log[0].brake === true, log[0]);
  const stopped = log.find((e) => Math.abs(e.v) < 0.5);
  check('…and actually comes to a stop', !!stopped && stopped.t < 8,
    stopped ? +stopped.t.toFixed(1) : null);
  // ON A GRADE is the half that matters: a truck that merely lifted off rolls
  // away from the very tile it is waiting for.
  const hill = sim(null, slope(-0.12), { secs: 14, v0: 4 });
  const late = hill[hill.length - 1];
  check('…and holds on a slope instead of rolling away',
    Math.abs(late.v) < 1.0 && late.brake === true, +late.v.toFixed(2));
}
{
  // AND THEN GOES. The road arrives at six seconds; nothing re-arms it, and
  // nothing should have to — a hold that needs a second tap is a hold that
  // will be found switched off at the bottom of the pass.
  const c = straight(900);
  const log = sim((t) => (t < 6 ? null : c), flat(), { secs: 30 });
  const held = log.find((e) => e.t > 1 && e.t < 5.5);
  check('a course that arrives is picked up without re-arming',
    held?.mode === 'wait', held?.mode);
  const went = log.find((e) => e.t > 6 && e.mode === 'run');
  check('…within a second of it arriving', !!went && went.t < 7, went ? +went.t.toFixed(2) : null);
  const end = log[log.length - 1];
  check('…and gets on with the drive', end.v > 15, +end.v.toFixed(2));
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

// ── REGAIN: the way back onto the road ─────────────────────────────
//
// Driving off the carriageway used to be a DEAD END. With no course the
// controller holds and brakes, which is right while a tile is arriving and wrong
// for ever afterwards: measured in the game, the truck ran wide onto ground and
// sat with the brakes on and `waited` climbing past sixty-five seconds, twenty
// metres from the road.
//
// The adapter now hands over a two-point line from the truck to the nearest
// carriageway and flags it `regain`. That makes the recovery a COURSE, so the
// steering, the stuck detector and the reverse all apply to it unchanged — and
// the only thing the controller has to add is that it must be CRAWLED, because
// this is ground nothing has been solved for.
{
  // The deck is behind and to the right — a ~114° turn from a standstill, which
  // is the awkward case. The line is REBUILT FROM THE RIG every frame, exactly as
  // autoCourse does it, because that is the contract the controller is given.
  const DECK = [16, 7];
  const dist = (e) => Math.hypot(e.x - DECK[0], e.z - DECK[1]);
  // THE WHOLE LOOP, not just the controller: autoCourse rebuilds this line from
  // the rig every frame AND STOPS OFFERING IT once the truck is on the deck
  // (`deck.d <= 3`), where the hold takes over and brakes. Testing the line
  // without the bail measures a truck coasting through its own target — which is
  // what happened: 12.2m past it, because `idle` lifts off without braking.
  const line = (_t, rig) => (dist(rig) <= 3 ? null : [[rig.x, rig.z], DECK]);
  const log = sim(line, flat(SURF.ground.mu), { secs: 25, regain: true, surf: SURF.ground });
  const closest = Math.min(...log.map(dist));
  const settled = dist(log[log.length - 1]);
  const driving = log.filter((e) => e.mode === 'recover');

  check('a regain line is crawled, never driven',
    driving.every((e) => e.want <= 5.001), +Math.max(...driving.map((e) => e.want)).toFixed(2));
  check('…and it says it is recovering, not running',
    driving.length > 50 && driving.every((e) => e.limit === 'recover'),
    [...new Set(log.map((e) => `${e.mode}/${e.limit}`))].join(','));
  check('…and it reaches the carriageway', closest < 3.01, +closest.toFixed(2));
  // AND STAYS THERE. Arriving once and driving on is the failure this nearly
  // shipped with, and "closest approach" alone cannot tell an arrival from a
  // fly-by: a target that cannot move produces a stable orbit through it.
  check('…and holds there instead of circling it', settled < 4, +settled.toFixed(2));
  check('…with the brakes on, so a slope cannot take it back off',
    log[log.length - 1].brake === true, log[log.length - 1].mode);

  // THE CONTRAST, or the cap proves nothing: the same geometry unflagged is
  // allowed to get on with it, so the crawl is the flag's doing and not the
  // shortness of the line.
  const fast = sim(line, flat(SURF.ground.mu), { secs: 25 });
  const vFast = Math.max(...fast.map((e) => e.v));
  const vCrawl = Math.max(...log.map((e) => e.v));
  check('…and the same line unflagged is NOT crawled', vFast > vCrawl + 2,
    { flagged: +vCrawl.toFixed(2), plain: +vFast.toFixed(2) });
}

console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exit(bad ? 1 : 0);
