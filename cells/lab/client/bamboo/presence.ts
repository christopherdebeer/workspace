/**
 * Something else in the grove, going somewhere (no drawing here; chase.ts asks what you can perceive of it, render.ts
 * draws its body, main.ts plays what it sounds like).
 *
 * - **a fox**: low and quick, a tail; it trots when you're far, runs when you're near, bolts when you're close; it stops
 *   now and then to listen and look back, hops onto stones and off them, takes the low gaps;
 * - **a runner**: someone with their own way to go, along the trails, at their own pace (about yours), not waiting for
 *   you; now and then a pause, checking the way; and somewhere a kilometre or so on, where they were going: they stop
 *   there;
 * - **a stir**: nothing to see, only the grove moving where it passes, high in the canopy: stems bending, leaves hissing.
 *
 * Its movement is honest: a body on the same ground as you, with the same culms in its way, never moved further in a
 * moment than its own speed takes it. What it leaves (footfalls, a landing, a rustle as it brushes a culm, the canopy
 * shaking) is handed out as cues: heard, or seen moving, by chase.ts; played by main.ts.
 */
import type { Land } from './world';
import { meets, type Footings, type Post } from './footing';

export type Kind = 'fox' | 'runner' | 'stir';
export interface Cue { kind: 'step' | 'land' | 'rustle' | 'stir'; x: number; y: number; z: number; loud: number; t: number }
/** a part of its body, for the renderer: where, turned how, how big (a stretched lump), which part */
export interface Part { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; part: number }

const KIND = {
  fox: { trot: 3.2, run: 7.2, bolt: 10.5, turn: 6, r: 0.16, hop: 1.25, drop: 2.6, stride: 0.95, loud: 1, h: 0.45 },
  runner: { trot: 6.2, run: 7.1, bolt: 7.6, turn: 2.6, r: 0.3, hop: 0.6, drop: 1.4, stride: 1.6, loud: 1.6, h: 1.8 },
  stir: { trot: 3.4, run: 6.4, bolt: 7.4, turn: 1.6, r: 0, hop: 99, drop: 99, stride: 2.5, loud: 1.2, h: 9 },
};
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ease = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

export class Presence {
  x: number; z: number; y = 0; heading: number; v = 0; phase = 0; t = 0;
  /** what it's doing: going, stopped to listen (looking back toward you), resting (letting you come) */
  mode: 'go' | 'pause' | 'rest' = 'go';
  /** how alarmed it is at you, 0 … 1 */
  alarm = 0;
  /** how far it's come */
  travelled = 0;
  /** what it's left, since asked (chase.ts and main.ts take them) */
  cues: Cue[] = [];
  /** culms it's shaken, for the renderer: where, when, how hard */
  shakes: { x: number; z: number; t: number; k: number }[] = [];
  private wander: number; private pauseT = 0; private nextPause: number; private posts: Post[] = []; private think = 0; private best: number;
  private rnd: () => number; private trailDir = 0; private goal: number; private shook = new Set<object>(); private air = 0;
  readonly spec: (typeof KIND)[Kind];
  constructor(readonly kind: Kind, readonly feet: Footings, readonly land: Land, x: number, z: number, heading: number, seed = 1) {
    this.x = x; this.z = z; this.heading = this.best = this.wander = heading; this.spec = KIND[kind];
    let s = (seed * 2654435761) >>> 0;
    this.rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    this.nextPause = 4 + this.rnd() * 6; this.goal = 700 + this.rnd() * 900;
    this.y = this.ground();
  }
  private ground() { return this.kind === 'stir' ? this.feet.groundAt(this.x, this.z) : this.feet.at(this.x, this.z).y; }
  private cue(kind: Cue['kind'], loud: number) { this.cues.push({ kind, x: this.x, y: this.y, z: this.z, loud, t: this.t }); if (this.cues.length > 60) this.cues.shift(); }

  /** on for `dt` seconds, with you where you are */
  step(dt: number, you: { x: number; z: number }) {
    for (let h = Math.min(dt, 0.25); h > 1e-6; h -= 1 / 30) this.tick(Math.min(h, 1 / 30), you);
  }
  private tick(dt: number, you: { x: number; z: number }) {
    const S = this.spec, F = this.feet;
    this.t += dt;
    const d = Math.hypot(you.x - this.x, you.z - this.z), away = Math.atan2(this.x - you.x, this.z - you.z);
    // (how alarmed: a fox by how near you are; a runner hardly at all; a stir not at all)
    const alarmed = this.kind === 'fox' ? (d < 11 ? 1 : d < 24 ? 0.6 : d < 45 ? 0.25 : 0.05) : this.kind === 'runner' ? (d < 4 ? 0.5 : 0) : 0;
    this.alarm += (alarmed - this.alarm) * ease(dt, alarmed > this.alarm ? 6 : 0.6);

    // ─── stopping: to listen and look back (a fox, calm enough), to check the way (a runner), to settle (a stir); never
    // to wait for you: a fox that hears you close goes at once ───
    if (this.mode === 'rest') { if (this.kind === 'fox' && this.alarm > 0.85 && d > 4) this.mode = 'go'; this.v = 0; return; }
    // (a runner, come where they were going, stops there)
    if (this.kind === 'runner' && this.travelled > this.goal) { this.mode = 'rest'; this.v = 0; return; }
    if (this.mode === 'pause') {
      this.pauseT -= dt; this.v += (0 - this.v) * ease(dt, 8);
      if (this.kind === 'fox') this.heading += wrap(away + Math.PI - this.heading) * ease(dt, 3);
      if (this.pauseT <= 0 || (this.kind === 'fox' && this.alarm > 0.55)) { this.mode = 'go'; this.nextPause = (this.kind === 'runner' ? 18 : 5) + this.rnd() * (this.kind === 'runner' ? 18 : 8); }
      return;
    }
    this.nextPause -= dt;
    if (this.nextPause <= 0 && (this.kind !== 'fox' || this.alarm < 0.35)) {
      this.mode = 'pause'; this.pauseT = this.kind === 'runner' ? 1.2 + this.rnd() * 0.9 : 0.8 + this.rnd() * 1.6;
      // (now and then, far enough from where it started and quiet enough, a fox lies up somewhere open, and lets you come)
      if (this.kind === 'fox' && this.travelled > 260 && this.alarm < 0.15 && this.rnd() < 0.3) this.mode = 'rest';
      return;
    }

    // ─── where it wants to go: a fox and a stir their own wandering way, turned from you when you press; a runner along
    // the trail it's on, in the way it's going ───
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
    // ─── its way through, a few times a second: the clearest near what it wants ───
    this.think -= dt;
    if (this.think <= 0) {
      this.think = 0.12;
      if (this.kind !== 'stir') this.posts = F.posts(this.x, this.z, 6);
      let bestCost = 1e9;
      for (let k = -6; k <= 6; k++) {
        const a = want + k * 0.14, dx = Math.sin(a), dz = Math.cos(a);
        let cost = Math.abs(k) * 0.35 + Math.abs(wrap(a - this.heading)) * 0.4;
        if (this.kind !== 'stir') {
          for (const p of this.posts) {
            if (p.lo > S.h) continue;
            const rx = p.x - this.x, rz = p.z - this.z, al = rx * dx + rz * dz;
            if (al > 0 && al < 5 && Math.abs(-rx * dz + rz * dx) < S.r + 0.12 + p.r) cost += (5 - al) * 1.3;
          }
          const here = this.y;
          for (const dd of [1, 2.2]) { const u = F.at(this.x + dx * dd, this.z + dz * dd); if (u.y - here > S.hop * (dd > 1.5 ? 1.6 : 1)) cost += 40; if (u.y - here < -S.drop) cost += 40; }
        }
        if (cost < bestCost) { bestCost = cost; this.best = a; }
      }
    }
    this.heading += wrap(this.best - this.heading) * ease(dt, S.turn);
    // ─── its pace ───
    const target = this.kind === 'fox' ? (this.alarm > 0.8 ? S.bolt : this.alarm > 0.4 ? S.run : S.trot) : this.kind === 'stir' ? S.run * (0.85 + 0.3 * Math.sin(this.t * 0.31)) : S.run;
    this.v += (target - this.v) * ease(dt, 2.5);
    const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
    let nx = this.x + dx * this.v * dt, nz = this.z + dz * this.v * dt;
    // (never through a culm: round it, as you go round one)
    if (this.kind !== 'stir') for (const p of this.posts) {
      if (meets(p) !== 'block' || p.lo > S.h) continue;
      const ox = nx - p.x, oz = nz - p.z, dd = Math.hypot(ox, oz), m = S.r + p.r + 0.05;
      if (dd < m && dd > 1e-4) { nx = p.x + (ox / dd) * m; nz = p.z + (oz / dd) * m; }
      // (brushing one, it rustles and shakes)
      if (dd < m + 0.3 && !this.shook.has(p.culm)) { this.shook.add(p.culm); this.cue('rustle', 0.7 * S.loud); this.shakes.push({ x: p.x, z: p.z, t: this.t, k: 0.5 }); }
    }
    if (this.shook.size > 30) this.shook.clear();
    this.travelled += Math.hypot(nx - this.x, nz - this.z);
    this.x = nx; this.z = nz;
    // ─── on the ground (or, a stir, high in the canopy): up onto a stone or down off one, a landing to be heard ───
    const g = this.ground();
    if (this.kind === 'stir') {
      this.y = g + 8;
      if (Math.floor(this.t / 0.35) !== Math.floor((this.t - dt) / 0.35)) { this.cue('stir', S.loud * (0.25 + 0.85 * F.coverNear(this.x, this.z))); this.shakes.push({ x: this.x, z: this.z, t: this.t, k: 1 }); }
    } else {
      if (Math.abs(g - this.y) > 0.35) { this.air = 0.22; this.cue('land', (0.8 + Math.min(1.2, Math.abs(g - this.y))) * S.loud); this.y = g; }
      else this.y += (g - this.y) * ease(dt, 12);
      this.air = Math.max(0, this.air - dt);
    }
    // ─── its footfalls, louder on stone ───
    const before = this.phase;
    this.phase += (this.v * dt) / S.stride;
    if (this.kind !== 'stir' && Math.floor(this.phase) !== Math.floor(before)) this.cue('step', S.loud * (0.5 + this.v / S.run * 0.5) * (F.at(this.x, this.z).kind === 'stone' ? 1.8 : 1));
    if (this.shakes.length > 40) this.shakes.splice(0, this.shakes.length - 40);
  }

  /** its body, as the renderer draws it (a few stretched lumps), moving as it moves */
  parts(): Part[] {
    if (this.kind === 'stir') return [];
    const h = this.heading, s = Math.sin(h), c = Math.cos(h), at = (f: number, up: number) => [this.x + s * f, this.y + up, this.z + c * f] as const;
    const run = Math.min(1, this.v / this.spec.run), gait = Math.sin(this.phase * Math.PI * 2);
    if (this.kind === 'fox') {
      const bob = Math.abs(gait) * 0.07 * run + this.air * 0.4, look = this.mode !== 'go' ? 0.6 : 0;
      const b = at(0, 0.3 + bob), hd = at(0.36, 0.42 + bob), tl = at(-0.42, 0.34 + bob + run * 0.06), tp = at(-0.7, 0.36 + bob + run * 0.08);
      return [
        { x: b[0], y: b[1], z: b[2], yaw: h, sx: 0.13, sy: 0.14, sz: 0.34, part: 0 },
        { x: hd[0], y: hd[1], z: hd[2], yaw: h + look * Math.sin(this.t * 1.3), sx: 0.09, sy: 0.09, sz: 0.14, part: 1 },
        { x: tl[0], y: tl[1], z: tl[2], yaw: h, sx: 0.08, sy: 0.08, sz: 0.24, part: 2 },
        { x: tp[0], y: tp[1], z: tp[2], yaw: h, sx: 0.06, sy: 0.06, sz: 0.1, part: 3 },
        ...[-1, 1].map((k) => { const lg = at(0.12 * k * gait * run, 0.12); return { x: lg[0], y: lg[1], z: lg[2], yaw: h, sx: 0.04, sy: 0.13, sz: 0.04, part: 0 }; }),
      ];
    }
    const bob = Math.abs(gait) * 0.06 * run, sw = gait * 0.28 * run, side = [c, -s];
    const b = at(0, 1.1 + bob), hd = at(0, 1.62 + bob);
    const arm = (k: number) => { const f = k * sw; return { x: this.x + s * f + side[0] * 0.2 * k, y: this.y + 1.12 + bob, z: this.z + c * f + side[1] * 0.2 * k, yaw: h, sx: 0.055, sy: 0.3, sz: 0.055, part: 6 }; };
    const leg = (k: number) => { const f = -k * sw * 1.2; return { x: this.x + s * f + side[0] * 0.09 * k, y: this.y + 0.46, z: this.z + c * f + side[1] * 0.09 * k, yaw: h, sx: 0.07, sy: 0.46, sz: 0.07, part: 4 }; };
    return [
      { x: b[0], y: b[1], z: b[2], yaw: h, sx: 0.17, sy: 0.36, sz: 0.12, part: 4 },
      { x: hd[0], y: hd[1], z: hd[2], yaw: h, sx: 0.1, sy: 0.12, sz: 0.1, part: 5 },
      arm(1), arm(-1), leg(1), leg(-1),
    ];
  }
}
