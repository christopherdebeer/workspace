/**
 * You, running (no drawing or input here, so it can be run on its own: devtools/bamboo-run.mjs, bamboo-course.mjs).
 *
 * You give the direction and the will to go; the run gives the footwork.
 *
 * - **the lope**: about 7 m/s, gathering and easing off smoothly; slower uphill, quicker down, a little quicker on a trail;
 * - **the weave**: a few times a second, of the ways within thirty degrees or so of where you're heading, the one that's
 *   clearest (culms as they really stand and bow, cut into posts by footing.ts: one at the hips gone round or squeezed
 *   past, one at head height ducked under, one at the shins stepped over; no rock face to climb; no drop too far to take),
 *   nearest your heading, and readier to go over a stone than round it;
 * - **the moves**: looking a second or two ahead along that way, the run picks one and commits to it, takeoff to landing:
 *   over a root or a small stone, a skip (the steps before it shortened to meet it); onto a broad low stone, a gather and
 *   a hop up onto its crown; from a crown, a leap to the next stone if there's one in reach, its takeoff already in mind
 *   as you land; off an edge, a step down or a leap, by your speed and where you'd come down. Turn well off its way before
 *   the takeoff and it's given up: your direction wins;
 * - **the landing**: by how hard you come down onto the surface (across its slope), how fast you're going and what's
 *   ahead: an ordinary one gives at the knees and comes back; a heavy one sinks, pitches you forward and costs speed, then
 *   a few short steps; on a stone, or into a tight place, you brace and stagger; fast and hard onto a clear run down, you
 *   go down into a low roll and come up running;
 * - **the body**: crouch (gathering, landing), duck (under a bowed culm), shoulders turned through a narrow gap, a brush
 *   past a culm, the roll: each for the camera to show (main.ts), with a footfall, a landing and a brush handed out to be
 *   heard;
 * - **the trail**: one near draws you onto it, and running more or less along one, it turns you with it, until you turn
 *   off it; a drop of over three metres the run won't take: you stop at the rim.
 *
 * It runs in fixed steps (`update` takes whatever time has passed), so the pace and the landings are the same however
 * fast the frames come. The land round you is built a chunk at a time as you go (`stream`), and let go behind you.
 */
import { CHUNK, HALF, type Chunk, type Land, type Stone } from './world';
import { Footings, meets, type Footing, type Post } from './footing';

export const LOPE = 7, EYE = 1.62;
const G = 9.8, H = 1 / 120;
export interface Input { go: boolean; turn: number }
export type Act = 'run' | 'skip' | 'hop' | 'leap' | 'drop' | 'fall' | 'climb';
export type Landing = 'light' | 'heavy' | 'brace' | 'roll';
export interface Plan {
  kind: Exclude<Act, 'run' | 'fall'>; dir: number; ox: number; oz: number; lx: number; lz: number; ly: number; clear: number; next: Plan | null; wait: number;
  /** read when (the landing seen while still approaching); how much it asks (0 a skip … 1.5 a long rising leap); how far
   * the last plant sinks for it; the speed it wants at takeoff (the approach slows or presses on to meet it) */
  read?: number; demand?: number; load?: number; vh?: number;
  /** when the foot it springs from was planted (the last plant of its approach, or the landing it's chained from) */
  planted?: number;
  /** a move onto a small surface with nothing after it: the approach brakes for it (a precision landing), and its landing
   * isn't taken further to suit the pace */
  precise?: boolean;
  /** taken on from a landing (the next of a chain): its foot's planted with the landing, but until it springs it's still
   * yours to turn away from */
  chained?: boolean;
  /** where you meant to go when it was chosen (your heading then): it's given up if you've turned off that since */
  intent?: number;
}
/** how a foot meets the ground: a plain plant; soft earth; a step up onto something higher; a check, braking (down, or
 * slowing); a quick touch on a stone in passing; the push of the last plant before a takeoff; a landing */
export type Effort = 'plant' | 'soft' | 'up' | 'check' | 'touch' | 'push' | 'land';
/** a foot set down: where, the slope it's on, on what, which foot (−1 left, 1 right), when, how long it bears the weight,
 * how hard (0 … 2), how much higher than the last, and how */
export interface Contact { x: number; y: number; z: number; n: [number, number, number]; on: Footing; side: number; t: number; dur: number; load: number; rise: number; effort: Effort }
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const key = (i: number, j: number) => `${i},${j}`;
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export class Runner {
  x = 0; z = 0; y = 0; heading = 0; move = 0; v = 0; vy = 0; air = false; phase = 0; turn = 0; onTrail = false; stopped = false;
  /** in the air: the way you're carried */
  vx = 0; vz = 0;
  /** what you're doing, what you're on, the move you're committed to */
  act: Act = 'run'; under: Footing = 'ground'; plan: Plan | null = null;
  /** the body, for the camera: how far it's sunk (gathering, landing), ducked, rolled; how far it's pitched forward; shoulders
   * turned (−1 … 1); a brush's push sideways; the landing it's coming down to, while in the air */
  crouch = 0; crouchV = 0; duck = 0; lean = 0; leanV = 0; shoulder = 0; nudge = 0; rollT = -1; recover = 0; landedAs: Landing | null = null; impact = 0;
  aim: [number, number, number] | null = null;
  /** the feet: the one bearing the weight now (or last), the last few; the body's rise and fall over them (for the eye: up
   * off a push, down into the next plant, sunk while it bears), and the weight's shift over the foot it's on (−1 … 1) */
  contact: Contact | null = null; contacts: Contact[] = []; bodyY = 0; bodyV = 0; weight = 0;
  /** how far into a move's approach you are (0 none … 1 at the takeoff): the eye goes to the landing as it comes */
  prep = 0;
  /** time run, for contacts */
  clock = 0;
  readonly chunks = new Map<string, Chunk>();
  readonly feet: Footings;
  /** a footfall: on what, how hard */
  onStep: (on: Footing, hard: number) => void = () => {};
  /** a landing: on what, how hard (m/s into the surface), how it was taken */
  onLand: (on: Footing, impact: number, as: Landing) => void = () => {};
  /** a culm brushed past: which side (−1 left, 1 right), how close */
  onBrush: (side: number, k: number) => void = () => {};
  /** a move begun */
  onAct: (act: Act) => void = () => {};
  /** a foot set down (every one: plain steps, the plant before a takeoff, a landing) */
  onContact: (c: Contact) => void = () => {};
  private loading = false; private stanceFrom = 0; private stanceLeft = 0; private stanceEnd = 0; private aerialT = 0.2; private nextY = 0; /** how long you've been held at a limit (a face, a rim, nothing to take along your way) */
  limitT = 0;
  /** which side's the more open, held at a limit: where a person would turn (+1 left, -1 right) */
  freer = 1;
  private airTurn = 0; private headTake = 0;
  /** the player holding on (going) this tick; settling onto a landing (braking to a stop within what's under you); the
   * way the body was going when the foot it springs from was planted */
  private going = true; private settle = false; private movePlant = 0; private lastX = 0; private lastZ = 0;
  /** the working the debug view shows (debug.ts): read only */
  debugState() { return { held: this.held, stopped: this.stopped, limitT: this.limitT, stanceLeft: this.stanceLeft, best: this.best, offLine: Math.abs(wrap(this.move - this.heading)) }; }
  private barred = 0; private held = false; private heldT = 0; private acc = 0; private foot = 0; private think = 0; private best = 0; private bestCost = 0; private stride = 2.2; private posts: Post[] = []; private brushed = new Set<object>();
  constructor(readonly world: Land, readonly range = 104) { this.feet = new Footings(world, this.chunks); }

  /** build the chunks within range of (x, z) that aren't built (at most `budget` of them), and let go of those well out */
  stream(x: number, z: number, budget: number, add?: (k: string, c: Chunk) => void, drop?: (k: string) => void) {
    const ci = Math.floor(x / CHUNK), cj = Math.floor(z / CHUNK), n = Math.ceil(this.range / CHUNK) + 1, want: [number, number, number][] = [];
    for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) {
      const d = Math.hypot((ci + a + 0.5) * CHUNK - x, (cj + b + 0.5) * CHUNK - z);
      if (d < this.range + CHUNK * 0.71 && !this.chunks.has(key(ci + a, cj + b))) want.push([d, ci + a, cj + b]);
    }
    want.sort((p, q) => p[0] - q[0]);
    for (const [, i, j] of want.slice(0, budget)) { const c = this.world.chunk(i, j), k = key(i, j); this.chunks.set(k, c); add?.(k, c); }
    for (const [k, c] of this.chunks) if (Math.hypot(c.x0 + CHUNK / 2 - x, c.z0 + CHUNK / 2 - z) > this.range + CHUNK * 2) { this.chunks.delete(k); drop?.(k); }
  }
  /** the ground underfoot (a stair's tread, where there is one) */
  groundAt(x: number, z: number) { return this.feet.groundAt(x, z); }
  /** what you'd stand on: the ground, a tread, a stone's top, a root's */
  standAt(x: number, z: number) { return this.feet.at(x, z).y; }
  /** how far the body has sunk below standing (for the eye): gathered, landed, ducked, rolled */
  get low() { return this.crouch + this.duck + (this.rollT >= 0 ? 0.95 * Math.sin(Math.PI * Math.min(1, this.rollT)) ** 1.4 : 0); }
  /** how far the head's pitched forward and down (radians) */
  get pitchDown() { return this.lean + (this.rollT >= 0 ? 0.55 * Math.sin(Math.PI * Math.min(1, this.rollT)) : 0) + this.duck * 0.25; }

  /** run on for `dt` seconds of time passed (in fixed steps); `turn` is how far you've turned meanwhile */
  update(dt: number, input: Input) {
    this.heading += input.turn;
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= H) { this.tick(H, input.go); this.acc -= H; }
  }
  /** (as `update`) */
  step(dt: number, input: Input) { this.update(dt, input); }

  private tick(dt: number, go: boolean) {
    this.going = go;
    const F = this.feet;
    this.clock += dt;
    // (a trail you're on, running more or less along it: you're on it (its footing's easier, its pull a little on your
    // line); it never turns you: where you go is yours)
    const q = this.world.trailNear(this.x, this.z);
    this.onTrail = false;
    if (q.trail && q.d < HALF * 1.6) {
      const tr = q.trail, i = Math.min(tr.x.length - 2, q.i), dir = Math.atan2(tr.x[i + 1] - tr.x[i], tr.z[i + 1] - tr.z[i]);
      const along = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI);
      if (Math.abs(wrap(along - this.heading)) < 0.6) this.onTrail = true;
    }
    const onStair = this.world.tread(this.x, this.z) !== null;
    // (a few times a second: the weave, and a move picked if there's one to make)
    this.think -= dt;
    if (this.think <= 0 && !this.air) {
      this.think = 0.08;
      this.posts = F.posts(this.x, this.z, 10);
      this.weave(q, go);
      // (the moves ahead are provisional: turn off a move's way before its foot's planted and it's dropped and looked for
      // again along where you're going now; once planted, the foot and the flight are committed)
      // (a chained one too, while the landing's foot still bears you: the flight you were in was committed, the next isn't)
      if (this.plan && this.plan.planted === undefined && Math.abs(wrap(this.heading - this.plan.dir)) > 0.35) this.plan = null;
      // (let go, and a move not yet sprung is let go too: a flight under way carries on; the next launch is yours to decline)
      if (this.plan && !go) { this.plan = null; this.loading = false; }
      if (this.plan?.chained && this.stanceLeft > 0 && Math.abs(wrap(this.heading - (this.plan.intent ?? this.heading))) > 0.35) this.plan = null;
      // (a planted foot that can't spring (nothing left to push it on) lets go of the move)
      if (this.plan && this.plan.planted !== undefined && this.clock - this.plan.planted > 0.8) this.plan = null;
      if (!this.plan && !onStair && (this.v > 1.2 || this.held || this.stopped)) {
        // (a way across what's in your way, first, along where you're going: an obstacle asks for a move, not a turn; only
        // if there's none, along the corridor's clearest way)
        const along = this.pick(this.heading);
        if (along) this.best = this.heading;
        const p = along ?? this.pick(this.best);
        // (the move you asked for is taken if its own way's clear; a blocked continuation is dropped, to be looked for again
        // from where it lands, never a reason to refuse the first)
        this.plan = p && this.clearWay(this.x, this.z, p.lx, p.lz) && (p.kind === 'climb' || this.flightClear(p.ox, this.feet.at(p.ox, p.oz).y, p.oz, p.lx, p.ly, p.lz, p.clear)) ? p : null;
        if (this.plan?.next && !this.clearWay(this.plan.lx, this.plan.lz, this.plan.next.lx, this.plan.next.lz)) this.plan.next = null;
        if (this.plan) this.read(this.plan, this.plan.ox, this.plan.oz, this.y, this.v);
      }
    }
    const plan = this.plan;
    const dirNow = plan && !this.air ? Math.atan2(plan.ox - this.x, plan.oz - this.z) : this.best;
    if (!this.air) this.move += wrap((plan ? (Math.hypot(plan.ox - this.x, plan.oz - this.z) > 0.25 ? dirNow : plan.dir) : this.best) - this.move) * ease(dt, plan ? 10 : 6);
    // (and your heading's your own: avoiding something, the body turns a little off your line and comes back to it; it
    // never takes you another way. Barred, it stops there, facing where you meant)
    // (how long you've been getting nowhere, meaning to: held at a face or a rim, or nothing to take along your way)
    // (and as soon as you're getting somewhere again, not held: a person turning to find a way stops turning once they're
    // moving)
    // (by how far you've really come, not how hard you're going: pressed into a stand of culms, going nowhere, is held too)
    const came = Math.hypot(this.x - this.lastX, this.z - this.lastZ) / dt; this.lastX = this.x; this.lastZ = this.z;
    this.limitT = go && !this.air && (this.v < 0.8 || came < 0.6) ? this.limitT + dt : 0;
    const dx = Math.sin(this.move), dz = Math.cos(this.move);

    // ─── the body: ducking what's at head height ahead, shoulders turned through a gap, a brush past a culm ───
    let duckTo = 0, squeeze = 0;
    {
      let left = 9, right = 9;
      for (const p of this.posts) {
        const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz, lat = -rx * dz + rz * dx, m = meets(p);
        if (al < -0.3 || al > 2.4) continue;
        if (m === 'duck' && Math.abs(lat) < 0.38 + p.r) duckTo = Math.max(duckTo, Math.min(0.8, EYE + 0.16 - p.lo + 0.08));
        if (m !== 'block' || al > 1.2) continue;
        const skin = Math.abs(lat) - p.r;
        if (lat < 0) left = Math.min(left, skin); else right = Math.min(right, skin);
        if (al < 0.35 && skin < 0.42 && !this.brushed.has(p.culm)) { this.brushed.add(p.culm); this.nudge += (lat < 0 ? 1 : -1) * 0.05 * (1 - skin / 0.42); this.onBrush(lat < 0 ? -1 : 1, 1 - skin / 0.42); }
      }
      if (left + right < 0.95 && left < 0.5 && right < 0.5) squeeze = left < right ? 1 : -1;
      if (this.brushed.size > 40) this.brushed.clear();
    }
    this.duck += (duckTo - this.duck) * ease(dt, duckTo > this.duck ? 9 : 3);
    this.shoulder += (squeeze - this.shoulder) * ease(dt, squeeze ? 8 : 3);
    this.nudge *= 1 - ease(dt, 4);

    // ─── the pace ───
    const here = this.y;
    // (the hill's grade slows you, the land's; not the ground's under rock you're running across the tops of, which says
    // nothing of the way you're going: there the moves take the heights)
    const onRock = this.under === 'stone' && F.groundAt(this.x, this.z) < here - 0.5;
    const grade = this.air || onRock ? 0 : (F.groundAt(this.x + dx * 2, this.z + dz * 2) - F.groundAt(this.x, this.z)) / 2;
    let target = go ? LOPE * (1 - Math.min(0.6, Math.max(0, grade)) * 0.9) * (1 + Math.min(0.35, Math.max(0, -grade)) * 0.5) * (this.onTrail ? 1.08 : 1) : 0;
    this.stopped = this.bestCost >= 60 && !plan;
    this.barred = this.stopped ? this.barred + dt : 0;
    if (this.stopped) target = 0;
    else if (this.bestCost > 14) target *= 0.75;
    target *= 1 - this.duck * 0.45 - Math.abs(this.shoulder) * 0.2 - (this.recover > 0 ? 0.25 : 0);
    // (a move's approach: the pace it wants at the takeoff, eased toward over the last steps, slowing for a short high
    // one, pressing on for a long one; a hop up wants a little way on)
    if (plan && plan.kind !== 'drop' && go) {
      // (but never braked: momentum is gathered into a move, pressing on to your lope, and carried through it, the landing
      // going further along its top instead (takeoff); only a precise one brakes)
      const want = Math.max(3.4, Math.min(LOPE * 1.12, plan.vh ?? target));
      // (a precise one, onto a small surface with nothing after it, brakes to what its flight carries: the place shapes the
      // pace, not the pace the place)
      target = this.prep > 0.2 ? (plan.precise ? want : Math.max(want, target)) : Math.max(target, 3.4);
    }
    // (on rock you drive off each foot: the pace comes back quicker between bounds than it builds on the open floor)
    if (!this.air && this.rollT < 0) this.v += (target - this.v) * ease(dt, target > this.v ? (onRock ? 3.6 : 2.2) : 3);
    // (settling onto a landing you've let go on: braked as hard as stopping within what's under you asks, the weight
    // contained on it)
    if (this.settle && !this.air) {
      if (go && this.v < 0.5) this.settle = false;
      else {
        const run = this.supportAt(this.x, this.z, here, this.move).runout, dec = Math.max(5, (this.v * this.v) / (2 * Math.max(0.2, run - 0.25)));
        this.v = Math.max(0, this.v - dec * dt);
        if (this.v === 0 && go) this.settle = false;
      }
    }
    this.recover = Math.max(0, this.recover - dt);

    if (this.air) this.fly(dt);
    else {
      // (the takeoff, when you've reached it)
      if (plan) {
        plan.wait -= dt;
        const toGo = (plan.ox - this.x) * Math.sin(plan.dir) + (plan.oz - this.z) * Math.cos(plan.dir);
        // (the approach: read from afar, the steps adjusted over the last two strides, then the last foot planted and the
        // body loaded onto it, as deep and as long as the move asks: the spring held off while it loads)
        const reach = Math.max(0.5, this.stride * 2.2);
        this.prep = Math.max(this.prep, Math.min(1, 1 - Math.max(0, toGo) / reach));
        if (plan.kind === 'drop') {
          this.loading = false;
          if (toGo <= this.v * dt + 0.02 && plan.wait <= 0) { this.takeoff(plan); return; }
        } else {
          // (the last foot: planted short of the takeoff by as far as the body travels while it bears it, so its stance ends
          // where the move begins; the body loads onto that foot through its stance, turns on it, and the takeoff is its
          // release, when its stance is done, not a foot of its own)
          const loadT = 0.07 + 0.1 * Math.min(1.5, plan.demand ?? 0.5);
          if (plan.planted === undefined && toGo <= Math.max(0.12, this.v * loadT)) { this.pushPlant(plan, dx, dz, loadT); plan.planted = this.clock; this.movePlant = this.move; }
          this.loading = plan.planted !== undefined || toGo < Math.max(0.35, this.v * (0.2 + 0.1 * (plan.demand ?? 0.5)));
          if (this.loading) { this.crouch += ((plan.load ?? 0.1) - this.crouch) * ease(dt, plan.planted !== undefined ? 22 : 10); this.crouchV = 0; }
          // (the turn onto its way goes with the stance: as much of it as the foot's borne the weight, no faster)
          if (plan.planted !== undefined && this.stanceLeft > 0 && this.contact) {
            const k = Math.min(1, 1 - this.stanceLeft / Math.max(0.03, this.contact.dur)), e = k * k * (3 - 2 * k);
            this.move = this.movePlant + wrap(plan.dir - this.movePlant) * e;
          }
          if (plan.planted !== undefined && this.stanceLeft <= 0 && plan.wait <= 0) { this.takeoff(plan); return; }
        }
      } else { this.prep = Math.max(0, this.prep - dt * 4); this.loading = false; }
      const [sx, sz] = this.slip(this.x + dx * this.v * dt, this.z + dz * this.v * dt);
      // (and never over a drop too far to take: held at the rim, unless it's where a leap's to be taken from)
      // (held there, you look for a way from where you stand: across, or down another way)
      this.held = F.at(sx + dx * 0.3, sz + dz * 0.3).y < here - 12 && !(plan && (plan.planted !== undefined || Math.hypot(plan.ox - sx, plan.oz - sz) < 0.5));
      this.heldT = this.held ? this.heldT + dt : 0;
      // (a face higher than a step is a wall: you meet it and stop there, braced, never lifted onto its top)
      const wall = !onStair && F.at(sx, sz).y > here + 0.95;
      // (on a planted foot the body goes over it, not on past it: it's the foot that turns it and springs it)
      const overFoot = !!(plan && plan.planted !== undefined && this.stanceLeft > 0 && this.contact && Math.abs(wrap(plan.dir - this.movePlant)) > 0.35 && Math.hypot(sx - this.contact.x, sz - this.contact.z) > 0.45);
      if (overFoot) this.v *= 1 - ease(dt, 10);
      if (this.held || wall || overFoot) { if (!overFoot) this.v = wall ? Math.min(this.v, 0.4) : 0; }
      else { this.x = sx; this.z = sz; }
      // (the footing: follow it; over an edge with nothing planned, off it, and down)
      const u = F.at(this.x, this.z);
      this.under = u.kind;
      // (an edge is the footing falling away at once, not a steep slope run down; off one unlooked-for, you step down
      // off it, checking your speed, rather than sail out over what's below)
      const edge = u.y < this.foot - 0.3 && u.y < here - 0.45;
      this.foot = u.y;
      // (an edge nothing was planned for (a crack between tops, a step down): a foothold across it first, bounded to with
      // the pace you have; only if there's none, off it, carrying your speed, not checked to a stumble)
      const across = edge && this.v > 1.5 && u.kind !== 'step' && !onStair ? this.chainFrom(this.x, this.z, here, this.move, null, 1) : null;
      if (across && across.ly > u.y + 0.3) {
        across.ox = this.x; across.oz = this.z; across.wait = 0; this.plan = across; this.read(across, this.x, this.z, here, this.v);
        this.y = here; this.foot = here; this.takeoff(across);
        return;
      } else if (edge && this.v > 1.5 && u.kind !== 'step' && !onStair) {
        this.air = true; this.act = 'fall'; this.vy = 0.3; this.vx = dx * Math.min(this.v, 4.5); this.vz = dz * Math.min(this.v, 4.5); this.aim = null; this.headTake = this.heading; this.airTurn = 0; this.onAct('fall');
      } else if (onStair || this.v < 1.5 || !this.contact || this.rollT >= 0) this.y += (u.y - this.y) * ease(dt, onStair ? 14 : u.y < this.y ? 30 : u.kind === 'stone' ? 18 : 12);
      else {
        // (a higher footing just ahead between strides: a foot's put up onto it, rather than the body lifted by it)
        if (!plan && this.stanceLeft <= 0 && this.clock - this.contact.t > 0.08) {
          const a = F.at(this.x + dx * 0.35, this.z + dz * 0.35);
          if (a.y > this.contact.y + 0.1 && a.y - this.contact.y < 0.9) { this.plant(dx, dz, plan, target, 0.35); this.phase = Math.floor(this.phase) + 0.02; }
        }
        // (the body's height goes from foot to foot: onto a lower one it drops at once; onto a higher one it takes the
        // weight where it was and drives up over the foot's stance; then it's carried over to where the next will come
        // down. So a raised stone lifts you at the step onto it, by the step, not before; never far into the ground)
        const c = this.contact;
        let want = c.y;
        if (this.stanceLeft > 0) { if (c.y > this.stanceFrom) { const k = Math.min(1, 1 - this.stanceLeft / Math.max(0.03, c.dur)); want = this.stanceFrom + (c.y - this.stanceFrom) * k * k * (3 - 2 * k); } }
        else { const k = Math.min(1, (this.clock - this.stanceEnd) / Math.max(0.05, this.aerialT)), d = this.nextY - c.y; want = c.y + d * (d > 0 ? 0.25 : 1) * k * k * (3 - 2 * k); }
        want = Math.max(want, u.y - 0.18);
        this.y += (want - this.y) * ease(dt, 40);
      }
      // (the stride: shortened to meet a takeoff with a footfall, shorter on a stair, short just after a hard landing)
      const before = this.phase;
      let stride = onStair ? 0.8 : this.recover > 0 ? 1.5 : 2.2;
      if (plan && plan.kind !== 'drop') {
        const toGo = Math.max(0.05, (plan.ox - this.x) * Math.sin(plan.dir) + (plan.oz - this.z) * Math.cos(plan.dir)), rem = Math.ceil(before) - before || 1;
        const n = Math.max(rem, rem + Math.round(toGo / stride - rem));
        stride = Math.min(stride * 1.25, Math.max(stride * 0.55, toGo / n));
      }
      this.stride = stride;
      if (this.rollT < 0) this.phase += (this.v * dt) / stride;
      // (a footfall when the stride comes round, unless a foot's still bearing the weight, or the move's own last foot is
      // about to be set down)
      const lastFoot = plan && plan.kind !== 'drop' && plan.planted === undefined && (plan.ox - this.x) * Math.sin(plan.dir) + (plan.oz - this.z) * Math.cos(plan.dir) < this.stride * 0.6;
      if (Math.floor(this.phase) !== Math.floor(before) && this.v > 0.6 && this.stanceLeft <= 0 && !lastFoot) this.plant(dx, dz, plan, target);
    }
    this.stride_(dt);
    this.turn += (wrap(this.best - this.move) - this.turn) * ease(dt, 3);

    // ─── the body's springs: the crouch gives and comes back, a little past; the lean too ───
    if (!this.loading || this.air) { this.crouchV += (-140 * this.crouch - 17 * this.crouchV) * dt; this.crouch = Math.max(-0.08, this.crouch + this.crouchV * dt); }
    this.leanV += (-90 * this.lean - 15 * this.leanV) * dt; this.lean += this.leanV * dt;
    if (this.rollT >= 0) { this.rollT += dt / 0.8; if (this.rollT >= 1) { this.rollT = -1; this.recover = 0.4; } }
  }

  /** the clearest way near your heading */
  private weave(q: { d: number; trail: unknown }, go: boolean) {
    const F = this.feet, here = this.y, posts = this.posts;
    const pull = q.trail && q.d < 16 && go;
    // (stones in reach that could be stood on: a way over one is a way the run would rather take)
    const crowns: { x: number; z: number; rise: number }[] = [];
    for (const s of F.stonesNear(this.x, this.z, 8)) { const top = F.at(s.x, s.z); if (top.kind === 'stone') { const rise = top.y - F.groundAt(s.x, s.z); if (rise > 0.25 && top.y - here < 1.3) crowns.push({ x: s.x, z: s.z, rise }); } }
    let best = this.heading, bestCost = 1e9, left = 1e9, right = 1e9;
    // (only within a corridor round where you're going (a stand sidestepped, a gap found), the cost of each way growing
    // with how far it's off your line, so the body comes back to it; never wider: a way round that isn't yours isn't
    // taken. A trail along your line draws you a little)
    for (let k = -5; k <= 5; k++) {
      const ang = this.heading + k * 0.11, dx = Math.sin(ang), dz = Math.cos(ang);
      let cost = Math.abs(k) * 0.8;
      if (pull) cost += Math.min(6, this.world.trailNear(this.x + dx * 6, this.z + dz * 6).d) * 0.2;
      for (const p of posts) {
        const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz;
        if (al <= 0 || al >= 9) continue;
        const lat = Math.abs(-rx * dz + rz * dx), m = meets(p);
        if (m === 'block') {
          // (a gap a body fits through turned sideways is a way, if a tight one)
          if (lat < 0.27 + p.r) cost += (9 - al) * (al < 4 ? 1.4 : 0.6);
          else if (lat < 0.42 + p.r) cost += (9 - al) * (al < 4 ? 0.45 : 0.2);
        } else if (m === 'duck' && lat < 0.35 + p.r) cost += 0.12;
      }
      // (the footing along it: a face too high to get up (a stone's too, unless it's low enough to stand on), a drop too far)
      for (const d of [0.3, 0.6, 1.4, 2.6, 3.8]) {
        const u = F.at(this.x + dx * d, this.z + dz * d), rise = u.y - here;
        if (u.kind === 'stone' && d > 1) { if (rise > 1.35) cost += 22 * (1 - d / 5); }
        else if ((d === 0.6 || d === 1.4) && rise > 0.9 && !this.onTrail) cost += 60;
        // (a drop too far, close in: a rim, or a cleft, unless there's a top across it to leap to)
        if (d <= 1.4 && rise < -12 && this.across(this.x + dx * d, this.z + dz * d, dx, dz, here) < 0) { cost += 60; break; }
      }
      for (const c of crowns) {
        const rx = c.x - this.x, rz = c.z - this.z, al = rx * dx + rz * dz, lat = Math.abs(-rx * dz + rz * dx);
        if (al > 1.5 && al < 8 && lat < 0.45) cost -= 1.6;
      }
      if (cost < bestCost) { bestCost = cost; best = ang; }
      if (k > 0) left = Math.min(left, cost); else if (k < 0) right = Math.min(right, cost);
    }
    this.best = best; this.bestCost = bestCost;
    // (chosen as you come to a limit, and kept while you're held there: one way round, not a dither)
    if (this.limitT === 0 && Math.abs(left - right) > 1) this.freer = left < right ? 1 : -1;
  }

  /** looking ahead along `dir` for something to do: the first edge up or down within a second or two */
  private pick(dir: number): Plan | null {
    const F = this.feet, dx = Math.sin(dir), dz = Math.cos(dir), S = 0.2, n = Math.ceil(Math.min(10, Math.max(3, this.v * 1.5)) / S);
    const prof = [] as { y: number; kind: Footing; stone: Stone | null }[];
    for (let i = 0; i <= n + 8; i++) prof.push(F.at(this.x + dx * i * S, this.z + dz * i * S));
    const at = (d: number) => [this.x + dx * d, this.z + dz * d] as const;
    // (a bowed culm's tip at the shins, across the way: skipped over, as a root is)
    let over = 1e9, overTop = 0;
    for (const p of this.posts) {
      const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz;
      if (al > 0.6 && al < n * S && al < over && Math.abs(-rx * dz + rz * dx) < 0.3 + p.r && meets(p) === 'over') { over = al; overTop = this.feet.groundAt(p.x, p.z) + p.hi; }
    }
    for (let i = 1; i <= n; i++) {
      if (i * S >= over) {
        const o = at(Math.max(0.1, over - 0.45 - this.v * 0.05)), l = at(over + 0.45);
        return { kind: 'skip', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly: this.feet.at(l[0], l[1]).y, clear: overTop + 0.12, next: null, wait: 0 };
      }
      const rise = prof[i].y - prof[i - 1].y;
      if (prof[i].kind === 'step' || prof[i - 1].kind === 'step') return null;
      if (rise > 0.18) {
        // (up: how high, and how much top it has)
        let top = prof[i].y, j1 = i;
        for (let j = i; j <= n + 8 && prof[j].y > prof[i - 1].y + 0.04; j++) { top = Math.max(top, prof[j].y); j1 = j; }
        let c0 = -1, c1 = i;
        for (let j = i; j <= j1; j++) if (prof[j].y > top - 0.22) { if (c0 < 0) c0 = j; c1 = j; }
        const riseTot = top - prof[i - 1].y, long = (j1 - i + 1) * S, crown = (c1 - c0 + 1) * S, d = i * S;
        if (long <= 1.1 && riseTot <= 0.5) {
          // (low and short (a root, a small stone): skipped over, from a little before it to just beyond)
          const o = at(Math.max(0.1, d - 0.4 - this.v * 0.05)), l = at(d + long + 0.35), ly = F.at(l[0], l[1]).y;
          return { kind: 'skip', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly, clear: top + 0.12, next: null, wait: 0 };
        }
        // (how high a hop up reaches: a standing one a little over a metre, a running one, at a lope, most of two)
        if (riseTot <= 1.35 + 0.12 * Math.max(0, this.v - 3) && crown >= 0.35 && prof[c0].kind === 'stone') {
          // (a broad low stone: up onto its crown)
          const o = at(Math.max(0.1, d - 0.6 - this.v * 0.2)), ld = (c0 + Math.min(c1 - c0, Math.round((0.4 + this.v * 0.08) / S))) * S, l = at(ld), lu = F.at(l[0], l[1]);
          const p: Plan = { kind: 'hop', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly: lu.y, clear: top + 0.05, next: null, wait: 0 };
          p.next = this.chainFrom(l[0], l[1], lu.y, dir, lu.stone);
          return p;
        }
        // (a face beyond a hop, up to two and a half times your height: run at it and up it, a foot or two kicked off the
        // stone, and over its top: superhuman, but a body's way of doing it, not a lift)
        if (riseTot <= 4.6 && crown >= 0.45 && prof[c0].kind === 'stone' && this.v > 2) {
          const o = at(Math.max(0.1, d - 0.5 - this.v * 0.1)), ld = (c0 + Math.min(c1 - c0, Math.round(0.5 / S))) * S, l = at(ld), lu = F.at(l[0], l[1]);
          return { kind: 'climb', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly: lu.y, clear: top + 0.35, next: null, wait: 0 };
        }
        return null;
      }
      if (rise < -0.22) {
        // (down: from a crown, a leap on to the next stone if one's in reach; else off it, a step or a leap)
        const from = prof[i - 1], o = at((i - 1) * S);
        if (from.kind === 'stone') { const c = this.chainFrom(o[0], o[1], from.y, dir, from.stone); if (c) return c; }
        let low = prof[i].y; for (let j = i; j <= Math.min(n + 8, i + 5); j++) low = Math.min(low, prof[j].y);
        const D = from.y - low;
        // (a cleft too deep to go down into, with a top across it: leapt)
        if (D > 3.2) {
          const g = this.across(o[0], o[1], dx, dz, from.y);
          if (g > 0) {
            // (onto the top it found, a little in from its edge, if that's still the same top)
            const l = at((i - 1) * S + g + 0.3), ly = F.at(l[0], l[1]).y;
            if (ly > from.y - 2.6 && ly < from.y + 0.7 && Math.abs(ly - F.at(o[0] + dx * g, o[1] + dz * g).y) < 0.35) return { kind: 'leap', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly, clear: Math.max(ly, from.y) + 0.1, next: null, wait: 0 };
          }
        }
        // (off the edge: never stopped there and lowered down a face; a drop to a dozen metres is leapt, out from the face
        // with your pace, into a roll if it's big; only if there's nowhere to come down is it no way)
        const most = 12;
        if (D < 0.4 || D > most) return null;
        // (where each would come down: the one with the clearest, flattest landing, the quicker the more of a leap)
        let bestP: Plan | null = null, bestS = -1e9;
        for (const vy of [0.5, 1.5, 2.5]) {
          const vh = D > 3.2 ? Math.max(5, this.v) : Math.max(2, this.v), land = this.arc(o[0], o[1], from.y, dx * vh, dz * vh, vy);
          if (!land || from.y - land[1] > most + 0.2 || (D < 4 && this.trapped(land[0], land[2], land[1]))) continue;
          if (D > 3.2 && (F.normalAt(land[0], land[2])[1] < 0.8 || this.cramped(land[0], land[2], dir))) continue;
          const nrm = F.normalAt(land[0], land[2]), cramp = this.cramped(land[0], land[2], dir);
          const score = nrm[1] * 3 - (cramp ? 2 : 0) - Math.abs(vy - (this.v < 3.5 || D < 0.8 ? 0.5 : 1.5 + this.v * 0.1)) * 0.8;
          if (score > bestS) { bestS = score; bestP = { kind: vy < 1 && D <= 3.2 ? 'drop' : 'leap', dir, ox: o[0], oz: o[1], lx: land[0], lz: land[2], ly: land[1], clear: 0, next: null, wait: 0 }; }
        }
        return bestP;
      }
    }
    return null;
  }
  /** how far across a cleft from (x, z) going (dx, dz) there's a top about as high as `y` to land on (within a long
   * leap), or -1 */
  private across(x: number, z: number, dx: number, dz: number, y: number) {
    // (as far as a bound at this pace reaches; onto a top about as high, or a ledge below (down to a couple of metres), level
    // enough to come down on: a way on across a cleft, or down a stepped face, not only a crack)
    const F = this.feet, reach = Math.max(2.4, Math.min(3.8, 1.6 + 0.3 * this.v));
    for (let d = 0.3; d <= reach; d += 0.15) {
      const u = F.at(x + dx * d, z + dz * d);
      if (u.y > y + 0.6) return -1;
      if (u.y > y - 2.5) { const v = F.at(x + dx * (d + 0.5), z + dz * (d + 0.5)); return Math.abs(v.y - u.y) < 0.35 ? d : -1; }
    }
    return -1;
  }
  private read(p: Plan, x: number, z: number, y: number, v: number) {
    const L = Math.hypot(p.lx - x, p.lz - z), vh0 = Math.max(p.kind === 'drop' ? 1.8 : 3.2, Math.min(LOPE * 1.1, v));
    let T = Math.max(p.kind === 'skip' ? 0.3 : 0.26, L / vh0), vy = (p.ly - y + 0.5 * G * T * T) / T;
    if (p.clear > 0) { const need = Math.sqrt(Math.max(0, 2 * G * (p.clear - y - (p.kind === 'skip' ? 0.15 : 0)))); if (vy < need) { vy = need; T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * G * (p.ly - y)))) / G; } }
    const turnBy = Math.abs(wrap(p.dir - this.move));
    // (read when chosen, and with it the footholds chained after it: they're in mind from the first)
    for (let q: Plan | null = p; q; q = q.next) q.read ??= this.clock;
    p.demand = Math.min(1.5, Math.max(0, vy) / 4 + Math.max(0, p.ly - y) * 0.45 + L * 0.08 + turnBy * 0.3);
    p.load = p.kind === 'drop' ? 0.02 : p.kind === 'skip' ? 0.025 + 0.04 * p.demand : 0.05 + 0.12 * p.demand;
    p.vh = p.kind === 'skip' ? v : L / Math.max(0.2, T);
    p.precise = !p.next && p.kind !== 'skip' && p.kind !== 'drop' && this.supportAt(p.lx, p.lz, p.ly, p.dir).runout < 1.5;
    this.aim = [p.lx, p.ly, p.lz];
  }
  /** a foot set down at (x, z): what it's on, its slope, which foot; handed out to be heard */
  private place(x: number, z: number, side: number, effort: Effort, dur: number, load: number): Contact {
    const F = this.feet, u = F.at(x, z), prev = this.contact;
    const c: Contact = { x, y: u.y, z, n: F.normalAt(x, z, 0.2), on: u.kind, side, t: this.clock, dur, load, rise: prev ? u.y - prev.y : 0, effort };
    this.contacts.push(c); if (this.contacts.length > 8) this.contacts.shift();
    this.onContact(c);
    return c;
  }
  /** a footfall in the stride: the foot set down a little ahead and to its side, on whatever's there; how it meets it by
   * how the ground goes from the last, the pace, what's coming; the body sinking onto it */
  private plant(dx: number, dz: number, _plan: Plan | null, target: number, reach = 0.12) {
    const F = this.feet, side = this.contact ? -this.contact.side : 1;
    const fx = this.x + dx * reach + dz * side * 0.1, fz = this.z + dz * reach - dx * side * 0.1, u = F.at(fx, fz);
    const rise = this.contact ? u.y - this.contact.y : 0, period = this.stride / Math.max(1, this.v);
    const grade = (F.groundAt(this.x + dx * 1.5, this.z + dz * 1.5) - F.groundAt(this.x, this.z)) / 1.5;
    let effort: Effort;
    if (rise > 0.1 || grade > 0.3) effort = 'up';
    else if (rise < -0.12 || grade < -0.3 || this.v - target > 0.8) effort = 'check';
    else if (u.kind === 'stone' && this.v > 3) effort = 'touch';
    else if (u.kind === 'ground' && !this.onTrail) effort = 'soft';
    else effort = 'plant';
    const K = { plant: [1, 1], soft: [1.15, 1.1], up: [1.35, 1.25], check: [1.25, 1.4], touch: [0.7, 0.7], push: [1.5, 1.3], land: [1, 1] }[effort];
    const dur = period * 0.36 * K[0], load = (0.6 + 0.4 * this.v / LOPE) * K[1] + Math.max(0, -rise) * 1.5 + Math.max(0, rise) * 0.8;
    this.contact = this.place(fx, fz, side, effort, dur, load);
    this.support(this.contact, dx, dz);
    // (sinking onto it: harder the harder it's met)
    this.bodyV = Math.min(this.bodyV, 0) - 0.12 * load;
    this.onStep(u.kind, 0.5 + this.v / LOPE);
  }
  /** a foot now bearing the weight: for its stance (the body sinking onto it, carried over it, rising off it), then the
   * stride's flight to where the next will come down */
  private support(c: Contact, dx: number, dz: number) {
    const period = this.stride / Math.max(1, this.v), ahead = this.v * period;
    this.stanceLeft = c.dur; this.stanceFrom = this.y; this.aerialT = Math.max(0.05, period - c.dur);
    this.nextY = this.feet.at(this.x + dx * (ahead + 0.12), this.z + dz * (ahead + 0.12)).y;
  }
  /** the move's last foot: set down where the body will be carried over it into the takeoff, met by the move's demand,
   * held for as long as it loads */
  private pushPlant(p: Plan, dx: number, dz: number, loadT: number) {
    const side = this.contact ? -this.contact.side : 1, fx = this.x + dx * 0.15 + dz * side * 0.08, fz = this.z + dz * 0.15 - dx * side * 0.08;
    this.contact = this.place(fx, fz, side, 'push', loadT, 0.9 + Math.min(1, p.demand ?? 0.5));
    this.support(this.contact, dx, dz);
    this.bodyV = Math.min(this.bodyV, 0) - 0.1 * this.contact.load;
    this.onStep(this.contact.on, 0.8 + (p.demand ?? 0.5) * 0.3);
  }
  /** the body over the stride: while a foot bears it, a stiff spring sunk by how hard it was met; at the push, up off it
   * as far as the stride's flight needs (more for a step up); in the stride's flight, falling toward the next; in a
   * jump's air, settling; the weight shifted over the foot it's on */
  private stride_(dt: number) {
    const c = this.contact;
    // (a stance's time runs whether or not you're moving: a foot loaded standing still still springs when it's done)
    if (!this.air && c && this.v < 0.6 && this.stanceLeft > 0) this.stanceLeft -= dt;
    if (this.air || !c || this.v < 0.6) { this.bodyV += (-60 * this.bodyY - 12 * this.bodyV) * dt; this.bodyY += this.bodyV * dt; this.weight *= 1 - ease(dt, 6); return; }
    const gE = 4.5;
    if (this.stanceLeft > 0) {
      this.stanceLeft -= dt;
      this.bodyV += (-280 * (this.bodyY + 0.03 * c.load) - 20 * this.bodyV) * dt;
      if (this.stanceLeft <= 0) { this.stanceEnd = this.clock; this.bodyV = gE * this.aerialT * 0.5 * (c.effort === 'up' ? 1.3 : c.effort === 'check' ? 0.8 : 1) + Math.max(0, this.nextY - c.y) * 0.4; }
    } else this.bodyV += (-gE - 8 * this.bodyY) * dt;
    this.bodyY = Math.max(-0.12, Math.min(0.08, this.bodyY + this.bodyV * dt));
    this.weight += ((this.stanceLeft > 0 ? 1 : 0.35) * c.side - this.weight) * ease(dt, 12);
  }
  /** whether a place is a trap: a ledge or a crown of rock with no way on from it (every way a face too high or a drop
   * too far), so it isn't one to drop onto */
  private trapped(x: number, z: number, y: number) {
    const F = this.feet;
    if (F.at(x, z).kind !== 'stone') return false;
    for (let a = 0; a < 8; a++) {
      const dx = Math.sin(a * 0.785), dz = Math.cos(a * 0.785);
      let ok = true;
      for (const d of [0.8, 1.6, 2.6]) { const dy = F.at(x + dx * d, z + dz * d).y - y; if (dy > 1.35 || dy < -3.2) { ok = false; break; } }
      if (ok) return false;
    }
    return true;
  }
  /** footholds on the crowns round (x, z) (stones' and the rock's): on each, its middle and points round it, each kept if
   * it's a crown (above the ground), level enough, with room to stand: how much room (0 … 4) */
  private patches(x: number, z: number, r: number) {
    const F = this.feet, out: { x: number; z: number; y: number; room: number }[] = [];
    // (the rock's pads as they are, with their room; not the one underfoot)
    for (const p of F.padsNear(x, z, r)) if (Math.hypot(p.x - x, p.z - z) > 0.6 && p.y - F.groundAt(p.x, p.z) > 0.2) out.push({ x: p.x, z: p.z, y: p.y, room: p.room });
    for (const c of F.perchesNear(x, z, r)) {
      if (Math.hypot(c.x - x, c.z - z) < c.r * 0.9) continue; // (not the one you're on)
      const pts: [number, number][] = [[c.x, c.z]];
      if (c.r > 0.45) for (let k = 0; k < 6; k++) pts.push([c.x + Math.sin(k * 1.047) * c.r * 0.5, c.z + Math.cos(k * 1.047) * c.r * 0.5]);
      for (const [px, pz] of pts) {
        const u = F.at(px, pz);
        if (u.kind !== 'stone' || u.y - F.groundAt(px, pz) < 0.2 || F.normalAt(px, pz, 0.2)[1] < 0.72) continue;
        let room = 0;
        for (const [ox, oz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) if (Math.abs(F.at(px + ox, pz + oz).y - u.y) < 0.1) room++;
        if (room >= 2) out.push({ x: px, z: pz, y: u.y, room });
      }
    }
    return out;
  }
  /** how a foothold reached from (x, y, z) going `dir` at speed v rates (lower better), or null if it can't be: how far
   * it turns you, how far it is from an easy bound, how much room it gives, how much it asks to rise or how hard it brakes */
  private rate(x: number, z: number, y: number, dir: number, v: number, f: { x: number; z: number; y: number; room: number }) {
    const rx = f.x - x, rz = f.z - z, d = Math.hypot(rx, rz), dy = f.y - y, off = Math.abs(wrap(Math.atan2(rx, rz) - dir));
    if (d < 0.9 || d > Math.min(4.4, 2.3 + 0.3 * v) || dy > 1.1 || dy < -1.6 || off > 1.05) return null;
    // (a dip between: two footholds, not one rock)
    // (a dip between, or a step: two footholds; the same level of one rock is run, not leapt)
    const mid = this.feet.at((x + f.x) / 2, (z + f.z) / 2).y;
    if (mid > Math.min(y, f.y) - 0.12) {
      // (one rock: two footholds only across a step in it (a face between), never down a slope you'd run)
      if (Math.abs(f.y - y) < 0.3 || mid > Math.max(y, f.y) - 0.1) return null;
      let step = 0, prev = y;
      for (let k = 1; k <= 6; k++) { const h = this.feet.at(x + (rx * k) / 6, z + (rz * k) / 6).y; step = Math.max(step, Math.abs(h - prev)); prev = h; }
      if (step < 0.25) return null;
    }
    // (the faster you're going, the longer the bound that's easy: a short fussy one at pace is a stutter)
    const easy = 1.8 + 0.2 * v, T = Math.max(0.26, d / Math.max(3.2, v)), brake = Math.abs(d / T - v) * 0.12;
    return off * 1.6 + Math.abs(d - easy) * 0.6 - f.room * 0.3 + Math.max(0, dy) * 0.8 + brake + (d < 1.2 && v > 4 ? 1.5 : 0);
  }
  /** the next foothold on from a crown at (x, z): of the patches on the crowns round, the one that's best reached and
   * best left (the best departure from it on to another, or onto open ground ahead) */
  private chainFrom(x: number, z: number, y: number, dir: number, _not: unknown = null, ahead = 1): Plan | null {
    const F = this.feet, v = Math.max(3.5, this.v), cands = this.contactsFrom(x, z, y, dir, v);
    // (each rated by how it's reached and how it's left: the best departure from it on to another, or onto open ground ahead)
    const scored: { f: (typeof cands)[number]; s: number; d2: number }[] = [];
    for (const f of cands) {
      const s1 = this.rate(x, z, y, dir, v, f);
      if (s1 === null) continue;
      const d2 = Math.atan2(f.x - x, f.z - z);
      let s2 = 9;
      for (const g of this.patches(f.x, f.z, 4.6)) { const r = this.rate(f.x, f.z, f.y, d2, v, g); if (r !== null) s2 = Math.min(s2, r); }
      const gx = f.x + Math.sin(d2) * 1.6, gz = f.z + Math.cos(d2) * 1.6, gd = f.y - F.at(gx, gz).y;
      if (gd > -0.3 && gd < 1.8) s2 = Math.min(s2, 1.2 + gd * 0.4);
      // (and what it gives the landing: room to run on along the way, width across it)
      const sp = this.supportAt(f.x, f.z, f.y, d2), held = -Math.min(1.5, sp.runout) * 0.25 - Math.min(0.9, sp.width) * 0.3;
      scored.push({ f, s: s1 + 0.5 * s2 + held, d2 });
    }
    scored.sort((a, b) => a.s - b.s);
    // (the best whose flight a body clears: not through a culm, nor through a lip or an overhang on the way)
    let best: Plan | null = null;
    for (const { f, d2 } of scored.slice(0, 6)) {
      if (!this.clearWay(x, z, f.x, f.z) || !this.flightClear(x, y, z, f.x, f.y, f.z, 0)) continue;
      best = { kind: f.y - y > 0.45 ? 'hop' : 'leap', dir: d2, ox: x, oz: z, lx: f.x, lz: f.z, ly: f.y, clear: 0, next: null, wait: 0.06 };
      break;
    }
    // (and the one after it, already in mind as you land)
    if (best && ahead > 0) best.next = this.chainFrom(best.lx, best.lz, best.ly, best.dir, null, ahead - 1);
    return best;
  }
  /** the contacts within a bound's reach from (x, y, z) going `dir`: the pads and crowns round, and what's found to land on
   * in a cone about your way (a level spot with room to stand), all as one list of surfaces to choose among */
  private contactsFrom(x: number, z: number, y: number, dir: number, v: number) {
    const F = this.feet, cands = this.patches(x, z, 4.6), reach = Math.min(4.4, 2.3 + 0.3 * v);
    for (const a of [0, -0.3, 0.3]) {
      const ex = Math.sin(dir + a), ez = Math.cos(dir + a);
      for (let d = 1; d <= reach; d += 0.3) {
        const px = x + ex * d, pz = z + ez * d, u = F.at(px, pz);
        if (u.kind !== 'stone' || u.y - y > 1.1 || u.y - y < -1.6 || F.normalAt(px, pz, 0.2)[1] < 0.8) continue;
        let room = 0;
        for (const [ox, oz] of [[0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]]) if (Math.abs(F.at(px + ox, pz + oz).y - u.y) < 0.1) room++;
        if (room >= 3) cands.push({ x: px, z: pz, y: u.y, room });
      }
    }
    return cands;
  }
  /** whether a body's flight from a to b clears what's there, the flight as takeoff throws it (its time from the pace,
   * raised to `top` if it must clear it): never through the rock's faces (at the shins and the chest, so a lip in the way
   * or an overhang over it refuses it), and never into a stone or a top standing higher than the feet along the way */
  private flightClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number, top: number, v = this.v) {
    const F = this.feet, L = Math.hypot(bx - ax, bz - az), vh = Math.max(3.2, Math.min(LOPE * 1.1, v));
    let T = Math.max(0.26, L / vh), vy = (by - ay + 0.5 * G * T * T) / T;
    if (top > 0) { const need = Math.sqrt(Math.max(0, 2 * G * (top - ay))); if (vy < need) { vy = need; T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * G * (by - ay)))) / G; } }
    const n = Math.max(4, Math.ceil(L / 0.4));
    const pt = (t: number, up: number): [number, number, number] => { const s = t * T; return [ax + (bx - ax) * t, ay + vy * s - 0.5 * G * s * s + up, az + (bz - az) * t]; };
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      for (const up of [0.35, 1.25]) if (F.rockBetween(pt(t0, up), pt(t1, up))) return false;
      // (the feet over what's underfoot: clear of it between takeoff and landing)
      if (k > 0 && t0 < 0.9) { const p = pt(t0, 0); if (F.at(p[0], p[2]).y > p[1] + 0.05) return false; }
    }
    return true;
  }
  /** where a leap from (x, y, z) moving (vx, vy, vz) comes down */
  private arc(x: number, z: number, y: number, vx: number, vz: number, vy: number): [number, number, number] | null {
    for (let t = 0.02; t < 2; t += 0.02) {
      const px = x + vx * t, pz = z + vz * t, py = y + vy * t - 0.5 * G * t * t, g = this.feet.at(px, pz).y;
      if (py <= g && vy - G * t < 0) return [px, g, pz];
    }
    return null;
  }
  /** no room to come out of a landing: a culm close ahead, the footing ahead rising or falling away, or on a stone */
  /** what a surface gives at (x, z) at height y, going dir: how far it runs on level along your way (to 3 m), and how wide
   * it is across it */
  supportAt(x: number, z: number, y: number, dir: number) {
    const F = this.feet, dx = Math.sin(dir), dz = Math.cos(dir);
    let runout = 0;
    for (let d = 0.15; d <= 3; d += 0.15) { if (Math.abs(F.at(x + dx * d, z + dz * d).y - y) > 0.15) break; runout = d; }
    let width = 0;
    for (const s of [-1, 1]) for (let d = 0.15; d <= 1.2; d += 0.15) { if (Math.abs(F.at(x + dz * d * s, z - dx * d * s).y - y) > 0.15) break; width += 0.15; }
    return { runout, width };
  }
  /** room to roll on into: nothing standing in the way for a couple of metres, the footing ahead near level */
  private rollRoom(x: number, z: number, dir: number) {
    const F = this.feet, dx = Math.sin(dir), dz = Math.cos(dir), y = F.at(x, z).y;
    for (const p of F.posts(x, z, 2.5)) {
      const rx = p.x - x, rz = p.z - z, al = rx * dx + rz * dz;
      if (al > -0.2 && al < 1.8 && Math.abs(-rx * dz + rz * dx) < 0.45 + p.r && meets(p) === 'block') return false;
    }
    for (const d of [0.6, 1.2, 1.8]) { const u = F.at(x + dx * d, z + dz * d); if (Math.abs(u.y - y) > 0.4) return false; }
    return true;
  }
  private cramped(x: number, z: number, dir: number) {
    const F = this.feet, dx = Math.sin(dir), dz = Math.cos(dir), y = F.at(x, z).y;
    for (const p of F.posts(x, z, 2.5)) {
      const rx = p.x - x, rz = p.z - z, al = rx * dx + rz * dz;
      if (al > -0.2 && al < 2.2 && Math.abs(-rx * dz + rz * dx) < 0.55 + p.r && meets(p) === 'block') return true;
    }
    for (const d of [0.8, 1.6, 2.6]) { const u = F.at(x + dx * d, z + dz * d); if (u.y - y > 0.25 || u.y - y < -0.7) return true; }
    // (on rock as on earth, by the room it gives: how far you can go on along it, how wide it is)
    const sp = this.supportAt(x, z, y, dir);
    return sp.runout < 0.9 || sp.width < 0.5;
  }

  private takeoff(p: Plan) {
    this.y = Math.max(this.y, this.feet.at(this.x, this.z).y - 0.05);
    // (a hop or a leap taken with more pace than its flight carries: its landing taken on along the same top, as far as
    // that pace takes it in the flight's own time, so the speed's carried over, not braked off in the air)
    if ((p.kind === 'hop' || p.kind === 'leap') && this.v > 3.4 && !p.precise) {
      const dx = Math.sin(p.dir), dz = Math.cos(p.dir), L0 = Math.hypot(p.lx - this.x, p.lz - this.z);
      const vy0 = Math.max(p.clear > 0 ? Math.sqrt(Math.max(0, 2 * G * (p.clear - this.y))) : 0, ((p.ly - this.y) + 0.5 * G * 0.3 * 0.3) / 0.3);
      const T = (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 - 2 * G * (p.ly - this.y)))) / G, Lw = Math.min(this.v * T, L0 + 2.2);
      // (along the top as it goes, uneven as rock is: a step of a hand's height either way is still the same top, if it
      // isn't steep)
      let ok = L0, prevY = p.ly;
      for (let d = L0 + 0.15; d <= Lw; d += 0.15) {
        const qx = this.x + dx * d, qz = this.z + dz * d, u = this.feet.at(qx, qz);
        if (Math.abs(u.y - prevY) > 0.12 || Math.abs(u.y - p.ly) > 0.35 || this.feet.normalAt(qx, qz)[1] < 0.8) break;
        ok = d; prevY = u.y;
      }
      if (ok > L0 + 0.1) { const back = Math.max(L0, ok - 0.35); p.lx = this.x + dx * back; p.lz = this.z + dz * back; p.ly = this.feet.at(p.lx, p.lz).y; }
    }
    // (a drop taken faster than it was read for goes further: re-aimed at the pace you really have, so the speed's
    // carried down, not braked to land where a slower step would have)
    if (p.kind === 'drop' && this.v > 3) {
      const dx = Math.sin(p.dir), dz = Math.cos(p.dir), l = this.arc(this.x, this.z, this.y, dx * this.v, dz * this.v, 0.6);
      if (l && this.y - l[1] < 3.4 && Math.abs(this.feet.normalAt(l[0], l[2])[1]) > 0.8) { p.lx = l[0]; p.lz = l[2]; p.ly = l[1]; }
    }
    // (the pace it goes at: what you're carrying, or what the move was read wanting (a chained one's, taken back up as
    // the foot it's planted on pushes))
    // (a bound pushed off a contact, still going, gives back pace as a running stride does: up to a metre a second a push,
    // to your lope; so a line of bounds gathers speed, not only spends it)
    const push = this.going && p.chained && !p.precise && (p.kind === 'leap' || p.kind === 'hop') ? Math.min(LOPE, this.v + 1) : 0;
    const L = Math.hypot(p.lx - this.x, p.lz - this.z), vh = Math.max(p.kind === 'drop' ? 1.8 : 3.2, Math.min(LOPE * 1.1, Math.max(this.v, p.vh ?? 0, push)));
    let T = Math.max(p.kind === 'skip' ? 0.3 : 0.26, L / vh), vy = (p.ly - this.y + 0.5 * G * T * T) / T;
    // (high enough to clear what's skipped or hopped onto)
    // (the feet tuck up a little over what's skipped)
    if (p.clear > 0) {
      const need = Math.sqrt(Math.max(0, 2 * G * (p.clear - this.y - (p.kind === 'skip' ? 0.15 : 0))));
      if (vy < need) {
        vy = need; T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * G * (p.ly - this.y)))) / G;
        // (a skip that has to go higher goes further too, keeping its pace; a hop keeps to its crown)
        if (p.kind === 'skip') { const k = (vh * T) / Math.max(1e-3, L); p.lx = this.x + (p.lx - this.x) * k; p.lz = this.z + (p.lz - this.z) * k; p.ly = this.feet.at(p.lx, p.lz).y; }
      }
    }
    // (nothing asks more than a body can spring: a move that would is given up where you stand)
    if (vy > (p.kind === 'climb' ? 10.5 : 6.5)) { this.plan = null; this.loading = false; this.v = Math.min(this.v, 2); return; }
    this.vx = (p.lx - this.x) / T; this.vz = (p.lz - this.z) / T; this.vy = vy; this.loading = false; this.airTurn = 0;
    this.move = Math.atan2(this.vx, this.vz);
    this.air = true; this.act = p.kind; this.aim = [p.lx, p.ly, p.lz]; this.headTake = this.heading;
    // (the release: the loaded crouch thrown off, as hard as it was loaded)
    this.crouchV -= 0.8 + 6 * Math.max(this.crouch, 0) + Math.min(1, vy * 0.2);
    // (the planted foot let go: the release of its push, not a foot of its own)
    this.bodyV = Math.max(this.bodyV, 0.4 + vy * 0.12); this.stanceLeft = 0;
    this.onAct(p.kind);
    this.prep = 1;
  }
  /** never through a culm: if one's right there, slip past it (on the ground or in the air) */
  private slip(nx: number, nz: number): [number, number] {
    const body = 0.3 - Math.abs(this.shoulder) * 0.08;
    for (let pass = 0; pass < 2; pass++) for (const p of this.posts) {
      if (meets(p, EYE + 0.16 - this.duck) !== 'block') continue;
      const ox = nx - p.x, oz = nz - p.z, d = Math.hypot(ox, oz), m = body + p.r;
      if (d < m && d > 1e-4) { nx = p.x + (ox / d) * m; nz = p.z + (oz / d) * m; }
    }
    // (pressed between two, too close to fit: no step through; you stay where you were)
    for (const p of this.posts) if (meets(p, EYE + 0.16 - this.duck) === 'block' && Math.hypot(nx - p.x, nz - p.z) < body * 0.7 + p.r) return [this.x, this.z];
    return [nx, nz];
  }
  /** whether a straight way from (ax, az) to (bx, bz) keeps clear of the culms */
  private clearWay(ax: number, az: number, bx: number, bz: number) {
    const L = Math.hypot(bx - ax, bz - az) || 1e-3, ux = (bx - ax) / L, uz = (bz - az) / L;
    for (const p of this.posts) {
      if (meets(p) !== 'block') continue;
      const rx = p.x - ax, rz = p.z - az, al = rx * ux + rz * uz;
      if (al > -0.2 && al < L + 0.3 && Math.abs(-rx * uz + rz * ux) < 0.3 + p.r) return false;
    }
    return true;
  }
  private fly(dt: number) {
    // (in the air you can still lean the flight a little toward where you're going now (a bounded turn of how you're
    // carried), so a turn made in the air shows at once and the landing's met already turning)
    // (by as much as you've turned since you left the ground, no more: a leap off your line (a chain's zig) is the body's
    // own, and isn't pulled back to it; your turning in the air is)
    const want = Math.max(-0.9 * dt, Math.min(0.9 * dt, wrap(this.heading - this.headTake) - this.airTurn));
    const turn = Math.max(-0.3 - this.airTurn, Math.min(0.3 - this.airTurn, want));
    if (Math.abs(turn) > 1e-5) {
      const c = Math.cos(turn), sn = Math.sin(turn), nvx = this.vx * c + this.vz * sn, nvz = -this.vx * sn + this.vz * c;
      // (where it'd come down, foreseen from how you'd be carried; but a flight aimed at a surface keeps to it: bent only
      // as far as it still comes down on what it was aimed at; the next is where your turn goes)
      const l = this.arc(this.x, this.z, this.y, nvx, nvz, this.vy), p = this.plan;
      const keeps = !p || (l !== null && Math.hypot(l[0] - p.lx, l[2] - p.lz) < 0.5 && Math.abs(l[1] - p.ly) < 0.2);
      if (keeps) { this.vx = nvx; this.vz = nvz; this.airTurn += turn; this.move = Math.atan2(this.vx, this.vz); if (l) this.aim = l; }
    }
    const [nx, nz] = this.slip(this.x + this.vx * dt, this.z + this.vz * dt);
    // (flying into a face well above your feet, you're stopped against it and slide down it: a top past its edge isn't
    // where you are)
    // (climbing, the face is run up: held at it, your way on kept, until you're over its top)
    if (this.feet.at(nx, nz).y > this.y + 0.35) { if (this.act !== 'climb') { this.vx *= 0.1; this.vz *= 0.1; } } else { this.x = nx; this.z = nz; }
    this.y += this.vy * dt; this.vy -= G * dt;
    const u = this.feet.at(this.x, this.z);
    // (down onto the surface; or, past where you were aiming and a hand's breadth over it, a foot reached down onto it: a
    // crown's falling side isn't skimmed over)
    const past = this.aim && (this.x - this.aim[0]) * this.vx + (this.z - this.aim[2]) * this.vz >= 0;
    if (this.vy < 0 && (this.y <= u.y || (past && this.y - u.y < 0.12))) this.land(u.y, u.kind);
  }
  private land(gy: number, on: Footing) {
    const F = this.feet, n = F.normalAt(this.x, this.z), vh = Math.hypot(this.vx, this.vz);
    // (how hard: the speed into the surface, across its slope)
    const imp = Math.max(0, -(this.vx * n[0] + this.vy * n[1] + this.vz * n[2]));
    // (and never down inside a culm's room: the landing's slipped clear of any beside it, as every step is)
    [this.x, this.z] = this.slip(this.x, this.z);
    this.y = gy; this.foot = gy; this.air = false; this.vy = 0; this.under = on; this.impact = imp; this.aim = null;
    this.v = vh; this.move = Math.atan2(this.vx, this.vz);
    let next = this.plan?.next ?? null;
    const cramped = this.cramped(this.x, this.z, this.move);
    // (the next of a chain, read again from where you really came down: its way from here, still in reach, still clear,
    // and still the way you're going now (steered off it in the air, it's let go and looked for again))
    if (next) {
      const d = Math.hypot(next.lx - this.x, next.lz - this.z);
      next.dir = Math.atan2(next.lx - this.x, next.lz - this.z);
      // (a chain may zig either side of your line; it's yours to change your mind in the air, not its to wander off it)
      const turned = Math.abs(wrap(this.heading - this.headTake)) > 0.35;
      if (turned || d < 0.6 || d > 4.6 || Math.abs(wrap(this.heading - next.dir)) > 1.05 || Math.abs(next.ly - gy) > 1.6 || !this.clearWay(this.x, this.z, next.lx, next.lz) || !this.flightClear(this.x, gy, this.z, next.lx, next.ly, next.lz, 0)) next = null;
      else { next.chained = true; next.intent = this.headTake; }
    }
    // (let go: no next, whatever was in mind; settle onto this one. Still going, but turned off the next: what's on along
    // the way you're going now, from here (a redirect))
    if (!this.going) next = null;
    else if (!next && this.plan?.next && Math.abs(wrap(this.heading - this.headTake)) > 0.35) {
      const c = this.chainFrom(this.x, this.z, gy, this.heading, null, 0);
      if (c && Math.abs(wrap(this.heading - c.dir)) < 0.6 && this.clearWay(this.x, this.z, c.lx, c.lz)) { next = c; next.chained = true; next.intent = this.heading; }
    }
    this.settle = !this.going;
    let as: Landing;
    if (next && imp < 4.5) {
      // (onto a crown with the next already in mind: planted, the weight taken and turned toward it, and away; a straight
      // run on a crisp touch, a turn or a rise a longer, deeper load)
      as = 'light'; this.crouchV += 0.5 + imp * 0.25;
      const turnBy = Math.abs(wrap(next.dir - this.move)), up = Math.max(0, next.ly - gy);
      // (a bound straight on: a brief touch; a redirect: the foot takes the weight, the turn goes with it, and the push
      // leaves on the new way)
      next.wait = Math.min(0.32, (turnBy > 0.35 ? 0.12 : 0.05) + 0.16 * turnBy + 0.06 * up + 0.012 * imp);
      this.movePlant = this.move;
      next.ox = this.x; next.oz = this.z;
      // (read at the pace you came in at; then braked for real as the foot takes the weight and turns it (the stride and
      // the eye going by what you're really doing), and taken back up by the push)
      this.read(next, this.x, this.z, gy, this.v);
      this.v *= 1 - 0.65 * Math.min(1, turnBy / 1.1);
    } else if (imp < 3.3) {
      as = 'light'; this.crouchV += 0.4 + imp * 0.3; this.v *= 0.97;
    } else if (imp > 6.5 && vh > 3.5 && this.rollRoom(this.x, this.z, this.move)) {
      // (come down hard with way on and room to go on into (on rock or earth): into a roll, not a stop)
      as = 'roll'; this.rollT = 0; this.v *= 0.9; this.crouchV += 0.6;
    } else if (cramped) {
      as = 'brace'; this.crouchV += 1.2 + imp * 0.42; this.leanV += 0.8 + imp * 0.2; this.v *= Math.max(0.4, 1 - imp * 0.09); this.recover = 0.7; this.nudge += (Math.random() < 0.5 ? -1 : 1) * 0.06;
    } else if (imp > 6.5 && vh > 4.5) {
      as = 'roll'; this.rollT = 0; this.v *= 0.9; this.crouchV += 0.6;
    } else {
      as = 'heavy'; this.crouchV += 1 + imp * 0.4; this.leanV += 0.6 + imp * 0.18; this.v *= Math.max(0.5, 1 - (imp - 2) * 0.08); this.recover = 0.5;
    }
    this.landedAs = as; this.act = 'run';
    this.plan = next && as === 'light' ? next : null;
    if (this.plan) this.aim = [this.plan.lx, this.plan.ly, this.plan.lz];
    this.prep = this.plan ? 0.6 : 0;
    // (the landing's a foot set down, the hardest: the body sinks onto it and the stride starts again from it)
    // (its stance: a chained one bears the weight until the push off it; the rest by how hard it came down)
    const dur = this.plan ? Math.max(0.05, this.plan.wait) : 0.08 + 0.03 * Math.min(4, imp);
    this.contact = this.place(this.x, this.z, this.contact ? -this.contact.side : 1, 'land', dur, 0.8 + imp * 0.25);
    this.stride = Math.max(1.5, this.stride);
    this.support(this.contact, Math.sin(this.move), Math.cos(this.move));
    if (this.plan) this.plan.planted = this.clock;
    this.bodyV = Math.min(this.bodyV, 0) - 0.05 * Math.min(6, imp);
    this.onLand(on, imp, as);
    this.phase = Math.floor(this.phase) + 0.02;
    this.think = 0;
  }
}
