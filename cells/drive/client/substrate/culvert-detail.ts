export type CulvertStructureFamily = 'pipe' | 'box' | 'twin-cell' | string;

export interface CulvertBoreInput {
  stations: readonly (readonly [x: number, z: number])[];
  invertY: readonly number[];
  offsets: readonly (readonly [x: number, z: number])[];
  start: number;
  end: number;
  heightM: number;
  family: CulvertStructureFamily;
}

export interface CulvertBoreGeometry {
  positions: Float32Array<ArrayBuffer>;
  lengthM: number;
}

const appendQuad = (
  output: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void => {
  output.push(...a, ...b, ...c, ...b, ...d, ...c);
};

/**
 * Renderer-free culvert shell authoring from an already resolved conduit.
 * Clearance and structure-family selection happen before this boundary; the
 * substrate builder owns the exact walls, soffit and optional cell divider.
 */
export function buildCulvertBoreGeometry(
  input: CulvertBoreInput,
): CulvertBoreGeometry {
  const stationCount = input.stations.length;
  if (input.invertY.length !== stationCount) {
    throw new Error('culvert stations and invert arrays must have matching lengths');
  }
  if (input.start < 0
    || input.end >= stationCount
    || input.end <= input.start
    || input.offsets.length !== input.end - input.start + 1) {
    throw new Error('culvert bore bounds or offsets are invalid');
  }
  const positions: number[] = [];
  let lengthM = 0;
  for (let station = input.start; station < input.end; station++) {
    const [x0, z0] = input.stations[station];
    const [x1, z1] = input.stations[station + 1];
    lengthM += Math.hypot(x1 - x0, z1 - z0) || 1;
    const [ax, az] = input.offsets[station - input.start];
    const [bx, bz] = input.offsets[station + 1 - input.start];
    const floorA = input.invertY[station];
    const floorB = input.invertY[station + 1];
    const ceilingA = floorA + input.heightM;
    const ceilingB = floorB + input.heightM;
    appendQuad(
      positions,
      [x0 + ax, floorA, z0 + az],
      [x1 + bx, floorB, z1 + bz],
      [x0 + ax, ceilingA, z0 + az],
      [x1 + bx, ceilingB, z1 + bz],
    );
    appendQuad(
      positions,
      [x0 - ax, floorA, z0 - az],
      [x1 - bx, floorB, z1 - bz],
      [x0 - ax, ceilingA, z0 - az],
      [x1 - bx, ceilingB, z1 - bz],
    );
    appendQuad(
      positions,
      [x0 + ax, ceilingA, z0 + az],
      [x1 + bx, ceilingB, z1 + bz],
      [x0 - ax, ceilingA, z0 - az],
      [x1 - bx, ceilingB, z1 - bz],
    );
    if (input.family === 'twin-cell') {
      appendQuad(
        positions,
        [x0, floorA, z0],
        [x1, floorB, z1],
        [x0, ceilingA, z0],
        [x1, ceilingB, z1],
      );
    }
  }
  return {
    positions: new Float32Array(positions),
    lengthM,
  };
}
