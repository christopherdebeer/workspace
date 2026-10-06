/**
 * Seals: the junction diagrams of Markovs Chains, engraved as seals.
 *
 * Three pure stages, so the game can take any of them:
 *
 *     style (a suit's hyperparameters) ──sample(seed)──▶ params (that seal's numbers)
 *     params + faces ──draw(seed)──▶ marks (circles, paths, figures; the rim is radius 50)
 *     marks ──sealSvg / sealCard──▶ SVG strings
 *
 * Every layer of the ground draws from its own stream (`hash(seed, layer)`), so turning one
 * hyperparameter re-draws that layer and leaves the rest of the seal where it was. The ground
 * is symmetric: each layer draws one half-sector and repeats it, mirrored, round the fold.
 *
 * The junction is drawn over the ground, bold: each exit a shaft with a barbed head out past the
 * rim, its die faces as numbered roundels across the shaft; the stays a closed loop hanging off
 * the hub, with its faces on the loop — inside the seal, never reaching for a port.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { SCHEMA, type Style } from './styles';

export type Fill = 'none' | 'ink' | 'paper' | 'wash';
export type Layer = 'wash' | 'ground' | 'junction';
export type Mark =
  | { k: 'path'; d: string; w: number; fill?: Fill; dash?: string; op?: number; layer: Layer; clip?: boolean }
  | { k: 'circle'; x: number; y: number; r: number; w: number; fill?: Fill; dash?: string; op?: number; layer: Layer; clip?: boolean }
  | { k: 'text'; x: number; y: number; size: number; text: string; layer: Layer };
export interface Seal {
  marks: Mark[];
  /** the radius the lattice is clipped to (the band's inner edge) */
  clipR: number;
}
type Pt = [number, number];

/** the rim's radius, in seal units */
export const R = 50;
const f = (n: number) => Math.round(n * 100) / 100;
const rad = (a: number) => (a * Math.PI) / 180;
/** a point at radius r, angle a in degrees: 0 north, clockwise (as the card lies) */
export const pol = (r: number, a: number): Pt => [r * Math.sin(rad(a)), -r * Math.cos(rad(a))];
const add = (p: Pt, q: Pt): Pt => [p[0] + q[0], p[1] + q[1]];
const angleOf = (p: Pt) => (Math.atan2(p[0], -p[1]) * 180) / Math.PI;
const mod = (a: number, m: number) => ((a % m) + m) % m;
const pt = (p: Pt) => `${f(p[0])} ${f(p[1])}`;
const seg = (a: Pt, b: Pt) => `M${pt(a)}L${pt(b)}`;
const arc = (r: number, a0: number, a1: number) => `M${pt(pol(r, a0))}A${f(r)} ${f(r)} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(pol(r, a1))}`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** a smooth closed curve through points (Catmull–Rom as cubics) */
function closed(ps: Pt[]): string {
  const n = ps.length;
  let d = `M${pt(ps[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = ps[(i - 1 + n) % n], p1 = ps[i], p2 = ps[(i + 1) % n], p3 = ps[(i + 2) % n];
    d += `C${pt([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${pt([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${pt(p2)}`;
  }
  return d + 'Z';
}
const polyline = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('');

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

// ─── stage one: a seed picks a seal out of the style ──────────────────────────────────────────
/** the style with every `vary` number moved by the seed, by up to a quarter of its range ×
 *  variance, kept in range and on its step */
export function sample(style: Style, seed: number): Style {
  const r = seeded(hash(seed, 0x5ea1));
  const out: Style = { ...style };
  for (const c of SCHEMA) {
    if (!c.vary || c.kind !== 'num') continue;
    const lo = c.min!, hi = c.max!, step = c.step!;
    const v = (style[c.key] as number) + (r() * 2 - 1) * style.variance * (hi - lo) * 0.25;
    (out as unknown as Record<string, number>)[c.key] = clamp(+(Math.round(v / step) * step).toFixed(6), lo, hi);
  }
  return out;
}

// ─── stage two: the marks ─────────────────────────────────────────────────────────────────────
/** the seal's marks: the ground from `p` and the seed, then the junction (`faces`: six die faces,
 *  each an exit 0 north … 3 west, or -1 to stay; null for the bare seal) */
export function draw(p: Style, faces: number[] | null, seed: number): Seal {
  const out: Mark[] = [];
  const W = p.weight;
  const rs = (layer: number): Rand => seeded(hash(seed, layer));
  const fold = [4, 8, 12].includes(p.fold) ? p.fold : 4;
  const wedge = 360 / fold, half = wedge / 2;
  /** every place a half-sector's angle lands, round the fold and mirrored: m is -1 when mirrored */
  const sym = (a: number): Array<{ a: number; m: number }> => {
    const seen = new Set<number>(), o: Array<{ a: number; m: number }> = [];
    for (let k = 0; k < fold; k++) for (const m of [1, -1]) {
      const A = mod(k * wedge + m * a, 360), key = Math.round(A * 1000);
      if (!seen.has(key)) { seen.add(key); o.push({ a: A, m }); }
    }
    return o;
  };
  /** both sides of every copy of a sector's angle a0 (for marks that run away from it) */
  const pairs = (a0: number): Array<{ a: number; m: number }> => Array.from({ length: fold * 2 }, (_, i) => ({ a: mod(Math.floor(i / 2) * wedge + a0, 360), m: i % 2 ? -1 : 1 }));
  /** a local frame at radius r0, angle a: u outward, v across (mirrored by m) */
  const frame = (r0: number, a: number, m: number) => (u: number, v: number): Pt => add(pol(r0 + u, a), pol(v * m, a + 90));
  const path = (d: string, w: number, extra: Partial<Extract<Mark, { k: 'path' }>> = {}) => { if (d) out.push({ k: 'path', d, w, layer: 'ground', ...extra }); };
  const circle = (c: Pt, r: number, w: number, extra: Partial<Extract<Mark, { k: 'circle' }>> = {}) => out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(r), w, layer: 'ground', ...extra });
  const AXES = [0, 90, 180, 270], DIAGS = [45, 135, 225, 315];

  // the wash: soft blots of colour, symmetric like the rest
  if (p.washAmount > 0) {
    const r = rs(1);
    const n = Math.round(3 + 7 * p.washAmount);
    for (let i = 0; i < n; i++) {
      const rr = 12 + r() * 33, a = r() * half, s = 3 + r() * 8 * p.washAmount + 2;
      const shape = Array.from({ length: 9 }, () => 0.55 + 0.8 * r());
      const op = f(0.1 + 0.25 * p.washAmount * r());
      for (const c of sym(a)) {
        const ctr = pol(rr, c.a);
        out.push({ k: 'path', d: closed(shape.map((k, j) => add(ctr, pol(s * k, c.a + c.m * j * 40)))), w: 0, fill: 'wash', op, layer: 'wash' });
      }
    }
  }

  // the rim: rings, then a ring of beads, then the band's edge
  for (let i = 0; i < p.rings; i++) circle([0, 0], R - i * p.ringGap, W * (i === 0 ? 1.6 : i % 2 ? 0.55 : 0.9));
  let rIn = R - (p.rings - 1) * p.ringGap;
  if (p.beads > 0.02) {
    const rb = rIn - 1.3 - p.beadR;
    const n = Math.max(fold, Math.round((40 + p.beads * 150) / fold) * fold);
    let d = '';
    for (let i = 0; i < n; i++) { const c = pol(rb, (i * 360) / n + 180 / n); d += `M${pt([c[0] - p.beadR, c[1]])}a${f(p.beadR)} ${f(p.beadR)} 0 1 0 ${f(2 * p.beadR)} 0a${f(p.beadR)} ${f(p.beadR)} 0 1 0 ${f(-2 * p.beadR)} 0`; }
    path(d, 0, { fill: 'ink' });
    if (p.diagNodes) for (const a of DIAGS) { circle(pol(rb, a), 1.5, W * 0.9, { fill: 'paper' }); circle(pol(rb, a), 0.55, 0, { fill: 'ink' }); }
    rIn = rb - p.beadR - 1.3;
  } else if (p.diagNodes) for (const a of DIAGS) { circle(pol(rIn, a), 1.5, W * 0.9, { fill: 'paper' }); circle(pol(rIn, a), 0.55, 0, { fill: 'ink' }); }
  circle([0, 0], rIn, W * 0.6);
  // the four cardinal nodes, standing out past the rim, with dots running on
  for (const a of AXES) {
    const at = R + p.nodeOut;
    if (p.nodeOut > 2.6) path(seg(pol(R, a), pol(at - 2.4, a)), W * 0.9);
    circle(pol(at, a), p.nodeOut > 0 ? 2.4 : 1.9, W * 1.3, { fill: 'paper' });
    circle(pol(at, a), p.nodeOut > 0 ? 1.25 : 0.9, W * 0.6);
    for (let i = 0; i < p.nodeDots; i++) circle(pol(at + 4.2 + i * 2.5, a), Math.max(0.3, 0.75 - i * 0.13), 0, { fill: 'ink' });
  }

  // the band, between the rim's edge and the lattice
  const rTop = rIn - 0.8;
  let clipR = rTop;
  if (p.band === 'scale') {
    const r = rs(3);
    const rB = rTop - p.bandLen * 1.15 - 0.6;
    const g0 = Math.min(6, half * 0.3), aEnd = half - Math.min(2.5, half * 0.12);
    const aStart = aEnd - (aEnd - g0) * p.bandSpan;
    const step = 1.1 / p.bandDensity, n = Math.floor((aEnd - aStart) / step);
    const raw = Array.from({ length: n + 2 }, () => r());
    const spike = Array.from({ length: n + 1 }, () => r() < 0.07);
    let ticks = '', base = '';
    for (const c of pairs(0)) {
      const s = c.m;
      base += arc(rB, Math.min(c.a + s * aStart, c.a + s * aEnd), Math.max(c.a + s * aStart, c.a + s * aEnd));
      base += arc(rB - 1, Math.min(c.a + s * aStart, c.a + s * aEnd), Math.max(c.a + s * aStart, c.a + s * aEnd));
      for (let i = 0; i <= n; i++) {
        const ruler = i % 5 === 0 ? 1 : 0.55;
        const noise = (raw[i] + raw[i + 1] + (raw[i - 1] ?? raw[i])) / 3 * 1.3 * (spike[i] ? 1.5 : 1);
        const taper = Math.min(1, (i + 1) / 3, (n - i + 1) / 3);
        const L = p.bandLen * clamp(ruler * (1 - p.bandRough) + noise * p.bandRough, 0.15, 1.15) * taper;
        const A = c.a + s * (aStart + i * step);
        ticks += seg(pol(rB, A), pol(rB + L, A));
      }
    }
    path(base, W * 0.5);
    path(ticks, W * 0.42);
    clipR = rB - 1;
  } else if (p.band === 'rays') {
    const r = rs(3);
    const rF = rTop - p.bandLen - 0.5;
    const spread = half * p.bandSpan * 0.85, step = 1.5 / p.bandDensity;
    const J = Math.floor(spread / step);
    const len = Array.from({ length: J + 1 }, (_, j) => p.bandLen * (1 - (0.55 * j) / Math.max(1, J)) * (1 - p.bandRough * 0.5 * r()));
    let rays = '', base = '';
    for (const c of pairs(half)) {
      base += arc(rF, Math.min(c.a, c.a - c.m * spread), Math.max(c.a, c.a - c.m * spread));
      for (let j = 0; j <= J; j++) { const A = c.a - c.m * j * step; rays += seg(pol(rF, A), pol(rF + len[j], A)); }
    }
    path(base, W * 0.6);
    path(rays, W * 0.4);
  }

  // the lattice: spokes, a star polygon (and a smaller one), an orbit, petals — clipped at the band
  if (p.spokes) for (let k = 0; k < p.spokes; k++) path(seg(pol(p.hubR + 1.5, (k * 360) / p.spokes), pol(rTop, (k * 360) / p.spokes)), W * 0.5);
  const starAt = (n: number, skip: number, r0: number, rot: number, ext: number) => {
    const v = Array.from({ length: n }, (_, i) => pol(r0, rot + (i * 360) / n));
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = v[i], b = v[(i + skip) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      d += seg([a[0] - u[0] * L * ext, a[1] - u[1] * L * ext], [b[0] + u[0] * L * ext, b[1] + u[1] * L * ext]);
    }
    path(d, W * 0.6, { clip: true });
    for (const c of v) if (Math.hypot(...c) < clipR - 1.5) circle(c, 1.25, W * 0.8, { fill: 'paper' });
  };
  if (p.star >= 3) {
    const skip = clamp(Math.round(p.starSkip), 1, Math.floor((p.star - 1) / 2));
    starAt(p.star, skip, p.starR, p.starRot, p.starExtend);
    if (p.star2R > 0.05) starAt(p.star, skip, p.starR * p.star2R, p.starRot + 180 / p.star, 0);
  }
  circle([0, 0], p.hubR + (clipR - p.hubR) * 0.45, W * 0.45, { dash: '.9 1.3' });
  for (let i = 0; i < p.lenses; i++) circle(pol(p.lensR * p.lensOffset, (p.lenses === 2 ? 90 : 0) + (i * 360) / p.lenses), p.lensR, W * 0.6, { clip: true });
  for (let i = 0; i < p.petals; i++) circle(pol(p.petalR * p.petalOffset, (i * 360) / p.petals), p.petalR, W * 0.55, { clip: true });
  // beads strung on the spokes (the same radii on every spoke of a kind)
  if (p.dots > 0.02 && p.spokes) {
    const r = rs(4);
    for (const set of p.spokes === 8 ? [AXES, DIAGS] : [AXES]) {
      const n = Math.round(p.dots * 4);
      for (let i = 0; i < n; i++) {
        const rr = p.hubR + 4 + r() * (clipR - p.hubR - 7), big = r() < 0.35, sz = 0.55 + r() * 0.5;
        for (const a of set) big ? circle(pol(rr, a), sz + 0.5, W * 0.7, { fill: 'paper' }) : circle(pol(rr, a), sz, 0, { fill: 'ink' });
      }
    }
  }
  // the hub's ring (the paper inside it clears the lattice)
  circle([0, 0], p.hubR, W * 1.1, { fill: 'paper' });
  circle([0, 0], p.hubR + 1.4, W * 0.45);

  // ornament: scrolls, motifs, crescents, sparkles
  if (p.scrolls > 0.04) {
    const r = rs(9);
    const n = 1 + Math.round(p.scrolls * 2);
    const sets = Array.from({ length: n }, (_, j) => ({ s: (3.6 + r() * 2) * (1 - j * 0.28), lift: r(), turn: 0.9 + r() * 0.4 }));
    let d = '';
    for (const a of DIAGS) for (const m of [1, -1]) {
      const L = frame(p.motifR, a, m);
      sets.forEach(({ s, lift, turn }, j) => {
        const p0: Pt = [-p.motifSize * 0.9 - j * 1.4, 0.4 + j * 0.6], p1: Pt = [s * (0.4 + lift * 0.5) + j * 1.4, s * 1.3 + j * 1.2];
        const ps: Pt[] = [];
        for (let t = 0; t <= 1.0001; t += 0.1) { const c: Pt = [p0[0] - s * 0.4, p1[1] + 0.4]; const q = (1 - t) * (1 - t), w2 = 2 * (1 - t) * t, e = t * t; ps.push([q * p0[0] + w2 * c[0] + e * p1[0], q * p0[1] + w2 * c[1] + e * p1[1]]); }
        const cc: Pt = [p1[0] - s * 0.5, p1[1]], r0 = s * 0.5;
        for (let t = 0; t <= 1.0001; t += 1 / 18) { const th = turn * Math.PI * 2 * t, rr = r0 * (1 - 0.72 * t); ps.push([cc[0] + rr * Math.cos(th), cc[1] + rr * Math.sin(th)]); }
        d += polyline(ps.map(([u, v]) => L(u, v)));
      });
    }
    path(d, W * 0.85);
  }
  const at = p.motifAt === 'axes' ? AXES : p.motifAt === 'diagonals' ? DIAGS : [...AXES, ...DIAGS];
  for (const a of at) {
    const c = pol(p.motifR, a);
    if (p.motifRoundel) { circle(c, p.motifSize * 1.6, W * 1.1, { fill: 'paper' }); circle(c, p.motifSize * 1.32, W * 0.4); }
    path(glyph(p.motif, c, p.motifSize, a), W * 0.9, { fill: p.motifFill ? 'ink' : 'paper' });
  }
  if (p.crescents) for (const a of p.crescents === 2 ? AXES : [90, 270]) path(glyph('crescent', pol(p.crescentR, a), 2.4, a), 0, { fill: 'ink' });
  if (p.sparkles) {
    const r = rs(11);
    let d = '';
    for (let i = 0; i < p.sparkles; i++) {
      const rr = p.hubR + 4 + r() * (clipR - p.hubR - 7), a = Math.min(6, half * 0.35) + r() * Math.max(0.5, half - Math.min(6, half * 0.35) - 3), s = 1 + r() * 1.5;
      for (const c of sym(a)) d += glyph('star', pol(rr, c.a), s, c.a);
    }
    path(d, 0, { fill: 'ink' });
  }

  if (faces) out.push(...junction(p, faces));
  return { marks: out, clipR: f(clipR) };
}

/** the junction's marks: shafts, heads, roundels, the stay loop, the hub */
export function junction(p: Style, faces: number[]): Mark[] {
  const out: Mark[] = [];
  const J = p.jWeight, rr = p.roundelR, hj = 5;
  const by = new Map<number, number[]>();
  faces.forEach((d, i) => by.set(d, [...(by.get(d) ?? []), i + 1]));
  const exitsTo = [0, 1, 2, 3].filter((d) => by.has(d));
  const path = (d: string, w: number, fill: Fill = 'none') => out.push({ k: 'path', d, w, fill, layer: 'junction' });
  /** numbers onto places so they read as print does: left to right, or top to bottom */
  const inOrder = (ps: Pt[]): Pt[] => {
    const xs = ps.map((q) => q[0]), ys = ps.map((q) => q[1]);
    const byX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
    return [...ps].sort((a, b) => (byX ? a[0] - b[0] : a[1] - b[1]));
  };
  const roundel = (c: Pt, r: number, n: number) => {
    out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(r), w: 0.8 * J, fill: 'paper', layer: 'junction' });
    out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(r * 0.8), w: 0.28 * J, fill: 'none', layer: 'junction' });
    out.push({ k: 'text', x: f(c[0]), y: f(c[1] + r * 0.44), size: f(r * 1.25), text: String(n), layer: 'junction' });
  };
  /** a barbed head, its tip at `tip`, pointing along angle t */
  const head = (tip: Pt, t: number, s: number) => {
    const L = (u: number, v: number) => add(tip, add(pol(u * s, t), pol(v * s, t + 90)));
    return `M${pt(L(0, 0))}L${pt(L(-7, 3.4))}L${pt(L(-4.6, 0))}L${pt(L(-7, -3.4))}Z`;
  };
  for (const d of exitsTo) {
    const a = d * 90;
    path(seg(pol(hj + 0.4, a), pol(R - 3.5, a)), 1.2 * J);
    path(seg(pol(R - 9, a), pol(R - 3.5, a)), 0.3 * J);
    path(head(pol(R + 3, a), a, 1), 0.3 * J, 'ink');
  }
  // the stays: a loop off the hub, on the side furthest from the exits
  const stays = by.get(-1) ?? [];
  if (stays.length) {
    const dist = (a: number, b: number) => { const x = mod(a - b, 360); return Math.min(x, 360 - x); };
    let phi: number, rho: number, small: number;
    const free = [2, 3, 1, 0].filter((d) => !by.has(d));
    if (free.length) {
      phi = 90 * free.reduce((best, d) => (exitsTo.reduce((s, e) => s + dist(d * 90, e * 90), 0) > exitsTo.reduce((s, e) => s + dist(best * 90, e * 90), 0) ? d : best), free[0]);
      // (big enough that its faces spread over no more than 130° of it)
      small = stays.length >= 4 ? 0.88 : 1;
      rho = Math.max(9.5, ((stays.length - 1) * 2 * rr * small * 1.12) / rad(130));
    } else {
      // (four exits: the loop sits on the diagonal between the two thinnest)
      const weight = (a: number) => (by.get(Math.floor(a / 90))!.length + by.get((Math.floor(a / 90) + 1) % 4)!.length);
      phi = [135, 45, 225, 315].reduce((best, a) => (weight(a) < weight(best) ? a : best), 135);
      rho = 7.2;
      small = 0.82;
    }
    const hR = hj + 0.9, cL = hj - 1.2 + rho, C = pol(cL, phi);
    const x = (cL * cL - rho * rho + hR * hR) / (2 * cL), h = Math.sqrt(Math.max(0, hR * hR - x * x));
    const P1 = add(pol(x, phi), pol(h, phi + 90)), P2 = add(pol(x, phi), pol(-h, phi + 90));
    const b1 = angleOf([P1[0] - C[0], P1[1] - C[1]]), b2 = angleOf([P2[0] - C[0], P2[1] - C[1]]);
    const cw = mod(phi - b1, 360) < mod(b2 - b1, 360);
    path(`M${pt(P1)}A${f(rho)} ${f(rho)} 0 1 ${cw ? 1 : 0} ${pt(P2)}`, 1.0 * J);
    path(head(P2, b2 + (cw ? 90 : -90), 0.62), 0.3 * J, 'ink');
    const r = rr * small, dpsi = ((2 * r * 1.12) / rho) * (180 / Math.PI);
    const at = inOrder(stays.map((_, i) => add(C, pol(rho, phi + (i - (stays.length - 1) / 2) * dpsi))));
    stays.forEach((n, i) => roundel(at[i], r, n));
  }
  for (const d of exitsTo) {
    const fs = by.get(d)!, dpsi = ((2 * rr * 1.12) / p.faceR) * (180 / Math.PI);
    const at = inOrder(fs.map((_, i) => pol(p.faceR, d * 90 + (i - (fs.length - 1) / 2) * dpsi)));
    fs.forEach((n, i) => roundel(at[i], rr, n));
  }
  out.push({ k: 'circle', x: 0, y: 0, r: hj, w: 1 * J, fill: 'paper', layer: 'junction' });
  out.push({ k: 'circle', x: 0, y: 0, r: hj - 1.4, w: 0.35 * J, fill: 'none', layer: 'junction' });
  out.push({ k: 'circle', x: 0, y: 0, r: 0.9, w: 0, fill: 'ink', layer: 'junction' });
  return out;
}

// ─── stage three: SVG ─────────────────────────────────────────────────────────────────────────
const SERIF = "Georgia,'Times New Roman',serif";
function markSvg(m: Mark, s: Style): string {
  const col = (x?: Fill) => (x === 'ink' ? s.ink : x === 'paper' ? s.paper : x === 'wash' ? s.wash : 'none');
  if (m.k === 'text') return `<text x="${m.x}" y="${m.y}" font-size="${m.size}" font-family="${SERIF}" text-anchor="middle" fill="${s.ink}">${m.text}</text>`;
  const stroke = m.w > 0 ? ` stroke="${s.ink}" stroke-width="${f(m.w)}"` : '';
  const extra = `${m.dash ? ` stroke-dasharray="${m.dash}"` : ''}${m.op !== undefined ? ` opacity="${m.op}"` : ''}`;
  if (m.k === 'circle') return `<circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="${col(m.fill)}"${stroke}${extra}/>`;
  return `<path d="${m.d}" fill="${col(m.fill)}"${stroke}${extra} stroke-linecap="round" stroke-linejoin="round"/>`;
}
/** the seal as SVG content (no <svg> wrapper), centred on 0,0: the wash, the ground (faint;
 *  its lattice clipped at the band), the junction. `id` keeps clip paths apart on one page. */
export function sealSvg(seal: Seal, s: Style, id: string): string {
  const of = (pred: (m: Mark) => boolean) => seal.marks.filter(pred).map((m) => markSvg(m, s)).join('');
  // (the ground keeps its painting order; the clipped marks are grouped where the first one fell)
  const ground: string[] = [];
  let clipped = '', placed = false;
  for (const m of seal.marks) {
    if (m.layer !== 'ground') continue;
    if ('clip' in m && m.clip) { clipped += markSvg(m, s); if (!placed) { ground.push('\u0000'); placed = true; } }
    else ground.push(markSvg(m, s));
  }
  const g = ground.join('').replace('\u0000', `<g clip-path="url(#${id}k)">${clipped}</g>`);
  return `<defs><clipPath id="${id}k"><circle r="${seal.clipR}"/></clipPath></defs><g>${of((m) => m.layer === 'wash')}</g><g opacity="${s.faint}">${g}</g><g>${of((m) => m.layer === 'junction')}</g>`;
}
/** a whole seal as an <svg>, on its paper */
export function sealSvgFile(seal: Seal, s: Style, id = 's', paper = true): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-64 -64 128 128">${paper ? `<rect x="-64" y="-64" width="128" height="128" fill="${s.paper}"/>` : ''}${sealSvg(seal, s, id)}</svg>`;
}

// ─── the words under a seal ───────────────────────────────────────────────────────────────────
const ARROWS = ['↑', '→', '↓', '←'];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];
/** "1–2 ↑   3 →   4–6 stay", in the order the faces come */
export function faceLine(faces: number[]): string {
  const by = new Map<number, number[]>();
  faces.forEach((d, i) => by.set(d, [...(by.get(d) ?? []), i + 1]));
  return [...by].map(([d, fs]) => `${fs.length > 1 && fs.every((x, i) => !i || x === fs[i - 1] + 1) ? `${fs[0]}–${fs[fs.length - 1]}` : fs.join(',')} ${d < 0 ? 'stay' : ARROWS[d]}`).join('   ');
}
/** "Six outcomes · one state · two exits" */
export function summary(faces: number[]): string {
  const n = new Set(faces.filter((d) => d >= 0)).size;
  const o = WORDS[faces.length] ?? String(faces.length);
  return `${o[0].toUpperCase()}${o.slice(1)} outcomes · one state · ${WORDS[n]} exit${n === 1 ? '' : 's'}`;
}
/** the seal on a playing card (63 × 88 mm): its title, the seal, the faces in words */
export function sealCard(o: { style: Style; seed: number; faces: number[] | null; title: string; id: string }): string {
  const s = sample(o.style, o.seed);
  const seal = draw(s, o.faces, o.seed);
  const sum = o.faces ? summary(o.faces) : '';
  const rule = sum.length * 0.62 + 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88"><rect x=".5" y=".5" width="62" height="87" rx="3.4" fill="${s.paper}" stroke="#8d8270" stroke-width=".5"/><rect x="2.4" y="2.4" width="58.2" height="83.2" rx="2.2" fill="none" stroke="${s.ink}" stroke-width=".22" opacity=".7"/>`
    + `<text x="31.5" y="10" text-anchor="middle" font-size="3.4" font-family="${SERIF}" letter-spacing=".55" fill="${s.ink}">${o.title}</text>`
    + `<g transform="translate(31.5 40.6) scale(.47)">${sealSvg(seal, s, o.id)}</g>`
    + (o.faces ? `<text x="31.5" y="74.8" text-anchor="middle" font-size="3.7" font-family="${SERIF}" fill="${s.ink}" xml:space="preserve">${faceLine(o.faces)}</text><path d="M7 79.6H${f(31.5 - rule)}M${f(31.5 + rule)} 79.6H56" stroke="${s.ink}" stroke-width=".22"/><circle cx="7" cy="79.6" r=".45" fill="${s.ink}"/><circle cx="56" cy="79.6" r=".45" fill="${s.ink}"/><text x="31.5" y="80.4" text-anchor="middle" font-size="2.15" font-family="${SERIF}" letter-spacing=".3" fill="${s.ink}">${sum}</text>` : '')
    + '</svg>';
}
