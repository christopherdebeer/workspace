/**
 * Taohua: the world, a band at a time. The hill is cut across into bands, so deep up the hill;
 * each is made from the seed and its number (the same seed, the same hillside): the ground; the
 * path's steps and landings that fall in it, with their kerbs; black rocks along the path's
 * edges and among the trees; peach trees, grown branch by branch, their blossom in clumps of
 * puffs about the ends of their branches; petals fallen on the ground; and now and then, beside
 * a landing, a temple. What's solid is one mesh (vertices: position, normal, colour, material);
 * the blossom and the petals are lists for instancing.
 */
import { hash, noise1, seeded, type Rand } from '../kit/rng';
import { inStation, stationsNear } from './compose';
import { GATE, LANDING, Path, RISE, TERRACE, WIDTH, type Flight, type V3 } from './path';

/** how deep a band is, up the hill (m); how far across the hill the world goes, each side */
export const BAND = 12, SPAN = 20;
/** a vertex: position, normal, colour, material */
export const STRIDE = 10;
/** the way the eye looks, on the whole (down the hill's slope from above and below it): for setting things behind one another as it sees them */
const VIEW: V3 = (() => { const p = 0.76; return [0, -Math.sin(p), Math.cos(p)]; })();
/** materials: what the drawing does with each */
export const M = { ground: 0, step: 1, stone: 2, rock: 3, trunk: 4, tile: 5, red: 6, wall: 7, robe: 8, hat: 9, petal: 10, blossom: 11, plaque: 12, twig: 13, dark: 14, skin: 15, ridge: 16, grass: 17, earth: 18, shade: 19 } as const;

type C3 = [number, number, number];
const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** the temples' names, in turn, as their plaques have them */
export const NAMES = ['大林寺', '桃花庵', '白云寺', '清凉寺', '栖霞寺', '云居寺', '灵岩寺', '兰若寺'];
/** the print's inks */
export const INK = {
  paper: hex(0xefe6d3), stepTop: hex(0xebe4d4), stepFace: hex(0xcfc6b4), stone: hex(0xb9b1a1), rock: hex(0x2a2827), rockTop: hex(0x7d7c79),
  trunk: hex(0x2b2321), tile: hex(0x45ad9c), tileDark: hex(0x1f5f58), red: hex(0xb8382c), wall: hex(0xeee9df), dark: hex(0x2d2622),
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

/** A mesh's vertices as they're pushed: a buffer that grows as it fills. */
class Verts {
  a = new Float32Array(1 << 16); n = 0;
  private room(k: number) { if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  push(...xs: number[]) { this.room(xs.length); for (const x of xs) this.a[this.n++] = x; }
  /** one vertex: position, normal, colour, material */
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, g: number, b: number, m: number) {
    this.room(10);
    const a = this.a, i = this.n;
    a[i] = x; a[i + 1] = y; a[i + 2] = z; a[i + 3] = nx; a[i + 4] = ny; a[i + 5] = nz; a[i + 6] = r; a[i + 7] = g; a[i + 8] = b; a[i + 9] = m;
    this.n = i + 10;
  }
  out() { return this.a.slice(0, this.n); }
}

/** A mesh as it's built: faces pushed with their normals and colours. */
export class Mesh {
  v = new Verts();
  tri(a: V3, b: V3, c: V3, col: C3, m: number, n?: V3) {
    let nx: number, ny: number, nz: number;
    if (n) { nx = n[0]; ny = n[1]; nz = n[2]; } else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const v = this.v;
    v.vert(a[0], a[1], a[2], nx, ny, nz, col[0], col[1], col[2], m);
    v.vert(b[0], b[1], b[2], nx, ny, nz, col[0], col[1], col[2], m);
    v.vert(c[0], c[1], c[2], nx, ny, nz, col[0], col[1], col[2], m);
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
  // (beside the path, it lies smooth under it; further off, it rolls. Beside a stair it lies well
  // under: the stair rises in steps and the hill in a slope, so at each step's front the slope comes
  // up nearly to the tread, and must stay clear of it)
  const nr = path.nearest(x, z), k = smooth(1.3, 3.4, nr.d);
  const under = path.flightAt(nr.s).kind === 'stair' ? 0.34 : 0.08;
  return path.hill(z) + k * 0.18 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.53 - x * 0.2) - 0.04 - under * (1 - k);
}

/** how far a temple beside the path stands from its middle line: clear of it, its stair down to it */
const BESIDE_OFF = WIDTH / 2 + 0.45 + TERRACE / 2 + 4 * 0.32;
export interface TempleAt { c: V3; face: [number, number]; poem: number; flight: Flight; gate: boolean }

/**
 * Where the temples stand, near z: a gate across the head of a flight, on the terrace its landing
 * makes, facing down it; or beside a level trail, partway along it, facing it.
 */
export function templesNear(path: Path, z0: number, z1: number): TempleAt[] {
  path.extend(z1 + 20);
  const out: TempleAt[] = [];
  let poem = 0;
  for (const f of path.flights) {
    if (!f.temple) continue;
    poem++;
    if (f.temple === GATE) {
      const c: V3 = [f.b[0] + f.dir[0] * TERRACE / 2, f.b[1], f.b[2] + f.dir[1] * TERRACE / 2];
      if (c[2] < z0 - 14 || c[2] > z1 + 14) continue;
      out.push({ c, face: [-f.dir[0], -f.dir[1]], poem, flight: f, gate: true });
    } else {
      const m = path.at(f.s0 + f.flat / 2);
      const px = m.dir[1] * f.temple, pz = -m.dir[0] * f.temple;
      const c: V3 = [m.p[0] + px * BESIDE_OFF, m.p[1], m.p[2] + pz * BESIDE_OFF];
      if (c[2] < z0 - 14 || c[2] > z1 + 14) continue;
      out.push({ c, face: [-px, -pz], poem, flight: f, gate: false });
    }
  }
  return out;
}

/**
 * Large-scale composition, independent of streaming bands. Every 36 m has an asymmetric
 * opening beside the route; overlapping soft fields leave wooded shoulders between them.
 * This controls whole groves before any individual tree is grown.
 */
export interface Opening { cx: number; cz: number; rx: number; rz: number; side: number; i: number }
export function opening(path: Path, seed: number, i: number): Opening {
  const rr = seeded(hash(seed, i, 0xc041));
  const cz = i * 36 + 12 + rr() * 12;
  const side = rr() < 0.5 ? -1 : 1;
  const at = path.at(path.nearest(0, cz).s).p;
  const cx = at[0] + side * (2.5 + rr() * 2.5);
  return { cx, cz, rx: 5.5 + rr() * 3.5, rz: 8 + rr() * 5, side, i };
}
export function groveDensity(path: Path, seed: number, x: number, z: number): number {
  const cell = Math.floor(z / 36);
  let open = 0;
  for (let i = cell - 1; i <= cell + 1; i++) {
    const o = opening(path, seed, i);
    const d = Math.hypot((x - o.cx) / o.rx, (z - o.cz) / o.rz);
    open = Math.max(open, 1 - smooth(0.55, 1.15, d));
  }
  const mass = noise1(hash(seed, 0xc042), z / 17 + x / 11);
  return (0.7 + 0.29 * mass) * (1 - open);
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
  // (whether a place is on a temple's terrace or by its walls, in the temple's own frame: across its front, and out from it)
  const onTemple = (x: number, z: number, m: number) => temples.some((t) => {
    const dx = x - t.c[0], dz = z - t.c[2];
    const ax = Math.abs(dx * -t.face[1] + dz * t.face[0]), az = dx * t.face[0] + dz * t.face[1];
    return (ax < 5.2 + m && Math.abs(az) < TERRACE / 2 + 0.6 + m) || (ax < 10.5 + m && Math.abs(az + 0.3) < 0.8 + m);
  });

  // (whether a place is in an open glade, about the middle of a trail through one)
  const glades = path.flights.filter((f) => f.glade && Math.abs(f.land[2] - (z0 + z1) / 2) < 40).map((f) => ({ m: path.at(f.s0 + f.flat / 2).p, r: f.glade }));
  const inGlade = (x: number, z: number) => glades.some((g) => Math.hypot(x - g.m[0], z - g.m[2]) < g.r);
  // (the stations' spaces, kept open: no tree whose crown would stand over one, no rock in one)
  const sts = stationsNear(path, seed, z0, z1);
  const treeOut = (x: number, z: number) => inStation(sts, x, z, 1.6, 4.5);

  // the ground: a sheet across the hill, the paper's cream
  const nx = 2 * SPAN / 1.5, nz = BAND / 1.5;
  // (each corner: where it is, and how near the path, for the brush strokes along it)
  const gv = new Map<string, number[]>();
  const GV = (x: number, z: number) => {
    const key = `${x},${z}`;
    let v = gv.get(key);
    if (!v) { const nr = path.nearest(x, z); const worn = path.flightAt(nr.s).kind === 'trail' ? 1 - smooth(0.5, 1.6, nr.d) : 0; v = [x, ground(path, x, z), z, 0, 1, 0, worn, 0, 0, M.ground]; gv.set(key, v); }
    return v;
  };
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const xa = -SPAN + i * 1.5, xb = xa + 1.5, za = z0 + k * 1.5, zb = za + 1.5;
    for (const [x, z] of [[xa, za], [xa, zb], [xb, zb], [xa, za], [xb, zb], [xb, za]]) mesh.v.push(...GV(x, z));
  }

  // the path: each step a slab of its own, laid on the hill, its ends ragged (no two the same
  // length, nor quite in line); the landings, the hill's own ground, trodden flat; a trail, only a
  // few flat stones along it, here and there, and a worn line (in the drawing)
  /** where on piece f the path is, so far from its foot (past its landing), and its way there */
  const along = (f: Flight, u: number) => path.at(f.s0 + f.ll + u);
  path.flights.forEach((f, fi) => {
    const prev = path.flights[fi - 1];
    const pd = prev ? prev.dir : f.dir;
    if (f.kind === 'trail') {
      const tr = seeded(hash(seed, fi, 0x5e7));
      for (let u = ramp(tr, 0.2, 0.8); u < f.flat; u += ramp(tr, 0.6, 1.8)) {
        if (tr() < 0.45) continue;
        const m = along(f, u), off = ramp(tr, -0.45, 0.45);
        const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
        if (!inBand(z)) continue;
        stone(mesh, path, x, z, ramp(tr, 0.16, 0.34), tr);
      }
      return;
    }
    if (inBand(f.land[2]) && prev?.temple !== GATE && f.ll > 1) {
      // (the last piece's way on, and this one's, each as wide as the stair, meeting at the turn)
      const start: V3 = prev ? prev.b : [0, 0, 0];
      const e: V3 = [start[0] + pd[0] * f.ll * 0.5, f.a[1] - 0.4, start[2] + pd[1] * f.ll * 0.5];
      mesh.box(e, [f.ll * 0.5 + 0.15, 0.4, WIDTH / 2 + 0.05], pd, INK.paper, INK.paper, M.earth);
      const g: V3 = [f.a[0] - f.dir[0] * f.ll * 0.35, f.a[1] - 0.4 + 0.002, f.a[2] - f.dir[1] * f.ll * 0.35];
      mesh.box(g, [f.ll * 0.35 + 0.15, 0.4, WIDTH / 2 + 0.05], f.dir, INK.paper, INK.paper, M.earth);
    }
    for (let k = 0; k < f.steps; k++) {
      const u = (k + 0.5) * f.run;
      const top = f.a[1] + (k + 1) * RISE;
      const c: V3 = [f.a[0] + f.dir[0] * u, top - 0.15, f.a[2] + f.dir[1] * u];
      if (!inBand(c[2])) continue;
      const h = hash(seed, fi, k);
      // (its two ends, each its own way out or in)
      const l = WIDTH / 2 + ((h >> 8) % 100) / 100 * 0.24 - 0.08, rr = WIDTH / 2 + ((h >> 16) % 100) / 100 * 0.24 - 0.08;
      const shift = (rr - l) / 2, half = (l + rr) / 2;
      const cc: V3 = [c[0] + f.dir[1] * shift, c[1], c[2] - f.dir[0] * shift];
      // Worn slabs: clipped, unequal corners; continuous treads keep the walk surface level.
      const sr = seeded(h), hx = f.run / 2 + 0.02;
      const cut = () => 0.025 + sr() * 0.075;
      const corners: Array<[number, number]> = [
        [-hx + cut(), -half], [hx - cut(), -half + sr() * 0.04],
        [hx, -half + cut()], [hx, half - cut()],
        [hx - cut(), half], [-hx + cut(), half - sr() * 0.04],
        [-hx, half - cut()], [-hx, -half + cut()],
      ];
      const P = (u: number, v: number, y: number): V3 =>
        [cc[0] + f.dir[0] * u + f.dir[1] * v, y, cc[2] + f.dir[1] * u - f.dir[0] * v];
      const centre = P(0, 0, top);
      for (let n = 0; n < corners.length; n++) {
        const a = corners[n], b = corners[(n + 1) % corners.length];
        const pa = P(a[0], a[1], top), pb = P(b[0], b[1], top);
        mesh.tri(centre, pb, pa, INK.stepTop, M.step, [0, 1, 0]);
        mesh.quad(P(a[0], a[1], top - 0.6), P(b[0], b[1], top - 0.6), pb, pa, INK.stepFace, M.step);
      }
    }
    // (now and then, along one side of a flight, a wall of squared blocks holding the hill back,
    // stepping up with the stair)
    const wr = seeded(hash(seed, fi, 0x3a1));
    if (fi > 0 && f.temple !== GATE && wr() < 0.4) {
      const sd = wr() < 0.5 ? 1 : -1, k0 = Math.floor(wr() * f.steps * 0.5), n = Math.min(f.steps - k0, 3 + Math.floor(wr() * 5));
      for (let k = k0; k < k0 + n; k++) {
        const u = (k + 0.5) * f.run, top = f.a[1] + (k + 1) * RISE + 0.22 + (k % 2) * 0.16;
        const off = (WIDTH / 2 + 0.55) * sd;
        const bc: V3 = [f.a[0] + f.dir[0] * u + f.dir[1] * off, top - 0.45, f.a[2] + f.dir[1] * u - f.dir[0] * off];
        if (inBand(bc[2])) mesh.box(bc, [f.run / 2 + 0.01, 0.45, 0.3], f.dir, INK.stepTop, INK.stone, M.stone);
      }
    }
  });

  // temples
  for (const t of temples) if (inBand(t.c[2])) temple(mesh, t, hash(seed, t.poem, 0x7e), (t.poem - 1) % NAMES.length);

  // rocks along the path's edges, black, in little clusters, and the ground about them
  const gy = (x: number, z: number) => ground(path, x, z);
  const rocks: Array<[number, number, number]> = [];
  path.flights.forEach((f, fi) => {
    const rr = seeded(hash(seed, fi, 0x40c));
    for (let u = 0.6; u < f.flat; u += ramp(rr, 0.9, 2.6)) {
      const m = along(f, u);
      for (const sd of [-1, 1]) {
        if (rr() < (f.glade ? 0.85 : 0.55)) continue;
        const off = (WIDTH / 2 + 0.6 + rr() * 0.9) * sd;
        const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
        if (!inBand(z)) continue;
        rocks.push([x, z, ramp(rr, 0.28, 0.7)]);
        // (a smaller one leaning on it, now and then; and another)
        for (let k = 0; k < 2 && rr() < 0.55; k++) { const a = rr() * 6.3, d = ramp(rr, 0.45, 0.8); rocks.push([x + Math.cos(a) * d + m.dir[1] * 0.2 * sd, z + Math.sin(a) * d, ramp(rr, 0.18, 0.42)]); }
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
    if (path.nearest(x, z).d < WIDTH / 2 + 0.35 || onTemple(x, z, 0.3) || inStation(sts, x, z, 0.4)) continue;
    const rr = seeded(hash(Math.round(x * 10), Math.round(z * 10), seed));
    rock(mesh, [x, gy(x, z), z], sz, rr, gy);
    shade(mesh, path, x - 0.9 * sz, z + 0.15 * sz, sz * 2.2, sz * 0.8, 0.3);
    for (let k = 0, n = 1 + Math.floor(rr() * 3); k < n; k++) { const a = rr() * 6.3, d = sz * ramp(rr, 1, 1.5); tuft(mesh, path, x + Math.cos(a) * d, z + Math.sin(a) * d, rr, 3 + Math.floor(rr() * 4)); }
  }
  // grass in tufts along the path's edges, more along a trail, and here and there on the hill
  path.flights.forEach((f, fi) => {
    const rr = seeded(hash(seed, fi, 0x6a5));
    for (let u = 0.3; u < f.flat; u += ramp(rr, f.kind === 'trail' ? 0.3 : 0.5, f.kind === 'trail' ? 0.8 : 1.4)) {
      const m = along(f, u);
      const sd = rr() < 0.5 ? 1 : -1, off = (WIDTH / 2 + (f.kind === 'trail' ? -0.15 : 0.3) + rr() * 0.3) * sd;
      const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
      if (inBand(z) && !onTemple(x, z, 0)) tuft(mesh, path, x, z, rr, 3 + Math.floor(rr() * 4));
    }
  });
  for (let i = 0; i < 40; i++) {
    const x = ramp(r, -SPAN, SPAN), z = ramp(r, z0, z1);
    if (path.nearest(x, z).d > WIDTH / 2 + 0.5 && !onTemple(x, z, 0) && !inStation(sts, x, z, 0)) tuft(mesh, path, x, z, r, 2 + Math.floor(r() * 4));
  }

  // (each opening held by one tree standing alone in it, toward its far side, away from the path,
  // its blossom fallen about it: the clearing is a shape the tree gives meaning to, not just a gap)
  for (let i = Math.floor(z0 / 36) - 1; i <= Math.floor(z1 / 36) + 1; i++) {
    const o = opening(path, seed, i), lr = seeded(hash(seed, i, 0x10e));
    if (lr() < 0.25) continue;
    const x = o.cx + o.side * o.rx * ramp(lr, 0.25, 0.5), z = o.cz + o.rz * ramp(lr, -0.1, 0.35);
    if (!inBand(z) || path.nearest(x, z).d < WIDTH / 2 + 2.2 || onTemple(x, z, 1) || inGlade(x, z) || treeOut(x, z)) continue;
    tree(mesh, puffs, petals, [x, ground(path, x, z), z], lr, path);
  }

  // trees: on a jittered grid, not on the path (though they lean over it), not on a temple's terrace
  const G = 3.9;
  for (let gx = -SPAN + 1; gx < SPAN; gx += G) for (let gz = Math.floor((z0 - G * 0.45) / G) * G; gz < z1 + G * 0.45; gz += G) {
    const tr = seeded(hash(seed, Math.round(gx * 10), Math.round(gz * 10), 0x7ee));
    const accept = tr();
    const x = gx + (tr() - 0.5) * G * 0.9, z = gz + (tr() - 0.5) * G * 0.9;
    // Ownership follows the final jittered position; neighbouring bands visit the same candidates.
    if (!inBand(z)) continue;
    if (accept > groveDensity(path, seed, x, z)) continue;
    if (path.nearest(x, z).d < WIDTH / 2 + 1.5) continue;
    if (onTemple(x, z, 0.8) || inGlade(x, z) || treeOut(x, z)) continue;
    // (an outcrop behind it, now and then, as in the print: black slabs the blossom stands against)
    if (tr() < 0.5) for (let k = 0, n = 2 + Math.floor(tr() * 3); k < n; k++) {
      const a = Math.PI / 2 + ramp(tr, -1.1, 1.1), d = ramp(tr, 0.45, 1.5), rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d, sz = ramp(tr, 0.4, 0.9) * (k ? 0.75 : 1);
      if (path.nearest(rx, rz).d > WIDTH / 2 + 0.6 && !onTemple(rx, rz, 0.3) && !inStation(sts, rx, rz, 0.4)) {
        rock(mesh, [rx, gy(rx, rz), rz], sz, seeded(hash(seed, Math.round(rx * 10), Math.round(rz * 10))), gy);
        shade(mesh, path, rx - 0.9 * sz, rz + 0.1, sz * 2.2, sz * 0.7, 0.28);
        tuft(mesh, path, rx + sz * 0.9, rz - sz * 0.3, tr, 4);
      }
    }
    tree(mesh, puffs, petals, [x, ground(path, x, z), z], tr, path);
  }
  // petals fallen on the path too
  for (let i = 0; i < 90; i++) {
    const x = ramp(r, -SPAN, SPAN), z = ramp(r, z0, z1);
    const nr = path.nearest(x, z);
    const y = nr.d < WIDTH / 2 ? path.at(nr.s).p[1] + 0.01 : ground(path, x, z) + 0.02;
    petals.push(x, y, z, ramp(r, 0.04, 0.08), r() * Math.PI, r() * 0.5);
  }
  return { j, verts: mesh.v.out(), puffs: new Float32Array(puffs), petals: new Float32Array(petals), temples: temples.filter((t) => inBand(t.c[2])).map((t) => ({ c: t.c, face: Math.atan2(t.face[0], t.face[1]), poem: t.poem })) };
}

/**
 * A rock, as the print has them: a standing stone, a slab or a wedge on end, its faces flat (black
 * where they're turned from the light, charcoal where they're turned to it, grey on top, in the
 * drawing). Its foot a ring of four to six corners; partway up, a ring a little in and askew, so
 * its faces break; its top cut on a slant, sometimes to a ridge. Stood on the ground under each
 * corner, its foot sunk.
 */
function rock(mesh: Mesh, at: V3, size: number, r: Rand, gy?: (x: number, z: number) => number) {
  const n = 5 + Math.floor(r() * 3), turn = r() * 6.3, long = ramp(r, 1.3, 2.1);
  const h = size * ramp(r, 0.7, 1.65), taper = ramp(r, 0.22, 0.62), tilt = ramp(r, 0.25, 0.65), ta = r() * 6.3;
  const ring = (rad: number, y: number, jit: number): V3[] => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (i ? ramp(r, -0.35, 0.35) / n * 3 : 0), rr = rad * ramp(r, 1 - jit, 1);
    const lx = Math.cos(a) * rr * long, lz = Math.sin(a) * rr;
    const x = at[0] + lx * Math.cos(turn) - lz * Math.sin(turn), z = at[2] + lx * Math.sin(turn) + lz * Math.cos(turn);
    // (the top on a slant: higher on one side than the other)
    const slant = y > 0 ? 1 - tilt * (Math.cos(a - ta) * 0.5 + 0.5) : 1;
    return [x, (gy ? gy(x, z) : at[1]) + y * slant, z];
  });
  const foot = ring(size * 0.8, -0.25, 0.35), midR = ring(size * 0.8 * ramp(r, 0.8, 1.02), h * ramp(r, 0.4, 0.6), 0.25), topR = ring(size * 0.8 * taper, h, 0.3);
  // (leaning, a little, as stones settle)
  const lx = ramp(r, -0.3, 0.3) * h, lz = ramp(r, -0.3, 0.3) * h;
  for (const p of midR) { p[0] += lx * 0.45; p[2] += lz * 0.45; }
  for (const p of topR) { p[0] += lx; p[2] += lz; }
  const rings = [foot, midR, topR];
  for (let k = 0; k < 2; k++) for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = rings[k][i], b = rings[k][j], c = rings[k + 1][j], d = rings[k + 1][i];
    mesh.tri(a, b, c, INK.rock, M.rock); mesh.tri(a, c, d, INK.rock, M.rock);
  }
  // (its top: a low peak, a little off its middle)
  let cx = 0, cy = 0, cz = 0;
  for (const p of topR) { cx += p[0] / n; cy += p[1] / n; cz += p[2] / n; }
  const apex: V3 = [cx + ramp(r, -0.15, 0.15) * size, cy + h * ramp(r, 0.02, 0.15), cz + ramp(r, -0.15, 0.15) * size];
  for (let i = 0; i < n; i++) mesh.tri(topR[i], topR[(i + 1) % n], apex, INK.rock, M.rock);
}

/** A flat stone set in the ground, a trail's hint of a path: a low slab, its outline irregular. */
function stone(mesh: Mesh, path: Path, x: number, z: number, size: number, r: Rand) {
  const n = 5 + Math.floor(r() * 3), turn = r() * 6.3, long = ramp(r, 1, 1.6);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + ramp(r, -0.25, 0.25), rr = size * ramp(r, 0.7, 1);
    const lx = Math.cos(a) * rr * long, lz = Math.sin(a) * rr;
    const px = x + lx * Math.cos(turn) - lz * Math.sin(turn), pz = z + lx * Math.sin(turn) + lz * Math.cos(turn);
    return [px, ground(path, px, pz), pz] as V3;
  });
  const top = pts.map((p) => [p[0], p[1] + 0.07, p[2]] as V3);
  let cx = 0, cy = 0, cz = 0;
  for (const p of top) { cx += p[0] / n; cy += p[1] / n; cz += p[2] / n; }
  const bot = pts.map((p) => [p[0], p[1] - 0.06, p[2]] as V3);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    mesh.tri([cx, cy, cz], top[j], top[i], INK.stepTop, M.step, [0, 1, 0]);
    mesh.quad(bot[i], bot[j], top[j], top[i], INK.stepFace, M.step);
  }
}

/**
 * Shade on the ground: a soft patch, under a rock or a tree, a little off toward the shadow side
 * (in the drawing: the ground's colour carries where in the patch it is, and how deep).
 */
export function shade(mesh: Mesh, path: Path, x: number, z: number, rx: number, rz: number, deep: number) {
  const N = 12, lift = 0.04 + deep * 0.08;
  const G = (u: number, v: number): V3 => { const px = x + u * rx, pz = z + v * rz; return [px, ground(path, px, pz) + lift, pz]; };
  const c = G(0, 0);
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    const p0 = G(Math.cos(a0), Math.sin(a0)), p1 = G(Math.cos(a1), Math.sin(a1));
    mesh.v.push(c[0], c[1], c[2], 0, 1, 0, 0, 0, deep, M.shade);
    mesh.v.push(p1[0], p1[1], p1[2], 0, 1, 0, Math.cos(a1), Math.sin(a1), deep, M.shade);
    mesh.v.push(p0[0], p0[1], p0[2], 0, 1, 0, Math.cos(a0), Math.sin(a0), deep, M.shade);
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
  // (a trunk you can see: tall before it opens, leaning, with a kink or two; bold, as the print's are)
  const stature = ramp(r, 0.82, 1.3);
  const H = ramp(r, 1.6, 2.6) * stature, lean: V3 = norm([ramp(r, -0.4, 0.4), 1, ramp(r, -0.15, 0.3)]);
  const R0 = ramp(r, 0.24, 0.34) * stature;
  const knee = add(base, add(mul(lean, H * 0.5), [ramp(r, -0.2, 0.2), 0, ramp(r, -0.1, 0.1)]));
  const top = add(knee, mul(norm(add(lean, [ramp(r, -0.35, 0.35), 0.3, ramp(r, -0.1, 0.2)])), H * 0.5));
  mesh.tube([base[0], base[1] - 0.3, base[2]], knee, R0 * 1.4, R0 * 1.05, INK.trunk, M.trunk, 8);
  mesh.tube(knee, top, R0 * 1.05, R0 * 0.88, INK.trunk, M.trunk, 8);
  const limbsFrom = mesh.v.n;
  const ends: Array<[V3, V3, number]> = [];
  const UP: V3 = [0, 1, 0];
  /**
   * (the way a limb goes, drawn as the print draws a tree: spread across the picture, up and out to
   * either side, little toward the eye or away; and what depth it has, a little away from the eye
   * rather than toward it, so the near side of the crown is open and its limbs are seen)
   */
  const fan = (d: V3): V3 => norm([d[0], d[1], d[2] * 0.45 + 0.14]);
  const twig = (from: V3, d: V3, len: number, rad: number) => {
    // (a hairline, straight, thinning to nothing)
    const e = add(from, mul(d, len));
    mesh.tube(from, e, rad, 0.004, INK.trunk, M.twig, 3);
    if (r() < 0.6) ends.push([e, d, 1]);
    return e;
  };
  /**
   * a limb: a long run, then a slight turn and on (as the print's are drawn: runs and angles, not
   * curves), thinning steadily; at its end it forks, two ways or three, the forks narrow; at the
   * last, a lace of fine twigs out to the crown's edge, and the blossom about them
   */
  const grow = (from: V3, dir: V3, len: number, rad: number, depth: number) => {
    const kink = fan(norm(add(add(dir, mul(UP, 0.08)), [ramp(r, -0.3, 0.3), ramp(r, -0.12, 0.15), ramp(r, -0.3, 0.3)])));
    const mid = add(from, mul(dir, len * ramp(r, 0.45, 0.6))), to = add(mid, mul(kink, len * 0.48));
    const sides = depth >= 3 ? 3 : depth >= 2 ? 4 : depth >= 1 ? 5 : 6;
    const taper = depth >= 3 ? 0.55 : 0.78;
    if (depth <= 1) {
      // (the main limbs wander a little along their way: a third bend, small, between)
      const q1 = add(add(from, mul(sub(mid, from), 0.5)), [ramp(r, -0.08, 0.08) * len, ramp(r, -0.05, 0.08) * len, ramp(r, -0.04, 0.04) * len]);
      const rm = rad * (1 + taper) / 2;
      mesh.tube(from, q1, rad, (rad + rm) / 2, INK.trunk, M.twig, sides);
      mesh.tube(q1, mid, (rad + rm) / 2, rm, INK.trunk, M.twig, sides);
    } else mesh.tube(from, mid, rad, rad * (1 + taper) / 2, INK.trunk, M.twig, sides);
    mesh.tube(mid, to, rad * (1 + taper) / 2, rad * taper, INK.trunk, M.twig, sides);
    // (now and then a short spur out of the turn)
    if (depth >= 1 && r() < 0.45) twig(mid, fan(norm(add(kink, [ramp(r, -1, 1), ramp(r, 0, 0.5), ramp(r, -0.6, 0.6)]))), len * ramp(r, 0.3, 0.5), rad * 0.4);
    if (depth >= 3) {
      for (let k = 0, n = 3 + Math.floor(r() * 3); k < n; k++) twig(to, fan(norm(add(kink, [ramp(r, -0.7, 0.7), ramp(r, -0.05, 0.5), ramp(r, -0.6, 0.6)]))), len * ramp(r, 0.5, 0.9), rad * 0.45);
      ends.push([to, kink, 3]);
      return;
    }
    if (depth === 2 && r() < 0.35) ends.push([to, kink, 1]);
    const n = depth === 0 ? 2 + (r() < 0.45 ? 1 : 0) : 2;
    const u = norm(cross(kink, Math.abs(kink[1]) < 0.9 ? UP : [1, 0, 0])), w = cross(kink, u);
    const phi0 = r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const phi = phi0 + (i / n) * Math.PI * 2 + ramp(r, -0.4, 0.4), th = ramp(r, 0.32, 0.62);
      const d = fan(norm(add(mul(kink, Math.cos(th)), mul(add(mul(u, Math.cos(phi)), mul(w, Math.sin(phi))), Math.sin(th)))));
      grow(to, d, len * ramp(r, 0.68, 0.82), rad * 0.62, depth + 1);
    }
  };
  // (the limbs: three or four, up and out to either side across the picture from the top of the trunk; now and then one lower down)
  const limbs = 3 + (r() < 0.45 ? 1 : 0), a0 = ramp(r, -0.4, 0.4);
  for (let i = 0; i < limbs; i++) {
    // (spread across: from up-left to up-right, the middle ones the more upright)
    const t = limbs === 1 ? 0.5 : i / (limbs - 1), a = -1.15 + 2.3 * t + a0 * 0.4 + ramp(r, -0.18, 0.18);
    const d = fan(norm([Math.sin(a) + lean[0] * 0.3, Math.cos(a) * ramp(r, 0.85, 1.15), ramp(r, -0.6, 0.6)]));
    grow(top, d, ramp(r, 1.3, 1.9) * stature, R0 * 0.56, 0);
  }
  if (r() < 0.5) { const sd = r() < 0.5 ? -1 : 1; grow(knee, fan(norm([sd, 0.7, ramp(r, -0.4, 0.4)])), ramp(r, 1.1, 1.5) * stature, R0 * 0.45, 1); }
  const tips = ends;
  // the crown's middle, for its lighting
  let cx = 0, cy = 0, cz = 0;
  for (const [p] of tips) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= tips.length; cy /= tips.length; cz /= tips.length;
  // (its branches shown through its own blossom, as ink over colour, and not through anything
  // else: each point of a limb is drawn nearer the eye by as far as it lies inside the crown in
  // front of it, the most at the crown's heart, none at its rim or below it, so the limbs stay
  // joined to the trunk and can't show through a neighbouring tree or a roof. In the drawing: the
  // limb's colour carries how far)
  let Rh = 0.8, Rv = 0.6;
  for (const [p] of tips) { Rh = Math.max(Rh, Math.hypot(p[0] - cx, p[2] - cz)); Rv = Math.max(Rv, Math.abs(p[1] - cy)); }
  Rh += 0.5; Rv += 0.6;
  // (its shade on the ground: broad and faint under the crown, off to the shadow side; deeper about the trunk's foot)
  shade(mesh, path, cx - 0.5 * (cy - base[1]) * 0.55, cz + 0.5 * (cy - base[1]) * 0.35, 3.0, 1.6, 0.1);
  shade(mesh, path, base[0] - 0.5, base[2] + 0.1, 1.1, 0.4, 0.22);
  const L: V3 = norm([0.55, 0.75, -0.35]);
  // (each tree its own pink, a little deeper or paler than the next)
  const t0 = ramp(r, -0.24, 0.12);
  const crownSeed = r();
  // (each tree its own fullness: most crowns full, some thinner, where more of the limbs show)
  const full = r() < 0.7 ? ramp(r, 0.85, 1) : ramp(r, 0.55, 0.75);
  for (const [p, d, k] of tips) {
    const n = k + (k > 1 && r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      // (a clump about the fan of twigs, lifted a little: the blossom sits on top of the branches)
      // (a clump about the twigs' ends, set a little behind them along the eye's line, so it's in the
      // same place on the print but the ink falls in front of it, as the print lays it)
      const back = ramp(r, 0.35, 0.8);
      const q: V3 = [p[0] + d[0] * ramp(r, 0, 0.5) + ramp(r, -0.5, 0.5) + VIEW[0] * back, p[1] + ramp(r, 0, 0.4) + VIEW[1] * back, p[2] + d[2] * ramp(r, 0, 0.5) + ramp(r, -0.4, 0.4) + VIEW[2] * back];
      // (the near side of the crown, low down, left open: there the limbs are seen against the blossom behind)
      if ((q[2] - cz) < -0.3 * Rh && q[1] < cy - 0.1 && r() < 0.45) continue;
      if (r() > full) continue;
      const rad = (k > 1 ? ramp(r, 0.5, 0.78) : ramp(r, 0.32, 0.52)) * Math.min(stature, 1.15);
      // (none right over the path, so its way stays open; in front of it, as the eye looks up the hill,
      // the crowns stand as they grow, and the walker passes behind them and comes out again)
      if (path.nearest(q[0], q[2]).d < WIDTH / 2 + 0.1) continue;
      const out = norm([q[0] - cx, (q[1] - cy) * 1.8, q[2] - cz]);
      const shade = Math.max(0, Math.min(1, 0.55 + t0 + 0.26 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.2 * (q[1] - cy) + ramp(r, -0.04, 0.04)));
      puffs.push(q[0], q[1], q[2], rad, shade, crownSeed * 0.5 + r() * 0.5);
    }
  }
  // (and the dome filled out behind its branches, so the crown is one full mass of blossom with the
  // ink across it, as the print has it: clumps through the upper part of the crown, set back along
  // the eye's line from the branches' plane)
  for (let k = 0, n = Math.round(tips.length * 0.4); k < n; k++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.9, up = ramp(r, -0.35, 1);
    const back = ramp(r, 1.0, 1.6);
    const q: V3 = [cx + Math.cos(a) * rr * Rh + VIEW[0] * back, cy + up * Rv * 0.8 + VIEW[1] * back, cz + Math.sin(a) * rr * Rh * 0.6 + VIEW[2] * back];
    if (path.nearest(q[0], q[2]).d < WIDTH / 2 + 0.1) continue;
    const out = norm([q[0] - cx, (q[1] - cy) * 1.8, q[2] - cz]);
    const shade = Math.max(0, Math.min(1, 0.55 + t0 + 0.26 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.2 * (q[1] - cy) + ramp(r, -0.04, 0.04)));
    puffs.push(q[0], q[1], q[2], ramp(r, 0.5, 0.75) * Math.min(stature, 1.15), shade, crownSeed * 0.5 + r() * 0.5);
  }
  // fallen blossom under it, where it's not the path: in drifts, stamped flowers and specks of red
  for (let k = 0; k < 4; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 3.4;
    const dx = cx + Math.cos(a) * d, dz = cz + Math.sin(a) * d;
    for (let i = 0; i < 12; i++) {
      const big = i < 5;
      const x = dx + (r() - 0.5) * (big ? 1.8 : 2.6), z = dz + (r() - 0.5) * (big ? 1.2 : 1.8);
      const nr = path.nearest(x, z);
      if (big && nr.d < WIDTH / 2 + 0.3) continue;
      const y = nr.d < WIDTH / 2 ? path.at(nr.s).p[1] + 0.01 : ground(path, x, z) + 0.06;
      // (shade above .5: a whole flower)
      petals.push(x, y, z, big ? ramp(r, 0.2, 0.36) : ramp(r, 0.04, 0.08), r() * Math.PI, big ? ramp(r, 0.55, 1) : r() * 0.5);
    }
  }
}

/**
 * A temple's gate hall, across the head of its flight, as the print has it: the stair climbs
 * straight up to it between balustrades onto a stone terrace, railed round; the hall stands on the
 * terrace with its doors open front and back, and the path goes through it and on from behind.
 * White walls on a grey stone plinth; a porch of red columns on stone bases; a red beam, painted
 * panels of teal and blue under it, a row of brackets; a red door, lattice windows; the plaque
 * with the temple's name hung under the eaves. Its roof of turquoise glazed tiles, hip-and-gable,
 * every tile drawn: the lower slopes hipped all round, a red gable at each end; the eaves well out,
 * a row of round tile-ends along them, and swept up at the corners; a ridge along its top with
 * tall beaded finials at its ends, ridges down the gables and the hips, little knobs along them.
 * White walls run off to each side, capped with tiles. `face`: the way its front looks (down the flight).
 */
function temple(mesh: Mesh, t: TempleAt, seed: number, name: number) {
  const r = seeded(seed);
  const { c, face, flight: f, gate } = t;
  // (its x along the front; z out of the front. Beside the path, it stands raised on its terrace, a stair down to the path)
  const fx = -face[1], fz = face[0];
  const B = gate ? 0 : 0.7;
  const P0 = (x: number, y: number, z: number): V3 => [c[0] + fx * x + face[0] * z, c[1] + y, c[2] + fz * x + face[1] * z];
  const P = (x: number, y: number, z: number): V3 => P0(x, y + B, z);
  const along: [number, number] = [fx, fz];
  const W = ramp(r, 2.9, 3.3), wd = ramp(r, 1.4, 1.6), Hw = 3.0;
  const stone = INK.stepTop, blue = hex(0x3c5f8a), base = hex(0xd9d0bf);
  // the terrace: stone, deep into the hill under it
  const tw = W + 1.5, T = TERRACE / 2;
  mesh.box(P(0, -2.5, 0), [tw, 2.5, T], along, stone, INK.stepFace, M.step, M.stone);
  const N = Math.min(f.steps, 7);
  if (gate) {
    // (the stair up to it is the path's own: beside its last steps a cheek of stone, and on it a balustrade, posts and a rail)
    for (const sd of [-1, 1]) {
      const tops: V3[] = [];
      for (let k = f.steps - N; k < f.steps; k++) {
        const u = (k + 0.5) * f.run, top = f.a[1] + (k + 1) * RISE + 0.12, off = (WIDTH / 2 + 0.34) * sd;
        const q: V3 = [f.a[0] + f.dir[0] * u + f.dir[1] * off, top, f.a[2] + f.dir[1] * u - f.dir[0] * off];
        mesh.box([q[0], top - 0.5, q[2]], [f.run / 2 + 0.012, 0.5, 0.17], f.dir, stone, INK.stone, M.stone);
        mesh.box([q[0], top + 0.26, q[2]], [0.065, 0.26, 0.065], f.dir, stone, INK.stone, M.stone);
        mesh.tube([q[0], top + 0.52, q[2]], [q[0], top + 0.64, q[2]], 0.08, 0.03, stone, M.stone, 6);
        tops.push([q[0], top + 0.46, q[2]]);
      }
      for (let i = 0; i + 1 < tops.length; i++) mesh.tube(tops[i], tops[i + 1], 0.04, 0.04, stone, M.stone, 4);
    }
  } else {
    // (its own stair, down the front to the path, a balustrade either side)
    const ns = 4, sw = WIDTH / 2 + 0.15;
    const tops: V3[][] = [[], []];
    for (let k = 0; k < ns; k++) {
      const top = B * (ns - k) / (ns + 1), z = T + (k + 0.5) * 0.32;
      mesh.box(P0(0, top - 1.2, z), [sw, 1.2, 0.17], along, stone, INK.stepFace, M.step, M.stone);
      [-1, 1].forEach((sd, i) => {
        mesh.box(P0(sd * (sw + 0.19), top - 0.6 + 0.14, z), [0.19, 0.6, 0.17], along, stone, INK.stone, M.stone);
        mesh.box(P0(sd * (sw + 0.19), top + 0.14 + 0.26, z), [0.065, 0.26, 0.065], along, stone, INK.stone, M.stone);
        mesh.tube(P0(sd * (sw + 0.19), top + 0.14 + 0.52, z), P0(sd * (sw + 0.19), top + 0.14 + 0.64, z), 0.08, 0.03, stone, M.stone, 6);
        tops[i].push(P0(sd * (sw + 0.19), top + 0.14 + 0.46, z));
      });
    }
    for (const row of tops) for (let i = 0; i + 1 < row.length; i++) mesh.tube(row[i], row[i + 1], 0.04, 0.04, stone, M.stone, 4);
  }
  // (the terrace's balustrade: posts with round heads, carved panels between, a rail over; round it but where the stair comes up)
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 0.7));
    const dl: [number, number] = [((bx - ax) * fx + (bz - az) * face[0]) / L, ((bx - ax) * fz + (bz - az) * face[1]) / L];
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * (i / n), z = az + (bz - az) * (i / n);
      mesh.box(P(x, 0.27, z), [0.065, 0.27, 0.065], along, stone, INK.stone, M.stone);
      mesh.tube(P(x, 0.54, z), P(x, 0.66, z), 0.08, 0.03, stone, M.stone, 6);
      if (i < n) {
        const mx = ax + (bx - ax) * ((i + 0.5) / n), mz = az + (bz - az) * ((i + 0.5) / n);
        mesh.box(P(mx, 0.22, mz), [L / n / 2 - 0.07, 0.15, 0.03], dl, stone, base, M.stone);
      }
    }
    mesh.box(P((ax + bx) / 2, 0.46, (az + bz) / 2), [L / 2, 0.035, 0.045], dl, stone, INK.stone, M.stone);
  };
  const ei = 0.12, so = gate ? WIDTH / 2 + 0.34 : WIDTH / 2 + 0.53;
  rail(-tw + ei, T - ei, -so, T - ei); rail(so, T - ei, tw - ei, T - ei);
  rail(-tw + ei, T - ei, -tw + ei, -T + ei); rail(tw - ei, T - ei, tw - ei, -T + ei);
  if (gate) { rail(-tw + ei, -T + ei, -so, -T + ei); rail(so, -T + ei, tw - ei, -T + ei); } else rail(-tw + ei, -T + ei, tw - ei, -T + ei);
  // the walls, white on a plinth of grey stone
  const wz = -0.25, zf = wz + wd, zc = zf + 0.5;
  mesh.box(P(0, Hw / 2, wz), [W, Hw / 2, wd], along, INK.wall, INK.wall, M.wall);
  mesh.box(P(0, 0.28, wz), [W + 0.04, 0.28, wd + 0.04], along, stone, INK.stone, M.stone);
  // the columns, red on round stone bases: across the porch, and at the corners
  const n = 4;
  const colX = (i: number) => -W + 0.3 + (i / (n - 1)) * (2 * W - 0.6);
  const column = (x: number, z: number) => {
    mesh.tube(P(x, 0, z), P(x, Hw, z), 0.16, 0.14, INK.red, M.red, 8);
    mesh.tube(P(x, 0, z), P(x, 0.14, z), 0.26, 0.24, base, M.stone, 10);
  };
  for (let i = 0; i < n; i++) column(colX(i), zc);
  for (const sx of [-1, 1]) column(sx * (W + 0.06), wz - wd - 0.06);
  // a beam over the porch; under it, between the columns, painted panels; over it a row of brackets, all round
  mesh.box(P(0, Hw - 0.15, zc), [W + 0.1, 0.15, 0.16], along, INK.red, INK.red, M.red);
  for (let i = 0; i + 1 < n; i++) {
    const x0 = colX(i), x1 = colX(i + 1), mx = (x0 + x1) / 2, hw = (x1 - x0) / 2 - 0.16;
    if (i === 1) continue;
    mesh.box(P(mx, Hw - 0.48, zc + 0.02), [hw, 0.17, 0.05], along, INK.red, INK.red, M.red);
    mesh.box(P(mx, Hw - 0.48, zc + 0.06), [hw - 0.06, 0.12, 0.03], along, INK.tile, INK.tile, M.red);
    mesh.box(P(mx, Hw - 0.48, zc + 0.08), [hw * 0.55, 0.07, 0.03], along, blue, blue, M.red);
  }
  for (let x = -W + 0.2; x <= W - 0.15; x += 0.42) for (const z of [zc + 0.05, wz - wd - 0.05]) {
    mesh.box(P(x, Hw + 0.1, z), [0.12, 0.1, 0.22], along, INK.tileDark, INK.tile, M.ridge);
  }
  // the doors, front and back: red, open, the dark within; lattice windows either side in front
  for (const [z, sgn] of [[zf, 1], [wz - wd, -1]] as Array<[number, number]>) {
    mesh.box(P(0, 1.2, z + 0.02 * sgn), [0.95, 1.2, 0.06], along, INK.red, INK.red, M.red);
    mesh.box(P(0, 1.1, z + 0.05 * sgn), [0.75, 1.1, 0.06], along, INK.dark, INK.dark, M.dark);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (W * 0.64);
    mesh.box(P(x, 1.45, zf + 0.02), [0.62, 0.62, 0.05], along, INK.red, INK.red, M.red);
    mesh.box(P(x, 1.45, zf + 0.04), [0.5, 0.5, 0.05], along, INK.dark, INK.dark, M.dark);
    for (let i = -2; i <= 2; i++) mesh.box(P(x + i * 0.17, 1.45, zf + 0.09), [0.018, 0.5, 0.02], along, INK.red, INK.red, M.red);
    for (let i = -2; i <= 2; i++) mesh.box(P(x, 1.45 + i * 0.17, zf + 0.09), [0.5, 0.018, 0.02], along, INK.red, INK.red, M.red);
  }
  // (the plaque, hung from the beam between the middle columns: its face carries its name, from the plaque's texture: uv in its colour)
  const pz = zc + 0.1, py = Hw - 1.2, pw = (colX(2) - colX(1)) / 2 - 0.12, ph = pw * 0.62;
  mesh.box(P(0, py + ph / 2, pz - 0.05), [pw + 0.1, ph / 2 + 0.1, 0.04], along, INK.red, INK.red, M.red);
  const pq = [P(-pw, py, pz), P(-pw, py + ph, pz), P(pw, py + ph, pz), P(pw, py, pz)] as const;
  const fn: V3 = [face[0], 0, face[1]];
  // (u to the right as it's looked at from in front)
  const uv: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [0, 0]];
  // (its name, from the plaques' sheet: one name a row)
  for (const k of [0, 1, 2, 0, 2, 3]) { const p = pq[k]; mesh.v.push(p[0], p[1], p[2], fn[0], fn[1], fn[2], uv[k][0], (name + uv[k][1]) / NAMES.length, 0, M.plaque); }

  // the roof: hip-and-gable. u across the front (-1 to 1), v front to back (-1 to 1); within the
  // gables (|x| < gx) the front and back slopes run up to the ridge; outside, the hipped ends run
  // up only so far as the gables' foot (g of the way)
  const ex = W + 1.15, ez = zc + 0.95, rz = 0, y0 = Hw + 0.25, rise = 2.2;
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
      // (one surface, seen from both sides: its underside darker, in the drawing; its colour carries where on the roof it is, for its tiles: their rows run down the slope, whichever way the slope runs)
      const at = (uu: number, vv: number): C3 => {
        const hz = 1 - Math.abs(vv), hx = end ? g * (ex - Math.abs(uu * ex)) / (ex - gx) : 9;
        return hx < hz ? [(vv * ez) / 0.26, (ex - Math.abs(uu * ex)) / 0.3, 2] : [(uu * ex) / 0.26, (1 - Math.abs(vv)) * ez / 0.3, 2];
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
  // (the eaves' edge: a band all round, carrying a row of round tile-ends, in the drawing: its colour says where along it each is)
  const E = 28;
  const eave = (fn2: (t: number) => [number, number]) => {
    const pts = Array.from({ length: E + 1 }, (_, i) => { const [u, v] = fn2(i / E); return roofAt(u, v, Math.abs(u) > gu - 1e-6); });
    let run = 0;
    for (let i = 0; i < E; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const a2: V3 = [a[0], a[1] - 0.2, a[2]], b2: V3 = [b[0], b[1] - 0.2, b[2]];
      const nn = norm(cross(sub(b, a), sub(a2, a)));
      const r0 = run / 0.26, r1 = (run + L) / 0.26;
      for (const [p, cu, cv] of [[a, r0, 0], [b, r1, 0], [b2, r1, 1], [a, r0, 0], [b2, r1, 1], [a2, r0, 1]] as Array<[V3, number, number]>) mesh.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], cu, cv, 3, M.ridge);
      run += L;
    }
  };
  eave((t) => [-1 + 2 * t, 1]); eave((t) => [-1 + 2 * t, -1]); eave((t) => [-1, -1 + 2 * t]); eave((t) => [1, -1 + 2 * t]);
  // (a line of ridge: a run of tube, a little over the roof; knobs along it now and then)
  const ridgeLine = (pts: V3[], ra: number, rb: number, knobs = 0) => {
    for (let i = 0; i + 1 < pts.length; i++) { const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1); mesh.tube(pts[i], pts[i + 1], ra + (rb - ra) * t0, ra + (rb - ra) * t1, dark, M.ridge, 6); }
    for (let k = 0; k < knobs; k++) { const p = pts[pts.length - 2 - k]; if (p) mesh.tube(p, add(p, [0, 0.22, 0]), 0.07, 0.03, INK.tile, M.ridge, 5); }
  };
  /** a finial: beads stacked, the top one pointed */
  const finial = (at: V3, h: number) => {
    const rs = [0.17, 0.11, 0.16, 0.09, 0.13, 0.06, 0.1, 0.02];
    for (let i = 0; i + 1 < rs.length; i++) mesh.tube(add(at, [0, (h * i) / (rs.length - 1), 0]), add(at, [0, (h * (i + 1)) / (rs.length - 1), 0]), rs[i], rs[i + 1], i % 2 ? dark : INK.tile, M.ridge, 6);
  };
  for (const sx of [-1, 1]) {
    // the gable: a red triangle, standing up from the hipped end, under its barge board
    const NG = 8, vg = 1 - g;
    for (let i = 0; i < NG; i++) {
      const v0 = -vg + (2 * vg * i) / NG, v1 = -vg + (2 * vg * (i + 1)) / NG;
      const t0 = roofAt(sx * gu, v0, false, -0.04), t1 = roofAt(sx * gu, v1, false, -0.04);
      const b0 = roofAt(sx * gu, v0, true), b1 = roofAt(sx * gu, v1, true);
      // (set back a hand from the hipped end's top)
      const back: V3 = [-fx * sx * 0.12, 0, -fz * sx * 0.12];
      mesh.quad(add(b0, back), add(t0, back), add(t1, back), add(b1, back), INK.gable, M.red, [fx * sx, 0, fz * sx]);
    }
    // (its barge board: ridges down both its edges from the top, knobs at their feet)
    for (const sv of [-1, 1]) ridgeLine(Array.from({ length: 7 }, (_, i) => roofAt(sx * gu, sv * vg * (i / 6), false, 0.08)), 0.1, 0.08, 1);
    // the hips: from the gable's foot down to the corners, a few knobs near their ends, ending turned up
    for (const sv of [-1, 1]) {
      const pts = Array.from({ length: 8 }, (_, i) => { const k = g * (1 - i / 7); return roofAt(sx * (ex - (k * (ex - gx)) / g) / ex, sv * (1 - k), true, 0.08); });
      ridgeLine(pts, 0.09, 0.07, 3);
      const tip = pts[pts.length - 1], out = norm(sub(tip, pts[pts.length - 2]));
      mesh.tube(tip, add(add(tip, mul(out, 0.3)), [0, 0.35, 0]), 0.07, 0.03, dark, M.ridge, 5);
    }
  }
  // the ridge along its top, and its ends: curled up and in, a tall beaded finial over each
  const top = roofAt(0, 0, false, 0.12);
  mesh.box([top[0], top[1] + 0.06, top[2]], [gx + 0.15, 0.18, 0.14], along, INK.tile, dark, M.ridge);
  for (const sx of [-1, 1]) {
    const q = (x: number, y: number): V3 => { const b2 = roofAt(sx * gu, 0, false, 0.1); return add(b2, [fx * sx * x, y, fz * sx * x]); };
    ridgeLine([q(0.1, 0), q(0.18, 0.4), q(0.1, 0.72), q(-0.12, 0.84), q(-0.28, 0.7)], 0.17, 0.06);
    finial(q(-0.05, 0.15), 1.1);
  }
  // white walls out to each side, their tops tiled
  // (long, across the hill, for a gate; short, for a temple beside the path, so they don't run along it)
  const wl = gate ? 4.6 : 1.6, wx = gate ? W + 1.2 + wl : tw + wl;
  for (const sx of [-1, 1]) {
    mesh.box(P(sx * wx, 0.35, wz), [wl, 1.85, 0.24], along, INK.wall, INK.wall, M.wall);
    mesh.box(P(sx * wx, -0.9, wz), [wl + 0.02, 1.3, 0.26], along, stone, INK.stone, M.stone);
    mesh.box(P(sx * wx, 2.32, wz), [wl + 0.15, 0.13, 0.45], along, INK.tile, INK.tileDark, M.tile);
    mesh.box(P(sx * wx, 2.5, wz), [wl, 0.07, 0.08], along, INK.tileDark, INK.tileDark, M.ridge);
  }
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
