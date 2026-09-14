import {
  BENCH_C,
  BENCH_K,
  benchFlat,
  latCands,
  ruleGrade,
} from '../roadprofile';

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

export interface ProductionAlignedRoadProfileInput {
  stations: readonly (readonly [x: number, z: number])[];
  elevation: readonly number[];
  benchAt: (station: number) => number;
  hints?: readonly (number | null)[];
  hinted: boolean;
  mode: ProductionRoadStructureMode;
  maxGrade: number;
  anchorStart?: number | null;
  anchorEnd?: number | null;
  heldStations?: ArrayLike<unknown>;
  isChaotic?: () => boolean;
  solveAuto?: () => readonly number[];
}

export interface ProductionAlignedRoadProfile {
  branchProfile: number[];
  profile: number[];
  branch: 1 | 2 | 3 | 4 | 5 | 6;
  gradeLimit: number;
}

export interface ProductionRoadBenchSamples {
  candidates: number[][];
  bench: number[];
  chaotic: boolean;
  sampleCount: number;
}

export interface ProductionRoadBenchStation {
  candidates: number[];
  bench: number;
  chaotic: boolean;
  sampleCount: number;
}

export interface ProductionEngineeredRoadProfileInput {
  stations: readonly (readonly [x: number, z: number])[];
  profile: readonly number[];
  mode: ProductionRoadStructureMode;
  heldStations?: ArrayLike<number>;
  maxGrade: number;
  railway: boolean;
}

export interface ProductionEngineeredRoadProfile {
  gradeLineProfile: number[];
  profile: number[];
}

export interface ProductionRoadCrossSectionInput {
  stations: readonly (readonly [x: number, z: number])[];
  profile: readonly number[];
  centreGround: readonly number[];
  rightGround: readonly number[];
  leftGround: readonly number[];
  mode: Exclude<ProductionRoadStructureMode, 'none'>;
  width: number;
  heldStations?: ArrayLike<number>;
  seatHeldStations?: ArrayLike<number>;
  gradeLimit: number;
  endWeld: boolean;
  weldStart?: number | null;
  weldEnd?: number | null;
  tiltStart?: number | null;
  tiltEnd?: number | null;
}

export interface ProductionRoadCrossSection {
  seatedProfile: number[];
  smoothedProfile: number[];
  reruledProfile: number[];
  profile: number[];
  tilt: number[];
  unweldedTilt: number[];
  centreWeldStart: number;
  centreWeldEnd: number;
  tiltWeldStart: number;
  tiltWeldEnd: number;
  preWeldStart: number;
  preWeldEnd: number;
}

export interface ProductionRoadJunctionWarpInput {
  stations: readonly (readonly [x: number, z: number])[];
  profile: readonly number[];
  tilt: readonly number[];
  heldStations?: ArrayLike<number>;
  end: 0 | 1;
  planeAt(x: number, z: number): number;
  kerbOffsetAt(station: number, side: 1 | -1): readonly [x: number, z: number];
  maximumCentreDisplacementM: number;
  tiltAnchor?: number | null;
  fadeM?: number;
  displacementLimitM?: number;
}

export interface ProductionRoadJunctionWarp {
  profile: number[];
  tilt: number[];
}

export interface ProductionRoadHostPlaneInput {
  nodeX: number;
  nodeZ: number;
  nodeHeight: number;
  hostTangentX: number;
  hostTangentZ: number;
  hostHalfWidthM: number;
  sampleHeight(x: number, z: number): number | null;
  alongProbeM?: number;
  crossProbeScale?: number;
  minimumCrossProbeM?: number;
  gradientLimit?: number;
}

export interface ProductionRoadHostPlane {
  originX: number;
  originZ: number;
  originHeight: number;
  gradientX: number;
  gradientZ: number;
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

/**
 * Sample the production lateral bench fan once for an entire road fragment.
 *
 * The adapter supplies terrain heights; substrate owns sample placement,
 * standalone bench selection and the cross-section chaos classification used
 * by both crumb deferral and aligned-profile branch selection.
 */
export function sampleProductionRoadBenchStation(
  stations: readonly (readonly [x: number, z: number])[],
  station: number,
  sampleHeight: (x: number, z: number) => number,
): ProductionRoadBenchStation {
  const dense = stations as Array<[number, number]>;
  const candidates = latCands(dense, station, sampleHeight);
  const freedom = clamp(
    Math.abs(candidates[BENCH_K - 1] - candidates[0]) / 18,
    0,
    1,
  );
  return {
    candidates,
    bench: candidates[BENCH_C]
      + (benchFlat(candidates) - candidates[BENCH_C]) * freedom,
    chaotic: Math.abs(candidates[BENCH_K - 1] - candidates[0]) > 18,
    sampleCount: BENCH_K,
  };
}

export function sampleProductionRoadBenchProfile(
  stations: readonly (readonly [x: number, z: number])[],
  sampleHeight: (x: number, z: number) => number,
): ProductionRoadBenchSamples {
  const sampled = stations.map((_, station) =>
    sampleProductionRoadBenchStation(stations, station, sampleHeight));
  return {
    candidates: sampled.map((value) => value.candidates),
    bench: sampled.map((value) => value.bench),
    chaotic: sampled.some((value) => value.chaotic),
    sampleCount: sampled.reduce((total, value) => total + value.sampleCount, 0),
  };
}

/**
 * Fit the local host carriageway plane used by junction warp and mouth seats.
 *
 * Three contextual deck samples supply along-grade and crossfall evidence.
 * Substrate owns sample placement, one-sided fallbacks and the gradient clamp
 * so a curving host cannot extrapolate an impossible plane down the side road.
 */
export function resolveProductionRoadHostPlane(
  input: ProductionRoadHostPlaneInput,
): ProductionRoadHostPlane {
  const alongProbeM = input.alongProbeM ?? 8;
  const crossProbeM = Math.max(
    input.minimumCrossProbeM ?? 1.5,
    input.hostHalfWidthM * (input.crossProbeScale ?? 0.6),
  );
  const crossX = -input.hostTangentZ;
  const crossZ = input.hostTangentX;
  const forward = input.sampleHeight(
    input.nodeX + input.hostTangentX * alongProbeM,
    input.nodeZ + input.hostTangentZ * alongProbeM,
  );
  const backward = input.sampleHeight(
    input.nodeX - input.hostTangentX * alongProbeM,
    input.nodeZ - input.hostTangentZ * alongProbeM,
  );
  const cross = input.sampleHeight(
    input.nodeX + crossX * crossProbeM,
    input.nodeZ + crossZ * crossProbeM,
  );
  const limit = input.gradientLimit ?? 0.18;
  const alongGradient = clamp(
    forward !== null && backward !== null
      ? (forward - backward) / (2 * alongProbeM)
      : forward !== null
        ? (forward - input.nodeHeight) / alongProbeM
        : backward !== null
          ? (input.nodeHeight - backward) / alongProbeM
          : 0,
    -limit,
    limit,
  );
  const crossGradient = clamp(
    cross !== null ? (cross - input.nodeHeight) / crossProbeM : 0,
    -limit,
    limit,
  );
  return {
    originX: input.nodeX,
    originZ: input.nodeZ,
    originHeight: input.nodeHeight,
    gradientX: input.hostTangentX * alongGradient + crossX * crossGradient,
    gradientZ: input.hostTangentZ * alongGradient + crossZ * crossGradient,
  };
}

export function sampleProductionRoadHostPlane(
  plane: ProductionRoadHostPlane,
  x: number,
  z: number,
): number {
  return plane.originHeight
    + (x - plane.originX) * plane.gradientX
    + (z - plane.originZ) * plane.gradientZ;
}

/**
 * Select the aligned longitudinal bench before structure decisions.
 *
 * This is the production branch authority: sufficiently complete chain hints
 * interpolate exactly; short fragments use continuity anchors or the sampled
 * bench; longer automatic fragments invoke the numerical DP supplied by the
 * tile adapter; tagged structures pin portal endpoints to anchors/bench. Every
 * non-draped result then passes through the same ruling-grade law while held
 * junction and hinted-end stations remain exact.
 */
export function resolveProductionAlignedRoadProfile(
  input: ProductionAlignedRoadProfileInput,
): ProductionAlignedRoadProfile {
  const n = input.elevation.length;
  if (input.stations.length !== n) {
    throw new Error('aligned road stations and elevation must have matching lengths');
  }
  if (input.hints?.length && input.hints.length !== n) {
    throw new Error('aligned road hints and elevation must have matching lengths');
  }
  if (input.heldStations && input.heldStations.length !== n) {
    throw new Error('aligned road held stations and elevation must have matching lengths');
  }
  const hints = input.hints?.length
    ? input.hints
    : Array.from({ length: n }, () => null);
  const anchorStart = input.anchorStart ?? null;
  const anchorEnd = input.anchorEnd ?? null;
  const crumbStart = anchorStart ?? hints[0] ?? null;
  const crumbEnd = anchorEnd ?? hints[n - 1] ?? null;
  let profile = [...input.elevation];
  let branch: ProductionAlignedRoadProfile['branch'] = 6;

  let fragmentM = 0;
  for (let station = 1; station < n; station++) {
    fragmentM += Math.hypot(
      input.stations[station][0] - input.stations[station - 1][0],
      input.stations[station][1] - input.stations[station - 1][1],
    );
  }
  const crumb = !input.hinted && input.mode === 'auto' && (
    (n <= 16 && fragmentM <= 70)
    || (n <= 40
      && Boolean(input.isChaotic?.())
      && (crumbStart !== null || crumbEnd !== null))
  );

  if (input.hinted) {
    branch = 1;
    const hintedStations: number[] = [];
    for (let station = 0; station < n; station++) {
      if (hints[station] !== null) hintedStations.push(station);
    }
    if (!hintedStations.length) {
      throw new Error('aligned road marked hinted without any hint stations');
    }
    profile = input.stations.map((_, station) => {
      let low = -1;
      let high = -1;
      for (const hintedStation of hintedStations) {
        if (hintedStation <= station) low = hintedStation;
        if (hintedStation >= station) {
          high = hintedStation;
          break;
        }
      }
      if (low < 0) return hints[high] as number;
      if (high < 0 || high === low) return hints[low] as number;
      const fraction = (station - low) / (high - low);
      return (hints[low] as number)
        + ((hints[high] as number) - (hints[low] as number)) * fraction;
    });
    if (anchorStart !== null && Math.abs(profile[0] - anchorStart) < 4) {
      profile[0] = anchorStart;
    }
    if (anchorEnd !== null && Math.abs(profile[n - 1] - anchorEnd) < 4) {
      profile[n - 1] = anchorEnd;
    }
  } else if (crumb) {
    if (crumbStart !== null && crumbEnd !== null) {
      branch = 2;
      profile = input.elevation.map((_, station) =>
        crumbStart + ((crumbEnd - crumbStart) * station) / (n - 1));
    } else if (crumbStart !== null || crumbEnd !== null) {
      branch = 3;
      const anchor = (crumbStart ?? crumbEnd) as number;
      profile = input.elevation.map(() => anchor);
    } else {
      branch = 4;
      profile = input.elevation.map((_, station) => input.benchAt(station));
    }
  } else if (input.mode === 'auto' && n > 4) {
    branch = 5;
    const solved = input.solveAuto?.();
    if (!solved || solved.length !== n) {
      throw new Error('aligned automatic road requires a complete solver profile');
    }
    profile = [...solved];
  } else if (input.mode !== 'none') {
    profile[0] = anchorStart ?? input.benchAt(0);
    profile[n - 1] = anchorEnd ?? input.benchAt(n - 1);
  }

  const branchProfile = [...profile];
  const gradeLimit = (input.maxGrade > 0 ? input.maxGrade : 0.15) * 1.2;
  if (input.mode !== 'none' && n > 1) {
    ruleGrade(
      input.stations as Array<[number, number]>,
      profile,
      gradeLimit,
      input.heldStations,
    );
  }
  return { branchProfile, profile, branch, gradeLimit };
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

/**
 * Apply the engineered longitudinal line after structure clearances.
 *
 * Roads smooth DEM-scale oscillation but retain steep streets through a small
 * deviation budget. Railways use a wider wavelength and a much larger budget
 * because leaving the ground is the formation's purpose. Held junctions and
 * fragment endpoints remain exact.
 */
export function resolveProductionEngineeredRoadProfile(
  input: ProductionEngineeredRoadProfileInput,
): ProductionEngineeredRoadProfile {
  if (input.stations.length !== input.profile.length) {
    throw new Error('engineered road stations and profile must have matching lengths');
  }
  if (input.heldStations
    && input.heldStations.length !== input.profile.length) {
    throw new Error('engineered road held stations and profile must have matching lengths');
  }
  const n = input.profile.length;
  const gradeLineProfile = [...input.profile];
  if (input.mode === 'auto' && n > 8) {
    const window = input.railway ? 16 : 8;
    const wide = (source: readonly number[]): number[] => source.map((_, i) => {
      let total = 0;
      let count = 0;
      for (let j = Math.max(0, i - window);
        j <= Math.min(n - 1, i + window);
        j++) {
        total += source[j];
        count++;
      }
      return total / count;
    });
    const engineered = wide(wide(gradeLineProfile));
    for (let station = 0; station < n; station++) {
      if (input.heldStations?.[station]) continue;
      const pin = clamp(
        Math.min(station, n - 1 - station) / window,
        0,
        1,
      );
      gradeLineProfile[station] +=
        (engineered[station] - gradeLineProfile[station]) * pin;
    }
  }

  const profile = [...gradeLineProfile];
  if (input.mode === 'auto' && n > 8 && input.maxGrade > 0) {
    const base = [...profile];
    const deviationM = input.railway ? 24 : 5;
    for (let pass = 0; pass < 3; pass++) {
      for (let station = 1; station < n; station++) {
        if (input.heldStations?.[station]) continue;
        const allowance = input.maxGrade * Math.max(1, Math.hypot(
          input.stations[station][0] - input.stations[station - 1][0],
          input.stations[station][1] - input.stations[station - 1][1],
        ));
        profile[station] = clamp(
          clamp(
            profile[station],
            profile[station - 1] - allowance,
            profile[station - 1] + allowance,
          ),
          base[station] - deviationM,
          base[station] + deviationM,
        );
      }
      for (let station = n - 2; station >= 0; station--) {
        if (input.heldStations?.[station]) continue;
        const allowance = input.maxGrade * Math.max(1, Math.hypot(
          input.stations[station + 1][0] - input.stations[station][0],
          input.stations[station + 1][1] - input.stations[station][1],
        ));
        profile[station] = clamp(
          clamp(
            profile[station],
            profile[station + 1] - allowance,
            profile[station + 1] + allowance,
          ),
          base[station] - deviationM,
          base[station] + deviationM,
        );
      }
    }
    for (let station = 0; station < n; station++) {
      if (input.heldStations?.[station]) continue;
      const pin = clamp(Math.min(station, n - 1 - station) / 8, 0, 1);
      profile[station] =
        base[station] + (profile[station] - base[station]) * pin;
    }
  }
  return { gradeLineProfile, profile };
}

/**
 * Construct the final engineered road plane from its longitudinal profile.
 *
 * Terrain sampling and neighbour lookup stay at the tile boundary; this
 * arithmetic owns seating the two kerbs, designed crossfall/superelevation,
 * the post-seat ruling-grade pass and the final centre/tilt endpoint weld.
 */
export function resolveProductionRoadCrossSection(
  input: ProductionRoadCrossSectionInput,
): ProductionRoadCrossSection {
  const n = input.profile.length;
  for (const [name, values] of [
    ['stations', input.stations],
    ['centre ground', input.centreGround],
    ['right ground', input.rightGround],
    ['left ground', input.leftGround],
  ] as const) {
    if (values.length !== n) {
      throw new Error(`road cross-section ${name} and profile must have matching lengths`);
    }
  }
  if (input.heldStations && input.heldStations.length !== n) {
    throw new Error('road cross-section held stations and profile must have matching lengths');
  }
  if (input.seatHeldStations && input.seatHeldStations.length !== n) {
    throw new Error('road cross-section seat-held stations and profile must have matching lengths');
  }

  const profile = [...input.profile];
  const profileBeforeSeat = [...profile];
  const tilt = new Array<number>(n).fill(0);
  const edgeR = new Array<number>(n);
  const edgeL = new Array<number>(n);
  const HUG_LO = 0.35;
  const HUG_HI = 1.9;
  const MAX_FALL = 0.85;
  const CROSSFALL = 0.025;
  const SUPER_MAX = 0.06;
  const SUPER_K = 20;

  const bendAt = (station: number): number => {
    if (station <= 0 || station >= n - 1) return 0;
    const ax = input.stations[station][0] - input.stations[station - 1][0];
    const az = input.stations[station][1] - input.stations[station - 1][1];
    const bx = input.stations[station + 1][0] - input.stations[station][0];
    const bz = input.stations[station + 1][1] - input.stations[station][1];
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    return Math.acos(clamp((ax * bx + az * bz) / (la * lb), -1, 1));
  };
  const bendSign = (station: number): number => {
    if (station <= 0 || station >= n - 1) return 0;
    const ax = input.stations[station][0] - input.stations[station - 1][0];
    const az = input.stations[station][1] - input.stations[station - 1][1];
    const bx = input.stations[station + 1][0] - input.stations[station][0];
    const bz = input.stations[station + 1][1] - input.stations[station][1];
    return ax * bz - az * bx;
  };

  for (let station = 0; station < n; station++) {
    const right = input.rightGround[station];
    const left = input.leftGround[station];
    const hug = input.mode === 'bridge'
      ? 0
      : 1 - clamp(
        (profile[station]
          - Math.min(left, right, input.centreGround[station])
          - HUG_LO)
          / (HUG_HI - HUG_LO),
        0,
        1,
      );
    const held = Boolean(
      input.heldStations?.[station] || input.seatHeldStations?.[station],
    );
    const seat = held
      ? profile[station]
      : profile[station]
        + (Math.min(profile[station], (right + left) * 0.5) - profile[station]) * hug;
    const dTheta = bendAt(station);
    const lo = Math.max(0, station - 1);
    const hi = Math.min(n - 1, station + 1);
    const ds = Math.max(1, Math.hypot(
      input.stations[hi][0] - input.stations[lo][0],
      input.stations[hi][1] - input.stations[lo][1],
    ) * 0.5);
    const elevation = clamp((dTheta / ds) * SUPER_K, 0, SUPER_MAX);
    const bank = -Math.sign(bendSign(station)) * elevation;
    const drain = CROSSFALL * (1 - clamp(elevation / CROSSFALL, 0, 1));
    const half = clamp(
      (bank + drain) * (input.width / 2),
      -MAX_FALL,
      MAX_FALL,
    );
    edgeR[station] = seat + half;
    edgeL[station] = seat - half;
  }
  const seatedProfile = edgeR.map((right, station) =>
    (right + edgeL[station]) * 0.5);

  for (let pass = 0; pass < 3; pass++) {
    const right = [...edgeR];
    const left = [...edgeL];
    for (let station = 1; station < n - 1; station++) {
      if (input.heldStations?.[station]) continue;
      edgeR[station] =
        (right[station - 1] + right[station] * 2 + right[station + 1]) * 0.25;
      edgeL[station] =
        (left[station - 1] + left[station] * 2 + left[station + 1]) * 0.25;
    }
  }
  for (let station = 0; station < n; station++) {
    profile[station] = (edgeR[station] + edgeL[station]) * 0.5;
    tilt[station] = (edgeR[station] - edgeL[station]) * 0.5;
    const over = profile[station] - profileBeforeSeat[station];
    if (over > 0) {
      profile[station] -= over;
      edgeR[station] -= over;
      edgeL[station] -= over;
    }
  }
  const smoothedProfile = [...profile];

  const beforeRuling = [...profile];
  const gradeHeld = Array.from({ length: n }, (_, station) =>
    input.heldStations?.[station] || input.seatHeldStations?.[station]
      ? 1
      : null);
  ruleGrade(input.stations as Array<[number, number]>, profile, input.gradeLimit, gradeHeld);
  for (let station = 0; station < n; station++) {
    const dy = profile[station] - beforeRuling[station];
    edgeR[station] += dy;
    edgeL[station] += dy;
  }
  const reruledProfile = [...profile];
  const unweldedTilt = [...tilt];

  const centreWeldStart =
    input.weldStart == null || !input.endWeld ? 0 : input.weldStart - profile[0];
  const centreWeldEnd =
    input.weldEnd == null || !input.endWeld ? 0 : input.weldEnd - profile[n - 1];
  const preWeldStart = profile[0];
  const preWeldEnd = profile[n - 1];
  const tiltWeldStart =
    input.endWeld && input.tiltStart != null ? input.tiltStart - tilt[0] : 0;
  const tiltWeldEnd =
    input.endWeld && input.tiltEnd != null ? input.tiltEnd - tilt[n - 1] : 0;

  if (centreWeldStart !== 0
    || centreWeldEnd !== 0
    || tiltWeldStart !== 0
    || tiltWeldEnd !== 0) {
    const arc = new Array<number>(n).fill(0);
    for (let station = 1; station < n; station++) {
      arc[station] = arc[station - 1] + Math.hypot(
        input.stations[station][0] - input.stations[station - 1][0],
        input.stations[station][1] - input.stations[station - 1][1],
      );
    }
    const total = arc[n - 1] || 1;
    let firstHeld = -1;
    let lastHeld = -1;
    for (let station = 0; station < n; station++) {
      if (!input.heldStations?.[station]) continue;
      if (firstHeld < 0) firstHeld = station;
      lastHeld = station;
    }
    for (let station = 0; station < n; station++) {
      let startFade: number;
      let endFade: number;
      if (firstHeld < 0) {
        const fraction = arc[station] / total;
        startFade = 1 - fraction;
        endFade = fraction;
      } else {
        startFade = firstHeld === 0
          ? (station === 0 ? 1 : 0)
          : station <= firstHeld ? 1 - arc[station] / arc[firstHeld] : 0;
        endFade = lastHeld === n - 1
          ? (station === n - 1 ? 1 : 0)
          : station >= lastHeld
            ? (arc[station] - arc[lastHeld]) / (total - arc[lastHeld])
            : 0;
      }
      const dy = centreWeldStart * startFade + centreWeldEnd * endFade;
      const dt = tiltWeldStart * startFade + tiltWeldEnd * endFade;
      profile[station] += dy;
      tilt[station] += dt;
    }
  }

  return {
    seatedProfile,
    smoothedProfile,
    reruledProfile,
    profile,
    tilt,
    unweldedTilt,
    centreWeldStart,
    centreWeldEnd,
    tiltWeldStart,
    tiltWeldEnd,
    preWeldStart,
    preWeldEnd,
  };
}

/**
 * Ease a road end onto a host-road plane without crossing a held junction.
 *
 * The host lookup and local plane fit are contextual tile inputs. Substrate
 * owns how their residual reaches the road: by arc length, bounded by the
 * node disagreement, never through the far end or the first pinned station.
 */
export function resolveProductionRoadJunctionWarp(
  input: ProductionRoadJunctionWarpInput,
): ProductionRoadJunctionWarp {
  const n = input.profile.length;
  if (input.stations.length !== n || input.tilt.length !== n) {
    throw new Error('junction warp stations, profile and tilt must have matching lengths');
  }
  if (input.heldStations && input.heldStations.length !== n) {
    throw new Error('junction warp held stations and profile must have matching lengths');
  }
  const profile = [...input.profile];
  const tilt = [...input.tilt];
  const fadeM = input.fadeM ?? 60;
  const limitM = input.displacementLimitM ?? 3;
  let along = 0;
  for (let step = 0; step < n - 2; step++) {
    const station = input.end === 0 ? step : n - 1 - step;
    if (step > 0) {
      const previous = input.end === 0 ? step - 1 : n - step;
      along += Math.hypot(
        input.stations[station][0] - input.stations[previous][0],
        input.stations[station][1] - input.stations[previous][1],
      );
    }
    if (along >= fadeM || input.heldStations?.[station]) break;
    const rightOffset = input.kerbOffsetAt(station, 1);
    const leftOffset = input.kerbOffsetAt(station, -1);
    const right = input.planeAt(
      input.stations[station][0] + rightOffset[0],
      input.stations[station][1] + rightOffset[1],
    );
    const left = input.planeAt(
      input.stations[station][0] + leftOffset[0],
      input.stations[station][1] + leftOffset[1],
    );
    const weight = 1 - along / fadeM;
    profile[station] += clamp(
      clamp((right + left) * 0.5 - profile[station], -limitM, limitM) * weight,
      -input.maximumCentreDisplacementM,
      input.maximumCentreDisplacementM,
    );
    tilt[station] += ((input.tiltAnchor ?? (right - left) * 0.5) - tilt[station])
      * weight;
  }
  return { profile, tilt };
}
