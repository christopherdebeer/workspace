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
