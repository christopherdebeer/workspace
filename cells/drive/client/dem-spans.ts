/**
 * ── A BRIDGE IS NOT GROUND, AND ONLY THE ROADS CAN SAY SO ──
 *
 * The elevation mosaic is a SURFACE model where its best source is one, so
 * where a national LiDAR fills the gap it serves the carriageway, the parapets
 * and the pylons as terrain. Measured at the Pont de Normandie: 137 m of
 * "ground" standing over an estuary the land cover calls water, the anchor
 * texel under the seat's own spawn reading 61.6 m against a 6.4 m river, and
 * everything downstream believing it — the mesh, the water's bed, and the road
 * solve that put the carriageway 63 m under the ridge it belongs to.
 *
 * `repairDem` cannot reach it, and the survey says why in the repair's own
 * terms (devtools/dem-ridges.mjs, and the table in CLAUDE.md): the pylons ARE
 * flagged and diffused away — 161 m over a 30 m relief, an equivalent radius
 * half of what the slope allows — and what is left standing is the DECK, 79 m
 * up and 37 m wide, which is under the 80 m rise the blob walk even considers
 * and under the 3x relief a blob must dwarf.
 *
 * AND NO SHAPE RULE CAN REACH IT EITHER. That was measured before this module
 * was written, over twenty-one tiles including the hardest narrow landforms on
 * earth, and it is the reason this file exists rather than a wider tolerance in
 * demrepair.ts:
 *
 *   Pont de Normandie, the deck   79 m tall · 37 m wide · 0.40 of the width its height allows
 *   Old Man of Hoy, the stack     77 m tall · 30 m wide · 0.33 of the width its height allows
 *
 * At six metres a pixel a sea stack and a carriageway are the same object. The
 * one thing that separates them is that somebody mapped a `bridge` over one of
 * them, so the repair has to be told by the ways — which means it cannot live
 * in demrepair.ts, whose whole contract is that it is pure per-tile and runs
 * identically in the capture tool.
 *
 * WHAT THIS DOES, AND THE THREE RULES THAT KEEP IT HONEST:
 *
 *  - IT ONLY EVER LOWERS. A span with no structure under it is a no-op, which
 *    is the common case (fifteen of the sixteen estuary spans surveyed have a
 *    flat DEM under them), so the rule costs nothing where it is not needed and
 *    cannot invent a mound anywhere.
 *  - IT INTERPOLATES ACROSS THE DECK, NEVER ALONG IT. A deck is narrow across
 *    and long along, so the ground the repair reads is twenty metres away
 *    rather than a kilometre: the bed under a 1,185 m span is never guessed
 *    from its banks. Each texel takes the HIGHER of what it finds either side —
 *    the deck may be beside a bank, and taking the lower would dig a trench
 *    along the shoreline — clamped to what is already there.
 *  - AND A SPAN THAT IS NOT NARROW IS NOT A DECK. If the walk cannot get off
 *    the structure within `reachPx`, the texel is left exactly as it came: a
 *    mis-tagged causeway, an embankment or a bridge-shaped building is real
 *    ground, and this rule has no way to tell otherwise.
 */

/** A bridge's centreline in ONE tile's pixel space, with its half width. */
export interface DemSpan {
  /** x0, y0, x1, y1, … in texels of this tile's 256-wide raster. */
  pts: Float64Array;
  /** Half the structure's width in texels, the alignment margin included. */
  halfPx: number;
}

export interface DemSpanOpts {
  /** How far past the mask to look for ground, in texels. */
  reachPx: number;
  /** Metres a texel must stand over the ground beside it before it is touched
   *  at all — and the one number that keeps this off real terrain. A mask is
   *  the deck's own width, so the prominence an ORDINARY hillside shows across
   *  it is the slope times the half mask: about six metres across a forty-metre
   *  mask on a 30% slope, nine on a 45%. Twelve clears those and is a long way
   *  under a deck, which stands sixty to a hundred and forty. The cost is
   *  stated: a low bridge whose DSM stands less than twelve metres proud is
   *  left alone, and a low bridge is a low error. */
  riseM: number;
  /** Left on the cleared ground so a deck's own shadow does not become a
   *  ditch; a metre is under the field's own vertical resolution. */
  clearM: number;
}

/**
 * Is this texel WATER, in the land cover's opinion? Optional, and it is what
 * makes the rule work over an estuary.
 *
 * A surface model does not smear a structure to its own width: at the Pont de
 * Normandie the carriageway is 23 m and the "ground" it leaves is 37 m, with
 * the pylons' own footprint wider still. So the first texel off the mask is
 * routinely more structure, and a rule that takes it as the ground lowers a
 * 137 m deck to 32 m and calls it done — measured, exactly that, before this
 * existed. Looking FURTHER for something lower is the obvious repair and it is
 * the one that shaves hills: over eighty metres a thirty percent slope falls
 * twenty-six, which is a prominence any deck threshold would fire on.
 *
 * The cover is what tells those apart, and the survey says it is there: at all
 * sixteen estuary spans measured the land cover calls the deck's own texel
 * water, and water is 60–100% of the box. So a side that finds water takes the
 * WATER's level; a side that does not keeps the first unmasked texel, which is
 * what a viaduct over a dry valley gets and is why this is optional.
 */
export type DemSpanWater = (px: number, py: number) => boolean;

export const DEM_SPAN_DEFAULTS: DemSpanOpts = { reachPx: 14, riseM: 12, clearM: 1 };

/** Distance from a point to a segment, and the segment's unit normal. */
function segNear(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): { d: number; nx: number; ny: number } {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const cx = ax + dx * t, cy = ay + dy * t;
  const len = Math.sqrt(len2) || 1;
  return { d: Math.hypot(px - cx, py - cy), nx: -dy / len, ny: dx / len };
}

/**
 * Take the structures out of one tile's raster, in place.
 *
 * Returns how many texels moved and by how much at worst, because a repair
 * that reports nothing cannot be argued with — and because "the span was
 * there and the DEM was already flat" and "the span never reached this tile"
 * are different answers that look identical from outside.
 */
export function clearDemSpans(
  data: Float32Array,
  spans: readonly DemSpan[],
  opts: DemSpanOpts = DEM_SPAN_DEFAULTS,
  w = 256,
  isWater?: DemSpanWater,
): { moved: number; worstM: number; refused: number; onWater: number } {
  if (!spans.length) return { moved: 0, worstM: 0, refused: 0, onWater: 0 };
  const h = data.length / w;
  // The mask, and the segment each masked texel belongs to — the normal is
  // what makes the walk go ACROSS the deck rather than along it.
  const mask = new Uint8Array(data.length);
  const nx = new Float32Array(data.length);
  const ny = new Float32Array(data.length);
  for (const span of spans) {
    const p = span.pts;
    const half = span.halfPx;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = p[i + 1], bx = p[i + 2], by = p[i + 3];
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - half - 1));
      const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + half + 1));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - half - 1));
      const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + half + 1));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const s = segNear(x + 0.5, y + 0.5, ax, ay, bx, by);
          if (s.d > half) continue;
          const k = y * w + x;
          mask[k] = 1; nx[k] = s.nx; ny[k] = s.ny;
        }
      }
    }
  }
  let moved = 0, worstM = 0, refused = 0, onWater = 0;
  const out = new Float32Array(data.length);
  out.set(data);
  for (let k = 0; k < data.length; k++) {
    if (!mask[k]) continue;
    const x = k % w, y = (k / w) | 0;
    // Off the structure, square to it, BOTH ways — and both must succeed. One
    // side is not evidence: at the edge of a mis-tagged embankment the outward
    // walk finds ground within a texel or two while the inward one never
    // leaves the structure, and a rule that accepted that would shave the
    // shoulders off every causeway on earth and leave its middle standing.
    let found = 0, ref = -Infinity, water = Infinity;
    for (const sgn of [1, -1]) {
      let side: number | null = null;
      for (let step = 1; step <= opts.reachPx; step++) {
        const sx = Math.round(x + sgn * nx[k] * step);
        const sy = Math.round(y + sgn * ny[k] * step);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) break;
        const j = sy * w + sx;
        // The cover's water beats anything: it is the one reading that cannot
        // be the structure. Keep walking while the texels are masked OR while
        // this side has only found more structure to stand on.
        if (isWater && isWater(sx, sy)) {
          side = data[j];
          if (data[j] < water) water = data[j];
          break;
        }
        if (mask[j]) continue;
        if (side === null) side = data[j];
        if (!isWater) break;              // no cover to ask: the first ground it is
      }
      if (side === null) continue;
      // The HIGHER of the two sides: a deck along a shoreline has water on
      // one hand and a bank on the other, and the bank is the ground.
      if (side > ref) ref = side;
      found++;
    }
    // …UNLESS ONE SIDE IS WATER, and then the water is the bed. The higher
    // side is the right answer for a deck lying along a shoreline and the
    // wrong one for a span whose other flank is its own pylon: measured at the
    // Pont de Normandie, taking the higher left the deck at 20 m over a river
    // at zero, because within reach of one side there is nothing but bridge.
    // The prominence guard is what keeps an abutment safe — where the deck is
    // at bank height it stands less than `riseM` over anything and is left.
    if (water < Infinity) { ref = water; onWater++; }
    if (found < 2) { refused++; continue; }
    const target = ref + opts.clearM;
    if (data[k] - target <= opts.riseM) continue;
    out[k] = target;
    moved++;
    if (data[k] - target > worstM) worstM = data[k] - target;
  }
  if (moved) data.set(out);
  return { moved, worstM, refused, onWater };
}
