/**
 * What fills a disc: one ornament from the suit's vocabulary, chosen by its weights (seeded by the
 * disc's orbit, so every copy agrees), turned to the disc's orientation and mirrored with it; and
 * the lace between neighbours. `fill` runs the passes (pack.ts) and draws the result.
 */
import { hash, seeded } from '../kit/rng';
import { sdf, ShapeIndex, type Pt, type Shape, type Sym } from './field';
import { evenness, fillPasses, type Disc, type Evenness } from './pack';
import type { Style } from './styles';

export type Fill = 'none' | 'ink' | 'paper' | 'wash';
export type Layer = 'wash' | 'ground' | 'junction';
export type Mark =
  | { k: 'path'; d: string; w: number; fill?: Fill; dash?: string; op?: number; layer: Layer; clip?: boolean }
  | { k: 'circle'; x: number; y: number; r: number; w: number; fill?: Fill; dash?: string; op?: number; layer: Layer; clip?: boolean }
  | { k: 'text'; x: number; y: number; size: number; text: string; layer: Layer };

const sq = (x: number) => x * x;
/** an emphasised stroke: `factor` times the line weight when accent is 1, a hairline (0.6×) at 0 */
export const accentW = (W: number, factor: number, accent: number) => W * (0.6 + (factor - 0.6) * accent);
export const f = (n: number) => Math.round(n * 100) / 100;
const rad = (a: number) => (a * Math.PI) / 180;
/** a point at radius r, angle a in degrees: 0 north, clockwise (as the card lies) */
export const pol = (r: number, a: number): Pt => [r * Math.sin(rad(a)), -r * Math.cos(rad(a))];
export const add = (p: Pt, q: Pt): Pt => [p[0] + q[0], p[1] + q[1]];
export const pt = (p: Pt) => `${f(p[0])} ${f(p[1])}`;

// ─── glyphs: unit-sized, pointing outward (up, before turning) ────────────────────────────────
type Map2 = (x: number, y: number) => string;
const GLYPHS: Record<string, (m: Map2, s: number) => string> = {
  heart: (m) => `M${m(0, 0.95)}C${m(-0.25, 0.62)} ${m(-1, 0.18)} ${m(-1, -0.32)}C${m(-1, -0.85)} ${m(-0.4, -1.05)} ${m(0, -0.55)}C${m(0.4, -1.05)} ${m(1, -0.85)} ${m(1, -0.32)}C${m(1, 0.18)} ${m(0.25, 0.62)} ${m(0, 0.95)}Z`,
  spade: (m) => `M${m(0, -1)}C${m(0.3, -0.62)} ${m(1, -0.25)} ${m(1, 0.22)}C${m(1, 0.68)} ${m(0.45, 0.85)} ${m(0.1, 0.45)}L${m(0.32, 1)}L${m(-0.32, 1)}L${m(-0.1, 0.45)}C${m(-0.45, 0.85)} ${m(-1, 0.68)} ${m(-1, 0.22)}C${m(-1, -0.25)} ${m(-0.3, -0.62)} ${m(0, -1)}Z`,
  trefoil: (m, s) => {
    const c = (x: number, y: number, r: number) => `M${m(x - r, y)}A${f(r * s)} ${f(r * s)} 0 1 0 ${m(x + r, y)}A${f(r * s)} ${f(r * s)} 0 1 0 ${m(x - r, y)}Z`;
    return `${c(0, -0.5, 0.42)}${c(-0.46, 0.2, 0.42)}${c(0.46, 0.2, 0.42)}M${m(-0.08, 0.3)}L${m(-0.28, 1)}L${m(0.28, 1)}L${m(0.08, 0.3)}Z`;
  },
  diamond: (m) => `M${m(0, -1)}Q${m(0.1, -0.12)} ${m(0.6, 0)}Q${m(0.1, 0.12)} ${m(0, 1)}Q${m(-0.1, 0.12)} ${m(-0.6, 0)}Q${m(-0.1, -0.12)} ${m(0, -1)}Z`,
  star: (m) => `M${m(0, -1)}Q${m(0.14, -0.14)} ${m(1, 0)}Q${m(0.14, 0.14)} ${m(0, 1)}Q${m(-0.14, 0.14)} ${m(-1, 0)}Q${m(-0.14, -0.14)} ${m(0, -1)}Z`,
  // (opening inward: its horns point at the hub)
  crescent: (m, s) => `M${m(-0.78, 0.55)}A${f(s)} ${f(s)} 0 1 1 ${m(0.78, 0.55)}A${f(0.82 * s)} ${f(0.82 * s)} 0 1 0 ${m(-0.78, 0.55)}Z`,
};
/** a glyph at c, scaled by s, turned by a (degrees, clockwise) */
export function glyph(name: string, c: Pt, s: number, a: number): string {
  const co = Math.cos(rad(a)), si = Math.sin(rad(a));
  const m: Map2 = (x, y) => pt([c[0] + (x * co - y * si) * s, c[1] + (x * si + y * co) * s]);
  return GLYPHS[name](m, s);
}

// ─── the vocabulary ───────────────────────────────────────────────────────────────────────────
export const KINDS = ['dot', 'sparkle', 'motif', 'rosette', 'roundel', 'scroll', 'star', 'eye', 'crescent'] as const;
export type Kind = (typeof KINDS)[number];
/** the style's weight for each kind */
const WEIGHT: Record<Kind, keyof Style> = { dot: 'oDot', sparkle: 'oSparkle', motif: 'oMotif', rosette: 'oRosette', roundel: 'oRoundel', scroll: 'oScroll', star: 'oStar', eye: 'oEye', crescent: 'oCrescent' };
/** how big a disc (as a share of rMax) must be to carry each kind legibly */
const MIN: Record<Kind, number> = { dot: 0, sparkle: 0.18, crescent: 0.3, scroll: 0.3, eye: 0.3, motif: 0.4, star: 0.42, rosette: 0.42, roundel: 0.36 };
export function pickKind(s: Style, r: number, rMax: number, u: number): Kind {
  const ok = KINDS.filter((k) => r >= MIN[k] * rMax && (s[WEIGHT[k]] as number) > 0);
  const total = ok.reduce((t, k) => t + (s[WEIGHT[k]] as number), 0);
  if (!total) return 'dot';
  let x = u * total;
  for (const k of ok) { x -= s[WEIGHT[k]] as number; if (x <= 0) return k; }
  return ok[ok.length - 1];
}

/** one ornament's marks, in the disc */
export function ornament(kind: Kind, d: Disc, s: Style, W: number, rMax: number, q: () => number): Mark[] {
  const out: Mark[] = [];
  const rr = d.r * 0.94, a = d.a, c = d.c;
  const w = W * Math.max(0.45, Math.min(1, d.r / (0.6 * rMax)));
  const path = (dd: string, ww: number, fill: Fill = 'none') => out.push({ k: 'path', d: dd, w: ww, fill, layer: 'ground' });
  const circle = (p: Pt, r: number, ww: number, fill: Fill = 'none') => out.push({ k: 'circle', x: f(p[0]), y: f(p[1]), r: f(r), w: ww, fill, layer: 'ground' });
  const at = (r: number, ang: number) => add(c, pol(r, ang));
  switch (kind) {
    case 'dot': circle(c, Math.max(0.12, rr * 0.38), 0, 'ink'); break;
    case 'sparkle': path(glyph('star', c, rr * 0.95, a), 0, 'ink'); break;
    case 'crescent': path(glyph('crescent', c, rr * 0.72, a), 0, 'ink'); break;
    case 'motif':
      if (rr > 0.55 * rMax) circle(c, rr * 0.96, w * 0.5);
      path(glyph(s.motif, c, rr * 0.64, a), w * 0.9, s.motifFill ? 'ink' : 'paper');
      break;
    case 'rosette': {
      const n = 5 + Math.floor(q() * 4), r0 = rr * 0.24;
      let dd = '';
      for (let k = 0; k < n; k++) {
        const g = a + (k * 360) / n, h = 180 / n * 0.7;
        dd += `M${pt(at(r0, g))}Q${pt(at(rr * 0.68, g - h))} ${pt(at(rr, g))}Q${pt(at(rr * 0.68, g + h))} ${pt(at(r0, g))}Z`;
      }
      path(dd, w * 0.7, 'paper');
      circle(c, rr * 0.2, 0, 'ink');
      break;
    }
    case 'roundel': {
      circle(c, rr, accentW(w, 0.85, s.accent), 'paper');
      circle(c, rr * 0.64, w * 0.4);
      circle(c, rr * 0.2, 0, 'ink');
      if (rr > 0.6 * rMax) { const n = 8 + 2 * Math.floor(q() * 3); for (let k = 0; k < n; k++) circle(at(rr * 0.82, a + (k * 360) / n), rr * 0.055, 0, 'ink'); }
      break;
    }
    case 'scroll': {
      // (a curl from the disc's edge inward, turning the way its mirror says)
      const turns = 1.3 + q() * 0.6, dir = d.m;
      const ps: Pt[] = [];
      for (let t = 0; t <= 1.0001; t += 1 / 28) ps.push(at(rr * (1 - 0.82 * t), a + dir * t * turns * 360));
      path(ps.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join(''), w * 0.85);
      circle(ps[ps.length - 1], rr * 0.09, 0, 'ink');
      break;
    }
    case 'star': {
      const n = 5 + Math.floor(q() * 4), k = n >= 7 ? 3 : 2;
      const v = Array.from({ length: n }, (_, i) => at(rr * 0.92, a + (i * 360) / n));
      let dd = '';
      for (let i = 0; i < n; i++) dd += `M${pt(v[i])}L${pt(v[(i + k) % n])}`;
      path(dd, w * 0.6);
      circle(c, rr * 0.32, w * 0.4, 'paper');
      break;
    }
    case 'eye': {
      const t1 = at(rr * 0.98, a), t2 = at(rr * 0.98, a + 180);
      path(`M${pt(t1)}Q${pt(at(rr * 0.62, a + 90))} ${pt(t2)}Q${pt(at(rr * 0.62, a - 90))} ${pt(t1)}Z`, w * 0.7, 'paper');
      circle(c, rr * 0.22, 0, 'ink');
      break;
    }
  }
  return out;
}

/** turn a disc to the style's orientation: out from `centre`, along it, upright, or its own */
export function orient(d: Disc, s: Style, centre: Pt): number {
  const out = (Math.atan2(d.c[0] - centre[0], -(d.c[1] - centre[1])) * 180) / Math.PI;
  return s.orient === 'radial' ? out : s.orient === 'tangent' ? out + 90 : s.orient === 'up' ? 0 : d.a;
}

// ─── a fill, drawn ────────────────────────────────────────────────────────────────────────────
export interface FillResult { marks: Mark[]; discs: Disc[]; stats: Evenness }
/** fill a region evenly with the style's ornaments; k scales the style's sizes (1: seal units) */
export function fill(o: { region: Shape; avoid: Shape[]; zones: Shape[]; sym: Sym; style: Style; seed: number; k: number; centre: Pt; stats?: boolean }): FillResult {
  const s = o.style, k = o.k;
  const rMax = s.packMax * k, rMin = Math.min(rMax, s.packMin * k), gap = s.packGap * k;
  const discs = fillPasses({ region: o.region, avoid: o.avoid, zones: o.zones, sym: o.sym, rMax, rMin, gap, tries: Math.round(s.packTries), jitter: s.packJitter, snapTol: s.snap * rMax, refill: s.refill, stipple: s.stipple, seed: o.seed });
  const marks: Mark[] = [];
  const W = s.weight * k;
  for (const d of discs) {
    const q = seeded(hash(o.seed, 0x0e7a, d.id, d.pass));
    const dd = { ...d, a: orient(d, s, o.centre) };
    if (d.pass === 2) { marks.push({ k: 'circle', x: f(d.c[0]), y: f(d.c[1]), r: f(Math.max(0.1 * k, d.r * 0.9)), w: 0, fill: 'ink', layer: 'ground' }); continue; }
    marks.push(...ornament(pickKind(s, d.r, rMax, q()), dd, s, W, rMax, q));
  }
  if (s.links > 0.02) marks.push(...links(discs.filter((d) => d.pass < 2), o, gap, rMax, W));
  return { marks, discs, stats: o.stats ? evenness(o.region, [...o.avoid, ...o.zones], discs) : { n: discs.filter((d) => d.pass < 2).length, coverage: NaN, meanGap: NaN, p95Gap: NaN, maxGap: NaN } };
}

/** lace: a curved hairline between near neighbours, where it crosses nothing */
function links(ds: Disc[], o: { region: Shape; avoid: Shape[]; zones: Shape[]; style: Style; seed: number }, gap: number, rMax: number, W: number): Mark[] {
  const s = o.style, reach = gap + 0.7 * rMax;
  const index = new ShapeIndex([...o.avoid, ...o.zones], reach + rMax);
  let d = '';
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) {
    const A = ds[i], B = ds[j];
    const dist = Math.sqrt(sq(B.c[0] - A.c[0]) + sq(B.c[1] - A.c[1]));
    if (dist - A.r - B.r > reach || dist < 1e-6) continue;
    const h = hash(o.seed, 0x11c, Math.min(A.id, B.id), Math.max(A.id, B.id));
    if ((h % 1000) / 1000 >= s.links) continue;
    const u: Pt = [(B.c[0] - A.c[0]) / dist, (B.c[1] - A.c[1]) / dist], n: Pt = [-u[1], u[0]];
    const p0: Pt = [A.c[0] + u[0] * A.r, A.c[1] + u[1] * A.r], p1: Pt = [B.c[0] - u[0] * B.r, B.c[1] - u[1] * B.r];
    const bend = s.linkBend * (dist - A.r - B.r) * 0.6 * ((h >> 10) & 1 ? 1 : -1) * A.m;
    const ctl: Pt = [(p0[0] + p1[0]) / 2 + n[0] * bend, (p0[1] + p1[1]) / 2 + n[1] * bend];
    const mid: Pt = [(p0[0] + 2 * ctl[0] + p1[0]) / 4, (p0[1] + 2 * ctl[1] + p1[1]) / 4];
    if (sdf(o.region, mid) >= 0 || index.dist(mid) <= 0) continue;
    if (ds.some((x) => x !== A && x !== B && Math.sqrt(sq(mid[0] - x.c[0]) + sq(mid[1] - x.c[1])) < x.r)) continue;
    d += `M${pt(p0)}Q${pt(ctl)} ${pt(p1)}`;
  }
  return d ? [{ k: 'path', d, w: W * 0.5, fill: 'none', layer: 'ground' }] : [];
}
