/**
 * Roof Jumps' city: geometry only, nothing about how it looks.
 *
 * The world is an endless plane of chunks (CHUNK metres square), each made from the seed and its own coordinates
 * alone, so any chunk can be made at any time, in any order, and is always the same. A chunk is a list of boxes on a
 * one-metre lattice: axis-aligned, standing on the ground or on a roof, each with a tag saying what it is (a building,
 * a raised part of its roof, the rim round it, a stair hut, a unit, a tank, a wall across an alley). Building heights are whole storeys.
 *
 * Beside the boxes, and made with them, a chunk has its holds: the places a hand or a foot can take. They are tagged,
 * not drawn: a line each (every box's top edges; the middle of anything narrow, a rail; and on a building's faces, on
 * most of them, a sill at each storey, on some a pipe from the ground to the roof; and each wall itself, whole), with
 * the way it faces and what it is for, by hand and by foot. A mover
 * asks what is in reach (`holdsNear`, `gripAt`) and what it does depends on what is there.
 *
 * That list is the whole interface. The sim asks one question of it (`heightAt`: how high is the top surface here);
 * a renderer turns the boxes into whatever it likes. Nothing here knows about colour, light or triangles.
 */
import { hash, seeded } from '../kit/rng';
import type { Rand } from '../kit/rng';
import { furnish } from './parts';
import type { PartCtx } from './parts';

/** a chunk's side (m) */
export const CHUNK = 64;
/** a storey (m): every building is a whole number of these */
export const STOREY = 3;
/** the buckets a chunk's boxes are sorted into, for `heightAt` (m) */
const CELL = 8, CELLS = CHUNK / CELL;

export const TAG = { GROUND: 0, BUILDING: 1, STEP: 2, HUT: 3, UNIT: 4, TANK: 5, PLAYER: 6, RIM: 7, BEAM: 8, STAIR: 9, BAR: 10, DEBRIS: 11, CLUTTER: 12, SKYLIGHT: 13, SLAB: 14,
  /** the details' (dressing.ts): drawn only */
  WINDOW: 15, PIPE: 16, SIGN: 17, WIRE: 18, POLE: 19, AWNING: 20, NEON: 21, RUST: 22, FURNITURE: 23, CLOTH: 24, RUNGS: 25 } as const;
export type Tag = (typeof TAG)[keyof typeof TAG];

/** a box; `fixture` for the small things fixed to a face (a unit, a sign, a balcony, a fire escape's parts): drawn as detail */
export interface Box { x0: number; z0: number; x1: number; z1: number; y0: number; y1: number; tag: Tag; fixture?: true; /** drawn: its own number (else one from where it stands); only its face out that way (a pane, a streak) */ seed?: number; flat?: [number, number] }

/**
 * An authored course (a scene to study): its boxes in place of chunk (0, 0)'s, holds added by hand (no sills or pipes by
 * dice, no ground detail, no bars of its own: only what's written), bars as hold and prop together, where to start, and
 * whether the rest of the city is there or empty street.
 */
export interface Course {
  boxes: Box[];
  holds?: { kind: HoldKind; ax: number; ay: number; az: number; bx: number; by: number; bz: number; nx: number; nz: number }[];
  bars?: { x0: number; x1: number; z0: number; z1: number; y: number }[];
  start: { x: number; z: number };
  alone?: boolean;
}

export type HoldKind = 'edge' | 'rail' | 'sill' | 'pipe' | 'face' | 'bar' | 'ledge' | 'ac' | 'sign' | 'balcony' | 'escape' | 'railing';
/**
 * Somewhere to put a hand or a foot: a line from a to b, facing (nx, nz) (level, out from the wall; 0, 0 for a rail).
 * A face is the one that isn't a line: the whole of a wall, from a at its foot to b at its top.
 * What each is for, by hand and by foot (empty: not for that):
 *
 *   edge  hand: grab   foot: push off, land on      rail  hand: plant   foot: balance along
 *   sill  hand: grab   foot: toe                    face  hand: steady  foot: tread (run along, run up, kick off)
 *   pipe  hand: grip   foot: clamp                  bar   hand: swing (a pipe across an alley, under which to go)
 *   ledge hand: grab, shimmy  foot: stand (a stone band across a face: two hands, along it, toes on it)
 *   ac    hand: grab (short)  foot: step (a unit under a window: its top's front edge)
 *   sign  hand: hang (short)  foot: none (a bracket out from the wall: a bar to hang from, one hand or two along it)
 *   balcony hand: grab, shimmy  foot: stand (its rail: a good grip, and a slab under it to put the feet on)
 *   escape hand: grab  foot: stand on the rail itself (a fire escape's landing rail, a storey apart, climbed rail to rail)
 *   railing hand: plant (a hop over it), grab  foot: balance (a roof edge's railing: its top rail, a metre up; drawn, not solid)
 */
export interface Hold { kind: HoldKind; hand: string; foot: string; ax: number; ay: number; az: number; bx: number; by: number; bz: number; nx: number; nz: number }
export const USES: Record<HoldKind, { hand: string; foot: string }> = {
  ledge: { hand: 'grab', foot: 'stand' }, ac: { hand: 'grab', foot: 'step' }, sign: { hand: 'hang', foot: '' }, balcony: { hand: 'grab', foot: 'stand' }, escape: { hand: 'grab', foot: 'stand' }, railing: { hand: 'plant', foot: 'balance' },
  edge: { hand: 'grab', foot: 'push' }, sill: { hand: 'grab', foot: 'toe' }, pipe: { hand: 'grip', foot: 'clamp' }, rail: { hand: 'plant', foot: 'balance' }, face: { hand: 'steady', foot: 'tread' }, bar: { hand: 'swing', foot: '' },
};
/** a hold, and the point on it nearest what was asked */
export interface Grip { hold: Hold; x: number; y: number; z: number; d: number }

/** a chunk: its boxes (what's stood on, on the lattice), what's drawn but not stood on (`props`: the bars across alleys and
 * their posts, thin and off the lattice), the buckets for heightAt, the holds and theirs */
/**
 * Ground detail on a roof: not boxes to stand on (the surface is the roof's), but places the feet mind. Debris (rubble,
 * loose tiles: a foot isn't put on it), clutter (pipe runs, vents, low curbs: stepped over, the knee high), no-go (a
 * skylight, a fragile panel: never stood on). Drawn as thin props; asked of with `regionsNear`.
 */
export type RegionKind = 'debris' | 'clutter' | 'nogo';
export interface Region { kind: RegionKind; x0: number; z0: number; x1: number; z1: number; y: number }
/**
 * The city's details, tagged for the looks to come (none draws them yet; `?details` shows them as lines): what a dense city
 * has on and about its buildings that the references show and that isn't a box, a hold or a fixture already. Each a kind, its
 * points (a line or a run: a pipe's bends, a wire's sag; or one point, its foot), the way it faces (out from its face; 0, 0
 * standing free), its size (`w` across, `h` up), a number of its own to vary by, and for some how many and how many lit.
 *
 *   on a face   windows (a storey's row: `count`, `lit` of them), pipes (a bundle of `count`, up and across with its bends),
 *               ladder, blade (a sign standing out from the face), rust (a streak down from a unit or a bend), awning and
 *               neon (over a shopfront at street level)
 *   on a roof   billboard (a board on a frame, facing out), aerial, dish, laundry (a line strung across)
 *   in the street  pole, wire (pole to pole, and down to a face), vending (a machine against a face), bin
 */
export type DetailKind = 'windows' | 'pipes' | 'ladder' | 'blade' | 'rust' | 'awning' | 'neon' | 'billboard' | 'aerial' | 'dish' | 'laundry' | 'pole' | 'wire' | 'vending' | 'bin';
export interface Detail { kind: DetailKind; pts: [number, number, number][]; n: [number, number]; w: number; h: number; seed: number; count?: number; lit?: number; /** the holds it is (what's seen of them: a bundle's runs, a ladder, the sill under a row of windows, the unit rust runs from) */ holds?: Hold[] }
export interface Chunk { cx: number; cz: number; boxes: Box[]; props: Box[]; cells: number[][]; holds: Hold[]; hcells: number[][]; regions: Region[]; details: Detail[] }

const key = (cx: number, cz: number) => `${cx},${cz}`;

export class City {
  private chunks = new Map<string, Chunk>();
  constructor(readonly seed: number, readonly practiceLine = false, readonly course: Course | null = null) {}

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
      // (across the gap, now and then, a wall a metre thick, about as high as the roofs it joins: a ledge to run along)
      if (gap > 0 && rand() < 0.55) {
        const p = int(1, (alongX ? d : w) - 2), g0 = (alongX ? x0 : z0) + at;
        const bx0 = alongX ? g0 : x0 + p, bz0 = alongX ? z0 + p : g0, bx1 = alongX ? g0 + gap : bx0 + 1, bz1 = alongX ? bz0 + 1 : g0 + gap;
        boxes.push({ x0: bx0, z0: bz0, x1: bx1, z1: bz1, y0: 0, y1: STOREY * Math.max(1, Math.round(2 + 4 * this.relief(bx0, bz0))), tag: TAG.BEAM });
      }
      if (alongX) { split(x0, z0, x0 + at, z1, depth + 1); split(x0 + at + gap, z0, x1, z1, depth + 1); }
      else { split(x0, z0, x1, z0 + at, depth + 1); split(x0, z0 + at + gap, x1, z1, depth + 1); }
    };
    const authored = !!this.course && cx === 0 && cz === 0;
    if (authored) boxes.push(...this.course!.boxes.map((b) => ({ ...b })));
    else if (this.course?.alone) { /* (the rest: empty street) */ }
    else if (this.practiceLine && cx === 0 && cz === 0) {
      // Four roofs share the city's ordinary collision, holds and render geometry.
      for (const [z0, z1, y1] of [[1, 16, 12], [19, 32, 12], [34, 52, 9], [55, 63, 9]]) {
        boxes.push({ x0: 24, x1: 40, z0, z1, y0: 0, y1, tag: TAG.BUILDING });
      }
      boxes.push({ x0: 37, x1: 40, z0: 4, z1: 15, y0: 12, y1: 17, tag: TAG.HUT });
    } else split(ox + this.margin(cx, cz, 0), oz + this.margin(cx, cz, 1), ox + CHUNK - this.margin(cx + 1, cz, 0), oz + CHUNK - this.margin(cx, cz + 1, 1), 0);
    // (walkways: across some alleys two to four metres wide between roofs of a height, a metre-wide bridge at roof height, open
    // beneath (a slab: the alley under it is still the alley), railed both sides; by their own dice, so the rest is as it was)
    if (!authored && !this.course?.alone && !(this.practiceLine && cx === 0 && cz === 0)) {
      const wr = seeded(hash(this.seed, cx, cz, 79)), blds0 = boxes.filter((b) => b.tag === TAG.BUILDING);
      for (const a of blds0) for (const b of blds0) {
        if (a === b || a.y1 !== b.y1) continue;
        for (const ax of [0, 1]) {
          const gap = ax === 0 ? b.x0 - a.x1 : b.z0 - a.z1, lo = ax === 0 ? Math.max(a.z0, b.z0) : Math.max(a.x0, b.x0), hi = ax === 0 ? Math.min(a.z1, b.z1) : Math.min(a.x1, b.x1);
          if (gap < 2 || gap > 4 || hi - lo < 4 || wr() > 0.22) continue;
          const m = Math.round((lo + hi) / 2) - 1, H = a.y1;
          // (its ends on bare roof: nothing standing at either end of it)
          const bare = (x: number, z: number) => { let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h === H; };
          const e0 = ax === 0 ? [a.x1 - 0.5, m + 0.5] : [m + 0.5, a.z1 - 0.5], e1 = ax === 0 ? [b.x0 + 0.5, m + 0.5] : [m + 0.5, b.z0 + 0.5];
          if (!bare(e0[0], e0[1]) || !bare(e1[0], e1[1])) continue;
          // (and the alley open all the way across under it and over it: nothing standing in its way)
          const w: Box = ax === 0 ? { x0: a.x1, x1: b.x0, z0: m, z1: m + 1, y0: H - 1, y1: H, tag: TAG.SLAB } : { x0: m, x1: m + 1, z0: a.z1, z1: b.z0, y0: H - 1, y1: H, tag: TAG.SLAB };
          if (boxes.some((o) => o !== a && o !== b && o.x0 < w.x1 && o.x1 > w.x0 && o.z0 < w.z1 && o.z1 > w.z0)) continue;
          boxes.push(ax === 0 ? { x0: a.x1, x1: b.x0, z0: m, z1: m + 1, y0: H - 1, y1: H, tag: TAG.SLAB } : { x0: m, x1: m + 1, z0: a.z1, z1: b.z0, y0: H - 1, y1: H, tag: TAG.SLAB });
        }
      }
    }
    // (bucketed, for heightAt)
    const cells: number[][] = Array.from({ length: CELLS * CELLS }, () => []);
    boxes.forEach((b, i) => {
      const a0 = Math.max(0, Math.floor((b.x0 - ox) / CELL)), a1 = Math.min(CELLS - 1, Math.floor((b.x1 - ox - 1e-6) / CELL));
      const c0 = Math.max(0, Math.floor((b.z0 - oz) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((b.z1 - oz - 1e-6) / CELL));
      for (let a = a0; a <= a1; a++) for (let c = c0; c <= c1; c++) cells[c * CELLS + a].push(i);
    });
    // (furnished: everything a chunk has once its boxes are laid out (holds, what's drawn, ground detail, tagged details) made
    // by its parts, in order, each by its own dice: see parts.ts)
    const furnished: PartCtx = { seed: this.seed, cx, cz, boxes, holds: [], props: [], regions: [], details: [], authored, course: this.course, practiceLine: this.practiceLine, practice: this.practiceLine && cx === 0 && cz === 0, alone: !authored && !!this.course?.alone };
    furnish(furnished);
    const { holds, props, regions, details } = furnished;
    const hcells: number[][] = Array.from({ length: CELLS * CELLS }, () => []);
    holds.forEach((h, i) => {
      const a0 = Math.max(0, Math.floor((Math.min(h.ax, h.bx) - ox) / CELL)), a1 = Math.min(CELLS - 1, Math.floor((Math.max(h.ax, h.bx) - ox) / CELL));
      const c0 = Math.max(0, Math.floor((Math.min(h.az, h.bz) - oz) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((Math.max(h.az, h.bz) - oz) / CELL));
      for (let a = a0; a <= a1; a++) for (let c = c0; c <= c1; c++) hcells[c * CELLS + a].push(i);
    });
    return { cx, cz, boxes, props, cells, holds, hcells, regions, details };
  }


  /** the details about (x, z) within `r` (by their first point), from the chunks there */
  detailsNear(x: number, z: number, r: number): Detail[] {
    const out: Detail[] = [];
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++)
      for (const d of this.chunk(cx, cz).details) if (Math.hypot(d.pts[0][0] - x, d.pts[0][2] - z) <= r) out.push(d);
    return out;
  }


  /** The holds with anything within `r` of (x, z) (roughly: by the buckets they lie in). */
  holdsNear(x: number, z: number, r: number): Hold[] {
    const out = new Set<Hold>();
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++) {
      const c = this.chunk(cx, cz), ox = cx * CHUNK, oz = cz * CHUNK;
      const a0 = Math.max(0, Math.floor((x - r - ox) / CELL)), a1 = Math.min(CELLS - 1, Math.floor((x + r - ox) / CELL));
      const c0 = Math.max(0, Math.floor((z - r - oz) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((z + r - oz) / CELL));
      for (let a = a0; a <= a1; a++) for (let b = c0; b <= c1; b++) for (const i of c.hcells[b * CELLS + a]) out.add(c.holds[i]);
    }
    return [...out];
  }

  /** The nearest point on any hold to (x, y, z) within `r`, of those `ok` allows. */
  gripAt(x: number, y: number, z: number, r: number, ok?: (h: Hold) => boolean): Grip | null {
    let best: Grip | null = null;
    for (const h of this.holdsNear(x, z, r)) {
      if (ok && !ok(h)) continue;
      let px: number, py: number, pz: number;
      const dx = h.bx - h.ax, dy = h.by - h.ay, dz = h.bz - h.az;
      if (h.kind === 'face') {
        // (a wall: the nearest point of all of it)
        const t = Math.max(0, Math.min(1, ((x - h.ax) * dx + (z - h.az) * dz) / (dx * dx + dz * dz || 1)));
        px = h.ax + dx * t; pz = h.az + dz * t; py = Math.max(h.ay, Math.min(h.by, y));
      } else {
        const l2 = dx * dx + dy * dy + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((x - h.ax) * dx + (y - h.ay) * dy + (z - h.az) * dz) / l2)) : 0;
        px = h.ax + dx * t; py = h.ay + dy * t; pz = h.az + dz * t;
      }
      const d = Math.hypot(px - x, py - y, pz - z);
      if (d <= r && (!best || d < best.d)) best = { hold: h, x: px, y: py, z: pz, d };
    }
    return best;
  }

  /** one lot: its building, and what stands on its roof */
  private lot(boxes: Box[], rand: Rand, int: (a: number, b: number) => number, x0: number, z0: number, x1: number, z1: number): void {
    let w = x1 - x0, d = z1 - z0;
    // (low and close: two to six storeys, a neighbour mostly within one of it)
    let storeys = Math.round(2 + 4 * this.relief((x0 + x1) / 2, (z0 + z1) / 2)) + [-1, 0, 0, 1][int(0, 3)];
    if (rand() < 0.04) storeys += int(2, 4);
    const H = Math.max(1, storeys) * STOREY;
    // (a stair up one side, now and then, on a taller one: a storey a step, a metre deep, as an iron stair up a wall would
    // go if the city were all boxes; the building drawn in a metre to make room for it)
    const steps = Math.round(H / STOREY) - 1;
    if (steps >= 2 && rand() < 0.18) {
      const L = 2, along = w >= steps * L + 1 ? 'x' : d >= steps * L + 1 ? 'z' : '';
      if (along) {
        const low = rand() < 0.5, rev = rand() < 0.5;
        for (let k = 1; k <= steps; k++) {
          const a = rev ? (along === 'x' ? x1 : z1) - k * L : (along === 'x' ? x0 : z0) + (k - 1) * L;
          if (along === 'x') boxes.push({ x0: a, x1: a + L, z0: low ? z0 : z1 - 1, z1: low ? z0 + 1 : z1, y0: 0, y1: k * STOREY, tag: TAG.STAIR });
          else boxes.push({ z0: a, z1: a + L, x0: low ? x0 : x1 - 1, x1: low ? x0 + 1 : x1, y0: 0, y1: k * STOREY, tag: TAG.STAIR });
        }
        if (along === 'x') { if (low) z0 += 1; else z1 -= 1; } else { if (low) x0 += 1; else x1 -= 1; }
      }
    }
    w = x1 - x0; d = z1 - z0;
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

  /** The ground detail with anything within `r` of (x, z). */
  regionsNear(x: number, z: number, r: number): Region[] {
    const out: Region[] = [];
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++)
      for (const g of this.chunk(cx, cz).regions) if (x + r > g.x0 && x - r < g.x1 && z + r > g.z0 && z - r < g.z1) out.push(g);
    return out;
  }
  /** the ground detail at a point on a surface at height y, if any */
  regionAt(x: number, y: number, z: number): Region | null {
    for (const g of this.regionsNear(x, z, 0.01)) if (Math.abs(g.y - y) < 0.05 && x >= g.x0 && x < g.x1 && z >= g.z0 && z < g.z1) return g;
    return null;
  }

  /** The boxes with anything within `r` of (x, z) (by the buckets they lie in): for a body's own extent against them. */
  boxesNear(x: number, z: number, r: number): Box[] {
    const out = new Set<Box>();
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) for (let cz = Math.floor((z - r) / CHUNK); cz <= Math.floor((z + r) / CHUNK); cz++) {
      const c = this.chunk(cx, cz), ox = cx * CHUNK, oz = cz * CHUNK;
      const a0 = Math.max(0, Math.floor((x - r - ox) / CELL)), a1 = Math.min(CELLS - 1, Math.floor((x + r - ox) / CELL));
      const c0 = Math.max(0, Math.floor((z - r - oz) / CELL)), c1 = Math.min(CELLS - 1, Math.floor((z + r - oz) / CELL));
      for (let a = a0; a <= a1; a++) for (let b = c0; b <= c1; b++) for (const i of c.cells[b * CELLS + a]) out.add(c.boxes[i]);
    }
    return [...out];
  }

  /** the height of the top surface at a point (0: the street) */
  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), c = this.chunk(cx, cz);
    const a = Math.min(CELLS - 1, Math.floor((x - cx * CHUNK) / CELL)), b = Math.min(CELLS - 1, Math.floor((z - cz * CHUNK) / CELL));
    let h = 0;
    for (const i of c.cells[b * CELLS + a]) { const o = c.boxes[i]; if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && o.y1 > h && !(o.tag === TAG.SLAB && o.y0 > this.refY + 0.45)) h = o.y1; }
    return h;
  }
  /**
   * The city is asked as a height field (the top of what's at a point), which has no undersides. A slab (a landing, a
   * floor with space beneath it) is the exception: it's floor only for a body at its underside or above (within a step:
   * `refY`, the height of the body asking, which the runner sets each step); beneath it, it's open, and a ceiling
   * (`ceilingAt`).
   */
  refY = Infinity;
  /** the underside of a slab over (x, z) that a body standing at `y` would put its head into (Infinity if none) */
  ceilingAt(x: number, y: number, z: number): number {
    let c = Infinity;
    for (const o of this.boxesNear(x, z, 0.01)) if (o.tag === TAG.SLAB && x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && o.y0 > y + 0.45 && o.y0 < c) c = o.y0;
    return c;
  }
  /** what's near (x, y, z) within `r`, as faces a limb could put itself against: the nearest point on each box, and the way
   * its face there looks (out of it; down from an underside) */
  facesNear(x: number, y: number, z: number, r: number): { p: [number, number, number]; n: [number, number, number]; box: Box }[] {
    const out: { p: [number, number, number]; n: [number, number, number]; box: Box }[] = [];
    for (const b of this.boxesNear(x, z, r)) {
      const px = Math.max(b.x0, Math.min(b.x1, x)), py = Math.max(b.y0, Math.min(b.y1, y)), pz = Math.max(b.z0, Math.min(b.z1, z));
      const dx = x - px, dy = y - py, dz = z - pz, d = Math.hypot(dx, dy, dz);
      if (d > r || d < 1e-6) continue;
      out.push({ p: [px, py, pz], n: [dx / d, dy / d, dz / d], box: b });
    }
    return out;
  }

  /** the box whose top is the surface at a point, if any */
  topAt(x: number, z: number): Box | null {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), c = this.chunk(cx, cz);
    const a = Math.min(CELLS - 1, Math.floor((x - cx * CHUNK) / CELL)), b = Math.min(CELLS - 1, Math.floor((z - cz * CHUNK) / CELL));
    let top: Box | null = null;
    for (const i of c.cells[b * CELLS + a]) { const o = c.boxes[i]; if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && (!top || o.y1 > top.y1)) top = o; }
    return top;
  }

  /** a roof to start on, near the origin: the middle of the biggest building of chunk (0, 0) */
  start(): { x: number; y: number; z: number } {
    if (this.course) { const { x, z } = this.course.start; return { x, y: this.heightAt(x, z), z }; }
    if (this.practiceLine) return { x: 32, y: 12, z: 5 };
    let best: Box | null = null;
    for (const b of this.chunk(0, 0).boxes) if (b.tag === TAG.BUILDING && (!best || (b.x1 - b.x0) * (b.z1 - b.z0) > (best.x1 - best.x0) * (best.z1 - best.z0))) best = b;
    const x = best ? (best.x0 + best.x1) / 2 : 0, z = best ? (best.z0 + best.z1) / 2 : 0;
    return { x, y: this.heightAt(x, z), z };
  }
}
