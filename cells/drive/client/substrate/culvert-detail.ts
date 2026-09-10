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

export interface CulvertHeadwallInput {
  x: number;
  z: number;
  bottomY: number;
  topY: number;
  widthM: number;
  depthM: number;
  rotationY: number;
  minimumHeightM?: number;
}

export interface CulvertHeadwallGeometry {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  index: Uint32Array<ArrayBuffer>;
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

/**
 * Build one indexed, textured headwall box in world coordinates.
 *
 * Keeping this renderer-free prevents the decorative mouth from becoming a
 * second geometry authority beside the versioned structure packet.
 */
export function buildCulvertHeadwallGeometry(
  input: CulvertHeadwallInput,
): CulvertHeadwallGeometry | undefined {
  const heightM = input.topY - input.bottomY;
  if (heightM < (input.minimumHeightM ?? 0.15)) return undefined;
  const centreY = input.bottomY + heightM / 2;
  const halfWidth = input.widthM / 2;
  const halfHeight = heightM / 2;
  const halfDepth = input.depthM / 2;
  const cosine = Math.cos(input.rotationY);
  const sine = Math.sin(input.rotationY);
  const transform = (
    point: readonly [number, number, number],
  ): readonly [number, number, number] => [
    input.x + cosine * point[0] + sine * point[2],
    centreY + point[1],
    input.z - sine * point[0] + cosine * point[2],
  ];
  const rotateNormal = (
    normal: readonly [number, number, number],
  ): readonly [number, number, number] => [
    cosine * normal[0] + sine * normal[2],
    normal[1],
    -sine * normal[0] + cosine * normal[2],
  ];
  const faces: Array<{
    normal: readonly [number, number, number];
    corners: readonly [
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
      readonly [number, number, number],
    ];
  }> = [
    {
      normal: [1, 0, 0],
      corners: [
        [halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, -halfDepth],
      ],
    },
    {
      normal: [-1, 0, 0],
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
        [-halfWidth, halfHeight, halfDepth],
      ],
    },
    {
      normal: [0, 1, 0],
      corners: [
        [-halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
      ],
    },
    {
      normal: [0, -1, 0],
      corners: [
        [-halfWidth, -halfHeight, -halfDepth],
        [halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, halfDepth],
      ],
    },
    {
      normal: [0, 0, 1],
      corners: [
        [-halfWidth, -halfHeight, halfDepth],
        [halfWidth, -halfHeight, halfDepth],
        [-halfWidth, halfHeight, halfDepth],
        [halfWidth, halfHeight, halfDepth],
      ],
    },
    {
      normal: [0, 0, -1],
      corners: [
        [halfWidth, -halfHeight, -halfDepth],
        [-halfWidth, -halfHeight, -halfDepth],
        [halfWidth, halfHeight, -halfDepth],
        [-halfWidth, halfHeight, -halfDepth],
      ],
    },
  ];
  const positions = new Float32Array(6 * 4 * 3);
  const normals = new Float32Array(6 * 4 * 3);
  const uvs = new Float32Array(6 * 4 * 2);
  const index = new Uint32Array(6 * 6);
  const faceUvs = [0, 0, 1, 0, 0, 1, 1, 1];
  for (let face = 0; face < faces.length; face++) {
    const positionOffset = face * 12;
    const uvOffset = face * 8;
    const indexOffset = face * 6;
    const vertexOffset = face * 4;
    const worldNormal = rotateNormal(faces[face].normal);
    for (let corner = 0; corner < 4; corner++) {
      positions.set(transform(faces[face].corners[corner]), positionOffset + corner * 3);
      normals.set(worldNormal, positionOffset + corner * 3);
    }
    uvs.set(faceUvs, uvOffset);
    index.set([
      vertexOffset,
      vertexOffset + 1,
      vertexOffset + 2,
      vertexOffset + 2,
      vertexOffset + 1,
      vertexOffset + 3,
    ], indexOffset);
  }
  return { positions, normals, uvs, index };
}
