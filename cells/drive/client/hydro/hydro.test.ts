import { HydroBodyRegistry } from './body-registry';
import { analyseHydroTile, buildHydroTile } from './build-tile';
import { HYDRO_KIND_ID, type HydroFeature, type HydroTileInput } from './types';

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(`hydro self-test: ${message}`);
};

const ring = (...xz: number[]): Float64Array => new Float64Array(xz);

function constantInput(features: HydroFeature[], elevationM = -85): HydroTileInput {
  return {
    key: 'test/0/0',
    revision: 1,
    bounds: { minX: 0, minZ: 0, maxX: 600, maxZ: 600 },
    elevation: { width: 16, height: 16, data: new Float32Array(16 * 16).fill(elevationM) },
    features,
    oceanCoverage: { status: 'unavailable' },
  };
}

export function runHydroSelfTest(): void {
  const pond: HydroFeature = {
    id: 'osm:pond', source: 'osm', kind: 'pond', taggedLevelM: -84.7,
    intermittent: false, tidal: false,
    geometry: {
      type: 'area', polygons: [{ holes: [], outer: ring(
        294, 294, 306, 294, 306, 306, 294, 306,
      ) }],
    },
  };
  const pondInput = constantInput([pond]);
  const pondAnalysis = analyseHydroTile(pondInput);
  const registry = new HydroBodyRegistry(0);
  registry.updateTile(pondInput.key, pondAnalysis.observations);
  const pondField = buildHydroTile(pondInput, registry, pondAnalysis, { fieldResolution: 128 });
  assert(pondField.hasWater, 'a sub-mesh-quad pond survives field rasterisation');
  let pondPixel = -1;
  for (let i = 0; i < pondField.width * pondField.height; i++) {
    if (pondField.geometry[i * 4] >= 0.5) { pondPixel = i; break; }
  }
  assert(pondPixel >= 0, 'pond has a covered fragment');
  assert(pondField.material[pondPixel * 4] === HYDRO_KIND_ID.pond, 'pond retains its material class');
  assert(Math.abs(pondField.elevationBaseM + pondField.geometry[pondPixel * 4 + 2] + 84.7) < 0.02,
    'negative inland level is preserved independently of ocean level');

  const lakeWithIsland: HydroFeature = {
    id: 'osm:lake', source: 'osm', kind: 'lake', taggedLevelM: 12,
    intermittent: false, tidal: false,
    geometry: {
      type: 'area', polygons: [{
        outer: ring(100, 100, 500, 100, 500, 500, 100, 500),
        holes: [ring(250, 250, 350, 250, 350, 350, 250, 350)],
      }],
    },
  };
  const lakeInput = constantInput([lakeWithIsland], 10);
  const lakeAnalysis = analyseHydroTile(lakeInput);
  registry.updateTile(lakeInput.key, lakeAnalysis.observations);
  const lakeField = buildHydroTile(lakeInput, registry, lakeAnalysis, { fieldResolution: 128 });
  const centre = lakeField.gutter + Math.round(0.5 * (lakeField.resolution - 1));
  const centreIndex = centre * lakeField.width + centre;
  assert(lakeField.geometry[centreIndex * 4] < 0.5, 'multipolygon inner ring remains dry');

  const slope = new Float32Array(16 * 16);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) slope[z * 16 + x] = 40 - z * 2;
  const river: HydroFeature = {
    id: 'osm:river', source: 'osm', kind: 'river', intermittent: false, tidal: false,
    geometry: { type: 'line', widthM: 8, points: ring(300, 80, 300, 220, 300, 380, 300, 520) },
  };
  const riverInput = { ...constantInput([river], 0), elevation: { width: 16, height: 16, data: slope } };
  const profile = analyseHydroTile(riverInput).profiles.get(river.id);
  assert(!!profile && profile.length === 12, 'river receives a longitudinal profile');
  if (profile) for (let i = 5; i < profile.length; i += 3) {
    assert(profile[i] <= profile[i - 3] + 1e-4, 'river profile is monotone downstream');
  }

  const bodyRegistry = new HydroBodyRegistry(0);
  const observation = pondAnalysis.observations[0];
  bodyRegistry.updateTile('a', [{ ...observation, tileKey: 'a', candidateLevelM: 10, taggedLevelM: undefined }]);
  bodyRegistry.updateTile('b', [{ ...observation, tileKey: 'b', candidateLevelM: 12, taggedLevelM: undefined }]);
  const shared = bodyRegistry.get(observation.id);
  assert(shared?.level.type === 'flat' && Math.abs(shared.level.elevationM - 11) < 0.01,
    'cross-tile body level uses shared robust evidence');
}
