/**
 * The marks (`?scene=marks`): teacher marks cut from the sparse conservatory studies, each drawn by a mark fitted to it
 * (devtools/splats-marks-fit.mjs → static/splats/marks-bench.json), laid out as sheets on one wall.
 *
 * Each sheet can be drawn several ways, with the same number of deposits:
 * - `organised`: a mark's own parameters and spine fitted (marks.ts); `organised+deposits`: then its deposits' small
 *   residuals too;
 * - `independent`: every deposit set free (a fitted field, in small): no mark to pick up;
 * - `style`: a held-out teacher mark drawn with the style learnt from another (only its pose fitted);
 * - `unfitted`: the marks as they start; `brush`: the lab's existing brush on the same spines.
 * A fitted mark is still a mark: tap one to select it, drag a point of its spine and its deposits come with it.
 */
import { layout, marksToSplats, spine, type Mark, type Deposit, type V } from './marks';
import { stroke, wash, pathFrom, planeRegion, deposit, toSplats, INK, type Dep, type Material } from './brush';
import type { Splats } from './format';

export interface Way { marks?: Mark[]; deps?: number[][]; k?: number[] }
export interface Sheet { name: string; study: string; kind: 'stroke' | 'wash'; of: string | null; w: number; h: number; unit: number; z: number; fov: number; ways: Record<string, Way>; at: V }
export interface MarksFile { about: string; sheets: Sheet[] }
export const WAYS = ['organised', 'organised+deposits', 'independent', 'style', 'unfitted', 'brush'] as const;
/** the existing brush's few knobs, for a stroke (its width against the mark's, its material, its weight) and a wash */
export interface Brushed { width: number; material: Material; weight: number; depth: number; reach: number }
export const BRUSHED: Brushed = { width: 1, material: 'dry', weight: 1, depth: 0.5, reach: 1 };

const shift = (p: V, at: V): V => [p[0] + at[0], p[1] + at[1], p[2] + at[2]];
export class MarksScene {
  sheets: Sheet[]; marks: Mark[] = []; loose: Array<{ d: Deposit; colour?: [number, number, number] }> = []; brushDeps: Dep[] = [];
  /** which sheet each mark is on (by its place in `marks`) */
  on: Sheet[] = [];
  centre: V = [0, 0, 0]; size: [number, number] = [1, 1];
  constructor(public file: MarksFile, public way: string, only: string | null, public brushed: Brushed = BRUSHED) {
    this.sheets = file.sheets.filter((s) => !only || s.name === only);
    // (one sheet: at the origin, as it was fitted; several: in rows, in the order they come)
    if (this.sheets.length === 1) { this.sheets[0].at = [0, 0, 0]; this.size = [this.sheets[0].w / this.sheets[0].unit, this.sheets[0].h / this.sheets[0].unit]; }
    else {
      const gap = 0.03, wide = 1.25; let x = 0, y = 0, rowH = 0, maxX = 0;
      for (const s of this.sheets) { const w = s.w / s.unit, h = s.h / s.unit; if (x > 0 && x + w > wide) { x = 0; y -= rowH + gap; rowH = 0; } s.at = [x + w / 2, y - h / 2, 0]; x += w + gap; rowH = Math.max(rowH, h); maxX = Math.max(maxX, x - gap); }
      this.size = [maxX, rowH - y]; this.centre = [maxX / 2, (y - rowH) / 2, 0];
    }
    this.setWay(way);
  }
  setWay(way: string) {
    this.way = way; this.marks = []; this.loose = []; this.on = []; this.brushDeps = [];
    for (const s of this.sheets) {
      const styled = Object.keys(s.ways).find((k) => k.startsWith('style of '));
      const w = way === 'style' ? s.ways[styled ?? 'organised'] : way === 'brush' ? s.ways.unfitted : s.ways[way] ?? s.ways.organised;
      if (way === 'brush') { this.brush(s, w.marks!); continue; }
      if (w.marks) for (const m0 of w.marks) {
        const m: Mark = { ...m0, ctrl: m0.ctrl?.map((p) => shift(p as V, s.at)), face: m0.face ? { ...m0.face, o: shift(m0.face.o, s.at) } : undefined, params: m0.params.slice(), resid: m0.resid.slice(), view: m0.view.slice() };
        this.marks.push(m); this.on.push(s);
      } else if (w.deps) {
        // (each loose deposit's colour: its mark's, by the order the marks' deposits were laid in)
        const plain = s.ways.unfitted.marks!, colours: Array<[number, number, number] | undefined> = []; for (const m of plain) for (let i = 0; i < m.count; i++) colours.push(m.colour);
        w.deps.forEach((r, i) => this.loose.push({ d: { p: shift([r[0], r[1], r[2]], s.at), s1: r[3], s2: r[4], thin: 0.0008, turn: r[5], logit: r[6], t: [r[7], r[8], r[9]], n: [0, 0, 1] }, colour: colours[i] }));
      }
    }
  }
  /** a sheet in the lab's existing brush: a stroke along each spine, a short stroke for each dab, a wash from the
   * outline's long axis */
  private brush(s: Sheet, plain: Mark[]) {
    const B = this.brushed, wall = planeRegion([0, 0, 1], s.at, () => true, 4);
    for (const m of plain) {
      const colour = (m.colour ?? INK) as V, key = `marks/${m.name}`;
      if (m.kind === 'wash') {
        const F = m.face!, o = shift(F.o, s.at), pts = F.tris.map((t) => [t[2], t[3]]);
        // (its long axis, through its middle; its reach, half its extent across)
        let cxx = 0, cxy = 0, cyy = 0, mx = 0, my = 0; for (const p of pts) { mx += p[0] / pts.length; my += p[1] / pts.length; }
        for (const p of pts) { cxx += (p[0] - mx) ** 2; cxy += (p[0] - mx) * (p[1] - my); cyy += (p[1] - my) ** 2; }
        const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ax = [Math.cos(th), Math.sin(th)]; let lo = 0, hi = 0, across = 0;
        for (const p of pts) { const a = (p[0] - mx) * ax[0] + (p[1] - my) * ax[1], b = Math.abs(-(p[0] - mx) * ax[1] + (p[1] - my) * ax[0]); lo = Math.min(lo, a); hi = Math.max(hi, a); across = Math.max(across, b); }
        const inside = (q: V) => { const x = q[0] - o[0], y = q[1] - o[1]; return F.tris.some((t) => { const d = (t[3] - t[5]) * (t[0] - t[4]) + (t[4] - t[2]) * (t[1] - t[5]), a = ((t[3] - t[5]) * (x - t[4]) + (t[4] - t[2]) * (y - t[5])) / d, b = ((t[5] - t[1]) * (x - t[4]) + (t[0] - t[4]) * (y - t[5])) / d; return a >= 0 && b >= 0 && a + b <= 1; }); };
        const end = (k: number): V => [o[0] + mx + ax[0] * k, o[1] + my + ax[1] * k, o[2]];
        const anchor: V[] = []; for (let k = 0; k <= 8; k++) anchor.push(end(lo * 0.8 + ((hi - lo) * 0.8 * k) / 8));
        this.brushDeps.push(...deposit(wash(planeRegion([0, 0, 1], o, inside, 1.2), anchor, { key, reach: across * B.reach, depth: B.depth, edge: 'soft' })));
        continue;
      }
      const ctrl = m.ctrl!.map((p) => shift(p as V, s.at));
      if ((m as Mark & { role?: string }).role === 'dabs') {
        const S = spine({ ...m, ctrl }), n = m.count, at = (u: number): [V, V] => { const d = u * S.L; let k = 0; while (k < S.pts.length - 2 && S.cum[k + 1] < d) k++; const f = (d - S.cum[k]) / Math.max(1e-9, S.cum[k + 1] - S.cum[k]), a = S.pts[k], b = S.pts[k + 1], t: V = [b[0] - a[0], b[1] - a[1], 0], l = Math.hypot(t[0], t[1]) || 1; return [[a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2]], [t[0] / l, t[1] / l, 0]]; };
        for (let i = 0; i < n; i++) {
          const [p, t] = at((i + 0.5) / n), sgn = i % 2 ? 1 : -1, c = Math.cos(0.5 * sgn), sn = Math.sin(0.5 * sgn), d: V = [t[0] * c - t[1] * sn, t[0] * sn + t[1] * c, 0], len = (S.L / n) * 1.3;
          this.brushDeps.push(...deposit(stroke(pathFrom([p, [p[0] + d[0] * len * 0.5, p[1] + d[1] * len * 0.5, p[2]], [p[0] + d[0] * len, p[1] + d[1] * len, p[2]]], wall), { width: (m.width ?? 0.005) * B.width, taper: [0.4, 0.5] }, { key: `${key}/${i}`, material: 'ink', colour, alpha: B.weight })));
        }
      } else this.brushDeps.push(...deposit(stroke(pathFrom(ctrl, wall), { width: (m.width ?? 0.01) * B.width * ((m.rows ?? 1) > 1 ? 1 : 1.2), taper: [0.1, 0.18], tremor: 0.15 }, { key, material: (m.rows ?? 1) > 1 ? B.material : 'ink', colour, alpha: B.weight })));
    }
  }
  /** the drawing as the renderer takes it */
  drawing(): Splats { return this.way === 'brush' ? toSplats(this.brushDeps) : marksToSplats(this.marks, 0.02, this.loose); }
  get deposits() { return this.way === 'brush' ? this.brushDeps.length : this.marks.reduce((a, m) => a + m.count, 0) + this.loose.length; }
  /** the mark nearest a point of the screen (within a finger's width of its spine or its deposits), or -1 */
  pick(toScreen: (p: number[]) => [number, number] | null, x: number, y: number): number {
    let best = -1, bd = 30;
    this.marks.forEach((m, i) => { for (const p of m.kind === 'stroke' ? spine(m).pts : layout(m).map((d) => d.p)) { const s = toScreen(p); if (!s) continue; const e = Math.hypot(s[0] - x, s[1] - y); if (e < bd) { bd = e; best = i; } } });
    return best;
  }
  /** a mark's handles: the points its spine runs through (a wash has none yet) */
  handles(i: number): V[] { return this.marks[i]?.ctrl ?? []; }
  /** move one: every mark on the same sheet that runs through the same point moves with it (a strand and its dabs) */
  setHandle(i: number, k: number, p: V) {
    const m = this.marks[i], old = m.ctrl![k], q: V = [p[0], p[1], old[2]];
    this.marks.forEach((o, j) => { if (this.on[j] === this.on[i] && o.ctrl && o.ctrl[k] && Math.hypot(o.ctrl[k][0] - old[0], o.ctrl[k][1] - old[1]) < 1e-6) o.ctrl[k] = [...q] as V; });
  }
}
