import { HydroBodyRegistry } from './body-registry';
import { analyseHydroTile, buildHydroTile } from './build-tile';
import type { HydroFeature, HydroTileField, HydroTileInput } from './types';

export interface HydroResolutionResult {
  resolution: number;
  meanBuildMs: number;
  fieldMiB: number;
  meanBankErrorM: number;
}

const sampleCoverage = (field: HydroTileField, x: number, z: number): number => {
  const u = (x - field.bounds.minX) / (field.bounds.maxX - field.bounds.minX);
  const v = (z - field.bounds.minZ) / (field.bounds.maxZ - field.bounds.minZ);
  const fx = field.gutter + Math.max(0, Math.min(1, u)) * (field.resolution - 1);
  const fz = field.gutter + Math.max(0, Math.min(1, v)) * (field.resolution - 1);
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const z1 = Math.min(field.height - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const at = (ix: number, iz: number): number => field.geometry[(iz * field.width + ix) * 4];
  return (at(x0, z0) * (1 - tx) + at(x1, z0) * tx) * (1 - tz)
    + (at(x0, z1) * (1 - tx) + at(x1, z1) * tx) * tz;
};

const fieldBytes = (field: HydroTileField): number =>
  field.ground.byteLength
  + field.geometry.byteLength
  + field.dynamics.byteLength
  + field.material.byteLength
  + (field.structure?.byteLength ?? 0);

function crossingAt(
  field: HydroTileField,
  centreX: number,
  z: number,
  direction: -1 | 1,
): number {
  let inner = centreX;
  let outer = centreX + direction * 80;
  for (let i = 0; i < 18; i++) {
    const mid = (inner + outer) * .5;
    if (sampleCoverage(field, mid, z) >= .5) inner = mid;
    else outer = mid;
  }
  return (inner + outer) * .5;
}

function bankError(field: HydroTileField): number {
  let total = 0;
  let count = 0;
  for (let z = 180; z <= 2220; z += 60) {
    const centre = 1200 + Math.sin(z * .0048) * 150;
    const left = crossingAt(field, centre, z, -1);
    const right = crossingAt(field, centre, z, 1);
    total += Math.abs(left - (centre - 13)) + Math.abs(right - (centre + 13));
    count += 2;
  }
  return total / count;
}

function fixture(): HydroTileInput {
  const bounds = { minX: 0, minZ: 0, maxX: 2400, maxZ: 2400 };
  const n = 129;
  const data = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
    const x = ix / (n - 1) * 2400;
    const z = iz / (n - 1) * 2400;
    const centre = 1200 + Math.sin(z * .0048) * 150;
    data[iz * n + ix] = 82 - z * .012 + Math.min(12, Math.abs(x - centre) * .04);
  }
  const points: number[] = [];
  for (let z = 0; z <= 2400; z += 60) {
    points.push(1200 + Math.sin(z * .0048) * 150, z);
  }
  const river: HydroFeature = {
    id: 'resolution:river',
    source: 'authored',
    kind: 'river',
    intermittent: false,
    tidal: false,
    roughness: .48,
    turbidity: .12,
    geometry: { type: 'line', widthM: 26, points: new Float64Array(points) },
  };
  return {
    key: 'resolution/0/0',
    revision: 1,
    bounds,
    elevation: { width: n, height: n, data },
    features: [river],
    oceanCoverage: { status: 'unavailable' },
  };
}

export function runHydroResolutionTest(): HydroResolutionResult[] {
  const input = fixture();
  const analysis = analyseHydroTile(input);
  const registry = new HydroBodyRegistry(0);
  registry.updateTile(input.key, analysis.observations);
  const results: HydroResolutionResult[] = [];
  for (const resolution of [128, 256]) {
    // Warm allocation/JIT before measuring the same deterministic build.
    buildHydroTile(input, registry, analysis, { fieldResolution: resolution });
    let total = 0;
    let field: HydroTileField | undefined;
    for (let i = 0; i < 4; i++) {
      const started = performance.now();
      field = buildHydroTile(input, registry, analysis, { fieldResolution: resolution });
      total += performance.now() - started;
    }
    if (!field) throw new Error('hydro resolution test did not build a field');
    results.push({
      resolution,
      meanBuildMs: total / 4,
      fieldMiB: fieldBytes(field) / (1024 * 1024),
      meanBankErrorM: bankError(field),
    });
  }
  const coarse = results[0], fine = results[1];
  // The finer tier must buy at least twenty per cent less physical bank
  // placement error. The production fixture currently measures ~28%; asking
  // for more would reject a visibly material improvement due to timing/noise
  // nowhere involved in this deterministic geometric metric.
  if (!(fine.meanBankErrorM < coarse.meanBankErrorM * .8)) {
    throw new Error(`256 field did not materially improve bank error: `
      + `${coarse.meanBankErrorM.toFixed(2)}m -> ${fine.meanBankErrorM.toFixed(2)}m`);
  }
  if (!(fine.fieldMiB < coarse.fieldMiB * 4.2)) {
    throw new Error(`256 field memory grew beyond the expected 4x tier`);
  }
  if (!(fine.meanBuildMs < coarse.meanBuildMs * 6.5)) {
    throw new Error(`256 field build cost grew disproportionately: `
      + `${coarse.meanBuildMs.toFixed(1)}ms -> ${fine.meanBuildMs.toFixed(1)}ms`);
  }
  return results;
}
