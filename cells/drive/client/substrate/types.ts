/**
 * Shared road/water/terrain contracts.
 *
 * The substrate is deliberately a layered 2.5D model rather than a single
 * "surface" number. A bridge, for example, has a river bed, exposed water and
 * a drivable deck at the same x/z; collapsing those into one winner is the
 * architectural mistake this module exists to avoid.
 */
import type { HydroBankMaterial, HydroBedMaterial, HydroKind } from '../hydro/types';

export interface SubstrateBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Row zero maps to bounds.minZ and column zero to bounds.minX. */
export interface SubstrateElevation {
  width: number;
  height: number;
  data: Float32Array<ArrayBuffer>;
}

export interface CorridorStation {
  x: number;
  z: number;
  /** Road deck for roads; channel invert for water. Absolute metres. */
  yM: number;
}

export type DriveMaterial = 'asphalt' | 'gravel' | 'ford';
export type WaterKind = 'river' | 'stream' | 'canal';
export type WaterRegime = 'pool' | 'run' | 'riffle' | 'rapid';
export type BedMaterial = HydroBedMaterial;
export type BankMaterial = HydroBankMaterial;

export interface RoadCorridor {
  id: string;
  kind: 'road' | 'track';
  stations: readonly CorridorStation[];
  halfWidthM: number;
  shoulderM: number;
  thicknessM: number;
  quality: number;
  material: Exclude<DriveMaterial, 'ford'>;
  layer?: number;
  /** 0 path/local, 1 collector, 2 arterial, 3 motorway-scale. */
  tier?: 0 | 1 | 2 | 3;
}

export interface WaterCorridor {
  id: string;
  kind: WaterKind;
  stations: readonly CorridorStation[];
  halfWidthM: number;
  bankWidthM: number;
  depthM: number;
  flowSpeedMps: number;
  roughness: number;
  regime: WaterRegime;
  bedMaterial: BedMaterial;
  bankMaterial: BankMaterial;
}

export type CrossingKind = 'bridge' | 'culvert' | 'ford' | 'causeway';
export type CrossingIntent = CrossingKind | 'auto';

export interface CrossingEvidence {
  intent: CrossingIntent;
  bridgeTagged?: boolean;
  fordTagged?: boolean;
  culvertTagged?: boolean;
  /** Available vertical room for a buried conduit. */
  availableClearanceM?: number;
  bridgeClearanceM?: number;
  approachM?: number;
}

export interface SubstrateTileInput {
  key: string;
  revision: number;
  bounds: SubstrateBounds;
  resolution: number;
  elevation: SubstrateElevation;
  road: RoadCorridor;
  water: WaterCorridor;
  crossing: CrossingEvidence;
}

export interface ResolvedCrossing {
  id: string;
  kind: CrossingKind;
  x: number;
  z: number;
  roadS: number;
  waterS: number;
  roadTangent: readonly [number, number];
  waterTangent: readonly [number, number];
  /** Length of the resolved structure/open crossing along the road. */
  spanRoadM: number;
  /** Length occupied along the water corridor by the carriageway. */
  spanWaterM: number;
  approachM: number;
  roadDeckM: number;
  waterSurfaceM: number;
  waterBedM: number;
}

export const GROUND_MATERIAL = {
  terrain: 0,
  cut: 1,
  fill: 2,
  riverbed: 3,
  bank: 4,
  shoulder: 5,
} as const;
export type GroundMaterialName = keyof typeof GROUND_MATERIAL;
export type GroundMaterialId = (typeof GROUND_MATERIAL)[GroundMaterialName];

export const DRIVE_MATERIAL = {
  none: 0,
  asphalt: 1,
  gravel: 2,
  ford: 3,
} as const;
export type DriveMaterialId = (typeof DRIVE_MATERIAL)[keyof typeof DRIVE_MATERIAL];

export const WATER_STATE = {
  none: 0,
  exposed: 1,
  hidden: 2,
  blocked: 3,
} as const;
export type WaterStateId = (typeof WATER_STATE)[keyof typeof WATER_STATE];

export const CROSSING_ID = {
  none: 0,
  bridge: 1,
  culvert: 2,
  ford: 3,
  causeway: 4,
} as const;
export type CrossingId = (typeof CROSSING_ID)[keyof typeof CROSSING_ID];

export interface ResolvedSubstrateTile {
  schemaVersion: 1;
  key: string;
  revision: number;
  bounds: SubstrateBounds;
  resolution: number;
  crossing: ResolvedCrossing;
  roadId: string;
  roadQuality: number;
  waterId: string;
  waterKind: WaterKind;
  waterRegime: WaterRegime;
  bedMaterial: BedMaterial;
  bankMaterial: BankMaterial;
  groundY: Float32Array<ArrayBuffer>;
  groundMaterial: Uint8Array<ArrayBuffer>;
  driveY: Float32Array<ArrayBuffer>;
  driveMaterial: Uint8Array<ArrayBuffer>;
  waterY: Float32Array<ArrayBuffer>;
  waterBedY: Float32Array<ArrayBuffer>;
  waterDepthM: Float32Array<ArrayBuffer>;
  waterShoreDistanceM: Float32Array<ArrayBuffer>;
  waterFlowX: Float32Array<ArrayBuffer>;
  waterFlowZ: Float32Array<ArrayBuffer>;
  waterSpeedMps: Float32Array<ArrayBuffer>;
  waterEnergy: Float32Array<ArrayBuffer>;
  waterVorticity: Float32Array<ArrayBuffer>;
  waterState: Uint8Array<ArrayBuffer>;
  crossingId: Uint8Array<ArrayBuffer>;
}

export interface GroundContact {
  yM: number;
  normal: readonly [number, number, number];
  material: GroundMaterialName;
}

export interface DriveContact {
  yM: number;
  material: DriveMaterial;
  quality: number;
  roadId: string;
}

export interface DriveProximity {
  /** Signed metres outside the carriageway edge; negative is inboard. */
  outM: number;
  deckY: number;
  material: Exclude<DriveMaterial, 'ford'>;
  quality: number;
  roadId: string;
}

export interface WaterContact {
  source: 'resolved-substrate' | 'production-hydro';
  kind: HydroKind;
  yM: number;
  bedY: number;
  depthM: number;
  coverage: number;
  /** Positive in water, negative on dry ground, matching HydroTileField. */
  shoreDistanceM: number;
  flow: readonly [number, number];
  /** Null when the source carries direction but no speed authority. */
  speedMps: number | null;
  speedAuthority: 'resolved' | 'unknown';
  energy: number | null;
  vorticity: number | null;
  fetchM: number | null;
  regime?: WaterRegime;
  bedMaterial?: BedMaterial;
  bankMaterial?: BankMaterial;
  intermittent: boolean;
  tidal: boolean;
  exposed: boolean;
  waterId: string;
}

export interface StructureContact {
  kind: 'bridge-deck' | 'culvert-roof' | 'causeway-fill';
  bottomY: number;
  topY: number;
}

export interface SupportContact {
  kind: 'ground' | 'drive';
  yM: number;
  material: GroundMaterialName | DriveMaterial;
  featureId?: string;
}

export interface FluidContact extends WaterContact {
  /** Water column physically above the selected support layer. */
  depthAboveSupportM: number;
}

export interface SubstrateContact {
  x: number;
  z: number;
  ground: GroundContact;
  drive?: DriveContact;
  /** Nearest deck through its shoulder/fairing reach, even just outboard. */
  driveProximity?: DriveProximity;
  water?: WaterContact;
  /** Highest solid layer available to a ground vehicle at this x/z. */
  support: SupportContact;
  /** Exposed fluid above that support. Water below a bridge is not fluid contact. */
  fluid?: FluidContact;
  structure?: StructureContact;
  crossing?: CrossingKind;
  blockedWater: boolean;
}
