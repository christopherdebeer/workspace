export type ProductionHydroReachStation = readonly [x: number, z: number];
export type ProductionHydroReachOffset = readonly [x: number, z: number];

export interface ProductionHydroReachInput {
  stations: readonly ProductionHydroReachStation[];
  groundY: readonly number[];
  widthM: number;
  maxBurialM: number;
  /** Production uses three 1-2-1 passes; tests may set zero explicitly. */
  smoothingPasses?: number;
}

export interface ProductionHydroReach {
  invertY: number[];
  speedMps: number[];
  flowTextureV: number[];
  offsets: ProductionHydroReachOffset[];
  daylighted: boolean[];
  daylightCount: number;
  worstDownhillRiseM: number;
  downhillInArrayOrder: boolean;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));

/**
 * One shared mitred offset per station. Adjacent channel bays therefore use
 * identical bank corners; the capped bisector prevents hairpins from growing
 * unbounded spikes.
 */
export function productionHydroReachOffsets(
  stations: readonly ProductionHydroReachStation[],
  halfWidthM: number,
): ProductionHydroReachOffset[] {
  const n = stations.length;
  if (n < 2) return [];
  const bay = (index: number): ProductionHydroReachOffset => {
    const j = clamp(index, 0, n - 2);
    const dx = stations[j + 1][0] - stations[j][0];
    const dz = stations[j + 1][1] - stations[j][1];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  };
  const offsets: ProductionHydroReachOffset[] = [];
  for (let index = 0; index < n; index++) {
    const [previousX, previousZ] = bay(index - 1);
    const [nextX, nextZ] = bay(index);
    const middleX = (previousX + nextX) * 0.5;
    const middleZ = (previousZ + nextZ) * 0.5;
    const middleLength = Math.hypot(middleX, middleZ);
    if (middleLength < 0.2) {
      offsets.push([nextX * halfWidthM, nextZ * halfWidthM]);
      continue;
    }
    const reach = halfWidthM * clamp(1 / middleLength, 1, 2.4);
    offsets.push([
      (middleX / middleLength) * reach,
      (middleZ / middleLength) * reach,
    ]);
  }
  return offsets;
}

/**
 * Resolve one grounded production watercourse reach before rendering.
 *
 * The substrate owns direction, DEM smoothing, monotone invert/daylighting,
 * flow speed, source-relative texture distance and exact bank mitres. The live
 * world remains responsible only for supplying sampled ground and consuming
 * the resulting channel/rapid/crossing records.
 */
export function resolveProductionHydroReach(
  input: ProductionHydroReachInput,
): ProductionHydroReach {
  const n = input.stations.length;
  if (n < 2) throw new Error('hydro reach requires at least two stations');
  if (input.groundY.length !== n) {
    throw new Error('hydro reach station and ground arrays must match');
  }
  if (!(input.widthM > 0) || !(input.maxBurialM >= 0)) {
    throw new Error('hydro reach width and burial limit must be valid');
  }
  for (let index = 0; index < n; index++) {
    const station = input.stations[index];
    if (!Number.isFinite(station[0]) || !Number.isFinite(station[1])
      || !Number.isFinite(input.groundY[index])) {
      throw new Error('hydro reach inputs must be finite');
    }
  }

  const smoothed = Array.from(input.groundY);
  const smoothingPasses = input.smoothingPasses ?? 3;
  for (let pass = 0; pass < smoothingPasses; pass++) {
    const previous = smoothed.slice();
    for (let index = 1; index < n - 1; index++) {
      smoothed[index] = (
        previous[index - 1]
        + previous[index] * 2
        + previous[index + 1]
      ) * 0.25;
    }
  }

  const endWindow = Math.max(1, Math.round(n / 5));
  let head = 0;
  let tail = 0;
  for (let index = 0; index < endWindow; index++) {
    head += smoothed[index];
    tail += smoothed[n - 1 - index];
  }
  const downhillInArrayOrder = head / endWindow >= tail / endWindow;
  const indexInFlowOrder = (index: number): number =>
    downhillInArrayOrder ? index : n - 1 - index;

  const invertY = new Array<number>(n);
  const daylighted = new Array<boolean>(n).fill(false);
  let runningInvert = smoothed[indexInFlowOrder(0)];
  let daylightCount = 0;
  for (let flowIndex = 0; flowIndex < n; flowIndex++) {
    const station = indexInFlowOrder(flowIndex);
    runningInvert = Math.min(runningInvert, smoothed[station]);
    if (runningInvert < smoothed[station] - input.maxBurialM) {
      runningInvert = smoothed[station];
      daylighted[station] = true;
      daylightCount++;
    }
    invertY[station] = runningInvert;
  }

  let worstDownhillRiseM = 0;
  for (let flowIndex = 1; flowIndex < n; flowIndex++) {
    const station = indexInFlowOrder(flowIndex);
    if (daylighted[station]) continue;
    const previous = indexInFlowOrder(flowIndex - 1);
    worstDownhillRiseM = Math.max(
      worstDownhillRiseM,
      invertY[station] - invertY[previous],
    );
  }

  const speedMps = new Array<number>(n).fill(0.6);
  for (let index = 0; index < n; index++) {
    const first = Math.max(0, index - 3);
    const last = Math.min(n - 1, index + 3);
    let distance = 0;
    for (let station = first; station < last; station++) {
      distance += Math.hypot(
        input.stations[station + 1][0] - input.stations[station][0],
        input.stations[station + 1][1] - input.stations[station][1],
      );
    }
    const drop = Math.abs(invertY[first] - invertY[last]);
    speedMps[index] = clamp(
      0.4 + 4.5 * Math.sqrt(drop / Math.max(distance, 1)),
      0.4,
      3.2,
    );
  }

  const flowTextureV = new Array<number>(n).fill(0);
  let sourceDistance = 0;
  for (let flowIndex = 0; flowIndex < n; flowIndex++) {
    const station = indexInFlowOrder(flowIndex);
    if (flowIndex > 0) {
      const previous = indexInFlowOrder(flowIndex - 1);
      sourceDistance += Math.hypot(
        input.stations[station][0] - input.stations[previous][0],
        input.stations[station][1] - input.stations[previous][1],
      );
    }
    flowTextureV[station] = sourceDistance / 20;
  }

  return {
    invertY,
    speedMps,
    flowTextureV,
    offsets: productionHydroReachOffsets(input.stations, input.widthM / 2),
    daylighted,
    daylightCount,
    worstDownhillRiseM,
    downhillInArrayOrder,
  };
}
