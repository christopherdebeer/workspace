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
import { Course } from './course';

export const G = 9.8, VMAX = 46;
export type Event = { kind: 'roost' | 'land' | 'wall' | 'launch' | 'crash'; x: number; y: number; z: number; k: number };
export interface Input { steer: number; brake: boolean }

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
  /** the rider's body on the bike, sprung (it lags, overshoots, settles): its roll against the bike's lean, its shift
   * across, fore and aft, and up and down (the legs and arms taking the bumps) */
  body = { roll: 0, shift: 0, fore: 0, rise: 0, vRoll: 0, vShift: 0, vFore: 0, vRise: 0 };
  private yawS = 0; private vWas = 0; private vyWas = 0;
  /** the run: metres down, best air, crashes, a score */
  dist = 0; bestAir = 0; crashes = 0; jumps = 0;
  events: Event[] = [];
  /** the ground's own vertical pace under you last step (NaN: just come down, nothing to compare yet) */
  private vyGround = NaN; private headingWas = 0;
  constructor(readonly course: Course) { this.place(); }
  private place() { const p = this.course.point(this.s, this.u); this.x = p.x; this.y = p.y; this.z = p.z; this.heading = this.travel = p.heading - this.psi; this.slip = 0; }
  private ev(kind: Event['kind'], k: number) { this.events.push({ kind, x: this.x, y: this.y, z: this.z, k }); if (this.events.length > 64) this.events.shift(); }

  step(dt: number, inp: Input) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        // (back on the line where you left it, on ground, and going again)
        this.u = 0; this.psi = 0; this.v = 16; this.air = false; this.vy = 0; this.vyGround = NaN; this.s = Math.max(2, this.s);
        while (!this.course.point(this.s, 0).surface || this.course.at(this.s).feature !== 'none') this.s += 1;
        this.place();
      }
      else { this.vy -= G * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt; this.pitch += dt * 3; }
      return;
    }
    this.steerK += (inp.steer - this.steerK) * (1 - Math.exp(-dt * 10));
    if (this.air) this.fly(dt, inp); else this.ride(dt, inp);
    this.sprung(dt);
  }
  private ride(dt: number, inp: Input) {
    const c = this.course, here = c.point(this.s, this.u), half = here.width / 2;
    // (pace: the hill's fall, the engine up to its top, the air's drag, the brake; slower on the loose shoulder)
    const grade = c.point(this.s - 1, 0).y - c.point(this.s + 1, 0).y;
    let a = G * grade * 0.5 * 0.85 + (this.v < VMAX ? 11 * (1 - this.v / VMAX) : 0) - 0.0022 * this.v * this.v - (inp.brake ? 18 : 0);
    if (Math.abs(this.u) > half) a -= 6;
    this.v = Math.max(4, this.v + a * dt);
    // (steering turns the bike, quicker at low speed; + is right, which turns the heading down)
    const maxYaw = 3.4 / (1 + this.v / 60);
    this.heading -= this.steerK * maxYaw * dt;
    // (the travel follows the bike through the tyres' grip, less of it at speed and braking; the slide self-aligns slowly,
    // and scrubs pace)
    const grip = 10 - 6 * Math.min(1, this.v / VMAX) - (inp.brake ? 3 : 0);
    this.travel += wrap(this.heading - this.travel) * (1 - Math.exp(-dt * grip));
    this.slip = wrap(this.heading - this.travel);
    this.heading -= this.slip * dt * 1.5;
    this.v = Math.max(4, this.v - Math.abs(this.slip) * this.v * 0.5 * dt);
    const yBefore = this.y, sWas = this.s;
    this.x += Math.sin(this.travel) * this.v * dt; this.z += Math.cos(this.travel) * this.v * dt;
    const loc = c.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u; this.dist += Math.max(0, this.s - sWas);
    // (the wall, on the left: a glance off it, turned back along the line; the drop, on the right: over the edge)
    if (this.u < -half - 1.4) {
      this.u = -half - 1.4; const w = c.point(this.s, this.u); this.x = w.x; this.z = w.z;
      this.travel = this.heading = w.heading - 0.12; this.v *= 0.72; this.ev('wall', this.v / VMAX);
    }
    this.psi = wrap(c.point(this.s, 0).heading - this.travel);
    const p = c.point(this.s, this.u);
    // (a ramp's lip, or a crest that falls away faster than you'd drop: you fly; off the edge, or onto nothing: you fall)
    if (here.feature === 'ramp' && p.feature !== 'ramp') { this.launch(yBefore, dt, false); return; }
    if (this.u > half + 2.2 || !p.surface) { this.launch(yBefore, dt, true); return; }
    const vyG = (p.y - yBefore) / dt;
    // (a crest: the ground a tenth of a second on falls away below the arc you'd fly from here, by more than the
    // suspension takes up)
    const tau = 0.12, ahead = c.point(this.s + this.v * tau, this.u).y, arc = p.y + vyG * tau - 0.5 * G * tau * tau;
    if (this.v > 8 && !Number.isNaN(this.vyGround) && ahead < arc - 0.26) { this.launch(yBefore, dt, false, here.feature === 'ramp'); return; }
    // (the suspension takes up each step the ground throws you up by)
    if (!Number.isNaN(this.vyGround)) this.squash = Math.min(1, this.squash + Math.max(0, vyG - this.vyGround) * 0.07);
    this.vyGround = vyG;
    this.y = p.y;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = vyG;
    // (lean: what the turn asks, its pace times how fast the travel's swinging (smoothed: a flick of the bars isn't a
    // turn), against gravity, and never more than ~35°; it comes in over a third of a second, not at once; + leans right)
    const yaw = wrap(this.travel - this.headingWas) / dt; this.headingWas = this.travel;
    this.yawS += (yaw - this.yawS) * (1 - Math.exp(-dt * 3));
    this.lean += (Math.max(-0.6, Math.min(0.6, Math.atan2(-this.v * this.yawS, G) * 0.8)) - this.lean) * (1 - Math.exp(-dt * 2.6));
    // (each wheel on the ground under it, the bike pitched between them: + is nose up)
    const fx0 = Math.sin(this.heading), fz0 = Math.cos(this.heading);
    this.yFront = this.groundAt(this.x + fx0 * 0.82, this.z + fz0 * 0.82, p.y);
    this.yRear = this.groundAt(this.x - fx0 * 0.78, this.z - fz0 * 0.78, p.y);
    this.pitch += (Math.atan2(this.yFront - this.yRear, 1.6) - this.pitch) * (1 - Math.exp(-dt * 25));
    this.squash *= Math.exp(-dt * 6);
    if (Math.random() < dt * (6 + this.v * 0.6 + Math.abs(this.slip) * 120)) this.ev('roost', Math.min(1, this.v / VMAX + Math.abs(this.slip) * 2));
  }
  /** the road's height under a world point near here (for a wheel's contact) */
  private groundAt(x: number, z: number, fallback: number) {
    const loc = this.course.locate(x, z, this.s), q = this.course.point(loc.s, loc.u);
    return q.surface ? q.y : fallback;
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
    [b.roll, b.vRoll] = spring(b.roll, b.vRoll, -this.lean * 0.45, 7, 0.45, 0);
    [b.shift, b.vShift] = spring(b.shift, b.vShift, this.slip * 0.12 - this.lean * 0.05, 8, 0.4, 0);
    [b.fore, b.vFore] = spring(b.fore, b.vFore, this.air ? -0.04 : 0, 8, 0.3, -Math.max(-25, Math.min(25, acc)) * 0.7);
    [b.rise, b.vRise] = spring(b.rise, b.vRise, this.air ? 0.07 : 0, 10, 0.28, -Math.max(-40, Math.min(40, lurch)) * 0.3);
    b.fore = Math.max(-0.16, Math.min(0.14, b.fore)); b.rise = Math.max(-0.14, Math.min(0.1, b.rise)); b.roll = Math.max(-0.4, Math.min(0.4, b.roll)); b.shift = Math.max(-0.12, Math.min(0.12, b.shift));
  }
  private launch(yBefore: number, dt: number, edge: boolean, lip = !edge) {
    // (off: the flight keeps the way you were carried, and the rise the ground was giving you; a lip gives a little pop)
    this.air = true; this.airT = 0;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = (this.vyGround || 0) + (lip ? 1.2 : 0);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y = yBefore + this.vy * dt;
    if (lip) { this.jumps++; this.ev('launch', 1); }
  }
  private fly(dt: number, inp: Input) {
    this.airT += dt;
    // (a little steer in the air, the bike's heading turned and the flight with it)
    const turn = -this.steerK * 0.6 * dt, c = Math.cos(turn), s = Math.sin(turn);
    const nvx = this.vx * c + this.vz * s, nvz = -this.vx * s + this.vz * c; this.vx = nvx; this.vz = nvz;
    this.vy -= G * dt; this.vx *= 1 - 0.002; this.vz *= 1 - 0.002;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.travel = Math.atan2(this.vx, this.vz); this.heading = this.travel + this.slip; this.slip *= Math.exp(-dt * 3);
    const loc = this.course.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u;
    const p = this.course.point(this.s, this.u), half = p.width / 2;
    // (in the air the nose follows the flight, slowly: + is nose up)
    this.pitch += (Math.atan2(this.vy, Math.hypot(this.vx, this.vz)) * 0.7 - this.pitch) * (1 - Math.exp(-dt * 2.5));
    this.lean *= Math.exp(-dt * 2);
    this.squash += (-0.35 - this.squash) * (1 - Math.exp(-dt * 4)); // (in the air the springs extend)
    void inp;
    const over = p.surface && Math.abs(this.u) < half + 2.2 && this.u > -half - 1.4;
    if (over && this.y <= p.y && p.y - this.y > 1.2) { this.crash(); return; }
    if (over && this.y <= p.y) {
      // (down: on the line again, its pace the flight's along the line; a hard one squashes and costs a little)
      const imp = -this.vy;
      this.air = false; this.y = p.y; this.v = Math.max(6, Math.hypot(this.vx, this.vz) * (imp > 14 ? 0.86 : imp > 8 ? 0.97 : 1));
      this.travel = Math.atan2(this.vx, this.vz); this.headingWas = this.travel;
      this.bestAir = Math.max(this.bestAir, this.airT); this.squash = Math.min(1, imp / 12); this.vyGround = NaN;
      this.ev('land', Math.min(1, imp / 10));
      return;
    }
    // (fallen well below where the surface would be: a crash, and back on the line)
    if (this.y < p.y - 7 || (this.u < -half - 1.4 && this.y < p.y + 0.3)) this.crash();
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
