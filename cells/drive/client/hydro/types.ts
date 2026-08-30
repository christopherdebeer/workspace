/**
 * Source-independent hydrology contracts.
 *
 * Coordinates are projected world metres (x east, z south in drive). CPU
 * coordinates remain JavaScript doubles. Elevations are absolute metres in
 * one declared vertical datum; negative elevations are valid and are never
 * implicitly clamped to the ocean datum.
 */

export type TileKey = string;
export type HydroSource = 'osm' | 'landcover' | 'authored';

export interface WorldBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Row-major grid. Row zero maps to bounds.minZ, column zero to bounds.minX. */
export interface ElevationGrid {
  width: number;
  height: number;
  data: Float32Array;
  noData?: number;
  verticalDatum?: string;
}

/** Normalized 0..255 coverage, independent of the source's class encoding. */
export interface CoverageGrid {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * Missing is deliberately not the same answer as known non-ocean.
 *
 * `bounds`, when present, is the world span the grid actually covers —
 * normally the tile padded by the field gutter, so the distance transform
 * can see a shore that lies just past the tile edge instead of clamping at
 * it. Without it the grid is mapped across the tile bounds, as before.
 */
export type OceanCoverage =
  | { status: 'ready'; grid: CoverageGrid; bounds?: WorldBounds }
  | { status: 'unavailable' };

export type HydroKind =
  | 'ocean'
  | 'lagoon'
  | 'lake'
  | 'pond'
  | 'reservoir'
  | 'basin'
  | 'river'
  | 'stream'
  | 'canal'
  | 'wetland';

/** Packed x,z pairs. The final pair need not repeat the first for a ring. */
export type PackedXZ = Float64Array;

export interface HydroPolygon {
  outer: PackedXZ;
  holes: readonly PackedXZ[];
}

export type HydroGeometry =
  | { type: 'area'; polygons: readonly HydroPolygon[] }
  | { type: 'line'; points: PackedXZ; widthM: number };

/** Raw OSM tags have already been interpreted before this boundary. */
export interface HydroFeature {
  /** Stable across vector-tile fragments, normally `osm:<way/relation id>`. */
  id: string;
  source: HydroSource;
  kind: HydroKind;
  geometry: HydroGeometry;
  taggedLevelM?: number;
  intermittent: boolean;
  tidal: boolean;
  /** Optional authored overrides; otherwise the registry derives them. */
  roughness?: number;
  turbidity?: number;
}

export interface HydroTileInput {
  key: TileKey;
  /** Monotonic for this key. Stale asynchronous builds are discarded. */
  revision: number;
  bounds: WorldBounds;
  elevation: ElevationGrid;
  features: readonly HydroFeature[];
  oceanCoverage: OceanCoverage;
}

export type HydroLevelModel =
  | { type: 'ocean'; elevationM: number }
  | { type: 'flat'; elevationM: number }
  /** Packed x,z,elevationM stations, ordered downstream. */
  | { type: 'profile'; stations: Float32Array };

export interface HydroBody {
  id: string;
  kind: HydroKind;
  level: HydroLevelModel;
  /** Unit vector in projected x,z, or [0,0] for standing water. */
  flow: readonly [number, number];
  /** Approximate open-water distance controlling wave scale. */
  fetchM: number;
  seed: number;
  roughness: number;
  turbidity: number;
  intermittent: boolean;
  tidal: boolean;
  version: number;
}

export interface HydroBodyObservation {
  tileKey: TileKey;
  id: string;
  kind: HydroKind;
  candidateLevelM?: number;
  taggedLevelM?: number;
  /** Local river profile, packed x,z,elevationM and ordered downstream. */
  profile?: Float32Array;
  flow: readonly [number, number];
  fetchM: number;
  roughness?: number;
  turbidity?: number;
  intermittent: boolean;
  tidal: boolean;
}

export interface ResolvedHydroFeature {
  feature: HydroFeature;
  body: HydroBody;
  /** A tile-local profile can be newer/more detailed than the registry body. */
  profile?: Float32Array;
}

/**
 * Logical GPU field layout. Packing is private to the hydro renderer.
 *
 * geometry RGBA = coverage, signed shore distance m, level delta m, depth m
 * dynamics RGBA = flow x, flow z, fetch m, wave scale
 * material RGBA8 = class id, stable seed, turbidity, flags
 */
export interface HydroTileField {
  key: TileKey;
  revision: number;
  bounds: WorldBounds;
  resolution: number;
  gutter: number;
  width: number;
  height: number;
  elevationBaseM: number;
  geometry: Float32Array;
  dynamics: Float32Array;
  material: Uint8Array;
  hasWater: boolean;
  /**
   * The world rect the water actually occupies, padded by a texel.
   *
   * A tile is 2.4km and a river is ten metres wide, so a mesh spanning
   * `bounds` rasterises the whole tile to show about two per cent water. Every
   * one of those fragments runs the water shader before its `discard`, and a
   * shader containing `discard` forfeits early-Z, so the ones buried under
   * terrain are shaded and then thrown away too. Absent when the tile has no
   * water at all.
   */
  waterBounds?: WorldBounds;
  bodyIds: readonly string[];
}

export interface HydroSample {
  kind: HydroKind;
  coverage: number;
  restingLevelM: number;
  shoreDistanceM: number;
  depthM: number;
  flow: readonly [number, number];
  fetchM: number;
  intermittent: boolean;
  tidal: boolean;
}

export interface HydroFrame {
  timeSeconds: number;
  /** Absolute projected/elevation origin represented by render-space zero. */
  worldOrigin: { x: number; y: number; z: number };
  wind: { x: number; z: number; speedMps: number };
  rain: number;
  sunDirection?: { x: number; y: number; z: number };
}

export type HydroDebugView = 'surface' | 'coverage' | 'shore' | 'depth' | 'flow' | 'class';

export interface HydroTuning {
  waveAmplitude: number;
  waveLength: number;
  rippleStrength: number;
  foamStrength: number;
  shoreFade: number;
}

export const DEFAULT_HYDRO_TUNING: HydroTuning = {
  waveAmplitude: 1,
  waveLength: 1,
  rippleStrength: 1,
  foamStrength: 1,
  shoreFade: 1,
};

export interface HydroBuildOptions {
  fieldResolution: number;
  gutter: number;
  oceanLevelM: number;
  shoreDistanceLimitM: number;
  minimumDepthM: number;
}

export const DEFAULT_HYDRO_BUILD: HydroBuildOptions = {
  fieldResolution: 128,
  // Six texels (~112m at a 2.4km tile) rather than one. The gutter exists so
  // per-tile passes — above all the shore-distance transform, which the
  // nearshore wave PHASE now reads — can see past the tile edge. One texel of
  // margin put a phase seam within 180m of every tile boundary a coast
  // crossed; six covers most of the shore-distance limit.
  gutter: 6,
  oceanLevelM: 0,
  shoreDistanceLimitM: 180,
  minimumDepthM: 0.08,
};

export const HYDRO_KIND_ID: Record<HydroKind, number> = {
  ocean: 1,
  lagoon: 2,
  lake: 3,
  pond: 4,
  reservoir: 5,
  basin: 6,
  river: 7,
  stream: 8,
  canal: 9,
  wetland: 10,
};

export const HYDRO_ID_KIND: Record<number, HydroKind> = Object.fromEntries(
  Object.entries(HYDRO_KIND_ID).map(([kind, id]) => [id, kind]),
) as Record<number, HydroKind>;

export const HydroFlags = {
  Intermittent: 1,
  Tidal: 2,
  Flowing: 4,
} as const;
