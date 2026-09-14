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
