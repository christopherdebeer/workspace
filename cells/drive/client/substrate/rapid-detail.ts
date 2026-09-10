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

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

/** Stable rebuild hash shared by placement and authored stone facets. */
export function rapidDetailRandom(x: number, z: number, sequence: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233 + sequence * 37.719) * 43758.5453;
  return value - Math.floor(value);
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
