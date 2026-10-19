/**
 * The cats: residents of what's built. They show how a place can be lived in: a warm ledge becomes a bed, a coping a
 * way to balance along, a court somewhere to play, an arch a shortcut.
 *
 * - **Who**: each a little individual that stays: a name, a coat, how it's inclined (to the sun, to height, to
 *   shelter, to play; how curious, how bold, how sleepy), its favourite places, found by resting in them. Who the nth
 *   to come is follows from the world's seed, so it's the same cat every visit.
 * - **How many**: as many as what's built is home for (perches.ts: habitable place, not stone). When there's room for
 *   another, one arrives, walking in from the edge of the land; when there's less, the newest leaves.
 * - **How they live**: mostly resting or quietly watching; now and then one wanders, explores, grooms; sometimes two
 *   play, a crouch, a short chase, then both sit and wash. Where to rest is chosen as each is inclined: sun, height,
 *   shelter, a view out, a favourite. One cat to a coping, a ledge or a resting place (reservations), so none overlap.
 * - **How they move**: along the perch graph: walking (the feet in a cat's order), up stairs, along copings; a jump is
 *   approached, weighed (assess), gathered for (the haunches drop), reached across, landed forepaws first. Inside a
 *   building they go unseen from door to door, taking the time it would.
 * - **What building does to them**: stone going up nearby, they look; close by, they get up and move aside, then,
 *   when it's settled, the curious go to see, sniff it, and may claim it as a new place to rest. Stone rising under a
 *   cat lifts it; stone taken from under one, it jumps clear. They never fall, and never stand in the hand's way.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { CENTER, DIRS, unkey, type World } from './model';
import { inStone } from './mesh';
import { surfaceY } from './land';
import { perches, route, reachable, stairY, type Link, type Perches, type Spot } from './perches';
import { POSES, S, cat as body, gait, look, mix, type Out, type Pose, type PoseName } from './catbody';

const NAMES = ['Miso', 'Fig', 'Pepper', 'Olive', 'Biscuit', 'Sesame', 'Juniper', 'Quince', 'Marlo', 'Tansy', 'Clove', 'Saffron', 'Nutmeg', 'Pip', 'Mabel', 'Ottoline', 'Basil', 'Moth', 'Saba', 'Dune', 'Rumi', 'Teasel'];
/** the coats (render.ts draws them): ginger tabby, grey, cream, brown tabby, black, ginger and white, silver tabby,
 * black and white */
export const COATS = ['ginger tabby', 'grey', 'cream', 'brown tabby', 'black', 'ginger and white', 'silver tabby', 'black and white'];
/** how fast they go (room units a second): walking, trotting, running */
const WALK = 0.34, TROT = 0.6, RUN = 1.0;

type Task = Generator<void, boolean | void, void>;
export interface Likes { sun: number; high: number; shelter: number; play: number; curious: number; bold: number; sleepy: number }
export interface Cat {
  n: number; name: string; coat: number; tone: number; likes: Likes;
  /** how well it knows each place (by name): its favourites */
  fav: Map<string, number>;
  x: number; y: number; z: number; yaw: number; pitch: number;
  /** where it is (or last was), where it's going next, where it means to rest (place names, kept across rebuilds) */
  at: string; next: string; resting: string;
  pose: Pose; want: PoseName; rate: number; moving: number; phase: number; stride: number;
  head: { yaw: number; pitch: number }; gaze: { x: number; y: number; z: number; until: number } | null;
  stir: { t: number; breath: number; twitch: number; flick: number };
  hidden: boolean; air: boolean; asleep: boolean; awake: boolean;
  /** what it's doing, said plainly */
  doing: string;
  task: Task | null; epoch: number; rng: Rand;
  /** something new nearby to go and see (cells, from when) */
  interest: { cells: Array<[number, number, number]>; at: number } | null;
  leaving: boolean; gone: boolean; play: number;
}
export interface Memory { arrived: number; fav: Array<Array<[string, number]>> }

const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const X = (i: number) => i - CENTER + 0.5, Z = (j: number) => j - CENTER + 0.5;

export class Cats {
  list: Cat[] = [];
  P: Perches | null = null;
  w: World | null = null;
  t = 0;
  /** `settled`: residents placed where they'd be, resting, rather than arriving (a world opened, not built) */
  settled = true;
  private v = -1; private built = -1e9; private stale = false; private epoch = 0;
  private stone = new Set<number>(); private arrived = 0; private nextArrival = 0; private rng: Rand;
  private memory: Memory | null = null;
  constructor(public seed: number) { this.rng = seeded(hash(seed, 4242)); }

  /** who's been here and where they like to be, to keep between visits */
  remembered(): Memory { return { arrived: this.arrived, fav: this.list.map((c) => [...c.fav].sort((a, b) => b[1] - a[1]).slice(0, 8)) }; }
  remember(m: Memory | null) { this.memory = m; }

  /** a step of their lives: `busy` while a hand is building (they're worked out again only now and then, then) */
  update(w: World, dt: number, busy = false) {
    this.t += dt;
    if (w !== this.w) this.begin(w);
    const P = this.P!;
    if (w.version !== this.v) this.changed(w);
    if (this.stale && (!busy || this.t - this.built > 0.9)) this.rebuild();
    // (how many it's home for: one more arrives now and then while there's room; the newest leaves if there isn't)
    const here = this.list.filter((c) => !c.leaving);
    if (here.length < P.capacity && this.t >= this.nextArrival) { this.arrive(this.arrived, false); this.nextArrival = this.t + 7 + this.rng() * 9; }
    else if (here.length > P.capacity) { const c = here[here.length - 1]; c.leaving = true; this.start(c, this.leave(c)); }
    for (const c of this.list) this.live(c, dt);
    this.list = this.list.filter((c) => !c.gone);
  }
  /** run the world on, unseen, `seconds` (for a picture) */
  run(w: World, seconds: number, dt = 0.1) { for (let t = 0; t < seconds; t += dt) this.update(w, dt); }

  /** a new world (or the first): the residents it's home for, where they'd be */
  private begin(w: World) {
    this.seed = hash(w.landSeed || 0, w.seed); this.rng = seeded(hash(this.seed, 4242));
    this.w = w; this.P = perches(w); this.v = w.version; this.built = this.t; this.stale = false; this.epoch++;
    this.stone = this.solidSet(w);
    this.list = []; this.arrived = 0;
    const want = this.P.capacity;
    for (let n = 0; n < want; n++) this.arrive(n, this.settled);
    this.arrived = Math.max(this.arrived, want);
    this.nextArrival = this.t + 5;
  }
  private solidSet(w: World) { return new Set<number>([...w.mass.keys(), ...w.stairs.keys()]); }
  /** what the hand changed: where, so they can look, move aside, and later go and see */
  private changed(w: World) {
    const now = this.solidSet(w), cells: Array<[number, number, number]> = [];
    for (const v of now) if (!this.stone.has(v)) cells.push(unkey(v));
    for (const v of this.stone) if (!now.has(v)) cells.push(unkey(v));
    this.stone = now; this.v = w.version; this.stale = true;
    if (cells.length && cells.length < 400) this.disturb(cells);
  }
  private rebuild() {
    const w = this.w!;
    this.P = perches(w); this.built = this.t; this.stale = false; this.epoch++;
    for (const c of this.list) {
      if (c.gone) continue;
      const s = this.place(c.at), near = s && Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) < 0.3;
      // (resting where it still can: it stays; anything else is thought again from where it is)
      if (near && c.resting === c.at && !c.air && !c.hidden) continue;
      if (c.air) continue;
      this.start(c, this.retreat(c));
    }
  }
  place(name: string): Spot | null { const id = this.P?.byName.get(name); return id === undefined ? null : this.P!.spots[id]; }

  // ─── who ───
  private arrive(n: number, settled: boolean) {
    const P = this.P!, h = (q: number) => (hash(this.seed, n, q) % 10000) / 10000;
    const fav = new Map<string, number>(this.memory?.fav[n] ?? []);
    const c: Cat = {
      n, name: NAMES[hash(this.seed, n, 1) % NAMES.length], coat: hash(this.seed, n, 2) % COATS.length, tone: h(3),
      likes: { sun: 0.3 + 0.7 * h(4), high: h(5), shelter: h(6), play: h(7), curious: 0.2 + 0.8 * h(8), bold: h(9), sleepy: h(10) },
      fav, x: 0, y: 0, z: 0, yaw: h(11) * 6.28, pitch: 0, at: '', next: '', resting: '',
      pose: POSES.stand, want: 'stand', rate: 6, moving: 0, phase: 0, stride: 0.3,
      head: { yaw: 0, pitch: 0 }, gaze: null, stir: { t: h(12) * 100, breath: h(13), twitch: 0, flick: 0 },
      hidden: false, air: false, asleep: false, awake: true, doing: '', task: null, epoch: this.epoch, rng: seeded(hash(this.seed, n, 99)), interest: null, leaving: false, gone: false, play: 0,
    };
    // (no two the same name)
    while (this.list.some((o) => o.name === c.name)) c.name = NAMES[(NAMES.indexOf(c.name) + 1) % NAMES.length];
    if (settled) {
      const s = this.chooseRest(c, null);
      if (!s) return;
      Object.assign(c, { x: s.x, y: s.y, z: s.z, at: s.name, resting: s.name });
      this.list.push(c);
      this.start(c, this.settle(c, s, true));
    } else {
      // (in from the edge of the land, the nearest way to somewhere it would like)
      const door = this.door(c);
      if (!door) return;
      Object.assign(c, { x: door.x, y: door.y, z: door.z, at: door.name, doing: 'arriving' });
      const e = this.w!.extent(), cx = (e.i0 + e.i1 + 1) / 2 - CENTER, cz = (e.j0 + e.j1 + 1) / 2 - CENTER;
      c.yaw = Math.atan2(cz - door.z, cx - door.x);
      this.list.push(c);
      this.start(c, this.life(c, true));
    }
    this.arrived = Math.max(this.arrived, n + 1);
  }
  /** where one comes in from (or goes out by): the edge of what's there, on the ground, and reaching in */
  private door(c: Cat): Spot | null {
    const P = this.P!, e = this.w!.extent();
    const edge = P.spots.filter((s) => s.ground && (s.i === e.i0 || s.i === e.i1 || s.j === e.j0 || s.j === e.j1));
    if (!edge.length) return null;
    const goal = this.chooseRest(c, null);
    if (!goal) return edge[Math.floor(c.rng() * edge.length)];
    const d = reachable(P, goal.id);
    let best: Spot | null = null;
    for (const s of edge) if (isFinite(d[s.id]) && (!best || d[s.id] + c.rng() * 3 < d[best.id])) best = s;
    return best;
  }

  // ─── choosing ───
  private taken(s: Spot, c: Cat) { return this.list.some((o) => o !== c && !o.gone && (o.resting === s.name || (s.narrow && (o.at === s.name || o.next === s.name)))); }
  private chooseRest(c: Cat, from: Spot | null, near?: (s: Spot) => number): Spot | null {
    const P = this.P!, d = from ? reachable(P, from.id) : null;
    let best: Spot | null = null, bs = -Infinity;
    for (const s of P.spots) {
      if (!s.rest || this.taken(s, c) || (d && !isFinite(d[s.id]))) continue;
      const L = c.likes, f = Math.min(2, c.fav.get(s.name) ?? 0);
      let v = 1.3 * L.sun * s.sun + 1.2 * L.high * Math.min(3, s.high) / 3 + 1.1 * L.shelter * s.shelter + 0.3 * s.out * (0.3 + L.high)
        + (s.water ? 0.2 : 0) + (s.court ? 0.35 : 0) + (s.ground && !s.court ? -0.9 : 0) + 0.6 * f
        + (s.kind === 'ledge' ? 0.2 : s.kind === 'rail' ? 0.12 * L.bold - 0.1 : s.kind === 'coping' ? 0.12 * L.bold : 0) + c.rng() * 0.7;
      if (d) v -= d[s.id] * 0.05;
      if (near) v += near(s);
      if (v > bs) { bs = v; best = s; }
    }
    return best;
  }

  // ─── living ───
  private start(c: Cat, task: Task) { c.task = task; c.epoch = this.epoch; }
  private live(c: Cat, dt: number) {
    c.stir.t += dt;
    c.stir.breath += dt / (c.asleep ? 3.4 : c.moving > 0.5 ? 0.9 : 2.2);
    c.stir.twitch = Math.max(0, c.stir.twitch - dt * 1.4); c.stir.flick = Math.max(0, c.stir.flick - dt * 3);
    if (c.rng() < dt * (c.asleep ? 0.04 : 0.12)) c.stir.twitch = 1;
    if (c.rng() < dt * 0.08) c.stir.flick = 1;
    this.hold(c, dt);
    this.dt = dt;
    if (!c.task) this.start(c, this.life(c, false));
    const r = c.task!.next();
    if (r.done) c.task = null;
    // (its pose: toward what it wants, walking if it's moving)
    let target: Pose = POSES[c.want];
    if (c.moving > 0.02 && (c.want === 'walk' || c.want === 'stand')) target = gait(c.moving > 0.7 ? mix(POSES.walk, POSES.gather, 0.25) : POSES.walk, c.phase, c.stride, c.moving > 0.7 ? 0.1 : 0.07);
    if (c.want === 'groom') { const b = Math.sin(c.stir.t * 7); target = { ...target, hp: target.hp + 0.12 * b, f: [target.f[0], target.f[1], [target.f[2][0], target.f[2][1] + 0.03 * b, target.f[2][2]], target.f[3]] }; }
    if (c.want === 'gather' && !c.air) target = { ...target, hy: target.hy + 0.15 * Math.sin(c.stir.t * 13) };
    c.pose = mix(c.pose, target, 1 - Math.exp(-dt * c.rate));
    // (its head: toward what it's watching, if it's awake)
    let hy = 0, hp = 0;
    if (c.gaze && this.t < c.gaze.until && !c.asleep) {
      hy = Math.max(-1.5, Math.min(1.5, wrap(Math.atan2(c.gaze.z - c.z, c.gaze.x - c.x) - c.yaw)));
      hp = Math.max(-0.6, Math.min(0.5, Math.atan2(c.gaze.y - c.y - 0.15, Math.hypot(c.gaze.x - c.x, c.gaze.z - c.z)) * 0.8));
    } else c.gaze = null;
    const k = 1 - Math.exp(-dt * 5);
    c.head.yaw += (hy - c.head.yaw) * k; c.head.pitch += (hp - c.head.pitch) * k;
  }
  private dt = 0.016;
  /** never in stone, never left in the air: lifted by stone rising under it; off at once if it's taken from under it */
  private hold(c: Cat, dt: number) {
    if (c.air || c.hidden || !this.w) return;
    const w = this.w, solid = (y: number) => inStone(w, c.x, y, c.z);
    if (solid(c.y + 0.06)) {
      for (let y = c.y + 0.05; y < c.y + 3; y += 0.05) if (!solid(y + 0.06) && !solid(y + 0.2)) { c.y += Math.min(y - c.y, dt * 2.2); break; }
      return;
    }
    // (on a place that's still there, it's held (a parapet's top isn't stone a touch strikes, but it's stood on))
    const s = this.place(c.at);
    if (s && Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) < 0.2) return;
    const ground = w.land ? surfaceY(w.land, c.x + CENTER, c.z + CENTER) : 0;
    if (c.y > ground + 0.05 && !solid(c.y - 0.06) && !solid(c.y - 0.2) && c.moving < 0.02 && this.t - this.built > 1) this.stale = true;
  }

  /** its life, when it's not doing anything in particular: rest, wander, groom, play, go and see something new */
  private *life(c: Cat, arriving: boolean): Task {
    if (arriving) {
      const s = this.chooseRest(c, this.place(c.at));
      if (s) { c.resting = s.name; c.doing = 'arriving'; if (yield* this.goTo(c, s, WALK)) yield* this.settle(c, s, false); c.resting = ''; }
    }
    for (;;) {
      // (a moment between one thing and the next, always)
      yield;
      c.awake = true; c.asleep = false;
      const here = this.place(c.at);
      if (!here) { yield* this.wait(c, 0.5); continue; }
      if (c.interest && this.t >= c.interest.at) {
        const it = c.interest; c.interest = null;
        if (c.rng() < 0.35 + 0.65 * c.likes.curious) { yield* this.investigate(c, it.cells); continue; }
      }
      const r = c.rng();
      if (r < 0.04 + 0.1 * c.likes.play && this.t > c.play) {
        const mate = this.list.find((o) => o !== c && !o.gone && !o.leaving && o.awake && !o.air && !o.hidden && o.likes.play > 0.25 && this.t > o.play && Math.hypot(o.x - c.x, o.z - c.z) < 4.5 && Math.abs(o.y - c.y) < 1.2);
        if (mate) { yield* this.chase(c, mate); continue; }
      }
      if (r < 0.74) {
        const s = this.chooseRest(c, here);
        if (s) { c.resting = s.name; c.doing = 'on its way'; if (yield* this.goTo(c, s, WALK)) yield* this.settle(c, s, false); c.resting = ''; continue; }
      }
      if (r < 0.9) { yield* this.wander(c); continue; }
      c.doing = 'grooming';
      c.want = 'sit'; c.rate = 5; yield* this.wait(c, 1);
      c.want = 'groom'; yield* this.wait(c, 3 + c.rng() * 4);
      c.want = 'sit'; yield* this.wait(c, 1.5);
    }
  }
  private *wait(c: Cat, s: number): Task { for (let t = 0; t < s; t += this.dt) yield; }
  /** turn on the spot to face a way */
  private *face(c: Cat, yaw: number): Task {
    let left = wrap(yaw - c.yaw);
    while (Math.abs(left) > 0.05) {
      const s = Math.sign(left) * Math.min(Math.abs(left), this.dt * 3.2);
      c.yaw += s; left -= s; c.moving = 0.15; c.phase += Math.abs(s) * 0.25; c.want = 'walk';
      yield;
    }
    c.moving = 0;
  }
  /** walk (or run) straight to a point, turning as it goes, its height as `yAt` says along the way */
  private *walkTo(c: Cat, x: number, z: number, speed: number, yAt: (f: number, px: number, pz: number) => number): Task {
    const x0 = c.x, z0 = c.z, L = Math.hypot(x - x0, z - z0);
    if (L < 1e-3) { c.y = yAt(1, x, z); return; }
    const want = Math.atan2(z - z0, x - x0);
    if (Math.abs(wrap(want - c.yaw)) > 1.2) yield* this.face(c, want);
    c.want = 'walk'; c.rate = 9; c.stride = speed > 0.8 ? 0.46 : speed > 0.5 ? 0.38 : 0.3;
    let done = 0;
    while (done < L) {
      const dyaw = wrap(Math.atan2(z - c.z, x - c.x) - c.yaw);
      c.yaw += Math.sign(dyaw) * Math.min(Math.abs(dyaw), this.dt * 5);
      const step = Math.min(L - done, speed * this.dt * Math.min(1, 0.4 + done * 3));
      done += step;
      const f = done / L, py = c.y;
      c.x = x0 + (x - x0) * f; c.z = z0 + (z - z0) * f; c.y = yAt(f, c.x, c.z);
      c.pitch += (Math.atan2(c.y - py, step || 1e-3) * 0.55 - c.pitch) * Math.min(1, this.dt * 10);
      c.phase += step / (c.stride * S); c.moving = speed;
      yield;
    }
    c.moving = 0; c.pitch = 0;
  }
  /** along the perch graph to a place: false if there's no way, or the world changed under it on the way */
  private *goTo(c: Cat, dest: Spot, speed: number): Task {
    const epoch = this.epoch;
    const from = this.place(c.at);
    if (!from) return false;
    const path = route(this.P!, from.id, dest.id, (s) => this.taken(s, c) && s.name !== dest.name, (l) => (l.kind === 'hop' || l.kind === 'leap' ? 1.6 - c.likes.bold : 1));
    if (!path) return false;
    let a = from;
    for (const l of path) {
      if (this.epoch !== epoch) return false;
      const b = this.P!.spots[l.to];
      // (one at a time on what's narrow: it waits a little, then thinks again)
      for (let t = 0; b.narrow && this.list.some((o) => o !== c && !o.gone && (o.at === b.name || o.next === b.name)); t += this.dt) {
        if (t > 2.5) return false;
        c.want = 'stand'; c.moving = 0; yield;
      }
      c.next = b.name;
      yield* this.traverse(c, a, b, l, speed);
      if (this.epoch !== epoch) { c.next = ''; return false; }
      c.at = b.name; c.next = ''; a = b;
    }
    return true;
  }
  /** one link: a walk, a jump, or a way through a building unseen */
  private *traverse(c: Cat, a: Spot, b: Spot, l: Link, speed: number): Task {
    const land = this.w!.land;
    const groundY = (x: number, z: number) => (land ? surfaceY(land, x + CENTER, z + CENTER) : 0);
    if (l.kind === 'walk') {
      const y0 = c.y, onGround = a.ground && b.ground;
      // (on a stair: along its steps' noses, by where it is in the stair's cell)
      const u = (s: Spot, x: number, z: number) => 0.5 + (x - s.x) * DIRS[s.d][0] + (z - s.z) * DIRS[s.d][1];
      const stairs = [a, b].filter((s) => s.kind === 'stair');
      const onStair = (x: number, z: number) => { const s = stairs.find((q) => { const v = u(q, x, z); return v >= 0 && v <= 1; }) ?? stairs[0]; return stairY(s.k, u(s, x, z)); };
      yield* this.walkTo(c, b.x, b.z, speed, (f, x, z) => (stairs.length ? onStair(x, z) : onGround ? groundY(x, z) : y0 + (b.y - y0) * f));
      return;
    }
    if (l.kind === 'inside') {
      c.hidden = true;
      yield* this.wait(c, l.cost * 0.7);
      c.x = b.x; c.y = b.y; c.z = b.z; c.hidden = false;
      return;
    }
    // (a jump: to where it springs from; a look; gathered; across; landed, forepaws first; on)
    const [fx, fy, fz] = l.from!, [lx, ly, lz] = l.land!;
    const y0 = c.y;
    yield* this.walkTo(c, fx, fz, Math.min(speed, TROT), (f) => y0 + (fy - y0) * f);
    yield* this.face(c, Math.atan2(lz - fz, lx - fx));
    const dy = ly - fy, dist = Math.hypot(lx - fx, lz - fz);
    c.gaze = { x: lx, y: ly, z: lz, until: this.t + 3 };
    c.want = 'assess'; c.rate = 6;
    yield* this.wait(c, (speed > 0.8 ? 0.15 : 0.45) + (1 - c.likes.bold) * (0.6 + 0.3 * Math.abs(dy) + (l.kind === 'leap' ? 0.4 : 0)));
    c.want = 'gather'; c.rate = 9;
    yield* this.wait(c, 0.34);
    c.gaze = null;
    c.air = true; c.want = 'reach'; c.rate = 14;
    const T = 0.3 + 0.12 * dist + 0.06 * Math.abs(dy), h = dy > 0 ? dy / 2 + 0.18 : l.kind === 'leap' ? 0.32 : 0.15;
    for (let t = 0; t < T; t += this.dt) {
      const f = Math.min(1, t / T);
      c.x = fx + (lx - fx) * f; c.z = fz + (lz - fz) * f; c.y = fy + dy * f + h * 4 * f * (1 - f);
      c.pitch = Math.atan2(dy + h * 4 * (1 - 2 * f), dist + 0.01) * 0.45;
      if (f > 0.7) c.want = 'land';
      yield;
    }
    c.x = lx; c.y = ly; c.z = lz; c.pitch = 0; c.air = false;
    c.want = 'land'; c.rate = 16;
    yield* this.wait(c, 0.2);
    c.want = 'walk'; c.rate = 9;
    yield* this.walkTo(c, b.x, b.z, Math.min(speed, WALK), (f) => ly + (b.y - ly) * f);
  }

  /** at a place to rest: sitting, maybe washing, lying down, maybe sleeping; then up, stretching */
  private *settle(c: Cat, s: Spot, already: boolean): Task {
    c.resting = s.name;
    // (facing out, where it looks out; else the most open way, or the sun)
    if (s.d >= 0) yield* this.face(c, Math.atan2([0, 1, 0, -1][s.d], [1, 0, -1, 0][s.d]));
    else if (!already) yield* this.face(c, c.yaw + (c.rng() - 0.5) * 2.4);
    const where = s.sun > 0.5 ? 'in the sun' : s.shelter > 0.5 ? 'in the shade' : s.kind === 'ledge' ? 'on the ledge' : s.kind === 'rail' ? 'on the parapet' : s.kind === 'coping' ? 'on the wall' : s.court ? 'in the court' : '';
    const learn = (t: number) => c.fav.set(s.name, Math.min(5, (c.fav.get(s.name) ?? 0) + t / 60));
    if (already) { c.want = c.rng() < 0.5 ? 'curl' : 'loaf'; c.pose = POSES[c.want]; }
    else {
      c.doing = `sitting ${where}`.trim();
      c.want = 'sit'; c.rate = 4;
      yield* this.wait(c, 1.2 + c.rng());
      if (c.rng() < 0.35) { c.doing = 'grooming'; c.want = 'groom'; yield* this.wait(c, 3 + c.rng() * 3); c.want = 'sit'; yield* this.wait(c, 1); }
      c.want = s.narrow && s.kind !== 'ledge' ? 'loaf' : c.rng() < 0.5 ? 'loaf' : 'sit';
      c.rate = 2.5;
      c.doing = `resting ${where}`.trim();
      yield* this.wait(c, 2 + c.rng() * 4);
    }
    // (sleep, or watch)
    const sleep = c.want === 'curl' || c.rng() < 0.3 + 0.5 * c.likes.sleepy;
    if (sleep && !(s.narrow && s.kind === 'rail')) {
      c.want = 'curl'; c.rate = 1.6; c.asleep = true; c.awake = false;
      c.doing = `curled up asleep ${where}`.trim();
      const T = 40 + c.rng() * 90;
      for (let t = 0; t < T; t += this.dt) { learn(this.dt); yield; }
      c.asleep = false; c.doing = 'waking';
      c.want = 'loaf'; c.rate = 2.5; yield* this.wait(c, 1.5);
      c.awake = true;
    } else {
      c.doing = `watching ${where || 'quietly'}`.trim();
      c.want = c.want === 'loaf' ? 'loaf' : 'sit';
      const T = 20 + c.rng() * 35;
      for (let t = 0; t < T; t += this.dt) {
        learn(this.dt);
        if (!c.gaze && c.rng() < this.dt * 0.35) {
          // (looking about: at another cat, or out)
          const o = this.list.find((q) => q !== c && !q.gone && Math.hypot(q.x - c.x, q.z - c.z) < 4 && c.rng() < 0.5);
          const a = c.yaw + (c.rng() - 0.5) * 2.4;
          c.gaze = o ? { x: o.x, y: o.y, z: o.z, until: this.t + 1.5 + c.rng() * 2 } : { x: c.x + Math.cos(a) * 3, y: c.y - 0.5 + c.rng(), z: c.z + Math.sin(a) * 3, until: this.t + 1.2 + c.rng() * 2 };
        }
        yield;
      }
    }
    c.want = 'sit'; c.rate = 4; yield* this.wait(c, 0.8);
    if (c.rng() < 0.55) { c.doing = 'stretching'; c.want = 'stretch'; c.rate = 3; yield* this.wait(c, 1.8); }
    c.want = 'stand'; c.rate = 5; yield* this.wait(c, 0.5);
    c.resting = '';
  }
  /** off somewhere it doesn't know well, or that looks out: a look, a sniff */
  private *wander(c: Cat): Task {
    const here = this.place(c.at)!, d = reachable(this.P!, here.id);
    let best: Spot | null = null, bs = -Infinity;
    for (const s of this.P!.spots) {
      if (!isFinite(d[s.id]) || d[s.id] < 2 || this.taken(s, c)) continue;
      const v = (1 - Math.min(1, c.fav.get(s.name) ?? 0)) + 0.6 * s.out + 0.3 * Math.min(2, s.high) - d[s.id] * 0.06 + c.rng() * 1.2;
      if (v > bs) { bs = v; best = s; }
    }
    if (!best) { c.want = 'sit'; yield* this.wait(c, 4); return; }
    c.doing = 'exploring';
    if (!(yield* this.goTo(c, best, WALK))) return;
    c.want = 'sniff'; c.rate = 5; yield* this.wait(c, 1.2 + c.rng());
    c.want = 'sit'; c.doing = 'looking about'; yield* this.wait(c, 3 + c.rng() * 5);
  }
  /** play: a crouch, a dash after the other (who runs), a pounce; then both sit and wash */
  private *chase(c: Cat, o: Cat): Task {
    c.play = o.play = this.t + 120 + c.rng() * 120;
    this.start(o, this.flee(o, c));
    c.doing = `playing with ${o.name}`;
    yield* this.face(c, Math.atan2(o.z - c.z, o.x - c.x));
    c.want = 'gather'; c.rate = 8; c.gaze = { x: o.x, y: o.y, z: o.z, until: this.t + 1.2 };
    yield* this.wait(c, 0.9 + c.rng() * 0.6);
    const until = this.t + 3 + c.rng() * 2;
    while (this.t < until) {
      const goal = this.place(o.next || o.at), here = this.place(c.at);
      if (!goal || !here) break;
      if (Math.hypot(o.x - c.x, o.z - c.z) < 0.4) break;
      const path = route(this.P!, here.id, goal.id);
      if (!path || !path.length) { yield* this.wait(c, 0.2); continue; }
      const b = this.P!.spots[path[0].to];
      c.next = b.name;
      yield* this.traverse(c, here, b, path[0], RUN);
      c.at = b.name; c.next = '';
    }
    // (the pounce, short, at where the other is)
    c.want = 'gather'; c.rate = 12; yield* this.wait(c, 0.3);
    c.want = 'reach'; c.rate = 14;
    const x0 = c.x, z0 = c.z, ang = Math.atan2(o.z - c.z, o.x - c.x), y0 = c.y;
    c.air = true;
    for (let t = 0; t < 0.3; t += this.dt) { const f = t / 0.3; c.x = x0 + Math.cos(ang) * 0.12 * f; c.z = z0 + Math.sin(ang) * 0.12 * f; c.y = y0 + 0.12 * 4 * f * (1 - f); yield; }
    c.y = y0; c.air = false;
    c.want = 'land'; c.rate = 14; yield* this.wait(c, 0.25);
    yield* this.recover(c);
  }
  private *flee(c: Cat, from: Cat): Task {
    c.doing = `playing with ${from.name}`; c.asleep = false;
    c.gaze = { x: from.x, y: from.y + 0.2, z: from.z, until: this.t + 1.2 };
    c.want = 'stand'; c.rate = 10;
    yield* this.wait(c, 0.7);
    const here = this.place(c.at);
    if (here) {
      const d = reachable(this.P!, here.id);
      let best: Spot | null = null, bs = -Infinity;
      for (const s of this.P!.spots) {
        if (!isFinite(d[s.id]) || d[s.id] > 7 || this.taken(s, c)) continue;
        const v = Math.hypot(s.x - from.x, s.z - from.z) - Math.abs(s.y - c.y) * 0.5 + c.rng() * 0.8;
        if (v > bs) { bs = v; best = s; }
      }
      if (best) yield* this.goTo(c, best, RUN);
    }
    yield* this.face(c, Math.atan2(from.z - c.z, from.x - c.x));
    c.want = 'gather'; c.rate = 8; yield* this.wait(c, 0.8);
    yield* this.recover(c);
  }
  private *recover(c: Cat): Task {
    c.doing = 'catching its breath';
    c.want = 'sit'; c.rate = 4; yield* this.wait(c, 1.5 + c.rng());
    c.doing = 'grooming'; c.want = 'groom'; yield* this.wait(c, 2.5 + c.rng() * 2);
    c.want = 'sit'; yield* this.wait(c, 1.5);
  }

  // ─── what building does to them ───
  /** stone laid or taken away: those near look; those close get up and move aside; the curious mean to go and see */
  private disturb(cells: Array<[number, number, number]>) {
    let cx = 0, cy = 0, cz = 0;
    for (const [k, i, j] of cells) { cx += X(i); cy += k + 0.5; cz += Z(j); }
    cx /= cells.length; cy /= cells.length; cz /= cells.length;
    for (const c of this.list) {
      if (c.gone || c.hidden || c.leaving) continue;
      let d = Infinity;
      for (const [k, i, j] of cells) d = Math.min(d, Math.hypot(X(i) - c.x, (k + 0.5) - c.y, Z(j) - c.z));
      if (d > 5.5) continue;
      c.interest = { cells, at: this.t + 1.8 };
      if (c.asleep) { c.stir.flick = 1; if (d > 1.4 && c.rng() < 0.7) continue; }
      c.gaze = { x: cx, y: cy, z: cz, until: this.t + 1.5 + c.rng() * 1.5 };
      if (d < 1.4 && !c.air) this.start(c, this.startle(c, cx, cz));
    }
  }
  private *startle(c: Cat, sx: number, sz: number): Task {
    c.asleep = false; c.awake = true; c.resting = '';
    c.doing = 'startled'; c.want = 'stand'; c.rate = 10;
    yield* this.wait(c, 0.4);
    // (aside: the nearest place to rest a little way off)
    const here = this.place(c.at);
    const s = here && this.chooseRest(c, here, (p) => { const d = Math.hypot(p.x - sx, p.z - sz); return d < 1.8 ? -9 : -Math.abs(d - 2.4) * 0.8; });
    if (s) {
      c.resting = s.name;
      if (yield* this.goTo(c, s, TROT)) {
        yield* this.face(c, Math.atan2(sz - c.z, sx - c.x));
        c.doing = 'watching the stone settle'; c.want = 'sit'; c.rate = 4;
        c.gaze = { x: sx, y: c.y, z: sz, until: this.t + 3 };
        yield* this.wait(c, 2.5 + c.rng() * 2);
      }
      c.resting = '';
    }
  }
  /** go and see what's new: close to it, onto it if it can be stood on; a sniff; and maybe it's a new place to rest */
  private *investigate(c: Cat, cells: Array<[number, number, number]>): Task {
    const here = this.place(c.at);
    if (!here) return;
    const on = (s: Spot) => cells.some(([k, i, j]) => i === s.i && j === s.j && (k === s.k - 1 || k === s.k));
    const by = (s: Spot) => cells.some(([k, i, j]) => Math.abs(i - s.i) + Math.abs(j - s.j) <= 1 && Math.abs(k + 1 - s.k) <= 1);
    const d = reachable(this.P!, here.id);
    let best: Spot | null = null, bs = -Infinity;
    for (const s of this.P!.spots) {
      if (!isFinite(d[s.id]) || this.taken(s, c) || !(on(s) || by(s))) continue;
      const v = (on(s) ? 2 : 0) + (s.rest ? 0.5 : 0) - d[s.id] * 0.12 + c.rng();
      if (v > bs) { bs = v; best = s; }
    }
    if (!best) return;
    c.doing = 'going to see the new stone';
    if (!(yield* this.goTo(c, best, WALK * 0.85))) return;
    const [k, i, j] = cells[Math.floor(c.rng() * cells.length)];
    c.gaze = { x: X(i), y: k + 0.6, z: Z(j), until: this.t + 2.5 };
    c.doing = 'sniffing the new stone'; c.want = 'sniff'; c.rate = 5;
    yield* this.wait(c, 1.5 + c.rng());
    if (best.rest && on(best) && c.rng() < 0.3 + 0.6 * c.likes.curious && !this.taken(best, c)) {
      c.fav.set(best.name, (c.fav.get(best.name) ?? 0) + 1.5);
      c.doing = 'claiming the new stone';
      yield* this.settle(c, best, false);
      return;
    }
    c.want = 'sit'; c.doing = 'looking at the new stone'; yield* this.wait(c, 2 + c.rng() * 2);
  }
  /** after the world's changed under it: to the nearest place, by a jump if need be; then on with its life */
  private *retreat(c: Cat): Task {
    c.resting = ''; c.next = ''; c.asleep = false;
    const P = this.P!;
    let best: Spot | null = null, bd = Infinity;
    for (const s of P.spots) {
      if (this.taken(s, c) && s.narrow) continue;
      const d = Math.hypot(s.x - c.x, (s.y - c.y) * 1.5, s.z - c.z) + (s.y < c.y - 0.3 ? 0.3 : 0);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) { c.gone = true; return; }
    if (bd > 0.08) {
      if (Math.abs(best.y - c.y) < 0.15) yield* this.walkTo(c, best.x, best.z, TROT, (f) => c.y + (best!.y - c.y) * f);
      else {
        // (a jump clear, from where it is)
        const fx = c.x, fy = c.y, fz = c.z, dy = best.y - fy, dist = Math.hypot(best.x - fx, best.z - fz), h = dy > 0 ? dy / 2 + 0.2 : 0.15;
        if (dist > 0.05) yield* this.face(c, Math.atan2(best.z - fz, best.x - fx));
        c.want = 'gather'; c.rate = 12; yield* this.wait(c, 0.2);
        c.air = true; c.want = 'reach'; c.rate = 14;
        const T = 0.3 + 0.1 * dist;
        for (let t = 0; t < T; t += this.dt) { const f = t / T; c.x = fx + (best.x - fx) * f; c.z = fz + (best.z - fz) * f; c.y = fy + dy * f + h * 4 * f * (1 - f); yield; }
        c.x = best.x; c.y = best.y; c.z = best.z; c.air = false;
        c.want = 'land'; c.rate = 16; yield* this.wait(c, 0.25);
      }
    }
    c.at = best.name;
    yield* this.life(c, false);
  }
  /** away out of it, by the edge it came in by */
  private *leave(c: Cat): Task {
    c.doing = 'leaving'; c.resting = '';
    const door = this.door(c);
    if (door) yield* this.goTo(c, door, WALK);
    c.gone = true;
  }

  // ─── seen ───
  /** the cats as they are now, into the moving buffer */
  draw(out: Out, scale = 1) {
    for (const c of this.list) {
      if (c.gone || c.hidden) continue;
      body(out, { x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: c.pitch, coat: c.coat, tone: c.tone, scale }, look(c.pose, c.head.yaw, c.head.pitch), c.stir);
    }
  }
  /** where a cat's head is (for touching it, and for following it) */
  headOf(c: Cat): [number, number, number] { return [c.x + Math.cos(c.yaw) * 0.45 * S, c.y + 0.55 * S, c.z + Math.sin(c.yaw) * 0.45 * S]; }
}
