/**
 * ── THE TRUCK IS A BOX, AND EVERY COLLISION IN THIS GAME ASKED A CIRCLE ──
 *
 * Reported from the seat: road barriers and buildings "trigger too far away,
 * like a metre from the barrier". They do, and the number is exact. Every
 * contact test — the wall push-out, the cover shell, trunks, boulders — reaches
 * `CAR_R`, one radius about the truck's centre, whose own comment calls it "a
 * real car's half-diagonal plus a whisker". A circle that circumscribes a
 * rectangle is the right size at ONE point, the corner; everywhere else it
 * stands proud of the hull, and at the FLANK — where a long vehicle is narrow
 * — by the most.
 *
 * Measured off the drawn model (`__rigbox`): the hull is 1.08 m half-width and
 * 2.546 m half-length, so its half-diagonal is 2.766 m and `CAR_R` is 2.4.
 * The comment is wrong twice over — it is the half-diagonal MINUS 0.37 — and
 * what that buys is a fault in both directions at once:
 *
 *     running ALONG a barrier   the hull stops 1.32 m short of it
 *     driving INTO one          the hull sinks 0.15 m into it
 *     obliquely                 it sinks up to 0.35 m in
 *
 * So this module is the truck's own shape, and it is a module because the
 * shape is useless without the FRAME and the frame was written out by hand at
 * five sites in main.ts — one of which had it wrong (see below). Pure: no
 * THREE, no DOM, no world state, so a node test can drive the shipped
 * functions in milliseconds.
 *
 * ── THE FRAME, TAKEN FROM THE INTEGRATION AND NOT FROM A MODEL ──
 *
 * `stepDrive` advances the truck with
 *
 *     state.x += Math.sin(state.heading) * state.speed * dt;
 *     state.z -= Math.cos(state.heading) * state.speed * dt;
 *     state.x += cH * slideV * dt;   // (cos, sin) is the car's own right
 *     state.z += sH * slideV * dt;
 *
 * so FORWARD is (sin h, −cos h) and RIGHT is (cos h, sin h). Those are
 * orthonormal, and they agree with the drawn model: `car.rotation.set(pitch,
 * −heading, roll)` maps the model's local +x to (cos h, sin h) and its local
 * −z — which is where the headlight target sits — to (sin h, −cos h). At
 * heading 0 the truck faces −z, which is north, as `toLocal` declares.
 *
 * **AND ONE SITE HAD THE Z SIGN INVERTED**, found by deriving this: the cover
 * shell's "how square was the hit" computed `vz = cos(h)·speed − sin(h)·slideV`
 * where every other site in the file writes `−cos(h)·speed`, so it read the
 * truck's velocity reflected about the x axis and charged a glancing pass at
 * the rim as a head-on one and the other way round. A frame written out five
 * times is a frame that will be written out wrong once; this is the copy.
 */

export interface HullBox {
  /** Half the hull ACROSS the truck, in metres. */
  readonly halfWidthM: number;
  /** Half the hull ALONG it. */
  readonly halfLengthM: number;
}

/** The hull's own axes in the world. See the frame note above. */
export function hullAxes(heading: number): {
  rx: number; rz: number; fx: number; fz: number;
} {
  const s = Math.sin(heading), c = Math.cos(heading);
  return { rx: c, rz: s, fx: s, fz: -c };
}

/**
 * The circle that CONTAINS the hull — the broad phase, and nothing else.
 *
 * A candidate set gathered at a smaller radius than this can miss a corner
 * contact, so it is the half-diagonal exactly rather than `CAR_R`, which is
 * smaller than the hull it was supposed to circumscribe.
 */
export const hullRadiusM = (box: HullBox): number =>
  Math.hypot(box.halfWidthM, box.halfLengthM);

/** A world offset from the hull's centre, in the hull's own axes: across, along. */
export function toHull(dx: number, dz: number, heading: number): [number, number] {
  const a = hullAxes(heading);
  return [dx * a.rx + dz * a.rz, dx * a.fx + dz * a.fz];
}

/** A hull-frame vector back into the world. */
export function fromHull(across: number, along: number, heading: number): [number, number] {
  const a = hullAxes(heading);
  return [across * a.rx + along * a.fx, across * a.rz + along * a.fz];
}

/**
 * How far the hull reaches from its centre along a world direction — its
 * support function. This is what a circle was standing in for, and it is the
 * whole difference: constant for a circle, and for a box it runs from the
 * half-width at the flank to the half-length at the nose.
 *
 * The direction need not be normalised; the answer is per unit of it.
 */
export function hullReachM(heading: number, box: HullBox, dirX: number, dirZ: number): number {
  const len = Math.hypot(dirX, dirZ);
  if (!(len > 1e-9)) return 0;
  const [u, v] = toHull(dirX / len, dirZ / len, heading);
  return Math.abs(u) * box.halfWidthM + Math.abs(v) * box.halfLengthM;
}

/**
 * The distance from the HULL to a world point, zero once the point is inside
 * it. Exact: the point is taken into the hull's frame, clamped to the box, and
 * the remainder measured — which is the right test for every round obstacle in
 * this world (a trunk, a boulder, the rim of a cover) where the support
 * function would over-reach near a corner.
 */
export function hullPointDistanceM(
  cx: number, cz: number, heading: number, box: HullBox,
  px: number, pz: number,
): number {
  const [u, v] = toHull(px - cx, pz - cz, heading);
  const du = Math.max(0, Math.abs(u) - box.halfWidthM);
  const dv = Math.max(0, Math.abs(v) - box.halfLengthM);
  return Math.hypot(du, dv);
}

export interface HullPush {
  /** The world translation that separates the hull, in metres. */
  readonly x: number;
  readonly z: number;
  /** Its magnitude — how deep the overlap was. */
  readonly depthM: number;
}

/**
 * THE LEAST TRANSLATION THAT SEPARATES THE HULL FROM A WALL SEGMENT, or null
 * where they do not touch.
 *
 * Separating-axis, and in two dimensions the axis set is COMPLETE: the edge
 * normals of both bodies, which for a box are its own two axes and for a
 * segment is its one normal. So this is exact, not an approximation of a
 * rounded hull — a capsule was the obvious cheaper answer and was measured
 * wrong at the corner, where it under-reaches the true box by 0.32 m and lets
 * a bumper sink into a façade.
 *
 * A DEGENERATE SEGMENT IS A POINT, and a point has no edge normal, so the two
 * box axes alone are complete for it. Skipping the third axis there is not a
 * shortcut: `n̂` is undefined and including it would push along a direction
 * built out of a division by nothing.
 */
export function hullPushFromSegment(
  cx: number, cz: number, heading: number, box: HullBox,
  ax: number, az: number, bx: number, bz: number,
): HullPush | null {
  const [au, av] = toHull(ax - cx, az - cz, heading);
  const [bu, bv] = toHull(bx - cx, bz - cz, heading);
  const hw = box.halfWidthM, hl = box.halfLengthM;
  let depth = Infinity, pu = 0, pv = 0;

  // ACROSS. The segment spans [lo, hi]; the hull spans [-hw, hw]. Moving the
  // hull to +across by `hi + hw` clears it, and to -across by `hw - lo`; the
  // smaller is this axis's overlap, and it is NEGATIVE exactly when the two
  // are already apart on it, which is the separating axis and an early out.
  {
    const lo = Math.min(au, bu), hi = Math.max(au, bu);
    const pos = hi + hw, neg = hw - lo;
    const d = Math.min(pos, neg);
    if (d <= 0) return null;
    depth = d; pu = pos < neg ? 1 : -1; pv = 0;
  }
  // ALONG.
  {
    const lo = Math.min(av, bv), hi = Math.max(av, bv);
    const pos = hi + hl, neg = hl - lo;
    const d = Math.min(pos, neg);
    if (d <= 0) return null;
    if (d < depth) { depth = d; pu = 0; pv = pos < neg ? 1 : -1; }
  }
  // THE SEGMENT'S OWN NORMAL, on which the segment is a single point and the
  // hull's extent is its support along that normal.
  {
    const su = bu - au, sv = bv - av;
    const len = Math.hypot(su, sv);
    if (len > 1e-9) {
      const nu = -sv / len, nv = su / len;
      const p = au * nu + av * nv;
      const r = hw * Math.abs(nu) + hl * Math.abs(nv);
      const pos = p + r, neg = r - p;
      const d = Math.min(pos, neg);
      if (d <= 0) return null;
      if (d < depth) {
        depth = d;
        if (pos < neg) { pu = nu; pv = nv; } else { pu = -nu; pv = -nv; }
      }
    }
  }
  const [wx, wz] = fromHull(pu, pv, heading);
  return { x: wx * depth, z: wz * depth, depthM: depth };
}
