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
  signedDistanceToArea,
} from './geometry';
import {
  DEFAULT_HYDRO_BUILD,
  HYDRO_KIND_ID,
  HydroFlags,
  type HydroBody,
  type HydroBodyObservation,
  type HydroBuildOptions,
  type HydroFeature,
  type HydroKind,
  type HydroTileField,
  type HydroTileInput,
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

function lineProfile(input: HydroTileInput, feature: HydroFeature): Float32Array | undefined {
  if (feature.geometry.type !== 'line') return undefined;
  const points = feature.geometry.points;
  const count = points.length >> 1;
  if (count < 2) return undefined;
  const heights = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    heights[i] = feature.taggedLevelM
      ?? sampleElevation(input.elevation, input.bounds, points[i * 2], points[i * 2 + 1]);
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
  const reverse = end > start;
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
      kind: feature.kind,
      candidateLevelM: profile ? quantile(Array.from(profile).filter((_, i) => i % 3 === 2), 0.5) : areaEvidence(input, feature),
      taggedLevelM: feature.taggedLevelM,
      profile,
      flow: flowFromProfile(profile),
      fetchM: fetchFor(feature),
      roughness: feature.roughness,
      turbidity: feature.turbidity,
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
const FLOWING_NOMINAL_DEPTH_M = 0.6;
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
    e[i] = clamp(Math.sqrt(slope / FULL_AT), 0, 1);
  }
  for (let pass = 0; pass < 2; pass++) {
    const c = e.slice();
    for (let i = 1; i < n - 1; i++) e[i] = (c[i - 1] + c[i] * 2 + c[i + 1]) * 0.25;
  }
  return e;
}

function energyAt(profile: Float32Array, energy: Float32Array, x: number, z: number): number {
  const hit = nearestSegment(x, z, profile, 3);
  if (hit.segment < 0) return energy[0] ?? 0;
  return energy[hit.segment] * (1 - hit.t) + (energy[hit.segment + 1] ?? energy[hit.segment]) * hit.t;
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
  const xAt = (ix: number): number => input.bounds.minX + ((ix - gutter) + 0.5) * pixelX;
  const zAt = (iz: number): number => input.bounds.minZ + ((iz - gutter) + 0.5) * pixelZ;

  const paint = (
    ix: number,
    iz: number,
    amount: number,
    body: HydroBody,
    levelM: number,
    localFlow: readonly [number, number],
    localEnergy?: number,
  ): void => {
    if (amount <= 0.005 || ix < 0 || iz < 0 || ix >= width || iz >= height) return;
    const i = iz * width + ix;
    const p = priority(body.kind);
    if (rank[i] > p || (rank[i] === p && coverage[i] > amount)) return;
    rank[i] = p;
    coverage[i] = Math.max(coverage[i], amount);
    level[i] = levelM;
    const ground = sampleElevation(input.elevation, input.bounds, xAt(ix), zAt(iz));
    depth[i] = Number.isFinite(ground) ? Math.max(options.minimumDepthM, levelM - ground) : options.minimumDepthM;
    flowX[i] = localFlow[0]; flowZ[i] = localFlow[1];
    fetch[i] = body.fetchM;
    // Flowing water's wave scale IS its reach energy — see profileEnergy.
    // Without a profile a flowing body stays calm rather than inheriting a
    // fetch-derived state it has no evidence for.
    scale[i] = localEnergy !== undefined ? localEnergy
      : FLOWING.has(body.kind) ? Math.min(0.15, waveScale(body.kind, body.fetchM, body.roughness))
      : waveScale(body.kind, body.fetchM, body.roughness);
    kind[i] = HYDRO_KIND_ID[body.kind];
    seed[i] = Math.round(clamp(body.seed, 0, 1) * 255);
    turbidity[i] = Math.round(clamp(body.turbidity, 0, 1) * 255);
    flags[i] = (body.intermittent ? HydroFlags.Intermittent : 0)
      | (body.tidal ? HydroFlags.Tidal : 0)
      | (FLOWING.has(body.kind) ? HydroFlags.Flowing : 0);
    bodyIds.add(body.id);
  };

  const ocean = registry.get('hydro:ocean');
  // Which texels the CURRENT coverage actually answered — ocean or dry. The
  // rest are unknown and keep the previous field's verdict below.
  const answered = new Uint8Array(count);
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
      const prevKind = previous.material[i * 4];
      coverage[i] = previous.geometry[i * 4];
      level[i] = previous.elevationBaseM + previous.geometry[i * 4 + 2];
      depth[i] = previous.geometry[i * 4 + 3];
      flowX[i] = previous.dynamics[i * 4]; flowZ[i] = previous.dynamics[i * 4 + 1];
      fetch[i] = previous.dynamics[i * 4 + 2]; scale[i] = previous.dynamics[i * 4 + 3];
      kind[i] = prevKind; seed[i] = previous.material[i * 4 + 1];
      turbidity[i] = previous.material[i * 4 + 2]; flags[i] = previous.material[i * 4 + 3];
      rank[i] = priority(ID_TO_KIND.get(prevKind) ?? 'ocean');
    }
  }

  const resolved: Array<ResolvedHydroFeature & { energy?: Float32Array }> = [];
  for (let index = 0; index < input.features.length; index++) {
    const feature = input.features[index];
    const body = registry.get(feature.id);
    if (!body) continue;
    // This fragment's OWN profile — see the note on the profiles map.
    const profile = analysis.profiles.get(`${feature.id}#${index}`);
    resolved.push({ feature, body, profile,
      energy: profile && FLOWING.has(feature.kind) ? profileEnergy(profile) : undefined });
  }
  for (const item of resolved) {
    const fb = featureBounds(item.feature);
    const ix0 = clamp(Math.floor((fb.minX - input.bounds.minX) / pixelX) + gutter - 1, 0, width - 1);
    const ix1 = clamp(Math.ceil((fb.maxX - input.bounds.minX) / pixelX) + gutter + 1, 0, width - 1);
    const iz0 = clamp(Math.floor((fb.minZ - input.bounds.minZ) / pixelZ) + gutter - 1, 0, height - 1);
    const iz1 = clamp(Math.ceil((fb.maxZ - input.bounds.minZ) / pixelZ) + gutter + 1, 0, height - 1);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const x = xAt(ix), z = zAt(iz);
      let signed = -Infinity;
      if (item.feature.geometry.type === 'area') {
        signed = signedDistanceToArea(x, z, item.feature.geometry);
      } else {
        signed = item.feature.geometry.widthM * 0.5
          - nearestSegment(x, z, item.feature.geometry.points).distanceM;
      }
      const amount = clamp(0.5 + signed / Math.max(0.01, antialias * 2), 0, 1);
      const localFlow = profileFlow(item.profile, item.body, x, z);
      // The bed under THIS texel, so a river given no profile can descend with
      // its own valley rather than lie flat across it.
      const bed = sampleElevation(input.elevation, input.bounds, x, z);
      const localEnergy = item.profile && item.energy
        ? energyAt(item.profile, item.energy, x, z) : undefined;
      paint(ix, iz, amount, item.body, bodyLevel(item.body, item.profile, x, z, bed), localFlow, localEnergy);
    }
  }

  // Extend body parameters outside the visible mask. The water mesh is much
  // coarser than this field, so its dry vertices still need the elevation of
  // the small masked body that may lie between them.
  const sources = new Uint8Array(count);
  for (let i = 0; i < count; i++) sources[i] = coverage[i] > 0.005 && kind[i] !== 0 ? 1 : 0;
  const nearest = nearestSourceMap(sources, width, height);
  for (let i = 0; i < count; i++) {
    if (sources[i] || nearest[i] < 0) continue;
    const n = nearest[i];
    level[i] = level[n]; depth[i] = depth[n];
    flowX[i] = flowX[n]; flowZ[i] = flowZ[n];
    fetch[i] = fetch[n]; scale[i] = scale[n];
    kind[i] = kind[n]; seed[i] = seed[n]; turbidity[i] = turbidity[n]; flags[i] = flags[n];
  }

  const wet = new Uint8Array(count);
  const waterLevels: number[] = [];
  let hasWater = false;
  for (let i = 0; i < count; i++) {
    wet[i] = coverage[i] >= 0.5 ? 1 : 0;
    if (coverage[i] > 0.005) { hasWater = true; waterLevels.push(level[i]); }
  }
  const elevationBaseM = quantile(waterLevels, 0.5) ?? options.oceanLevelM;
  // THE RECT THE MESH ONLY NEEDS TO COVER. Measured on the coverage that will
  // actually survive the fragment cut, then padded by a texel so the shore
  // fade and the wave displacement have somewhere to go.
  let waterBounds: WorldBounds | undefined;
  {
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
  const toDry = distanceTransform(wet, width, height, 0);
  const toWet = distanceTransform(wet, width, height, 1);
  const geometry = new Float32Array(count * 4);
  const dynamics = new Float32Array(count * 4);
  const material = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    const signedCells = wet[i] ? toDry[i] : -toWet[i];
    geometry[i * 4] = coverage[i];
    geometry[i * 4 + 1] = clamp(signedCells * pixelM, -options.shoreDistanceLimitM, options.shoreDistanceLimitM);
    geometry[i * 4 + 2] = level[i] - elevationBaseM;
    geometry[i * 4 + 3] = depth[i];
    dynamics[i * 4] = flowX[i];
    dynamics[i * 4 + 1] = flowZ[i];
    dynamics[i * 4 + 2] = fetch[i];
    dynamics[i * 4 + 3] = scale[i];
    material[i * 4] = kind[i];
    material[i * 4 + 1] = seed[i];
    material[i * 4 + 2] = turbidity[i];
    material[i * 4 + 3] = flags[i];
  }

  return {
    key: input.key,
    revision: input.revision,
    bounds: input.bounds,
    resolution,
    gutter,
    width,
    height,
    elevationBaseM,
    geometry,
    dynamics,
    material,
    hasWater,
    waterBounds,
    bodyIds: [...bodyIds],
  };
}
