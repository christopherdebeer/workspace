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
  const riverAnalysis = analyseHydroTile(riverInput);
  const profile = riverAnalysis.profiles.get(river.id);
  assert(!!profile && profile.length >= 12, 'river receives a longitudinal profile');
  if (profile) for (let i = 5; i < profile.length; i += 3) {
    assert(profile[i] <= profile[i - 3] + 1e-4, 'river profile is monotone downstream');
  }
  // ── THE SPINE IS RESAMPLED ── station spacing is a property of the build,
  // not of whichever node density the mapper's hand produced. The fixture's
  // 440m line at 8m width resamples near the 10m floor; every interior gap
  // must be uniform (endpoints are kept exactly, so the last gap may differ
  // by under one station).
  if (profile) {
    const n = profile.length / 3;
    assert(n > 20, 'resampling densifies a sparse OSM line');
    const gaps: number[] = [];
    for (let i = 1; i < n; i++) {
      gaps.push(Math.hypot(profile[i * 3] - profile[(i - 1) * 3],
        profile[i * 3 + 1] - profile[(i - 1) * 3 + 1]));
    }
    const spread = Math.max(...gaps) - Math.min(...gaps);
    assert(spread < 1, `stations are evenly spaced (spread ${spread.toFixed(3)}m)`);
  }

  // ── RIVER SPACE, PER TEXEL ── the structure field must exist for a flowing
  // tile, s must grow DOWNSTREAM along the channel, and n must change sign
  // across it. The fixture river runs north-south down a southward slope, so
  // downstream is +z and s should increase with z.
  const riverRegistry = new HydroBodyRegistry(0);
  riverRegistry.updateTile(riverInput.key, riverAnalysis.observations);
  const riverField = buildHydroTile(riverInput, riverRegistry, riverAnalysis, { fieldResolution: 128 });
  assert(!!riverField.structure, 'a flowing tile carries the structure field');
  if (riverField.structure) {
    const st = riverField.structure;
    const texelAt = (x: number, z: number): number => {
      const u = (x - riverInput.bounds.minX) / 600, v = (z - riverInput.bounds.minZ) / 600;
      const ix = riverField.gutter + Math.round(u * (riverField.resolution - 1));
      const iz = riverField.gutter + Math.round(v * (riverField.resolution - 1));
      return iz * riverField.width + ix;
    };
    const up = texelAt(300, 120), down = texelAt(300, 480);
    assert(riverField.geometry[up * 4] >= 0.5 && riverField.geometry[down * 4] >= 0.5,
      'both probe texels are wet');
    const dS = st[down * 4] - st[up * 4];
    assert(Math.abs(dS - 360) < 12,
      `s advances by channel distance downstream (saw ${dS.toFixed(1)}m for 360m)`);
    // n is signed: texels either side of the centreline disagree in sign.
    const left = texelAt(297, 300), right = texelAt(303, 300);
    assert(st[left * 4 + 1] * st[right * 4 + 1] < 0,
      `n changes sign across the channel (saw ${st[left * 4 + 1].toFixed(2)} / ${st[right * 4 + 1].toFixed(2)})`);
    assert(Math.abs(st[up * 4 + 3] - 4) < 0.01, 'half-width rides in the fourth channel');
  }

  // ── A BEND DOES NOT BREAK s ── an L-shaped river's s keeps counting along
  // the channel through the corner: between a texel before the bend and one
  // after it, s advances by the PATH distance, not the world-axis projection
  // that the old dot(position, direction) phase amounted to.
  const bendSlope = new Float32Array(16 * 16);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) bendSlope[z * 16 + x] = 60 - (x + z);
  const bend: HydroFeature = {
    id: 'osm:bend', source: 'osm', kind: 'river', intermittent: false, tidal: false,
    geometry: { type: 'line', widthM: 8, points: ring(100, 100, 100, 300, 120, 320, 300, 320) },
  };
  const bendInput = { ...constantInput([bend], 0), elevation: { width: 16, height: 16, data: bendSlope } };
  const bendAnalysis = analyseHydroTile(bendInput);
  const bendRegistry = new HydroBodyRegistry(0);
  bendRegistry.updateTile(bendInput.key, bendAnalysis.observations);
  const bendField = buildHydroTile(bendInput, bendRegistry, bendAnalysis, { fieldResolution: 128 });
  assert(!!bendField.structure, 'the bend tile carries structure');
  if (bendField.structure) {
    const st = bendField.structure;
    const texelAt = (x: number, z: number): number => {
      const ix = bendField.gutter + Math.round((x / 600) * (bendField.resolution - 1));
      const iz = bendField.gutter + Math.round((z / 600) * (bendField.resolution - 1));
      return iz * bendField.width + ix;
    };
    const before = texelAt(100, 150), after = texelAt(250, 320);
    assert(bendField.geometry[before * 4] >= 0.5 && bendField.geometry[after * 4] >= 0.5,
      'bend probe texels are wet');
    // Path distance (100,150) → corner arc → (250,320): ~150 + ~28.3 + ~130.
    const dS = st[after * 4] - st[before * 4];
    assert(dS > 280 && dS < 330,
      `s follows the channel around the bend (saw ${dS.toFixed(1)}m for ~308m of path)`);
    // The corner has curvature; the straights effectively none.
    const corner = texelAt(108, 312), straight = texelAt(100, 200);
    assert(Math.abs(st[corner * 4 + 2]) > Math.abs(st[straight * 4 + 2]) + 1e-4,
      `the bend carries more curvature than the straight (${st[corner * 4 + 2].toFixed(4)} vs ${st[straight * 4 + 2].toFixed(4)})`);
  }

  // ── FRAGMENTS SHARE ONE s ── the registry chains spans by endpoint: a
  // fragment whose head meets an installed tail continues its count; a
  // fragment whose tail meets an installed head extends upstream, negative;
  // and NOBODY is ever renumbered by a later arrival.
  const spanRegistry = new HydroBodyRegistry(0);
  const a0 = spanRegistry.riverSpanS0('osm:way', 0, 0, 0, 500, 500);
  assert(a0 === 0, 'the first fragment starts its own count');
  const b0 = spanRegistry.riverSpanS0('osm:way', 0, 500, 0, 900, 400);
  assert(b0 === 500, `a downstream continuation picks up the count (saw ${b0})`);
  const c0 = spanRegistry.riverSpanS0('osm:way', 0, -300, 0, 0, 300);
  assert(c0 === -300, `an upstream extension counts backward (saw ${c0})`);
  const aAgain = spanRegistry.riverSpanS0('osm:way', 0, 0, 0, 500, 500);
  assert(aAgain === 0, 'a re-registered fragment keeps its s0 — nobody is renumbered');
  const island = spanRegistry.riverSpanS0('osm:way', 5000, 5000, 5000, 5400, 400);
  assert(island === 0, 'a disconnected fragment starts at zero, harmlessly');

  const bodyRegistry = new HydroBodyRegistry(0);
  const observation = pondAnalysis.observations[0];
  bodyRegistry.updateTile('a', [{ ...observation, tileKey: 'a', candidateLevelM: 10, taggedLevelM: undefined }]);
  bodyRegistry.updateTile('b', [{ ...observation, tileKey: 'b', candidateLevelM: 12, taggedLevelM: undefined }]);
  const shared = bodyRegistry.get(observation.id);
  assert(shared?.level.type === 'flat' && Math.abs(shared.level.elevationM - 11) < 0.01,
    'cross-tile body level uses shared robust evidence');
}
