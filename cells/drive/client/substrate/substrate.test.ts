import {
  buildCulvertBoreGeometry,
  buildCulvertHeadwallGeometry,
  buildProductionHydroFixture,
  buildProductionSubstrateTile,
  buildRapidDetailField,
  buildRapidDetailMesh,
  buildSubstrateTile,
  makeCrossingFixture,
  pointInProductionCrossingFootprint,
  productionCrossingFootprint,
  ProductionCrossingRegistry,
  ProductionSubstrateStore,
  resolveFluidContact,
  resolveCrossingKind,
  resolveProductionCrossing,
  resolveProductionCrossingIntent,
  sampleHydroContactLayers,
  sampleProductionSubstrateTile,
  sampleSubstrate,
  SubstrateShadowMonitor,
  VehicleWaterEvidence,
} from './index';
import type {
  CrossingKind,
  ResolvedSubstrateTile,
  SubstrateContact,
} from './types';

const fail = (message: string): never => {
  throw new Error(message);
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) fail(message);
};

const close = (actual: number, expected: number, tolerance: number, message: string): void => {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    fail(`${message}: expected ${expected} ± ${tolerance}, saw ${actual}`);
  }
};

const at = (tile: ResolvedSubstrateTile, x: number, z: number): SubstrateContact => {
  const contact = sampleSubstrate(tile, x, z);
  assert(contact, `expected a substrate contact at ${x}, ${z}`);
  return contact;
};

const sameArray = (
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  message: string,
): void => {
  assert(a.length === b.length, `${message}: lengths differ`);
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) fail(`${message}: index ${i} differs (${a[i]} / ${b[i]})`);
  }
};

function assertNumericallySafe(tile: ResolvedSubstrateTile): void {
  assert(tile.schemaVersion === 1, 'tile schema version must be explicit');
  for (const y of tile.groundY) assert(Number.isFinite(y), 'ground must always be finite');
  for (const values of [tile.driveY, tile.waterY, tile.waterBedY]) {
    for (const value of values) {
      assert(Number.isFinite(value) || Number.isNaN(value), 'optional layers may only be finite or NaN');
    }
  }
  for (const value of tile.waterSpeedMps) assert(Number.isFinite(value), 'water speed must be finite');
  for (const value of tile.waterShoreDistanceM) {
    assert(Number.isFinite(value), 'water shore distance must be finite');
  }
  for (const value of tile.waterEnergy) {
    assert(Number.isFinite(value) && value >= 0 && value <= 1, 'water energy must be normalised');
  }
  for (const value of tile.waterVorticity) assert(Number.isFinite(value), 'vorticity must be finite');
}

function assertCrossing(kind: CrossingKind): ResolvedSubstrateTile {
  const tile = buildSubstrateTile(makeCrossingFixture(kind));
  assertNumericallySafe(tile);
  assert(tile.crossing.kind === kind, `${kind}: crossing kind was not retained`);
  assert(tile.bedMaterial === 'pebble', `${kind}: bed material was lost`);
  assert(tile.bankMaterial === 'gravel', `${kind}: bank material was lost`);
  close(tile.roadQuality, .9, 1e-6, `${kind}: road quality was lost`);

  const centre = at(tile, 0, 0);
  assert(centre.crossing === kind, `${kind}: centre is not classified as the crossing`);
  assert(centre.drive, `${kind}: crossing has no drivable layer`);
  assert(centre.support.kind === 'drive', `${kind}: road must be the support layer`);
  assert(centre.support.featureId === tile.roadId, `${kind}: support lost road identity`);
  close(centre.drive.quality, kind === 'ford' ? .495 : .9, 1e-5, `${kind}: contact quality`);

  const river = at(tile, 0, 34);
  assert(!river.drive, `${kind}: river away from the crossing acquired a road`);
  assert(river.water?.bankMaterial === 'gravel',
    `${kind}: water contact lost canonical bank material`);
  assert(river.water?.exposed, `${kind}: ordinary river must remain exposed`);
  assert(river.fluid && river.fluid.depthAboveSupportM > .2,
    `${kind}: ordinary river must immerse a ground-supported probe`);
  assert(river.water.speedMps !== null, `${kind}: resolved water must own flow speed`);
  close(river.water.speedMps, 1.25, 1e-5, `${kind}: flow speed`);

  const road = at(tile, 34, 0);
  assert(road.drive, `${kind}: road away from the crossing disappeared`);
  assert(!road.water && !road.fluid, `${kind}: dry road acquired fluid contact`);
  assert(!road.crossing, `${kind}: crossing mask leaked down the approach`);
  assert(sampleSubstrate(tile, 90, 0) === undefined, `${kind}: bounds gate failed`);
  return tile;
}

/**
 * Pure invariants for the architectural proof. The same fixture builder and
 * kernel are imported by /lab/substrate, so a passing test and a convincing
 * lab are inspecting one implementation rather than parallel demonstrations.
 */
export function runSubstrateSelfTest(): void {
  const culvertBore = buildCulvertBoreGeometry({
    stations: [[0, 0], [10, 0], [20, 0]],
    invertY: [1, .8, .6],
    offsets: [[0, 2], [0, 2], [0, 2]],
    start: 0,
    end: 2,
    heightM: 1.5,
    family: 'box',
  });
  const twinCulvertBore = buildCulvertBoreGeometry({
    stations: [[0, 0], [10, 0], [20, 0]],
    invertY: [1, .8, .6],
    offsets: [[0, 2], [0, 2], [0, 2]],
    start: 0,
    end: 2,
    heightM: 1.5,
    family: 'twin-cell',
  });
  assert(culvertBore.positions.length === 108
    && twinCulvertBore.positions.length === 144,
  'culvert builder must author three shell faces plus an optional divider');
  close(culvertBore.lengthM, 20, 1e-6,
    'culvert builder must retain exact run length');
  assert([...culvertBore.positions, ...twinCulvertBore.positions]
    .every(Number.isFinite),
  'culvert geometry must remain numerically safe');
  const headwall = buildCulvertHeadwallGeometry({
    x: 4,
    z: -3,
    bottomY: 1,
    topY: 3,
    widthM: 5,
    depthM: .7,
    rotationY: Math.PI / 3,
  });
  assert(headwall?.positions.length === 72
    && headwall.normals.length === 72
    && headwall.uvs.length === 48
    && headwall.index.length === 36,
  'culvert headwall must retain indexed textured box topology');
  assert([
    ...(headwall?.positions ?? []),
    ...(headwall?.normals ?? []),
    ...(headwall?.uvs ?? []),
    ...(headwall?.index ?? []),
  ].every(Number.isFinite),
  'culvert headwall geometry must remain numerically safe');
  assert(buildCulvertHeadwallGeometry({
    x: 0,
    z: 0,
    bottomY: 1,
    topY: 1.1,
    widthM: 5,
    depthM: .7,
    rotationY: 0,
  }) === undefined,
  'culvert headwall must not exceed a constrained deck ceiling');

  const rapidStations = Array.from(
    { length: 20 },
    (_, index) => [index * 10, 0] as const,
  );
  const rapidFieldInput = {
    stations: rapidStations,
    offsets: rapidStations.map(() => [0, 4] as const),
    invertY: rapidStations.map((_, index) =>
      20 - index * .1 - (index >= 10 ? 4 : 0)),
    speedMps: rapidStations.map(() => 2.8),
    widthM: 8,
    downhillInArrayOrder: true,
  };
  const rapidFieldA = buildRapidDetailField(rapidFieldInput);
  const rapidFieldB = buildRapidDetailField(rapidFieldInput);
  assert(JSON.stringify(rapidFieldA.rocks) === JSON.stringify(rapidFieldB.rocks),
    'rapid placement witnesses must be deterministic');
  sameArray(rapidFieldA.foamPositive, rapidFieldB.foamPositive,
    'positive-bank rapid foam must be deterministic');
  sameArray(rapidFieldA.foamNegative, rapidFieldB.foamNegative,
    'negative-bank rapid foam must be deterministic');
  assert(rapidFieldA.rocks.length > 0,
    'high-energy reach must resolve solid rapid witnesses');
  assert(
    [...rapidFieldA.foamPositive, ...rapidFieldA.foamNegative]
      .some((value) => value > 1),
    'rock wakes and waterfall aeration must enter the shared foam field',
  );

  const rapidRocks = [{
    station: 3,
    sequence: 1,
    stationX: 12,
    stationZ: -8,
    x: 13.5,
    z: -7.25,
    radiusM: .8,
    topY: 2.4,
    baseY: 1.1,
    spin: .35,
    tone: .91,
    across: .2,
  }];
  const rapidDetailA = buildRapidDetailMesh(
    rapidRocks,
    [0.075, 0.02, 0.02, 0.05, 0.30, 0.15],
  );
  const rapidDetailB = buildRapidDetailMesh(
    rapidRocks,
    [0.075, 0.02, 0.02, 0.05, 0.30, 0.15],
  );
  sameArray(rapidDetailA.positions, rapidDetailB.positions,
    'rapid-bed positions must be deterministic');
  sameArray(rapidDetailA.colours, rapidDetailB.colours,
    'rapid-bed geology colour must be deterministic');
  assert(rapidDetailA.positions.length === 54
    && rapidDetailA.colours.length === 54,
  'one rapid rock must author six triangular facets');
  assert(rapidDetailA.colliders.length === 1
    && rapidDetailA.colliders[0].x === rapidRocks[0].x
    && rapidDetailA.colliders[0].z === rapidRocks[0].z
    && rapidDetailA.colliders[0].radiusM === rapidRocks[0].radiusM,
  'rapid-bed packet and collider must derive from one rock witness');
  assert([...rapidDetailA.positions, ...rapidDetailA.colours]
    .every(Number.isFinite),
  'rapid-bed geometry must remain numerically safe');

  const bridge = assertCrossing('bridge');
  const bridgeCentre = at(bridge, 0, 0);
  assert(bridgeCentre.water?.exposed, 'bridge must preserve the exposed river below');
  assert(!bridgeCentre.fluid, 'water below a bridge deck is not vehicle fluid contact');
  assert(bridgeCentre.structure?.kind === 'bridge-deck', 'bridge deck structure missing');
  assert(bridgeCentre.drive!.yM > bridgeCentre.water.yM + 2,
    'bridge deck must clear the water surface');
  assert(bridgeCentre.ground.yM < bridgeCentre.water.yM, 'bridge channel must remain open');

  const culvert = assertCrossing('culvert');
  const culvertCentre = at(culvert, 0, 0);
  assert(culvertCentre.water && !culvertCentre.water.exposed, 'culvert flow must be hidden');
  assert(!culvertCentre.fluid, 'buried culvert water must not immerse the vehicle');
  assert(culvertCentre.structure?.kind === 'culvert-roof', 'culvert roof structure missing');
  assert(culvertCentre.drive!.yM > culvertCentre.water.yM, 'culvert road must remain above water');

  const ford = assertCrossing('ford');
  const fordCentre = at(ford, 0, 0);
  assert(fordCentre.drive?.material === 'ford', 'ford must retain its drive material');
  assert(fordCentre.water?.exposed, 'ford water must remain exposed');
  assert(fordCentre.fluid && fordCentre.fluid.depthAboveSupportM > .5,
    'ford must report water above the drive support');
  assert(fordCentre.water.yM > fordCentre.drive.yM, 'ford water must overlay the crossing surface');

  const causeway = assertCrossing('causeway');
  const causewayCentre = at(causeway, 0, 0);
  assert(causewayCentre.blockedWater, 'causeway must explicitly block the unresolved centre flow');
  assert(!causewayCentre.water && !causewayCentre.fluid,
    'blocked causeway water must not masquerade as exposed vehicle contact');
  assert(causewayCentre.structure?.kind === 'causeway-fill', 'causeway fill structure missing');

  const productionCrossingBase = {
    roadId: 'road:7',
    waterId: 'water:9',
    x: 12,
    z: -8,
    radiusM: 9,
    roadLayer: 0,
    deckY: 104,
    waterBedY: 101,
    waterSurfaceY: 102,
    availableClearanceM: 1.4,
    structureOutcome: 'none' as const,
  };
  const explicitBridgeIntent = resolveProductionCrossingIntent({
    roadLayer: 1,
    roadTags: { bridge: 'yes', embankment: 'yes' },
  });
  assert(explicitBridgeIntent.kind === 'bridge',
    'bridge evidence must determine intent before construction');
  assert(explicitBridgeIntent.authority === 'explicit-tag',
    'bridge intent must retain explicit authority');
  const explicitCulvertIntent = resolveProductionCrossingIntent({
    roadLayer: 0,
    roadTags: { tunnel: 'culvert' },
  });
  assert(explicitCulvertIntent.kind === 'culvert',
    'culvert evidence must determine intent before construction');
  const explicitFordIntent = resolveProductionCrossingIntent({
    roadLayer: 0,
    waterTags: { ford: 'yes' },
  });
  assert(explicitFordIntent.kind === 'ford',
    'ford evidence must determine intent before construction');
  const explicitCausewayIntent = resolveProductionCrossingIntent({
    roadLayer: 0,
    roadTags: { embankment: 'yes' },
  });
  assert(explicitCausewayIntent.kind === 'causeway',
    'causeway evidence must determine intent before construction');
  const unresolvedCrossingIntent = resolveProductionCrossingIntent({ roadLayer: 0 });
  assert(unresolvedCrossingIntent.kind === 'unresolved',
    'an untagged overlap must remain unresolved before construction');

  const explicitProductionBridge = resolveProductionCrossing({
    ...productionCrossingBase,
    roadLayer: 1,
    roadTags: { bridge: 'yes' },
    structureOutcome: 'bridge-deck',
  });
  assert(explicitProductionBridge.kind === 'bridge', 'production bridge tags must resolve bridge');
  assert(explicitProductionBridge.authority === 'explicit-tag', 'bridge tag must be explicit authority');
  assert(explicitProductionBridge.implementation === 'built', 'bridge deck must satisfy bridge intent');

  const taggedProductionCulvert = resolveProductionCrossing({
    ...productionCrossingBase,
    waterTags: { tunnel: 'culvert' },
  });
  assert(taggedProductionCulvert.kind === 'culvert', 'water culvert tag must resolve culvert');
  assert(taggedProductionCulvert.implementation === 'missing',
    'tagged culvert without a conduit must remain visibly missing');

  const builtProductionCulvert = resolveProductionCrossing({
    ...productionCrossingBase,
    structureOutcome: 'culvert-built',
  });
  assert(builtProductionCulvert.kind === 'culvert', 'built conduit must resolve procedural culvert');
  assert(builtProductionCulvert.authority === 'built-structure',
    'procedural culvert must retain construction authority');

  const taggedProductionFord = resolveProductionCrossing({
    ...productionCrossingBase,
    roadTags: { ford: 'yes' },
  });
  assert(taggedProductionFord.kind === 'ford', 'ford tag must resolve ford');
  const fallbackProductionFord = resolveProductionCrossing({
    ...productionCrossingBase,
    structureOutcome: 'ford-fallback',
  });
  assert(fallbackProductionFord.kind === 'ford', 'ford recipe must resolve procedural ford');

  const resolvedProductionCauseway = resolveProductionCrossing({
    ...productionCrossingBase,
    roadTags: { embankment: 'yes' },
    structureOutcome: 'culvert-built',
  });
  assert(resolvedProductionCauseway.kind === 'causeway', 'embankment crossing must resolve causeway');
  assert(resolvedProductionCauseway.authority === 'explicit-tag',
    'explicit causeway intent must outrank an inconsistent construction outcome');

  const unknownProductionCrossing = resolveProductionCrossing(productionCrossingBase);
  assert(unknownProductionCrossing.kind === 'unresolved',
    'geometry overlap alone must not invent crossing semantics');

  const productionRegistry = new ProductionCrossingRegistry();
  productionRegistry.observe(productionCrossingBase);
  productionRegistry.observe({
    ...productionCrossingBase,
    structureOutcome: 'culvert-built',
  });
  productionRegistry.observe({
    ...productionCrossingBase,
    waterTags: { tunnel: 'culvert' },
    structureOutcome: 'culvert-built',
  });
  const registeredProductionCrossing = productionRegistry.at(12, -8);
  assert(registeredProductionCrossing?.kind === 'culvert',
    'registry must upgrade an unresolved overlap to a built crossing');
  assert(registeredProductionCrossing.authority === 'explicit-tag',
    'registry must retain the strongest crossing authority');
  assert(productionRegistry.at(60, -8) === undefined, 'registry radius lookup leaked too far');
  assert(productionRegistry.forBounds({ minX: 0, minZ: -20, maxX: 20, maxZ: 0 }).length === 1,
    'registry bounds lookup missed crossing');
  const productionRegistrySnapshot = productionRegistry.snapshot();
  assert(productionRegistrySnapshot.total === 1, 'registry must deduplicate one crossing');
  assert(productionRegistrySnapshot.culvert === 1, 'registry snapshot lost culvert classification');
  assert(productionRegistrySnapshot.missingImplementation === 0,
    'built culvert must not remain a missing implementation');
  const registeredFootprint = productionCrossingFootprint(registeredProductionCrossing);
  assert(registeredFootprint, 'implemented crossing must expose an earthwork footprint');
  assert(pointInProductionCrossingFootprint(
    registeredFootprint,
    registeredFootprint.x + registeredFootprint.halfLengthM - .1,
    registeredFootprint.z + registeredFootprint.halfWidthM - .1,
  ), 'earthwork footprint missed an oriented in-bounds point');
  assert(!pointInProductionCrossingFootprint(
    registeredFootprint,
    registeredFootprint.x + registeredFootprint.halfLengthM + .1,
    registeredFootprint.z,
  ), 'earthwork footprint leaked beyond its road-length bound');
  assert(productionRegistry.earthworkAt(12, -8)?.kind === 'culvert',
    'registry earthwork lookup missed an implemented crossing');
  const stableCrossingRevision = registeredProductionCrossing.revision;
  const repeatedCrossing = productionRegistry.observe({
    ...productionCrossingBase,
    waterTags: { tunnel: 'culvert' },
    structureOutcome: 'culvert-built',
  });
  assert(repeatedCrossing.revision === stableCrossingRevision,
    'an unchanged crossing observation must retain its record revision');

  const diagnosticRegistry = new ProductionCrossingRegistry();
  diagnosticRegistry.observe({
    ...productionCrossingBase,
    roadId: 'road:built',
    waterId: 'water:built',
    x: 0,
    structureOutcome: 'culvert-built',
  });
  diagnosticRegistry.observe({
    ...productionCrossingBase,
    roadId: 'road:missing',
    waterId: 'water:missing',
    x: 40,
    roadTags: { bridge: 'yes' },
  });
  diagnosticRegistry.observe({
    ...productionCrossingBase,
    roadId: 'road:unresolved',
    waterId: 'water:unresolved',
    x: 80,
  });
  const crossingDiagnostics = diagnosticRegistry.diagnostics(2);
  assert(crossingDiagnostics.length === 2, 'crossing diagnostics must obey their bound');
  assert(crossingDiagnostics[0].kind === 'unresolved',
    'crossing diagnostics must put unresolved semantics first');
  assert(crossingDiagnostics[1].implementation === 'missing',
    'crossing diagnostics must put missing implementations before healthy records');
  assert(diagnosticRegistry.diagnostics(0).length === 0,
    'crossing diagnostics must accept an empty bound');
  const unresolvedDiagnostic = diagnosticRegistry.diagnostics().find((record) =>
    record.kind === 'unresolved');
  const missingDiagnostic = diagnosticRegistry.diagnostics().find((record) =>
    record.implementation === 'missing');
  assert(unresolvedDiagnostic && !productionCrossingFootprint(unresolvedDiagnostic),
    'unresolved crossing must not alter earthworks');
  assert(missingDiagnostic && !productionCrossingFootprint(missingDiagnostic),
    'missing crossing implementation must not alter earthworks');
  assert(diagnosticRegistry.earthworkAt(unresolvedDiagnostic.x, unresolvedDiagnostic.z) === undefined,
    'registry earthwork lookup must ignore unresolved and missing records');

  for (const kind of ['bridge', 'culvert', 'ford', 'causeway'] as const) {
    const roadTags: Readonly<Record<string, string>> | undefined =
      kind === 'bridge' ? { bridge: 'yes' }
        : kind === 'ford' ? { ford: 'yes' }
          : kind === 'causeway' ? { embankment: 'yes' }
            : undefined;
    const waterTags: Readonly<Record<string, string>> | undefined =
      kind === 'culvert' ? { tunnel: 'culvert' } : undefined;
    const crossingInput = {
      ...productionCrossingBase,
      x: 0,
      z: 0,
      roadTags,
      waterTags,
      structureOutcome: kind === 'bridge' ? 'bridge-deck' as const
        : kind === 'culvert' ? 'culvert-built' as const
          : kind === 'ford' ? 'ford-fallback' as const
            : 'none' as const,
    };
    const crossingRecord = {
      ...resolveProductionCrossing(crossingInput),
      revision: 1,
    };
    const productionTile = buildProductionSubstrateTile({
      key: `production-${kind}`,
      revision: 7,
      sourceRevisions: {
        terrain: 2, drive: 4, structures: 2, hydroDetails: 3,
        hydro: 3, crossings: 1,
      },
      bounds: { minX: -10, minZ: -10, maxX: 10, maxZ: 10 },
      resolution: 11,
      sampleGround: () => ({ yM: 0, material: 'terrain' }),
      sampleDrive: (_x, z) => Math.abs(z) <= 2
        ? {
          yM: kind === 'bridge' ? .9 : kind === 'ford' ? .2 : 1.8,
          material: 'gravel',
          quality: .75,
          roadId: 'road:7',
        }
        : undefined,
      sampleWater: (x, _z, support) => {
        if (Math.abs(x) > 3) return undefined;
        const water = {
          source: 'production-hydro' as const,
          kind: 'river' as const,
          yM: 1,
          bedY: -.5,
          depthM: 1.5,
          coverage: 1,
          shoreDistanceM: 3 - Math.abs(x),
          flow: [0, 1] as const,
          speedMps: 1.3,
          speedAuthority: 'resolved' as const,
          energy: .3,
          vorticity: .1,
          fetchM: 30,
          intermittent: false,
          tidal: false,
          exposed: true,
          waterId: 'water:9',
        };
        return { water, fluid: resolveFluidContact(water, support) };
      },
      sampleCrossing: (x, z) => Math.hypot(x, z) <= 5 ? crossingRecord : undefined,
    });
    assert(productionTile.revision === 7, `${kind}: production revision was lost`);
    assert(productionTile.sourceRevisions.hydro === 3,
      `${kind}: production source revisions were lost`);
    assert(productionTile.sourceRevisions.drive === 4,
      `${kind}: production drive revision was lost`);
    assert(productionTile.sourceRevisions.structures === 2,
      `${kind}: production structure revision was lost`);
    assert(productionTile.sourceRevisions.hydroDetails === 3,
      `${kind}: production hydro-detail revision was lost`);
    const productionContact = sampleProductionSubstrateTile(productionTile, 0, 0);
    assert(productionContact?.crossing === kind, `${kind}: production tile lost crossing kind`);
    assert(productionContact.drive, `${kind}: production tile lost drive support`);
    if (kind === 'bridge') {
      assert(productionContact.water?.exposed, 'production bridge must retain exposed water');
      assert(!productionContact.fluid,
        'production bridge water must not become vehicle fluid without flood authority');
    } else if (kind === 'culvert') {
      assert(productionContact.water && !productionContact.water.exposed,
        'production culvert must hide conduit water');
      assert(!productionContact.fluid, 'production culvert must not immerse the vehicle');
    } else if (kind === 'ford') {
      assert(productionContact.drive.material === 'ford', 'production ford must mark drive material');
      assert(productionContact.fluid, 'production ford must expose water above drive support');
      const crossingProbeStore = new ProductionSubstrateStore();
      crossingProbeStore.upsert(productionTile);
      const crossingProbes = crossingProbeStore.waterPoints(1, {
        x: 0,
        z: 0,
        radiusM: 20,
      });
      assert(crossingProbes[0]?.crossing === 'ford' && crossingProbes[0].fluid,
        'representative water probes must prioritize the explicit fluid crossing');
    } else {
      assert(productionContact.blockedWater, 'production causeway must block water');
      assert(!productionContact.water && !productionContact.fluid,
        'production causeway must not expose blocked water');
    }
  }

  const narrowCrossingRecord = {
    ...resolveProductionCrossing({
      ...productionCrossingBase,
      x: 50,
      z: 13,
      roadTags: { bridge: 'yes' },
      structureOutcome: 'bridge-deck',
    }),
    revision: 2,
  };
  const narrowVectorTile = buildProductionSubstrateTile({
    key: 'production-narrow-vector',
    revision: 8,
    sourceRevisions: {
      terrain: 3, drive: 5, structures: 1, hydro: 4, crossings: 2,
      hydroDetails: 0,
    },
    bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
    resolution: 3,
    driveSegments: [{
      ax: 0,
      az: 13,
      bx: 100,
      bz: 13,
      yaM: 5,
      ybM: 5,
      halfWidthM: 2.5,
      material: 'asphalt',
      quality: .95,
      roadId: 'road:narrow',
      shoulderM: 2.2,
    }],
    driveRenderMeshes: [{
      name: 'test-road-packet',
      materialKeys: ['test-road-material'],
      attributes: {
        position: {
          itemSize: 3,
          normalized: false,
          data: new Float32Array([
            0, 5, 11,
            100, 5, 11,
            0, 5, 15,
          ]),
        },
        color: {
          itemSize: 3,
          normalized: true,
          data: new Uint8Array([
            255, 128, 0,
            64, 255, 32,
            0, 96, 255,
          ]),
        },
      },
      index: new Uint32Array([0, 1, 2]),
      groups: [{ start: 0, count: 3, materialIndex: 0 }],
      matrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      renderOrder: 2,
      castShadow: false,
      receiveShadow: true,
      frustumCulled: true,
      userData: { ribbon: true },
    }],
    structureRenderMeshes: [{
      name: 'test-structure-packet',
      materialKeys: ['test-structure-material'],
      attributes: {
        position: {
          itemSize: 3,
          normalized: false,
          data: new Float32Array([
            48, 4, 12,
            52, 4, 12,
            50, 6, 14,
          ]),
        },
      },
      groups: [],
      matrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      renderOrder: 0,
      castShadow: true,
      receiveShadow: true,
      frustumCulled: true,
      userData: { structureKind: 'bridge-deck' },
    }],
    hydroDetailRenderMeshes: [{
      name: 'test-riverbed-packet',
      materialKeys: ['test-riverbed-material'],
      attributes: {
        position: {
          itemSize: 3,
          normalized: false,
          data: new Float32Array([
            47, 1, 10,
            53, 1, 10,
            50, 1, 16,
          ]),
        },
      },
      groups: [],
      matrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      renderOrder: 0,
      castShadow: false,
      receiveShadow: true,
      frustumCulled: true,
      userData: { riverbed: true },
    }],
    hydroDetailColliders: [{
      kind: 'rapid-rock',
      x: 50,
      z: 13,
      radiusM: .8,
    }],
    crossings: [narrowCrossingRecord],
    sampleGround: () => ({ yM: 0 }),
    sampleDrive: () => undefined,
    sampleWater: () => undefined,
    sampleCrossing: () => undefined,
  });
  const narrowVectorContact = sampleProductionSubstrateTile(narrowVectorTile, 50, 13);
  assert(narrowVectorContact?.drive?.roadId === 'road:narrow',
    'exact drive vectors must survive when the diagnostic raster misses the road');
  assert(narrowVectorTile.driveRenderMeshes.length === 1,
    'production tile must retain its drive render packet');
  assert(narrowVectorTile.driveRenderMeshes[0].attributes.position.data[4] === 5
    && narrowVectorTile.driveRenderMeshes[0].index?.[2] === 2
    && narrowVectorTile.driveRenderMeshes[0].userData.ribbon === true,
  'drive render packet must retain exact geometry, index and probe metadata');
  assert(narrowVectorTile.driveRenderMeshes[0].attributes.color.data instanceof Uint8Array
    && narrowVectorTile.driveRenderMeshes[0].attributes.color.normalized
    && narrowVectorTile.driveRenderMeshes[0].attributes.color.data[1] === 128,
  'render packets must preserve normalized integer component storage');
  assert(narrowVectorTile.structureRenderMeshes.length === 1
    && narrowVectorTile.structureRenderMeshes[0].userData.structureKind === 'bridge-deck',
  'production tile must retain exact structure render packets');
  assert(narrowVectorTile.hydroDetailRenderMeshes.length === 1
    && narrowVectorTile.hydroDetailRenderMeshes[0].userData.riverbed === true,
  'production tile must retain exact hydro-detail render packets');
  assert(narrowVectorTile.hydroDetailColliders.length === 1
    && narrowVectorTile.hydroDetailColliders[0].kind === 'rapid-rock'
    && narrowVectorTile.hydroDetailColliders[0].radiusM === .8,
  'production tile must retain versioned hydro-detail collider witnesses');
  assert(narrowVectorContact.crossing === 'bridge',
    'exact crossing records must survive when the diagnostic raster misses the crossing');
  const narrowShoulderContact = sampleProductionSubstrateTile(narrowVectorTile, 50, 17);
  assert(narrowShoulderContact, 'outboard shoulder contact missing');
  assert(!narrowShoulderContact.drive,
    'outboard shoulder must not masquerade as carriageway support');
  assert(narrowShoulderContact.driveProximity?.roadId === 'road:narrow'
    && narrowShoulderContact.driveProximity.outM > 1,
  `exact drive proximity must retain the deck through the fairing zone: ${
    JSON.stringify(narrowShoulderContact)
  }`);
  narrowVectorTile.driveY.fill(12);
  narrowVectorTile.driveQuality.fill(.9);
  narrowVectorTile.driveMaterial.fill(1);
  narrowVectorTile.roadIndex.fill(1);
  const rasterBleedContact = sampleProductionSubstrateTile(narrowVectorTile, 50, 25);
  assert(rasterBleedContact && !rasterBleedContact.drive,
    'coarse drive raster must not invent support between exact vector roads');

  const shoulderBridgeTile = buildProductionSubstrateTile({
    key: 'production-shoulder-bridge',
    revision: 9,
    sourceRevisions: {
      terrain: 3, drive: 6, structures: 1, hydro: 4, crossings: 2,
      hydroDetails: 0,
    },
    bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 },
    resolution: 3,
    driveSegments: [{
      ax: 0,
      az: 9,
      bx: 100,
      bz: 9,
      yaM: 7,
      ybM: 7,
      halfWidthM: 2.5,
      material: 'asphalt',
      quality: .95,
      roadId: 'road:shoulder-only',
      shoulderM: 2.2,
      crossfallA: 0,
      crossfallB: 0,
    }],
    crossings: [narrowCrossingRecord],
    sampleGround: () => ({ yM: 0 }),
    sampleDrive: () => undefined,
    sampleWater: () => undefined,
    sampleCrossing: () => undefined,
  });
  const shoulderBridgeContact = sampleProductionSubstrateTile(
    shoulderBridgeTile,
    50,
    13,
  );
  assert(shoulderBridgeContact?.drive?.roadId === narrowCrossingRecord.roadId
    && shoulderBridgeContact.support.kind === 'drive',
  `a shoulder-only candidate must not suppress canonical bridge support: ${
    JSON.stringify(shoulderBridgeContact)
  }`);
  assert(shoulderBridgeContact.driveProximity?.roadId === 'road:shoulder-only'
    && shoulderBridgeContact.driveProximity.outM > .8,
  'shoulder-only geometry must remain available to fairing diagnostics');

  const exactGroundPositions = new Float32Array([
    -5, 0, -5,
    5, 10, -5,
    -5, 0, 5,
    5, 10, 5,
  ]);
  const exactGroundTile = buildProductionSubstrateTile({
    key: 'production-exact-ground',
    revision: 9,
    sourceRevisions: {
      terrain: 4, drive: 0, structures: 0, hydro: 0, crossings: 0,
      hydroDetails: 0,
    },
    bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
    resolution: 3,
    groundMesh: {
      positions: exactGroundPositions,
      cellOffsets: new Int32Array([0, 2]),
      cellTriangles: new Int32Array([0, 1, 2, 1, 3, 2]),
      segmentCount: 1,
      originX: 5,
      originZ: 5,
      verticalOffsetM: 100,
    },
    terrainRenderMeshes: [{
      name: 'test-terrain-packet',
      materialKeys: ['test-terrain-material'],
      attributes: {
        position: {
          itemSize: 3,
          normalized: false,
          data: exactGroundPositions,
        },
      },
      index: new Uint32Array([0, 1, 2, 1, 3, 2]),
      groups: [],
      matrix: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]),
      renderOrder: 0,
      castShadow: false,
      receiveShadow: true,
      frustumCulled: true,
      userData: { corridor: true },
    }],
    sampleGround: () => ({ yM: 100 }),
    sampleDrive: () => undefined,
    sampleWater: () => undefined,
    sampleCrossing: () => undefined,
  });
  const exactGroundContact = sampleProductionSubstrateTile(exactGroundTile, 5, 5);
  assert(exactGroundContact, 'exact ground mesh contact missing');
  close(exactGroundContact.ground.yM, 105, 1e-6,
    'exact terrain triangle must outrank coarse diagnostic ground');
  assert(exactGroundContact.ground.normal[1] > .6,
    'exact terrain triangle must provide an upward normal');
  assert(exactGroundTile.terrainRenderMeshes[0].attributes.position.data
    === exactGroundTile.groundMesh?.positions,
  'terrain render and exact contact must share one immutable position array');

  const taggedBridge = makeCrossingFixture('ford');
  taggedBridge.crossing = { intent: 'auto', bridgeTagged: true };
  assert(resolveCrossingKind(taggedBridge) === 'bridge', 'explicit bridge evidence must win');

  const shallowMinor = makeCrossingFixture('bridge', {
    riverWidthM: 7,
    waterDepthM: .55,
  });
  shallowMinor.crossing = { intent: 'auto' };
  assert(resolveCrossingKind(shallowMinor) === 'ford', 'shallow minor crossing should resolve to ford');

  const viableCulvert = makeCrossingFixture('bridge', {
    riverWidthM: 10,
    waterDepthM: 1.1,
  });
  viableCulvert.crossing = { intent: 'auto', availableClearanceM: 1.2 };
  assert(resolveCrossingKind(viableCulvert) === 'culvert',
    'small channel with cover should resolve to culvert');

  const unresolvedFill = makeCrossingFixture('bridge', {
    riverWidthM: 22,
    waterDepthM: 1.4,
  });
  unresolvedFill.crossing = { intent: 'auto', availableClearanceM: .2 };
  assert(resolveCrossingKind(unresolvedFill) === 'causeway',
    'large low-clearance crossing should remain an explicit causeway');

  const deterministicA = buildSubstrateTile(makeCrossingFixture('ford', {
    flowSpeedMps: 2.4,
    regime: 'rapid',
  }));
  const deterministicB = buildSubstrateTile(makeCrossingFixture('ford', {
    flowSpeedMps: 2.4,
    regime: 'rapid',
  }));
  sameArray(deterministicA.groundY, deterministicB.groundY, 'deterministic ground');
  sameArray(deterministicA.driveY, deterministicB.driveY, 'deterministic drive');
  sameArray(deterministicA.waterEnergy, deterministicB.waterEnergy, 'deterministic energy');
  sameArray(deterministicA.crossingId, deterministicB.crossingId, 'deterministic semantics');

  const matchedInput = makeCrossingFixture('ford', { waterDepthM: .6 });
  const matchedTile = buildSubstrateTile(matchedInput);
  const matchedCentre = at(matchedTile, 0, 0);
  const matchedField = buildProductionHydroFixture(matchedInput);
  const matchedHydro = sampleHydroContactLayers(
    matchedField,
    matchedCentre.x,
    matchedCentre.z,
    matchedCentre.support,
  );
  assert(matchedHydro, 'production hydro adapter must find the fixture river');
  assert(matchedHydro.water.source === 'production-hydro', 'adapter source must stay explicit');
  assert(matchedHydro.water.kind === 'river', 'adapter must retain production water kind');
  assert(matchedHydro.water.coverage > .5, 'adapter must retain production coverage');
  assert(matchedHydro.water.shoreDistanceM > 0, 'channel centre must be inside the production shore');
  assert(matchedHydro.water.fetchM !== null, 'adapter must retain production fetch');
  assert(matchedHydro.water.bedMaterial === matchedInput.water.bedMaterial,
    'adapter must retain production bed material');
  assert(matchedHydro.water.bankMaterial === matchedInput.water.bankMaterial,
    'adapter must retain production bank material');
  assert(matchedHydro.water.speedMps === null, 'production flow direction must not invent speed');
  assert(matchedHydro.water.speedAuthority === 'unknown', 'unknown speed authority must be explicit');
  assert(matchedHydro.fluid, 'matching ford water must sit above drive support');
  assert(matchedCentre.water, 'matching canonical ford water missing');
  close(matchedHydro.water.yM, matchedCentre.water.yM, .08, 'matching hydro level');
  close(
    matchedHydro.fluid.depthAboveSupportM,
    matchedCentre.fluid!.depthAboveSupportM,
    .08,
    'matching ford fluid depth',
  );
  assert(
    sampleHydroContactLayers(matchedField, 34, 0, at(matchedTile, 34, 0).support) === undefined,
    'production adapter must not report water outside the channel',
  );

  const exactHydroTile = buildProductionSubstrateTile({
    key: 'production-exact-hydro',
    revision: 10,
    sourceRevisions: {
      terrain: 1,
      drive: 0,
      structures: 0,
      hydroDetails: 0,
      hydro: matchedField.revision,
      crossings: 0,
    },
    bounds: matchedField.bounds,
    resolution: 3,
    hydroField: matchedField,
    waterCoverageCutAt: () => .5,
    waterMotionSegments: [{
      ax: 0,
      az: matchedField.bounds.minZ,
      bx: 0,
      bz: matchedField.bounds.maxZ,
      bedAM: matchedCentre.water!.bedY,
      bedBM: matchedCentre.water!.bedY,
      halfWidthM: 8,
      speedMps: 2.1,
      waterId: 'water:exact',
    }],
    sampleGround: () => ({ yM: matchedCentre.ground.yM }),
    sampleDrive: () => undefined,
    sampleWater: () => undefined,
    sampleCrossing: () => undefined,
  });
  const exactHydroContact = sampleProductionSubstrateTile(exactHydroTile, 0, 34);
  assert(exactHydroContact?.water, 'locked hydro field must resolve exact water between witness cells');
  close(exactHydroContact.water.speedMps ?? NaN, 2.1, 1e-6,
    'exact channel segment must provide physical speed authority');
  assert(exactHydroContact.water.speedAuthority === 'resolved',
    'exact channel speed authority must remain explicit');
  assert(exactHydroContact.water.waterId === 'water:exact',
    'exact channel identity must survive in production contact');
  const exactHydroStore = new ProductionSubstrateStore();
  exactHydroStore.upsert(exactHydroTile);
  const exactWaterPoints = exactHydroStore.waterPoints(8, { x: 0, z: 0, radiusM: 100 });
  assert(exactWaterPoints.length > 0,
    'production store must expose exact field water for representative-drive probes');
  assert(exactWaterPoints.some((point) => point.fluid && point.depthAboveSupportM !== null),
    'representative-drive probes must identify water that can contact the vehicle');

  const productionBridgeInput = makeCrossingFixture('bridge', { waterDepthM: .6 });
  const productionBridgeTile = buildSubstrateTile(productionBridgeInput);
  const productionBridgeCentre = at(productionBridgeTile, 0, 0);
  const productionBridge = sampleHydroContactLayers(
    buildProductionHydroFixture(productionBridgeInput),
    0,
    0,
    productionBridgeCentre.support,
  );
  assert(productionBridge?.water.exposed, 'production hydro must preserve water below a bridge');
  assert(!productionBridge.fluid, 'water below the bridge deck must not become vehicle fluid contact');

  const productionCulvertInput = makeCrossingFixture('culvert', { waterDepthM: .6 });
  const productionCulvertCentre = at(buildSubstrateTile(productionCulvertInput), 0, 0);
  const productionCulvert = sampleHydroContactLayers(
    buildProductionHydroFixture(productionCulvertInput),
    0,
    0,
    productionCulvertCentre.support,
  );
  assert(productionCulvert?.water.exposed, 'production hydro currently lacks culvert occlusion');
  assert(!productionCulvertCentre.water?.exposed, 'canonical culvert flow must remain hidden');
  assert(!productionCulvert.fluid, 'culvert roof support must still prevent vehicle fluid contact');
  assert(
    resolveFluidContact(productionCulvertCentre.water, productionCulvertCentre.support) === undefined,
    'hidden canonical water must never resolve as vehicle fluid',
  );

  const productionCausewayInput = makeCrossingFixture('causeway', { waterDepthM: .6 });
  const productionCausewayCentre = at(buildSubstrateTile(productionCausewayInput), 0, 0);
  const productionCauseway = sampleHydroContactLayers(
    buildProductionHydroFixture(productionCausewayInput),
    0,
    0,
    productionCausewayCentre.support,
  );
  assert(productionCauseway?.water.exposed, 'production hydro currently lacks causeway blocking');
  assert(productionCausewayCentre.blockedWater, 'canonical causeway must retain blocked-water state');
  assert(!productionCauseway.fluid, 'causeway support must keep production water below the vehicle');

  const divergentInput = makeCrossingFixture('ford');
  const divergentCentre = at(buildSubstrateTile(divergentInput), 0, 0);
  const divergentHydro = sampleHydroContactLayers(
    buildProductionHydroFixture(divergentInput),
    0,
    0,
    divergentCentre.support,
  );
  assert(divergentCentre.water && divergentHydro, 'depth comparison needs both water sources');
  close(
    divergentCentre.water.yM - divergentHydro.water.yM,
    .55,
    .08,
    'authored depth disagreement must remain visible',
  );

  const shadow = new SubstrateShadowMonitor();
  shadow.observe({
    x: 0,
    z: 0,
    support: matchedCentre.support,
    legacySupport: { ...matchedCentre.support, yM: matchedCentre.support.yM + .02 },
    hydro: matchedHydro,
    legacy: {
      wet: true,
      depthM: matchedHydro.fluid.depthAboveSupportM,
      speedMps: 2.6,
      flow: matchedHydro.water.flow,
    },
    crossing: { authority: 'canonical', kind: 'ford' },
    substrateAuthority: 'tile',
  });
  let shadowSnapshot = shadow.snapshot();
  assert(shadowSnapshot.probes === 1, 'shadow monitor must count probes');
  assert(shadowSnapshot.hydroWater === 1, 'shadow monitor must count real hydro probes');
  assert(shadowSnapshot.canonicalFluid === 1, 'shadow monitor must count fluid contacts');
  assert(shadowSnapshot.driveWaterOverlap === 1, 'shadow monitor must count road/water overlap');
  assert(shadowSnapshot.wetAgreement === 1, 'matching contacts must agree in shadow');
  assert(shadowSnapshot.depth.compared === 1, 'matching wet contacts must compare depth');
  assert(shadowSnapshot.unknownSpeed === 1, 'shadow must expose unknown hydro speed authority');
  assert(shadowSnapshot.tileProbes === 1 && shadowSnapshot.fallbackProbes === 0,
    'shadow must distinguish revisioned tile probes from fallback');
  assert(shadowSnapshot.support.compared === 1, 'shadow must compare support height');
  close(shadowSnapshot.support.maxAbsDeltaM ?? NaN, .02, 1e-6, 'support height delta');
  close(shadowSnapshot.support.p95AbsDeltaM ?? NaN, .02, .0011, 'support height p95');
  close(shadowSnapshot.depth.p95AbsDeltaM ?? NaN, 0, .0011, 'fluid depth p95');
  assert(shadowSnapshot.wetDisagreementRate === 0,
    'matching contacts must retain a zero disagreement rate');
  assert(
    shadowSnapshot.gates.some((gate) =>
      gate.id === 'support-p95' && gate.pass && gate.limit === .03),
    'cutover diagnostics must expose the support p95 gate structurally',
  );
  assert(!shadowSnapshot.readyForCutover, 'unknown speed and low sample count must block cutover');

  shadow.observe({
    x: 1,
    z: 0,
    support: matchedCentre.support,
    hydro: matchedHydro,
    legacy: {
      wet: false,
      depthM: null,
      speedMps: null,
      flow: null,
    },
    crossing: { authority: 'unresolved' },
    substrateAuthority: 'fallback',
  });
  shadowSnapshot = shadow.snapshot();
  assert(shadowSnapshot.wetDisagreement === 1, 'shadow must count wet-contact disagreement');
  close(shadowSnapshot.wetDisagreementRate, .5, 1e-9, 'wet disagreement rate');
  assert(
    shadowSnapshot.gates.some((gate) =>
      gate.id === 'wet-disagreement-rate' && !gate.pass && gate.limit === .001),
    'cutover diagnostics must expose the wet disagreement-rate gate structurally',
  );
  assert(
    shadowSnapshot.canonicalWetLegacyDry === 1,
    'shadow must identify canonical-wet / legacy-dry direction',
  );
  assert(shadowSnapshot.unresolvedCrossing === 1, 'shadow must count missing crossing authority');
  assert(shadowSnapshot.fallbackProbes === 1, 'shadow must count substrate fallback probes');
  assert(
    shadowSnapshot.blockers.includes('substrate tile unavailable for some probes'),
    'substrate fallback must remain a cutover blocker',
  );
  assert(
    shadowSnapshot.blockers.includes('crossing semantics unresolved'),
    'crossing authority must remain a cutover blocker',
  );

  const evidenceDrive = (evidence: VehicleWaterEvidence): object[] => {
    const wheels = (x: number, wet: boolean) => [
      { x: x - .8, z: -1.5, yM: 0, wet },
      { x: x + .8, z: -1.5, yM: 0, wet },
      { x: x - .8, z: 1.5, yM: 0, wet },
      { x: x + .8, z: 1.5, yM: 0, wet },
    ];
    const out: object[] = [];
    out.push(evidence.step({
      dt: .1,
      timeSeconds: 0,
      x: 0,
      z: 0,
      vx: 5,
      vz: 0,
      heading: Math.PI / 2,
      depthM: .45,
      inWater: true,
      authority: 'substrate',
      wheels: wheels(0, true),
    }));
    out.push(evidence.step({
      dt: .1,
      timeSeconds: .2,
      x: 1,
      z: 0,
      vx: 5,
      vz: 0,
      heading: Math.PI / 2,
      depthM: 0,
      inWater: false,
      authority: 'substrate',
      wheels: wheels(1, false),
    }));
    out.push(evidence.step({
      dt: .3,
      timeSeconds: .55,
      x: 2,
      z: 0,
      vx: 5,
      vz: 0,
      heading: Math.PI / 2,
      depthM: 0,
      inWater: false,
      authority: 'substrate',
      wheels: wheels(2, false),
    }));
    return out;
  };
  const evidenceA = new VehicleWaterEvidence();
  const evidenceB = new VehicleWaterEvidence();
  const evidenceTraceA = evidenceDrive(evidenceA);
  const evidenceTraceB = evidenceDrive(evidenceB);
  assert(JSON.stringify(evidenceTraceA) === JSON.stringify(evidenceTraceB),
    'vehicle-water evidence must be deterministic for a representative drive');
  const evidenceEntry = evidenceTraceA[0] as ReturnType<VehicleWaterEvidence['snapshot']>;
  assert(evidenceEntry.entered && evidenceEntry.inWater,
    'vehicle-water evidence must retain the entry transition');
  assert(evidenceEntry.wakeStrength > 0 && evidenceEntry.hullWetness > 0,
    'resolved fluid contact must drive wake and hull wetness together');
  const evidenceExit = evidenceTraceA[1] as ReturnType<VehicleWaterEvidence['snapshot']>;
  assert(evidenceExit.exited && evidenceExit.activeTracks === 4,
    'wet tyres must leave one deterministic first print after exit');
  const evidenceCarry = evidenceTraceA[2] as ReturnType<VehicleWaterEvidence['snapshot']>;
  assert(evidenceCarry.activeTracks >= 8 && evidenceCarry.activeDrips >= 1,
    'vehicle passage must retain tracks and post-exit drips');
  assert(evidenceCarry.tyreWetness.every((wetness) => wetness > 0),
    'tyre wetness must carry after fluid contact ends');
  evidenceA.step({
    dt: .25,
    timeSeconds: 40,
    x: 2,
    z: 0,
    vx: 0,
    vz: 0,
    heading: 0,
    depthM: 0,
    inWater: false,
    authority: 'substrate',
    wheels: [],
  });
  assert(evidenceA.activeStamps(40).length === 0,
    'expired vehicle-water evidence must leave the bounded history');
}
