import { HydroBodyRegistry } from './body-registry';
import { analyseHydroTile, buildHydroTile } from './build-tile';
import { sampleFieldSurface } from './system';
import { extractOsmHydro } from './osm';
import {
  extractFlowingHydroShoreSegments,
  extractHydroShoreSegments,
} from './shore-contour';
import { sampleBankField, WATERLINE_CUT } from '../shoreline';
import { HYDRO_KIND_ID, type HydroFeature, type HydroTileInput } from './types';
import { HYDRO_FRAGMENT_SHADER, HYDRO_VERTEX_SHADER } from './shaders';
import { HYDRO_SCENE_SKY_GLSL } from './scene-sky';

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
  assert(!HYDRO_FRAGMENT_SHADER.includes('smoothstep(-0.04, 0.22'),
    'lighting no longer flips through the old narrow dawn/dusk gate');
  assert(HYDRO_FRAGMENT_SHADER.includes('reflectedSky')
    && HYDRO_FRAGMENT_SHADER.includes('terrainCoupling'),
  'surface colour continuously includes sky reflection and shallow terrain tint');
  assert(HYDRO_FRAGMENT_SHADER.includes('float waterF0 = 0.02')
    && HYDRO_FRAGMENT_SHADER.includes('(0.46 - waterF0)'),
  'water reflection uses a dielectric head-on baseline with the retained artistic grazing ceiling');
  assert(HYDRO_FRAGMENT_SHADER.includes('float absorption = mix(0.85, 1.55, turbidity)')
    && HYDRO_FRAGMENT_SHADER.includes('uAbsorptionStrength')
    && !HYDRO_FRAGMENT_SHADER.includes('mix(0.85, 0.30, turbidity)'),
  'suspended sediment shortens rather than lengthens the palette attenuation path');
  assert(HYDRO_FRAGMENT_SHADER.includes('float suspended = clamp(turbidity * uScatteringStrength')
    && HYDRO_FRAGMENT_SHADER.includes('float suspendedScattering'),
  'suspended scattering has an optical gain independent of absorption');
  assert(HYDRO_FRAGMENT_SHADER.includes('#ifdef HYDRO_SCENE_REFLECTION')
    && HYDRO_FRAGMENT_SHADER.includes('sceneReflectedSky(')
    && HYDRO_FRAGMENT_SHADER.includes('surfaceRoughness'),
  'the host sky is evaluated in the reflected direction with roughness-aware breakup');
  assert(HYDRO_SCENE_SKY_GLSL.includes('vec3 sceneReflectedSky(')
    && HYDRO_SCENE_SKY_GLSL.includes('clInLattice')
    && HYDRO_SCENE_SKY_GLSL.includes('uCsSunDisc'),
  'production and Hydrograph share one world-anchored cloud reflection evaluator');
  assert(HYDRO_FRAGMENT_SHADER.includes('vec3 colour = palette(kind, visualDepth, turbidity, terrainC)')
    && !HYDRO_FRAGMENT_SHADER.includes('visualDepth * (1.0 + 0.9 * overhead)'),
  'camera angle does not change the material water depth');
  assert(HYDRO_FRAGMENT_SHADER.includes('cobbleColour')
    && HYDRO_FRAGMENT_SHADER.includes('bedVisibility')
    && HYDRO_FRAGMENT_SHADER.includes('pebbleSpeck')
    && HYDRO_FRAGMENT_SHADER.includes('gravelMineral')
    && HYDRO_FRAGMENT_SHADER.includes('float bedMixCap = mix(0.95, 0.82, vFlowing)'),
  'clear shallows reveal a stable sediment, pebble and cobble bed');
  assert(!HYDRO_FRAGMENT_SHADER.includes('terrainC * 1.32')
    && !HYDRO_FRAGMENT_SHADER.includes('mix(1.12, 1.30, overhead)'),
  'flowing shallow beds stay in the local bank key instead of drawing a cream rim');
  assert(HYDRO_FRAGMENT_SHADER.includes('stoneCluster')
    && HYDRO_FRAGMENT_SHADER.includes('stoneGrain')
    && HYDRO_FRAGMENT_SHADER.includes('vec2 bedFlowP = bedP')
    && HYDRO_FRAGMENT_SHADER.includes('vec2(0.012, 0.026)'),
  'world-anchored mineral texture and river-aligned gravel bars retain production-scale structure');
  assert(HYDRO_FRAGMENT_SHADER.includes('float bedClass')
    && HYDRO_FRAGMENT_SHADER.includes('stonePresence')
    && HYDRO_FRAGMENT_SHADER.includes('siltSediment'),
  'the shader resolves canonical silt, sand, gravel, pebble and rock beds');
  assert(HYDRO_FRAGMENT_SHADER.includes('float bankClass')
    && HYDRO_FRAGMENT_SHADER.includes('mudBank')
    && HYDRO_FRAGMENT_SHADER.includes('edgeMaterial'),
  'the body edge resolves canonical soil, mud, gravel and rock material');
  const taggedBed = extractOsmHydro([{
    id: 7,
    tags: { waterway: 'stream', surface: 'bedrock', 'bank:material': 'gravel' },
    geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: .001 }],
  }], { project: (lat, lon) => [lon * 1000, lat * 1000] });
  assert(taggedBed[0]?.bedMaterial === 'rock',
    'OSM bed and surface tags enter the canonical bed-material contract');
  assert(taggedBed[0]?.bankMaterial === 'gravel',
    'OSM bank tags enter the canonical bank-material contract');
  assert(HYDRO_FRAGMENT_SHADER.includes('shallowRapid')
    && HYDRO_FRAGMENT_SHADER.includes('rapidChop')
    && HYDRO_FRAGMENT_SHADER.includes('rapidTongue')
    && HYDRO_FRAGMENT_SHADER.includes('tongueEnergy = max(energyGate, shallowRapid')
    && HYDRO_FRAGMENT_SHADER.includes('tongueReach = mix(0.38, 1.0, rapidReach)'),
  'shallow high-energy reaches receive coherent flow-aligned rapid tongues');
  assert(HYDRO_FRAGMENT_SHADER.includes('riverTransportSpeed')
    && HYDRO_FRAGMENT_SHADER.includes('float riverTransport = riverS')
    && HYDRO_FRAGMENT_SHADER.includes('riverTransport * 0.12')
    && HYDRO_FRAGMENT_SHADER.includes('along = riverTransport')
    && HYDRO_FRAGMENT_SHADER.includes('transportedDownstream = riverTransport'),
  'grain, current lanes and foam share one non-shearing river transport clock');
  assert(HYDRO_FRAGMENT_SHADER.includes('float foamSource = 0.0')
    && HYDRO_FRAGMENT_SHADER.includes('float energyRise')
    && HYDRO_FRAGMENT_SHADER.includes('float crestRise')
    && HYDRO_FRAGMENT_SHADER.includes('float constriction')
    && HYDRO_FRAGMENT_SHADER.includes('float foamAge'),
  'river foam begins from energy, shallow-crest, constriction and fall evidence before ageing downstream');
  assert(HYDRO_FRAGMENT_SHADER.includes('float slowFacet = cos(riverS * 0.22 + seed * 4.1)')
    && !HYDRO_FRAGMENT_SHADER.includes('riverS * 0.22 - uTime'),
  'standing rapid facets remain anchored while transported material crosses them');
  assert(HYDRO_FRAGMENT_SHADER.includes('mix(1.0, 0.3, smoothstep(0.9, 3.5, geometryField.a))')
    && HYDRO_FRAGMENT_SHADER.includes('vFlowing);'),
  'depth-based energy damping is restricted to the flowing regime');
  assert(HYDRO_FRAGMENT_SHADER.includes('float metresPerPixel')
    && HYDRO_FRAGMENT_SHADER.includes('float structurePixelLod')
    && HYDRO_FRAGMENT_SHADER.includes('float skinPixelLod')
    && HYDRO_FRAGMENT_SHADER.includes('float bedPixelLod'),
  'body, structure, skin and broad bed detail resolve against projected footprint');
  assert(HYDRO_VERTEX_SHADER.includes('float swellTransmission')
    && HYDRO_VERTEX_SHADER.includes('float localWindTransmission')
    && HYDRO_VERTEX_SHADER.includes('swellTransmission')
    && HYDRO_VERTEX_SHADER.includes('localWindTransmission'),
  'incoming swell and locally generated wind waves respond separately to coastal shelter');
  assert(HYDRO_VERTEX_SHADER.includes('vCoastProfile = 4.0')
    && HYDRO_VERTEX_SHADER.includes('float platformShelf')
    && HYDRO_VERTEX_SHADER.includes('float shoreReach')
    && HYDRO_VERTEX_SHADER.includes('cliffProfile * 0.28')
    && HYDRO_FRAGMENT_SHADER.includes('shingleProfile * 0.52'),
  'beach, shingle, platform, cliff and sheltered-inlet profiles have distinct depth, break and wash responses');
  assert(!HYDRO_FRAGMENT_SHADER.includes('trough *= mix(1.0, 0.48, pointBar)')
    && HYDRO_FRAGMENT_SHADER.includes('The large shelf is now cut into terrain'),
  'large point bars are terrain-owned while the water shader retains their mineral skin');
  assert(HYDRO_FRAGMENT_SHADER.includes('if (bedLod > 0.015)')
    && !HYDRO_FRAGMENT_SHADER.includes('if (nearWater) {\n    float clearDepthM'),
  'broad shallow-bed structure is no longer cut off by the shorter near-water branch');
  assert(HYDRO_FRAGMENT_SHADER.includes('riverEddyField')
    && HYDRO_FRAGMENT_SHADER.includes('riverEddyTone'),
  'bend-driven eddies affect both normals and restrained water tone');
  assert(HYDRO_FRAGMENT_SHADER.includes('rigTrailField')
    && HYDRO_FRAGMENT_SHADER.includes('uRigTrail[8]'),
  'recent wetted vehicle positions leave an ageing surface trail');
  assert(HYDRO_FRAGMENT_SHADER.includes('float sediment = 0.0')
    && HYDRO_FRAGMENT_SHADER.includes('float sedimentPlume')
    && HYDRO_FRAGMENT_SHADER.includes('float softBed'),
  'vehicle history raises a delayed sediment plume over soft beds');
  assert(HYDRO_FRAGMENT_SHADER.includes('dropJitter')
    && HYDRO_FRAGMENT_SHADER.includes('float cadence')
    && HYDRO_FRAGMENT_SHADER.includes('uRain * (1.0 - skinPixelLod)'),
  'rain impacts jitter in position and cadence and retire into aggregate roughness');
  assert(HYDRO_VERTEX_SHADER.includes('vShoreCycle = shorePhase')
    && HYDRO_FRAGMENT_SHADER.includes('float recentlyWashed')
    && HYDRO_FRAGMENT_SHADER.includes('vec3 wetTerrain'),
  'retreating surf retains a phase-history wet strip over exposed terrain');
  assert(!HYDRO_FRAGMENT_SHADER.includes('edgeDither'),
    'river coverage does not duplicate the global dither pipeline');
  assert(HYDRO_FRAGMENT_SHADER.includes('#ifdef HYDRO_EDGE_BLEND')
    && HYDRO_FRAGMENT_SHADER.includes('waterBlend = mix(1.0, waterBlend'),
  'inland bank cohesion is a controllable blend inside the single water body');
  assert(HYDRO_FRAGMENT_SHADER.includes('vec3 edgeGround = mix(terrainC')
    && HYDRO_FRAGMENT_SHADER.includes('float riverFadeM = clamp(1.65')
    && HYDRO_FRAGMENT_SHADER.includes('min(bankMetres, geometryField.g)')
    && HYDRO_FRAGMENT_SHADER.includes('coverageInterior = smoothstep(bodyCut'),
  'river edges use the rendered coverage contour before widening into shallows');
  assert(!HYDRO_FRAGMENT_SHADER.includes('edgeDither'),
    'bank feather does not implement local dithering');
  assert(HYDRO_FRAGMENT_SHADER.includes(
    '(bankPatch(vAbsoluteXZ) - 0.5) * 0.08',
  ), 'rendered inland waterline uses the shared narrow contour perturbation');
  const riverCut = WATERLINE_CUT(123.4, 456.7, 'river');
  assert(riverCut >= 0.46 && riverCut <= 0.54,
    `CPU inland waterline stays close to the canonical contour (saw ${riverCut})`);
  const coastalMain = HYDRO_FRAGMENT_SHADER.indexOf('bool coastalKind');
  const terrainDeclaration = HYDRO_FRAGMENT_SHADER.indexOf(
    'vec3 terrainC = uTerrainColour', coastalMain,
  );
  const surfBranch = HYDRO_FRAGMENT_SHADER.indexOf('#ifdef HYDRO_SURF', coastalMain);
  assert(coastalMain >= 0 && terrainDeclaration > coastalMain && terrainDeclaration < surfBranch,
    'terrain colour is declared for both coastal surf and inland shader variants');

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
    id: 'osm:river', source: 'osm', kind: 'river', intermittent: true, tidal: true,
    bedMaterial: 'pebble',
    bankMaterial: 'rock',
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
  assert(riverRegistry.get(river.id)?.bedMaterial === 'pebble',
    'registry preserves explicit categorical bed material');
  assert(riverRegistry.get(river.id)?.bankMaterial === 'rock',
    'registry preserves explicit categorical bank material');
  const riverField = buildHydroTile(riverInput, riverRegistry, riverAnalysis, { fieldResolution: 128 });
  assert(riverField.ground.length === riverField.width * riverField.height
    && riverField.ground.every(Number.isFinite),
  'the immutable field carries finite terrain elevation at every texel');
  const shoreSegments = extractHydroShoreSegments(riverField);
  assert(shoreSegments.length > 8
    && shoreSegments.every((segment) =>
      Number.isFinite(segment.a.groundM)
      && Number.isFinite(segment.b.groundM)
      && Math.hypot(segment.b.x - segment.a.x, segment.b.z - segment.a.z) > 0),
  'coverage extraction produces finite terrain-attached shoreline segments');
  const flowingShoreSegments = extractFlowingHydroShoreSegments(
    riverField,
    .5,
    true,
  );
  assert(flowingShoreSegments.length >= shoreSegments.length
    && flowingShoreSegments.every((segment) =>
      Number.isFinite(segment.a.x)
      && Number.isFinite(segment.a.z)
      && Number.isFinite(segment.b.x)
      && Number.isFinite(segment.b.z)),
  'flowing terrain contours preserve the river shoreline through the gutter pass');
  const riverSample = sampleFieldSurface(riverField, 300, 300, .1);
  assert(riverSample?.bedMaterial === 'pebble',
    'packed field samples preserve explicit bed material');
  assert(riverSample?.bankMaterial === 'rock',
    'packed field samples preserve explicit bank material');
  assert(riverSample?.intermittent && riverSample.tidal,
    'packed bed and bank classes do not corrupt intermittent and tidal flags');
  let dryBankDistance = -1;
  for (let iz = riverField.gutter; iz < riverField.gutter + riverField.resolution; iz++) {
    for (let ix = riverField.gutter; ix < riverField.gutter + riverField.resolution; ix++) {
      const i = iz * riverField.width + ix;
      if (riverField.geometry[i * 4] >= 0.5) continue;
      const x = riverField.bounds.minX
        + ((ix - riverField.gutter + 0.5) / riverField.resolution) * 600;
      const z = riverField.bounds.minZ
        + ((iz - riverField.gutter + 0.5) / riverField.resolution) * 600;
      const bank = sampleBankField(riverField, x, z, 12);
      if (bank && !bank.wet) {
        dryBankDistance = bank.shoreDistanceM;
        break;
      }
    }
    if (dryBankDistance >= 0) break;
  }
  assert(dryBankDistance > 0 && dryBankDistance <= 12,
    `dry bank reports positive metre distance to water (saw ${dryBankDistance})`);
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

  const culvertInput: HydroTileInput = {
    ...riverInput,
    key: 'test/culvert',
    surfaceOccluders: [{
      kind: 'culvert',
      x: 300,
      z: 300,
      roadTangent: [1, 0],
      roadHalfWidthM: 8,
      halfLengthM: 12,
    }],
  };
  const culvertAnalysis = analyseHydroTile(culvertInput);
  const culvertRegistry = new HydroBodyRegistry(0);
  culvertRegistry.updateTile(culvertInput.key, culvertAnalysis.observations);
  const culvertField = buildHydroTile(
    culvertInput, culvertRegistry, culvertAnalysis, { fieldResolution: 128 },
  );
  assert(!sampleFieldSurface(culvertField, 300, 300, .5),
    'culvert structure suppresses the visible free surface under the road');
  assert(!!sampleFieldSurface(culvertField, 300, 250, .5),
    'culvert mouths retain open water beyond the carriageway');

  // ── A SUB-TEXEL DIAGONAL IS STILL ONE RIVER ── production field texels are
  // ~18.75m across while an unnamed stream defaults to 4m. If its visual mask
  // marks only diagonal texels, those cells touch at corners and the shader's
  // 0.5 cutoff tears the stream into islands. The raster must be 4-connected;
  // its structure field still carries the authored 2m half-width.
  const diagonal: HydroFeature = {
    id: 'osm:diagonal', source: 'osm', kind: 'stream', intermittent: false, tidal: false,
    geometry: { type: 'line', widthM: 4, points: ring(70, 70, 530, 530) },
  };
  const diagonalInput = constantInput([diagonal], 20);
  const diagonalAnalysis = analyseHydroTile(diagonalInput);
  const diagonalRegistry = new HydroBodyRegistry(0);
  diagonalRegistry.updateTile(diagonalInput.key, diagonalAnalysis.observations);
  const diagonalField = buildHydroTile(
    diagonalInput, diagonalRegistry, diagonalAnalysis, { fieldResolution: 32 },
  );
  const diagonalWet = new Uint8Array(diagonalField.width * diagonalField.height);
  let firstWet = -1;
  for (let i = 0; i < diagonalWet.length; i++) {
    diagonalWet[i] = diagonalField.geometry[i * 4] >= 0.5 ? 1 : 0;
    if (firstWet < 0 && diagonalWet[i]) firstWet = i;
  }
  assert(firstWet >= 0, 'sub-texel diagonal stream reaches the visible cutoff');
  const visited = new Uint8Array(diagonalWet.length);
  const queue = [firstWet];
  visited[firstWet] = 1;
  let reached = 0;
  while (queue.length) {
    const i = queue.pop() as number;
    reached++;
    const x = i % diagonalField.width;
    const z = Math.floor(i / diagonalField.width);
    for (const n of [
      x > 0 ? i - 1 : -1,
      x + 1 < diagonalField.width ? i + 1 : -1,
      z > 0 ? i - diagonalField.width : -1,
      z + 1 < diagonalField.height ? i + diagonalField.width : -1,
    ]) {
      if (n >= 0 && diagonalWet[n] && !visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  const visibleDiagonal = diagonalWet.reduce((sum, wet) => sum + wet, 0);
  assert(reached === visibleDiagonal,
    `sub-texel diagonal mask is 4-connected (${reached}/${visibleDiagonal} texels)`);
  let transition = -1;
  for (let i = 0; i < diagonalWet.length; i++) {
    const coverage = diagonalField.geometry[i * 4];
    if (coverage > .02 && coverage < .98
      && diagonalField.material[i * 4] === HYDRO_KIND_ID.stream) {
      transition = i;
      break;
    }
  }
  assert(transition >= 0, 'diagonal stream retains a fractional shoreline texel');
  if (transition >= 0) {
    const ix = transition % diagonalField.width;
    const iz = Math.floor(transition / diagonalField.width);
    const x = diagonalField.bounds.minX
      + (ix - diagonalField.gutter + 0.5) / diagonalField.resolution
      * (diagonalField.bounds.maxX - diagonalField.bounds.minX);
    const z = diagonalField.bounds.minZ
      + (iz - diagonalField.gutter + 0.5) / diagonalField.resolution
      * (diagonalField.bounds.maxZ - diagonalField.bounds.minZ);
    const coverage = diagonalField.geometry[transition * 4];
    assert(!!sampleFieldSurface(diagonalField, x, z, coverage - .01),
      'CPU sampling admits a shoreline texel below its caller-owned cut');
    assert(!sampleFieldSurface(diagonalField, x, z, coverage + .01),
      'CPU sampling rejects the same shoreline texel above its caller-owned cut');
  }
  if (diagonalField.structure) {
    const wet = diagonalWet.findIndex(Boolean);
    assert(Math.abs(diagonalField.structure[wet * 4 + 3] - 2) < 0.01,
      'visual continuity does not widen the authored river-space width');
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
  assert(island === 0, 'a disconnected fragment starts at zero until topology connects it');

  // OSM way ids are editing identities, not river identities. Directly
  // touching ways chain geometrically across ids.
  const networkRegistry = new HydroBodyRegistry(0);
  const firstWay = networkRegistry.riverSpanS0('osm:101', 0, 0, 0, 500, 500);
  const secondWay = networkRegistry.riverSpanS0('osm:202', 0, 500, 0, 900, 400);
  assert(firstWay === 0 && secondWay === 500,
    `connected OSM ways share chainage across ids (${firstWay}, ${secondWay})`);

  // Arrival order cannot leave the old permanent seam. Install both sides as
  // islands, then the missing middle: the downstream component is translated
  // and exposed for rebuild.
  const lateRegistry = new HydroBodyRegistry(0);
  lateRegistry.riverSpanS0('osm:up', 0, 0, 0, 400, 400);
  lateRegistry.riverSpanS0('osm:down', 0, 800, 0, 1200, 400);
  const bridgeS = lateRegistry.riverSpanS0('osm:bridge', 0, 400, 0, 800, 400);
  const downstreamAgain = lateRegistry.riverSpanS0('osm:down', 0, 800, 0, 1200, 400);
  const rebased = lateRegistry.consumeRiverSpanChanges();
  assert(bridgeS === 400 && downstreamAgain === 800,
    `late bridge heals both joins (${bridgeS}, ${downstreamAgain})`);
  assert(rebased.has('osm:down'), 'late join invalidates the rebased downstream body');

  // A riverbank polygon borrows the nearby centreline's river chart. Probe
  // well outside the nominal 8m line: s must still advance and n must retain
  // a signed, non-zero cross-channel coordinate.
  const areaLine: HydroFeature = {
    id: 'osm:centre', source: 'osm', kind: 'river', intermittent: false, tidal: false,
    geometry: { type: 'line', widthM: 8, points: ring(300, 40, 300, 560) },
  };
  const areaRiver: HydroFeature = {
    id: 'osm:bank', source: 'osm', kind: 'river', intermittent: false, tidal: false,
    geometry: { type: 'area', polygons: [{
      outer: ring(210, 30, 390, 30, 390, 570, 210, 570), holes: [],
    }] },
  };
  const areaInput = constantInput([areaLine, areaRiver], 0);
  const areaAnalysis = analyseHydroTile(areaInput);
  const areaRegistry = new HydroBodyRegistry(0);
  areaRegistry.updateTile(areaInput.key, areaAnalysis.observations);
  const areaField = buildHydroTile(areaInput, areaRegistry, areaAnalysis, { fieldResolution: 128 });
  assert(!!areaField.structure, 'river area with centreline carries river space');
  if (areaField.structure) {
    const at = (x: number, z: number): number => {
      const ix = areaField.gutter + Math.round((x / 600) * (areaField.resolution - 1));
      const iz = areaField.gutter + Math.round((z / 600) * (areaField.resolution - 1));
      return iz * areaField.width + ix;
    };
    const areaUp = at(365, 160), areaDown = at(365, 440);
    const areaS = areaField.structure[areaDown * 4] - areaField.structure[areaUp * 4];
    assert(areaS > 250 && areaS < 310, `river area follows centreline s (saw ${areaS})`);
    assert(Math.abs(areaField.structure[areaUp * 4 + 1]) > 0.5,
      'river area retains cross-channel position away from the nominal line');
  }

  const bodyRegistry = new HydroBodyRegistry(0);
  const observation = pondAnalysis.observations[0];
  bodyRegistry.updateTile('a', [{ ...observation, tileKey: 'a', candidateLevelM: 10, taggedLevelM: undefined }]);
  bodyRegistry.updateTile('b', [{ ...observation, tileKey: 'b', candidateLevelM: 12, taggedLevelM: undefined }]);
  const shared = bodyRegistry.get(observation.id);
  assert(shared?.level.type === 'flat' && Math.abs(shared.level.elevationM - 11) < 0.01,
    'cross-tile body level uses shared robust evidence');
}
