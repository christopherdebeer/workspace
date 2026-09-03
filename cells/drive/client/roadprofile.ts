/**
 * THE BENCH DP — the stage that decides what height a road sits at.
 *
 * Moved out of the fifteen-thousand-line browser module for the reason its
 * neighbour `roadsolve.ts` was: it is arithmetic over numbers and arrays, it
 * has no business needing a WebGL context to answer a question, and while it
 * lived in there the only way to ask one was to drive a headless browser at
 * two frames a second. `SolveEnv` already called it out as "numerically
 * delicate and worth moving on its own, later, with its own tests". This is
 * later.
 *
 * Nothing here samples terrain. The lateral candidates arrive as numbers —
 * `latCands` will build them from any sampler you hand it — so a test can feed
 * a captured height grid, or a synthetic surface with a known right answer,
 * and get the same code the game runs.
 *
 * It is also, now, a thing that could run somewhere other than the main
 * thread. That was not the reason for moving it, but it is the shape that
 * makes it possible.
 *
 * ── WHAT THE COSTS ARE FOR ──
 *
 * A road's elevation is not in the data. OSM gives a centreline and no
 * heights; the DEM gives a hillside and does not know where the road was cut
 * into it. So the profile is inferred: at each station, sample the terrain at
 * a few lateral offsets and choose one, subject to costs that say what a road
 * IS. Near the centreline, following the flattest bench, not steeper than its
 * class allows, welded to its neighbours where they meet.
 *
 * Two of those costs were missing, and both produced faults visible from the
 * driver's seat:
 *
 * LATERAL CONTINUITY. The transition cost read only the ELEVATIONS of the two
 * chosen candidates, never how far apart they sat across the road. Nothing
 * stopped the inferred bench from taking the left shoulder at one station and
 * the right at the next — 90m of lateral travel between stations 12m apart,
 * for free — which on a cliff road means the profile alternates between the
 * cutting and the drop.
 *
 * VERTICAL CURVATURE. The grade term charged only for EXCEEDING the class
 * limit, so every grade within it was free. A profile could alternate between
 * +gCap and −gCap on consecutive stations at zero cost and the DP had no
 * reason to prefer a straight ramp. That is the rollercoaster: not illegal
 * grades, but legal ones changing sign as fast as the stations allow. Charging
 * the CHANGE of grade is what turns a sequence of legal grades into a vertical
 * curve, and it is why this DP now carries the previous candidate in its state
 * — curvature is a property of three stations, not two.
 */

/**
 * Metres either side of the centreline to look for the bench.
 *
 * FINER NEAR THE ROAD, COARSE FURTHER OUT — and that is not a taste. These
 * were spaced every 15m, which is wider than the thing they are searching
 * for: a carriageway bench is 7-10m across, so it fell BETWEEN samples and
 * the search could only find it by luck.
 *
 * Measured on the bench, a shelf road with the ground misregistered by 15m,
 * varying only the width of the cut:
 *
 *     bench 9m -> 2.69m of height error
 *     bench 14m -> 2.05m
 *     bench 20m -> 1.28m
 *     bench 30m -> 0.00m
 *
 * Zero at 30m, which is exactly TWICE the old spacing — the width at which a
 * sample is guaranteed to land on the bench. No cost term can reach a feature
 * the sampling never sees, and a session of weight-tuning against it found
 * nothing because there was nothing there to find.
 *
 * Close in is where the road actually is, so that is where the resolution
 * goes; far out is only there to catch a badly misregistered bench, where
 * landing within a few metres of it is enough.
 */
export interface ProfileWeights {
  /** Pull towards the centreline. */
  off: number;
  /** Pull towards the flattest bench in reach. */
  flat: number;
  /** Grade in excess of the class limit, squared, per metre. */
  grade: number;
  /** A junction pin or a chain anchor — near enough to a law. */
  pin: number;
  /** Moving the bench sideways between stations, per candidate step squared.
   *  Small: a sustained move is how misregistration is compensated. */
  lat: number;
  /** CHANGING the rate of that movement — the bench's own curvature. This is
   *  what separates a deliberate shift from a jitter. */
  latCurve: number;
  /** Change of grade between consecutive spans, squared. The vertical curve. */
  curve: number;
}

/**
 * One self-contained numerical kernel for both the browser and its worker.
 *
 * The worker is born from this function's compiled source. Keeping every
 * runtime dependency inside the closure means the worker and synchronous
 * fallback cannot silently drift into two different road solvers.
 */
export function createRoadProfileKernel() {
const BENCH_OFFS = [-45, -30, -20, -12, -6, 0, 6, 12, 20, 30, 45];
const BENCH_K = BENCH_OFFS.length;
const BENCH_C = BENCH_K >> 1;
/** The spacing the lateral penalty is expressed in, so its weight reads as
 *  "cost per candidate step" rather than per metre. */
const BENCH_STEP = 15;
/**
 * How many candidates the bench may cross in one station.
 *
 * A BAND, not an optimisation for its own sake: the bench is a strip of ground
 * a road was cut into, and it cannot teleport from one side of the corridor to
 * the other between two stations twelve metres apart. Forbidding what the cost
 * terms already make expensive costs nothing in quality and takes the
 * relaxation from K^3 to K*(2B+1)^2 — with eleven candidates, 275 instead of
 * 1331.
 *
 * That matters because this runs inside the tile build. Measured on the
 * longest chain there is (Chapman's Peak, 22km, 1800 stations): 232ms
 * unbanded, which is precisely the class of stall the build budget was added
 * to remove, and it happens BEFORE the build loop's yields.
 */
const BENCH_BAND = 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** The costs, in one place so a test can zero one and measure what it was
 *  worth. Every default here is the shipped behaviour. */
const WEIGHTS: ProfileWeights = {
  off: 0.35, flat: 0.5, grade: 30, pin: 120,
  // ── THESE TWO ARE A TRADE, AND THE TRADE IS THE POINT ──
  //
  // Curvature is bought with lateral travel. Smoothing the profile means
  // preferring stations whose candidates line up vertically, and on rough
  // ground the cheapest way to line them up is to go and find them — off the
  // centreline, in a different direction each time. Measured over 60 stations
  // of hashed roughness (devtools/roadprofile.test.mjs surface 1), worst grade
  // change / total lateral travel / mean distance off centreline:
  //
  //     lat  curve |  kink  travel  offset
  //       0      0 | 0.283     90m    0.8m   <- before this change
  //     1.2    900 | 0.117    525m    6.0m   <- smooth, and wandering badly
  //       8    900 | 0.155    315m    5.3m
  //      16   1600 | 0.117    255m   10.8m
  //      16    400 | 0.193     45m    2.3m   <- chosen
  //
  // The first guess at these weights (1.2 / 900) halved the kink and then
  // sampled the deck height from up to 45m to one side, alternating — a road
  // whose elevation comes from somewhere it does not run. That is worse than
  // the fault it fixed, and it is only visible if you measure both.
  //
  // So: a third off the worst grade change AND half the lateral travel,
  // rather than a large win in one and a regression in the other.
  // ── CHARGE FOR JITTER, NOT FOR MOVEMENT ──
  //
  // A single weight on |Δoffset| cannot tell a useful lateral move from a
  // wasteful one, so setting it high enough to stop the bench flip-flopping
  // also stops it compensating for misregistration. The bench measured
  // exactly that: at lat 16 the recovered fraction of a lateral shift was 0.00
  // at 5m, 15m and 22m — the bench sat on the centreline and ate the error,
  // 2.7m of it at 15m of shift, which then shows up as a road standing proud
  // of the ground beneath it.
  //
  // The fix is the same one the vertical profile got. Charge the SECOND
  // difference: a sustained shift to one side costs one transition and then
  // nothing, a steady drift across the road costs nothing at all, and
  // alternation costs on every station. The DP state already carries three
  // consecutive stations for the vertical curve, so the bench's own curvature
  // is available at no extra cost.
  lat: 2.5,
  latCurve: 26,
  curve: 400,
};

/**
 * The lateral samples at one station, from whatever sampler you have. Split
 * out so the DP itself never touches terrain — the game passes its live
 * sampler, a test passes a captured grid.
 */
function latCands(
  dense: Array<[number, number]>, i: number, sample: (x: number, z: number) => number,
): number[] {
  const n = dense.length;
  const [x, z] = dense[i];
  const [ax, az] = dense[Math.max(0, i - 1)];
  const [bx, bz] = dense[Math.min(n - 1, i + 1)];
  const tx = bx - ax, tz = bz - az, tl = Math.hypot(tx, tz) || 1;
  const px = -tz / tl, pz = tx / tl;
  return BENCH_OFFS.map((o) => sample(x + px * o, z + pz * o));
}

/**
 * The flattest candidate that is NOT the water: on a coast road the flattest
 * thing in reach is the OCEAN, and an unbanded search walked the road seventy
 * metres down into it. Anything within 8m of the section's minimum is treated
 * as the sea/lowest slope and excluded; where that excludes everything
 * (ordinary flat ground) the spread is tiny and the answer is the median.
 */
function benchFlat(cs: number[]): number {
  const lo = Math.min(...cs);
  const sorted = cs.slice().sort((a, b) => a - b);
  const med = sorted[BENCH_K >> 1];
  let bk = -1, bg = Infinity;
  for (let k = 1; k < BENCH_K - 1; k++) {
    if (cs[k] < lo + 8) continue;
    // A SLOPE, not a height difference. With the candidates evenly spaced the
    // two were interchangeable; they are not once the spacing varies, and
    // comparing a 12m span against a 30m one would call the coarse end of the
    // fan flat purely because its neighbours are further apart.
    const span = Math.max(1, BENCH_OFFS[k + 1] - BENCH_OFFS[k - 1]);
    const g = Math.abs(cs[k + 1] - cs[k - 1]) / span + Math.abs(BENCH_OFFS[k]) * 0.004;
    if (g < bg) { bg = g; bk = k; }
  }
  return bk < 0 ? med : cs[bk];
}

/**
 * THE RULING GRADE, imposed on a finished profile in place.
 *
 * Forward then back, twice: any span steeper than the limit is redistributed
 * as the longest possible ramp at just over the class grade, rather than left
 * as a wall for one station to absorb. Absolute truth about a shelf road's
 * elevation is unknowable in this data; drivability is not negotiable, so this
 * is a law and not a cost term — every branch that can produce a profile ends
 * up here, and so does every stage that reshapes one afterwards.
 *
 * `held` stations are exempt, and the exemption is the whole point of the
 * junction pins: a pinned station IS another road's deck, so moving it is
 * un-welding the join that was just made. The ends were always exempt by
 * construction — the forward pass starts at 1 and the backward pass stops at 1
 * — which is why chain ANCHORS survived this and interior pins silently did
 * not. Neighbours absorb the ramp instead.
 */
function ruleGrade(
  dense: Array<[number, number]>, y: number[], gLim: number, held?: ArrayLike<unknown>,
): void {
  const n = y.length;
  for (let r = 0; r < 2; r++) {
    // THE SPAN IS THE REAL SPAN. This floored at one metre, which let any
    // station shorter than that rise a full metre's worth of grade: densify
    // leaves a 0.1x-leg straight between two consecutive rounded bends, and
    // on The Cheviots Road at Camps Bay that straight is 0.53m long and was
    // carrying a 0.53m step — the fixture's worst seam and a 100% grade,
    // legal under a 1m floor at 1.2x the class limit. The floor only ever
    // guarded a coincident pair, and for those the right answer IS no rise.
    for (let i = 1; i < n; i++) {
      if (held?.[i] != null) continue;
      const d = Math.max(0.1, Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
      y[i] = clamp(y[i], y[i - 1] - gLim * d, y[i - 1] + gLim * d);
    }
    for (let i = n - 2; i >= 1; i--) {
      if (held?.[i] != null) continue;
      const d = Math.max(0.1, Math.hypot(dense[i + 1][0] - dense[i][0], dense[i + 1][1] - dense[i][1]));
      y[i] = clamp(y[i], y[i + 1] - gLim * d, y[i + 1] + gLim * d);
    }
  }
}

/**
 * `pins[i]`, where present, is a height this station must hold — the deck an
 * ALREADY SOLVED road carries at the very same point. Junctions are the one
 * place where two roads have to agree, and OSM's own topology says where they
 * are: two ways that meet share a node, and two ways that cross without one
 * are grade separated. So a pin is simply "another road's solved deck lies
 * within a whisker of this station", and the fact that it does is the evidence
 * that you can turn there.
 *
 * THE STATE CARRIES TWO STATIONS. Curvature is a property of three points, so
 * the cost of arriving at station i on candidate k depends on which candidate
 * station i−1 took. That makes the table K×K per station and the relaxation
 * K³ — 343 instead of 49 at seven candidates, which on the longest chain
 * measured (22km, ~1800 stations) is well under a million operations and has
 * never been the expensive part of building a tile.
 */
function solveChain(
  dense: Array<[number, number]>,
  cand: number[][],
  maxGrade: number,
  p0: number | null,
  p1: number | null,
  pins?: Array<number | null>,
  W: ProfileWeights = WEIGHTS,
): number[] {
  const n = dense.length;
  const gCap = maxGrade > 0 ? maxGrade : 0.15;
  const INF = 1e9;
  // How free this station is to leave the centreline: where the lateral
  // samples disagree wildly there is real relief to find a bench in, and where
  // they agree there is nothing to gain by wandering.
  const free = cand.map((cs) => clamp(Math.abs(cs[BENCH_K - 1] - cs[0]) / 18, 0, 1));
  const flat = cand.map(benchFlat);
  const span = (i: number): number => Math.max(1, Math.hypot(
    dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));

  /** What it costs to stand at station i on candidate k, before any history. */
  const stat = (i: number, k: number): number =>
    Math.abs(BENCH_OFFS[k]) * W.off * (1 - 0.75 * free[i])
    + Math.abs(cand[i][k] - flat[i]) * W.flat * free[i]
    + (i === 0 && p0 !== null ? Math.abs(cand[i][k] - p0) * W.pin : 0)
    + (i === n - 1 && p1 !== null ? Math.abs(cand[i][k] - p1) * W.pin : 0)
    + (pins?.[i] == null ? 0 : Math.abs(cand[i][k] - (pins[i] as number)) * W.pin);

  /** Sideways travel between two chosen benches, in candidate steps. */
  const lateral = (j: number, k: number): number => {
    const dk = (BENCH_OFFS[k] - BENCH_OFFS[j]) / BENCH_STEP;
    return dk * dk * W.lat;
  };
  /** The bench's own curvature: how much its sideways RATE changed. Zero for a
   *  straight walk across the road, large for a flip-flop. */
  const latKink = (j: number, k: number, m: number): number => {
    const d = (BENCH_OFFS[m] - 2 * BENCH_OFFS[k] + BENCH_OFFS[j]) / BENCH_STEP;
    return d * d * W.latCurve;
  };
  /** Grade of the span into station i, arriving on k from j. */
  const grade = (i: number, j: number, k: number): number =>
    (cand[i][k] - cand[i - 1][j]) / span(i);
  /** What the span into i costs on grade alone. */
  const steep = (i: number, j: number, k: number): number => {
    const d = span(i);
    const excess = Math.max(0, Math.abs(cand[i][k] - cand[i - 1][j]) - gCap * d);
    return (excess * excess * W.grade) / d;
  };

  if (n < 2) return cand.map((cs) => cs[BENCH_C]);

  // cost[k * BENCH_K + j] — at station i on k, having come from j.
  let cost = new Float64Array(BENCH_K * BENCH_K).fill(INF);
  for (let j = 0; j < BENCH_K; j++) {
    for (let k = 0; k < BENCH_K; k++) {
      // Out of band at the seed as well: a chain that may not cross the
      // corridor mid-way must not be allowed to start having done so.
      cost[k * BENCH_K + j] = Math.abs(k - j) > BENCH_BAND ? INF
        : stat(0, j) + stat(1, k) + lateral(j, k) + steep(1, j, k);
    }
  }
  // back[i][k * K + j] = the candidate station i−2 took. Int8 is ample at K=7.
  const back: Int8Array[] = [];
  for (let i = 2; i < n; i++) {
    const next = new Float64Array(BENCH_K * BENCH_K).fill(INF);
    const bk = new Int8Array(BENCH_K * BENCH_K).fill(-1);
    for (let k = 0; k < BENCH_K; k++) {           // station i−1
      const mLo = Math.max(0, k - BENCH_BAND), mHi = Math.min(BENCH_K - 1, k + BENCH_BAND);
      for (let m = mLo; m <= mHi; m++) {          // station i
        const arrive = stat(i, m) + lateral(k, m) + steep(i, k, m);
        const gNew = grade(i, k, m);
        let best = INF, bestJ = -1;
        const jLo = Math.max(0, k - BENCH_BAND), jHi = Math.min(BENCH_K - 1, k + BENCH_BAND);
        for (let j = jLo; j <= jHi; j++) {        // station i−2
          const c0 = cost[k * BENCH_K + j];
          if (c0 >= INF) continue;
          // THE VERTICAL CURVE. Without this term every grade inside the class
          // limit is free, so the cheapest profile is free to alternate
          // between +gCap and −gCap station by station and the DP has no
          // reason to prefer a ramp.
          const dg = gNew - grade(i - 1, j, k);
          const c = c0 + arrive + dg * dg * W.curve + latKink(j, k, m);
          if (c < best) { best = c; bestJ = j; }
        }
        next[m * BENCH_K + k] = best;
        bk[m * BENCH_K + k] = bestJ;
      }
    }
    back.push(bk);
    cost = next;
  }

  // Unwind: find the cheapest (last, second-last) pair and walk back.
  let bestIdx = 0;
  for (let i = 1; i < cost.length; i++) if (cost[i] < cost[bestIdx]) bestIdx = i;
  const pick = new Array<number>(n).fill(BENCH_C);
  let k = Math.floor(bestIdx / BENCH_K);
  let j = bestIdx % BENCH_K;
  pick[n - 1] = k;
  if (n >= 2) pick[n - 2] = j;
  for (let i = n - 1; i >= 2; i--) {
    const prev = back[i - 2][k * BENCH_K + j];
    if (prev < 0) break;
    pick[i - 2] = prev;
    k = j; j = prev;
  }

  const alg = cand.map((cs, i) => cs[pick[i]]);
  if (p0 !== null && Math.abs(alg[0] - p0) < 4) alg[0] = p0;
  if (p1 !== null && Math.abs(alg[n - 1] - p1) < 4) alg[n - 1] = p1;
  // A junction pin is not a preference. The lateral candidates are DEM samples
  // and none of them need land on the neighbour's deck, so the pinned stations
  // are seated exactly and the limiter below ramps the rest of the chain to
  // meet them — which is what makes the two ribbons one surface where they
  // touch instead of two terraces with a wall between.
  if (pins) for (let i = 0; i < n; i++) if (pins[i] != null) alg[i] = pins[i] as number;
  // Where chains solved in different tiles disagree about the absolute shelf,
  // someone must absorb the difference — and the DP's soft costs concentrated
  // it into one fragment as a 70% wall.
  //
  // THE PINS ARE HELD THROUGH THIS. Seating them a line earlier and then
  // letting the limiter clamp them was the whole junction-step bug: a long
  // chain's own profile disagrees with the road it joins by more than one
  // station's grade allowance, so the limiter dragged the pinned station back
  // towards its neighbours and the two carriageways parted.
  ruleGrade(dense, alg, gCap * 1.2, pins);
  return alg;
}

/** The offsets a solve chose, for a test that wants to ask about the bench
 *  rather than the heights. Recomputed rather than returned from solveChain so
 *  the hot path allocates nothing extra. */
function chosenOffsets(cand: number[][], alg: number[]): number[] {
  return alg.map((y, i) => {
    let bk = BENCH_C, bd = Infinity;
    for (let k = 0; k < BENCH_K; k++) {
      const d = Math.abs(cand[i][k] - y);
      if (d < bd) { bd = d; bk = k; }
    }
    return BENCH_OFFS[bk];
  });
}

return { BENCH_OFFS, BENCH_K, BENCH_C, WEIGHTS, latCands, benchFlat, ruleGrade, solveChain, chosenOffsets };
}

export const {
  BENCH_OFFS, BENCH_K, BENCH_C, WEIGHTS,
  latCands, benchFlat, ruleGrade, solveChain, chosenOffsets,
} = createRoadProfileKernel();
