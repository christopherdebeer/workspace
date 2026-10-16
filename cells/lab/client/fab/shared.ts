/**
 * What every garment's cut shares: the pieces as they're drafted, what's sewn to what (and how long each seam's two
 * edges are, for the checks), what's held on the figure and on a hanger, and what each piece hangs from.
 */
import { SHOULDER_Y, TORSO_TOP, WAIST_Y, girth, section, type V3 } from './body';
import { BOLT, bandAt } from './pattern';
import { areaOf, gridHealth, sew, type At, type Check, type Pair, type Piece, type Run, type Seam, type Span } from './edges';

export const TAU = Math.PI * 2;
export class Cut {
  pieces: Piece[] = []; pairs: Pair[] = []; seams: Seam[] = [];
  /** held on the figure, and on a hanger (its own frame: what it hangs from at y = 0) */
  holds: Array<{ at: At; p: V3 }> = []; hanger: Array<{ at: At; p: V3 }> = [];
  anchors: At[] = []; notes: string[] = []; checks: Check[] = [];
  add(p: Piece): number { this.pieces.push(p); return this.pieces.length - 1; }
  span(k: number, name: string): Span {
    const s = this.pieces[k].spans?.[name];
    if (!s) throw new Error(`${this.pieces[k].name} has no edge "${name}"`);
    return { piece: k, pts: s };
  }
  sew(A: Run, B: Run, why: string, o: { want?: number; tol?: number; map?: number[] } = {}) {
    const r = sew(this.pieces, A, B, why, o);
    this.pairs.push(...r.pairs); this.seams.push(r.seam);
  }
  /** the points of a piece's run, as grid points */
  pts(k: number, name: string): At[] { return this.span(k, name).pts.map((p): At => [k, p[0], p[1]]); }
  area(): number { return this.pieces.reduce((s, p) => s + areaOf(p), 0); }
}

// ─── the figure, measured ──────────────────────────────────────────────────────────────────────
/** how high the top of the figure's shoulders (or neck's base) is across at |x|, through its middle (not its arms) */
export function topAt(x: number): number {
  const ax = Math.abs(x);
  for (let y = TORSO_TOP + 1.5; y > SHOULDER_Y - 8; y -= 0.05) {
    if (y <= TORSO_TOP && section(y).rx >= ax) return y;
    if ((ax - 15.6) ** 2 + (y - 89.5) ** 2 <= 4.6 * 4.6) return y;
  }
  return SHOULDER_Y;
}
/** the length of the figure's surface from its waist up its front (side +1) or back (−1) at |x|, over the top of it
 * to the middle of its shoulder: what a bodice's pattern must be long enough to cover there */
export function surfaceLen(x: number, side: 1 | -1): number {
  const ax = Math.abs(x), top = topAt(ax);
  let len = 0, py = WAIST_Y, pz = NaN;
  const zAt = (y: number) => { const s = section(y); return ax >= s.rx ? s.cz : s.cz + side * s.rz * Math.sqrt(1 - (ax / s.rx) ** 2); };
  pz = zAt(py);
  for (let y = WAIST_Y + 0.25; y <= top; y += 0.25) {
    const s = section(y);
    if (s.rx < ax) break;
    const z = zAt(y); len += Math.hypot(y - py, z - pz); py = y; pz = z;
  }
  return len + Math.hypot(top - py, pz - section(Math.min(py, TORSO_TOP)).cz);
}
export const CHEST = girth(82), WAIST = girth(WAIST_Y), HEAD_ROUND = TAU * 9.6;

// ─── where pieces start, before they're sewn ───────────────────────────────────────────────────
/** a bodice piece laid out before it's sewn, as GarmentCodeData lays its panels: flat (unstretched), on a gentle curve
 * in front of the figure (side +1) or behind it (−1), as high as its neck's point is above the waist (`lift`: how far
 * to drop it so that point's just over the figure's shoulder). The sewing and the shoulders' holds draw it round. */
export function bodiceStart(flat: (u: number, v: number) => [number, number], side: 1 | -1, lift: number) {
  const R = 26, off = 13;
  return (u: number, v: number): V3 => {
    const [x0, y] = flat(u, v), x = side * x0, a = x / R;
    return [R * Math.sin(a), WAIST_Y + y - lift, side * (off - R * (1 - Math.cos(a))) + (side > 0 ? 0.4 : -0.6)];
  };
}

// ─── waistbands ────────────────────────────────────────────────────────────────────────────────
export const BAND_H = 2.5;
/** a waistband: a straight strip `round` long, held round the waist (its top edge is "top", its foot "foot") */
export function waistband(cut: Cut, round: number, h: number, name = 'waistband'): number {
  const bu = Math.max(8, Math.round(round / Math.max(1.5, h * 0.8)));
  const flat = (u: number, v: number): [number, number] => [(u - 0.5) * round, BAND_H * (1 - v)];
  const k = cut.add({
    name, kind: 'band', nu: bu, nv: 1, flat, grain: Math.PI / 2, label: `${name} · cut 1`, cut: 1,
    start: (u, v) => bandAt((u - 0.5) * round, WAIST_Y + BAND_H * (1 - v), round),
    spans: { foot: Array.from({ length: bu + 1 }, (_, i) => [i, 1] as [number, number]), top: Array.from({ length: bu + 1 }, (_, i) => [i, 0] as [number, number]) },
  });
  for (let i = 0; i <= bu; i++) for (let j = 0; j <= 1; j++) {
    const s = (i / bu - 0.5) * round, y = BAND_H * (1 - j);
    cut.holds.push({ at: [k, i, j], p: bandAt(s, WAIST_Y + y, round) });
    cut.hanger.push({ at: [k, i, j], p: clipAt(s, y, round) });
  }
  return k;
}
/** a point on a waistband held flat in a hanger's two clips: an ellipse 1.6 cm deep whose round is the band's */
export function clipAt(s: number, y: number, round: number): V3 {
  const rz = 1.6, per = (a: number) => { const h = ((a - rz) / (a + rz)) ** 2; return Math.PI * (a + rz) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))); };
  let lo = rz, hi = round;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (per(m) < round) lo = m; else hi = m; }
  const rx = lo, f = (((s / round) % 1) + 1) % 1;
  // (by length round the ellipse, from the front)
  const N = 128, acc = [0];
  for (let k = 1; k <= N; k++) { const a0 = ((k - 1) / N) * TAU, a1 = (k / N) * TAU; acc.push(acc[k - 1] + Math.hypot((Math.sin(a1) - Math.sin(a0)) * rx, (Math.cos(a1) - Math.cos(a0)) * rz)); }
  const t = f * acc[N];
  let j = 0; while (j < N - 1 && acc[j + 1] < t) j++;
  const a = ((j + (t - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j])) / N) * TAU;
  return [Math.sin(a) * rx, y, Math.cos(a) * rz];
}
/** a point held on top of the shoulders, at x across (on the figure), and on a coat hanger's sloped arm */
export const shoulderAt = (x: number, out = 0.7): V3 => [x, topAt(x) + out, -0.4];
export const SHOULDER_TOP = topAt(6);
/** (on the coat hanger's bar: its top surface, 5.6 cm up at the middle, falling as the bar does) */
export const coatAt = (x: number): V3 => [x * 0.98, 6.1 - 0.36 * Math.abs(x), 0];

// ─── checks every garment's cut gets ───────────────────────────────────────────────────────────
export function commonChecks(cut: Cut, gr = 0): Check[] {
  const out: Check[] = [];
  // (every seam's two edges the lengths they're meant to be: the same, or gathered by as much as was meant)
  let worst: Seam | null = null, worstErr = -1;
  for (const s of cut.seams) { const e = Math.abs(s.ratio / s.want - 1) / s.tol; if (e > worstErr) { worstErr = e; worst = s; } }
  if (worst) out.push({ name: 'seams meet', ok: worstErr <= 1, detail: `${cut.seams.length} seams; the furthest out: ${worst.why}, ${worst.a.toFixed(1)} cm to ${worst.b.toFixed(1)} cm${worst.want !== 1 ? ` (gathered ${worst.want.toFixed(2)}×)` : ''}` });
  // (every piece's grid sound: nothing folded over, no cell crushed)
  const bad = cut.pieces.filter((p) => !p.ruled).map((p) => ({ p, h: gridHealth(p) })).filter((x) => !x.h.ok);
  out.push({ name: 'pieces lie flat', ok: !bad.length, detail: bad.length ? `${bad.map((x) => x.p.name).join(', ')}: a corner of ${Math.min(...bad.map((x) => x.h.worst)).toFixed(0)}°` : (() => { const n = cut.pieces.filter((p) => !p.ruled).length; return `${n} piece${n === 1 ? '' : 's'} cut from curves, every cell sound${cut.pieces.some((p) => p.ruled) ? ' (a skirt\'s paper has its own checks)' : ''}`; })() });
  // (every piece fits across the cloth, along its grain)
  let wide = 0, which = '';
  for (const p of cut.pieces) {
    if (p.kind === 'band') continue;
    const g = p.grain + gr * 0;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j <= 16; j++) for (let i = 0; i <= 16; i++) { const [x, y] = p.flat(i / 16, j / 16), a = x * Math.cos(g) - y * Math.sin(g); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    if (hi - lo > wide) { wide = hi - lo; which = p.name; }
  }
  out.push({ name: 'fits on the cloth', ok: wide <= BOLT + 0.5, detail: `${which}: ${wide.toFixed(0)} cm across the grain, of ${BOLT}` });
  return out;
}
