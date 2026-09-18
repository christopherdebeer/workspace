import type { HydroKind } from '../hydro/types';
import { sampleFieldSurface } from '../hydro/field-sample';
import type { HydroTileField } from '../hydro/types';
import type { SubstrateField } from '../substrate-field';
import { resolveFluidContact } from './contact';
import type { HydroContactLayers } from './hydro-adapter';
import type {
  ProductionCrossingRecord,
} from './crossing-authority';
import {
  pointInProductionCrossingFootprint,
  productionCrossingFootprint,
} from './crossing-authority';
import {
  CROSSING_ID,
  DRIVE_MATERIAL,
  GROUND_MATERIAL,
  WATER_STATE,
  type CrossingKind,
  type DriveMaterial,
  type GroundMaterialName,
  type SubstrateBounds,
  type SubstrateContact,
  type SupportContact,
} from './types';

export interface ProductionGroundSample {
  yM: number;
  material?: GroundMaterialName;
}

export interface ProductionDriveSample {
  yM: number;
  material: Exclude<DriveMaterial, 'ford'>;
  quality: number;
  roadId: string;
}

export interface ProductionDriveSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  yaM: number;
  ybM: number;
  halfWidthM: number;
  material: Exclude<DriveMaterial, 'ford'>;
  quality: number;
  roadId: string;
  shoulderM?: number;
  crossfallA?: number;
  crossfallB?: number;
}

/**
 * Exact identity of the solved road authoring that enters one substrate tile.
 *
 * The packet generation is part of the identity because a geometry-only
 * change (paint, kerb, batter or junction arrays) must invalidate the tile
 * even when the contact segments retain the same centreline and profile.
 */
export function productionDriveAuthoringSignature(
  segments: readonly ProductionDriveSegment[],
  renderGeneration: string,
): string {
  return `${renderGeneration};${segments.map((segment) => [
    segment.ax, segment.az, segment.bx, segment.bz,
    segment.yaM, segment.ybM, segment.halfWidthM,
    segment.material, segment.quality, segment.shoulderM ?? '',
    segment.crossfallA ?? '', segment.crossfallB ?? '', segment.roadId,
  ].join(',')).join('|')}`;
}

function productionAuthoringRevision(signature: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/** Compact diagnostic revision for the exact drive authoring signature. */
export function productionDriveAuthoringRevision(signature: string): number {
  return productionAuthoringRevision(signature);
}

export function productionStructureAuthoringSignature(
  renderGeneration: string,
): string {
  return renderGeneration;
}

/** Compact diagnostic revision for the exact structure authoring signature. */
export function productionStructureAuthoringRevision(signature: string): number {
  return productionAuthoringRevision(signature);
}

/**
 * Exact component storage for a renderer-neutral vertex attribute.
 *
 * Normalized integer attributes are materially different from eagerly
 * expanding them to floats: the component width, signedness and normalized
 * decode are part of the authored GPU contract. Keep that contract in the
 * substrate packet so packet publication can share build arrays without
 * rejecting colour/mask attributes used by some road and river materials.
 */
export type ProductionRenderAttributeArray =
  | Float32Array<ArrayBuffer>
  | Float64Array<ArrayBuffer>
  | Uint32Array<ArrayBuffer>
  | Uint16Array<ArrayBuffer>
  | Uint8Array<ArrayBuffer>
  | Uint8ClampedArray<ArrayBuffer>
  | Int32Array<ArrayBuffer>
  | Int16Array<ArrayBuffer>
  | Int8Array<ArrayBuffer>;

export interface ProductionRenderAttribute {
  itemSize: number;
  normalized: boolean;
  data: ProductionRenderAttributeArray;
}

export interface ProductionRenderGroup {
  start: number;
  count: number;
  materialIndex: number;
}

/**
 * Renderer-neutral geometry captured after production roads have been profiled,
 * joined and re-seated against the owning terrain revision.
 *
 * The substrate tile owns these immutable arrays. Runtime renderers may build
 * GPU objects from them, but may not admit the hidden source mesh directly.
 */
export interface ProductionRenderMesh {
  name: string;
  materialKeys: readonly string[];
  attributes: Readonly<Record<string, ProductionRenderAttribute>>;
  index?: Uint32Array<ArrayBuffer>;
  groups: readonly ProductionRenderGroup[];
  matrix: Float32Array<ArrayBuffer>;
  renderOrder: number;
  castShadow: boolean;
  receiveShadow: boolean;
  frustumCulled: boolean;
  userData: Readonly<Record<string, string | number | boolean>>;
}
export type ProductionDriveRenderMesh = ProductionRenderMesh;

export interface ProductionHydroDetailCollider {
  kind: 'rapid-rock';
  x: number;
  z: number;
  radiusM: number;
}

export interface ProductionGroundMesh {
  /** Position xyz, local to originX/originZ; y is local to verticalOffsetM. */
  positions: Float32Array<ArrayBuffer>;
  cellOffsets: Int32Array<ArrayBuffer>;
  cellTriangles: Int32Array<ArrayBuffer>;
  segmentCount: number;
  originX: number;
  originZ: number;
  verticalOffsetM: number;
}

export interface ProductionWaterMotionSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  bedAM: number;
  bedBM: number;
  halfWidthM: number;
  speedMps: number | null;
  waterId?: string;
}

export interface ProductionDriveWaterOverlap {
  roadId: string;
  waterId?: string;
  x: number;
  z: number;
  deckY: number;
  bedY: number;
  roadHalfWidthM: number;
  waterHalfWidthM: number;
  roadTangent: readonly [number, number];
  waterTangent: readonly [number, number];
}

/**
 * Exact packet-space road/water overlap witnesses.
 *
 * Crossing discovery used to run once while legacy water ribbons were being
 * flushed. A road arriving after that pass could therefore be present in the
 * immutable substrate tile while absent from crossing authority. Reconcile at
 * publication from the final drive and water vectors instead.
 */
export function findProductionDriveWaterOverlaps(
  driveSegments: readonly ProductionDriveSegment[],
  waterSegments: readonly ProductionWaterMotionSegment[],
): readonly ProductionDriveWaterOverlap[] {
  const cellM = 32;
  const grid = new Map<string, ProductionDriveSegment[]>();
  const keyAt = (x: number, z: number): string =>
    `${Math.floor(x / cellM)},${Math.floor(z / cellM)}`;
  for (const road of driveSegments) {
    if (![road.ax, road.az, road.bx, road.bz, road.yaM, road.ybM,
      road.halfWidthM, road.quality].every(Number.isFinite)
      || road.halfWidthM <= 0) continue;
    const reach = road.halfWidthM + .8;
    const minX = Math.floor((Math.min(road.ax, road.bx) - reach) / cellM);
    const maxX = Math.floor((Math.max(road.ax, road.bx) + reach) / cellM);
    const minZ = Math.floor((Math.min(road.az, road.bz) - reach) / cellM);
    const maxZ = Math.floor((Math.max(road.az, road.bz) + reach) / cellM);
    for (let gx = minX; gx <= maxX; gx++) for (let gz = minZ; gz <= maxZ; gz++) {
      const key = `${gx},${gz}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(road);
      else grid.set(key, [road]);
    }
  }

  const found = new Map<string, ProductionDriveWaterOverlap & { distanceM: number }>();
  for (const water of waterSegments) {
    if (![water.ax, water.az, water.bx, water.bz, water.bedAM, water.bedBM,
      water.halfWidthM].every(Number.isFinite)
      || water.halfWidthM <= 0) continue;
    const waterDx = water.bx - water.ax;
    const waterDz = water.bz - water.az;
    const waterLength = Math.hypot(waterDx, waterDz);
    if (waterLength <= 1e-6) continue;
    const waterTangent = [waterDx / waterLength, waterDz / waterLength] as const;
    // At most 3m between witnesses: narrower than a one-lane road, so an
    // oblique crossing cannot fall between samples.
    const steps = Math.max(1, Math.ceil(waterLength / 3));
    for (let step = 0; step <= steps; step++) {
      const wt = step / steps;
      const x = mix(water.ax, water.bx, wt);
      const z = mix(water.az, water.bz, wt);
      for (const road of grid.get(keyAt(x, z)) ?? []) {
        const roadDx = road.bx - road.ax;
        const roadDz = road.bz - road.az;
        const roadLength2 = roadDx * roadDx + roadDz * roadDz;
        if (roadLength2 <= 1e-9) continue;
        const roadT = clamp(
          ((x - road.ax) * roadDx + (z - road.az) * roadDz) / roadLength2,
          0,
          1,
        );
        const roadX = mix(road.ax, road.bx, roadT);
        const roadZ = mix(road.az, road.bz, roadT);
        const distanceM = Math.hypot(x - roadX, z - roadZ);
        if (distanceM > road.halfWidthM + .8) continue;
        let deckY = mix(road.yaM, road.ybM, roadT);
        if (road.crossfallA !== undefined && road.crossfallB !== undefined
          && Number.isFinite(road.crossfallA) && Number.isFinite(road.crossfallB)) {
          const roadLength = Math.sqrt(roadLength2);
          const side = ((x - roadX) * (-roadDz / roadLength)
            + (z - roadZ) * (roadDx / roadLength)) / road.halfWidthM;
          deckY += mix(road.crossfallA, road.crossfallB, roadT) * clamp(side, -1, 1);
        }
        if (!Number.isFinite(deckY)) continue;
        const roadLength = Math.sqrt(roadLength2);
        const overlap: ProductionDriveWaterOverlap & { distanceM: number } = {
          roadId: road.roadId,
          ...(water.waterId ? { waterId: water.waterId } : {}),
          x,
          z,
          deckY,
          bedY: mix(water.bedAM, water.bedBM, wt),
          roadHalfWidthM: road.halfWidthM,
          waterHalfWidthM: water.halfWidthM,
          roadTangent: [roadDx / roadLength, roadDz / roadLength],
          waterTangent,
          distanceM,
        };
        const identity = `${road.roadId}×${water.waterId ?? 'water'}`
          + `@${Math.round(x / 4)},${Math.round(z / 4)}`;
        const previous = found.get(identity);
        if (!previous || distanceM < previous.distanceM
          || (distanceM === previous.distanceM && deckY > previous.deckY)) {
          found.set(identity, overlap);
        }
      }
    }
  }
  return [...found.values()]
    .sort((a, b) =>
      a.roadId.localeCompare(b.roadId)
      || (a.waterId ?? '').localeCompare(b.waterId ?? '')
      || a.x - b.x
      || a.z - b.z)
    .map(({ distanceM: _distanceM, ...overlap }) => overlap);
}

export interface ProductionSubstrateTileInput {
  key: string;
  revision: number;
  sourceRevisions: {
    terrain: number;
    hydroDetails: number;
    hydro: number;
    crossings: number;
  };
  bounds: SubstrateBounds;
  resolution: number;
  groundMesh?: ProductionGroundMesh;
  terrainField?: SubstrateField;
  terrainRenderMeshes?: readonly ProductionRenderMesh[];
  driveSegments?: readonly ProductionDriveSegment[];
  driveRenderGeneration: string;
  driveRenderMeshes?: readonly ProductionDriveRenderMesh[];
  structureRenderGeneration: string;
  structureRenderMeshes?: readonly ProductionRenderMesh[];
  hydroDetailRenderMeshes?: readonly ProductionRenderMesh[];
  hydroDetailColliders?: readonly ProductionHydroDetailCollider[];
  hydroField?: HydroTileField;
  waterMotionSegments?: readonly ProductionWaterMotionSegment[];
  waterCoverageCutAt?: (x: number, z: number, kind: HydroKind) => number;
  crossings?: readonly ProductionCrossingRecord[];
  sampleGround(x: number, z: number): ProductionGroundSample;
  sampleDrive(x: number, z: number): ProductionDriveSample | undefined;
  sampleWater(x: number, z: number, support: SupportContact): HydroContactLayers | undefined;
  sampleCrossing(x: number, z: number): ProductionCrossingRecord | undefined;
}

export interface ProductionSubstrateTile {
  schemaVersion: 1;
  source: 'production-substrate';
  key: string;
  revision: number;
  sourceRevisions: {
    terrain: number;
    drive: number;
    structures: number;
    hydroDetails: number;
    hydro: number;
    crossings: number;
  };
  bounds: SubstrateBounds;
  resolution: number;
  roadIds: readonly string[];
  waterIds: readonly string[];
  crossings: readonly ProductionCrossingRecord[];
  groundMesh?: ProductionGroundMesh;
  terrainField?: SubstrateField;
  terrainRenderMeshes: readonly ProductionRenderMesh[];
  driveSegments: readonly ProductionDriveSegment[];
  driveAuthoringSignature: string;
  /** Built on the first sample, see buildDriveIndex; never part of the
   *  tile's identity or revision. */
  driveIndex?: ProductionDriveIndex;
  driveRenderMeshes: readonly ProductionDriveRenderMesh[];
  structureAuthoringSignature: string;
  structureRenderMeshes: readonly ProductionRenderMesh[];
  hydroDetailRenderMeshes: readonly ProductionRenderMesh[];
  hydroDetailColliders: readonly ProductionHydroDetailCollider[];
  hydroField?: HydroTileField;
  waterMotionSegments: readonly ProductionWaterMotionSegment[];
  waterCoverageCutAt?: (x: number, z: number, kind: HydroKind) => number;
  groundY: Float32Array<ArrayBuffer>;
  groundMaterial: Uint8Array<ArrayBuffer>;
  driveY: Float32Array<ArrayBuffer>;
  driveMaterial: Uint8Array<ArrayBuffer>;
  driveQuality: Float32Array<ArrayBuffer>;
  roadIndex: Uint16Array<ArrayBuffer>;
  waterY: Float32Array<ArrayBuffer>;
  waterBedY: Float32Array<ArrayBuffer>;
  waterDepthM: Float32Array<ArrayBuffer>;
  waterCoverage: Float32Array<ArrayBuffer>;
  waterShoreDistanceM: Float32Array<ArrayBuffer>;
  waterFlowX: Float32Array<ArrayBuffer>;
  waterFlowZ: Float32Array<ArrayBuffer>;
  waterSpeedMps: Float32Array<ArrayBuffer>;
  waterEnergy: Float32Array<ArrayBuffer>;
  waterVorticity: Float32Array<ArrayBuffer>;
  waterFetchM: Float32Array<ArrayBuffer>;
  waterKind: Uint8Array<ArrayBuffer>;
  waterFlags: Uint8Array<ArrayBuffer>;
  waterState: Uint8Array<ArrayBuffer>;
  waterIndex: Uint16Array<ArrayBuffer>;
  crossingId: Uint8Array<ArrayBuffer>;
  crossingIndex: Uint16Array<ArrayBuffer>;
}

export interface ProductionSubstrateStoreSnapshot {
  tiles: number;
  revision: number;
  cells: number;
  roads: number;
  waters: number;
  crossings: number;
}

export type ProductionSubstrateLookup =
  | {
    status: 'available';
    tileKey: string;
    tileRevision: number;
    contact: SubstrateContact;
  }
  | {
    status: 'unavailable';
    reason: 'no-tile' | 'invalid-tile' | 'stale-terrain' | 'stale-hydro';
    tileKey?: string;
    tileRevision?: number;
  };

/** What the world currently holds for a tile key, asked of the store's
 *  revision source at lookup time: the terrain revision the mesh was built
 *  at and the hydro field revision. A tile whose `sourceRevisions` disagree
 *  is STALE — its ground raster is another mesh's, its water rasters another
 *  field's — and stale is an explicit `unavailable`, never an answer. */
export interface ProductionCurrentRevisions {
  terrain: number;
  hydro: number;
}

export interface ProductionWaterProbe {
  tileKey: string;
  x: number;
  z: number;
  surfaceY: number;
  supportY: number;
  depthAboveSupportM: number | null;
  exposed: boolean;
  fluid: boolean;
  speedMps: number | null;
  crossing: CrossingKind | null;
}

const HYDRO_KINDS: readonly HydroKind[] = [
  'ocean', 'lagoon', 'lake', 'pond', 'reservoir',
  'basin', 'river', 'stream', 'canal', 'wetland',
];
const HYDRO_KIND_ID = new Map(HYDRO_KINDS.map((kind, index) => [kind, index + 1]));

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const finiteOrNaN = (value: number | null): number =>
  value !== null && Number.isFinite(value) ? value : NaN;

const groundMaterialId = (material: GroundMaterialName): number =>
  GROUND_MATERIAL[material];
const groundMaterialName = (id: number): GroundMaterialName => {
  switch (id) {
    case GROUND_MATERIAL.cut: return 'cut';
    case GROUND_MATERIAL.fill: return 'fill';
    case GROUND_MATERIAL.riverbed: return 'riverbed';
    case GROUND_MATERIAL.bank: return 'bank';
    case GROUND_MATERIAL.shoulder: return 'shoulder';
    default: return 'terrain';
  }
};
const driveMaterialId = (material: DriveMaterial): number =>
  DRIVE_MATERIAL[material];
const driveMaterialName = (id: number): DriveMaterial =>
  id === DRIVE_MATERIAL.gravel ? 'gravel'
    : id === DRIVE_MATERIAL.ford ? 'ford'
      : 'asphalt';

const intern = (values: string[], indices: Map<string, number>, value: string): number => {
  const found = indices.get(value);
  if (found !== undefined) return found;
  if (values.length >= 0xffff) throw new Error('production substrate feature table overflow');
  values.push(value);
  const index = values.length;
  indices.set(value, index);
  return index;
};

const internCrossing = (
  values: ProductionCrossingRecord[],
  indices: Map<string, number>,
  value: ProductionCrossingRecord,
): number => {
  const found = indices.get(value.id);
  if (found !== undefined) return found;
  if (values.length >= 0xffff) throw new Error('production substrate crossing table overflow');
  values.push(value);
  const index = values.length;
  indices.set(value.id, index);
  return index;
};

const crossingKind = (id: number): CrossingKind | undefined => {
  switch (id) {
    case CROSSING_ID.bridge: return 'bridge';
    case CROSSING_ID.culvert: return 'culvert';
    case CROSSING_ID.ford: return 'ford';
    case CROSSING_ID.causeway: return 'causeway';
    default: return undefined;
  }
};

/**
 * Assemble the existing production facts into one immutable layered tile.
 *
 * This is the versioned production authority. Shadow mode compares it without
 * consuming it; guarded contact/render modes use this same immutable answer.
 */
export function buildProductionSubstrateTile(
  input: ProductionSubstrateTileInput,
): ProductionSubstrateTile {
  const resolution = Math.max(3, Math.floor(input.resolution));
  if (typeof input.driveRenderGeneration !== 'string') {
    throw new Error(`production substrate ${input.key}: missing drive render generation`);
  }
  const driveSegments = (input.driveSegments ?? []).map((segment) => ({ ...segment }));
  for (const segment of driveSegments) {
    if (![segment.ax, segment.az, segment.bx, segment.bz,
      segment.yaM, segment.ybM, segment.halfWidthM, segment.quality]
      .every(Number.isFinite)
      || segment.halfWidthM <= 0
      || !segment.roadId) {
      throw new Error(`production substrate ${input.key}: invalid drive authoring`);
    }
  }
  const driveAuthoringSignature = productionDriveAuthoringSignature(
    driveSegments,
    input.driveRenderGeneration,
  );
  const driveRevision = productionDriveAuthoringRevision(driveAuthoringSignature);
  if (typeof input.structureRenderGeneration !== 'string') {
    throw new Error(`production substrate ${input.key}: missing structure render generation`);
  }
  const structureAuthoringSignature = productionStructureAuthoringSignature(
    input.structureRenderGeneration,
  );
  const structureRevision = productionStructureAuthoringRevision(
    structureAuthoringSignature,
  );
  const terrainField = input.terrainField;
  if (terrainField) {
    const fieldCount = terrainField.n * terrainField.n * 4;
    const boundsMatch = terrainField.xs === input.bounds.minX
      && terrainField.zs === input.bounds.minZ
      && terrainField.w === input.bounds.maxX - input.bounds.minX
      && terrainField.h === input.bounds.maxZ - input.bounds.minZ;
    if (!Number.isInteger(terrainField.n) || terrainField.n < 2
      || terrainField.a.length !== fieldCount
      || terrainField.b.length !== fieldCount
      || !boundsMatch) {
      throw new Error(`production substrate ${input.key}: invalid terrain field`);
    }
  }
  const count = resolution * resolution;
  const groundY = new Float32Array(count);
  const groundMaterial = new Uint8Array(count);
  const driveY = new Float32Array(count); driveY.fill(NaN);
  const driveMaterial = new Uint8Array(count);
  const driveQuality = new Float32Array(count);
  const roadIndex = new Uint16Array(count);
  const waterY = new Float32Array(count); waterY.fill(NaN);
  const waterBedY = new Float32Array(count); waterBedY.fill(NaN);
  const waterDepthM = new Float32Array(count);
  const waterCoverage = new Float32Array(count);
  const waterShoreDistanceM = new Float32Array(count);
  const waterFlowX = new Float32Array(count);
  const waterFlowZ = new Float32Array(count);
  const waterSpeedMps = new Float32Array(count); waterSpeedMps.fill(NaN);
  const waterEnergy = new Float32Array(count); waterEnergy.fill(NaN);
  const waterVorticity = new Float32Array(count); waterVorticity.fill(NaN);
  const waterFetchM = new Float32Array(count); waterFetchM.fill(NaN);
  const waterKind = new Uint8Array(count);
  const waterFlags = new Uint8Array(count);
  const waterState = new Uint8Array(count);
  const waterIndex = new Uint16Array(count);
  const crossingId = new Uint8Array(count);
  const crossingIndex = new Uint16Array(count);
  const roadIds: string[] = [];
  const waterIds: string[] = [];
  const crossings: ProductionCrossingRecord[] = [...(input.crossings ?? [])];
  const roadIndices = new Map<string, number>();
  const waterIndices = new Map<string, number>();
  const crossingIndices = new Map(crossings.map((crossing, index) => [crossing.id, index + 1]));
  const spanX = input.bounds.maxX - input.bounds.minX;
  const spanZ = input.bounds.maxZ - input.bounds.minZ;

  for (let iz = 0; iz < resolution; iz++) {
    const z = input.bounds.minZ + (iz / (resolution - 1)) * spanZ;
    for (let ix = 0; ix < resolution; ix++) {
      const x = input.bounds.minX + (ix / (resolution - 1)) * spanX;
      const i = iz * resolution + ix;
      const ground = input.sampleGround(x, z);
      if (!Number.isFinite(ground.yM)) {
        throw new Error(`production substrate ${input.key}: non-finite ground at ${x},${z}`);
      }
      groundY[i] = ground.yM;
      groundMaterial[i] = groundMaterialId(ground.material ?? 'terrain');

      const crossing = input.sampleCrossing(x, z);
      if (crossing && crossing.kind !== 'unresolved') {
        crossingId[i] = CROSSING_ID[crossing.kind];
        crossingIndex[i] = internCrossing(crossings, crossingIndices, crossing);
      }

      const drive = input.sampleDrive(x, z);
      let support: SupportContact = {
        kind: 'ground',
        yM: ground.yM,
        material: ground.material ?? 'terrain',
      };
      if (drive) {
        const material: DriveMaterial = crossing?.kind === 'ford' ? 'ford' : drive.material;
        driveY[i] = drive.yM;
        driveMaterial[i] = driveMaterialId(material);
        driveQuality[i] = clamp(drive.quality, 0, 1);
        roadIndex[i] = intern(roadIds, roadIndices, drive.roadId);
        support = {
          kind: 'drive',
          yM: drive.yM,
          material,
          featureId: drive.roadId,
        };
      }

      const hydro = input.sampleWater(x, z, support);
      if (!hydro) continue;
      const water = hydro.water;
      waterY[i] = water.yM;
      waterBedY[i] = water.bedY;
      waterDepthM[i] = water.depthM;
      waterCoverage[i] = clamp(water.coverage, 0, 1);
      waterShoreDistanceM[i] = water.shoreDistanceM;
      waterFlowX[i] = water.flow[0];
      waterFlowZ[i] = water.flow[1];
      waterSpeedMps[i] = finiteOrNaN(water.speedMps);
      waterEnergy[i] = finiteOrNaN(water.energy);
      waterVorticity[i] = finiteOrNaN(water.vorticity);
      waterFetchM[i] = finiteOrNaN(water.fetchM);
      waterKind[i] = HYDRO_KIND_ID.get(water.kind) ?? 0;
      waterFlags[i] = (water.intermittent ? 1 : 0) | (water.tidal ? 2 : 0);
      waterIndex[i] = intern(waterIds, waterIndices, water.waterId);
      if (crossing?.kind === 'causeway') {
        waterState[i] = WATER_STATE.blocked;
      } else if (crossing?.kind === 'culvert') {
        waterState[i] = WATER_STATE.hidden;
      } else {
        waterState[i] = water.exposed ? WATER_STATE.exposed : WATER_STATE.hidden;
      }
    }
  }

  return {
    schemaVersion: 1,
    source: 'production-substrate',
    key: input.key,
    revision: input.revision,
    sourceRevisions: {
      ...input.sourceRevisions,
      drive: driveRevision,
      structures: structureRevision,
    },
    bounds: input.bounds,
    resolution,
    roadIds,
    waterIds,
    crossings,
    ...(input.groundMesh ? { groundMesh: input.groundMesh } : {}),
    ...(terrainField ? {
      terrainField: {
        n: terrainField.n,
        xs: terrainField.xs,
        zs: terrainField.zs,
        w: terrainField.w,
        h: terrainField.h,
        a: terrainField.a,
        b: terrainField.b,
      },
    } : {}),
    terrainRenderMeshes: [...(input.terrainRenderMeshes ?? [])],
    driveSegments,
    driveAuthoringSignature,
    driveRenderMeshes: [...(input.driveRenderMeshes ?? [])],
    structureAuthoringSignature,
    structureRenderMeshes: [...(input.structureRenderMeshes ?? [])],
    hydroDetailRenderMeshes: [...(input.hydroDetailRenderMeshes ?? [])],
    hydroDetailColliders: (input.hydroDetailColliders ?? []).map((collider) => ({
      ...collider,
    })),
    ...(input.hydroField ? { hydroField: input.hydroField } : {}),
    waterMotionSegments: [...(input.waterMotionSegments ?? [])],
    ...(input.waterCoverageCutAt ? { waterCoverageCutAt: input.waterCoverageCutAt } : {}),
    groundY,
    groundMaterial,
    driveY,
    driveMaterial,
    driveQuality,
    roadIndex,
    waterY,
    waterBedY,
    waterDepthM,
    waterCoverage,
    waterShoreDistanceM,
    waterFlowX,
    waterFlowZ,
    waterSpeedMps,
    waterEnergy,
    waterVorticity,
    waterFetchM,
    waterKind,
    waterFlags,
    waterState,
    waterIndex,
    crossingId,
    crossingIndex,
  };
}

function bilinear(
  values: Float32Array<ArrayBuffer>,
  n: number,
  fx: number,
  fz: number,
  fallback: number,
): number {
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const a = values[z0 * n + x0], b = values[z0 * n + x1];
  const c = values[z1 * n + x0], d = values[z1 * n + x1];
  if (![a, b, c, d].every(Number.isFinite)) return fallback;
  return mix(mix(a, b, tx), mix(c, d, tx), tz);
}

function sampleGroundMesh(
  mesh: ProductionGroundMesh,
  bounds: SubstrateBounds,
  x: number,
  z: number,
): { yM: number; normal: readonly [number, number, number] } | undefined {
  const seg = mesh.segmentCount;
  if (seg < 1) return undefined;
  const fx = ((x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX)) * seg;
  const fz = ((z - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ)) * seg;
  if (fx < 0 || fz < 0 || fx >= seg || fz >= seg) return undefined;
  const cell = Math.floor(fz) * seg + Math.floor(fx);
  const positions = mesh.positions;
  const vertex = (index: number): readonly [number, number, number] => {
    const i = index * 3;
    return [
      positions[i] + mesh.originX,
      positions[i + 1] + mesh.verticalOffsetM,
      positions[i + 2] + mesh.originZ,
    ];
  };
  for (let h = mesh.cellOffsets[cell]; h < mesh.cellOffsets[cell + 1]; h++) {
    const a = vertex(mesh.cellTriangles[h * 3]);
    const b = vertex(mesh.cellTriangles[h * 3 + 1]);
    const c = vertex(mesh.cellTriangles[h * 3 + 2]);
    const denominator = (b[2] - c[2]) * (a[0] - c[0])
      + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(denominator) < 1e-9) continue;
    const wa = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2]))
      / denominator;
    const wb = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2]))
      / denominator;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
    const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const length = Math.hypot(nx, ny, nz) || 1;
    return {
      yM: wa * a[1] + wb * b[1] + wc * c[1],
      normal: [nx / length, ny / length, nz / length],
    };
  }
  return undefined;
}

/** Whether the precise field has an answer at (x, z) at all — inside its
 *  bounds with a usable resolution. Its answer may then be wet or dry; only
 *  outside this is the witness raster consulted. Mirrors the bounds test at
 *  the top of `sampleFieldSurface`, which folds "outside" into the same
 *  undefined as "dry". */
function hydroFieldCovers(field: HydroTileField, x: number, z: number): boolean {
  const b = field.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  const sx = (b.maxX - b.minX) / field.resolution, sz = (b.maxZ - b.minZ) / field.resolution;
  return sx > 0 && sz > 0;
}
function sampleWaterMotion(
  segments: readonly ProductionWaterMotionSegment[],
  x: number,
  z: number,
): { bedY: number; speedMps: number | null; waterId?: string } | undefined {
  let best: { bedY: number; speedMps: number | null; waterId?: string } | undefined;
  for (const segment of segments) {
    const dx = segment.bx - segment.ax, dz = segment.bz - segment.az;
    const t = clamp(((x - segment.ax) * dx + (z - segment.az) * dz)
      / (dx * dx + dz * dz || 1), 0, 1);
    const px = segment.ax + dx * t, pz = segment.az + dz * t;
    if (Math.hypot(x - px, z - pz) > segment.halfWidthM) continue;
    const bedY = mix(segment.bedAM, segment.bedBM, t);
    if (!best || bedY < best.bedY) {
      best = {
        bedY,
        speedMps: segment.speedMps,
        ...(segment.waterId ? { waterId: segment.waterId } : {}),
      };
    }
  }
  return best;
}

/**
 * WHICH ROAD SEGMENTS CAN REACH A POINT, WITHOUT ASKING EVERY ONE.
 *
 * The sampler walked every drive segment of the tile for every query — and
 * validated each with an eight-element array allocated per segment per
 * query — while `surfaceAt`, `waterInfoAt`, `splashWet` and `tyreHeight`
 * had all become this sampler on the ordinary path. Every animal every
 * frame, four wheels, every POI, every tree and shrub lattice point: the
 * seat read stepWildlife at 14.5 ms a frame, sim:suspension at 4.1,
 * treeRefresh at 62 ms with shrubs at 31, against 0.3 / 0.1 / 12 / 4 on the
 * build before, and the fixture reproduced it (stepWildlife 0.8 → 4.9 ms a
 * frame on the default path). A segment can only answer for points within
 * halfWidth + shoulder of itself, so each is filed once, at the tile's
 * first sample, into every 32 m cell its reach touches, and a query reads
 * its own cell's list. Validation moves here too, so it happens once.
 */
export interface ProductionDriveIndex {
  cell: number;
  cols: number;
  rows: number;
  buckets: ReadonlyArray<readonly number[] | undefined>;
}
const DRIVE_INDEX_CELL = 32;
const NO_SEGMENTS: readonly number[] = [];
function buildDriveIndex(tile: ProductionSubstrateTile): ProductionDriveIndex {
  const b = tile.bounds, cell = DRIVE_INDEX_CELL;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
  const buckets: Array<number[] | undefined> = new Array(cols * rows);
  tile.driveSegments.forEach((segment, i) => {
    if (![segment.ax, segment.az, segment.bx, segment.bz, segment.yaM,
      segment.ybM, segment.halfWidthM, segment.quality].every(Number.isFinite)
      || segment.halfWidthM <= 0) return;
    // The sampler keeps a segment while distance − halfWidth ≤ shoulder; a
    // box around the segment grown by that reach contains every such point.
    const reach = segment.halfWidthM + Math.max(0, segment.shoulderM ?? .8) + .5;
    const x0 = Math.max(0, Math.floor((Math.min(segment.ax, segment.bx) - reach - b.minX) / cell));
    const x1 = Math.min(cols - 1, Math.floor((Math.max(segment.ax, segment.bx) + reach - b.minX) / cell));
    const z0 = Math.max(0, Math.floor((Math.min(segment.az, segment.bz) - reach - b.minZ) / cell));
    const z1 = Math.min(rows - 1, Math.floor((Math.max(segment.az, segment.bz) + reach - b.minZ) / cell));
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const k = cz * cols + cx;
      (buckets[k] ??= []).push(i);
    }
  });
  return { cell, cols, rows, buckets };
}
function driveSegmentsNear(tile: ProductionSubstrateTile, x: number, z: number): readonly number[] {
  const idx = tile.driveIndex ?? (tile.driveIndex = buildDriveIndex(tile));
  const b = tile.bounds;
  const cx = Math.floor((x - b.minX) / idx.cell), cz = Math.floor((z - b.minZ) / idx.cell);
  if (cx < 0 || cz < 0 || cx >= idx.cols || cz >= idx.rows) return NO_SEGMENTS;
  return idx.buckets[cz * idx.cols + cx] ?? NO_SEGMENTS;
}
export function sampleProductionSubstrateTile(
  tile: ProductionSubstrateTile,
  x: number,
  z: number,
): SubstrateContact | undefined {
  const { bounds, resolution: n } = tile;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return undefined;
  const fx = clamp((x - bounds.minX) / Math.max(1e-6, bounds.maxX - bounds.minX), 0, 1) * (n - 1);
  const fz = clamp((z - bounds.minZ) / Math.max(1e-6, bounds.maxZ - bounds.minZ), 0, 1) * (n - 1);
  const ix = clamp(Math.round(fx), 0, n - 1);
  const iz = clamp(Math.round(fz), 0, n - 1);
  const i = iz * n + ix;
  const exactGround = tile.groundMesh
    ? sampleGroundMesh(tile.groundMesh, tile.bounds, x, z)
    : undefined;
  const groundLevel = exactGround?.yM
    ?? bilinear(tile.groundY, n, fx, fz, tile.groundY[i]);
  const sx = (bounds.maxX - bounds.minX) / (n - 1);
  const sz = (bounds.maxZ - bounds.minZ) / (n - 1);
  const left = tile.groundY[iz * n + Math.max(0, ix - 1)];
  const right = tile.groundY[iz * n + Math.min(n - 1, ix + 1)];
  const up = tile.groundY[Math.max(0, iz - 1) * n + ix];
  const down = tile.groundY[Math.min(n - 1, iz + 1) * n + ix];
  const nx = -(right - left) / Math.max(1e-6, sx * 2);
  const nz = -(down - up) / Math.max(1e-6, sz * 2);
  const normalLength = Math.hypot(nx, 1, nz) || 1;
  const groundNormal = exactGround?.normal
    ?? [nx / normalLength, 1 / normalLength, nz / normalLength] as const;
  let crossingRecord: ProductionCrossingRecord | undefined;
  let crossingDistance = Infinity;
  for (const candidate of tile.crossings) {
    const distance = Math.hypot(x - candidate.x, z - candidate.z);
    const footprint = productionCrossingFootprint(candidate);
    const contains = footprint
      ? pointInProductionCrossingFootprint(footprint, x, z)
      : distance <= candidate.radiusM;
    if (contains && distance < crossingDistance) {
      crossingRecord = candidate;
      crossingDistance = distance;
    }
  }
  const crossing = crossingRecord && crossingRecord.kind !== 'unresolved'
    ? crossingRecord.kind
    // Exact oriented records outrank the 33x33 diagnostic raster. Once a tile
    // carries records, a nearby raster cell must not smear "bridge" sideways
    // onto exposed river beside the actual deck footprint.
    : tile.crossings.length === 0
      ? crossingKind(tile.crossingId[i])
      : undefined;
  const contact: SubstrateContact = {
    x,
    z,
    ground: {
      yM: groundLevel,
      normal: groundNormal,
      material: groundMaterialName(tile.groundMaterial[i]),
    },
    support: {
      kind: 'ground',
      yM: groundLevel,
      material: groundMaterialName(tile.groundMaterial[i]),
    },
    crossing,
    blockedWater: crossing === 'causeway' || tile.waterState[i] === WATER_STATE.blocked,
  };

  let exactDriveProximity: (ProductionDriveSample & { outM: number }) | undefined;
  let exactDriveSupport: (ProductionDriveSample & { outM: number }) | undefined;
  for (const si of driveSegmentsNear(tile, x, z)) {
    const segment = tile.driveSegments[si];
    const dx = segment.bx - segment.ax, dz = segment.bz - segment.az;
    const t = clamp(((x - segment.ax) * dx + (z - segment.az) * dz)
      / (dx * dx + dz * dz || 1), 0, 1);
    const px = segment.ax + dx * t, pz = segment.az + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    const outM = distance - segment.halfWidthM;
    if (outM > (segment.shoulderM ?? .8)) continue;
    let yM = mix(segment.yaM, segment.ybM, t);
    if (segment.crossfallA !== undefined && segment.crossfallB !== undefined
      && Number.isFinite(segment.crossfallA) && Number.isFinite(segment.crossfallB)) {
      const length = Math.hypot(dx, dz) || 1;
      const side = ((x - px) * (-dz / length) + (z - pz) * (dx / length))
        / (segment.halfWidthM || 1);
      yM += mix(segment.crossfallA, segment.crossfallB, t) * clamp(side, -1, 1);
    }
    if (!Number.isFinite(yM) || !Number.isFinite(outM)) continue;
    const sample = {
      yM,
      material: segment.material,
      quality: segment.quality,
      roadId: segment.roadId,
      outM,
    };
    if (!exactDriveProximity
      || sample.outM < exactDriveProximity.outM
      || (sample.outM === exactDriveProximity.outM
        && sample.yM > exactDriveProximity.yM)) {
      exactDriveProximity = sample;
    }
    // Shoulder/fairing reach is intentionally wider than physical drive
    // support. Do not let a high shoulder-only segment hide a lower deck the
    // vehicle is actually standing on.
    if (sample.outM <= .8
      && (!exactDriveSupport || sample.yM > exactDriveSupport.yM)) {
      exactDriveSupport = sample;
    }
  }
  // A crossing record is an authority, not merely a label. Tile clipping can
  // put the semantic centre in a tile whose road segment packet is owned by a
  // neighbour; without this fallback a built bridge was reported as "bridge"
  // while selecting the river bed as vehicle support and resolving live fluid
  // above it. Retain the explicit deck through the crossing footprint until
  // direct substrate road generation removes that ownership seam.
  const crossingFootprint = crossingRecord
    ? productionCrossingFootprint(crossingRecord)
    : undefined;
  if (!exactDriveSupport
    && (tile.driveSegments.length > 0 || !Number.isFinite(tile.driveY[i]))
    && crossingRecord && crossingFootprint
    && pointInProductionCrossingFootprint(crossingFootprint, x, z)) {
    const tx = crossingRecord.roadTangent[0];
    const tz = crossingRecord.roadTangent[1];
    const length = Math.hypot(tx, tz) || 1;
    const across = Math.abs(
      (x - crossingRecord.x) * (-tz / length)
      + (z - crossingRecord.z) * (tx / length),
    );
    const crossingDrive: ProductionDriveSample & { outM: number } = {
      yM: crossingRecord.deckY,
      material: tile.driveMaterial[i] === DRIVE_MATERIAL.gravel ? 'gravel' : 'asphalt',
      quality: Math.max(.5, tile.driveQuality[i]),
      roadId: crossingRecord.roadId,
      outM: across - crossingRecord.roadHalfWidthM,
    };
    // An exact segment remains the better fairing witness even when it is
    // shoulder-only. The semantic crossing fallback supplies missing solid
    // support; it must not erase more precise vector proximity.
    if (!exactDriveProximity) exactDriveProximity = crossingDrive;
    if (crossingDrive.outM <= .8) exactDriveSupport = crossingDrive;
  }
  if (exactDriveProximity) {
    contact.driveProximity = {
      outM: exactDriveProximity.outM,
      deckY: exactDriveProximity.yM,
      material: exactDriveProximity.material,
      quality: exactDriveProximity.quality,
      roadId: exactDriveProximity.roadId,
    };
  }
  // The coarse drive raster is a compatibility witness only. Once exact
  // vector segments are present it must not fill gaps between them: at Senqu
  // a bridge approach bled across a 64m raster cell and invented an elevated
  // deck over open river several metres outside the carriageway.
  const rasterDrive = tile.driveSegments.length === 0 && Number.isFinite(tile.driveY[i]);
  if (exactDriveSupport || rasterDrive) {
    const roadId = tile.roadIds[tile.roadIndex[i] - 1] ?? 'production-road:unknown';
    const material = crossing === 'ford'
      ? 'ford'
      : exactDriveSupport?.material ?? driveMaterialName(tile.driveMaterial[i]);
    contact.drive = {
      yM: exactDriveSupport?.yM ?? bilinear(tile.driveY, n, fx, fz, tile.driveY[i]),
      material,
      quality: exactDriveSupport?.quality ?? tile.driveQuality[i],
      roadId: exactDriveSupport?.roadId ?? roadId,
    };
    contact.support = {
      kind: 'drive',
      yM: contact.drive.yM,
      material,
      featureId: contact.drive.roadId,
    };
  }

  // THREE ANSWERS FROM THE PRECISE FIELD, NOT TWO. Known wet, known dry, and
  // unavailable (no field, or the point outside its bounds). The dry answer is
  // FINAL: the 33x33 witness raster below is a fallback for the unavailable
  // case only. Before this, "dry" and "unavailable" were the same undefined,
  // and a wet raster cell 60-70 m wide resurrected water contact 24 m from an
  // 8 m channel — wet, 0.63 m deep, where the field said dry — which the
  // surface classifier, the wheels and the splash all consumed.
  const hydroKnown = !!tile.hydroField && hydroFieldCovers(tile.hydroField, x, z);
  let exactHydro = hydroKnown && tile.hydroField
    ? sampleFieldSurface(tile.hydroField, x, z, 0)
    : undefined;
  if (exactHydro) {
    const cut = tile.waterCoverageCutAt
      ? clamp(tile.waterCoverageCutAt(x, z, exactHydro.kind), 0, 1)
      : .5;
    if (exactHydro.coverage < cut) exactHydro = undefined;
  }
  if (exactHydro && crossing !== 'causeway') {
    const motion = sampleWaterMotion(tile.waterMotionSegments, x, z);
    const bedY = motion?.bedY ?? exactHydro.restingLevelM - exactHydro.depthM;
    const speed = motion?.speedMps ?? null;
    const waterId = motion?.waterId
      ?? (tile.hydroField?.bodyIds.length === 1
        ? tile.hydroField.bodyIds[0]
        : `${tile.key}:water`);
    contact.water = {
      source: 'production-hydro',
      kind: exactHydro.kind,
      yM: exactHydro.restingLevelM,
      bedY,
      depthM: Math.max(0, exactHydro.restingLevelM - bedY),
      coverage: exactHydro.coverage,
      shoreDistanceM: exactHydro.shoreDistanceM,
      flow: exactHydro.flow,
      speedMps: speed,
      speedAuthority: speed === null ? 'unknown' : 'resolved',
      energy: null,
      vorticity: null,
      fetchM: exactHydro.fetchM,
      bedMaterial: exactHydro.bedMaterial,
      bankMaterial: exactHydro.bankMaterial,
      intermittent: exactHydro.intermittent,
      tidal: exactHydro.tidal,
      exposed: crossing !== 'culvert',
      waterId,
    };
    // Bridge water remains exposed/renderable below the structure, but is not
    // vehicle fluid. A flooded deck needs explicit flood state; centimetres of
    // profile/reconstruction disagreement are not flooding authority.
    contact.fluid = crossing === 'bridge' && contact.support.kind === 'drive'
      ? undefined
      : resolveFluidContact(contact.water, contact.support);
  } else if (!hydroKnown && crossing !== 'causeway'
    && (tile.waterState[i] === WATER_STATE.exposed || tile.waterState[i] === WATER_STATE.hidden)) {
    const kind = HYDRO_KINDS[tile.waterKind[i] - 1];
    const waterId = tile.waterIds[tile.waterIndex[i] - 1] ?? 'production-water:unknown';
    const speed = tile.waterSpeedMps[i];
    contact.water = {
      source: 'production-hydro',
      kind: kind ?? 'river',
      yM: bilinear(tile.waterY, n, fx, fz, tile.waterY[i]),
      bedY: bilinear(tile.waterBedY, n, fx, fz, tile.waterBedY[i]),
      depthM: tile.waterDepthM[i],
      coverage: tile.waterCoverage[i],
      shoreDistanceM: tile.waterShoreDistanceM[i],
      flow: [tile.waterFlowX[i], tile.waterFlowZ[i]],
      speedMps: Number.isFinite(speed) ? speed : null,
      speedAuthority: Number.isFinite(speed) ? 'resolved' : 'unknown',
      energy: Number.isFinite(tile.waterEnergy[i]) ? tile.waterEnergy[i] : null,
      vorticity: Number.isFinite(tile.waterVorticity[i]) ? tile.waterVorticity[i] : null,
      fetchM: Number.isFinite(tile.waterFetchM[i]) ? tile.waterFetchM[i] : null,
      intermittent: (tile.waterFlags[i] & 1) !== 0,
      tidal: (tile.waterFlags[i] & 2) !== 0,
      exposed: crossing !== 'culvert' && tile.waterState[i] === WATER_STATE.exposed,
      waterId,
    };
    contact.fluid = crossing === 'bridge' && contact.support.kind === 'drive'
      ? undefined
      : resolveFluidContact(contact.water, contact.support);
  }

  if (crossing === 'bridge' && contact.drive) {
    contact.structure = {
      kind: 'bridge-deck',
      bottomY: contact.drive.yM - .72,
      topY: contact.drive.yM,
    };
  } else if (crossing === 'culvert' && contact.drive && contact.water) {
    contact.structure = {
      kind: 'culvert-roof',
      bottomY: Math.min(contact.drive.yM - .22, contact.water.yM + .28),
      topY: contact.drive.yM - .08,
    };
  } else if (crossing === 'causeway' && contact.drive) {
    contact.structure = {
      kind: 'causeway-fill',
      bottomY: Number.isFinite(tile.waterBedY[i]) ? tile.waterBedY[i] : contact.ground.yM,
      topY: contact.drive.yM - .08,
    };
  }
  return contact;
}

export class ProductionSubstrateStore {
  private readonly tiles = new Map<string, ProductionSubstrateTile>();
  private revision = 0;
  private currentRevisions: ((key: string) => ProductionCurrentRevisions | undefined) | null = null;

  /** Install the world's view of current revisions per key. Without one the
   *  store answers from whatever it holds (the tests' pure tiles). */
  setRevisionSource(source: ((key: string) => ProductionCurrentRevisions | undefined) | null): void {
    this.currentRevisions = source;
  }

  /** Why a held tile would not be served: stale against the world, or fresh. */
  staleness(tile: ProductionSubstrateTile): 'stale-terrain' | 'stale-hydro' | null {
    const current = this.currentRevisions?.(tile.key);
    if (!current) return null;
    if (tile.sourceRevisions.terrain !== current.terrain) return 'stale-terrain';
    if (tile.sourceRevisions.hydro !== current.hydro) return 'stale-hydro';
    return null;
  }

  upsert(tile: ProductionSubstrateTile): void {
    const previous = this.tiles.get(tile.key);
    if (previous && previous.revision > tile.revision) return;
    this.tiles.set(tile.key, tile);
    this.revision = Math.max(this.revision + 1, tile.revision);
  }

  remove(key: string): void {
    if (this.tiles.delete(key)) this.revision++;
  }

  reset(): void {
    if (this.tiles.size) this.revision++;
    this.tiles.clear();
  }

  tile(key: string): ProductionSubstrateTile | undefined {
    return this.tiles.get(key);
  }

  lookup(x: number, z: number): ProductionSubstrateLookup {
    const tile = this.tileAt(x, z);
    if (!tile) return { status: 'unavailable', reason: 'no-tile' };
    // REVISIONS ARE CONSUMED HERE, not only carried. A tile built on terrain
    // revision 3 answering for a mesh at revision 4 gives the wheels another
    // mesh's ground and the splash another field's water for the frames
    // between the rebuild being queued and landing. Those frames go to the
    // legacy sampler explicitly, counted, rather than to a stale answer.
    const stale = this.staleness(tile);
    if (stale) return { status: 'unavailable', reason: stale, tileKey: tile.key, tileRevision: tile.revision };
    const contact = sampleProductionSubstrateTile(tile, x, z);
    // `tileAt` and the sampler deliberately share the same bounds. Keep this
    // defensive state explicit: a malformed/revised tile may use rollback,
    // but it must never masquerade as an ordinary dry substrate answer.
    if (!contact) return { status: 'unavailable', reason: 'invalid-tile' };
    return {
      status: 'available',
      tileKey: tile.key,
      tileRevision: tile.revision,
      contact,
    };
  }

  sample(x: number, z: number): SubstrateContact | undefined {
    const lookup = this.lookup(x, z);
    return lookup.status === 'available' ? lookup.contact : undefined;
  }

  debugAt(x: number, z: number): Record<string, unknown> | null {
    const tile = this.tileAt(x, z);
    if (!tile) return null;
    const contact = sampleProductionSubstrateTile(tile, x, z);
    const n = tile.resolution;
    const fx = clamp((x - tile.bounds.minX)
      / Math.max(1e-6, tile.bounds.maxX - tile.bounds.minX), 0, 1) * (n - 1);
    const fz = clamp((z - tile.bounds.minZ)
      / Math.max(1e-6, tile.bounds.maxZ - tile.bounds.minZ), 0, 1) * (n - 1);
    const ix = clamp(Math.round(fx), 0, n - 1);
    const iz = clamp(Math.round(fz), 0, n - 1);
    const rasterGroundY = bilinear(
      tile.groundY, n, fx, fz, tile.groundY[iz * n + ix],
    );
    return {
      key: tile.key,
      revision: tile.revision,
      sourceRevisions: tile.sourceRevisions,
      exactGround: !!tile.groundMesh,
      terrainField: !!tile.terrainField,
      terrainRenderMeshes: tile.terrainRenderMeshes.length,
      exactHydro: !!tile.hydroField,
      driveSegments: tile.driveSegments.length,
      driveAuthoring: tile.driveAuthoringSignature.length > 0,
      driveRenderMeshes: tile.driveRenderMeshes.length,
      structureAuthoring: tile.structureAuthoringSignature.length > 0,
      structureRenderMeshes: tile.structureRenderMeshes.length,
      hydroDetailRenderMeshes: tile.hydroDetailRenderMeshes.length,
      hydroDetailColliders: tile.hydroDetailColliders.length,
      waterMotionSegments: tile.waterMotionSegments.length,
      crossingRecords: tile.crossings.length,
      crossing: contact?.crossing ?? null,
      driveId: contact?.drive?.roadId ?? null,
      waterId: contact?.water?.waterId ?? null,
      rasterGroundY,
      contactGroundY: contact?.ground.yM ?? null,
      supportY: contact?.support.yM ?? null,
    };
  }

  /**
   * Exact points on the current field-rendered water for browser drives and
   * diagnostics. This replaces probes that walked retired river ribbon meshes.
   * Segment stations are preferred because they carry bed/speed authority;
   * field texels fill bodies without a channel vector.
   */
  waterPoints(
    max = 32,
    around?: { x: number; z: number; radiusM?: number },
  ): ProductionWaterProbe[] {
    const limit = clamp(Math.floor(max), 1, 256);
    const candidates: ProductionWaterProbe[] = [];
    const seen = new Set<string>();
    const append = (tile: ProductionSubstrateTile, x: number, z: number): void => {
      if (candidates.length >= limit * 8 || this.tileAt(x, z) !== tile) return;
      if (around && Math.hypot(x - around.x, z - around.z) > (around.radiusM ?? Infinity)) return;
      const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
      if (seen.has(key)) return;
      const contact = sampleProductionSubstrateTile(tile, x, z);
      if (!contact?.water?.exposed) return;
      seen.add(key);
      candidates.push({
        tileKey: tile.key,
        x,
        z,
        surfaceY: contact.water.yM,
        supportY: contact.support.yM,
        depthAboveSupportM: contact.fluid?.depthAboveSupportM ?? null,
        exposed: contact.water.exposed,
        fluid: !!contact.fluid,
        speedMps: contact.water.speedMps,
        crossing: contact.crossing ?? null,
      });
    };

    // Semantic crossings are first-class audit targets. Sampling only channel
    // stations made a representative "ford" drive timing-dependent: whichever
    // ordinary wet segment entered the store first could consume the returned
    // probe budget before the actual crossing centre was visited.
    for (const tile of this.tiles.values()) {
      for (const crossing of tile.crossings) append(tile, crossing.x, crossing.z);
    }
    for (const tile of this.tiles.values()) {
      for (const segment of tile.waterMotionSegments) {
        for (const t of [.2, .5, .8]) {
          append(
            tile,
            mix(segment.ax, segment.bx, t),
            mix(segment.az, segment.bz, t),
          );
        }
      }
    }
    for (const tile of this.tiles.values()) {
      const field = tile.hydroField;
      if (!field || candidates.length >= limit * 4) continue;
      const step = Math.max(1, Math.floor(field.resolution / Math.max(3, Math.sqrt(limit))));
      const spanX = field.bounds.maxX - field.bounds.minX;
      const spanZ = field.bounds.maxZ - field.bounds.minZ;
      for (let iz = Math.floor(step / 2); iz < field.resolution; iz += step) {
        for (let ix = Math.floor(step / 2); ix < field.resolution; ix += step) {
          append(
            tile,
            field.bounds.minX + (ix + .5) / field.resolution * spanX,
            field.bounds.minZ + (iz + .5) / field.resolution * spanZ,
          );
        }
      }
    }
    const rank = (probe: ProductionWaterProbe): number =>
      probe.crossing === 'ford' && probe.fluid
        ? 0
        : probe.crossing !== null
          ? 1
          : probe.fluid ? 2 : 3;
    const stable = (a: ProductionWaterProbe, b: ProductionWaterProbe): number =>
      rank(a) - rank(b)
      || a.tileKey.localeCompare(b.tileKey)
      || a.x - b.x
      || a.z - b.z;
    if (around) {
      candidates.sort((a, b) =>
        rank(a) - rank(b)
        || Math.hypot(a.x - around.x, a.z - around.z)
        - Math.hypot(b.x - around.x, b.z - around.z)
        || stable(a, b));
    } else {
      candidates.sort((a, b) =>
        rank(a) - rank(b)
        || (b.depthAboveSupportM ?? -Infinity) - (a.depthAboveSupportM ?? -Infinity)
        || stable(a, b));
    }
    return candidates.slice(0, limit);
  }

  /** The tile that answered last, and the store revision it answered under:
   *  a wheel, an animal or a lattice point asks thousands of times inside
   *  one 2 km tile, and the scan below ran for each of those. */
  private lastHit: { tile: ProductionSubstrateTile; rev: number } | undefined;
  private tileAt(x: number, z: number): ProductionSubstrateTile | undefined {
    const hit = this.lastHit;
    if (hit && hit.rev === this.revision) {
      const b = hit.tile.bounds;
      if (x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ) return hit.tile;
    }
    let best: ProductionSubstrateTile | undefined;
    for (const tile of this.tiles.values()) {
      const bounds = tile.bounds;
      // Half-open, like HydroSystem and the terrain tile store. Two inclusive
      // max edges can otherwise make a border point read whichever neighbour
      // happened to enter this map first.
      if (x < bounds.minX || x >= bounds.maxX || z < bounds.minZ || z >= bounds.maxZ) continue;
      if (!best || tile.revision > best.revision) best = tile;
    }
    if (best) this.lastHit = { tile: best, rev: this.revision };
    return best;
  }

  snapshot(): ProductionSubstrateStoreSnapshot {
    let cells = 0, roads = 0, waters = 0, crossings = 0;
    for (const tile of this.tiles.values()) {
      cells += tile.resolution * tile.resolution;
      roads += new Set([
        ...tile.roadIds,
        ...tile.driveSegments.map((segment) => segment.roadId),
      ]).size;
      waters += tile.waterIds.length;
      crossings += tile.crossings.length;
    }
    return {
      tiles: this.tiles.size,
      revision: this.revision,
      cells,
      roads,
      waters,
      crossings,
    };
  }
}
