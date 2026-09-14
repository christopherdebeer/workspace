export { buildSubstrateTile, resolveCrossing, resolveCrossingKind, sampleSubstrate } from './kernel';
export { resolveFluidContact } from './contact';
export {
  adaptHydroSample,
  sampleHydroContactLayers,
  type HydroAdapterOptions,
  type HydroContactLayers,
} from './hydro-adapter';
export {
  SubstrateShadowMonitor,
  type LegacyFluidObservation,
  type ShadowCrossingObservation,
  type SubstrateCutoverGate,
  type SubstrateShadowObservation,
  type SubstrateShadowSnapshot,
} from './shadow';
export {
  pointInProductionCrossingFootprint,
  productionCrossingFootprint,
  ProductionCrossingRegistry,
  resolveProductionCrossing,
  resolveProductionCrossingIntent,
  navigableClearance,
  resolveProductionBridgeProfile,
  resolveProductionDeck,
  waterClearanceForClass,
  PRODUCTION_BRIDGE_CLEARANCE_M,
  PRODUCTION_BRIDGE_DECK_SAMPLE_STEP_M,
  PRODUCTION_BRIDGE_PORTAL_REACH_M,
  WET_CLEARANCE_MAX,
  WET_SPAN_RATIO,
  type CrossingAuthority,
  type DeckAuthority,
  type ProductionBridgeLiftSource,
  type ProductionBridgeProfileInput,
  type ProductionBridgeProfileResult,
  type ProductionDeckDecision,
  type ProductionDeckInput,
  type CrossingImplementation,
  type CrossingStructureOutcome,
  type ProductionCrossingEvidenceInput,
  type ProductionCrossingFootprint,
  type ProductionCrossingInput,
  type ProductionCrossingIntent,
  type ProductionCrossingKind,
  type ProductionCrossingRecord,
  type ProductionCrossingSnapshot,
} from './crossing-authority';
export {
  buildProductionSubstrateTile,
  findProductionDriveWaterOverlaps,
  ProductionSubstrateStore,
  sampleProductionSubstrateTile,
  type ProductionDriveSample,
  type ProductionDriveRenderMesh,
  type ProductionDriveSegment,
  type ProductionDriveWaterOverlap,
  type ProductionGroundMesh,
  type ProductionGroundSample,
  type ProductionHydroDetailCollider,
  type ProductionRenderAttribute,
  type ProductionRenderAttributeArray,
  type ProductionRenderGroup,
  type ProductionRenderMesh,
  type ProductionSubstrateLookup,
  type ProductionSubstrateStoreSnapshot,
  type ProductionSubstrateTile,
  type ProductionSubstrateTileInput,
  type ProductionWaterProbe,
  type ProductionWaterMotionSegment,
} from './production-tile';
export {
  SubstrateFallbackMonitor,
  type SubstrateContactConsumer,
  type SubstrateConsumerAvailability,
  type SubstrateFallbackSnapshot,
} from './availability';
export {
  resolveProductionSubstrateMode,
  type ProductionSubstrateMode,
  type ProductionSubstrateModeName,
} from './mode';
export { buildProductionHydroFixture } from './hydro-fixture';
export { makeCrossingFixture, type CrossingFixtureOptions } from './fixtures';
export {
  buildCulvertBoreGeometry,
  buildCulvertHeadwallGeometry,
  type CulvertBoreGeometry,
  type CulvertBoreInput,
  type CulvertHeadwallGeometry,
  type CulvertHeadwallInput,
  type CulvertStructureFamily,
} from './culvert-detail';
export {
  buildRapidDetailField,
  buildRapidDetailMesh,
  rapidDetailRandom,
  type RapidDetailCollider,
  type RapidDetailField,
  type RapidDetailMesh,
  type RapidDetailReachInput,
  type RapidDetailRock,
  type RapidDetailStoneFamily,
} from './rapid-detail';
export {
  VehicleWaterEvidence,
  type VehicleWaterAuthority,
  type VehicleWaterEvidenceInput,
  type VehicleWaterEvidenceSnapshot,
  type VehicleWaterStamp,
  type VehicleWaterStampKind,
  type VehicleWaterWheelSample,
} from './vehicle-water';
export * from './types';
