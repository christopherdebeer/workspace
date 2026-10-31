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
export type Act = 'run' | 'skip' | 'hop' | 'leap' | 'drop' | 'fall';
export type Landing = 'light' | 'heavy' | 'brace' | 'roll';
interface Plan {
  kind: Exclude<Act, 'run' | 'fall'>; dir: number; ox: number; oz: number; lx: number; lz: number; ly: number; clear: number; next: Plan | null; wait: number;
  /** read when (the landing seen while still approaching); how much it asks (0 a skip … 1.5 a long rising leap); how far
   * the last plant sinks for it; the speed it wants at takeoff (the approach slows or presses on to meet it) */
  read?: number; demand?: number; load?: number; vh?: number;
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
  private loading = false; private stanceLeft = 0; private stanceEnd = 0; private aerialT = 0.2; private nextY = 0; private barred = 0; private held = false; private acc = 0; private foot = 0; private think = 0; private best = 0; private bestCost = 0; private stride = 2.2; private posts: Post[] = []; private brushed = new Set<object>();
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
    const F = this.feet;
    this.clock += dt;
    // (a trail you're on, running more or less along it, carries you: it turns you with it until you turn off it)
    const q = this.world.trailNear(this.x, this.z);
    this.onTrail = false;
    if (q.trail && q.d < HALF * 1.6) {
      const tr = q.trail, i = Math.min(tr.x.length - 2, q.i), dir = Math.atan2(tr.x[i + 1] - tr.x[i], tr.z[i + 1] - tr.z[i]);
      const along = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI), off = wrap(along - this.heading);
      if (Math.abs(off) < 0.6) { this.onTrail = true; this.heading += off * ease(dt, 2.2); }
    }
    const onStair = this.world.tread(this.x, this.z) !== null;
    // (a few times a second: the weave, and a move picked if there's one to make)
    this.think -= dt;
    if (this.think <= 0 && !this.air) {
      this.think = 0.08;
      this.posts = F.posts(this.x, this.z, 10);
      this.weave(q, go);
      // (a move you've committed to is given up only if you turn well off its way before the takeoff)
      if (this.plan && Math.abs(wrap(this.heading - this.plan.dir)) > 0.95) this.plan = null;
      if (!this.plan && !onStair && (this.v > 1.2 || this.held)) {
        const p = this.pick(this.best);
        this.plan = p && this.clearWay(this.x, this.z, p.lx, p.lz) && (!p.next || this.clearWay(p.lx, p.lz, p.next.lx, p.next.lz)) ? p : null;
        if (this.plan?.next && !this.clearWay(this.plan.lx, this.plan.lz, this.plan.next.lx, this.plan.next.lz)) this.plan.next = null;
        if (this.plan) this.read(this.plan, this.plan.ox, this.plan.oz, this.y, this.v);
      }
    }
    const plan = this.plan;
    const dirNow = plan && !this.air ? Math.atan2(plan.ox - this.x, plan.oz - this.z) : this.best;
    if (!this.air) this.move += wrap((plan ? (Math.hypot(plan.ox - this.x, plan.oz - this.z) > 0.25 ? dirNow : plan.dir) : this.best) - this.move) * ease(dt, plan ? 10 : 6);
    // (turned aside by a rim, you go on that way: the heading follows)
    if (Math.abs(wrap(this.best - this.heading)) > 0.6 && this.bestCost < 60) this.heading += wrap(this.best - this.heading) * ease(dt, 1.5);
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
    const grade = this.air ? 0 : (F.groundAt(this.x + dx * 2, this.z + dz * 2) - F.groundAt(this.x, this.z)) / 2;
    let target = go ? LOPE * (1 - Math.min(0.6, Math.max(0, grade)) * 0.9) * (1 + Math.min(0.35, Math.max(0, -grade)) * 0.5) * (this.onTrail ? 1.08 : 1) : 0;
    this.stopped = this.bestCost >= 60 && !plan;
    this.barred = this.stopped ? this.barred + dt : 0;
    if (this.stopped) target = 0;
    else if (this.bestCost > 14) target *= 0.75;
    target *= 1 - this.duck * 0.45 - Math.abs(this.shoulder) * 0.2 - (this.recover > 0 ? 0.25 : 0);
    // (a move's approach: the pace it wants at the takeoff, eased toward over the last steps, slowing for a short high
    // one, pressing on for a long one; a hop up wants a little way on)
    if (plan && plan.kind !== 'drop' && go) {
      const want = Math.max(3.4, Math.min(LOPE * 1.12, plan.vh ?? target));
      target = this.prep > 0.2 ? want : Math.max(target, 3.4);
    }
    if (!this.air && this.rollT < 0) this.v += (target - this.v) * ease(dt, target > this.v ? 2.2 : 3);
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
        const loadFrom = Math.max(0.35, this.v * (0.12 + 0.1 * (plan.demand ?? 0.5)));
        this.loading = plan.kind !== 'drop' && (toGo < loadFrom || plan.wait > 0);
        if (this.loading) { this.crouch += ((plan.load ?? 0.1) - this.crouch) * ease(dt, 16); this.crouchV = 0; }
        if (toGo <= this.v * dt + 0.02 && plan.wait <= 0) { this.takeoff(plan); return; }
      } else { this.prep = Math.max(0, this.prep - dt * 4); this.loading = false; }
      // (planted on a crown before going on from it: the body pivots over the foot, hardly carried on)
      const carry = plan && plan.wait > 0 && Math.hypot(plan.ox - this.x, plan.oz - this.z) < 0.7 ? 0.35 : 1;
      const [sx, sz] = this.slip(this.x + dx * this.v * dt * carry, this.z + dz * this.v * dt * carry);
      // (and never over a drop too far to take: held at the rim, unless it's where a leap's to be taken from)
      // (held there, you look for a way from where you stand: across, or down another way)
      this.held = F.at(sx + dx * 0.3, sz + dz * 0.3).y < here - 3.2 && !(plan && plan.kind === 'leap' && Math.hypot(plan.ox - sx, plan.oz - sz) < 0.5);
      if (this.held) this.v = 0;
      else { this.x = sx; this.z = sz; }
      // (the footing: follow it; over an edge with nothing planned, off it, and down)
      const u = F.at(this.x, this.z);
      this.under = u.kind;
      // (an edge is the footing falling away at once, not a steep slope run down; off one unlooked-for, you step down
      // off it, checking your speed, rather than sail out over what's below)
      const edge = u.y < this.foot - 0.3 && u.y < here - 0.45;
      this.foot = u.y;
      if (edge && this.v > 1.5 && u.kind !== 'step' && !onStair) {
        this.air = true; this.act = 'fall'; this.vy = 0.3; this.vx = dx * Math.min(this.v, 2.8); this.vz = dz * Math.min(this.v, 2.8); this.aim = null; this.onAct('fall');
      } else if (onStair || this.v < 1.5 || !this.contact || this.rollT >= 0) this.y += (u.y - this.y) * ease(dt, onStair ? 14 : u.y < this.y ? 30 : u.kind === 'stone' ? 18 : 12);
      else {
        // (the body's height goes from foot to foot: held at the one bearing it, then carried over to where the next will
        // come down, so a raised stone lifts you at the step onto it, not before; never into the ground)
        const c = this.contact;
        let want = c.y;
        if (this.stanceLeft <= 0) { const k = Math.min(1, (this.clock - this.stanceEnd) / Math.max(0.05, this.aerialT)); want = c.y + (this.nextY - c.y) * k * k * (3 - 2 * k); }
        want = Math.max(want, u.y - 0.03);
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
      if (Math.floor(this.phase) !== Math.floor(before) && this.v > 0.6) this.plant(dx, dz, plan, target);
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
    let best = this.heading, bestCost = 1e9;
    // (looking wider when the way ahead's barred: a rim or a face turns you along it; a dead end (a crown of rock with
    // a drop all round in front) turns you back the way you came)
    for (let a = -5; a <= 5 || (bestCost >= 60 && a <= 54); a++) {
      const k = a <= 5 ? a : (a % 2 ? 1 : -1) * (6 + Math.floor((a - 6) / 2));
      const ang = this.heading + k * 0.11, dx = Math.sin(ang), dz = Math.cos(ang);
      let cost = Math.abs(k) * 0.5;
      if (pull) cost += Math.min(6, this.world.trailNear(this.x + dx * 6, this.z + dz * 6).d) * 0.45;
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
        else if (d === 1.4 && rise > 0.9 && !this.onTrail) cost += 60;
        // (a drop too far, close in: a rim, or a cleft, unless there's a top across it to leap to)
        if (d <= 1.4 && rise < (this.barred > 2 ? -7 : -3.2) && this.across(this.x + dx * d, this.z + dz * d, dx, dz, here) < 0) { cost += 60; break; }
      }
      for (const c of crowns) {
        const rx = c.x - this.x, rz = c.z - this.z, al = rx * dx + rz * dz, lat = Math.abs(-rx * dz + rz * dx);
        if (al > 1.5 && al < 8 && lat < 0.45) cost -= 1.6;
      }
      if (cost < bestCost) { bestCost = cost; best = ang; }
    }
    this.best = best; this.bestCost = bestCost;
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
        if (riseTot <= 1.35 && crown >= 0.35 && prof[c0].kind === 'stone') {
          // (a broad low stone: up onto its crown)
          const o = at(Math.max(0.1, d - 0.6 - this.v * 0.06)), ld = (c0 + Math.min(c1 - c0, Math.round(0.5 / S))) * S, l = at(ld), lu = F.at(l[0], l[1]);
          const p: Plan = { kind: 'hop', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly: lu.y, clear: top + 0.05, next: null, wait: 0 };
          p.next = this.chainFrom(l[0], l[1], lu.y, dir, lu.stone);
          return p;
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
          if (g > 0) { const l = at((i - 1) * S + g + 0.3), ly = F.at(l[0], l[1]).y; return { kind: 'leap', dir, ox: o[0], oz: o[1], lx: l[0], lz: l[1], ly, clear: Math.max(ly, from.y) + 0.1, next: null, wait: 0 }; }
        }
        // (no further than you'd jump; or, held up a while with no other way, lowering yourself down a face as far as
        // you'd dare)
        const most = this.barred > 2 ? 7 : 3.2;
        if (D < 0.4 || D > most) return null;
        // (where each would come down: the one with the clearest, flattest landing, the quicker the more of a leap)
        let bestP: Plan | null = null, bestS = -1e9;
        for (const vy of [0.5, 1.5, 2.5]) {
          const vh = Math.max(2, this.v), land = this.arc(o[0], o[1], from.y, dx * vh, dz * vh, vy);
          if (!land || from.y - land[1] > most + 0.2 || (most < 4 && this.trapped(land[0], land[2], land[1]))) continue;
          const nrm = F.normalAt(land[0], land[2]), cramp = this.cramped(land[0], land[2], dir);
          const score = nrm[1] * 3 - (cramp ? 2 : 0) - Math.abs(vy - (this.v < 3.5 || D < 0.8 ? 0.5 : 1.5 + this.v * 0.1)) * 0.8;
          if (score > bestS) { bestS = score; bestP = { kind: vy < 1 ? 'drop' : 'leap', dir, ox: o[0], oz: o[1], lx: land[0], lz: land[2], ly: land[1], clear: 0, next: null, wait: 0 }; }
        }
        return bestP;
      }
    }
    return null;
  }
  /** how far across a cleft from (x, z) going (dx, dz) there's a top about as high as `y` to land on (within a long
   * leap), or -1 */
  private across(x: number, z: number, dx: number, dz: number, y: number) {
    const F = this.feet;
    for (let d = 0.3; d <= 2.4; d += 0.15) {
      const u = F.at(x + dx * d, z + dz * d);
      if (u.y > y + 0.6) return -1;
      if (u.y > y - 0.7) { const v = F.at(x + dx * (d + 0.5), z + dz * (d + 0.5)); return v.y > y - 0.8 ? d : -1; }
    }
    return -1;
  }
  /** a move read as it's chosen: how much it asks, how deep the last plant loads for it, the pace it wants at takeoff
   * (worked out as the takeoff will: the flight's time from the distance at this pace, longer if it must go higher) */
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
  private plant(dx: number, dz: number, plan: Plan | null, target: number) {
    const F = this.feet, side = this.contact ? -this.contact.side : 1;
    const fx = this.x + dx * 0.12 + dz * side * 0.1, fz = this.z + dz * 0.12 - dx * side * 0.1, u = F.at(fx, fz);
    const rise = this.contact ? u.y - this.contact.y : 0, period = this.stride / Math.max(1, this.v);
    const toGo = plan ? (plan.ox - this.x) * Math.sin(plan.dir) + (plan.oz - this.z) * Math.cos(plan.dir) : 1e9;
    const grade = (F.groundAt(this.x + dx * 1.5, this.z + dz * 1.5) - F.groundAt(this.x, this.z)) / 1.5;
    let effort: Effort;
    if (plan && plan.kind !== 'drop' && toGo < this.stride * 1.05) effort = 'push';
    else if (rise > 0.1 || grade > 0.3) effort = 'up';
    else if (rise < -0.12 || grade < -0.3 || this.v - target > 0.8) effort = 'check';
    else if (u.kind === 'stone' && this.v > 3) effort = 'touch';
    else if (u.kind === 'ground' && !this.onTrail) effort = 'soft';
    else effort = 'plant';
    const K = { plant: [1, 1], soft: [1.15, 1.1], up: [1.35, 1.25], check: [1.25, 1.4], touch: [0.7, 0.7], push: [1.5, 1.3], land: [1, 1] }[effort];
    const dur = period * 0.36 * K[0], load = (0.6 + 0.4 * this.v / LOPE) * K[1] + Math.max(0, -rise) * 1.5 + Math.max(0, rise) * 0.8;
    this.contact = this.place(fx, fz, side, effort, dur, load);
    this.stanceLeft = dur; this.aerialT = Math.max(0.05, period - dur);
    // (where the next foot will come down, so the body's carried over to it)
    const ahead = this.v * period;
    this.nextY = F.at(this.x + dx * (ahead + 0.12), this.z + dz * (ahead + 0.12)).y;
    // (sinking onto it: harder the harder it's met)
    this.bodyV = Math.min(this.bodyV, 0) - 0.12 * load;
    this.onStep(u.kind, 0.5 + this.v / LOPE);
  }
  /** the body over the stride: while a foot bears it, a stiff spring sunk by how hard it was met; at the push, up off it
   * as far as the stride's flight needs (more for a step up); in the stride's flight, falling toward the next; in a
   * jump's air, settling; the weight shifted over the foot it's on */
  private stride_(dt: number) {
    const c = this.contact;
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
    if (this.feet.at((x + f.x) / 2, (z + f.z) / 2).y > Math.min(y, f.y) - 0.12) return null;
    const easy = 1.6 + 0.12 * v, T = Math.max(0.26, d / Math.max(3.2, v)), brake = Math.abs(d / T - v) * 0.12;
    return off * 1.6 + Math.abs(d - easy) * 0.6 - f.room * 0.3 + Math.max(0, dy) * 0.8 + brake;
  }
  /** the next foothold on from a crown at (x, z): of the patches on the crowns round, the one that's best reached and
   * best left (the best departure from it on to another, or onto open ground ahead) */
  private chainFrom(x: number, z: number, y: number, dir: number, _not: unknown = null, ahead = 1): Plan | null {
    const F = this.feet, v = Math.max(3.5, this.v), cands = this.patches(x, z, 4.6);
    let best: Plan | null = null, bestS = 1e9;
    for (const f of cands) {
      const s1 = this.rate(x, z, y, dir, v, f);
      if (s1 === null) continue;
      const d2 = Math.atan2(f.x - x, f.z - z);
      // (and how it sets up what's after: the best foothold on from it, or the ground ahead clear and not far below)
      let s2 = 9;
      for (const g of this.patches(f.x, f.z, 4.6)) { const r = this.rate(f.x, f.z, f.y, d2, v, g); if (r !== null) s2 = Math.min(s2, r); }
      const gx = f.x + Math.sin(d2) * 1.6, gz = f.z + Math.cos(d2) * 1.6, gd = f.y - F.at(gx, gz).y;
      if (gd > -0.3 && gd < 1.8) s2 = Math.min(s2, 1.2 + gd * 0.4);
      const sc = s1 + 0.5 * s2;
      if (sc < bestS) { bestS = sc; best = { kind: f.y - y > 0.45 ? 'hop' : 'leap', dir: d2, ox: x, oz: z, lx: f.x, lz: f.z, ly: f.y, clear: 0, next: null, wait: 0.06 }; }
    }
    // (and the one after it, already in mind as you land)
    if (best && ahead > 0) best.next = this.chainFrom(best.lx, best.lz, best.ly, best.dir, null, ahead - 1);
    return best;
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
  private cramped(x: number, z: number, dir: number) {
    const F = this.feet, dx = Math.sin(dir), dz = Math.cos(dir), y = F.at(x, z).y;
    for (const p of F.posts(x, z, 2.5)) {
      const rx = p.x - x, rz = p.z - z, al = rx * dx + rz * dz;
      if (al > -0.2 && al < 2.2 && Math.abs(-rx * dz + rz * dx) < 0.55 + p.r && meets(p) === 'block') return true;
    }
    for (const d of [0.8, 1.6, 2.6]) { const u = F.at(x + dx * d, z + dz * d); if (u.y - y > 0.25 || u.y - y < -0.7) return true; }
    return F.at(x, z).kind === 'stone';
  }

  private takeoff(p: Plan) {
    this.y = Math.max(this.y, this.feet.at(this.x, this.z).y - 0.05);
    const L = Math.hypot(p.lx - this.x, p.lz - this.z), vh = Math.max(p.kind === 'drop' ? 1.8 : 3.2, Math.min(LOPE * 1.1, this.v));
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
    this.vx = (p.lx - this.x) / T; this.vz = (p.lz - this.z) / T; this.vy = vy; this.loading = false;
    this.move = Math.atan2(this.vx, this.vz);
    this.air = true; this.act = p.kind; this.aim = [p.lx, p.ly, p.lz];
    // (the release: the loaded crouch thrown off, as hard as it was loaded)
    this.crouchV -= 0.8 + 6 * Math.max(this.crouch, 0) + Math.min(1, vy * 0.2);
    this.bodyV = Math.max(this.bodyV, 0.4 + vy * 0.12); this.stanceLeft = 0;
    this.contact = this.place(this.x, this.z, this.contact ? -this.contact.side : 1, 'push', 0.08, 0.9 + Math.min(1, (p.demand ?? 0.5)));
    this.onStep(this.under, 0.8 + vy * 0.15); this.onAct(p.kind);
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
    [this.x, this.z] = this.slip(this.x + this.vx * dt, this.z + this.vz * dt); this.y += this.vy * dt; this.vy -= G * dt;
    const u = this.feet.at(this.x, this.z);
    if (this.y <= u.y && this.vy < 0) this.land(u.y, u.kind);
  }
  private land(gy: number, on: Footing) {
    const F = this.feet, n = F.normalAt(this.x, this.z), vh = Math.hypot(this.vx, this.vz);
    // (how hard: the speed into the surface, across its slope)
    const imp = Math.max(0, -(this.vx * n[0] + this.vy * n[1] + this.vz * n[2]));
    this.y = gy; this.foot = gy; this.air = false; this.vy = 0; this.under = on; this.impact = imp; this.aim = null;
    this.v = vh; this.move = Math.atan2(this.vx, this.vz);
    const next = this.plan?.next ?? null, cramped = this.cramped(this.x, this.z, this.move);
    let as: Landing;
    if (next && imp < 4.5) {
      // (onto a crown with the next already in mind: planted, the weight taken and turned toward it, and away; a straight
      // run on a crisp touch, a turn or a rise a longer, deeper load)
      as = 'light'; this.crouchV += 0.5 + imp * 0.25;
      const turnBy = Math.abs(wrap(next.dir - this.move)), up = Math.max(0, next.ly - gy);
      next.wait = Math.min(0.3, 0.05 + 0.16 * turnBy + 0.06 * up + 0.012 * imp);
      next.ox = this.x; next.oz = this.z;
      this.v *= 1 - 0.25 * Math.min(1, turnBy);
      this.read(next, this.x, this.z, gy, this.v);
    } else if (imp < 3.3) {
      as = 'light'; this.crouchV += 0.4 + imp * 0.3; this.v *= 0.97;
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
    this.contact = this.place(this.x, this.z, this.contact ? -this.contact.side : 1, 'land', 0.08 + 0.03 * Math.min(4, imp), 0.8 + imp * 0.25);
    this.bodyV = Math.min(this.bodyV, 0) - 0.05 * Math.min(6, imp);
    this.onLand(on, imp, as);
    this.phase = Math.floor(this.phase) + 0.02;
    this.think = 0;
  }
}
