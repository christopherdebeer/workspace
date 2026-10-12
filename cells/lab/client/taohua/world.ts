/**
 * Taohua: the world, a band at a time. The hill is cut across into bands, so deep up the hill;
 * each is made from the seed and its number (the same seed, the same hillside): the ground; the
 * ways' steps and stones that fall in it; black rocks along their edges and among the trees; peach
 * trees, grown branch by branch, their blossom in clumps of puffs about the ends of their
 * branches; petals fallen on the ground; and now and then a temple, beside a way or across it. What's solid is one mesh (vertices: position, normal, colour, material);
 * the blossom and the petals are lists for instancing.
 */
import { hash, noise1, seeded, type Rand } from '../kit/rng';
import { identify, moving } from '../changes/model';
import { inStation, stationsNear, type Station } from './compose';
import { RISE, TERRACE_OF, WIDTH, Ways, type Junction, type V3, type Way } from './ways';

/** how deep a tile of the hill is, up it (m), and how wide, across it: the world is made a tile at a time, about the walker, as far across as the ways go */
export const BAND = 12, TILE = 16;
/** a vertex: position, normal, colour, material */
export const STRIDE = 10;
/** the way the eye looks, on the whole (down the hill's slope from above and below it): for setting things behind one another as it sees them */
const VIEW: V3 = (() => { const p = 0.76; return [0, -Math.sin(p), Math.cos(p)]; })();
/** materials: what the drawing does with each */
export const M = { ground: 0, step: 1, stone: 2, rock: 3, trunk: 4, tile: 5, red: 6, wall: 7, robe: 8, hat: 9, petal: 10, blossom: 11, plaque: 12, twig: 13, dark: 14, skin: 15, ridge: 16, grass: 17, earth: 18, shade: 19, type: 20, water: 21 } as const;

type C3 = [number, number, number];
const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
/** the temples' names, in turn, as their plaques have them */
export const NAMES = ['大林寺', '桃花庵', '白云寺', '清凉寺', '栖霞寺', '云居寺', '灵岩寺', '兰若寺'];
/** The sheet of the temples' names, as their plaques have them: cells 512 by 160, in columns; a cell's place on the sheet, as the drawing's u, v. */
export const ATLAS = { cols: 4, rows: 2, w: 512, h: 160 };
export const atlasUV = (cell: number, u: number, v: number): [number, number] => [((cell % ATLAS.cols) + u) / ATLAS.cols, (Math.floor(cell / ATLAS.cols) + v) / ATLAS.rows];
type Rect = [number, number, number, number];
/**
 * The sheet the casts' words are written from, in ink on nothing (where there's no ink, the hill
 * shows): each hexagram's name, its characters one under the other (cells 128 by 256, sixteen to a
 * row); 之; each hexagram's number and title, small, plain and again after an arrow (cells 512 by
 * 56, four to a row). Pixels, from its top left.
 */
export const TYPE = {
  w: 2048, h: 3072,
  han: (k: number): Rect => [(k % 16) * 128, Math.floor(k / 16) * 256, 128, 256],
  zhi: [0, 1024, 128, 128] as Rect,
  en: (k: number, arrow: boolean): Rect => { const i = k + (arrow ? 64 : 0); return [(i % 4) * 512, 1152 + Math.floor(i / 4) * 56, 512, 56]; },
};
/** the print's inks */
export const INK = {
  paper: hex(0xefe6d3), stepTop: hex(0xebe4d4), stepFace: hex(0xcfc6b4), stone: hex(0xb9b1a1), rock: hex(0x2a2827), rockTop: hex(0x7d7c79),
  trunk: hex(0x2b2321), tile: hex(0x45ad9c), tileDark: hex(0x1f5f58), red: hex(0xb8382c), wall: hex(0xeee9df), dark: hex(0x2d2622),
  robe: hex(0x6f7882), hat: hex(0xd8c39a), skin: hex(0xe2c7a6), grass: hex(0x6d7258), gable: hex(0x9c3a2e),
};

export interface Band {
  i: number; j: number;
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
export function ground(ways: Ways, x: number, z: number): number {
  // (beside a way, it lies smooth under it; further off, it rolls. Beside a stair it lies well
  // under: the stair rises in steps and the hill in a slope, so at each step's front the slope comes
  // up nearly to the tread, and must stay clear of it)
  // (and by water, carved to hold it: see Water.bed)
  return groundCut(ways, x, z).y;
}
/** the ground, and how deep it's cut into the hill there for water (where deep, its banks are rock) */
export function groundCut(ways: Ways, x: number, z: number): { y: number; cut: number } {
  const nr = ways.nearest(x, z), k = smooth(1.3, 3.4, nr.d);
  const under = ways.stairAt(nr.w, nr.u) ? 0.34 : 0.08;
  const g = ways.hill(z) + k * 0.18 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.53 - x * 0.2) - 0.04 - under * (1 - k);
  return ways.water.bed(x, z, g);
}

/** a temple's stair: so many steps, each so deep, from so high (above the temple's foot) at its foot up to its terrace */
export interface TempleStair { n: number; h0: number }
export type BuildingKind = 'gate' | 'hall' | 'pavilion' | 'pagoda' | 'shrine';
export interface TempleAt {
  c: V3; face: [number, number]; name: number; kind: BuildingKind; gate: boolean;
  /** its terrace: how high above its foot (c's height), how far across from its middle, how deep from it */
  B: number; tw: number; T: number;
  /** its stair down the front; a gate's down the back */
  front: TempleStair; back: TempleStair | null;
  /** a hall's bays (3 or 5), its roof hipped (not hip-and-gable), its eaves double, walls out to its sides */
  bays: number; hip: boolean; double: boolean; wings: boolean;
}
/** how deep a temple's step is */
export const TSTEP = 0.32;

/**
 * The buildings near z: at each junction that has one (a gate across a way, or a building at a
 * branch's end), on its terrace, its front looking down the way it's reached by. Each of its kind,
 * its parts from the seed and its junction; with its terrace's height and its stairs, so the
 * walker can climb them.
 */
export function templesNear(ways: Ways, z0: number, z1: number): TempleAt[] {
  const out: TempleAt[] = [];
  for (const j of ways.junctionsNear(z0 - 16, z1 + 16)) {
    const kind: BuildingKind | null = j.gate ? 'gate' : j.end && j.end !== 'cast' ? j.end : null;
    if (!kind) continue;
    const memo = templeMemo.get(j);
    if (memo) { out.push(memo); continue; }
    const r = seeded(hash(ways.seed, j.n, 0x7e1));
    const c: V3 = [j.x, j.y, j.z], face = j.face;
    const T = TERRACE_OF[kind];
    const bays = kind === 'hall' && r() < 0.4 ? 5 : 3;
    const tw = kind === 'hall' || kind === 'gate' ? (bays === 5 ? ramp(r, 5.7, 6.3) : ramp(r, 4.4, 4.8)) : kind === 'pavilion' ? ramp(r, 2.3, 3.2) : kind === 'pagoda' ? T : 2.3;
    const L = (x: number, z: number): V3 => [c[0] - face[1] * x + face[0] * z, 0, c[2] + face[0] * x + face[1] * z];
    // (its terrace level with the hill at its back, or a little above; its front stair up from below)
    const backFoot = L(0, -(T + 1.4));
    const B = Math.max(kind === 'pavilion' || kind === 'shrine' ? 0.45 : 0.6, ways.hill(backFoot[2]) - c[1] + 0.16);
    const stairTo = (sgn: number): TempleStair => {
      const foot = L(0, sgn * (T + 1.4));
      const h0 = ways.hill(foot[2]) - c[1];
      return { n: Math.max(2, Math.round((B - h0) / RISE)), h0 };
    };
    const name = hash(ways.seed, j.n, 0x7e) % NAMES.length;
    const t: TempleAt = { c, face, name, kind, gate: kind === 'gate', B, tw, T, front: stairTo(1), back: kind === 'gate' ? stairTo(-1) : null, bays, hip: r() < 0.3, double: kind === 'hall' && r() < 0.4, wings: kind === 'hall' && r() < 0.5 };
    templeMemo.set(j, t);
    out.push(t);
  }
  return out.filter((t) => t.c[2] > z0 - 14 && t.c[2] < z1 + 14);
}
const templeMemo = new WeakMap<Junction, TempleAt>();

/** Where one stands on a temple's terrace or stair, if (x, z) is on one: the height there. */
export function templeSurface(t: TempleAt, x: number, z: number): number | null {
  const dx = x - t.c[0], dz = z - t.c[2];
  const ax = dx * -t.face[1] + dz * t.face[0], az = dx * t.face[0] + dz * t.face[1];
  if (Math.abs(ax) > WIDTH / 2 + 0.4) return null;
  const T = t.T;
  if (Math.abs(az) <= t.T) return t.c[1] + t.B;
  const st = az > 0 ? t.front : t.back;
  if (!st) return null;
  const k = Math.floor((Math.abs(az) - T) / TSTEP);
  if (k >= st.n) return null;
  // (step k down from the terrace)
  return t.c[1] + t.B - ((k + 1) / (st.n + 1)) * (t.B - st.h0);
}

/**
 * Large-scale composition, independent of streaming bands. Every 36 m has an asymmetric
 * opening beside the route; overlapping soft fields leave wooded shoulders between them.
 * This controls whole groves before any individual tree is grown.
 */
export interface Opening { cx: number; cz: number; rx: number; rz: number; side: number; i: number }
/** the opening in cell (ix, iz) of the hill, 36 m each way: beside whichever way passes nearest its middle */
export function opening(ways: Ways, seed: number, ix: number, iz: number): Opening {
  const rr = seeded(hash(seed, ix, iz, 0xc041));
  const cz = iz * 36 + 12 + rr() * 12, mx = ix * 36 + 18;
  const side = rr() < 0.5 ? -1 : 1;
  const at = ways.nearest(mx, cz).p;
  const cx = at[0] + side * (2.5 + rr() * 2.5);
  return { cx, cz, rx: 5.5 + rr() * 3.5, rz: 8 + rr() * 5, side, i: ix * 100003 + iz };
}
export function groveDensity(ways: Ways, seed: number, x: number, z: number): number {
  const cz = Math.floor(z / 36), cx = Math.floor(x / 36);
  let open = 0;
  for (let i = cz - 1; i <= cz + 1; i++) for (let k = cx - 1; k <= cx + 1; k++) {
    const o = opening(ways, seed, k, i);
    const d = Math.hypot((x - o.cx) / o.rx, (z - o.cz) / o.rz);
    open = Math.max(open, 1 - smooth(0.55, 1.15, d));
  }
  const mass = noise1(hash(seed, 0xc042), z / 17 + x / 11);
  return (0.7 + 0.29 * mass) * (1 - open);
}

/** Tile (i, j) of the hill: i across it, j up it. */
export function makeBand(ways: Ways, seed: number, i: number, j: number): Band {
  const z0 = j * BAND, z1 = z0 + BAND, x0 = i * TILE, x1 = x0 + TILE;
  const r = seeded(hash(seed, i, j, 0xb4d));
  const mesh = new Mesh();
  const puffs: number[] = [], petals: number[] = [];
  const temples = templesNear(ways, z0, z1);
  const inT = (x: number, z: number) => z >= z0 && z < z1 && x >= x0 && x < x1;
  // (whether a place is on a temple's terrace or by its walls, in the temple's own frame: across its front, and out from it)
  const onTemple = (x: number, z: number, m: number) => temples.some((t) => {
    const dx = x - t.c[0], dz = z - t.c[2];
    const ax = Math.abs(dx * -t.face[1] + dz * t.face[0]), az = dx * t.face[0] + dz * t.face[1];
    return (ax < t.tw + 0.4 + m && az < t.T + 0.6 + m + (t.front.n + 1) * TSTEP && az > -t.T - 0.6 - m - (t.back ? (t.back.n + 1) * TSTEP : 0)) || (t.gate && ax < t.tw + 6.3 + m && Math.abs(az + 0.3) < 0.8 + m);
  });

  // (the open space about a temple beside a way, where its terrace and courtyard stand)
  const inGlade = (x: number, z: number) => temples.some((t) => !t.gate && Math.hypot(x - t.c[0], z - t.c[2]) < t.T + 4.5);
  // (the stations' spaces, kept open: no tree whose crown would stand over one, no rock in one)
  const sts = stationsNear(ways, seed, z0, z1);
  const treeOut = (x: number, z: number) => inStation(sts, x, z, 2.8, 4.5);
  /** whether (x, z) is just downhill of a way, where a crown would stand between the eye and it */
  const belowWay = (x: number, z: number) => [2, 3.8, 5.6, 7.2].some((dz) => ways.nearest(x, z + dz).d < WIDTH / 2 + 1);

  // the ground: a sheet across the hill, the paper's cream
  const nx = TILE / 1.5, nz = BAND / 1.5;
  // (each corner: where it is, and how near the path, for the brush strokes along it)
  const gv = new Map<string, number[]>();
  const GV = (x: number, z: number) => {
    const key = `${x},${z}`;
    let v = gv.get(key);
    if (!v) { const nr = ways.nearest(x, z); const worn = ways.stairAt(nr.w, nr.u) ? 0 : 1 - smooth(0.5, 1.6, nr.d); v = [x, ground(ways, x, z), z, 0, 1, 0, worn, 0, 0, M.ground]; gv.set(key, v); }
    return v;
  };
  // (by water, finer, so its banks are drawn true; each corner carries how deep it's cut into the
  // hill for the water: where deep, the drawing makes it rock)
  const cutAt = new Map<string, number>();
  const GW = (x: number, z: number) => {
    const key = `${x},${z}`;
    let v = gv.get(key);
    if (!v) {
      const nr = ways.nearest(x, z), worn = ways.stairAt(nr.w, nr.u) ? 0 : 1 - smooth(0.5, 1.6, nr.d), gc = groundCut(ways, x, z);
      v = [x, gc.y, z, 0, 1, 0, worn, gc.cut, 0, M.ground]; gv.set(key, v); cutAt.set(key, gc.cut);
    }
    return v;
  };
  for (let i = 0; i < Math.round(nx); i++) for (let k = 0; k < nz; k++) {
    const xa = x0 + i * 1.5, xb = xa + 1.5, za = z0 + k * 1.5, zb = za + 1.5;
    if (ways.dryOf(xa + 0.75, za + 0.75) > 3.5) {
      for (const [x, z] of [[xa, za], [xa, zb], [xb, zb], [xa, za], [xb, zb], [xb, za]]) mesh.v.push(...GV(x, z));
      continue;
    }
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const xs = xa + a * 0.5, zs = za + b * 0.5, xe = xs + 0.5, ze = zs + 0.5;
      for (const [x, z] of [[xs, zs], [xs, ze], [xe, ze], [xs, zs], [xe, ze], [xe, zs]]) mesh.v.push(...GW(x, z));
    }
  }

  // the water: its surface, level across, following the hill down or level in its pools, dropping at
  // its falls; with rocks along its banks and in it where it runs fast, ledges at its falls, reeds in a marsh
  water(mesh, petals, ways, seed, x0, x1, z0, z1);

  // the ways: on their steep stretches, steps, each a slab of its own, laid on the hill, its ends
  // ragged (no two the same length, nor quite in line), turning as the way bends; on their gentle
  // stretches, only a few flat stones here and there, and a worn line (in the drawing)
  const near = ways.waysNear(z0 - 3, z1 + 3).filter((w) => w.box[1] > x0 - 4 && w.box[0] < x1 + 4);
  const onTerrace = (x: number, z: number) => temples.some((t) => templeSurface(t, x, z) !== null);
  for (const w of near) {
    const wh = hash(seed, w.n, 0x5a);
    for (const [si, st] of w.stairs.entries()) {
      const du = (st.u1 - st.u0) / st.n;
      for (let k = 0; k < st.n; k++) {
        const uc = st.u0 + (k + 0.5) * du;
        const m = ways.at(w, uc, true), dir = m.dir;
        if (!inT(m.p[0], m.p[2]) || onTerrace(m.p[0], m.p[2])) continue;
        const top = st.h0 + ((k + 1) / st.n) * (st.h1 - st.h0);
        const h = hash(wh, si, k);
        // (its two ends, each its own way out or in)
        const l = WIDTH / 2 + ((h >> 8) % 100) / 100 * 0.24 - 0.08, rr = WIDTH / 2 + ((h >> 16) % 100) / 100 * 0.24 - 0.08;
        const shift = (rr - l) / 2, half = (l + rr) / 2;
        const cc: V3 = [m.p[0] + dir[1] * shift, top, m.p[2] - dir[0] * shift];
        // Worn slabs: clipped, unequal corners; continuous treads keep the walk surface level.
        const sr = seeded(h), hx = du / 2 + 0.03;
        const cut = () => 0.025 + sr() * 0.075;
        const corners: Array<[number, number]> = [
          [-hx + cut(), -half], [hx - cut(), -half + sr() * 0.04],
          [hx, -half + cut()], [hx, half - cut()],
          [hx - cut(), half], [-hx + cut(), half - sr() * 0.04],
          [-hx, half - cut()], [-hx, -half + cut()],
        ];
        const P = (u: number, v: number, y: number): V3 => [cc[0] + dir[0] * u + dir[1] * v, y, cc[2] + dir[1] * u - dir[0] * v];
        const centre = P(0, 0, top);
        for (let n = 0; n < corners.length; n++) {
          const a = corners[n], b = corners[(n + 1) % corners.length];
          const pa = P(a[0], a[1], top), pb = P(b[0], b[1], top);
          mesh.tri(centre, pb, pa, INK.stepTop, M.step, [0, 1, 0]);
          mesh.quad(P(a[0], a[1], top - 0.6), P(b[0], b[1], top - 0.6), pb, pa, INK.stepFace, M.step);
        }
      }
      // (now and then, along one side of a stair, a wall of squared blocks holding the hill back, stepping up with it)
      const wr = seeded(hash(wh, si, 0x3a1));
      if (wr() < 0.4) {
        const sd = wr() < 0.5 ? 1 : -1, k0 = Math.floor(wr() * st.n * 0.5), n = Math.min(st.n - k0, 3 + Math.floor(wr() * 5));
        for (let k = k0; k < k0 + n; k++) {
          const m = ways.at(w, st.u0 + (k + 0.5) * du, true), top = st.h0 + ((k + 1) / st.n) * (st.h1 - st.h0) + 0.22 + (k % 2) * 0.16;
          const off = (WIDTH / 2 + 0.55) * sd;
          const bc: V3 = [m.p[0] + m.dir[1] * off, top - 0.45, m.p[2] - m.dir[0] * off];
          if (inT(bc[0], bc[2]) && !onTerrace(bc[0], bc[2])) mesh.box(bc, [du / 2 + 0.01, 0.45, 0.3], m.dir, INK.stepTop, INK.stone, M.stone);
        }
      }
    }
    // (where it crosses water: stepping stones, or a bridge)
    if (w.cross) crossing(mesh, ways, w, inT);
    // (stones along its gentle stretches)
    const tr = seeded(hash(wh, 0x5e7));
    for (let u = ramp(tr, 0.2, 0.8); u < w.len; u += ramp(tr, 0.6, 1.8)) {
      if (tr() < 0.45 || ways.stairAt(w, u) || (w.cross && u > w.cross.u0 - 0.5 && u < w.cross.u1 + 0.5)) continue;
      const m = ways.at(w, u, true), off = ramp(tr, -0.45, 0.45);
      const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
      if (!inT(x, z) || onTerrace(x, z)) continue;
      stone(mesh, ways, x, z, ramp(tr, 0.16, 0.34), tr);
    }
  }

  // temples
  for (const t of temples) if (inT(t.c[0], t.c[2])) temple(mesh, t, hash(seed, Math.round(t.c[2] * 10), 0x7e));

  // rocks along the ways' edges, black, in little clusters, and the ground about them
  const gy = (x: number, z: number) => ground(ways, x, z);
  const rocks: Array<[number, number, number]> = [];
  for (const w of near) {
    const rr = seeded(hash(seed, w.n, 0x40c));
    for (let u = 0.6; u < w.len; u += ramp(rr, 0.9, 2.6)) {
      const m = ways.at(w, u, true), stair = !!ways.stairAt(w, u);
      for (const sd of [-1, 1]) {
        // (fewer along a trail: it's open ground, a stone or two by the way)
        if (rr() < (stair ? 0.55 : 0.82)) continue;
        const off = (WIDTH / 2 + 0.6 + rr() * 0.9) * sd;
        const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
        if (!inT(x, z)) continue;
        rocks.push([x, z, ramp(rr, 0.28, 0.7)]);
        // (a smaller one leaning on it, now and then; and another)
        for (let k = 0; k < 2 && rr() < 0.55; k++) { const a = rr() * 6.3, d = ramp(rr, 0.45, 0.8); rocks.push([x + Math.cos(a) * d + m.dir[1] * 0.2 * sd, z + Math.sin(a) * d, ramp(rr, 0.18, 0.42)]); }
      }
    }
  }
  // (and a few out among the trees, low and broad)
  for (let i = 0; i < 2; i++) {
    const x = ramp(r, x0, x1), z = ramp(r, z0, z1);
    if (ways.nearest(x, z).d < WIDTH / 2 + 0.8) continue;
    rocks.push([x, z, ramp(r, 0.4, 0.95)]);
  }
  for (const [x, z, sz] of rocks) {
    if (ways.dryOf(x, z) < 0.1) continue;
    if (ways.nearest(x, z).d < WIDTH / 2 + 0.35 || onTemple(x, z, 0.3) || inStation(sts, x, z, 0.4)) continue;
    const rr = seeded(hash(Math.round(x * 10), Math.round(z * 10), seed));
    rock(mesh, [x, gy(x, z), z], sz, rr, gy);
    shade(mesh, ways, x - 0.9 * sz, z + 0.15 * sz, sz * 2.2, sz * 0.8, 0.3);
    for (let k = 0, n = 1 + Math.floor(rr() * 3); k < n; k++) { const a = rr() * 6.3, d = sz * ramp(rr, 1, 1.5); tuft(mesh, ways, x + Math.cos(a) * d, z + Math.sin(a) * d, rr, 3 + Math.floor(rr() * 4)); }
  }
  // grass in tufts along the ways' edges, more along a trail, and here and there on the hill
  for (const w of near) {
    const rr = seeded(hash(seed, w.n, 0x6a5));
    for (let u = 0.3; u < w.len; u += ramp(rr, 0.3, 1.2)) {
      const m = ways.at(w, u, true), stair = !!ways.stairAt(w, u);
      const sd = rr() < 0.5 ? 1 : -1, off = (WIDTH / 2 + (stair ? 0.3 : -0.15) + rr() * 0.3) * sd;
      const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
      if (inT(x, z) && !onTemple(x, z, 0) && ways.nearest(x, z).d > WIDTH / 2 - 0.3) tuft(mesh, ways, x, z, rr, 3 + Math.floor(rr() * 4));
    }
  }
  for (let i = 0; i < 16; i++) {
    const x = ramp(r, x0, x1), z = ramp(r, z0, z1);
    if (ways.nearest(x, z).d > WIDTH / 2 + 0.5 && !onTemple(x, z, 0) && !inStation(sts, x, z, 0)) tuft(mesh, ways, x, z, r, 2 + Math.floor(r() * 4));
  }

  // (each station's words, inked on the hill; beside them, a cairn or a wayside shrine)
  for (const st of sts) if (inT(st.c[0], st.c[2])) { castWords(mesh, ways, st); castMark(mesh, ways, st); }

  // (each station's space shaped by its cast: what stands behind it, as its upper trigram has it; what
  // lies in it, below the words, as its lower has it)
  for (const st of sts) {
    const sr = seeded(hash(seed, st.i, 0x7121));
    const R = (u: number, v: number): [number, number] => [st.c[0] + u * st.rx, st.c[2] + v * st.rz];
    // (a station at a junction has no side of a way: its own, from its number)
    const away = st.side || (st.i % 2 ? 1 : -1);
    switch (st.upper) {
      case 'Mountain': // (standing stones along its upper edge)
        for (let k = 0, n = 3 + Math.floor(sr() * 2); k < n; k++) {
          const [x, z] = R(ramp(sr, -0.9, 0.9), ramp(sr, 1.05, 1.3));
          if (inT(x, z) && ways.nearest(x, z).d > WIDTH / 2 + 0.6) { const sz = ramp(sr, 0.45, 0.9); rock(mesh, [x, gy(x, z), z], sz, sr, gy); shade(mesh, ways, x - 0.9 * sz, z + 0.1, sz * 2.2, sz * 0.7, 0.28); }
        }
        break;
      case 'Wind': // (a grove close behind it)
        for (let k = 0; k < 3; k++) {
          const [x, z] = R(ramp(sr, -0.9, 0.9), ramp(sr, 1.25, 1.6));
          if (inT(x, z) && ways.nearest(x, z).d > WIDTH / 2 + 1.5 && !belowWay(x, z)) tree(mesh, puffs, petals, [x, gy(x, z), z], sr, ways);
        }
        break;
      case 'Thunder': { // (one tree at its far side, leaning out over it)
        const [x, z] = R(away * ramp(sr, 1.15, 1.35), ramp(sr, 0.2, 0.7));
        if (inT(x, z) && ways.nearest(x, z).d > WIDTH / 2 + 1.5 && !belowWay(x, z)) tree(mesh, puffs, petals, [x, gy(x, z), z], sr, ways);
        break;
      }
    }
    switch (st.lower) {
      case 'Water': // (flat stones across it, as stepping stones over a stream)
        for (let k = 0; k < 5; k++) {
          const t = k / 4, [x, z] = R(-0.7 + 1.4 * t, -0.97 + 0.08 * t + ramp(sr, -0.03, 0.03));
          if (inT(x, z)) stone(mesh, ways, x, z, ramp(sr, 0.2, 0.3), sr);
        }
        break;
      case 'Lake': // (a ring of flat stones)
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2, [x, z] = R(-away * 0.95 + Math.cos(a) * 0.3, -0.55 + Math.sin(a) * 0.14);
          if (inT(x, z)) stone(mesh, ways, x, z, ramp(sr, 0.14, 0.22), sr);
        }
        break;
      case 'Fire': // (fallen blossom, red, heaped)
        for (let k = 0; k < 16; k++) {
          const [x, z] = R(ramp(sr, -0.9, 0.9), ramp(sr, -1.05, -0.85));
          if (inT(x, z)) petals.push(x, gy(x, z) + 0.06, z, ramp(sr, 0.2, 0.34), sr() * Math.PI, ramp(sr, 0.6, 1));
        }
        break;
      case 'Mountain': { // (one stone, low, at its edge)
        const [x, z] = R(-away * 0.95, -0.7);
        if (inT(x, z)) { const sz = ramp(sr, 0.35, 0.5); rock(mesh, [x, gy(x, z), z], sz, sr, gy); shade(mesh, ways, x - 0.9 * sz, z + 0.1, sz * 2.2, sz * 0.7, 0.28); }
        break;
      }
      case 'Wind': // (grass, in tufts)
        for (let k = 0; k < 6; k++) { const [x, z] = R((k % 2 ? 1 : -1) * ramp(sr, 0.75, 0.95), ramp(sr, -0.8, 0.2)); if (inT(x, z)) tuft(mesh, ways, x, z, sr, 4); }
        break;
      case 'Thunder': // (a stone split in two)
        for (const dx of [-0.08, 0.08]) { const [x, z] = R(away * 0.92 + dx, -0.7); if (inT(x, z)) rock(mesh, [x, gy(x, z), z], 0.3, seeded(hash(st.i, 3)), gy); }
        break;
    }
  }

  // (each opening held by one tree standing alone in it, toward its far side, away from the path,
  // its blossom fallen about it: the clearing is a shape the tree gives meaning to, not just a gap)
  for (let i = Math.floor(z0 / 36) - 1; i <= Math.floor(z1 / 36) + 1; i++) for (let ix = Math.floor(x0 / 36) - 1; ix <= Math.floor(x1 / 36) + 1; ix++) {
    const o = opening(ways, seed, ix, i), lr = seeded(hash(seed, ix, i, 0x10e));
    if (lr() < 0.25) continue;
    const x = o.cx + o.side * o.rx * ramp(lr, 0.25, 0.5), z = o.cz + o.rz * ramp(lr, -0.1, 0.35);
    if (!inT(x, z) || ways.nearest(x, z).d < WIDTH / 2 + 2.2 || belowWay(x, z) || onTemple(x, z, 1) || inGlade(x, z) || treeOut(x, z)) continue;
    tree(mesh, puffs, petals, [x, ground(ways, x, z), z], lr, ways);
  }

  // trees: on a jittered grid, not on the path (though they lean over it), not on a temple's terrace
  const G = 3.9;
  for (let gx = Math.floor((x0 - G * 0.45) / G) * G; gx < x1 + G * 0.45; gx += G) for (let gz = Math.floor((z0 - G * 0.45) / G) * G; gz < z1 + G * 0.45; gz += G) {
    const tr = seeded(hash(seed, Math.round(gx * 10), Math.round(gz * 10), 0x7ee));
    const accept = tr();
    const x = gx + (tr() - 0.5) * G * 0.9, z = gz + (tr() - 0.5) * G * 0.9;
    // Ownership follows the final jittered position; neighbouring bands visit the same candidates.
    if (!inT(x, z)) continue;
    if (accept > groveDensity(ways, seed, x, z)) continue;
    if (ways.nearest(x, z).d < WIDTH / 2 + 1.5) continue;
    // (nor just downhill of a way: from above, its crown would stand between the eye and the way, and a
    // way across the hill would be lost under it; the strip below each way is kept open, a tree's height deep)
    if (belowWay(x, z)) continue;
    if (onTemple(x, z, 0.8) || inGlade(x, z) || treeOut(x, z)) continue;
    // (an outcrop behind it, now and then, as in the print: black slabs the blossom stands against)
    if (tr() < 0.5) for (let k = 0, n = 2 + Math.floor(tr() * 3); k < n; k++) {
      const a = Math.PI / 2 + ramp(tr, -1.1, 1.1), d = ramp(tr, 0.45, 1.5), rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d, sz = ramp(tr, 0.4, 0.9) * (k ? 0.75 : 1);
      if (ways.nearest(rx, rz).d > WIDTH / 2 + 0.6 && !onTemple(rx, rz, 0.3) && !inStation(sts, rx, rz, 0.4)) {
        rock(mesh, [rx, gy(rx, rz), rz], sz, seeded(hash(seed, Math.round(rx * 10), Math.round(rz * 10))), gy);
        shade(mesh, ways, rx - 0.9 * sz, rz + 0.1, sz * 2.2, sz * 0.7, 0.28);
        tuft(mesh, ways, rx + sz * 0.9, rz - sz * 0.3, tr, 4);
      }
    }
    tree(mesh, puffs, petals, [x, ground(ways, x, z), z], tr, ways);
  }
  // petals fallen on the path too
  for (let i = 0; i < 36; i++) {
    const x = ramp(r, x0, x1), z = ramp(r, z0, z1);
    petals.push(x, restY(ways, x, z, 0.02), z, ramp(r, 0.04, 0.08), r() * Math.PI, r() * 0.5);
  }
  return { i, j, verts: mesh.v.out(), puffs: new Float32Array(puffs), petals: new Float32Array(petals), temples: temples.filter((t) => inT(t.c[0], t.c[2])).map((t) => ({ c: t.c, face: Math.atan2(t.face[0], t.face[1]), poem: t.name })) };
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
function stone(mesh: Mesh, ways: Ways, x: number, z: number, size: number, r: Rand) {
  const n = 5 + Math.floor(r() * 3), turn = r() * 6.3, long = ramp(r, 1, 1.6);
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + ramp(r, -0.25, 0.25), rr = size * ramp(r, 0.7, 1);
    const lx = Math.cos(a) * rr * long, lz = Math.sin(a) * rr;
    const px = x + lx * Math.cos(turn) - lz * Math.sin(turn), pz = z + lx * Math.sin(turn) + lz * Math.cos(turn);
    return [px, ground(ways, px, pz), pz] as V3;
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
export function shade(mesh: Mesh, ways: Ways, x: number, z: number, rx: number, rz: number, deep: number) {
  const N = 12, lift = 0.04 + deep * 0.08;
  const G = (u: number, v: number): V3 => { const px = x + u * rx, pz = z + v * rz; return [px, ground(ways, px, pz) + lift, pz]; };
  const c = G(0, 0);
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2;
    const p0 = G(Math.cos(a0), Math.sin(a0)), p1 = G(Math.cos(a1), Math.sin(a1));
    mesh.v.push(c[0], c[1], c[2], 0, 1, 0, 0, 0, deep, M.shade);
    mesh.v.push(p1[0], p1[1], p1[2], 0, 1, 0, Math.cos(a1), Math.sin(a1), deep, M.shade);
    mesh.v.push(p0[0], p0[1], p0[2], 0, 1, 0, Math.cos(a0), Math.sin(a0), deep, M.shade);
  }
}

const WATER_KIND = { flow: 0, pool: 1, pond: 1, spring: 1, plunge: 1, marsh: 2, falls: 3 } as const;
/**
 * The water in a tile: its surface (a fine sheet, at its level wherever it's within reach of the
 * water; the banks, carved, stand up through it at its edge; where its level drops from step to
 * step the sheet drops too, a fall); rocks along it; reeds in a marsh; petals afloat.
 * Each vertex carries, for the drawing, how far in from the edge it is, how far across from a stream's middle line, and what kind of water (and, after the point, how fast it runs).
 */
function water(mesh: Mesh, petals: number[], ways: Ways, seed: number, x0: number, x1: number, z0: number, z1: number) {
  const W = ways.water;
  const sts = W.streamsNear(z0, z1);
  if (!sts.length) return;
  const D = 0.5;
  const cache = new Map<number, [number, number, number, number, number, number] | null>();
  const at = (x: number, z: number) => {
    const key = Math.round(x * 4) * 100000 + Math.round(z * 4);
    if (cache.has(key)) return cache.get(key)!;
    const w = W.at(x, z);
    // (its edge is drawn where it's 0 m in from its edge (see the drawing); further out, the sheet's tucked under the ground)
    const v: [number, number, number, number, number, number] | null = w && w.s < 1.2 ? [x, w.s > 0.8 ? Math.min(w.L, ground(ways, x, z) - 0.03) : w.L, z, -w.s, w.across, WATER_KIND[w.kind] + Math.min(0.99, w.run)] : null;
    cache.set(key, v);
    return v;
  };
  for (let x = x0; x < x1 - 1e-6; x += D) for (let z = z0; z < z1 - 1e-6; z += D) {
    const a = at(x, z), b = at(x, z + D), c = at(x + D, z + D), d = at(x + D, z);
    if (!a || !b || !c || !d || Math.max(a[3], b[3], c[3], d[3]) < -0.6) continue;
    for (const t of [[a, b, c], [a, c, d]]) {
      const [p, q, o] = t;
      const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = o[0] - p[0], vy = o[1] - p[1], vz = o[2] - p[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      for (const v of t) mesh.v.vert(v[0], v[1], v[2], nx, ny, nz, v[3], v[4], v[5], M.water);
    }
  }
  const inT = (x: number, z: number) => z >= z0 && z < z1 && x >= x0 && x < x1;
  const gy = (x: number, z: number) => ground(ways, x, z);
  const clearOfWays = (x: number, z: number, m: number) => ways.nearest(x, z).d > WIDTH / 2 + m;
  for (const st of sts) {
    const r = seeded(hash(seed, st.k, Math.floor(z0), Math.floor(x0), 0x40c4));
    // (rocks along its banks, and in it where it runs fast)
    for (let z = Math.max(z0, st.z0 - 2); z < Math.min(z1, st.z1 + 2); z += ramp(r, 1.2, 3)) {
      const xc = W.xAt(st, z), hw = W.halfAt(st, z), lv = W.levelAt(st, z), fast = lv.kind === 'flow' && ways.slope(z) > 0.2;
      for (const sd of [-1, 1]) {
        if (r() > (fast ? 0.7 : 0.38)) continue;
        const x = xc + sd * (hw + ramp(r, -0.3, 0.6));
        if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.35, 0.8), r, gy);
      }
      if (fast && r() < 0.5) { const x = xc + ramp(r, -hw * 0.6, hw * 0.6); if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.3, 0.55), r, gy); }
    }
    // (at each fall's lip, ledges of rock either side; under a high fall, rock all about its pool)
    for (const f of st.falls) for (const lip of f.lips) {
      if (lip < z0 - 3 || lip > z1 + 3) continue;
      const xc = W.xAt(st, lip), hw = W.halfAt(st, lip) * 1.5;
      // (along the step the banks make at its lip, as far out as it's cut, rocks: a ledge, broken)
      for (const sd of [-1, 1]) for (let d = hw + ramp(r, 0, 0.4); d < hw + 7; d += ramp(r, 0.7, 1.1)) {
        const x = xc + sd * d, z = lip + ramp(r, -0.5, 0.7);
        if (d > hw + 1.5 && groundCut(ways, x, z - 0.6).cut < 0.35) break;
        if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.55, 1) * (f.single ? 1.3 : 1), r, gy);
      }
      if (f.single) for (const sd of [-1, 1]) for (let k = 0; k < 3; k++) {
        const x = xc + sd * (hw + ramp(r, 0.1, 0.9) + k * 0.6), z = lip - 1.5 - k * 1.6;
        if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.7, 1.2), r, gy);
      }
    }
    for (const p of st.pools) {
      if (p.z + p.rz * 2 < z0 || p.z - p.rz * 2 > z1) continue;
      // (rocks about a spring, above it, where it comes out)
      if (p.kind === 'spring') for (let k = 0; k < 5; k++) {
        const a = ramp(r, 0.3, 2.85), x = p.x + Math.cos(a) * p.rx * ramp(r, 1.1, 1.6), z = p.z + Math.sin(a) * p.rz * ramp(r, 1.1, 1.6);
        if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.5, 1), r, gy);
      }
      // (reeds in a marsh, in clumps; a few rocks about a pond's shore)
      if (p.kind === 'marsh') for (let k = 0; k < 60; k++) {
        const a = r() * 6.3, e = Math.sqrt(r()) * 1.05, x = p.x + Math.cos(a) * p.rx * e, z = p.z + Math.sin(a) * p.rz * e;
        const w = W.at(x, z);
        if (inT(x, z) && w && w.s > -2.2 && w.s < 0.6 && clearOfWays(x, z, 0.3)) reeds(mesh, x, w.s < 0 ? w.L : gy(x, z), z, r, 5 + Math.floor(r() * 7));
      }
      if (p.kind === 'pond' || p.kind === 'pool' || p.kind === 'plunge') for (let k = 0; k < (p.kind === 'pool' ? 2 : 5); k++) {
        const a = r() * 6.3, x = p.x + Math.cos(a) * p.rx * ramp(r, 0.95, 1.15), z = p.z + Math.sin(a) * p.rz * ramp(r, 0.95, 1.15);
        if (inT(x, z) && clearOfWays(x, z, 0.6)) rock(mesh, [x, gy(x, z), z], ramp(r, 0.4, 0.9), r, gy);
      }
    }
  }
  // (petals afloat, drifting together in its stiller water)
  const pr = seeded(hash(seed, Math.floor(x0), Math.floor(z0), 0xf10a));
  for (let i = 0; i < 70; i++) {
    const x = ramp(pr, x0, x1), z = ramp(pr, z0, z1), w = W.at(x, z);
    if (!w || w.s > -0.15 || (w.kind === 'flow' && w.run > 0.2) || w.kind === 'falls') continue;
    petals.push(x, w.L + 0.015, z, ramp(pr, 0.04, 0.09), pr() * Math.PI, pr() * 0.6);
  }
}
/** Reeds: a clump of tall thin blades, standing up out of the water. */
function reeds(mesh: Mesh, x: number, y: number, z: number, r: Rand, n: number) {
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, lean = ramp(r, 0.05, 0.3), h = ramp(r, 0.45, 1.05), w = ramp(r, 0.015, 0.03);
    const bx = x + Math.cos(a) * 0.12 * r(), bz = z + Math.sin(a) * 0.12 * r();
    const tip: V3 = [bx + Math.cos(a) * lean * h, y + h, bz + Math.sin(a) * lean * h];
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    mesh.tri([bx - px, y - 0.05, bz - pz], [bx + px, y - 0.05, bz + pz], tip, INK.grass, M.grass, [0, 1, 0]);
  }
}
/**
 * A way's crossing of water: stepping stones (squarish, pale-topped, a stride apart, just above
 * the water), or a bridge (a deck of stone slabs, arched a little, with a low kerb either side and
 * a pier at either bank).
 */
function crossing(mesh: Mesh, ways: Ways, w: Way, inT: (x: number, z: number) => boolean) {
  const c = w.cross!, r = seeded(hash(w.n, 0xb21d9e));
  if (c.kind === 'stones') {
    for (let u = c.u0 + 0.55; u < c.u1 - 0.3; u += ramp(r, 0.55, 0.7)) {
      const m = ways.at(w, u, true), side = ramp(r, -0.18, 0.18);
      const x = m.p[0] + m.dir[1] * side, z = m.p[2] - m.dir[0] * side;
      if (!inT(x, z)) continue;
      const top = ways.surface(w, u, z), turn = ramp(r, -0.35, 0.35), dir: [number, number] = [m.dir[0] * Math.cos(turn) - m.dir[1] * Math.sin(turn), m.dir[0] * Math.sin(turn) + m.dir[1] * Math.cos(turn)];
      mesh.box([x, top - 0.4, z], [ramp(r, 0.2, 0.27), 0.4, ramp(r, 0.26, 0.36)], dir, INK.stepTop, INK.stepFace, M.step);
    }
    return;
  }
  const span0 = c.u0 - 0.4, span1 = c.u1 + 0.4, n = Math.max(3, Math.round((span1 - span0) / 0.5));
  const du = (span1 - span0) / n;
  for (let k = 0; k < n; k++) {
    const u = span0 + (k + 0.5) * du, m = ways.at(w, u, true);
    if (!inT(m.p[0], m.p[2])) continue;
    const top = ways.surface(w, Math.max(c.u0, Math.min(c.u1, u)), m.p[2]);
    mesh.box([m.p[0], top - 0.1, m.p[2]], [du / 2 + 0.01, 0.1, WIDTH / 2 + 0.06], m.dir, INK.stepTop, INK.stone, M.stone);
    for (const sd of [-1, 1]) {
      const off = (WIDTH / 2 + 0.02) * sd;
      mesh.box([m.p[0] + m.dir[1] * off, top + 0.1, m.p[2] - m.dir[0] * off], [du / 2 - 0.02, 0.1, 0.08], m.dir, INK.stepTop, INK.stone, M.stone);
    }
  }
  // (its piers, at either bank, down into the ground)
  for (const u of [c.u0, c.u1]) {
    const m = ways.at(w, u, true);
    if (!inT(m.p[0], m.p[2])) continue;
    const top = ways.surface(w, u, m.p[2]) - 0.2, foot = Math.min(ground(ways, m.p[0], m.p[2]), c.L) - 0.6;
    mesh.box([m.p[0], (top + foot) / 2, m.p[2]], [0.32, (top - foot) / 2, WIDTH / 2 + 0.16], m.dir, INK.stepTop, INK.stone, M.stone);
  }
}

/** Where a fallen petal comes to rest: on a way (its tread, a stepping stone, a bridge's deck), afloat on water, or on the ground. */
function restY(ways: Ways, x: number, z: number, lift: number): number {
  const nr = ways.nearest(x, z);
  if (nr.d < WIDTH / 2) return ways.surface(nr.w, nr.u, z) + 0.01;
  const wt = ways.water.at(x, z);
  if (wt && wt.s < -0.05) return wt.L + 0.015;
  return ground(ways, x, z) + lift;
}

/** A tuft of grass: a few blades, fine, leaning out from a clump; where the ground meets a rock or a wall. */
function tuft(mesh: Mesh, ways: Ways, x: number, z: number, r: Rand, n = 5) {
  if (ways.dryOf(x, z) < 0.15) return;
  const y = ground(ways, x, z);
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
function tree(mesh: Mesh, puffs: number[], petals: number[], base: V3, r: Rand, ways: Ways) {
  // (none stands in water, nor on a bank cut steep; nor just downhill of water, where its crown would
  // stand between the eye and it: the water's an open mass, as the print's are)
  if (ways.dryOf(base[0], base[2]) < 2.2) return;
  for (const dz of [1.5, 3, 4.5, 6, 7.5]) { const w = ways.water.at(base[0], base[2] + dz); if (w && w.s < 0) return; }
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
  shade(mesh, ways, cx - 0.5 * (cy - base[1]) * 0.55, cz + 0.5 * (cy - base[1]) * 0.35, 3.0, 1.6, 0.1);
  shade(mesh, ways, base[0] - 0.5, base[2] + 0.1, 1.1, 0.4, 0.22);
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
      // (crowns stand as they grow, over a way too: the walker passes under them and comes out again)
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
      const nr = ways.nearest(x, z);
      if (big && nr.d < WIDTH / 2 + 0.3) continue;
      const y = restY(ways, x, z, 0.06);
      // (shade above .5: a whole flower)
      petals.push(x, y, z, big ? ramp(r, 0.2, 0.36) : ramp(r, 0.04, 0.08), r() * Math.PI, big ? ramp(r, 0.55, 1) : r() * 0.5);
    }
  }
}

/**
 * A cast's words, inked on the hillside in the space kept for them, as a page would set them: the
 * figure (six lines, the first at the bottom, a yin line broken, the moving lines vermilion); its
 * name in a column beside it, and if it moves, 之 and the name of what it becomes; under both, the
 * numbers and titles, small. Laid on the ground (just above it, following it), stretched up the hill
 * as much as the eye's slant onto the slope there shortens it, so it reads square. Whatever stands
 * before it (a crown, a rock) stands before it.
 */
function castWords(mesh: Mesh, ways: Ways, st: Station) {
  const hex = identify(st.lines), rel = st.lines.some(moving) ? identify(st.lines, true) : null;
  // (the page: in its pixels, about as the print shows them where the walker is)
  const PX = 0.038, CH = 30, EN = 18, ENW = 512 * EN / 56;
  const nh = [...hex.han].length, nr = rel ? [...rel.han].length : 0;
  const colH = (nh + (rel ? 1 + nr : 0)) * CH, top = Math.max(45, colH);
  const Wb = 120, Hb = top + 6 + EN * (rel ? 2 : 1);
  const ax = st.c[0], az = st.c[2] + st.rz * 0.2;
  const grade = ways.slope(az), sl = Math.atan(grade), kz = PX * Math.cos(sl) / Math.sin(0.76 + sl);
  const nl = Math.hypot(1, grade), nrm: V3 = [0, 1 / nl, -grade / nl];
  // (the page's right is the hill's -x, as the eye looks up it; its down, down the hill)
  const at = (px: number, py: number): [number, number] => [ax - (px - Wb / 2) * PX, az - (py - Hb / 2) * kz];
  const quad = (x0: number, y0: number, x1: number, y1: number, r: Rect | null, ink: number) => {
    const nx = Math.max(1, Math.ceil((x1 - x0) / 24)), ny = Math.max(1, Math.ceil((y1 - y0) / 24));
    const P = (i: number, j: number) => {
      const fx = i / nx, fy = j / ny, [x, z] = at(x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy);
      const u = r ? (r[0] + r[2] * fx) / TYPE.w : 0, v = r ? (r[1] + r[3] * fy) / TYPE.h : 0;
      return [x, ground(ways, x, z) + 0.06, z, nrm[0], nrm[1], nrm[2], u, v, ink, M.type];
    };
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      for (const q of [a, b, c, a, c, d]) mesh.v.push(...q);
    }
  };
  // (the figure: 42 by 45)
  st.lines.forEach((v, k) => {
    const y = (58 - k * 10.4) * 0.7, h = 3.4 * 0.7, col = moving(v) ? 2 : 1;
    if (v % 2) quad(1.4, y - h, 40.6, y + h, null, col);
    else { quad(1.4, y - h, 17.5, y + h, null, col); quad(24.5, y - h, 40.6, y + h, null, col); }
  });
  // (the names, a column beside it)
  const cell = (r: Rect, n: number): Rect => [r[0], r[1], r[2], 128 * n];
  let y = 0;
  quad(52, y, 52 + CH, y + nh * CH, cell(TYPE.han(hex.number - 1), nh), 0); y += nh * CH;
  if (rel) {
    quad(52, y, 52 + CH, y + CH, TYPE.zhi, 0); y += CH;
    quad(52, y, 52 + CH, y + nr * CH, cell(TYPE.han(rel.number - 1), nr), 0);
  }
  // (the titles, small, under both)
  quad(0, top + 6, ENW, top + 6 + EN, TYPE.en(hex.number - 1, false), 0);
  if (rel) quad(0, top + 6 + EN, ENW, top + 6 + EN * 2, TYPE.en(rel.number - 1, true), 0);
}

/**
 * Beside a cast's words, a small built thing that ties them to the place: a cairn of flat dark
 * stones, stacked, or a wayside shrine (a stone post, a little white house on it with a dark niche,
 * red posts at its front, under its own small roof of tiles), facing down the hill.
 */
function castMark(mesh: Mesh, ways: Ways, st: Station) {
  const r = seeded(hash(st.i, 0x5a1));
  const away = st.side || (st.i % 2 ? 1 : -1);
  const x = st.c[0] + away * st.rx * ramp(r, 1.2, 1.4), z = st.c[2] + st.rz * ramp(r, -0.12, 0.05);
  const y = ground(ways, x, z);
  const earthy = st.upper === 'Mountain' || st.lower === 'Mountain' || st.upper === 'Earth' || st.lower === 'Earth';
  if (earthy || r() < 0.35) {
    // (a cairn: flat stones, each smaller, each turned a little, the last a pebble)
    let h = y - 0.04, s0 = ramp(r, 0.36, 0.48);
    for (let k = 0, n = 4 + Math.floor(r() * 3); k < n; k++) {
      const sx = s0 * (1 - k * 0.14), th = ramp(r, 0.08, 0.14), a = r() * 3;
      mesh.box([x + ramp(r, -0.03, 0.03), h + th, z + ramp(r, -0.03, 0.03)], [sx, th, sx * ramp(r, 0.6, 0.85)], [Math.cos(a), Math.sin(a)], INK.rock, INK.rock, M.rock);
      h += th * 2;
    }
    shade(mesh, ways, x - 0.5, z + 0.1, 0.9, 0.35, 0.28);
    return;
  }
  // (a wayside shrine, facing down the hill)
  const face: [number, number] = [0, -1], fx = -face[1], fz = face[0];
  const P = (px: number, py: number, pz: number): V3 => [x + fx * px + face[0] * pz, y + py, z + fz * px + face[1] * pz];
  const along: [number, number] = [fx, fz];
  mesh.box(P(0, 0.35, 0), [0.2, 0.42, 0.18], along, INK.stepTop, INK.stepFace, M.step, M.stone);
  mesh.box(P(0, 0.8, 0), [0.4, 0.06, 0.34], along, INK.stepTop, INK.stepFace, M.step);
  mesh.box(P(0, 1.1, -0.02), [0.32, 0.25, 0.26], along, INK.wall, INK.wall, M.wall);
  mesh.box(P(0, 1.06, 0.22), [0.16, 0.18, 0.03], along, INK.dark, INK.dark, M.dark);
  for (const sx of [-1, 1]) mesh.tube(P(sx * 0.3, 0.86, 0.26), P(sx * 0.3, 1.36, 0.26), 0.035, 0.03, INK.red, M.red, 5);
  roof(mesh, P, fx, fz, { ex: 0.6, ez: 0.5, rz: 0, y0: 1.38, rise: 0.4, gx: 0.22, g: 0.5, sweep: 0.22 });
  shade(mesh, ways, x - 0.6, z + 0.1, 1.0, 0.35, 0.28);
}

/**
 * A roof of glazed tiles, every tile drawn: hip-and-gable (g < 1: the lower slopes hipped all
 * round, a red gable at each end under its barge board), hipped (g 1, a ridge gx long), or a
 * pyramid (g 1, gx 0, coming to a point). Its eaves well out (ex across, ez front to back, about
 * rz), swept up toward the corners; a row of round tile-ends along them; ridges down its hips and
 * gables with knobs along them; along its top a ridge with its ends curled in and a beaded finial
 * over each, or, coming to a point, one finial there. `P` places its own (x, y, z) in the world
 * (x along the front, z out of it).
 */
function roof(mesh: Mesh, P: (x: number, y: number, z: number) => V3, fx: number, fz: number, o: { ex: number; ez: number; rz: number; y0: number; rise: number; gx: number; g: number; sweep: number; spire?: number }) {
  const { ex, ez, rz, y0, rise, g } = o;
  const gx = Math.min(o.gx, ex * 0.8), gu = gx / ex, along: [number, number] = [fx, fz];
  const gable = g < 1 && gx > 0.1;
  const H = (k: number) => rise * Math.pow(k, 0.72);
  const inward = (u: number, v: number, end: boolean) => {
    const hz = 1 - Math.abs(v);
    if (!end) return hz;
    const hx = g * (ex - Math.abs(u * ex)) / Math.max(1e-3, ex - gx);
    return Math.min(hz, hx);
  };
  const roofAt = (u: number, v: number, end: boolean, up = 0): V3 => {
    const k = inward(u, v, end);
    // (the eaves swept up toward the corners, most at the corner itself)
    const sweep = o.sweep * Math.pow(smooth(0.3, 1, Math.abs(u)) * smooth(0.3, 1, Math.abs(v)), 1.3) * Math.pow(1 - k, 1.4);
    return P(u * ex, y0 + H(k) + sweep + up, rz + v * ez);
  };
  const patch = (ua: number, ub: number, nu: number, end: boolean) => {
    if (ub - ua < 1e-4) return;
    const S = 14;
    for (let i = 0; i < nu; i++) for (let k = 0; k < S; k++) {
      const u0 = ua + ((ub - ua) * i) / nu, u1 = ua + ((ub - ua) * (i + 1)) / nu, v0 = -1 + (2 * k) / S, v1 = v0 + 2 / S;
      const a = roofAt(u0, v0, end), b = roofAt(u0, v1, end), cc = roofAt(u1, v1, end), d = roofAt(u1, v0, end);
      // (one surface, seen from both sides: its underside darker, in the drawing; its colour carries where on the roof it is, for its tiles: their rows run down the slope, whichever way the slope runs)
      const at = (uu: number, vv: number): C3 => {
        const hz = 1 - Math.abs(vv), hx = end ? g * (ex - Math.abs(uu * ex)) / Math.max(1e-3, ex - gx) : 9;
        return hx < hz ? [(vv * ez) / 0.26, (ex - Math.abs(uu * ex)) / 0.3, 2] : [(uu * ex) / 0.26, (1 - Math.abs(vv)) * ez / 0.3, 2];
      };
      const nn = norm(cross(sub(b, a), sub(d, a)));
      for (const [p, uu, vv] of [[a, u0, v0], [b, u0, v1], [cc, u1, v1], [a, u0, v0], [cc, u1, v1], [d, u1, v0]] as Array<[V3, number, number]>) {
        const col = at(uu, vv);
        mesh.v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], col[0], col[1], col[2], M.tile);
      }
    }
  };
  const nEnd = Math.max(3, Math.round(5 * (1 - gu))), nMid = Math.max(1, Math.round(10 * gu));
  patch(-1, -gu, nEnd, true); patch(-gu, gu, nMid, false); patch(gu, 1, nEnd, true);
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
  const ridgeLine = (pts: V3[], ra: number, rb: number, knobs = 0) => {
    for (let i = 0; i + 1 < pts.length; i++) { const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1); mesh.tube(pts[i], pts[i + 1], ra + (rb - ra) * t0, ra + (rb - ra) * t1, dark, M.ridge, 6); }
    for (let k = 0; k < knobs; k++) { const p = pts[pts.length - 2 - k]; if (p) mesh.tube(p, add(p, [0, 0.22, 0]), 0.07, 0.03, INK.tile, M.ridge, 5); }
  };
  const vg = 1 - g;
  for (const sx of [-1, 1]) {
    if (gable) {
      // the gable: a red triangle, standing up from the hipped end, under its barge board
      const NG = 8;
      for (let i = 0; i < NG; i++) {
        const v0 = -vg + (2 * vg * i) / NG, v1 = -vg + (2 * vg * (i + 1)) / NG;
        const t0 = roofAt(sx * gu, v0, false, -0.04), t1 = roofAt(sx * gu, v1, false, -0.04);
        const b0 = roofAt(sx * gu, v0, true), b1 = roofAt(sx * gu, v1, true);
        const back: V3 = [-fx * sx * 0.12, 0, -fz * sx * 0.12];
        mesh.quad(add(b0, back), add(t0, back), add(t1, back), add(b1, back), INK.gable, M.red, [fx * sx, 0, fz * sx]);
      }
      for (const sv of [-1, 1]) ridgeLine(Array.from({ length: 7 }, (_, i) => roofAt(sx * gu, sv * vg * (i / 6), false, 0.08)), 0.1, 0.08, 1);
    }
    // the hips: down to the corners, a few knobs near their ends, ending turned up
    for (const sv of [-1, 1]) {
      const pts = Array.from({ length: 8 }, (_, i) => { const k = g * (1 - i / 7); return roofAt(sx * (ex - (k * (ex - gx)) / g) / ex, sv * (1 - k), true, 0.08); });
      ridgeLine(pts, 0.09, 0.07, 3);
      const tip = pts[pts.length - 1], out = norm(sub(tip, pts[pts.length - 2]));
      mesh.tube(tip, add(add(tip, mul(out, 0.3)), [0, 0.35, 0]), 0.07, 0.03, dark, M.ridge, 5);
    }
  }
  if (gx > 0.1) {
    // the ridge along its top, and its ends: curled up and in, a tall beaded finial over each
    const top = roofAt(0, 0, false, 0.12);
    mesh.box([top[0], top[1] + 0.06, top[2]], [gx + 0.15, 0.18, 0.14], along, INK.tile, dark, M.ridge);
    for (const sx of [-1, 1]) {
      const q = (x: number, y: number): V3 => { const b2 = roofAt(sx * gu, 0, false, 0.1); return add(b2, [fx * sx * x, y, fz * sx * x]); };
      ridgeLine([q(0.1, 0), q(0.18, 0.4), q(0.1, 0.72), q(-0.12, 0.84), q(-0.28, 0.7)], 0.17, 0.06);
      finial(mesh, q(-0.05, 0.15), 1.1);
    }
  } else finial(mesh, roofAt(0, 0, true, 0.02), o.spire ?? 1.2);
}
/** a finial: beads stacked, the top one pointed */
function finial(mesh: Mesh, at: V3, h: number) {
  const rs = [0.17, 0.11, 0.16, 0.09, 0.13, 0.06, 0.1, 0.02];
  const k = Math.max(1, h / 1.1);
  for (let i = 0; i + 1 < rs.length; i++) mesh.tube(add(at, [0, (h * i) / (rs.length - 1), 0]), add(at, [0, (h * (i + 1)) / (rs.length - 1), 0]), rs[i] * Math.sqrt(k), rs[i + 1] * Math.sqrt(k), i % 2 ? INK.tileDark : INK.tile, M.ridge, 6);
}

/**
 * A building on its terrace, of its kind, from its parts: a gate hall across a way; a hall, three
 * bays or five, under a hip-and-gable roof or a hipped one, its eaves single or double; an open
 * pavilion under a pyramid roof; a pagoda of three to five tiers; a small shrine. Each raised on a
 * stone terrace, railed round, a stair down its front to the way (a gate's down its back too);
 * white walls on a grey stone plinth, red columns on round stone bases, painted panels and a row
 * of brackets under the eaves, a red door, lattice windows, the plaque with the temple's name.
 * `face`: the way its front looks.
 */
function temple(mesh: Mesh, t: TempleAt, seed: number) {
  const r = seeded(seed);
  const { c, face, B, name, kind } = t;
  const gate = kind === 'gate';
  // (its x along the front; z out of the front)
  const fx = -face[1], fz = face[0];
  const P0 = (x: number, y: number, z: number): V3 => [c[0] + fx * x + face[0] * z, c[1] + y, c[2] + fz * x + face[1] * z];
  const P = (x: number, y: number, z: number): V3 => P0(x, y + B, z);
  const along: [number, number] = [fx, fz];
  const stone = INK.stepTop, blue = hex(0x3c5f8a), base = hex(0xd9d0bf);
  const tw = t.tw, T = t.T;
  // the terrace: stone, deep into the hill under it
  mesh.box(P(0, -3, 0), [tw, 3, T], along, stone, INK.stepFace, M.step, M.stone);
  // (its stairs, a balustrade either side: from the terrace down to the hill at their foot)
  const sw = WIDTH / 2 + 0.15;
  for (const [st, sgn] of [[t.front, 1], [t.back, -1]] as Array<[TempleStair | null, number]>) {
    if (!st) continue;
    const tops: V3[][] = [[], []];
    for (let k = 0; k < st.n; k++) {
      const top = B - ((k + 1) / (st.n + 1)) * (B - st.h0), z = sgn * (T + (k + 0.5) * TSTEP);
      mesh.box(P0(0, top - 1.2, z), [sw, 1.2, TSTEP / 2 + 0.01], along, stone, INK.stepFace, M.step, M.stone);
      [-1, 1].forEach((sd, i) => {
        mesh.box(P0(sd * (sw + 0.19), top - 0.6 + 0.14, z), [0.19, 0.6, TSTEP / 2 + 0.01], along, stone, INK.stone, M.stone);
        if (k % 2 === 0 || k === st.n - 1) {
          mesh.box(P0(sd * (sw + 0.19), top + 0.14 + 0.26, z), [0.065, 0.26, 0.065], along, stone, INK.stone, M.stone);
          mesh.tube(P0(sd * (sw + 0.19), top + 0.14 + 0.52, z), P0(sd * (sw + 0.19), top + 0.14 + 0.64, z), 0.08, 0.03, stone, M.stone, 6);
          tops[i].push(P0(sd * (sw + 0.19), top + 0.14 + 0.46, z));
        }
      });
    }
    for (const row of tops) for (let i = 0; i + 1 < row.length; i++) mesh.tube(row[i], row[i + 1], 0.04, 0.04, stone, M.stone, 4);
  }
  // (the terrace's balustrade: posts with round heads, carved panels between, a rail over; round it but where the stairs come up)
  const rail = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.3) return;
    const n = Math.max(1, Math.round(L / 0.7));
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
  const ei = 0.12, so = WIDTH / 2 + 0.53;
  rail(-tw + ei, T - ei, -so, T - ei); rail(so, T - ei, tw - ei, T - ei);
  rail(-tw + ei, T - ei, -tw + ei, -T + ei); rail(tw - ei, T - ei, tw - ei, -T + ei);
  if (t.back) { rail(-tw + ei, -T + ei, -so, -T + ei); rail(so, -T + ei, tw - ei, -T + ei); } else rail(-tw + ei, -T + ei, tw - ei, -T + ei);
  const column = (x: number, z: number, h: number, rad = 0.16) => {
    mesh.tube(P(x, 0, z), P(x, h, z), rad, rad * 0.88, INK.red, M.red, 8);
    mesh.tube(P(x, 0, z), P(x, 0.14, z), rad + 0.1, rad + 0.08, base, M.stone, 10);
  };
  const plaque = (pw: number, py: number, pz: number) => {
    const ph = pw * 0.62;
    mesh.box(P(0, py + ph / 2, pz - 0.05), [pw + 0.1, ph / 2 + 0.1, 0.04], along, INK.red, INK.red, M.red);
    const pq = [P(-pw, py, pz), P(-pw, py + ph, pz), P(pw, py + ph, pz), P(pw, py, pz)] as const;
    const fn: V3 = [face[0], 0, face[1]];
    // (u to the right as it's looked at from in front; its name, from the plaques' sheet: one name a row)
    const uv: Array<[number, number]> = [[1, 0], [1, 1], [0, 1], [0, 0]];
    for (const k of [0, 1, 2, 0, 2, 3]) { const p = pq[k], [tu, tv] = atlasUV(name, uv[k][0], uv[k][1]); mesh.v.push(p[0], p[1], p[2], fn[0], fn[1], fn[2], tu, tv, 0, M.plaque); }
  };

  if (kind === 'pavilion') {
    // an open pavilion: columns at its corners (and its sides, if it's long), low benches between, a pyramid roof (or a short ridge), its eaves swept high
    const s = t.tw - 0.6, d = Math.min(s, T - 0.5), Hc = ramp(r, 2.4, 2.8);
    const xs = s > 2.2 ? [-s, 0, s] : [-s, s];
    for (const x of xs) for (const z of [-d, d]) column(x, z, Hc, 0.13);
    for (const [ax, az, bx, bz] of [[-s, -d, s, -d], [-s, -d, -s, d], [s, -d, s, d]] as Array<[number, number, number, number]>) {
      const L = Math.hypot(bx - ax, bz - az), dl: [number, number] = [((bx - ax) * fx + (bz - az) * face[0]) / L, ((bx - ax) * fz + (bz - az) * face[1]) / L];
      mesh.box(P((ax + bx) / 2, 0.45, (az + bz) / 2), [L / 2, 0.05, 0.16], dl, INK.red, INK.red, M.red);
    }
    mesh.box(P(0, Hc - 0.1, d), [s + 0.15, 0.12, 0.12], along, INK.red, INK.red, M.red);
    mesh.box(P(0, Hc - 0.1, -d), [s + 0.15, 0.12, 0.12], along, INK.red, INK.red, M.red);
    const pyramid = r() < 0.65;
    roof(mesh, P, fx, fz, { ex: s + 0.95, ez: d + 0.95, rz: 0, y0: Hc + 0.05, rise: ramp(r, 1.5, 2), gx: pyramid ? 0 : s * 0.4, g: 1, sweep: 1.1, spire: 1 });
    return;
  }
  if (kind === 'pagoda') {
    // a pagoda: tiers, each a little narrower, white walls with a dark door, under a skirt of tiles; the last under a pyramid and a tall spire
    const tiers = 3 + Math.floor(r() * 3);
    let y = 0, S = Math.min(t.tw, T) - 0.7;
    for (let i = 0; i < tiers; i++) {
      const h = i === 0 ? 2.4 : 1.45, s = S * (1 - 0.13 * i);
      mesh.box(P(0, y + h / 2, 0), [s, h / 2, s], along, INK.wall, INK.wall, M.wall);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) mesh.tube(P(sx * s, y, sz * s), P(sx * s, y + h, sz * s), 0.09, 0.08, INK.red, M.red, 6);
      mesh.box(P(0, y + Math.min(1.1, h * 0.42), s + 0.01), [Math.min(0.5, s * 0.35), Math.min(1.1, h * 0.42), 0.05], along, INK.dark, INK.dark, M.dark);
      if (i === 0) mesh.box(P(0, 0.28, 0), [s + 0.04, 0.28, s + 0.04], along, stone, INK.stone, M.stone);
      const last = i === tiers - 1;
      roof(mesh, P, fx, fz, { ex: s + 0.75, ez: s + 0.75, rz: 0, y0: y + h + 0.05, rise: last ? 1.3 : 0.8, gx: 0, g: 1, sweep: 0.55, spire: last ? 2.4 : 0.01 });
      y += h + 0.25;
    }
    return;
  }

  // a hall (or a gate, or a shrine): its walls, white on a plinth of grey stone; columns across its porch and at its corners
  const small = kind === 'shrine';
  const n = small ? 2 : t.bays + 1;
  const W = t.tw - (small ? 0.7 : 1.5), wd = small ? 1.0 : ramp(r, 1.4, 1.6), Hw = small ? 2.3 : 3.0;
  const wz = small ? -0.3 : -0.25, zf = wz + wd, zc = zf + (small ? 0.35 : 0.5);
  mesh.box(P(0, Hw / 2, wz), [W, Hw / 2, wd], along, INK.wall, INK.wall, M.wall);
  mesh.box(P(0, 0.28, wz), [W + 0.04, 0.28, wd + 0.04], along, stone, INK.stone, M.stone);
  const colX = (i: number) => n === 2 ? (i ? 1 : -1) * (W - 0.25) : -W + 0.3 + (i / (n - 1)) * (2 * W - 0.6);
  for (let i = 0; i < n; i++) column(colX(i), zc, Hw);
  for (const sx of [-1, 1]) column(sx * (W + 0.06), wz - wd - 0.06, Hw, 0.15);
  // a beam over the porch; under it, between the columns, painted panels; over it a row of brackets, all round
  mesh.box(P(0, Hw - 0.15, zc), [W + 0.1, 0.15, 0.16], along, INK.red, INK.red, M.red);
  const mid = Math.floor((n - 1) / 2);
  for (let i = 0; i + 1 < n; i++) {
    const x0 = colX(i), x1 = colX(i + 1), mx = (x0 + x1) / 2, hw = (x1 - x0) / 2 - 0.16;
    if (i === mid && !small) continue;
    mesh.box(P(mx, Hw - 0.48, zc + 0.02), [hw, 0.17, 0.05], along, INK.red, INK.red, M.red);
    mesh.box(P(mx, Hw - 0.48, zc + 0.06), [hw - 0.06, 0.12, 0.03], along, INK.tile, INK.tile, M.red);
    mesh.box(P(mx, Hw - 0.48, zc + 0.08), [hw * 0.55, 0.07, 0.03], along, blue, blue, M.red);
  }
  for (let x = -W + 0.2; x <= W - 0.15; x += 0.42) for (const z of [zc + 0.05, wz - wd - 0.05]) mesh.box(P(x, Hw + 0.1, z), [0.12, 0.1, 0.22], along, INK.tileDark, INK.tile, M.ridge);
  // the doors (front, and a gate's back): red, open, the dark within; lattice windows in the bays either side
  const doors: Array<[number, number]> = gate ? [[zf, 1], [wz - wd, -1]] : [[zf, 1]];
  const dw = small ? 0.55 : 0.95;
  for (const [z, sgn] of doors) {
    mesh.box(P(0, Hw * 0.4, z + 0.02 * sgn), [dw, Hw * 0.4, 0.06], along, INK.red, INK.red, M.red);
    mesh.box(P(0, Hw * 0.37, z + 0.05 * sgn), [dw - 0.2, Hw * 0.37, 0.06], along, INK.dark, INK.dark, M.dark);
  }
  if (!small) for (let i = 0; i + 1 < n; i++) {
    if (i === mid) continue;
    const x = (colX(i) + colX(i + 1)) / 2, hw = Math.min(0.62, (colX(i + 1) - colX(i)) / 2 - 0.25);
    mesh.box(P(x, 1.45, zf + 0.02), [hw, 0.62, 0.05], along, INK.red, INK.red, M.red);
    mesh.box(P(x, 1.45, zf + 0.04), [hw - 0.12, 0.5, 0.05], along, INK.dark, INK.dark, M.dark);
    for (let k = -2; k <= 2; k++) mesh.box(P(x + k * (hw - 0.12) / 2.5, 1.45, zf + 0.09), [0.018, 0.5, 0.02], along, INK.red, INK.red, M.red);
    for (let k = -2; k <= 2; k++) mesh.box(P(x, 1.45 + k * 0.17, zf + 0.09), [hw - 0.12, 0.018, 0.02], along, INK.red, INK.red, M.red);
  }
  plaque(small ? 0.55 : Math.min(0.95, (colX(mid + 1) - colX(mid)) / 2 - 0.12), Hw - (small ? 0.85 : 1.2), zc + 0.1);
  // the roof: double eaves (a skirt of tiles all round, and an upper storey under its own roof), or single
  const ex = W + (small ? 0.85 : 1.15), ez = zc + (small ? 0.75 : 0.95) - (small ? -0.3 : 0), rzc = small ? -0.3 + (zc - wz) * 0 : 0;
  if (t.double) {
    roof(mesh, P, fx, fz, { ex, ez: zc + 0.95, rz: 0, y0: Hw + 0.25, rise: 0.95, gx: W * 0.6, g: 1, sweep: 0.6 });
    const H2 = 1.5, W2 = W * 0.74, D2 = wd * 0.78;
    mesh.box(P(0, Hw + 0.2 + H2 / 2, wz), [W2, H2 / 2, D2], along, INK.wall, INK.wall, M.wall);
    for (let x = -W2; x <= W2 + 1e-3; x += (2 * W2) / Math.max(1, n - 2)) mesh.tube(P(x, Hw + 0.2, wz + D2 + 0.02), P(x, Hw + 0.2 + H2, wz + D2 + 0.02), 0.1, 0.09, INK.red, M.red, 6);
    roof(mesh, P, fx, fz, { ex: W2 + 1.0, ez: D2 + 1.0, rz: wz, y0: Hw + 0.2 + H2 + 0.15, rise: 1.9, gx: W2 * 0.72, g: t.hip ? 1 : 0.5, sweep: 0.95 });
  } else roof(mesh, P, fx, fz, { ex, ez: small ? ez : zc + 0.95, rz: small ? rzc : 0, y0: Hw + 0.25, rise: small ? 1.5 : 2.2, gx: W * 0.72, g: t.hip ? 1 : 0.5, sweep: small ? 0.7 : 0.95 });
  // white walls out to each side, their tops tiled: long, across the hill, for a gate; short, now and then, for a hall
  const wl = gate ? 4.6 : t.wings ? 1.6 : 0, wx = gate ? W + 1.2 + wl : tw + wl;
  if (wl) for (const sx of [-1, 1]) {
    mesh.box(P(sx * wx, 0.35, wz), [wl, 1.85, 0.24], along, INK.wall, INK.wall, M.wall);
    mesh.box(P(sx * wx, -0.9, wz), [wl + 0.02, 1.3, 0.26], along, stone, INK.stone, M.stone);
    mesh.box(P(sx * wx, 2.32, wz), [wl + 0.15, 0.13, 0.45], along, INK.tile, INK.tileDark, M.tile);
    mesh.box(P(sx * wx, 2.5, wz), [wl, 0.07, 0.08], along, INK.tileDark, INK.tileDark, M.ridge);
  }
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
