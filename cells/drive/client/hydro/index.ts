/** Public surface of drive's new, isolated hydro pipeline. */
export { createHydroSystem } from './system';
export { extractOsmHydro } from './osm';
export { pointInArea } from './geometry';
export { extractHydroShoreSegments } from './shore-contour';
export { HYDRO_FRAGMENT_SHADER, HYDRO_VERTEX_SHADER } from './shaders';

export type {
  HydroStats,
  HydroSystem,
  HydroSystemOptions,
  HydroTileBinding,
} from './system';
export type {
  ExtractOsmHydroOptions,
  OsmHydroElement,
  OsmHydroPoint,
} from './osm';
export type {
  CoverageGrid,
  ElevationGrid,
  HydroBody,
  HydroBankMaterial,
  HydroBedMaterial,
  HydroDebugView,
  HydroFeature,
  HydroFrame,
  HydroGeometry,
  HydroKind,
  HydroLevelModel,
  HydroPolygon,
  HydroSample,
  HydroSurfaceOccluder,
  HydroTuning,
  HydroTileInput,
  OceanCoverage,
  PackedXZ,
  TileKey,
  WorldBounds,
} from './types';
export type { HydroShorePoint, HydroShoreSegment } from './shore-contour';
