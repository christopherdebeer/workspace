/**
 * Editing a drawing by its instructions (used by the Bench and the composed scene).
 *
 * An `Editor` keeps every element's deposits in a cache by id. An edit changes an item's stroke (its path through
 * handles, its pressure, weight or material) or the washes anchored to it, and deposits again only that stroke and
 * those washes. The drawing is then reassembled from the cache. Undo restores an item's state from a snapshot and
 * deposits it again.
 *
 * An item says how its handles shape its path:
 * - `ctrlItem`: the path is a curve through control points (the Bench);
 * - `deformItem`: the path is an authored path displaced smoothly by the handles' offsets, so a crack bent keeps its
 *   own jaggedness (the composed scene's seam and lip).
 *
 * On a surface, a handle's new place is taken onto the surface; if the surface won't take it, the edit is refused.
 */
import { add, deposit, len, mul, pathFrom, sub, toSplats, type Dep, type Drawing, type Element, type Gesture, type Material, type Region, type Stroke, type V, type Wash } from './brush';

/** pressure presets; 'as made' is the stroke's own (none, for a Bench stroke; the seam's authored rhythm, for the seam) */
export const PRESSURES: Record<string, ((u: number) => number) | undefined> = {
  'as made': undefined,
  swell: (u) => 0.35 + 0.65 * Math.sin(Math.PI * u),
  'press in': (u) => 1 - 0.6 * u,
  'lift off': (u) => 0.4 + 0.6 * u,
};

/** a wash anchored to an item's stroke: its anchor worked out from the stroke's path */
export interface Dependent { wash: Wash; anchor: (pts: V[]) => V[]; reach0: number }
export interface EditItem {
  name: string; stroke: Stroke; deps: Dependent[]; width0: number; pressure: string; pressure0?: (u: number) => number;
  /** the handles' places now */
  handles(): V[];
  /** move a handle (false if the surface won't take it); the stroke's path follows */
  setHandle(k: number, p: V): boolean;
  /** its shape's state, for undo */
  state(): unknown; load(s: unknown): void;
}
export interface Snapshot { item: number; shape: unknown; material: Material; pressure: string; weight: number; wash: number }

/** an item whose path is a curve through control points, taken onto a surface if it has one */
export function ctrlItem(name: string, stroke: Stroke, ctrl: V[], onto: Region | undefined, deps: Array<Omit<Dependent, 'reach0'>>): EditItem {
  let C = ctrl.map((p) => [...p] as V);
  const rebuild = () => { stroke.path = pathFrom(C, onto); };
  return {
    name, stroke, deps: deps.map((d) => ({ ...d, reach0: d.wash.reach })), width0: stroke.gesture.width, pressure: 'as made', pressure0: stroke.gesture.pressure,
    handles: () => C,
    setHandle(k, p) { let q = p; if (onto) { const h = onto.project(p); if (!h) return false; q = h.p; } C[k] = q; rebuild(); return true; },
    state: () => C.map((p) => [...p]), load(s) { C = (s as V[]).map((p) => [...p] as V); rebuild(); },
  };
}
/**
 * An item whose path is an authored path displaced by its handles: `k` handles spread evenly along it; each point
 * moves by the handles' offsets, blended smoothly between neighbouring handles, then is taken back onto the surface.
 */
export function deformItem(name: string, stroke: Stroke, k: number, onto: Region, deps: Array<Omit<Dependent, 'reach0'>>): EditItem {
  const base = stroke.path.pts.map((p) => [...p] as V), baseN = (stroke.path.normals ?? base.map(() => [0, 1, 0] as V)).map((p) => [...p] as V), n = base.length;
  const at = Array.from({ length: k }, (_, i) => Math.round((i / (k - 1)) * (n - 1)));
  let off: V[] = at.map(() => [0, 0, 0]);
  const rebuild = () => {
    const pts: V[] = [], ns: V[] = [];
    for (let i = 0; i < n; i++) {
      // (the offset at this point: between the two handles round it, eased)
      let j = 0; while (j < k - 2 && at[j + 1] < i) j++;
      const t = Math.max(0, Math.min(1, (i - at[j]) / Math.max(1, at[j + 1] - at[j]))), e = t * t * (3 - 2 * t);
      const o = add(mul(off[j], 1 - e), mul(off[j + 1], e));
      // (where nothing has moved, the authored point exactly, so undoing every edit gives back the authored stroke)
      if (len(o) < 1e-12) { pts.push(base[i]); ns.push(baseN[i]); continue; }
      const p = add(base[i], o), h = onto.project(p);
      pts.push(h ? h.p : p); ns.push(h?.n ?? baseN[i]);
    }
    stroke.path = { pts, normals: ns };
  };
  return {
    name, stroke, deps: deps.map((d) => ({ ...d, reach0: d.wash.reach })), width0: stroke.gesture.width, pressure: 'as made', pressure0: stroke.gesture.pressure,
    handles: () => at.map((i, j) => { if (len(off[j]) < 1e-12) return base[i]; const p = add(base[i], off[j]), h = onto.project(p); return h ? h.p : p; }),
    setHandle(j, p) { const h = onto.project(p); if (!h) return false; off[j] = sub(h.p, base[at[j]]); if (len(off[j]) > 0.6) return false; rebuild(); return true; },
    state: () => off.map((p) => [...p]), load(s) { off = (s as V[]).map((p) => [...p] as V); rebuild(); },
  };
}

export class Editor {
  readonly cache = new Map<number, Dep[]>();
  density = 1;
  constructor(readonly order: Element[], readonly items: EditItem[]) { for (const e of order) this.redo(e); }
  private redo(e: Element) { const d = deposit(e, this.density); this.cache.set(e.id, d); return d.length; }
  get total() { let n = 0; for (const d of this.cache.values()) n += d.length; return n; }
  deps(id: number) { return this.cache.get(id) ?? []; }
  /** the drawing from the cache, the selected item's stroke tinted */
  drawing(selected: number): Drawing {
    const sel = this.items[selected]?.stroke.id, all: Dep[] = [];
    for (const e of this.order) { const d = this.cache.get(e.id) ?? []; if (e.id === sel) for (const m of d) all.push({ ...m, c: [168, 72, 42] }); else for (const m of d) all.push(m); }
    return toSplats(all);
  }
  /** deposit again what an edit to an item affects (its stroke and its anchored washes), or everything */
  regenerate(item: number | 'all') {
    const t0 = performance.now();
    let els: Element[];
    if (item === 'all') els = this.order;
    else { const it = this.items[item]; for (const d of it.deps) d.wash.anchor = d.anchor(it.stroke.path.pts); els = [it.stroke, ...it.deps.map((d) => d.wash)]; }
    let marks = 0; for (const e of els) marks += this.redo(e);
    return { elements: els.length, marks, ms: performance.now() - t0 };
  }
  weight(i: number) { const it = this.items[i]; return it.stroke.gesture.width / it.width0; }
  washScale(i: number) { const d = this.items[i].deps[0]; return d ? d.wash.reach / d.reach0 : 1; }
  snapshot(i: number): Snapshot { const it = this.items[i]; return { item: i, shape: it.state(), material: it.stroke.material, pressure: it.pressure, weight: this.weight(i), wash: this.washScale(i) }; }
  restore(s: Snapshot) { const it = this.items[s.item]; it.load(s.shape); it.stroke.material = s.material; this.setPressure(s.item, s.pressure); this.setWeight(s.item, s.weight); this.setWash(s.item, s.wash); }
  setHandle(i: number, k: number, p: V) { return this.items[i].setHandle(k, p); }
  setMaterial(i: number, m: Material) { this.items[i].stroke.material = m; }
  setPressure(i: number, p: string) { const it = this.items[i]; it.pressure = p; it.stroke.gesture = { ...it.stroke.gesture, pressure: p === 'as made' ? it.pressure0 : PRESSURES[p] } as Gesture; }
  setWeight(i: number, w: number) { const it = this.items[i]; it.stroke.gesture = { ...it.stroke.gesture, width: it.width0 * w }; }
  /** the anchored washes' reach, a multiple of as made */
  setWash(i: number, k: number) { for (const d of this.items[i].deps) d.wash.reach = d.reach0 * k; }
}
