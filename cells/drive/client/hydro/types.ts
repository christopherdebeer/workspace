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
 *
 * ── THE GRID IS TRI-STATE ──
 * 255 is confirmed ocean, ~128 is confirmed dry, 0 is NOT YET KNOWN — a
 * pixel no loaded cover tile owns. The pipeline used to collapse unknown
 * into dry, and a later arrival then "corrected" it: photographed as a
 * straight-edged rectangle of missing sea that healed a minute later, and
 * as resolved water vanishing when a partial revision replaced the field.
 * Unknown pixels keep the PREVIOUS field's answer (see buildHydroTile), so
 * an incomplete revision can only add knowledge, never destroy it.
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

/** Physical material visible through shallow water and exposed at its bed. */
export type HydroBedMaterial = 'silt' | 'sand' | 'gravel' | 'pebble' | 'rock';
/** Material exposed along the damp transition between terrain and water. */
export type HydroBankMaterial = 'soil' | 'mud' | 'gravel' | 'rock';

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
  bedMaterial?: HydroBedMaterial;
  bankMaterial?: HydroBankMaterial;
}

export interface HydroTileInput {
  /**
   * THE BED THE TERRAIN WAS ACTUALLY CARVED TO, when the caller has one.
   *
   * A watercourse is solved twice in this world: the terrain kernel digs a
   * channel to a monotone invert (`carveChannels`), and the hydro build fits
   * its own profile to the elevation raster. Two answers to "where is the
   * bed" that nobody reconciled, and in a gorge the raster's answer is the
   * BANK — measured above Obergoms as a surface standing 4.35m over the
   * drawn valley floor with the field's own depth channel reading 0.32m.
   * Handed the carved invert, the profile becomes the channel the player is
   * driving past, and the water sits in it by construction. Absolute metres
   * at a point inside a channel; NaN anywhere else, where the raster remains
   * the honest fallback.
   */
  channelInvertM?: (x: number, z: number) => number;
  key: TileKey;
  /** Monotonic for this key. Stale asynchronous builds are discarded. */
  revision: number;
  bounds: WorldBounds;
  elevation: ElevationGrid;
  features: readonly HydroFeature[];
  oceanCoverage: OceanCoverage;
  /**
   * Explicit structures that suppress the visible free surface while water
   * continues below (culvert) or is blocked by fill (causeway).
   */
  surfaceOccluders?: readonly HydroSurfaceOccluder[];
}

export interface HydroSurfaceOccluder {
  kind: 'culvert' | 'causeway';
  x: number;
  z: number;
  /** Unit direction along the road deck/fill. */
  roadTangent: readonly [number, number];
  roadHalfWidthM: number;
  /** Reach along the road needed to span the channel and its banks. */
  halfLengthM: number;
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
  bedMaterial: HydroBedMaterial;
  bankMaterial: HydroBankMaterial;
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
  bedMaterial?: HydroBedMaterial;
  bankMaterial?: HydroBankMaterial;
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
 * material RGBA8 = class id, stable seed, turbidity, flags + bed material
 * structure RGBA = river s (m downstream), river n (-1..1 across),
 *                  signed curvature (1/m), channel half-width (m)
 */
export interface HydroTileField {
  /** Raster candidate outcomes; not a measurement of final triangle contact. */
  shoreContact?: { candidates: number; extended: number; noJoin: number;
    tooHigh: number; protected: number; missingGround: number; maxExtensionM: number };
  key: TileKey;
  revision: number;
  bounds: WorldBounds;
  resolution: number;
  gutter: number;
  width: number;
  height: number;
  elevationBaseM: number;
  /** Terrain elevation at every field texel, stored relative to
   * `elevationBaseM`. Coverage contour generation consumes this exact array so
   * shoreline geometry and water classification cannot drift onto separate
   * terrain samples. */
  ground: Float32Array<ArrayBuffer>;
  geometry: Float32Array<ArrayBuffer>;
  dynamics: Float32Array<ArrayBuffer>;
  material: Uint8Array<ArrayBuffer>;
  /**
   * ── RIVER SPACE, PER TEXEL ──
   *
   * R = s, cumulative metres DOWNSTREAM along the body (continuous across
   * tile fragments — see the registry's river spans). G = n, signed
   * cross-channel position in half-widths, -1 at one bank, +1 at the other.
   * B = signed centreline curvature (1/m). A = channel half-width (m).
   *
   * This exists because river motion parameterised by world position
   * projected onto a per-texel flow direction FOLDS ITS PHASE at every bend
   * — the same fingerprint defect the sea shader was rewritten to remove.
   * Distance along the river is continuous by construction, so phases built
   * on it turn with the channel instead of folding.
   *
   * Allocated only when the tile holds flowing water, so an ocean tile pays
   * neither the memory nor the texture. Float32, deliberately not half:
   * s spans tens of kilometres and half-floats lose metre precision past
   * 2048, which returns as phase jitter exactly where a long river needs
   * the coordinate most.
   */
  structure?: Float32Array<ArrayBuffer>;
  /** Connected drop: sheet strength, fallen fraction, impact/tail, drop metres. */
  waterfalls?: Float32Array<ArrayBuffer>;
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
  /**
   * ── THE COAST FIELD ── travel time from the waterline in deep-water
   * metres (R), the seaward direction (G, B) and exposure (A), per texel,
   * for tiles with sea or lagoon in them — see coast-field.ts. The shader
   * phases the nearshore crests on R instead of the shore distance, which
   * puts refraction into the same continuous coordinate, and damps the
   * shore wave, breakers and chop by A. Absent when the build was asked not
   * to (`coastField: false`, `?coast=0`) or the tile has no coast.
   */
  coast?: Float32Array<ArrayBuffer>;
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
  bedMaterial: HydroBedMaterial;
  bankMaterial: HydroBankMaterial;
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
  /** Optional linear scene colours. They keep hydro's API stable while letting
   * the surface reflect the actual environment rather than guessing a separate
   * day/night palette. Fog/horizon colour remains the shader-side fallback. */
  skyColour?: { r: number; g: number; b: number };
  terrainColour?: { r: number; g: number; b: number };
  /** THE LIGHT THE GROUND GETS, as a ratio to the light the water's palette
   *  was drawn under (a clear noon in the same biome): the sun on a flat
   *  surface plus the sky fill plus the moon, per channel. 1 is that noon;
   *  haze, a low sun and night take it down exactly as they take the ground
   *  down. Omitted, the water keeps a daylight curve of its own. */
  sceneLight?: { r: number; g: number; b: number };
  /** The sky straight up, for what a chart sees reflected in flat water;
   *  `skyColour` is the horizon side the seat sees. */
  zenithColour?: { r: number; g: number; b: number };
  /** WHAT A UNIT OF GROUND ALBEDO DRAWS AS, at the reference noon: the
   *  irradiance over π, per channel — the Lambert ground's own gain. The
   *  water's palette constants are lit colours at that noon; the ground's
   *  colour arrives as albedo. Multiplying the albedo by this puts the two
   *  on one scale, so a bank seen through a shallow is the bank beside it
   *  and not three times brighter. */
  groundGain?: { r: number; g: number; b: number };
  /** The moon as the water sees it: where it is (unit, toward the moon) and
   *  its light (linear colour × a 0..1 strength, 0 when it is down, new or
   *  clouded out). Only the look model's glitter path reads it. */
  moon?: { x: number; y: number; z: number; r: number; g: number; b: number };
  /** The vehicle, when it is IN the water: absolute x/z, velocity in m/s and
   *  how deep it is wading. Omit (or wadeM 0) and the surface ignores it —
   *  the water only answers a hull that is actually displacing it. */
  rig?: {
    x: number;
    z: number;
    vx: number;
    vz: number;
    wadeM: number;
    /** Canonical vehicle-water history may provide the already resolved wake
     *  response. Omit for labs and legacy callers that still derive it from
     *  depth and speed. */
    wakeStrength?: number;
  };
  /** THE GROUND'S OWN COLOUR, LOCALLY. `terrainColour` is one colour for the
   *  whole frame — the ground under the truck — and every shallow, bed and
   *  damp bank in view took it, so a river forty metres off wore the road's
   *  tint. This is the sward's colour field: the terrain palette per 3 m
   *  texel over a square around the truck, already built for the grass.
   *  `widthM` 0 means there is no field yet and the frame colour stands. */
  terrainField?: { texture: object | null; originX: number; originZ: number; widthM: number };
}

export type HydroDebugView = 'surface' | 'coverage' | 'shore' | 'depth' | 'flow' | 'class' | 'coast';

export interface HydroTuning {
  waveAmplitude: number;
  waveLength: number;
  /** Horizontal trochoidal displacement of standing-water crests. */
  waveChop: number;
  rippleStrength: number;
  foamStrength: number;
  shoreFade: number;
  /** Visibility of sediment, pebble and cobble detail through clear shallows. */
  shallowBedStrength: number;
  /** Width/contrast of the wet gravel and shallow-water river transition. */
  riverEdgeStrength: number;
  /** Riffle facets, boil and rapid response, independently of calm ripples. */
  turbulenceStrength: number;
  /** Bend-driven circulating surface structure on the inside of turns. */
  eddyStrength: number;
  /** Optical loss through the water column, independent of suspended colour. */
  absorptionStrength: number;
  /** Milky/mineral suspended return, independent of surface reflection breakup. */
  scatteringStrength: number;
  /** Broadening and dimming of reflected sky structure. */
  surfaceRoughness: number;
  /** Optical model. 0 is the shipped look; 1 lets reflection carry the
   *  scene's own sky (full Fresnel, no second night dimming, a moon glint)
   *  and confines every water-only term to the water, so the first
   *  fragments at the waterline are the ground. `?hydrolook=` A/B. */
  lookModel: number;
}

export const DEFAULT_HYDRO_TUNING: HydroTuning = {
  waveAmplitude: 1,
  waveLength: 1,
  waveChop: 1,
  rippleStrength: 1,
  foamStrength: 1,
  shoreFade: 1,
  shallowBedStrength: 1,
  riverEdgeStrength: 1,
  turbulenceStrength: 1,
  eddyStrength: 1,
  absorptionStrength: 1,
  scatteringStrength: 1,
  surfaceRoughness: 1,
  lookModel: 0,
};

export interface HydroBuildOptions {
  fieldResolution: number;
  gutter: number;
  oceanLevelM: number;
  shoreDistanceLimitM: number;
  /** A tile holding no water writes its field's constants instead of running
   *  eleven full-grid passes to arrive at them (see buildHydroTile). False is
   *  the exact A/B — `?hydrodry=0` — and the control the measurement needs,
   *  since the saving is per BUILD and a session mean is dominated by the
   *  handful of wet tiles whichever way this is set. */
  dryShortCircuit: boolean;
  minimumDepthM: number;
  /** Solve the coast field (travel time and exposure) for coastal tiles. */
  coastField: boolean;
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
  dryShortCircuit: true,
  minimumDepthM: 0.08,
  coastField: true,
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

/** Bed material occupies bits 3..5 of the packed material flag byte. */
export const HYDRO_BED_SHIFT = 3;
export const HYDRO_BED_MASK = 0x38;
export const HYDRO_BED_ID: Record<HydroBedMaterial, number> = {
  silt: 1,
  sand: 2,
  gravel: 3,
  pebble: 4,
  rock: 5,
};
export const HYDRO_ID_BED: Record<number, HydroBedMaterial> = Object.fromEntries(
  Object.entries(HYDRO_BED_ID).map(([material, id]) => [id, material]),
) as Record<number, HydroBedMaterial>;

/** Bank material occupies the final two bits of the packed material byte. */
export const HYDRO_BANK_SHIFT = 6;
export const HYDRO_BANK_MASK = 0xc0;
export const HYDRO_BANK_ID: Record<HydroBankMaterial, number> = {
  soil: 0,
  mud: 1,
  gravel: 2,
  rock: 3,
};
export const HYDRO_ID_BANK: Record<number, HydroBankMaterial> = Object.fromEntries(
  Object.entries(HYDRO_BANK_ID).map(([material, id]) => [id, material]),
) as Record<number, HydroBankMaterial>;
