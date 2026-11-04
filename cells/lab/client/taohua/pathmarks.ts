/**
 * Taohua: the marks along the ways, drawn as the water's are (marks.ts): not a texture laid over the
 * ground, but marks each with a reason to be there. Where a way's cut into the hill, a line along the
 * top of the cut, where it begins, and strokes down the bank from it, as old maps hatch a slope: close
 * where it's steep, long and short by turns. Its bed's edge, a fine line, broken: drawn more on its
 * uphill side, under the cut, than down the hill, where the way's built out and meets the hill by
 * degrees. Along a trail, a few long strokes where feet have worn it, crowding the inside of a bend;
 * where it's steep, short wandering runnels where the rain's run down it. On a stair, now and then the
 * worn edge of a tread. All heavier where something happens: at a flight's foot and head, at the
 * way's ends, at a crossing; and lighter between, so the eye travels.
 */
import { hash, noise1, seeded, type Rand } from '../kit/rng';
import { ribbon, type Push } from './marks';
import { WIDTH, type V3, type Way, type Ways } from './ways';

/** why a mark is there (after the water's own families) */
export const PFAM = { edge: 6, cut: 7, hachure: 8, wear: 9, tread: 10, runnel: 11 } as const;

export type WayKind = 'wet' | 'slab' | 'rock' | 'timber' | 'trail' | 'stepping' | 'flags';
export interface WayCtx {
  ways: Ways;
  seed: number;
  /** the tile's extent: x0, x1, z0, z1 */
  tile: [number, number, number, number];
  /** whether a mark starting here is this tile's to draw */
  own: (x: number, z: number) => boolean;
  /** the ground's height as drawn there */
  surf: (x: number, z: number) => number;
  /** the way's cross-section to one side (see world.bankAt) */
  bank: (w: Way, u: number, sd: number) => { bench: number; top: number; diff: number };
  /** what the way is, so far along it */
  kind: (w: Way, u: number) => WayKind;
}

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** a mark's lift off the ground, so it lies on it, not in it */
const LIFT = 0.025;
/** how long a stretch of a way is decided at a time */
const CELL = 0.8;

export function wayMarks(push: Push, c: WayCtx, w: Way, mat: number) {
  const { ways } = c;
  const [x0, x1, z0, z1] = c.tile;
  /** a place so far along the way and so far across it (v: + to its right as it goes) */
  const Q = (u: number, v: number): [number, number] => { const m = ways.at(w, u, true); return [m.p[0] + m.dir[1] * v, m.p[2] - m.dir[0] * v]; };
  const onG = (q: [number, number]): V3 => [q[0], c.surf(q[0], q[1]) + LIFT, q[1]];
  // (how much happens about here: a flight's foot or head, the way's ends, a crossing)
  const busy = (u: number) => {
    let b = 1 - smooth(1, 4, Math.min(u, w.len - u));
    for (const s of w.stairs) b = Math.max(b, 1 - smooth(0.4, 3, Math.abs(u - s.u0)), 1 - smooth(0.4, 3, Math.abs(u - s.u1)));
    if (w.cross) b = Math.max(b, 1 - smooth(0.4, 3, Math.min(Math.abs(u - w.cross.u0), Math.abs(u - w.cross.u1))));
    return b;
  };
  /** a line along the way, from u for so long, at v(u) across it; cut short where it leaves the way's own ground */
  const along = (u: number, len: number, v: (uu: number) => number | null): V3[] => {
    const pts: V3[] = [];
    for (let d = 0; d <= len + 1e-6; d += 0.2) {
      const uu = u + d;
      if (uu < 0 || uu > w.len) break;
      const vv = v(uu);
      if (vv === null || c.kind(w, uu) === 'wet' || (Math.abs(vv) > WIDTH / 2 + 0.3 && !ours(uu, vv))) { if (pts.length > 1) break; pts.length = 0; continue; }
      pts.push(onG(Q(uu, vv)));
    }
    return pts;
  };
  /** whether this side of the way, out to so far, is the way's own (not another's, nor water's, nor,
   * inside a bend, another stretch of it nearer) */
  const ours = (u: number, v: number) => { const q = Q(u, v), nr = ways.nearest(q[0], q[1]); return nr.w === w && Math.abs(nr.u - u) < 0.6 + 0.25 * Math.abs(v) && ways.dryOf(q[0], q[1]) > 2.5; };

  for (let i = 0, n = Math.ceil(w.len / CELL); i < n; i++) {
    const mc = ways.at(w, (i + 0.5) * CELL, true);
    if (mc.p[0] < x0 - 5 || mc.p[0] > x1 + 5 || mc.p[2] < z0 - 5 || mc.p[2] > z1 + 5) continue;
    const r = seeded(hash(c.seed, w.n, i, 0x9a7e));
    const u = (i + r()) * CELL, k = c.kind(w, u);
    if (k === 'wet') continue;
    const b = busy(u), stair = k === 'slab' || k === 'rock' || k === 'timber';
    for (const sd of [-1, 1]) {
      const pr = c.bank(w, u, sd);
      if (!ours(u, sd * (pr.bench + pr.top) / 2)) continue;
      if (pr.diff > 0.2) {
        // a cut: the line along its top, broken; heavier the higher it stands
        const hard = clamp((pr.diff - 0.2) / 0.9);
        if (r() < 0.5 + 0.3 * hard + 0.3 * b) {
          const pts = along(u, ramp(r, 0.8, 2.2), (uu) => { const p = c.bank(w, uu, sd); return p.diff > 0.15 ? sd * (p.top - 0.05) : null; });
          if (pts.length > 1 && c.own(pts[0][0], pts[0][2])) ribbon(push, pts, ramp(r, 0.028, 0.04) + 0.03 * hard, PFAM.cut, Math.min(0.95, 0.45 + 0.35 * hard + 0.15 * b), mat);
        }
        // and down the bank from it, strokes hanging from its top: in groups, each leaning its own way,
        // with the bank left bare between; mostly short, now and then one long; closer where it's steep
        const steep = clamp(pr.diff / Math.max(0.2, pr.top - pr.bench) / 1.2);
        const gap = 0.3 - 0.12 * steep;
        for (let uh = i * CELL + r() * gap; uh < (i + 1) * CELL; uh += gap * ramp(r, 0.6, 1.4)) {
          const grp = noise1(w.n * 7 + sd * 3, uh * 0.9);
          if (grp < 0.42 - 0.15 * hard) continue;
          // (where the way turns sharply, fewer: strokes square to it there fan out like a sunburst)
          const da = ways.at(w, Math.max(0, uh - 1), true).dir, dc = ways.at(w, Math.min(w.len, uh + 1), true).dir;
          if (r() < clamp((1 - (da[0] * dc[0] + da[1] * dc[1]) - 0.02) * 12)) continue;
          const p = c.bank(w, uh, sd);
          if (p.diff < 0.2) continue;
          const face = p.top - p.bench, dt = p.top - 0.06, db = dt - face * (r() < 0.2 ? ramp(r, 0.5, 0.75) : ramp(r, 0.18, 0.4));
          const s = Q(uh, sd * dt);
          if (!c.own(s[0], s[1]) || !ours(uh, sd * dt) || !ours(uh, sd * db)) continue;
          const lean = (noise1(w.n * 11 + sd, uh * 0.5) - 0.5) * 0.7 * face + ramp(r, -0.04, 0.04), pts: V3[] = [];
          for (let t = 0; t <= 1.0001; t += 0.2) pts.push(onG(Q(uh + lean * t, sd * (dt + (db - dt) * t))));
          ribbon(push, pts, ramp(r, 0.022, 0.034) + 0.012 * hard, PFAM.hachure, Math.min(0.9, ramp(r, 0.32, 0.5) + 0.25 * hard + 0.15 * b), mat);
        }
      }
      // the bed's edge: a fine line, broken; under a cut, more of it; down the hill, where it's built
      // out, less; none beside a stair (its slabs are its edge) nor flags (their kerbs are)
      if (stair || k === 'flags') continue;
      const p = pr.diff > 0.2 ? 0.4 + 0.3 * b : pr.diff < -0.2 ? 0.18 + 0.4 * b : 0.3 + 0.4 * b;
      if (r() < p) {
        const pts = along(u, ramp(r, 0.7, 2) * (1 + b * 0.5), (uu) => { const q = c.bank(w, uu, sd); return sd * (q.diff > 0.2 ? q.bench - 0.03 : WIDTH / 2 + 0.06 + 0.04 * Math.sin(uu * 3.1 + w.n)); });
        if (pts.length > 1 && c.own(pts[0][0], pts[0][2])) ribbon(push, pts, ramp(r, 0.022, 0.032), PFAM.edge, Math.min(0.8, ramp(r, 0.3, 0.42) + 0.2 * b), mat);
      }
    }
    if (k === 'trail') {
      // worn into a trail: now and then a long stroke along it, crowding the inside of a bend
      const pa = Q(Math.max(0, u - 2), 0), pb = Q(Math.min(w.len, u + 2), 0), pc = Q(u, 0), right = Q(u, 1);
      const bx = (pa[0] + pb[0]) / 2 - pc[0], bz = (pa[1] + pb[1]) / 2 - pc[1];
      const inner = Math.sign(bx * (right[0] - pc[0]) + bz * (right[1] - pc[1])) || 1, bendy = clamp(Math.hypot(bx, bz) * 3);
      if (r() < 0.28 + 0.3 * b + 0.2 * bendy) {
        const v0 = r() < bendy ? inner * ramp(r, 0.15, 0.55) : ramp(r, -0.5, 0.5), ph = r() * 6.3;
        const pts = along(u, ramp(r, 1.1, 2.6), (uu) => (c.kind(w, uu) === 'trail' ? v0 + 0.05 * Math.sin(ph + uu * 2.3) : null));
        if (pts.length > 1 && c.own(pts[0][0], pts[0][2])) ribbon(push, pts, ramp(r, 0.024, 0.036), PFAM.wear, ramp(r, 0.25, 0.42) + 0.12 * b, mat);
      }
      // where it's steep, a runnel down it, wandering
      const fall = Math.abs(ways.hill(pb[1]) - ways.hill(pa[1])) / 4;
      if (fall > 0.07 && r() < 0.15 + fall * 2.5) {
        const v0 = ramp(r, -0.35, 0.35), ph = r() * 6.3, amp = ramp(r, 0.04, 0.09);
        const pts = along(u, ramp(r, 0.6, 1.3), (uu) => (c.kind(w, uu) === 'trail' ? v0 + amp * Math.sin(ph + uu * 7) : null));
        if (pts.length > 1 && c.own(pts[0][0], pts[0][2])) ribbon(push, pts, ramp(r, 0.02, 0.03), PFAM.runnel, ramp(r, 0.28, 0.42), mat);
      }
    }
  }

  // on a stair of slabs: the worn edge of a tread, at its foot and head and now and then between
  for (const [si, st] of w.stairs.entries()) {
    if (c.kind(w, (st.u0 + st.u1) / 2) !== 'slab') continue;
    const du = (st.u1 - st.u0) / st.n, hx = du / 2 + 0.03, front = st.h1 >= st.h0 ? -1 : 1;
    for (let k = 0; k < st.n; k++) {
      const r = seeded(hash(c.seed, w.n, si, k, 0x7ead)), end = k === 0 || k === st.n - 1;
      if (!end && r() > 0.22) continue;
      const uc = st.u0 + (k + 0.5) * du, m = ways.at(w, uc, true), top = st.h0 + ((k + 1) / st.n) * (st.h1 - st.h0);
      const P = (a: number, v: number): V3 => [m.p[0] + m.dir[0] * a + m.dir[1] * v, top + 0.012, m.p[2] + m.dir[1] * a - m.dir[0] * v];
      const a = front * (hx - ramp(r, 0.07, 0.12)), v0 = ramp(r, -0.45, 0.05) * WIDTH / 2, v1 = v0 + ramp(r, 0.25, 0.5) * WIDTH / 2;
      const s = P(a, v0);
      if (!c.own(s[0], s[2])) continue;
      const pts: V3[] = [];
      for (let t = 0; t <= 1.0001; t += 0.25) pts.push(P(a + 0.015 * Math.sin(t * 5 + k), v0 + (v1 - v0) * t));
      ribbon(push, pts, ramp(r, 0.028, 0.04), PFAM.tread, ramp(r, 0.32, 0.48) + (end ? 0.18 : 0), mat);
    }
  }
}
