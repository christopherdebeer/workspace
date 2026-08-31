/**
 * THE AUTOPILOT — a driver made of arithmetic, for testing the road.
 *
 * Built for development, not for play. A solver change moves the deck under
 * every road in the world, and the only honest way to know whether it moved
 * it for the better is to DRIVE the road — which means a person, a phone, and
 * an afternoon per fixture. Sixteen benchmark drives is sixteen afternoons.
 * This drives them instead, the same way a person would: it reads the course
 * ahead, plans a speed for it, and holds the truck on it with the same
 * throttle, brake and steering a thumb has.
 *
 * ── WHY IT LIVES OUT HERE ──
 *
 * Same reason `roadprofile.ts` and `roadsolve.ts` do: it is arithmetic over
 * numbers, it has no business needing a WebGL context to answer a question,
 * and a controller you can only exercise by driving a headless browser at two
 * frames a second is a controller you cannot tune. Everything here is pure.
 * The world arrives as a `Course` (a polyline in local metres) and a `Ground`
 * (two samplers), so a test can hand it a synthetic hairpin on a known slope
 * and check what it does, with no browser anywhere.
 *
 * ── WHAT "CORRECTS FOR TERRAIN AND PHYSICS" MEANS HERE ──
 *
 * Not "follows the line". A line-follower that ignores the ground drives off
 * the outside of the first downhill hairpin at Trollstigen, and the failure
 * tells you nothing about the road because it was the driver that was wrong.
 * So the speed plan is a real one, over three limits that the game's own
 * physics actually imposes:
 *
 *   CORNERING. A corner has a maximum speed and it is √(a_lat / κ), where the
 *   lateral budget is a fraction of μg and μ is the surface under THAT part of
 *   the road, not under the truck now.
 *
 *   GRADE. Braking downhill is worse than braking flat by exactly g·sin θ, so
 *   the deceleration the planner is allowed to believe in shrinks on a
 *   descent. This is why it brakes early into a corner at the bottom of a hill
 *   and not into the same corner on the flat.
 *
 *   GRIP. Mud is not tarmac. The surface ceiling scales with μ.
 *
 * …and then the plan is a BRAKING ENVELOPE rather than a speed limit at the
 * truck: for every point ahead, the speed that can still be shed to that
 * point's limit before reaching it. Take the tightest. Without this the
 * autopilot arrives at a corner at the straight's speed and brakes inside it,
 * which is how a line-follower rolls a truck.
 *
 * ── AND WHAT IT DOES WHEN IT GOES WRONG ──
 *
 * Two recoveries, because both failures happen and neither is the road's
 * fault. Off the corridor, it stops chasing the lookahead — which on a
 * hairpin points across the drop — and aims at the nearest point of the
 * course at a crawl. Stuck (throttle open, not moving: a wall, a ditch, a
 * boulder), it reverses with the wheel held over, which is what a person
 * does, and then tries again.
 */

/** Where the truck is and what it is doing. Compass heading, as the game
 *  keeps it: forward is (sin h, −cos h). */
export interface Rig { x: number; z: number; heading: number; speed: number }

/** The world, as two questions. Both are asked at points along the course
 *  well ahead of the truck, so neither may assume the truck is near. */
export interface Ground {
  /** Metres above datum. Grade is read as a difference of these. */
  height(x: number, z: number): number;
  /** The friction coefficient the physics would hand back here — tarmac is
   *  about 1.05, open ground 0.6, water 0.3. */
  grip(x: number, z: number): number;
}

/** A course in LOCAL METRES, the same frame the truck is in. */
export type Course = Array<[number, number]>;

export interface AutoTune {
  /** Seconds of travel the steering aims ahead by, and its bounds. Short is
   *  twitchy and cuts corners; long understeers wide and ignores the bend it
   *  is in. */
  lookT: number; lookMin: number; lookMax: number;
  /** Heading error → steering, and the yaw-rate damping that stops it from
   *  ringing. Damping is what makes it hold a line rather than weave. */
  steerK: number; steerD: number;
  /** Steady cross-track offset → steering. Small: pure pursuit already pulls
   *  back toward the line, and this only kills the residual. */
  offK: number;
  /** Fraction of μg spent on cornering. The rest is the margin that keeps it
   *  on the road when the DEM is wrong about the camber. */
  latMargin: number;
  /** Deceleration the plan may count on, on the flat with μ=1, m/s². */
  brakeA: number;
  /** Metres to plan ahead, floor and ceiling — the braking distance sets the
   *  rest. */
  planMin: number; planMax: number;
  /** Resampling step for the course. OSM vertices land where a surveyor
   *  clicked, so curvature read off raw ones is a property of the survey. */
  step: number;
  /** Hard ceiling and a floor the plan never goes under — crawling is a speed,
   *  stopping is a failure. */
  vMax: number; vMin: number;
  /** Speed error → throttle, and → brake. */
  accelK: number; brakeK: number;
  /** How far off the course before the lookahead stops being trustworthy. */
  corridor: number;
  /** Stuck: under this speed, with the throttle open, for this long. Then
   *  reverse for this long. */
  stuckV: number; stuckS: number; revS: number;
}

export const AUTO: AutoTune = {
  // Long eyes for real speed: at 44m/s the old 70m ceiling was a second and a
  // half of travel — reaction, not planning.
  lookT: 1.25, lookMin: 14, lookMax: 110,
  steerK: 1.5, steerD: 0.55, offK: 0.03,
  latMargin: 0.6,
  // 6.5, from 4.2 — still barely a sixth of what the arcade brake actually
  // delivers (CAR.brake·1.4 ≈ 36m/s²). The first tune planned every descent
  // as if the truck had drum brakes and a full trailer; the ceiling below
  // was unreachable because the envelope never released it.
  brakeA: 6.5,
  planMin: 60, planMax: 460,
  step: 8,
  // 44m/s — 158km/h — against a road equilibrium of ~57. The tyres, the
  // corners and the length of the streamed road are the governors now, which
  // is what a top speed is supposed to be.
  vMax: 44, vMin: 2.5,
  accelK: 0.32, brakeK: 0.42,
  corridor: 16,
  stuckV: 0.55, stuckS: 1.4, revS: 1.6,
};

/** The controller's own memory. The caller owns one and hands it back every
 *  frame; nothing here is a module global, so two of these can run at once. */
export interface AutoMem {
  stuck: number;
  reverse: number;
  revSteer: number;
  lastHeading: number;
  yaw: number;
  lastSteer: number;
  /** Seconds spent holding for a course that has not arrived. Reported, not
   *  acted on — a run that spent half its time waiting for tiles is a
   *  measurement of the streamer, and worth being able to see. */
  waited: number;
}
export const autoMem = (): AutoMem => ({
  stuck: 0, reverse: 0, revSteer: 0, lastHeading: 0, yaw: 0, lastSteer: 0,
  waited: 0,
});

export interface AutoOut {
  /** The controls, in exactly the shape `input()` returns. */
  steer: number; throttle: number; brake: boolean; brakeF: number;
  /** …and the reasoning, so a probe can say WHY it slowed down. */
  want: number;
  off: number;
  err: number;
  look: [number, number] | null;
  /** Which limit bound the plan: the tightest one wins and it is named. */
  limit: 'curve' | 'grip' | 'cap' | 'end' | 'short' | 'recover' | 'none';
  mode: 'run' | 'recover' | 'reverse' | 'wait' | 'idle';
}

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Shortest signed angle a→b, radians. */
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
const G = 9.81;

/**
 * The course at a constant spacing. Curvature is a second difference, so it is
 * only meaningful over a constant baseline: on raw OSM vertices two points 3m
 * apart on a straight read as a sharper corner than two 40m apart on a real
 * one, purely because of how the way was drawn.
 */
export function resample(course: Course, step: number): Course {
  if (course.length < 2) return course.slice();
  const out: Course = [[course[0][0], course[0][1]]];
  let carry = 0;
  for (let i = 1; i < course.length; i++) {
    const [ax, az] = course[i - 1], [bx, bz] = course[i];
    let seg = Math.hypot(bx - ax, bz - az);
    if (seg < 1e-6) continue;
    const ux = (bx - ax) / seg, uz = (bz - az) / seg;
    let at = step - carry;
    while (at <= seg) { out.push([ax + ux * at, az + uz * at]); at += step; }
    carry = seg - (at - step);
  }
  // THE FAR END, EXACTLY. A course's last vertex is a destination or the edge
  // of what has streamed, and both are read to — `endsHere` brakes to the end
  // of the path, so a resample that drops the tail stops the truck short of
  // where it was sent. When the leftover is a sliver the last sample is MOVED
  // rather than a sliver segment appended: three points a few centimetres
  // apart is a curvature reading of nothing, and the speed plan divides by it.
  const last = course[course.length - 1];
  const tail = out[out.length - 1];
  const rest = Math.hypot(last[0] - tail[0], last[1] - tail[1]);
  if (rest > step * 0.5) out.push([last[0], last[1]]);
  else if (rest > 1e-9) out[out.length - 1] = [last[0], last[1]];
  return out;
}

/** Menger curvature at vertex `i` of an evenly-spaced path, 1/m. Zero at the
 *  ends, where there is no triangle to read. */
export function curvatureAt(path: Course, i: number): number {
  if (i <= 0 || i >= path.length - 1) return 0;
  const [ax, az] = path[i - 1], [bx, bz] = path[i], [cx, cz] = path[i + 1];
  const a = Math.hypot(bx - ax, bz - az);
  const b = Math.hypot(cx - bx, cz - bz);
  const c = Math.hypot(cx - ax, cz - az);
  if (a < 1e-6 || b < 1e-6 || c < 1e-6) return 0;
  // Twice the triangle's signed area, by the cross product.
  const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return (2 * area2) / (a * b * c);
}

/** Nearest point of the path, how far off it we are (signed, positive to the
 *  RIGHT of travel), and how far along it that lands. */
export function seekPath(path: Course, x: number, z: number):
{ i: number; along: number; off: number; px: number; pz: number; ux: number; uz: number } {
  let best = Infinity, bi = 1, bt = 0, run = 0, bRun = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / len2, 0, 1);
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) { best = d; bi = i; bt = t; bRun = run; }
    run += Math.sqrt(len2);
  }
  const [ax, az] = path[bi - 1], [bx, bz] = path[bi];
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const px = ax + dx * bt, pz = az + dz * bt;
  // Right of travel: forward (sin h, −cos h) rotated +90° is (cos h, sin h),
  // which for a forward of (ux, uz) is (−uz, ux).
  const off = (x - px) * -uz + (z - pz) * ux;
  return { i: bi, along: bRun + len * bt, off, px, pz, ux, uz };
}

/** A point `d` metres along the path from its start, and the index it fell in. */
function pointAt(path: Course, d: number): { p: [number, number]; i: number } {
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (run + seg >= d) {
      const t = seg > 0 ? (d - run) / seg : 0;
      return { p: [ax + (bx - ax) * t, az + (bz - az) * t], i };
    }
    run += seg;
  }
  const l = path[path.length - 1];
  return { p: [l[0], l[1]], i: path.length - 1 };
}

/** Total length of a path, metres. */
export function pathLength(path: Course): number {
  let m = 0;
  for (let i = 1; i < path.length; i++) m += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return m;
}

export interface AutoOpts {
  /** True when the course genuinely STOPS at its last vertex — a destination.
   *  False when it merely ran out of streamed road, where braking for the end
   *  of the data would be braking for nothing. */
  endsHere?: boolean;
  /** Metres of lateral room either side of the given line that still count as
   *  carriageway — half-width minus the truck's own half plus a margin. Above
   *  ~0.4m the controller stops tracking the centreline and drives the RACING
   *  line inside that corridor instead. */
  width?: number;
  /**
   * This course is a RECOVERY LINE to the nearest carriageway, not a road to
   * drive: the truck is off the network and this is the way back on.
   *
   * It is crawled, and it is reported as a recovery, because both of those are
   * true and neither is inferable from the geometry — a two-point line across
   * open ground is indistinguishable from a very short straight road. Racing it
   * would be absurd; racing it at the surface's cornering limit across ground the
   * solver never profiled would be worse.
   */
  regain?: boolean;
}

/**
 * THE RALLY LINE — out, in, out, as an objective rather than as opinion.
 *
 * The course arrives as the road's CENTRELINE, and pure pursuit faithfully
 * drives down the middle of every corner — the slowest line through it. What
 * a rally driver buys with the road's width is CURVATURE: enter wide, clip
 * the apex, run wide again, and the corner's effective radius grows.
 *
 * The objective matters, and the first cut proved it by being wrong: pulling
 * every point toward its neighbours' midpoint is a TAUT STRING — the shortest
 * path in the corridor — and the shortest path hugs the inside of the bend,
 * an inward-offset arc whose radius is SMALLER. Measured: the "raced" corner
 * came out sharper than the centreline it replaced. Shortest is not
 * flattest. The right objective is minimum curvature energy — descend on the
 * FOURTH difference — because redistributing bend is what pushes the entry
 * outward to buy the apex its radius. Out-in-out is not programmed anywhere
 * below; it is what the minimiser does with a corridor.
 *
 * Clamped radially to the corridor around the original line each pass, ends
 * anchored (a destination is a place the truck must actually reach), and
 * RE-RESAMPLED before anyone measures it: relaxation bunches points, and
 * Menger curvature on uneven spacing inflates — the plan would brake for
 * phantom corners of the smoother's own making.
 */
export function raceLine(path: Course, maxOff: number, passes = 160, step = 8): Course {
  if (path.length < 5 || maxOff < 0.05) return path;
  const out: Course = path.map((p) => [p[0], p[1]]);
  const n = out.length;
  const m2 = maxOff * maxOff;
  // Descent rate: the biharmonic operator's stability bound on a unit lattice
  // is ~1/16 of the step; 0.05 converges in the pass budget without ringing.
  const L = 0.05;
  // Only the END POINTS are pinned. The first cut also froze their
  // neighbours, and the smoothed interior met the pinned tail in a KINK that
  // out-measured the corner it had just flattened — the sharpest point of the
  // "racing line" was the reconnection. Ghost points (index-clamped) let the
  // penultimate points relax; lateral freedom at the ends is free, because an
  // end is a place to arrive at, not a lane to arrive in.
  const at = (j: number): [number, number] => out[j < 0 ? 0 : j >= n ? n - 1 : j];
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 1; i < n - 1; i++) {
      // −∇ of Σ|p″|²: the fourth difference, taken from the evolving line.
      let gx = at(i - 2)[0] - 4 * at(i - 1)[0] + 6 * at(i)[0] - 4 * at(i + 1)[0] + at(i + 2)[0];
      let gz = at(i - 2)[1] - 4 * at(i - 1)[1] + 6 * at(i)[1] - 4 * at(i + 1)[1] + at(i + 2)[1];
      let nx = out[i][0] - gx * L;
      let nz = out[i][1] - gz * L;
      const dx = nx - path[i][0], dz = nz - path[i][1];
      const d2 = dx * dx + dz * dz;
      if (d2 > m2) {
        const k = maxOff / Math.sqrt(d2);
        nx = path[i][0] + dx * k;
        nz = path[i][1] + dz * k;
      }
      out[i][0] = nx; out[i][1] = nz;
    }
  }
  return resample(out, step);
}

/**
 * One frame of driving.
 *
 * `dt` is the frame's timestep in seconds; the memory carries the yaw estimate
 * and the recovery timers across frames.
 */
export function autoDrive(
  rig: Rig, course: Course | null, ground: Ground, mem: AutoMem, dt: number,
  opts: AutoOpts = {}, T: AutoTune = AUTO,
): AutoOut {
  const idle: AutoOut = { steer: 0, throttle: 0, brake: false, brakeF: 0,
    want: 0, off: 0, err: 0, look: null, limit: 'none', mode: 'idle' };

  // The yaw estimate is differentiated from the heading rather than taken from
  // the game, so the controller stays free of anything but its own inputs —
  // and so a test can step it with nothing but positions.
  if (dt > 0) {
    // CLAMPED BEFORE FILTERING, because the truck can TELEPORT. Travelling to
    // a drive, a rewind scrub, or a re-anchored world frame all move the
    // heading discontinuously, and a differentiated step of π over one frame
    // is a yaw rate of a hundred and fifty radians a second. The damping term
    // would then hold full opposite lock for the length of the filter. Four is
    // already three times anything this chassis can produce.
    const raw = clamp(wrap(rig.heading - mem.lastHeading) / dt, -4, 4);
    // A frame-to-frame difference is noisy at 60Hz; a short filter is the
    // difference between damping and adding a second oscillator.
    mem.yaw += (raw - mem.yaw) * clamp(dt / 0.12, 0, 1);
  }
  mem.lastHeading = rig.heading;

  // REVERSING OUT, first: whatever the course says, the truck is against
  // something and going forward is not on offer.
  if (mem.reverse > 0) {
    mem.reverse -= dt;
    mem.lastSteer = mem.revSteer;
    return { ...idle, steer: mem.revSteer, throttle: -0.6, mode: 'reverse',
      limit: 'recover', want: 0 };
  }
  // ── NO COURSE YET: HOLD, and then go when there is one ──
  //
  // The tile has not arrived, or it has and the ribbon is still being built.
  // Coasting through that is the wrong answer twice: at speed the truck runs
  // on into ground nothing has been solved for, and stopped on a slope it
  // rolls away from the very tile it is waiting for. So it brakes, holds, and
  // resumes by itself the moment a course appears — no arming, no re-tap.
  //
  // A HOLD IS NOT A FAILURE and does not read as one: `wait` is its own mode,
  // and the time spent in it is counted, because a drive that spends half its
  // life here is telling you about the streamer rather than about the road.
  if (!course || course.length < 2) {
    mem.waited += dt;
    const v0 = Math.abs(rig.speed);
    // Firm enough to stop promptly, not so hard it locks and slides — and it
    // keeps holding once stopped, which is the half that matters on a grade.
    const bf = v0 > 0.4 ? 0.85 : 1;
    return { ...idle, mode: 'wait', limit: 'none', brake: true, brakeF: bf };
  }

  const centre = resample(course, T.step);
  if (centre.length < 2) return idle;
  // Given room, drive the rally line inside it rather than the centreline.
  const path = opts.width && opts.width > 0.4 ? raceLine(centre, opts.width, 36, T.step) : centre;
  const seek = seekPath(path, rig.x, rig.z);
  const total = pathLength(path);
  const v = Math.max(0, rig.speed);

  // ── the speed plan ──
  // Walk forward sampling the course, and at every sample ask two questions:
  // what is the fastest this point may be taken at, and can we still get down
  // to that from here. The tightest answer over the whole window is the target.
  const reach = clamp((v * v) / (2 * T.brakeA) + 40, T.planMin, T.planMax);
  let want = T.vMax;
  let limit: AutoOut['limit'] = 'cap';
  const start = seek.along;
  let prevH: number | null = null;
  for (let d = 0; d <= reach; d += T.step) {
    const at = pointAt(path, start + d);
    if (start + d > total) break;
    const [px, pz] = at.p;
    const mu = clamp(ground.grip(px, pz), 0.15, 1.4);
    const h = ground.height(px, pz);
    // Rise per metre TRAVELLED — negative downhill, which is exactly the sign
    // that has to reduce the braking budget below.
    const grade = prevH === null ? 0 : (h - prevH) / T.step;
    prevH = h;
    const k = curvatureAt(path, at.i);
    // What this point may be taken at.
    const vCurve = k > 1e-4 ? Math.sqrt((T.latMargin * mu * G) / k) : T.vMax;
    const vGrip = T.vMax * clamp(mu / 1.05, 0.35, 1);
    let cap = Math.min(vCurve, vGrip, T.vMax);
    let why: AutoOut['limit'] = cap === vCurve ? 'curve' : cap === vGrip ? 'grip' : 'cap';
    // …AND THE END OF WHAT IS KNOWN, which is a limit even when the road
    // continues. A course from `wayAhead` reaches as far as the chained
    // geometry does, and while streaming lags that can be forty metres. Going
    // faster than you could stop within it is driving on ground nothing has
    // been solved for — the same mistake as coasting through a hold, made at
    // speed. The constraint is simply "be able to stop by the last vertex",
    // which costs nothing at all when the chain is healthy: from 420m the
    // envelope releases 61m/s, well over the ceiling.
    //
    // `endsHere` is the stronger version of the same point — a DESTINATION,
    // where the truck is meant to come to rest rather than merely be able to.
    // It differs only in the floor: a road that continues is crawled on, so
    // the streamer keeps being asked for the next tile; a destination is not.
    if (start + d >= total - T.step) { cap = 0; why = opts.endsHere ? 'end' : 'short'; }
    cap = Math.max(cap, why === 'end' ? 0 : T.vMin);
    // Can we still shed to it? Deceleration on a slope is the flat figure plus
    // g·grade, and grade is negative downhill — so a descent brings the whole
    // envelope down, and it brakes earlier for the same corner.
    const aBrake = Math.max(0.5, T.brakeA * mu + G * grade);
    const allow = Math.sqrt(cap * cap + 2 * aBrake * d);
    if (allow < want) { want = allow; limit = why; }
  }
  want = Math.max(want, opts.endsHere ? 0 : T.vMin);
  if (mem.waited > 0 && want > T.vMin) mem.waited = 0;   // moving again

  // ── steering ──
  // OFF THE CORRIDOR, THE LOOKAHEAD IS A LIE. On a hairpin the point 40m along
  // the course sits across the drop, and chasing it from outside the corridor
  // drives at the drop. Aim at the nearest point of the line instead, slowly.
  const lost = Math.abs(seek.off) > T.corridor;
  const look = T.lookT * v;
  const L = lost ? 0 : clamp(look, T.lookMin, T.lookMax);
  const tgt = lost ? [seek.px, seek.pz] as [number, number]
    : pointAt(path, Math.min(start + L, total)).p;
  const dx = tgt[0] - rig.x, dz = tgt[1] - rig.z;
  // Heading that points at the target, in the game's compass convention.
  const bearing = Math.hypot(dx, dz) < 0.5 ? rig.heading : Math.atan2(dx, -dz);
  const err = wrap(bearing - rig.heading);
  // Positive steer is RIGHT. Sitting right of the line (off > 0) asks for left.
  let steer = clamp(T.steerK * err - T.offK * seek.off - T.steerD * mem.yaw, -1, 1);
  if (lost) { want = Math.min(want, 5); limit = 'recover'; }
  // A REGAIN LINE IS CRAWLED, at the same pace as the off-corridor recovery and
  // for the same reason: this is ground nothing has been solved for, and arriving
  // at the carriageway slowly is the whole point — the chain has to be picked up,
  // not crossed at speed.
  if (opts.regain) { want = Math.min(want, 5); limit = 'recover'; }

  // ── throttle and brake, never both ──
  // Lifting off through a bend is not politeness, it is the lateral budget:
  // every newton spent accelerating is one the tyre cannot spend turning.
  const e = want - v;
  let throttle = 0, brakeF = 0;
  if (e > 0.3) throttle = clamp(T.accelK * e, 0, 1) * (1 - 0.6 * clamp(Math.abs(err) / 0.6, 0, 1));
  else if (e < -0.6) brakeF = clamp(T.brakeK * -e, 0, 1);

  // ── stuck ──
  // Open throttle and no movement is a wall, a ditch or a boulder. Back off
  // with the wheel held over — the thing a person does, and the thing that
  // gets the nose pointed somewhere else.
  if (throttle > 0.4 && v < T.stuckV) mem.stuck += dt; else mem.stuck = 0;
  if (mem.stuck >= T.stuckS) {
    mem.stuck = 0;
    mem.reverse = T.revS;
    mem.revSteer = mem.lastSteer >= 0 ? -1 : 1;
    return { ...idle, steer: mem.revSteer, throttle: -0.6, mode: 'reverse',
      limit: 'recover', want: 0 };
  }
  mem.lastSteer = steer;
  // Straighten the wheel while braking hard in a straight line — otherwise the
  // damping term, which is fed by a yaw that is still decaying, keeps steering
  // after the reason for it has gone.
  if (brakeF > 0.8 && Math.abs(err) < 0.05) steer *= 0.5;

  return { steer, throttle, brake: brakeF > 0.01, brakeF,
    want, off: seek.off, err, look: tgt,
    limit, mode: lost || opts.regain ? 'recover' : 'run' };
}
