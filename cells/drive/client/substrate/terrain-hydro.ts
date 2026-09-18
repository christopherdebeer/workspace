import type { HydroTileField } from '../hydro/types';
import {
  bankGroundMineralMix,
  bankMineralColour,
  bankPatch,
  sampleBankField,
} from '../shoreline';

export type ProductionTerrainColour = readonly [number, number, number];

export interface ProductionTerrainHydroBlendInput {
  field: HydroTileField;
  positions: Float32Array;
  colours: Float32Array;
  normals: Float32Array;
  centreX: number;
  centreZ: number;
  baseElevationM: number;
  coverAt: (x: number, z: number) => number | null;
  terrainColourAt: (
    elevationM: number,
    slope: number,
    cover: number | null,
    x: number,
    z: number,
  ) => ProductionTerrainColour;
  bankRadiusM?: number;
}

/**
 * Apply the canonical hydro-bank ground treatment to final terrain arrays.
 *
 * Terrain construction may run synchronously or in a worker, but both paths
 * publish the same array contract. Keeping field sampling, slope derivation
 * and colour mutation here prevents those paths from acquiring separate bank
 * transforms after the substrate tile has been authored.
 */
export function blendProductionTerrainHydroBank(
  input: ProductionTerrainHydroBlendInput,
): number {
  const {
    field,
    positions,
    colours,
    normals,
    centreX,
    centreZ,
    baseElevationM,
    coverAt,
    terrainColourAt,
  } = input;
  if (
    positions.length % 3 !== 0
    || colours.length !== positions.length
    || normals.length !== positions.length
  ) {
    throw new Error('terrain hydro blend arrays must contain matching xyz triples');
  }
  const radiusM = input.bankRadiusM ?? 12;
  if (!Number.isFinite(radiusM) || radiusM < 0) {
    throw new Error('terrain hydro blend radius must be finite and non-negative');
  }

  let blendedVertices = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] + centreX;
    const z = positions[i + 2] + centreZ;
    const bank = sampleBankField(field, x, z, radiusM);
    if (!bank) continue;
    const mix = bankGroundMineralMix(bank, bankPatch(x, z));
    if (mix <= 0) continue;
    const ny = Math.max(0.08, Math.abs(normals[i + 1]));
    const slope = Math.hypot(normals[i], normals[i + 2]) / ny;
    const local = terrainColourAt(
      positions[i + 1] + baseElevationM,
      slope,
      coverAt(x, z),
      x,
      z,
    );
    const mineral = bankMineralColour(local[0], local[1], local[2]);
    colours[i] += (mineral[0] - colours[i]) * mix;
    colours[i + 1] += (mineral[1] - colours[i + 1]) * mix;
    colours[i + 2] += (mineral[2] - colours[i + 2]) * mix;
    blendedVertices++;
  }
  return blendedVertices;
}
