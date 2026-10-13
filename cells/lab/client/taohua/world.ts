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
import { clearOfDeer, deerNear } from './herds';
import { obstacleMarks, postReflection, ribbon, riverMarks, streamMarks } from './marks';
import { wayMarks, type WayKind } from './pathmarks';
import { RISE, TERRACE_OF, WIDTH, Ways, type Junction, type V3, type Way } from './ways';
import { RIVER_L, RIVER_NEAR, type Water } from './water';

/** how deep a tile of the hill is, up it (m), and how wide, across it: the world is made a tile at a time, about the walker, as far across as the ways go */
export const BAND = 12, TILE = 16;
/** a vertex: position, normal, colour, material */
export const STRIDE = 10;
/** the way the eye looks, on the whole (down the hill's slope from above and below it): for setting things behind one another as it sees them */
const VIEW: V3 = (() => { const p = 0.76; return [0, -Math.sin(p), Math.cos(p)]; })();
/** materials: what the drawing does with each */
export const M = { ground: 0, step: 1, stone: 2, rock: 3, trunk: 4, tile: 5, red: 6, wall: 7, robe: 8, hat: 9, petal: 10, blossom: 11, plaque: 12, twig: 13, dark: 14, skin: 15, ridge: 16, grass: 17, earth: 18, shade: 19, type: 20, water: 21, ripple: 22, reflect: 23, reflectPink: 24, ring: 25, eddy: 26, archReflect: 27, deer: 28, mark: 29, stroke: 30 } as const;

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
  /** what stands in the walker's way, off the ways, as circles (x, z, radius): rocks, a cast's sheet, its cairn or shrine */
  blocks: Float32Array;
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
  /**
   * a tapered tube from a to b, so many sides. A limb's (trunk or twig) is part of a stroke, as a brush
   * draws a branch from where it leaves its parent to its tip: `st` says which stroke, how far along it
   * this piece starts, its class (0 trunk, 1 limb, 2 branch, 3 twig, 4 root) and how long the whole stroke is;
   * each vertex carries them in place of a colour (which stroke; how far along it; class × 10 + its
   * length), for the drawing. Returns how far along the stroke its end is.
   */
  tube(a: V3, b: V3, ra: number, rb: number, col: C3, m: number, sides = 6, st?: { id: number; s: number; cls: number; L: number }): number {
    const d = norm(sub(b, a)), len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // (a limb's segments overlap a little at their joints, so a turn shows no seam)
    const limb = m === M.trunk || m === M.twig;
    if (limb) { a = sub(a, mul(d, ra * 0.35)); b = add(b, mul(d, rb * 0.35)); }
    const s0 = st ? st.s : 0, sa = limb ? s0 - ra * 0.35 : 0, sb = limb ? s0 + len + rb * 0.35 : 0;
    const id = st ? st.id : 0, code = st ? st.cls * 10 + Math.min(9.9, st.L) : 2 * 10 + 9.9;
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref)), w = cross(d, u), v = this.v;
    // (round, not faceted: each vertex its own normal, out from the axis)
    const P = (p: V3, o: V3, r: number, sv: number) => limb
      ? v.vert(p[0] + o[0] * r, p[1] + o[1] * r, p[2] + o[2] * r, o[0], o[1], o[2], id, sv, code, m)
      : v.vert(p[0] + o[0] * r, p[1] + o[1] * r, p[2] + o[2] * r, o[0], o[1], o[2], col[0], col[1], col[2], m);
    for (let k = 0; k < sides; k++) {
      const t0 = (k / sides) * Math.PI * 2, t1 = ((k + 1) / sides) * Math.PI * 2;
      const o0: V3 = add(mul(u, Math.cos(t0)), mul(w, Math.sin(t0))), o1: V3 = add(mul(u, Math.cos(t1)), mul(w, Math.sin(t1)));
      P(a, o0, ra, sa); P(b, o0, rb, sb); P(b, o1, rb, sb);
      P(a, o0, ra, sa); P(b, o1, rb, sb); P(a, o1, ra, sa);
    }
    return s0 + len;
  }
}
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

// ─── the ways' kinds, stretch by stretch ─────────────────────────────────────────────────────────
export type StairKind = 'slab' | 'rock' | 'timber';
export type TrailKind = 'trail' | 'stepping' | 'flags';
/** how far along a way it is to a building's terrace at either end (Infinity if neither has one) */
const toBuilding = (w: Way, u: number) => Math.min(w.to.reach || w.to.gate ? w.len - u : Infinity, w.from.gate ? u : Infinity);
/**
 * What a stair's made of: most often pale slabs; now and then steps cut in the black rock (where it
 * climbs through an outcrop), or earth steps held by logs (on a wilder stretch). Before a temple, slabs.
 */
export function stairKind(seed: number, w: Way, si: number): StairKind {
  const st = w.stairs[si];
  if (toBuilding(w, st.u1) < 18 || toBuilding(w, st.u0) < 18) return 'slab';
  const r = seeded(hash(seed, w.n, si, 0x57a1))();
  return r < 0.2 ? 'rock' : r < 0.36 ? 'timber' : 'slab';
}
/**
 * What a gentle stretch of a way is (between its stairs): most often a worn earth trail, a few flat
 * stones in it; now and then stepping stones through the grass; and coming to a temple, paving of
 * flags, laid in a cracked-ice pattern (冰裂纹).
 */
export function trailKind(seed: number, w: Way, u: number): TrailKind {
  if (toBuilding(w, u) < 16) return 'flags';
  let seg = 0, a = 0, b = w.len;
  for (const st of w.stairs) { if (st.u1 <= u) { seg++; a = st.u1; } else if (st.u0 > u) { b = Math.min(b, st.u0); } }
  if (b - a < 5) return 'trail';
  return seeded(hash(seed, w.n, seg, 0x9e17))() < 0.28 ? 'stepping' : 'trail';
}

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
  const nat = ways.hill(z) + k * 0.18 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.53 - x * 0.2) - 0.04;
  // (a way's bench, cut into the hill: across the way and a little either side of it, level with the
  // way's middle there; then, uphill of it, a cut bank rising quickly to the hill, and downhill, a fill
  // slope falling more gently to it; the bench's edge and the banks' widths ragged along the way)
  const level = ways.hill(nr.p[2]) - 0.04 - under;
  const diff = nat - level;
  const rag = noise1(nr.w.n * 977 + 5, nr.u * 0.6);
  const bench = WIDTH / 2 + 0.12 + 0.25 * rag;
  const bank = diff > 0 ? 0.3 + Math.abs(diff) * (0.7 + 0.5 * rag) : 0.55 + Math.abs(diff) * (1.5 + 0.6 * rag);
  const f = smooth(bench, bench + bank, nr.d);
  const g = level + diff * f;
  return ways.water.bed(x, z, g);
}

/**
 * A way's cross-section to one side (sd, ±1, across it), so far along it, as groundCut makes it: how
 * far out its bench's edge is, how far out its bank ends (where it meets the hill), and how high the
 * bank stands there (above the bench: a cut; below it: a fill).
 */
export function bankAt(ways: Ways, w: Way, u: number, sd: number): { bench: number; top: number; diff: number } {
  const m = ways.at(w, u, true);
  const level = m.p[1] - 0.04 - (ways.stairAt(w, u) ? 0.34 : 0.08);
  const rag = noise1(w.n * 977 + 5, u * 0.6);
  const bench = WIDTH / 2 + 0.12 + 0.25 * rag;
  const nat = (d: number) => {
    const x = m.p[0] + m.dir[1] * d * sd, z = m.p[2] - m.dir[0] * d * sd, k = smooth(1.3, 3.4, d);
    return ways.hill(z) + k * 0.18 * Math.sin(x * 0.7 + z * 0.3) * Math.sin(z * 0.53 - x * 0.2) - 0.04;
  };
  let top = bench + 1, diff = 0;
  for (let i = 0; i < 2; i++) {
    diff = nat(top) - level;
    top = bench + (diff > 0 ? 0.3 + Math.abs(diff) * (0.7 + 0.5 * rag) : 0.55 + Math.abs(diff) * (1.5 + 0.6 * rag));
  }
  return { bench, top, diff };
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
/**
 * The journey's movements: the hill, stretch by stretch up it (some hundred and seventy metres each),
 * is given a character, so that a walk up it is a succession of pictures and not one picture again
 * and again: a dense grove; an orchard (as the hill is most often); open hillside, a few trees; a lone
 * tree or two on open paper, drawn the more fully for it; or a garden of standing stones. Each eases
 * into the next over its last thirty metres.
 */
export type Movement = 'grove' | 'orchard' | 'open' | 'lone' | 'stones';
const MOVE = 170;
export function movementOf(seed: number, b: number): Movement {
  if (b <= 0) return 'orchard';
  const v = seeded(hash(seed, b, 0x30fe))();
  return v < 0.28 ? 'grove' : v < 0.56 ? 'orchard' : v < 0.72 ? 'open' : v < 0.88 ? 'lone' : 'stones';
}
const DENSITY: Record<Movement, number> = { grove: 1.25, orchard: 1, open: 0.38, lone: 0.12, stones: 0.5 };
/** how thick the trees stand, as the journey's movement has it there (eased between movements) */
export function movementDensity(seed: number, z: number): number {
  const b = Math.floor(z / MOVE), f = smooth(MOVE - 30, MOVE, z - b * MOVE);
  return DENSITY[movementOf(seed, b)] * (1 - f) + DENSITY[movementOf(seed, b + 1)] * f;
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
  return Math.min(0.98, (0.7 + 0.29 * mass) * (1 - open) * movementDensity(seed, z));
}

/** Tile (i, j) of the hill: i across it, j up it. */
/** the water bench (bench.ts): no trees, nothing but the hill, its water and its rocks */
let BENCH = false;
export const setBench = (on: boolean) => { BENCH = on; };
/**
 * Reflections are the drawing's (see render.ts: what stands over the water, found and drawn there in
 * level bars), not laid on the water by hand; `?refl=old` brings back the old, hand-laid ones, to compare.
 */
export let OLD_REFL = false;
export const setOldRefl = (on: boolean) => { OLD_REFL = on; };
/** the tree bench's trees, set out as given (see bench.ts) */
let SPECIMENS: Array<{ x: number; z: number; seed: number; iso: number; rocks?: boolean }> = [];
export const setSpecimens = (s: typeof SPECIMENS) => { SPECIMENS = s; };
/** (as a tile's made, what's set in it that the walker can't walk through) */
let blocking: number[] | null = null;
const block = (x: number, z: number, r: number) => { blocking?.push(x, z, r); };
export function makeBand(ways: Ways, seed: number, i: number, j: number): Band {
  blocking = [];
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
  // (those whose spaces reach this tile, kept open across it: a space reaches some fourteen metres down the hill from its middle, and a few up)
  const sts = stationsNear(ways, seed, z0 - 8, z1 + 16);
  // (and the deer's places: no tree or rock where a deer stands, nor its crown just before it)
  const herds = deerNear(ways, seed, z0 - 10, z1 + 10);
  // (a crown spreads four metres and more from its trunk: so the trunks stand that far back from the sheet's sides)
  const lands = landingsOf(ways, seed);
  const treeOut = (x: number, z: number) => nearLanding(lands, x, z) < 2.8 || inStation(sts, x, z, 4.2, 4.5) || !clearOfDeer(herds, x, z, 3) || [2, 4, 6, 8].some((dz) => !clearOfDeer(herds, x, z + dz, 3.2));
  /** whether (x, z) is just downhill of a way, where a crown would stand between the eye and it */
  const belowWay = (x: number, z: number) => [2, 3.8, 5.6, 7.2].some((dz) => ways.nearest(x, z + dz).d < WIDTH / 2 + 1);

  // the ground: a sheet across the hill, the paper's cream
  const nx = TILE / 1.5, nz = BAND / 1.5;
  // (each corner: where it is, and how near the path, for the brush strokes along it)
  const gv = new Map<string, number[]>();
  const GV = (x: number, z: number) => {
    const key = `${x},${z}`;
    let v = gv.get(key);
    if (!v) { const nr = ways.nearest(x, z); const worn = ways.stairAt(nr.w, nr.u) || trailKind(seed, nr.w, nr.u) !== 'trail' ? 0 : 1 - smooth(0.5, 1.6, nr.d); v = [x, ground(ways, x, z), z, 0, 1, 0, worn, 0, 0, M.ground]; gv.set(key, v); }
    return v;
  };
  // (by water, finer, so its banks are drawn true; each corner carries how deep it's cut into the
  // hill for the water: where deep, the drawing makes it rock)
  const cutAt = new Map<string, number>();
  const GW = (x: number, z: number) => {
    const key = `${x},${z}`;
    let v = gv.get(key);
    if (!v) {
      const nr = ways.nearest(x, z), worn = ways.stairAt(nr.w, nr.u) || trailKind(seed, nr.w, nr.u) !== 'trail' ? 0 : 1 - smooth(0.5, 1.3 + 0.9 * noise1(nr.w.n * 31, nr.u * 0.5), nr.d), gc = groundCut(ways, x, z);
      // (beside a way, its banks are hatched by marks of their own (pathmarks.ts), not by the drawing: so marked, -1)
      const byWay = ways.dryOf(x, z) > 2.5 ? -(1 - smooth(4.2, 5, nr.d)) : 0;
      v = [x, gc.y, z, 0, 1, 0, worn, gc.cut, byWay, M.ground]; gv.set(key, v); cutAt.set(key, gc.cut);
    }
    return v;
  };
  for (let i = 0; i < Math.round(nx); i++) for (let k = 0; k < nz; k++) {
    const xa = x0 + i * 1.5, xb = xa + 1.5, za = z0 + k * 1.5, zb = za + 1.5;
    // (finer near a way, where its banks are, and by water)
    if (ways.dryOf(xa + 0.75, za + 0.75) > 3.5 && ways.nearest(xa + 0.75, za + 0.75).d > WIDTH / 2 + 3.2) {
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
  // the jetty where the journey starts, out from the river's near bank below the first way (see `jetty`)
  if (z0 < JETTY.z1 + 1 && z1 > JETTY.z0 - 2 && x0 < 3 && x1 > -3) jetty(mesh, ways, seed, inT);
  // the other landings along the river (see `landingsOf`)
  for (const l of lands) if (l.kind !== 'jetty') landing(mesh, petals, puffs, ways, seed, l, inT);

  // the ways: on their steep stretches, steps, each a slab of its own, laid on the hill, its ends
  // ragged (no two the same length, nor quite in line), turning as the way bends; on their gentle
  // stretches, only a few flat stones here and there, and a worn line (in the drawing)
  const near = ways.waysNear(z0 - 3, z1 + 3).filter((w) => w.box[1] > x0 - 4 && w.box[0] < x1 + 4);
  const onTerrace = (x: number, z: number) => temples.some((t) => templeSurface(t, x, z) !== null);
  for (const w of near) {
    const wh = hash(seed, w.n, 0x5a);
    for (const [si, st] of w.stairs.entries()) {
      const du = (st.u1 - st.u0) / st.n, sk = stairKind(seed, w, si);
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
        const P = (u: number, v: number, y: number): V3 => [cc[0] + dir[0] * u + dir[1] * v, y, cc[2] + dir[1] * u - dir[0] * v];
        // (a slab, or a piece of one, from va to vb across the way; its top so high, tipped a little across)
        const slab = (va: number, vb: number, y: number, tip: number) => slabIn(va, vb, y, INK.stepTop, INK.stepFace, M.step, tip);
        const slabIn = (va: number, vb: number, y: number, topC: C3, faceC: C3, mat: number, tip = 0) => {
          const corners: Array<[number, number]> = [
            [-hx + cut(), va], [hx - cut(), va + sr() * 0.04],
            [hx, va + cut()], [hx, vb - cut()],
            [hx - cut(), vb], [-hx + cut(), vb - sr() * 0.04],
            [-hx, vb - cut()], [-hx, va + cut()],
          ];
          const Y = (v: number) => y + tip * (v - (va + vb) / 2);
          const centre = P(0, (va + vb) / 2, y);
          for (let n = 0; n < corners.length; n++) {
            const a = corners[n], b = corners[(n + 1) % corners.length];
            const pa = P(a[0], a[1], Y(a[1])), pb = P(b[0], b[1], Y(b[1]));
            mesh.tri(centre, pb, pa, topC, mat, [0, 1, 0]);
            mesh.quad(P(a[0], a[1], y - 0.6), P(b[0], b[1], y - 0.6), pb, pa, faceC, mat);
          }
        };
        // (weathered, now and then: cracked across, in two; sunk a little and tipped; or an end broken
        // off, the piece lying by it)
        if (sk === 'rock') {
          // (cut in the black rock: each step a block of it, its top worn grey; the outcrop it's cut
          // through standing either side, now and then)
          slabIn(-half, half, top, INK.rockTop, INK.rock, M.rock);
          for (const sd of [-1, 1]) if (sr() < 0.45) { const pp = P(ramp(sr, -hx, hx), sd * (half + ramp(sr, 0.35, 0.7)), 0); if (!onTerrace(pp[0], pp[2])) rock(mesh, [pp[0], ground(ways, pp[0], pp[2]), pp[2]], ramp(sr, 0.5, 0.95), sr, (x, z) => ground(ways, x, z)); }
          continue;
        }
        if (sk === 'timber') {
          // (earth steps, each held at its front by a log laid across, pegged at its ends)
          mesh.box(P(0, 0, top - 0.3), [hx, 0.3, half - 0.05], dir, INK.paper, INK.stepFace, M.earth, M.stone);
          mesh.tube(P(-hx + 0.03, -half - 0.08, top - 0.02), P(-hx + 0.03, half + 0.08, top - 0.02), 0.075, 0.07, INK.trunk, M.trunk, 6);
          for (const sd of [-1, 1]) mesh.tube(P(-hx - 0.06, sd * (half + 0.12), top - 0.3), P(-hx - 0.06, sd * (half + 0.12), top + 0.07), 0.035, 0.03, INK.trunk, M.trunk, 5);
          if (sr() < 0.35) tuftAt(mesh, P(hx - 0.05, ramp(sr, -half, half) * 0.8, top), sr, 3, 0.7);
          continue;
        }
        const wear = sr();
        if (wear < 0.1) { const c = ramp(sr, -0.3, 0.3) * half; slab(-half, c - 0.025, top, 0); slab(c + 0.025, half, top - 0.02, ramp(sr, -0.02, 0.02)); }
        else if (wear < 0.17) slab(-half, half, top - 0.03, ramp(sr, -0.03, 0.03));
        else if (wear < 0.26) {
          const end = sr() < 0.5 ? -1 : 1, lost = ramp(sr, 0.25, 0.42);
          if (end < 0) slab(-half + lost, half, top, 0); else slab(-half, half - lost, top, 0);
          const lx = cc[0] + dir[1] * end * (half + 0.25), lz = cc[2] - dir[0] * end * (half + 0.25);
          stone(mesh, ways, lx + ramp(sr, -0.15, 0.15), lz + ramp(sr, -0.15, 0.15), ramp(sr, 0.13, 0.2), sr);
        } else slab(-half, half, top, 0);
        // (moss and grass in the joint at the back of the tread, where the next step rises; and the
        // fallen petals drifted against the riser there)
        if (k < st.n - 1) {
          for (const sd of [-1, 1]) if (sr() < 0.3) { const v = sd * (half - ramp(sr, 0.05, 0.25)); tuftAt(mesh, P(hx - 0.05, v, top), sr, 2 + Math.floor(sr() * 3), 0.6); }
          if (sr() < 0.4) for (let q = 0, nq = 2 + Math.floor(sr() * 4); q < nq; q++) {
            const pp = P(hx - ramp(sr, 0.02, 0.12), ramp(sr, -half, half) * (sr() < 0.6 ? 0.9 : 0.4), top + 0.012);
            petals.push(pp[0], pp[1], pp[2], ramp(sr, 0.04, 0.08), sr() * Math.PI, sr() * 0.5);
          }
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
    // (its gentle stretches, each of its kind: a trail, a few flat stones in it; stepping stones in
    // the grass, a stride apart; or, coming to a temple, flags in a cracked-ice pattern, kerbed)
    const tr = seeded(hash(wh, 0x5e7));
    const wet = (u: number) => !!w.cross && u > w.cross.u0 - 0.5 && u < w.cross.u1 + 0.5;
    for (let u = ramp(tr, 0.2, 0.8); u < w.len; u += ramp(tr, 0.6, 1.8)) {
      if (ways.stairAt(w, u) || wet(u) || trailKind(seed, w, u) !== 'trail' || tr() < 0.45) continue;
      const m = ways.at(w, u, true), off = ramp(tr, -0.45, 0.45);
      const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
      if (!inT(x, z) || onTerrace(x, z)) continue;
      stone(mesh, ways, x, z, ramp(tr, 0.16, 0.34), tr);
    }
    for (let u = ramp(tr, 0.1, 0.4), side = 1; u < w.len; u += ramp(tr, 0.6, 0.74), side = -side) {
      if (ways.stairAt(w, u) || wet(u) || trailKind(seed, w, u) !== 'stepping') continue;
      const m = ways.at(w, u, true), off = side * ramp(tr, 0.05, 0.22);
      const x = m.p[0] + m.dir[1] * off, z = m.p[2] - m.dir[0] * off;
      if (!inT(x, z) || onTerrace(x, z)) continue;
      stone(mesh, ways, x, z, ramp(tr, 0.24, 0.33), tr);
      if (tr() < 0.6) tuft(mesh, ways, x - m.dir[1] * off * 2.5, z + m.dir[0] * off * 2.5, tr, 3 + Math.floor(tr() * 3));
    }
    const flagged: Array<[number, number]> = [];
    for (let u = 0.2; u < w.len; u += 0.4) {
      if (ways.stairAt(w, u) || wet(u) || trailKind(seed, w, u) !== 'flags') continue;
      const m = ways.at(w, u, true);
      for (let a = -1; a <= 1; a += 0.5) { const v = a * (WIDTH / 2 - 0.12) + ramp(tr, -0.06, 0.06); flagged.push([m.p[0] + m.dir[1] * v + ramp(tr, -0.07, 0.07), m.p[2] - m.dir[0] * v + ramp(tr, -0.07, 0.07)]); }
      // (its kerbs: long stones set along either edge)
      if (Math.round(u / 0.4) % 2 === 0) for (const sd of [-1, 1]) {
        const v = sd * (WIDTH / 2 + 0.06), x = m.p[0] + m.dir[1] * v, z = m.p[2] - m.dir[0] * v;
        if (inT(x, z) && !onTerrace(x, z)) mesh.box([x, ground(ways, x, z) + 0.03, z], [0.38, 0.07, 0.07], m.dir, INK.stepTop, INK.stepFace, M.stone);
      }
    }
    pave(mesh, ways, flagged.filter(([x, z]) => inT(x, z) && !onTerrace(x, z)), 0.24, tr);
  }

  // landings: at the head of a stair now and then, a broader place, paved, to stand and look; by it, a
  // stone lantern, a bench, or a cairn
  for (const w of near) for (const [si, st] of w.stairs.entries()) {
    const lr = seeded(hash(seed, w.n, si, 0x1a9d));
    if (lr() > 0.45 || st.u1 > w.len - 4 || toBuilding(w, st.u1) < 14) continue;
    const u = Math.min(w.len - 1, st.u1 + 0.9), m = ways.at(w, u, true);
    if (!inT(m.p[0], m.p[2]) || onTerrace(m.p[0], m.p[2]) || ways.dryOf(m.p[0], m.p[2]) < 3 || inStation(sts, m.p[0], m.p[2], 1.5)) continue;
    const side = lr() < 0.5 ? -1 : 1, pts: Array<[number, number]> = [];
    for (let a = -1.1; a <= 1.1; a += 0.42) for (let b = -1; b <= 1; b += 0.42) {
      if (Math.hypot(a / 1.2, b / 1.05) > 1) continue;
      const v = b * (WIDTH / 2 + 0.75) + side * 0.35;
      pts.push([m.p[0] + m.dir[0] * a + m.dir[1] * v + ramp(lr, -0.06, 0.06), m.p[2] + m.dir[1] * a - m.dir[0] * v + ramp(lr, -0.06, 0.06)]);
    }
    pave(mesh, ways, pts.filter(([x, z]) => !ways.stairAt(ways.nearest(x, z).w, ways.nearest(x, z).u)), 0.25, lr);
    const fx = m.p[0] + m.dir[1] * side * (WIDTH / 2 + 1.25), fz = m.p[2] - m.dir[0] * side * (WIDTH / 2 + 1.25);
    if (ways.nearest(fx, fz).d < WIDTH / 2 + 0.6 || onTemple(fx, fz, 0.3)) continue;
    const pick = lr(), fy = ground(ways, fx, fz);
    block(fx, fz, 0.55);
    if (pick < 0.45) lantern(mesh, [fx, fy, fz], [-m.dir[1] * side, m.dir[0] * side], lr);
    else if (pick < 0.75) { // (a bench: a slab on two stones)
      for (const e of [-0.42, 0.42]) mesh.box([fx + m.dir[0] * e, fy + 0.2, fz + m.dir[1] * e], [0.1, 0.2, 0.17], m.dir, INK.stepFace, INK.stepFace, M.stone);
      mesh.box([fx, fy + 0.44, fz], [0.62, 0.05, 0.22], m.dir, INK.stepTop, INK.stepFace, M.stone);
    } else { // (a cairn)
      let hh = fy - 0.04, s0 = ramp(lr, 0.3, 0.42);
      for (let q = 0, nq = 4 + Math.floor(lr() * 3); q < nq; q++) { const sx = s0 * (1 - q * 0.14), th = ramp(lr, 0.07, 0.12), aa = lr() * 3; mesh.box([fx, hh + th, fz], [sx, th, sx * 0.75], [Math.cos(aa), Math.sin(aa)], INK.rockTop, INK.rock, M.rock); hh += th * 2; }
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
  const mvHere = movementOf(seed, Math.floor((z0 + z1) / 2 / MOVE));
  for (let i = 0; i < (BENCH ? 0 : mvHere === 'stones' ? 7 : mvHere === 'open' ? 3 : 2); i++) {
    const x = ramp(r, x0, x1), z = ramp(r, z0, z1);
    if (ways.nearest(x, z).d < WIDTH / 2 + 0.8) continue;
    rocks.push([x, z, ramp(r, 0.4, 0.95)]);
  }
  for (const [x, z, sz] of rocks) {
    if (ways.dryOf(x, z) < 0.1 || !clearOfDeer(herds, x, z, 1.4) || nearLanding(lands, x, z) < 1.6) continue;
    if (ways.nearest(x, z).d < WIDTH / 2 + 0.35 || onTemple(x, z, 0.3) || inStation(sts, x, z, 0.4)) continue;
    const rr = seeded(hash(Math.round(x * 10), Math.round(z * 10), seed));
    rock(mesh, [x, gy(x, z), z], sz, rr, gy);
    shade(mesh, ways, x - 0.9 * sz, z + 0.15 * sz, sz * 2.2, sz * 0.8, 0.3);
    for (let k = 0, n = 1 + Math.floor(rr() * 3); k < n; k++) { const a = rr() * 6.3, d = sz * ramp(rr, 1, 1.5); tuft(mesh, ways, x + Math.cos(a) * d, z + Math.sin(a) * d, rr, 3 + Math.floor(rr() * 4)); }
  }
  // the fringe of each way: from its edge out, loose pebbles, tufts and drifted petals, thinning
  // away into the open hill, so a way meets the hill by degrees, not at a line; by a stair, a few
  // stones spilt from it, half sunk in the bank
  for (const w of near) {
    const fr = seeded(hash(seed, w.n, 0xf1e9e));
    for (let u = ramp(fr, 0, 0.4); u < w.len; u += ramp(fr, 0.18, 0.5)) {
      const m = ways.at(w, u, true), stair = !!ways.stairAt(w, u), sd = fr() < 0.5 ? 1 : -1;
      const out = -Math.log(1 - fr() * 0.97) * 0.75;
      // (fewer the further out, and in loose groups along the way)
      if (fr() > Math.exp(-out / 0.9) * (0.55 + 0.45 * noise1(w.n * 13 + sd, u * 0.35))) continue;
      const off = (WIDTH / 2 + 0.05 + out) * sd, x = m.p[0] + m.dir[1] * off + ramp(fr, -0.2, 0.2), z = m.p[2] - m.dir[0] * off + ramp(fr, -0.2, 0.2);
      if (!inT(x, z) || onTemple(x, z, 0.2) || ways.dryOf(x, z) < 0.3 || ways.nearest(x, z).d < WIDTH / 2 + 0.05) continue;
      const pick = fr();
      if (stair && out < 0.6 && pick < 0.35) stone(mesh, ways, x, z, ramp(fr, 0.14, 0.26), fr);
      else if (pick < 0.45) stone(mesh, ways, x, z, ramp(fr, 0.05, 0.12), fr);
      else if (pick < 0.8) tuft(mesh, ways, x, z, fr, 2 + Math.floor(fr() * 4));
      else petals.push(x, ground(ways, x, z) + 0.03, z, ramp(fr, 0.04, 0.08), fr() * Math.PI, fr() * 0.5);
    }
  }
  // the marks along each way: the top of its cut and strokes down the bank, its bed's edge, a trail's
  // wear and runnels, a tread's worn edge (see pathmarks.ts)
  {
    const yAt = new Map<string, number>();
    const Y = (x: number, z: number) => { const key = `${x},${z}`; let y = gv.get(key)?.[1] ?? yAt.get(key); if (y === undefined) { y = ground(ways, x, z); yAt.set(key, y); } return y; };
    // (the ground's height as the sheet draws it: across its triangles, coarse or fine as it's laid)
    const surf = (x: number, z: number) => {
      const xa = x0 + Math.floor((x - x0) / 1.5) * 1.5, za = z0 + Math.floor((z - z0) / 1.5) * 1.5;
      const S = ways.dryOf(xa + 0.75, za + 0.75) > 3.5 && ways.nearest(xa + 0.75, za + 0.75).d > WIDTH / 2 + 3.2 ? 1.5 : 0.5;
      const xs = xa + Math.floor((x - xa) / S) * S, zs = za + Math.floor((z - za) / S) * S, fx = (x - xs) / S, fz = (z - zs) / S;
      const y00 = Y(xs, zs), y11 = Y(xs + S, zs + S);
      return fz >= fx ? y00 + fz * (Y(xs, zs + S) - y00) + fx * (y11 - Y(xs, zs + S)) : y00 + fx * (Y(xs + S, zs) - y00) + fz * (y11 - Y(xs + S, zs));
    };
    const kind = (w: Way, u: number): WayKind => {
      if (w.cross && u > w.cross.u0 - 0.5 && u < w.cross.u1 + 0.5) return 'wet';
      const st = ways.stairAt(w, u);
      return st ? stairKind(seed, w, w.stairs.indexOf(st)) : trailKind(seed, w, u);
    };
    const own = (x: number, z: number) => inT(x, z) && !onTemple(x, z, 0.2) && !inStation(sts, x, z, 0);
    const push = (v: number[]) => { mesh.v.push(...v); };
    for (const w of near) wayMarks(push, { ways, seed, tile: [x0, x1, z0, z1], own, surf, bank: (ww, u, sd) => bankAt(ways, ww, u, sd), kind }, w, M.stroke);
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
      case 'Thunder': { // (one tree at its far side, leaning in toward it; well out to the side of the sheet, so its crown frames the words, not covers them)
        const [x, z] = R(away * ramp(sr, 2.5, 2.7), ramp(sr, 0.05, 0.4));
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
    const mv = movementOf(seed, Math.floor(o.cz / MOVE));
    if (BENCH || (lr() < 0.25 && mv !== 'lone')) continue;
    const x = o.cx + o.side * o.rx * ramp(lr, 0.25, 0.5), z = o.cz + o.rz * ramp(lr, -0.1, 0.35);
    if (!inT(x, z) || ways.nearest(x, z).d < WIDTH / 2 + 2.2 || belowWay(x, z) || onTemple(x, z, 1) || inGlade(x, z) || treeOut(x, z)) continue;
    // (alone in its clearing, it's drawn the more fully; the more so where the hill's open about it)
    tree(mesh, puffs, petals, [x, ground(ways, x, z), z], lr, ways, mv === 'lone' || mv === 'open' ? 1 : 0.6);
  }

  // trees: on a jittered grid, not on the path (though they lean over it), not on a temple's terrace
  const G = 3.9;
  for (let gx = Math.floor((x0 - G * 0.45) / G) * G; gx < x1 + G * 0.45; gx += G) for (let gz = Math.floor((z0 - G * 0.45) / G) * G; gz < z1 + G * 0.45; gz += G) {
    const tr = seeded(hash(seed, Math.round(gx * 10), Math.round(gz * 10), 0x7ee));
    const accept = tr();
    const x = gx + (tr() - 0.5) * G * 0.9, z = gz + (tr() - 0.5) * G * 0.9;
    // Ownership follows the final jittered position; neighbouring bands visit the same candidates.
    if (BENCH || !inT(x, z)) continue;
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
    // (a tree with few about it is drawn the more fully: its limbs seen, its twigs out past its crown)
    const dens = groveDensity(ways, seed, x, z);
    tree(mesh, puffs, petals, [x, ground(ways, x, z), z], tr, ways, Math.max(0, Math.min(1, (0.45 - dens) / 0.33)));
  }
  // (the tree bench's trees, each from its own seed; one with an outcrop behind it, as the hill's are)
  for (const sp of SPECIMENS) {
    if (!inT(sp.x, sp.z)) continue;
    const tr = seeded(hash(sp.seed, 0x7ee));
    if (sp.rocks) for (let k = 0; k < 3; k++) {
      const a = Math.PI / 2 + (k - 1) * 0.7, d = 1 + 0.3 * k, rx = sp.x + Math.cos(a) * d, rz = sp.z + Math.sin(a) * d, sz = k === 1 ? 0.9 : 0.6;
      rock(mesh, [rx, gy(rx, rz), rz], sz, seeded(hash(sp.seed, k)), gy);
      shade(mesh, ways, rx - 0.9 * sz, rz + 0.1, sz * 2.2, sz * 0.7, 0.28);
    }
    tree(mesh, puffs, petals, [sp.x, ground(ways, sp.x, sp.z), sp.z], tr, ways, sp.iso);
  }
  // (the blossom's reflection in still water)
  if (OLD_REFL && ways.water.streamsNear(z0, z1).length) blossomInWater(mesh, ways, puffs, hash(seed, i, j));

  // petals fallen on the path too
  for (let i = 0; i < (BENCH ? 0 : 36); i++) {
    const x = ramp(r, x0, x1), z = ramp(r, z0, z1);
    petals.push(x, restY(ways, x, z, 0.02), z, ramp(r, 0.04, 0.08), r() * Math.PI, r() * 0.5);
  }
  const blocks = new Float32Array(blocking); blocking = null;
  return { i, j, verts: mesh.v.out(), puffs: new Float32Array(puffs), petals: new Float32Array(petals), blocks, temples: temples.filter((t) => inT(t.c[0], t.c[2])).map((t) => ({ c: t.c, face: Math.atan2(t.face[0], t.face[1]), poem: t.name })) };
}

/**
 * A rock, as the print has them: a standing stone, a slab or a wedge on end, its faces flat (black
 * where they're turned from the light, charcoal where they're turned to it, grey on top, in the
 * drawing). Its foot a ring of four to six corners; partway up, a ring a little in and askew, so
 * its faces break; its top cut on a slant, sometimes to a ridge. Stood on the ground under each
 * corner, its foot sunk.
 */
function rock(mesh: Mesh, at: V3, size: number, r: Rand, gy?: (x: number, z: number) => number) {
  block(at[0], at[2], size * 1.1 + 0.25);
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

const WATER_KIND = { flow: 0, pool: 1, pond: 1, spring: 1, plunge: 1, marsh: 2, falls: 3, river: 1 } as const;
/**
 * The water in a tile: its surface (a fine sheet, at its level wherever it's within reach of the
 * water; the banks, carved, stand up through it at its edge; where its level drops from step to
 * step the sheet drops too, a fall); rocks along it; reeds in a marsh; petals afloat.
 * Each vertex carries, for the drawing, how far in from the edge it is, how far across from a stream's middle line, and what kind of water (and, after the point, how fast it runs).
 */
function water(mesh: Mesh, petals: number[], ways: Ways, seed: number, x0: number, x1: number, z0: number, z1: number) {
  const W = ways.water;
  const sts = W.streamsNear(z0, z1), river = W.riverNear(z0, z1);
  if (!sts.length && !river) return;
  const D = 0.5;
  const cache = new Map<number, number[] | null>();
  const at = (x: number, z: number) => {
    const key = Math.round(x * 4) * 100000 + Math.round(z * 4);
    if (cache.has(key)) return cache.get(key)!;
    const w = W.at(x, z);
    let v: number[] | null = null;
    if (w && w.s < 1.2) {
      // (foam: at the foot of a drop just above it, thinning out below; in fast water, a little)
      let foam = 0;
      for (const [dz, f] of [[0.6, 1], [1.2, 0.75], [2, 0.4]] as Array<[number, number]>) {
        const u = W.at(x, z + dz);
        if (u && u.s < 0.3 && u.L - w.L > 0.2 + 0.36 * dz) { foam = f; break; }
      }
      // (its edge is drawn where it's 0 m in from its edge (see the drawing); further out, the sheet's tucked under the ground)
      // (on the river, how fast it runs here, for the drawing: its reflections calm or broken)
      const run = w.kind === 'river' ? W.riverFlow(x, z)[2] * 0.3 : w.run;
      v = [x, w.s > 0.8 ? Math.min(w.L, ground(ways, x, z) - 0.03) : w.L, z, -w.s, w.across, WATER_KIND[w.kind] + Math.min(0.99, run), foam];
    }
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
      // (where it lies level, its normal's up, leaning by how much foam there is: for the drawing)
      for (const v of t) ny > 0.97 ? mesh.v.vert(v[0], v[1], v[2], v[6], 1, 0, v[3], v[4], v[5], M.water) : mesh.v.vert(v[0], v[1], v[2], nx, ny, nz, v[3], v[4], v[5], M.water);
    }
  }
  const inT = (x: number, z: number) => z >= z0 && z < z1 && x >= x0 && x < x1;
  const gy = (x: number, z: number) => ground(ways, x, z);
  const clearOfWays = (x: number, z: number, m: number) => ways.nearest(x, z).d > WIDTH / 2 + m;
  // (a rock by or in the water: and, if it stands in it, ripples about it; and where the water's still enough, its reflection)
  const stone = (x: number, z: number, size: number, r: Rand) => {
    // (one standing in the water stands up out of it: its foot a little under the water, not on the bed)
    const w = W.at(x, z);
    const foot = w && w.s < 0.3 ? (px: number, pz: number) => Math.max(gy(px, pz), w.L - size * 0.2) : gy;
    rock(mesh, [x, foot(x, z), z], size, r, foot);
    waterMarks(mesh, W, x, z, size, size * ramp(r, 1, 1.4));
    obstacleMarks(push, W, { x, z, r: size }, M.mark);
  };
  const push = (v: number[]) => { mesh.v.push(...v); };
  for (const st of sts) {
    const r = seeded(hash(seed, st.k, Math.floor(z0), Math.floor(x0), 0x40c4));
    // (rocks along its banks, and in it where it runs fast)
    for (let z = Math.max(z0, st.z0 - 2); z < Math.min(z1, st.z1 + 2); z += ramp(r, 1.2, 3)) {
      const xc = W.xAt(st, z), hw = W.halfAt(st, z), lv = W.levelAt(st, z), fast = lv.kind === 'flow' && ways.slope(z) > 0.2;
      for (const sd of [-1, 1]) {
        if (r() > (fast ? 0.45 : 0.4)) continue;
        const x = xc + sd * (hw + ramp(r, -0.35, 0.4));
        if (inT(x, z) && clearOfWays(x, z, 0.6)) stone(x, z, ramp(r, 0.35, 0.8), r);
      }
      // (and in it: where it runs fast, often; where it's slow, now and then)
      if (r() < (fast ? 0.22 : 0.15)) { const x = xc + ramp(r, -hw * 0.7, hw * 0.7), pool = W.at(x, z)?.kind === 'pool'; if (inT(x, z) && clearOfWays(x, z, 0.6)) stone(x, z, pool ? ramp(r, 0.6, 1) : ramp(r, 0.35, 0.65), r); }
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
    // (and the marks on it: see marks.ts)
    streamMarks(push, W, st, z0, z1, inT, (x, z) => groundCut(ways, x, z).cut, M.mark);
    for (const p of st.pools) {
      if (p.z + p.rz * 2 < z0 || p.z - p.rz * 2 > z1) continue;
      // (where the stream drops into it, a small cascade: rocks either side of its lip)
      if (p.kind !== 'spring' && p.kind !== 'plunge') {
        const hz = p.z + p.rz * 0.95, hx = W.xAt(st, hz), drop = W.levelAt(st, hz + 0.8).L - p.L;
        if (drop > 0.2) for (const sd of [-1, 1]) {
          const x = hx + sd * (W.halfAt(st, hz) + ramp(r, 0.05, 0.4)), z = hz + ramp(r, -0.2, 0.4);
          if (inT(x, z) && clearOfWays(x, z, 0.6)) stone(x, z, ramp(r, 0.45, 0.8), r);
        }
      }
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
        if (inT(x, z) && clearOfWays(x, z, 0.6)) stone(x, z, ramp(r, 0.4, 0.9), r);
      }
      // (and one or two standing out in a pond)
      if (p.kind === 'pond' || p.kind === 'plunge') for (let k = 0; k < 2; k++) {
        if (r() < 0.55) continue;
        const a = r() * 6.3, x = p.x + Math.cos(a) * p.rx * ramp(r, 0.35, 0.75), z = p.z + Math.sin(a) * p.rz * ramp(r, 0.35, 0.75);
        if (inT(x, z) && clearOfWays(x, z, 0.6)) stone(x, z, ramp(r, 0.55, 0.95), r);
      }
    }
  }
  if (river) {
    // the river: its marks (see marks.ts); its banks held by black rocks, in clumps, half in the water,
    // more at its near bank (up the picture) than its far; reeds here and there between (each clump
    // decided by where it is along the river, so it's the same whichever tile draws it)
    riverMarks(push, W, x0, x1, inT, M.mark);
    for (let c = Math.floor((x0 - 4) / 6.5); c <= Math.floor((x1 + 4) / 6.5); c++) for (const near of [true, false]) {
      const rr = seeded(hash(seed, c, near ? 1 : 2, 0x21e7)), xc = (c + ramp(rr, 0.1, 0.9)) * 6.5;
      if (Math.abs(xc) < 5.5 || (!near && xc > 30) || (near && landingsOf(ways, seed).some((l) => l.kind !== 'jetty' && Math.abs(xc - l.at[0]) < 5))) continue;
      const bank = (x: number) => W.riverMid(x) + (near ? 1 : -1) * W.riverHalf(x);
      const pick = rr();
      if (pick < (near ? 0.62 : 0.4)) {
        // (a clump of rocks: one large, a few smaller about it, along the bank and out into the water)
        for (let k = 0, n = 2 + Math.floor(rr() * 4); k < n; k++) {
          const x = xc + ramp(rr, -1.6, 1.6) * (k ? 1 : 0.3), z = bank(x) + (near ? 1 : -1) * ramp(rr, -1.1, 0.5), sz = (k ? ramp(rr, 0.3, 0.65) : ramp(rr, 0.75, 1.2));
          if (!inT(x, z)) continue;
          const w = W.at(x, z);
          if (w && w.s < 0.2) stone(x, z, sz, rr); else rock(mesh, [x, gy(x, z), z], sz, rr, gy);
        }
      } else if (pick < 0.85) {
        const x = xc, z = bank(x) + (near ? 1 : -1) * ramp(rr, -0.8, 0.2), w = W.at(x, z);
        if (inT(x, z) && w) reeds(mesh, x, w.s < 0 ? w.L : gy(x, z), z, rr, 6 + Math.floor(rr() * 9));
      }
    }
  }
  // (petals afloat, drifting together in its stiller water)
  const pr = seeded(hash(seed, Math.floor(x0), Math.floor(z0), 0xf10a));
  for (let i = 0; i < 70; i++) {
    const x = ramp(pr, x0, x1), z = ramp(pr, z0, z1), w = W.at(x, z);
    if (!w || w.s > -0.15 || (w.kind === 'flow' && w.run > 0.2) || w.kind === 'falls') continue;
    // (on the river, carried on: gathered along its banks, behind the pier and about the boat; few out on it)
    if (w.kind === 'river' && pr() > (Math.abs(x - JETTY.x) < 4.5 && z > JETTY.z0 - 2.5 ? 0.85 : w.s > -2.2 ? 0.55 : 0.06)) continue;
    const sz = ramp(pr, 0.04, 0.09);
    petals.push(x, w.L + 0.015, z, sz, pr() * Math.PI, pr() * 0.6);
    // (about some, a ring on the water where it lies)
    if (w.kind !== 'river' && pr() < 0.22) { const R = sz * ramp(pr, 2.2, 3); decal(mesh, W, x - R * 1.25, x + R * 1.25, z - R * 1.25, z + R * 1.25, w.L + 0.012, M.ring, (px, pz) => [(px - x) / R, (pz - z) / R]); }
  }
}
/**
 * Where the journey starts: a jetty out from the river's near bank at the foot of the hill, below the
 * first way: a deck of planks on posts driven into the bed, a lantern on a pole at its end; from its
 * land end up to the first way, a landing paved in cracked ice. A boat's moored along its side (see
 * `boat`; drawn apart, as it rocks).
 */
export const JETTY = {
  /** its middle line across the hill, its land end and its far end up the hill, its half-width, its deck */
  x: 0, z1: RIVER_NEAR + 0.9, z0: RIVER_NEAR - 5.4, hw: 0.8, y: RIVER_L + 0.42,
  /** where the boat lies: its middle, off the deck's side, its bow in toward the pier and its stern swung out a little into the river; tied at bow and stern */
  boat: [2.05, RIVER_L, RIVER_NEAR - 3.5] as V3, boatYaw: -0.36,
};
/** whether (x, z) is on the jetty's deck, where one can stand */
export const onJetty = (x: number, z: number) => Math.abs(x - JETTY.x) < JETTY.hw - 0.12 && z > JETTY.z0 + 0.1 && z < JETTY.z1 + 0.35;
function jetty(mesh: Mesh, ways: Ways, seed: number, inT: (x: number, z: number) => boolean) {
  const r = seeded(hash(seed, 0x7e77));
  const { x, z0, z1, hw, y } = JETTY;
  const push = (v: number[]) => { mesh.v.push(...v); };
  // (a pier of stone, as the stairs and bridges are: a deck of pale slabs laid across, each its own
  // length, set a little unevenly; on piers of squared stone standing in the water)
  for (let z = z1, k = 0; z > z0 + 0.05; z -= 0.52, k++) {
    if (!inT(x, z - 0.25)) continue;
    const L = hw + ramp(r, -0.04, 0.05), sx = ramp(r, -0.03, 0.03);
    mesh.box([x + sx, y - 0.07 + ramp(r, -0.006, 0.006), z - 0.26], [L, 0.07, 0.245], [1, 0], INK.stepTop, INK.stepFace, M.step);
  }
  for (let z = z1 - 0.45, k = 0; z >= z0 + 0.2; z -= 1.65, k++) {
    if (!inT(x, z)) continue;
    mesh.box([x, (y - 0.14 + RIVER_L - 1.2) / 2, z], [hw - 0.08, (y - 0.14 - RIVER_L + 1.2) / 2, 0.24], [1, 0], INK.stone, INK.stone, M.stone);
    if (OLD_REFL) for (const sd of [-1, 1]) postReflection(push, ways.water, x + sd * (hw - 0.15), z - 0.2, 0.75, seed + k * 2 + (sd > 0 ? 1 : 0), M.mark);
  }
  // (at its far end, a stone post at each corner to tie up to)
  for (const sd of [-1, 1]) {
    const px = x + sd * (hw - 0.14), pz = z0 + 0.22;
    if (inT(px, pz)) { mesh.box([px, y + 0.2, pz], [0.1, 0.27, 0.1], [1, 0], INK.stepTop, INK.stepFace, M.step, M.stone); if (OLD_REFL) postReflection(push, ways.water, px, pz - 0.2, 0.9, seed + 31 + sd, M.mark); }
  }
  // (at its end, a pole with a red paper lantern hung from its arm)
  const lx = x - hw + 0.08, lz = z0 + 0.25;
  if (inT(lx, lz)) {
    mesh.tube([lx, y - 0.1, lz], [lx, y + 2.3, lz], 0.04, 0.03, INK.trunk, M.trunk, 5);
    mesh.tube([lx, y + 2.25, lz], [lx - 0.45, y + 2.3, lz], 0.022, 0.018, INK.trunk, M.trunk, 4);
    mesh.tube([lx - 0.42, y + 1.95, lz], [lx - 0.42, y + 2.22, lz], 0.13, 0.12, hex(0xc8412e), M.red, 8);
    if (OLD_REFL) postReflection(push, ways.water, lx - 0.42, lz, 1.4, seed + 1, M.mark);
  }
  // (the boat, its reflection and its mooring lines are drawn apart: see `boat`, `boatReflection`, `moorings`)
  // (beside the pier, stone steps down into the water from the landing; and along the bank, faced
  // with dressed stone, as at a landing that's been there a long time)
  const W = ways.water, sx0 = -2.9, sx1 = -1.3;
  for (let ex = -6.4; ex < 5.2; ex += 0.62) {
    const exm = ex + 0.31;
    if (Math.abs(exm - x) < hw + 0.2 || (exm > sx0 - 0.1 && exm < sx1 + 0.1)) continue;
    const zb = W.riverNearBank(exm) + 0.12, yt = ground(ways, exm, zb + 0.5) + 0.04, yb = RIVER_L - 0.4;
    if (inT(exm, zb)) mesh.box([exm, (yt + yb) / 2, zb], [0.3, (yt - yb) / 2, 0.14], [1, 0], INK.stone, INK.stone, M.stone);
  }
  {
    const sxm = (sx0 + sx1) / 2, zb = W.riverNearBank(sxm) + 0.35, yt = ground(ways, sxm, zb + 0.5), n = 5, dy = (yt - (RIVER_L - 0.12)) / n;
    for (let k = 0; k < n; k++) {
      const top = yt - k * dy, sz = zb - k * 0.34;
      if (inT(sxm, sz)) mesh.box([sxm, top - 0.16, sz], [(sx1 - sx0) / 2, 0.16, 0.18], [1, 0], INK.stepTop, INK.stepFace, M.step);
    }
  }
  // (from its land end up to the first way: a landing, paved in cracked ice, its edges ragged)
  const w0 = ways.first(), top = ways.at(w0, 0, true).p;
  const pts: Array<[number, number]> = [];
  // (and across to the head of the water stairs)
  for (let px = -2.8; px < x - 0.4; px += 0.42) for (let pz = z1 - 0.1; pz < z1 + 1.1; pz += 0.42) { const qx = px + ramp(r, -0.08, 0.08), qz = pz + ramp(r, -0.08, 0.08); if (inT(qx, qz) && ways.dryOf(qx, qz) > 0.25) pts.push([qx, qz]); }
  for (let z = z1 - 0.1; z < top[2] + 0.4; z += 0.42) for (let a = -1; a <= 1; a += 0.5) {
    const f = (z - z1) / Math.max(0.1, top[2] - z1), cx = x + (top[0] - x) * f, half = hw + 0.25 + 0.35 * Math.sin(Math.PI * f);
    const px = cx + a * half + ramp(r, -0.08, 0.08), pz = z + ramp(r, -0.08, 0.08);
    if (inT(px, pz) && ways.dryOf(px, pz) > 0.25) pts.push([px, pz]);
  }
  pave(mesh, ways, pts, 0.24, r);
  // (over the landing, part way up, a gate, as a temple's: two red columns on stone bases, a red beam
  // across, a dark board on it, and a little roof of teal tiles: the threshold from the river to the hill)
  const gz = z1 + 1.7, gy = ground(ways, x, gz), face: [number, number] = [0, -1], fx = -face[1], fz = face[0];
  if (inT(x, gz)) {
    const P = (px: number, py: number, pz: number): V3 => [x + fx * px + face[0] * pz, gy + py, gz + fz * px + face[1] * pz];
    const along: [number, number] = [fx, fz];
    for (const sd of [-1, 1]) {
      mesh.box(P(sd * 1.3, 0.12, 0), [0.2, 0.16, 0.2], along, INK.stepTop, INK.stepFace, M.step, M.stone);
      mesh.tube(P(sd * 1.3, 0.25, 0), P(sd * 1.3, 2.55, 0), 0.1, 0.09, INK.red, M.red, 8);
      block(...([P(sd * 1.3, 0, 0)[0], P(sd * 1.3, 0, 0)[2], 0.32] as [number, number, number]));
    }
    mesh.box(P(0, 2.3, 0), [1.5, 0.08, 0.09], along, INK.red, INK.red, M.red);
    mesh.box(P(0, 2.12, 0.02), [0.42, 0.11, 0.03], along, INK.dark, INK.dark, M.dark);
    mesh.box(P(0, 2.5, 0), [1.45, 0.06, 0.12], along, INK.red, INK.red, M.red);
    roof(mesh, P, fx, fz, { ex: 1.85, ez: 0.5, rz: 0, y0: 2.58, rise: 0.48, gx: 1.15, g: 0.5, sweep: 0.32 });
  }
}

/**
 * The places along the river where the boat can come in, from the seed alone: the jetty; downstream,
 * a stone landing under a tree standing alone, a few steps down into the water and a post to tie up
 * to, with a way of stepping stones up from it to the nearest of the ways; and upstream, a reed bank,
 * where the boat can only rest, nosed in among the reeds, and there's nowhere to go.
 */
export interface Landing {
  kind: 'jetty' | 'stone' | 'reeds';
  /** where it is, on the river's near bank */
  at: [number, number];
  /** where the boat lies there, and its heading */
  boat: V3; yaw: number;
  /** where one steps in and out (none at the reed bank) */
  by: V3 | null;
  /** the way of stepping stones from the landing up to a way: from `by`, to where it meets the way (and which way, how far along it) */
  trail: Array<[number, number]>; join: { w: Way; u: number } | null;
}
const landingMemo = new Map<number, Landing[]>();
export function landingsOf(ways: Ways, seed: number): Landing[] {
  const got = landingMemo.get(seed);
  if (got) return got;
  const W = ways.water, r = seeded(hash(seed, 0x1a4d));
  const out: Landing[] = [{ kind: 'jetty', at: [JETTY.x, RIVER_NEAR], boat: JETTY.boat, yaw: JETTY.boatYaw, by: [JETTY.x + JETTY.hw - 0.42, JETTY.y, JETTY.boat[2] + 0.5], trail: [], join: null }];
  // (downstream: of the places along the near bank where a way comes nearest it, one, from the seed)
  const cands: Array<{ x: number; d: number }> = [];
  for (let x = -72; x <= -22; x += 2) {
    const zb = W.riverNearBank(x), n = ways.nearest(x, zb + 2.5);
    if (n.d < 60 && n.d > 5) cands.push({ x, d: n.d });
  }
  cands.sort((a, b) => a.d - b.d);
  const pick = cands[Math.min(cands.length - 1, Math.floor(r() * Math.min(4, cands.length)))];
  if (pick) {
    const x = pick.x, zb = W.riverNearBank(x), top: V3 = [x, ground(ways, x, zb + 1.6), zb + 1.6];
    const n = ways.nearest(x, zb + 2.5), trail: Array<[number, number]> = [];
    // (the stepping stones' way up: from the landing to the way, bending a little)
    const bend = ramp(r, -1.5, 1.5), steps = Math.max(2, Math.ceil(Math.hypot(n.p[0] - x, n.p[2] - top[2]) / 0.75));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      trail.push([x + (n.p[0] - x) * t + bend * Math.sin(Math.PI * t), top[2] + (n.p[2] - top[2]) * t]);
    }
    out.push({ kind: 'stone', at: [x, zb], boat: [x + 0.2, RIVER_L, zb - 1.15], yaw: Math.PI / 2, by: top, trail, join: { w: n.w, u: n.u } });
  }
  // (upstream: a reed bank, where the broad water begins)
  const xr = ramp(r, 24, 40), zr = W.riverNearBank(xr);
  out.push({ kind: 'reeds', at: [xr, zr], boat: [xr, RIVER_L, zr - 2.6], yaw: ramp(r, -0.35, 0.35), by: null, trail: [], join: null });
  landingMemo.set(seed, out);
  return out;
}
/** how near a place is to a landing's ground (its steps and the way up from it) */
export function nearLanding(ls: Landing[], x: number, z: number): number {
  let d = Infinity;
  for (const l of ls) {
    if (l.kind !== 'stone') continue;
    d = Math.min(d, Math.hypot(x - l.at[0], z - l.at[1] - 1));
    for (const [px, pz] of l.trail) d = Math.min(d, Math.hypot(x - px, z - pz));
  }
  return d;
}
/** A landing: stone steps down into the water, a post to tie up to, its tree, and the stones up from it; or a bank of reeds. */
function landing(mesh: Mesh, petals: number[], puffs: number[], ways: Ways, seed: number, l: Landing, inT: (x: number, z: number) => boolean) {
  const r = seeded(hash(seed, Math.round(l.at[0] * 10), 0x1a5d)), W = ways.water, [x, zb] = l.at;
  if (l.kind === 'reeds') {
    for (let k = 0; k < 9; k++) {
      const px = x + ramp(r, -3.2, 3.2), pz = W.riverNearBank(px) + ramp(r, -2.8, 0.6), w = W.at(px, pz);
      if (inT(px, pz) && w) reeds(mesh, px, w.s < 0 ? w.L : ground(ways, px, pz), pz, r, 8 + Math.floor(r() * 10));
    }
    return;
  }
  // (its steps down into the water, the bank faced with stone either side of them)
  const yt = ground(ways, x, zb + 1.1), n = 5, dy = (yt - (RIVER_L - 0.12)) / n;
  for (let k = 0; k < n; k++) { const sz = zb + 0.9 - k * 0.36; if (inT(x, sz)) mesh.box([x, yt - k * dy - 0.16, sz], [0.85 - k * 0.03, 0.16, 0.2], [1, 0], INK.stepTop, INK.stepFace, M.step); }
  for (const sd of [-1, 1]) for (let k = 0; k < 2; k++) {
    const ex = x + sd * (1.25 + k * 0.62), ez = W.riverNearBank(ex) + 0.12, et = ground(ways, ex, ez + 0.5) + 0.04;
    if (inT(ex, ez)) mesh.box([ex, (et + RIVER_L - 0.4) / 2, ez], [0.3, (et - RIVER_L + 0.4) / 2, 0.14], [1, 0], INK.stone, INK.stone, M.stone);
  }
  // (a post to tie up to, at the top of the steps)
  if (inT(x + 1, zb + 1)) mesh.box([x + 1, yt + 0.25, zb + 1], [0.09, 0.32, 0.09], [1, 0], INK.stepTop, INK.stepFace, M.step, M.stone);
  // (the stepping stones up from it)
  for (let k = 1; k < l.trail.length - 1; k++) { const [px, pz] = l.trail[k]; if (inT(px, pz)) stone(mesh, ways, px + ramp(r, -0.1, 0.1), pz, ramp(r, 0.22, 0.3), r); }
  // (its tree, standing alone beside it, up the bank)
  const tx = x + (r() < 0.5 ? -1 : 1) * ramp(r, 2.6, 3.4), tz = W.riverNearBank(tx) + ramp(r, 3.2, 4.2);
  if (inT(tx, tz)) tree(mesh, puffs, petals, [tx, ground(ways, tx, tz), tz], seeded(hash(seed, 0x7eee)), ways, 1);
}

/**
 * The boat moored at the jetty (a sampan), drawn in ink: its hull of dark planks, long and low, its ends rising; amidships
 * a woven canopy, arched; a pole laid along it, a red lantern on a post at its stern. In its own frame:
 * along +z its bow, its waterline at y = 0.
 */
export function boat(mesh: Mesh) {
  // (in ink, as the prints draw a boat on the water: a dark hull, its rail and floor a little less dark, the canopy's matting grey)
  const HULL = hex(0x2b2421), RIM = hex(0x3f3833), MAT = hex(0x6e675f);
  const L = 2.3, B = 0.62;
  // (its sections along it: half-beam and how high its sheer stands, rising to its ends)
  const sec = (t: number) => { const e = Math.abs(t); return { hb: B * Math.sqrt(Math.max(0.02, 1 - e ** 2.2)), top: 0.32 + 0.22 * e ** 2.4, bot: -0.16 * (1 - e ** 2) }; };
  const N = 12;
  for (let i = 0; i < N; i++) {
    const ta = -1 + (2 * i) / N, tb = -1 + (2 * (i + 1)) / N, a = sec(ta), b = sec(tb), za = ta * L, zb = tb * L;
    for (const sd of [-1, 1]) {
      mesh.quad([sd * a.hb, a.top, za], [sd * b.hb, b.top, zb], [sd * b.hb * 0.55, b.bot, zb], [sd * a.hb * 0.55, a.bot, za], HULL, M.wall);
      // (the gunwale: a rail along its sheer)
      mesh.quad([sd * a.hb, a.top + 0.035, za], [sd * b.hb, b.top + 0.035, zb], [sd * b.hb, b.top - 0.02, zb], [sd * a.hb, a.top - 0.02, za], RIM, M.wall);
    }
    mesh.quad([-a.hb * 0.55, a.bot, za], [a.hb * 0.55, a.bot, za], [b.hb * 0.55, b.bot, zb], [-b.hb * 0.55, b.bot, zb], HULL, M.wall);
    // (its floor of boards, just under its sheer)
    mesh.quad([-a.hb * 0.9, 0.1, za], [-b.hb * 0.9, 0.1, zb], [b.hb * 0.9, 0.1, zb], [a.hb * 0.9, 0.1, za], RIM, M.wall, [0, 1, 0]);
  }
  // (amidships its canopy: a woven arch of matting on bent ribs)
  const c0 = -0.75, c1 = 0.55, R = 0.6, M2 = 10;
  for (let k = 0; k < M2; k++) {
    const a0 = Math.PI * (k / M2), a1 = Math.PI * ((k + 1) / M2);
    const p = (a: number, z: number): V3 => [Math.cos(a) * R, 0.36 + Math.sin(a) * R * 0.95, z];
    mesh.quad(p(a0, c0), p(a1, c0), p(a1, c1), p(a0, c1), MAT, M.hat);
  }
  for (const z of [c0, c1]) for (let k = 0; k < M2; k++) {
    const a0 = Math.PI * (k / M2), a1 = Math.PI * ((k + 1) / M2);
    mesh.tube([Math.cos(a0) * R, 0.36 + Math.sin(a0) * R * 0.95, z], [Math.cos(a1) * R, 0.36 + Math.sin(a1) * R * 0.95, z], 0.025, 0.025, INK.trunk, M.trunk, 4);
  }
  // (a pole laid along it; a post at its stern, a red lantern hung from it)
  mesh.tube([0, 0.4, -L * 0.82], [0, 1.6, -L * 0.82], 0.03, 0.025, INK.trunk, M.trunk, 5);
  mesh.tube([0, 1.55, -L * 0.82], [0, 1.58, -L * 0.82 + 0.32], 0.016, 0.014, INK.trunk, M.trunk, 4);
  mesh.tube([0, 1.22, -L * 0.82 + 0.3], [0, 1.46, -L * 0.82 + 0.3], 0.11, 0.1, hex(0xc8412e), M.red, 8);
}
/**
 * The boat's reflection on the water, as it lies turned so (yaw): as the prints have it, short level
 * bars, stacked, dark under its hull and broken, shorter and fainter going down from it (down the
 * picture, whichever way it lies: so it's made for so many headings, and the nearest drawn). About its
 * middle, its waterline at y = 0.
 */
export function boatReflection(mesh: Mesh, yaw: number) {
  const push = (v: number[]) => { mesh.v.push(...v); };
  const r = seeded(0xb0a7), c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let t = -0.92; t <= 0.92; t += 0.16) {
    const lz = t * 2.3, hb = 0.62 * Math.sqrt(Math.max(0.05, 1 - Math.abs(t) ** 2.2));
    // (this station of the hull, where it lies; and how wide the hull shows there, across the picture)
    const sx = sn * lz, sz = c * lz, wide = hb * Math.abs(c) + 0.2 * Math.abs(sn) + 0.08;
    for (let j = 0; j < 5; j++) {
      if (j > 1 && r() < 0.15 + 0.15 * j) continue;
      const dz = -(0.1 + hb * 0.45 + j * ramp(r, 0.13, 0.19)), half = wide * (1.3 - 0.2 * j) * ramp(r, 0.8, 1.1) + 0.12 * Math.abs(sn), x0 = sx + ramp(r, -0.1, 0.1);
      const pts: V3[] = [];
      for (let u = -half; u <= half + 1e-6; u += 0.1) pts.push([x0 + u, 0.023, sz + dz + 0.02 * Math.sin(u * 13 + j)]);
      ribbon(push, pts, ramp(r, 0.07, 0.11) * (1 - 0.12 * j), 1, Math.max(0.3, 0.95 - 0.16 * j), M.mark);
    }
  }
}
/** the pole's length, as it lies in the boat (laidPole) and as it's held */
export const POLE_L = 3.8;
/** The boat's pole, laid along it (when no one's poling): in the boat's frame */
export function laidPole(mesh: Mesh) { mesh.tube([0.42, 0.42, -2.3 * 0.95], [0.3, 0.4, 2.3 * 0.7], 0.022, 0.018, INK.trunk, M.trunk, 4); }
/** A pole, from (0,0,0) to (0,1,0): placed and stretched where it's held, end to end */
export function poleMesh(mesh: Mesh) { mesh.tube([0, 0, 0], [0, 1, 0], 0.024, 0.02, INK.trunk, M.trunk, 5); }
/** The boat's mooring lines, bow and stern, sagging to the posts at the pier's end, as it lies moored. */
export function moorings(mesh: Mesh) {
  const { x, hw, y, z0, z1 } = JETTY, B = JETTY.boat, cy = Math.cos(JETTY.boatYaw), sy = Math.sin(JETTY.boatYaw);
  const onBoat = (lx: number, ly: number, lz: number): V3 => [B[0] + cy * lx + sy * lz, B[1] + ly, B[2] - sy * lx + cy * lz];
  for (const [from, post] of [[onBoat(0, 0.5, 2.05), [x + hw - 0.02, y - 0.02, z1 - 1.2]], [onBoat(0, 0.5, -2.0), [x + hw - 0.14, y + 0.4, z0 + 0.22]]] as Array<[V3, V3]>) {
    const mid: V3 = [(from[0] + post[0]) / 2, (from[1] + post[1]) / 2 - 0.12, (from[2] + post[2]) / 2];
    mesh.tube(from, mid, 0.012, 0.012, INK.dark, M.dark, 4);
    mesh.tube(mid, post, 0.012, 0.012, INK.dark, M.dark, 4);
  }
}

/**
 * A patch on the water's surface, for marks drawn on it: a fine sheet from (xa, za) to (xb, zb), just
 * above the water at y, each corner carrying where it is in the marks' own measure, and how far in
 * from the water's edge it is (so they're only drawn on the water).
 */
function decal(mesh: Mesh, W: Water, xa: number, xb: number, za: number, zb: number, y: number, mat: number, map: (x: number, z: number) => [number, number]) {
  const nx = Math.max(2, Math.ceil((xb - xa) / 0.22)), nz = Math.max(2, Math.ceil((zb - za) / 0.22));
  const V = (i: number, k: number) => {
    const x = xa + ((xb - xa) * i) / nx, z = za + ((zb - za) * k) / nz, w = W.at(x, z), m = map(x, z);
    return [x, y, z, 0, 1, 0, m[0], m[1], w ? -w.s : -1, mat];
  };
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const a = V(i, k), b = V(i, k + 1), c = V(i + 1, k + 1), d = V(i + 1, k);
    if (Math.max(a[8], b[8], c[8], d[8]) < 0) continue;
    for (const v of [a, b, c, a, c, d]) mesh.v.push(...v);
  }
}
/**
 * The marks on the water about something standing at (x, z), so wide (size) and so high (h): if it
 * stands in the water, two or three rings of ripples about it, drawn out downstream where it runs;
 * where the water's still enough, its reflection below it.
 */
function waterMarks(mesh: Mesh, W: Water, x: number, z: number, size: number, h: number) {
  const w = W.at(x, z), below = W.at(x, z - size);
  if (below && below.s < 0 && below.run < 0.2 && below.kind !== 'falls' && (!w || w.s > 0.4)) {
    // (on the bank just uphill of still water: only its reflection, in the water below it)
    const dz = h * 1.06 + 0.2, hx = size * 0.85, L = below.L;
    if (OLD_REFL) decal(mesh, W, x - hx, x + hx, z - dz, z + 0.15, L + 0.01, M.reflect, (px, pz) => [(px - x) / hx, (z + 0.15 - pz) / (dz + 0.15)]);
    return;
  }
  if (!w || w.s > 0.4 || w.kind === 'falls') return;
  const L = w.L;
  if (w.s < 0.4) {
    const R = size * 0.78, down = w.kind === 'flow' ? 1.5 : 1;
    decal(mesh, W, x - R * 1.8, x + R * 1.8, z - R * 1.8 * down, z + R * 1.8, L + 0.014, M.ripple, (px, pz) => [(px - x) / R, (pz - z) / R / (pz < z ? down : 1)]);
    // (behind it, downstream, where the water's not too quick, now and then an eddy)
    if (w.kind === 'flow' && w.run < 0.2 && hash(Math.round(x * 10), Math.round(z * 10), 0xedd1) % 100 < 40) {
      const E = size * 0.7, ez = z - size * 1.7;
      decal(mesh, W, x - E, x + E, ez - E, ez + E, L + 0.016, M.eddy, (px, pz) => [(px - x) / E, (pz - ez) / E]);
    }
  }
  if (OLD_REFL && w.run < 0.2) {
    const dz = h * 1.06 + 0.2, hx = size * 0.85;
    decal(mesh, W, x - hx, x + hx, z - dz, z + 0.15, L + 0.01, M.reflect, (px, pz) => [(px - x) / hx, (z + 0.15 - pz) / (dz + 0.15)]);
  }
}
/**
 * The blossom's reflection, on still water: for each clump of a crown whose mirror image falls on
 * the water (below it as the eye sees it: as far down the hill from it, on the water, as it stands
 * above the water), a patch of pink strokes there.
 */
function blossomInWater(mesh: Mesh, ways: Ways, puffs: number[], seed: number) {
  const W = ways.water, r = seeded(hash(seed, puffs.length, 0x5ef1));
  let n = 0;
  for (let i = 0; i < puffs.length && n < 80; i += 6) {
    if (r() < 0.45) continue;
    const x = puffs[i], y = puffs[i + 1], z = puffs[i + 2], rad = puffs[i + 3];
    const w0 = W.at(x, z - (y - ways.hill(z)) * 1.06);
    if (!w0 || w0.s > 0) continue;
    const zr = z - (y - w0.L) * 1.06, w = W.at(x, zr);
    if (!w || w.s > -0.15 || w.run >= 0.2 || w.kind === 'falls') continue;
    decal(mesh, W, x - rad, x + rad, zr - rad * 1.5, zr + rad * 0.4, w.L + 0.006 + r() * 0.003, M.reflectPink, (px, pz) => [(px - x) / rad, (zr + rad * 0.4 - pz) / (rad * 1.9)]);
    n++;
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
  if (c.kind === 'arch') { archBridge(mesh, ways, w, inT); return; }
  if (c.kind === 'boards') {
    // (a boardwalk: planks laid across, on posts driven into the marsh at either side, every so often)
    const WOOD = hex(0x8a7158);
    for (let u = c.u0 - 0.3; u < c.u1 + 0.3; u += 0.27) {
      const m = ways.at(w, u, true);
      if (!inT(m.p[0], m.p[2])) continue;
      const top = ways.surface(w, Math.max(c.u0, Math.min(c.u1, u)), m.p[2]);
      mesh.box([m.p[0], top - 0.03, m.p[2]], [0.12, 0.03, WIDTH / 2 - 0.1 + r() * 0.06], m.dir, WOOD, WOOD, M.wall);
      if (Math.round((u - c.u0) / 0.27) % 5 === 0) for (const sd of [-1, 1]) { const v = sd * (WIDTH / 2 - 0.05); mesh.tube([m.p[0] + m.dir[1] * v, c.L - 0.5, m.p[2] - m.dir[0] * v], [m.p[0] + m.dir[1] * v, top + 0.02, m.p[2] - m.dir[0] * v], 0.05, 0.05, INK.trunk, M.trunk, 5); }
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

/**
 * A stone arch over the water: one round arch, its opening over the water as wide as it can be,
 * its crown under the deck; its face of squared stone, the deck pale, a low parapet either side. Its
 * reflection below it, as the eye sees it: its face mirrored round its opening's mirror, so the arch
 * and its reflection make a ring.
 */
function archBridge(mesh: Mesh, ways: Ways, w: Way, inT: (x: number, z: number) => boolean) {
  const c = w.cross!, W = ways.water;
  // (its opening: over the water, a little wider; round, as high as it's wide, or as the deck allows)
  let wa = Infinity, wb = -Infinity;
  for (let u = c.u0; u <= c.u1; u += 0.1) { const q = ways.at(w, u, true).p, t = W.at(q[0], q[2]); if (t && t.s < 0) { wa = Math.min(wa, u); wb = Math.max(wb, u); } }
  if (!(wb > wa)) { wa = c.u0 + 1.2; wb = c.u1 - 1.2; }
  const o0 = Math.max(c.u0 + 0.3, wa - 0.35), o1 = Math.min(c.u1 - 0.3, wb + 0.35), mid = (o0 + o1) / 2;
  const top = (u: number, z: number) => ways.surface(w, Math.max(c.u0, Math.min(c.u1, u)), z);
  const crown = top(mid, ways.at(w, mid, true).p[2]) - 0.3;
  const H = Math.max(0.3, Math.min((o1 - o0) / 2, crown - c.L));
  const s0 = c.u0 - 0.7, s1 = c.u1 + 0.7, n = Math.max(12, Math.round((s1 - s0) / 0.18));
  const HW = WIDTH / 2 + 0.14;
  // (a section across it at each step along it: its middle, across, deck, and the arch's soffit or the abutment's foot)
  const sec = Array.from({ length: n + 1 }, (_, k) => {
    const u = s0 + ((s1 - s0) * k) / n, m = ways.at(w, u, true), y1 = top(u, m.p[2]);
    const f = (u - o0) / (o1 - o0);
    const y0 = f > 0 && f < 1 ? Math.min(y1 - 0.12, c.L + H * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2))) : Math.min(ground(ways, m.p[0], m.p[2]), c.L) - 0.5;
    return { p: m.p, ax: m.dir[1], az: -m.dir[0], y1, y0, open: f > 0 && f < 1 };
  });
  const P = (q: typeof sec[number], off: number, y: number): V3 => [q.p[0] + q.ax * off, y, q.p[2] + q.az * off];
  for (let k = 0; k < n; k++) {
    const a = sec[k], b = sec[k + 1];
    if (!inT(a.p[0], a.p[2]) && !inT(b.p[0], b.p[2])) continue;
    // (its deck, pale stone)
    mesh.quad(P(a, -HW, a.y1), P(b, -HW, b.y1), P(b, HW, b.y1), P(a, HW, a.y1), INK.stepTop, M.stone, [0, 1, 0]);
    // (its two faces, squared stone, from the deck down to the arch, or into the ground)
    for (const sd of [-1, 1]) {
      mesh.quad(P(a, sd * HW, a.y0), P(b, sd * HW, b.y0), P(b, sd * HW, b.y1), P(a, sd * HW, a.y1), INK.stone, M.stone);
      // (a low parapet along each side)
      const o = sd * (HW - 0.08);
      mesh.box([(P(a, o, 0)[0] + P(b, o, 0)[0]) / 2, (a.y1 + b.y1) / 2 + 0.13, (P(a, o, 0)[2] + P(b, o, 0)[2]) / 2], [Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]) / 2 + 0.01, 0.13, 0.08], [b.p[0] - a.p[0], b.p[2] - a.p[2]].map((v, _, arr) => v / (Math.hypot(arr[0], arr[1]) || 1)) as [number, number], INK.stepTop, INK.stone, M.stone);
    }
    // (the arch's soffit, under it, in shadow)
    if (a.open || b.open) mesh.quad(P(a, -HW, a.y0), P(a, HW, a.y0), P(b, HW, b.y0), P(b, -HW, b.y0), INK.rock, M.stone);
  }
  // (its reflection, on the side the eye sees it from)
  const a = ways.at(w, o0, true).p, b = ways.at(w, o1, true).p, mm = ways.at(w, mid, true);
  const wt = W.at(mm.p[0], mm.p[2]);
  if (!wt || wt.run >= 0.2 || !inT(mm.p[0], mm.p[2])) return;
  const half = Math.abs(b[0] - a[0]) / 2, xm = (a[0] + b[0]) / 2;
  if (half < 0.8) return;
  const face = mm.p[2] - (WIDTH / 2 + 0.14) * Math.abs(mm.dir[0]) - 0.05, D = (H * 1.06) / 0.72, hw = half / 0.78;
  if (OLD_REFL) decal(mesh, W, xm - hw, xm + hw, face - D, face, c.L + 0.012, M.archReflect, (px, pz) => [(px - xm) / hw, (face - pz) / D]);
}

/** Where a fallen petal comes to rest: on a way (its tread, a stepping stone, a bridge's deck), afloat on water, or on the ground. */
function restY(ways: Ways, x: number, z: number, lift: number): number {
  const nr = ways.nearest(x, z);
  if (nr.d < WIDTH / 2) return ways.surface(nr.w, nr.u, z) + 0.01;
  const wt = ways.water.at(x, z);
  if (wt && wt.s < -0.05) return wt.L + 0.015;
  return ground(ways, x, z) + lift;
}

/**
 * Paving in a cracked-ice pattern: about each of the points, a flag, an irregular polygon of five to
 * seven sides, pale, thin, laid on the ground, the joints between them left open.
 */
function pave(mesh: Mesh, ways: Ways, pts: Array<[number, number]>, rad: number, r: Rand) {
  for (const [x, z] of pts) {
    const n = 5 + Math.floor(r() * 3), turn = r() * 6.3, y = ground(ways, x, z) + 0.04 + r() * 0.012;
    const ring: V3[] = [];
    for (let i = 0; i < n; i++) { const a = turn + (i / n) * Math.PI * 2 + ramp(r, -0.3, 0.3), rr = rad * ramp(r, 0.78, 1.08); ring.push([x + Math.cos(a) * rr, y, z + Math.sin(a) * rr]); }
    const c: V3 = [x, y, z];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      mesh.tri(c, b, a, INK.stepTop, M.step, [0, 1, 0]);
      mesh.quad([a[0], y - 0.12, a[2]], [b[0], y - 0.12, b[2]], b, a, INK.stepFace, M.step);
    }
  }
}
/** A stone lantern (石灯籠): a broad foot, a post, a fire-box with its dark window, a hipped cap and a knob; facing f. */
function lantern(mesh: Mesh, at: V3, f: [number, number], r: Rand) {
  const [x, y, z] = at, dir: [number, number] = [f[1], -f[0]], h = ramp(r, 0.9, 1.2);
  mesh.box([x, y + 0.06, z], [0.24, 0.06, 0.24], dir, INK.stepTop, INK.stepFace, M.stone);
  mesh.tube([x, y + 0.1, z], [x, y + h * 0.55, z], 0.08, 0.07, INK.stepFace, M.stone, 6);
  mesh.box([x, y + h * 0.58, z], [0.2, 0.04, 0.2], dir, INK.stepTop, INK.stepFace, M.stone);
  mesh.box([x, y + h * 0.72, z], [0.14, 0.11, 0.14], dir, INK.stepTop, INK.stepFace, M.stone);
  mesh.box([x + f[0] * 0.13, y + h * 0.72, z + f[1] * 0.13], [0.07, 0.065, 0.015], dir, INK.dark, INK.dark, M.dark);
  mesh.tube([x, y + h * 0.83, z], [x, y + h * 0.98, z], 0.27, 0.03, INK.stepFace, M.stone, 4);
  mesh.tube([x, y + h * 0.97, z], [x, y + h * 1.05, z], 0.04, 0.02, INK.stepFace, M.stone, 5);
}

/** A little grass at a given height (in a joint between stones): fine short blades, so tall (k). */
function tuftAt(mesh: Mesh, at: V3, r: Rand, n: number, k = 1) {
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, lean = ramp(r, 0.15, 0.6), h = ramp(r, 0.08, 0.2) * k, w = ramp(r, 0.015, 0.025);
    const bx = at[0] + Math.cos(a) * 0.05 * r(), bz = at[2] + Math.sin(a) * 0.05 * r();
    const tip: V3 = [bx + Math.cos(a) * lean * h, at[1] + h, bz + Math.sin(a) * lean * h];
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    mesh.tri([bx - px, at[1] - 0.01, bz - pz], [bx + px, at[1] - 0.01, bz + pz], tip, INK.grass, M.grass, [0, 1, 0]);
  }
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
function tree(mesh: Mesh, puffs: number[], petals: number[], base: V3, r: Rand, ways: Ways, iso = 0) {
  // (none stands in water, nor on a bank cut steep; nor just downhill of water, where its crown would
  // stand between the eye and it: the water's an open mass, as the print's are)
  if (ways.dryOf(base[0], base[2]) < 1.6) return;
  for (const dz of [1.5, 3, 4.5, 6]) { const w = ways.water.at(base[0], base[2] + dz); if (w && w.s < 0) return; }
  // (a trunk you can see: tall before it opens, leaning, with a kink or two; bold, as the print's are)
  // (each tree its own form: most open from a short trunk into a vase of limbs; some keep a leader,
  // limbs from it in two tiers; some fork low into two stems; some lean hard, their limbs thrown out
  // the way they lean; some are low and broad, their limbs spreading wide and level)
  const fv = seeded(hash(Math.round(base[0] * 100), Math.round(base[2] * 100), 0xf0a))();
  const form = fv < 0.36 ? 'vase' : fv < 0.55 ? 'leader' : fv < 0.71 ? 'twin' : fv < 0.86 ? 'lean' : 'low';
  const stature = ramp(r, 0.82, 1.3) * (1 + 0.22 * iso);
  const H = ramp(r, 1.6, 2.6) * stature * (form === 'leader' ? 1.4 : form === 'low' ? 0.62 : 1);
  const lean0 = ramp(r, -0.4, 0.4), leanSd = lean0 < 0 ? -1 : 1;
  const lean: V3 = norm([form === 'lean' ? leanSd * (0.75 + Math.abs(lean0)) : lean0, 1, ramp(r, -0.15, 0.3)]);
  const R0 = ramp(r, 0.24, 0.34) * stature;
  const knee = add(base, add(mul(lean, H * 0.5), [ramp(r, -0.2, 0.2), 0, ramp(r, -0.1, 0.1)]));
  const top = add(knee, mul(norm(add(lean, [ramp(r, -0.35, 0.35), 0.3, ramp(r, -0.1, 0.2)])), H * 0.5));
  // (the twin's two stems: from a fork low on the trunk, out either side and up)
  const fork = add(base, mul(lean, H * 0.32));
  const stems: V3[] = form === 'twin' ? [-1, 1].map((sd) => add(fork, mul(norm([lean[0] + sd * 0.42, 1, lean[2] + sd * 0.08]), H * 0.85))) : [top];
  // (each limb a stroke of the brush, from where it leaves its parent to its tip: which, numbered
  // from the tree's place, so a stroke's marks are its own)
  const tid = hash(Math.round(base[0] * 100), Math.round(base[2] * 100), 0x51d) % 1000;
  let strokes = 0;
  const stroke = (cls: number, L: number) => ({ id: tid * 0.37 + ++strokes * 7.13, s: 0, cls, L });
  // (its foot flares out to the ground, the trunk's own first stretch, so the tree stands on the hill)
  const foot = add(base, mul(lean, 0.38));
  const trunkTo = form === 'twin' ? fork : knee;
  const ts = stroke(0, H + 0.6);
  ts.s = mesh.tube([base[0], base[1] - 0.3, base[2]], foot, R0 * 1.8, R0 * 1.42, INK.trunk, M.trunk, 10, ts);
  ts.s = mesh.tube(foot, trunkTo, R0 * 1.42, form === 'twin' ? R0 * 1.15 : R0 * 1.05, INK.trunk, M.trunk, 10, ts);
  if (form === 'twin') {
    for (const st of stems) { const ss = stroke(0, H); ss.s = ts.s; mesh.tube(fork, st, R0 * 0.85, R0 * 0.66, INK.trunk, M.trunk, 8, ss); }
  } else mesh.tube(knee, top, R0 * 1.05, R0 * 0.88, INK.trunk, M.trunk, 10, ts);
  // (and its roots, where they leave it and dive into the ground: short ridges, a few, each its own
  // stroke; from their own stream, so the tree above is as it was)
  {
    const rr = seeded(hash(Math.round(base[0] * 100), Math.round(base[2] * 100), 0x2007));
    for (let k = 0, n = 3 + Math.floor(rr() * 3), a0 = rr() * 6.3; k < n; k++) {
      const a = a0 + (k / n) * 6.283 + ramp(rr, -0.4, 0.4), dir: V3 = [Math.cos(a), 0, Math.sin(a)], L = R0 * ramp(rr, 1.6, 3);
      const at = (t: number, dy: number): V3 => { const x = base[0] + dir[0] * (R0 * 1.2 + L * t) + ramp(rr, -0.04, 0.04), z = base[2] + dir[2] * (R0 * 1.2 + L * t); return [x, ground(ways, x, z) + dy, z]; };
      // (a root's class, 4: drawn dark, the cream only on its very top)
      const rs = stroke(4, L);
      const p0: V3 = [base[0] + dir[0] * R0 * 0.7, base[1] + 0.06, base[2] + dir[2] * R0 * 0.7], p1 = at(0.45, -0.03), p2 = at(1, -0.12);
      rs.s = mesh.tube(p0, p1, R0 * 0.42, R0 * 0.22, INK.trunk, M.trunk, 6, rs);
      mesh.tube(p1, p2, R0 * 0.22, 0.02, INK.trunk, M.trunk, 5, rs);
    }
  }
  const limbsFrom = mesh.v.n;
  const ends: Array<[V3, V3, number]> = [];
  const UP: V3 = [0, 1, 0];
  /**
   * (the way a limb goes, drawn as the print draws a tree: spread across the picture, up and out to
   * either side, little toward the eye or away; and what depth it has, a little away from the eye
   * rather than toward it, so the near side of the crown is open and its limbs are seen)
   */
  const fan = (d: V3): V3 => norm([d[0], d[1], d[2] * 0.45 + 0.14]);
  // (the twigs' turns, from a stream of their own, so the tree's growth is as it was)
  const tk = seeded(hash(tid, 0x7a1));
  const twig = (from: V3, d: V3, len: number, rad: number) => {
    // (a hairline, thinning to nothing, with a turn in it, sharper than a limb's)
    const e = add(from, mul(d, len));
    const m: V3 = add(add(from, mul(d, len * ramp(tk, 0.4, 0.6))), [ramp(tk, -0.07, 0.07) * len, ramp(tk, -0.02, 0.05) * len, ramp(tk, -0.04, 0.04) * len]);
    const st = stroke(3, len);
    st.s = mesh.tube(from, m, rad, (rad + 0.004) * 0.55, INK.trunk, M.twig, 3, st);
    mesh.tube(m, e, (rad + 0.004) * 0.55, 0.004, INK.trunk, M.twig, 3, st);
    if (r() < 0.6) ends.push([e, d, 1]);
    return e;
  };
  /**
   * a limb: a long run, then a slight turn and on (as the print's are drawn: runs and angles, not
   * curves), thinning steadily; at its end it forks, two ways or three, the forks narrow; at the
   * last, a lace of fine twigs out to the crown's edge, and the blossom about them
   */
  const grow = (from: V3, dir: V3, len: number, rad: number, depth: number) => {
    // (the turn sharper the further out: a limb's runs long and steady, a branch's quicker)
    const kk = 0.8 + 0.25 * depth;
    const kink = fan(norm(add(add(dir, mul(UP, 0.08)), [ramp(r, -0.3, 0.3) * kk, ramp(r, -0.12, 0.15), ramp(r, -0.3, 0.3) * kk])));
    const mid = add(from, mul(dir, len * ramp(r, 0.45, 0.6))), to = add(mid, mul(kink, len * 0.48));
    const sides = depth >= 3 ? 3 : depth >= 2 ? 4 : depth >= 1 ? 5 : 6;
    const taper = depth >= 3 ? 0.55 : 0.78;
    const st = stroke(depth === 0 ? 1 : depth <= 2 ? 2 : 3, len);
    if (depth <= 1) {
      // (the main limbs wander a little along their way: a third bend, small, between)
      const q1 = add(add(from, mul(sub(mid, from), 0.5)), [ramp(r, -0.08, 0.08) * len, ramp(r, -0.05, 0.08) * len, ramp(r, -0.04, 0.04) * len]);
      const rm = rad * (1 + taper) / 2;
      st.s = mesh.tube(from, q1, rad, (rad + rm) / 2, INK.trunk, M.twig, sides, st);
      st.s = mesh.tube(q1, mid, (rad + rm) / 2, rm, INK.trunk, M.twig, sides, st);
    } else st.s = mesh.tube(from, mid, rad, rad * (1 + taper) / 2, INK.trunk, M.twig, sides, st);
    mesh.tube(mid, to, rad * (1 + taper) / 2, rad * taper, INK.trunk, M.twig, sides, st);
    // (now and then a short spur out of the turn)
    if (depth >= 1 && r() < 0.45) twig(mid, fan(norm(add(kink, [ramp(r, -1, 1), ramp(r, 0, 0.5), ramp(r, -0.6, 0.6)]))), len * ramp(r, 0.3, 0.5), rad * 0.4);
    if (depth >= 3) {
      for (let k = 0, n = 3 + Math.floor(r() * 3) + (iso > 0 ? Math.round(iso * 3) : 0); k < n; k++) twig(to, fan(norm(add(kink, [ramp(r, -0.7, 0.7), ramp(r, -0.05, 0.5), ramp(r, -0.6, 0.6)]))), len * ramp(r, 0.5, 0.9), rad * 0.45);
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
  const limbs = 3 + (r() < 0.45 ? 1 : 0) + (form === 'leader' || form === 'twin' ? 1 : 0), a0 = ramp(r, -0.4, 0.4);
  // (how wide the limbs spread, and how level: the low tree's wide and flat; the leader's narrower, up)
  const spread = form === 'low' ? 1.5 : form === 'leader' ? 0.85 : 1.15, rise = form === 'low' ? 0.62 : 1;
  for (let i = 0; i < limbs; i++) {
    // (spread across: from up-left to up-right, the middle ones the more upright)
    const t = limbs === 1 ? 0.5 : i / (limbs - 1);
    let a = -spread + 2 * spread * t + a0 * 0.4 + ramp(r, -0.18, 0.18);
    // (the leaning tree throws its limbs out the way it leans)
    if (form === 'lean') a = a * 0.75 + leanSd * 0.45;
    const d = fan(norm([Math.sin(a) + lean[0] * 0.3, Math.cos(a) * ramp(r, 0.85, 1.15) * rise, ramp(r, -0.6, 0.6)]));
    // (from where: the top; on a leader, the lower tier from part way up; on a twin, each stem its side)
    const from = form === 'twin' ? stems[t < 0.5 ? 0 : 1] : form === 'leader' && i % 2 === 0 ? add(base, mul(sub(top, base), 0.62)) : top;
    grow(from, d, ramp(r, 1.3, 1.9) * stature * (form === 'low' ? 1.15 : 1), R0 * 0.56, 0);
  }
  if (r() < 0.5) { const sd = r() < 0.5 ? -1 : 1; grow(form === 'twin' ? fork : knee, fan(norm([sd, 0.7, ramp(r, -0.4, 0.4)])), ramp(r, 1.1, 1.5) * stature, R0 * 0.45, 1); }
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
  // (which crown: for the drawing, so where one crown stands before another it can say so)
  const cid = 1 + Math.floor(crownSeed * 250);
  const puffsFrom = puffs.length;
  // (each tree its own fullness: most crowns full, some thinner, where more of the limbs show)
  let full = r() < 0.7 ? ramp(r, 0.85, 1) : ramp(r, 0.55, 0.75);
  if (iso > 0) full *= 1 - 0.3 * iso;
  for (const [p, d, k] of tips) {
    const n = k + (k > 1 && r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      // (a clump about the fan of twigs, lifted a little: the blossom sits on top of the branches)
      // (a clump about the twigs' ends, set a little behind them along the eye's line, so it's in the
      // same place on the print but the ink falls in front of it, as the print lays it)
      // (but inside the crown, as the eye sees it, the clump stands before its twigs instead: there the
      // limbs that hold them are hidden, and a fan of twigs on its own, cut off, reads as stubble; at
      // the crown's rim the twigs stay before it, a lace out to the edge)
      const rim = Math.hypot((p[0] - cx) / Rh, ((p[1] - cy) * VIEW[2] - (p[2] - cz) * VIEW[1]) / Rv);
      const back0 = ramp(r, 0.35, 0.8), back = rim < 0.45 * (1 - 0.5 * iso) && p[1] > cy - 0.3 * Rv ? -0.2 - (back0 - 0.35) * 0.4 : back0;
      const q: V3 = [p[0] + d[0] * ramp(r, 0, 0.5) + ramp(r, -0.5, 0.5) + VIEW[0] * back, p[1] + ramp(r, 0, 0.4) + VIEW[1] * back, p[2] + d[2] * ramp(r, 0, 0.5) + ramp(r, -0.4, 0.4) + VIEW[2] * back];
      // (the near side of the crown, low down, left open: there the limbs are seen against the blossom behind)
      if ((q[2] - cz) < -0.3 * Rh && q[1] < cy - 0.1 && r() < 0.45) continue;
      if (r() > full) continue;
      const rad = (k > 1 ? ramp(r, 0.5, 0.78) : ramp(r, 0.32, 0.52)) * Math.min(stature, 1.15);
      // (crowns stand as they grow, over a way too: the walker passes under them and comes out again)
      const out = norm([q[0] - cx, (q[1] - cy) * 1.8, q[2] - cz]);
      const shade = Math.max(0, Math.min(1, 0.55 + t0 + 0.26 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.2 * (q[1] - cy) + ramp(r, -0.04, 0.04)));
      puffs.push(q[0], q[1], q[2], rad, shade, cid + (crownSeed * 0.5 + r() * 0.5) * 0.998);
    }
  }
  // (and the dome filled out behind its branches, so the crown is one full mass of blossom with the
  // ink across it, as the print has it: clumps through the upper part of the crown, set back along
  // the eye's line from the branches' plane)
  for (let k = 0, n = Math.round(tips.length * 0.4 * (1 - 0.6 * iso)); k < n; k++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.9, up = ramp(r, -0.35, 1);
    const back = ramp(r, 1.0, 1.6);
    const q: V3 = [cx + Math.cos(a) * rr * Rh + VIEW[0] * back, cy + up * Rv * 0.8 + VIEW[1] * back, cz + Math.sin(a) * rr * Rh * 0.6 + VIEW[2] * back];
    const out = norm([q[0] - cx, (q[1] - cy) * 1.8, q[2] - cz]);
    const shade = Math.max(0, Math.min(1, 0.55 + t0 + 0.26 * (out[0] * L[0] + out[1] * L[1] + out[2] * L[2]) + 0.2 * (q[1] - cy) + ramp(r, -0.04, 0.04)));
    puffs.push(q[0], q[1], q[2], ramp(r, 0.5, 0.75) * Math.min(stature, 1.15), shade, cid + (crownSeed * 0.5 + r() * 0.5) * 0.998);
  }
  // (no clump adrift: as the eye sees the crown, a clump or two off by themselves, held up by twigs too
  // fine to see, read as blobs, not blossom; so they go, and their twigs show bare past the crown)
  {
    const n = (puffs.length - puffsFrom) / 6, P = (i: number) => puffsFrom + i * 6;
    const sx = new Float64Array(n), sy = new Float64Array(n), up: V3 = [0, VIEW[2], -VIEW[1]];
    for (let i = 0; i < n; i++) { const o = P(i); sx[i] = puffs[o]; sy[i] = puffs[o + 1] * up[1] + puffs[o + 2] * up[2]; }
    const root = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
    // (swept across, so only clumps near each other across the picture are compared)
    const ord = Array.from({ length: n }, (_, i) => i).sort((a, b) => sx[a] - sx[b]);
    let maxR = 0;
    for (let i = 0; i < n; i++) maxR = Math.max(maxR, puffs[P(i) + 3]);
    for (let a = 0; a < n; a++) {
      const i = ord[a], ri = puffs[P(i) + 3];
      for (let b = a + 1; b < n; b++) {
        const j = ord[b], dx = sx[j] - sx[i];
        if (dx > (ri + maxR) * 0.8) break;
        const lim = (ri + puffs[P(j) + 3]) * 0.8, dy = sy[j] - sy[i];
        if (dx * dx + dy * dy < lim * lim) root[find(i)] = find(j);
      }
    }
    const area = new Map<number, number>(), count = new Map<number, number>();
    for (let i = 0; i < n; i++) { const k = find(i), rr = puffs[P(i) + 3]; area.set(k, (area.get(k) ?? 0) + rr * rr); count.set(k, (count.get(k) ?? 0) + 1); }
    const most = Math.max(0, ...area.values());
    const keep: number[] = [];
    for (let i = 0; i < n; i++) { const k = find(i); if (count.get(k)! > 3 || area.get(k)! >= most * 0.25) for (let q = 0; q < 6; q++) keep.push(puffs[P(i) + q]); }
    puffs.length = puffsFrom; puffs.push(...keep);
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
 * A cast's words, written on a sheet standing in the space kept for them, as a page would set them:
 * the figure (six lines, the first at the bottom, a yin line broken, the moving lines vermilion); its
 * name in a column beside it, and if it moves, 之 and the name of what it becomes; under both, the
 * numbers and titles, small. The sheet stands at its place on the hill and always faces the eye (the
 * drawing turns it: each corner carries its offset across and up the sheet), so it reads square from
 * wherever it's seen; whatever stands before it (a crown, a rock) stands before it.
 */
function castWords(mesh: Mesh, ways: Ways, st: Station) {
  const hex = identify(st.lines), rel = st.lines.some(moving) ? identify(st.lines, true) : null;
  // (the page: in its pixels, about as the print shows them where the walker is)
  const PX = 0.034, CH = 30, EN = 18, ENW = 512 * EN / 56;
  const nh = [...hex.han].length, nr = rel ? [...rel.han].length : 0;
  const colH = (nh + (rel ? 1 + nr : 0)) * CH, top = Math.max(45, colH);
  const Wb = 120, Hb = top + 6 + EN * (rel ? 2 : 1);
  // (its foot, at the uphill side of its space, a little above the ground)
  const ax = st.c[0], az = st.c[2] + st.rz * 0.25, ay = ground(ways, ax, az) + 0.2;
  block(ax, az, 1.2);
  const off = (px: number, py: number): [number, number] => [(px - Wb / 2) * PX, (Hb - py) * PX];
  const quad = (x0: number, y0: number, x1: number, y1: number, r: Rect | null, ink: number) => {
    const nx = Math.max(1, Math.ceil((x1 - x0) / 24)), ny = Math.max(1, Math.ceil((y1 - y0) / 24));
    const P = (i: number, j: number) => {
      const fx = i / nx, fy = j / ny, [ox, oy] = off(x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy);
      const u = r ? (r[0] + r[2] * fx) / TYPE.w : 0, v = r ? (r[1] + r[3] * fy) / TYPE.h : 0;
      return [ax, ay, az, ox, oy, 0, u, v, ink, M.type];
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
  block(x, z, 0.9);
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
