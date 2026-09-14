export interface ProductionRoadFaceInput {
  xA: number;
  yA: number;
  zA: number;
  xB: number;
  yB: number;
  zB: number;
  bottomA: number;
  bottomB: number;
  u0: number;
  u1: number;
}

export interface ProductionRoadPierInput {
  centreX: number;
  centreZ: number;
  axisX: number;
  axisZ: number;
  topY: number;
  bottomY: number;
  halfWidthM: number;
}

export interface ProductionRoadArchInput {
  start: { x: number; z: number; top: number; bottom: number };
  end: { x: number; z: number; top: number; bottom: number };
  halfWidthM: number;
  segments?: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/**
 * Append one four-corner renderer-neutral quad as the production triangle soup.
 */
export function appendProductionRoadQuad(
  vertices: number[],
  uvs: number[],
  positions: readonly number[],
  textureCoordinates: readonly number[],
): void {
  if (positions.length !== 12 || textureCoordinates.length !== 8) {
    throw new Error('road detail quad requires four positions and four UVs');
  }
  vertices.push(
    positions[0], positions[1], positions[2],
    positions[3], positions[4], positions[5],
    positions[6], positions[7], positions[8],
    positions[3], positions[4], positions[5],
    positions[9], positions[10], positions[11],
    positions[6], positions[7], positions[8],
  );
  uvs.push(
    textureCoordinates[0], textureCoordinates[1],
    textureCoordinates[2], textureCoordinates[3],
    textureCoordinates[4], textureCoordinates[5],
    textureCoordinates[2], textureCoordinates[3],
    textureCoordinates[6], textureCoordinates[7],
    textureCoordinates[4], textureCoordinates[5],
  );
}

/** Append one vertical apron/fascia face with metre-scaled texture depth. */
export function appendProductionRoadFace(
  vertices: number[],
  uvs: number[],
  input: ProductionRoadFaceInput,
): void {
  const depthA = (input.yA - input.bottomA) / 4;
  const depthB = (input.yB - input.bottomB) / 4;
  vertices.push(
    input.xA, input.yA, input.zA,
    input.xB, input.yB, input.zB,
    input.xA, input.bottomA, input.zA,
    input.xB, input.yB, input.zB,
    input.xB, input.bottomB, input.zB,
    input.xA, input.bottomA, input.zA,
  );
  uvs.push(
    input.u0, 0,
    input.u1, 0,
    input.u0, depthA,
    input.u1, 0,
    input.u1, depthB,
    input.u0, depthA,
  );
}

/** Append the four splayed faces of one bridge pier. */
export function appendProductionRoadPier(
  vertices: number[],
  uvs: number[],
  input: ProductionRoadPierInput,
): void {
  const length = Math.hypot(input.axisX, input.axisZ) || 1;
  const alongX = input.axisX / length;
  const alongZ = input.axisZ / length;
  const acrossX = -alongZ;
  const acrossZ = alongX;
  const corner = (side: number, along: number): readonly [number, number] => [
    input.centreX + acrossX * input.halfWidthM * side + alongX * 1.05 * along,
    input.centreZ + acrossZ * input.halfWidthM * side + alongZ * 1.05 * along,
  ];
  const splay = 1.22;
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]] as const;
  for (let face = 0; face < corners.length; face++) {
    const [side0, along0] = corners[face];
    const [side1, along1] = corners[(face + 1) % corners.length];
    const top0 = corner(side0, along0);
    const top1 = corner(side1, along1);
    const bottom0 = corner(side0 * splay, along0 * splay);
    const bottom1 = corner(side1 * splay, along1 * splay);
    const textureHeight = (input.topY - input.bottomY) / 4;
    appendProductionRoadQuad(vertices, uvs, [
      top0[0], input.topY, top0[1],
      top1[0], input.topY, top1[1],
      bottom0[0], input.bottomY, bottom0[1],
      bottom1[0], input.bottomY, bottom1[1],
    ], [0, 0, 1, 0, 0, textureHeight, 1, textureHeight]);
  }
}

/**
 * Append the paired segmented spandrel faces between two piers.
 *
 * Returns false when the span is outside the production arch proportions.
 */
export function appendProductionRoadArch(
  vertices: number[],
  uvs: number[],
  input: ProductionRoadArchInput,
): boolean {
  const dx = input.end.x - input.start.x;
  const dz = input.end.z - input.start.z;
  const gap = Math.hypot(dx, dz);
  if (gap < 8 || gap > 45) return false;
  const acrossX = -dz / gap;
  const acrossZ = dx / gap;
  const crownDrop = clamp(gap * 0.18, 0.7, 2);
  const springDrop = clamp(gap * 0.75, 3, 10);
  const floor = Math.min(input.start.bottom, input.end.bottom);
  const topAt = (fraction: number): number =>
    input.start.top + (input.end.top - input.start.top) * fraction;
  const lowAt = (fraction: number): number => Math.max(
    floor,
    topAt(fraction)
      - crownDrop
      - (springDrop - crownDrop) * Math.abs(Math.cos(Math.PI * fraction)),
  );
  const segments = input.segments ?? 8;
  for (const side of [1, -1]) {
    for (let segment = 0; segment < segments; segment++) {
      const fraction0 = segment / segments;
      const fraction1 = (segment + 1) / segments;
      const x0 = input.start.x + dx * fraction0
        + acrossX * input.halfWidthM * side;
      const z0 = input.start.z + dz * fraction0
        + acrossZ * input.halfWidthM * side;
      const x1 = input.start.x + dx * fraction1
        + acrossX * input.halfWidthM * side;
      const z1 = input.start.z + dz * fraction1
        + acrossZ * input.halfWidthM * side;
      appendProductionRoadQuad(vertices, uvs, [
        x0, topAt(fraction0), z0,
        x1, topAt(fraction1), z1,
        x0, lowAt(fraction0), z0,
        x1, lowAt(fraction1), z1,
      ], [
        gap * fraction0 / 4, 0,
        gap * fraction1 / 4, 0,
        gap * fraction0 / 4, springDrop / 4,
        gap * fraction1 / 4, springDrop / 4,
      ]);
    }
  }
  return true;
}
