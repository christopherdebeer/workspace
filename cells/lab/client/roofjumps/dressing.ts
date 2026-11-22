/**
 * What's drawn of the city's details (city.ts `Detail`, made in parts.ts): each kind's few plain boxes, for the mesh, so every
 * look has them to colour (the plain looks a flat colour a kind, by its tag). Draw only: none is stood on or collided with, and
 * what's held of them (a bundle's runs, a ladder, the sill under a window row) is the holds they carry (`Detail.holds`), drawn
 * where those holds are. One row a kind (a `Record`, so a new kind of detail can't go undrawn).
 */
import type { Box, Detail, DetailKind, Tag } from './city';
import { TAG } from './city';

type P3 = [number, number, number];
/** a box from a point on a face: `a` along it and `o` out from it (from its line), `y0..y1` up it; `flat` its one face, outward */
function onFace(d: Detail, p: P3, a0: number, a1: number, o0: number, o1: number, y0: number, y1: number, tag: Tag, seed?: number, flat = false): Box {
  const [nx, nz] = d.n, ux = -nz, uz = nx;
  // (back to the face's own line: details are recorded a little out from it)
  const out = 0;
  const xs = [p[0] + ux * a0 + nx * (o0 + out), p[0] + ux * a1 + nx * (o0 + out), p[0] + ux * a0 + nx * (o1 + out), p[0] + ux * a1 + nx * (o1 + out)];
  const zs = [p[2] + uz * a0 + nz * (o0 + out), p[2] + uz * a1 + nz * (o0 + out), p[2] + uz * a0 + nz * (o1 + out), p[2] + uz * a1 + nz * (o1 + out)];
  const b: Box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0, y1, tag };
  if (seed !== undefined) b.seed = seed;
  if (flat) b.flat = [nx, nz];
  return b;
}
/** an upright box standing on a point */
const stand = (p: P3, w: number, d: number, h: number, tag: Tag, y0 = p[1]): Box => ({ x0: p[0] - w / 2, x1: p[0] + w / 2, z0: p[2] - d / 2, z1: p[2] + d / 2, y0, y1: y0 + h, tag });
/** a line strung a to b as short boxes, each spanning its own rise (a wire's sag, a line of washing): a run that joins up */
function strung(a: P3, b: P3, t: number, tag: Tag, n = 8): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const p = a.map((v, k) => v + (b[k] - v) * (i / n)), q = a.map((v, k) => v + (b[k] - v) * ((i + 1) / n));
    out.push({ x0: Math.min(p[0], q[0]) - t, x1: Math.max(p[0], q[0]) + t, z0: Math.min(p[2], q[2]) - t, z1: Math.max(p[2], q[2]) + t, y0: Math.min(p[1], q[1]) - t, y1: Math.max(p[1], q[1]) + t, tag });
  }
  return out;
}
/** along a face from p to q (both on it): how far */
const along = (d: Detail, p: P3, q: P3) => (q[0] - p[0]) * -d.n[1] + (q[2] - p[2]) * d.n[0];
/** a number in 0..1 from a detail's seed and an index */
const pick = (seed: number, i: number) => { let h = Math.imul(seed | 0, 2654435761) ^ Math.imul(i + 1, 40503); h = Math.imul(h ^ (h >>> 15), 2246822519); return ((h ^ (h >>> 13)) >>> 0) / 4294967296; };

export const DRESS: Record<DetailKind, (d: Detail) => Box[]> = {
  // (a row of panes, each in its slot; the lit ones by the row's dice (the seed: over a half, lit); the sill under each, where
  // the row has its sill (the hold): seen where it's held)
  windows: (d) => {
    // (one quad the row: its panes, which are lit and the sill under each cut from it as it's drawn (render.ts), from its seed:
    // how many, the share lit, and 100 more where the row sits on its sill (the hold): seen where it's held)
    const [p, q] = d.pts, n = d.count ?? 1, y = p[1], lit = Math.min(0.9, ((d.lit ?? 0) / n) * 0.9);
    const p0: P3 = [p[0] - d.n[0] * 0.02, p[1], p[2] - d.n[1] * 0.02], s = along(d, p, q);
    return [onFace(d, p0, Math.min(0, s), Math.max(0, s), 0, 0.03, y - 0.06, y + d.h - 0.1, TAG.WINDOW, n + lit + (d.holds?.length ? 100 : 0), true)];
  },
  // (a bundle as one box a run (its pipes striped on it as it's coloured): up from the street, across the jog, up to the roof)
  pipes: (d) => {
    const [a, b, c, e] = d.pts, n = d.count ?? 2, r = n * 0.055, jog = (b[1] + c[1]) / 2, s = along(d, a, c);
    const base: P3 = [a[0] - d.n[0] * 0.12, a[1], a[2] - d.n[1] * 0.12];
    return [onFace(d, base, -r, r, 0.05, 0.14, 0, jog + r, TAG.PIPE), onFace(d, base, Math.min(0, s) - r, Math.max(0, s) + r, 0.05, 0.14, jog - r, jog + r, TAG.PIPE), onFace(d, base, s - r, s + r, 0.05, 0.14, jog - r, e[1], TAG.PIPE)];
  },
  // (two rails, and the rungs between: one quad, cut into rungs every 30 cm as it's drawn (render.ts))
  ladder: (d) => {
    const [a, b] = d.pts, base: P3 = [a[0] - d.n[0] * 0.1, 0, a[2] - d.n[1] * 0.1], out: Box[] = [];
    for (const s of [-0.22, 0.22]) out.push(onFace(d, base, s - 0.025, s + 0.025, 0.08, 0.16, a[1], b[1], TAG.BAR));
    out.push(onFace(d, base, -0.22, 0.22, 0.1, 0.12, a[1] + 0.05, b[1] - 0.05, TAG.RUNGS, undefined, true));
    return out;
  },
  // (a sign standing out from the face on its edge: a board a metre out, on a bracket)
  blade: (d) => {
    const [top, bot] = d.pts, base: P3 = [top[0] - d.n[0] * 0.6, 0, top[2] - d.n[1] * 0.6];
    return [onFace(d, base, -0.06, 0.06, 0.15, 1.05, bot[1], top[1], TAG.SIGN, d.seed % 997 / 997), onFace(d, base, -0.03, 0.03, 0, 0.2, top[1] - 0.15, top[1] - 0.05, TAG.BAR)];
  },
  // (a streak down the face, flat on it)
  rust: (d) => {
    const [a, b] = d.pts, base: P3 = [a[0] - d.n[0] * 0.02, 0, a[2] - d.n[1] * 0.02];
    return [onFace(d, base, -d.w / 2, d.w / 2, 0, 0.012, Math.min(a[1], b[1]), Math.max(a[1], b[1]), TAG.RUST, d.seed % 991 / 991, true)];
  },
  // (out over the shopfront, a metre deep)
  awning: (d) => {
    const [a, b] = d.pts, base: P3 = [a[0] - d.n[0] * 0.9, 0, a[2] - d.n[1] * 0.9];
    return [onFace(d, base, 0, along(d, a, b), 0, 0.95, a[1] - 0.12, a[1] + 0.05, TAG.AWNING, d.seed % 983 / 983)];
  },
  // (a lit tube along the face over the shop)
  neon: (d) => {
    const [a, b] = d.pts, base: P3 = [a[0] - d.n[0] * 0.02, 0, a[2] - d.n[1] * 0.02];
    return [onFace(d, base, 0, along(d, a, b), 0.02, 0.1, a[1], a[1] + d.h, TAG.NEON, d.seed % 977 / 977)];
  },
  // (a board on two legs along a roof's edge, facing out)
  billboard: (d) => {
    const [a, b] = d.pts, base: P3 = [a[0], 0, a[2]], len = along(d, a, b), y = a[1], out = [onFace(d, base, Math.min(0, len), Math.max(0, len), -0.15, 0, y + 1.2, y + 1.2 + d.h, TAG.SIGN, d.seed % 971 / 971)];
    for (const t of [0.2, 0.8]) out.push(onFace(d, base, len * t - 0.06, len * t + 0.06, -0.4, -0.15, y, y + 1.3, TAG.BAR));
    return out;
  },
  // (a mast and its cross-pieces)
  aerial: (d) => { const [p] = d.pts; return [stand(p, 0.05, 0.05, d.h, TAG.BAR), stand(p, d.w, 0.03, 0.03, TAG.BAR, p[1] + d.h * 0.8), stand(p, 0.03, d.w * 0.7, 0.03, TAG.BAR, p[1] + d.h * 0.6)]; },
  // (a dish on a short post: a plate standing up)
  dish: (d) => { const [p] = d.pts; return [stand(p, 0.08, 0.08, d.h * 0.55, TAG.BAR), stand(p, d.w, 0.1, d.w * 0.8, TAG.UNIT, p[1] + d.h * 0.45)]; },
  // (a line across and what hangs off it, a cloth every so often)
  laundry: (d) => {
    const [a, b] = d.pts, out = strung(a, b, 0.012, TAG.WIRE, 6);
    for (const p of [a, b]) out.push(stand([p[0], p[1] - d.h, p[2]], 0.05, 0.05, d.h, TAG.BAR));
    for (let i = 1; i < 6; i++) if (pick(d.seed, i) < 0.7) { const t = i / 6, m: P3 = [a[0] + (b[0] - a[0]) * t, a[1], a[2] + (b[2] - a[2]) * t]; const c = stand([m[0], m[1] - 0.6, m[2]], 0.45, 0.04, 0.58, TAG.CLOTH); c.seed = pick(d.seed, i + 20); out.push(c); }
    return out;
  },
  pole: (d) => { const [p] = d.pts; return [stand(p, d.w, d.w, d.h, TAG.POLE), stand(p, 1.2, 0.08, 0.08, TAG.POLE, p[1] + d.h - 1.5)]; },
  wire: (d) => { const out: Box[] = []; for (let i = 0; i + 1 < d.pts.length; i++) out.push(...strung(d.pts[i], d.pts[i + 1], 0.015, TAG.WIRE, 6)); return out; },
  vending: (d) => { const [p] = d.pts; return [onFace(d, [p[0] - d.n[0] * 0.4, 0, p[2] - d.n[1] * 0.4], -d.w / 2, d.w / 2, 0, 0.75, 0, d.h, TAG.FURNITURE, d.seed % 967 / 967)]; },
  bin: (d) => { const [p] = d.pts; return [onFace(d, [p[0] - d.n[0] * 0.35, 0, p[2] - d.n[1] * 0.35], -d.w / 2, d.w / 2, 0.05, 0.55, 0, d.h, TAG.FURNITURE, 0.1)]; },
};

/** what's drawn of a chunk's details */
export const dressingOf = (details: Detail[]): Box[] => details.flatMap((d) => DRESS[d.kind](d));
