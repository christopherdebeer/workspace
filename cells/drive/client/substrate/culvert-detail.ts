import {
  pickInfrastructureRecipe,
  type InfrastructureContext,
  type StructureRecipe,
} from '../infrastructure';
import type { CrossingStructureOutcome } from './crossing-authority';

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

export type ProductionCulvertRecipeContext = Omit<
  InfrastructureContext,
  | 'kind'
  | 'lengthM'
  | 'spanM'
  | 'roadWidthM'
  | 'taggedStructure'
  | 'coverM'
  | 'waterWidthM'
  | 'availableClearanceM'
>;

export interface ProductionCulvertInput {
  stations: readonly (readonly [x: number, z: number])[];
  invertY: readonly number[];
  groundY: readonly number[];
  deckY: readonly (number | null)[];
  start: number;
  end: number;
  coreStart: number;
  coreEnd: number;
  widthM: number;
  recipeContext: ProductionCulvertRecipeContext;
  taggedFamily?: string;
  allowWetFordFallback?: boolean;
  underDeckM?: number;
  minimumClearanceM?: number;
  rigClearanceM?: number;
  nominalStationSpacingM?: number;
}

export interface ProductionCulvert {
  outcome: CrossingStructureOutcome;
  availableClearanceM: number | null;
  family?: string;
  recipe?: StructureRecipe;
  bore?: CulvertBoreGeometry;
  headwalls: CulvertHeadwallGeometry[];
  heightM: number;
  widthM: number;
  rigSized: boolean;
  tooTight: boolean;
  minimumUnderDeckM: number | null;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

const productionCulvertOffsets = (
  stations: readonly (readonly [number, number])[],
  start: number,
  end: number,
  halfWidthM: number,
): Array<readonly [number, number]> => {
  const bay = (index: number): readonly [number, number] => {
    const station = clamp(index, start, end - 1);
    const dx = stations[station + 1][0] - stations[station][0];
    const dz = stations[station + 1][1] - stations[station][1];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  };
  const offsets: Array<readonly [number, number]> = [];
  for (let station = start; station <= end; station++) {
    const [priorX, priorZ] = bay(station - 1);
    const [nextX, nextZ] = bay(station);
    const meanX = (priorX + nextX) * .5;
    const meanZ = (priorZ + nextZ) * .5;
    const magnitude = Math.hypot(meanX, meanZ);
    if (magnitude < .2) {
      offsets.push([nextX * halfWidthM, nextZ * halfWidthM]);
      continue;
    }
    const scale = halfWidthM * clamp(1 / magnitude, 1, 2.4);
    offsets.push([meanX / magnitude * scale, meanZ / magnitude * scale]);
  }
  return offsets;
};

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
 * The production resolver below owns clearance and family selection; this
 * lower-level builder owns the exact walls, soffit and optional cell divider.
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

/**
 * Resolve and author one production conduit from sampled terrain/deck facts.
 *
 * The live context supplies observations and cultural inputs, while this
 * renderer-free boundary owns every construction decision and the resulting
 * final geometry arrays.
 */
export function buildProductionCulvert(
  input: ProductionCulvertInput,
): ProductionCulvert {
  const stationCount = input.stations.length;
  if (
    input.invertY.length !== stationCount
    || input.groundY.length !== stationCount
    || input.deckY.length !== stationCount
    || input.start < 0
    || input.end >= stationCount
    || input.end <= input.start
    || input.coreStart < input.start
    || input.coreEnd > input.end
    || input.coreEnd < input.coreStart
  ) {
    throw new Error('production culvert station arrays or bounds are invalid');
  }
  const empty = (
    outcome: CrossingStructureOutcome,
    availableClearanceM: number | null,
    family?: string,
    recipe?: StructureRecipe,
    tooTight = false,
  ): ProductionCulvert => ({
    outcome,
    availableClearanceM,
    family,
    recipe,
    headwalls: [],
    heightM: 0,
    widthM: 0,
    rigSized: false,
    tooTight,
    minimumUnderDeckM: null,
  });

  const underDeckM = input.underDeckM ?? .8;
  const minimumClearanceM = input.minimumClearanceM ?? .35;
  const rigClearanceM = input.rigClearanceM ?? 3.2;
  if (
    !Number.isFinite(input.widthM)
    || input.widthM <= 0
    || !Number.isFinite(underDeckM)
    || underDeckM < 0
    || !Number.isFinite(minimumClearanceM)
    || minimumClearanceM < 0
    || !Number.isFinite(rigClearanceM)
    || rigClearanceM < minimumClearanceM
  ) {
    throw new Error('production culvert dimensions must be finite and ordered');
  }

  let room = Infinity;
  for (let station = input.coreStart; station <= input.coreEnd; station++) {
    const deck = input.deckY[station];
    const roof = deck === null
      ? input.groundY[station]
      : Math.min(input.groundY[station], deck - underDeckM);
    room = Math.min(room, roof - input.invertY[station]);
  }
  if (!Number.isFinite(room)) return empty('infeasible', null);
  if (room < minimumClearanceM) {
    return input.allowWetFordFallback
      ? empty('ford-fallback', room, 'ford', undefined, true)
      : empty('no-room', room, undefined, undefined, true);
  }

  const recipe = pickInfrastructureRecipe({
    ...input.recipeContext,
    kind: 'conduit',
    lengthM: Math.max(1, input.end - input.start)
      * (input.nominalStationSpacingM ?? 12),
    spanM: input.widthM,
    roadWidthM: input.widthM,
    taggedStructure: input.taggedFamily,
    coverM: room,
    waterWidthM: input.widthM,
    availableClearanceM: room,
  });
  if (!recipe.feasible) {
    return empty('infeasible', room, recipe.family, recipe);
  }
  if (recipe.family === 'ford') {
    return empty('ford-fallback', room, recipe.family, recipe);
  }

  const rigSized = room >= rigClearanceM;
  const heightM = rigSized
    ? rigClearanceM
    : Math.min(room, recipe.family === 'pipe' ? 1.45 : 1.8);
  const widthM = Math.max(
    input.widthM,
    rigSized ? 4.4 : recipe.family === 'pipe' ? 1.6 : 2.2,
  );
  const offsets = productionCulvertOffsets(
    input.stations,
    input.start,
    input.end,
    widthM / 2,
  );
  const bore = buildCulvertBoreGeometry({
    stations: input.stations,
    invertY: input.invertY,
    offsets,
    start: input.start,
    end: input.end,
    heightM,
    family: recipe.family,
  });

  let minimumUnderDeckM = Infinity;
  for (let station = input.coreStart; station <= input.coreEnd; station++) {
    const deck = input.deckY[station];
    if (deck === null) continue;
    minimumUnderDeckM = Math.min(
      minimumUnderDeckM,
      deck - (input.invertY[station] + heightM),
    );
  }
  const headwalls: CulvertHeadwallGeometry[] = [];
  for (const end of [input.start, input.end]) {
    const prior = end === input.start ? input.start : input.end - 1;
    const next = end === input.start ? input.start + 1 : input.end;
    const [x0, z0] = input.stations[prior];
    const [x1, z1] = input.stations[next];
    const [x, z] = input.stations[end];
    const deck = input.deckY[end];
    const ceiling = deck === null ? Infinity : deck - underDeckM;
    const wall = buildCulvertHeadwallGeometry({
      x,
      z,
      bottomY: input.invertY[end] - .4,
      topY: Math.min(input.invertY[end] + heightM + .7, ceiling),
      widthM: widthM + 2.4,
      depthM: .7,
      rotationY: Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2,
    });
    if (wall) headwalls.push(wall);
  }
  return {
    outcome: 'culvert-built',
    availableClearanceM: room,
    family: recipe.family,
    recipe,
    bore,
    headwalls,
    heightM,
    widthM,
    rigSized,
    tooTight: false,
    minimumUnderDeckM: Number.isFinite(minimumUnderDeckM)
      ? minimumUnderDeckM
      : null,
  };
}
