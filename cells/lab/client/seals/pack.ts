/**
 * Even filling: discs packed into a region, every one as large as the space at its centre allows
 * (up to rMax), the best of `tries` seeded candidates at each step.
 *
 * `tries` is the evenness dial: 1 is random sequential addition (clumps and holes), 30+ is
 * largest-first (an even, apollonian fill). Under a symmetry the candidate is drawn in the
 * fundamental domain and placed with all its copies; near a mirror it snaps onto it.
 *
 * Safe zones break symmetry, so a fill runs in passes (see `fillPasses`): symmetric over the
 * scene's symmetric obstacles; then every disc a zone touches shrinks to fit or goes; then an
 * unsymmetric pass of smaller discs closes the gaps the zones left.
 */
import { hash, seeded } from '../kit/rng';
import { bounds, copies, sampleDomain, sdf, sdfAll, snap, ShapeIndex, type Pt, type Shape, type Sym } from './field';

const sq = (x: number) => x * x;
export interface Disc {
  c: Pt;
  r: number;
  /** orientation, degrees clockwise from up (copies turned and mirrored with the point) */
  a: number;
  /** -1 for a mirrored copy */
  m: number;
  /** the orbit: every copy of one placement shares it, so their ornaments agree */
  id: number;
  /** the pass that placed it (0 symmetric, 1 refill, 2 stipple) */
  pass: number;
}
export interface PackOpts {
  region: Shape;
  avoid: Shape[];
  sym: Sym;
  rMax: number;
  rMin: number;
  gap: number;
  tries: number;
  /** each disc smaller than its space by up to this fraction (variety) */
  jitter: number;
  /** snap to a mirror within this distance */
  snapTol: number;
  seed: number;
  existing?: Disc[];
  /** the scene is known symmetric under `sym`, so one copy's free radius is every copy's (a fast
   *  path; a seal's lines needn't be — two great arcs under a fourfold symmetry are not) */
  symmetricScene?: boolean;
  pass?: number;
  idBase?: number;
  /** extra spacing at a point (a density gradient), and its largest value */
  gapAt?: (p: Pt) => number;
  gapExtraMax?: number;
  /** the largest disc at a point, if less than rMax */
  rMaxAt?: (p: Pt) => number;
  maxOrbits?: number;
}

/** discs, added to `existing` (returned together) */
export function pack(o: PackOpts): Disc[] {
  const r = seeded(hash(o.seed, 0x9ac4, o.pass ?? 0));
  const discs: Disc[] = [...(o.existing ?? [])];
  const big = discs.reduce((m, d) => Math.max(m, d.r), o.rMax);
  const cell = big + o.rMax + o.gap + (o.gapExtraMax ?? 0) + 1e-6;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(x / cell) * 92821 + Math.floor(y / cell);
  const insert = (i: number) => { const k = key(discs[i].c[0], discs[i].c[1]); (grid.get(k) ?? grid.set(k, []).get(k)!).push(i); };
  discs.forEach((_, i) => insert(i));
  const b = bounds(o.region);
  const avoid = new ShapeIndex(o.avoid, o.rMax + o.gap);
  /** the radius a disc centred at p could have */
  const free = (p: Pt): number => {
    let f = Math.min(o.rMaxAt ? Math.max(o.rMin, Math.min(o.rMax, o.rMaxAt(p))) : o.rMax, -sdf(o.region, p));
    if (f < o.rMin) return f;
    // (the fade spaces discs from each other, not from the lines)
    f = Math.min(f, avoid.dist(p) - o.gap);
    const gap = o.gap + (o.gapAt ? o.gapAt(p) : 0);
    if (f < o.rMin) return f;
    const ix = Math.floor(p[0] / cell), iy = Math.floor(p[1] / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of grid.get((ix + dx) * 92821 + iy + dy) ?? []) {
      const d = discs[i];
      f = Math.min(f, Math.sqrt(sq(p[0] - d.c[0]) + sq(p[1] - d.c[1])) - d.r - gap);
      if (f < o.rMin) return f;
    }
    return f;
  };
  let id = o.idBase ?? discs.reduce((m, d) => Math.max(m, d.id + 1), 0);
  const limit = o.maxOrbits ?? 5000;
  for (let orbits = 0; orbits < limit; orbits++) {
    let best: { p: Pt; f: number } | null = null, valid = 0, misses = 0;
    while (valid < o.tries && misses < 240) {
      const p = snap(o.sym, sampleDomain(o.sym, b, r), o.snapTol);
      // (the point itself first: most candidates fail there, before their copies are worked out)
      let f = free(p);
      if (f < o.rMin) { misses++; continue; }
      const cs = copies(o.sym, p, 0);
      if (!o.symmetricScene) for (let j = 1; j < cs.length && f >= o.rMin; j++) f = Math.min(f, free(cs[j].p));
      // (the copies must not touch each other)
      for (let j = 1; j < cs.length && f >= o.rMin; j++) f = Math.min(f, (Math.sqrt(sq(cs[j].p[0] - p[0]) + sq(cs[j].p[1] - p[1])) - o.gap) / 2);
      if (f < o.rMin) { misses++; continue; }
      valid++;
      if (!best || f > best.f) best = { p, f };
    }
    if (!best) break;
    const rr = Math.max(o.rMin, best.f * (1 - o.jitter * r()));
    const a0 = r() * 360;
    for (const c of copies(o.sym, best.p, a0)) { discs.push({ c: c.p, r: rr, a: c.a, m: c.m, id, pass: o.pass ?? 0 }); insert(discs.length - 1); }
    id++;
  }
  return discs;
}

/** keep clear of the zones: each disc shrinks to fit beside them, or goes */
export function clear(discs: Disc[], zones: Shape[], gap: number, rMin: number): Disc[] {
  if (!zones.length) return discs;
  const out: Disc[] = [];
  for (const d of discs) {
    const f = sdfAll(zones, d.c) - gap;
    if (f >= d.r) out.push(d);
    else if (f >= rMin) out.push({ ...d, r: f });
  }
  return out;
}

export interface FillOpts {
  region: Shape;
  /** symmetric obstacles (the scene's lines) */
  avoid: Shape[];
  /** safe zones (labels, the faces): not symmetric */
  zones: Shape[];
  sym: Sym;
  rMax: number;
  rMin: number;
  gap: number;
  tries: number;
  jitter: number;
  snapTol: number;
  /** close the zones' gaps with an unsymmetric pass */
  refill: boolean;
  /** 0 none … 1 dense: tiny dots in what is left */
  stipple: number;
  seed: number;
  gapAt?: (p: Pt) => number;
  gapExtraMax?: number;
  rMaxAt?: (p: Pt) => number;
}
/** the passes: symmetric, cleared of the zones, refilled, stippled */
export function fillPasses(o: FillOpts): Disc[] {
  let discs = pack({ ...o, existing: [], pass: 0 });
  discs = clear(discs, o.zones, o.gap, o.rMin);
  if (o.refill && o.zones.length) discs = pack({ ...o, avoid: [...o.avoid, ...o.zones], sym: { kind: 'none' }, rMax: Math.max(o.rMin, o.rMax * 0.6), rMaxAt: undefined, existing: discs, pass: 1 });
  if (o.stipple > 0.02) {
    const s = Math.max(0.12, o.rMin * 0.28);
    discs = pack({ ...o, avoid: [...o.avoid, ...o.zones], sym: { kind: 'none' }, rMax: s, rMin: s, rMaxAt: undefined, jitter: 0, tries: 1, gap: s * (2 + (1 - o.stipple) * 9), existing: discs, pass: 2 });
  }
  return discs;
}

export interface Evenness {
  /** discs placed (the stipple left out) */
  n: number;
  /** of the free area (region less obstacles and zones), the share inside a disc */
  coverage: number;
  /** the radius of the empty circle at a free point: its mean, its 95th percentile, its largest */
  meanGap: number;
  p95Gap: number;
  maxGap: number;
}
/** how evenly the discs fill the free space, on a grid of samples */
export function evenness(region: Shape, avoid: Shape[], discs: Disc[], samples = 48): Evenness {
  const b = bounds(region), step = Math.max(b[2] - b[0], b[3] - b[1]) / samples;
  const ds = discs.filter((d) => d.pass < 2);
  const idx = new ShapeIndex(avoid, step * 4);
  const gaps: number[] = [];
  let inside = 0;
  for (let x = b[0] + step / 2; x < b[2]; x += step) for (let y = b[1] + step / 2; y < b[3]; y += step) {
    const p: Pt = [x, y];
    if (sdf(region, p) >= 0 || idx.dist(p) <= 0) continue;
    let g = Infinity;
    for (const d of ds) { g = Math.min(g, Math.sqrt(sq(x - d.c[0]) + sq(y - d.c[1])) - d.r); if (g <= 0) break; }
    // (an empty point's gap: no further than the nearest edge of the free space either)
    if (g > 0) g = Math.min(g, -sdf(region, p), idx.dist(p));
    if (g <= 0) inside++;
    gaps.push(Math.max(0, g));
  }
  gaps.sort((a, c) => a - c);
  const n = gaps.length || 1;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { n: ds.length, coverage: r2(inside / n), meanGap: r2(gaps.reduce((s, g) => s + g, 0) / n), p95Gap: r2(gaps[Math.floor(n * 0.95)] ?? 0), maxGap: r2(gaps[n - 1] ?? 0) };
}
