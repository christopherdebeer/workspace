/**
 * Roof Jumps' runner: the body as a point with a velocity, and the judgement that makes the running effortless.
 *
 * The only input is a direction (and, optionally, a jump). Everything else is the runner's own: at an edge, a step or
 * a wall it looks along the way it's going, finds where it can next stand, and throws itself there on an arc worked
 * out to land it (`leap`). What it throws is chosen by what's in front of it, so no two crossings in a row are the
 * same thing:
 *
 *   vault    over clutter and rims, where there's an edge to put a hand on: lower and quicker still
 *   hop      the same with nothing to hold: a hurdle
 *   bound    a gap at about this height: flat and fast, the legs split
 *   flip     the same, every so often, turned over in the air
 *   spring   up a storey: steep, the arms thrown up, a crouch on top
 *   dive     down a storey or so: headfirst, and rolled out of
 *   glide    a long way across or a long way down: the slow one, arms out, steerable
 *
 * On the ground it runs, sprints, bursts into a dash off a clean landing with room ahead, rolls out of a dive or a
 * hard landing, and balances along anything narrow (a rim, a wall across an alley), drawn to its line. In the air a
 * wall alongside is run along, tilted off it, and kicked away from, wall to wall down an alley; a wall ahead too
 * high to spring onto is jumped at, caught and run up.
 *
 * What its hands do is the city's to offer (city.ts: the holds). Up a wall they go to the sills, the pipe, the top
 * edge, whatever is in reach, and it climbs fast; with nothing to hold it climbs slowly. Over a unit one is planted on
 * its edge. Landing a storey up, both come down on the lip. Along a wall the near one trails on it; out of a dive both
 * go to the ground; a deep landing is three-pointed. `reach` is where each hand wants to be: the rig takes it there.
 *
 * No DOM, no drawing: it asks the city for heights, and keeps what the rig needs to pose a figure (`move`, how far
 * through it, the stride, the leading leg, the wall's side, the landing's weight).
 */
import type { City, Hold } from './city';
import { TUNE } from './tune';

export interface Input { x: number; z: number; jump: boolean }

export type Move = 'run' | 'dash' | 'ledge' | 'roll' | 'vault' | 'hop' | 'bound' | 'flip' | 'spring' | 'dive' | 'glide' | 'climb' | 'wallrun';
export type State = 'ground' | 'air' | 'climb' | 'wall';

type P3 = [number, number, number];
/** where each hand wants to be, if anywhere: a point in the world */
export interface Reach { hl?: P3; hr?: P3 }

/** what the rig reads of a body */
export interface Body {
  x: number; y: number; z: number; heading: number; speed: number; state: State; move: Move;
  /** how far through the move, 0..1 (a flight, a roll) */
  mu: number;
  phase: number; lead: number; land: number; turn: number; climbT: number; wallT: number;
  /** which side the wall is on, running along one: 1 the figure's +x, -1 the other */
  wallSide: number;
  reach: Reach;
}


/** how long a fall of `s` metres from rest takes: as anything falls, or gliding */
const fall = (s: number, float: boolean) => {
  s = Math.max(0, s);
  const G = TUNE.gravity, GF = TUNE.glideGravity, SINK = TUNE.sink;
  if (!float) return Math.sqrt((2 * s) / G);
  return s <= (SINK * SINK) / (2 * GF) ? Math.sqrt((2 * s) / GF) : SINK / GF + (s - (SINK * SINK) / (2 * GF)) / SINK;
};
/** a difference in height walked over without a thought (m) */
const STEP = 0.45;
/** the body's radius against walls (m) */
const R = 0.35;
const JUMP = 9.5;
/** a roll's length (s) */
const ROLL = 0.5;
const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** the point of a level hold nearest (x, z) */
const onHold = (h: Hold, x: number, z: number): P3 => {
  const dx = h.bx - h.ax, dz = h.bz - h.az, t = Math.max(0, Math.min(1, ((x - h.ax) * dx + (z - h.az) * dz) / (dx * dx + dz * dz || 1)));
  return [h.ax + dx * t, h.ay, h.az + dz * t];
};

export class Runner implements Body {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  heading = 0; state: State = 'ground'; move: Move = 'run'; mu = 0;
  /** seconds of unbroken running: the sprint builds on it */
  runT = 0;
  /** the stride, in radians: one turn is two steps */
  phase = 0;
  airT = 0;
  /** how long this flight is meant to take (s) */
  flightT = 1;
  /** coming down slowly, this flight */
  float = false;
  /** which leg leads a leap: alternates */
  lead = 0;
  /** how hard the last landing was, 0..1, fading: the crouch */
  land = 0;
  climbT = 0; wallT = 0; wallSide = 0;
  /** rate of turn (rad/s), smoothed: the lean into a bend */
  turn = 0;
  /** in a leap aimed at a landing: left alone in the air unless the input turns away from it */
  planned = false;
  private rollT = 0; private dashT = 0;
  /** on a wall: the way into it, the way along it, the pace along it; and a moment after leaving one before another is taken */
  private wx = 0; private wz = 0; private tx = 0; private tz = 0; private wsp = 0; private wallCool = 0;
  private top = 0;
  reach: Reach = {};
  /** a vault's hand hold; a spring's landing lip; a climb's grips, and when they were last looked for and last had */
  private plant: P3 | null = null; private plant2: P3 | null = null; private lip: [P3, P3] | null = null;
  /** the height a vault lands at: anything higher under it on the way is what it's going over */
  private vaultTo = 0;
  private grips: Reach = {}; private gripN = 0; private gripT = 0;
  private air2 = false; private flats = 0;
  leaps = 0; climbs = 0; walls = 0; rolls = 0; dashes = 0; dist = 0;
  /** times it has come down to the street off a roof */
  streets = 0; private high = 0;
  /** how many of each move it has made */
  made: Partial<Record<Move, number>> = {};

  constructor(readonly city: City) { const s = city.start(); this.x = s.x; this.y = s.y; this.z = s.z; }

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** another of it, as it is now, to be run on ahead without touching this one (plan.ts) */
  clone(): Runner { const c = Object.assign(Object.create(Runner.prototype) as Runner, this); c.made = { ...this.made }; return c; }
  private count(m: Move): void { this.made[m] = (this.made[m] ?? 0) + 1; }

  step(dt: number, inp: Input): void {
    const mag = Math.min(1, Math.hypot(inp.x, inp.z)), on = mag > 0.1;
    const dx = on ? inp.x / Math.hypot(inp.x, inp.z) : 0, dz = on ? inp.z / Math.hypot(inp.x, inp.z) : 0;
    const x0 = this.x, z0 = this.z, h0 = this.heading;
    this.land *= Math.exp(-6 * dt); this.wallCool -= dt;
    if (this.state === 'ground') this.ground(dt, mag, on, dx, dz, inp.jump);
    else if (this.state === 'air') this.air(dt, on, dx, dz, inp.jump);
    else if (this.state === 'wall') this.wall(dt, on, dx, dz, inp.jump);
    else this.climb(dt, on, dx, dz, inp.jump);
    // (facing: the way it's going; up a wall, the wall)
    const sp = this.speed;
    const want = this.state === 'climb' ? Math.atan2(this.wx, this.wz) : sp > 1 ? Math.atan2(this.vx, this.vz) : this.heading;
    let d = want - this.heading; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    this.heading += d * (1 - Math.exp(-16 * dt));
    let dh = this.heading - h0; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
    this.turn += (dh / dt - this.turn) * (1 - Math.exp(-8 * dt));
    this.dist += Math.hypot(this.x - x0, this.z - z0);
    this.reach = TUNE.reach ? this.reaching() : {};
    if (this.state === 'ground') { if (this.y < 0.5 && this.high > 4) this.streets++; this.high = this.y; } else this.high = Math.max(this.high, this.y);
  }

  /** Where the hands want to be, this instant. */
  private reaching(): Reach {
    const u = this.mu, L = this.lead === 1, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    /** a point by the figure: `a` ahead, `s` to its left, `h` up */
    const by = (a: number, s: number, h: number): P3 => [this.x + fx * a + fz * s, this.y + h, this.z + fz * a - fx * s];
    // (up a wall: what it has hold of, until it's gone by below the hips)
    if (this.state === 'climb') { const g = this.grips, ok = (p?: P3) => (p && p[1] - this.y > 1 ? p : undefined); return { hl: ok(g.hl), hr: ok(g.hr) }; }
    if (this.state === 'wall') {
      // (the near hand trails on the wall, about the shoulder's height, a little ahead)
      const p: P3 = [this.x + this.wx * (R + 0.02) + this.tx * 0.25, this.y + 1.3, this.z + this.wz * (R + 0.02) + this.tz * 0.25];
      return this.wallSide > 0 ? { hl: p } : { hr: p };
    }
    if (this.state === 'air') {
      if (this.move === 'vault' && this.plant && u > 0.12 && u < 0.82) return this.plant2 ? { hl: this.plant, hr: this.plant2 } : L ? { hr: this.plant } : { hl: this.plant };
      if (this.move === 'spring' && this.lip && u > 0.6) return { hl: this.lip[0], hr: this.lip[1] };
      return {};
    }
    // (out of a dive, both hands to the ground first; a deep landing, one)
    if (this.move === 'roll' && u < 0.28) return { hl: by(0.45, 0.16, 0), hr: by(0.45, -0.16, 0) };
    if (this.move === 'run' && this.land > 0.5) return L ? { hr: by(0.38, -0.26, 0) } : { hl: by(0.38, 0.26, 0) };
    return {};
  }

  private ground(dt: number, mag: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.runT = mag > 0.5 ? this.runT + dt : 0;
    if (this.rollT > 0) { this.rollT -= dt; this.mu = 1 - Math.max(0, this.rollT) / ROLL; }
    if (this.dashT > 0) this.dashT -= on ? dt : 1;
    let sp = this.speed;
    // (somewhere narrow: lower on both sides)
    const fx = sp > 1 ? this.vx / sp : Math.sin(this.heading), fz = sp > 1 ? this.vz / sp : Math.cos(this.heading);
    const ledge = this.y > 0 && H(this.x - fz * 0.8, this.z + fx * 0.8) < this.y - STEP && H(this.x + fz * 0.8, this.z - fx * 0.8) < this.y - STEP;
    const k = Math.min(1, Math.max(0, (this.runT - 0.5) / 2));
    let top = this.dashT > 0 ? TUNE.dash : mag * (TUNE.run + (TUNE.sprint - TUNE.run) * k * k * (3 - 2 * k));
    if (ledge) {
      top = Math.min(top, TUNE.ledgeSpeed);
      // (and if it runs our way, drawn onto its line)
      const b = this.city.topAt(this.x, this.z);
      if (b && on) {
        const w = b.x1 - b.x0, d = b.z1 - b.z0;
        if (w <= 2 && d > w && Math.abs(dz) > 1 - 0.66 * TUNE.ledgePull) { dx = 0; dz = Math.sign(dz); this.x += ((b.x0 + b.x1) / 2 - this.x) * (1 - Math.exp(-10 * dt)); }
        else if (d <= 2 && w > d && Math.abs(dx) > 1 - 0.66 * TUNE.ledgePull) { dz = 0; dx = Math.sign(dx); this.z += ((b.z0 + b.z1) / 2 - this.z) * (1 - Math.exp(-10 * dt)); }
      }
    }
    this.move = this.rollT > 0 ? 'roll' : this.dashT > 0 ? 'dash' : ledge ? 'ledge' : 'run';
    // (toward the wanted velocity, at a fixed rate: a turn is quick, a reversal a skid)
    const tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = (this.dashT > 0 ? 90 : TUNE.accel) * dt;
    if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    sp = this.speed;
    this.phase += ((sp * dt) / (1.3 + 0.27 * sp)) * 2 * Math.PI;
    if (jump) { this.launch(11, 'spring', false, false, 1.1); return; }
    if (on) {
      // (the way it looks: the way it's going, or from a stand the way it's asked)
      const ux = sp > 2 ? this.vx / sp : dx, uz = sp > 2 ? this.vz / sp : dz, ahead = 0.45 + sp * 0.06;
      if (ux * dx + uz * dz > 0.3 && Math.abs(H(this.x + ux * ahead, this.z + uz * ahead) - this.y) > STEP) { this.leap(ux, uz, ahead, sp); return; }
    }
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, h = H(nx, nz);
    if (Math.abs(h - this.y) <= STEP) { this.x = nx; this.z = nz; this.y = h; }
    else if (h < this.y) { this.x = nx; this.z = nz; this.vy = 0; this.launch(0, 'glide', false, true, 1); this.leaps--; }
    // (a corner the look ahead went past: leapt, from where it stands)
    else if (on) this.leap(dx, dz, 0.05, sp);
    else { this.vx = 0; this.vz = 0; }
  }

  private launch(vy: number, move: Move, planned: boolean, float: boolean, T: number): void {
    this.state = 'air'; this.vy = vy; this.airT = 0; this.planned = planned; this.air2 = true;
    this.move = move; this.float = float; this.flightT = Math.max(0.15, T); this.mu = 0;
    this.lead ^= 1; this.leaps++; this.rollT = 0; this.count(move);
    if (move !== 'vault') this.plant = this.plant2 = null;
    if (move !== 'spring') this.lip = null;
  }

  /** Look along (ux, uz) for where to stand next, and go there: by the move that suits what's between. */
  private leap(ux: number, uz: number, from: number, sp: number): void {
    const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
    /** somewhere to stand: the same height for a good stride beyond */
    const flat = (d: number, h: number) => Math.abs(H(d + 0.6) - h) < 0.1 && Math.abs(H(d + 1.2) - h) < 0.1;
    const reach = TUNE.reach + sp, y = this.y, G = TUNE.gravity, RISE = TUNE.rise, DROP = TUNE.drop, VLEAP = TUNE.leapSpeed;
    let at = -1, to = 0, over = y, wall = -1, overAt = from;
    // (the first place within a storey up or a couple down; what's in the way before it, to clear; or a wall)
    for (let d = from; d <= reach; d += 0.5) {
      const h = H(d);
      if (h > y + RISE) { wall = d; break; }
      if (h >= y - DROP) { if (flat(d, h)) { at = d; to = h; break; } if (h > over) { over = h; overAt = d; } }
    }
    if (at < 0 && wall >= 0) {
      // (a wall: jump at it, to meet it near the top of the jump, and run up it from there)
      const t = JUMP / G, v = Math.min(14, Math.max(sp, wall / t));
      this.vx = ux * v; this.vz = uz * v; this.launch(JUMP, 'spring', false, false, 2 * t); return;
    }
    if (at < 0) {
      // (nothing near this height: the highest place in reach, however far down)
      for (let d = from; d <= reach; d += 0.5) { const h = H(d); if (h < y - DROP && (at < 0 || h > to) && flat(d, h)) { at = d; to = h; } }
      if (at < 0) { this.vx = ux * Math.max(sp, 5); this.vz = uz * Math.max(sp, 5); this.launch(JUMP * 0.8, 'glide', false, true, 2); return; }
    }
    let D = at + 0.7;
    const dh = to - y, clear = Math.max(0, dh, over - y);
    // (which move: by the rise, the drop, the distance, what's in the way)
    let move: Move, apex: number;
    if (dh >= 1.2) { move = 'spring'; apex = clear + 0.6; }
    // (something tall in the way: over it, turned over)
    else if (clear >= 1.2) { move = 'flip'; apex = clear + 0.5; }
    else if (dh <= -TUNE.glideDrop || D > TUNE.glideDist) { move = 'glide'; apex = clear + 0.55 + 0.045 * D; }
    else if (dh <= -TUNE.diveDrop) { move = 'dive'; apex = clear + 0.4; }
    else if (over - y >= 0.6 && D <= 5) {
      // (something to get over: with an edge of it to put a hand on, a vault, one hand or (every other) two; without, a hop)
      const g = TUNE.reach ? this.city.gripAt(this.x + ux * overAt, over, this.z + uz * overAt, TUNE.gripReach, (h) => (h.kind === 'edge' || h.kind === 'rail') && Math.abs(h.ay - over) < 0.05) : null;
      if (g) {
        move = 'vault'; apex = clear + TUNE.vaultLow;
        const two = this.leaps % 2 === 0, l = Math.hypot(g.hold.bx - g.hold.ax, g.hold.bz - g.hold.az) || 1, hx = ((g.hold.bx - g.hold.ax) / l) * 0.2, hz = ((g.hold.bz - g.hold.az) / l) * 0.2;
        this.plant = two ? onHold(g.hold, g.x + hx, g.z + hz) : [g.x, g.y, g.z]; this.plant2 = two ? onHold(g.hold, g.x - hx, g.z - hz) : null;
      } else { move = 'hop'; apex = clear + 0.3; }
    }
    else if (D > 4 && ++this.flats % Math.max(1, Math.round(TUNE.flipEvery)) === 0) { move = 'flip'; apex = clear + 1.5; }
    else { move = 'bound'; apex = clear + 0.1 + 0.06 * D; }
    const float = move === 'glide';
    apex += TUNE.hang;
    // (the arc: up to an apex that clears what's between, down to the landing; higher if it'd otherwise be too fast)
    let T = 0, up = 0;
    for (let i = 0; i < 24; i++) { up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh, float); if (D / T <= VLEAP) break; apex += 0.4; }
    let v = D / T;
    // (keep the pace where the landing has the room for it)
    const keep = Math.min(VLEAP, sp) * (float ? 0.85 : 1);
    if (v < keep) { const D2 = keep * T; if (Math.abs(H(D2) - to) < 0.1 && Math.abs(H((D + D2) / 2) - to) < 0.1 && Math.abs(H(D2 + 0.6) - to) < 0.1) { D = D2; v = keep; } }
    // (a hop that would hang in the air: flatter, if what's in the way allows; and off a height, out at a run, to land wherever)
    let aimed = true;
    if (v < 5) {
      apex = clear + 0.25; up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh, float); v = D / T;
      if (v < 5) { v = Math.min(9, Math.max(sp, 5.5)); aimed = false; }
    }
    this.vx = ux * v; this.vz = uz * v;
    const plant = this.plant, plant2 = this.plant2;
    this.launch(G * up, move, aimed, float, T);
    if (move === 'vault') {
      this.plant = plant; this.plant2 = plant2; this.vaultTo = to;
      // (the hands in the figure's own order: the one on its left to the left)
      if (plant && plant2 && (plant[0] - plant2[0]) * uz - (plant[2] - plant2[2]) * ux < 0) { this.plant = plant2; this.plant2 = plant; }
    }
    if (move === 'spring' && TUNE.reach) {
      // (a storey up: the lip it lands over, for both hands)
      const g = this.city.gripAt(this.x + ux * at, to, this.z + uz * at, TUNE.gripReach, (h) => h.kind === 'edge' && Math.abs(h.ay - to) < 0.05);
      if (g) this.lip = [onHold(g.hold, g.x + uz * 0.2, g.z - ux * 0.2), onHold(g.hold, g.x - uz * 0.2, g.z + ux * 0.2)];
    }
  }

  private air(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.airT += dt; this.mu = Math.min(1, this.airT / this.flightT);
    // (a leap that hasn't landed where it meant to: a glide from here)
    if (!this.float && this.airT > this.flightT + 0.12) { this.float = true; this.move = 'glide'; this.planned = false; }
    const sp = this.speed;
    if (this.planned && on && sp > 0.5 && (this.vx * dx + this.vz * dz) / sp < 0.5) this.planned = false;
    if (!this.planned && on) {
      const top = Math.max(sp, 7), tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = TUNE.steer * dt;
      if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    }
    // (a second jump, off nothing, turned over: once a flight)
    if (jump && this.air2) { this.launch(JUMP * 0.95, 'flip', false, false, 0.8); this.air2 = false; }
    if (this.float) { this.vy -= (this.vy > 0 ? TUNE.gravity : TUNE.glideGravity) * dt; if (this.vy < -TUNE.sink) this.vy += (-TUNE.sink - this.vy) * (1 - Math.exp(-8 * dt)); }
    else this.vy -= TUNE.gravity * dt;
    // (a wall alongside: run along it)
    if (this.airT > 0.1 && (!this.planned || (this.float && this.mu > 0.3)) && this.seek(0.62)) return;
    const s2 = this.speed, ux = s2 > 0.1 ? this.vx / s2 : 0, uz = s2 > 0.1 ? this.vz / s2 : 0;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, ny = this.y + this.vy * dt;
    // (a corner can slip between two looks ahead: so where the body itself would be counts too)
    let px = nx + ux * R, pz = nz + uz * R, h = H(px, pz);
    if (H(nx, nz) > h) { px = nx; pz = nz; h = H(nx, nz); }
    // (a vault goes over what its hand is on, carried on the hand: that isn't in the way, and isn't landed on)
    const over = this.move === 'vault' && this.plant ? this.plant[1] + 0.05 : -1;
    if (h > ny + 0.05 && h > over) {
      // (something in the way: a lip is stepped up onto; a wall met at a slant is run along; met square, run up)
      if (h - ny <= 0.6) { this.x = px; this.z = pz; this.y = h; this.touch(Math.max(0, -this.vy)); return; }
      this.y = ny;
      if (this.seek(0.86)) return;
      this.state = 'climb'; this.move = 'climb'; this.wx = ux; this.wz = uz; this.top = h; this.climbT = 0; this.grips = {}; this.gripN = 0; this.gripT = -1; this.climbs++; this.count('climb'); this.vx = this.vz = this.vy = 0;
      return;
    }
    this.x = nx; this.z = nz; this.y = ny;
    const g = H(nx, nz);
    if (g <= over && g > this.vaultTo + 0.3) { if (this.y < g + 0.05) { this.y = g + 0.05; this.vy = Math.max(this.vy, 0); } return; }
    if (this.y <= g && this.vy <= 0) { this.y = g; this.touch(-this.vy); }
  }

  /** A wall to run along: beside the way it's going (no more head-on than `slant`), within reach, going on ahead. */
  private seek(slant: number): boolean {
    const sp = this.speed;
    if (!TUNE.walls || this.wallCool > 0 || sp < 6) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z), ux = this.vx / sp, uz = this.vz / sp;
    for (const [ax, az] of AXES) {
      const along = ax * ux + az * uz;
      if (along < -0.1 || along > slant) continue;
      let d = 0.1; while (d <= TUNE.wallReach && H(this.x + ax * d, this.z + az * d) <= this.y + 1.2) d += 0.1;
      if (d > TUNE.wallReach) continue;
      let tx = ux - ax * along, tz = uz - az * along; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const wx = this.x + ax * (d + 0.05), wz = this.z + az * (d + 0.05);
      // (it has to go on: a wall there a stride ahead, and nothing across the way along it)
      if (H(wx + tx * 1.5, wz + tz * 1.5) <= this.y + 1.2 || H(this.x + ax * (d - R - 0.05) + tx * 1.5, this.z + az * (d - R - 0.05) + tz * 1.5) > this.y) continue;
      this.x += ax * (d - R - 0.05); this.z += az * (d - R - 0.05);
      this.state = 'wall'; this.move = 'wallrun'; this.wx = ax; this.wz = az; this.tx = tx; this.tz = tz; this.wallT = 0;
      this.wsp = Math.max(TUNE.wallSpeed, sp * Math.sqrt(1 - along * along)); this.vy = Math.min(5, Math.max(this.vy, 3.5));
      this.vx = tx * this.wsp; this.vz = tz * this.wsp; this.planned = false;
      // (which side of the figure it's on: the figure's +x is (cos, -sin) of its heading)
      const hd = Math.atan2(tx, tz); this.wallSide = ax * Math.cos(hd) - az * Math.sin(hd) > 0 ? 1 : -1;
      this.walls++; this.count('wallrun');
      return true;
    }
    return false;
  }

  /** Along a wall: a shallow arc, rising then sinking, until the wall ends, its top comes, or it's time to kick off. */
  private wall(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.wallT += dt; this.vy -= TUNE.wallGravity * dt;
    const kick = () => {
      this.vx = this.tx * this.wsp * 0.9 - this.wx * TUNE.kick; this.vz = this.tz * this.wsp * 0.9 - this.wz * TUNE.kick;
      this.wallCool = 0.12; this.launch(7.5, 'bound', false, false, 0.75);
    };
    if (jump || (on && dx * this.wx + dz * this.wz < -0.5) || this.wallT > TUNE.wallTime) { kick(); return; }
    const nx = this.x + this.tx * this.wsp * dt, nz = this.z + this.tz * this.wsp * dt, ny = this.y + this.vy * dt;
    // (something across the way: off the wall)
    if (H(nx + this.tx * R, nz + this.tz * R) > ny + 0.05) { kick(); return; }
    this.x = nx; this.z = nz; this.y = ny;
    const g = H(nx, nz);
    if (this.y <= g) { this.y = g; this.touch(0); return; }
    const top = H(nx + this.wx * (R + 0.2), nz + this.wz * (R + 0.2));
    if (top > this.y + 0.25) return;
    this.wallCool = 0.2;
    // (its top: onto it; or it has ended: on, off the end of it)
    if (top > this.y - 0.7) { this.x += this.wx * (R + 0.3); this.z += this.wz * (R + 0.3); this.y = H(this.x, this.z); this.touch(0); return; }
    this.launch(Math.max(this.vy, 4.5), 'bound', false, false, 0.7);
  }

  private touch(impact: number): void {
    const was = this.move, aimed = this.planned;
    this.state = 'ground'; this.vy = 0; this.planned = false; this.move = 'run';
    const sp = this.speed, ux = sp > 0.5 ? this.vx / sp : 0, uz = sp > 0.5 ? this.vz / sp : 0;
    // (a dive, or a hard landing, is rolled out of; a spring is landed deep; the rest are run out of)
    if ((was === 'dive' || impact > 10) && sp > 4) { this.rollT = ROLL; this.mu = 0; this.rolls++; this.count('roll'); this.land = Math.max(this.land, 0.25); }
    else this.land = Math.max(this.land, was === 'spring' ? 0.85 : Math.min(1, impact / 11));
    // (out of a roll, or landed as meant with room ahead: a dash)
    if (sp > 6 && (this.rollT > 0 || (aimed && was !== 'glide' && was !== 'spring'))) {
      const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
      if (this.rollT > 0 || [2, 4, 6].every((d) => Math.abs(H(d) - this.y) <= STEP)) { this.dashT = TUNE.dashTime + this.rollT; this.dashes++; this.count('dash'); }
    }
  }

  /** On the wall it's climbing: the highest hold each hand can reach (a sill, the top edge, a rung's height of a pipe). */
  private gripsOn(): Reach {
    const fx = this.x + this.wx * (R + 0.05), fz = this.z + this.wz * (R + 0.05), lx = this.wz, lz = -this.wx, up = TUNE.armReach;
    const out: Reach = {};
    let yl = -1, yr = -1;
    for (const h of this.city.holdsNear(fx, fz, 0.8) as Hold[]) {
      if (h.kind === 'rail' || h.nx * this.wx + h.nz * this.wz > -0.5) continue;
      if (h.kind === 'pipe') {
        // (a pipe: a hand at each rung's height of it, one above the other)
        if (Math.hypot(h.ax - fx, h.az - fz) > 0.6) continue;
        const a = Math.min(h.by, Math.floor((this.y + up) / 0.7) * 0.7), b = Math.min(h.by, Math.floor((this.y + up - 0.35) / 0.7) * 0.7 + 0.35);
        if (a > this.y + 1 && a > yl) { yl = a; out.hl = [h.ax, a, h.az]; }
        if (b > this.y + 1 && b > yr) { yr = b; out.hr = [h.ax, b, h.az]; }
        continue;
      }
      // (a sill or the top edge: level; a hand either side of where the body is, if the line runs that far)
      if (h.ay <= this.y + 1 || h.ay > this.y + up) continue;
      const dx = h.bx - h.ax, dz = h.bz - h.az, l2 = dx * dx + dz * dz || 1;
      const on = (px: number, pz: number): P3 | null => { const t = Math.max(0, Math.min(1, ((px - h.ax) * dx + (pz - h.az) * dz) / l2)), qx = h.ax + dx * t, qz = h.az + dz * t; return Math.hypot(qx - px, qz - pz) < 0.4 ? [qx, h.ay, qz] : null; };
      const pl = on(fx + lx * 0.22, fz + lz * 0.22), pr = on(fx - lx * 0.22, fz - lz * 0.22);
      if (pl && h.ay > yl) { yl = h.ay; out.hl = pl; }
      if (pr && h.ay > yr) { yr = h.ay; out.hr = pr; }
    }
    return out;
  }

  private climb(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    this.climbT += dt;
    // (turned away from the wall, or a jump: off it, the other way)
    if ((on && dx * this.wx + dz * this.wz < -0.4) || jump) {
      const ox = on ? dx : -this.wx, oz = on ? dz : -this.wz;
      this.vx = ox * 8; this.vz = oz * 8; this.launch(JUMP, 'flip', false, false, 0.9); return;
    }
    // (what there is to hold, looked for a few times a stride: with something in hand it goes up fast, with nothing, slowly)
    if (TUNE.reach && this.gripN++ % 5 === 0) { this.grips = this.gripsOn(); if (this.grips.hl || this.grips.hr) this.gripT = this.climbT; }
    const held = !TUNE.reach || (this.gripT >= 0 && this.climbT - this.gripT < 0.3);
    this.y += (held ? TUNE.climb : TUNE.climbBare) * dt;
    if (this.y < this.top) return;
    // (over the top, unless what's there goes on up: then on up)
    const px = this.x + this.wx * (R + 0.35), pz = this.z + this.wz * (R + 0.35), h = this.city.heightAt(px, pz);
    if (h > this.top + 0.05) { this.top = h; return; }
    this.x = px; this.z = pz; this.y = h; this.state = 'ground'; this.move = 'run';
    this.vx = this.wx * 6; this.vz = this.wz * 6; this.land = Math.max(this.land, 0.45);
  }
}
