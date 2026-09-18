import {
  createTerrainKernel,
  type BreakLine,
  type HeightTile,
  type StripLike,
  type TerrainCrossingKind,
  type TerrainStore,
} from './terrain-kernel';
import { buildSubstrateCells, SUB_FIELD_N } from './substrate-field';

const fail = (message: string): never => {
  throw new Error(message);
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) fail(message);
};

const K = createTerrainKernel(buildSubstrateCells, SUB_FIELD_N);

function gridded(segment: StripLike): Map<string, StripLike[]> {
  const out = new Map<string, StripLike[]>();
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) out.set(`${x},${z}`, [segment]);
  }
  return out;
}

function centreHeight(kind: TerrainCrossingKind | null): number {
  const tile: HeightTile = {
    tx: 0,
    ty: 0,
    xs: -16,
    zs: -16,
    w: 32,
    h: 32,
    data: new Float32Array(256 * 256).fill(4),
  };
  const road: StripLike = {
    ax: -16,
    az: 0,
    bx: 16,
    bz: 0,
    hw: 3,
    ya: 6,
    yb: 6,
  };
  const channel: StripLike = {
    ax: 0,
    az: -16,
    bx: 0,
    bz: 16,
    hw: 2,
    ya: 1,
    yb: 1,
  };
  const store: TerrainStore = {
    heights: new Map([['0/0', tile]]),
    hasHeight: () => true,
    sampleHeight: () => 4,
    sampleHeightRaw: () => 4,
    sampleCover: () => 80,
    coverPaint: () => 80,
    coverWater: (x) => Math.abs(x) <= 3,
    crossingAt: (x, z) => Math.abs(x) <= 6 && Math.abs(z) <= 5 ? kind : null,
    cover: { water: 80, built: 50 },
    seaAbs: () => 0,
    baseElev: 0,
    strips: gridded(road),
    cutL: 24,
    channels: gridded(channel),
    grid: 24,
    hydroBreakLines: () => [], hydroFloor: () => null,
    onRoad: (_x, z) => Math.abs(z) <= 3,
    palette: () => [.4, .4, .4],
    areaTint: () => null,
    borders: new Map(),
    nrmCoarsePx: 4, nrmRes: 2,
    cutWash: 0,
    cprobe: false,
    carveLog: new Map(),
    cutRelief: false,
  };
  const built = K.buildTile(store, tile, 16, true, true);
  let nearest = -1;
  let distance = Infinity;
  for (let i = 0; i < built.pos.length / 3; i++) {
    const d = Math.hypot(built.pos[i * 3], built.pos[i * 3 + 2]);
    if (d >= distance) continue;
    distance = d;
    nearest = i;
  }
  assert(nearest >= 0 && distance < .01, `crossing fixture has no centre vertex (${distance})`);
  return built.pos[nearest * 3 + 1];
}

function assertHydroContourIsTopology(): void {
  const tile: HeightTile = {
    tx: 0,
    ty: 0,
    xs: -16,
    zs: -16,
    w: 32,
    h: 32,
    data: new Float32Array(256 * 256).fill(4),
  };
  const shore: BreakLine = { ax: -20, az: 3.25, bx: 20, bz: 3.25 };
  const store: TerrainStore = {
    heights: new Map([['0/0', tile]]),
    hasHeight: () => true,
    sampleHeight: () => 4,
    sampleHeightRaw: () => 4,
    sampleCover: () => 50,
    coverPaint: () => 50,
    coverWater: () => false,
    crossingAt: () => null,
    cover: { water: 80, built: 50 },
    seaAbs: () => 0,
    baseElev: 0,
    strips: new Map(),
    cutL: 24,
    channels: new Map(),
    grid: 24,
    hydroBreakLines: () => [shore], hydroFloor: () => null,
    onRoad: () => false,
    palette: () => [.4, .4, .4],
    areaTint: () => null,
    borders: new Map(),
    nrmCoarsePx: 4, nrmRes: 2,
    cutWash: 0,
    cprobe: false,
    carveLog: new Map(),
    cutRelief: false,
  };
  const built = K.buildTile(store, tile, 4, false, true);
  assert(built.refined, 'a hydro contour did not select refined terrain topology');
  let contourVertices = 0;
  for (let i = 0; i < built.pos.length / 3; i++) {
    if (Math.abs(built.pos[i * 3 + 2] - shore.az) < 1e-3) contourVertices++;
  }
  assert(contourVertices >= 5,
    `hydro contour did not become a continuous terrain vertex row (${contourVertices})`);
  for (let i = 0; i < built.idx.length; i += 3) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 3; k++) {
      const z = built.pos[built.idx[i + k] * 3 + 2] - shore.az;
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
    assert(!(lo < -1e-3 && hi > 1e-3),
      'a terrain triangle still bridges across the canonical hydro contour');
  }
}

function assertPointBarBelongsToTerrain(): void {
  const channel: StripLike = {
    ax: 0,
    az: -16,
    bx: 0,
    bz: 16,
    hw: 4,
    ya: 1,
    yb: 1,
    cv: .012,
  };
  const tile: HeightTile = {
    tx: 0, ty: 0, xs: -16, zs: -16, w: 32, h: 32,
    data: new Float32Array(256 * 256).fill(4),
  };
  const store: TerrainStore = {
    heights: new Map([['0/0', tile]]),
    hasHeight: () => true,
    sampleHeight: () => 4,
    sampleHeightRaw: () => 4,
    sampleCover: () => 80,
    coverPaint: () => 80,
    coverWater: () => true,
    crossingAt: () => null,
    cover: { water: 80, built: 50 },
    seaAbs: () => 0,
    baseElev: 0,
    strips: new Map(),
    cutL: 24,
    channels: gridded(channel),
    grid: 24,
    hydroBreakLines: () => [],
    onRoad: () => false,
    palette: () => [.4, .4, .4],
    areaTint: () => null,
    borders: new Map(),
    nrmCoarsePx: 4, nrmRes: 2,
    cutWash: 0,
    cprobe: false,
    carveLog: new Map(),
    cutRelief: false,
  };
  // Tangent points +z, so cross(tangent, offset) is positive on x<0.
  const inside = K.channelFloorAt(store, -3.4, 0, 4);
  const outside = K.channelFloorAt(store, 3.4, 0, 4);
  assert(inside !== null && outside !== null && inside > outside + .15,
    `curved channel did not raise a terrain-owned inside shelf (${inside}, ${outside})`);
}

export function runTerrainCrossingSelfTest(): void {
  assertHydroContourIsTopology();
  assertPointBarBelongsToTerrain();
  const mask = {
    kind: 'causeway' as const,
    x: 0,
    z: 0,
    roadTangent: [1, 0] as const,
    halfLengthM: 6,
    halfWidthM: 4,
  };
  assert(K.crossingKindAt([mask], 5.9, 3.9) === 'causeway',
    'oriented crossing footprint missed an in-bounds point');
  assert(K.crossingKindAt([mask], 6.1, 0) === null,
    'oriented crossing footprint leaked beyond its road-length bound');
  assert(K.crossingKindAt([mask], 0, 4.1) === null,
    'oriented crossing footprint leaked beyond its road-width bound');

  const unresolved = centreHeight(null);
  const bridge = centreHeight('bridge');
  const culvert = centreHeight('culvert');
  const ford = centreHeight('ford');
  const causeway = centreHeight('causeway');
  assert(Math.abs(unresolved - 4) < .05,
    `unresolved overlap must retain the conservative earth plug, saw ${unresolved}`);
  assert(bridge < 1.1, `bridge must keep the channel open, saw ${bridge}`);
  assert(culvert < 1.1, `culvert must keep the buried channel continuous, saw ${culvert}`);
  assert(ford < 1.1, `ford must keep the channel open below drive support, saw ${ford}`);
  assert(causeway > 4.8, `causeway must retain solid road fill, saw ${causeway}`);
}
