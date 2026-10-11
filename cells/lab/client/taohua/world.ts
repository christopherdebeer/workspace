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
export const BAND = 12, SPAN = 26;
/** a vertex: position, normal, colour, material */
export const STRIDE = 10;
/** materials: what the drawing does with each */
export const M = { ground: 0, step: 1, stone: 2, rock: 3, trunk: 4, tile: 5, red: 6, wall: 7, robe: 8, hat: 9, petal: 10, blossom: 11, plaque: 12, twig: 13, dark: 14, skin: 15, ridge: 16 } as const;

type C3 = [number, number, number];
const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** the temples' names, in turn, as their plaques have them */
export const NAMES = ['大林寺', '桃花庵', '白云寺', '清凉寺', '栖霞寺', '云居寺', '灵岩寺', '兰若寺'];
/** the print's inks */
export const INK = {
  paper: hex(0xefe6d3), stepTop: hex(0xebe4d4), stepFace: hex(0xcfc6b4), stone: hex(0xb9b1a1), rock: hex(0x2a2827), rockTop: hex(0x7d7c79),
  trunk: hex(0x2b2321), tile: hex(0x3d9887), tileDark: hex(0x2b6f64), red: hex(0xb8382c), wall: hex(0xeee9df), dark: hex(0x2d2622),
  robe: hex(0x6f7882), hat: hex(0xd8c39a), skin: hex(0xe2c7a6),
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
    const c: V3 = [L[0] + px * (WIDTH / 2 + 5.2), f.b[1], L[2] + pz * (WIDTH / 2 + 5.2)];
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
    mesh.quad(P(xa, za), P(xa, zb), P(xb, zb), P(xb, za), INK.paper, M.ground, [0, 1, 0]);
  }

  // the path: each step, each landing, that falls in this band, with their kerbs
  path.flights.forEach((f, fi) => {
    const prev = path.flights[fi - 1];
    const pd = prev ? prev.dir : f.dir;
    // (the landing: a broad flagstone where the flights meet, wide enough for the turn)
    if (inBand(f.land[2])) {
      const dir = norm([pd[0] + f.dir[0], 0, pd[1] + f.dir[1]]);
      const d2: [number, number] = [dir[0], dir[2]];
      mesh.box([f.land[0], f.a[1] - 0.4, f.land[2]], [LANDING / 2 + 0.6, 0.4, WIDTH / 2 + 0.5], d2, INK.stepTop, INK.stepFace, M.step, M.stone);
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

  // rocks along the path's edges, black, and the ground about them
  const rocks: Array<[V3, number]> = [];
  path.flights.forEach((f, fi) => {
    const rr = seeded(hash(seed, fi, 0x40c));
    for (let u = 0.6; u < f.steps * f.run; u += ramp(rr, 0.9, 2.6)) {
      for (const sd of [-1, 1]) {
        if (rr() < 0.35) continue;
        const off = (WIDTH / 2 + 0.55 + rr() * 0.9) * sd;
        const x = f.a[0] + f.dir[0] * u + f.dir[1] * off, z = f.a[2] + f.dir[1] * u - f.dir[0] * off;
        if (!inBand(z)) continue;
        rocks.push([[x, ground(path, x, z), z], ramp(rr, 0.35, 1.0)]);
        if (rr() < 0.5) { const x2 = x + (rr() - 0.5) * 1.2 + f.dir[1] * 0.5 * sd, z2 = z + (rr() - 0.5) * 1.2; rocks.push([[x2, ground(path, x2, z2), z2], ramp(rr, 0.25, 0.6)]); }
      }
    }
  });
  // (and some out among the trees)
  for (let i = 0; i < 10; i++) {
    const x = ramp(r, -SPAN + 2, SPAN - 2), z = ramp(r, z0, z1);
    if (path.nearest(x, z).d < WIDTH / 2 + 0.6) continue;
    rocks.push([[x, ground(path, x, z), z], ramp(r, 0.4, 1.4)]);
  }
  for (const [p, s] of rocks) rock(mesh, p, s, seeded(hash(Math.round(p[0] * 10), Math.round(p[2] * 10), seed)));

  // trees: on a jittered grid, not on the path (though they lean over it), not where a temple is
  const G = 5.0;
  for (let gx = -SPAN + 1; gx < SPAN; gx += G) for (let gz = Math.ceil(z0 / G) * G; gz < z1; gz += G) {
    const tr = seeded(hash(seed, Math.round(gx * 10), Math.round(gz * 10), 0x7ee));
    if (tr() < 0.06) continue;
    const x = gx + (tr() - 0.5) * G * 0.9, z = gz + (tr() - 0.5) * G * 0.9;
    if (!inBand(z)) continue;
    if (path.nearest(x, z).d < WIDTH / 2 + 1.3) continue;
    if (temples.some((t) => Math.hypot(x - t.c[0], z - t.c[2]) < 8)) continue;
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

/** A rock: an angular lump, black, its top faces catching the light grey. */
function rock(mesh: Mesh, at: V3, size: number, r: Rand) {
  // (a squashed icosahedron, its corners pulled about, its foot sunk)
  const t = (1 + Math.sqrt(5)) / 2;
  const P: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => norm(p as V3));
  const F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const sx = size * ramp(r, 0.9, 1.4), sy = size * ramp(r, 0.6, 1.0), sz = size * ramp(r, 0.8, 1.2), turn = r() * 6.3;
  const Q = P.map((p) => {
    const k = ramp(r, 0.75, 1.15);
    const x = p[0] * sx * k, z = p[2] * sz * k, y = Math.max(-0.25, p[1]) * sy * k;
    return [at[0] + x * Math.cos(turn) - z * Math.sin(turn), at[1] + y + sy * 0.15, at[2] + x * Math.sin(turn) + z * Math.cos(turn)] as V3;
  });
  for (const [a, b, c] of F) {
    const n = norm(cross(sub(Q[b], Q[a]), sub(Q[c], Q[a])));
    // (the faces toward the sky and the light take a grey; the rest stay black)
    const lit = n[1] * 0.8 + n[0] * 0.3 - n[2] * 0.15;
    const col: C3 = lit > 0.78 ? INK.rockTop : lit > 0.6 ? [0.3, 0.3, 0.3] : INK.rock;
    mesh.tri(Q[a], Q[b], Q[c], col, M.rock, n);
  }
}

/**
 * A peach tree: a short trunk leaning, splitting into a few limbs that spread wide and up, each
 * splitting again, and again; at the ends of the branches the blossom gathers in clumps, wider
 * than they're tall, lit from up and to the right; petals under it.
 */
function tree(mesh: Mesh, puffs: number[], petals: number[], base: V3, r: Rand, path: Path) {
  const H = ramp(r, 0.7, 1.4), lean: V3 = norm([ramp(r, -0.35, 0.35), 1, ramp(r, -0.35, 0.35)]);
  const top = add(base, mul(lean, H));
  const R0 = ramp(r, 0.16, 0.24);
  mesh.tube([base[0], base[1] - 0.3, base[2]], top, R0 * 1.25, R0, INK.trunk, M.trunk, 7);
  const tips: Array<[V3, number]> = [];
  const grow = (from: V3, dir: V3, len: number, rad: number, depth: number) => {
    const to = add(from, mul(dir, len));
    mesh.tube(from, to, rad, rad * 0.62, INK.trunk, depth >= 2 ? M.twig : M.trunk, depth >= 2 ? 4 : 6);
    if (depth >= 3) { tips.push([to, len]); return; }
    const n = depth === 0 ? 3 + Math.floor(r() * 3) : 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 1.2;
      // (out and up: limbs spread wide, twigs go on more up)
      const spread = depth === 0 ? ramp(r, 0.9, 1.4) : ramp(r, 0.5, 0.9);
      const d = norm([dir[0] * 0.5 + Math.cos(a) * spread, dir[1] * 0.45 + ramp(r, 0.1, 0.45), dir[2] * 0.5 + Math.sin(a) * spread]);
      grow(to, d, len * ramp(r, 0.6, 0.85), rad * 0.62, depth + 1);
    }
  };
  grow(top, lean, ramp(r, 1.4, 2.1), R0, 0);
  // the canopy's middle, for its lighting
  let cx = 0, cy = 0, cz = 0;
  for (const [p] of tips) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= tips.length; cy /= tips.length; cz /= tips.length;
  const L: V3 = norm([0.55, 0.75, -0.35]);
  for (const [p, len] of tips) {
    const n = 4 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const q: V3 = [p[0] + ramp(r, -1, 1) * len, p[1] + ramp(r, -0.3, 0.45) * len, p[2] + ramp(r, -1, 1) * len];
      const rad = ramp(r, 0.6, 1.05);
      // (lit by which way it faces out of the canopy, and how high it is in it)
      const out = norm([q[0] - cx, (q[1] - cy) * 1.6, q[2] - cz]);
      const shade = Math.max(0, Math.min(1, 0.45 + 0.45 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.25 * (q[1] - cy)));
      puffs.push(q[0], q[1], q[2], rad, shade, r());
    }
  }
  // petals fallen under it, where it's not the path
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.2;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    const nr = path.nearest(x, z);
    const y = nr.d < WIDTH / 2 ? path.at(nr.s).p[1] + 0.01 : ground(path, x, z) + 0.02;
    petals.push(x, y, z, ramp(r, 0.05, 0.11), r() * Math.PI, r());
  }
}

/**
 * A temple hall on its terrace: a stone platform, white walls, red columns across its front and
 * a red door, a plaque over it; its roof of teal glazed tiles, hipped, its eaves curving up at the
 * corners, a ridge along its top with its ends turned up. `face`: the way its front looks.
 */
function temple(mesh: Mesh, c: V3, face: [number, number], seed: number, name: number) {
  const r = seeded(seed);
  // (its x along the front; z out of the front)
  const fx = -face[1], fz = face[0];
  const P = (x: number, y: number, z: number): V3 => [c[0] + fx * x + face[0] * z, c[1] + y, c[2] + fz * x + face[1] * z];
  const along: [number, number] = [fx, fz];
  const W = ramp(r, 2.9, 3.5), D = ramp(r, 2.1, 2.5), Hw = 2.7;
  // the terrace: stone, its front edge toward the path
  mesh.box(P(0, -0.6, 0.4), [W + 1.4, 0.9, D + 1.6], along, INK.stepTop, INK.stepFace, M.step, M.stone);
  // the walls
  mesh.box(P(0, 0.3 + Hw / 2, -0.3), [W, Hw / 2, D - 0.4], along, INK.wall, INK.wall, M.wall);
  // the columns across its front, red
  const n = 4;
  for (let i = 0; i < n; i++) {
    const x = -W + 0.35 + (i / (n - 1)) * (2 * W - 0.7);
    mesh.tube(P(x, 0.3, D - 0.25), P(x, 0.3 + Hw, D - 0.25), 0.17, 0.15, INK.red, M.red, 8);
  }
  // a beam over them; the door, red, its opening dark; the plaque
  mesh.box(P(0, 0.3 + Hw - 0.2, D - 0.25), [W, 0.2, 0.18], along, INK.red, INK.red, M.red);
  mesh.box(P(0, 0.3 + 1.15, D - 0.62), [0.85, 1.15, 0.06], along, INK.red, INK.red, M.red);
  mesh.box(P(0, 0.3 + 1.05, D - 0.6), [0.62, 1.05, 0.07], along, INK.dark, INK.dark, M.dark);
  // (the plaque: its face carries its name, from the plaque's texture: uv in its colour)
  const pq = [P(-0.95, 0.3 + Hw - 0.3, D - 0.05), P(-0.95, 0.3 + Hw + 0.35, D - 0.05), P(0.95, 0.3 + Hw + 0.35, D - 0.05), P(0.95, 0.3 + Hw - 0.3, D - 0.05)] as const;
  const fn: V3 = [face[0], 0, face[1]];
  // (u to the right as it's looked at from in front)
  const uv: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [0, 0]];
  // (its name, from the plaques' sheet: one name a row)
  for (const k of [0, 1, 2, 0, 2, 3]) { const p = pq[k]; mesh.v.push(p[0], p[1], p[2], fn[0], fn[1], fn[2], uv[k][0], (name + uv[k][1]) / NAMES.length, 0, M.plaque); }
  // the roof: hipped, the eaves well out, curving up at the corners
  const ex = W + 1.1, ez = D + 1.1, y0 = 0.3 + Hw + 0.1, rise = 1.9, ridge = W * 0.55;
  const S = 14;
  const roofAt = (u: number, v: number): V3 => {
    // (u across the front, -1 to 1; v front to back, -1 to 1)
    const x = u * ex, z = v * ez;
    // (how far in from the eaves: the ridge's line is the middle, along x, as far as `ridge`)
    const dz = 1 - Math.abs(v), dx = Math.max(0, (ex - Math.abs(x)) / (ex - ridge));
    const inward = Math.min(dz, Math.min(1, dx));
    // (a curve: steep near the ridge, flattening to the eaves; the corners swept up)
    const corner = Math.pow(Math.abs(u) * Math.abs(v), 3) * 0.7;
    return P(x, y0 + rise * Math.pow(inward, 0.75) + corner, z);
  };
  for (let i = 0; i < S; i++) for (let k = 0; k < S; k++) {
    const u0 = -1 + (2 * i) / S, u1 = u0 + 2 / S, v0 = -1 + (2 * k) / S, v1 = v0 + 2 / S;
    const a = roofAt(u0, v0), b = roofAt(u0, v1), cc = roofAt(u1, v1), d = roofAt(u1, v0);
    // (one surface, seen from both sides: its underside darker, in the drawing; its colour carries where on the roof it is, for its tiles' channels)
    const at = (u: number, v: number): C3 => [(u * ex) / 0.24, (Math.abs(v) * ez) / 0.32, 2];
    const n = norm(cross(sub(b, a), sub(d, a)));
    for (const [p, uu, vv] of [[a, u0, v0], [b, u0, v1], [cc, u1, v1], [a, u0, v0], [cc, u1, v1], [d, u1, v0]] as Array<[V3, number, number]>) {
      const col = at(uu, vv);
      mesh.v.push(p[0], p[1], p[2], n[0], n[1], n[2], col[0], col[1], col[2], M.tile);
    }
  }
  // the ridge, and its ends turned up
  const ry = y0 + rise + 0.05;
  mesh.box(P(0, ry + 0.12, 0), [ridge + 0.2, 0.14, 0.14], along, INK.tileDark, INK.tileDark, M.ridge);
  for (const sx of [-1, 1]) mesh.tube(P(sx * (ridge + 0.2), ry + 0.1, 0), P(sx * (ridge + 0.55), ry + 0.75, 0), 0.13, 0.06, INK.tileDark, M.ridge, 6);
  // low walls out to each side, white, capped with tiles
  for (const sx of [-1, 1]) {
    mesh.box(P(sx * (W + 3.2), 0.3 + 0.8, -0.6), [2.2, 0.8, 0.22], along, INK.wall, INK.wall, M.wall);
    mesh.box(P(sx * (W + 3.2), 0.3 + 1.7, -0.6), [2.35, 0.12, 0.42], along, INK.tile, INK.tileDark, M.tile);
  }
}
