import { HydroBodyRegistry } from '../hydro/body-registry';
import {
  analyseHydroTile,
  buildHydroTile,
} from '../hydro/build-tile';
import type {
  HydroFeature,
  HydroTileField,
  HydroTileInput,
} from '../hydro/types';
import type {
  CorridorStation,
  SubstrateTileInput,
} from './types';

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

function corridorY(
  stations: readonly CorridorStation[],
  x: number,
  z: number,
): number {
  let bestDistance = Infinity;
  let bestY = NaN;
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1];
    const b = stations[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    if (length2 < 1e-8) continue;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1);
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    bestY = a.yM + (b.yM - a.yM) * t;
  }
  return bestY;
}

const turbidityForBed = (bed: SubstrateTileInput['water']['bedMaterial']): number => {
  if (bed === 'silt') return .72;
  if (bed === 'sand') return .52;
  if (bed === 'gravel') return .34;
  if (bed === 'pebble') return .22;
  return .14;
};

/**
 * Build the shipping HydroTileField over the same authored fixture used by
 * the substrate lab. This is a comparison witness, not a replacement solve:
 * the production builder keeps its own nominal flowing depth, making any
 * disagreement with the canonical authored water profile visible.
 */
export function buildProductionHydroFixture(
  input: SubstrateTileInput,
  fieldResolution = 128,
): HydroTileField {
  const points = new Float64Array(input.water.stations.length * 2);
  for (let i = 0; i < input.water.stations.length; i++) {
    points[i * 2] = input.water.stations[i].x;
    points[i * 2 + 1] = input.water.stations[i].z;
  }
  const feature: HydroFeature = {
    id: input.water.id,
    source: 'authored',
    kind: input.water.kind,
    geometry: {
      type: 'line',
      widthM: input.water.halfWidthM * 2,
      points,
    },
    intermittent: false,
    tidal: false,
    roughness: input.water.roughness,
    turbidity: turbidityForBed(input.water.bedMaterial),
    bedMaterial: input.water.bedMaterial,
    bankMaterial: input.water.bankMaterial,
  };
  const hydroInput: HydroTileInput = {
    key: `${input.key}:production-hydro`,
    revision: input.revision,
    bounds: input.bounds,
    elevation: {
      width: input.elevation.width,
      height: input.elevation.height,
      data: input.elevation.data,
      verticalDatum: 'substrate-fixture',
    },
    features: [feature],
    oceanCoverage: { status: 'unavailable' },
    channelInvertM: (x, z) => corridorY(input.water.stations, x, z),
  };
  const analysis = analyseHydroTile(hydroInput);
  const registry = new HydroBodyRegistry(0);
  registry.updateTile(hydroInput.key, analysis.observations);
  return buildHydroTile(hydroInput, registry, analysis, { fieldResolution });
}
