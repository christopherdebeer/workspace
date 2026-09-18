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
  /** How far ALONG the shoreline this station speaks for — half the contour
   *  segment it was made from, plus a margin. Without it a station's influence
   *  is a disc of its cross-bank reach, and a point midway between two
   *  stations further apart than that reach gets no bank at all: a bank full
   *  of holes, at exactly the spacing of the contour. Caught by the test,
   *  which placed its stations fifteen metres apart and asked between two. */
  alongM: number;
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
  const stations: HydroBankStation[] = [];
  // THE SPACING IS SOLVED FROM THE SHORELINE'S OWN LENGTH. Taking segments in
  // order until a ceiling describes the first part of a shore finely and the
  // rest not at all — measured at the Senqu ford as `dropped 512 of 1024
  // segments`, exactly half the shore left to the carve. One pass to measure
  // the shore, then a spacing that just fits the budget.
  let shoreM = 0;
  for (const seg of segments) shoreM += Math.hypot(seg.b.x - seg.a.x, seg.b.z - seg.a.z);
  const spacing = Math.max(minSpacing, maxStations > 0 ? shoreM / maxStations : 0);
  const stats: HydroBankResult['stats'] = {
    segments: segments.length, stations: 0, dropped: 0, resolved: 0, nothingToCut: 0,
    shoreM: +shoreM.toFixed(1), spacingM: +spacing.toFixed(2),
    unresolved: { 'no-water': 0, 'no-ground': 0, 'no-join': 0, 'too-deep': 0 },
    byProfile: { soft: 0, gravel: 0, confined: 0, rock: 0, uncertain: 0 },
  };
  // AND THE THINNING IS SPATIAL, NOT SEQUENTIAL. Marching squares emits its
  // segments in no particular order, so "further than the spacing from the
  // LAST one I kept" thins by whatever order they happen to arrive in and can
  // leave a stretch bare while crowding another. A hash at the spacing asks
  // the question the spacing means — is any station already standing here —
  // and answers it the same whatever order the segments come in.
  const cellM = Math.max(0.5, spacing);
  const kept = new Map<string, number[]>();
  const tooClose = (x: number, z: number): boolean => {
    if (!(spacing > 0)) return false;
    const cx = Math.floor(x / cellM), cz = Math.floor(z / cellM);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = kept.get(`${cx + dx}/${cz + dz}`);
      if (!list) continue;
      for (let i = 0; i < list.length; i += 2) {
        if (Math.hypot(x - list[i], z - list[i + 1]) < spacing) return true;
      }
    }
    return false;
  };
  const markKept = (x: number, z: number): void => {
    const key = `${Math.floor(x / cellM)}/${Math.floor(z / cellM)}`;
    const list = kept.get(key);
    if (list) list.push(x, z); else kept.set(key, [x, z]);
  };
  for (const seg of segments) {
    const mx = (seg.a.x + seg.b.x) / 2, mz = (seg.a.z + seg.b.z) / 2;
    if (tooClose(mx, mz)) continue;
    if (stations.length >= maxStations) { stats.dropped++; continue; }
    const dx = seg.b.x - seg.a.x, dz = seg.b.z - seg.a.z;
    const L = Math.hypot(dx, dz);
    if (!(L > 1e-6)) continue;
    // WHICH WAY IS DRY. A contour segment has two normals and nothing in its
    // own geometry says which one leaves the water; the coverage does, and it
    // is the same quantity the isoline was cut from.
    let nx = -dz / L, nz = dx / L;
    const probe = Math.max(step, 1);
    if (coverageAt(field, mx + nx * probe, mz + nz * probe) > coverageAt(field, mx - nx * probe, mz - nz * probe)) {
      nx = -nx; nz = -nz;
    }
    markKept(mx, mz);
    // The water is read just INSIDE the line: exactly on it the coverage is
    // the cut, and a sampler that refuses below its cut would answer nothing
    // for half the stations depending on which side rounding landed.
    const inX = mx - nx * probe, inZ = mz - nz * probe;
    const w = sampleFieldSurface(field, inX, inZ, Math.min(cut, 0.05));
    if (!w) { stats.unresolved['no-water']++; continue; }
    const natural0 = fieldGroundAt(field, mx, mz);
    if (natural0 === null) { stats.unresolved['no-ground']++; continue; }
    const profile: HydroBankProfile = BANK_BY_MATERIAL[w.bankMaterial] ?? 'uncertain';
    const P = PROFILE[profile];
    const level = w.restingLevelM;
    const waterline = level - BANK_SUBMERGE_M;
    // The interior bed the underwater face runs down to. The field states a
    // depth; the floor rule publishes the same quantity on its own lattice,
    // and both come from here, so they cannot disagree about the bed.
    const innerBed = level - Math.max(w.depthM, 0.08);
    // ── HOW FAR IN THE FACE RUNS, AND WHY IT IS A SEARCH ──
    //
    // The first cut derived it from the slope alone: depth over k, which for
    // half a metre of gravel-bank river is about a metre. The census then read
    // fringe-buried points lying a median 4 m and a p90 8 m INSIDE the mask, so
    // the face stopped three-quarters of the way short of the burial it exists
    // to remove — and the published floor could not take over either, because
    // its lattice is ~18 m over a tile and a line river never has four wet
    // corners (measured, and recorded above).
    //
    // So it marches inward the way it marches outward, and stops where the
    // ground is already at or under the bed the field states. That is not a
    // flat-bottomed trench: `bankProfileY` smoothsteps from the waterline to
    // the bed over this reach, so a wide river gets a wide concave face and a
    // narrow one a short toe. The profile's own reach still caps it, so a rock
    // margin asserts four metres where an alluvial one asserts eighteen.
    const bedTarget = innerBed;
    let innerReach = Math.max(1, Math.min(P.reach, Math.max(w.depthM, 0.08) / Math.max(0.05, P.k)));
    for (let sIn = step; sIn <= P.reach + 1e-9; sIn += step) {
      const g = fieldGroundAt(field, mx - nx * sIn, mz - nz * sIn);
      if (g === null) break;
      innerReach = Math.max(innerReach, Math.min(P.reach, sIn));
      if (g <= bedTarget) break;
    }
    const base = {
      x: mx, z: mz, outwardX: nx, outwardZ: nz,
      waterLevelM: level, innerBedM: innerBed, innerReachM: innerReach,
      // THE ALONG-SHORE REACH IS THE SPACING, NOT THE SEGMENT. A station stands
      // in for the stretch of shore between it and its neighbours, and after
      // thinning that stretch is the SPACING — bounding it by the contour
      // segment's own half-length instead leaves the bank a comb of narrow
      // slats with bare shore between every pair of teeth. Measured at the
      // Senqu ford before this: 512 stations on the tile and not one of them
      // reaching a single point of a transect straight through the shoreline.
      // The same hole as the first cut's cross-bank bound, in a new place.
      alongM: Math.max(L / 2, spacing / 2) + 0.5,
      profile, confidence: P.confidence,
    };
    // NOTHING TO CUT: the ground outside the line is already at or under the
    // water. That is a resolved station with zero influence, not a failure —
    // and emitting it keeps the shoreline's topology continuous for whatever
    // consumes these.
    if (natural0 <= waterline + WATERLINE_TOL_M) {
      stations.push({ ...base, outerReachM: 0, outerJoinM: natural0, cutM: 0, unresolved: null });
      stats.nothingToCut++; stats.byProfile[profile]++; stats.stations++;
      continue;
    }
    const cutAtLine = natural0 - waterline;
    if (cutAtLine > P.cut) {
      // Too much ground to remove for this profile. A cliff at the water's
      // edge, a level estimated far too low, or a missing dam — and the
      // honest answer to all three is the same: say so, and change nothing.
      stations.push({ ...base, outerReachM: 0, outerJoinM: natural0, cutM: 0, unresolved: 'too-deep' });
      stats.unresolved['too-deep']++; stats.byProfile[profile]++; stats.stations++;
      continue;
    }
    // MARCH OUT ALONG THE NORMAL until the profile has risen back to the
    // ground — the road batter's `toeOut` and the same reason for it: a bank
    // that closes where the ground actually is leaves no step, and one that
    // closes at a fixed distance leaves one everywhere the ground is not
    // where the fixed distance assumed.
    let joinS = -1, joinY = natural0;
    let prevS = 0, prevGap = natural0 - waterline;          // natural − profile, > 0 here
    for (let s = step; s <= P.reach + 1e-9; s += step) {
      const g = fieldGroundAt(field, mx + nx * s, mz + nz * s);
      if (g === null) break;
      const prof = waterline + P.k * s;
      const gap = g - prof;
      if (gap <= 0) {
        // Crossed between prevS and s; interpolate for the exact join.
        const t = prevGap / (prevGap - gap || 1);
        joinS = prevS + (s - prevS) * clamp(t, 0, 1);
        joinY = waterline + P.k * joinS;
        break;
      }
      prevS = s; prevGap = gap;
    }
    if (joinS < 0) {
      stations.push({ ...base, outerReachM: 0, outerJoinM: natural0, cutM: 0, unresolved: 'no-join' });
      stats.unresolved['no-join']++; stats.byProfile[profile]++; stats.stations++;
      continue;
    }
    stations.push({ ...base, outerReachM: joinS, outerJoinM: joinY, cutM: cutAtLine, unresolved: null });
    stats.resolved++; stats.byProfile[profile]++; stats.stations++;
  }
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
    const along = Math.abs(dx * -st.outwardZ + dz * st.outwardX);
    if (along > st.alongM) continue;
    if (s > st.outerReachM || -s > st.innerReachM) continue;
    const P = PROFILE[st.profile];
    const waterline = st.waterLevelM - BANK_SUBMERGE_M;
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
 * Twelve floats a station, and the packet carries EVERYTHING the evaluation
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
 */
export const BANK_STRIDE = 12;
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
    out[o + 8] = st.alongM;
    out[o + 9] = P.k;
    // AN UNRESOLVED STATION STILL OWNS ITS REGION. Its refusal means "nothing
    // may change here", and that has to bind the channel carve too — otherwise
    // the bank declines to cut a rock face and the carve planes it anyway,
    // which is the refusal costing nothing. Outward only: the bank failed on
    // the LAND side, and the bed inside is the carve's and the field's.
    out[o + 10] = st.unresolved === null ? 0 : P.reach;
    out[o + 11] = st.unresolved === null ? 0 : BANK_FLAG_UNRESOLVED;
  }
  return out;
}
