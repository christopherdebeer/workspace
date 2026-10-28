/**
 * You, running (no drawing or input here, so it can be run on its own: devtools/bamboo-run.mjs).
 *
 * - **the lope**: about 7 m/s, gathering and easing off smoothly; slower uphill, quicker down, a little quicker on a trail;
 * - **the weave**: each moment, of the ways within thirty degrees or so of where you're heading, the one that's clearest
 *   (no culm in its path for five metres; no rock face to climb; no drop too far to take) and nearest your heading;
 * - **the trail**: running more or less along one, it turns you with it, until you turn off it;
 * - **the drop**: off an edge (half a metre or more, at a run) you're in the air, and land with a dip; one of over three
 *   metres the run won't take: you stop at the rim;
 * - **the stride**: a footfall each half stride (shorter on a stair), handed out to be heard.
 *
 * The land round you is built a chunk at a time as you go (`stream`), and let go behind you.
 */
import { World, CHUNK, HALF, type Chunk } from './world';

export const LOPE = 7;
export interface Input { go: boolean; turn: number }
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const key = (i: number, j: number) => `${i},${j}`;

export class Runner {
  x = 0; z = 0; y = 0; heading = 0; move = 0; v = 0; vy = 0; air = false; dip = 0; phase = 0; turn = 0; onTrail = false; stopped = false;
  readonly chunks = new Map<string, Chunk>();
  /** a footfall: on stone or not, how hard */
  onStep: (stone: boolean, hard: number) => void = () => {};
  constructor(readonly world: World, readonly range = 104) {}

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
  groundAt(x: number, z: number) {
    const tr = this.world.tread(x, z);
    if (tr !== null) return tr;
    const c = this.chunks.get(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!c) return this.world.ground(x, z);
    const fx = x - c.x0, fz = z - c.z0, i = Math.min(CHUNK - 1, Math.floor(fx)), j = Math.min(CHUNK - 1, Math.floor(fz)), u = fx - i, v = fz - j, N = CHUNK + 1, G = c.ground, k = i + j * N;
    return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + N] * (1 - u) + G[k + N + 1] * u) * v;
  }
  culmsNear(x: number, z: number, r: number) {
    const out: { x: number; z: number; r: number }[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const c = this.chunks.get(key(Math.floor(x / CHUNK) + a, Math.floor(z / CHUNK) + b)); if (!c) continue;
      for (let k = 0; k < c.tall; k++) { const q = c.culms[k]; if (Math.abs(q.x - x) < r && Math.abs(q.z - z) < r) out.push({ x: q.x, z: q.z, r: q.r }); }
    }
    return out;
  }

  step(dt: number, input: Input) {
    this.heading += input.turn;
    // (a trail you're on, running more or less along it, carries you: it turns you with it until you turn off it)
    const q = this.world.trailNear(this.x, this.z);
    this.onTrail = false;
    if (q.trail && q.d < HALF * 1.6) {
      const tr = q.trail, i = Math.min(tr.x.length - 2, q.i), dir = Math.atan2(tr.x[i + 1] - tr.x[i], tr.z[i + 1] - tr.z[i]);
      const along = Math.abs(wrap(this.heading - dir)) < Math.PI / 2 ? dir : wrap(dir + Math.PI), off = wrap(along - this.heading);
      if (Math.abs(off) < 0.6) { this.onTrail = true; this.heading += off * Math.min(1, dt * 2.2); }
    }
    // (the weave: the clearest way near your heading)
    const near = this.culmsNear(this.x, this.z, 7), here = this.groundAt(this.x, this.z);
    let best = this.heading, bestCost = 1e9;
    // (looking wider when the way ahead's barred: a rim or a face turns you along it)
    for (let a = -5; a <= 5 || (bestCost >= 60 && a <= 14); a++) {
      const k = a <= 5 ? a : (a % 2 ? 1 : -1) * (6 + Math.floor((a - 6) / 2)) ;
      const ang = this.heading + k * 0.11, dx = Math.sin(ang), dz = Math.cos(ang);
      let cost = Math.abs(k) * 0.5;
      for (const c of near) {
        const rx = c.x - this.x, rz = c.z - this.z, al = rx * dx + rz * dz, lat = Math.abs(-rx * dz + rz * dx);
        if (al > 0 && al < 5.5 && lat < 0.42 + c.r) cost += (5.5 - al) * 1.4;
      }
      const rise = this.groundAt(this.x + dx * 1.4, this.z + dz * 1.4) - here;
      if (rise > 0.9 && !this.onTrail) cost += 60; // (a rock face)
      if (rise < -3.2) cost += 60; // (a drop too far to take)
      if (cost < bestCost) { bestCost = cost; best = ang; }
    }
    this.move += wrap(best - this.move) * Math.min(1, dt * 6);
    // (turned aside by a rim, you go on that way: the heading follows)
    if (Math.abs(wrap(best - this.heading)) > 0.6 && bestCost < 60) this.heading += wrap(best - this.heading) * Math.min(1, dt * 1.5);
    // (the pace)
    const dx = Math.sin(this.move), dz = Math.cos(this.move), grade = (this.groundAt(this.x + dx * 2, this.z + dz * 2) - here) / 2;
    let target = input.go ? LOPE * (1 - Math.min(0.6, Math.max(0, grade)) * 0.9) * (1 + Math.min(0.35, Math.max(0, -grade)) * 0.5) * (this.onTrail ? 1.08 : 1) : 0;
    this.stopped = bestCost >= 60;
    if (this.stopped) target = 0;
    else if (bestCost > 8) target *= 0.7;
    this.v += (target - this.v) * Math.min(1, dt * (target > this.v ? 2.2 : 3));
    // (never through a culm: if one's right there, slip past it)
    let nx = this.x + dx * this.v * dt, nz = this.z + dz * this.v * dt;
    for (const c of near) { const ox = nx - c.x, oz = nz - c.z, d = Math.hypot(ox, oz), m = 0.32 + c.r; if (d < m && d > 1e-4) { nx = c.x + (ox / d) * m; nz = c.z + (oz / d) * m; } }
    this.x = nx; this.z = nz;
    this.turn = this.turn * 0.9 + wrap(best - this.move) * 0.1;
    // (the ground: follow it; over a drop, off it, and down)
    const g = this.groundAt(this.x, this.z), onStair = this.world.tread(this.x, this.z) !== null;
    if (this.air) {
      this.vy -= 9.8 * dt; this.y += this.vy * dt;
      if (this.y <= g) { this.dip = Math.min(0.35, -this.vy * 0.05); this.y = g; this.air = false; this.vy = 0; this.onStep(false, 1.6); }
    } else if (g < this.y - 0.45 && this.v > 1.5 && !onStair) { this.air = true; this.vy = 1.6; }
    else this.y += (g - this.y) * Math.min(1, dt * (onStair ? 14 : 10));
    this.dip *= 1 - Math.min(1, dt * 5);
    // (the stride)
    const stride = onStair ? 0.8 : 2.2, before = this.phase;
    if (!this.air) this.phase += (this.v * dt) / stride;
    if (Math.floor(this.phase) !== Math.floor(before)) this.onStep(onStair, 0.5 + this.v / LOPE);
  }
}
