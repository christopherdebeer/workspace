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
 *   flip     over a tall obstacle, or on a second tap in flight
 *   spring   up a storey: steep, the arms thrown up, a crouch on top
 *   dive     down a storey or so: headfirst, and rolled out of
 *   glide    a long way across or a long way down: the slow one, arms out, steerable
 *
 * On the ground it runs, sprints, bursts into a dash off a clean landing with room ahead, rolls out of a dive or a
 * hard landing, and balances along anything narrow (a rim, a wall across an alley), drawn to its line. In the air a
 * wall alongside is run along, tilted off it, and kicked away from, wall to wall down an alley; a deliberate jump into a wall can plant on it and catch a reachable lip.
 *
 * What its hands do is the city's to offer (city.ts: the holds). A mantle fixes the hands on a real roof edge while the hips rise beneath it. Over a unit one is planted on
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
export interface Reach {
  hl?: P3; hr?: P3;
  /** and each foot, while it's planted; and which way what it's on faces (up, if not said) */
  fl?: P3; fr?: P3; fn?: P3;
}

/** what the rig reads of a body */
export interface Body {
  x: number; y: number; z: number; heading: number; speed: number; state: State; move: Move;
  /** how far through the move, 0..1 (a flight, a roll) */
  mu: number;
  wallPlant?: boolean; committed?: boolean; load?: number; phase: number; lead: number; land: number; turn: number; climbT: number; wallT: number;
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
  /** which leg leads a leap: opposite the support foot at takeoff */
  lead = 0;
  /** compression of the supporting legs, 0..1 across 0.46 metres of travel */
  land = 0;
  climbT = 0; wallT = 0; wallSide = 0;
  /** rate of turn (rad/s), smoothed: the lean into a bend */
  turn = 0;
  /** in a leap aimed at a landing: fine steering until the input turns decisively away */
  planned = false;
  load = 0;
  committed = false;
  wallPlant = false;
  wallSteps = 0;
  braces = 0;
  private bracing = false;
  private jumpBuffer = 0;
  private legVelocity = 0;
  private stepAge = 0;
  private stepFoot: P3 | null = null;
  private catchHeight = 0;
  private supportLeft = false;
  private pushPending = false;
  private rollDuration = ROLL;
  private rollT = 0; private dashT = 0;
  /** on a wall: the way into it, the way along it, the pace along it; and a moment after leaving one before another is taken */
  wx = 0; wz = 0; tx = 0; tz = 0; private wsp = 0; private wallCool = 0;
  private top = 0;
  reach: Reach = {};
  /** a vault's hand hold; a spring's landing lip; a climb's grips, and when they were last looked for and last had */
  private plant: P3 | null = null; private plant2: P3 | null = null; private lip: [P3, P3] | null = null;
  /** the height a vault lands at: anything higher under it on the way is what it's going over */
  private vaultTo = 0;
  private grips: Reach = {};
  /** each foot's footfall: planted or not, and where */
  private feet = { L: { on: false, p: [0, 0, 0] as P3 }, R: { on: false, p: [0, 0, 0] as P3 } };
  private air2 = false;
  leaps = 0; climbs = 0; walls = 0; rolls = 0; dashes = 0; dist = 0;
  /** times it has come down to the street off a roof */
  streets = 0; private high = 0;
  /** how many of each move it has made */
  made: Partial<Record<Move, number>> = {};

  constructor(readonly city: City) { const s = city.start(); this.x = s.x; this.y = s.y; this.z = s.z; }

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** another of it, as it is now, to be run on ahead without touching this one (plan.ts) */
  clone(): Runner { const c = Object.assign(Object.create(Runner.prototype) as Runner, this); c.made = { ...this.made }; c.feet = { L: { ...this.feet.L }, R: { ...this.feet.R } }; return c; }
  private count(m: Move): void { this.made[m] = (this.made[m] ?? 0) + 1; }

  step(dt: number, inp: Input): void {
    const mag = Math.min(1, Math.hypot(inp.x, inp.z)), on = mag > 0.1;
    const dx = on ? inp.x / Math.hypot(inp.x, inp.z) : 0, dz = on ? inp.z / Math.hypot(inp.x, inp.z) : 0;
    const x0 = this.x, z0 = this.z, h0 = this.heading;
    if (this.state === 'ground') {
      const depth = this.land * 0.46;
      this.legVelocity += (-175 * depth - 19 * this.legVelocity) * dt;
      const next = Math.max(0, Math.min(0.46, depth + this.legVelocity * dt));
      if (next === 0 || next === 0.46) this.legVelocity = 0;
      this.land = next / 0.46;
    } else this.land *= Math.exp(-12 * dt);
    this.wallCool -= dt;
    if (this.state === 'ground') this.ground(dt, mag, on, dx, dz, inp.jump);
    else if (this.state === 'air') this.air(dt, on, dx, dz, inp.jump);
    else if (this.state === 'wall') this.wall(dt, on, dx, dz, inp.jump);
    else this.climb(dt, on, dx, dz, inp.jump);
    // (facing: the way it's going; up a wall, the wall)
    const sp = this.speed;
    const want = this.state === 'climb' || this.wallPlant ? Math.atan2(this.wx, this.wz) : sp > 1 ? Math.atan2(this.vx, this.vz) : this.heading;
    let d = want - this.heading; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    this.heading += d * (1 - Math.exp(-16 * dt));
    let dh = this.heading - h0; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
    this.turn += (dh / dt - this.turn) * (1 - Math.exp(-8 * dt));
    this.dist += Math.hypot(this.x - x0, this.z - z0);
    this.reach = TUNE.reach ? this.reaching() : {};
    if (TUNE.reach && TUNE.feet) this.stepping(); else this.feet.L.on = this.feet.R.on = false;
    if (this.state === 'ground') { if (this.y < 0.5 && this.high > 4) this.streets++; this.high = this.y; } else this.high = Math.max(this.high, this.y);
  }

  /**
   * Where the feet are put. A stride has each foot down for part of it: when one comes down it is given a place (on the
   * roof ahead of the body; on a rail, on its line; at a lip, on the lip; up a wall, on a sill or a pipe if one's by,
   * else on the wall; along a wall, on the wall) and it stays there, the body going over it, until it lifts.
   */
  private stepping(): void {
    const sp = this.speed, f = this.feet;
    if (this.state === 'ground' && sp < 0.5 && (this.committed || this.land > 0.005 || this.legVelocity > 0)) {
      const co = Math.cos(this.heading), si = Math.sin(this.heading);
      for (const [foot, side] of [[f.L, 1], [f.R, -1]] as const) {
        if (!foot.on) {
          const x = this.x + co * side * 0.13, z = this.z - si * side * 0.13;
          const y = this.city.heightAt(x, z);
          if (Math.abs(y - this.y) <= STEP) { foot.p = [x, y, z]; foot.on = true; }
        }
      }
      if (f.L.on) this.reach.fl = f.L.p;
      if (f.R.on) this.reach.fr = f.R.p;
      return;
    }
    const ground = this.state === 'ground' && this.move !== 'roll' && sp > 2, wall = this.state === 'wall', climb = this.state === 'climb';
    if (!ground && !wall && !climb) { f.L.on = f.R.on = false; return; }
    const a = ground ? this.phase : wall ? this.wallT * 14 + this.lead * Math.PI : this.climbT * 15;
    // (how much of a turn a foot is down for: on the ground, as long as the body takes to go 0.9 m over it)
    const span = ground ? Math.min(2.4, (2 * Math.PI * 0.9) / (1.3 + 0.27 * sp)) : 2.2, from = Math.PI / 2 + 0.3;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    for (const [foot, side, off] of [[f.L, 1, 0], [f.R, -1, Math.PI]] as const) {
      const ph = (((a + off - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), down = ph < span;
      if (down && !foot.on) {
        let p: P3 | null = null;
        if (ground) {
          // (ahead of the body by half of what it'll travel over it, out to its own side)
          const ax = this.x + fx * 0.45 + fz * side * 0.09, az = this.z + fz * 0.45 - fx * side * 0.09, h = this.city.heightAt(ax, az);
          if (Math.abs(h - this.y) <= STEP) p = [ax, h, az];
          // (along something narrow, on its line; past a lip, on the lip)
          const g = this.city.gripAt(ax, this.y, az, this.move === 'ledge' ? 0.4 : p ? 0.14 : 0.55, (o) => (o.kind === 'rail' || o.kind === 'edge') && Math.abs(o.ay - this.y) < 0.05);
          if (g) p = [g.x, g.y, g.z];
        } else {
          const up = climb ? 0.4 : 0.25, along = climb ? 0 : 0.45, lx = climb ? this.wz * side * 0.13 : 0, lz = climb ? -this.wx * side * 0.13 : 0;
          const wx = this.x + this.wx * (R + 0.02) + this.tx * along * (wall ? 1 : 0) + lx, wz = this.z + this.wz * (R + 0.02) + this.tz * along * (wall ? 1 : 0) + lz, wy = this.y + up;
          // (a toe hold if there's one by: a sill, a pipe; else the wall itself)
          const g = this.city.gripAt(wx, wy, wz, 0.45, (o) => (o.kind === 'sill' || o.kind === 'pipe') && o.nx * this.wx + o.nz * this.wz < -0.5) ?? this.city.gripAt(wx, wy, wz, 0.3, (o) => o.kind === 'face' && o.nx * this.wx + o.nz * this.wz < -0.5);
          if (g) p = [g.x, g.y, g.z];
        }
        if (p) { foot.on = true; foot.p = p; }
      } else if (!down) foot.on = false;
    }
    if (f.L.on) this.reach.fl = f.L.p;
    if (f.R.on) this.reach.fr = f.R.p;
    if (!ground && (f.L.on || f.R.on)) this.reach.fn = [-this.wx, 0, -this.wz];
  }

  /** Where the hands want to be, this instant. */
  private reaching(): Reach {
    const u = this.mu, L = this.lead === 1, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    /** a point by the figure: `a` ahead, `s` to its left, `h` up */
    const by = (a: number, s: number, h: number): P3 => [this.x + fx * a + fz * s, this.y + h, this.z + fz * a - fx * s];
    // (up a wall: what it has hold of, until it's gone by below the hips)
    if (this.state === 'climb') return this.mu < 0.88 ? { ...this.grips } : {};
    if (this.state === 'wall') {
      // (the near hand trails on the wall, about the shoulder's height, a little ahead)
      const p: P3 = [this.x + this.wx * (R + 0.02) + this.tx * 0.25, this.y + 1.3, this.z + this.wz * (R + 0.02) + this.tz * 0.25];
      return this.wallSide > 0 ? { hl: p } : { hr: p };
    }
    if (this.state === 'air') {
      if (this.wallPlant && this.stepFoot && this.stepAge < 0.15) {
        return { [L ? 'fr' : 'fl']: this.stepFoot, fn: [-this.wx, 0, -this.wz] };
      }
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
    if (jump) this.jumpBuffer = 0.22;
    if (this.rollT > 0) { this.rollT -= dt; this.mu = 1 - Math.max(0, this.rollT) / this.rollDuration; }
    if (this.dashT > 0) this.dashT = on ? this.dashT - dt : 0;
    if (!on || mag < 0.65 || this.vx * dx + this.vz * dz < this.speed * 0.65) this.pushPending = false;
    if (this.pushPending && this.legVelocity <= 0 && this.rollT <= 0 && this.inStance()) {
      this.pushPending = false; this.dashT = TUNE.dashTime;
      this.dashes++; this.count('dash');
    }
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
    // Shed pace on the roof when the next step is a storey higher.
    const brakeAhead = R + sp * 0.20;
    if (on && sp > TUNE.run && H(this.x + fx * brakeAhead, this.z + fz * brakeAhead) >= this.y + 1.2) top = Math.min(top, TUNE.run);
    if (this.rollT > 0) top = Math.min(sp, top);
    this.move = this.rollT > 0 ? 'roll' : this.dashT > 0 ? 'dash' : ledge ? 'ledge' : 'run';
    // (toward the wanted velocity, at a fixed rate: a turn is quick, a reversal a skid)
    const tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = (this.rollT > 0 ? TUNE.accel * 0.3 : TUNE.accel) * dt;
    if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    sp = this.speed;
    this.phase += ((sp * dt) / (1.3 + 0.27 * sp)) * 2 * Math.PI;
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const preparing = this.jumpBuffer > 0 && this.rollT <= 0;
    if (preparing) {
      if (!this.committed) this.supportLeft = this.leftSupports();
      this.committed = true;
      this.load = Math.min(1, this.load + dt / 0.115);
      if (this.load >= 1 || (this.load >= 0.65 && this.inStance())) {
        this.strongJump(); return;
      }
    }
    if (on) {
      // (the way it looks: the way it's going, or from a stand the way it's asked)
      const ux = sp > 2 ? this.vx / sp : dx, uz = sp > 2 ? this.vz / sp : dz, ahead = 0.45 + sp * 0.06;
      // Find the lip one support beat early. Stay on the roof while the last foot takes weight.
      const stride = 1.3 + 0.27 * sp;
      const probe = ahead + Math.min(1.4, stride * 0.3);
      let edge = 0;
      if (ux * dx + uz * dz > 0.3) {
        for (let d = 0.2; d <= probe + 0.19; d += 0.2) {
          if (Math.abs(H(this.x + ux * d, this.z + uz * d) - this.y) > STEP) { edge = d; break; }
        }
      }
      if (edge && !preparing && this.rollT <= 0 && mag >= 0.55 &&
          H(this.x + ux * edge, this.z + uz * edge) <= this.y + TUNE.rise) {
        if (!this.load) {
          // The next contact unless a foot is already supporting the runner.
          this.supportLeft = this.leftSupports();
          if (!this.inStance()) this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 + 0.31 + (this.supportLeft ? 0 : Math.PI);
        }
        this.load = Math.min(1, this.load + dt * 9);
        if ((this.load >= 0.65 && edge <= ahead) || edge <= R + sp * dt) {
          this.leap(ux, uz, edge, sp); return;
        }
      } else if (!preparing) this.load = 0;
    } else if (!preparing) this.load = 0;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, h = H(nx, nz);
    if (preparing && Math.abs(h - this.y) > STEP) {
      // Finish the supporting step when a tap arrives right on the boundary.
      if (this.load >= 0.65) this.strongJump();
      return;
    }
    if (Math.abs(h - this.y) <= STEP) { this.x = nx; this.z = nz; this.y = h; }
    else if (h < this.y && mag < 0.55 && sp < 6) { this.vx = this.vz = 0; }
    else if (h < this.y) { this.x = nx; this.z = nz; this.vy = 0; this.launch(0, 'glide', false, true, 1); this.leaps--; }
    // (a corner the look ahead went past: leapt, from where it stands)
    else if (on && h <= this.y + TUNE.rise && mag >= 0.55) this.leap(dx, dz, 0.05, sp);
    else if (on) {
      const xFree = Math.abs(H(nx, this.z) - this.y) <= STEP;
      const zFree = Math.abs(H(this.x, nz) - this.y) <= STEP;
      if (xFree && (!zFree || Math.abs(this.vx) >= Math.abs(this.vz))) { this.x = nx; this.vz = 0; }
      else if (zFree) { this.z = nz; this.vx = 0; }
      else this.vx = this.vz = 0;
      this.y = H(this.x, this.z);
    }
    else { this.vx = 0; this.vz = 0; }
  }

  private strongJump(): void {
    const impulse = this.speed < 1 ? 7.2 : 10.5;
    this.launch(impulse, 'spring', false, false, 2 * impulse / TUNE.gravity);
    this.committed = true;
  }

  private leftSupports(): boolean {
    if (this.feet.L.on || this.feet.R.on) return this.feet.L.on;
    return Math.sin(this.phase - 0.3) > 0;
  }

  private inStance(): boolean {
    const half = Math.PI, phase = ((this.phase - half / 2 - 0.3) % half + half) % half;
    return phase < Math.min(2.4, 2 * half * 0.9 / (1.3 + 0.27 * this.speed));
  }

  private launch(vy: number, move: Move, planned: boolean, float: boolean, T: number): void {
    const ground = this.state === 'ground';
    if (ground) {
      const supportLeft = this.load ? this.supportLeft : this.leftSupports();
      this.lead = supportLeft ? 0 : 1;
    } else this.lead ^= 1;
    this.wallPlant = false; this.stepFoot = null; this.bracing = false;
    this.committed = false; this.jumpBuffer = 0;
    this.load = 0; this.pushPending = false; this.dashT = 0;
    this.state = 'air'; this.vy = vy; this.airT = 0; this.planned = planned; this.air2 = true;
    this.move = move; this.float = float; this.flightT = Math.max(0.15, T); this.mu = 0;
    this.leaps++; this.rollT = 0; this.count(move);
    if (move !== 'vault') this.plant = this.plant2 = null;
    if (move !== 'spring') this.lip = null;
  }

  /** Look along (ux, uz) for where to stand next, and go there: by the move that suits what's between. */
  private leap(ux: number, uz: number, from: number, sp: number): void {
    const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
    /** somewhere to stand: the same height for a good stride beyond */
    const flat = (d: number, h: number) => Math.abs(H(d + 0.6) - h) < 0.1 && Math.abs(H(d + 1.2) - h) < 0.1;
    const reach = TUNE.jumpReach + sp, y = this.y, G = TUNE.gravity, RISE = TUNE.rise, DROP = TUNE.drop, VLEAP = TUNE.leapSpeed;
    let at = -1, to = 0, over = y, wall = -1, overAt = from;
    // (the first place within a storey up or a couple down; what's in the way before it, to clear; or a wall)
    for (let d = from; d <= reach; d += 0.5) {
      const h = H(d);
      if (h > y + RISE) { wall = d; break; }
      if (h >= y - DROP) { if (flat(d, h)) { at = d; to = h; break; } if (h > over) { over = h; overAt = d; } }
    }
    if (at < 0 && wall >= 0) {
      // A high wall beyond the edge: cross toward it on the available momentum.
      const t = JUMP / G, v = Math.max(sp, Math.min(sp + 1.5, wall / t));
      this.vx = ux * v; this.vz = uz * v; this.launch(JUMP, 'spring', false, false, 2 * t); return;
    }
    if (at < 0) {
      // (nothing near this height: the highest place in reach, however far down)
      for (let d = from; d <= reach; d += 0.5) { const h = H(d); if (h < y - DROP && (at < 0 || h > to) && flat(d, h)) { at = d; to = h; } }
      if (at < 0) { this.vx = ux * sp; this.vz = uz * sp; this.launch(JUMP * 0.8, 'glide', false, true, 2); return; }
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
    // Keep the horizontal impulse within a running step. If the original mark is out of
    // reach, keep travelling and let the actual roof, lip or wall receive the runner.
    const carried = Math.max(sp - 1.5, Math.min(sp + 1.5, v));
    if (Math.abs(carried - v) > 0.001) {
      aimed = Math.abs(H(carried * T) - to) < 0.1 && flat(carried * T, to);
      v = carried;
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
    if (this.wallPlant) { this.wallStep(dt, on ? dx * this.wx + dz * this.wz : 0); return; }
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.airT += dt; this.mu = Math.min(1, this.airT / this.flightT);
    // (a leap that hasn't landed where it meant to: a glide from here)
    if (!this.float && this.airT > this.flightT + 0.12) { this.float = true; this.move = 'glide'; this.planned = false; }
    const sp = this.speed;
    if (this.planned && on && sp > 0.5 && (this.vx * dx + this.vz * dz) / sp < 0.5) this.planned = false;
    if (on) {
      const top = this.planned ? sp : Math.max(sp, 7);
      const tx = dx * top, tz = dz * top;
      const ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez);
      const alignment = sp > 0.5 ? (this.vx * dx + this.vz * dz) / sp : 0;
      const authority = this.planned ? Math.min(1, 0.2 + 1.6 * (1 - alignment)) : 1;
      const a = TUNE.steer * authority * dt;
      if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    }
    // (a second jump, off nothing, turned over: once a flight)
    if (jump && this.vy < 0 && this.y - H(this.x, this.z) < -this.vy * 0.12) this.jumpBuffer = 0.22;
    else if (jump && this.air2) { this.launch(JUMP * 0.95, 'flip', false, false, 0.8); this.air2 = false; }
    if (this.float) { this.vy -= (this.vy > 0 ? TUNE.gravity : TUNE.glideGravity) * dt; if (this.vy < -TUNE.sink) this.vy += (-TUNE.sink - this.vy) * (1 - Math.exp(-8 * dt)); }
    else this.vy -= TUNE.gravity * dt;
    // (a wall alongside: run along it)
    if (this.airT > 0.1 && (!this.planned || (this.float && this.mu > 0.3)) && this.seek(0.62, dx, dz)) return;
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
      // (how square it's met: only a wall met nearly square is run straight up)
      const square = Math.cos((TUNE.climbSquare * Math.PI) / 180);
      if (this.seek(square, dx, dz)) return;
      let nax = 0, naz = 0, most = 0;
      for (const [ax, az] of AXES) { const k = ax * ux + az * uz; if (k > most && H(this.x + ax * (R + 0.15), this.z + az * (R + 0.15)) > ny + 0.05) { most = k; nax = ax; naz = az; } }
      if (most === 0) {
        if (Math.abs(ux) > Math.abs(uz)) nax = Math.sign(ux); else naz = Math.sign(uz);
      }
      const into = nax * dx + naz * dz;
      if (TUNE.walls && this.committed && this.vy > 0 && most >= square && into > 0.65) {
        const foot = this.city.gripAt(px, ny + 0.38, pz, 0.52,
          g => g.kind === 'face' && g.nx * nax + g.nz * naz < -0.9);
        if (foot) {
          this.wx = nax; this.wz = naz;
          this.x = foot.x - nax * R; this.z = foot.z - naz * R;
          this.stepFoot = [foot.x, foot.y, foot.z]; this.wallPlant = true; this.stepAge = 0;
          this.vy = Math.min(12, Math.max(6, this.vy + s2 * most * 0.44));
          this.vx = this.vz = 0; this.wallSteps++; return;
        }
      }
      const normal = this.vx * nax + this.vz * naz;
      this.vx -= nax * normal; this.vz -= naz * normal;
      const sx = this.x + this.vx * dt, sz = this.z + this.vz * dt;
      if (H(sx, sz) <= ny) { this.x = sx; this.z = sz; }
      if (!this.bracing) this.braces++;
      this.bracing = true; this.planned = false;
      const floor = H(this.x, this.z);
      if (ny <= floor && this.vy <= 0) { this.y = floor; this.touch(-this.vy); }
      return;
    }
    this.x = nx; this.z = nz; this.y = ny;
    const g = H(nx, nz);
    if (g <= over && g > this.vaultTo + 0.3) { if (this.y < g + 0.05) { this.y = g + 0.05; this.vy = Math.max(this.vy, 0); } return; }
    if (this.y <= g && this.vy <= 0) { this.y = g; this.touch(-this.vy); }
  }

  /** A wall to run along: beside the way it's going (no more head-on than `slant`), within reach, going on ahead. */
  private seek(slant: number, dx: number, dz: number): boolean {
    const sp = this.speed;
    if (!TUNE.walls || this.wallCool > 0 || sp < 4) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z), ux = this.vx / sp, uz = this.vz / sp;
    for (const [ax, az] of AXES) {
      const along = ax * ux + az * uz;
      if (dx * ax + dz * az < 0.24 || along < -0.1 || along > slant) continue;
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

  /**
   * Along a wall. Left to itself it's a shallow arc, rising then sinking as gravity has it. Leaning into the wall
   * drives it up the wall as it goes along: that is how height is gained, and it is paid for, in how long the run
   * lasts and in pace along. Away from the wall, or a jump, kicks off it; so does the run's end, when time runs out. It ends on the wall's top if it gets there.
   */
  private wall(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    const into = on ? dx * this.wx + dz * this.wz : 0, back = on && dx * this.tx + dz * this.tz < -0.5, up = Math.max(0, into);
    this.wallT += dt * (1 + TUNE.wallCost * up);
    const left = Math.max(0, 1 - this.wallT / TUNE.wallTime);
    this.vy = Math.min(TUNE.wallRise, this.vy + (up * TUNE.wallLift * Math.min(1, left * 2.5) - TUNE.wallGravity) * dt);
    this.wsp = Math.max(TUNE.wallSpeed * 0.6, this.wsp - up * TUNE.wallDrag * dt);
    this.vx = this.tx * this.wsp; this.vz = this.tz * this.wsp;
    const kick = () => {
      this.vx = this.tx * this.wsp * 0.9 - this.wx * TUNE.kick; this.vz = this.tz * this.wsp * 0.9 - this.wz * TUNE.kick;
      this.wallCool = 0.12; this.launch(7.5, 'bound', false, false, 0.75);
    };
    if (jump || into < -0.5 || back) { kick(); return; }
    if (left <= 0) { kick(); return; }
    const nx = this.x + this.tx * this.wsp * dt, nz = this.z + this.tz * this.wsp * dt, ny = this.y + this.vy * dt;
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

  private wallStep(dt: number, into: number): void {
    this.stepAge += dt;
    this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
    const x = this.x + this.wx * (R + 0.05), z = this.z + this.wz * (R + 0.05);
    const top = this.city.heightAt(x, z), reach = top - this.y;
    if (into > 0.55 && this.stepAge >= 0.06 && reach > 0.65 && reach <= TUNE.armReach) {
      const lip = this.city.gripAt(x, top, z, 0.3, g => g.kind === 'edge' && g.nx * this.wx + g.nz * this.wz < -0.9);
      if (lip) {
        this.top = top;
        this.grips = { hl: onHold(lip.hold, x + this.wz * 0.18, z - this.wx * 0.18),
          hr: onHold(lip.hold, x - this.wz * 0.18, z + this.wx * 0.18) };
        this.catchHeight = this.y; this.climbT = 0; this.mu = 0; this.vy = 0;
        this.state = 'climb'; this.move = 'climb'; this.climbs++; this.count('climb');
        this.wallPlant = false; return;
      }
    }
    if (this.vy <= 0 || into < 0.1 || this.stepAge > 0.5) {
      this.launch(this.vy, 'bound', false, false, 0.55);
      this.vx = -this.wx * 1.6; this.vz = -this.wz * 1.6; this.wallCool = 0.25;
    }
  }

  private touch(impact: number): void {
    const was = this.move, aimed = this.planned;
    this.committed = false; this.wallPlant = false; this.land = 0;
    this.legVelocity = Math.min(10, impact) * 0.9;
    this.phase = Math.PI / 2 + 0.31 + (this.lead ? 0 : Math.PI);
    this.state = 'ground'; this.vy = 0; this.planned = false; this.move = 'run';
    const sp = this.speed, ux = sp > 0.5 ? this.vx / sp : 0, uz = sp > 0.5 ? this.vz / sp : 0;
    // (a dive, or a hard landing, is rolled out of; a spring is landed deep; the rest are run out of)
    if ((was === 'dive' || impact > 10) && sp > 4) { let room = 0;
      while (room < sp * ROLL && Math.abs(this.city.heightAt(this.x + ux * (room + 0.25), this.z + uz * (room + 0.25)) - this.y) <= STEP) room += 0.25;
      this.rollDuration = Math.min(ROLL, Math.max(0, room - R) / sp);
      this.rollT = this.rollDuration >= 0.24 ? this.rollDuration : 0;
      this.mu = 0; if (this.rollT > 0) { this.move = 'roll'; this.rolls++; this.count('roll'); }
    }

    // (out of a roll, or landed as meant with room ahead: a dash)
    if (sp > 6 && (this.rollT > 0 || (aimed && was !== 'glide' && was !== 'spring'))) {
      const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
      if (this.rollT > 0 || [2, 4, 6].every((d) => Math.abs(H(d) - this.y) <= STEP)) { this.pushPending = true; }
    }
  }

  private climb(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    this.climbT += dt;
    // (turned away from the wall, or a jump: off it, the other way)
    if ((on && dx * this.wx + dz * this.wz < -0.4) || jump) {
      const ox = on ? dx : -this.wx, oz = on ? dz : -this.wz;
      this.vx = ox * 8; this.vz = oz * 8; this.launch(JUMP, 'flip', false, false, 0.9); return;
    }
    const duration = Math.max(0.32, (this.top - this.catchHeight) / TUNE.climb + 0.22);
    this.mu = Math.min(1, this.climbT / duration);
    const pull = this.mu * this.mu * (3 - 2 * this.mu);
    this.y = this.catchHeight + (this.top - this.catchHeight) * pull;
    // Let the pelvis swing away beneath the fixed hands, then draw it back to the lip.
    if (this.stepFoot) {
      const clearance = R * (1 - pull) + 0.14 * Math.sin(Math.PI * this.mu);
      this.x = this.stepFoot[0] - this.wx * Math.max(0.02, clearance);
      this.z = this.stepFoot[2] - this.wz * Math.max(0.02, clearance);
    }
    if (this.mu < 1) return;
    const px = this.x + this.wx * 0.13, pz = this.z + this.wz * 0.13, h = this.city.heightAt(px, pz);
    if (Math.abs(h - this.top) > STEP) { this.launch(0, 'bound', false, false, 0.5); return; }
    this.x = px; this.z = pz; this.y = h; this.state = 'ground'; this.move = 'run';
    this.vx = this.wx * 6; this.vz = this.wz * 6; this.land = Math.max(this.land, 0.45);
  }
}
