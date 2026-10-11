/**
 * Taohua: the world, a band at a time. The hill is cut across into bands, so deep up the hill;
 * each is made from the seed and its number (the same seed, the same hillside): the ground; the
 * path's steps and landings that fall in it, with their kerbs; black rocks along the path's
 * edges and among the trees; peach trees, grown branch by branch, their blossom in clumps of
 * puffs about the ends of their branches; petals fallen on the ground; and now and then, beside
 * a landing, a temple. What's solid is one mesh (vertices: position, normal, colour, material);
 * the blossom and the petals are lists for instancing.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { LANDING, Path, RISE, WIDTH, type Flight, type V3 } from './path';

/** how deep a band is, up the hill (m); how far across the hill the world goes, each side */
export const BAND = 12, SPAN = 20;
/** a vertex: position, normal, colour, material */
export const STRIDE = 10;
/** materials: what the drawing does with each */
export const M = { ground: 0, step: 1, stone: 2, rock: 3, trunk: 4, tile: 5, red: 6, wall: 7, robe: 8, hat: 9, petal: 10, blossom: 11, plaque: 12, twig: 13, dark: 14, skin: 15, ridge: 16, grass: 17 } as const;

type C3 = [number, number, number];
const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** the temples' names, in turn, as their plaques have them */
export const NAMES = ['大林寺', '桃花庵', '白云寺', '清凉寺', '栖霞寺', '云居寺', '灵岩寺', '兰若寺'];
/** the print's inks */
export const INK = {
  paper: hex(0xefe6d3), stepTop: hex(0xebe4d4), stepFace: hex(0xcfc6b4), stone: hex(0xb9b1a1), rock: hex(0x2a2827), rockTop: hex(0x7d7c79),
  trunk: hex(0x2b2321), tile: hex(0x3d9887), tileDark: hex(0x2b6f64), red: hex(0xb8382c), wall: hex(0xeee9df), dark: hex(0x2d2622),
  robe: hex(0x6f7882), hat: hex(0xd8c39a), skin: hex(0xe2c7a6), grass: hex(0x6d7258), gable: hex(0x9c3a2e),
};

export interface Band {
  j: number;
  verts: Float32Array;
  /** blossom puffs: x, y, z, radius, shade (0 dark–1 light), seed; per puff */
  puffs: Float32Array;
  /** fallen petals: x, y, z, size, turn, shade */
  petals: Float32Array;
  /** temples in it: where (their terrace's middle), facing */
  temples: Array<{ c: V3; face: number; poem: number }>;
}

/** A mesh as it's built: faces pushed with their normals and colours. */
export class Mesh {
  v: number[] = [];
  tri(a: V3, b: V3, c: V3, col: C3, m: number, n?: V3) {
    const nn = n ?? norm(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) this.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], col[0], col[1], col[2], m);
  }
  quad(a: V3, b: V3, c: V3, d: V3, col: C3, m: number, n?: V3) { this.tri(a, b, c, col, m, n); this.tri(a, c, d, col, m, n); }
  /** a box: its middle, half its size, turned about the vertical (its x along `dir`); its top and its sides each a colour */
  box(c: V3, h: V3, dir: [number, number], top: C3, side: C3, m: number, mSide = m) {
    const [ux, uz] = dir, vx = uz, vz = -ux;
    const P = (x: number, y: number, z: number): V3 => [c[0] + ux * x + vx * z, c[1] + y, c[2] + uz * x + vz * z];
    const [hx, hy, hz] = h;
    this.quad(P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), top, m, [0, 1, 0]);
    const faces: Array<[V3, V3, V3, V3, V3]> = [
      [P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(hx, -hy, hz), [ux, 0, uz]],
      [P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), P(-hx, -hy, -hz), [-ux, 0, -uz]],
      [P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, -hy, -hz), [-vx, 0, -vz]],
      [P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), P(-hx, -hy, hz), [vx, 0, vz]],
    ];
    for (const [a, b, cc, d, n] of faces) this.quad(a, b, cc, d, side, mSide, n);
  }
  /** a tapered tube from a to b, so many sides */
  tube(a: V3, b: V3, ra: number, rb: number, col: C3, m: number, sides = 6) {
    const d = norm(sub(b, a));
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref)), w = cross(d, u);
    for (let k = 0; k < sides; k++) {
      const t0 = (k / sides) * Math.PI * 2, t1 = ((k + 1) / sides) * Math.PI * 2;
      const o0: V3 = add(mul(u, Math.cos(t0)), mul(w, Math.sin(t0))), o1: V3 = add(mul(u, Math.cos(t1)), mul(w, Math.sin(t1)));
      const n = norm(add(o0, o1));
      this.quad(add(a, mul(o0, ra)), add(b, mul(o0, rb)), add(b, mul(o1, rb)), add(a, mul(o1, ra)), col, m, n);
    }
  }
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

/** The ground's height at (x, z): the hill there, a little rolling. */
export function ground(path: Path, x: number, z: number): number {
  return path.hill(z) + 0.18 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.53 - x * 0.2) - 0.04;
}

/** Where the temples stand, near z: beside the landing at the head of each flight that has one. */
export function templesNear(path: Path, z0: number, z1: number): Array<{ c: V3; face: [number, number]; poem: number; flight: Flight }> {
  path.extend(z1 + 20);
  const out: Array<{ c: V3; face: [number, number]; poem: number; flight: Flight }> = [];
  let poem = 0;
  for (const f of path.flights) {
    if (!f.temple) continue;
    poem++;
    // (on the landing at its head: the path goes on along the next flight; the temple stands off to the side, facing the landing)
    const L: V3 = [f.b[0] + f.dir[0] * LANDING / 2, f.b[1], f.b[2] + f.dir[1] * LANDING / 2];
    const px = f.dir[1] * f.temple, pz = -f.dir[0] * f.temple;
    const c: V3 = [L[0] + px * (WIDTH / 2 + 5.8), f.b[1], L[2] + pz * (WIDTH / 2 + 5.8)];
    if (c[2] < z0 - 12 || c[2] > z1 + 12) continue;
    out.push({ c, face: [-px, -pz], poem, flight: f });
  }
  return out;
}

/** Band j of the hill. */
export function makeBand(path: Path, seed: number, j: number): Band {
  const z0 = j * BAND, z1 = z0 + BAND;
  path.extend(z1 + 30);
  const r = seeded(hash(seed, j, 0xb4d));
  const mesh = new Mesh();
  const puffs: number[] = [], petals: number[] = [];
  const temples = templesNear(path, z0, z1);
  const inBand = (z: number) => z >= z0 && z < z1;

  // the ground: a sheet across the hill, the paper's cream
  const nx = 2 * SPAN / 1.5, nz = BAND / 1.5;
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const xa = -SPAN + i * 1.5, xb = xa + 1.5, za = z0 + k * 1.5, zb = za + 1.5;
    const P = (x: number, z: number): V3 => [x, ground(path, x, z), z];
    mesh.quad(P(xa, za), P(xa, zb), P(xb, zb), P(xb, za), [0, 0, 0], M.ground, [0, 1, 0]);
  }

  // the path: each step, each landing, that falls in this band, with their kerbs
  path.flights.forEach((f, fi) => {
    const prev = path.flights[fi - 1];
    const pd = prev ? prev.dir : f.dir;
    // (the landing: a broad flagstone where the flights meet, wide enough for the turn)
    if (inBand(f.land[2])) {
      // (the last flight's way on, and this one's, each as wide as the stair, meeting at the turn)
      const start: V3 = prev ? prev.b : [0, 0, 0];
      const e: V3 = [start[0] + pd[0] * LANDING * 0.5, f.a[1] - 0.4, start[2] + pd[1] * LANDING * 0.5];
      mesh.box(e, [LANDING * 0.5 + 0.15, 0.4, WIDTH / 2 + 0.05], pd, INK.stepTop, INK.stone, M.step, M.stone);
      const g: V3 = [f.a[0] - f.dir[0] * LANDING * 0.35, f.a[1] - 0.4 + 0.002, f.a[2] - f.dir[1] * LANDING * 0.35];
      mesh.box(g, [LANDING * 0.35 + 0.15, 0.4, WIDTH / 2 + 0.05], f.dir, INK.stepTop, INK.stone, M.step, M.stone);
    }
    for (let k = 0; k < f.steps; k++) {
      const u = (k + 0.5) * f.run;
      const c: V3 = [f.a[0] + f.dir[0] * u, f.a[1] + (k + 1) * RISE - 0.5, f.a[2] + f.dir[1] * u];
      if (!inBand(c[2])) continue;
      // (each step a slab, deep into the hill, laid a little unevenly: not quite as wide as the last, a shade off true)
      const h = hash(seed, fi, k);
      const tone = 0.95 + 0.07 * ((h % 100) / 100);
      const wid = WIDTH / 2 + ((h >> 8) % 100) / 100 * 0.25 - 0.1, shift = (((h >> 16) % 100) / 100 - 0.5) * 0.18;
      const cc: V3 = [c[0] + f.dir[1] * shift, c[1], c[2] - f.dir[0] * shift];
      mesh.box(cc, [f.run / 2 + 0.02, 0.5, wid], f.dir, [INK.stepTop[0] * tone, INK.stepTop[1] * tone, INK.stepTop[2] * tone], INK.stone, M.step, M.stone);
      // (now and then a squared block at its side, as a stair is built against the hill)
      if ((h >> 4) % 5 === 0) {
        const sd = (h >> 12) % 2 ? 1 : -1, off = (wid + 0.35) * sd;
        const bc: V3 = [cc[0] + f.dir[1] * off, c[1] + 0.12 + ((h >> 20) % 3) * 0.06, cc[2] - f.dir[0] * off];
        mesh.box(bc, [f.run * (0.9 + ((h >> 6) % 3) * 0.4), 0.5, 0.35], f.dir, INK.stone, INK.stepFace, M.stone);
      }
    }
  });

  // each flight's sides: a stone wall along each edge, from the hill up to its steps' noses, so a flight is one solid stair set into the slope
  path.flights.forEach((f) => {
    const L = f.steps * f.run;
    for (const sd of [-1, 1]) {
      const off = (WIDTH / 2 + 0.24) * sd;
      const ox = f.dir[1] * off, oz = -f.dir[0] * off;
      // (in short lengths, those in this band)
      const n = Math.max(1, Math.ceil(L / 1.5));
      for (let i = 0; i < n; i++) {
        const u0 = (i / n) * L, u1 = ((i + 1) / n) * L, um = (u0 + u1) / 2;
        if (!inBand(f.a[2] + f.dir[1] * um)) continue;
        const P = (u: number, y: number): V3 => [f.a[0] + f.dir[0] * u + ox, y, f.a[2] + f.dir[1] * u + oz];
        const y0 = f.a[1] + (u0 / L) * (f.b[1] - f.a[1]) + 0.12, y1 = f.a[1] + (u1 / L) * (f.b[1] - f.a[1]) + 0.12;
        const out: V3 = [f.dir[1] * sd, 0, -f.dir[0] * sd];
        mesh.quad(P(u0, y0 - 1.2), P(u0, y0), P(u1, y1), P(u1, y1 - 1.2), INK.stone, M.stone, out);
        // (its top, a coping a hand wide)
        const ix = -f.dir[1] * 0.28 * sd, iz = f.dir[0] * 0.28 * sd;
        const a = P(u0, y0), b = P(u1, y1);
        mesh.quad(a, b, [b[0] + ix, b[1], b[2] + iz], [a[0] + ix, a[1], a[2] + iz], INK.stepTop, M.stone, [0, 1, 0]);
      }
    }
  });

  // temples
  for (const t of temples) if (inBand(t.c[2])) temple(mesh, t.c, t.face, hash(seed, t.poem, 0x7e), (t.poem - 1) % NAMES.length);

  // rocks along the path's edges, black, in little clusters, and the ground about them
  const gy = (x: number, z: number) => ground(path, x, z);
  const rocks: Array<[number, number, number]> = [];
  path.flights.forEach((f, fi) => {
    const rr = seeded(hash(seed, fi, 0x40c));
    for (let u = 0.6; u < f.steps * f.run; u += ramp(rr, 0.9, 2.6)) {
      for (const sd of [-1, 1]) {
        if (rr() < 0.55) continue;
        const off = (WIDTH / 2 + 0.6 + rr() * 0.9) * sd;
        const x = f.a[0] + f.dir[0] * u + f.dir[1] * off, z = f.a[2] + f.dir[1] * u - f.dir[0] * off;
        if (!inBand(z)) continue;
        rocks.push([x, z, ramp(rr, 0.28, 0.7)]);
        // (a smaller one leaning on it, now and then; and another)
        for (let k = 0; k < 2 && rr() < 0.55; k++) { const a = rr() * 6.3, d = ramp(rr, 0.45, 0.8); rocks.push([x + Math.cos(a) * d + f.dir[1] * 0.2 * sd, z + Math.sin(a) * d, ramp(rr, 0.18, 0.42)]); }
      }
    }
  });
  // (and a few out among the trees, low and broad)
  for (let i = 0; i < 5; i++) {
    const x = ramp(r, -SPAN + 2, SPAN - 2), z = ramp(r, z0, z1);
    if (path.nearest(x, z).d < WIDTH / 2 + 0.8) continue;
    rocks.push([x, z, ramp(r, 0.4, 0.95)]);
  }
  for (const [x, z, sz] of rocks) {
    if (path.nearest(x, z).d < WIDTH / 2 + 0.35) continue;
    const rr = seeded(hash(Math.round(x * 10), Math.round(z * 10), seed));
    rock(mesh, [x, gy(x, z), z], sz, rr, gy);
    shade(mesh, path, x - 0.25 * sz, z + 0.2 * sz, sz * 1.9, sz * 1.6, 0.32);
    for (let k = 0, n = 1 + Math.floor(rr() * 3); k < n; k++) { const a = rr() * 6.3, d = sz * ramp(rr, 1, 1.5); tuft(mesh, path, x + Math.cos(a) * d, z + Math.sin(a) * d, rr, 3 + Math.floor(rr() * 4)); }
  }
  // grass in tufts along the stair's foot, and here and there on the hill
  path.flights.forEach((f, fi) => {
    const rr = seeded(hash(seed, fi, 0x6a5));
    for (let u = 0.3; u < f.steps * f.run; u += ramp(rr, 0.5, 1.4)) {
      const sd = rr() < 0.5 ? 1 : -1, off = (WIDTH / 2 + 0.3 + rr() * 0.25) * sd;
      const x = f.a[0] + f.dir[0] * u + f.dir[1] * off, z = f.a[2] + f.dir[1] * u - f.dir[0] * off;
      if (inBand(z)) tuft(mesh, path, x, z, rr, 3 + Math.floor(rr() * 4));
    }
  });
  for (let i = 0; i < 40; i++) {
    const x = ramp(r, -SPAN, SPAN), z = ramp(r, z0, z1);
    if (path.nearest(x, z).d > WIDTH / 2 + 0.5) tuft(mesh, path, x, z, r, 2 + Math.floor(r() * 4));
  }

  // trees: on a jittered grid, not on the path (though they lean over it), not on a temple's terrace
  const G = 3.9;
  const onTemple = (x: number, z: number, m: number) => temples.some((t) => {
    // (in the temple's own frame: across its front, and out from it)
    const dx = x - t.c[0], dz = z - t.c[2];
    const ax = Math.abs(dx * -t.face[1] + dz * t.face[0]), az = dx * t.face[0] + dz * t.face[1];
    return ax < 5 + m && az > -4.2 - m && az < 5.2 + m;
  });
  for (let gx = -SPAN + 1; gx < SPAN; gx += G) for (let gz = Math.ceil(z0 / G) * G; gz < z1; gz += G) {
    const tr = seeded(hash(seed, Math.round(gx * 10), Math.round(gz * 10), 0x7ee));
    if (tr() < 0.06) continue;
    const x = gx + (tr() - 0.5) * G * 0.9, z = gz + (tr() - 0.5) * G * 0.9;
    if (!inBand(z)) continue;
    if (path.nearest(x, z).d < WIDTH / 2 + 1.5) continue;
    if (onTemple(x, z, 0.8)) continue;
    // (rocks at its roots, now and then, as in the print)
    if (tr() < 0.45) for (let k = 0, n = 1 + Math.floor(tr() * 3); k < n; k++) {
      const a = tr() * 6.3, d = 0.5 + tr() * 0.9, rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d, sz = ramp(tr, 0.3, 0.7);
      if (path.nearest(rx, rz).d > WIDTH / 2 + 0.5) { rock(mesh, [rx, gy(rx, rz), rz], sz, seeded(hash(seed, Math.round(rx * 10), Math.round(rz * 10))), gy); tuft(mesh, path, rx + sz, rz, tr, 4); }
    }
    tree(mesh, puffs, petals, [x, ground(path, x, z), z], tr, path);
  }
  // petals fallen on the path too
  for (let i = 0; i < 90; i++) {
    const x = ramp(r, -SPAN, SPAN), z = ramp(r, z0, z1);
    const nr = path.nearest(x, z);
    const y = nr.d < WIDTH / 2 ? path.at(nr.s).p[1] + 0.01 : ground(path, x, z) + 0.02;
    petals.push(x, y, z, ramp(r, 0.05, 0.1), r() * Math.PI, r());
  }
  return { j, verts: new Float32Array(mesh.v), puffs: new Float32Array(puffs), petals: new Float32Array(petals), temples: temples.filter((t) => inBand(t.c[2])).map((t) => ({ c: t.c, face: Math.atan2(t.face[0], t.face[1]), poem: t.poem })) };
}

/**
 * A rock: a craggy lump, black, as the print has them; where its faces turn up to the light, a grey
 * laid on with a dry brush (in the drawing). An icosahedron cut once more, its corners pushed out
 * and in, then split along a few planes (flat faces, sharp edges: a crag, not a pebble), squashed,
 * and set into the slope it stands on, its foot under the ground all round.
 */
function rock(mesh: Mesh, at: V3, size: number, r: Rand, gy?: (x: number, z: number) => number) {
  const t = (1 + Math.sqrt(5)) / 2;
  let P: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V3));
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  // (cut once more: each face into four, the new corners on the sphere)
  const mids = new Map<string, number>();
  const mid = (a: number, b: number) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!mids.has(key)) { P.push(norm(add(P[a], P[b]))); mids.set(key, P.length - 1); }
    return mids.get(key)!;
  };
  F = F.flatMap(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  const sx = size * ramp(r, 0.9, 1.5), sy = size * ramp(r, 0.6, 1.15), sz = size * ramp(r, 0.8, 1.2), turn = r() * 6.3;
  const bump = P.map(() => ramp(r, 0.78, 1.15));
  // (its planes of cleavage: what stands out past one is pressed back onto it)
  const cuts: Array<[V3, number]> = [];
  for (let k = 0, n = 4 + Math.floor(r() * 4); k < n; k++) cuts.push([norm([ramp(r, -1, 1), ramp(r, -0.2, 1), ramp(r, -1, 1)]), ramp(r, 0.55, 0.85)]);
  // (a crag leans: its top pushed off to one side)
  const lx = ramp(r, -0.3, 0.3), lz = ramp(r, -0.3, 0.3);
  P = P.map((p0, i) => {
    let p = mul(p0, bump[i]);
    for (const [n, d] of cuts) { const e = p[0] * n[0] + p[1] * n[1] + p[2] * n[2] - d; if (e > 0) p = sub(p, mul(n, e)); }
    const y = Math.max(-0.35, p[1]);
    const x = (p[0] + lx * Math.max(0, y)) * sx, z = (p[2] + lz * Math.max(0, y)) * sz;
    const wx = at[0] + x * Math.cos(turn) - z * Math.sin(turn), wz = at[2] + x * Math.sin(turn) + z * Math.cos(turn);
    // (stood on the ground where each part of it is: on a slope, it follows the slope, so no side of it floats)
    const g = gy ? gy(wx, wz) : at[1];
    return [wx, g + y * sy + sy * 0.18, wz] as V3;
  });
  for (const [a, b, c] of F) mesh.tri(P[a], P[b], P[c], INK.rock, M.rock);
}

/**
 * Shade on the ground: a soft patch, under a rock or a tree, a little off toward the shadow side
 * (in the drawing: the ground's colour carries where in the patch it is, and how deep).
 */
function shade(mesh: Mesh, path: Path, x: number, z: number, rx: number, rz: number, deep: number) {
  const N = 12, lift = 0.04 + deep * 0.08;
  const G = (u: number, v: number): V3 => { const px = x + u * rx, pz = z + v * rz; return [px, ground(path, px, pz) + lift, pz]; };
  const c = G(0, 0);
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    const p0 = G(Math.cos(a0), Math.sin(a0)), p1 = G(Math.cos(a1), Math.sin(a1));
    mesh.v.push(c[0], c[1], c[2], 0, 1, 0, 0, 0, deep, M.ground);
    mesh.v.push(p1[0], p1[1], p1[2], 0, 1, 0, Math.cos(a1), Math.sin(a1), deep, M.ground);
    mesh.v.push(p0[0], p0[1], p0[2], 0, 1, 0, Math.cos(a0), Math.sin(a0), deep, M.ground);
  }
}

/** A tuft of grass: a few blades, fine, leaning out from a clump; where the ground meets a rock or a wall. */
function tuft(mesh: Mesh, path: Path, x: number, z: number, r: Rand, n = 5) {
  const y = ground(path, x, z);
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, lean = ramp(r, 0.15, 0.6), h = ramp(r, 0.12, 0.32), w = ramp(r, 0.018, 0.03);
    const bx = x + Math.cos(a) * 0.08 * r(), bz = z + Math.sin(a) * 0.08 * r();
    const tip: V3 = [bx + Math.cos(a) * lean * h, y + h, bz + Math.sin(a) * lean * h];
    // (a blade: a thin triangle, turned across the way it leans)
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    mesh.tri([bx - px, y - 0.02, bz - pz], [bx + px, y - 0.02, bz + pz], tip, INK.grass, M.grass, [0, 1, 0]);
  }
}

/**
 * A peach tree, as the print has them: a short trunk, leaning, opening at once into four to six
 * limbs that spread wide and up, each limb gently bent and splitting, and splitting again, into a
 * fan of thin twigs; the blossom in clumps along the ends of the twigs, so a tree is a broad
 * umbrella of pink, pale on top and deep beneath, with its dark branches through it (the thinner
 * ones are drawn a little nearer the eye than they are, so they show over the blossom, as ink
 * over colour); petals fallen under it, some whole flowers, in drifts.
 */
function tree(mesh: Mesh, puffs: number[], petals: number[], base: V3, r: Rand, path: Path) {
  const H = ramp(r, 0.45, 1.0), lean: V3 = norm([ramp(r, -0.3, 0.3), 1, ramp(r, -0.3, 0.3)]);
  const top = add(base, mul(lean, H));
  const R0 = ramp(r, 0.17, 0.27);
  mesh.tube([base[0], base[1] - 0.3, base[2]], top, R0 * 1.4, R0, INK.trunk, M.trunk, 8);
  const tips: Array<[V3, V3]> = [];
  const UP: V3 = [0, 1, 0];
  /** a limb: bent a little partway, then on; at its end, more, or a spray of twigs */
  const grow = (from: V3, dir: V3, len: number, rad: number, depth: number) => {
    const bend = norm(add(add(dir, mul(UP, 0.18)), [ramp(r, -0.2, 0.2), ramp(r, -0.1, 0.15), ramp(r, -0.2, 0.2)]));
    const mid = add(from, mul(dir, len * 0.5)), to = add(mid, mul(bend, len * 0.5));
    const m = M.twig, sides = depth >= 2 ? 3 : depth >= 1 ? 5 : 7;
    mesh.tube(from, mid, rad, rad * 0.84, INK.trunk, m, sides);
    mesh.tube(mid, to, rad * 0.84, rad * 0.66, INK.trunk, m, sides);
    if (depth >= 2) {
      // (a spray of fine twigs out of the end, and the blossom along them)
      for (let k = 0; k < 3; k++) {
        const d = norm(add(bend, [ramp(r, -0.7, 0.7), ramp(r, -0.2, 0.5), ramp(r, -0.7, 0.7)]));
        const end = add(to, mul(d, len * ramp(r, 0.5, 0.9)));
        mesh.tube(to, end, rad * 0.6, 0.008, INK.trunk, M.twig, 3);
        tips.push([end, d]);
      }
      tips.push([to, bend]);
      return;
    }
    const n = depth === 0 ? 2 + Math.floor(r() * 2) : 2 + Math.floor(r() * 2);
    // (about its own way, each child turned out, a little up)
    const u = norm(cross(bend, Math.abs(bend[1]) < 0.9 ? UP : [1, 0, 0])), w = cross(bend, u);
    for (let i = 0; i < n; i++) {
      const phi = (i / n) * Math.PI * 2 + r() * 1.5, th = depth === 0 ? ramp(r, 0.4, 0.7) : ramp(r, 0.35, 0.6);
      const d = norm(add(add(mul(bend, Math.cos(th)), mul(add(mul(u, Math.cos(phi)), mul(w, Math.sin(phi))), Math.sin(th))), mul(UP, 0.12)));
      grow(to, d, len * ramp(r, 0.62, 0.8), rad * 0.62, depth + 1);
    }
  };
  // (the limbs: four to six, round about, spreading out and up from the top of the trunk)
  const limbs = 4 + Math.floor(r() * 3), a0 = r() * 6.28;
  for (let i = 0; i < limbs; i++) {
    const a = a0 + (i / limbs) * Math.PI * 2 + ramp(r, -0.3, 0.3), el = ramp(r, 0.55, 0.95);
    const d = norm([Math.cos(a) * Math.cos(el) + lean[0] * 0.3, Math.sin(el), Math.sin(a) * Math.cos(el) + lean[2] * 0.3]);
    grow(top, d, ramp(r, 1.3, 1.9), R0 * 0.55, 0);
  }
  // the crown's middle, for its lighting
  let cx = 0, cy = 0, cz = 0;
  for (const [p] of tips) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= tips.length; cy /= tips.length; cz /= tips.length;
  // (its shade on the ground: broad and faint under the crown, off to the shadow side; deeper about the trunk's foot)
  shade(mesh, path, cx - 0.5 * (cy - base[1]) * 0.55, cz + 0.5 * (cy - base[1]) * 0.35, 2.7, 2.3, 0.1);
  shade(mesh, path, base[0] - 0.15, base[2] + 0.1, 0.75, 0.6, 0.22);
  const L: V3 = norm([0.55, 0.75, -0.35]);
  for (const [p, d] of tips) {
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      // (clumps along the twig's end, lifted a little: the blossom sits on top of the branches)
      const q: V3 = [p[0] + d[0] * ramp(r, -0.3, 0.1) + ramp(r, -0.35, 0.35), p[1] + ramp(r, 0, 0.35), p[2] + d[2] * ramp(r, -0.3, 0.1) + ramp(r, -0.35, 0.35)];
      const rad = ramp(r, 0.4, 0.68);
      // (none over the path: the crowns stop short of it, so the way stays open)
      if (path.nearest(q[0], q[2]).d < WIDTH / 2 + 0.25) continue;
      const out = norm([q[0] - cx, (q[1] - cy) * 1.8, q[2] - cz]);
      const shade = Math.max(0, Math.min(1, 0.42 + 0.4 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.3 * (q[1] - cy) + ramp(r, -0.08, 0.08)));
      puffs.push(q[0], q[1], q[2], rad, shade, r());
    }
  }
  // petals fallen under it, where it's not the path: in drifts, some whole flowers
  for (let k = 0; k < 4; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.4;
    const dx = cx + Math.cos(a) * d, dz = cz + Math.sin(a) * d;
    for (let i = 0; i < 9; i++) {
      const x = dx + (r() - 0.5) * 1.6, z = dz + (r() - 0.5) * 1.2;
      const nr = path.nearest(x, z);
      const y = nr.d < WIDTH / 2 ? path.at(nr.s).p[1] + 0.01 : ground(path, x, z) + 0.02;
      // (shade above .5: a whole flower)
      petals.push(x, y, z, ramp(r, 0.06, 0.12), r() * Math.PI, r());
    }
  }
}

/**
 * A temple hall on its terrace, as the print has it: a stone platform, raised, a stair up its front
 * and a balustrade round its edge; white walls, red columns across its front, lattice windows and a
 * red door, a plaque over it, a row of brackets under the eaves; its roof of teal glazed tiles,
 * hip-and-gable: the lower slopes hipped all round, the upper part a gable at each end, red, under
 * a barge board; its eaves well out and swept up at the corners; a ridge along its top with its
 * ends curled up, ridges down the gables' edges, and down each hip to the corners.
 * `face`: the way its front looks.
 */
function temple(mesh: Mesh, c: V3, face: [number, number], seed: number, name: number) {
  const r = seeded(seed);
  // (its x along the front; z out of the front)
  const fx = -face[1], fz = face[0];
  const P = (x: number, y: number, z: number): V3 => [c[0] + fx * x + face[0] * z, c[1] + y, c[2] + fz * x + face[1] * z];
  const along: [number, number] = [fx, fz];
  const W = ramp(r, 2.9, 3.4), D = ramp(r, 2.0, 2.4), Hw = 2.6, B = 0.9;
  const stone = INK.stepTop;
  // the terrace: stone, raised, deep into the hill under it
  const tw = W + 1.4, tf = D + 1.3, tb = -D - 0.9;
  mesh.box(P(0, B - 2.5, (tf + tb) / 2), [tw, 2.5, (tf - tb) / 2], along, stone, INK.stepFace, M.step, M.stone);
  // (its stair, down the front to the path; cheeks either side)
  const ns = 4, sw = 1.25;
  for (let k = 0; k < ns; k++) {
    const top = B * (ns - k) / (ns + 1), z = tf + (k + 0.5) * 0.32;
    mesh.box(P(0, top - 1.5, z), [sw, 1.5, 0.17], along, stone, INK.stepFace, M.step, M.stone);
  }
  for (const sx of [-1, 1]) {
    // (a cheek: a sloped stone wall, its top a coping, down beside the stair)
    const x = sx * (sw + 0.14), z0 = tf, z1 = tf + ns * 0.32 + 0.1, y0 = B + 0.12, y1 = B / (ns + 1) + 0.1;
    const o = 0.14;
    mesh.quad(P(x + o * sx, y0, z0), P(x + o * sx, y1, z1), P(x + o * sx, -1.5, z1), P(x + o * sx, -1.5, z0), INK.stone, M.stone, [fx * sx, 0, fz * sx]);
    mesh.quad(P(x - o * sx, y0, z0), P(x - o * sx, -1.5, z0), P(x - o * sx, -1.5, z1), P(x - o * sx, y1, z1), INK.stone, M.stone, [-fx * sx, 0, -fz * sx]);
    mesh.quad(P(x - o, y0, z0), P(x + o, y0, z0), P(x + o, y1, z1), P(x - o, y1, z1), stone, M.stone);
    mesh.quad(P(x - o, y1, z1), P(x + o, y1, z1), P(x + o, -1.5, z1), P(x - o, -1.5, z1), INK.stone, M.stone, [face[0], 0, face[1]]);
  }
  // (the balustrade: posts, a rail along their tops and one low; round the terrace but where the stair goes up)
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.55));
    const dl: [number, number] = [((bx - ax) * fx + (bz - az) * face[0]) / L, ((bx - ax) * fz + (bz - az) * face[1]) / L];
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
      mesh.box(P(x, B + 0.25, z), [0.065, 0.25, 0.065], along, stone, INK.stone, M.stone);
    }
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    mesh.box(P(mx, B + 0.42, mz), [L / 2, 0.035, 0.04], dl, stone, INK.stone, M.stone);
    mesh.box(P(mx, B + 0.1, mz), [L / 2, 0.03, 0.03], dl, stone, INK.stone, M.stone);
  };
  const ei = 0.12;
  rail(-tw + ei, tf - ei, -sw - 0.3, tf - ei); rail(sw + 0.3, tf - ei, tw - ei, tf - ei);
  rail(-tw + ei, tf - ei, -tw + ei, tb + ei); rail(tw - ei, tf - ei, tw - ei, tb + ei);
  // the walls
  const wz = -0.3, wd = D - 0.4;
  mesh.box(P(0, B + Hw / 2, wz), [W, Hw / 2, wd], along, INK.wall, INK.wall, M.wall);
  // the columns across its front (and round its sides), red
  const n = 4, colZ = D - 0.25;
  const colX = (i: number) => -W + 0.35 + (i / (n - 1)) * (2 * W - 0.7);
  for (let i = 0; i < n; i++) mesh.tube(P(colX(i), B, colZ), P(colX(i), B + Hw, colZ), 0.17, 0.15, INK.red, M.red, 8);
  for (const sx of [-1, 1]) for (const z of [wz, -D + 0.1]) mesh.tube(P(sx * (W + 0.05), B, z), P(sx * (W + 0.05), B + Hw, z), 0.15, 0.13, INK.red, M.red, 8);
  // a beam over them, and a row of brackets on it, under the eaves, all round
  mesh.box(P(0, B + Hw - 0.2, colZ), [W, 0.2, 0.18], along, INK.red, INK.red, M.red);
  for (let x = -W + 0.25; x <= W - 0.2; x += 0.5) {
    mesh.box(P(x, B + Hw + 0.08, colZ + 0.05), [0.13, 0.08, 0.2], along, INK.tileDark, INK.tileDark, M.ridge);
    mesh.box(P(x, B + Hw + 0.08, wz - wd - 0.05), [0.13, 0.08, 0.2], along, INK.tileDark, INK.tileDark, M.ridge);
  }
  // the door, red, its opening dark; lattice windows in the bays either side
  const fz0 = wz + wd;
  mesh.box(P(0, B + 1.15, fz0 + 0.02), [0.85, 1.15, 0.06], along, INK.red, INK.red, M.red);
  mesh.box(P(0, B + 1.05, fz0 + 0.04), [0.62, 1.05, 0.07], along, INK.dark, INK.dark, M.dark);
  for (const sx of [-1, 1]) {
    const x = sx * (W * 0.62);
    mesh.box(P(x, B + 1.45, fz0 + 0.02), [0.62, 0.6, 0.05], along, INK.red, INK.red, M.red);
    mesh.box(P(x, B + 1.45, fz0 + 0.04), [0.5, 0.48, 0.05], along, INK.dark, INK.dark, M.dark);
    // (its lattice: bars, red, across the dark)
    for (let i = -2; i <= 2; i++) mesh.box(P(x + i * 0.17, B + 1.45, fz0 + 0.09), [0.018, 0.48, 0.02], along, INK.red, INK.red, M.red);
    for (let i = -2; i <= 2; i++) mesh.box(P(x, B + 1.45 + i * 0.17, fz0 + 0.09), [0.5, 0.018, 0.02], along, INK.red, INK.red, M.red);
    // (and under it, a panel of the wall, framed)
    mesh.box(P(x, B + 0.45, fz0 + 0.02), [0.62, 0.42, 0.04], along, INK.red, INK.red, M.red);
  }
  // (the plaque: its face carries its name, from the plaque's texture: uv in its colour)
  const pz = colZ + 0.2, py = B + Hw - 0.3;
  const pq = [P(-0.95, py, pz), P(-0.95, py + 0.65, pz), P(0.95, py + 0.65, pz), P(0.95, py, pz)] as const;
  const fn: V3 = [face[0], 0, face[1]];
  // (u to the right as it's looked at from in front)
  const uv: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [0, 0]];
  // (its name, from the plaques' sheet: one name a row)
  for (const k of [0, 1, 2, 0, 2, 3]) { const p = pq[k]; mesh.v.push(p[0], p[1], p[2], fn[0], fn[1], fn[2], uv[k][0], (name + uv[k][1]) / NAMES.length, 0, M.plaque); }

  // the roof: hip-and-gable. u across the front (-1 to 1), v front to back (-1 to 1); within the
  // gables (|x| < gx) the front and back slopes run up to the ridge; outside, the hipped ends run
  // up only so far as the gables' foot (g of the way)
  const ex = W + 1.15, ez = D + 1.15, rz = -0.2, y0 = B + Hw + 0.2, rise = 2.1;
  const gx = W * 0.72, gu = gx / ex, g = 0.5;
  const H = (k: number) => rise * Math.pow(k, 0.72);
  const inward = (u: number, v: number, end: boolean) => {
    const hz = 1 - Math.abs(v);
    if (!end) return hz;
    const hx = g * (ex - Math.abs(u * ex)) / (ex - gx);
    return Math.min(hz, hx);
  };
  const roofAt = (u: number, v: number, end: boolean, up = 0): V3 => {
    const k = inward(u, v, end);
    // (the eaves swept up toward the corners, most at the corner itself)
    const sweep = 0.95 * Math.pow(smooth(0.3, 1, Math.abs(u)) * smooth(0.3, 1, Math.abs(v)), 1.3) * Math.pow(1 - k, 1.4);
    return P(u * ex, y0 + H(k) + sweep + up, rz + v * ez);
  };
  const patch = (ua: number, ub: number, nu: number, end: boolean) => {
    const S = 14;
    for (let i = 0; i < nu; i++) for (let k = 0; k < S; k++) {
      const u0 = ua + ((ub - ua) * i) / nu, u1 = ua + ((ub - ua) * (i + 1)) / nu, v0 = -1 + (2 * k) / S, v1 = v0 + 2 / S;
      const a = roofAt(u0, v0, end), b = roofAt(u0, v1, end), cc = roofAt(u1, v1, end), d = roofAt(u1, v0, end);
      // (one surface, seen from both sides: its underside darker, in the drawing; its colour carries where on the roof it is, for its tiles' channels: down the slope, whichever way the slope runs)
      const at = (uu: number, vv: number): C3 => {
        const hz = 1 - Math.abs(vv), hx = end ? g * (ex - Math.abs(uu * ex)) / (ex - gx) : 9;
        return hx < hz ? [(vv * ez) / 0.24, (ex - Math.abs(uu * ex)) / 0.32, 2] : [(uu * ex) / 0.24, (Math.abs(vv) * ez) / 0.32, 2];
      };
      const nn = norm(cross(sub(b, a), sub(d, a)));
      for (const [p, uu, vv] of [[a, u0, v0], [b, u0, v1], [cc, u1, v1], [a, u0, v0], [cc, u1, v1], [d, u1, v0]] as Array<[V3, number, number]>) {
        const col = at(uu, vv);
        mesh.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], col[0], col[1], col[2], M.tile);
      }
    }
  };
  patch(-1, -gu, 5, true); patch(-gu, gu, 10, false); patch(gu, 1, 5, true);
  const dark = INK.tileDark;
  // (the eaves' edge: a band, thick and dark, all round)
  const edge = (pts: V3[]) => { for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; mesh.quad(a, b, [b[0], b[1] - 0.17, b[2]], [a[0], a[1] - 0.17, a[2]], dark, M.ridge); } };
  const E = 24;
  const eave = (f: (t: number) => [number, number]) => edge(Array.from({ length: E + 1 }, (_, i) => { const [u, v] = f(i / E); return roofAt(u, v, Math.abs(u) > gu - 1e-6); }));
  eave((t) => [-1 + 2 * t, 1]); eave((t) => [-1 + 2 * t, -1]); eave((t) => [-1, -1 + 2 * t]); eave((t) => [1, -1 + 2 * t]);
  // (a line of ridge: a run of tube, a little over the roof)
  const ridgeLine = (pts: V3[], ra: number, rb: number) => { for (let i = 0; i + 1 < pts.length; i++) { const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1); mesh.tube(pts[i], pts[i + 1], ra + (rb - ra) * t0, ra + (rb - ra) * t1, dark, M.ridge, 6); } };
  for (const sx of [-1, 1]) {
    // the gable: a red triangle, standing up from the hipped end, under its barge board
    const N = 8, vg = 1 - g;
    for (let i = 0; i < N; i++) {
      const v0 = -vg + (2 * vg * i) / N, v1 = -vg + (2 * vg * (i + 1)) / N;
      const t0 = roofAt(sx * gu, v0, false, -0.04), t1 = roofAt(sx * gu, v1, false, -0.04);
      const b0 = roofAt(sx * gu, v0, true), b1 = roofAt(sx * gu, v1, true);
      // (set back a hand from the hipped end's top)
      const back: V3 = [-fx * sx * 0.12, 0, -fz * sx * 0.12];
      mesh.quad(add(b0, back), add(t0, back), add(t1, back), add(b1, back), INK.gable, M.red, [fx * sx, 0, fz * sx]);
    }
    // (its barge board: ridges down both its edges from the top)
    for (const sv of [-1, 1]) ridgeLine(Array.from({ length: 7 }, (_, i) => roofAt(sx * gu, sv * vg * (i / 6), false, 0.08)), 0.1, 0.08);
    // the hips: from the gable's foot down to the corners, ending turned up
    for (const sv of [-1, 1]) {
      const pts = Array.from({ length: 8 }, (_, i) => { const k = g * (1 - i / 7); return roofAt(sx * (ex - (k * (ex - gx)) / g) / ex, sv * (1 - k), true, 0.08); });
      ridgeLine(pts, 0.09, 0.07);
      const tip = pts[pts.length - 1], out = norm(sub(tip, pts[pts.length - 2]));
      mesh.tube(tip, add(add(tip, mul(out, 0.3)), [0, 0.3, 0]), 0.07, 0.03, dark, M.ridge, 5);
    }
  }
  // the ridge along its top, and its ends curled up and in
  const top = roofAt(0, 0, false, 0.12);
  mesh.box([top[0], top[1] + 0.06, top[2]], [gx + 0.15, 0.17, 0.13], along, dark, dark, M.ridge);
  for (const sx of [-1, 1]) {
    const q = (x: number, y: number): V3 => { const b = roofAt(sx * gu, 0, false, 0.1); return add(b, [fx * sx * x, y, fz * sx * x]); };
    ridgeLine([q(0.1, 0), q(0.18, 0.4), q(0.1, 0.72), q(-0.12, 0.84), q(-0.28, 0.7)], 0.16, 0.06);
  }
  // low walls out to each side, white, capped with tiles
  for (const sx of [-1, 1]) {
    mesh.box(P(sx * (W + 3.4), 0.3 + 0.8, -0.6), [2.2, 0.8, 0.22], along, INK.wall, INK.wall, M.wall);
    mesh.box(P(sx * (W + 3.4), 0.3 + 1.7, -0.6), [2.35, 0.12, 0.42], along, INK.tile, INK.tileDark, M.tile);
  }
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
