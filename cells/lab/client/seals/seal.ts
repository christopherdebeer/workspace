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
import { shapeOutline, type Pt, type Shape } from './field';
import { accentW, add, f, fill, glyph, pol, pt, type Fill, type FillResult, type Mark } from './ornament';
import type { Disc, Evenness } from './pack';
import { SCHEMA, type Style } from './styles';
import { ornate } from './structure';

export { glyph, pol, type Fill, type Layer, type Mark } from './ornament';
export interface Seal {
  marks: Mark[];
  /** the radius the lattice is clipped to (the band's inner edge) */
  clipR: number;
  /** the fill: its region, the lines it kept off, the safe zones it kept clear, its discs */
  region: Shape;
  avoid: Shape[];
  zones: Shape[];
  discs: Disc[];
  stats: Evenness;
}

/** the rim's radius, in seal units */
export const R = 50;
const rad = (a: number) => (a * Math.PI) / 180;
const angleOf = (p: Pt) => (Math.atan2(p[0], -p[1]) * 180) / Math.PI;
const mod = (a: number, m: number) => ((a % m) + m) % m;
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
/** the seal's marks: the ground from `p` and the seed — its lines, then an even fill of ornament
 *  in the space they leave — then the junction (`faces`: six die faces, each an exit 0 north …
 *  3 west, or -1 to stay; null for the bare seal). `show`: draw the faces (default: when given);
 *  `zones`: keep the fill clear of where they go (default: when given). */
export function draw(p: Style, faces: number[] | null, seed: number, o: { show?: boolean; zones?: boolean; stats?: boolean } = {}): Seal {
  const out: Mark[] = [];
  /** the lines the fill keeps off */
  const avoid: Shape[] = [];
  const edge = p.packEdge;
  const line = (a: Pt, b: Pt, w: number) => avoid.push({ k: 'capsule', a, b, r: w / 2 + edge });
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
  for (let i = 0; i < p.rings; i++) circle([0, 0], R - i * p.ringGap, i % 2 ? W * 0.55 : accentW(W, i === 0 ? 1.6 : 0.9, p.accent));
  let rIn = R - (p.rings - 1) * p.ringGap;
  if (p.beads > 0.02) {
    const rb = rIn - 1.3 - p.beadR;
    const n = Math.max(fold, Math.round((40 + p.beads * 150) / fold) * fold);
    let d = '';
    for (let i = 0; i < n; i++) { const c = pol(rb, (i * 360) / n + 180 / n); d += `M${pt([c[0] - p.beadR, c[1]])}a${f(p.beadR)} ${f(p.beadR)} 0 1 0 ${f(2 * p.beadR)} 0a${f(p.beadR)} ${f(p.beadR)} 0 1 0 ${f(-2 * p.beadR)} 0`; }
    path(d, 0, { fill: 'ink' });
    if (p.diagNodes) for (const a of DIAGS) { circle(pol(rb, a), 1.5, accentW(W, 0.9, p.accent), { fill: 'paper' }); circle(pol(rb, a), 0.55, 0, { fill: 'ink' }); }
    rIn = rb - p.beadR - 1.3;
  } else if (p.diagNodes) for (const a of DIAGS) { circle(pol(rIn, a), 1.5, accentW(W, 0.9, p.accent), { fill: 'paper' }); circle(pol(rIn, a), 0.55, 0, { fill: 'ink' }); }
  circle([0, 0], rIn, W * 0.6);
  // the four cardinal nodes, standing out past the rim, with dots running on
  for (const a of AXES) {
    const at = R + p.nodeOut;
    if (p.nodeOut > 2.6) path(seg(pol(R, a), pol(at - 2.4, a)), W * 0.9);
    circle(pol(at, a), p.nodeOut > 0 ? 2.4 : 1.9, accentW(W, 1.3, p.accent), { fill: 'paper' });
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
  if (p.lines) {
  if (p.spokes) for (let k = 0; k < p.spokes; k++) { const a = pol(p.hubR + 1.5, (k * 360) / p.spokes), b = pol(rTop, (k * 360) / p.spokes); path(seg(a, b), W * 0.5); line(a, b, W * 0.5); }
    const starAt = (n: number, skip: number, r0: number, rot: number, ext: number) => {
      const v = Array.from({ length: n }, (_, i) => pol(r0, rot + (i * 360) / n));
      let d = '';
      for (let i = 0; i < n; i++) {
        const a = v[i], b = v[(i + skip) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
        const a1: Pt = [a[0] - u[0] * L * ext, a[1] - u[1] * L * ext], b1: Pt = [b[0] + u[0] * L * ext, b[1] + u[1] * L * ext];
        d += seg(a1, b1);
        line(a1, b1, W * 0.6);
      }
      path(d, W * 0.6, { clip: true });
      for (const c of v) if (Math.hypot(...c) < clipR - 1.5) { circle(c, 1.25, W * 0.8, { fill: 'paper' }); avoid.push({ k: 'circle', c, r: 1.25 + edge }); }
    };
    if (p.star >= 3) {
      const skip = clamp(Math.round(p.starSkip), 1, Math.floor((p.star - 1) / 2));
      starAt(p.star, skip, p.starR, p.starRot, p.starExtend);
      if (p.star2R > 0.05) starAt(p.star, skip, p.starR * p.star2R, p.starRot + 180 / p.star, 0);
    }
    const orbit = p.hubR + (clipR - p.hubR) * 0.45;
    circle([0, 0], orbit, W * 0.45, { dash: '.9 1.3' });
    avoid.push({ k: 'stroke', c: [0, 0], r: orbit, w: W * 0.25 + edge });
    for (let i = 0; i < p.lenses; i++) { const c = pol(p.lensR * p.lensOffset, (p.lenses === 2 ? 90 : 0) + (i * 360) / p.lenses); circle(c, p.lensR, W * 0.6, { clip: true }); avoid.push({ k: 'stroke', c, r: p.lensR, w: W * 0.3 + edge }); }
    for (let i = 0; i < p.petals; i++) { const c = pol(p.petalR * p.petalOffset, (i * 360) / p.petals); circle(c, p.petalR, W * 0.55, { clip: true }); avoid.push({ k: 'stroke', c, r: p.petalR, w: W * 0.3 + edge }); }
    // beads strung on the spokes (the same radii on every spoke of a kind)
    if (p.dots > 0.02 && p.spokes) {
      const r = rs(4);
      for (const set of p.spokes === 8 ? [AXES, DIAGS] : [AXES]) {
        const n = Math.round(p.dots * 4);
        for (let i = 0; i < n; i++) {
          const rr = p.hubR + 4 + r() * (clipR - p.hubR - 7), big = r() < 0.35, sz = 0.55 + r() * 0.5;
          for (const a of set) { big ? circle(pol(rr, a), sz + 0.5, W * 0.7, { fill: 'paper' }) : circle(pol(rr, a), sz, 0, { fill: 'ink' }); avoid.push({ k: 'circle', c: pol(rr, a), r: sz + 0.5 + edge }); }
        }
      }
    }
  }
  // the hub's ring (the paper inside it clears the lattice)
  circle([0, 0], p.hubR, accentW(W, 1.1, p.accent), { fill: 'paper' });
  circle([0, 0], p.hubR + 1.4, W * 0.45);

  // the anchored ornament: the suit's motifs, the crescents
  const at = p.motifAt === 'axes' ? AXES : p.motifAt === 'diagonals' ? DIAGS : [...AXES, ...DIAGS];
  for (const a of at) {
    const c = pol(p.motifR, a);
    if (p.motifRoundel) { circle(c, p.motifSize * 1.6, accentW(W, 1.1, p.accent), { fill: 'paper' }); circle(c, p.motifSize * 1.32, W * 0.4); }
    path(glyph(p.motif, c, p.motifSize, a), W * 0.9, { fill: p.motifFill ? 'ink' : 'paper' });
    avoid.push({ k: 'circle', c, r: p.motifSize * (p.motifRoundel ? 1.6 : 1.1) + edge });
  }
  if (p.crescents) for (const a of p.crescents === 2 ? AXES : [90, 270]) { path(glyph('crescent', pol(p.crescentR, a), 2.4, a), 0, { fill: 'ink' }); avoid.push({ k: 'circle', c: pol(p.crescentR, a), r: 2.6 + edge }); }

  // the fill: the space the lines leave, filled evenly, kept clear of the faces
  const region: Shape = { k: 'diff', a: { k: 'circle', c: [0, 0], r: clipR - edge }, minus: [{ k: 'circle', c: [0, 0], r: p.hubR + 1.4 + edge }] };
  const parts = faces ? junction(p, faces) : null;
  const zones = parts && (o.zones ?? true) ? parts.zones.map((z) => ({ k: 'grow', s: z, by: p.zoneMargin }) as Shape) : [];
  const filled = fill({ region, avoid, zones, sym: { kind: 'rot', c: [0, 0], fold }, style: p, seed, k: 1, centre: [0, 0], stats: o.stats });
  out.push(...filled.marks);

  if (parts && (o.show ?? true)) out.push(...parts.marks);
  return { marks: out, clipR: f(clipR), region, avoid, zones, discs: filled.discs, stats: filled.stats };
}

/** the junction's marks — shafts, heads, roundels, the stay loop, the hub — and the zones they
 *  need kept clear to be read */
export function junction(p: Style, faces: number[]): { marks: Mark[]; zones: Shape[] } {
  const out: Mark[] = [];
  const zones: Shape[] = [{ k: 'circle', c: [0, 0], r: 5 }];
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
    zones.push({ k: 'circle', c, r });
    out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(r), w: 0.8 * J, fill: 'paper', layer: 'junction' });
    out.push({ k: 'circle', x: f(c[0]), y: f(c[1]), r: f(r * 0.8), w: 0.28 * J, fill: 'none', layer: 'junction' });
    out.push({ k: 'text', x: f(c[0]), y: f(c[1] + r * 0.44), size: f(r * 1.25), text: String(n), layer: 'junction' });
  };
  // the heads: their marks, and where along them (back from the tip) the line joins
  const hs = p.arrowSize;
  const HEADS: Record<string, { len: number; join: number }> = { barb: { len: 7, join: 4.6 }, dart: { len: 7, join: 6.6 }, open: { len: 6, join: 0.6 }, fleur: { len: 11, join: 4.6 } };
  const spec = HEADS[p.arrow] ?? HEADS.barb;
  /** a head with its tip at `tip`, pointing along angle t, at scale s */
  const head = (tip: Pt, t: number, s: number) => {
    const L = (u: number, v: number) => pt(add(tip, add(pol(u * s, t), pol(v * s, t + 90))));
    if (p.arrow === 'open') { path(`M${L(-6, 3.4)}L${L(0, 0)}L${L(-6, -3.4)}`, 0.75 * J * Math.max(0.6, s)); return; }
    if (p.arrow === 'dart') { path(`M${L(0, 0)}L${L(-7, 2.1)}L${L(-6.4, 0)}L${L(-7, -2.1)}Z`, 0.3 * J, 'ink'); return; }
    path(`M${L(0, 0)}L${L(-7, 3.4)}L${L(-4.6, 0)}L${L(-7, -3.4)}Z`, 0.3 * J, 'ink');
    if (p.arrow === 'fleur') path(`M${L(-7.6, 0)}L${L(-9.3, 1.5)}L${L(-11, 0)}L${L(-9.3, -1.5)}Z`, 0.4 * J, 'paper');
  };
  for (const d of exitsTo) {
    const a = d * 90, tip = R + 3, s = hs;
    path(seg(pol(hj + 0.4, a), pol(tip - spec.join * s, a)), 1.2 * J);
    zones.push({ k: 'capsule', a: pol(hj, a), b: pol(tip, a), r: 0.6 * J }, { k: 'circle', c: pol(tip - spec.len * s * 0.5, a), r: spec.len * s * 0.55 });
    head(pol(tip, a), a, s);
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
    // (the head lies along the curve: aimed from the point a head's length back on the arc to
    // the tip, so its base sits on the curve too; the arc stops where the head takes over)
    const s = 0.62 * hs, dir = cw ? 1 : -1, deg = 180 / Math.PI;
    const back = add(C, pol(rho, b2 - dir * ((spec.len * s) / rho) * deg));
    const t = angleOf([P2[0] - back[0], P2[1] - back[1]]);
    const end = add(C, pol(rho, b2 - dir * ((spec.join * s) / rho) * deg));
    path(`M${pt(P1)}A${f(rho)} ${f(rho)} 0 1 ${cw ? 1 : 0} ${pt(end)}`, 1.0 * J);
    zones.push({ k: 'stroke', c: C, r: rho, w: 0.5 * J });
    head(P2, t, s);
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
  return { marks: out, zones };
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
/** an estimate of a line of serif text's width (at font size `size`), to size its safe zone */
export function textWidth(t: string, size: number, spacing = 0): number {
  let w = 0;
  for (const ch of t) w += /[A-Z]/.test(ch) ? 0.72 : /[a-z]/.test(ch) ? 0.48 : /[0-9]/.test(ch) ? 0.52 : ch === ' ' ? 0.26 : /[·.,]/.test(ch) ? 0.28 : ch === '–' ? 0.52 : 0.9;
  return w * size + spacing * Math.max(0, [...t].length - 1);
}
/** a line of text's safe zone: a rounded box round it (baseline y, centred on x) */
export const textZone = (x: number, y: number, t: string, size: number, spacing = 0): Shape => ({ k: 'box', c: [x, y - size * 0.34], hw: textWidth(t, size, spacing) / 2 + size * 0.25, hh: size * 0.6, rx: size * 0.4 });

/** the faces: drawn; hidden (the bare ground, as if there were none); or hidden with the space
 *  they need still kept (and shown as zones) */
export type FacesMode = 'shown' | 'hidden' | 'zones';
/** an overlay of the fill's workings: its discs (teal, orange where refilled) and its zones */
export function overlaySvg(discs: Disc[], zones: Shape[], w: number): string {
  const ds = discs.filter((d) => d.pass < 2).map((d) => `<circle cx="${f(d.c[0])}" cy="${f(d.c[1])}" r="${f(d.r)}" fill="none" stroke="${d.pass ? '#d9701a' : '#0b8a8a'}" stroke-width="${f(w)}"/>`).join('');
  return `<g color="#d1207f" opacity=".5">${zones.map((z) => shapeOutline(z, `fill="#d1207f" fill-opacity=".25" stroke="none"`)).join('')}</g><g opacity=".75">${ds}</g>`;
}
export interface CardResult { svg: string; seal: Seal; border: FillResult | null }
/** the seal on a playing card (63 × 88 mm): its title, the seal, the faces in words, and the
 *  border filled from the same style — kept clear of the seal and of every line of text, each
 *  zone sized to its words */
export function card(o: { style: Style; seed: number; faces: number[] | null; title: string; id: string; mode?: FacesMode; overlay?: boolean; stats?: boolean }): CardResult {
  const s = sample(o.style, o.seed);
  const mode = o.mode ?? 'shown';
  const seal = draw(s, o.faces, o.seed, { show: mode === 'shown', zones: mode !== 'hidden', stats: o.stats });
  const bordered = s.border !== 'none';
  const scale = bordered ? 0.43 : 0.47, cy = bordered ? 41.2 : 40.6;
  const fY = bordered ? 73.4 : 74.8, sY = bordered ? 78.4 : 80.4, tY = 10.2;
  const line = o.faces ? faceLine(o.faces) : '', sum = o.faces ? summary(o.faces) : '';
  const words = (mode === 'shown' || mode === 'zones') && !!o.faces;
  // the border: a frame inside the card's rule, corner pieces inside the frame, or both
  let border: FillResult | null = null, borderSvg = '', borderOverlay = '';
  if (bordered) {
    const k = 0.45, bw = s.borderW, e = s.packEdge * k;
    const outer: Shape = { k: 'box', c: [31.5, 44], hw: 29.1, hh: 41.6, rx: 2.2 };
    const inner: Shape = { k: 'box', c: [31.5, 44], hw: 29.1 - bw, hh: 41.6 - bw, rx: 1.2 };
    const frame: Shape = { k: 'diff', a: outer, minus: [inner] };
    void e;
    const ix = 29.1 - bw, iy = 41.6 - bw;
    const corners: Shape = { k: 'union', of: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({ k: 'inter', of: [{ k: 'circle', c: [31.5 + sx * ix, 44 + sy * iy], r: s.cornerR }, s.border === 'corners' ? outer : inner] }) as Shape) };
    const region: Shape = s.border === 'frame' ? frame : s.border === 'corners' ? corners : { k: 'union', of: [frame, corners] };
    const reach = (R + Math.max(4, s.nodeOut + 2.4 + s.nodeDots * 2.5 + 1)) * scale;
    const zm = s.zoneMargin * k;
    const zones: Shape[] = [{ k: 'circle', c: [31.5, cy], r: reach + zm }, { k: 'grow', s: textZone(31.5, tY, o.title, 3.4, 0.55), by: zm }];
    if (words) zones.push({ k: 'grow', s: textZone(31.5, fY, line, 3.7), by: zm }, { k: 'grow', s: textZone(31.5, sY + 0.8, sum, 2.15, 0.3), by: zm });
    const made = ornate({ region, zones, sym: { kind: 'd2', c: [31.5, 44] }, style: s, seed: hash(o.seed, 0xb0d), k, centre: [31.5, 44], stats: o.stats });
    border = made.fill;
    const st = made.structure, cid = `${o.id}b`;
    const clipped = st.marks.filter((m) => 'clip' in m && m.clip).map((m) => markSvg(m, s)).join('');
    borderSvg = `<g opacity="${s.faint}"><clipPath id="${cid}"><path d="${st.clip}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${cid})">${clipped}</g>${st.marks.filter((m) => !('clip' in m && m.clip)).map((m) => markSvg(m, s)).join('')}${border.marks.map((m) => markSvg(m, s)).join('')}</g>`;
    if (o.overlay || mode === 'zones') borderOverlay = overlaySvg(o.overlay ? border.discs : [], zones, 0.12);
  }
  const sealOverlay = o.overlay || mode === 'zones' ? overlaySvg(o.overlay ? seal.discs : [], seal.zones, 0.25) : '';
  const rule = sum.length * 0.62 + 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 63 88"><rect x=".5" y=".5" width="62" height="87" rx="3.4" fill="${s.paper}" stroke="#8d8270" stroke-width=".5"/><rect x="2.4" y="2.4" width="58.2" height="83.2" rx="2.2" fill="none" stroke="${s.ink}" stroke-width=".22" opacity=".7"/>`
    + borderSvg
    + `<text x="31.5" y="${tY}" text-anchor="middle" font-size="3.4" font-family="${SERIF}" letter-spacing=".55" fill="${s.ink}">${o.title}</text>`
    + `<g transform="translate(31.5 ${cy}) scale(${scale})">${sealSvg(seal, s, o.id)}${sealOverlay}</g>`
    + (words && mode === 'shown' ? `<text x="31.5" y="${fY}" text-anchor="middle" font-size="3.7" font-family="${SERIF}" fill="${s.ink}" xml:space="preserve">${line}</text><path d="M7 ${sY - 0.8}H${f(31.5 - rule)}M${f(31.5 + rule)} ${sY - 0.8}H56" stroke="${s.ink}" stroke-width=".22"/><circle cx="7" cy="${sY - 0.8}" r=".45" fill="${s.ink}"/><circle cx="56" cy="${sY - 0.8}" r=".45" fill="${s.ink}"/><text x="31.5" y="${sY}" text-anchor="middle" font-size="2.15" font-family="${SERIF}" letter-spacing=".3" fill="${s.ink}">${sum}</text>` : '')
    + borderOverlay
    + '</svg>';
  return { svg, seal, border };
}
/** the card as SVG (see `card`) */
export const sealCard = (o: Parameters<typeof card>[0]): string => card(o).svg;
