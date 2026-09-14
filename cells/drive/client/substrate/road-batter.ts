export type ProductionRoadBatterColour = readonly [number, number, number];

export type ProductionRoadBatterStep = readonly [
  distanceA: number,
  distanceB: number,
  heightA: number,
  heightB: number,
  seatedA: number,
  seatedB: number,
  groundA: number,
  groundB: number,
];

export type ProductionRoadBatterTint = readonly [
  colourA: ProductionRoadBatterColour,
  colourB: ProductionRoadBatterColour,
];

export interface ProductionRoadBatterInput {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  normalAx: number;
  normalAz: number;
  normalBx: number;
  normalBz: number;
  kerbHeightA: number;
  kerbHeightB: number;
  uA: number;
  uB: number;
  capA: boolean;
  capB: boolean;
  normalReachM: number;
  shoulderColour: ProductionRoadBatterColour;
  steps: readonly ProductionRoadBatterStep[];
  tints: readonly ProductionRoadBatterTint[];
}

export interface ProductionRoadBatterResult {
  capCount: number;
}

export interface ProductionRoadBatterReachInput {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  normalAx: number;
  normalAz: number;
  normalBx: number;
  normalBz: number;
  kerbHeightA: number;
  kerbHeightB: number;
  normalReachM: number;
  bankSlope: number;
  cutSlope: number;
  vergeM: number;
  cutReachM: number;
  distancesM: readonly number[];
  shoulderColour: ProductionRoadBatterColour;
  earthColour: ProductionRoadBatterColour;
  rockColour: ProductionRoadBatterColour;
  blockedAt: (distanceM: number) => boolean;
  hasGround: (x: number, z: number) => boolean;
  waterAt: (x: number, z: number) => boolean;
  groundAt: (x: number, z: number) => number;
  terrainColourAt: (x: number, z: number, groundY: number) => ProductionRoadBatterColour;
}

export interface ProductionRoadBatterReachResult {
  steps: ProductionRoadBatterStep[];
  tints: ProductionRoadBatterTint[];
  contactMet: boolean;
  drawable: boolean;
  clipped: boolean;
  wet: boolean;
  noGap: boolean;
  reachedM: number;
  unknownAt: { x: number; z: number } | null;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/**
 * Resolve the production shoulder/batter reach against streamed world
 * callbacks. The substrate owns wedge limits, exact toe interpolation,
 * cut-wall promotion, carriageway clipping and water/unknown-ground stops.
 */
export function resolveProductionRoadBatterReach(
  input: ProductionRoadBatterReachInput,
): ProductionRoadBatterReachResult {
  const steps: ProductionRoadBatterStep[] = [];
  const tints: ProductionRoadBatterTint[] = [];
  const reach = input.distancesM[input.distancesM.length - 1] ?? 0;
  let limit = reach;
  let clipped = false;
  let contactMet = false;
  let wet = false;
  let noGap = false;
  let unknownAt: { x: number; z: number } | null = null;
  let toeA = -1;
  let toeB = -1;

  const clearTo = (low: number, high: number): number => {
    let best = low;
    for (let distance = low + 0.25; distance <= high; distance += 0.25) {
      if (input.blockedAt(distance)) break;
      best = distance;
    }
    return best;
  };

  for (const requestedDistance of input.distancesM) {
    let distance = requestedDistance;
    if (distance > limit) break;
    if (input.blockedAt(distance)) {
      const last = steps.length
        ? Math.max(steps[steps.length - 1][0], steps[steps.length - 1][1])
        : 0;
      limit = clearTo(last, distance);
      clipped = true;
      if (limit <= last + 0.2) break;
      distance = limit;
    }
    const fraction = distance / input.normalReachM;
    const xA = input.ax + input.normalAx * fraction;
    const zA = input.az + input.normalAz * fraction;
    const xB = input.bx + input.normalBx * fraction;
    const zB = input.bz + input.normalBz * fraction;
    const groundAAvailable = input.hasGround(xA, zA);
    const groundBAvailable = input.hasGround(xB, zB);
    if (!groundAAvailable || !groundBAvailable) {
      unknownAt = groundAAvailable ? { x: xB, z: zB } : { x: xA, z: zA };
      break;
    }
    if (input.waterAt(xA, zA) || input.waterAt(xB, zB)) {
      wet = true;
      break;
    }
    const groundA = input.groundAt(xA, zA);
    const groundB = input.groundAt(xB, zB);
    if (!steps.length
      && Math.abs(groundA - input.kerbHeightA) < 0.35
      && Math.abs(groundB - input.kerbHeightB) < 0.35) {
      noGap = true;
      contactMet = true;
      break;
    }
    const slopeDistance = Math.max(0, distance - input.vergeM);
    const lowA = input.kerbHeightA - slopeDistance * input.bankSlope;
    const lowB = input.kerbHeightB - slopeDistance * input.bankSlope;
    const highA = input.kerbHeightA + slopeDistance * input.cutSlope;
    const highB = input.kerbHeightB + slopeDistance * input.cutSlope;
    let pointA = clamp(groundA, lowA, highA);
    let pointB = clamp(groundB, lowB, highB);
    let seatedA = pointA === groundA;
    let seatedB = pointB === groundB;
    let wallA = false;
    let wallB = false;
    if (distance >= input.cutReachM) {
      if (!seatedA && groundA > highA) {
        pointA = groundA;
        seatedA = true;
        wallA = true;
      }
      if (!seatedB && groundB > highB) {
        pointB = groundB;
        seatedB = true;
        wallB = true;
      }
    }
    const previous = steps.length ? steps[steps.length - 1] : null;
    const cutA = !seatedA && groundA > highA;
    const cutB = !seatedB && groundB > highB;
    const resolveSide = (
      seated: boolean,
      wall: boolean,
      ground: number,
      low: number,
      high: number,
      previousPoint: number,
      previousGround: number,
      previousDistance: number,
      toe: number,
      x: number,
      z: number,
      normalX: number,
      normalZ: number,
    ): [number, number, number] => {
      if (!seated) return [distance, ground < low ? low : high, -1];
      if (wall) return [distance, ground, distance];
      if (toe >= 0) {
        const edge = Math.min(distance, toe + 1);
        const edgeFraction = edge / input.normalReachM;
        return [
          edge,
          input.groundAt(x + normalX * edgeFraction, z + normalZ * edgeFraction),
          toe,
        ];
      }
      const previousGap = previous ? Math.abs(previousPoint - previousGround) : 0;
      const currentGap = Math.max(0, Math.min(ground - low, high - ground));
      const blend = previousGap + currentGap > 1e-6
        ? previousGap / (previousGap + currentGap)
        : 1;
      const edge = previous
        ? previousDistance + blend * (distance - previousDistance)
        : distance;
      const edgeFraction = edge / input.normalReachM;
      return [
        edge,
        input.groundAt(x + normalX * edgeFraction, z + normalZ * edgeFraction),
        edge,
      ];
    };
    const sideA = resolveSide(
      seatedA,
      wallA,
      groundA,
      lowA,
      highA,
      previous ? previous[2] : 0,
      previous ? previous[6] : 0,
      previous ? previous[0] : 0,
      toeA,
      input.ax,
      input.az,
      input.normalAx,
      input.normalAz,
    );
    const sideB = resolveSide(
      seatedB,
      wallB,
      groundB,
      lowB,
      highB,
      previous ? previous[3] : 0,
      previous ? previous[7] : 0,
      previous ? previous[1] : 0,
      toeB,
      input.bx,
      input.bz,
      input.normalBx,
      input.normalBz,
    );
    toeA = sideA[2];
    toeB = sideB[2];
    steps.push([
      sideA[0],
      sideB[0],
      sideA[1],
      sideB[1],
      seatedA ? 1 : 0,
      seatedB ? 1 : 0,
      groundA,
      groundB,
    ]);
    tints.push([
      distance <= input.vergeM
        ? input.shoulderColour
        : wallA
          ? input.rockColour
          : cutA
            ? input.earthColour
            : input.terrainColourAt(xA, zA, groundA),
      distance <= input.vergeM
        ? input.shoulderColour
        : wallB
          ? input.rockColour
          : cutB
            ? input.earthColour
            : input.terrainColourAt(xB, zB, groundB),
    ]);
    if (seatedA && seatedB) {
      contactMet = true;
      break;
    }
    if (clipped) break;
  }

  const cutFaceMet = steps.some((step) =>
    step[2] > input.kerbHeightA + 0.3 || step[3] > input.kerbHeightB + 0.3);
  const drawable = steps.length > 0
    && (contactMet || cutFaceMet || clipped || wet)
    && unknownAt === null;
  const reachedM = steps.length
    ? Math.max(steps[steps.length - 1][0], steps[steps.length - 1][1])
    : 0;
  return {
    steps,
    tints,
    contactMet,
    drawable,
    clipped,
    wet,
    noGap,
    reachedM,
    unknownAt,
  };
}

const appendQuad = (
  vertices: number[],
  uvs: number[],
  colours: number[],
  seats: number[],
  positions: readonly number[],
  textureCoordinates: readonly number[],
  cornerColours: readonly [
    ProductionRoadBatterColour,
    ProductionRoadBatterColour,
    ProductionRoadBatterColour,
    ProductionRoadBatterColour,
  ],
  cornerSeats: readonly [number, number, number, number],
): void => {
  if (positions.length !== 12 || textureCoordinates.length !== 8) {
    throw new Error('road batter quad requires four positions and four UVs');
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
  const [colourA, colourB, colourC, colourD] = cornerColours;
  colours.push(
    colourA[0], colourA[1], colourA[2],
    colourB[0], colourB[1], colourB[2],
    colourC[0], colourC[1], colourC[2],
    colourB[0], colourB[1], colourB[2],
    colourD[0], colourD[1], colourD[2],
    colourC[0], colourC[1], colourC[2],
  );
  seats.push(
    cornerSeats[0],
    cornerSeats[1],
    cornerSeats[2],
    cornerSeats[1],
    cornerSeats[3],
    cornerSeats[2],
  );
};

/**
 * Append the production batter strip and optional end-cap fans.
 *
 * The caller owns terrain/contact decisions. This function owns the exact
 * triangle, UV, colour and ground-seat ordering consumed by rendering.
 */
export function appendProductionRoadBatter(
  vertices: number[],
  uvs: number[],
  colours: number[],
  seats: number[],
  input: ProductionRoadBatterInput,
): ProductionRoadBatterResult {
  if (input.steps.length !== input.tints.length) {
    throw new Error('road batter steps and tints must have matching lengths');
  }
  let capCount = 0;
  for (const [end, enabled] of [[0, input.capA], [1, input.capB]] as const) {
    if (!enabled || !input.steps.length) continue;
    const endB = end === 1;
    const x = endB ? input.bx : input.ax;
    const z = endB ? input.bz : input.az;
    const normalX = endB ? input.normalBx : input.normalAx;
    const normalZ = endB ? input.normalBz : input.normalAz;
    const kerbHeight = endB ? input.kerbHeightB : input.kerbHeightA;
    let previousDistance = 0;
    let previousHeight = kerbHeight;
    let previousSeat = 0;
    let previousColour = input.shoulderColour;
    for (let index = 0; index < input.steps.length; index++) {
      const step = input.steps[index];
      const distance = endB ? step[1] : step[0];
      const height = endB ? step[3] : step[2];
      const seat = endB ? step[5] : step[4];
      const colour = endB ? input.tints[index][1] : input.tints[index][0];
      const previousFraction = previousDistance / input.normalReachM;
      const fraction = distance / input.normalReachM;
      appendQuad(
        vertices,
        uvs,
        colours,
        seats,
        [
          x, kerbHeight, z,
          x, kerbHeight, z,
          x + normalX * previousFraction,
          previousHeight,
          z + normalZ * previousFraction,
          x + normalX * fraction,
          height,
          z + normalZ * fraction,
        ],
        [
          input.uA * 2, 0,
          input.uA * 2, 0,
          input.uA * 2, previousDistance / 4,
          input.uA * 2, distance / 4,
        ],
        [
          input.shoulderColour,
          input.shoulderColour,
          previousColour,
          colour,
        ],
        [0, 0, previousSeat, seat],
      );
      previousDistance = distance;
      previousHeight = height;
      previousSeat = seat;
      previousColour = colour;
    }
    capCount++;
  }

  let previousDistanceA = 0;
  let previousDistanceB = 0;
  let previousHeightA = input.kerbHeightA;
  let previousHeightB = input.kerbHeightB;
  let previousSeatA = 0;
  let previousSeatB = 0;
  let previousColourA = input.shoulderColour;
  let previousColourB = input.shoulderColour;
  for (let index = 0; index < input.steps.length; index++) {
    const [
      distanceA,
      distanceB,
      heightA,
      heightB,
      seatA,
      seatB,
    ] = input.steps[index];
    const [colourA, colourB] = input.tints[index];
    const previousFractionA = previousDistanceA / input.normalReachM;
    const previousFractionB = previousDistanceB / input.normalReachM;
    const fractionA = distanceA / input.normalReachM;
    const fractionB = distanceB / input.normalReachM;
    appendQuad(
      vertices,
      uvs,
      colours,
      seats,
      [
        input.ax + input.normalAx * previousFractionA,
        previousHeightA,
        input.az + input.normalAz * previousFractionA,
        input.bx + input.normalBx * previousFractionB,
        previousHeightB,
        input.bz + input.normalBz * previousFractionB,
        input.ax + input.normalAx * fractionA,
        heightA,
        input.az + input.normalAz * fractionA,
        input.bx + input.normalBx * fractionB,
        heightB,
        input.bz + input.normalBz * fractionB,
      ],
      [
        input.uA * 2, previousDistanceA / 4,
        input.uB * 2, previousDistanceB / 4,
        input.uA * 2, distanceA / 4,
        input.uB * 2, distanceB / 4,
      ],
      [previousColourA, previousColourB, colourA, colourB],
      [previousSeatA, previousSeatB, seatA, seatB],
    );
    previousDistanceA = distanceA;
    previousDistanceB = distanceB;
    previousHeightA = heightA;
    previousHeightB = heightB;
    previousSeatA = seatA;
    previousSeatB = seatB;
    previousColourA = colourA;
    previousColourB = colourB;
  }
  return { capCount };
}
