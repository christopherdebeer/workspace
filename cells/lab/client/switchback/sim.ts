/**
 * Switchback's rider: arcade physics on the real ground, readable at speed.
 *
 * The bike goes where it points: steering turns the bike itself (by touch you **aim** it: how far your drag has moved
 * from where it began sets the bike's heading against the one it had then, so it turns as far as you drag and holds
 * there; by keys you turn it at a rate). Nothing turns it for you: hands off, it runs straight on. The way it's
 * **travelling** follows the way it points only as fast as the tyres' grip allows (a lateral pull of so many g, less
 * braking): turn harder than that and the rear steps out, the bike yawed past its line, sliding, scrubbing pace and
 * throwing roost, until the travel comes round.
 *
 * It rides on whatever's under it: the road (its rough, its ramps) within the road's width, the carved ground beyond it
 * (slower going). A face rising sharply in front is a wall: you glance off it. Ground falling away faster than you'd drop
 * (a ramp's lip, a crest, the edge of an embankment) and you fly, a ballistic arc, steerable a little; you come down on
 * whatever's under you, and a fall from high, or onto rough ground well off the road, is a crash: back on the line where
 * you left it.
 */
import { Course } from './course';

export const G = 9.8, VMAX = 46;
/** the tyres' grip, as a lateral pull (m/s²), riding and braking */
export const GRIP = 28, GRIP_BRAKING = 20;
export type Event = { kind: 'roost' | 'land' | 'wall' | 'launch' | 'crash'; x: number; y: number; z: number; k: number };
/** steer: a rate (-1…1, + right); aim: a heading to turn the bike to (overrides steer); brake */
export interface Input { steer: number; brake: boolean; aim?: number }

export class Rider {
  s = 2; u = 0; psi = 0; v = 16;
  /** heading: the way the bike points; travel: the way it's going (the difference is the slide) */
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; heading = 0; travel = 0; slip = 0;
  air = false; airT = 0; crashT = 0; onRoad = true;
  /** for the eye and the model: lean into the turn, pitch with the ground or the flight, the suspension's give */
  lean = 0; pitch = 0; squash = 0; steerK = 0;
  /** the run: metres down, best air, crashes, a score */
  dist = 0; bestAir = 0; crashes = 0; jumps = 0;
  events: Event[] = [];
  /** the ground's own vertical pace under you last step (NaN: just come down, nothing to compare yet) */
  private vyGround = NaN; private headingWas = 0;
  constructor(readonly course: Course) { this.place(); }
  private place() { const p = this.course.point(this.s, this.u); this.x = p.x; this.y = p.y; this.z = p.z; this.heading = this.travel = this.headingWas = p.heading; this.slip = 0; }
  private ev(kind: Event['kind'], k: number) { this.events.push({ kind, x: this.x, y: this.y, z: this.z, k }); if (this.events.length > 64) this.events.shift(); }
  /** the surface under (x, z) near distance s: the road within its width, else the carved ground */
  surface(x: number, z: number, s: number) {
    const loc = this.course.locate(x, z, s), p = this.course.point(loc.s, loc.u);
    const road = Math.abs(loc.u) <= p.width / 2 + 0.25 && p.surface;
    return { y: road ? p.y : this.course.ground(x, z), road, s: loc.s, u: loc.u, p };
  }

  step(dt: number, inp: Input) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        // (back on the line where you left it, on ground, and going again)
        this.u = 0; this.v = 14; this.air = false; this.vy = 0; this.vyGround = NaN; this.s = Math.max(2, this.s);
        while (!this.course.point(this.s, 0).surface || this.course.at(this.s).feature !== 'none') this.s += 1;
        this.place();
      } else { this.vy -= G * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt; this.pitch += dt * 3; }
      return;
    }
    this.steerK += (inp.steer - this.steerK) * (1 - Math.exp(-dt * 14));
    if (this.air) return this.fly(dt, inp);
    const c = this.course;
    // (steering turns the bike: to the aimed heading, quickly, or at a rate; + is right, which turns the heading down)
    const maxYaw = 3.6 / (1 + this.v / 70);
    const yaw = inp.aim !== undefined ? Math.max(-maxYaw, Math.min(maxYaw, wrap(inp.aim - this.heading) * 10)) : -this.steerK * maxYaw;
    this.heading += yaw * dt;
    // (the travel follows the bike as far as the grip allows; past that, the rear slides, scrubbing pace)
    const grip = (inp.brake ? GRIP_BRAKING : GRIP) * (this.onRoad ? 1 : 0.7), maxTurn = grip / Math.max(4, this.v);
    const d = wrap(this.heading - this.travel);
    this.travel += Math.max(-maxTurn * dt, Math.min(maxTurn * dt, d * (1 - Math.exp(-dt * 16))));
    this.slip = wrap(this.heading - this.travel);
    // (a slide the rider isn't holding comes back in line, the bike swinging round to its travel)
    if (inp.aim === undefined && Math.abs(this.steerK) < 0.1) this.heading -= this.slip * (1 - Math.exp(-dt * 2.5));
    // (pace: the fall of the ground, the engine up to its top, the air's drag, the brake, the slide's scrub, rough going)
    const slope = Number.isNaN(this.vyGround) ? 0 : -this.vyGround / Math.max(4, this.v);
    let a = G * slope * 0.85 + (this.v < VMAX && !inp.brake ? 11 * (1 - this.v / VMAX) : 0) - 0.0022 * this.v * this.v - (inp.brake ? 18 : 0) - Math.abs(this.slip) * this.v * 0.6;
    if (!this.onRoad) a -= 5;
    this.v = Math.max(3, this.v + a * dt);
    const xWas = this.x, zWas = this.z, yBefore = this.y, sWas = this.s, here = c.point(this.s, this.u);
    this.x += Math.sin(this.travel) * this.v * dt; this.z += Math.cos(this.travel) * this.v * dt;
    let q = this.surface(this.x, this.z, this.s);
    // (a face rising sharply in front: a wall; you glance off it, turned along the road, the pace lost)
    if (q.y - yBefore > 0.9) {
      // (turned away from the side the blocked move was heading for: + u is right, and turning left raises the heading)
      const away = q.u > this.u ? 1 : -1;
      this.x = xWas; this.z = zWas;
      const lh = c.point(this.s, 0).heading;
      this.travel = this.heading = lh + away * 0.15; this.v = Math.max(4, this.v * 0.7); this.ev('wall', this.v / VMAX);
      q = this.surface(this.x, this.z, this.s);
    }
    this.s = q.s; this.u = q.u; this.onRoad = q.road; this.dist += Math.max(0, this.s - sWas);
    this.psi = wrap(c.point(this.s, 0).heading - this.travel);
    // (a ramp's lip: you fly, with a pop; the ground falling away under you (an edge, a gap): you fly)
    if (here.feature === 'ramp' && q.p.feature !== 'ramp' && Math.abs(q.u) <= q.p.width / 2 + 0.25) { this.launch(yBefore, dt, true); return; }
    if (q.y < yBefore - 1.0) { this.launch(yBefore, dt, false); return; }
    const vyG = (q.y - yBefore) / dt;
    // (a crest: the ground a tenth of a second on falls away below the arc you'd fly from here, by more than the
    // suspension takes up)
    const tau = 0.12, ax = this.x + Math.sin(this.travel) * this.v * tau, az = this.z + Math.cos(this.travel) * this.v * tau;
    const ahead = this.surface(ax, az, this.s).y, arc = q.y + vyG * tau - 0.5 * G * tau * tau;
    if (this.v > 8 && !Number.isNaN(this.vyGround) && ahead < arc - 0.26) { this.launch(yBefore, dt, here.feature === 'ramp'); return; }
    // (the suspension takes up each step the ground throws you up by)
    if (!Number.isNaN(this.vyGround)) this.squash = Math.min(1, this.squash + Math.max(0, vyG - this.vyGround) * 0.07);
    this.vyGround = Number.isNaN(this.vyGround) ? vyG : this.vyGround + (vyG - this.vyGround) * 0.5;
    this.y = q.y;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = vyG;
    // (lean: what the turn asks (pace times how fast the travel's swinging, against gravity), and more in a slide)
    const yr = wrap(this.travel - this.headingWas) / dt; this.headingWas = this.travel;
    this.lean += (Math.max(-0.95, Math.min(0.95, Math.atan2(-this.v * yr, G) - this.slip * 0.6)) - this.lean) * (1 - Math.exp(-dt * 8));
    this.pitch += (Math.atan2(-vyG, this.v) - this.pitch) * (1 - Math.exp(-dt * 10));
    this.squash *= Math.exp(-dt * 6);
    if (Math.random() < dt * (6 + this.v * 0.6 + Math.abs(this.slip) * 140)) this.ev('roost', Math.min(1, this.v / VMAX + Math.abs(this.slip) * 2));
  }
  private launch(yBefore: number, dt: number, lip: boolean) {
    // (off: the flight keeps the way you were carried, and the rise the ground was giving you; a lip gives a little pop)
    this.air = true; this.airT = 0;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = (Number.isNaN(this.vyGround) ? 0 : this.vyGround) + (lip ? 1.2 : 0);
    this.y = yBefore + this.vy * dt;
    if (lip) { this.jumps++; this.ev('launch', 1); }
  }
  private fly(dt: number, inp: Input) {
    this.airT += dt;
    // (a little turn in the air, the flight with it)
    const want = inp.aim !== undefined ? Math.max(-1, Math.min(1, -wrap(inp.aim - this.heading) * 3)) : this.steerK;
    const turn = -want * 0.6 * dt, ct = Math.cos(turn), sn = Math.sin(turn);
    const nvx = this.vx * ct + this.vz * sn, nvz = -this.vx * sn + this.vz * ct; this.vx = nvx; this.vz = nvz;
    this.vy -= G * dt; this.vx *= 1 - 0.002; this.vz *= 1 - 0.002;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.travel = Math.atan2(this.vx, this.vz); this.heading = this.travel + this.slip; this.slip *= Math.exp(-dt * 3);
    const q = this.surface(this.x, this.z, this.s); this.s = q.s; this.u = q.u;
    this.pitch += (Math.atan2(-this.vy, Math.hypot(this.vx, this.vz)) * 0.8 - this.pitch) * (1 - Math.exp(-dt * 3));
    this.lean *= Math.exp(-dt * 2);
    this.squash += (-0.35 - this.squash) * (1 - Math.exp(-dt * 4)); // (in the air the springs extend)
    if (this.y > q.y) {
      // (fallen far below the road, off the mountain: that run's over)
      if (this.y < this.course.point(this.s, 0).y - 30) this.crash();
      return;
    }
    // (down: the impact is the speed into the ground's own slope (a landing down a slope that matches the flight is
    // soft, one onto the flat from the same height isn't); through a face rather than onto it, too hard, or onto rough
    // ground well off the road: a crash)
    const vh = Math.hypot(this.vx, this.vz), ax = this.x + this.vx / Math.max(1, vh), az = this.z + this.vz / Math.max(1, vh);
    const fallAway = q.y - this.surface(ax, az, this.s).y, imp = -(this.vy + vh * fallAway);
    if (q.y - this.y > 1.2 || imp > 15 || (!q.road && Math.abs(this.u) > q.p.width / 2 + 9)) { this.crash(); return; }
    // (else down: a hard one squashes and costs a little)
    this.air = false; this.onRoad = q.road; this.y = q.y; this.v = Math.max(6, Math.hypot(this.vx, this.vz) * (imp > 14 ? 0.86 : imp > 8 ? 0.97 : 1));
    this.travel = Math.atan2(this.vx, this.vz); this.headingWas = this.travel;
    this.bestAir = Math.max(this.bestAir, this.airT); this.squash = Math.min(1, imp / 12); this.vyGround = NaN;
    this.ev('land', Math.min(1, imp / 10));
  }
  private crash() { this.crashT = 1.1; this.crashes++; this.ev('crash', 1); this.air = true; }
}

/** the fastest you can be going now and still make every turn ahead (by the tyres' grip, braking from here) */
export function safeSpeed(r: Rider) {
  let allowed = VMAX;
  const look = Math.max(30, r.v * 2.6);
  for (let d = 2; d < look; d += 2) {
    const a = r.course.point(r.s + d - 5, 0).heading, b = r.course.point(r.s + d + 5, 0).heading;
    const k = Math.abs(wrap(b - a)) / 10;
    if (k < 1e-3) continue;
    const vt = Math.sqrt((GRIP * 0.7) / k);
    allowed = Math.min(allowed, Math.sqrt(vt * vt + 2 * 15 * d));
  }
  return allowed;
}

/** the sim's own rider (for `auto`, the preview and the tests): aims at a point on the line ahead (further the faster),
 * and brakes for the turns it can't make at this pace */
export function autoRide(r: Rider): { steer: number; brake: boolean; aim: number } {
  // (the look-ahead: further the faster, but never further round a tight turn than its radius allows)
  const k = Math.abs(wrap(r.course.point(r.s + 8, 0).heading - r.course.point(r.s, 0).heading)) / 8 + 1e-4;
  const L = Math.max(4, Math.min(5 + r.v * 0.3, 0.7 / k));
  const P = r.course.point(r.s + L, 0), aim = Math.atan2(P.x - r.x, P.z - r.z);
  // (no braking on a ramp: commit to it)
  const ramp = r.course.at(r.s).feature === 'ramp';
  return { steer: 0, aim, brake: !ramp && r.v > safeSpeed(r) + 0.5 };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
