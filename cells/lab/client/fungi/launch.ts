/**
 * A hat-thrower's throw, as one event: everything that happens to a sporangium, from the moment
 * the vesicle bursts to where it ends up, in one record that the drawing, the residue, the
 * passenger and the camera all read.
 *
 * The sporangium leaves along the axis of the stalk's tip (the vesicle is a lens that has turned
 * it to the light), at about nine metres a second, pushed by a jet of the vesicle's sap. In the
 * air it's slowed hard by drag and pulled down by gravity. Its path is integrated in small steps
 * and tested against everything standing near (the other stalks and caps, as they are at that
 * moment): the first it touches, it sticks to — where it touched, how far up, which side. Else
 * it comes down on the dung, or (mostly) flies out of the scene, a metre or two into the grass.
 *
 * Positions are relative to the thrower's base, so a pat can be moved without moving its throws.
 */
import { hash, seeded } from '../kit/rng';
import { along, state, type Stalk, type V3 } from './genome';

export interface Launch {
  /** release: the sporangium's centre (relative to the base), its velocity (mm/s) */
  p0: V3;
  v0: V3;
  /** the path: [seconds since release, x, y, z] per sample, relative to the base */
  path: Float32Array;
  /** where it ended: on a stalk (which, how far up, round which side), the ground, or away */
  end: { kind: 'stalk' | 'bell' | 'ground' | 'away'; t: number; at: V3; host?: Stalk; s?: number; a?: number };
  /** its radius (mm) */
  r: number;
}

const G = 9810;
/** quadratic drag (1/mm): a sporangium's terminal speed is a couple of metres a second */
const K = 0.0024;
const REACH = 160;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** the closest two segments come: the distance, and how far along each (0..1) */
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3) {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s = 0;
  let t = 0;
  if (a <= 1e-9 && e <= 1e-9) return { d: Math.hypot(...r), s, t };
  if (a <= 1e-9) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = dot(d1, r);
    if (e <= 1e-9) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den !== 0 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { d: Math.hypot(...sub(c1, c2)), s, t, c2 };
}
/** the angle round a stalk's axis that `off` points (as the drawing's ring basis has it) */
function ringAngle(t: V3, dir: [number, number], off: V3) {
  const side: V3 = [-dir[1], 0, dir[0]];
  const x = nrm(cross(t, side));
  const y = cross(t, x);
  return Math.atan2(dot(off, y), dot(off, x));
}

/** The throw of `st` (a thrower's), among `standing` (everything up near it then). */
export function launch(st: Stalk, capFlat: number, standing: Stalk[], seed: number): Launch {
  const r = seeded(hash(seed, 0x7a0c));
  const T = st.tl;
  const s = state(st, T - 1e-4);
  const top = along(st, s, 1);
  const cr = st.cap;
  const rel = (p: V3): V3 => [p[0] - st.base[0], p[1] - st.base[1], p[2] - st.base[2]];
  const p0 = rel([top.p[0] + top.t[0] * cr * capFlat * 0.7, top.p[1] + top.t[1] * cr * capFlat * 0.7, top.p[2] + top.t[2] * cr * capFlat * 0.7]);
  const speed = 7000 + r() * 4000;
  const v0: V3 = [top.t[0] * speed, top.t[1] * speed, top.t[2] * speed];
  // the obstacles: what's standing near, as it is at that moment — a polyline each, a radius
  const obs: Array<{ o: Stalk; pts: V3[]; rad: number; bell: number; us: number[] }> = [];
  // (only what's near its line of flight is worth testing)
  const d0 = nrm(v0);
  const nearLine = (q: V3) => {
    const w = sub(q, p0);
    const t = dot(w, d0);
    return t > -5 && Math.hypot(...sub(w, [d0[0] * t, d0[1] * t, d0[2] * t])) < 12 + t * 0.15;
  };
  for (const o of standing) {
    if (o === st || T < o.t0 || T > o.tEnd) continue;
    if (Math.hypot(o.base[0] - st.base[0], o.base[2] - st.base[2]) > REACH) continue;
    const ob = rel(o.base);
    if (!nearLine(ob) && !nearLine([ob[0], ob[1] + o.len * 0.5, ob[2]]) && !nearLine([ob[0], ob[1] + o.len, ob[2]])) continue;
    const os = state(o, T);
    if (os.grown < 0.2 || os.thrown >= 0) continue;
    const us = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const pts = us.map((u) => rel(along(o, os, u).p));
    const rad = o.r * 1.2 + (o.ves ? o.ves * os.swell * 0.6 : 0);
    const bell = o.bell ? o.bell * (0.6 + 0.35 * os.open) : o.cap ? o.cap : 0;
    // (crowded together where it's released — in a clump, drawn through each other: not in its way)
    let touching = Math.hypot(...sub(pts[pts.length - 1], p0)) < bell + cr;
    for (let j = 0; j + 1 < pts.length; j++) if (segSeg(p0, p0, pts[j], pts[j + 1]).d < rad + cr) touching = true;
    if (touching) continue;
    obs.push({ o, pts, rad, bell, us });
  }
  const path: number[] = [0, ...p0];
  let p: V3 = [...p0];
  let v: V3 = [...v0];
  let t = 0;
  let end: Launch['end'] = { kind: 'away', t: 0, at: p0 };
  // (small steps while it's quick, longer as it slows)
  let last: V3 = [...p];
  let lastT = 0;
  for (let i = 0; i < 4000; i++) {
    const sp = Math.hypot(v[0], v[1], v[2]);
    const dt = Math.min(0.004, 1 / Math.max(sp, 1));
    const ax = -K * sp * v[0];
    const ay = -K * sp * v[1] - G;
    const az = -K * sp * v[2];
    const np: V3 = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    v = [v[0] + ax * dt, v[1] + ay * dt, v[2] + az * dt];
    t += dt;
    // what it touches on this step: the first along it
    let hit: Launch['end'] | null = null;
    let best = 2;
    for (const ob of obs) {
      for (let j = 0; j + 1 < ob.pts.length; j++) {
        const q = segSeg(p, np, ob.pts[j], ob.pts[j + 1]);
        if (q.d < ob.rad + cr && q.s < best) {
          best = q.s;
          const u = ob.us[j] + (ob.us[j + 1] - ob.us[j]) * q.t;
          const os = state(ob.o, T);
          const ax0 = along(ob.o, os, Math.max(0.01, Math.min(0.99, u)));
          const at: V3 = [p[0] + (np[0] - p[0]) * q.s, p[1] + (np[1] - p[1]) * q.s, p[2] + (np[2] - p[2]) * q.s];
          hit = { kind: 'stalk', t: t - dt + dt * q.s, at, host: ob.o, s: Math.max(0.05, Math.min(0.97, u)), a: ringAngle(ax0.t, ob.o.dir, nrm(sub(at, rel(ax0.p)))) };
        }
      }
      if (ob.bell > 0) {
        // (a cap or a bell at the top: a ball, near enough)
        const c = ob.pts[ob.pts.length - 1];
        const q = segSeg(p, np, c, c);
        if (q.d < ob.bell + cr && q.s < best) {
          best = q.s;
          const at: V3 = [p[0] + (np[0] - p[0]) * q.s, p[1] + (np[1] - p[1]) * q.s, p[2] + (np[2] - p[2]) * q.s];
          hit = { kind: 'bell', t: t - dt + dt * q.s, at, host: ob.o, s: 1, a: r() * Math.PI * 2 };
        }
      }
    }
    if (hit) {
      end = hit;
      path.push(end.t, ...end.at);
      break;
    }
    p = np;
    if (p[1] < cr * 0.5 && v[1] < 0) {
      end = { kind: 'ground', t, at: [p[0], 0, p[2]] };
      path.push(t, p[0], cr * 0.5, p[2]);
      break;
    }
    if (Math.hypot(p[0], p[2]) > REACH || p[1] > REACH) {
      end = { kind: 'away', t, at: p };
      path.push(t, ...p);
      break;
    }
    // (a sample every couple of millimetres)
    if (Math.hypot(...sub(p, last)) > 2 || t - lastT > 0.01) {
      path.push(t, ...p);
      last = [...p];
      lastT = t;
    }
  }
  return { p0, v0, path: Float32Array.from(path), end, r: cr };
}

/** Where the sporangium is, `tau` seconds after release (relative to the base); and its speed. */
export function capAlong(l: Launch, tau: number): { p: V3; v: number; done: boolean } {
  const P = l.path;
  const n = P.length / 4;
  if (tau >= P[(n - 1) * 4]) return { p: [P[(n - 1) * 4 + 1], P[(n - 1) * 4 + 2], P[(n - 1) * 4 + 3]], v: 0, done: true };
  let i = 0;
  while (i < n - 2 && P[(i + 1) * 4] < tau) i++;
  const t0 = P[i * 4];
  const t1 = P[(i + 1) * 4];
  const f = t1 > t0 ? (tau - t0) / (t1 - t0) : 0;
  const a: V3 = [P[i * 4 + 1], P[i * 4 + 2], P[i * 4 + 3]];
  const b: V3 = [P[(i + 1) * 4 + 1], P[(i + 1) * 4 + 2], P[(i + 1) * 4 + 3]];
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], v: Math.hypot(...sub(b, a)) / Math.max(1e-6, t1 - t0), done: false };
}
