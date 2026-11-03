/**
 * Switchback's rider: arcade physics, readable at speed.
 *
 * On the ground the bike goes where it's pointed: your steering turns the bike itself, and nothing turns it for you, so
 * with no input it runs straight on and a bend has to be ridden. The way you're travelling follows the way the bike points
 * through the tyres' grip, which gives at speed: turn hard and the rear steps out, the bike yawed past its line, sliding
 * (scrubbing pace, throwing roost). Where you are on the course (s down it, u across it) is read back from the world. The fall of the hill drives you on, the engine adds to it, the air holds you back. Off a ramp's lip,
 * or over a crest steeper than you can hold, you fly (a ballistic arc, steerable a little), and come down on whatever's
 * under you. Off the drop side, too far: a fall, and back on the line. Into the wall: a glance off it, the pace lost.
 */
import { AIR, Course } from './course';
import { ground } from './ground';

export const G = 9.8, VMAX = 46;
export type Event = { kind: 'roost' | 'land' | 'wall' | 'launch' | 'crash' | 'checkpoint' | 'respawn' | 'flip'; x: number; y: number; z: number; k: number };
/** steer (−1…1, + right); drive (−1…1): + the throttle opened wider, − the brake, as hard as it's pulled (`brake` is the
 * same as drive −1), and in the air the same axis tips the nose (− pulls it up and over, + pushes it down); and the
 * whip (−1…1): what the bars do in the air, throwing the bike out beneath you (the player's steering, in the air; the
 * sim's own rider never whips, nor tips) */
export interface Input { steer: number; brake: boolean; drive?: number; whip?: number }

export class Rider {
  s = 2; u = 0; psi = 0; v = 18;
  /** heading: the way the bike points; travel: the way it's going (the difference is the slide) */
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; heading = 0; travel = 0; slip = 0;
  air = false; airT = 0; crashT = 0;
  /** for the eye and the model: lean into the turn, pitch with the ground or the flight, the suspension's give */
  lean = 0; pitch = 0; squash = 0; steerK = 0;
  /** the front's steering angle (+ right; opposite lock in a slide), and the ground under each wheel (for drawing the
   * bike standing on both) */
  steer = 0; yFront = 0; yRear = 0;
  /** the whip: in the air the bike swung out sideways beneath the rider (rad, + its nose to the right), sprung toward
   * what the bars ask and back when they let go. Land with it still out and the bike comes down yawed off the way it's
   * going and slides it straight, scrubbing pace; too far out (past ~34°) and it's a crash */
  whip = 0; private vWhip = 0;
  /** the nose turning in the air (rad/s, + up and over backward), and the pitch it took off at (so a flip's counted) */
  spin = 0; private pitch0 = 0;
  /** how far off square to the slope the last landing came down (rad): for the score's CLEAN */
  lastMiss = 0;
  /** the drive as last asked, and where it stood when you left the ground: in the air the nose answers to how far it's
   * moved from there (so the throttle held through a lip doesn't tip you over), from nothing once it's let go */
  private driveNow = 0; private drive0 = 0;
  /** the rider's body on the bike, sprung (it lags, overshoots, settles): its roll against the bike's lean, its shift
   * across, fore and aft, and up and down (the legs and arms taking the bumps) */
  body = { roll: 0, shift: 0, fore: 0, rise: 0, look: 0, nod: 0, vRoll: 0, vShift: 0, vFore: 0, vRise: 0, vLook: 0, vNod: 0 };
  private yawS = 0; private vWas = 0; private vyWas = 0;
  /** the run: metres down, best air, crashes, a score */
  dist = 0; bestAir = 0; crashes = 0; jumps = 0;
  events: Event[] = [];
  /** the last checkpoint flag passed (its station; the start until the first), and how many have been passed: a crash
   * puts you back just past it */
  checkpoint = 2; checkpoints = 0;
  private sPrev = 2;
  /** the ground's own vertical pace under you last step (NaN: just come down, nothing to compare yet) */
  private vyGround = NaN; private headingWas = 0;
  constructor(readonly course: Course) { this.place(); }
  private place() { const p = this.course.point(this.s, this.u); this.x = p.x; this.y = p.y; this.z = p.z; this.heading = this.travel = p.heading - this.psi; this.slip = 0; }
  private ev(kind: Event['kind'], k: number) { this.events.push({ kind, x: this.x, y: this.y, z: this.z, k }); if (this.events.length > 64) this.events.shift(); }

  step(dt: number, inp: Input) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        // (back to the last checkpoint flag passed, just past it, on the line, and going again)
        this.u = 0; this.psi = 0; this.v = 24; this.air = false; this.vy = 0; this.vyGround = NaN; this.s = this.checkpoint + 3;
        while (!this.course.point(this.s, 0).surface || this.course.at(this.s).feature !== 'none') this.s += 1;
        this.place(); this.sPrev = this.s; this.headingWas = this.travel; this.lean = 0; this.squash = 0; this.wheels(); this.whip = this.vWhip = 0; this.spin = 0; this.pitch = wrap(this.pitch);
        this.ev('respawn', this.checkpoints);
      }
      else { this.vy -= G * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt; this.pitch += dt * 3; }
      return;
    }
    this.steerK += (inp.steer - this.steerK) * (1 - Math.exp(-dt * 10));
    if (!this.air) this.driveNow = inp.drive ?? (inp.brake ? -1 : 0);
    if (this.air) this.fly(dt, inp); else this.ride(dt, inp);
    this.sprung(dt);
    // (past a flag: that's the checkpoint now)
    if (this.crashT <= 0 && this.s > this.sPrev) for (let i = Math.floor(this.sPrev) + 1; i <= Math.floor(this.s); i++) if (this.course.at(i).flag && i > this.checkpoint) { this.checkpoint = i; this.checkpoints++; this.ev('checkpoint', this.checkpoints); }
    this.sPrev = this.s;
  }
  private ride(dt: number, inp: Input) {
    const c = this.course, here = c.point(this.s, this.u), half = here.width / 2;
    // (pace: the hill's fall, the engine up to its top, the air's drag, the brake; slower on the loose shoulder)
    const grade = c.point(this.s - 1, 0).y - c.point(this.s + 1, 0).y;
    // (the drive: left alone the engine pulls toward its top as it always has; opened wider it pulls harder, toward ~185
    // km/h; the brake bites as hard as it's pulled)
    const d = drive(inp), gas = Math.max(0, d), brk = Math.max(0, -d), top = VMAX * (1 + 0.12 * gas);
    let a = G * grade * 0.5 * 0.85 + (this.v < top ? 11 * (1 + 0.6 * gas) * (1 - this.v / top) : 0) - 0.0022 * this.v * this.v - brk * 18;
    if (Math.abs(this.u) > half) a -= 6;
    this.v = Math.max(4, this.v + a * dt);
    // (steering turns the bike, quicker at low speed; + is right, which turns the heading down)
    const maxYaw = 3.4 / (1 + this.v / 60);
    this.heading -= this.steerK * maxYaw * dt;
    // (the travel follows the bike through the tyres' grip, less of it at speed and braking; the slide self-aligns slowly,
    // and scrubs pace)
    const grip = 10 - 6 * Math.min(1, this.v / VMAX) - brk * 3;
    this.travel += wrap(this.heading - this.travel) * (1 - Math.exp(-dt * grip));
    this.slip = wrap(this.heading - this.travel);
    this.heading -= this.slip * dt * 1.5;
    this.v = Math.max(4, this.v - Math.abs(this.slip) * this.v * 0.5 * dt);
    const yBefore = this.y, sWas = this.s;
    this.x += Math.sin(this.travel) * this.v * dt; this.z += Math.cos(this.travel) * this.v * dt;
    const loc = c.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u; this.dist += Math.max(0, this.s - sWas);
    // (the wall, on the left: a glance off it, turned back along the line)
    if (this.u < -half - 1.4) {
      this.u = -half - 1.4; const w = c.point(this.s, this.u); this.x = w.x; this.z = w.z;
      this.travel = this.heading = w.heading - 0.12; this.v *= 0.72; this.ev('wall', this.v / VMAX);
    }
    let sy = this.surfaceY(this.s, this.u);
    // (a face rising in front (an outcrop on the drop side, the side of a raised deck): a glance off it, turned away
    // from it, the pace lost; + u is right, and turning left raises the heading)
    if (sy - yBefore > 0.9) {
      const back = c.locate(this.x - Math.sin(this.travel) * this.v * dt, this.z - Math.cos(this.travel) * this.v * dt, this.s), w = c.point(back.s, back.u);
      const away = this.u > back.u ? 1 : -1;
      this.s = back.s; this.u = back.u; this.x = w.x; this.z = w.z;
      this.travel = this.heading = w.heading + away * 0.12; this.v *= 0.72; this.ev('wall', this.v / VMAX);
      sy = this.surfaceY(this.s, this.u);
    }
    this.psi = wrap(c.point(this.s, 0).heading - this.travel);
    const p = c.point(this.s, this.u);
    // (a ramp's lip: you fly; onto nothing (a kicker's gap): you fall)
    // (the lip is the ramp's last station: past it, off you go, at the pace the ramp's last metre was lifting you; not a
    // metre on, where the surface has already gone flat over the gap)
    if (here.feature === 'ramp' && (p.feature !== 'ramp' || c.at(Math.floor(this.s) + 1).feature !== 'ramp')) { this.launch(yBefore, dt, false); return; }
    if (Math.abs(this.u) <= half && !p.surface) { this.launch(yBefore, dt, true); return; }
    // (the drop side is ridden, not fallen off: the shoulder, then the slope beyond it, which takes you down it if it's
    // steep (sliding toward the valley); far enough down and you've gone over: a crash)
    if (this.u > half + 14) { this.crash(); return; }
    if (this.u > half + 2.6) {
      const cross = this.surfaceY(this.s, this.u) - this.surfaceY(this.s, this.u + 1);
      if (cross > 0.45) this.travel -= Math.min(1, cross - 0.45) * 0.9 * dt;
    }
    // (off the side of something raised (a deck, a ramp), or over a step down: the ground's gone from under you, you fall)
    if (sy < yBefore - 0.4) { this.launch(yBefore, dt, true); return; }
    const vyG = (sy - yBefore) / dt;
    // (a crest: the ground a tenth of a second on (the way you're going, across the line too) falls away below the arc
    // you'd fly from here, by more than the suspension takes up: an edge, a lip, the shelf's brink)
    const tau = 0.12, ahead = this.surfaceY(this.s + this.v * tau * Math.cos(this.psi), this.u + this.v * tau * Math.sin(this.psi)), arc = sy + vyG * tau - 0.5 * G * tau * tau;
    // (not on a ramp: there the lip is the launch, exactly, so a big ramp throws you as steeply as it's built to)
    if (here.feature !== 'ramp' && this.v > 8 && !Number.isNaN(this.vyGround) && ahead < arc - 0.26) { this.launch(yBefore, dt, false, false); return; }
    // (the suspension takes up each step the ground throws you up by)
    if (!Number.isNaN(this.vyGround)) this.squash = Math.min(1, this.squash + Math.max(0, vyG - this.vyGround) * 0.07);
    this.vyGround = vyG;
    this.y = sy;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = vyG;
    // (lean: what the turn asks, its pace times how fast the travel's swinging (smoothed: a flick of the bars isn't a
    // turn), against gravity, and never more than ~35°; it comes in over a third of a second, not at once; + leans right)
    const yaw = wrap(this.travel - this.headingWas) / dt; this.headingWas = this.travel;
    this.yawS += (yaw - this.yawS) * (1 - Math.exp(-dt * 3));
    this.lean += (Math.max(-0.6, Math.min(0.6, Math.atan2(-this.v * this.yawS, G) * 0.8)) - this.lean) * (1 - Math.exp(-dt * 2.6));
    // (each wheel on the ground under it, the bike pitched between them: + is nose up)
    this.wheels();
    this.pitch += (Math.atan2(this.yFront - this.yRear, 1.6) - this.pitch) * (1 - Math.exp(-dt * 25));
    this.squash *= Math.exp(-dt * 6);
    if (Math.random() < dt * (6 + this.v * 0.6 + Math.abs(this.slip) * 120)) this.ev('roost', Math.min(1, this.v / VMAX + Math.abs(this.slip) * 2));
  }
  /** what's under (s, u): the road within its width (where there's road; up to the wall on the left), else the ground
   * beside it (the drop side's shoulder and slope, a gap's notch) as it's drawn */
  surfaceY(s: number, u: number) {
    const p = this.course.point(s, u), half = p.width / 2;
    if (u < -half) return p.y;
    if (u <= half && p.surface) return p.y;
    return ground(this.course, s, u);
  }
  /** each wheel's contact: the ground under it (on every step that ends on the ground, the landing one included, so the
   * bike is never drawn standing on where it took off from) */
  private wheels() {
    const fx0 = Math.sin(this.heading), fz0 = Math.cos(this.heading);
    this.yFront = this.groundAt(this.x + fx0 * 0.82, this.z + fz0 * 0.82);
    this.yRear = this.groundAt(this.x - fx0 * 0.78, this.z - fz0 * 0.78);
  }
  /** what's under a world point near here (for a wheel's contact) */
  private groundAt(x: number, z: number) {
    const loc = this.course.locate(x, z, this.s);
    return this.surfaceY(loc.s, loc.u);
  }
  /** the front's steering and the rider's body, after the step (both ground and air) */
  private sprung(dt: number) {
    // (the bars: turned the way you steer, less at speed; in a slide, toward where the bike's going (opposite lock))
    const want = Math.max(-0.6, Math.min(0.6, this.steerK * 0.5 * (1 - 0.5 * Math.min(1, this.v / VMAX)) + this.slip * 0.9));
    this.steer += (want - this.steer) * (1 - Math.exp(-dt * 12));
    // (the body: springs toward its posture (upright against the bike's lean, shifted to the outside of a slide,
    // standing up in the air), pushed by what the bike does under it (its speeding up and slowing, its lurches up and
    // down), so it lags and settles rather than riding as a statue)
    const b = this.body, acc = (this.v - this.vWas) / dt; this.vWas = this.v;
    const lurch = this.air ? 0 : Math.max(-3, Math.min(3, this.vy - this.vyWas)) / dt; this.vyWas = this.vy;
    const spring = (x: number, v: number, to: number, w: number, z: number, force: number) => { const a = -w * w * (x - to) - 2 * z * w * v + force; v += a * dt; return [x + v * dt, v]; };
    // (in the air: up off the seat at first, the limbs long; coming down, the hips settle back toward it and the weight
    // goes forward, ready for the ground)
    const coming = this.air && this.vy < -2;
    // (the counter-lean: the bike tips further than the body, which stays nearer upright over it)
    [b.roll, b.vRoll] = spring(b.roll, b.vRoll, -this.lean * 0.7, 7, 0.45, 0);
    [b.shift, b.vShift] = spring(b.shift, b.vShift, this.slip * 0.12 - this.lean * 0.05, 8, 0.4, 0);
    [b.fore, b.vFore] = spring(b.fore, b.vFore, this.air ? (coming ? 0.08 : -0.06) : 0, 8, 0.3, -Math.max(-25, Math.min(25, acc)) * 0.7);
    [b.rise, b.vRise] = spring(b.rise, b.vRise, this.air ? (coming ? 0 : 0.17) : 0, 10, 0.28, -Math.max(-40, Math.min(40, lurch)) * 0.3);
    // (the head, quicker than the body, so it leads: it looks where the bike's going (into the turn, along a slide), down
    // toward the ground as you come down to it, and up and out at the top of a flight)
    [b.look, b.vLook] = spring(b.look, b.vLook, Math.max(-0.6, Math.min(0.6, this.steerK * 0.3 + this.slip * 0.8)), 11, 0.6, 0);
    [b.nod, b.vNod] = spring(b.nod, b.vNod, this.air ? (coming ? 0.34 : -0.08) : 0.06 + Math.max(0, this.squash) * 0.25, 9, 0.6, 0);
    b.fore = Math.max(-0.16, Math.min(0.14, b.fore)); b.rise = Math.max(-0.14, Math.min(0.18, b.rise)); b.roll = Math.max(-0.5, Math.min(0.5, b.roll)); b.shift = Math.max(-0.12, Math.min(0.12, b.shift));
  }
  private launch(yBefore: number, dt: number, edge: boolean, lip = !edge) {
    // (off: the flight keeps the way you were carried, and the rise the ground was giving you; a lip gives a little pop)
    this.air = true; this.airT = 0;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = (this.vyGround || 0) + (lip ? 1.2 : 0);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y = yBefore + this.vy * dt;
    if (lip) { this.jumps++; this.ev('launch', 1); }
    this.spin = 0; this.pitch0 = this.pitch; this.drive0 = this.driveNow;
  }
  private fly(dt: number, inp: Input) {
    this.airT += dt;
    // (the whip: only once you're truly off the ground (a crest's hop is too short to throw the bike), toward ~49° at full
    // lock, sprung so it swings out and comes back)
    const wTo = (inp.whip ?? 0) * 0.85 * Math.max(0, Math.min(1, (this.airT - 0.2) / 0.2)), wk = 60;
    this.vWhip += (-wk * (this.whip - wTo) - 2 * 0.75 * Math.sqrt(wk) * this.vWhip) * dt; this.whip += this.vWhip * dt;
    // (a little steer in the air, the bike's heading turned and the flight with it)
    const turn = -this.steerK * 0.6 * dt, c = Math.cos(turn), s = Math.sin(turn);
    const nvx = this.vx * c + this.vz * s, nvz = -this.vx * s + this.vz * c; this.vx = nvx; this.vz = nvz;
    // (gravity, and the air holding you back as it does on the ground, with the square of the pace)
    const drag = 1 - AIR * Math.hypot(this.vx, this.vz) * dt;
    this.vy -= G * dt; this.vx *= drag; this.vz *= drag;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.travel = Math.atan2(this.vx, this.vz); this.heading = this.travel + this.slip; this.slip *= Math.exp(-dt * 3);
    const loc = this.course.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u;
    const p = this.course.point(this.s, this.u), half = p.width / 2;
    // (in the air the drive tips the nose (+ is nose up): pulled back it comes up and keeps coming, over into a backflip
    // if you hold it; pushed, it goes down (to meet a falling slope, or over the front). Let go and the turning dies away
    // quickly, and once it's slow and near the flight's line the nose follows the flight again, as it does untouched)
    const raw = inp.drive ?? 0; if (!raw) this.drive0 = 0;
    const cmd = -drive({ steer: 0, brake: false, drive: raw - this.drive0 }, 0.2);
    // (a heavy turn: it takes a moment to get going and comes round at ~3.2 rad/s at most, so a whole flip wants over
    // two seconds of air: a big kicker or a booter, not a kicker)
    if (cmd) this.spin += (cmd * 3.2 - this.spin) * (1 - Math.exp(-dt * 3)); else this.spin *= Math.exp(-dt * 4);
    this.pitch += this.spin * dt;
    const off = wrap(this.pitch - Math.atan2(this.vy, Math.hypot(this.vx, this.vz)) * 0.7);
    if (!cmd && Math.abs(this.spin) < 1.5 && Math.abs(off) < 1.2) this.pitch -= off * (1 - Math.exp(-dt * 2.5));
    this.lean *= Math.exp(-dt * 2);
    this.squash += (-0.35 - this.squash) * (1 - Math.exp(-dt * 4)); // (in the air the springs extend)
    void inp;
    // (the wall, from the air: a crash)
    if (this.u < -half - 1.4 && this.y < p.y + 0.3) { this.crash(); return; }
    const sy = this.surfaceY(this.s, this.u);
    if (this.y <= sy) {
      // (down. The impact is the speed into the ground's own slope, the way you're going: a landing down a slope that
      // matches the flight is soft, one onto the flat from the same height isn't. Into a gap, through a face rather than
      // onto it, too hard, or far down the drop: a crash)
      const vh = Math.hypot(this.vx, this.vz) || 1, ah = this.groundAt(this.x + this.vx / vh, this.z + this.vz / vh);
      // (and how the bike meets it: its pitch against the ground's own slope under it. Square to it, the landing's soft
      // and keeps its pace (a nose pushed down onto a falling slope carries you on faster); a little off and one wheel
      // slams; well off (nose first, or looped over onto the back wheel) it's a crash)
      // (the slope across where the wheels come down; just past a gap's edge (or just short of a drop), the side over the
      // hole doesn't count)
      const fx = (this.vx / vh) * 0.8, fz = (this.vz / vh) * 0.8, gF = this.groundAt(this.x + fx, this.z + fz), gB = this.groundAt(this.x - fx, this.z - fz);
      const slope = Math.abs(gB - sy) > 0.6 ? Math.atan2(gF - sy, 0.8) : Math.abs(gF - sy) > 0.6 ? Math.atan2(sy - gB, 0.8) : Math.atan2(gF - gB, 1.6);
      const miss = Math.abs(wrap(this.pitch - slope)), square = miss < 0.12;
      this.lastMiss = miss;
      const imp = -(this.vy + vh * (sy - ah)) * (square ? 0.7 : 1) + Math.max(0, miss - 0.3) * 18, gap = Math.abs(this.u) <= half && !p.surface;
      if (gap || sy - this.y > 1.2 || imp > 15 || this.u > half + 14 || Math.abs(this.whip) > 0.6 || miss > 0.75) { this.crash(); return; }
      // (else on the ground again; a hard one squashes and costs a little)
      this.air = false; this.y = sy; this.v = Math.max(6, Math.hypot(this.vx, this.vz) * (imp > 14 ? 0.86 : imp > 8 ? 0.97 : square && slope < -0.12 ? 1.05 : 1));
      // (a whole turn or more of the nose since take-off, landed: a flip (+ back, − front))
      const turns = Math.round((this.pitch - this.pitch0) / (Math.PI * 2));
      if (turns) this.ev('flip', turns);
      this.pitch = wrap(this.pitch); this.spin = 0;
      this.travel = Math.atan2(this.vx, this.vz); this.headingWas = this.travel;
      // (down with the bike still whipped: it lands yawed off the way it's going (its nose right of it: heading less) and
      // the slide takes it straight)
      if (this.whip) { this.slip = wrap(this.slip - this.whip); this.heading = this.travel + this.slip; this.whip = this.vWhip = 0; }
      this.bestAir = Math.max(this.bestAir, this.airT); this.squash = Math.min(1, imp / 12); this.vyGround = NaN;
      this.ev('land', Math.min(1, imp / 10));
      this.wheels();
      return;
    }
  }
  private crash() { this.crashT = 1.1; this.crashes++; this.ev('crash', 1); this.air = true; }
}

/** a steer that keeps to the line (for `auto`, the preview and the tests): pure pursuit of a point on the line ahead,
 * further ahead the faster you go, steering the way you're travelling (so a slide is ridden, not fought) */
export function autoSteer(r: Rider) {
  const P = r.course.point(r.s + 7 + r.v * 0.3, 0), want = Math.atan2(P.x - r.x, P.z - r.z);
  return Math.max(-1, Math.min(1, -wrap(want - r.travel) * 4));
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the drive asked for (−1…1), less a dead zone (so a drag that's mostly sideways doesn't brake or tip the nose) */
function drive(inp: Input, dead = 0.15) {
  const d = inp.drive ?? (inp.brake ? -1 : 0), m = Math.max(0, Math.abs(d) - dead) / (1 - dead);
  return Math.sign(d) * Math.min(1, m);
}
