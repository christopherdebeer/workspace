/**
 * Honey run over a rim: a thick collar of it round the top, and from that its drips, each its own width and
 * pace, creeping down the side as the level goes on, thinning as they go, a teardrop swelling at each end; most
 * stall on the way as they cool, a few reach the foot and run into the pool. And a few drops fallen beside the
 * pool. Real shapes, so each has its silhouette and catches the light along it; drawn as honey (main.ts,
 * MAT.honeyDrip), seen through, rebuilt a few times a second from how long the level's been going. The same for
 * a glass jar (its side straight) and a pot (its side bellied): `side` says how far out the surface is at a height.
 */
import { MAT, type V3 } from './level';

export interface HoneyRim {
  /** the middle of what it's run down, at its foot */
  c: V3;
  /** the rim it runs over, and the foot it runs to (y) */
  top: number; foot: number;
  /** how far out the surface is at a height */
  side: (y: number) => number;
  /** how far a lip stands out past the side at the rim (a pot's rolled lip): the collar sits out over it */
  lip?: number;
  /** which way its front faces (radians, round from +x toward +z): most of the drips come down there */
  front: number;
  seed: number;
}

const hash = (k: number, salt: number) => {
  let h = Math.imul(k * 7919 + salt * 104729, 2654435761) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0;
  return (h % 100000) / 100000;
};
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** a triangle, wound to face along its normals (the drawing flips a normal seen from behind) */
function tri(out: number[], p: V3[], n: V3[], uv: Array<[number, number]>) {
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
  const facing = cx * (n[0][0] + n[1][0] + n[2][0]) + cy * (n[0][1] + n[1][1] + n[2][1]) + cz * (n[0][2] + n[1][2] + n[2][2]);
  const order = facing >= 0 ? [0, 1, 2] : [0, 2, 1];
  for (const k of order) out.push(p[k][0], p[k][1], p[k][2], n[k][0], n[k][1], n[k][2], MAT.honeyDrip, uv[k][0], uv[k][1]);
}
/** a grid of rings into triangles: ring i, point j */
function rings(out: number[], P: V3[][], N: V3[][], closed = true) {
  for (let i = 0; i + 1 < P.length; i++) {
    const m = P[i].length;
    for (let j = 0; j < (closed ? m : m - 1); j++) {
      const k = (j + 1) % m, v0 = i / (P.length - 1), v1 = (i + 1) / (P.length - 1);
      tri(out, [P[i][j], P[i + 1][j], P[i + 1][k]], [N[i][j], N[i + 1][j], N[i + 1][k]], [[v0, j / m], [v1, j / m], [v1, k / m]]);
      tri(out, [P[i][j], P[i + 1][k], P[i][k]], [N[i][j], N[i + 1][k], N[i][k]], [[v0, j / m], [v1, k / m], [v0, k / m]]);
    }
  }
}

/** The drips' lengths at a time (s since the level began): most stall partway, a few reach the foot. */
function dripLength(k: number, seed: number, run: number, H: number) {
  const h1 = hash(k, seed + 1), h4 = hash(k, seed + 4), h5 = hash(k, seed + 5);
  // (none runs to the foot: a few get two thirds of the way, most stop in the top third, fat at the end)
  const L0 = 1.8 + 3.5 * h1, tau = 45 + 160 * h4;
  const reach = h5 < 0.22 ? H * (0.55 + 0.15 * h1) : L0 + (H * 0.45 - L0) * h5;
  return Math.min(H, L0 + (reach - L0) * (1 - Math.exp(-run / tau)));
}

/** All of it for one rim, at `run` seconds in, onto `out`. */
export function honeyOver(rim: HoneyRim, run: number, out: number[]) {
  const { c, top, foot, side, front, seed } = rim, H = top - foot - 0.6;
  // (the drips: most round the front, a few elsewhere; each where the collar droops)
  const drips: Array<{ a: number; w: number; L: number; k: number }> = [];
  for (let k = 0; k < 12; k++) {
    const a = k < 9 ? front + (k - 4) * 0.3 + (hash(k, seed) - 0.5) * 0.14 : front + Math.PI * (0.55 + 0.45 * (k - 9)) + (hash(k, seed + 9) - 0.5) * 0.4;
    drips.push({ a, w: 0.32 + 0.5 * hash(k, seed + 2) ** 1.3, L: dripLength(k, seed, run, H), k });
  }
  // the collar: a thick roll of it round the rim, drooping where each drip leaves it
  {
    const SEG = 128, SIDES = 12, P: V3[][] = [], N: V3[][] = [];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      let droop = 0;
      for (const d of drips) { const da = Math.abs(((th - d.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI); droop = Math.max(droop, Math.exp(-(((da * side(top)) / (d.w * 1.6)) ** 2))); }
      const rc = 0.5 + 0.08 * Math.sin(th * 3 + seed) ** 2 + 0.3 * droop;
      const lip = rim.lip ?? 0, cy = top - 0.28 + lip * 0.4 - 0.35 * droop, out2 = Math.max(side(cy), side(top) + lip) + rc * 0.45;
      const er: V3 = [Math.cos(th), 0, Math.sin(th)];
      const ring: V3[] = [], nr: V3[] = [];
      for (let j = 0; j < SIDES; j++) {
        const ph = (j / SIDES) * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
        const nn = norm([er[0] * cp, sp, er[2] * cp]);
        ring.push([c[0] + er[0] * (out2 + rc * cp), cy + rc * sp * 0.8, c[2] + er[2] * (out2 + rc * cp)]);
        nr.push(nn);
      }
      P.push(ring); N.push(nr);
    }
    rings(out, P, N);
  }
  // the drips: a tube down the side, pressed flat against it a little, thinning, a teardrop at its end
  for (const d of drips) {
    const er: V3 = [Math.cos(d.a), 0, Math.sin(d.a)], et: V3 = [-Math.sin(d.a), 0, Math.cos(d.a)];
    const reached = d.L >= H - 0.01, y0 = top - 0.35, rb = reached ? 0 : d.w * (1.25 + 0.4 * Math.min(1, d.L / (H * 0.5)));
    const radius = (s: number) => {
      // (it swells as it goes down, the honey gathering toward its end, not thinning to a string)
      const stem = d.w * (0.72 + 0.4 * Math.min(1, s / Math.max(d.L, 1))) * (1 + 0.08 * Math.sin(s * 1.3 + d.k)) + d.w * 0.9 * Math.exp(-s / 0.6);
      if (reached) return stem + d.w * 0.8 * Math.exp(-(d.L - s) / 0.6);
      const sb = d.L - rb, bead = s > sb - rb ? Math.sqrt(Math.max(0, rb * rb - (s - sb) ** 2)) : 0;
      // (a neck just over the bead)
      const neck = 1 - 0.3 * Math.exp(-(((s - (sb - rb * 1.05)) / (rb * 0.5)) ** 2));
      return s >= sb ? bead : Math.max(stem * neck, bead);
    };
    const STEPS = 26, SIDES = 12, P: V3[][] = [], N: V3[][] = [];
    for (let i = 0; i <= STEPS; i++) {
      // (more rings toward the end, where the bead is)
      const u = i / STEPS, s = d.L * (1 - (1 - u) ** 1.6), y = y0 - s;
      const rho = i === STEPS && !reached ? 0 : radius(s), ds = 0.05, slope = (radius(Math.min(d.L, s + ds)) - radius(Math.max(0, s - ds))) / (2 * ds);
      const R = side(y) + rho * 0.55, ring: V3[] = [], nr: V3[] = [];
      for (let j = 0; j < SIDES; j++) {
        const ph = (j / SIDES) * Math.PI * 2, cp = Math.cos(ph), sp = Math.sin(ph);
        ring.push([c[0] + er[0] * (R + rho * cp * 0.75) + et[0] * rho * sp, y, c[2] + er[2] * (R + rho * cp * 0.75) + et[2] * rho * sp]);
        nr.push(norm([er[0] * cp / 0.75 + et[0] * sp, slope, er[2] * cp / 0.75 + et[2] * sp]));
      }
      P.push(ring); N.push(nr);
    }
    rings(out, P, N);
  }
  // a few drops fallen beside the pool, toward the front: little flattened domes
  for (let k = 0; k < 5; k++) {
    const a = front + (hash(k, seed + 30) - 0.5) * 1.6, dist = side(foot) + 2.2 + 1.4 * hash(k, seed + 31), r = 0.18 + 0.3 * hash(k, seed + 32) ** 2;
    const at: V3 = [c[0] + Math.cos(a) * dist, foot + 0.02, c[2] + Math.sin(a) * dist], P: V3[][] = [], N: V3[][] = [];
    for (let i = 0; i <= 4; i++) {
      const el = (i / 4) * Math.PI / 2, ring: V3[] = [], nr: V3[] = [];
      for (let j = 0; j < 8; j++) {
        const az = (j / 8) * Math.PI * 2, ce = Math.cos(el), se = Math.sin(el);
        ring.push([at[0] + Math.cos(az) * ce * r, at[1] + se * r * 0.45, at[2] + Math.sin(az) * ce * r]);
        nr.push(norm([Math.cos(az) * ce * 0.45, se, Math.sin(az) * ce * 0.45]));
      }
      P.push(ring); N.push(nr);
    }
    rings(out, P, N);
  }
}

/**
 * A honey pot's side: how far out it is at a height, foot `y0` to rim `y1`, its belly `R`. Narrower at its foot,
 * bellied low, drawn in at its shoulder to a neck, a little flared at the lip.
 */
export function potSide(R: number, y0: number, y1: number): (y: number) => number {
  return (y: number) => {
    const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
    if (t < 0.86) return R * (0.68 + 0.32 * Math.sin(Math.PI * Math.min(1, t / 0.86) * 0.95 + 0.1) ** 0.55);
    const u = (t - 0.86) / 0.14;
    return R * (0.74 + 0.07 * u * u);
  };
}
