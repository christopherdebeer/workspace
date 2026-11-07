/**
 * The Bench (`?scene=bench`): one brush made dependable, then made editable. The same stroke and wash on three
 * supports: a plane (a board), a cylinder (a culm) and open space. Each stroke is authored as control points and keeps
 * its identity; its wash is anchored to it, so it follows the stroke.
 *
 * Editing works on the instructions, not the splats:
 * - select a stroke (tap it);
 * - bend it (drag a control point: on a surface the point stays on the surface);
 * - change its pressure (even, swell, press in, lift off), its weight and its material (ink, dry, wash-line);
 * - undo.
 *
 * Only the affected elements are deposited again: the stroke, and the wash anchored to it. Everything else is reused
 * from the cache. The splats are then reassembled and uploaded whole; only deposition is incremental, not the upload.
 *
 * The density control re-deposits everything at 0.5, 1 or 2. The drawing gets finer or coarser, but its tone should hold
 * (brush.ts `faint`).
 */
import { add, cross, mul, norm, sub, stroke, wash, group, deposit, pathFrom, planeRegion, cylinderRegion, volumeRegion, scope, toSplats, INK, type Dep, type Drawing, type Element, type Gesture, type Material, type Region, type Stroke, type V, type Wash } from './brush';

export const PRESSURES: Record<string, ((u: number) => number) | undefined> = {
  even: undefined,
  swell: (u) => 0.35 + 0.65 * Math.sin(Math.PI * u),
  'press in': (u) => 1 - 0.6 * u,
  'lift off': (u) => 0.4 + 0.6 * u,
};
export interface Item { name: string; stroke: Stroke; wash: Wash; ctrl: V[]; onto?: Region; width: number; pressure: string }
interface Snapshot { item: number; ctrl: V[]; material: Material; pressure: string; weight: number }

export interface Bench {
  items: Item[]; fixed: Element[]; occluder: Float32Array; centre: V;
  /** the drawing, assembled from the cache (the selected stroke tinted) */
  drawing(selected: number): Drawing;
  /** deposit again what an edit to an item affects (or everything, at a new density); returns how many elements and marks */
  regenerate(item: number | 'all'): { elements: number; marks: number; ms: number };
  /** the item's weight (a multiple of its width as made) */
  weight(item: number): number;
  snapshot(item: number): Snapshot; restore(s: Snapshot): void;
  setCtrl(item: number, k: number, p: V): boolean; setMaterial(item: number, m: Material): void; setPressure(item: number, p: string): void; setWeight(item: number, w: number): void;
  density: number; total: number;
  /** all the deposits, by element id (for picking) */
  deps(id: number): Dep[];
}

const UP: V = [0, 1, 0];

export function benchScene(): Bench {
  // ─── the three supports ───
  const boardN = norm([0.25, 0.2, 1]), boardC: V = [-0.88, 0.62, 0], bu = norm(cross(UP, boardN)), bv = cross(boardN, bu), H = 0.3;
  const onBoard = (p: V) => { const d = sub(p, boardC); return Math.abs(d[0] * bu[0] + d[1] * bu[1] + d[2] * bu[2]) < H && Math.abs(d[0] * bv[0] + d[1] * bv[1] + d[2] * bv[2]) < H; };
  const board = planeRegion(boardN, boardC, onBoard, 0.6);
  const CX = 0, CZ = 0, CR = 0.14, CY0 = 0.1, CY1 = 1.15;
  // (the culm's front half, toward the default view)
  const culm = cylinderRegion(CX, CZ, CR, CY0, CY1, -0.2, Math.PI + 0.2);
  const freeC: V = [0.88, 0.62, 0];
  const at = (u: number, v: number): V => add(boardC, add(mul(bu, u * H), mul(bv, v * H)));
  const cyl = (a: number, y: number): V => [CX + Math.cos(a) * CR, y, CZ + Math.sin(a) * CR];

  const made = scope('bench', () => {
    const mk = (name: string, ctrl: V[], onto: Region | undefined, washRegion: Region, width: number, reach: number): Item => {
      const s = stroke(pathFrom(ctrl, onto), { width, taper: [0.12, 0.2], tremor: 0.2 }, { key: `${name}/stroke`, heart: 'middle' });
      const w = wash(washRegion, s.path.pts, { key: `${name}/wash`, reach, depth: 0.7, direction: (_p, n) => norm(cross(n, UP)) });
      group(0.9, s, [w]);
      return { name, stroke: s, wash: w, ctrl, onto, width, pressure: 'even' };
    };
    const items = [
      mk('plane', [at(-0.75, -0.35), at(-0.25, 0.25), at(0.3, 0.1), at(0.75, 0.55)], board, board, 0.011, 0.22),
      mk('cylinder', [cyl(1.1, 0.3), cyl(1.45, 0.55), cyl(1.9, 0.75), cyl(2.3, 1.0)], culm, culm, 0.01, 0.1),
      mk('free', [add(freeC, [-0.28, -0.3, 0]), add(freeC, [-0.08, 0.08, 0.12]), add(freeC, [0.14, 0.0, -0.08]), add(freeC, [0.28, 0.32, 0])], undefined, volumeRegion(freeC, [0.4, 0.42, 0.28]), 0.011, 0.12),
    ];
    // (the supports drawn lightly, so there's something for the marks to sit on: the board's edges, the culm's silhouette)
    const fixed: Element[] = [];
    const edge = (a: V, b: V, k: string) => fixed.push(stroke(pathFrom([a, b], board), { width: 0.004, taper: [0.02, 0.02] }, { key: k, alpha: 0.45, colour: [120, 110, 98] }));
    edge(at(-1, -1), at(1, -1), 'board/e0'); edge(at(1, -1), at(1, 1), 'board/e1'); edge(at(1, 1), at(-1, 1), 'board/e2'); edge(at(-1, 1), at(-1, -1), 'board/e3');
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, d = (Math.PI * 2) / 16, n1: V = [Math.cos(a - d / 2), 0, Math.sin(a - d / 2)], n2: V = [Math.cos(a + d / 2), 0, Math.sin(a + d / 2)];
      const pts: V[] = [cyl(a, CY0), cyl(a, CY1)];
      fixed.push(stroke({ pts, normals: [n1, n1] }, { width: 0.004, taper: [0.02, 0.02] }, { key: `culm/edge${k}`, mark: 4, profile: n2, alpha: 0.6, colour: [120, 110, 98] }));
    }
    for (const y of [CY0, 0.62, CY1]) { const pts: V[] = [], ns: V[] = []; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2; pts.push(cyl(a, y)); ns.push([Math.cos(a), 0, Math.sin(a)]); } fixed.push(stroke({ pts, normals: ns }, { width: 0.004, taper: [0, 0] }, { key: `culm/ring${y}`, alpha: 0.4, colour: [120, 110, 98] })); }
    return { items, fixed };
  });
  const { items, fixed } = made;

  // ─── the occluder: the board (just behind its marks) and the culm ───
  const tris: number[] = [];
  { const k = 0.004, c = sub(boardC, mul(boardN, k)), q = (u: number, v: number) => add(c, add(mul(bu, u * H), mul(bv, v * H))); tris.push(...q(-1, -1), ...q(1, -1), ...q(1, 1), ...q(-1, -1), ...q(1, 1), ...q(-1, 1)); }
  for (let k = 0; k < 24; k++) { const a0 = (k / 24) * Math.PI * 2, a1 = ((k + 1) / 24) * Math.PI * 2, r = CR * 0.97, A: V = [Math.cos(a0) * r, CY0, Math.sin(a0) * r], B: V = [Math.cos(a1) * r, CY0, Math.sin(a1) * r]; tris.push(...A, ...B, B[0], CY1, B[2], ...A, B[0], CY1, B[2], A[0], CY1, A[2]); }

  // ─── the cache: each element's deposits, by id ───
  const order: Element[] = [...fixed, ...items.flatMap((it) => [it.wash, it.stroke])];
  const cache = new Map<number, Dep[]>();
  let density = 1;
  const redo = (e: Element) => { const d = deposit(e, density); cache.set(e.id, d); return d.length; };
  for (const e of order) redo(e);
  const rebuild = (it: Item) => { it.stroke.path = pathFrom(it.ctrl, it.onto); it.wash.anchor = it.stroke.path.pts; };

  const B: Bench = {
    items, fixed, occluder: new Float32Array(tris), centre: [0, 0.6, 0],
    get density() { return density; }, set density(d: number) { density = d; },
    get total() { let n = 0; for (const d of cache.values()) n += d.length; return n; },
    deps: (id) => cache.get(id) ?? [],
    drawing(selected) {
      const sel = items[selected]?.stroke.id, all: Dep[] = [];
      for (const e of order) { const d = cache.get(e.id) ?? []; if (e.id === sel) for (const m of d) all.push({ ...m, c: [168, 72, 42] }); else for (const m of d) all.push(m); }
      return toSplats(all);
    },
    regenerate(item) {
      const t0 = performance.now(), els = item === 'all' ? order : [items[item].stroke, items[item].wash];
      let marks = 0; for (const e of els) marks += redo(e);
      return { elements: els.length, marks, ms: performance.now() - t0 };
    },
    weight: (i) => items[i].stroke.gesture.width / items[i].width,
    snapshot: (i) => ({ item: i, ctrl: items[i].ctrl.map((p) => [...p] as V), material: items[i].stroke.material, pressure: items[i].pressure, weight: B.weight(i) }),
    restore(s) { const it = items[s.item]; it.ctrl = s.ctrl.map((p) => [...p] as V); it.stroke.material = s.material; B.setPressure(s.item, s.pressure); B.setWeight(s.item, s.weight); rebuild(it); },
    setCtrl(i, k, p) {
      const it = items[i]; let q: V = p;
      if (it.onto) { const h = it.onto.project(p); if (!h) return false; q = h.p; }
      it.ctrl[k] = q; rebuild(it); return true;
    },
    setMaterial(i, m) { items[i].stroke.material = m; },
    setPressure(i, p) { const it = items[i]; it.pressure = p; it.stroke.gesture = { ...it.stroke.gesture, pressure: PRESSURES[p] } as Gesture; },
    setWeight(i, w) { const it = items[i]; it.stroke.gesture = { ...it.stroke.gesture, width: it.width * w }; },
  };
  void INK;
  return B;
}
