import {
  type InfrastructureContext, canonicalAlignment, pickInfrastructureRecipe,
  planSupportStations, supportFootprintClear,
} from './infrastructure';

export interface InfrastructureCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export const CHECK_CONTEXT: InfrastructureContext = {
  key: 'way/check-1001', kind: 'bridge', lengthM: 180, spanM: 42,
  roadWidthM: 8.2, tier: 2, lanes: 2, layer: 1,
  climate: [0.04, 0.06, 0.7, 0.12, 0.08],
  temperatureC: 11, moisture: 0.58, snow: 0.16,
  reliefM: 28, sideSlope: 0.14, coverM: 0, daylightM: 18,
  waterWidthM: 22, urbanity: 0.28, bedrock: 'sedimentary',
  regionSeed: 12345, districtSeed: 67890, settlementSeed: 54321,
  availableClearanceM: 8,
};

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function runInfrastructureChecks(): InfrastructureCheck[] {
  const checks: InfrastructureCheck[] = [];
  const add = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
  };

  const recipe = pickInfrastructureRecipe(CHECK_CONTEXT);
  add('repeatable recipe', eq(recipe, pickInfrastructureRecipe({ ...CHECK_CONTEXT })),
    'same facts produce byte-identical family, geometry, finish and maintenance');

  const neighbourA = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/neighbour-a' });
  const neighbourB = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/neighbour-b' });
  add('regional era coherence', neighbourA.era === neighbourB.era,
    `same 96km seed resolves ${neighbourA.era} for both structures`);

  const districtArchA = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/arch-a',
    kind: 'conduit', taggedStructure: 'masonry-arch', taggedMaterial: undefined });
  const districtArchB = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/arch-b',
    kind: 'conduit', taggedStructure: 'masonry-arch', taggedMaterial: undefined });
  add('district material coherence', districtArchA.material === districtArchB.material,
    `same 6km seed resolves ${districtArchA.material} masonry`);

  const contexts = [
    CHECK_CONTEXT,
    { ...CHECK_CONTEXT, key: 'way/check-1002', climate: [0, 0, 0.05, 0.2, 0.75], snow: 0.9,
      reliefM: 120, daylightM: 62, bedrock: 'metamorphic' as const },
    { ...CHECK_CONTEXT, key: 'way/check-2001', kind: 'tunnel' as const, lengthM: 900,
      coverM: 80, daylightM: 0, sideSlope: 0.7, bedrock: 'igneous' as const },
    { ...CHECK_CONTEXT, key: 'way/check-3001', kind: 'conduit' as const, tier: 1 as const,
      waterWidthM: 5, availableClearanceM: 1.8 },
  ];
  const forward = contexts.map((c) => [c.key, pickInfrastructureRecipe(c)] as const);
  const backward = contexts.slice().reverse().map((c) => [c.key, pickInfrastructureRecipe(c)] as const).reverse();
  add('call-order independence', eq(forward, backward), 'stream/tile arrival order does not consume shared RNG state');

  const tagged = pickInfrastructureRecipe({ ...CHECK_CONTEXT,
    taggedStructure: 'truss', taggedMaterial: 'steel' });
  add('explicit OSM precedence', tagged.family === 'truss' && tagged.material === 'steel',
    `resolved ${tagged.family}/${tagged.material}`);

  const malformed = pickInfrastructureRecipe({ ...CHECK_CONTEXT,
    taggedStructure: 'definitely_not_a_bridge_family', taggedMaterial: 'unobtainium' });
  add('malformed tag fallback', malformed.family !== ('definitely_not_a_bridge_family' as typeof malformed.family),
    'unknown vocabulary falls back to feasible contextual grammar');

  const starved = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/check-buried',
    kind: 'conduit', tier: 3, waterWidthM: 9, availableClearanceM: 0.2 });
  add('buried conduit omission', starved.family === 'none' && !starved.feasible
    && starved.geometry.cells === 0, 'unsafe solid becomes geometry-free none');

  const lowFord = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/check-ford',
    kind: 'conduit', tier: 0, waterWidthM: 3, availableClearanceM: 0.2 });
  add('minor crossing fallback', lowFord.family === 'ford' && lowFord.geometry.silhouette === 'open-crossing',
    'small minor crossing becomes an open ford, not a larger buried bore');

  const line = [{ x: -60, z: 4 }, { x: 10, z: 8 }, { x: 90, z: 20 }];
  const ca = canonicalAlignment(line), cb = canonicalAlignment(line.slice().reverse());
  add('reverse-order alignment', eq(ca.points, cb.points) && ca.lengthM === cb.lengthM,
    'canonical endpoint ordering removes source direction');

  const common = {
    key: 'way/check-clips', spacingM: 26, endClearanceM: 8,
    stationOffsetM: 123456.75, structureLengthM: 180, clearAt: () => true,
  };
  const full = planSupportStations({ ...common, lengthM: 180, fragmentStartM: 0 })
    .accepted.map((s) => +s.stationM.toFixed(6));
  const left = planSupportStations({ ...common, lengthM: 83, fragmentStartM: 0 })
    .accepted.map((s) => +s.stationM.toFixed(6));
  const right = planSupportStations({ ...common, lengthM: 97, fragmentStartM: 83 })
    .accepted.map((s) => +(s.stationM + 83).toFixed(6));
  add('clip-stable support chainage', eq(full, [...left, ...right].sort((a, b) => a - b)),
    `whole ${full.length} = fragments ${left.length}+${right.length}`);

  const vetoed = planSupportStations({
    key: 'way/check-veto', lengthM: 150, spacingM: 25, endClearanceM: 5,
    clearAt: (s) => Math.abs(s - 75) > 22,
  });
  add('support veto never relaxed', vetoed.refused > 0
    && vetoed.accepted.every((s) => Math.abs(s.stationM - 75) > 22),
    `${vetoed.refused} nominal supports omitted after deterministic shifts failed`);

  const refused = planSupportStations({
    key: 'way/check-refuse-all', lengthM: 90, spacingM: 20, endClearanceM: 4,
    clearAt: () => false,
  });
  add('support-free safety fallback', refused.accepted.length === 0 && refused.refused > 0,
    'no collision-free station means no support geometry');

  const roadClear = supportFootprintClear({ x: 0, z: 0 }, 1.2, [{
    points: [{ x: -20, z: 0 }, { x: 20, z: 0 }], halfWidthM: 3.5,
  }]);
  const roadAway = supportFootprintClear({ x: 0, z: 8 }, 1.2, [{
    points: [{ x: -20, z: 0 }, { x: 20, z: 0 }], halfWidthM: 3.5,
  }]);
  add('corridor footprint test', !roadClear && roadAway,
    'support circle includes carriageway width plus conservative margin');

  const emptyClimate = pickInfrastructureRecipe({ ...CHECK_CONTEXT, key: 'way/check-empty-climate',
    climate: [], moisture: 0, snow: 0 });
  add('missing climate resilience', !!emptyClimate.family && Number.isFinite(emptyClimate.weathering),
    'missing weights degrade to deterministic defaults without NaN');

  add('complete render contract',
    recipe.geometry.repeatM >= 0
      && Number.isInteger(recipe.finish.base)
      && recipe.finish.moss >= 0 && recipe.finish.moss <= 1
      && recipe.finish.rust >= 0 && recipe.finish.rust <= 1
      && recipe.finish.soot >= 0 && recipe.finish.soot <= 1,
    'recipe contains bounded geometry rhythm and finish channels');

  return checks;
}
