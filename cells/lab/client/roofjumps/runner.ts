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
 * Its states (`state`), each a method of its own: ground (running, loading a takeoff, landing in its legs), air (a flight:
 * a leap, a fall, a glide while the jump is held), wall (running along one), plant (a foot put on a wall it jumped at,
 * driving up off it), chimney (up a narrow alley between two walls, kicking from one to the other), climb (hands on a hold: pulling over a lip, or hanging from a sill on the way up a face, loading,
 * and springing for the next: a chain, as up a fire escape). A move that misses its landing falls: it catches a lip in
 * reach, or comes down and rolls. It glides only while the jump is held.
 *
 * No DOM, no drawing: it asks the city for heights, and keeps what the rig needs to pose a figure (`move`, how far
 * through it, the stride, the leading leg, the wall's side, the landing's weight).
 */
import type { City, Hold } from './city';
import { TUNE } from './tune';

/** a direction; a jump tapped; and the jump held (to glide) */
export interface Input { x: number; z: number; jump: boolean; hold?: boolean }

export type Move = 'kick' | 'run' | 'dash' | 'ledge' | 'roll' | 'vault' | 'hop' | 'bound' | 'flip' | 'spring' | 'dive' | 'glide' | 'fall' | 'climb' | 'hang' | 'wallrun' | 'chimney' | 'sideflip' | 'underbar';
export type State = 'ground' | 'air' | 'climb' | 'wall' | 'plant' | 'chimney';

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
  wallPlant?: boolean; committed?: boolean; load?: number;
  /** seconds in the air (a glide's sway); a vault turned round on its hand (a palm spin) */
  airT?: number; palmSpin?: boolean;
  /** off balance (to the figure's left +), and how fast it's going over; the effort left (1 fresh); the size of the wind-up
   * now loading (0..1); seconds since the start */
  balance?: number; balanceV?: number; stamina?: number; effort?: number; time?: number;
  /** hanging on the way up a face: 0 caught, 1 loading, 2 springing for the next hold */
  chainPhase?: number;
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
/** hanging from a hold: the feet this far below the hands (m); the catch settling, the least load, a spring for the next (s) */
const HANG = 2.05, CHAIN_CATCH = 0.12, CHAIN_LOAD = 0.18, CHAIN_SPRING = 0.32;
/** up a narrow alley: a kick from one wall to the other this long (s), off it this fast upward (m/s); no wider than (m) */
const TIC = 0.27, TIC_UP = 6.3, ALLEY = 3.2;
/** a lip caught: the hips swing in under it this long before anything's decided (s); pressed into a wall, braced this long
 * before it goes for it (s) */
const LIP_BEAT = 0.3, BRACE = 0.35;
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
  /**
   * A takeoff, from a tap or the runner's own judgement, all in one place: the tap's window (s), how far the support
   * leg is loaded (0..1), whether it's committed to a jump (a tap's: it goes, and it plants on a wall it meets), and
   * which foot is the support. Begun on the ground; cleared, all of it, when it leaves the ground or lands (`resetTakeoff`).
   */
  private to = { buffer: 0, load: 0, committed: false, left: false };
  get load(): number { return this.to.load; }
  set load(v: number) { this.to.load = v; }
  get committed(): boolean { return this.to.committed; }
  set committed(v: boolean) { this.to.committed = v; }
  /** a foot on a wall it jumped at (state 'plant') */
  get wallPlant(): boolean { return this.state === 'plant'; }
  wallSteps = 0;
  /** springs from hold to hold up a face; and seconds pressed into a wall in reach, before it goes for it */
  chains = 0; private press = 0;
  /** hanging from a hold on the way up a face: its height, what phase, how long in it, and where it springs from */
  private chain: { y: number; phase: number; t: number; y0: number; y1: number; next: number } | null = null;
  /** up a narrow alley: the way to the wall it started on (ax, az), a point on that wall's face, the faces apart, which
   * wall it's on (1 the first), how long since the last kick, how many, how far along the alley, and its pace along it */
  private ch: { ax: number; az: number; ox: number; oz: number; gap: number; side: number; t: number; kicks: number; along: number; pace: number } | null = null;
  chimneys = 0;
  /** a vault turned round on its hand; a held moment at the top of a flight (`apexHold`), and whether it's still rising; a
   * stuck landing on something narrow, the seconds it's still settling */
  palmSpin = false; private held = 0; private rising = false; private stickT = 0;
  /** balance: how far off it is (rad, to the figure's left +) and how fast it's going over; corrected like a spring */
  balance = 0; balanceV = 0; private prevTurn = 0;
  /** a landing's recovery still being paid (s); a heavy one's held frame owed at its deepest; how hard the last one was and
   * how long ago (the eye dips by it) */
  private recoverT = 0; private hitPending = false; impact = 0; impactT = 9;
  /** the whole body held a moment (the emphasis: a wind-up held at full load, a heavy landing at its deepest); whether the
   * wind-up now firing has had its hold */
  private freeze = 0; private tamed = false;
  /** effort left (1 fresh): big releases spend it, easy running gives it back; when it was last spent; the size of the
   * wind-up loading now */
  stamina = 1; private spentT = 9; effort = 0; time = 0;
  /** landings, by how they went */
  landings = { flow: 0, heavy: 0, off: 0 };
  /** hanging from a lip it caught (s; -1 not hanging); lips caught; and the wall it's braced against, pressed into one */
  private atLip = -1; catches = 0;
  /** leaps off the ground that missed their landing and fell (a kick off a wall into the air isn't one); where this flight began */
  misses = 0; private from: State = 'ground'; private pax = 0; private paz = 0;
  /** a heavy landing held at its deepest a while (the emphasis): the legs stay down, the body goes on */
  private legHold = 0;
  get chainPhase(): number | undefined { return this.chain ? this.chain.phase : this.atLip >= 0 ? (this.atLip < LIP_BEAT ? 0 : 1) : undefined; }
  braces = 0;
  private bracing = false;
  private legVelocity = 0;
  private stepAge = 0;
  private stepFoot: P3 | null = null;
  private catchHeight = 0;
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
  /** the jump held, this step: a fall becomes a glide */
  private hold = false;
  leaps = 0; climbs = 0; walls = 0; rolls = 0; dashes = 0; dist = 0;
  /** times it has come down to the street off a roof */
  streets = 0; private high = 0;
  /** how many of each move it has made */
  made: Partial<Record<Move, number>> = {};

  constructor(readonly city: City) { const s = city.start(); this.x = s.x; this.y = s.y; this.z = s.z; }

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** another of it, as it is now, to be run on ahead without touching this one (plan.ts) */
  clone(): Runner { const c = Object.assign(Object.create(Runner.prototype) as Runner, this); c.made = { ...this.made }; c.to = { ...this.to }; c.landings = { ...this.landings }; c.chain = this.chain ? { ...this.chain } : null; c.ch = this.ch ? { ...this.ch } : null; c.feet = { L: { ...this.feet.L }, R: { ...this.feet.R } }; return c; }
  private count(m: Move): void { this.made[m] = (this.made[m] ?? 0) + 1; }

  step(dt: number, inp: Input): void {
    const mag = Math.min(1, Math.hypot(inp.x, inp.z)), on = mag > 0.1;
    const dx = on ? inp.x / Math.hypot(inp.x, inp.z) : 0, dz = on ? inp.z / Math.hypot(inp.x, inp.z) : 0;
    const x0 = this.x, z0 = this.z, h0 = this.heading;
    this.time += dt; this.impactT += dt;
    // (held: nothing moves, the pose stays (the emphasis))
    if (this.freeze > 0) { this.freeze -= dt; return; }
    if (this.state === 'ground' && this.legHold > 0) this.legHold -= dt;
    else if (this.state === 'ground') {
      const depth = this.land * 0.46, wasDown = this.legVelocity > 0;
      this.legVelocity += (-175 * depth - 19 * this.legVelocity) * dt;
      const next = Math.max(0, Math.min(0.46, depth + this.legVelocity * dt));
      if (next === 0 || next === 0.46) this.legVelocity = 0;
      this.land = next / 0.46;
      // (a heavy landing at its deepest: held there a moment, if the emphasis asks)
      if (this.hitPending && wasDown && this.legVelocity <= 0) { this.hitPending = false; this.legHold = 0.06 * TUNE.emphasis; }
    } else this.land *= Math.exp(-12 * dt);
    // (balance: knocked by what happens, corrected like a spring on the ground; in the air it just fades)
    if (this.state === 'ground') {
      if (this.move === 'ledge') this.balanceV += (Math.sin(this.dist * 2.3) + Math.sin(this.dist * 0.9 + 1)) * 1.6 * dt;
      if (this.speed > 6) this.balanceV += (this.turn - this.prevTurn) * 0.02;
      this.balanceV += (-60 * this.balance - 9 * this.balanceV) * dt; this.balance += this.balanceV * dt;
    } else { const k = Math.exp(-3 * dt); this.balance *= k; this.balanceV *= k; }
    this.prevTurn = this.turn;
    // (effort comes back, running easily, a while after the last big one)
    this.spentT += dt; if (this.spentT > 0.8 && this.state === 'ground') this.stamina = Math.min(1, this.stamina + 0.15 * dt);
    this.wallCool -= dt;
    if (this.state === 'ground') this.ground(dt, mag, on, dx, dz, inp.jump);
    else if (this.state === 'air') this.air(dt, on, dx, dz, inp.jump);
    else if (this.state === 'wall') this.wall(dt, on, dx, dz, inp.jump);
    else if (this.state === 'plant') this.wallStep(dt, on ? dx * this.wx + dz * this.wz : 0);
    else if (this.state === 'chimney') this.chimney(dt, on);
    else this.climb(dt, on, dx, dz, inp.jump);
    this.hold = !!inp.hold;
    // (facing: the way it's going; up a wall, the wall)
    const sp = this.speed;
    const want = this.state === 'climb' || this.state === 'plant' ? Math.atan2(this.wx, this.wz) : sp > 1 ? Math.atan2(this.vx, this.vz) : this.heading;
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
    // (hanging, loaded: both feet set on the wall under the hips; springing: off it)
    if (this.state === 'climb' && this.chain && this.chain.phase >= 1) {
      if (this.chain.phase === 2) { f.L.on = f.R.on = false; return; }
      for (const [foot, side] of [[f.L, 1], [f.R, -1]] as const) {
        if (foot.on) continue;
        const x = this.x + this.wx * (R + 0.02) + this.wz * side * 0.16, z = this.z + this.wz * (R + 0.02) - this.wx * side * 0.16;
        const g = this.city.gripAt(x, this.y + 0.75, z, 0.35, (o) => (o.kind === 'face' || o.kind === 'sill' || o.kind === 'pipe') && o.nx * this.wx + o.nz * this.wz < -0.5);
        if (g) { foot.on = true; foot.p = [g.x, g.y, g.z]; }
      }
      if (f.L.on) this.reach.fl = f.L.p; if (f.R.on) this.reach.fr = f.R.p;
      if (f.L.on || f.R.on) this.reach.fn = [-this.wx, 0, -this.wz];
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
    if (this.state === 'climb' && this.atLip >= 0) return { ...this.grips };
    if (this.state === 'climb') {
      // (hanging: the hands on the hold, let go through the first part of a spring for the next, and on the next one)
      if (this.chain) return this.chain.phase === 2 && this.chain.t < 0.6 * CHAIN_SPRING ? {} : { ...this.grips };
      return this.mu < 0.88 ? { ...this.grips } : {};
    }
    if (this.state === 'chimney' && this.ch) {
      // (a hand on each wall, about the shoulders, a little ahead; the foot on the wall it has just kicked from)
      const c = this.ch, ahead = 0.25, y = this.y + 1.35;
      const onA: P3 = [c.ox + this.tx * (c.along + ahead), y, c.oz + this.tz * (c.along + ahead)];
      const onB: P3 = [c.ox - c.ax * c.gap + this.tx * (c.along + ahead), y, c.oz - c.az * c.gap + this.tz * (c.along + ahead)];
      const aLeft = c.ax * Math.cos(this.heading) - c.az * Math.sin(this.heading) > 0;
      const r: Reach = aLeft ? { hl: onA, hr: onB } : { hl: onB, hr: onA };
      if (c.t < 0.1) {
        const w: P3 = c.side > 0 ? [onA[0] - this.tx * ahead, this.y + 0.3, onA[2] - this.tz * ahead] : [onB[0] - this.tx * ahead, this.y + 0.3, onB[2] - this.tz * ahead];
        const nx = c.side > 0 ? c.ax : -c.ax, nz = c.side > 0 ? c.az : -c.az;
        const g = this.city.gripAt(w[0], w[1], w[2], 0.35, (q) => q.kind === 'face' && q.nx * nx + q.nz * nz < -0.5);
        if (g) { r[this.lead === 1 ? 'fr' : 'fl'] = [g.x, g.y, g.z]; r.fn = [-nx, 0, -nz]; }
      }
      return r;
    }
    if (this.state === 'plant') return this.stepFoot && this.stepAge < 0.15 ? { [this.lead === 1 ? 'fr' : 'fl']: this.stepFoot, fn: [-this.wx, 0, -this.wz] } : {};
    if (this.state === 'wall') {
      // (the near hand trails on the wall, about the shoulder's height, a little ahead)
      const p: P3 = [this.x + this.wx * (R + 0.02) + this.tx * 0.25, this.y + 1.3, this.z + this.wz * (R + 0.02) + this.tz * 0.25];
      return this.wallSide > 0 ? { hl: p } : { hr: p };
    }
    if (this.state === 'air') {
      if (this.move === 'underbar' && this.plant && this.plant2 && u > 0.1 && u < 0.7) return { hl: this.plant, hr: this.plant2 };
      if (this.move === 'vault' && this.plant && u > 0.12 && u < 0.82) return this.plant2 ? { hl: this.plant, hr: this.plant2 } : L ? { hr: this.plant } : { hl: this.plant };
      if (this.move === 'spring' && this.lip && u > 0.6) return { hl: this.lip[0], hr: this.lip[1] };
      return {};
    }
    // (braced against a wall it's pressing into: both hands on it, about the shoulders)
    if (this.state === 'ground' && this.press > 0) {
      const wx = this.x + this.pax * (R + 0.28), wz = this.z + this.paz * (R + 0.28);
      return { hl: [wx - this.paz * 0.24, this.y + 1.35, wz + this.pax * 0.24], hr: [wx + this.paz * 0.24, this.y + 1.35, wz - this.pax * 0.24] };
    }
    // (out of a dive, both hands to the ground first; a deep landing, one)
    if (this.move === 'roll' && u < 0.28) return { hl: by(0.45, 0.16, 0), hr: by(0.45, -0.16, 0) };
    if (this.move === 'run' && this.land > 0.5) return L ? { hr: by(0.38, -0.26, 0) } : { hl: by(0.38, 0.26, 0) };
    return {};
  }

  private ground(dt: number, mag: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.runT = mag > 0.5 ? this.runT + dt : 0;
    if (jump) this.to.buffer = 0.22;
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
    if (this.stickT > 0) { this.stickT -= dt; top = Math.min(top, 1.5); }
    this.move = this.rollT > 0 ? 'roll' : this.dashT > 0 ? 'dash' : ledge ? 'ledge' : 'run';
    // (toward the wanted velocity, at a fixed rate: a turn is quick, a reversal a skid)
    // (while the legs are still taking a landing it drives less: the landing is a beat, and the burst comes out of it; let
    // go with room ahead, it settles, through a walk to a stand, over about a second; with no room, it stops short)
    const settling = !on && sp > 0.5 && this.rollT <= 0 && (() => { const s = (sp * sp) / (2 * TUNE.accel * 0.25) + 0.6; for (let d = 0.5; d <= s; d += 0.5) if (Math.abs(H(this.x + fx * d, this.z + fz * d) - this.y) > STEP) return false; return true; })();
    // (and while a landing is still being recovered from, or it's off balance, it drives less; spent, it runs a little slower)
    if (this.recoverT > 0) this.recoverT -= dt;
    top *= 0.9 + 0.1 * this.stamina;
    const drive = (this.recoverT > 0 ? 0.5 : 1) * (1 - Math.min(0.5, Math.abs(this.balance) * 2));
    const tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez), a = (this.rollT > 0 ? TUNE.accel * 0.3 : settling ? TUNE.accel * 0.25 : TUNE.accel * (1 - 0.6 * this.land) * drive) * dt;
    if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    sp = this.speed;
    this.phase += ((sp * dt) / (1.3 + 0.27 * sp)) * 2 * Math.PI;
    this.to.buffer = Math.max(0, this.to.buffer - dt);
    const preparing = this.to.buffer > 0 && this.rollT <= 0;
    if (preparing) {
      if (!this.committed) this.to.left = this.leftSupports();
      this.committed = true;
      this.load = Math.min(1, this.load + dt / 0.115);
      if (this.load >= 1 || (this.load >= 0.65 && this.inStance())) {
        this.effort = 0.8; if (this.tame()) return;
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
          this.to.left = this.leftSupports();
          if (!this.inStance()) this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 + 0.31 + (this.to.left ? 0 : Math.PI);
        }
        // (the wind-up as big as what's ahead asks: up a storey, deeper and longer; across or down, quick; spent, slower)
        const rise = H(this.x + ux * edge, this.z + uz * edge) - this.y;
        this.effort = rise > 1.2 ? Math.min(1, 0.5 + rise / 6.8) : 0.25;
        this.load = Math.min(1, this.load + dt * (9 - 4 * this.effort) * (0.7 + 0.3 * this.stamina));
        if ((this.load >= 0.65 && edge <= ahead) || edge <= R + sp * dt) {
          if (this.tame()) return;
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
    else if (h < this.y) { this.x = nx; this.z = nz; this.vy = 0; this.launch(0, 'fall', false, false, 0.3); this.leaps--; }
    // (a corner the look ahead went past: leapt, from where it stands)
    else if (on && h <= this.y + TUNE.rise && mag >= 0.55) this.leap(dx, dz, 0.05, sp);
    // (a tall wall met at a slant, at pace, with wall going on along it: stepped onto off one foot, and run along)
    else if (on && sp >= 4 && this.seek(0.85, dx, dz)) return;
    else if (on && this.goFor(dt, dx, dz, nx, nz)) return;
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

  /**
   * Pressed into a tall wall, met near square, with a hold in reach (its top, or a sill on the way up it): after a beat
   * it goes for it, as a tap would, carried a little into the wall so the jump meets it and a foot is planted.
   */
  private goFor(dt: number, dx: number, dz: number, nx: number, nz: number): boolean {
    if (!TUNE.walls || this.wallCool > 0 || this.to.buffer > 0) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    let ax = 0, az = 0;
    for (const [bx, bz] of AXES) if (bx * dx + bz * dz > 0.65 && H(this.x + bx * (R + 0.3), this.z + bz * (R + 0.3)) > this.y + TUNE.rise) { ax = bx; az = bz; }
    if (!ax && !az) { this.press = 0; return false; }
    const wx = this.x + ax * (R + 0.3), wz = this.z + az * (R + 0.3), top = H(wx, wz);
    const apex = (10.5 * 10.5) / (2 * TUNE.gravity), reachable = top - this.y <= apex + TUNE.armReach + 0.38 ||
      !!this.city.gripAt(wx, this.y + apex + TUNE.armReach - 0.5, wz, 1.2, (g) => (g.kind === 'sill' || g.kind === 'pipe') && g.nx * ax + g.nz * az < -0.5);
    if (!reachable) { this.press = 0; return false; }
    this.press += dt; this.pax = ax; this.paz = az;
    if (this.press < BRACE) return false;
    this.press = 0; this.to.buffer = 0.22;
    // (into it: so the jump meets the wall)
    // (the pace along the wall kept; into it, a step's worth)
    const along = Math.abs(ax) ? this.vz : this.vx; void nx; void nz;
    this.vx = ax ? ax * 2.5 : along; this.vz = az ? az * 2.5 : along;
    return true;
  }

  /** a big wind-up, before it goes: held at full load a moment (the emphasis); true while it's being held */
  private tame(): boolean {
    // (only from a stand, or a hold: a running takeoff is never stopped to be held)
    if (TUNE.emphasis <= 0 || this.effort < 0.5 || this.tamed || this.speed > 3) { this.tamed = false; return false; }
    this.tamed = true; this.load = 1; this.freeze = (0.04 + 0.05 * this.effort) * TUNE.emphasis;
    return true;
  }
  /** a big release spends effort */
  private spend(e: number): void { this.stamina = Math.max(0, this.stamina - e * 0.18); this.spentT = 0; }

  private resetTakeoff(): void { this.to.buffer = 0; this.to.load = 0; this.to.committed = false; }

  /**
   * A committed jump: how it goes is the approach's and the plant's. Standing, a strong spring straight up; off a step or
   * two, the highest (the last step loads best); flat out, lower and long, carrying the pace and adding to it. A deeper
   * final plant gives more of all of it, and so does effort left.
   */
  private strongJump(): void {
    const s = this.speed, k1 = Math.min(1, s / 4), k2 = Math.max(0, Math.min(1, (s - 6) / 10));
    const plant = 0.85 + 0.15 * Math.min(1, this.load), fresh = 0.9 + 0.1 * this.stamina;
    const vy = (9 + 1.5 * k1 - 2 * k2) * plant * fresh;
    if (s > 0.5) { const add = 1.5 * k2 * Math.max(0, (Math.min(1, this.load) - 0.65) / 0.35); this.vx += (this.vx / s) * add; this.vz += (this.vz / s) * add; }
    this.launch(vy, 'spring', false, false, (2 * vy) / TUNE.gravity);
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
    const ground = this.state === 'ground'; this.from = this.state;
    if (ground && vy > 0) this.spend(this.effort || 0.25);
    this.effort = 0;
    if (ground) {
      const supportLeft = this.load ? this.to.left : this.leftSupports();
      this.lead = supportLeft ? 0 : 1;
    } else this.lead ^= 1;
    this.chain = null; this.ch = null; this.atLip = -1; this.stepFoot = null; this.bracing = false; this.press = 0; this.held = 0; this.rising = vy > 0;
    if (move !== 'vault') this.palmSpin = false;
    this.resetTakeoff(); this.pushPending = false; this.dashT = 0;
    this.state = 'air'; this.vy = vy; this.airT = 0; this.planned = planned; this.air2 = true;
    this.move = move; this.float = float; this.flightT = Math.max(0.15, planned || float ? T : this.comesDown(T)); this.mu = 0;
    this.leaps++; this.rollT = 0; this.count(move);
    if (move !== 'vault' && move !== 'underbar') this.plant = this.plant2 = null;
    if (move !== 'spring') this.lip = null;
  }

  /** an unaimed flight: when it will come down on whatever's under it (or `T`, if that's not within a few seconds) */
  private comesDown(T: number): number {
    let x = this.x, y = this.y, z = this.z, vy = this.vy; const h = 1 / 60;
    for (let t = h; t < 3; t += h) {
      vy -= TUNE.gravity * h; x += this.vx * h; z += this.vz * h; y += vy * h;
      if (vy < 0 && y <= this.city.heightAt(x, z)) return t;
    }
    return T;
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
      if (at < 0) { this.vx = ux * sp; this.vz = uz * sp; this.launch(JUMP * 0.8, 'bound', false, false, 2 * JUMP * 0.8 / G); return; }
    }
    let D = at + 0.7;
    const dh = to - y, clear = Math.max(0, dh, over - y);
    // (which move: by the rise, the drop, the distance, what's in the way)
    let move: Move, apex: number, spin = false;
    if (dh >= 1.2) { move = 'spring'; apex = clear + 0.6; }
    // (something tall in the way: over it, turned over)
    else if (clear >= 1.2) { move = this.leaps % 2 ? 'sideflip' : 'flip'; apex = clear + 0.5; }
    // (a long way down: headfirst and rolled out of; a long way across: a bound, as long as it takes. A glide is never the
    // runner's choice, only the held jump's)
    else if (dh <= -TUNE.diveDrop) { move = 'dive'; apex = clear + 0.4 + (D > TUNE.glideDist ? 0.04 * D : 0); }
    else if (over - y >= 0.6 && D <= 5) {
      // (something to get over: with an edge of it to put a hand on, a vault, one hand or (every other) two; without, a hop)
      const g = TUNE.reach ? this.city.gripAt(this.x + ux * overAt, over, this.z + uz * overAt, TUNE.gripReach, (h) => (h.kind === 'edge' || h.kind === 'rail') && Math.abs(h.ay - over) < 0.05) : null;
      if (g) {
        move = 'vault'; apex = clear + TUNE.vaultLow;
        const two = this.leaps % 2 === 0, l = Math.hypot(g.hold.bx - g.hold.ax, g.hold.bz - g.hold.az) || 1, hx = ((g.hold.bx - g.hold.ax) / l) * 0.2, hz = ((g.hold.bz - g.hold.az) / l) * 0.2;
        this.plant = two ? onHold(g.hold, g.x + hx, g.z + hz) : [g.x, g.y, g.z]; this.plant2 = two ? onHold(g.hold, g.x - hx, g.z - hz) : null;
        spin = !two && this.leaps % 3 === 0;
      } else { move = 'hop'; apex = clear + 0.3; }
    }
    else { move = 'bound'; apex = clear + 0.1 + 0.06 * D; }
    // (a bar across the way, about head height over the gap, and the far side level with this one: under it, feet first,
    // the hands on it (an underbar))
    let bar: P3 | null = null;
    if ((move === 'bound' || move === 'hop') && TUNE.reach && Math.abs(dh) < 0.6) {
      const mid = (from + at) / 2, g = this.city.gripAt(this.x + ux * mid, y + 1.3, this.z + uz * mid, Math.max(1.2, (at - from) / 2), (h) => h.kind === 'bar' && h.ay - y > 0.9 && h.ay - y < 1.8);
      if (g) { move = 'underbar'; apex = clear + 0.15; bar = [g.x, g.y, g.z]; }
    }
    const float = false;
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
    // (and keep the aim: too slow for the mark at the pace it can carry, a higher arc, so the flight lasts long enough;
    // too fast, a flatter one, so it's shorter; only if neither lands it does it go unaimed, to land wherever it can)
    const carried = Math.max(sp - 1.5, Math.min(sp + 1.5, v));
    if (Math.abs(carried - v) > 0.001) {
      let a2 = apex, u2 = up, T2 = T;
      // (flatter only across a gap: over something, never lower than it was, or it'd go through what it's going over)
      const step = carried < v ? 0.2 : -0.1, lo = move === 'bound' || move === 'dive' || move === 'underbar' ? clear + 0.1 : apex, hi = clear + 3.4;
      for (let i = 0; i < 40; i++) {
        const nA = a2 + step; if (nA < lo || nA > hi) break;
        a2 = nA; u2 = Math.sqrt((2 * a2) / G); T2 = u2 + fall(a2 - dh, float);
        if (carried < v ? carried * T2 >= D : carried * T2 <= D) break;
      }
      const at2 = carried * T2;
      if (Math.abs(H(at2) - to) < 0.1 && flat(at2, to)) { apex = a2; up = u2; T = T2; aimed = true; }
      else aimed = Math.abs(H(carried * T) - to) < 0.1 && flat(carried * T, to);
      v = carried;
    }
    this.vx = ux * v; this.vz = uz * v;
    const plant = this.plant, plant2 = this.plant2;
    this.launch(G * up, move, aimed, float, T);
    if (move === 'vault') {
      this.plant = plant; this.plant2 = plant2; this.vaultTo = to; this.palmSpin = spin; if (spin) this.count('palmspin' as Move);
      // (the hands in the figure's own order: the one on its left to the left)
      if (plant && plant2 && (plant[0] - plant2[0]) * uz - (plant[2] - plant2[2]) * ux < 0) { this.plant = plant2; this.plant2 = plant; }
    }
    if (move === 'underbar' && bar) { this.plant = [bar[0] + uz * 0.22, bar[1], bar[2] - ux * 0.22]; this.plant2 = [bar[0] - uz * 0.22, bar[1], bar[2] + ux * 0.22]; }
    if (move === 'spring' && TUNE.reach) {
      // (a storey up: the lip it lands over, for both hands)
      const g = this.city.gripAt(this.x + ux * at, to, this.z + uz * at, TUNE.gripReach, (h) => h.kind === 'edge' && Math.abs(h.ay - to) < 0.05);
      if (g) this.lip = [onHold(g.hold, g.x + uz * 0.2, g.z - ux * 0.2), onHold(g.hold, g.x - uz * 0.2, g.z + ux * 0.2)];
    }
  }

  private air(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.to.buffer = Math.max(0, this.to.buffer - dt);
    // (held at the top of a flight a moment, as a drawing would hold it (`apexHold`): the pose held, the body going on
    // across, at its pace, and on its arc, so it lands where it meant to; then the pose catches up)
    this.airT += dt;
    const muT = Math.min(1, this.airT / this.flightT);
    if (TUNE.apexHold > 0 && !this.float) { if (this.vy > 0) this.rising = true; else if (this.rising) { this.rising = false; this.held = TUNE.apexHold; } }
    if (this.held > 0) this.held -= dt;
    else this.mu = Math.min(muT, this.mu + Math.max(dt / this.flightT, (muT - this.mu) * Math.min(1, dt * 14)));
    // (a leap that hasn't landed where it meant to: falling from here, to catch what it can, or to come down and roll)
    if (!this.float && this.airT > this.flightT + 0.12 && this.move !== 'fall') { this.move = 'fall'; this.planned = false; this.count('fall'); if (this.from === 'ground') this.misses++; }
    // (the jump held, coming down: a glide, as long as it's held; let go, a fall)
    if (this.hold && this.vy < 0 && !this.float) { this.float = true; this.move = 'glide'; this.planned = false; this.count('glide'); }
    else if (!this.hold && this.float && this.move === 'glide') { this.float = false; this.move = 'fall'; }
    const sp = this.speed;
    if (this.planned && on && sp > 0.5 && (this.vx * dx + this.vz * dz) / sp < 0.5) this.planned = false;
    if (on) {
      // (steered, not driven: a flight doesn't gain pace in the air (a little from a standing jump); a glide does, gliding)
      const top = this.float ? Math.max(sp, 7) : this.planned ? sp : Math.max(sp, 3);
      const tx = dx * top, tz = dz * top;
      const ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez);
      const alignment = sp > 0.5 ? (this.vx * dx + this.vz * dz) / sp : 0;
      const authority = this.planned ? Math.min(1, 0.2 + 1.6 * (1 - alignment)) : 1;
      const a = TUNE.steer * authority * dt;
      if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    }
    // (a second jump, off nothing, turned over: once a flight)
    if (jump && this.vy < 0 && this.y - H(this.x, this.z) < -this.vy * 0.12) this.to.buffer = 0.22;
    else if (jump && this.air2) {
      // (turned over forwards; leaning across the way it's going, over sideways)
      const side = on && sp > 0.5 ? Math.abs((this.vx * dz - this.vz * dx) / sp) : 0;
      this.launch(JUMP * 0.95, side > 0.5 ? 'sideflip' : 'flip', false, false, 0.8); this.air2 = false;
    }
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
    // (only once the feet are up near it, tucked over: below that, what the hand is on is in the way like anything else)
    const over = this.move === 'vault' && this.plant && this.y + this.vy * dt > this.plant[1] - 0.6 ? this.plant[1] + 0.05 : -1;
    if (h > ny + 0.05 && h > over) {
      // (something in the way: a lip is stepped up onto; a wall met at a slant is run along; met square, run up)
      if (h - ny <= 0.6) { this.x = px; this.z = pz; this.y = h; this.touch(Math.max(0, -this.vy)); return; }
      this.y = ny;
      // (coming down against it with its top in reach: caught, and pulled over)
      if (this.vy <= 0 && this.catchLip(px, pz, ux, uz)) return;
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
          this.stepFoot = [foot.x, foot.y, foot.z]; this.state = 'plant'; this.stepAge = 0;
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

  /** A lip in arm's reach on the wall it's against (falling, or off a plant): its edge in both hands, and pulled over. */
  private catchLip(px: number, pz: number, ux: number, uz: number): boolean {
    if (!TUNE.walls) return false;
    let ax = 0, az = 0, most = 0;
    for (const [bx, bz] of AXES) { const k = bx * ux + bz * uz; if (k > most && this.city.heightAt(this.x + bx * (R + 0.15), this.z + bz * (R + 0.15)) > this.y + 0.05) { most = k; ax = bx; az = bz; } }
    if (!ax && !az) return false;
    const x = this.x + ax * (R + 0.05), z = this.z + az * (R + 0.05), top = this.city.heightAt(x, z), reach = top - this.y;
    if (reach <= 0.65 || reach > TUNE.armReach) return false;
    const lip = this.city.gripAt(x, top, z, 0.4, (g) => g.kind === 'edge' && g.nx * ax + g.nz * az < -0.9);
    if (!lip) return false;
    void px; void pz;
    this.wx = ax; this.wz = az; this.x = x - ax * (R + 0.05); this.z = z - az * (R + 0.05);
    this.grabTop(lip, top, x, z);
    return true;
  }
  /** hands on a lip at `top`: climbing over it from here */
  private grabTop(lip: { hold: Hold }, top: number, x: number, z: number): void {
    this.top = top; this.chain = null;
    this.grips = { hl: onHold(lip.hold, x + this.wz * 0.18, z - this.wx * 0.18), hr: onHold(lip.hold, x - this.wz * 0.18, z + this.wx * 0.18) };
    this.catchHeight = this.y; this.climbT = 0; this.mu = 0; this.vy = 0; this.vx = this.vz = 0;
    // (caught: hanging, the hips swinging in under it, before anything's decided)
    this.state = 'climb'; this.move = 'hang'; this.atLip = 0; this.catches++;
  }
  /** a hold to hang from on the face ahead, between `lo` and `hi`: a sill, or a pipe at that height */
  private holdUp(lo: number, hi: number): { y: number; hold: Hold; x: number; z: number } | null {
    const x = this.x + this.wx * (R + 0.05), z = this.z + this.wz * (R + 0.05);
    let best: { y: number; hold: Hold; x: number; z: number } | null = null;
    for (const h of this.city.holdsNear(x, z, 1.4)) {
      if ((h.kind !== 'sill' && h.kind !== 'pipe') || h.nx * this.wx + h.nz * this.wz > -0.5) continue;
      const p = onHold(h, x, z), y = h.kind === 'pipe' ? Math.min(h.by, hi) : h.ay;
      if (Math.hypot(p[0] - x, p[2] - z) > 1.2 || y < lo || y > hi) continue;
      if (!best || y > best.y) best = { y, hold: h, x: p[0], z: p[2] };
    }
    return best;
  }
  /** hands on a hold part way up a face: hanging from it, to load and spring for the next */
  private hangFrom(g: { y: number; hold: Hold; x: number; z: number }): void {
    const l = Math.hypot(g.hold.bx - g.hold.ax, g.hold.bz - g.hold.az) > 0.1;
    this.grips = l ? { hl: onHold(g.hold, g.x + this.wz * 0.18, g.z - this.wx * 0.18), hr: onHold(g.hold, g.x - this.wz * 0.18, g.z + this.wx * 0.18) }
      : { hl: [g.x, g.y + 0.12, g.z], hr: [g.x, g.y - 0.1, g.z] };
    this.chain = { y: g.y, phase: 0, t: 0, y0: this.y, y1: g.y - HANG, next: 0 };
    this.vy = 0; this.vx = this.vz = 0; this.climbT = 0; this.mu = 0;
    this.state = 'climb'; this.move = 'hang'; this.count('hang');
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
    // (a wall close across the way, as tall: a narrow alley; leaning in, up it wall to wall)
    // (only once the lean has been held through the run's first beat: not the angle it happened to arrive at)
    if (TUNE.walls && up > 0.2 && this.wallT > 0.25) { const d = this.across(); if (d > 0) { this.intoChimney(d); return; } }
    this.wallT += dt * (1 + TUNE.wallCost * up);
    const left = Math.max(0, 1 - this.wallT / TUNE.wallTime);
    this.vy = Math.min(TUNE.wallRise, this.vy + (up * TUNE.wallLift * Math.min(1, left * 2.5) - TUNE.wallGravity) * dt);
    this.wsp = Math.max(TUNE.wallSpeed * 0.6, this.wsp - up * TUNE.wallDrag * dt);
    this.vx = this.tx * this.wsp; this.vz = this.tz * this.wsp;
    const kick = () => {
      this.vx = this.tx * this.wsp * 0.9 - this.wx * TUNE.kick; this.vz = this.tz * this.wsp * 0.9 - this.wz * TUNE.kick;
      this.wallCool = 0.12; this.launch(7.5, 'kick', false, false, 0.75);
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

  /** how far the wall across a narrow alley is (from the body), or 0 if there's none in reach as tall as this one */
  private across(): number {
    for (let d = R + 0.3; d <= ALLEY; d += 0.1) if (this.city.heightAt(this.x - this.wx * d, this.z - this.wz * d) > this.y + 1.6) return d;
    return 0;
  }
  private intoChimney(d: number): void {
    const ox = this.x + this.wx * (R + 0.05), oz = this.z + this.wz * (R + 0.05);
    this.ch = { ax: this.wx, az: this.wz, ox, oz, gap: d + R + 0.05, side: 1, t: 0, kicks: 0, along: 0, pace: Math.min(4, this.wsp * 0.35) };
    this.state = 'chimney'; this.move = 'chimney'; this.vy = TIC_UP; this.chimneys++; this.count('chimney');
  }
  /**
   * Up a narrow alley, wall to wall: off one with a kick up and across, onto the other, a kick every TIC seconds, drifting
   * on along the alley; a top come within reach is caught and pulled over; let go (no direction held), it drops; the
   * alley widening or a wall ending, it's off into the air.
   */
  private chimney(dt: number, on: boolean): void {
    const c = this.ch!, H = (x: number, z: number) => this.city.heightAt(x, z);
    c.t += dt; c.along += c.pace * dt;
    this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
    const from = c.side > 0 ? R : c.gap - R, to = c.side > 0 ? c.gap - R : R, k = Math.min(1, c.t / TIC), e = k * k * (3 - 2 * k), lat = from + (to - from) * e;
    this.x = c.ox - c.ax * lat + this.tx * c.along; this.z = c.oz - c.az * lat + this.tz * c.along;
    this.vx = this.tx * c.pace; this.vz = this.tz * c.pace; this.mu = k; this.wallSide = c.side;
    const g = H(this.x, this.z);
    if (this.y <= g) { this.ch = null; this.y = g; this.touch(Math.max(0, -this.vy)); return; }
    if (k < 1) return;
    // (on the other wall: its top in reach is caught; else kicked off again, if it goes on and it's still wanted)
    c.side = -c.side; c.t = 0; c.kicks++; this.lead ^= 1;
    const nx = c.side > 0 ? c.ax : -c.ax, nz = c.side > 0 ? c.az : -c.az;
    const fx = this.x + nx * (R + 0.05), fz = this.z + nz * (R + 0.05), top = H(fx, fz), reach = top - this.y;
    if (reach > 0.5 && reach <= TUNE.armReach) {
      const lip = this.city.gripAt(fx, top, fz, 0.5, (q) => q.kind === 'edge' && q.nx * nx + q.nz * nz < -0.9);
      if (lip) { this.wx = nx; this.wz = nz; this.ch = null; this.grabTop(lip, top, fx, fz); return; }
    }
    const fwd = H(fx + this.tx * 0.6, fz + this.tz * 0.6), back = H(this.x - nx * (c.gap - R + 0.05) + this.tx * 0.6, this.z - nz * (c.gap - R + 0.05) + this.tz * 0.6);
    if (!on || c.kicks >= 12 || reach <= 0.5 || fwd <= this.y + 0.6 || back <= this.y + 0.6) {
      this.ch = null; this.vx = this.tx * c.pace - nx * 2.5; this.vz = this.tz * c.pace - nz * 2.5; this.wx = nx; this.wz = nz;
      this.launch(Math.max(this.vy, 4), 'bound', false, false, 0.6); this.wallCool = 0.3; return;
    }
    this.vy = TIC_UP; this.spend(0.3);
  }

  private wallStep(dt: number, into: number): void {
    this.stepAge += dt;
    this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
    const x = this.x + this.wx * (R + 0.05), z = this.z + this.wz * (R + 0.05);
    const top = this.city.heightAt(x, z), reach = top - this.y;
    if (into > 0.55 && this.stepAge >= 0.06 && reach > 0.65 && reach <= TUNE.armReach) {
      const lip = this.city.gripAt(x, top, z, 0.3, g => g.kind === 'edge' && g.nx * this.wx + g.nz * this.wz < -0.9);
      if (lip) { this.grabTop(lip, top, x, z); return; }
    }
    // (its top out of reach: a sill, or a pipe, in reach on the way up it, hung from; and from there, the next)
    if (into > 0.55 && this.stepAge >= 0.06 && this.vy < 2.5 && reach > TUNE.armReach) {
      const g = this.holdUp(this.y + 0.9, this.y + TUNE.armReach);
      if (g) { this.hangFrom(g); return; }
    }
    if (this.vy <= 0 || into < 0.1 || this.stepAge > 0.5) {
      this.launch(this.vy, 'bound', false, false, 0.55);
      this.vx = -this.wx * 1.6; this.vz = -this.wz * 1.6; this.wallCool = 0.25;
    }
  }

  private touch(impact: number): void {
    const was = this.move, aimed = this.planned, braced = this.bracing;
    this.resetTakeoff(); this.land = 0;
    // (up a storey costs pace)
    if (was === 'spring') { this.vx *= 0.82; this.vz *= 0.82; }
    // (how it went: off its mark (a fall, off a wall, into one) a stagger and a knock to the balance; heavy, deeper and
    // longer in the legs, held at the deepest if the emphasis asks, paid for in pace; else light, flowing on)
    const heavy = impact >= 9 ? Math.min(1, (impact - 9) / 8) : 0, off = was === 'fall' || was === 'kick' || braced;
    if (off) {
      this.landings.off++; this.legVelocity = Math.min(12, impact) * 0.9; this.recoverT = 0.25;
      this.vx *= 0.85; this.vz *= 0.85; this.balanceV += (this.lead ? 1 : -1) * 1.6 + this.wallSide * (was === 'kick' ? 0.8 : 0);
    } else if (heavy > 0) {
      this.landings.heavy++; this.legVelocity = Math.min(14, impact) * 0.95; this.recoverT = 0.15 + 0.35 * heavy; this.hitPending = TUNE.emphasis > 0;
      if (was !== 'dive') { this.vx *= 1 - 0.3 * heavy; this.vz *= 1 - 0.3 * heavy; }
    } else { this.landings.flow++; this.legVelocity = Math.min(10, impact) * 0.75; }
    this.balanceV += this.turn * 0.05;
    if (impact > 5) { this.impact = Math.min(1, impact / 16); this.impactT = 0; }
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

    // (an aimed landing on something narrow (a rim, a wall across an alley): stuck, the pace taken in the legs, a moment to
    // settle before it goes on along it)
    if (aimed && this.rollT <= 0 && (was === 'bound' || was === 'hop' || was === 'spring') && sp > 1) {
      const H = (x: number, z: number) => this.city.heightAt(x, z), px = -uz, pz = ux;
      if (H(this.x + px * 0.7, this.z + pz * 0.7) < this.y - STEP && H(this.x - px * 0.7, this.z - pz * 0.7) < this.y - STEP) {
        this.vx *= 0.15; this.vz *= 0.15; this.stickT = 0.3; this.legVelocity = Math.max(this.legVelocity, 4); this.count('stick' as Move);
        return;
      }
    }
    // (out of a roll, or landed as meant with room ahead: a dash)
    if (sp > 6 && (this.rollT > 0 || (aimed && was !== 'glide' && was !== 'spring'))) {
      const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
      if (this.rollT > 0 || [2, 4, 6].every((d) => Math.abs(H(d) - this.y) <= STEP)) { this.pushPending = true; }
    }
  }

  private climb(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    this.climbT += dt;
    if (this.chain) { this.hang(dt, on ? dx * this.wx + dz * this.wz : 0, jump); return; }
    if (this.atLip >= 0) {
      // (hanging from a lip it caught: a beat for the hips to swing in under it; then pressing on toward the wall pulls over
      // (a tap too); pressing away, it lets go and drops)
      const into = on ? dx * this.wx + dz * this.wz : 0;
      this.atLip += dt; this.mu = Math.min(1, this.atLip / LIP_BEAT);
      // (held along the wall, neither toward it nor away, after a while longer: let go, and on the way it was going (a brush
      // past); nothing held at all: it hangs, as long as it's left)
      const along = on && Math.abs(into) <= 0.3 && this.atLip > LIP_BEAT + 0.5;
      if (into < -0.3 || along) { this.atLip = -1; this.vx = (along ? dx * 3 : 0) - this.wx * 2; this.vz = (along ? dz * 3 : 0) - this.wz * 2; this.launch(0, 'fall', false, false, 0.4); this.wallCool = 0.3; this.made.fall = (this.made.fall ?? 1) - 1; this.leaps--; this.count('drop' as Move); return; }
      if ((this.atLip >= LIP_BEAT && into > 0.3) || (jump && this.atLip > 0.08)) {
        this.atLip = -1; this.climbT = 0; this.mu = 0; this.move = 'climb'; this.climbs++; this.count('climb');
      }
      return;
    }
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

  /**
   * Hanging from a hold on the way up a face, as up a fire escape: caught (the body swinging in under the hands), loaded
   * (knees up, feet on the wall), and sprung for the next hold: the roof's lip, pulled over; or a sill a storey up, hung
   * from again. Pressing into the wall goes again as soon as it's loaded; a tap goes at once (the rhythm is yours);
   * pressing away lets go.
   */
  private hang(dt: number, into: number, jump: boolean): void {
    const c = this.chain!, H = (x: number, z: number) => this.city.heightAt(x, z);
    const wx = this.x + this.wx * (R + 0.05), wz = this.z + this.wz * (R + 0.05);
    c.t += dt;
    if (into < -0.4) { this.chain = null; this.vx = -this.wx * 3; this.vz = -this.wz * 3; this.launch(2, 'fall', false, false, 0.4); this.wallCool = 0.3; return; }
    if (c.phase === 0) {
      // (caught: the body comes in under the hands)
      const k = Math.min(1, c.t / CHAIN_CATCH); this.y = c.y0 + (c.y1 - c.y0) * (k * k * (3 - 2 * k)); this.mu = k;
      if (k >= 1) { c.phase = 1; c.t = 0; }
      return;
    }
    if (c.phase === 1) {
      this.mu = Math.min(1, c.t / CHAIN_LOAD);
      if (!(jump && c.t > 0.05) && !(into > 0.55 && c.t >= CHAIN_LOAD / (0.7 + 0.3 * this.stamina))) return;
      // (for the next: the roof's lip if it's within a spring and a reach, else a hold a storey or so up)
      const top = H(wx, wz);
      if (top - c.y <= 3.3) c.next = top;
      else { const g = this.holdUp(c.y + 1.2, c.y + 3.6); if (!g) return; c.next = g.y; }
      this.effort = 0.8; if (this.tame()) return; this.spend(0.7); this.effort = 0;
      c.phase = 2; c.t = 0; c.y0 = this.y; c.y1 = c.next - (c.next === top ? TUNE.armReach * 0.75 : HANG); this.chains++; this.count('hang');
      return;
    }
    // (springing: fast off the wall, slowing into the catch, the body long, arms up for the next)
    const k = Math.min(1, c.t / CHAIN_SPRING), e = 1 - (1 - k) * (1 - k);
    this.y = c.y0 + (c.y1 - c.y0) * e; this.mu = k;
    if (k < 1) return;
    const top = H(wx, wz);
    if (Math.abs(c.next - top) < 0.05) {
      const lip = this.city.gripAt(wx, top, wz, 0.5, (g) => g.kind === 'edge' && g.nx * this.wx + g.nz * this.wz < -0.9);
      if (lip) { this.grabTop(lip, top, wx, wz); return; }
    } else {
      const g = this.holdUp(c.next - 0.05, c.next + 0.05);
      if (g) { this.hangFrom(g); this.chain!.y0 = this.y; return; }
    }
    this.chain = null; this.launch(0, 'fall', false, false, 0.3);
  }
}
