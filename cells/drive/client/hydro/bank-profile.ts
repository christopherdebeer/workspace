/**
 * ── THE BANK: FROM THE ACCEPTED WATERLINE TO THE BED AND TO NATURAL GROUND ──
 *
 * The channel carve digs a class-width trench about a CENTRELINE and the
 * published floor lowers ground under a body's INTERIOR. Between them sits the
 * band neither can reach: the strip between where the carve's 1:1 bank has
 * risen back above the water and where the field stops drawing it. Measured at
 * the Senqu ford with `__banktransect`, on a river whose bed and level are both
 * correct: the carve's bank is at 1790.77 two metres short of the waterline
 * while the water rests at 1790.51 with coverage still 0.67 — a quarter of a
 * metre of ground standing over its own water, and no amount of lowering the
 * interior touches it, because there is no interior there.
 *
 * So the boundary this solves for is the one the field actually DRAWS — the
 * coverage isoline, the same contour the refinement already splits cells along
 * — and not a centreline offset by a nominal width. Those are different curves,
 * and the gap between them is the whole fault.
 *
 * WHAT THIS OWNS, and what it must not touch:
 *
 *   hydro owns    accepted coverage, resting level, body identity, flow
 *   THIS owns     the transition from that boundary to bed and natural ground
 *   terrain owns  the final triangles and their normals
 *   crossings own bridges, culverts, fords, causeways, dams
 *
 * It is PURE and it reads the FIELD only — never a mesh, never a previous
 * build. That is not tidiness: the field's `ground` channel is the DEM before
 * anything hydro has an opinion, so solving against it is idempotent by
 * construction. Solving against the carved mesh instead would be
 *
 *     carve → resample the carved ground → solve deeper → carve again
 *
 * which converges on a hole. It also means this module has no road data at all,
 * which is correct: whether a bank may be cut through an embankment is the
 * crossing authority's question, and it is asked where the constraints are
 * consumed rather than guessed at here.
 *
 * AND IT ONLY EVER CUTS. Raising ground to meet water manufactures levees
 * around every polygon whose level was estimated high, which is a far worse
 * failure than a bank that did not quite close — so fill needs explicit
 * authority (an embankment, a dam) and there is none of that here. A station
 * that cannot meet natural ground within its bounded reach and cut is returned
 * UNRESOLVED, with the reason, rather than being met by digging further.
 */
import { sampleFieldSurface } from './field-sample';
import type { HydroBankMaterial, HydroTileField } from './types';
import type { HydroShoreSegment } from './shore-contour';

/** The band inside which terrain and the resting level count as MEETING.
 *  This is the diagnostic's own number (`wetClassAt`'s `above` test) named so
 *  the resolver and the classifier cannot drift: a bank solved to sit within
 *  it would be read as buried by the very census that judges it. */
export const WATERLINE_TOL_M = 0.02;
/** How far UNDER the resting level the solved waterline sits. It must clear
 *  WATERLINE_TOL_M, or a perfectly met shoreline classifies as a burial — the
 *  relation is asserted in the test rather than left to whoever edits these
 *  two numbers next. Small, because it is a rendering nicety (the water
 *  visibly covers its own edge instead of z-fighting it) and not a depth. */
export const BANK_SUBMERGE_M = 0.06;
/** The algorithm's own version, in the terrain job's dependency identity. A
 *  cached packet solved by an older rule is stale even though every input
 *  revision matches. */
export const BANK_PROFILE_VERSION = 1;

export type HydroBankProfile = 'soft' | 'gravel' | 'confined' | 'rock' | 'uncertain';
/** Why a station could not be solved. Never a reason to cut further. */
export type HydroBankUnresolved = 'no-water' | 'no-ground' | 'no-join' | 'too-deep';

export interface HydroBankStation {
  /** On the canonical waterline, world metres. */
  x: number;
  z: number;
  /** Unit normal, toward the DRY side. */
  outwardX: number;
  outwardZ: number;
  /** Absolute metres. */
  waterLevelM: number;
  /** The interior bed this bank runs down to, absolute metres. */
  innerBedM: number;
  /** Bounded influence, metres. Nothing outside these may be modified. */
  innerReachM: number;
  outerReachM: number;
  /**
   * THE INTERVAL OF SHORELINE THIS STATION SPEAKS FOR, back and forward along
   * its own tangent. Asymmetric because it is the interval to its ACTUAL
   * NEIGHBOURS on the contour, not a constant: the first cut gave every
   * survivor half the MINIMUM spacing either side, and greedy rejection leaves
   * neighbours anywhere from that spacing to twice it apart — measured on a
   * straight shore at 10 m spacing as stations 12 m apart carrying 11 m of
   * influence, a one-metre hole every time, with `dropped: 0` reporting a
   * clean run. Sampling a chain by arc length and handing each station the
   * half-interval to each neighbour makes the intervals TILE the chain, which
   * is the property `bank-coverage.test.mjs` asserts.
   *
   * Measured by PROJECTION onto the tangent at evaluation time, so around a
   * tight bend the intervals of two neighbours overlap slightly on the inside
   * and leave a sliver on the outside. At contour spacings that is under a
   * texel; a bend tighter than the spacing is not resolvable by this contour
   * in the first place.
   */
  alongBackM: number;
  alongFwdM: number;
  /** Which contour chain this came from. Two banks of one river are two
   *  chains, and an unrelated body's is a third — so a refusal can be told
   *  from a legitimate connected overlap rather than every nearby station
   *  being assumed to be part of the same boundary. */
  chainId: number;
  /** d(water level) / d(along), absolute metres per metre. A reach that falls
   *  along its length is a sloping water surface, and a row of stations each
   *  asserting one constant level across its own interval steps at every
   *  boundary between them. Zero for a standing body. */
  levelSlopeAlong: number;
  /** Natural ground at the outer join — where the profile meets it again. */
  outerJoinM: number;
  /** How deep the cut is AT the waterline. Zero where natural ground is
   *  already at or under the water and there is nothing to do. */
  cutM: number;
  profile: HydroBankProfile;
  /** 0..1. Below 1 where the material was a fallback or the join was found
   *  against a noisy sample; a consumer may refuse a low-confidence station
   *  rather than acting on a guess. */
  confidence: number;
  unresolved: HydroBankUnresolved | null;
}

/** Bank shape by evidence. `k` is the outward rise per metre — steeper is a
 *  NARROWER correction, which is what preserves a rock bank's relief rather
 *  than smoothing it into a beach. `cut` bounds how much ground a station may
 *  remove at the waterline, and is the one number that stops this becoming the
 *  trench it exists to replace. */
const PROFILE: Record<HydroBankProfile, { k: number; reach: number; cut: number; confidence: number }> = {
  // Alluvial soil: a broad, gentle transition — the classic meadow bank.
  soft: { k: 0.25, reach: 18, cut: 2.5, confidence: 1 },
  // A gravel margin shelves shallowly and then firms up.
  gravel: { k: 0.4, reach: 12, cut: 2.5, confidence: 1 },
  // Mud in a confined channel: narrower and steeper than soil.
  confined: { k: 0.7, reach: 8, cut: 3, confidence: 1 },
  // ROCK KEEPS ITS RELIEF. A steep k meets natural ground within a couple of
  // metres, so a rock bank is trimmed at the waterline and left alone above
  // it; a gentle k here would plane a gorge into a beach, which is the one
  // outcome this whole programme is meant to avoid.
  rock: { k: 1.6, reach: 4, cut: 1.5, confidence: 1 },
  // Nothing said what this is. Conservative on every axis, and it says so.
  uncertain: { k: 0.5, reach: 6, cut: 1.2, confidence: 0.5 },
};

const BANK_BY_MATERIAL: Record<HydroBankMaterial, HydroBankProfile> = {
  soil: 'soft', mud: 'confined', gravel: 'gravel', rock: 'rock',
};

export interface HydroBankOptions {
  /** The coverage isoline these segments were extracted at. */
  coverageCut?: number;
  /** March step for the outward search, metres. */
  stepM?: number;
  /**
   * THE STATION BUDGET, AND IT THINS RATHER THAN TRUNCATES.
   *
   * The first cut took segments in order and stopped at the ceiling, and the
   * census read exactly 512 on one tile and exactly 1024 on two — a count that
   * equals its own budget is not a count, and what it was measuring was a
   * shoreline cut off part way along with the carve still owning the rest.
   * The spacing is solved from the shoreline's OWN length against this budget
   * instead, so a long shore is described coarsely end to end rather than
   * finely for its first few hundred metres. The ceiling stays as a backstop
   * and `dropped` says when it fired, which should now be never.
   */
  maxStations?: number;
  /** Minimum along-shore spacing. Marching squares emits a segment per texel
   *  edge; a bank does not vary faster than the field can see. The solved
   *  spacing above is a floor on this, never a cap. */
  minSpacingM?: number;
}

export interface HydroBankResult {
  stations: HydroBankStation[];
  /** Counts by outcome, for the diagnostic — a resolver that quietly refuses
   *  most of a shoreline must be visible as such and not as a clean run. */
  stats: {
    segments: number;
    stations: number;
    dropped: number;
    /** The shoreline's own length in this tile, and the along-shore spacing
     *  the budget bought — read the pair, because a spacing far over the
     *  field's texel is a bank described coarser than the water it follows. */
    shoreM: number;
    spacingM: number;
    /** THE COVERAGE, REPORTED RATHER THAN ASSUMED. `dropped: 0` says the
     *  budget was not hit; it says nothing about whether the stations that
     *  were kept speak for the whole shore, which is the thing that matters
     *  and the thing the first cut got wrong. */
    coveredM: number;
    uncoveredM: number;
    chains: number;
    resolved: number;
    nothingToCut: number;
    unresolved: Record<HydroBankUnresolved, number>;
    byProfile: Record<HydroBankProfile, number>;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The DEM under the field, bilinear, in the field's own texel convention —
 *  the same placement `sampleFieldSurface` uses, so the ground and the water
 *  at one point are read from one grid and cannot be half a texel apart. */
export function fieldGroundAt(field: HydroTileField, x: number, z: number): number | null {
  const b = field.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return null;
  const sx = (b.maxX - b.minX) / field.resolution, sz = (b.maxZ - b.minZ) / field.resolution;
  if (!(sx > 0 && sz > 0)) return null;
  const px = field.gutter + (x - b.minX) / sx - 0.5;
  const pz = field.gutter + (z - b.minZ) / sz - 0.5;
  const ix = Math.floor(px), iz = Math.floor(pz), tx = px - ix, tz = pz - iz;
  const at = (i: number, j: number): number =>
    field.ground[clamp(j, 0, field.height - 1) * field.width + clamp(i, 0, field.width - 1)];
  const a = at(ix, iz), e = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
  return field.elevationBaseM + ((a * (1 - tx) + e * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz);
}

/** Coverage alone, below any cut — the isoline's own quantity, needed to tell
 *  which side of a shoreline segment is dry. */
function coverageAt(field: HydroTileField, x: number, z: number): number {
  const b = field.bounds;
  const sx = (b.maxX - b.minX) / field.resolution, sz = (b.maxZ - b.minZ) / field.resolution;
  if (!(sx > 0 && sz > 0)) return 0;
  const px = field.gutter + (x - b.minX) / sx - 0.5;
  const pz = field.gutter + (z - b.minZ) / sz - 0.5;
  const ix = Math.floor(px), iz = Math.floor(pz), tx = px - ix, tz = pz - iz;
  const at = (i: number, j: number): number =>
    field.geometry[(clamp(j, 0, field.height - 1) * field.width + clamp(i, 0, field.width - 1)) * 4];
  const a = at(ix, iz), e = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
  return (a * (1 - tx) + e * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

/**
 * ── THE CONTOUR AS CHAINS, NOT AS A BAG OF SEGMENTS ──
 *
 * Marching squares emits one segment per texel edge crossing, in whatever
 * order it walked the grid. Everything a bank needs is a property of the
 * CURVE — which stretch a station stands in for, which neighbour it must meet,
 * which boundary it belongs to — and none of those survive the bag.
 *
 * So the segments are joined back into polylines first. Endpoints are matched
 * through a millimetre hash, which is the rule `mmNear` already uses for tile
 * borders and for the same reason: quantising a coordinate puts two ends of
 * one point in different buckets whenever they straddle a boundary, so the
 * hash finds candidates and the DISTANCE decides.
 *
 * DETERMINISM IS THE POINT AND IT IS NOT FREE. A walk over a hash map visits
 * in insertion order, so the assembly is sorted at every step that could
 * otherwise inherit the input's order: the segments once at the start, each
 * node's neighbour list, and the chains themselves at the end. Without it a
 * reversed or shuffled segment array produces different chains — measured, and
 * the reason `bank-coverage.test.mjs` shuffles rather than only reversing.
 */
interface ShoreChain {
  pts: Array<{ x: number; z: number }>;
  closed: boolean;
  /** Cumulative arc length at each point; last entry is the chain's length. */
  cum: number[];
}

const mmKeyOf = (x: number, z: number): string =>
  `${Math.round(x * 1000)}/${Math.round(z * 1000)}`;

export function assembleShoreChains(
  segments: readonly HydroShoreSegment[],
  weldM = 0.002,
): ShoreChain[] {
  // A canonical order first, so nothing downstream can inherit the caller's.
  const segs = segments
    .map((sg) => ({ ax: sg.a.x, az: sg.a.z, bx: sg.b.x, bz: sg.b.z }))
    .filter((sg) => Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) > 1e-6)
    .sort((p, q) => p.ax - q.ax || p.az - q.az || p.bx - q.bx || p.bz - q.bz);
  // Node ids by welded position.
  const nodeOf = new Map<string, number>();
  const nodes: Array<{ x: number; z: number }> = [];
  const idOf = (x: number, z: number): number => {
    const kx = Math.round(x / weldM), kz = Math.round(z / weldM);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const hit = nodeOf.get(`${kx + dx}/${kz + dz}`);
      if (hit !== undefined && Math.hypot(nodes[hit].x - x, nodes[hit].z - z) <= weldM) return hit;
    }
    const id = nodes.length;
    nodes.push({ x, z });
    nodeOf.set(`${kx}/${kz}`, id);
    return id;
  };
  const adj = new Map<number, number[]>();
  const edges: Array<[number, number]> = [];
  for (const sg of segs) {
    const a = idOf(sg.ax, sg.az), b = idOf(sg.bx, sg.bz);
    if (a === b) continue;
    const e = edges.length;
    edges.push([a, b]);
    for (const n of [a, b]) {
      const list = adj.get(n);
      if (list) list.push(e); else adj.set(n, [e]);
    }
  }
  for (const list of adj.values()) list.sort((i, j) => i - j);
  const used = new Uint8Array(edges.length);
  const other = (e: number, n: number): number => (edges[e][0] === n ? edges[e][1] : edges[e][0]);
  const walkFrom = (start: number): number[] => {
    const out = [start];
    let cur = start;
    for (;;) {
      const list = adj.get(cur);
      if (!list) break;
      // The lowest unused edge, so a junction of three or more is resolved the
      // same way every run. A shoreline that branches is not a curve and this
      // is the one place that has to decide something arbitrary; deciding it
      // deterministically is what keeps the build reproducible.
      let pick = -1;
      for (const e of list) if (!used[e]) { pick = e; break; }
      if (pick < 0) break;
      used[pick] = 1;
      cur = other(pick, cur);
      out.push(cur);
      if (cur === start) break;
    }
    return out;
  };
  const chains: ShoreChain[] = [];
  const endsFirst = [...adj.keys()]
    .filter((n) => (adj.get(n) as number[]).length !== 2)
    .sort((a, b) => nodes[a].x - nodes[b].x || nodes[a].z - nodes[b].z || a - b);
  const rest = [...adj.keys()]
    .sort((a, b) => nodes[a].x - nodes[b].x || nodes[a].z - nodes[b].z || a - b);
  const emit = (ids: number[]): void => {
    if (ids.length < 2) return;
    const closed = ids.length > 2 && ids[0] === ids[ids.length - 1];
    const pts = ids.map((i) => ({ x: nodes[i].x, z: nodes[i].z }));
    if (closed) pts.pop();
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    if (closed) {
      cum.push(cum[cum.length - 1]
        + Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z));
    }
    if (cum[cum.length - 1] < 1e-6) return;
    chains.push({ pts, closed, cum });
  };
  // Open chains first, from their own ends, then whatever rings are left.
  for (const n of endsFirst) {
    const list = adj.get(n) as number[];
    for (const e of list) if (!used[e]) emit(walkFrom(n));
  }
  for (const n of rest) {
    const list = adj.get(n) as number[];
    for (const e of list) if (!used[e]) emit(walkFrom(n));
  }
  return chains;
}

/** A point and a unit tangent at arc length `s` along a chain. */
function chainAt(c: ShoreChain, s: number): { x: number; z: number; tx: number; tz: number } {
  const L = c.cum[c.cum.length - 1];
  let t = s;
  if (c.closed) { t = ((t % L) + L) % L; } else { t = clamp(t, 0, L); }
  let i = 0;
  while (i + 1 < c.cum.length && c.cum[i + 1] < t) i++;
  const aIdx = i % c.pts.length, bIdx = (i + 1) % c.pts.length;
  const a = c.pts[aIdx], b = c.pts[bIdx];
  const segLen = Math.max(1e-9, c.cum[i + 1] - c.cum[i]);
  const f = clamp((t - c.cum[i]) / segLen, 0, 1);
  const dx = b.x - a.x, dz = b.z - a.z;
  const d = Math.hypot(dx, dz) || 1;
  return { x: a.x + dx * f, z: a.z + dz * f, tx: dx / d, tz: dz / d };
}

/**
 * Solve a bank at every accepted shoreline segment.
 *
 * The segments are the caller's: flowing water now, a lake's or a coast's
 * contour later, extracted by whichever rule that kind wants. What this does
 * with them is the same either way, which is the point of taking them as an
 * argument rather than extracting them here.
 */
export function resolveHydroBankStations(
  field: HydroTileField,
  segments: readonly HydroShoreSegment[],
  options: HydroBankOptions = {},
): HydroBankResult {
  const cut = options.coverageCut ?? 0.5;
  const step = Math.max(0.25, options.stepM ?? 1);
  const maxStations = options.maxStations ?? 512;
  const minSpacing = Math.max(0, options.minSpacingM ?? 0);
  const chains = assembleShoreChains(segments);
  let shoreM = 0;
  for (const c of chains) shoreM += c.cum[c.cum.length - 1];
  // THE SPACING IS SOLVED FROM THE SHORELINE'S OWN LENGTH against the budget,
  // so a long shore is described coarsely end to end rather than finely for
  // its first few hundred metres.
  const spacing = Math.max(0.5, Math.max(minSpacing, maxStations > 0 ? shoreM / maxStations : 0));
  const stations: HydroBankStation[] = [];
  const stats: HydroBankResult['stats'] = {
    segments: segments.length, stations: 0, dropped: 0, resolved: 0, nothingToCut: 0,
    shoreM: +shoreM.toFixed(1), spacingM: +spacing.toFixed(2),
    coveredM: 0, uncoveredM: 0, chains: chains.length,
    unresolved: { 'no-water': 0, 'no-ground': 0, 'no-join': 0, 'too-deep': 0 },
    byProfile: { soft: 0, gravel: 0, confined: 0, rock: 0, uncertain: 0 },
  };
  let coveredM = 0;

  for (let ci = 0; ci < chains.length; ci++) {
    const c = chains[ci];
    const L = c.cum[c.cum.length - 1];
    // SAMPLED BY ARC LENGTH, and the count rounded so the intervals TILE the
    // chain exactly: n stations at (i + 1/2)·L/n own [i·L/n, (i+1)·L/n], which
    // abut by construction and cover the whole of it. That is the property the
    // greedy rejection could not offer at any spacing.
    const n = Math.max(1, Math.round(L / spacing));
    const h = L / n;
    // Pass one: where each station stands, which way is dry, and what the
    // water is doing there — the level has to be known at the NEIGHBOURS
    // before a station can carry the slope between them.
    const seats: Array<{
      s: number; x: number; z: number; tx: number; tz: number;
      nx: number; nz: number; level: number | null; w: ReturnType<typeof sampleFieldSurface>;
      natural: number | null;
    }> = [];
    for (let i = 0; i < n; i++) {
      const sAt = (i + 0.5) * h;
      const p = chainAt(c, sAt);
      // WHICH WAY IS DRY. A contour has two normals and nothing in its own
      // geometry says which one leaves the water; the coverage does, and it is
      // the same quantity the isoline was cut from.
      let nx = -p.tz, nz = p.tx;
      const probe = Math.max(step, 1);
      if (coverageAt(field, p.x + nx * probe, p.z + nz * probe)
        > coverageAt(field, p.x - nx * probe, p.z - nz * probe)) { nx = -nx; nz = -nz; }
      // The water is read just INSIDE the line: exactly on it the coverage is
      // the cut, and a sampler that refuses below its cut would answer nothing
      // for half the stations depending on which side rounding landed.
      const w = sampleFieldSurface(field, p.x - nx * probe, p.z - nz * probe, Math.min(cut, 0.05));
      seats.push({
        s: sAt, x: p.x, z: p.z, tx: p.tx, tz: p.tz, nx, nz, w,
        level: w ? w.restingLevelM : null,
        natural: fieldGroundAt(field, p.x, p.z),
      });
    }
    // Pass two: solve each seat, with its interval and its neighbours' levels.
    for (let i = 0; i < seats.length; i++) {
      if (stations.length >= maxStations) { stats.dropped++; continue; }
      const st = seats[i];
      const prev = c.closed ? seats[(i - 1 + seats.length) % seats.length] : seats[i - 1];
      const next = c.closed ? seats[(i + 1) % seats.length] : seats[i + 1];
      if (!st.w) { stats.unresolved['no-water']++; continue; }
      if (st.natural === null) { stats.unresolved['no-ground']++; continue; }
      const profile: HydroBankProfile = BANK_BY_MATERIAL[st.w.bankMaterial] ?? 'uncertain';
      const P = PROFILE[profile];
      const level = st.w.restingLevelM;
      const waterline = level - BANK_SUBMERGE_M;
      // THE LEVEL'S SLOPE ALONG THE REACH. A row of stations each asserting one
      // constant level across its own interval steps at every boundary between
      // them, which on a falling river is a staircase down the bank. The slope
      // is the central difference where both neighbours have a level, one side
      // where only one does, and zero for a standing body.
      let levelSlopeAlong = 0;
      {
        const pl = prev && prev.level !== null ? prev.level : null;
        const nl = next && next.level !== null ? next.level : null;
        const ps = prev ? prev.s : st.s, ns = next ? next.s : st.s;
        if (pl !== null && nl !== null && ns !== ps) levelSlopeAlong = (nl - pl) / (ns - ps);
        else if (nl !== null && ns !== st.s) levelSlopeAlong = (nl - level) / (ns - st.s);
        else if (pl !== null && st.s !== ps) levelSlopeAlong = (level - pl) / (st.s - ps);
        if (!Number.isFinite(levelSlopeAlong)) levelSlopeAlong = 0;
      }
      const innerBed = level - Math.max(st.w.depthM, 0.08);
      const base = {
        x: st.x, z: st.z, outwardX: st.nx, outwardZ: st.nz,
        waterLevelM: level, innerBedM: innerBed,
        alongBackM: h / 2, alongFwdM: h / 2,
        chainId: ci, levelSlopeAlong,
        profile, confidence: P.confidence,
      };
      coveredM += h;
      stats.stations++;
      stats.byProfile[profile]++;
      // ── HOW FAR IN THE FACE RUNS. It marches the way it marches outward and
      // stops where the ground is already at or under the stated bed, capped
      // by the profile's own reach — a wide river gets a wide concave face and
      // a narrow one a short toe, and `bankProfileY` smoothsteps between them
      // so it is never a flat-bottomed trench.
      let innerReach = Math.max(1, Math.min(P.reach, Math.max(st.w.depthM, 0.08) / Math.max(0.05, P.k)));
      for (let sIn = step; sIn <= P.reach + 1e-9; sIn += step) {
        const g = fieldGroundAt(field, st.x - st.nx * sIn, st.z - st.nz * sIn);
        if (g === null) break;
        innerReach = Math.max(innerReach, Math.min(P.reach, sIn));
        if (g <= innerBed) break;
      }
      const seat = { ...base, innerReachM: innerReach };
      // NOTHING TO CUT: the ground outside the line is already at or under the
      // water. A resolved station with zero outward influence, not a failure —
      // and emitting it keeps the shoreline's topology continuous.
      if (st.natural <= waterline + WATERLINE_TOL_M) {
        stations.push({ ...seat, outerReachM: 0, outerJoinM: st.natural, cutM: 0, unresolved: null });
        stats.nothingToCut++;
        continue;
      }
      const cutAtLine = st.natural - waterline;
      if (cutAtLine > P.cut) {
        // Too much ground to remove for this profile: a cliff at the water's
        // edge, a level estimated far too low, or a missing dam — and the
        // honest answer to all three is the same: say so, and change nothing.
        stations.push({ ...seat, outerReachM: 0, outerJoinM: st.natural, cutM: 0, unresolved: 'too-deep' });
        stats.unresolved['too-deep']++;
        continue;
      }
      // MARCH OUT ALONG THE NORMAL until the profile has risen back to the
      // ground — the road batter's `toeOut` and the same reason for it.
      let joinS = -1, joinY = st.natural;
      let prevS = 0, prevGap = st.natural - waterline;
      for (let sOut = step; sOut <= P.reach + 1e-9; sOut += step) {
        const g = fieldGroundAt(field, st.x + st.nx * sOut, st.z + st.nz * sOut);
        if (g === null) break;
        const prof = waterline + P.k * sOut;
        const gap = g - prof;
        if (gap <= 0) {
          const t = prevGap / (prevGap - gap || 1);
          joinS = prevS + (sOut - prevS) * clamp(t, 0, 1);
          joinY = waterline + P.k * joinS;
          break;
        }
        prevS = sOut; prevGap = gap;
      }
      if (joinS < 0) {
        stations.push({ ...seat, outerReachM: 0, outerJoinM: st.natural, cutM: 0, unresolved: 'no-join' });
        stats.unresolved['no-join']++;
        continue;
      }
      stations.push({ ...seat, outerReachM: joinS, outerJoinM: joinY, cutM: cutAtLine, unresolved: null });
      stats.resolved++;
    }
  }
  stats.coveredM = +coveredM.toFixed(2);
  stats.uncoveredM = +Math.max(0, shoreM - coveredM).toFixed(2);
  return { stations, stats };
}

/**
 * The bank's target height at a point, or null where no station reaches it.
 *
 * A consumer asks this per vertex. It is the CROSS-SECTION evaluated at the
 * point's own signed distance from the nearest station's waterline: negative
 * is the water side and runs down to the bed, positive is land and rises to
 * the join. Outside a station's stated reach it answers null — invariant 4,
 * and the reason the reach is on the station rather than a global constant.
 *
 * Unresolved stations answer null: a station that could not be solved must
 * change nothing, which is not the same as a station that solved to zero.
 */
export function bankTargetAt(
  stations: readonly HydroBankStation[],
  x: number,
  z: number,
): { y: number; station: HydroBankStation; s: number } | null {
  let best: { y: number; station: HydroBankStation; s: number } | null = null;
  for (const st of stations) {
    if (st.unresolved !== null) continue;
    const dx = x - st.x, dz = z - st.z;
    const s = dx * st.outwardX + dz * st.outwardZ;            // signed, outward positive
    // Along the shore a station speaks for the contour segment it was made
    // from and no further. Bounding this by the CROSS-BANK reach instead — the
    // obvious thing, and what the first cut did — puts a hole between every
    // pair of stations further apart than the bank is wide, which on a real
    // contour is most of them.
    // SIGNED, because the interval to a station's two neighbours is not
    // symmetric: it is the half-gap to each of them.
    const along = dx * -st.outwardZ + dz * st.outwardX;
    if (along < -st.alongBackM || along > st.alongFwdM) continue;
    if (s > st.outerReachM || -s > st.innerReachM) continue;
    const P = PROFILE[st.profile];
    const waterline = st.waterLevelM - BANK_SUBMERGE_M + st.levelSlopeAlong * along;
    const y = s >= 0
      ? waterline + P.k * s
      // Underwater: down from the waterline to the stated bed over the inner
      // reach, then flat at the bed. Smoothstep so the toe is a toe and not a
      // crease, which is what a shelf reads as at this scale.
      : (() => {
        const t = clamp(-s / Math.max(0.1, st.innerReachM), 0, 1);
        const e = t * t * (3 - 2 * t);
        return waterline + (st.innerBedM - waterline) * e;
      })();
    // The LOWEST bank wins where two stations overlap — at a confluence or
    // inside a tight bend two shorelines genuinely both apply, and taking the
    // higher would leave a ridge between them.
    if (!best || y < best.y) best = { y, station: st, s };
  }
  return best;
}

/** The profile table, for a consumer that needs a station's slope without
 *  re-deriving it (the refinement's toe breakline, the diagnostic). */
export function bankProfileOf(profile: HydroBankProfile): { k: number; reach: number; cut: number } {
  const P = PROFILE[profile];
  return { k: P.k, reach: P.reach, cut: P.cut };
}

/**
 * ── THE WIRE FORM ──
 *
 * Fifteen floats a station, and the packet carries EVERYTHING the evaluation
 * needs — the waterline already submerged, the profile's own slope, the
 * reaches — so the consumer needs no constant of this module and no table.
 *
 * That is not a style choice. The terrain kernel is stringified into a worker
 * (`createTerrainKernel.toString()`), so anything it calls must be either
 * inside that closure or interpolated beside it; a helper here that closed
 * over PROFILE or BANK_SUBMERGE_M would compile, pass every test on the main
 * thread, and throw on the worker's first job. A packet that answers for
 * itself cannot fail that way.
 *
 * Absolute metres, as the floor lattice is: the kernel subtracts its own
 * baseElev, and one datum for both keeps them comparable.
 *
 * ── AND THE ORDER IS PART OF THE FORM ──
 *
 * Stations are emitted CHAIN-MAJOR and, within a chain, in increasing arc
 * length. The kernel's crease builder reads that: it groups by `chainId` and
 * then walks the packet's own order, so two entries next to each other in one
 * chain are next to each other on the contour. An INDEX along the chain was
 * carried here for a while and read by nothing — the adjacency the builder
 * actually needs is geometric (are these two centres one interval apart, or
 * two, with a skipped station between them), which the reaches already answer
 * and which a ring's wrap answers too. A field nobody reads is the thing this
 * repo keeps recording, so the order is stated instead and
 * `bank-coverage.test.mjs` asserts it.
 */
export const BANK_STRIDE = 15;
export const BANK_FLAG_UNRESOLVED = 1;

export function packBankStations(stations: readonly HydroBankStation[]): Float32Array {
  const out = new Float32Array(stations.length * BANK_STRIDE);
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i], o = i * BANK_STRIDE;
    const P = PROFILE[st.profile];
    out[o] = st.x;
    out[o + 1] = st.z;
    out[o + 2] = st.outwardX;
    out[o + 3] = st.outwardZ;
    out[o + 4] = st.waterLevelM - BANK_SUBMERGE_M;   // the anchor itself
    out[o + 5] = st.innerBedM;
    out[o + 6] = st.innerReachM;
    out[o + 7] = st.outerReachM;
    out[o + 8] = st.alongFwdM;
    out[o + 9] = P.k;
    // AN UNRESOLVED STATION STILL OWNS ITS REGION. Its refusal means "nothing
    // may change here", and that has to bind the channel carve too — otherwise
    // the bank declines to cut a rock face and the carve planes it anyway,
    // which is the refusal costing nothing. Outward only: the bank failed on
    // the LAND side, and the bed inside is the carve's and the field's.
    out[o + 10] = st.unresolved === null ? 0 : P.reach;
    out[o + 11] = st.unresolved === null ? 0 : BANK_FLAG_UNRESOLVED;
    out[o + 12] = st.alongBackM;
    // BOUNDARY IDENTITY, so a consumer can tell a legitimate connected overlap
    // — two stations of one chain meeting round a bend — from two unrelated
    // boundaries whose influences happen to cross. Without it every nearby
    // station is assumed to belong to the same bank, and a refusal on one
    // shore cannot be told from a refusal on the other.
    out[o + 13] = st.chainId;
    out[o + 14] = st.levelSlopeAlong;
  }
  return out;
}
