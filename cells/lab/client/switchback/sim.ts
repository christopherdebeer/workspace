/**
 * Switchback's rider: arcade physics, readable at speed.
 *
 * On the ground the bike is held in the course's own frame: how far down the line (s), how far across it (u), and its
 * angle off the line (psi), which your steering sets; so with no input it follows the line round its bends, and a steer
 * carries you across it. The fall of the hill drives you on, the engine adds to it, the air holds you back. Off a ramp's lip,
 * or over a crest steeper than you can hold, you fly (a ballistic arc, steerable a little), and come down on whatever's
 * under you. Off the drop side, too far: a fall, and back on the line. Into the wall: a glance off it, the pace lost.
 */
import { Course } from './course';

export const G = 9.8, VMAX = 34;
export type Event = { kind: 'roost' | 'land' | 'wall' | 'launch' | 'crash'; x: number; y: number; z: number; k: number };
export interface Input { steer: number; brake: boolean }

export class Rider {
  s = 2; u = 0; psi = 0; v = 14;
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; heading = 0;
  air = false; airT = 0; crashT = 0;
  /** for the eye and the model: lean into the turn, pitch with the ground or the flight, the suspension's give */
  lean = 0; pitch = 0; squash = 0; steerK = 0;
  /** the run: metres down, best air, crashes, a score */
  dist = 0; bestAir = 0; crashes = 0; jumps = 0;
  events: Event[] = [];
  /** the ground's own vertical pace under you last step (NaN: just come down, nothing to compare yet) */
  private vyGround = NaN; private headingWas = 0;
  constructor(readonly course: Course) { this.place(); }
  private place() { const p = this.course.point(this.s, this.u); this.x = p.x; this.y = p.y; this.z = p.z; this.heading = p.heading - this.psi; }
  private ev(kind: Event['kind'], k: number) { this.events.push({ kind, x: this.x, y: this.y, z: this.z, k }); if (this.events.length > 64) this.events.shift(); }

  step(dt: number, inp: Input) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        // (back on the line where you left it, on ground, and going again)
        this.u = 0; this.psi = 0; this.v = 12; this.air = false; this.vy = 0; this.vyGround = NaN; this.s = Math.max(2, this.s);
        while (!this.course.point(this.s, 0).surface || this.course.at(this.s).feature !== 'none') this.s += 1;
        this.place();
      }
      else { this.vy -= G * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt; this.pitch += dt * 3; }
      return;
    }
    this.steerK += (inp.steer - this.steerK) * (1 - Math.exp(-dt * 10));
    if (this.air) return this.fly(dt, inp);
    const c = this.course, here = c.point(this.s, this.u), half = here.width / 2;
    // (pace: the hill's fall, the engine up to its top, the air's drag, the brake; slower on the loose shoulder)
    const grade = c.point(this.s - 1, 0).y - c.point(this.s + 1, 0).y;
    let a = G * grade * 0.5 * 0.85 + (this.v < VMAX ? 6 * (1 - this.v / VMAX) : 0) - 0.0035 * this.v * this.v - (inp.brake ? 14 : 0);
    if (Math.abs(this.u) > half) a -= 6;
    this.v = Math.max(4, this.v + a * dt);
    // (steering: your input sets the angle off the line, more at low speed; a little self-centring so a bend's held)
    const want = this.steerK * (0.55 - 0.25 * Math.min(1, this.v / VMAX));
    this.psi += (want - this.psi) * (1 - Math.exp(-dt * 6));
    const ds = this.v * Math.cos(this.psi) * dt, du = this.v * Math.sin(this.psi) * dt;
    const yBefore = this.y;
    this.s += ds; this.u += du; this.dist += ds;
    // (the wall, on the left: a glance off it; the drop, on the right: over the edge)
    if (this.u < -half - 1.4) { this.u = -half - 1.4; this.psi = Math.abs(this.psi) * 0.5; this.v *= 0.72; this.ev('wall', this.v / VMAX); }
    const p = c.point(this.s, this.u);
    // (a ramp's lip, or a crest that falls away faster than you'd drop: you fly; off the edge, or onto nothing: you fall)
    if (here.feature === 'ramp' && p.feature !== 'ramp') { this.launch(yBefore, dt, false); return; }
    if (this.u > half + 2.2 || !p.surface) { this.launch(yBefore, dt, true); return; }
    const vyG = (p.y - yBefore) / dt;
    if (vyG < this.vyGround - G * dt * 1.6 && this.v > 8) { this.launch(yBefore, dt, false); return; }
    this.vyGround = vyG;
    this.x = p.x; this.y = p.y; this.z = p.z; this.heading = p.heading - this.psi;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = vyG;
    // (lean: what the turn asks, its pace times how fast the heading's swinging, against gravity; + leans right)
    const yaw = wrap(this.heading - this.headingWas) / dt; this.headingWas = this.heading;
    this.lean += (Math.max(-0.95, Math.min(0.95, Math.atan2(-this.v * yaw, G))) - this.lean) * (1 - Math.exp(-dt * 8));
    this.pitch += (Math.atan2(-vyG, this.v) - this.pitch) * (1 - Math.exp(-dt * 10));
    this.squash *= Math.exp(-dt * 6);
    if (Math.random() < dt * (6 + this.v * 0.6)) this.ev('roost', this.v / VMAX);
  }
  private launch(yBefore: number, dt: number, edge: boolean) {
    // (off: the flight keeps the way you were carried, and the rise the ground was giving you; a lip gives a little pop)
    this.air = true; this.airT = 0;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = (this.vyGround || 0) + (edge ? 0 : 1.2);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y = yBefore + this.vy * dt;
    if (!edge) { this.jumps++; this.ev('launch', 1); }
  }
  private fly(dt: number, inp: Input) {
    this.airT += dt;
    // (a little steer in the air, the bike's heading turned and the flight with it)
    const turn = -this.steerK * 0.6 * dt, c = Math.cos(turn), s = Math.sin(turn);
    const nvx = this.vx * c + this.vz * s, nvz = -this.vx * s + this.vz * c; this.vx = nvx; this.vz = nvz;
    this.vy -= G * dt; this.vx *= 1 - 0.002; this.vz *= 1 - 0.002;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.heading = Math.atan2(this.vx, this.vz);
    const loc = this.course.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u;
    const p = this.course.point(this.s, this.u), half = p.width / 2;
    this.pitch += (Math.atan2(-this.vy, Math.hypot(this.vx, this.vz)) * 0.8 - this.pitch) * (1 - Math.exp(-dt * 3));
    this.lean *= Math.exp(-dt * 2);
    void inp;
    const over = p.surface && Math.abs(this.u) < half + 2.2 && this.u > -half - 1.4;
    if (over && this.y <= p.y && p.y - this.y > 1.2) { this.crash(); return; }
    if (over && this.y <= p.y) {
      // (down: on the line again, its pace the flight's along the line; a hard one squashes and costs a little)
      const imp = -this.vy, along = this.vx * Math.sin(p.heading) + this.vz * Math.cos(p.heading);
      this.air = false; this.y = p.y; this.v = Math.max(6, along * (imp > 12 ? 0.8 : 0.96));
      this.psi = Math.max(-0.6, Math.min(0.6, Math.atan2(-this.vx * Math.cos(p.heading) + this.vz * Math.sin(p.heading), along)));
      this.bestAir = Math.max(this.bestAir, this.airT); this.squash = Math.min(1, imp / 12); this.vyGround = NaN;
      this.ev('land', Math.min(1, imp / 10));
      return;
    }
    // (fallen well below where the surface would be: a crash, and back on the line)
    if (this.y < p.y - 7 || (this.u < -half - 1.4 && this.y < p.y + 0.3)) this.crash();
  }
  private crash() { this.crashT = 1.1; this.crashes++; this.ev('crash', 1); this.air = true; }
}

/** a steer that keeps to the line (for `auto`, the preview and the tests): back toward the middle, a little ahead */
export function autoSteer(r: Rider) {
  return Math.max(-1, Math.min(1, -r.u * 0.25 - r.psi * 1.5));
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
