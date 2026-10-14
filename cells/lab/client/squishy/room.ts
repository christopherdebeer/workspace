/**
 * Squishy: the kitchen round the course: drawn here, and what of it is over the counter solid (runSolids), to
 * land on or be stopped by. A run of kitchen along a wall: the base
 * cupboards under the counter (a drawer over each door, shaker panels, bar handles, the kick board), the wall
 * cupboards over it with windows between them (their sills, herbs in pots on them), a range at one end (its hob,
 * its oven door with a window in it and a handle across, its knobs, a hood over it), and at the other the counter
 * run on, a microwave on it, then a tall fridge (its two doors, their handles, magnets on it). Out in the room, a
 * table with a gingham cloth and its chairs. At the table, the same run along the room's back wall.
 */
import { MAT, type V3 } from './level';
import { box, capsule, cylinder, quad } from './mesh';

/** A run of kitchen along a wall at zb (facing -z), its counter's front at zf, its top at yt, the floor at g, the counter from xa to xb. */
export interface Run {
  xa: number; xb: number; zf: number; zb: number; yt: number; g: number;
  /** where windows are already (a course's own, by a sill): none of the run's here, nor cupboards over them */
  avoid: number[];
  /** draw the counter's top too (it's not the course's own); and its material */
  top?: number;
}
const CAB = 60, DOOR_GAP = 1.2;

/** Where a run's things go: the range's and the fridge's ends, the counter's run on past the course, the wall cupboards' spans and the windows between them. */
export interface RunLayout { ext: number; rx0: number; rx1: number; fx0: number; fx1: number; wy0: number; wy1: number; wf: number; windows: number[]; cupboards: Array<[number, number]> }
export function runLayout(o: Run): RunLayout {
  const { xa, xb, zb, yt } = o;
  const ext = 64, fx0 = xb + ext + 2, fx1 = fx0 + 74, rx0 = xa - 76, rx1 = xa - 2;
  const wy0 = yt + 76, wy1 = yt + 142, wf = zb - 33;
  const windows: number[] = [];
  for (let x = xa + 70; x < xb - 30; x += 240) if (!o.avoid.some((a) => Math.abs(a - x) < 100)) windows.push(x);
  // (the cupboards, each as wide as it can be up to its slot, cut short by a window, the hood, or what the course
  // has on the wall; not one too narrow to be a cupboard)
  const gaps: Array<[number, number]> = [...windows.map((wx): [number, number] => [wx - 62, wx + 62]), ...o.avoid.map((a): [number, number] => [a - 45, a + 45]), [rx0, rx1]];
  const cupboards: Array<[number, number]> = [];
  for (let x = rx0 - 60; x < fx0 - 2; x += CAB) {
    let segs: Array<[number, number]> = [[x, Math.min(fx0 - 2, x + CAB)]];
    for (const [g0, g1] of gaps) {
      const next: Array<[number, number]> = [];
      for (const [a, b] of segs) {
        if (b <= g0 || a >= g1) { next.push([a, b]); continue; }
        if (g0 > a) next.push([a, g0]);
        if (g1 < b) next.push([g1, b]);
      }
      segs = next;
    }
    for (const sg of segs) if (sg[1] - sg[0] >= 30) cupboards.push(sg);
  }
  return { ext, rx0, rx1, fx0, fx1, wy0, wy1, wf, windows, cupboards };
}
/** A box: its middle and half-sizes. */
export type Block = { c: V3; h: V3; mat: number };
/** A pot on a sill (and its herbs, a clump over it): x, z, its radius, its foot and its top, the clump's top. */
export type Pot = { x: number; z: number; r: number; y0: number; y1: number; top: number };
/**
 * What's solid in a run, over the counter and round it (what's under the counter's top is the fall): the
 * wall cupboards, the one over the fridge, the fridge, the microwave, the range's hood and chimney, each
 * window's sill; and the pots on the sills.
 */
export function runSolids(o: Run): { blocks: Block[]; pots: Pot[] } {
  const L = runLayout(o), { xb, zf, zb, yt, g } = o, blocks: Block[] = [], pots: Pot[] = [];
  for (const [x, x1] of L.cupboards) blocks.push({ c: [(x + x1) / 2, (L.wy0 + L.wy1) / 2, (L.wf + zb) / 2], h: [(x1 - x) / 2 - 0.3, (L.wy1 - L.wy0) / 2, (zb - L.wf) / 2], mat: MAT.cabinet });
  blocks.push(overFridge(L, zb, g), fridgeBody(L.fx0, L.fx1, zf - 3, zb, g), { c: [xb + L.ext / 2, yt + 14, zb - 21], h: [24, 14, 17], mat: MAT.fridge }, ...hood(L.rx0, L.rx1, zb, yt));
  for (const wx of L.windows) { blocks.push(sillOf(wx, yt + 40, zb, 96)); pots.push(...potsOf(wx, yt + 40, zb, 96)); }
  return { blocks, pots };
}
const overFridge = (L: RunLayout, zb: number, g: number): Block => ({ c: [(L.fx0 + L.fx1) / 2, (g + 192 + L.wy1) / 2, (L.wf + zb) / 2], h: [(L.fx1 - L.fx0) / 2, (L.wy1 - g - 192) / 2, (zb - L.wf) / 2], mat: MAT.cabinet });
const fridgeBody = (x0: number, x1: number, zf: number, zb: number, g: number): Block => ({ c: [(x0 + x1) / 2, g + 94, (zf + 2 + zb) / 2], h: [(x1 - x0) / 2, 94, (zb - zf - 2) / 2], mat: MAT.fridge });
const hood = (x0: number, x1: number, zb: number, yt: number): Block[] => [
  { c: [(x0 + x1) / 2, yt + 72, zb - 24], h: [(x1 - x0) / 2 + 2, 5, 24], mat: MAT.steel },
  { c: [(x0 + x1) / 2, yt + 112, zb - 14], h: [(x1 - x0) / 4, 35, 14], mat: MAT.steel },
];
const sillOf = (x: number, y0: number, zb: number, w: number): Block => ({ c: [x, y0 - 1.2, zb - 6], h: [w / 2 + 5, 1.2, 6], mat: MAT.porcelain });
const potsOf = (x: number, y0: number, zb: number, w: number): Pot[] =>
  ([[-0.3, 1], [0.05, 0.8], [0.33, 1.1]] as Array<[number, number]>).map(([px, s]) => ({ x: x + px * w, z: zb - 6, r: 4 * s, y0, y1: y0 + 7 * s, top: y0 + 13 * s }));

export function kitchenRun(out: number[], o: Run) {
  const { xa, xb, zf, zb, yt, g } = o;
  const L = runLayout(o), { ext, fx0, fx1, rx0, rx1, wy0, wy1, wf } = L;
  // the counter's top, if it's ours, and on past the course's to the fridge, the microwave on it
  if (o.top !== undefined) box(out, [(xa + xb) / 2, yt - 2, (zf + zb) / 2], [(xb - xa) / 2, 2, (zb - zf) / 2], 0, o.top);
  box(out, [xb + ext / 2, yt - 2, (zf + zb) / 2], [ext / 2, 2, (zb - zf) / 2], 0, o.top ?? MAT.counter);
  microwave(out, xb + ext / 2, yt, zb - 21);
  // the base cupboards, the whole run: their carcass, set back from the counter's edge, the kick board under it
  const ca = xa, cb = xb + ext, cf = zf + 3;
  box(out, [(ca + cb) / 2, (g + 10 + yt - 4) / 2, (cf + zb) / 2], [(cb - ca) / 2, (yt - 4 - g - 10) / 2, (zb - cf) / 2], 0, MAT.cabinet);
  box(out, [(ca + cb) / 2, g + 5, (cf + 5 + zb) / 2], [(cb - ca) / 2, 5, (zb - cf - 5) / 2], 0, MAT.legs);
  const n = Math.max(1, Math.round((cb - ca) / CAB)), w = (cb - ca) / n;
  for (let i = 0; i < n; i++) {
    const cx = ca + (i + 0.5) * w;
    // (a drawer over a door, each a frame with a panel in it, a bar handle on each)
    panel(out, cx, yt - 11, cf, w - DOOR_GAP * 2, 11, true);
    panel(out, cx, (g + 11 + yt - 18.5) / 2, cf, w - DOOR_GAP * 2, yt - 18.5 - g - 11, false);
  }
  range(out, rx0, rx1, zf, zb, yt, g);
  fridge(out, fx0, fx1, zf - 3, zb, g);
  // the wall cupboards and the windows between them, from over the range to over the fridge
  for (const [x, x1] of L.cupboards) {
    box(out, [(x + x1) / 2, (wy0 + wy1) / 2, (wf + zb) / 2], [(x1 - x) / 2 - 0.3, (wy1 - wy0) / 2, (zb - wf) / 2], 0, MAT.cabinet);
    panel(out, (x + x1) / 2, (wy0 + wy1) / 2, wf, x1 - x - DOOR_GAP * 2, wy1 - wy0 - 2, false, true);
  }
  // (over the fridge, a short one)
  const of = overFridge(L, zb, g);
  box(out, of.c, of.h, 0, MAT.cabinet);
  panel(out, (fx0 + fx1) / 2, (g + 192 + wy1) / 2, wf, fx1 - fx0 - 3, wy1 - g - 194, false, true);
  for (const wx of L.windows) window(out, wx, yt + 40, yt + 138, zb, 96);
}

/** A cupboard's front, centred at (cx, cy) on the plane z = f (facing -z), w by h: a frame, a raised panel in it, a bar handle (a drawer's across its middle; a door's up near its top, or, on a wall cupboard, near its foot). */
function panel(out: number[], cx: number, cy: number, f: number, w: number, h: number, drawer: boolean, wall = false) {
  box(out, [cx, cy, f - 0.8], [w / 2, h / 2, 0.8], 0, MAT.cabinet);
  const m = Math.min(6, Math.min(w, h) * 0.18);
  box(out, [cx, cy, f - 1.9], [w / 2 - m, h / 2 - m, 0.3], 0, MAT.cabinet);
  const hy = drawer ? cy : wall ? cy - h / 2 + 7 : cy + h / 2 - 7, hl = Math.min(8, w * 0.18);
  capsule(out, [cx - hl, hy, f - 3.4], [cx + hl, hy, f - 3.4], 0.55, MAT.steel, 8, 3);
  for (const s of [-1, 1]) capsule(out, [cx + s * hl, hy, f - 1.6], [cx + s * hl, hy, f - 3.4], 0.45, MAT.steel, 6, 2);
}

/** A range, x0 to x1: its body to the counter's height, an oven door (a window in it, a handle across its top), a row of knobs, a hob of four burners, a hood over it. */
function range(out: number[], x0: number, x1: number, zf: number, zb: number, yt: number, g: number) {
  const cx = (x0 + x1) / 2, w = x1 - x0;
  box(out, [cx, (g + yt) / 2, (zf + 1 + zb) / 2], [w / 2, (yt - g) / 2, (zb - zf - 1) / 2], 0, MAT.fridge);
  box(out, [cx, yt + 0.4, (zf + 1 + zb) / 2], [w / 2, 0.4, (zb - zf - 1) / 2], 0, MAT.hob);
  for (const [bx, bz, br] of [[-0.25, 0.3, 9], [0.25, 0.3, 7], [-0.25, 0.7, 7], [0.25, 0.7, 9]] as Array<[number, number, number]>) cylinder(out, cx + bx * w, zf + 1 + bz * (zb - zf - 1), br, yt + 0.8, yt + 1.3, MAT.burner, MAT.burner, 24);
  const dy0 = g + 14, dy1 = yt - 16;
  box(out, [cx, (dy0 + dy1) / 2, zf], [w / 2 - 3, (dy1 - dy0) / 2, 1], 0, MAT.fridge);
  box(out, [cx, (dy0 + dy1) / 2 + 2, zf - 1.1], [w / 2 - 12, (dy1 - dy0) / 2 - 12, 0.2], 0, MAT.pan);
  capsule(out, [x0 + 8, dy1 - 4, zf - 4], [x1 - 8, dy1 - 4, zf - 4], 0.8, MAT.steel, 8, 3);
  for (const s of [x0 + 8, x1 - 8]) capsule(out, [s, dy1 - 4, zf - 1], [s, dy1 - 4, zf - 4], 0.6, MAT.steel, 6, 2);
  for (let k = 0; k < 5; k++) capsule(out, [x0 + 10 + k * (w - 20) / 4, yt - 8, zf + 1], [x0 + 10 + k * (w - 20) / 4, yt - 8, zf - 1.4], 1.6, MAT.knob, 10, 3);
  // (its hood, and its chimney up the wall)
  for (const b of hood(x0, x1, zb, yt)) box(out, b.c, b.h, 0, b.mat);
}

/** A tall retro fridge, x0 to x1, its doors' face at zf: a freezer over the fridge, long handles, a few magnets. */
function fridge(out: number[], x0: number, x1: number, zf: number, zb: number, g: number) {
  const cx = (x0 + x1) / 2, w = x1 - x0, H = 188, split = g + 128, fb = fridgeBody(x0, x1, zf, zb, g);
  box(out, fb.c, fb.h, 0, MAT.fridge);
  for (const [y0, y1] of [[g + 3, split - 0.8], [split + 0.8, g + H - 3]]) {
    box(out, [cx, (y0 + y1) / 2, zf + 1], [w / 2 - 0.5, (y1 - y0) / 2, 1.2], 0, MAT.fridge);
    const hx = x0 + 6, hy0 = y1 > split + 1 ? y0 + 6 : y1 - 46, hy1 = y1 > split + 1 ? y0 + 30 : y1 - 8;
    capsule(out, [hx, hy0, zf - 3], [hx, hy1, zf - 3], 1, MAT.steel, 8, 3);
    for (const hy of [hy0, hy1]) capsule(out, [hx, hy, zf], [hx, hy, zf - 3], 0.7, MAT.steel, 6, 2);
  }
  // (magnets)
  for (const [mx, my, mat] of [[0.62, 0.55, MAT.lacquer], [0.78, 0.6, MAT.gold], [0.7, 0.47, MAT.plant], [0.55, 0.7, MAT.terracotta]] as Array<[number, number, number]>)
    capsule(out, [x0 + mx * w, g + my * H, zf - 0.2], [x0 + mx * w, g + my * H, zf - 0.9], 1.8, mat, 10, 2);
}

/** A microwave on the counter, centred at x, its back to the wall: its door's dark window, its buttons, a handle. */
function microwave(out: number[], x: number, yt: number, z: number) {
  const W = 48, H = 28, D = 34, f = z - D / 2;
  box(out, [x, yt + H / 2, z], [W / 2, H / 2, D / 2], 0, MAT.fridge);
  box(out, [x - 6, yt + H / 2, f - 0.2], [15, H / 2 - 5, 0.2], 0, MAT.pan);
  capsule(out, [x + 11, yt + 6, f - 1.6], [x + 11, yt + H - 6, f - 1.6], 0.7, MAT.steel, 6, 2);
  for (let k = 0; k < 6; k++) box(out, [x + 17 + (k % 2) * 3, yt + H - 7 - Math.floor(k / 2) * 4, f - 0.3], [1, 1.2, 0.3], 0, MAT.knob);
}

/** A window on the wall at zb, centred at x, from y0 to y1, w wide: its pane, its frame and glazing bars, its sill, and herbs in pots on it. */
export function window(out: number[], x: number, y0: number, y1: number, zb: number, w: number) {
  const a = x - w / 2, b = x + w / 2, z = zb - 0.3;
  quad(out, [a, y0, z], [a, y1, z], [b, y1, z], [b, y0, z], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
  const fr: Array<[V3, V3]> = [[[x, y1 + 1.5, zb - 1.5], [w / 2 + 3, 1.5, 1.5]], [[a - 1.5, (y0 + y1) / 2, zb - 1.5], [1.5, (y1 - y0) / 2 + 3, 1.5]], [[b + 1.5, (y0 + y1) / 2, zb - 1.5], [1.5, (y1 - y0) / 2 + 3, 1.5]],
    [[x, (y0 + y1) / 2, zb - 1], [0.8, (y1 - y0) / 2, 1]], [[x, y0 + (y1 - y0) * 0.62, zb - 1], [w / 2, 0.8, 1]]];
  for (const [c, h] of fr) box(out, c, h, 0, MAT.porcelain);
  // (its sill, deep enough for pots)
  const sl = sillOf(x, y0, zb, w);
  box(out, sl.c, sl.h, 0, MAT.porcelain);
  for (const [px, s] of [[-0.3, 1], [0.05, 0.8], [0.33, 1.1]] as Array<[number, number]>) {
    const cx = x + px * w, r = 4 * s;
    cylinder(out, cx, zb - 6, r * 0.8, y0, y0 + 7 * s, MAT.terracotta, MAT.terracotta, 16, true, r);
    for (let k = 0; k < 5; k++) { const an = k * 1.26 + px * 9; capsule(out, [cx, y0 + 6 * s, zb - 6], [cx + Math.cos(an) * 4 * s, y0 + (10 + (k % 3) * 2.5) * s, zb - 6 + Math.sin(an) * 3 * s], 1.5 * s, MAT.plant, 8, 3); }
  }
}

/** A kitchen table out in the room, centred at (x, z), its top at the floor + 76: a gingham cloth over it, chairs pulled up (all round; or, against a wall behind it, only on its +z side). */
export function tableSet(out: number[], x: number, z: number, g: number, chairs: 'all' | 'front' = 'all') {
  const ty = g + 76;
  box(out, [x, ty - 2, z], [62, 2, 42], 0, MAT.board);
  box(out, [x, ty + 0.2, z], [56, 0.2, 38], 0, MAT.gingham);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(out, [x + sx * 56, (g + ty - 4) / 2, z + sz * 36], [2.5, (ty - 4 - g) / 2, 2.5], 0, MAT.legs);
  for (const [cx, cz, f] of [[-26, 58, -1], [32, 60, -1], ...(chairs === 'all' ? [[-30, -58, 1], [30, -60, 1]] : [])] as Array<[number, number, number]>) chair(out, x + cx, z + cz, g, f);
}
/** A chair, its seat at the floor + 45, its back away from the table (f: which way it faces, +z or -z). */
export function chair(out: number[], x: number, z: number, g: number, f: number) {
  const sy = g + 45;
  box(out, [x, sy - 1.5, z], [20, 1.5, 19], 0, MAT.board);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(out, [x + sx * 17, (g + sy - 3) / 2, z + sz * 16], [1.6, (sy - 3 - g) / 2, 1.6], 0, MAT.legs);
  const bz = z - f * 17.5;
  for (const sx of [-1, 1]) box(out, [x + sx * 17, sy + 22, bz], [1.6, 22, 1.6], 0, MAT.legs);
  for (const k of [0, 1, 2]) box(out, [x, sy + 14 + k * 11, bz], [17, 2, 1.2], 0, MAT.board);
}
