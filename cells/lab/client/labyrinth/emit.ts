/**
 * What the drawing is made with (mesh.ts, and the parts of it in roof.ts and facade.ts): the vertex's layout and the
 * materials it names, a cell's place in the drawing, and the means a part draws with, handed it by the mesh being made.
 */
import { CENTER, type World } from './model';
import type { Dress } from './model';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (MAT), its rising (when laid, the height it
 * grows from, how), and a seed for its stone's tone */
export const STRIDE = 12;
/** roof tiles: columns across a slope, a unit's width (render.ts lays them the same way, the caps on every other one) */
export const TILE_U = 7;
export const MAT = { stone: 0, within: 1, water: 2, leaves: 3, bark: 4, slab: 5, slabSide: 6, table: 7, court: 8, lamp: 9, clay: 10, door: 11, glass: 12, tile: 13, lead: 14, wood: 15 };
/** the land (the slab's own, marked: drawn barely, its steep faces rock) */
export const LANDMAT = MAT.slab + 16;
/** how far a foundation goes down into the land under what's built on it */
export const FOUND = 0.75;
/** a material cut through (with KIND × 3 over stone: a jali; over wood: a mashrabiya's lattice) */
export const PIERCED = 3 * 64;
/** a stone's dressing, over its material (stone, or the light within an arch): 16 moss, 32 ivy, 64 × which stone
 * (travertine, brick, marble) */
export const MOSS = 16, IVY = 32, KIND = 64;
/** what's taken up (select): tinted, and outlined where it meets what isn't */
export const SEL = 256;
export type V3 = [number, number, number];
/** a cell's corner in the drawing */
export const X = (i: number) => i - CENTER, Z = (j: number) => j - CENTER;
/** where a part's vertices go: when it was laid, how it grows in, its tone, its dressing, whether it's taken up */
export interface Cur { born: number; pivot: number; how: number; tone: number; dress: number; sel: boolean }
/** the means a part draws with, from the mesh being made: its world, what's taken up and how each cell's dressed, the
 * vertex now being laid (`cur`), and the ways to lay triangles, faces, boxes and turned shapes */
export interface Emit {
  w: World; selected: Set<number>; dressed: (k: number, i: number, j: number) => Dress | null | undefined;
  cur: Cur;
  vert: (p: V3, n: V3, ao: number, mat: number) => void;
  quad: (a: V3, b: V3, c: V3, d: V3, n: V3, ao: number[] | number, mat: number) => void;
  tri: (a: V3, b: V3, c: V3, n: V3, ao: number, mat: number) => void;
  face: (p: V3[], mat: number, ao?: number, up?: boolean, from?: V3) => void;
  box: (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: number, ao?: number[] | number) => void;
  lathe: (cx: number, cz: number, rings: Array<[number, number]>, mat: number, seg?: number) => void;
}
