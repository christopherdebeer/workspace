import {
  createTerrainKernel,
  type HeightTile,
  type StripLike,
  type TerrainCrossingKind,
  type TerrainStore,
} from './terrain-kernel';

const fail = (message: string): never => {
  throw new Error(message);
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) fail(message);
};

const K = createTerrainKernel();

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
    onRoad: (_x, z) => Math.abs(z) <= 3,
    palette: () => [.4, .4, .4],
    areaTint: () => null,
    borders: new Map(),
    nrmScale: 0,
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

export function runTerrainCrossingSelfTest(): void {
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
