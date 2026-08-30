/** Public surface of drive's new, isolated hydro pipeline. */
export { createHydroSystem } from './system';
export { extractOsmHydro } from './osm';
export { pointInArea } from './geometry';
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
  HydroDebugView,
  HydroFeature,
  HydroFrame,
  HydroGeometry,
  HydroKind,
  HydroLevelModel,
  HydroPolygon,
  HydroSample,
  HydroTuning,
  HydroTileInput,
  OceanCoverage,
  PackedXZ,
  TileKey,
  WorldBounds,
} from './types';
