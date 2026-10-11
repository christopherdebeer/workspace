/**
 * Squishy: a jelly to land on. A round jelly whose top is a membrane: nodes on rings and spokes,
 * each held to its rest height by a spring, damped, and drawn toward its neighbours (so a dent
 * spreads, and ripples). The dumpling pushes it down where it presses, and it pushes back: a
 * landing dents it, the dent springs back, and if it springs back slower than the dumpling
 * settles, it throws the dumpling up again, unasked. Edges tilt under it. It keeps its own clock,
 * so however many things step it, it moves once.
 */
import type { Hit } from './level';

/** How a jelly gives: how fast its top springs back (Hz), how much of each wobble it keeps, how heavy it is (the dumpling is 1), how far a dent spreads (Hz). */
export interface JellyFeel { hz: number; zeta: number; mass: number; spread: number }
/**
 * The kinds: a panna cotta (it dents, and that's all), a mango pudding (lively: a hard landing comes
 * back as a little hop), a konjac jelly (springy: it throws you up again, a good way). A jelly has to
 * spring back quickly to throw anything: only a top that turns round faster than falling (its
 * dent × (2π hz)² over g) leaves what's on it behind.
 */
export const FEELS = {
  pannacotta: { hz: 5, zeta: 0.25, mass: 15, spread: 4 },
  pudding: { hz: 7, zeta: 0.06, mass: 15, spread: 3 },
  konjac: { hz: 14, zeta: 0.05, mass: 12, spread: 2 },
  // (a loaf: soft under its crust, and dead)
  boule: { hz: 6, zeta: 0.4, mass: 20, spread: 3 },
} satisfies Record<string, JellyFeel>;

export interface Jel {
  /** its middle, its foot, its top at rest (in the middle), its radius; and how far its top falls away to its rim at rest (a loaf's dome) */
  cx: number; cz: number; base: number; top: number; rad: number; dome: number;
  /** rings out from the middle, spokes round */
  R: number; S: number;
  /** each node's height off its rest (cm) and how fast it's going: the middle, then ring by ring */
  z: Float32Array; w: Float32Array;
  /** each node's neighbours (CSR) */
  nbrStart: Int32Array; nbr: Int32Array;
  feel: JellyFeel;
  /** its own time */
  t: number;
}
const STEP = 1 / 600;
/** how far its top can go: down (of its height), and up (cm) */
const DOWN = 0.55, UP = 3;
/** how much more a pressed node is damped, each press */
export let LOADED = 0.0015;
export const setLoaded = (v: number) => { LOADED = v; };

export function makeJel(cx: number, cz: number, rad: number, base: number, top: number, feel: JellyFeel, dome = 0, R = 7, S = 24): Jel {
  const N = 1 + R * S;
  const lists: number[][] = Array.from({ length: N }, () => []);
  const id = (i: number, j: number) => (i === 0 ? 0 : 1 + (i - 1) * S + (((j % S) + S) % S));
  for (let j = 0; j < S; j++) { lists[0].push(id(1, j)); }
  for (let i = 1; i <= R; i++) for (let j = 0; j < S; j++) {
    const k = id(i, j), l = lists[k];
    l.push(id(i, j - 1), id(i, j + 1), i === 1 ? 0 : id(i - 1, j));
    if (i < R) l.push(id(i + 1, j));
  }
  const nbrStart = new Int32Array(N + 1), flat: number[] = [];
  for (let k = 0; k < N; k++) { nbrStart[k] = flat.length; flat.push(...lists[k]); }
  nbrStart[N] = flat.length;
  return { cx, cz, base, top, rad, dome, R, S, z: new Float32Array(N), w: new Float32Array(N), nbrStart, nbr: Int32Array.from(flat), feel: { ...feel }, t: -1 };
}

/** The nodes about a point and how much each counts (up to four), into idx/wt; how many. */
const idx = new Int32Array(4), wt = new Float32Array(4);
function about(j: Jel, dx: number, dz: number): number {
  const rr = Math.min(Math.hypot(dx, dz), j.rad);
  const fr = (rr / j.rad) * j.R;
  const i0 = Math.min(j.R - 1, Math.floor(fr)), a = fr - i0;
  let th = Math.atan2(dz, dx) / (Math.PI * 2);
  if (th < 0) th += 1;
  const fs = th * j.S, s0 = Math.floor(fs) % j.S, b = fs - Math.floor(fs), s1 = (s0 + 1) % j.S;
  const ring = (i: number, s: number) => 1 + (i - 1) * j.S + s;
  let n = 0;
  if (i0 === 0) { idx[n] = 0; wt[n++] = 1 - a; }
  else { idx[n] = ring(i0, s0); wt[n++] = (1 - a) * (1 - b); idx[n] = ring(i0, s1); wt[n++] = (1 - a) * b; }
  idx[n] = ring(i0 + 1, s0); wt[n++] = a * (1 - b);
  idx[n] = ring(i0 + 1, s1); wt[n++] = a * b;
  return n;
}
/** Its top's height at a point (from its middle), off its middle's rest height: its dome, and where the membrane has it. */
export function surfAt(j: Jel, dx: number, dz: number): number {
  const q = Math.min(1, (dx * dx + dz * dz) / (j.rad * j.rad));
  return heightAt(j, dx, dz) - j.dome * q;
}
/** The membrane's height off rest at a point (from its middle). */
export function heightAt(j: Jel, dx: number, dz: number): number {
  const n = about(j, dx, dz);
  let h = 0;
  for (let k = 0; k < n; k++) h += j.z[idx[k]] * wt[k];
  return h;
}
function speedAt(j: Jel, dx: number, dz: number): number {
  const n = about(j, dx, dz);
  let v = 0;
  for (let k = 0; k < n; k++) v += j.w[idx[k]] * wt[k];
  return v;
}
/** Pushed down at a point (world x, z), by so much momentum (the dumpling's mass × cm/s). */
export function pressJel(j: Jel, x: number, z: number, impulse: number) {
  const n = about(j, x - j.cx, z - j.cz);
  const m = j.feel.mass / j.z.length;
  // (and where it's pressed, it's damped a little more: what sits on a jelly settles, rather than the two of them humming on)
  for (let k = 0; k < n; k++) { j.w[idx[k]] -= (impulse * wt[k]) / m; j.w[idx[k]] *= 1 - LOADED * wt[k]; }
}
/** On to time t, in its own fixed steps. */
export function stepJel(j: Jel, t: number) {
  // (first, after a long gap, or a clock started again: from now)
  if (j.t < 0 || t - j.t > 0.25 || t < j.t) j.t = t;
  const K = (2 * Math.PI * j.feel.hz) ** 2, C = 2 * j.feel.zeta * 2 * Math.PI * j.feel.hz, P = (2 * Math.PI * j.feel.spread) ** 2;
  const lo = -DOWN * (j.top - j.base);
  const { z, w, nbrStart, nbr } = j, N = z.length;
  while (j.t + STEP <= t) {
    j.t += STEP;
    for (let k = 0; k < N; k++) {
      let s = 0;
      const a0 = nbrStart[k], a1 = nbrStart[k + 1];
      for (let q = a0; q < a1; q++) s += z[nbr[q]];
      const lap = s / (a1 - a0) - z[k];
      w[k] += (-K * z[k] - C * w[k] + P * lap) * STEP;
    }
    for (let k = 0; k < N; k++) {
      z[k] += w[k] * STEP;
      if (z[k] < lo) { z[k] = lo; if (w[k] < 0) w[k] = 0; }
      else if (z[k] > UP) { z[k] = UP; if (w[k] > 0) w[k] = 0; }
    }
  }
}
/** Its highest point now (for its bounds). */
export function jelTop(j: Jel): number { let m = 0; for (let k = 0; k < j.z.length; k++) m = Math.max(m, j.z[k]); return j.top + m; }

/**
 * A point with a skin of s against the jelly: over its top, pushed out along the top as it is
 * there (tilted where it's dented); inside it, out the nearest way; round its side and its rim,
 * as a cylinder whose rim is where the top's edge is now. The top's speed comes with it.
 */
export function touchJel(j: Jel, px: number, py: number, pz: number, s: number, o: Hit, gap: number): boolean {
  o.vx = 0; o.vy = 0; o.vz = 0;
  const dx = px - j.cx, dz = pz - j.cz, rr = Math.hypot(dx, dz);
  const rx = rr > 1e-6 ? dx / rr : 1, rz = rr > 1e-6 ? dz / rr : 0;
  if (rr <= j.rad) {
    const ht = j.top + surfAt(j, dx, dz);
    if (py >= ht) {
      // (the top as it is here: its slope from either side)
      const e = 0.35;
      const gx = (surfAt(j, dx + e, dz) - surfAt(j, dx - e, dz)) / (2 * e), gz = (surfAt(j, dx, dz + e) - surfAt(j, dx, dz - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      const nx = -gx / l, ny = 1 / l, nz = -gz / l;
      const d = s - (py - ht) * ny;
      if (d < -gap) return false;
      o.nx = nx; o.ny = ny; o.nz = nz; o.d = d; o.vy = speedAt(j, dx, dz);
      return true;
    }
    if (py >= j.base) {
      const dTop = ht - py, dSide = j.rad - rr, dBot = py - j.base;
      if (dTop <= dSide && dTop <= dBot) { o.nx = 0; o.ny = 1; o.nz = 0; o.d = s + dTop; o.vy = speedAt(j, dx, dz); }
      else if (dSide <= dBot) { o.nx = rx; o.ny = 0; o.nz = rz; o.d = s + dSide; }
      else { o.nx = 0; o.ny = -1; o.nz = 0; o.d = s + dBot; }
      return true;
    }
    const d = s - (j.base - py);
    if (d < -gap) return false;
    o.nx = 0; o.ny = -1; o.nz = 0; o.d = d;
    return true;
  }
  const dr = rr - j.rad, rim = j.top + surfAt(j, dx, dz);
  const dh = py > rim ? py - rim : py < j.base ? py - j.base : 0;
  if (dh === 0) {
    if (dr > s + gap) return false;
    o.nx = rx; o.ny = 0; o.nz = rz; o.d = s - dr;
    return true;
  }
  const dist = Math.hypot(dr, dh);
  if (dist > s + gap) return false;
  o.nx = (rx * dr) / dist; o.ny = dh / dist; o.nz = (rz * dr) / dist; o.d = s - dist;
  if (dh > 0) o.vy = speedAt(j, dx, dz) * o.ny;
  return true;
}

/**
 * Its mesh as it is now, into out (VSTRIDE floats a vertex: position, normal, material, uv): its
 * top, each node where it is, lit by its slope; its side, up to where its rim is; a coat on its top
 * (mat, if any) just over it.
 */
export function jelMesh(j: Jel, out: Float32Array, mat: number, coat = 0): number {
  const { R, S, rad } = j;
  const P = (i: number, s: number): [number, number, number] => {
    const a = (s / S) * Math.PI * 2, r = (i / R) * rad;
    const k = i === 0 ? 0 : 1 + (i - 1) * S + (s % S);
    return [j.cx + Math.cos(a) * r, j.top + j.z[k] - j.dome * (i / R) ** 2, j.cz + Math.sin(a) * r];
  };
  const Nrm = (i: number, s: number): [number, number, number] => {
    const a = (s / S) * Math.PI * 2, r = (i / R) * rad;
    const dx = Math.cos(a) * r, dz = Math.sin(a) * r, e = 0.4;
    const gx = (surfAt(j, dx + e, dz) - surfAt(j, dx - e, dz)) / (2 * e), gz = (surfAt(j, dx, dz + e) - surfAt(j, dx, dz - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    return [-gx / l, 1 / l, -gz / l];
  };
  let o = 0;
  const put = (p: number[], n: number[], m: number, u: number, v: number) => {
    out[o++] = p[0]; out[o++] = p[1]; out[o++] = p[2]; out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2]; out[o++] = m; out[o++] = u; out[o++] = v;
  };
  const uv = (p: number[]) => [(p[0] - j.cx) / rad, (p[2] - j.cz) / rad];
  const top = (m: number, lift: number) => {
    const L = (p: number[], n: number[]) => [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift];
    for (let i = 0; i < R; i++) for (let s = 0; s < S; s++) {
      const a = P(i, s), b = P(i + 1, s), c = P(i + 1, s + 1), d = P(i, s + 1);
      const na = Nrm(i, s), nb = Nrm(i + 1, s), nc = Nrm(i + 1, s + 1), nd = Nrm(i, s + 1);
      const tri = (p: number[][], n: number[][]) => { for (let q = 0; q < 3; q++) { const pp = L(p[q], n[q]); const t = uv(pp); put(pp, n[q], m, t[0], t[1]); } };
      tri([a, c, b], [na, nc, nb]);
      tri([a, d, c], [na, nd, nc]);
    }
  };
  top(mat, 0);
  // its side, down from its rim as it is
  for (let s = 0; s < S; s++) {
    const a0 = (s / S) * Math.PI * 2, a1 = ((s + 1) / S) * Math.PI * 2;
    const r0 = P(R, s), r1 = P(R, s + 1);
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    const b0 = [r0[0], j.base, r0[2]], b1 = [r1[0], j.base, r1[2]];
    put(b0, n0, mat, a0 * rad, j.base); put(r0, n0, mat, a0 * rad, r0[1]); put(r1, n1, mat, a1 * rad, r1[1]);
    put(b0, n0, mat, a0 * rad, j.base); put(r1, n1, mat, a1 * rad, r1[1]); put(b1, n1, mat, a1 * rad, j.base);
  }
  if (coat) top(coat, 0.06);
  return o;
}
/** how many floats its mesh takes */
export const jelMeshSize = (j: Jel, coat = 0) => (j.R * j.S * 6 * (coat ? 2 : 1) + j.S * 6) * 9;
