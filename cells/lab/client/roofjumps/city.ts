/**
 * Roof Jumps' city: geometry only, nothing about how it looks.
 *
 * The world is an endless plane of chunks (CHUNK metres square), each made from the seed and its own coordinates
 * alone, so any chunk can be made at any time, in any order, and is always the same. A chunk is a list of boxes on a
 * one-metre lattice: axis-aligned, standing on the ground or on a roof, each with a tag saying what it is (a building,
 * a raised part of its roof, the rim round it, a stair hut, a unit, a tank). Building heights are whole storeys.
 *
 * That list is the whole interface. The sim asks one question of it (`heightAt`: how high is the top surface here);
 * a renderer turns the boxes into whatever it likes. Nothing here knows about colour, light or triangles.
 */
import { hash, seeded } from '../kit/rng';
import type { Rand } from '../kit/rng';

/** a chunk's side (m) */
export const CHUNK = 64;
/** a storey (m): every building is a whole number of these */
export const STOREY = 3;
/** the buckets a chunk's boxes are sorted into, for `heightAt` (m) */
const CELL = 8, CELLS = CHUNK / CELL;

export const TAG = { GROUND: 0, BUILDING: 1, STEP: 2, HUT: 3, UNIT: 4, TANK: 5, PLAYER: 6, RIM: 7 } as const;
export type Tag = (typeof TAG)[keyof typeof TAG];

export interface Box { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; tag: Tag }

export interface Chunk { cx: number; cz: number; boxes: Box[]; cells: number[][] }

const key = (cx: number, cz: number) => `${cx},${cz}`;

export class City {
  private chunks = new Map<string, Chunk>();
  constructor(readonly seed: number) {}

  /** smooth 0..1 over the plane: the skyline's rise and fall */
  private relief(x: number, z: number): number {
    const S = 150, fx = x / S, fz = z / S, ix = Math.floor(fx), iz = Math.floor(fz);
    const u = fx - ix, v = fz - iz, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const n = (i: number, j: number) => hash(this.seed, 77, i, j) / 4294967296;
    return (n(ix, iz) * (1 - su) + n(ix + 1, iz) * su) * (1 - sv) + (n(ix, iz + 1) * (1 - su) + n(ix + 1, iz + 1) * su) * sv;
  }

  /** half the street along a chunk's west (axis 0) or south (axis 1) edge: shared by the two chunks it lies between */
  private margin(cx: number, cz: number, axis: number): number { return 1 + (hash(this.seed, 5, cx, cz, axis) % 3); }

  chunk(cx: number, cz: number): Chunk {
    const k = key(cx, cz);
    let c = this.chunks.get(k);
    if (!c) { c = this.make(cx, cz); this.chunks.set(k, c); }
    return c;
  }

  /** forget chunks further than `r` chunks from (cx, cz) */
  evict(cx: number, cz: number, r: number): void {
    for (const [k, c] of this.chunks) if (Math.abs(c.cx - cx) > r || Math.abs(c.cz - cz) > r) this.chunks.delete(k);
  }

  private make(cx: number, cz: number): Chunk {
    const rand = seeded(hash(this.seed, cx, cz));
    const ox = cx * CHUNK, oz = cz * CHUNK, boxes: Box[] = [];
    const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
    // (the lots: the chunk inside its streets, split in two again and again, a street, an alley or nothing between)
    const MIN = 4;
    const split = (x0: number, z0: number, x1: number, z1: number, depth: number): void => {
      const w = x1 - x0, d = z1 - z0, max = int(7, 14);
      const gap = depth === 0 ? int(4, 6) : [0, 1, 1, 2, 2, 3][int(0, 5)];
      const alongX = w >= d;
      const len = alongX ? w : d;
      if ((w <= max && d <= max) || len < 2 * MIN + gap) { this.lot(boxes, rand, int, x0, z0, x1, z1); return; }
      const at = int(MIN, len - gap - MIN);
      if (alongX) { split(x0, z0, x0 + at, z1, depth + 1); split(x0 + at + gap, z0, x1, z1, depth + 1); }
      else { split(x0, z0, x1, z0 + at, depth + 1); split(x0, z0 + at + gap, x1, z1, depth + 1); }
    };
    split(ox + this.margin(cx, cz, 0), oz + this.margin(cx, cz, 1), ox + CHUNK - this.margin(cx + 1, cz, 0), oz + CHUNK - this.margin(cx, cz + 1, 1), 0);
    // (bucketed, for heightAt)
    const cells: number[][] = Array.from({ length: CELLS * CELLS }, () => []);
    boxes.forEach((b, i) => {
      const a0 = Math.max(0, Math.floor((b.x0 - ox) / CELL)), a1 = Math.min(CELLS - 1, Math.floor((b.x1 - ox - 1e-6) / CELL));
      const c0 = Math.max(0, Math.floor((b.z0 - oz) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((b.z1 - oz - 1e-6) / CELL));
      for (let a = a0; a <= a1; a++) for (let c = c0; c <= c1; c++) cells[c * CELLS + a].push(i);
    });
    return { cx, cz, boxes, cells };
  }

  /** one lot: its building, and what stands on its roof */
  private lot(boxes: Box[], rand: Rand, int: (a: number, b: number) => number, x0: number, z0: number, x1: number, z1: number): void {
    const w = x1 - x0, d = z1 - z0;
    // (low and close: two to six storeys, a neighbour mostly within one of it)
    let storeys = Math.round(2 + 4 * this.relief((x0 + x1) / 2, (z0 + z1) / 2)) + [-1, 0, 0, 1][int(0, 3)];
    if (rand() < 0.04) storeys += int(2, 4);
    const H = Math.max(1, storeys) * STOREY;
    boxes.push({ x0, z0, x1, z1, y0: 0, y1: H, tag: TAG.BUILDING });
    // (a rim round the roof, a metre high and thick: something to go over at every edge)
    if (rand() < 0.3 && w >= 6 && d >= 6) {
      const rim = (a: number, b: number, c: number, e: number) => boxes.push({ x0: a, z0: b, x1: c, z1: e, y0: H, y1: H + 1, tag: TAG.RIM });
      rim(x0, z0, x1, z0 + 1); rim(x0, z1 - 1, x1, z1); rim(x0, z0 + 1, x0 + 1, z1 - 1); rim(x1 - 1, z0 + 1, x1, z1 - 1);
    }
    // (a raised part: one side of the roof, or a corner of it, a storey up)
    let step: Box | null = null;
    if (rand() < 0.3 && w >= 8 && d >= 8) {
      const sx = rand() < 0.5 ? w : int(4, w - 4), sz = sx === w ? int(4, d - 4) : rand() < 0.5 ? d : int(4, d - 4);
      const ax = rand() < 0.5 ? x0 : x1 - sx, az = rand() < 0.5 ? z0 : z1 - sz;
      step = { x0: ax, z0: az, x1: ax + sx, z1: az + sz, y0: H, y1: H + STOREY, tag: TAG.STEP };
      boxes.push(step);
    }
    // (what stands on it: each from the roof under its middle, so nothing floats and nothing is buried)
    const stand = (pw: number, pd: number, h: number, tag: Tag) => {
      if (w < pw + 2 || d < pd + 2) return;
      const px = int(x0 + 1, x1 - 1 - pw), pz = int(z0 + 1, z1 - 1 - pd), mx = px + pw / 2, mz = pz + pd / 2;
      const on = step && mx > step.x0 && mx < step.x1 && mz > step.z0 && mz < step.z1 ? step.y1 : H;
      boxes.push({ x0: px, z0: pz, x1: px + pw, z1: pz + pd, y0: H, y1: on + h, tag });
    };
    if (rand() < 0.35 && w * d >= 48) stand(3, 3, 3, TAG.HUT);
    for (let n = int(0, Math.min(3, Math.floor((w * d) / 20))); n > 0; n--) { const t = rand() < 0.5; stand(t ? 2 : 1, t ? 1 : 2, 1, TAG.UNIT); }
    if (rand() < 0.1) stand(2, 2, 3, TAG.TANK);
  }

  /** the height of the top surface at a point (0: the street) */
  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), c = this.chunk(cx, cz);
    const a = Math.min(CELLS - 1, Math.floor((x - cx * CHUNK) / CELL)), b = Math.min(CELLS - 1, Math.floor((z - cz * CHUNK) / CELL));
    let h = 0;
    for (const i of c.cells[b * CELLS + a]) { const o = c.boxes[i]; if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && o.y1 > h) h = o.y1; }
    return h;
  }

  /** a roof to start on, near the origin: the middle of the biggest building of chunk (0, 0) */
  start(): { x: number; y: number; z: number } {
    let best: Box | null = null;
    for (const b of this.chunk(0, 0).boxes) if (b.tag === TAG.BUILDING && (!best || (b.x1 - b.x0) * (b.z1 - b.z0) > (best.x1 - best.x0) * (best.z1 - best.z0))) best = b;
    const x = best ? (best.x0 + best.x1) / 2 : 0, z = best ? (best.z0 + best.z1) / 2 : 0;
    return { x, y: this.heightAt(x, z), z };
  }
}
