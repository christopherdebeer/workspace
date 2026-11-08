/**
 * A hand and a tool for the Splats brush, after Autograph (hands/v34.ts, ink.ts), so a mark looks as it does because of
 * how it was made:
 *
 * - **the hand** (optional; `hand`): a planned path becomes a timed movement. Autograph's `move()` gives the speed along
 *   it (the two-thirds power law, starting and ending at rest, stopping at cusps), and its `body()` follows the plan as
 *   a critically damped spring, so a hurried hand rounds a corner and cuts a turn. A path that should be exact skips
 *   the hand.
 * - **the tool** (`penDeposit`): turns movement and carried state into deposited material, by Autograph's rules:
 *   - speed narrows the line (`widths`);
 *   - a broad nib held at its own angle is thick moving across its edge and a hairline moving along it;
 *   - press widens and darkens; lifting pales; the voice blends round into broad;
 *   - ink runs out with distance and is dipped again at a pause.
 *
 *   In splats the nib is an elongated Gaussian, laid along the nib's edge at every step and lying on the surface, so the
 *   broad nib's directional character comes from the tool's shape, not from a width profile. Two rules keep its tone the
 *   pen's own, as Autograph's union of swept shapes does:
 *   - a step's opacity is shared among the steps that overlap it along the motion;
 *   - where a stroke crosses itself, the later pass leaves what the earlier one laid.
 * - **the surface** (`SurfaceMap`): where the page's x and y go in space, with the surface's normal and its "right" and
 *   "up" there, so the nib keeps its angle to the surface (a plane, a cylinder, the ground).
 *
 * Coordinates are Autograph's: page units (an x-height is 220), y down, time in hundredths of a second.
 */
import { add, cross, dot, len, mul, norm, sub, stroke, type Dep, type Element, type V } from './brush';
import { BROAD, INK, LOUD, widths, type PenAt } from '../autograph/ink';
import { body, move } from '../autograph/hands/v34';

/** a timed stroke as Autograph keeps one: x, y, t (hundredths of a second) flat; the pen's state at its start and end */
export type TimedStroke = number[] & { pen?: [PenAt, PenAt] };
/** where the page goes in space: a point of the page (page units) to a point on a surface, its normal, and the
 * directions of the page's +x ("right") and −y ("up") there */
export interface SurfaceMap { place(x: number, y: number): { p: V; n: V; right: V; up: V } }
export interface PenSpec {
  /** the round pen's width (page units: Autograph's is 30); metres a page unit */
  pen: number; k: number;
  /** round (0) to broad (1), where the stroke doesn't carry its own; the nib's angle (radians, from the page's +x) */
  voice: number; angle?: number;
  /** ink that runs out and is dipped at pauses */
  dip: boolean;
  /** a stroke's crossings left as its first pass laid them (Autograph's union) */
  union: boolean;
  colour: V; element: number; object?: number; rank?: number;
}

// ─── the surfaces ───
/** a plane: the page's origin at `o`, its right and up along `right` and `up` (unit, perpendicular) */
export function planeMap(o: V, right: V, up: V, k: number): SurfaceMap {
  const n = norm(cross(right, up));
  return { place: (x, y) => ({ p: add(o, add(mul(right, x * k), mul(up, -y * k))), n, right, up }) };
}
/** an upright cylinder (axis at `c`'s x and z, radius r): the page wrapped round it, its x round the circumference
 * (the page's origin at angle a0, seen from +z at a0 = 0), its y down from height `c[1]` */
export function cylinderMap(c: V, r: number, a0: number, k: number): SurfaceMap {
  return {
    place: (x, y) => {
      const a = a0 + (x * k) / r, s = Math.sin(a), co = Math.cos(a);
      return { p: [c[0] + r * s, c[1] - y * k, c[2] + r * co], n: [s, 0, co], right: [co, 0, -s], up: [0, 1, 0] };
    },
  };
}
/** a height field seen from above: the page's x along +x, its y along +z (so "up" on the page is −z), a point's height
 * from `height`, its normal from the slope; `toScene` takes the field's point into the scene */
export function groundMap(height: (x: number, z: number) => number, origin: [number, number], k: number, toScene: (p: V) => V): SurfaceMap {
  return {
    place: (x, y) => {
      const wx = origin[0] + x * k, wz = origin[1] + y * k, h = height(wx, wz), e = 0.15;
      const hx = (height(wx + e, wz) - height(wx - e, wz)) / (2 * e), hz = (height(wx, wz + e) - height(wx, wz - e)) / (2 * e);
      const n = norm([-hx, 1, -hz]), right = norm([1, hx, 0]), up = norm(cross(n, right));
      return { p: toScene([wx, h, wz]), n, right, up: mul(up, Math.sign(dot(up, [0, 0, -1])) || 1) };
    },
  };
}

// ─── the hand ───
/**
 * A planned path (page units) moved through by a hand: Autograph's `move()` gives the times (at `pace` x-heights a
 * second), its `body()` the pen following the plan (stiffness `omega`, radians a second; 0, the pen exactly on the plan).
 * Returns a timed stroke, starting at `t0` (hundredths of a second).
 */
export function hand(plan: Array<[number, number]>, pace: number, omega: number, t0 = 0, pen?: [PenAt, PenAt]): TimedStroke {
  const X = 220, P = plan.map(([x, y]) => [x / X, y / X] as [number, number]);
  // (finer steps than the plan's, as Autograph's spline gives, so the speed and the body work on a smooth line)
  const fine: Array<[number, number]> = [];
  for (let i = 0; i < P.length - 1; i++) { const n = Math.max(1, Math.ceil(Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) * 24)); for (let j = 0; j < n; j++) { const u = j / n; fine.push([P[i][0] + (P[i + 1][0] - P[i][0]) * u, P[i][1] + (P[i + 1][1] - P[i][1]) * u]); } }
  fine.push(P[P.length - 1]);
  const T = move(fine, pace), { Q, TQ } = body(fine, T, omega);
  const out = [] as unknown as TimedStroke;
  Q.forEach(([x, y], i) => out.push(x * X, y * X, t0 + TQ[i] * 100));
  if (pen) out.pen = pen;
  return out;
}

// ─── the tool ───
/** a timed stroke smoothed as Autograph's pen draws it: x, y, t, and the speed's width at each point */
function smoothed(s: number[]): number[][] {
  const m = s.length / 3, w = widths(s), pts: number[][] = [];
  if (m === 1) return [[s[0], s[1], s[2], w[0]]];
  let ax = s[0], ay = s[1];
  pts.push([ax, ay, s[2], w[0]]);
  for (let i = 1; i < m; i++) {
    const px = s[i * 3], py = s[i * 3 + 1], qx = i < m - 1 ? s[i * 3 + 3] : px, qy = i < m - 1 ? s[i * 3 + 4] : py, mx = (px + qx) / 2, my = (py + qy) / 2;
    for (let t = 0.5; t <= 1.001; t += 0.5) { const u = 1 - t; pts.push([u * u * ax + 2 * u * t * px + t * t * mx, u * u * ay + 2 * u * t * py + t * t * my, s[(i - 1) * 3 + 2] + (s[i * 3 + 2] - s[(i - 1) * 3 + 2]) * t, w[i]]); }
    ax = mx; ay = my;
  }
  return pts;
}

/** timed strokes deposited by the pen onto a surface; returns the deposits and the ink left */
export function penDeposit(strokes: TimedStroke[], map: SurfaceMap, spec: PenSpec, wet0 = 1): { deps: Dep[]; wet: number } {
  const out: Dep[] = [], a = spec.angle ?? BROAD.angle, ex = Math.cos(a), ey = -Math.sin(a), xh = (spec.pen * 220) / 30;
  let wet = wet0, lastEnd = -Infinity;
  for (const s of strokes) {
    if (s.length < 3) continue;
    const pp = s.pen, t0 = s[2], t1 = s[s.length - 1], at = (t: number) => (t1 > t0 ? (t - t0) / (t1 - t0) : 0);
    // (the ink: dipped at a pause once it's low, or straight away once it's dry)
    if (spec.dip) { if (wet < INK.dry || (wet < INK.low && t0 / 100 - lastEnd > INK.pause)) wet = 1; lastEnd = t1 / 100; }
    const penAt = (u: number): PenAt => (pp ? { press: pp[0].press + (pp[1].press - pp[0].press) * u, voice: pp[0].voice + (pp[1].voice - pp[0].voice) * u } : { press: 0, voice: spec.voice });
    // (the pen's shape at a point, as ink.ts's sweep: how wide along its edge, how thick across it, how dark)
    const shape = (q: number[]) => {
      const { press, voice } = penAt(at(q[2])), v = Math.max(0, Math.min(1, voice));
      const loud = press >= 0 ? 1 + LOUD.up * press : 1 + LOUD.down * press;
      const round = spec.pen * q[3] * loud, wide = spec.pen * BROAD.w * (0.75 + 0.25 * q[3]) * loud, edge = spec.pen * BROAD.edge * Math.min(1, loud);
      return { wd: round + (wide - round) * v, th: round + (edge - round) * v, shade: press < 0 ? 1 + LOUD.pale * press : 1, loud };
    };
    const tone = () => (spec.dip ? INK.palest + (1 - INK.palest) * Math.pow(Math.max(0, wet), 0.7) : 1);
    const pts = smoothed(s);
    // (where this stroke has been: cells of the page, with how far along it the pen was)
    const visited = new Map<string, number>(), cellOf = (x: number, y: number, c: number) => `${Math.floor(x / c)},${Math.floor(y / c)}`;
    let along = 0;
    const lay = (x: number, y: number, dx: number, dy: number, step: number, sh: ReturnType<typeof shape>, darken: number) => {
      // (how far the nib's footprint reaches along the motion, so how many steps overlap here: the opacity shared)
      const dl = Math.hypot(dx, dy) || 1, cosf = (dx * ex + dy * ey) / dl, sinf = Math.sqrt(Math.max(0, 1 - cosf * cosf));
      const ext = 2 * Math.hypot((sh.wd / 2) * cosf, (sh.th / 2) * sinf), N = Math.max(1, ext / Math.max(1e-6, step));
      const T = Math.min(0.95, sh.shade * darken * 0.92), alpha = 1 - Math.pow(1 - T, 1 / N);
      // (a crossing: the cell already laid by this stroke well before here, so this pass leaves it)
      const cell = Math.max(sh.th, sh.wd * 0.35), key = cellOf(x, y, cell), was = visited.get(key);
      if (spec.union && was !== undefined && along - was > ext * 1.6 + cell * 2) return;
      if (was === undefined) visited.set(key, along);
      const S = map.place(x, y), E = norm(add(mul(S.right, ex), mul(S.up, -ey))), A = norm(cross(S.n, E));
      // (the Gaussian's spread: along the edge, the nib's half width; across, its thickness, never thinner than the step,
      // so a nib moved across its edge leaves no gaps)
      const sa = (sh.wd / 2 / 1.5) * spec.k, sc = Math.max((sh.th / 2 / 1.5), step * 0.6) * spec.k;
      out.push({ p: add(S.p, mul(S.n, 0.0015)), ax: [E, A, S.n], s: [sa, sc, 0.0008], c: spec.colour, a: alpha, rank: spec.rank ?? 0.95, mark: 1, feature: 0, element: spec.element, u: along, support: 1, n1: S.n, object: spec.object });
    };
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const sh0 = shape(pts[0]);
    if (pts.length === 1 || L < sh0.wd * 0.5) {
      // (a dot: the nib moved across its own width)
      const cx = pts.reduce((q, p) => q + p[0], 0) / pts.length, cy = pts.reduce((q, p) => q + p[1], 0) / pts.length, d = (sh0.wd * 0.45) / 2;
      for (let j = -2; j <= 2; j++) lay(cx + Math.sin(a) * d * (j / 2), cy + Math.cos(a) * d * (j / 2), Math.sin(a), Math.cos(a), d / 2, sh0, tone());
      continue;
    }
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], seg = Math.hypot(x1 - x0, y1 - y0);
      const sh = shape(pts[i]), step = Math.max(spec.pen * 0.04, Math.min(sh.th * 0.5, sh.wd * 0.25)), n = Math.max(1, Math.ceil(seg / step));
      if (spec.dip) wet -= (seg / xh) * INK.use * (sh.wd / spec.pen);
      const dark = Math.min(1, tone() + (0.8 * Math.max(0, sh.loud - 1)) / LOUD.up);
      for (let j = 0; j < n; j++) { const u = (j + 0.5) / n; lay(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, x1 - x0, y1 - y0, seg / n, sh, dark); along += seg / n; }
    }
  }
  return { deps: out, wet };
}

/** the same strokes as the Splats brush draws a path today: the smoothed line laid on the surface with a fixed round
 * width and a prescribed pressure profile (the speed's widths along it), no nib, no timing, no ink */
export function staticStrokes(strokes: TimedStroke[], map: SurfaceMap, spec: PenSpec, key: string): Element[] {
  return strokes.filter((s) => s.length >= 6).map((s, i) => {
    const pts = smoothed(s), P = pts.map((q) => map.place(q[0], q[1])), w = pts.map((q) => q[3]);
    return stroke({ pts: P.map((q) => add(q.p, mul(q.n, 0.0015))), normals: P.map((q) => q.n) }, { width: spec.pen * spec.k * 1.1, pressure: (u) => w[Math.min(w.length - 1, Math.round(u * (w.length - 1)))], taper: [0.08, 0.12] }, { key: `${key}/${i}`, colour: spec.colour, alpha: 0.9 });
  });
}
void sub; void len;
