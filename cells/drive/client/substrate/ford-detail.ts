/**
 * A FORD IS THE ONE CROSSING KIND THAT USED TO DRAW NOTHING.
 *
 * `resolveProductionCrossing` gives a ford `implementation: 'not-required'`,
 * and that is right about a CONDUIT — there is no barrel to build, because
 * the whole point of a drift is that the road goes through the water. It was
 * then read as "no geometry at all", so the one crossing a driver meets most
 * often was the one the world said nothing about: measured at Chapman's Peak,
 * 27 of 27 drawn-wet points inside a carriageway carried a ford record with
 * the river resting 0.22-0.65 m over the deck, and the frame from the seat
 * showed a river painted across a track with nothing built at it.
 *
 * A real drift is built, and what it is built of is the point: a hard apron
 * laid on the bed so wheels have something to cross on, a lip or cutoff wall
 * at each edge so the apron is not scoured out from under, and marker posts
 * at the entries so a driver can see where the crossing is and how deep it
 * has become. None of that is a conduit and all of it is geometry.
 *
 * Renderer-free by the same rule as `culvert-detail.ts`: this owns the exact
 * apron, sills and posts; the caller owns materials, meshes and the packet
 * that commits them. Pure, so `substrate.test.ts` can drive it.
 *
 * THE STATIONS ARE THE WATERCOURSE'S, NOT THE ROAD'S, because that is what
 * the crossing loop already has in hand — a watercourse crossing a road runs
 * from one kerb to the other, so walking `coreStart..coreEnd` walks ACROSS the
 * carriageway, and the perpendicular offsets at each station run ALONG the
 * road. The apron is therefore a strip over the channel, exactly the shape a
 * drift is.
 *
 * AND THAT WALK IS OFTEN ONE STATION LONG. A watercourse is densified for its
 * own geometry and knows nothing about the roads that cross it, so at a track
 * a few metres wide the core is routinely a single station — seven of nine
 * crossings at Chapman's Peak. The span is synthesised from the carriageway's
 * own half width there rather than refused; see `buildProductionFord`.
 */

/** How far past the drawn water's edge the apron reaches, each side. A drift
 *  is wider than its channel or the first flood takes its edges. */
export const FORD_LIP_M = 1.4;
/** The apron sits this far over the carriageway deck. The road's own ribbon
 *  is drawn at the deck plus `SURFACE.road.lift` (4 cm) — a render z-order
 *  device, not a kerb — so anything meant to read as laid ON the road has to
 *  clear that, or the two fight for depth and the drift flickers. */
export const FORD_PROUD_M = 0.07;
/** The cutoff at each edge: visible as a low lip, and the reason the apron
 *  does not simply end in mid-air where the bed falls away. */
export const FORD_SILL_DROP_M = 0.45;
export const FORD_POST_H_M = 1.35;
export const FORD_POST_R_M = 0.11;
/** Past this the crossing is not a drift by any reading — it is a causeway or
 *  a bridge nobody tagged — and inventing an apron across it would be building
 *  infrastructure the source does not claim. */
export const FORD_MAX_HALF_M = 16;

export interface ProductionFordInput {
  /** The watercourse polyline, in world metres. */
  stations: readonly (readonly [x: number, z: number])[];
  /** The road deck over each station, or null where no carriageway is there. */
  deckY: readonly (number | null)[];
  /** The channel invert under each station. */
  invertY: readonly number[];
  /** The natural ground under each station. */
  groundY: readonly number[];
  /** The contiguous run of stations under the carriageway. `coreStart` equal
   *  to `coreEnd` is ordinary rather than degenerate, and is served from
   *  `roadHalfWidthM`. */
  coreStart: number;
  coreEnd: number;
  /** Half the DRAWN water's width — the apron spans this plus the lip. */
  waterHalfWidthM: number;
  /** Half the CARRIAGEWAY's width. Only read where the core is a single
   *  station, which is the common case and not a degenerate one — see the
   *  span resolution below. */
  roadHalfWidthM?: number;
  /** The drawn water's resting level, where the field has one. */
  waterSurfaceY?: number | null;
}

export interface ProductionFordGeometry {
  /** Reason the drift was refused, when it was. */
  outcome: 'built' | 'no-span' | 'no-deck' | 'too-wide';
  /** The apron's own top surface and edges, as raw triangles. */
  apron: Float32Array;
  /** The two cutoff lips, as raw triangles. */
  sills: Float32Array;
  /** The marker posts, as raw triangles. */
  posts: Float32Array;
  postCount: number;
  /** Along the road: how much of the channel the apron covers. */
  lengthM: number;
  /** Across the road: the carriageway's own width at the crossing. */
  widthM: number;
  /** How deep the drawn water stands over the apron, where it is known. */
  depthOverApronM: number | null;
}

const EMPTY = new Float32Array(0);

const refuse = (outcome: ProductionFordGeometry['outcome']): ProductionFordGeometry => ({
  outcome, apron: EMPTY, sills: EMPTY, posts: EMPTY, postCount: 0,
  lengthM: 0, widthM: 0, depthOverApronM: null,
});

const push3 = (out: number[], x: number, y: number, z: number): void => {
  out.push(x, y, z);
};

const quad = (
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void => {
  out.push(...a, ...b, ...c, ...b, ...d, ...c);
};

/**
 * The unit normal of the polyline at a station, averaged across the two bays
 * that meet there so an apron does not crease at a bend. The same construction
 * `productionCulvertOffsets` uses, and for the same reason.
 */
const normalAt = (
  stations: readonly (readonly [number, number])[],
  station: number,
  start: number,
  end: number,
): readonly [number, number] => {
  const bay = (index: number): readonly [number, number] => {
    const at = Math.max(start, Math.min(end - 1, index));
    const dx = stations[at + 1][0] - stations[at][0];
    const dz = stations[at + 1][1] - stations[at][1];
    const length = Math.hypot(dx, dz) || 1;
    return [-dz / length, dx / length];
  };
  const [priorX, priorZ] = bay(station - 1);
  const [nextX, nextZ] = bay(station);
  const meanX = (priorX + nextX) * .5;
  const meanZ = (priorZ + nextZ) * .5;
  const magnitude = Math.hypot(meanX, meanZ);
  // A near-reversal (a hairpin in the channel) has no honest mean; take the
  // outgoing bay rather than a normal of length nothing.
  if (magnitude < .2) return [nextX, nextZ];
  return [meanX / magnitude, meanZ / magnitude];
};

export function buildProductionFord(
  input: ProductionFordInput,
): ProductionFordGeometry {
  const { stations, deckY, invertY, groundY } = input;
  const start = Math.max(0, input.coreStart);
  const end = Math.min(stations.length - 1, input.coreEnd);
  if (end < start || start >= stations.length) return refuse('no-span');
  const halfM = Math.max(1.2, input.waterHalfWidthM) + FORD_LIP_M;
  if (halfM > FORD_MAX_HALF_M) return refuse('too-wide');

  // ── THE SPAN IS RESOLVED FIRST, AND A SINGLE STATION IS THE COMMON CASE ──
  //
  // A watercourse is densified for its OWN geometry, not for the roads that
  // cross it, so at a track a few metres wide the core is routinely one
  // station: measured at Chapman's Peak, seven of nine crossings. Refusing
  // those — which the first cut did, as `no-span` — threw away most of the
  // fords in the world for want of a second point, and the second point is
  // not missing evidence, it is arithmetic: the carriageway reaches its own
  // half width either side of the crossing along the channel. So the span is
  // synthesised there rather than refused, and only a core of one station
  // with no road width to go on is a refusal.
  const pts: Array<readonly [number, number]> = [];
  const deck: number[] = [];
  const inv: number[] = [];
  const grd: number[] = [];
  if (end > start) {
    for (let station = start; station <= end; station++) {
      const y = deckY[station];
      if (y === null || !Number.isFinite(y)) return refuse('no-deck');
      pts.push(stations[station]);
      deck.push(y as number);
      inv.push(invertY[station]);
      grd.push(groundY[station]);
    }
  } else {
    const hw = input.roadHalfWidthM ?? 0;
    if (!Number.isFinite(hw) || hw <= 0.25) return refuse('no-span');
    const y = deckY[start];
    if (y === null || !Number.isFinite(y)) return refuse('no-deck');
    // The channel's own direction at the crossing, from whichever neighbours
    // exist: a crossing at the very end of a traced watercourse has one.
    const before = stations[Math.max(0, start - 1)];
    const after = stations[Math.min(stations.length - 1, start + 1)];
    let tx = after[0] - before[0];
    let tz = after[1] - before[1];
    const length = Math.hypot(tx, tz);
    if (!(length > 1e-6)) return refuse('no-span');
    tx /= length; tz /= length;
    const [cx, cz] = stations[start];
    for (const step of [-hw, 0, hw]) {
      pts.push([cx + tx * step, cz + tz * step]);
      deck.push(y as number);
      inv.push(invertY[start]);
      grd.push(groundY[start]);
    }
  }

  const last = pts.length - 1;
  const apron: number[] = [];
  const sills: number[] = [];
  const posts: number[] = [];
  const left: Array<[number, number, number]> = [];
  const right: Array<[number, number, number]> = [];
  let widthM = 0;
  for (let i = 0; i <= last; i++) {
    const [x, z] = pts[i];
    const [nx, nz] = normalAt(pts, i, 0, last);
    const y = deck[i] + FORD_PROUD_M;
    left.push([x - nx * halfM, y, z - nz * halfM]);
    right.push([x + nx * halfM, y, z + nz * halfM]);
    if (i > 0) widthM += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
  }
  for (let i = 1; i < left.length; i++) {
    quad(apron, left[i - 1], right[i - 1], left[i], right[i]);
  }

  // The cutoff at each edge drops to the bed, or as far as the sill goes,
  // whichever is shallower: a lip that reached the invert of a deep pool
  // would be a wall standing in the river rather than the edge of an apron.
  const sillFoot = (i: number, topY: number): number => {
    const bed = Math.min(inv[i], grd[i]);
    return Math.max(bed, topY - FORD_SILL_DROP_M);
  };
  for (let i = 1; i < left.length; i++) {
    const s0 = i - 1;
    const s1 = i;
    const l0 = left[i - 1];
    const l1 = left[i];
    const r0 = right[i - 1];
    const r1 = right[i];
    quad(sills,
      [l0[0], sillFoot(s0, l0[1]), l0[2]], l0,
      [l1[0], sillFoot(s1, l1[1]), l1[2]], l1);
    quad(sills,
      r0, [r0[0], sillFoot(s0, r0[1]), r0[2]],
      r1, [r1[0], sillFoot(s1, r1[1]), r1[2]]);
  }

  // Four posts, one at each corner of the apron, standing on the deck a half
  // metre outboard of the lip: they mark where the crossing is from the
  // approach, which is the one thing a driver needs and the picture had none
  // of. Square section — at twelve pixels to the metre a cylinder is a square.
  const postAt = (x: number, z: number, baseY: number): void => {
    const r = FORD_POST_R_M;
    const top = baseY + FORD_POST_H_M;
    const corners: Array<readonly [number, number]> = [
      [x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i];
      const [bx, bz] = corners[(i + 1) % 4];
      quad(posts, [ax, baseY, az], [bx, baseY, bz], [ax, top, az], [bx, top, bz]);
    }
    quad(posts,
      [corners[0][0], top, corners[0][1]], [corners[1][0], top, corners[1][1]],
      [corners[3][0], top, corners[3][1]], [corners[2][0], top, corners[2][1]]);
  };
  for (const end0 of [0, last]) {
    const [x, z] = pts[end0];
    const [nx, nz] = normalAt(pts, end0, 0, last);
    const out = halfM + .5;
    const baseY = deck[end0];
    postAt(x - nx * out, z - nz * out, baseY);
    postAt(x + nx * out, z + nz * out, baseY);
  }

  const midDeck = deck[Math.floor(deck.length / 2)] + FORD_PROUD_M;
  const depthOverApronM = input.waterSurfaceY === null
    || input.waterSurfaceY === undefined
    || !Number.isFinite(input.waterSurfaceY)
    ? null
    : Math.max(0, (input.waterSurfaceY as number) - midDeck);

  return {
    outcome: 'built',
    apron: new Float32Array(apron),
    sills: new Float32Array(sills),
    posts: new Float32Array(posts),
    postCount: 4,
    lengthM: halfM * 2,
    widthM,
    depthOverApronM,
  };
}
