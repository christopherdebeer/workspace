/**
 * Roof Jumps' runner: the body as a point with a velocity, and the judgement that makes the running effortless.
 *
 * The only input is a direction (and, optionally, a jump). Everything else is the runner's own: at an edge, a step or
 * a wall it looks along the way it's going, finds where it can next stand, and throws itself there on an arc worked
 * out to land it (`leap`). A wall too high to leap onto is jumped at, caught and run up. And it is light: it goes up
 * as anything does, but comes down slowly, arms out, at no more than a gentle sink, so a leap carries a long way, a
 * drop into a street is a glide that can be steered, and every landing is soft. So holding a direction is enough to
 * cross the city in it.
 *
 * No DOM, no drawing: it asks the city one question (`heightAt`), and keeps what the rig needs to pose a figure
 * (stride phase, time in the air, the leading leg, how hard it landed).
 */
import type { City } from './city';

export interface Input { x: number; z: number; jump: boolean }

/** gravity going up; and coming down, with the fastest it sinks (m/s², m/s) */
export const G = 20, GF = 7, SINK = 7.5;
/** how long a fall of `s` metres from rest takes, sinking like that */
const fall = (s: number) => (s <= (SINK * SINK) / (2 * GF) ? Math.sqrt((2 * Math.max(0, s)) / GF) : SINK / GF + (s - (SINK * SINK) / (2 * GF)) / SINK);
/** running, and after a couple of seconds of it (m/s) */
const RUN = 9, SPRINT = 12.5;
const ACCEL = 42;
/** a difference in height walked over without a thought (m) */
const STEP = 0.45;
/** how far up a leap can land (a storey), and how far down it will choose to before looking for anything higher (m) */
const RISE = 3.4, DROP = 7;
/** the fastest a leap carries (m/s) */
const VLEAP = 17;
const CLIMB = 13;
/** the body's radius against walls (m) */
const R = 0.35;
const JUMP = 9.5;

export type State = 'ground' | 'air' | 'climb';

export class Runner {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  heading = 0; state: State = 'ground';
  /** seconds of unbroken running: the sprint builds on it */
  runT = 0;
  /** the stride, in radians: one turn is two steps */
  phase = 0;
  airT = 0;
  /** the upward speed this flight began with: the rig reads the flight's shape against it */
  vy0 = JUMP;
  /** which leg leads a leap: alternates */
  lead = 0;
  /** how hard the last landing was, 0..1, fading: the crouch */
  land = 0;
  climbT = 0;
  /** rate of turn (rad/s), smoothed: the lean into a bend */
  turn = 0;
  /** in a leap aimed at a landing: left alone in the air unless the input turns away from it */
  planned = false;
  private wx = 0; private wz = 0; private top = 0;
  private air2 = false;
  leaps = 0; climbs = 0; dist = 0;

  constructor(readonly city: City) { const s = city.start(); this.x = s.x; this.y = s.y; this.z = s.z; }

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  step(dt: number, inp: Input): void {
    const mag = Math.min(1, Math.hypot(inp.x, inp.z)), on = mag > 0.1;
    const dx = on ? inp.x / Math.hypot(inp.x, inp.z) : 0, dz = on ? inp.z / Math.hypot(inp.x, inp.z) : 0;
    const x0 = this.x, z0 = this.z, h0 = this.heading;
    this.land *= Math.exp(-6 * dt);
    if (this.state === 'ground') this.ground(dt, mag, on, dx, dz, inp.jump);
    else if (this.state === 'air') this.air(dt, on, dx, dz, inp.jump);
    else this.climb(dt, on, dx, dz, inp.jump);
    // (facing: the way it's going; on a wall, the wall)
    const sp = this.speed;
    const want = this.state === 'climb' ? Math.atan2(this.wx, this.wz) : sp > 1 ? Math.atan2(this.vx, this.vz) : this.heading;
    let d = want - this.heading; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    this.heading += d * (1 - Math.exp(-16 * dt));
    let dh = this.heading - h0; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
    this.turn += (dh / dt - this.turn) * (1 - Math.exp(-8 * dt));
    this.dist += Math.hypot(this.x - x0, this.z - z0);
  }

  private ground(dt: number, mag: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.runT = mag > 0.5 ? this.runT + dt : 0;
    const k = Math.min(1, Math.max(0, (this.runT - 0.5) / 2)), top = mag * (RUN + (SPRINT - RUN) * k * k * (3 - 2 * k));
    // (toward the wanted velocity, at a fixed rate: a turn is quick, a reversal a skid)
    const tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = ACCEL * dt;
    if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    const sp = this.speed;
    this.phase += ((sp * dt) / (1.3 + 0.27 * sp)) * 2 * Math.PI;
    if (jump) { this.launch(JUMP, false); return; }
    if (on) {
      // (the way it looks: the way it's going, or from a stand the way it's asked)
      const ux = sp > 2 ? this.vx / sp : dx, uz = sp > 2 ? this.vz / sp : dz, ahead = 0.45 + sp * 0.06;
      if (ux * dx + uz * dz > 0.3 && Math.abs(H(this.x + ux * ahead, this.z + uz * ahead) - this.y) > STEP) { this.leap(ux, uz, ahead, sp); return; }
    }
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, h = H(nx, nz);
    if (Math.abs(h - this.y) <= STEP) { this.x = nx; this.z = nz; this.y = h; }
    else if (h < this.y) { this.x = nx; this.z = nz; this.state = 'air'; this.vy = 0; this.vy0 = JUMP; this.airT = 0; this.planned = false; this.air2 = true; }
    // (a corner the look ahead went past: leapt, from where it stands)
    else if (on) this.leap(dx, dz, 0.05, sp);
    else { this.vx = 0; this.vz = 0; }
  }

  private launch(vy: number, planned: boolean): void {
    this.state = 'air'; this.vy = vy; this.vy0 = Math.max(4, vy); this.airT = 0; this.planned = planned; this.air2 = true;
    this.lead ^= 1; this.leaps++;
  }

  /** Look along (ux, uz) for where to stand next, and go there on an arc that lands it. */
  private leap(ux: number, uz: number, from: number, sp: number): void {
    const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
    /** somewhere to stand: the same height for a good stride beyond */
    const flat = (d: number, h: number) => Math.abs(H(d + 0.6) - h) < 0.1 && Math.abs(H(d + 1.2) - h) < 0.1;
    const reach = 8 + sp, y = this.y;
    let at = -1, to = 0, over = y, wall = -1;
    // (the first place within a storey up or a couple down; what's in the way before it, to clear; or a wall)
    for (let d = from; d <= reach; d += 0.5) {
      const h = H(d);
      if (h > y + RISE) { wall = d; break; }
      if (h >= y - DROP) { if (flat(d, h)) { at = d; to = h; break; } over = Math.max(over, h); }
    }
    if (at < 0 && wall >= 0) {
      // (a wall: jump at it, to meet it near the top of the jump, and run up it from there)
      const t = JUMP / G, v = Math.min(14, Math.max(sp, wall / t));
      this.vx = ux * v; this.vz = uz * v; this.launch(JUMP, false); return;
    }
    if (at < 0) {
      // (nothing near this height: the highest place in reach, however far down)
      for (let d = from; d <= reach; d += 0.5) { const h = H(d); if (h < y - DROP && (at < 0 || h > to) && flat(d, h)) { at = d; to = h; } }
      if (at < 0) { this.vx = ux * Math.max(sp, 5); this.vz = uz * Math.max(sp, 5); this.launch(JUMP * 0.8, false); return; }
    }
    let D = at + 0.7;
    const dh = to - y;
    // (the arc: up to an apex that clears what's between, down to the landing; higher if it'd otherwise be too fast)
    let apex = Math.max(0, dh, over - y) + 0.55 + 0.045 * D, T = 0, up = 0;
    for (let i = 0; i < 24; i++) { up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh); if (D / T <= VLEAP) break; apex += 0.4; }
    let v = D / T;
    // (keep the pace where the landing has the room for it)
    const keep = Math.min(VLEAP, sp) * 0.85;
    if (v < keep) { const D2 = keep * T; if (Math.abs(H(D2) - to) < 0.1 && Math.abs(H((D + D2) / 2) - to) < 0.1 && Math.abs(H(D2 + 0.6) - to) < 0.1) { D = D2; v = keep; } }
    // (a hop that would hang in the air: flatter, if what's in the way allows; and off a height, out at a run, to land wherever)
    let aimed = true;
    if (v < 5) {
      apex = Math.max(0, dh, over - y) + 0.25; up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh); v = D / T;
      if (v < 5) { v = Math.min(9, Math.max(sp, 5)); aimed = false; }
    }
    this.vx = ux * v; this.vz = uz * v;
    this.launch(G * up, aimed);
  }

  private air(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.airT += dt;
    const sp = this.speed;
    if (this.planned && on && sp > 0.5 && (this.vx * dx + this.vz * dz) / sp < 0.5) this.planned = false;
    if (!this.planned && on) {
      const top = Math.max(sp, 7), tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = 16 * dt;
      if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    }
    // (a second jump, off nothing: once a flight)
    if (jump && this.air2) { this.air2 = false; this.vy = JUMP * 0.9; this.vy0 = this.vy; this.airT = 0; this.planned = false; this.lead ^= 1; this.leaps++; }
    this.vy = Math.max(-SINK, this.vy - (this.vy > 0 ? G : GF) * dt);
    const s2 = this.speed, ux = s2 > 0.1 ? this.vx / s2 : 0, uz = s2 > 0.1 ? this.vz / s2 : 0;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, ny = this.y + this.vy * dt;
    // (a corner can slip between two looks ahead: so where the body itself would be counts too)
    let px = nx + ux * R, pz = nz + uz * R, h = H(px, pz);
    if (H(nx, nz) > h) { px = nx; pz = nz; h = H(nx, nz); }
    if (h > ny + 0.05) {
      // (something in the way: a lip is stepped up onto, a wall is caught and run up)
      if (h - ny <= 0.6) { this.x = px; this.z = pz; this.y = h; this.touch(Math.max(0, -this.vy)); return; }
      this.state = 'climb'; this.wx = ux; this.wz = uz; this.top = h; this.climbT = 0; this.climbs++; this.y = ny; this.vx = this.vz = this.vy = 0;
      return;
    }
    this.x = nx; this.z = nz; this.y = ny;
    const g = H(nx, nz);
    if (this.y <= g && this.vy <= 0) { this.y = g; this.touch(-this.vy); }
  }

  private touch(impact: number): void {
    this.state = 'ground'; this.vy = 0; this.planned = false;
    this.land = Math.max(this.land, Math.min(1, impact / 9));
  }

  private climb(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    this.climbT += dt;
    // (turned away from the wall, or a jump: off it, the other way)
    if ((on && dx * this.wx + dz * this.wz < -0.4) || jump) {
      const ox = on ? dx : -this.wx, oz = on ? dz : -this.wz;
      this.vx = ox * 8; this.vz = oz * 8; this.launch(JUMP, false); return;
    }
    this.y += CLIMB * dt;
    if (this.y < this.top) return;
    // (over the top, unless what's there goes on up: then on up)
    const px = this.x + this.wx * (R + 0.35), pz = this.z + this.wz * (R + 0.35), h = this.city.heightAt(px, pz);
    if (h > this.top + 0.05) { this.top = h; return; }
    this.x = px; this.z = pz; this.y = h; this.state = 'ground';
    this.vx = this.wx * 5; this.vz = this.wz * 5; this.land = Math.max(this.land, 0.35);
  }
}
