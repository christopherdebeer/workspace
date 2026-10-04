/**
 * Soft stalks, and their collisions. A stalk is a turgid tube held at its foot: push it at the
 * top and it bends (as a cantilever does, u²(3 - u)/2 of the push at u), slender ones easily,
 * stout ones hardly. Each frame, for what's standing:
 *
 * - **the air** moves it a little (more in the field's breeze than under a lid), neighbours alike;
 * - **its own throw** kicks it back as the sporangium and the jet leave, and it rings, damped;
 * - **a sporangium hitting it** pushes it the way the sporangium was going, and it rings;
 * - **its neighbours**: where two would pass through each other (a stem through a cap, two
 *   sporangiophores in a clump) they're pushed apart, each by as much as it gives, and the
 *   stiffer gives less. A few rounds of this settle a clump.
 *
 * All of it follows from the hour and the clock alone (nothing's carried from frame to frame), so
 * a scrub lands on the same bends. The result is `st.bend`, which along() and the stalks' vertex
 * shader both read: what's stuck to a stalk, or riding it, goes where it's bent to.
 */
import { along, radius, state, type Stalk, type State, type V3 } from './genome';

/** A thing standing, for the solver: the stalk, and the size of what's on its top. */
export interface Soft {
  st: Stalk;
  /** the radius of its top's cap or bell (mm), as drawn */
  top: (s: State) => number;
}
interface Hit {
  t: number;
  dir: [number, number];
  s: number;
  m: number;
}
/** Where each throw ends on another stalk: the host's list of hits. */
export function hitsOf(list: Soft[]): Map<Stalk, Hit[]> {
  const hits = new Map<Stalk, Hit[]>();
  for (const { st } of list) {
    const l = st.launch;
    const h = l?.end.host;
    if (!l || !h) continue;
    // (the way it was going when it hit: its path's last step)
    const P = l.path;
    const n = P.length / 4;
    const dx = P[(n - 1) * 4 + 1] - P[(n - 2) * 4 + 1];
    const dz = P[(n - 1) * 4 + 3] - P[(n - 2) * 4 + 3];
    const d = Math.hypot(dx, dz) || 1;
    const e = hits.get(h) ?? [];
    e.push({ t: st.tl + l.end.t / 3600, dir: [dx / d, dz / d], s: l.end.s ?? 1, m: l.r });
    hits.set(h, e);
  }
  return hits;
}

const shape = (u: number) => (u * u * (3 - u)) / 2;
const US = [0.3, 0.55, 0.8, 1];

interface Live {
  st: Stalk;
  s: State;
  L: number;
  /** how much it gives (relative): a long thin one a lot */
  give: number;
  /** its top's extra radius */
  topR: number;
  pts: V3[];
  rs: number[];
  lo: [number, number, number];
  hi: [number, number, number];
}

/** Bend everything in `list` for hour T and clock `time` (s). `air`: how much the air moves (0..1).
 *  `near`: only these are tested against their neighbours (the rest just sway). */
export function soften(list: Soft[], hits: Map<Stalk, Hit[]>, T: number, time: number, air: number, near: (p: V3) => boolean) {
  const live: Live[] = [];
  for (const { st, top } of list) {
    st.bend = undefined;
    if (T < st.t0 || T > st.tEnd) continue;
    const s = state(st, T);
    if (s.grown <= 0.001) continue;
    const L = st.len * s.grown;
    const b: V3 = [0, 0, 0];
    // the air: slow and smooth, near ones together; the slender more
    const slender = Math.min(1.5, L / (st.r * 30));
    const ph = st.base[0] * 0.045 + st.base[2] * 0.03;
    const a = air * L * 0.025 * slender;
    b[0] += a * (Math.sin(time * 0.61 + ph) + 0.45 * Math.sin(time * 1.73 + ph * 2.1 + 1.3));
    b[2] += a * (Math.sin(time * 0.47 + ph * 1.3 + 2) + 0.45 * Math.sin(time * 1.37 + ph * 1.7));
    // its throw's recoil: back from where the sporangium went, then ringing down
    if (s.thrown >= 0 && st.launch) {
      const tau = s.thrown * 3600;
      if (tau < 1.5) {
        const v = st.launch.v0;
        const h = Math.hypot(v[0], v[2]) || 1;
        const k = -L * 0.07 * Math.exp(-tau / 0.08) * Math.sin(2 * Math.PI * 22 * tau);
        b[0] += (v[0] / h) * k;
        b[2] += (v[2] / h) * k;
      }
    }
    // hit: pushed the way the sporangium was going, ringing (the higher it hit, the more)
    for (const h of hits.get(st) ?? []) {
      const tau = (T - h.t) * 3600;
      if (tau < 0 || tau > 2) continue;
      const f = 9 + 30 / Math.max(1, L / 6);
      const k = Math.min(L * 0.15, h.m * 3 * shape(h.s) * slender) * Math.exp(-tau / 0.15) * Math.sin(2 * Math.PI * f * tau);
      b[0] += h.dir[0] * k;
      b[2] += h.dir[1] * k;
    }
    st.bend = b;
    if (!near(st.base)) continue;
    // (how much it gives: a cantilever's L³ over its section's r⁴, made relative)
    const give = Math.pow(L / 10, 3) / Math.pow(Math.max(st.r, 0.02) / 0.1, 4);
    live.push({ st, s, L, give, topR: top(s), pts: [], rs: [], lo: [0, 0, 0], hi: [0, 0, 0] });
  }
  if (live.length < 2) return;
  const sample = (e: Live) => {
    e.pts = US.map((u) => along(e.st, e.s, u).p);
    e.rs = US.map((u, i) => Math.max(radius(e.st, e.s, u), i === US.length - 1 ? e.topR : 0));
    e.lo = [Infinity, Infinity, Infinity];
    e.hi = [-Infinity, -Infinity, -Infinity];
    e.pts.forEach((p, i) => {
      for (let k = 0; k < 3; k++) {
        e.lo[k] = Math.min(e.lo[k], p[k] - e.rs[i]);
        e.hi[k] = Math.max(e.hi[k], p[k] + e.rs[i]);
      }
    });
  };
  for (let round = 0; round < 5; round++) {
    for (const e of live) sample(e);
    // (sweep along x: only those whose boxes overlap)
    const order = [...live].sort((a, b) => a.lo[0] - b.lo[0]);
    const push = new Map<Live, V3>();
    for (let i = 0; i < order.length; i++) {
      const A = order[i];
      for (let j = i + 1; j < order.length && order[j].lo[0] <= A.hi[0]; j++) {
        const B = order[j];
        if (B.lo[1] > A.hi[1] || B.hi[1] < A.lo[1] || B.lo[2] > A.hi[2] || B.hi[2] < A.lo[2]) continue;
        // the deepest the two go into each other
        let deep = 0;
        let nx = 0;
        let nz = 0;
        let ua = 1;
        let ub = 1;
        // (each length of one against each of the other's; and each top — a cap, a bell, much
        // fatter than the stalk under it — as a ball on its own against the other's)
        const n = US.length;
        const segs: Array<[number, number, number, number]> = [];
        for (let a = 0; a + 1 < n; a++) for (let b = 0; b + 1 < n; b++) segs.push([a, a + 1, b, b + 1]);
        for (let b = 0; b + 1 < n; b++) segs.push([n - 1, n - 1, b, b + 1]);
        for (let a = 0; a + 1 < n; a++) segs.push([a, a + 1, n - 1, n - 1]);
        for (const [a, a1, b, b1] of segs) {
          {
            const q = closest(A.pts[a], A.pts[a1], B.pts[b], B.pts[b1]);
            const ra = A.rs[a] + (A.rs[a1] - A.rs[a]) * q.s;
            const rb = B.rs[b] + (B.rs[b1] - B.rs[b]) * q.t;
            const d = ra + rb - q.d;
            if (d > deep) {
              deep = d;
              // (apart across the ground: a stalk is pushed sideways, not down into the dung)
              let hx = q.ca[0] - q.cb[0];
              let hz = q.ca[2] - q.cb[2];
              let hl = Math.hypot(hx, hz);
              if (hl < 1e-4) {
                hx = A.st.base[0] - B.st.base[0] + 1e-3;
                hz = A.st.base[2] - B.st.base[2];
                hl = Math.hypot(hx, hz);
              }
              nx = hx / hl;
              nz = hz / hl;
              ua = US[a] + (US[a1] - US[a]) * q.s;
              ub = US[b] + (US[b1] - US[b]) * q.t;
            }
          }
        }
        if (deep <= 0) continue;
        // each gives by as much as it's soft; the tip moves as far as the touch needs
        const wa = A.give / (A.give + B.give);
        const pa = push.get(A) ?? [0, 0, 0];
        const pb = push.get(B) ?? [0, 0, 0];
        const ka = (deep * wa) / Math.max(0.25, shape(ua));
        const kb = (deep * (1 - wa)) / Math.max(0.25, shape(ub));
        pa[0] += nx * ka;
        pa[2] += nz * ka;
        pb[0] -= nx * kb;
        pb[2] -= nz * kb;
        push.set(A, pa);
        push.set(B, pb);
      }
    }
    if (!push.size) break;
    for (const [e, p] of push) {
      const b = e.st.bend!;
      b[0] += p[0] * 0.8;
      b[2] += p[2] * 0.8;
      // (a stalk bends only so far)
      const h = Math.hypot(b[0], b[2]);
      const max = e.L * 0.45;
      if (h > max) {
        b[0] *= max / h;
        b[2] *= max / h;
      }
    }
  }
}

/** the closest two segments come: how far apart, where along each (0..1), the two points */
function closest(p1: V3, q1: V3, p2: V3, q2: V3) {
  const d1: V3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2: V3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
  const bb = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  let s = 0;
  let t = 0;
  if (a > 1e-9 && e > 1e-9) {
    const den = a * e - bb * bb;
    s = den > 1e-12 ? Math.max(0, Math.min(1, (bb * f - c * e) / den)) : 0;
    t = (bb * s + f) / e;
    if (t < 0) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else if (t > 1) {
      t = 1;
      s = Math.max(0, Math.min(1, (bb - c) / a));
    }
  } else if (e > 1e-9) t = Math.max(0, Math.min(1, f / e));
  else if (a > 1e-9) s = Math.max(0, Math.min(1, -c / a));
  const ca: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const cb: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { d: Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]), s, t, ca, cb };
}
