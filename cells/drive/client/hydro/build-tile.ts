import { riverDrops, sampleRiverDrop, type RiverDrop } from './waterfalls';
import { solveCoastField, swellWavelengthM } from './coast-field';
import { HydroBodyRegistry } from './body-registry';
import {
  areaOfRing,
  boundsIntersect,
  clamp,
  featureBounds,
  nearestSegment,
  pointInArea,
  quantile,
  sampleCoverage,
  sampleElevation,
} from './geometry';
import {
  DEFAULT_HYDRO_BUILD,
  HYDRO_BANK_ID,
  HYDRO_BANK_MASK,
  HYDRO_BANK_SHIFT,
  HYDRO_BED_ID,
  HYDRO_BED_MASK,
  HYDRO_BED_SHIFT,
  HYDRO_KIND_ID,
  HydroFlags,
  type HydroBody,
  type HydroBodyObservation,
  type HydroBuildOptions,
  type HydroFeature,
  type HydroKind,
  type HydroTileField,
  type HydroTileInput,
  type PackedXZ,
  type ResolvedHydroFeature,
  type WorldBounds,
} from './types';

export interface HydroTileAnalysis {
  observations: HydroBodyObservation[];
  /**
   * Tile-local, downhill profiles. Keyed by feature id AND by id#index —
   * Overpass clips one way into several fragments sharing an id, and each
   * fragment carries its own stretch of geometry, so a bare-id lookup would
   * hand every fragment whichever profile analysed last. The bare id stays
   * as the first fragment's profile for callers that hold only the id.
   */
  profiles: ReadonlyMap<string, Float32Array>;
}

const FLOWING = new Set<HydroKind>(['river', 'stream', 'canal']);
const ID_TO_KIND = new Map<number, HydroKind>(
  (Object.entries(HYDRO_KIND_ID) as Array<[HydroKind, number]>).map(([k, v]) => [v, k]));

function fillMissing(values: number[]): void {
  let first = values.findIndex(Number.isFinite);
  if (first < 0) { values.fill(0); return; }
  for (let i = 0; i < first; i++) values[i] = values[first];
  let prior = first;
  for (let i = first + 1; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    const a = values[prior], b = values[i], span = i - prior;
    for (let k = 1; k < span; k++) values[prior + k] = a + (b - a) * (k / span);
    prior = i;
  }
  for (let i = prior + 1; i < values.length; i++) values[i] = values[prior];
}

/** Least-squares non-increasing fit (pool-adjacent-violators). */
function descendingFit(values: number[]): number[] {
  const blocks: Array<{ start: number; end: number; sum: number; count: number }> = [];
  for (let i = 0; i < values.length; i++) {
    blocks.push({ start: i, end: i, sum: values[i], count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.count >= b.sum / b.count) break;
      a.end = b.end; a.sum += b.sum; a.count += b.count; blocks.pop();
    }
  }
  const out = new Array<number>(values.length);
  for (const block of blocks) {
    const value = block.sum / block.count;
    for (let i = block.start; i <= block.end; i++) out[i] = value;
  }
  return out;
}

/**
 * ── THE SPINE IS RESAMPLED, NOT INHERITED ──
 *
 * Every station-indexed quantity downstream of here — the energy baselines,
 * the curvature estimate, the river-space `s` itself — used to inherit OSM's
 * node density, which is whatever the mapper's hand did that day: forty
 * metres on one reach, four hundred on the next. Curvature from unequal
 * chords is noise, and an energy window counted in stations means nothing.
 * Resampling at a consistent physical interval makes station arithmetic mean
 * metres again. The original endpoints are kept EXACTLY, because the
 * registry joins fragments of one river by endpoint coincidence.
 */
function resampleLine(points: PackedXZ, stepM: number): Float64Array {
  const count = points.length >> 1;
  if (count < 2) return Float64Array.from(points);
  let total = 0;
  for (let i = 1; i < count; i++) {
    total += Math.hypot(points[i * 2] - points[(i - 1) * 2], points[i * 2 + 1] - points[(i - 1) * 2 + 1]);
  }
  // A degenerate or absurd fragment keeps a bounded station count: widen the
  // step rather than allocating without limit.
  const step = Math.max(stepM, total / 4096);
  const stations = Math.max(2, Math.round(total / Math.max(1e-6, step)) + 1);
  const out = new Float64Array(stations * 2);
  out[0] = points[0]; out[1] = points[1];
  let seg = 1, segStart = 0;
  let segLen = Math.hypot(points[2] - points[0], points[3] - points[1]);
  for (let j = 1; j < stations - 1; j++) {
    const target = (j / (stations - 1)) * total;
    while (segStart + segLen < target && seg < count - 1) {
      segStart += segLen;
      seg++;
      segLen = Math.hypot(points[seg * 2] - points[(seg - 1) * 2], points[seg * 2 + 1] - points[(seg - 1) * 2 + 1]);
    }
    const t = segLen > 1e-9 ? (target - segStart) / segLen : 0;
    out[j * 2] = points[(seg - 1) * 2] + (points[seg * 2] - points[(seg - 1) * 2]) * t;
    out[j * 2 + 1] = points[(seg - 1) * 2 + 1] + (points[seg * 2 + 1] - points[(seg - 1) * 2 + 1]) * t;
  }
  out[(stations - 1) * 2] = points[(count - 1) * 2];
  out[(stations - 1) * 2 + 1] = points[(count - 1) * 2 + 1];
  return out;
}

function lineProfile(input: HydroTileInput, feature: HydroFeature): Float32Array | undefined {
  if (feature.geometry.type !== 'line') return undefined;
  // Sub-channel-width stations buy nothing; forty-metre ones lose the bends.
  const points = resampleLine(feature.geometry.points,
    clamp(feature.geometry.widthM * 1.25, 10, 40));
  const count = points.length >> 1;
  if (count < 2) return undefined;
  // THE CARVED BED FIRST. Where the terrain has already dug this channel the
  // stations stand on its invert, so the surface and the ground are one
  // solve; the raster answers everywhere else, as it always did. One call a
  // station (10-40m apart), not one a texel — see the bedFoot note below for
  // what happens when this is asked per pixel.
  // THE INVERT IS THE FLOOR, NOT THE SURFACE. Levelling the stations ON it
  // gave a river of exactly zero depth — surface and bed the same number at
  // every texel, measured — so the station stands a nominal depth above the
  // bed the ground was carved to, which is what the ribbon has always drawn.
  const invert = input.channelInvertM;
  const heights = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const x = points[i * 2], z = points[i * 2 + 1];
    const inv = invert ? invert(x, z) : NaN;
    heights[i] = feature.taggedLevelM
      ?? (Number.isFinite(inv) ? inv + FLOWING_NOMINAL_DEPTH_M
        : sampleElevation(input.elevation, input.bounds, x, z));
  }
  fillMissing(heights);
  // A tiny symmetric filter removes individual DEM pits before direction is
  // inferred. The monotone fit below handles the longitudinal contract.
  const smooth = heights.map((h, i) => (
    heights[Math.max(0, i - 1)] + h * 2 + heights[Math.min(count - 1, i + 1)]
  ) / 4);
  const edge = Math.max(1, Math.floor(count * 0.2));
  const start = smooth.slice(0, edge).reduce((a, b) => a + b, 0) / edge;
  const end = smooth.slice(count - edge).reduce((a, b) => a + b, 0) / edge;
  // OSM waterway ways conventionally run in flow direction. Preserve that
  // authored network orientation; a 30m DEM is too noisy to reverse adjacent
  // fragments independently. Synthetic lines still use the terrain evidence.
  const reverse = feature.source === 'osm' ? false : end > start;
  const order = Array.from({ length: count }, (_, i) => reverse ? count - 1 - i : i);
  const fitted = descendingFit(order.map((i) => smooth[i]));
  const out = new Float32Array(count * 3);
  for (let j = 0; j < count; j++) {
    const i = order[j];
    out[j * 3] = points[i * 2];
    out[j * 3 + 1] = points[i * 2 + 1];
    out[j * 3 + 2] = fitted[j];
  }
  return out;
}

/**
 * A standing-water AREA whose interior lies mostly under the confirmed ocean
 * mask is the sea wearing an OSM `natural=water` polygon. Camps Bay's beach
 * carries one, three texels wide between the sand and the ocean body, and as
 * a LAKE it drew a pond's edge where the surf should break, kept the surf
 * strip and the run-up off that shore (they compile for coastal kinds only),
 * and cut the coast field's travel off at its own rim — the field measured
 * the sea's crests from the polygon's edge and left the band itself with
 * none. Observed as a lagoon it is coastal, which is what it is on the
 * ground. Sampled the way `areaEvidence` samples a level: an eleven-by-eleven
 * lattice over the clipped bounds, the samples inside the polygon, and the
 * sea if half of them read confirmed ocean. A lake behind a beach has none
 * under the mask; a wetland keeps its own kind whatever it stands in.
 */
export function seaTouching(input: HydroTileInput, feature: HydroFeature): boolean {
  const t = seaTouchingStats(input, feature);
  return t.known >= 3 && t.sea * 2 >= t.known;
}
/** The rule's arithmetic, for the tile debug: samples on the lattice, inside
 *  the polygon, answered by the mask, and reading sea. */
export function seaTouchingStats(input: HydroTileInput, feature: HydroFeature): { inside: number; known: number; sea: number; why?: string } {
  if (feature.geometry.type !== 'area' || FLOWING.has(feature.kind)
    || feature.kind === 'wetland' || feature.kind === 'lagoon' || feature.kind === 'ocean') return { inside: 0, known: 0, sea: 0, why: 'kind' };
  if (input.oceanCoverage.status !== 'ready') return { inside: 0, known: 0, sea: 0, why: 'no coverage' };
  const bounds = featureBounds(feature);
  if (!boundsIntersect(bounds, input.bounds)) return { inside: 0, known: 0, sea: 0, why: 'outside' };
  const clipped: WorldBounds = {
    minX: Math.max(bounds.minX, input.bounds.minX),
    minZ: Math.max(bounds.minZ, input.bounds.minZ),
    maxX: Math.min(bounds.maxX, input.bounds.maxX),
    maxZ: Math.min(bounds.maxZ, input.bounds.maxZ),
  };
  const covBounds = input.oceanCoverage.bounds ?? input.bounds;
  // THE MASK'S UNKNOWNS DO NOT VOTE. Offshore the mask is often not yet
  // judged (a class-80 pixel waits for the terrain under it — see
  // OceanCoverage's tri-state), so the verdict is taken over the samples
  // the mask has answered.
  const n = 11;
  let inside = 0, known = 0, sea = 0;
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = clipped.minX + (ix + 0.5) / n * (clipped.maxX - clipped.minX);
    const z = clipped.minZ + (iz + 0.5) / n * (clipped.maxZ - clipped.minZ);
    if (!pointInArea(x, z, feature.geometry)) continue;
    inside++;
    const raw = sampleCoverage(input.oceanCoverage.grid, covBounds, x, z);
    if (raw < 0.25) continue;
    known++;
    if (raw >= 0.7) sea++;
  }
  return { inside, known, sea };
}

function areaEvidence(input: HydroTileInput, feature: HydroFeature): number | undefined {
  if (feature.taggedLevelM !== undefined) return feature.taggedLevelM;
  if (feature.geometry.type !== 'area') return undefined;
  const bounds = featureBounds(feature);
  if (!boundsIntersect(bounds, input.bounds)) return undefined;
  const clipped: WorldBounds = {
    minX: Math.max(bounds.minX, input.bounds.minX),
    minZ: Math.max(bounds.minZ, input.bounds.minZ),
    maxX: Math.min(bounds.maxX, input.bounds.maxX),
    maxZ: Math.min(bounds.maxZ, input.bounds.maxZ),
  };
  const samples: number[] = [];
  // Fixed bounded evidence: enough to reject bank contamination without tile
  // build cost growing with a reservoir's area.
  const n = 11;
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = clipped.minX + (ix + 0.5) / n * (clipped.maxX - clipped.minX);
    const z = clipped.minZ + (iz + 0.5) / n * (clipped.maxZ - clipped.minZ);
    if (!pointInArea(x, z, feature.geometry)) continue;
    const h = sampleElevation(input.elevation, input.bounds, x, z);
    if (Number.isFinite(h)) samples.push(h);
  }
  // A sub-DEM pond can miss every interior sample. Its ring is weaker evidence
  // but still better than silently borrowing ocean level.
  if (samples.length < 4) {
    for (const polygon of feature.geometry.polygons) {
      const ring = polygon.outer;
      const step = Math.max(1, Math.floor((ring.length >> 1) / 24));
      for (let i = 0; i < (ring.length >> 1); i += step) {
        const h = sampleElevation(input.elevation, input.bounds, ring[i * 2], ring[i * 2 + 1]);
        if (Number.isFinite(h)) samples.push(h);
      }
    }
  }
  // Slightly below the median resists a few high bank pixels without selecting
  // the deepest DEM error in the body.
  // A COVER-RASTER BODY STANDS AT THE LOWEST GROUND IN IT. Its outline is
  // 38 m pixels, so it always takes in bank: at the Hunzikenbrücke over the
  // Aare the 40th percentile of the ground inside it read 520.4 m against a
  // river surface of 517.1, and the bridge deck stood in the water. An OSM
  // outline is drawn at the waterline and its median is the surface; a
  // cover outline is not, and only its low ground is.
  if (feature.source === 'landcover') return quantile(samples, samples.length >= 8 ? 0.12 : 0);
  return quantile(samples, samples.length >= 8 ? 0.4 : 0.5);
}

function fetchFor(feature: HydroFeature): number {
  if (feature.geometry.type === 'line') return Math.max(12, feature.geometry.widthM * 5);
  let area = 0;
  for (const polygon of feature.geometry.polygons) {
    area += areaOfRing(polygon.outer);
    for (const hole of polygon.holes) area -= areaOfRing(hole);
  }
  // Characteristic diameter rather than bounding-box diagonal, so a winding
  // riverbank relation does not acquire ocean swell.
  return clamp(2 * Math.sqrt(Math.max(1, area) / Math.PI), 6, 20000);
}

function flowFromProfile(profile: Float32Array | undefined): readonly [number, number] {
  if (!profile || profile.length < 6) return [0, 0];
  const dx = profile[profile.length - 3] - profile[0];
  const dz = profile[profile.length - 2] - profile[1];
  const length = Math.hypot(dx, dz) || 1;
  return [dx / length, dz / length];
}

export function analyseHydroTile(input: HydroTileInput): HydroTileAnalysis {
  const observations: HydroBodyObservation[] = [];
  const profiles = new Map<string, Float32Array>();

  if (input.oceanCoverage.status === 'ready' && input.oceanCoverage.grid.data.some((v) => v > 0)) {
    observations.push({
      tileKey: input.key,
      id: 'hydro:ocean',
      kind: 'ocean',
      flow: [0, 0],
      fetchM: 50000,
      intermittent: false,
      tidal: true,
    });
  }

  for (let index = 0; index < input.features.length; index++) {
    const feature = input.features[index];
    if (!boundsIntersect(featureBounds(feature), input.bounds)) continue;
    const profile = FLOWING.has(feature.kind) ? lineProfile(input, feature) : undefined;
    if (profile) {
      profiles.set(`${feature.id}#${index}`, profile);
      if (!profiles.has(feature.id)) profiles.set(feature.id, profile);
    }
    observations.push({
      tileKey: input.key,
      id: feature.id,
      kind: seaTouching(input, feature) ? 'lagoon' : feature.kind,
      candidateLevelM: profile ? quantile(Array.from(profile).filter((_, i) => i % 3 === 2), 0.5) : areaEvidence(input, feature),
      taggedLevelM: feature.taggedLevelM,
      profile,
      flow: flowFromProfile(profile),
      fetchM: fetchFor(feature),
      roughness: feature.roughness,
      turbidity: feature.turbidity,
      bedMaterial: feature.bedMaterial,
      bankMaterial: feature.bankMaterial,
      intermittent: feature.intermittent,
      tidal: feature.tidal,
    });
  }
  return { observations, profiles };
}

/**
 * ── FLOWING WATER HAS NO SINGLE LEVEL ──
 *
 * A lake is flat and a sea is flat, so one elevation describes them. A river
 * is not: it descends, which is the whole reason the level model carries a
 * profile at all. But a profile only comes from LINE geometry, and OSM maps
 * any river wide enough to see as an AREA — `waterway=riverbank`, or
 * `natural=water` with `water=river`. Those fall through to `areaEvidence`,
 * which returns one number for the body, and the registry then reconciles
 * that one number across every tile the river crosses. Upstream wins as often
 * as not, and the whole reach downstream is drawn at a level its bed never
 * reaches.
 *
 * Measured on the Muota at Ingenbohl: one flat 440.7m over a bed running
 * 433.6m to 438.0m — a sheet floating a median 6.8m above the valley, which
 * from the cab is at or above eye level and therefore both invisible (a
 * front-faced plane seen from beneath) and expensive. Reported from the seat
 * as exactly that, and correctly diagnosed there before it was measured here.
 *
 * So a flowing body with no profile takes the LOCAL bed instead, plus a
 * nominal depth. That is what the old watercourse solver has always done —
 * it reads the ground station by station and lets the water descend with it —
 * and it is right for the same reason: the surface of running water is a
 * property of the channel under it, not of the body as a whole.
 *
 * Standing water is untouched. A lake's flatness is not an approximation.
 */
/** Shared with the isolated lab's display carve so its terrain and the shipping
 *  profile solver depict the same channel depth. */
export const FLOWING_NOMINAL_DEPTH_M = 0.6;
function bodyLevel(
  body: HydroBody,
  profile: Float32Array | undefined,
  x: number,
  z: number,
  bedM?: number,
): number {
  if (body.level.type === 'flat' || body.level.type === 'ocean') {
    if (FLOWING.has(body.kind) && bedM !== undefined && Number.isFinite(bedM)) {
      return bedM + FLOWING_NOMINAL_DEPTH_M;
    }
    return body.level.elevationM;
  }
  const stations = profile ?? body.level.stations;
  const hit = nearestSegment(x, z, stations, 3);
  if (hit.segment < 0) return stations[2] ?? 0;
  const a = hit.segment * 3 + 2, b = (hit.segment + 1) * 3 + 2;
  return stations[a] * (1 - hit.t) + stations[b] * hit.t;
}

/**
 * ── RIVER ENERGY, DECIDED HERE AND NOT IN THE SHADER ──
 *
 * The shader used to infer turbulence per vertex from raw level gradients,
 * and DEM noise pushed most of every river over the rapids threshold. Energy
 * is a property of the reach, so it is computed on the reach: per station,
 * from the longitudinal slope of the monotone-fitted profile over a ~60m
 * baseline (the same window the legacy watercourse solver settled on, for
 * the same reason — one station of drop is mostly raster noise), mapped
 * through sqrt as every open-channel formula and the eye agree, then
 * smoothed twice so rapids form coherent reaches instead of pixel events.
 *
 * Packed into the field's dynamics.w, which for standing water carries the
 * sea state — one channel, two regimes, split by flow length exactly as the
 * shader splits everything else.
 */
function profileEnergy(profile: Float32Array): Float32Array {
  const n = profile.length / 3;
  const e = new Float32Array(n);
  // Cumulative distance along the stations, once.
  const along = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    along[i] = along[i - 1] + Math.hypot(
      profile[i * 3] - profile[(i - 1) * 3],
      profile[i * 3 + 1] - profile[(i - 1) * 3 + 1]);
  }
  const HALF = 30;                 // metres of baseline each side
  const FULL_AT = 0.04;            // 4% slope reads as full whitewater
  for (let i = 0; i < n; i++) {
    let a = i, b = i;
    while (a > 0 && along[i] - along[a - 1] < HALF) a--;
    while (b < n - 1 && along[b + 1] - along[i] < HALF) b++;
    const run = along[b] - along[a];
    const drop = profile[a * 3 + 2] - profile[b * 3 + 2];
    const slope = run > 1 ? Math.max(0, drop) / run : 0;
    const slopeEnergy = clamp(Math.sqrt(slope / FULL_AT), 0, 1);

    // A hard bend produces working water even without a steep DEM profile:
    // pressure piles up at the outside bank, the inner lane slackens, and the
    // reach boils before it necessarily turns white. Curvature is deliberately
    // capped below the foam threshold; grade still owns actual whitewater.
    let bendEnergy = 0;
    if (i > 0 && i + 1 < n) {
      const ax = profile[i * 3] - profile[(i - 1) * 3];
      const az = profile[i * 3 + 1] - profile[(i - 1) * 3 + 1];
      const bx = profile[(i + 1) * 3] - profile[i * 3];
      const bz = profile[(i + 1) * 3 + 1] - profile[i * 3 + 1];
      const al = Math.hypot(ax, az) || 1, bl = Math.hypot(bx, bz) || 1;
      const cross = Math.abs((ax / al) * (bz / bl) - (az / al) * (bx / bl));
      bendEnergy = clamp(cross * 0.34, 0, 0.34);
    }
    e[i] = Math.max(slopeEnergy, bendEnergy);
  }
  for (let pass = 0; pass < 2; pass++) {
    const c = e.slice();
    for (let i = 1; i < n - 1; i++) e[i] = (c[i - 1] + c[i] * 2 + c[i + 1]) * 0.25;
  }

  // Turbulence does not stop at the final steep station. Carry the settled
  // reach energy downstream with a distance-based decay: short after riffles,
  // longer after true rapids. This moves the causal memory to the CPU and lets
  // the fragment shader remove its two upstream texture reads.
  for (let i = 1; i < n; i++) {
    const ds = Math.max(0, along[i] - along[i - 1]);
    const persistenceM = 26 + e[i - 1] * 72;
    e[i] = Math.max(e[i], e[i - 1] * Math.exp(-ds / persistenceM));
  }
  return e;
}

/**
 * ── THE SPINE: RIVER SPACE, DERIVED ONCE PER FRAGMENT ──
 *
 * `along` is cumulative distance downstream from the fragment's first station
 * (the registry's s0 shifts it into the body's shared count). `curvature` is
 * the signed heading rate dθ/ds — positive bends one way, negative the other
 * — from the RESAMPLED stations, so equal chords make it an actual rate
 * rather than node-density noise. Smoothed once for the same reason the
 * energy is: a bend is a reach property, not a station event.
 */
interface ProfileSpine {
  along: Float32Array;
  curvature: Float32Array;
}
function profileSpine(profile: Float32Array): ProfileSpine {
  const n = profile.length / 3;
  const along = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    along[i] = along[i - 1] + Math.hypot(
      profile[i * 3] - profile[(i - 1) * 3],
      profile[i * 3 + 1] - profile[(i - 1) * 3 + 1]);
  }
  const curvature = new Float32Array(n);
  for (let i = 1; i + 1 < n; i++) {
    const ax = profile[i * 3] - profile[(i - 1) * 3];
    const az = profile[i * 3 + 1] - profile[(i - 1) * 3 + 1];
    const bx = profile[(i + 1) * 3] - profile[i * 3];
    const bz = profile[(i + 1) * 3 + 1] - profile[i * 3 + 1];
    const al = Math.hypot(ax, az), bl = Math.hypot(bx, bz);
    if (al < 1e-6 || bl < 1e-6) continue;
    // cross of unit tangents ~ sin(dθ) ~ dθ over half the two chords' span.
    const cross = (ax / al) * (bz / bl) - (az / al) * (bx / bl);
    curvature[i] = cross / Math.max(1e-6, (al + bl) * 0.5);
  }
  if (n > 2) { curvature[0] = curvature[1]; curvature[n - 1] = curvature[n - 2]; }
  const copy = curvature.slice();
  for (let i = 1; i + 1 < n; i++) curvature[i] = (copy[i - 1] + copy[i] * 2 + copy[i + 1]) * 0.25;
  return { along, curvature };
}

function energyAt(profile: Float32Array, energy: Float32Array, x: number, z: number): number {
  const hit = nearestSegment(x, z, profile, 3);
  if (hit.segment < 0) return energy[0] ?? 0;
  return energy[hit.segment] * (1 - hit.t) + (energy[hit.segment + 1] ?? energy[hit.segment]) * hit.t;
}

/**
 * ── ONE NEAREST-SEGMENT HIT PER TEXEL, FOUND THROUGH A BUCKET INDEX ──
 *
 * The paint loop used to walk the ENTIRE polyline three times per texel —
 * once each for level, flow and energy — and a long river's bbox spans most
 * of its tile. Measured at the Senqu: ~576 stations times ~19,600 texels
 * times three is tens of millions of segment tests per rebuild, which is the
 * coastless rebuild hang reported from the seat. The index buckets segments
 * into cells sized to the river's own width; each texel asks only its 3x3
 * neighbourhood, and a texel with no segment there cannot be inside the
 * water (the search radius exceeds half-width plus antialias), so it skips
 * the paint entirely. One hit then answers distance, level, flow AND energy.
 */
interface ProfileIndex {
  cell: number;
  minX: number;
  minZ: number;
  cols: number;
  buckets: Map<number, number[]>;
}
function indexProfile(profile: Float32Array, widthM: number): ProfileIndex {
  const cell = Math.max(96, widthM * 1.5);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  const n = profile.length / 3;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, profile[i * 3]); maxX = Math.max(maxX, profile[i * 3]);
    minZ = Math.min(minZ, profile[i * 3 + 1]); maxZ = Math.max(maxZ, profile[i * 3 + 1]);
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const buckets = new Map<number, number[]>();
  for (let i = 0; i + 1 < n; i++) {
    const cx0 = Math.floor((Math.min(profile[i * 3], profile[i * 3 + 3]) - minX) / cell);
    const cx1 = Math.floor((Math.max(profile[i * 3], profile[i * 3 + 3]) - minX) / cell);
    const cz0 = Math.floor((Math.min(profile[i * 3 + 1], profile[i * 3 + 4]) - minZ) / cell);
    const cz1 = Math.floor((Math.max(profile[i * 3 + 1], profile[i * 3 + 4]) - minZ) / cell);
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = cz * cols + cx;
      let arr = buckets.get(k);
      if (!arr) buckets.set(k, (arr = []));
      arr.push(i);
    }
  }
  return { cell, minX, minZ, cols, buckets };
}
/** One 2×2-texel block's answer from the nearest-profile search: the segment
 *  it found, from which every texel in the block derives its own distance,
 *  side and station exactly (a straight segment projects), so the search
 *  runs a quarter as often and the centreline seam stays where it is. */
interface BlockHit {
  px: number; pz: number; fx: number; fz: number;
  energy: number; s: number; curvature: number; centreHalfW: number; levelM: number;
  grade: number; drops: readonly RiverDrop[]; s0: number;
}
interface ProfileHit {
  distanceM: number;
  levelM: number;
  grade: number;
  /** Projection foot on the centreline — where the thalweg bed is sampled. */
  px: number;
  pz: number;
  fx: number;
  fz: number;
  energy: number;
  /** Metres downstream from the fragment's first station (add the span s0). */
  s: number;
  /** Which side of the centreline: +1 left of the tangent, -1 right. */
  side: number;
  curvature: number;
}
function sampleProfileAt(
  profile: Float32Array,
  energy: Float32Array | undefined,
  spine: ProfileSpine,
  index: ProfileIndex,
  x: number,
  z: number,
  searchCells = 1,
): ProfileHit | null {
  const cx = Math.floor((x - index.minX) / index.cell);
  const cz = Math.floor((z - index.minZ) / index.cell);
  let best = -1, bestD2 = Infinity, bestT = 0;
  for (let dz = -searchCells; dz <= searchCells; dz++) {
    for (let dx = -searchCells; dx <= searchCells; dx++) {
    const arr = index.buckets.get((cz + dz) * index.cols + (cx + dx));
    if (!arr) continue;
    for (const i of arr) {
      const o = i * 3, q = o + 3;
      const ax = profile[o], az = profile[o + 1];
      const vx = profile[q] - ax, vz = profile[q + 1] - az;
      const d2v = vx * vx + vz * vz;
      const t = d2v > 0 ? clamp(((x - ax) * vx + (z - az) * vz) / d2v, 0, 1) : 0;
      const qx = ax + vx * t, qz = az + vz * t;
      const d2 = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d2 < bestD2) { bestD2 = d2; best = i; bestT = t; }
    }
  }
  }
  if (best < 0) return null;
  const o = best * 3, q = o + 3;
  const vx = profile[q] - profile[o], vz = profile[q + 1] - profile[o + 1];
  const len = Math.hypot(vx, vz) || 1;
  const eA = energy ? energy[best] : 0;
  const eB = energy ? (energy[best + 1] ?? eA) : 0;
  const px = profile[o] + vx * bestT, pz = profile[o + 1] + vz * bestT;
  const fx = vx / len, fz = vz / len;
  // The sign of the cross product tangent x offset says which bank; the
  // magnitude is already bestD2. This is what makes `n` SIGNED — the two
  // banks of one river must never share a coordinate.
  const cross = fx * (z - pz) - fz * (x - px);
  const curvA = spine.curvature[best], curvB = spine.curvature[best + 1] ?? curvA;
  return {
    grade: (profile[q + 2] - profile[o + 2]) / len,
    distanceM: Math.sqrt(bestD2),
    levelM: profile[o + 2] * (1 - bestT) + profile[q + 2] * bestT,
    px, pz, fx, fz,
    energy: eA * (1 - bestT) + eB * bestT,
    s: spine.along[best] + (spine.along[best + 1] - spine.along[best]) * bestT,
    side: cross >= 0 ? 1 : -1,
    curvature: curvA * (1 - bestT) + curvB * bestT,
  };
}

function profileFlow(profile: Float32Array | undefined, body: HydroBody, x: number, z: number): readonly [number, number] {
  if (!profile?.length) return body.flow;
  const hit = nearestSegment(x, z, profile, 3);
  return hit.segment < 0 ? body.flow : [hit.tangentX, hit.tangentZ];
}

function waveScale(kind: HydroKind, fetchM: number, roughness: number): number {
  switch (kind) {
    case 'ocean': return clamp(0.55 + roughness * 0.55, 0.5, 1.2);
    case 'lagoon': return clamp(fetchM / 1800, 0.12, 0.55);
    case 'lake':
    case 'reservoir': return clamp(fetchM / 2400, 0.08, 0.62);
    case 'pond':
    case 'basin': return clamp(fetchM / 900, 0.025, 0.18);
    case 'river': return clamp(fetchM / 450, 0.08, 0.35);
    case 'stream': return clamp(fetchM / 180, 0.05, 0.28);
    case 'canal': return clamp(fetchM / 700, 0.04, 0.16);
    case 'wetland': return 0.025;
  }
}

function priority(kind: HydroKind): number {
  if (kind === 'ocean') return 0;
  if (kind === 'wetland') return 1;
  if (FLOWING.has(kind)) return 3;
  return 2;
}

function distanceTransform(mask: Uint8Array, width: number, height: number, target: number): Float32Array {
  const inf = 1e9;
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] === target ? 0 : inf;
  const rt2 = Math.SQRT2;
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (x > 0) out[i] = Math.min(out[i], out[i - 1] + 1);
    if (z > 0) out[i] = Math.min(out[i], out[i - width] + 1);
    if (x > 0 && z > 0) out[i] = Math.min(out[i], out[i - width - 1] + rt2);
    if (x + 1 < width && z > 0) out[i] = Math.min(out[i], out[i - width + 1] + rt2);
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x;
    if (x + 1 < width) out[i] = Math.min(out[i], out[i + 1] + 1);
    if (z + 1 < height) out[i] = Math.min(out[i], out[i + width] + 1);
    if (x + 1 < width && z + 1 < height) out[i] = Math.min(out[i], out[i + width + 1] + rt2);
    if (x > 0 && z + 1 < height) out[i] = Math.min(out[i], out[i + width - 1] + rt2);
  }
  return out;
}

/** Approximate Euclidean nearest-source map, used to extend resting levels
 * beneath dry masked fragments. This is what lets a pond smaller than one
 * mesh quad retain its own elevation: fragment coverage cuts its outline,
 * while the surrounding vertices inherit the nearest body's plane. */
function nearestSourceMap(source: Uint8Array, width: number, height: number): Int32Array {
  const nearest = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < source.length; i++) if (source[i]) nearest[i] = i;
  const consider = (i: number, candidate: number): void => {
    if (candidate < 0) return;
    const x = i % width, z = Math.floor(i / width);
    const cx = candidate % width, cz = Math.floor(candidate / width);
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    const prior = nearest[i];
    if (prior < 0) { nearest[i] = candidate; return; }
    const px = prior % width, pz = Math.floor(prior / width);
    if (d < (x - px) ** 2 + (z - pz) ** 2) nearest[i] = candidate;
  };
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const i = z * width + x;
    if (x > 0) consider(i, nearest[i - 1]);
    if (z > 0) consider(i, nearest[i - width]);
    if (x > 0 && z > 0) consider(i, nearest[i - width - 1]);
    if (x + 1 < width && z > 0) consider(i, nearest[i - width + 1]);
  }
  for (let z = height - 1; z >= 0; z--) for (let x = width - 1; x >= 0; x--) {
    const i = z * width + x;
    if (x + 1 < width) consider(i, nearest[i + 1]);
    if (z + 1 < height) consider(i, nearest[i + width]);
    if (x + 1 < width && z + 1 < height) consider(i, nearest[i + width + 1]);
    if (x > 0 && z + 1 < height) consider(i, nearest[i + width - 1]);
  }
  return nearest;
}

/** ── COVERAGE BY SCANLINE, NOT BY DISTANCE ──
 *
 * An area's coverage was a signed distance to its rings, per texel: O(texels
 * × ring points), and a cover-raster lagoon or a real OSM lake outline runs
 * to a thousand points — measured at 177 ms for one hydro tile in the harness
 * once the cover's inland water arrived, against a 10 ms main-thread budget.
 * This fills the polygon by scanline at 4×4 sub-samples a texel instead:
 * O(rows × edges) once, then a lookup. The band the distance used to
 * anti-alias is now the sub-sample fraction, which is the same thing
 * measured the other way round. Holes are rings too: even-odd. */
const AREA_SS = 4;
function areaCoverageRaster(
  geometry: Extract<HydroFeature['geometry'], { type: 'area' }>,
  ix0: number, ix1: number, iz0: number, iz1: number,
  xAt: (ix: number) => number, zAt: (iz: number) => number,
  pixelX: number, pixelZ: number,
): Float32Array {
  const w = ix1 - ix0 + 1, h = iz1 - iz0 + 1;
  const counts = new Uint8Array(w * h);
  const X0 = xAt(ix0) - pixelX / 2, Z0 = zAt(iz0) - pixelZ / 2;
  const subW = pixelX / AREA_SS, subH = pixelZ / AREA_SS;
  // Only the edges that cross this raster's rows: a relation ring runs to
  // thousands of points and this tile sees a few dozen of them. An edge to
  // the LEFT or RIGHT of the raster still counts — even-odd parity needs it.
  const Z1 = Z0 + h * pixelZ;
  const ex0: number[] = [], ez0: number[] = [], ex1: number[] = [], ez1: number[] = [];
  for (const poly of geometry.polygons) {
    for (const ring of [poly.outer, ...poly.holes]) {
      const n = ring.length >> 1;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const z0 = ring[j * 2 + 1], z1 = ring[i * 2 + 1];
        if (Math.max(z0, z1) < Z0 || Math.min(z0, z1) > Z1 || z0 === z1) continue;
        ex0.push(ring[j * 2]); ez0.push(z0); ex1.push(ring[i * 2]); ez1.push(z1);
      }
    }
  }
  const xs: number[] = [];
  for (let sy = 0; sy < h * AREA_SS; sy++) {
    const zs = Z0 + (sy + 0.5) * subH;
    xs.length = 0;
    for (let e = 0; e < ex0.length; e++) {
      const z0 = ez0[e], z1 = ez1[e];
      if ((z0 > zs) === (z1 > zs)) continue;
      xs.push(ex0[e] + ((zs - z0) / (z1 - z0)) * (ex1[e] - ex0[e]));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = ((sy / AREA_SS) | 0) * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - X0) / subW - 0.5));
      const b = Math.min(w * AREA_SS - 1, Math.floor((xs[k + 1] - X0) / subW - 0.5));
      for (let sx = a; sx <= b; sx++) counts[row + ((sx / AREA_SS) | 0)]++;
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = counts[i] / (AREA_SS * AREA_SS);
  return out;
}

/** WHERE A BUILD GOES, cumulative across the session: the instrument for a
 *  hydro build that costs more than its frame. Read via __hydro().buildProf. */
export const HYDRO_BUILD_PROF = {
  builds: 0, total: 0, max: 0, ocean: 0, analyse: 0, raster: 0, texels: 0, search: 0, sources: 0, coast: 0,
  // `rest` WAS TWO THIRDS OF A BUILD, which is a phase name meaning "the rest
  // of it". Measured on the Yosemite capture at 33.5 of 51.7 ms — the split
  // below is what a phase called that is worth: every one of these is a FULL
  // GRID pass, so on a flowing tile (flowingFieldResolution 256 against the
  // dry 128) each costs four times what the same line costs elsewhere, and
  // which of them dominates decides whether the cut is the resolution, the
  // sampler or the transform.
  fill: 0, majority: 0, occlude: 0, extent: 0, shore: 0, ground: 0, pack: 0,
  items: 0, areaItems: 0, flowingAreas: 0, searchTexels: 0, paints: 0,
  /** Texels per build, so a phase can be read as ns/texel across resolutions. */
  texelCount: 0,
  /** HOW MUCH OF THE GRID THE WATER ACTUALLY OCCUPIES. Every phase after
   *  `analyse` is a full-grid pass, so the build's price is set by the TILE
   *  and not by the river in it; this pair is what says whether that is a
   *  fair price. `dryBuilds` are the tiles that built a whole field for no
   *  water at all. */
  coveredTexels: 0, dryBuilds: 0, dryMs: 0, dryTexels: 0, wetBuilds: 0, wetMs: 0, wetTexels: 0,
};
export function buildHydroTile(
  input: HydroTileInput,
  registry: HydroBodyRegistry,
  analysis: HydroTileAnalysis,
  partialOptions: Partial<HydroBuildOptions> = {},
  /** The field this build replaces, for last-known-good retention: texels the
   *  new coverage cannot answer keep this field's answer instead of going
   *  dry. A revision may add knowledge; it may not destroy it. */
  previous?: HydroTileField,
): HydroTileField {
  const options = { ...DEFAULT_HYDRO_BUILD, ...partialOptions };
  const resolution = Math.max(8, Math.floor(options.fieldResolution));
  const gutter = Math.max(0, Math.floor(options.gutter));
  const width = resolution + gutter * 2, height = width;
  const count = width * height;
  const spanX = input.bounds.maxX - input.bounds.minX;
  const spanZ = input.bounds.maxZ - input.bounds.minZ;
  const pixelX = spanX / resolution, pixelZ = spanZ / resolution;
  const pixelM = Math.sqrt(Math.abs(pixelX * pixelZ));
  const antialias = Math.max(pixelX, pixelZ) * 0.7;
  // A STREAM NARROWER THAN A TEXEL STILL DRAWS. An unnamed `waterway=stream`
  // is 4 m by default and a tile's texel is ~9 m, so its coverage peaked at
  // 0.66 on the centreline and the shore fade took the rest: a whole wooded
  // valley at George with two streams in its tile and no water in the field.
  // The drawn half-width reaches just past half a texel's DIAGONAL. A narrow
  // 45-degree stream otherwise lights only corner-touching texels; at the
  // fragment shader's 0.5 cutoff those islands meet at one mathematical point
  // and split on screen. The structure's own half-width (the cross-channel
  // chart and physics width) stays the tagged one.
  const continuousHalfW = Math.hypot(pixelX, pixelZ) * 0.51;
  const drawnHalfW = (lineWidth: number): number =>
    Math.max(lineWidth * 0.5, continuousHalfW);

  const coverage = new Float32Array(count);
  const level = new Float32Array(count);
  const depth = new Float32Array(count);
  const flowX = new Float32Array(count);
  const flowZ = new Float32Array(count);
  const fetch = new Float32Array(count);
  const scale = new Float32Array(count);
  const kind = new Uint8Array(count);
  const seed = new Uint8Array(count);
  const turbidity = new Uint8Array(count);
  const flags = new Uint8Array(count);
  const rank = new Uint8Array(count);
  const bodyIds = new Set<string>();
  // ── IS THERE ANY WATER IN THIS TILE AT ALL? ──
  //
  // Set by the two — and only two — things that can put coverage on a texel:
  // `paint` below, and the last-known-good retention from the previous field.
  // The 3x3 majority pass only RAISES a texel that already carries a flowing
  // kind, and the occluders only lower, so once the item loop is done this
  // flag is final. It is a flag rather than a scan because the scan it
  // replaces would itself be one of the full-grid passes it exists to skip.
  let anyCoverage = false;
  // River space, allocated only once a flowing texel actually lands — an
  // ocean tile never pays for it. See HydroTileField.structure.
  let structure: Float32Array | null = null;
  let waterfalls: Float32Array<ArrayBuffer> | undefined;
  const structureAt = (): Float32Array => structure ?? (structure = new Float32Array(count * 4));
  const xAt = (ix: number): number => input.bounds.minX + ((ix - gutter) + 0.5) * pixelX;
  const zAt = (iz: number): number => input.bounds.minZ + ((iz - gutter) + 0.5) * pixelZ;

  // WHAT A BODY PAINTS IS THE SAME AT EVERY TEXEL — its priority, kind id,
  // seed, turbidity, flags and flat wave scale were recomputed per paint,
  // twelve thousand times for one wide river in one tile. Once per body.
  interface BodyConsts {
    p: number;
    flowing: boolean;
    scaleFlat: number;
    kindId: number;
    seed: number;
    turb: number;
    flags: number;
  }
  const bodyConsts = new Map<HydroBody, BodyConsts>();
  const constsOf = (body: HydroBody): BodyConsts => {
    let c = bodyConsts.get(body);
    if (!c) {
      const flowing = FLOWING.has(body.kind);
      const ws = waveScale(body.kind, body.fetchM, body.roughness);
      c = {
        p: priority(body.kind), flowing, scaleFlat: flowing ? Math.min(0.15, ws) : ws,
        kindId: HYDRO_KIND_ID[body.kind],
        seed: Math.round(clamp(body.seed, 0, 1) * 255), turb: Math.round(clamp(body.turbidity, 0, 1) * 255),
        flags: (body.intermittent ? HydroFlags.Intermittent : 0)
          | (body.tidal ? HydroFlags.Tidal : 0)
          | (flowing ? HydroFlags.Flowing : 0)
          | ((HYDRO_BED_ID[body.bedMaterial] << HYDRO_BED_SHIFT) & HYDRO_BED_MASK)
          | ((HYDRO_BANK_ID[body.bankMaterial] << HYDRO_BANK_SHIFT) & HYDRO_BANK_MASK),
      };
      bodyConsts.set(body, c);
    }
    return c;
  };
  const paint = (
    ix: number,
    iz: number,
    amount: number,
    body: HydroBody,
    levelM: number,
    localFlow: readonly [number, number],
    localEnergy?: number,
    /** River space for this texel: [s, n, curvature, halfWidth]. Flowing
     *  paints without a spine get a legible fallback below. */
    river?: readonly [number, number, number, number],
    /** The ground at this texel when the caller has already sampled it. */
    groundM?: number,
    fall?: readonly [number, number, number, number],
  ): void => {
    if (amount <= 0.005 || ix < 0 || iz < 0 || ix >= width || iz >= height) return;
    // Before the rank guard on purpose: a paint this one loses to is a paint
    // that already put coverage over the threshold on this texel.
    anyCoverage = true;
    const i = iz * width + ix;
    const c = constsOf(body);
    const p = c.p;
    if (rank[i] > p || (rank[i] === p && coverage[i] > amount)) return;
    rank[i] = p;
    if (fall && (fall[0] > 0 || fall[2] > 0)) waterfalls ??= new Float32Array(count * 4);
    if (waterfalls) waterfalls.set(fall ?? [0, 0, 0, 0], i * 4);
    if (c.flowing) {
      const st = structureAt();
      if (river) {
        st[i * 4] = river[0]; st[i * 4 + 1] = river[1];
        st[i * 4 + 2] = river[2]; st[i * 4 + 3] = river[3];
      } else {
        // No spine (an area river, or a profile too short to carry one): the
        // world position projected onto the BODY's one average flow direction.
        // One constant direction per body cannot fold a phase — this is the
        // old behaviour, demoted to the fallback it should always have been.
        st[i * 4] = xAt(ix) * body.flow[0] + zAt(iz) * body.flow[1];
        st[i * 4 + 1] = 0;
        st[i * 4 + 2] = 0;
        st[i * 4 + 3] = Math.max(4, body.fetchM / 10);
      }
    }
    coverage[i] = Math.max(coverage[i], amount);
    level[i] = levelM;
    const ground = groundM ?? sampleElevation(input.elevation, input.bounds, xAt(ix), zAt(iz));
    depth[i] = Number.isFinite(ground) ? Math.max(options.minimumDepthM, levelM - ground) : options.minimumDepthM;
    flowX[i] = localFlow[0]; flowZ[i] = localFlow[1];
    fetch[i] = body.fetchM;
    // Flowing water's wave scale IS its reach energy — see profileEnergy.
    // Without a profile a flowing body stays calm rather than inheriting a
    // fetch-derived state it has no evidence for.
    scale[i] = localEnergy !== undefined ? localEnergy : c.scaleFlat;
    kind[i] = c.kindId;
    seed[i] = c.seed;
    turbidity[i] = c.turb;
    flags[i] = c.flags;
    bodyIds.add(body.id);
  };

  const P = HYDRO_BUILD_PROF;
  const T0 = performance.now();
  let tMark = T0;
  const lap = (k: 'ocean' | 'analyse' | 'sources' | 'coast' | 'fill' | 'majority' | 'occlude' | 'extent' | 'shore' | 'ground' | 'pack'): void => { const now = performance.now(); P[k] += now - tMark; tMark = now; };
  const ocean = registry.get('hydro:ocean');
  // Which texels the CURRENT coverage actually answered — ocean or dry. The
  // rest are unknown and keep the previous field's verdict below.
  const answered = new Uint8Array(count);
  // The mask's own interior, remembered for the coast field: depth there is
  // fill, so the swell is solved as deep water over it.
  const oceanInterior = new Uint8Array(count);
  if (ocean && input.oceanCoverage.status === 'ready') {
    // The grid maps over the span it declares — the tile padded by the
    // gutter, when the caller sampled that far — so gutter texels carry real
    // coverage instead of an edge-clamped copy of the last tile row.
    const covBounds = input.oceanCoverage.bounds ?? input.bounds;
    for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
      const raw = sampleCoverage(input.oceanCoverage.grid, covBounds, xAt(ix), zAt(iz));
      // Tri-state: >=0.75 confirmed ocean, 0.25..0.75 confirmed dry,
      // <0.25 not yet known. See OceanCoverage in types.
      if (raw < 0.25) continue;
      answered[iz * width + ix] = 1;
      if (raw >= 0.9) oceanInterior[iz * width + ix] = 1;
      if (raw >= 0.7) {
        // ── THE MASK RULES OFFSHORE; DEPTH SHAPES ONLY THE EDGE ──
        //
        // Two regimes, split by how certain the coverage is. INTERIOR sea
        // (>= 0.9: the mask's own ocean, away from its boundary) draws solid,
        // because the DEM under open water is fill, not measurement — depth-
        // gating it made the whole sea speckle at the threshold, photographed
        // off Monterey as a checkerboard. The EDGE BAND (0.7..0.9: the
        // mask's boundary texels and the dilation outside them) is where the
        // DEM is real land data, and there the waterline is the terrain's own
        // datum crossing — the mechanism that made the legacy plane's coast
        // right for free, and that keeps the mask's 31m raster invisible.
        const x = xAt(ix), z = zAt(iz);
        const lvl = bodyLevel(ocean, undefined, x, z);
        let amount = 1;
        if (raw < 0.9) {
          const ground = sampleElevation(input.elevation, input.bounds, x, z);
          amount = Number.isFinite(ground)
            ? clamp((lvl - ground + 0.35) / 1.0, 0, 1) : 1;
        }
        paint(ix, iz, amount, ocean, lvl, [0, 0]);
      }
    }
  }
  // ── LAST KNOWN GOOD ──
  // A texel the new coverage could not answer keeps what the old field knew.
  // This is what stops a straight-edged rectangle of sea vanishing when a
  // rebuild lands before its cover does, and healing a minute later — the
  // shape a physical surface cannot make, photographed at Monterey. Only a
  // like-for-like field is consulted: same layout, same bounds.
  if (previous && previous.width === width && previous.height === height
    && previous.bounds.minX === input.bounds.minX && previous.bounds.minZ === input.bounds.minZ
    && previous.bounds.maxX === input.bounds.maxX && previous.bounds.maxZ === input.bounds.maxZ) {
    for (let i = 0; i < count; i++) {
      if (answered[i]) continue;
      if (previous.geometry[i * 4] <= 0.005) continue;
      anyCoverage = true;
      const prevKind = previous.material[i * 4];
      coverage[i] = previous.geometry[i * 4];
      level[i] = previous.elevationBaseM + previous.geometry[i * 4 + 2];
      depth[i] = previous.geometry[i * 4 + 3];
      flowX[i] = previous.dynamics[i * 4]; flowZ[i] = previous.dynamics[i * 4 + 1];
      fetch[i] = previous.dynamics[i * 4 + 2]; scale[i] = previous.dynamics[i * 4 + 3];
      kind[i] = prevKind; seed[i] = previous.material[i * 4 + 1];
      turbidity[i] = previous.material[i * 4 + 2]; flags[i] = previous.material[i * 4 + 3];
      rank[i] = priority(ID_TO_KIND.get(prevKind) ?? 'ocean');
      // A retained flowing texel keeps its river space too, or its phase
      // would snap to zero while its motion machinery kept running.
      if (previous.waterfalls && (flags[i] & HydroFlags.Flowing)) {
        waterfalls ??= new Float32Array(count * 4);
        waterfalls.set(previous.waterfalls.subarray(i * 4, i * 4 + 4), i * 4);
      }
      if (previous.structure && (flags[i] & HydroFlags.Flowing)) {
        const st = structureAt();
        st[i * 4] = previous.structure[i * 4];
        st[i * 4 + 1] = previous.structure[i * 4 + 1];
        st[i * 4 + 2] = previous.structure[i * 4 + 2];
        st[i * 4 + 3] = previous.structure[i * 4 + 3];
      }
    }
  }

  lap('ocean');
  const resolved: Array<ResolvedHydroFeature & {
    energy?: Float32Array;
    drops: RiverDrop[];
    spine?: ProfileSpine;
    s0?: number;
    index?: ProfileIndex;
  }> = [];
  for (let index = 0; index < input.features.length; index++) {
    const feature = input.features[index];
    const body = registry.get(feature.id);
    if (!body) continue;
    // This fragment's OWN profile — see the note on the profiles map.
    const profile = analysis.profiles.get(`${feature.id}#${index}`);
    const flowing = !!profile && FLOWING.has(feature.kind);
    const spine = flowing ? profileSpine(profile) : undefined;
    // The registry shifts this fragment's local chainage into the body's
    // shared count, so `s` is continuous where fragments meet — and STAYS
    // what it was on every rebuild, which is what stops the downstream
    // phase popping as the streamed ring changes.
    const s0 = spine && profile ? registry.riverSpanS0(
      feature.id,
      profile[0], profile[1],
      profile[profile.length - 3], profile[profile.length - 2],
      spine.along[spine.along.length - 1],
    ) : undefined;
    const lineWidth = feature.geometry.type === 'line' ? feature.geometry.widthM : 0;
    resolved.push({
      feature, body, profile, spine, s0,
      drops: profile && spine ? riverDrops(profile, spine.along) : [],
      index: profile && feature.geometry.type === 'line'
        ? indexProfile(profile, Math.max(lineWidth, antialias * 1.6)) : undefined,   // the DRAWN width's reach
      energy: flowing && profile ? profileEnergy(profile) : undefined,
    });
  }
  lap('analyse');
  for (const item of resolved) {
    P.items++;
    const fb = featureBounds(item.feature);
    const ix0 = clamp(Math.floor((fb.minX - input.bounds.minX) / pixelX) + gutter - 1, 0, width - 1);
    const ix1 = clamp(Math.ceil((fb.maxX - input.bounds.minX) / pixelX) + gutter + 1, 0, width - 1);
    const iz0 = clamp(Math.floor((fb.minZ - input.bounds.minZ) / pixelZ) + gutter - 1, 0, height - 1);
    const iz1 = clamp(Math.ceil((fb.maxZ - input.bounds.minZ) / pixelZ) + gutter + 1, 0, height - 1);
    const lineWidth = item.feature.geometry.type === 'line' ? item.feature.geometry.widthM : 0;
    const tRaster = performance.now();
    const areaCov = item.feature.geometry.type === 'area'
      ? areaCoverageRaster(item.feature.geometry, ix0, ix1, iz0, iz1, xAt, zAt, pixelX, pixelZ) : null;
    const covW = ix1 - ix0 + 1;
    const tTexels = performance.now();
    P.raster += tTexels - tRaster;
    if (areaCov) P.areaItems++;
    if (areaCov && FLOWING.has(item.feature.kind)) P.flowingAreas++;
    // THE SEARCH'S CANDIDATES ARE CHOSEN ONCE. The nearest-profile search
    // below ran every profile in the tile for every wet texel of a flowing
    // area: a 300 m river relation over a ~9 m field is thousands of wet
    // texels, and a coastal tile holds a dozen streams — 292 ms a build on
    // the phone (De Hoop, measured by the telemetry), where the search is
    // the only thing a relation added to a build. Only a profile whose
    // reach touches the area is a candidate, and each is skipped at a
    // texel its bounds cannot reach.
    const SEARCH_REACH = 420;
    const cands = FLOWING.has(item.feature.kind) && !item.spine && item.feature.geometry.type === 'area'
      ? resolved.filter((c) => c.profile && c.spine && c.index && boundsIntersect(featureBounds(c.feature), fb, SEARCH_REACH))
        .map((c) => ({ c, b: featureBounds(c.feature) }))
      : [];
    const covH = iz1 - iz0 + 1, bw = (covW + 1) >> 1;
    const blockHits: Array<BlockHit | null | undefined> = cands.length ? new Array<BlockHit | null | undefined>(bw * ((covH + 1) >> 1)) : [];
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = xAt(ix), z = zAt(iz);
      if (item.index && item.profile && item.spine) {
        // The fast path: one bucket-indexed hit answers everything — asked
        // BEFORE the bed sample, because most of a meander's bbox is dry and
        // the index rejects it for the cost of nine Map lookups.
        const hit = sampleProfileAt(item.profile, item.energy, item.spine, item.index, x, z);
        if (!hit) continue;                    // no segment within reach: dry
        const signed = drawnHalfW(lineWidth) - hit.distanceM;
        const amount = clamp(0.5 + signed / Math.max(0.01, antialias * 2), 0, 1);
        if (amount <= 0.005) continue;
        // ── A RIVER SITS IN ITS VALLEY, NOT OVER IT ──
        // The monotone-fitted profile smooths terrain dips away, so its level
        // can ride more than a metre above the ground it crosses — reported
        // from the cab at the Senqu as a floating surface. The ceiling is the
        // bed at the CENTRELINE FOOT plus the nominal depth: sampled at the
        // texel instead, each wet pixel hovers over its own bank and the
        // cross-section humps upward at the edges; sampled at the thalweg,
        // the surface stays flat across the section and follows the valley
        // longitudinally. Where the fit says higher, the bed wins.
        // The ceiling on the fitted level. The carved invert is the true bed
        // where there is one — and it is a grid lookup, not a heightfield
        // walk, so it can be afforded per texel where sampleHeight could not
        // (that cost +5ms a build, measured, and seated every pixel on its
        // own dip).
        // THE RASTER HERE, THE INVERT AT THE STATIONS. Asked per wet texel the
        // channel lookup is a grid walk each time and cost 7ms a build,
        // measured; the profile above already carries the invert, so this
        // ceiling has nothing left to correct where there is a carve.
        const bedFoot = sampleElevation(input.elevation, input.bounds, hit.px, hit.pz);
        const levelM = Number.isFinite(bedFoot)
          ? Math.min(hit.levelM, bedFoot + FLOWING_NOMINAL_DEPTH_M) : hit.levelM;
        const halfW = Math.max(0.5, lineWidth * 0.5);
        paint(ix, iz, amount, item.body, levelM, [hit.fx, hit.fz], hit.energy, [
          (item.s0 ?? 0) + hit.s,
          clamp((hit.side * hit.distanceM) / halfW, -1.25, 1.25),
          hit.curvature,
          halfW,
        ], undefined, item.drops.length ? sampleRiverDrop(item.drops, hit.s, levelM) : undefined);
        continue;
      }
      let amount: number;
      if (item.feature.geometry.type === 'area') {
        amount = (areaCov as Float32Array)[(iz - iz0) * covW + (ix - ix0)];
      } else {
        const signed = drawnHalfW(lineWidth)
          - nearestSegment(x, z, item.feature.geometry.points).distanceM;
        amount = clamp(0.5 + signed / Math.max(0.01, antialias * 2), 0, 1);
      }
      // Dry texels pay nothing: the nearest-profile search below was run for
      // every texel of a lake's bounding box, water or not.
      if (amount <= 0.005) continue;
      const bed = sampleElevation(input.elevation, input.bounds, x, z);
      let localFlow: readonly [number, number] = profileFlow(item.profile, item.body, x, z);
      let localEnergy = item.profile && item.energy
        ? energyAt(item.profile, item.energy, x, z) : undefined;
      let river: readonly [number, number, number, number] | undefined;
      let fall: [number, number, number, number] | undefined;
      // A flowing AREA with no profile of its own — an OSM riverbank, or a
      // cover-raster reach — used to take bed + nominal depth per texel, a
      // surface that copies every DEM wrinkle. Where a centreline profile is
      // within reach it takes THAT level instead, graded and monotone, the
      // same surface the centreline body draws, capped at the thalweg bed
      // plus nominal depth exactly as the line branch above does.
      let levelM: number | undefined;

      // Riverbank/natural-water polygons describe the visible width, while a
      // neighbouring waterway line describes its motion. Project polygon
      // texels into the nearest centreline chart instead of treating a broad
      // river as a directionless, synchronously heaving lake.
      if (FLOWING.has(item.feature.kind) && !item.spine
        && item.feature.geometry.type === 'area') {
        const tSearch = performance.now();
        P.searchTexels++;
        const bk = ((iz - iz0) >> 1) * bw + ((ix - ix0) >> 1);
        let hb = blockHits[bk];
        if (hb === undefined) {
          let best: ProfileHit | null = null;
          let bestItem: typeof resolved[number] | undefined;
          for (const { c: candidate, b } of cands) {
            if (x < b.minX - SEARCH_REACH || x > b.maxX + SEARCH_REACH || z < b.minZ - SEARCH_REACH || z > b.maxZ + SEARCH_REACH) continue;
            const hit = sampleProfileAt(
              candidate.profile as Float32Array, candidate.energy, candidate.spine as ProfileSpine,
              candidate.index as ProfileIndex, x, z, 3,
            );
            if (hit && hit.distanceM < (best?.distanceM ?? SEARCH_REACH)) {
              best = hit;
              bestItem = candidate;
            }
          }
          if (best && bestItem) {
            const bedFoot = sampleElevation(input.elevation, input.bounds, best.px, best.pz);
            hb = {
              px: best.px, pz: best.pz, fx: best.fx, fz: best.fz,
              grade: best.grade, drops: bestItem.drops, s0: bestItem.s0 ?? 0,
              energy: best.energy, s: (bestItem.s0 ?? 0) + best.s, curvature: best.curvature,
              centreHalfW: bestItem.feature.geometry.type === 'line' ? bestItem.feature.geometry.widthM * 0.5 : 4,
              levelM: Number.isFinite(bedFoot) ? Math.min(best.levelM, bedFoot + FLOWING_NOMINAL_DEPTH_M) : best.levelM,
            };
          } else hb = null;
          blockHits[bk] = hb;
        }
        if (hb) {
          const cross = hb.fx * (z - hb.pz) - hb.fz * (x - hb.px);
          const dist = Math.abs(cross);
          const chartHalfW = Math.max(hb.centreHalfW, dist / 1.2, 1);
          localFlow = [hb.fx, hb.fz];
          localEnergy = hb.energy;
          river = [
            hb.s + (x - hb.px) * hb.fx + (z - hb.pz) * hb.fz,
            clamp(((cross >= 0 ? 1 : -1) * dist) / chartHalfW, -1.25, 1.25),
            hb.curvature,
            chartHalfW,
          ];
          // Reuse the segment search, not the block's constant height. A
          // 2x2 flat step intersects the line mesh on a steep waterfall.
          const ds = (x - hb.px) * hb.fx + (z - hb.pz) * hb.fz;
          levelM = hb.levelM + ds * hb.grade;
          fall = hb.drops.length ? sampleRiverDrop(hb.drops, river[0] - hb.s0, levelM) : undefined;
        }
        P.search += performance.now() - tSearch;
      }
      paint(
        ix, iz, amount, item.body,
        levelM ?? bodyLevel(item.body, item.profile, x, z, bed),
        localFlow, localEnergy, river, bed, fall,
      );
      P.paints++;
    }
    P.texels += performance.now() - tTexels;
  }
  tMark = performance.now();

  // ── A TILE WITH NO WATER IN IT PAYS FOR NONE ──
  //
  // Everything from here to the packing loop is a FULL-GRID pass — the
  // source map, the extension fill, the 3x3 majority, the occluder mask, the
  // extent scan, two distance transforms and the pack — so a build is priced
  // by the TILE and not by the water in it. Measured on the Yosemite capture
  // (devtools/hydro-phases.mjs), where a dump from the seat put hydroBuild at
  // 94.6 ms a build and 30% of every slow frame: 296 of 38,309 texels wet,
  // 0.77% — and FIFTEEN OF TWENTY-TWO BUILDS HAD NO WATER AT ALL. Those
  // fifteen ran eleven passes over a 258-square grid to produce a constant.
  //
  // The constant is exact, not an approximation, and each channel is the
  // value the skipped code provably writes with `coverage` empty:
  //  · sources are all zero, so `nearestSourceMap` answers -1 everywhere and
  //    the fill writes nothing;
  //  · the majority pass tests `kind[i]`, which only a paint sets;
  //  · an occluder's loop `continue`s on every texel (coverage <= .005);
  //  · `waterLevels` is empty, so `elevationBaseM` is the ocean level and
  //    `waterBounds` is undefined — the mesh covers nothing;
  //  · `wet` is all zero, so the signed shore distance is -toWet everywhere
  //    and clamps to exactly -shoreDistanceLimitM;
  //  · level, depth, flow, fetch, scale, kind, seed, turbidity and flags are
  //    all still zero-initialised, so dynamics and material are zero and the
  //    geometry's level channel is 0 - elevationBaseM.
  //
  // The ground channel is NOT skipped: it is the terrain under the tile, it
  // is true whether or not there is water on it, and `shore-contour` reads it
  // through `field.ground`. It is 10% of a dry build and the honest 10%.
  //
  // THE RETENTION IS UPSTREAM OF THIS FLAG, which is what makes it safe: a
  // texel the new coverage could not answer has already taken the previous
  // field's water by the time `anyCoverage` is read, so "dry" means dry after
  // last-known-good and not merely "nothing arrived this time".
  // WATERLESS IS THE TILE; DRY IS WHAT THIS BUILD DID ABOUT IT. They are kept
  // apart so the `?hydrodry=0` control classifies the SAME population: with
  // the short-circuit off every waterless tile still runs the long way, and
  // the ledger has to say that it was a waterless tile that did so, or the
  // A/B compares a mean over all builds against a mean over seven.
  const waterless = !anyCoverage;
  const dry = waterless && options.dryShortCircuit;
  if (!dry) {
  // Extend body parameters outside the visible mask. The water mesh is much
  // coarser than this field, so its dry vertices still need the elevation of
  // the small masked body that may lie between them.
  const sources = new Uint8Array(count);
  for (let i = 0; i < count; i++) sources[i] = coverage[i] > 0.005 && kind[i] !== 0 ? 1 : 0;
  const nearest = nearestSourceMap(sources, width, height);
  lap('sources');
  for (let i = 0; i < count; i++) {
    if (sources[i] || nearest[i] < 0) continue;
    const n = nearest[i];
    if (waterfalls) waterfalls.set(waterfalls.subarray(n * 4, n * 4 + 4), i * 4);
    level[i] = level[n]; depth[i] = depth[n];
    flowX[i] = flowX[n]; flowZ[i] = flowZ[n];
    fetch[i] = fetch[n]; scale[i] = scale[n];
    kind[i] = kind[n]; seed[i] = seed[n]; turbidity[i] = turbidity[n]; flags[i] = flags[n];
    // The mesh vertex just outside a river's coverage still displaces and
    // still needs a sane s under it — same argument as the level above.
    if (structure) {
      structure[i * 4] = structure[n * 4];
      structure[i * 4 + 1] = structure[n * 4 + 1];
      structure[i * 4 + 2] = structure[n * 4 + 2];
      structure[i * 4 + 3] = structure[n * 4 + 3];
    }
  }
  lap('fill');

  // ── A RIVER FROM THE COVER RASTER IS ONE RIVER ──
  //
  // WorldCover's class 80 arrives as 22 m pixels traced into polygons, and at
  // the field's 18.75 m texel that outline is a staircase with pinholes: the
  // Senqu at a hundred metres wide came out as disjoint blobs — coverage 0.6
  // in its own interior, every wet texel one cell from a dry one — drawn from
  // above as separate pale patches with the terrain's own water paint
  // showing between them, and every one of them ankle-deep because the
  // shore was always a texel away. One 3×3 majority pass over flowing
  // texels closes the pinholes and rounds the staircase: a texel whose
  // neighbourhood is mostly wet is wet. Standing water keeps its outline;
  // a pond's edge is its edge.
  {
    const src = coverage.slice();
    for (let iz = 1; iz < height - 1; iz++) for (let ix = 1; ix < width - 1; ix++) {
      const i = iz * width + ix;
      if (kind[i] < HYDRO_KIND_ID.river || kind[i] > HYDRO_KIND_ID.canal) continue;
      let sum = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const j = i + dz * width + dx;
        sum += kind[j] === kind[i] || src[j] < 0.005 ? src[j] : 0;
      }
      const mean = sum / 9;
      if (mean >= 0.5 && src[i] < mean) coverage[i] = Math.min(1, Math.max(coverage[i], mean * 1.15));
    }
  }
  lap('majority');
  // ── STRUCTURES OWN SURFACE VISIBILITY ──
  //
  // A culvert carries water below the road and a causeway blocks it with fill;
  // neither has a visible free surface through the carriageway. Applying the
  // mask after continuity repair and last-known-good retention is essential:
  // either pass would otherwise paint the deliberately hidden strip back in.
  //
  // The rectangle is road-aligned. Its short axis is the carriageway width;
  // its long axis spans the channel and banks. Coverage fades over one field
  // texel so the conduit mouths meet open water without a raster-hard cut.
  for (const occluder of input.surfaceOccluders ?? []) {
    const length = Math.hypot(occluder.roadTangent[0], occluder.roadTangent[1]) || 1;
    const tx = occluder.roadTangent[0] / length;
    const tz = occluder.roadTangent[1] / length;
    const nx = -tz, nz = tx;
    const halfLength = Math.max(.5, occluder.halfLengthM);
    const halfWidth = Math.max(.5, occluder.roadHalfWidthM);
    const feather = Math.max(.25, Math.max(Math.abs(pixelX), Math.abs(pixelZ)) * .75);
    for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
      const i = iz * width + ix;
      if (coverage[i] <= .005) continue;
      const dx = xAt(ix) - occluder.x, dz = zAt(iz) - occluder.z;
      const along = Math.abs(dx * tx + dz * tz) - halfLength;
      const across = Math.abs(dx * nx + dz * nz) - halfWidth;
      const outside = Math.max(along, across);
      const keep = clamp(.5 + outside / feather, 0, 1);
      coverage[i] *= keep;
    }
  }
  lap('occlude');
  }
  const wet = new Uint8Array(count);
  const waterLevels: number[] = [];
  let hasWater = false;
  if (!dry) {
    let cov = 0;
    for (let i = 0; i < count; i++) {
      wet[i] = coverage[i] >= 0.5 ? 1 : 0;
      if (coverage[i] > 0.005) { hasWater = true; waterLevels.push(level[i]); cov++; }
    }
    P.coveredTexels += cov;
  }
  const elevationBaseM = quantile(waterLevels, 0.5) ?? options.oceanLevelM;
  // THE RECT THE MESH ONLY NEEDS TO COVER. Measured on the coverage that will
  // actually survive the fragment cut, then padded by a texel so the shore
  // fade and the wave displacement have somewhere to go.
  let waterBounds: WorldBounds | undefined;
  if (!dry) {
    let wx0 = Infinity, wz0 = Infinity, wx1 = -Infinity, wz1 = -Infinity;
    for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
      if (coverage[iz * width + ix] <= 0.005) continue;
      const x = xAt(ix), z = zAt(iz);
      if (x < wx0) wx0 = x;
      if (x > wx1) wx1 = x;
      if (z < wz0) wz0 = z;
      if (z > wz1) wz1 = z;
    }
    if (Number.isFinite(wx0)) {
      // CLIPPED TO THE TILE. Gutter texels carry coverage now, and a mesh
      // that followed them past the edge would overlap its neighbour's mesh
      // in a strip of coplanar water — a z-fight at every join. Each tile
      // draws exactly to its boundary and no further.
      waterBounds = {
        minX: Math.max(wx0 - pixelX, input.bounds.minX),
        minZ: Math.max(wz0 - pixelZ, input.bounds.minZ),
        maxX: Math.min(wx1 + pixelX, input.bounds.maxX),
        maxZ: Math.min(wz1 + pixelZ, input.bounds.maxZ),
      };
    }
  }
  lap('extent');
  // A dry grid's two transforms are constants — every texel is dry, so `toDry`
  // is zero everywhere and `toWet` never finds a target — and the pack below
  // reads neither on that path.
  const toDry = dry ? null : distanceTransform(wet, width, height, 0);
  const toWet = dry ? null : distanceTransform(wet, width, height, 1);
  lap('shore');
  const geometry = new Float32Array(count * 4);
  const dynamics = new Float32Array(count * 4);
  const material = new Uint8Array(count * 4);
  const ground = new Float32Array(count);
  for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
    const sampled = sampleElevation(input.elevation, input.bounds, xAt(ix), zAt(iz));
    ground[iz * width + ix] = Number.isFinite(sampled)
      ? sampled - elevationBaseM
      : 0;
  }
  lap('ground');
  if (dry) {
    // The whole field, written without a loop over its own arithmetic: a dry
    // texel's shore distance is the clamp (it is further from water than the
    // limit can express, in a grid that holds none) and its level channel is
    // the datum's own negation. Everything else is the zero the arrays were
    // born with, which is why only two of the twelve channels are touched.
    const shoreDry = -options.shoreDistanceLimitM;
    const levelDry = -elevationBaseM;
    for (let i = 0; i < count; i++) {
      geometry[i * 4 + 1] = shoreDry;
      geometry[i * 4 + 2] = levelDry;
    }
  } else for (let i = 0; i < count; i++) {
    const signedCells = wet[i] ? toDry![i] : -toWet![i];
    geometry[i * 4] = coverage[i];
    geometry[i * 4 + 1] = clamp(signedCells * pixelM, -options.shoreDistanceLimitM, options.shoreDistanceLimitM);
    geometry[i * 4 + 2] = level[i] - elevationBaseM;
    // ── A WIDE RIVER IS DEEP IN THE MIDDLE ──
    //
    // Flowing depth is level minus ground, and the DEM does not resolve a
    // channel: the Senqu at a hundred metres wide came out 8 to 40 cm deep
    // from bank to bank, which the shader honestly drew as a hundred metres
    // of shallow rapid — a white sheet from above, a mudflat from the seat.
    // Nothing in the data says how deep a river is, but its width does: a
    // channel deepens with distance from its own shore, about 8 cm a metre,
    // to four metres. Standing water keeps the basin the DEM gives it.
    const shoreM = geometry[i * 4 + 1];
    const flowingKind = kind[i] >= HYDRO_KIND_ID.river && kind[i] <= HYDRO_KIND_ID.canal;
    geometry[i * 4 + 3] = flowingKind && shoreM > 0 ? Math.max(depth[i], Math.min(4, shoreM * 0.08)) : depth[i];
    dynamics[i * 4] = flowX[i];
    dynamics[i * 4 + 1] = flowZ[i];
    dynamics[i * 4 + 2] = fetch[i];
    dynamics[i * 4 + 3] = scale[i];
    material[i * 4] = kind[i];
    material[i * 4 + 1] = seed[i];
    material[i * 4 + 2] = turbidity[i];
    material[i * 4 + 3] = flags[i];
  }

  lap('pack');
  // ── THE COAST FIELD ── only where the tile holds sea or lagoon; the swell
  // it is solved for is the shader's own for the body's fetch.
  let coast: Float32Array<ArrayBuffer> | undefined;
  if (options.coastField) {
    const coastal = new Uint8Array(count);
    // The MEDIUM is every standing texel, whatever body owns it — see the
    // coast field's own note. A channel is excluded: a river is not the sea's
    // road, and its banks bound the swell like any other shore.
    const standing = new Uint8Array(count);
    let any = false, fetchMax = 0;
    for (let i = 0; i < count; i++) {
      if (!wet[i]) continue;
      const k = kind[i];
      if (k < HYDRO_KIND_ID.river || k > HYDRO_KIND_ID.canal) standing[i] = 1;
      if (k !== HYDRO_KIND_ID.ocean && k !== HYDRO_KIND_ID.lagoon) continue;
      coastal[i] = 1; any = true;
      if (fetch[i] > fetchMax) fetchMax = fetch[i];
    }
    if (any) {
      coast = solveCoastField({
        // `any` needs a wet ocean texel, which a dry grid cannot have, so the
        // transform is non-null on every path that reaches here.
        width, height, pixelM, wet: standing, coastal, interior: oceanInterior, depth, toDry: toDry!,
        swellWavelengthM: swellWavelengthM(fetchMax),
      }).data;
    }
  }
  lap('coast');
  { const d = performance.now() - T0;
    P.builds++; P.total += d; P.texelCount += count; if (d > P.max) P.max = d;
    if (waterless) { P.dryBuilds++; P.dryMs += d; P.dryTexels += count; }
    else { P.wetBuilds++; P.wetMs += d; P.wetTexels += count; } }
  return {
    key: input.key,
    revision: input.revision,
    bounds: input.bounds,
    resolution,
    gutter,
    width,
    height,
    elevationBaseM,
    ground,
    geometry,
    dynamics,
    material,
    structure: structure ?? undefined,
    waterfalls,
    hasWater,
    waterBounds,
    coast,
    bodyIds: [...bodyIds],
  };
}
