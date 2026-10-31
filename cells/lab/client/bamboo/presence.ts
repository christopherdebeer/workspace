/**
 * Something else in the grove, going somewhere (no drawing here; chase.ts asks what you can perceive of it, render.ts
 * draws its body, main.ts plays what it sounds like).
 *
 * - **a fox**: a body on four legs. It walks, trots and gallops by its speed, each foot set down on the ground under it
 *   (a stone's top, a root, the slope) and lifted again in its turn, the knees bending to reach. Over what it can't step
 *   (a rise, a stone, a culm bowed low across its way, an edge) it **bounds**: a takeoff, a flight it's committed to, a
 *   landing, heard. Where there's no way it can take, it stops and turns; it never slips through. It's wary of you by
 *   what it can tell of you: seen coming (more the faster you come, the nearer, the less there's between you), heard
 *   (your running, your landings). It goes from a trot to a run to flight, and when it's got away it stops to listen and
 *   look back; quiet a long while somewhere open, it lies up, and you may come to it slowly;
 * - **a runner**: someone with their own way to go, along the trails, at about your pace, not waiting for you; legs and
 *   arms as a runner's go; now and then a pause, checking the way; and a kilometre or so on, where they were going:
 *   they stop there;
 * - **a stir**: nothing to see, only the grove moving where it passes, high in the canopy: stems bending, leaves hissing.
 *
 * What it leaves (footfalls, landings, a rustle as it brushes a culm, the canopy shaking where it's passed) is handed
 * out as cues: heard, or seen moving, by chase.ts; played by main.ts; the shaking drawn by render.ts, settling after.
 */
import type { Land } from './world';
import { meets, type Footings, type Post } from './footing';

export type Kind = 'fox' | 'runner' | 'stir';
export interface Cue { kind: 'step' | 'land' | 'rustle' | 'stir'; x: number; y: number; z: number; loud: number; t: number }
/** a part of its body, for the renderer: a stretched sphere, where, turned how (yaw about up, then pitched), which part */
export interface Part { x: number; y: number; z: number; yaw: number; pitch: number; sx: number; sy: number; sz: number; part: number;
  /** tapered toward its far end (or, < 0, its near one), 0 … 1; how furred its edge is, 0 … 1 */
  tp?: number; fur?: number }
/** what it can tell of you: where your eye is, how fast you're going, how loud you've just been (a landing) */
export interface You { x: number; z: number; y: number; v: number; loud: number }

const G = 9.8;
const KIND = {
  fox: { trot: 3.2, run: 7.2, bolt: 10.5, turn: 6, r: 0.16, hop: 1.25, drop: 2.6, leap: 2.6, loud: 1, h: 0.45 },
  runner: { trot: 6.2, run: 7.1, bolt: 7.6, turn: 2.6, r: 0.3, hop: 0.6, drop: 1.4, leap: 1.8, loud: 1.6, h: 1.8 },
  stir: { trot: 3.4, run: 6.4, bolt: 7.4, turn: 1.6, r: 0, hop: 99, drop: 99, leap: 0, loud: 1.2, h: 9 },
};
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);
type V3 = [number, number, number];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** a limb's segment from a to b, r thick */
function seg(a: V3, b: V3, r: number, part: number): Part {
  const d = sub(b, a), L = Math.max(1e-3, len(d)), h = Math.hypot(d[0], d[2]);
  return { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, yaw: h > 1e-4 ? Math.atan2(d[0], d[2]) : 0, pitch: -Math.asin(Math.max(-1, Math.min(1, d[1] / L))), sx: r, sy: r, sz: L / 2 + r * 0.4, part };
}
/** a two-bone limb from joint j to foot f, upper a and lower b long, its knee bent toward `bend` */
function limb(j: V3, f: V3, a: number, b: number, bend: V3): V3 {
  let d = sub(f, j), L = len(d);
  if (L > a + b - 0.005) { d = nrm(d); L = a + b - 0.005; } else d = nrm(d);
  const along = (a * a - b * b + L * L) / (2 * L), h = Math.sqrt(Math.max(0, a * a - along * along));
  const side = nrm(cross(d, bend)), perp = nrm(cross(side, d)), p = dot(perp, bend) < 0 ? -1 : 1;
  return add(add(j, d, along), perp, h * p);
}
/** a rounded mass at c, lying along `dir` */
function blob(c: V3, dir: V3, sx: number, sy: number, sz: number, part: number, fur = 0): Part {
  return { ...seg(add(c, dir, -0.01), add(c, dir, 0.01), 0.01, part), sx, sy, sz, fur };
}
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** through a, b, c as s goes 0 … 1 */
const via = (a: V3, b: V3, c: V3, s: number) => (s < 0.5 ? mix3(a, b, s * 2) : mix3(b, c, s * 2 - 1));

export class Presence {
  x: number; z: number; y = 0; heading: number; v = 0; t = 0;
  /** in the air: carried (vx, vz), rising or falling (vy) */
  air = false; vx = 0; vz = 0; vy = 0;
  /** a bound's phases: gathering for it (seconds left), how long it's been in the air of how long it'll be, since it
   * came down */
  gather = 0; airT = 0; flightT = 1; landT = 9;
  private springAt = 0; private springDir: [number, number] = [0, 1];
  /** what it's doing: going, stopped to listen (looking back toward you), lying up */
  mode: 'go' | 'pause' | 'rest' = 'go';
  /** how alarmed it is at you, 0 … 1; and whether it can see you just now */
  alarm = 0; seesYou = false;
  travelled = 0;
  cues: Cue[] = [];
  /** culms it's shaken, and where it's passed through the canopy: where, when, how hard (the renderer lets them settle) */
  shakes: { x: number; z: number; t: number; k: number }[] = [];
  readonly spec: (typeof KIND)[Kind];
  private wander: number; private pauseT = 0; private nextPause: number; private posts: Post[] = []; private think = 0; private best: number; private bestCost = 0;
  private rnd: () => number; private trailDir = 0; private shook = new Set<object>(); private goal: number;
  comp = 0; look = 0;
  private gait = 0; private compV = 0; private wasAlarmed = false; private calm = 0; private sight = 0; private youNoise = 0;
  private tail: V3[] = [];
  constructor(readonly kind: Kind, readonly feet: Footings, readonly land: Land, x: number, z: number, heading: number, seed = 1) {
    this.x = x; this.z = z; this.heading = this.best = this.wander = heading; this.spec = KIND[kind];
    let s = (seed * 2654435761) >>> 0;
    this.rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.nextPause = 4 + this.rnd() * 6; this.goal = 700 + this.rnd() * 900;
    this.y = this.ground();
  }
  private ground(x = this.x, z = this.z) { return this.kind === 'stir' ? this.feet.groundAt(x, z) : this.feet.at(x, z).y; }
  private cue(kind: Cue['kind'], loud: number, x = this.x, y = this.y, z = this.z) { this.cues.push({ kind, x, y, z, loud, t: this.t }); if (this.cues.length > 80) this.cues.shift(); }

  /** on for `dt` seconds, with you where you are */
  step(dt: number, you: You) {
    for (let h = Math.min(dt, 0.25); h > 1e-6; h -= 1 / 60) this.tick(Math.min(h, 1 / 60), you);
  }

  /** whether a line from `a` to `b` is clear of the land, the stones and the culms (a fox's eye to yours, or yours to it) */
  clear(a: V3, b: V3) {
    const F = this.feet, d = sub(b, a), L = Math.hypot(d[0], d[2]);
    if (L < 0.5) return true;
    for (let s = 0.6; s < L - 0.3; s += 0.6) { const f = s / L; if (F.at(a[0] + d[0] * f, a[2] + d[2] * f).y > a[1] + d[1] * f) return false; }
    const ux = d[0] / L, uz = d[2] / L;
    for (const q of F.posts((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, L / 2 + 1)) {
      const rx = q.x - a[0], rz = q.z - a[2], al = rx * ux + rz * uz;
      if (al <= 0.3 || al >= L - 0.3) continue;
      const yAt = a[1] + d[1] * (al / L) - F.groundAt(q.x, q.z);
      if (yAt < q.lo || yAt > q.hi) continue;
      if (Math.abs(-rx * uz + rz * ux) < q.r + 0.04) return false;
    }
    return true;
  }

  private tick(dt: number, you: You) {
    const S = this.spec, F = this.feet;
    this.t += dt;
    const d = Math.hypot(you.x - this.x, you.z - this.z), away = Math.atan2(this.x - you.x, this.z - you.z);
    // ─── what it can tell of you ───
    this.youNoise = Math.max(this.youNoise * Math.exp(-dt * 2), you.loud);
    this.sight -= dt;
    if (this.kind === 'fox' && this.sight <= 0) { this.sight = 0.2; this.seesYou = d < 40 && this.clear([this.x, this.y + 0.4, this.z], [you.x, you.y, you.z]); }
    if (this.kind === 'fox') {
      const vk = Math.min(1, you.v / 7);
      // (seen coming: more the faster, the nearer; heard: your running and your landings, nearer louder)
      const seen = this.seesYou ? Math.max(0, 1.4 - d / 30) * (0.35 + 0.65 * vk) : 0;
      const noise = vk * 0.75 + this.youNoise, heard = noise * Math.max(0, 1 - d / (6 + 16 * noise));
      const want = Math.min(1, Math.max(seen, heard));
      this.alarm += (want - this.alarm) * ease(dt, want > this.alarm ? 2.5 : 0.35);
    } else this.alarm = this.kind === 'runner' && d < 4 ? 0.5 : 0;

    // ─── the tail and the body's give, every moment, whatever it's doing ───
    this.compV += (-160 * this.comp - 18 * this.compV) * dt; this.comp += this.compV * dt;

    if (this.air) { this.fly(dt); this.swing(dt); return; }
    this.landT += dt;
    // (gathering: the hind feet come under, the body sinks, still going on a little; then it springs from there)
    if (this.gather > 0) {
      const [dx, dz] = this.springDir, s = this.v * 0.45 * dt, nx = this.x + dx * s, nz = this.z + dz * s;
      if (Math.abs(F.at(nx, nz).y - this.y) < 0.06) { this.x = nx; this.z = nz; this.springAt -= s; this.travelled += s; }
      this.gather -= dt; this.swing(dt);
      if (this.gather <= 0) this.spring();
      return;
    }

    // ─── lying up: it lets you come, slowly; come fast or loud and it's gone ───
    if (this.mode === 'rest') {
      this.v = 0; this.swing(dt);
      if (this.alarm > 0.7) { this.mode = 'go'; this.wander = away; }
      return;
    }
    // ─── stopping: when it's got away, to listen and look back; on a height, to look; a runner to check the way; never
    // to wait for you: hearing you close, a fox goes at once ───
    if (this.mode === 'pause') {
      this.pauseT -= dt; this.v += (0 - this.v) * ease(dt, 8);
      if (this.kind === 'fox') {
        // (it looks back over its shoulder; further round than its neck goes, and it turns its body to you)
        const to = wrap(away + Math.PI - this.heading), over = Math.abs(to) - 1.4;
        if (over > 0) this.heading += Math.sign(to) * over * ease(dt, 2.5);
        this.look += (Math.max(-1.4, Math.min(1.4, to)) - this.look) * ease(dt, 4);
      }
      this.swing(dt);
      if (this.pauseT <= 0 || (this.kind === 'fox' && this.alarm > 0.55)) { this.mode = 'go'; this.nextPause = (this.kind === 'runner' ? 18 : 6) + this.rnd() * (this.kind === 'runner' ? 18 : 8); }
      return;
    }
    this.look *= 1 - ease(dt, 5);
    if (this.kind === 'runner' && this.travelled > this.goal) { this.mode = 'rest'; this.v = 0; return; }
    this.nextPause -= dt;
    if (this.kind === 'fox') {
      // (got away: alarm falling through, after it ran; or come up onto a stone, a rise, calm enough to look)
      const eased = this.wasAlarmed && this.alarm < 0.32, onHeight = F.at(this.x, this.z).kind === 'stone' && this.alarm < 0.45 && this.nextPause < 0;
      if (this.alarm > 0.6) this.wasAlarmed = true;
      if (eased || onHeight) { this.wasAlarmed = false; this.mode = 'pause'; this.pauseT = 1 + this.rnd() * 1.8; return; }
      this.calm = this.alarm < 0.12 ? this.calm + dt : 0;
      if (this.calm > 10 && this.travelled > 120 && F.coverNear(this.x, this.z) < 0.45) { this.mode = 'rest'; this.calm = 0; return; }
    } else if (this.nextPause <= 0) { this.mode = 'pause'; this.pauseT = this.kind === 'runner' ? 1.2 + this.rnd() * 0.9 : 0.8 + this.rnd() * 1.6; return; }

    // ─── where it wants to go: a fox and a stir their own wandering way, turned from you when it's wary; a runner along
    // their trail, the way they're going ───
    this.wander += (this.rnd() - 0.5) * dt * 1.6;
    let want = this.wander;
    if (this.kind === 'fox' && this.alarm > 0.3) want = away + wrap(this.wander - away) * 0.45;
    if (this.kind === 'runner') {
      const q = this.land.trailNear(this.x, this.z);
      if (q.trail) {
        const tr = q.trail, i = Math.min(tr.x.length - 2, Math.max(1, q.i)), dir = Math.atan2(tr.x[i + 1] - tr.x[i - 1], tr.z[i + 1] - tr.z[i - 1]);
        if (!this.trailDir) this.trailDir = Math.abs(wrap(dir - this.heading)) < Math.PI / 2 ? 1 : -1;
        const along = this.trailDir > 0 ? dir : wrap(dir + Math.PI), toward = Math.atan2(tr.x[i] - this.x, tr.z[i] - this.z);
        want = q.d > 1.2 ? toward + wrap(along - toward) * 0.5 : along;
        this.wander = want;
      }
    }
    // ─── its way, a few times a second: of the ways near what it wants, one it can take (stepping, or bounding what it
    // can't step); none, and it stops and turns ───
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.1;
      if (this.kind !== 'stir') this.posts = F.posts(this.x, this.z, 6);
      let bestCost = 1e9;
      for (let k = -9; k <= 9; k++) {
        const a = want + k * 0.14, dx = Math.sin(a), dz = Math.cos(a);
        let cost = Math.abs(k) * 0.35 + Math.abs(wrap(a - this.heading)) * 0.4;
        if (this.kind !== 'stir') {
          for (const p of this.posts) {
            if (p.lo > S.h || p.hi < 0.4) continue;
            const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz;
            if (al > 0 && al < 5 && Math.abs(-rx * dz + rz * dx) < S.r + 0.12 + p.r) cost += (5 - al) * 1.3;
          }
          if (!this.passable(a)) cost += 100;
        }
        if (cost < bestCost) { bestCost = cost; this.best = a; }
      }
      this.bestCost = bestCost;
    }
    const blocked = this.bestCost >= 100;
    this.heading += wrap(this.best - this.heading) * ease(dt, blocked ? S.turn * 1.5 : S.turn);
    // ─── its pace (none, turning, where there's no way on) ───
    const target = blocked ? 0 : this.kind === 'fox' ? (this.alarm > 0.8 ? S.bolt : this.alarm > 0.4 ? S.run : S.trot) : this.kind === 'stir' ? S.run * (0.85 + 0.3 * Math.sin(this.t * 0.31)) : S.run;
    this.v += (target - this.v) * ease(dt, target < this.v ? 4 : 2.5);
    const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
    // ─── a bound, if there's something just ahead it can't step ───
    if (this.kind !== 'stir' && this.v > 1 && this.bound(dx, dz)) return;
    let nx = this.x + dx * this.v * dt, nz = this.z + dz * this.v * dt;
    if (this.kind !== 'stir') [nx, nz] = this.slip(nx, nz);
    // (on the ground it rises and falls no more steeply than it steps: anything more is a bound, or it's held, and the way's
    // looked for again)
    if (this.kind !== 'stir' && Math.abs(F.at(nx, nz).y - this.y) > Math.max(0.06, 1.1 * Math.hypot(nx - this.x, nz - this.z))) { this.v *= 0.5; this.think = 0; return; }
    this.travelled += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;
    const g = this.ground();
    if (this.kind === 'stir') {
      this.y = g + 8;
      if (Math.floor(this.t / 0.35) !== Math.floor((this.t - dt) / 0.35)) { this.cue('stir', S.loud * (0.25 + 0.85 * F.coverNear(this.x, this.z))); this.shakes.push({ x: this.x, z: this.z, t: this.t, k: 1 }); }
    } else this.y = g;
    // ─── its footfalls, each foot as it's set down; louder on stone ───
    const before = this.gait;
    this.gait += (this.v * dt) / this.strideLen();
    if (this.kind !== 'stir') for (const off of this.offsets()) if (Math.floor(before + off) !== Math.floor(this.gait + off)) this.cue('step', S.loud * (this.kind === 'fox' ? 0.45 : 0.7) * (0.5 + (0.5 * this.v) / S.run) * (F.at(this.x, this.z).kind === 'stone' ? 1.8 : 1));
    this.swing(dt);
    if (this.shakes.length > 60) this.shakes.splice(0, this.shakes.length - 60);
  }
  /** never through a culm: round it; brushing one, it rustles and shakes */
  private slip(nx: number, nz: number): [number, number] {
    const S = this.spec;
    for (const p of this.posts) {
      if (meets(p) !== 'block' || p.lo > S.h) continue;
      const ox = nx - p.x, oz = nz - p.z, dd = Math.hypot(ox, oz), m = S.r + p.r + 0.05;
      if (dd < m && dd > 1e-4) { nx = p.x + (ox / dd) * m; nz = p.z + (oz / dd) * m; }
      if (dd < m + 0.3 && !this.shook.has(p.culm)) { this.shook.add(p.culm); this.cue('rustle', 0.7 * S.loud, p.x, this.y, p.z); this.shakes.push({ x: p.x, z: p.z, t: this.t, k: 0.6 }); }
    }
    if (this.shook.size > 30) this.shook.clear();
    return [nx, nz];
  }
  /** whether a way's takeable: stepped, or bounded (a landing it can reach, no higher than it can spring) */
  private passable(a: number) {
    const S = this.spec, F = this.feet, dx = Math.sin(a), dz = Math.cos(a);
    for (let s = 0.3; s <= 2.2; s += 0.3) {
      const u = F.at(this.x + dx * s, this.z + dz * s).y;
      if (this.edge(u, s)) return this.landing(dx, dz, s) !== null;
    }
    return true;
  }
  /** whether ground `u` at `s` metres on is more than it can step from where it is: up or down too far, too steeply */
  private edge(u: number, s: number) { const dy = u - this.y; return (dy > 0.28 && dy / s > 0.65) || (dy < -0.38 && -dy / s > 0.9); }
  /** where a bound from here along (dx, dz) over what's at `edge` would come down, or null if nowhere it can */
  private landing(dx: number, dz: number, edge: number): { d: number; y: number; crest: number } | null {
    const S = this.spec, F = this.feet;
    let crest = this.y;
    for (let s = edge; s <= S.leap + 0.2; s += 0.15) {
      const u = F.at(this.x + dx * s, this.z + dz * s).y;
      crest = Math.max(crest, u);
      if (s < edge + 0.35) continue;
      const u2 = F.at(this.x + dx * (s + 0.25), this.z + dz * (s + 0.25)).y, u0 = F.at(this.x + dx * (s - 0.25), this.z + dz * (s - 0.25)).y;
      // (somewhere level enough to land, that it can spring up to or drop down to)
      if (Math.abs(u2 - u) < 0.14 && Math.abs(u - u0) < 0.14 && u - this.y <= S.hop && this.y - u <= S.drop) return { d: s, y: u, crest };
    }
    return null;
  }
  /** something just ahead it can't step: it gathers for it, then springs (`spring`); nowhere to come down, and it doesn't */
  private bound(dx: number, dz: number) {
    const F = this.feet, ahead = Math.max(0.35, this.v * 0.16);
    let edge = -1;
    for (let s = 0.15; s <= ahead + 0.3; s += 0.15) { const u = F.at(this.x + dx * s, this.z + dz * s).y; if (this.edge(u, s)) { edge = s; break; } }
    // (a culm bowed low across its way: over it)
    if (edge < 0) for (const p of this.posts) {
      if (p.hi > 0.5 || p.hi < 0.12) continue;
      const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz;
      if (al > 0.2 && al < ahead + 0.3 && Math.abs(-rx * dz + rz * dx) < 0.3) { edge = al; break; }
    }
    if (edge < 0) return false;
    if (!this.landing(dx, dz, edge)) { this.think = 0; this.v *= 0.3; return true; }
    this.gather = this.kind === 'fox' ? 0.12 : 0.09; this.springAt = edge; this.springDir = [dx, dz];
    return true;
  }
  /** off: the flight worked out from where it's gathered, committed to where it'll come down */
  private spring() {
    const [dx, dz] = this.springDir, L = this.landing(dx, dz, Math.max(0.1, this.springAt));
    if (!L) { this.think = 0; this.v *= 0.3; return; }
    const vh = Math.max(this.v, 3.5), T0 = Math.max(0.22, L.d / vh);
    let vy = (L.y - this.y + 0.5 * G * T0 * T0) / T0, T = T0;
    const need = Math.sqrt(Math.max(0, 2 * G * (L.crest + 0.18 - this.y)));
    if (vy < need) { vy = need; T = (vy + Math.sqrt(Math.max(0, vy * vy - 2 * G * (L.y - this.y)))) / G; }
    this.vx = (dx * L.d) / T; this.vz = (dz * L.d) / T; this.vy = vy; this.air = true; this.airT = 0; this.flightT = T;
    this.compV -= 1.2;
    this.cue('step', this.spec.loud * 0.8);
  }
  private fly(dt: number) {
    this.x += this.vx * dt; this.z += this.vz * dt; this.vy -= G * dt; this.y += this.vy * dt; this.airT += dt;
    this.travelled += Math.hypot(this.vx, this.vz) * dt;
    const g = this.ground();
    if (this.y <= g && this.vy < 0) {
      const imp = -this.vy;
      this.y = g; this.air = false; this.vy = 0; this.v = Math.hypot(this.vx, this.vz); this.landT = 0;
      this.compV += 0.4 + imp * 0.22;
      this.cue('land', (0.7 + imp * 0.25) * this.spec.loud * (this.feet.at(this.x, this.z).kind === 'stone' ? 1.5 : 1));
      this.shakes.push({ x: this.x, z: this.z, t: this.t, k: 0.35 });
    }
  }
  /** the tail, swinging after the body: streaming straight out in a bound or a gallop, low and swaying when it trots,
   * hanging when it stops to listen */
  swing(dt: number) {
    if (this.kind !== 'fox') return;
    const h = this.heading, f: V3 = [Math.sin(h), 0, Math.cos(h)], run = this.air ? 1 : Math.min(1, this.v / this.spec.run), n = 5, L = 0.12;
    let p: V3 = [this.x - f[0] * 0.27, this.y + 0.33 - this.comp, this.z - f[2] * 0.27];
    const dir = nrm([-f[0], -0.45 + 0.5 * run - (this.mode === 'pause' ? 0.3 : 0), -f[2]]), side: V3 = [f[2], 0, -f[0]];
    if (this.tail.length !== n) this.tail = Array.from({ length: n }, (_, k) => add(p, dir, L * k));
    this.tail[0] = p;
    for (let k = 1; k < n; k++) {
      const sway = Math.sin(this.t * 2.2 - k * 0.8) * 0.04 * k * (1 - run * 0.7);
      // (it curves: the root rising from the hips, the brush drooping, the tip lifting a little)
      const bend: V3 = [0, k === 1 ? 0.03 : k === n - 1 ? 0.015 : -0.01, 0];
      const want = add(add(add(this.tail[k - 1], dir, L), side, sway), bend), q = this.tail[k];
      const nq = add(q, sub(want, q), ease(dt, 15 - k * 2.2));
      this.tail[k] = add(this.tail[k - 1], nrm(sub(nq, this.tail[k - 1])), L);
      p = this.tail[k];
    }
  }
  private strideLen() { return this.kind === 'runner' ? (this.v < 2 ? 1.2 : 1.9) : this.v < 1.6 ? 0.42 : this.v < 5 ? 0.8 : 1.5; }
  /** each foot's place in the stride: a fox's walk, trot (diagonal pairs), gallop (the hind pair, then the fore); a runner's two */
  private offsets() {
    if (this.kind === 'runner') return [0, 0.5];
    return this.v < 1.6 ? [0, 0.5, 0.75, 0.25] : this.v < 5 ? [0, 0.5, 0.5, 0] : [0, 0.12, 0.55, 0.65];
  }
  private duty() { return this.kind === 'runner' ? (this.v < 2 ? 0.6 : 0.36) : this.v < 1.6 ? 0.75 : this.v < 5 ? 0.55 : 0.36; }
  /** a foot, from its joint: set down and drawn back under the body while it bears weight, then lifted and swung forward */
  private foot(j: V3, off: number, f: V3, reach: number): V3 {
    const S = this.strideLen(), duty = this.duty(), p = (((this.gait + off) % 1) + 1) % 1, run = Math.min(1, this.v / this.spec.run);
    let o = 0, lift = 0;
    if (this.v > 0.05) {
      if (p < duty) o = S * duty * (0.5 - p / duty);
      else { const s = (p - duty) / (1 - duty); o = S * duty * (s - 0.5); lift = Math.sin(Math.PI * s) * (this.kind === 'runner' ? 0.18 + 0.1 * run : 0.05 + 0.06 * run); }
    }
    const x = j[0] + f[0] * (o + reach), z = j[2] + f[2] * (o + reach);
    return [x, this.feet.at(x, z).y + lift + (this.kind === 'runner' ? 0.04 : 0.02), z];
  }

  /** its body, as the renderer draws it (stretched spheres, each limb two of them, bent at the knee), as it moves */
  parts(): Part[] {
    if (this.kind === 'stir') return [];
    const h = this.heading, f: V3 = [Math.sin(h), 0, Math.cos(h)], r: V3 = [Math.cos(h), 0, -Math.sin(h)], up: V3 = [0, 1, 0];
    const run = Math.min(1, this.v / this.spec.run), gaitW = Math.sin(this.gait * Math.PI * 2), F = this.feet;
    const out: Part[] = [];
    if (this.kind === 'fox') {
      const lie = this.mode === 'rest' ? 0.17 : 0, listen = this.mode === 'pause' ? 1 : 0;
      // (where it is in a bound: gathering (the hind feet coming under, the hips sinking), in the air (s: 0 the push off,
      // ½ stretched out, 1 the forefeet reaching down for the ground), and coming down (the shoulders taking it, sinking))
      const gk = this.gather > 0 ? Math.min(1, 1 - this.gather / 0.12) : 0, s = this.air ? Math.min(1, this.airT / this.flightT) : 0;
      const ak = !this.air && this.landT < 0.32 ? Math.sin(Math.PI * Math.min(1, 0.25 + this.landT / 0.32 * 0.75)) : 0, stretch = this.air ? Math.sin(Math.PI * Math.min(1, s * 1.3)) : 0;
      const vh = Math.hypot(this.vx, this.vz), pa = this.air ? Math.max(-0.55, Math.min(0.5, Math.atan2(this.vy, Math.max(1, vh)) * 1.3 + 0.12 * (1 - s * 2))) : -0.12 * ak + 0.06 * gk;
      // (the spine from the hips to the shoulders, each over the ground under it, so it follows the slope and its stones)
      const gF = this.air ? this.y : F.at(this.x + f[0] * 0.2, this.z + f[2] * 0.2).y, gH = this.air ? this.y : F.at(this.x - f[0] * 0.2, this.z - f[2] * 0.2).y;
      const flex = this.v > 5 && !this.air ? gaitW * 0.03 : 0, half = 0.16 + 0.05 * stretch - 0.04 * gk - 0.02 * ak;
      const sh: V3 = [this.x + f[0] * half, gF + 0.35 - this.comp - lie + flex + Math.sin(pa) * half - 0.06 * gk - 0.1 * ak + 0.02 * listen, this.z + f[2] * half];
      const hp: V3 = [this.x - f[0] * half, gH + 0.36 - this.comp - lie - flex - Math.sin(pa) * half - 0.13 * gk - 0.03 * ak, this.z - f[2] * half];
      const spine = nrm(sub(sh, hp)), belly = nrm(cross(spine, r));
      // (the deep chest, the slighter waist, the hips; the white bib at the throat)
      // (one trunk from the haunch to the shoulder, fuller at the shoulder; the deep chest hung under its front)
      out.push({ ...seg(add(hp, spine, -0.06), add(sh, spine, 0.04), 0.078, 0), sy: 0.09, tp: -0.25, fur: 0.9 });
      out.push(blob(add(add(sh, spine, -0.03), belly, 0.045), spine, 0.066, 0.082, 0.1, 0, 1));
      // (the neck and head: up and alert when it stops, turned over its shoulder to look back at you; low and reaching
      // as it runs; level and forward in a bound)
      const hy = h + this.look, hf: V3 = [Math.sin(hy), 0, Math.cos(hy)], hr: V3 = [Math.cos(hy), 0, -Math.sin(hy)];
      const lift = 0.13 - 0.07 * run + 0.06 * listen - lie * 0.6 - 0.03 * stretch + Math.sin(pa) * 0.08 - 0.06 * gk - 0.07 * ak;
      const neck0 = add(add(sh, spine, 0.05), belly, -0.03), head = add(add(neck0, hf, 0.13 + 0.05 * run + 0.03 * stretch), up, lift);
      out.push(blob(add(add(sh, spine, 0.075), belly, 0.06), sub(head, neck0), 0.045, 0.06, 0.045, 3, 1));
      out.push({ ...seg(neck0, head, 0.06, 0), tp: 0.25, fur: 0.9 });
      out.push(blob(head, hf, 0.058, 0.055, 0.065, 1, 0.3), blob(add(add(head, hf, -0.025), up, -0.02), hf, 0.075, 0.05, 0.045, 1, 1));
      const nose = add(add(head, hf, 0.155), up, -0.035);
      out.push({ ...seg(add(add(head, hf, 0.03), up, -0.012), nose, 0.033, 1), tp: 0.8 }, blob(nose, hf, 0.011, 0.011, 0.013, 7));
      // (the ears, tall, dark-backed, pricked toward you when it listens)
      for (const k of [-1, 1]) out.push({ ...seg(add(add(add(head, hr, 0.03 * k), up, 0.03), hf, -0.01), add(add(add(head, hr, 0.05 * k), up, 0.125 + 0.01 * listen), hf, -0.03 + 0.015 * listen), 0.03, 10), tp: 0.95 });
      // (the legs: the fore with its elbow behind, the hind with the thigh's mass, its stifle forward and hock behind; each
      // foot on the ground under it, or in a bound pushing off, folded and stretched, then reaching for the ground)
      const offs = this.offsets();
      for (let i = 0; i < 4; i++) {
        const fore = i < 2, k = i % 2 ? 1 : -1, j = add(add(fore ? sh : hp, r, (fore ? 0.05 : 0.06) * k), up, fore ? -0.02 : 0);
        let foot: V3;
        if (this.air) foot = fore
          ? add(j, via(add(mul(f, 0.22), up, -0.2), add(mul(f, 0.06), up, -0.13), add(mul(f, 0.26), up, -0.33), s), 1)
          : add(j, via(add(mul(f, -0.34), up, -0.12), add(mul(f, -0.33), up, -0.1), add(mul(f, -0.12), up, -0.2), s), 1);
        else if (lie) foot = add(add(j, f, fore ? 0.17 : -0.02), up, -0.12);
        else {
          foot = this.foot(j, offs[i], f, fore ? 0.06 * ak - 0.04 * gk : 0.24 * gk + 0.08 * ak);
        }
        if (fore) {
          const pastern = add(add(foot, up, 0.05), f, -0.012), elbow = limb(j, pastern, 0.16, 0.17, sub([0, 0, 0], f));
          out.push({ ...seg(j, elbow, 0.036, 9), tp: 0.2, fur: 0.4 }, seg(elbow, pastern, 0.02, 7), seg(pastern, foot, 0.019, 7));
        } else {
          const hock = add(add(foot, up, 0.11), f, -0.035), stifle = limb(j, hock, 0.16, 0.17, f);
          out.push({ ...seg(add(j, f, -0.01), stifle, 0.055, 0), tp: 0.45, fur: 0.7 }, { ...seg(stifle, hock, 0.026, 9), tp: 0.2 }, seg(hock, foot, 0.019, 7));
        }
        out.push({ ...blob(add(foot, f, 0.012), f, 0.022, 0.016, 0.032, 7) });
      }
      // (the brush: thick, as long as its body nearly, smoky above, white at its tip)
      const T = this.tail, TR = [0.05, 0.075, 0.085, 0.07];
      if (T.length === 5) for (let k = 0; k < 4; k++) out.push({ ...seg(T[k], T[k + 1], TR[k], k === 3 ? 3 : 2), tp: k === 0 ? -0.5 : k === 3 ? 0.85 : 0, fur: 1 });
      return out;
    }
    // ─── a runner ───
    const bob = this.v > 0.5 ? Math.abs(gaitW) * 0.05 * run : 0, lean = 0.08 * run;
    const g = this.air ? this.y : F.at(this.x, this.z).y;
    const pelvis: V3 = [this.x, g + 0.94 + bob - this.comp, this.z], chest = add(add(pelvis, up, 0.42), f, lean * 0.6), head = add(add(chest, up, 0.24), f, lean * 0.4);
    out.push(seg(pelvis, chest, 0.16, 4), { ...seg(pelvis, pelvis, 0.15, 4), sz: 0.12 }, seg(add(chest, up, 0.1), head, 0.05, 8), { ...seg(head, head, 0.1, 5), sz: 0.11, sy: 0.12 });
    const offs = this.offsets();
    for (const [k, i] of [[-1, 0], [1, 1]] as const) {
      const hip = add(pelvis, r, 0.1 * k);
      const foot = this.air ? add(add(hip, f, k * 0.15), up, -0.75) : this.foot(hip, offs[i], f, 0);
      const knee = limb(hip, foot, 0.46, 0.46, f);
      out.push(seg(hip, knee, 0.075, 4), seg(knee, foot, 0.058, 4), { ...seg(foot, add(foot, f, 0.12), 0.04, 5), sz: 0.1 });
      // (the arm opposite the leg, bent at the elbow, swinging)
      const shoulder = add(add(chest, r, 0.2 * k), up, 0.08), sw = this.v > 0.5 ? -Math.sin((this.gait + offs[i]) * Math.PI * 2) * 0.28 * run : 0;
      const hand = add(add(add(shoulder, up, -0.42 + 0.12 * run), f, sw + 0.08 * run), r, -0.03 * k);
      const elbow = limb(shoulder, hand, 0.29, 0.27, sub([0, 0, 0], f));
      out.push(seg(shoulder, elbow, 0.055, 6), seg(elbow, hand, 0.045, 6));
    }
    return out;
  }
}
