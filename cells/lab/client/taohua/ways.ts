/**
 * Taohua: the ways up the hill. No one path: a hillside crossed by ways, meeting and parting, that
 * the walker takes one of and then another, choosing as they go. Just a journey.
 *
 * The hill comes first: it rises up the slope (z), gently in some bands and steeply in others, the
 * same all across it (x). On it, junctions in rows up the hill, one to three in a row, each row a
 * dozen metres or so above the last; between one row and the next, ways, each from a junction
 * below to one above, bending as it goes, so that every junction can be reached and none of the
 * ways cross: where a row has more junctions than the last, the way forks; fewer, they meet. Each
 * way takes the hill's height as it goes: where its going is steep (the hill steep there, or the
 * way heading straight up it) it climbs in steps; where it's gentle, it's a trail. On forever, made
 * as far ahead as it's needed, from the seed: the same seed, the same hillside.
 *
 * World: y up; z up the hill; x across it.
 */
import { hash, noise1, seeded } from '../kit/rng';

export type V3 = [number, number, number];

/** a way's width; a step's rise; a gate's terrace's depth */
export const WIDTH = 1.9, RISE = 0.16, TERRACE = 7.2;
/** temples beside a way (-1 left, +1 right of its going) */
export const BESIDE_L = -1, BESIDE_R = 1;

export interface Junction { id: string; row: number; k: number; x: number; z: number; y: number; gate: boolean; face: [number, number] }
/** a stretch of a way that climbs in steps: from u0 to u1 along it, so many steps */
export interface StairRun { u0: number; u1: number; n: number; h0: number; h1: number }
export interface Way {
  id: string; row: number; from: Junction; to: Junction;
  /** its curve across the ground (a, c, b; their heights the hill's); and where it truly starts and ends (a0, b1), straight to and from the curve (through a gate's terrace: straight up its stair, straight on down its back) */
  a: V3; c: V3; b: V3; a0: V3; b1: V3; head: number; tail: number;
  /** its length across the ground (all of it); how far along its curve each of its samples is */
  len: number; samp: Float64Array;
  /** where it climbs in steps */
  stairs: StairRun[];
  /** a temple beside it, which side, and how far along (0: none) */
  temple: number; templeU: number;
  /** its extent across the ground */
  box: [number, number, number, number];
  /** (its line across the ground, as points (x, z) and how far along each is: for nearness) */
  pts: Float64Array;
}
export interface Near { d: number; w: Way; u: number; p: V3 }

const N = 40;
const bez = (a: V3, c: V3, b: V3, t: number): V3 => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
};
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Ways {
  constructor(readonly seed: number) {}

  // ─── the hill ──────────────────────────────────────────────────────────────────────────────────
  /** how steeply the hill rises at z: mostly gently, in bands steeply */
  slope(z: number): number {
    if (z < 0) return 0.12;
    const n = noise1(hash(this.seed, 0x51), z / 30) * 0.65 + noise1(hash(this.seed, 0x52), z / 11) * 0.35;
    return 0.05 + 0.28 * smooth(0.42, 0.85, n);
  }
  private hillT: number[] = [0];
  /** The hill's height at z (the same all across it): its slope, summed up the hill. */
  hill(z: number): number {
    if (z <= 0) return z * 0.12;
    const D = 0.25, T = this.hillT;
    while ((T.length - 1) * D < z + D) { const z0 = (T.length - 1) * D; T.push(T[T.length - 1] + this.slope(z0 + D / 2) * D); }
    const i = Math.floor(z / D), f = z / D - i;
    return T[i] + (T[i + 1] - T[i]) * f;
  }

  // ─── the junctions, in rows ────────────────────────────────────────────────────────────────────
  private rowZ: number[] = [2];
  private rows: Junction[][] = [];
  /** the z of row k */
  zOf(k: number): number {
    while (this.rowZ.length <= k) { const r = seeded(hash(this.seed, this.rowZ.length, 0x20)); this.rowZ.push(this.rowZ[this.rowZ.length - 1] + (this.rowZ.length < 2 ? 16 : 34 + r() * 30)); }
    return this.rowZ[k];
  }
  /** the row nearest below z (or 0) */
  rowBelow(z: number): number {
    let hi = this.rowZ.length - 1;
    while (this.zOf(hi) <= z) hi = hi * 2 + 1;
    let lo = 0;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.rowZ[m] <= z) lo = m; else hi = m - 1; }
    return lo;
  }
  row(k: number): Junction[] {
    while (this.rows.length <= k) this.rows.push(this.makeRow(this.rows.length));
    return this.rows[k];
  }
  private makeRow(k: number): Junction[] {
    const r = seeded(hash(this.seed, k, 0x21));
    const z = this.zOf(k), y = this.hill(z);
    const J = (i: number, x: number): Junction => ({ id: `${k}.${i}`, row: k, k: i, x, z, y, gate: false, face: [0, -1] });
    if (k < 2) return [J(0, k === 0 ? 0 : (r() - 0.5) * 10)];
    // (how many: one, often; two, often; three, now and then; spread far across the hill, each row
    // drifting on from the last, unequal gaps between; drawn back a little if it's wandered far)
    const prev = this.rows[k - 1];
    const mid = prev.reduce((a, j) => a + j.x, 0) / prev.length;
    const n = r() < 0.4 ? 1 : r() < 0.75 ? 2 : 3;
    const m = mid + (r() - 0.5) * 50 - mid * (Math.abs(mid) > 40 ? 0.5 : 0.2);
    const xs: number[] = [];
    let x = m - ((n - 1) / 2) * 32;
    for (let i = 0; i < n; i++) { xs.push(x + (r() - 0.5) * 10); x += 18 + r() * 34; }
    return xs.map((x, i) => J(i, x));
  }

  // ─── the ways between rows ─────────────────────────────────────────────────────────────────────
  private between: Way[][] = [];
  /** The ways from row k up to row k+1. */
  waysUp(k: number): Way[] {
    while (this.between.length <= k) this.between.push(this.makeWays(this.between.length));
    return this.between[k];
  }
  private makeWays(k: number): Way[] {
    const A = this.row(k), B = this.row(k + 1);
    const r = seeded(hash(this.seed, k, 0x22));
    // (every junction reached, none crossing: walked across both rows together, left to right)
    let pairs: Array<[number, number]> = [[0, 0]];
    let i = 0, j = 0;
    while (i < A.length - 1 || j < B.length - 1) {
      if (i === A.length - 1) j++;
      else if (j === B.length - 1) i++;
      else if (A[i + 1].x < B[j + 1].x) i++;
      else j++;
      pairs.push([i, j]);
    }
    // (a crossing way, where both its ends have others, is left out more often than not)
    const deg = (side: 0 | 1, n: number) => pairs.filter((p) => p[side] === n).length;
    pairs = pairs.filter((p) => !(deg(0, p[0]) > 1 && deg(1, p[1]) > 1 && r() < 0.6));
    // (now and then a junction alone in its row is a temple's gate: the ways come up to its front, and go on from its back)
    const gateAt = (jn: Junction) => jn.row >= 3 && hash(this.seed, jn.row, 0x7e) % 6 === 0;
    if (B.length === 1 && gateAt(B[0])) {
      // (its front toward where the ways come up from, and down the hill)
      const mx = A.reduce((t, jn) => t + jn.x, 0) / A.length;
      B[0].gate = true; B[0].face = norm2([(mx - B[0].x) * 0.5, -1]);
    }
    const shape = (w: Way, c: V3) => {
      const { a, b, a0, b1 } = w;
      c[1] = this.hill(c[2]);
      w.c = c;
      const head = Math.hypot(a[0] - a0[0], a[2] - a0[2]), tail = Math.hypot(b1[0] - b[0], b1[2] - b[2]);
      w.head = head; w.tail = tail;
      w.box = [Math.min(a0[0], a[0], b[0], c[0], b1[0]), Math.max(a0[0], a[0], b[0], c[0], b1[0]), Math.min(a0[2], a[2]), Math.max(b[2], b1[2])];
      let len = 0, q = a;
      for (let t = 1; t <= N; t++) { const p = bez(a, c, b, t / N); len += Math.hypot(p[0] - q[0], p[2] - q[2]); w.samp[t] = len; q = p; }
      w.len = head + len + tail;
      // (its line, for nearness: the straight in, the curve's samples, the straight out)
      const P: number[] = [];
      if (head > 0) P.push(a0[0], a0[2], 0);
      for (let t = 0; t <= N; t++) { const p = bez(a, c, b, t / N); P.push(p[0], p[2], head + w.samp[t]); }
      if (tail > 0) P.push(b1[0], b1[2], w.len);
      w.pts = new Float64Array(P);
    };
    const made = pairs.map(([i, j]) => {
      const from = A[i], to = B[j];
      // (through a gate: its curve ends at the foot of the gate's front stair, and goes straight from there up through the hall; from a gate, straight from the hall down its back first)
      const G = TERRACE / 2 + 1.8;
      const a0: V3 = [from.x, from.y, from.z], b1: V3 = [to.x, to.y, to.z];
      const a: V3 = from.gate ? [from.x - from.face[0] * G, 0, from.z - from.face[1] * G] : [...a0];
      const b: V3 = to.gate ? [to.x + to.face[0] * G, 0, to.z + to.face[1] * G] : [...b1];
      a[1] = this.hill(a[2]); b[1] = this.hill(b[2]);
      const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
      // (it bends: its middle pushed to one side, but never back down the hill; where it shares a
      // junction with another way, only a little, and outward, away from its neighbours, so no two cross)
      const shared = pairs.filter((p) => p[0] === i || p[1] === j).length > 1;
      const mx = pairs.reduce((t, p) => t + (A[p[0]].x + B[p[1]].x) / 2, 0) / pairs.length;
      const out = Math.sign((from.x + to.x) / 2 - mx) || (r() < 0.5 ? -1 : 1);
      const bend = shared ? -out * Math.sign(dz) * (0.04 + r() * 0.1) * L : (r() - 0.5) * 0.5 * L;
      let c: V3 = [(a[0] + b[0]) / 2 + (dz / L) * bend, 0, (a[2] + b[2]) / 2 - (dx / L) * bend];
      c[2] = Math.max(a[2] + 1.5, Math.min(b[2] - 1.5, c[2]));
      // (into and out of a gate, its curve meets the straight on its line)
      if (to.gate) { const f = to.face; c = [b[0] + f[0] * dz * 0.45, 0, b[2] + f[1] * dz * 0.45]; }
      if (from.gate) c = [a[0] - from.face[0] * dz * 0.45, 0, a[2] - from.face[1] * dz * 0.45];
      c[2] = Math.max(a[2] + 0.5, Math.min(b[2] - 0.5, c[2]));
      const w: Way = { id: `${from.id}-${to.k}`, row: k, from, to, a, c, b, a0, b1, head: 0, tail: 0, len: 0, samp: new Float64Array(N + 1), stairs: [], temple: 0, templeU: 0, pts: new Float64Array(0), box: [0, 0, 0, 0] };
      shape(w, c);
      return w;
    });
    // (and if, for all that, two of them cross, they're both laid straight: straight ways from the
    // same two rows, none crossing at their ends, can't)
    for (let x = 0; x < made.length; x++) for (let y = x + 1; y < made.length; y++) if (crosses(made[x], made[y])) {
      for (const w of [made[x], made[y]]) shape(w, [(w.a[0] + w.b[0]) / 2, 0, (w.a[2] + w.b[2]) / 2]);
    }
    return made.map((w) => {
      const j = w.to.k;
      w.stairs = this.stairsOf(w);
      // (a temple beside it, now and then, where it runs long and level enough for its terrace)
      if (hash(this.seed, k, j, 0x7f) % 6 === 0 && !w.from.gate && !w.to.gate) {
        const flat = this.flatStretch(w);
        if (flat) { w.temple = r() < 0.5 ? BESIDE_L : BESIDE_R; w.templeU = flat; }
      }
      return w;
    });
  }
  /** Where along a way it climbs in steps: where its height, as the hill gives it, rises steeply for its going. */
  private stairsOf(w: Way): StairRun[] {
    const steep: boolean[] = [];
    const M = 48;
    for (let i = 0; i < M; i++) {
      const u0 = (i / M) * w.len, u1 = ((i + 1) / M) * w.len;
      const h0 = this.hill(this.at(w, u0, true).p[2]), h1 = this.hill(this.at(w, u1, true).p[2]);
      steep.push((h1 - h0) / (u1 - u0) > 0.13);
    }
    // (runs of steep: short gentle gaps in a stair taken into it; short steep bits left as trail)
    const runs: StairRun[] = [];
    let i = 0;
    while (i < M) {
      if (!steep[i]) { i++; continue; }
      let j = i;
      while (j < M && (steep[j] || (j + 2 < M && steep[j + 1] && steep[j + 2]))) j++;
      const u0 = (i / M) * w.len, u1 = (j / M) * w.len;
      const h0 = this.hill(this.at(w, u0, true).p[2]), h1 = this.hill(this.at(w, u1, true).p[2]);
      const n = Math.round((h1 - h0) / RISE);
      if (u1 - u0 > 1.2 && n >= 3) runs.push({ u0, u1, n, h0, h1 });
      i = j;
    }
    return runs;
  }
  /** a stretch of a way with no steps for ten metres, its middle (for a temple's terrace beside it) */
  private flatStretch(w: Way): number {
    let last = 0;
    for (const s of [...w.stairs, { u0: w.len, u1: w.len }]) { if (s.u0 - last > 10) return (last + s.u0) / 2; last = s.u1; }
    return 0;
  }

  /** The ways that run between z0 and z1. */
  waysNear(z0: number, z1: number): Way[] {
    const out: Way[] = [];
    for (let k = Math.max(0, this.rowBelow(z0) - 1); this.zOf(k) < z1 + 1; k++) for (const w of this.waysUp(k)) if (w.b[2] > z0 && w.a[2] < z1) out.push(w);
    return out;
  }
  /** The ways in and out of a junction: those coming up into it, those going on up from it. */
  into(j: Junction): Way[] { return j.row === 0 ? [] : this.waysUp(j.row - 1).filter((w) => w.to === j); }
  outOf(j: Junction): Way[] { return this.waysUp(j.row).filter((w) => w.from === j); }
  /** A way by its name (as the address keeps it). */
  byId(id: string): Way | null {
    const k = Number(id.split('.')[0]);
    if (!Number.isFinite(k) || k < 0 || k > 100000) return null;
    return this.waysUp(k).find((w) => w.id === id) ?? null;
  }

  // ─── along a way ───────────────────────────────────────────────────────────────────────────────
  /** A way's t on its curve, so far along it. */
  tAt(w: Way, u: number): number {
    const S = w.samp;
    u -= w.head;
    if (u <= 0) return 0;
    if (u >= S[N]) return 1;
    let k = 1;
    while (S[k] < u) k++;
    return (k - 1 + (u - S[k - 1]) / (S[k] - S[k - 1] || 1)) / N;
  }
  /** Where a way is, so far along it: its middle, standing on it (on a step, the step's tread), and its going there. `bare`: the curve only. */
  at(w: Way, u: number, bare = false): { p: V3; dir: [number, number] } {
    const straight = (p0: V3, p1: V3, f: number) => {
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1;
      const p: V3 = [p0[0] + dx * f, 0, p0[2] + dz * f];
      p[1] = bare ? this.hill(p[2]) : this.surface(w, u, p[2]);
      return { p, dir: [dx / l, dz / l] as [number, number] };
    };
    if (w.head > 0 && u < w.head) return straight(w.a0, w.a, Math.max(0, u / w.head));
    if (w.tail > 0 && u > w.len - w.tail) return straight(w.b, w.b1, Math.min(1, (u - (w.len - w.tail)) / w.tail));
    const t = this.tAt(w, u);
    const p = bez(w.a, w.c, w.b, t), p2 = bez(w.a, w.c, w.b, Math.min(1, t + 0.01)), p1 = bez(w.a, w.c, w.b, Math.max(0, t - 0.01));
    const dx = p2[0] - p1[0], dz = p2[2] - p1[2], l = Math.hypot(dx, dz) || 1;
    if (!bare) p[1] = this.surface(w, u, p[2]);
    return { p, dir: [dx / l, dz / l] };
  }
  /** The height one stands at on a way, so far along it: on a stair, the tread; else the hill. */
  surface(w: Way, u: number, z?: number): number {
    for (const s of w.stairs) if (u >= s.u0 && u < s.u1) {
      const k = Math.min(s.n - 1, Math.floor(((u - s.u0) / (s.u1 - s.u0)) * s.n));
      return s.h0 + ((k + 1) / s.n) * (s.h1 - s.h0);
    }
    return this.hill(z ?? this.at(w, u, true).p[2]);
  }
  /** On a stair there? */
  stairAt(w: Way, u: number): StairRun | null {
    for (const s of w.stairs) if (u >= s.u0 && u < s.u1) return s;
    return null;
  }

  // ─── nearness ──────────────────────────────────────────────────────────────────────────────────
  private near = new Map<number, Near>();
  /** How far a point (x, z) is from the nearest way's middle line, across the ground, and where on it. */
  nearest(x: number, z: number): Near {
    // (asked for again and again about the same places as the hill is made: remembered, to a hand's breadth)
    const key = Math.round(x * 8) * 4194304 + Math.round(z * 8);
    const got = this.near.get(key);
    if (got) return got;
    if (this.near.size > 400000) this.near.clear();
    let best = Infinity, bw: Way | null = null, bu = 0;
    for (let R = 18; !bw || best > R; R *= 2) {
      for (const w of this.waysNear(z - R, z + R)) {
        const bx = w.box;
        if (x < bx[0] - best || x > bx[1] + best || z < bx[2] - best || z > bx[3] + best) continue;
        const P = w.pts;
        for (let i = 3; i < P.length; i += 3) {
          const qx = P[i - 3], qz = P[i - 2], dx = P[i] - qx, dz = P[i + 1] - qz, L2 = dx * dx + dz * dz || 1;
          let t = ((x - qx) * dx + (z - qz) * dz) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - qx - dx * t, ez = z - qz - dz * t, d2 = ex * ex + ez * ez;
          if (d2 < best * best) { best = Math.sqrt(d2); bw = w; bu = P[i - 1] + t * (P[i + 2] - P[i - 1]); }
        }
      }
      if (R > 200) break;
    }
    const out: Near = { d: best, w: bw!, u: bu, p: this.at(bw!, bu, true).p };
    this.near.set(key, out);
    return out;
  }

  // ─── the journey: from where one is to where one would be ──────────────────────────────────────
  /**
   * The way from (w, u) to (gw, gu), as legs along ways: each a way and from where along it to
   * where. Through the junctions, the shortest across the ground (up or down the hill, as needed).
   */
  route(w: Way, u: number, gw: Way, gu: number): Array<{ w: Way; u0: number; u1: number }> {
    if (w === gw) return [{ w, u0: u, u1: gu }];
    // (the junctions about the two, and the ways between them)
    const lo = Math.max(0, Math.min(w.row, gw.row) - 3), hi = Math.max(w.row, gw.row) + 4;
    const dist = new Map<Junction, number>(), via = new Map<Junction, Way>();
    const todo: Junction[] = [];
    const seed = (j: Junction, d: number) => { if (d < (dist.get(j) ?? Infinity)) { dist.set(j, d); todo.push(j); } };
    seed(w.from, u); seed(w.to, w.len - u);
    via.set(w.from, w); via.set(w.to, w);
    while (todo.length) {
      todo.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const j = todo.shift()!, d = dist.get(j)!;
      for (const e of [...this.into(j), ...this.outOf(j)]) {
        if (e === w || e.row < lo || e.row > hi) continue;
        const o = e.from === j ? e.to : e.from;
        if (d + e.len < (dist.get(o) ?? Infinity)) { dist.set(o, d + e.len); via.set(o, e); todo.push(o); }
      }
    }
    // (into the goal's way from whichever end is nearer, all told)
    const viaFrom = (dist.get(gw.from) ?? Infinity) + gu, viaTo = (dist.get(gw.to) ?? Infinity) + (gw.len - gu);
    const end = viaFrom <= viaTo ? gw.from : gw.to;
    if (!Number.isFinite(Math.min(viaFrom, viaTo))) return [];
    // (back from that end to where one is, junction by junction)
    const legs: Array<{ w: Way; u0: number; u1: number }> = [{ w: gw, u0: end === gw.from ? 0 : gw.len, u1: gu }];
    let j = end;
    for (let guard = 0; guard < 200; guard++) {
      const e = via.get(j)!;
      if (e === w) { legs.unshift({ w, u0: u, u1: j === w.from ? 0 : w.len }); break; }
      const o = e.from === j ? e.to : e.from;
      legs.unshift({ w: e, u0: e.from === o ? 0 : e.len, u1: e.from === o ? e.len : 0 });
      j = o;
    }
    return legs;
  }
}
/** whether two ways' lines cross, away from their ends */
function crosses(u: Way, v: Way): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  const A = u.pts, B = v.pts;
  for (let i = 3; i + 3 < A.length; i += 3) for (let j = 3; j + 3 < B.length; j += 3) {
    const [ax, az, bx, bz, cx, cz, dx, dz] = [A[i], A[i + 1], A[i + 3], A[i + 4], B[j], B[j + 1], B[j + 3], B[j + 4]];
    if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) return true;
  }
  return false;
}
const norm2 = (v: [number, number]): [number, number] => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
