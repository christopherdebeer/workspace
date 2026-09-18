export type ProductionRoadSurfaceCorner =
  readonly [x: number, y: number, z: number, u: number, v: number];

export interface ProductionRoadSurfaceBay {
  rightA: ProductionRoadSurfaceCorner;
  rightB: ProductionRoadSurfaceCorner;
  leftA: ProductionRoadSurfaceCorner;
  leftB: ProductionRoadSurfaceCorner;
  color: readonly [r: number, g: number, b: number];
  slip: readonly [rightA: number, rightB: number, leftA: number, leftB: number];
  dirt: readonly [r: number, g: number, b: number];
}

export interface ProductionRoadSurfaceGeometry {
  positions: Float32Array<ArrayBuffer>;
  normals: Float32Array<ArrayBuffer>;
  uvs: Float32Array<ArrayBuffer>;
  colors: Float32Array<ArrayBuffer>;
  slips: Float32Array<ArrayBuffer>;
  dirts: Float32Array<ArrayBuffer>;
}

export interface ProductionRoadKerbGeometryInput {
  stations: readonly (readonly [x: number, z: number])[];
  halfWidthM: number;
  outwardReachM: number;
  startNeighborNormal?: readonly [x: number, z: number] | null;
  endNeighborNormal?: readonly [x: number, z: number] | null;
}

export interface ProductionRoadKerbGeometry {
  right: readonly (readonly [x: number, z: number])[];
  left: readonly (readonly [x: number, z: number])[];
  outwardRight: readonly (readonly [x: number, z: number])[];
  outwardLeft: readonly (readonly [x: number, z: number])[];
  mitreRatio: readonly number[];
}

export interface ProductionRoadCropHost {
  outM: number;
  track: boolean;
  halfWidthM: number;
  tangentX: number;
  tangentZ: number;
  name?: string;
  fragmentId?: number;
  built: boolean;
}

export interface ProductionRoadEndCrop {
  rightFraction: number;
  leftFraction: number;
  hostTangentX: number;
  hostTangentZ: number;
  hiddenBays: number;
}

export type ProductionRoadEndCropReason =
  | 'cropped'
  | 'no-host'
  | 'host-is-track'
  | 'not-inside-host'
  | 'host-narrower'
  | 'tie-unbuilt-host'
  | 'host-ends-here'
  | 'grade-separated'
  | 'continuation'
  | 'too-parallel'
  | 'never-enters-host';

export interface ProductionRoadEndCropInput {
  stations: readonly (readonly [x: number, z: number])[];
  rightOffsets: readonly (readonly [x: number, z: number])[];
  leftOffsets: readonly (readonly [x: number, z: number])[];
  end: 0 | 1;
  halfWidthM: number;
  roadName?: string;
  ownHeightM: number;
  gradeSeparationM: number;
  hostAt(x: number, z: number): ProductionRoadCropHost | null;
  hostEndsAt?(host: ProductionRoadCropHost, x: number, z: number): boolean;
  hostHeightAtNode?(): number | null;
}

export interface ProductionRoadEndCropDecision {
  reason: ProductionRoadEndCropReason;
  host?: ProductionRoadCropHost;
  crop?: ProductionRoadEndCrop;
  alignment?: number;
  heightDeltaM?: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/**
 * Resolve one shared mitred cross-section at every road station.
 *
 * The carriageway, fascia, parapet and batter all consume these offsets. End
 * normals may come from a built continuation so independently authored
 * fragments meet on the same kerb point instead of reverting to a bay-normal
 * butt joint at the tile edge.
 */
export function resolveProductionRoadKerbGeometry(
  input: ProductionRoadKerbGeometryInput,
): ProductionRoadKerbGeometry {
  const n = input.stations.length;
  if (n < 2) {
    return {
      right: [],
      left: [],
      outwardRight: [],
      outwardLeft: [],
      mitreRatio: [],
    };
  }
  const bayNormal = (bay: number): readonly [number, number] => {
    if (bay < 0 && input.startNeighborNormal) return input.startNeighborNormal;
    if (bay > n - 2 && input.endNeighborNormal) return input.endNeighborNormal;
    const station = clamp(bay, 0, n - 2);
    const dx = input.stations[station + 1][0] - input.stations[station][0];
    const dz = input.stations[station + 1][1] - input.stations[station][1];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  };
  const offsetAt = (
    station: number,
    side: 1 | -1,
    reach: number,
  ): readonly [number, number] => {
    const previous = bayNormal(station - 1);
    const next = bayNormal(station);
    const averageX = (previous[0] + next[0]) * 0.5;
    const averageZ = (previous[1] + next[1]) * 0.5;
    const magnitude = Math.hypot(averageX, averageZ);
    if (magnitude < 0.2) {
      return [next[0] * reach * side, next[1] * reach * side];
    }
    const scale = reach * clamp(1 / magnitude, 1, 2.4);
    return [
      (averageX / magnitude) * scale * side,
      (averageZ / magnitude) * scale * side,
    ];
  };
  const right: Array<readonly [number, number]> = [];
  const left: Array<readonly [number, number]> = [];
  const outwardRight: Array<readonly [number, number]> = [];
  const outwardLeft: Array<readonly [number, number]> = [];
  const mitreRatio: number[] = [];
  for (let station = 0; station < n; station++) {
    const rightOffset = offsetAt(station, 1, input.halfWidthM);
    right.push(rightOffset);
    left.push([-rightOffset[0], -rightOffset[1]]);
    const outward = offsetAt(station, 1, input.outwardReachM);
    outwardRight.push(outward);
    outwardLeft.push([-outward[0], -outward[1]]);
    mitreRatio.push(
      Math.hypot(rightOffset[0], rightOffset[1])
        / Math.max(1e-9, input.halfWidthM),
    );
  }
  return { right, left, outwardRight, outwardLeft, mitreRatio };
}

/**
 * Decide where a road end stops against a host carriageway.
 *
 * Host lookup remains a tile-context callback, but hierarchy, continuation,
 * grade-separation, shallow-fork hiding and the left/right kerb intersections
 * are one substrate decision. This keeps build order from creating a second
 * crop authority in the renderer.
 */
export function resolveProductionRoadEndCrop(
  input: ProductionRoadEndCropInput,
): ProductionRoadEndCropDecision {
  const n = input.stations.length;
  if (n < 4
    || input.rightOffsets.length !== n
    || input.leftOffsets.length !== n) {
    throw new Error('road crop requires four stations and matching kerb offsets');
  }
  const node = input.end === 0 ? 0 : n - 1;
  const nodeX = input.stations[node][0];
  const nodeZ = input.stations[node][1];
  const host = input.hostAt(nodeX, nodeZ);
  if (!host) return { reason: 'no-host' };
  if (host.track) return { reason: 'host-is-track', host };
  if (host.outM >= -0.6) return { reason: 'not-inside-host', host };
  if (host.halfWidthM < input.halfWidthM - 0.4) {
    return { reason: 'host-narrower', host };
  }
  if (!host.built && host.halfWidthM < input.halfWidthM + 0.4) {
    return { reason: 'tie-unbuilt-host', host };
  }
  if (host.built && input.hostEndsAt?.(host, nodeX, nodeZ)) {
    return { reason: 'host-ends-here', host };
  }
  const hostHeight = input.hostHeightAtNode?.() ?? null;
  const heightDeltaM = hostHeight === null
    ? undefined
    : hostHeight - input.ownHeightM;
  if (heightDeltaM !== undefined
    && Math.abs(heightDeltaM) > input.gradeSeparationM) {
    return { reason: 'grade-separated', host, heightDeltaM };
  }

  const neighbor = input.end === 0 ? 1 : n - 2;
  const dx = input.stations[neighbor][0] - nodeX;
  const dz = input.stations[neighbor][1] - nodeZ;
  const length = Math.hypot(dx, dz) || 1;
  const alignment = Math.abs(
    (dx / length) * host.tangentX + (dz / length) * host.tangentZ,
  );
  const sameIdentity = input.roadName !== undefined
    ? input.roadName === host.name
    : host.name === undefined;
  if (sameIdentity && alignment >= 0.94) {
    return { reason: 'continuation', host, alignment };
  }
  if (alignment >= 0.99) {
    return { reason: 'too-parallel', host, alignment };
  }

  const offsetAt = (
    station: number,
    side: 1 | -1,
  ): readonly [number, number] =>
    side > 0 ? input.rightOffsets[station] : input.leftOffsets[station];
  const insideStation = (station: number): boolean => {
    for (const side of [1, -1] as const) {
      const offset = offsetAt(station, side);
      const edge = input.hostAt(
        input.stations[station][0] + offset[0],
        input.stations[station][1] + offset[1],
      );
      if (!edge || edge.outM > -0.2) return false;
    }
    return true;
  };
  let hiddenBays = 0;
  const hiddenCap = Math.min(3, n - 3);
  while (hiddenBays < hiddenCap
    && insideStation(input.end === 0 ? hiddenBays : n - 1 - hiddenBays)
    && insideStation(input.end === 0 ? hiddenBays + 1 : n - 2 - hiddenBays)) {
    hiddenBays++;
  }
  const outer = input.end === 0 ? hiddenBays : n - 1 - hiddenBays;
  const inner = input.end === 0 ? hiddenBays + 1 : n - 2 - hiddenBays;
  const fractionFor = (side: 1 | -1): number => {
    const outerOffset = offsetAt(outer, side);
    const innerOffset = offsetAt(inner, side);
    const outerX = input.stations[outer][0] + outerOffset[0];
    const outerZ = input.stations[outer][1] + outerOffset[1];
    const innerX = input.stations[inner][0] + innerOffset[0];
    const innerZ = input.stations[inner][1] + innerOffset[1];
    const outAt = (fraction: number): number => input.hostAt(
      innerX + (outerX - innerX) * fraction,
      innerZ + (outerZ - innerZ) * fraction,
    )?.outM ?? 1;
    if (outAt(1) >= 0) return 1;
    if (outAt(0) <= 0) return 0.08;
    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 9; iteration++) {
      const middle = (low + high) / 2;
      if (outAt(middle) > 0) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const rightFraction = fractionFor(1);
  const leftFraction = fractionFor(-1);
  if (rightFraction >= 1 && leftFraction >= 1 && hiddenBays === 0) {
    return { reason: 'never-enters-host', host, alignment };
  }
  return {
    reason: 'cropped',
    host,
    alignment,
    crop: {
      rightFraction,
      leftFraction,
      hostTangentX: host.tangentX,
      hostTangentZ: host.tangentZ,
      hiddenBays,
    },
  };
}

/**
 * Average coincident road-surface normals within a 40-degree cone.
 *
 * Position vertices remain split so UV seams stay exact; only normals join.
 * The centimetre key and cone match the production ribbon behaviour.
 */
export function smoothProductionRoadSurfaceNormals(
  positions: ArrayLike<number>,
  normals: Float32Array<ArrayBufferLike>,
): void {
  const count = Math.floor(Math.min(positions.length, normals.length) / 3);
  const groups = new Map<string, number[]>();
  for (let vertex = 0; vertex < count; vertex++) {
    const offset = vertex * 3;
    const key = `${Math.round(positions[offset] * 100)},`
      + `${Math.round(positions[offset + 1] * 100)},`
      + `${Math.round(positions[offset + 2] * 100)}`;
    const group = groups.get(key);
    if (group) group.push(vertex);
    else groups.set(key, [vertex]);
  }
  const cosine = 0.75;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const used = new Uint8Array(group.length);
    for (let seed = 0; seed < group.length; seed++) {
      if (used[seed]) continue;
      const seedOffset = group[seed] * 3;
      const members = [group[seed]];
      let x = normals[seedOffset];
      let y = normals[seedOffset + 1];
      let z = normals[seedOffset + 2];
      for (let candidate = seed + 1; candidate < group.length; candidate++) {
        if (used[candidate]) continue;
        const offset = group[candidate] * 3;
        if (normals[seedOffset] * normals[offset]
          + normals[seedOffset + 1] * normals[offset + 1]
          + normals[seedOffset + 2] * normals[offset + 2] > cosine) {
          used[candidate] = 1;
          members.push(group[candidate]);
          x += normals[offset];
          y += normals[offset + 1];
          z += normals[offset + 2];
        }
      }
      if (members.length < 2) continue;
      const length = Math.hypot(x, y, z) || 1;
      x /= length;
      y /= length;
      z /= length;
      for (const member of members) {
        const offset = member * 3;
        normals[offset] = x;
        normals[offset + 1] = y;
        normals[offset + 2] = z;
      }
    }
  }
}

/**
 * Emit the immutable, renderer-neutral surface arrays for solved road bays.
 *
 * Contextual decisions such as junction cropping and terrain paint arrive as
 * final corners and attributes. This function owns triangle order, UV order,
 * paint interpolation and the exact face normals consumed by packet rendering.
 */
export function buildProductionRoadSurfaceGeometry(
  bays: readonly ProductionRoadSurfaceBay[],
): ProductionRoadSurfaceGeometry {
  const vertexCount = bays.length * 6;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const slips = new Float32Array(vertexCount);
  const dirts = new Float32Array(vertexCount * 3);
  const cornerOrder = [0, 1, 2, 1, 3, 2] as const;
  let vertex = 0;
  for (const bay of bays) {
    const corners = [bay.rightA, bay.rightB, bay.leftA, bay.leftB] as const;
    const slip = [
      bay.slip[0],
      bay.slip[1],
      bay.slip[2],
      bay.slip[1],
      bay.slip[3],
      bay.slip[2],
    ] as const;
    for (let local = 0; local < cornerOrder.length; local++, vertex++) {
      const corner = corners[cornerOrder[local]];
      const positionOffset = vertex * 3;
      const uvOffset = vertex * 2;
      positions[positionOffset] = corner[0];
      positions[positionOffset + 1] = corner[1];
      positions[positionOffset + 2] = corner[2];
      uvs[uvOffset] = corner[3];
      uvs[uvOffset + 1] = corner[4];
      colors[positionOffset] = bay.color[0];
      colors[positionOffset + 1] = bay.color[1];
      colors[positionOffset + 2] = bay.color[2];
      slips[vertex] = slip[local];
      dirts[positionOffset] = bay.dirt[0];
      dirts[positionOffset + 1] = bay.dirt[1];
      dirts[positionOffset + 2] = bay.dirt[2];
    }
  }

  for (let triangle = 0; triangle < vertexCount; triangle += 3) {
    const a = triangle * 3;
    const b = a + 3;
    const c = a + 6;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (let local = 0; local < 3; local++) {
      const offset = a + local * 3;
      normals[offset] = nx;
      normals[offset + 1] = ny;
      normals[offset + 2] = nz;
    }
  }
  return { positions, normals, uvs, colors, slips, dirts };
}
