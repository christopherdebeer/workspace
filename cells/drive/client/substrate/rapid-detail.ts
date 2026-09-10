export type RapidDetailStoneFamily = readonly [
  hue: number,
  hueSpan: number,
  saturation: number,
  saturationSpan: number,
  lightness: number,
  lightnessSpan: number,
];

export interface RapidDetailRock {
  station: number;
  sequence: number;
  stationX: number;
  stationZ: number;
  x: number;
  z: number;
  radiusM: number;
  topY: number;
  baseY: number;
  spin: number;
  tone: number;
  across: number;
}

export interface RapidDetailCollider {
  x: number;
  z: number;
  radiusM: number;
}

export interface RapidDetailMesh {
  positions: Float32Array<ArrayBuffer>;
  colours: Float32Array<ArrayBuffer>;
  colliders: readonly RapidDetailCollider[];
}

export interface RapidDetailReachInput {
  stations: readonly (readonly [x: number, z: number])[];
  /** Mitred channel half-width offsets, one per station. */
  offsets: readonly (readonly [x: number, z: number])[];
  invertY: readonly number[];
  speedMps: readonly number[];
  widthM: number;
  /** True when station indices already run from source toward mouth. */
  downhillInArrayOrder: boolean;
}

export interface RapidDetailField {
  rocks: readonly RapidDetailRock[];
  foamPositive: Float32Array<ArrayBuffer>;
  foamNegative: Float32Array<ArrayBuffer>;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

/** Stable rebuild hash shared by placement and authored stone facets. */
export function rapidDetailRandom(x: number, z: number, sequence: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233 + sequence * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Resolve the solid witnesses and aeration field for one flowing reach.
 *
 * This is deliberately upstream of rendering: the same rock record drives
 * surface foam, authored facets and vehicle collision. Rebuilding a tile from
 * identical stations therefore cannot move a boulder or leave whitewater where
 * no solid witness exists.
 */
export function buildRapidDetailField(
  input: RapidDetailReachInput,
): RapidDetailField {
  const n = input.stations.length;
  if (input.offsets.length !== n
    || input.invertY.length !== n
    || input.speedMps.length !== n) {
    throw new Error('rapid detail reach arrays must have matching lengths');
  }
  const rocks: RapidDetailRock[] = [];
  for (let station = 1; station < n - 1; station++) {
    const speed = input.speedMps[station];
    if (speed < 1.35) continue;
    const [stationX, stationZ] = input.stations[station];
    const wanted = Math.min(3, Math.floor((speed - 1.1) * 1.6));
    const [offsetX, offsetZ] = input.offsets[station];
    const offsetLength = Math.hypot(offsetX, offsetZ) || 1;
    for (let sequence = 0; sequence < wanted; sequence++) {
      if (rapidDetailRandom(stationX, stationZ, sequence) > 0.72) continue;
      const across = rapidDetailRandom(stationX, stationZ, sequence + 11) * 1.5 - 0.75;
      const radiusM = 0.35
        + rapidDetailRandom(stationX, stationZ, sequence + 23) * 0.85;
      rocks.push({
        station,
        sequence,
        stationX,
        stationZ,
        x: stationX + (offsetX / offsetLength) * across * (input.widthM / 2),
        z: stationZ + (offsetZ / offsetLength) * across * (input.widthM / 2),
        radiusM,
        topY: input.invertY[station] + 0.025
          + radiusM
            * (0.35 + rapidDetailRandom(
              stationX,
              stationZ,
              sequence + 31,
            ) * 0.7),
        baseY: input.invertY[station] - 0.5,
        spin: rapidDetailRandom(stationX, stationZ, sequence + 41) * Math.PI,
        tone: 0.72 + rapidDetailRandom(stationX, stationZ, sequence + 53) * 0.3,
        across,
      });
    }
  }

  const foamPositive = new Float32Array(n);
  const foamNegative = new Float32Array(n);
  const downstreamStep = input.downhillInArrayOrder ? 1 : -1;
  for (const rock of rocks) {
    const strength = 0.55 + rock.radiusM * 0.8;
    const positiveWeight = 0.5 + rock.across / 1.5;
    const negativeWeight = 1 - positiveWeight;
    for (let distance = -1; distance <= 4; distance++) {
      const station = rock.station + distance * downstreamStep;
      if (station < 0 || station >= n) continue;
      const wake = strength
        * (distance < 0 ? 0.4 : Math.exp(-distance / 2.2));
      foamPositive[station] += wake * positiveWeight;
      foamNegative[station] += wake * negativeWeight;
    }
  }

  const indexInFlowOrder = (index: number): number =>
    input.downhillInArrayOrder ? index : n - 1 - index;
  for (let index = 1; index < n; index++) {
    const station = indexInFlowOrder(index);
    const previous = indexInFlowOrder(index - 1);
    const distance = Math.hypot(
      input.stations[station][0] - input.stations[previous][0],
      input.stations[station][1] - input.stations[previous][1],
    ) || 1;
    if ((input.invertY[previous] - input.invertY[station]) / distance <= 0.28) {
      continue;
    }
    foamPositive[station] += 1.3;
    foamNegative[station] += 1.3;
    foamPositive[previous] += 0.9;
    foamNegative[previous] += 0.9;
  }

  return { rocks, foamPositive, foamNegative };
}

const hue2rgb = (p: number, q: number, t0: number): number => {
  let t = t0 - Math.floor(t0);
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
};

/** Renderer-free equivalent of THREE.Color.setHSL. */
const hslToRgb = (
  hue: number,
  saturation: number,
  lightness: number,
): readonly [number, number, number] => {
  if (saturation === 0) return [lightness, lightness, lightness];
  const p = lightness <= 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const q = 2 * lightness - p;
  return [
    hue2rgb(q, p, hue + 1 / 3),
    hue2rgb(q, p, hue),
    hue2rgb(q, p, hue - 1 / 3),
  ];
};

/**
 * Substrate-owned rapid-bed geometry. The water solver decides where a rock
 * exists; this pure builder owns the exact visual facets, geology tint and
 * matching collider witnesses consumed by the versioned detail packet.
 */
export function buildRapidDetailMesh(
  rocks: readonly RapidDetailRock[],
  family: RapidDetailStoneFamily,
): RapidDetailMesh {
  const positions = new Float32Array(rocks.length * 6 * 9);
  const colours = new Float32Array(rocks.length * 6 * 9);
  const colliders: RapidDetailCollider[] = [];
  let positionOffset = 0;
  let colourOffset = 0;
  for (const rock of rocks) {
    const familyPick = clamp((rock.tone - 0.72) / 0.30, 0, 1) - 0.5;
    const colour = hslToRgb(
      family[0] + familyPick * family[1],
      clamp(
        family[2]
          + (rapidDetailRandom(rock.stationX, rock.stationZ, rock.sequence + 57) - 0.5)
            * family[3],
        0,
        1,
      ),
      clamp(family[4] + familyPick * family[5], 0.04, 0.78),
    );
    for (let edge = 0; edge < 6; edge++) {
      const angle0 = rock.spin + (edge / 6) * Math.PI * 2;
      const angle1 = rock.spin + ((edge + 1) / 6) * Math.PI * 2;
      const radius0 = rock.radiusM
        * (0.7 + rapidDetailRandom(
          rock.stationX + edge,
          rock.stationZ,
          rock.sequence + 61,
        ) * 0.6);
      const radius1 = rock.radiusM
        * (0.7 + rapidDetailRandom(
          rock.stationX + edge + 1,
          rock.stationZ,
          rock.sequence + 61,
        ) * 0.6);
      positions.set([
        rock.x, rock.topY, rock.z,
        rock.x + Math.cos(angle0) * radius0, rock.baseY,
        rock.z + Math.sin(angle0) * radius0,
        rock.x + Math.cos(angle1) * radius1, rock.baseY,
        rock.z + Math.sin(angle1) * radius1,
      ], positionOffset);
      positionOffset += 9;
      colours.set([
        colour[0] * 1.04, colour[1] * 1.04, colour[2] * 1.02,
        colour[0] * 0.76, colour[1] * 0.78, colour[2] * 0.80,
        colour[0] * 0.76, colour[1] * 0.78, colour[2] * 0.80,
      ], colourOffset);
      colourOffset += 9;
    }
    colliders.push({ x: rock.x, z: rock.z, radiusM: rock.radiusM });
  }
  return { positions, colours, colliders };
}
