/**
 * ── WHICH WATER IS THE SEA ──
 *
 * The world has asked one question about water for a long time — "is the whole
 * 40km sea plane switched on?" — and answered it globally, from the truck's own
 * elevation. Everything painful about water in this game descends from that:
 * the dry-basin evidence, the 30km suppression radius, the boot rule that says
 * a world starting below −2m must be a basin. A polder cannot be dry while the
 * North Sea is visible a kilometre away, because there is only one switch.
 *
 * The replacement question is spatial: is THIS POINT ocean. That is what this
 * file answers, per cover tile, as a coverage grid the hydro renderer consumes
 * directly.
 *
 * ── THE DISTINCTION THE RASTER ALREADY MAKES AND main.ts THREW AWAY ──
 *
 *     return v || null;   // 0 is "no class here" (open ocean), not a class
 *
 * That comment is right and the code beneath it is lossy: `0` and `not loaded`
 * both leave as `null`. But raw zero is the single most reliable ocean signal
 * in the dataset — WorldCover classifies land, so the absence of any class over
 * a pixel IS open water — and it is the one thing that distinguishes Badwater
 * Basin at −86m (which has land classes) from the Pacific (which has none).
 *
 * ── WHY THE FLOOD IS BOUNDED ──
 *
 * Coastal water arrives as class 80, not as zero: the raster's ocean band runs
 * a few pixels inshore of where zero begins. So the mask has to absorb SOME
 * class-80 next to the zeros or every coastline sits offshore by a hundred
 * metres. But an unbounded flood through class 80 walks up an estuary, up the
 * river behind it, and turns a mountain lake into the sea — which is the exact
 * failure the old "over ~1.5km² it is the sea" rule made in a different way.
 *
 * ── AND WHY ZERO IS NOT ENOUGH ON ITS OWN ──
 *
 * Measured, and it corrects the premise this file was written on. The cell's
 * cover route fills a tile with `new Uint8Array(...)` — zero — and leaves a
 * pixel at zero wherever no WorldCover source file covers it. ESA ships tiles
 * for LAND ONLY, so zero means "outside any source", which is deep ocean far
 * from any coast. Near a coast the source file exists, covers the sea, and
 * classifies it as class 80 like any other water.
 *
 * So off Big Sur: 31,723 class-80 pixels, and ZERO seeds. The flood never
 * started. Zero is still the most certain ocean signal there is and is still
 * seeded first — it just is not the only one, because the game is almost never
 * far enough offshore to see it.
 *
 * The second seed is the tile EDGE. The sea leaves the tile; a lake does not.
 * A class-80 pixel on the boundary, sitting at the datum, is connected to
 * something bigger than this tile, and that is the best available local
 * evidence for "sea" without a planet-wide connectivity graph.
 *
 * Then the gates. A pixel joins if it is class 80 AND its elevation is within
 * tolerance of the datum — unbounded within that surface, because the sea IS a
 * surface at one height and there is no reason to stop crossing it. Where
 * elevation has not arrived the height gate cannot run, and the bounded step
 * count takes over instead. A tidal river mouth passes for a few hundred metres
 * and then fails on height, which is correct: the water is still there, it is
 * simply a river rather than the sea.
 *
 * Nothing here imports THREE or touches the DOM. It is a grid in and a grid
 * out, which is why it costs a third of a second to test rather than five
 * minutes in a browser.
 */

/** WorldCover's water class. Land classes are all non-zero; see the note above
 *  on why zero is the interesting value. */
export const COVER_WATER = 80;

/** How the mask reports itself. 255 is ocean, 0 is not — the byte range is what
 *  `CoverageGrid` wants and what uploads as a texture without conversion. */
export interface MaskGrid {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface MaskStats {
  /** Pixels that were raw zero — outside any WorldCover source, so open ocean
   *  with no argument. Near a coast this is legitimately zero; see the note. */
  seeds: number;
  /** Class-80 pixels on the tile boundary, at the datum, taken as connected to
   *  something larger than this tile. */
  edgeSeeds: number;
  /** Class-80 pixels the bounded flood absorbed. */
  bridged: number;
  /** Pixels the coastline barrier stood in the way of. Zero on a tile with no
   *  coastline in it, which is most of them. */
  walled: number;
  /** Pixels refused because the coastline puts them on the LAND side. This is
   *  the count that closes the IJsselmeer case. */
  landward: number;
  /** Refused pixels absorbed after the flood because the sea surrounded
   *  them: an isolated high DEM sample inside confirmed ocean is measurement
   *  noise, not an island. Only class-80 pixels with three of four ocean
   *  neighbours heal, and never across a barrier, a landward verdict or the
   *  coastline's side. */
  healed: number;
  /** Class-80 pixels that did NOT join the ocean, on distance or on height.
   *  A count of pixels, not of rejections — see the note at the height gate.
   *  Worth reporting: a tile where this is large and `bridged` is small is a
   *  tile full of inland water, which is a different world from a coastline. */
  refused: number;
  ocean: number;
  total: number;
}

export interface MaskOptions {
  /** Absolute elevation of the sea surface. */
  datumM: number;
  /** How far from the datum a class-80 pixel may sit and still be absorbed.
   *  Three metres by default: enough for tide, swell and DEM noise, far short
   *  of the height of any real lake above its coast. */
  tolM?: number;
  /** How many pixels the flood may travel where ELEVATION IS UNKNOWN. With
   *  heights the datum gate does the work and there is no step limit, because
   *  the sea is a surface at one height and there is no reason to stop crossing
   *  it. Without them this is all there is. */
  bridgePx?: number;
  /** Seed from class-80 water on the tile boundary that sits at the datum.
   *  The sea leaves the tile; a lake does not. Off by default so the unit
   *  cases can pose the zero-seed question on its own. */
  seedEdge?: boolean;
  /** Absolute elevation per pixel, same dimensions as the cover grid. Omitted
   *  where terrain has not arrived — then the height gate cannot be applied and
   *  the flood falls back to distance alone. */
  elevation?: Float32Array;
  /**
   * ── THE COASTLINE, AS A WALL ──
   *
   * Non-zero where an OSM `natural=coastline` way crosses this pixel. The flood
   * will not enter one, exactly as it will not enter land.
   *
   * This needs none of OSM's left-of-the-way-is-land convention, and that is
   * the point: it is pure topology. Land already stops the flood, so a barrier
   * only changes an answer where there is WATER ON BOTH SIDES of it — which is
   * precisely and only the case the height gate cannot reach: a large body at
   * the datum, reaching the tile edge, separated from the sea by a dyke. The
   * IJsselmeer behind the Afsluitdijk is the canonical one, and OSM's coastline
   * runs along the dyke, so the barrier falls exactly where it must.
   */
  barrier?: Uint8Array;
  /**
   * ── WHICH SIDE OF THE COASTLINE THIS PIXEL IS ON ──
   *
   * 1 where the nearest OSM coastline says LANDWARD, 0 where seaward or where
   * no coastline is near enough to say. This is the mechanism the barrier is
   * not: OSM winds a coastline with land on the LEFT, so for a directed segment
   * the side of a point is a cross-product sign, decided locally with no global
   * topology at all.
   *
   * A wall stops the flood CROSSING a dyke. It cannot stop the far side being
   * seeded directly, which is what happens when the inland body also reaches
   * the tile boundary — measured, and the reason the IJsselmeer case survived
   * the barrier. The side test is what closes it, because it disqualifies the
   * seed rather than the path.
   *
   * Only meaningful where the caller bothered to compute it. Boundary pixels
   * are enough: that is where seeds come from, and it is ~1000 nearest-segment
   * queries per tile rather than 65,536.
   */
  landward?: Uint8Array;
  /**
   * ── THE SEA CONTINUES FROM WHERE IT IS ALREADY ESTABLISHED ──
   *
   * Boundary pixels whose abutting pixel in the ADJACENT tile's mask is
   * ocean. A wholly-offshore cover tile has no seeds of its own — ESA
   * classifies near-coast sea as class 80, terrain never streams that far
   * out, and an unknown pixel may not seed — so entire tiles of open sea
   * rendered as nothing, in tile-shaped holes. Measured off Big Sur:
   * 65,536 class-80 pixels, all unknown, all refused, zero ocean, twice.
   *
   * Cross-border adjacency is the same evidence as in-tile travel: this
   * pixel is class 80 and CONNECTED to established sea. So these seed even
   * where elevation is unknown. Barrier and landward still bind.
   */
  neighbourOcean?: Uint8Array;
  /**
   * ── WITHIN A CLIFF'S BLUR, THE COASTLINE OUTRANKS THE DEM ──
   *
   * Class-80 pixels within a cover pixel or two of an OSM coastline, on the
   * SEA side of it. A 31m coastal pixel that is mostly water still samples
   * its elevation from ground contaminated by the cliff standing in the same
   * pixel, reads +5..20m, fails the datum gate, and pulls the waterline
   * seaward of the mapped coast. OSM's winding says which side is the sea
   * with none of that contamination, so for these pixels the height gate is
   * WAIVED — connectivity still decides, they just may not be refused on a
   * height the cliff wrote.
   */
  nearCoastSea?: Uint8Array;
  /**
   * ── THE COASTLINE AS A LINE, NOT A REGION ──
   *
   * Signed side of the nearest coast segment, for pixels near one: +1
   * seaward, -1 landward, 0 far or unsaid. Supersedes barrier+nearCoastSea
   * where present, and fixes what the barrier band did wrong: rasterising
   * the wall as "pixels within a cover pixel of the line" made a ~62m dead
   * strip hugging every coast — measured at Big Sur as the sea detaching
   * from the mapped shore the moment the coastline streamed in, at datum
   * elevation the whole way. A wall has no width. With this array the flood
   * refuses a LANDWARD pixel (water behind the coast is not the sea), blocks
   * a step whose two ends sit on OPPOSITE sides (that step crosses the
   * line — the dyke case), and waives the height gate on the SEAWARD side
   * (the cliff-bleed case) — but seaward water right up to the line is sea.
   */
  coastSide?: Int8Array;
}

const DEFAULTS = { tolM: 3, bridgePx: 4 };

/**
 * The mask for one loaded cover tile.
 *
 * `cover` is the raw class per pixel INCLUDING zero — the caller must not have
 * passed it through anything that collapses zero to null, which is the whole
 * point. Every pixel of a loaded tile has a value; "unknown" is a property of a
 * tile that has not arrived, and is expressed by not calling this at all.
 */
export function buildOceanMask(
  cover: Uint8Array,
  width: number,
  height: number,
  options: MaskOptions,
): { grid: MaskGrid; stats: MaskStats } {
  const tolM = options.tolM ?? DEFAULTS.tolM;
  const bridgePx = Math.max(0, Math.floor(options.bridgePx ?? DEFAULTS.bridgePx));
  const elev = options.elevation;
  const bar = options.barrier;
  const land = options.landward;
  const neigh = options.neighbourOcean;
  const nearSea = options.nearCoastSea;
  const side = options.coastSide;
  const n = width * height;
  const data = new Uint8Array(n);
  const stats: MaskStats = { seeds: 0, edgeSeeds: 0, bridged: 0, walled: 0, landward: 0, healed: 0, refused: 0, ocean: 0, total: n };

  // ── PASS 1: the seeds, which need no argument at all ──
  // A queue of indices with the step count they were reached at, walked
  // breadth-first so `bridgePx` is a true radius rather than whatever the scan
  // order happened to allow.
  const queue = new Int32Array(n);
  const step = new Uint8Array(n);
  let head = 0, tail = 0;
  const atDatum = (i: number): boolean => !elev || Math.abs(elev[i] - options.datumM) <= tolM;
  for (let i = 0; i < n; i++) {
    if (cover[i] !== 0) continue;
    data[i] = 255;
    stats.seeds++;
    queue[tail++] = i;
  }
  if (options.seedEdge) {
    for (let i = 0; i < n; i++) {
      if (data[i] || cover[i] !== COVER_WATER) continue;
      if (bar && bar[i]) continue;              // an edge ON the coastline is not a seed
      if (land && land[i]) { stats.landward++; continue; }   // …nor one behind it
      if (side && side[i] === -1) { stats.landward++; continue; }
      const x = i % width, y = (i / width) | 0;
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue;
      // A neighbour's established ocean seeds across the border regardless of
      // the datum gate; the coastline waivers relax it; otherwise the gate
      // stands exactly as before.
      const waived = (nearSea && nearSea[i]) || (side && side[i] === 1);
      if (!(neigh && neigh[i]) && !waived && !atDatum(i)) continue;
      data[i] = 255;
      stats.edgeSeeds++;
      queue[tail++] = i;
    }
  }

  // ── PASS 2: the bounded bridge through coastal class-80 ──
  while (head < tail) {
    const i = queue[head++];
    const d = step[i];
    // The step budget only binds where there is no elevation to judge by.
    if (!elev && d >= bridgePx) continue;
    const x = i % width, y = (i / width) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (data[j]) continue;                       // already ocean
      if (cover[j] !== COVER_WATER) continue;      // land stops the flood dead
      if (bar && bar[j]) { stats.walled++; continue; }   // …and so does a coastline
      if (land && land[j]) { stats.landward++; continue; }
      if (side) {
        // Water behind the coastline is not the sea, however it connects.
        if (side[j] === -1) { stats.landward++; continue; }
        // A step whose ends sit on opposite sides crosses the line itself —
        // the dyke narrower than a pixel. The wall has no width otherwise.
        if (side[i] !== 0 && side[j] !== 0 && side[i] !== side[j]) { stats.walled++; continue; }
      }
      // ── UNKNOWN MAY TRAVEL, BUT MAY NOT SEED ──
      //
      // A pixel with no elevation is not a pixel at the datum, and admitting
      // it as though it were floods every low valley the DEM has not reached.
      // But refusing it outright is just as wrong in the other direction, and
      // worse to look at: cover tiles are 8km and terrain streams a couple of
      // kilometres around the truck, so MOST of the sea has no height under it
      // and never will. Measured at Noordhoek: 306,773 class-80 pixels unjudged
      // across nine masks, seven of them reporting no ocean at all — the sea
      // truncated at the edge of the loaded terrain, in tile-shaped rectangles.
      // Reported from the seat as a coast seriously out of sync with the land.
      //
      // The distinction that resolves it is between SEEDING and TRAVELLING.
      // Starting the flood needs positive evidence — raw zero, or class 80 on
      // the boundary measured at the datum — and an unknown pixel has none, so
      // `atDatum` fails it there and the inland pool stays a pool. Continuing
      // the flood is a different claim: this pixel is class 80 AND connected to
      // water already established as sea. That connection is the evidence, and
      // it is exactly what carries the ocean out past the last loaded tile.
      //
      // The coastline still binds: an unknown pixel behind a dyke is stopped by
      // the barrier, and one on the landward side is refused above.
      const known = !elev || Number.isFinite(elev[j]);
      const waived = (nearSea && nearSea[j]) || (side && side[j] === 1);
      if (!waived && known && !atDatum(j)) continue;
      // THE HEIGHT GATE, for pixels that HAVE a height. A tidal river mouth
      // passes the distance test for a few pixels and then fails here, which is
      // right: the water is still water, it is simply not the sea.
      // NOT counted as refused here. A pixel can be reached from several
      // neighbours and rejected each time, and an in-flood tally therefore
      // depends on scan order and can exceed the number of pixels that exist —
      // measured at 12 refusals in a grid holding 8 water pixels. The sweep
      // below counts the answer instead of the attempts.
      data[j] = 255;
      step[j] = d + 1;
      stats.bridged++;
      queue[tail++] = j;
    }
  }

  // ── HEAL THE PINPRICKS ──
  // A refused pixel with three of four neighbours ocean is not an island;
  // it is one noisy DEM sample punching a hole in confirmed sea. Two passes
  // close pairs. The guards keep every deliberate refusal deliberate: land,
  // barriers, the coastline's landward side.
  for (let pass = 0; pass < 2; pass++) {
    let healedThisPass = 0;
    for (let i = 0; i < n; i++) {
      if (data[i] || cover[i] !== COVER_WATER) continue;
      if (bar && bar[i]) continue;
      if (land && land[i]) continue;
      if (side && side[i] === -1) continue;
      const x = i % width, y = (i / width) | 0;
      let wet = 0;
      if (x > 0 && data[i - 1]) wet++;
      if (x < width - 1 && data[i + 1]) wet++;
      if (y > 0 && data[i - width]) wet++;
      if (y < height - 1 && data[i + width]) wet++;
      if (wet >= 3) { data[i] = 255; healedThisPass++; }
    }
    stats.healed += healedThisPass;
    if (!healedThisPass) break;
  }

  // Class-80 that never joined: reported so a caller can tell a coast from a
  // lake district without re-walking the grid.
  for (let i = 0; i < n; i++) {
    if (cover[i] === COVER_WATER && !data[i]) stats.refused++;
    if (data[i]) stats.ocean++;
  }
  return { grid: { width, height, data }, stats };
}

/**
 * Sample a mask at a fractional position within its tile, nearest-neighbour.
 *
 * Nearest, not bilinear, and deliberately: this is a CLASSIFICATION. Half-ocean
 * is not a meaningful answer to "may the truck drive here", and interpolating
 * one produces a band of ambiguous ground around every coast where the picture
 * and the physics can disagree. Coverage for RENDERING is a different question
 * and the hydro field answers it with a signed distance, which is continuous
 * because it is a distance rather than a class.
 */
export function maskAt(grid: MaskGrid, u: number, v: number): boolean {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  const x = Math.min(grid.width - 1, (u * grid.width) | 0);
  const y = Math.min(grid.height - 1, (v * grid.height) | 0);
  return grid.data[y * grid.width + x] !== 0;
}
