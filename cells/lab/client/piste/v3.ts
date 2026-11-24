/** Small vector helpers: `V` is a plain [x, y, z]. The hot loops (the blade) work on flat arrays instead. */
export type V = [number, number, number];
export const v = (x = 0, y = 0, z = 0): V => [x, y, z];
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V, b: V, s: number): V => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a: V): V => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
export const smooth = (t: number) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
/** rotate `a` about unit axis `k` by angle `t` (Rodrigues) */
export function rot(a: V, k: V, t: number): V {
  const c = Math.cos(t), s = Math.sin(t), d = dot(k, a) * (1 - c), x = cross(k, a);
  return [a[0] * c + x[0] * s + k[0] * d, a[1] * c + x[1] * s + k[1] * d, a[2] * c + x[2] * s + k[2] * d];
}

/** A fencer's frame on the piste: forward toward the opponent, up, and their own right (weapon side for a right-hander). */
export interface Frame { o: V; f: V; u: V; r: V }
/** local (forward, up, right) to world */
export const toWorld = (F: Frame, a: number, b: number, c: number): V => [
  F.o[0] + F.f[0] * a + F.u[0] * b + F.r[0] * c,
  F.o[1] + F.f[1] * a + F.u[1] * b + F.r[1] * c,
  F.o[2] + F.f[2] * a + F.u[2] * b + F.r[2] * c,
];
/** a direction in local (forward, up, right) to world */
export const dirWorld = (F: Frame, a: number, b: number, c: number): V => [
  F.f[0] * a + F.u[0] * b + F.r[0] * c, F.f[1] * a + F.u[1] * b + F.r[1] * c, F.f[2] * a + F.u[2] * b + F.r[2] * c,
];
/** world to local (forward, up, right) */
export const toLocal = (F: Frame, p: V): V => { const d = sub(p, F.o); return [dot(d, F.f), dot(d, F.u), dot(d, F.r)]; };

/**
 * Closest points between segments p1-q1 and p2-q2: the parameters (s on the first, t on the second) and the squared
 * distance. (Ericson, Real-Time Collision Detection, 5.1.9.)
 */
export function segSeg(p1: V, q1: V, p2: V, q2: V): { s: number; t: number; d2: number } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s: number, t: number;
  if (a < 1e-12 && e < 1e-12) { s = t = 0; }
  else if (a < 1e-12) { s = 0; t = clamp(f / e, 0, 1); }
  else {
    const c = dot(d1, r);
    if (e < 1e-12) { t = 0; s = clamp(-c / a, 0, 1); }
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > 1e-12 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = madd(p1, d1, s), c2 = madd(p2, d2, t), w = sub(c1, c2);
  return { s, t, d2: dot(w, w) };
}
/** closest parameter on segment a-b to point p */
export function segPoint(a: V, b: V, p: V): number {
  const ab = sub(b, a), l2 = dot(ab, ab);
  return l2 < 1e-12 ? 0 : clamp(dot(sub(p, a), ab) / l2, 0, 1);
}
