/**
 * Squishy: the props, things laid about a kitchen that the dumpling goes over, up, along: a
 * wooden spoon, a tea towel draped over something, butter melted across a table, a plate tipped
 * on a teacup. Each is a surface: made from a patch (u, v in 0–1), it gives a collider (its top's
 * triangles, a sheet so thick) and its drawing (its top, its underside, its edges), so what's
 * seen is what's met.
 */
import { MAT, sheet, type Shape, type V3 } from './level';
import { VSTRIDE } from './mesh';

export interface Prop { shapes: Shape[]; verts: number[] }
type UV = [number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const dotv = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
void VSTRIDE;

/**
 * A surface from f(u, v), nu by nv quads, th thick: the top facing `up` (its normal turned to
 * agree with it in the middle), the drawing in its material with (u, v) as `uv` makes them.
 */
export function surface(f: (u: number, v: number) => V3, nu: number, nv: number, th: number, mat: number, mu: number, up: V3, uv: (u: number, v: number) => UV = (u, v) => [u, v]): Prop {
  const P: V3[][] = [], N: V3[][] = [];
  for (let i = 0; i <= nu; i++) { P.push([]); for (let j = 0; j <= nv; j++) P[i].push(f(i / nu, j / nv)); }
  // (which way round: the middle's normal against `up`)
  const mid = (a: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(a)));
  const mi = mid(nu / 2, nu), mj = mid(nv / 2, nv);
  const flip = dotv(cross(sub(P[mi + 1][mj], P[mi][mj]), sub(P[mi][mj + 1], P[mi][mj])), up) < 0;
  for (let i = 0; i <= nu; i++) {
    N.push([]);
    for (let j = 0; j <= nv; j++) {
      const pu = sub(P[Math.min(nu, i + 1)][j], P[Math.max(0, i - 1)][j]), pv = sub(P[i][Math.min(nv, j + 1)], P[i][Math.max(0, j - 1)]);
      let n = norm(cross(pu, pv));
      if (n[0] === 0 && n[1] === 0 && n[2] === 0) n = norm(up);
      N[i].push(flip ? [-n[0], -n[1], -n[2]] : n);
    }
  }
  const corners: number[] = [], verts: number[] = [];
  const put = (p: V3, n: V3, t: UV) => verts.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, t[0], t[1]);
  const down = (i: number, j: number): V3 => [P[i][j][0] - N[i][j][0] * th, P[i][j][1] - N[i][j][1] * th, P[i][j][2] - N[i][j][2] * th];
  const neg = (n: V3): V3 => [-n[0], -n[1], -n[2]];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const q: Array<[number, number]> = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const tris = flip ? [[0, 3, 1], [1, 3, 2]] : [[0, 1, 3], [1, 2, 3]];
    for (const t of tris) for (const k of t) { const [a, b] = q[k]; corners.push(...P[a][b]); put(P[a][b], N[a][b], uv(a / nu, b / nv)); }
    // (its underside, the other way round)
    for (const t of tris) for (const k of [t[0], t[2], t[1]]) { const [a, b] = q[k]; put(down(a, b), neg(N[a][b]), uv(a / nu, b / nv)); }
  }
  // its edges: round the patch's border, from its top down through its thickness
  const edge = (a: [number, number], b: [number, number]) => {
    const pa = P[a[0]][a[1]], pb = P[b[0]][b[1]], da = down(a[0], a[1]), db = down(b[0], b[1]);
    const out = norm(cross(sub(pb, pa), N[a[0]][a[1]]));
    const ua = uv(a[0] / nu, a[1] / nv), ub = uv(b[0] / nu, b[1] / nv);
    put(pa, out, ua); put(pb, out, ub); put(db, out, ub);
    put(pa, out, ua); put(db, out, ub); put(da, out, ua);
  };
  for (let i = 0; i < nu; i++) { edge([i, 0], [i + 1, 0]); edge([i + 1, nv], [i, nv]); }
  for (let j = 0; j < nv; j++) { edge([nu, j], [nu, j + 1]); edge([0, j + 1], [0, j]); }
  return { shapes: [sheet(corners, th, mat, mu)], verts };
}

/**
 * A wooden spoon lying with its bowl on the table (its bowl's middle at `bowl`) and its handle
 * running up the way `yaw` faces to rest at `end` (a height, that far along, measured flat): a
 * dish to land in, a narrow ramp up.
 */
export function spoon(bowl: V3, yaw: number, reach: number, endY: number): Prop {
  const f: V3 = [Math.sin(yaw), 0, Math.cos(yaw)], r: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const S = reach + 4.5, ty = bowl[1];
  const half = (s: number) => {
    let w = s < 9 ? 3.3 * Math.sqrt(Math.max(0, 1 - ((s - 4.5) / 4.5) ** 2)) : 0;
    const neck = s < 7 ? 0 : s < 12.5 ? 0.9 + (0.3 * Math.max(0, s - 9)) / 3.5 : 1.2 + (0.3 * (s - 12.5)) / (S - 12.5);
    w = Math.max(w, neck);
    // (the handle's end rounded off)
    if (s > S - 1.4) w *= Math.sqrt(Math.max(0, 1 - ((s - (S - 1.4)) / 1.4) ** 2));
    return w;
  };
  // (its back's height: the bowl's rim flat on the table, the neck rising, the handle straight to its end)
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hS = 2.5, hE = endY - ty;
  const back = (s: number) => {
    const handle = hS + ((hE - hS) * Math.max(0, s - 12.5)) / (S - 12.5);
    return 1.9 + (handle - 1.9) * smooth(8, 12.5, s);
  };
  return surface((u, v) => {
    const s = u * S, a = v * 2 - 1, w = half(s);
    const e = (s - 4.5) / 4.5;
    const dish = s < 9 ? 1.3 * Math.max(0, 1 - e * e - a * a) : 0;
    const y = ty + back(s) - dish;
    const off = s - 4.5;
    return [bowl[0] + f[0] * off + r[0] * a * w, y, bowl[2] + f[2] * off + r[2] * a * w];
  }, 64, 10, 0.55, MAT.spoon, 0.75, [0, 1, 0], (u, v) => [u * S, (v * 2 - 1) * half(u * S)]);
}

/**
 * A tea towel over something: along `dir` from `from`, so long (its width as it lies), its
 * cross-section the path `xs` (pairs of across and height, across measured along `side`).
 * Linen: it grips, and holds what lands on it a while, even on its hanging sides.
 */
export function towel(from: V3, dir: V3, side: V3, long: number, xs: Array<[number, number]>, seed: number): Prop {
  // (the path by its length, so the towel's stripes and hems sit evenly)
  const L: number[] = [0];
  for (let i = 1; i < xs.length; i++) L.push(L[i - 1] + Math.hypot(xs[i][0] - xs[i - 1][0], xs[i][1] - xs[i - 1][1]));
  const total = L[L.length - 1];
  const at = (d: number): [number, number] => {
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const t = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
    return [xs[i - 1][0] + (xs[i][0] - xs[i - 1][0]) * t, xs[i - 1][1] + (xs[i][1] - xs[i - 1][1]) * t];
  };
  const wob = (u: number, v: number) => 0.18 * Math.sin(u * 23 + seed) * Math.sin(v * 9 + seed * 2) + 0.12 * Math.sin(u * 51 + v * 13 + seed);
  const pr = surface((u, v) => {
    const [a, y] = at(u * total);
    const w = v * long;
    // (folds: it lies in soft ridges, more where it hangs)
    const fold = wob(u, v) * (y > 1.5 ? 1 : 0.4);
    return [from[0] + dir[0] * w + side[0] * (a + fold), from[1] + y + (y < 1 ? 0.06 : 0), from[2] + dir[2] * w + side[2] * (a + fold)];
  }, Math.max(12, Math.round(total / 1.2)), Math.max(6, Math.round(long / 1.5)), 0.3, MAT.towel, 1.0, [0, 1, 0], (u, v) => [u * total, v * long]);
  const s = pr.shapes[0];
  // (linen grips: it holds a dumpling on its hanging side a moment or two, then lets it slide)
  s.tack = 2; s.tire = 0.6;
  return pr;
}

/** Butter melted across the table from `a` toward `b`: a smear, wider in the middle, ragged at its edges. Slippery, and it comes off on you. */
export function smear(a: V3, b: V3, wide: number, seed: number): Prop {
  const d = sub(b, a), len = Math.hypot(d[0], d[2]);
  const f: V3 = [d[0] / len, 0, d[2] / len], r: V3 = [f[2], 0, -f[0]];
  const pr = surface((u, v) => {
    const s = u * len, c = v * 2 - 1;
    // (its width: blobby along it, a run of drips at its sides)
    const w = (wide / 2) * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6 * (0.75 + 0.25 * Math.sin(u * 17 + seed) + 0.12 * Math.sin(u * 41 + seed * 3));
    const wander = 1.6 * Math.sin(u * 4 + seed);
    return [a[0] + f[0] * s + r[0] * (c * w + wander), a[1] + 0.07 + 0.05 * (1 - c * c), a[2] + f[2] * s + r[2] * (c * w + wander)];
  }, 40, 6, 0.12, MAT.smear, 0.2, [0, 1, 0], (u, v) => [u, v]);
  return pr;
}

/** A plate tipped up on one side (on a teacup, a tin): its middle at `c`, so wide, its rise along `dir` (radians). Glazed, a little slippery, with a lip. */
export function tiltPlate(c: V3, rad: number, dir: number, tilt: number): Prop {
  const ca = Math.cos(tilt), sa = Math.sin(tilt), dx = Math.sin(dir), dz = Math.cos(dir);
  return surface((u, v) => {
    const rr = u * rad, th = v * Math.PI * 2;
    const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
    // (the well flat, the rim curving up into a lip)
    const y = u < 0.62 ? 0 : 0.9 * ((u - 0.62) / 0.38) ** 1.6;
    // (tipped: its rise along dir)
    const along = x * dx + z * dz, across = x * dz - z * dx;
    const a2 = along * ca - y * sa, y2 = along * sa + y * ca;
    return [c[0] + dx * a2 + dz * across, c[1] + y2, c[2] + dz * a2 - dx * across];
  }, 12, 36, 0.45, MAT.porcelain, 0.55, [0, 1, 0], (u, v) => [Math.cos(v * Math.PI * 2) * u, Math.sin(v * Math.PI * 2) * u]);
}
