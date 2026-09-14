export type ProductionRoadStructureMode = 'none' | 'auto' | 'tunnel' | 'bridge';

export interface ProductionRoadStructureProfileInput {
  stations: readonly (readonly [x: number, z: number])[];
  alignedProfile: readonly number[];
  mode: ProductionRoadStructureMode;
  canopy: boolean;
  heldStations?: ArrayLike<number>;
  tunnelToleranceM?: number;
  smoothingRadius?: number;
}

export interface ProductionRoadStructureProfile {
  runs: readonly (readonly [start: number, end: number])[];
  chordProfile: number[];
}

/**
 * Decide which aligned road spans become structures and construct their
 * portal chords before rendering exists.
 *
 * Tagged bridges/tunnels claim the whole way. Automatic mode detects sustained
 * terrain above the aligned bench. Held junctions split a chord so another
 * road's solved deck cannot be overwritten.
 */
export function resolveProductionRoadStructureProfile(
  input: ProductionRoadStructureProfileInput,
): ProductionRoadStructureProfile {
  if (input.stations.length !== input.alignedProfile.length) {
    throw new Error('road stations and aligned profile must have matching lengths');
  }
  if (input.heldStations
    && input.heldStations.length !== input.alignedProfile.length) {
    throw new Error('road held stations and aligned profile must have matching lengths');
  }
  const n = input.alignedProfile.length;
  const chordProfile = [...input.alignedProfile];
  const runs: Array<readonly [number, number]> = [];
  if (input.mode === 'none'
    || n < 2
    || (input.canopy && input.mode !== 'bridge')) {
    return { runs, chordProfile };
  }

  if (input.mode === 'tunnel' || input.mode === 'bridge') {
    runs.push([0, n - 1]);
  } else {
    if (n <= 4) return { runs, chordProfile };
    const radius = Math.max(1, Math.floor(input.smoothingRadius ?? 20));
    const average = (source: readonly number[]): number[] => source.map((_, i) => {
      let total = 0;
      let count = 0;
      for (let j = Math.max(0, i - radius);
        j <= Math.min(n - 1, i + radius);
        j++) {
        total += source[j];
        count++;
      }
      return total / count;
    });
    const smoothed = average(average(input.alignedProfile));
    const tolerance = input.tunnelToleranceM ?? 5;
    let start = -1;
    for (let station = 0; station < n; station++) {
      const deep = input.alignedProfile[station] - smoothed[station] > tolerance;
      if (deep && start < 0) start = station;
      if ((!deep || station === n - 1) && start >= 0) {
        if (station - start >= 2) {
          runs.push([
            Math.max(0, start - 1),
            Math.min(n - 1, station),
          ]);
        }
        start = -1;
      }
    }
  }

  for (const [start, end] of runs) {
    const knots = [start];
    for (let station = start + 1; station < end; station++) {
      if (input.heldStations?.[station]) knots.push(station);
    }
    knots.push(end);
    for (let knot = 0; knot + 1 < knots.length; knot++) {
      const a = knots[knot];
      const b = knots[knot + 1];
      for (let station = a; station <= b; station++) {
        const chord = input.alignedProfile[a]
          + ((input.alignedProfile[b] - input.alignedProfile[a])
            * (station - a)) / (b - a || 1);
        chordProfile[station] = input.mode === 'tunnel'
          ? Math.min(chord, input.alignedProfile[station])
          : chord;
      }
    }
  }
  return { runs, chordProfile };
}
