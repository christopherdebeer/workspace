import {
  type BedMaterial,
  type BankMaterial,
  type CrossingKind,
  type SubstrateElevation,
  type SubstrateTileInput,
  type WaterRegime,
} from './types';

export interface CrossingFixtureOptions {
  roadWidthM?: number;
  riverWidthM?: number;
  bankWidthM?: number;
  waterDepthM?: number;
  bridgeClearanceM?: number;
  approachM?: number;
  flowSpeedMps?: number;
  roughness?: number;
  regime?: WaterRegime;
  bedMaterial?: BedMaterial;
  bankMaterial?: BankMaterial;
  resolution?: number;
}

/** One authored place, four explicit semantic resolutions. */
export function makeCrossingFixture(
  kind: CrossingKind,
  options: CrossingFixtureOptions = {},
): SubstrateTileInput {
  const bounds = { minX: -72, minZ: -72, maxX: 72, maxZ: 72 };
  const gridN = 145;
  const data = new Float32Array(gridN * gridN);
  for (let iz = 0; iz < gridN; iz++) {
    const z = bounds.minZ + (iz / (gridN - 1)) * (bounds.maxZ - bounds.minZ);
    for (let ix = 0; ix < gridN; ix++) {
      const x = bounds.minX + (ix / (gridN - 1)) * (bounds.maxX - bounds.minX);
      data[iz * gridN + ix] = 1.05
        + x * .002 - z * .003
        + Math.sin(x * .055) * .16
        + Math.cos(z * .043) * .12;
    }
  }
  const elevation: SubstrateElevation = { width: gridN, height: gridN, data };
  const roadHalf = (options.roadWidthM ?? 8.4) * .5;
  const riverHalf = (options.riverWidthM ?? 16) * .5;
  return {
    key: `substrate:${kind}`,
    revision: 1,
    bounds,
    resolution: options.resolution ?? 145,
    elevation,
    road: {
      id: 'road:crossing',
      kind: 'road',
      stations: [
        { x: -72, z: 0, yM: 1.12 },
        { x: 0, z: 0, yM: 1.05 },
        { x: 72, z: 0, yM: .98 },
      ],
      halfWidthM: roadHalf,
      shoulderM: 2.2,
      thicknessM: .26,
      quality: .9,
      material: 'asphalt',
      tier: 1,
    },
    water: {
      id: 'water:river',
      kind: 'river',
      stations: [
        { x: 0, z: -72, yM: -.25 },
        { x: 0, z: 0, yM: -.62 },
        { x: 0, z: 72, yM: -.98 },
      ],
      halfWidthM: riverHalf,
      bankWidthM: options.bankWidthM ?? 8,
      depthM: options.waterDepthM ?? 1.15,
      flowSpeedMps: options.flowSpeedMps ?? 1.25,
      roughness: options.roughness ?? .58,
      regime: options.regime ?? 'riffle',
      bedMaterial: options.bedMaterial ?? 'pebble',
      bankMaterial: options.bankMaterial ?? 'gravel',
    },
    crossing: {
      intent: kind,
      availableClearanceM: 1.4,
      bridgeClearanceM: options.bridgeClearanceM ?? 2.35,
      approachM: options.approachM ?? 22,
    },
  };
}
