/**
 * ── WHAT HAPPENS TO A HEIGHT TILE BETWEEN THE DECODE AND THE GROUND ──
 *
 * Extracted from main.ts so that anything reading the same DEM reads it the
 * same way. That is not tidiness: `devtools/capture-world.mjs` takes the raw
 * terrarium pixel, and a raw terrarium pixel is not what the game builds.
 *
 * Measured on the Cape Town capture that prompted this — a junction at
 * -33.94533, 18.38296, which is flat suburb 10 to 100m above the sea. The
 * capture reported ground running **-7,049m to 399m**. The tile is not
 * catastrophically broken: 65,476 of its 65,536 pixels are sane, and the few
 * dozen that are not scatter from -5,600m upward, a handful per hundred
 * metres. That is 0.5% — comfortably under the 2% the game refuses at — so the
 * live game ACCEPTS this tile, patches those pixels to its own ground and
 * builds perfectly ordinary suburb. The capture kept them, and would have put
 * five-kilometre shafts under a road whose whole purpose was to show how a
 * junction meets a slope.
 *
 * A fixture that reproduces a defect the game does not have is worse than no
 * fixture: it is a defect report with a fabricated witness. So the capture runs
 * this, and this is the shipping code — main.ts imports these four functions
 * rather than keeping its own copy of them.
 *
 * The order matters and is the game's: count out-of-range, count spikes, refuse
 * the tile if either is over its threshold, patch what is left, then repair by
 * shape. `demBad` and `demSpikes` are separated from the patch because the
 * counts decide REFUSAL — a tile can be too bad to build at all, and returning
 * null there is strictly better than building a mountain range out of a decode
 * error. Terrain that has not arrived is a gap you can see; terrain built from
 * nonsense is a gap you drive into.
 *
 * ── AND THE COUNTS COME FIRST FOR A REASON ──
 *
 * `repairDem` is a SHAPE argument, and it deliberately stands down when it
 * would rewrite more than a fifth of the tile, on the reasoning that a rule
 * rewriting that much is likelier to be misfiring than right. That is sound for
 * the corruption it was written against — a few hundred stray pixels — and
 * exactly backwards for the catastrophic case: THE WORSE THE TILE, THE LESS
 * LIKELY IT IS TO BE TOUCHED. A tile that is mostly garbage sails through
 * unrepaired and gets built into terrain, which is what a field of spikes is.
 * So the two absolute tests stand in front of it, and neither needs a shape
 * heuristic to make its case.
 */

/**
 * ── THE DEM LIES, SOMETIMES ──
 *
 * The terrarium mosaic is not maintained and carries local corruption. Central
 * Reykjavik is the case that found this: a smooth 918m cone sitting in the
 * middle of the harbour, where Copernicus reads 0m — measured, not guessed.
 * Downtown Manhattan carries a -742m void, Hong Kong -7006m. Rendered, these
 * are the black spires and the bottomless pits.
 *
 * Nothing about the repair knows any geography. It rests on one fact about
 * LAND: a hill of height H has a footprint. Even a volcanic plug or a sea
 * cliff does not climb H metres within H/1.7 metres of run and then close back
 * on itself, and if it did it would run off the side of a 1km tile rather than
 * standing alone in the middle of one. So a blob is corrupt when BOTH:
 *
 *   · it is far too narrow for its height (radius < 0.6 of what the slope
 *     limit demands), and
 *   · it dwarfs the tile it sits in (more than 3x the tile's own relief) —
 *     which is what keeps a real summit inside a mountain range safe, since
 *     there the relief is already large.
 *
 * Validated against 28 of the hardest real landforms on Earth — Half Dome, El
 * Capitan, Devils Tower, Uluru (including tiles clipping only its edge),
 * Matterhorn, Cerro Torre, Meteora, Preikestolen, Gibraltar, Monument Valley,
 * the Grand Canyon, Cliffs of Moher, Death Valley: ZERO pixels touched on all
 * 28, while every known-bad tile comes back to a sane range.
 */
export const DEM_RISE = 80;     // metres clear of the ground before a blob is even considered
export const DEM_SLOPE = 1.7;   // ~60°, the steepest slope a real landform sustains
export const DEM_RATIO = 0.6;   // how much narrower than that it must be to be called a lie
export const DEM_DWARF = 3;     // and how far it must tower over everything else around
/** The ceiling is the summit of Everest with room to spare; the floor is the
 *  caller's, because it is not the same number at every zoom. See `demFloor`. */
export const DEM_ROOF = 9000;

/**
 * ── THE FLOOR IS SEA LEVEL ONLY WHERE THE WHEELS ARE ──
 *
 * -500 says "land, near enough", and it is right for the fine layer: a z14 tile
 * is 2km of ground the truck drives on, and a reading below the Dead Sea there
 * is a decode error. It is wrong for the SHELL, whose tiles are tens to
 * hundreds of kilometres across and routinely mostly ocean — and AWS terrarium
 * carries real bathymetry, so a z7 tile off the Cape measures 10.1% of its
 * pixels below -500m, bottoming at -3,348m. All of that is the Atlantic, and
 * the tile was refused for containing it.
 *
 * The symptom was silent and total: at the ceiling the shell selected z7,
 * fetched its DEM, and stood at ZERO tiles — every coarse tile refused,
 * re-asked on the next pass, and refused again.
 *
 * So the coarse floor is Challenger Deep instead. The guard keeps its teeth
 * where it matters: -13,029m, the value this source is documented as serving at
 * Chapman's Peak, is still below the deepest water on Earth and still refused.
 */
export const demFloor = (z: number, fineZ: number): number => (z >= fineZ ? -500 : -11000);

/** How many pixels are not readings at all. Over 2% and the tile is refused. */
export function demBad(e: Float32Array, floor: number): number {
  let bad = 0;
  for (let i = 0; i < e.length; i++) {
    const v = e[i];
    if (!Number.isFinite(v) || v < floor || v > DEM_ROOF) bad++;
  }
  return bad;
}

/**
 * ── …AND THE RANGE TEST IS THE EASY HALF ──
 *
 * A terrarium height is R*256 + G + B/256 - 32768, so a byte that lands in the
 * wrong channel moves the ground by 256 METRES and stays comfortably inside the
 * range of a real planet. That is a spike `demBad` cannot see, and it is the
 * size of the ones reported from the seat.
 *
 * What gives it away is not its height but its NEIGHBOURS. Real ground is
 * continuous at 10-30m sampling: even a sea cliff climbs a few tens of metres
 * between adjacent posts, and the pixels that do are a contiguous line, never
 * scattered. A post standing a hundred metres off the four around it is not a
 * landform, it is a bad byte.
 *
 * Deliberately NOT a repair, and deliberately without `repairDem`'s stand-down:
 * this only decides whether the tile is TRUSTWORTHY, so the more of it is wrong
 * the more certain the answer gets, which is the right way round for the case
 * that has been getting through. Over 3% and the tile is refused.
 */
export function demSpikes(e: Float32Array, mpp: number, w = 256): number {
  const th = Math.max(80, 12 * mpp);
  let spikes = 0;
  for (let y = 1; y < w - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const n = (e[i - 1] + e[i + 1] + e[i - w] + e[i + w]) * 0.25;
      if (Math.abs(e[i] - n) > th) spikes++;
    }
  }
  return spikes;
}

/**
 * Patch the few pixels that are not readings, IN PLACE, to the tile's own
 * ground — not to zero. A patch at sea level in a mountain valley is its own
 * crater. THE SAME FLOOR the refusal used, or a coarse tile that legitimately
 * passed with bathymetry in it would have every metre of that bathymetry
 * patched up to land level: the seabed rising through the sea plane across a
 * whole ocean, which is a worse picture than the one the guard exists to
 * prevent.
 */
export function demPatch(e: Float32Array, floor: number): void {
  const ok = Array.from(e).filter((v) => Number.isFinite(v) && v >= floor && v <= DEM_ROOF).sort((a, b) => a - b);
  const ground = ok.length ? ok[Math.floor(ok.length * 0.2)] : 0;
  for (let i = 0; i < e.length; i++) {
    const v = e[i];
    if (!Number.isFinite(v) || v < floor || v > DEM_ROOF) e[i] = ground;
  }
}

/** Where a repair happened, for the probe that asks what the DEM cost. */
export type DemNote = (what: string, n: number) => void;

export function repairDem(e: Float32Array, mpp: number, note?: DemNote): Float32Array {
  const W = 256;
  const s = Float32Array.from(e).sort();
  const at = (f: number): number => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  const ground = at(0.2);
  const relief = Math.max(30, at(0.95) - ground);
  const flag = new Uint8Array(e.length);
  const seen = new Uint8Array(e.length);
  const stack = new Int32Array(e.length);
  const cells = new Int32Array(e.length);
  let flagged = 0;
  for (const dir of [1, -1]) {
    // A pit is ground missing from below the GROUND, not below the roof —
    // basing it on a high percentile made every low-lying city one crater.
    const base = dir > 0 ? ground : at(0.05);
    seen.fill(0);
    for (let st = 0; st < e.length; st++) {
      if (seen[st] || (e[st] - base) * dir <= DEM_RISE) continue;
      let sp = 0, nc = 0, peak = 0;
      stack[sp++] = st; seen[st] = 1;
      while (sp) {
        const i = stack[--sp];
        cells[nc++] = i;
        const h = (e[i] - base) * dir;
        if (h > peak) peak = h;
        const x = i % W, y = (i / W) | 0;
        if (x > 0) { const j = i - 1; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (x < W - 1) { const j = i + 1; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (y > 0) { const j = i - W; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (y < W - 1) { const j = i + W; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
      }
      if (peak <= DEM_DWARF * relief) continue;
      if (Math.sqrt(nc / Math.PI) / (peak / (DEM_SLOPE * mpp)) >= DEM_RATIO) continue;
      for (let k = 0; k < nc; k++) { flag[cells[k]] = 1; flagged++; }
    }
  }
  // A "repair" that rewrites a fifth of the tile is far likelier to be this
  // rule misfiring than real corruption. Leave the tile exactly as it came.
  if (!flagged || flagged > e.length * 0.2) return e;
  // Diffuse the surviving ground into the holes, so what is left is the land
  // the blob was standing on rather than a flat plate.
  const out = Float32Array.from(e);
  let left = flagged;
  const next = new Uint8Array(e.length);
  for (let pass = 0; pass < 300 && left; pass++) {
    next.set(flag);
    for (let i = 0; i < e.length; i++) {
      if (!flag[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let sum = 0, n = 0;
      if (x > 0 && !flag[i - 1]) { sum += out[i - 1]; n++; }
      if (x < W - 1 && !flag[i + 1]) { sum += out[i + 1]; n++; }
      if (y > 0 && !flag[i - W]) { sum += out[i - W]; n++; }
      if (y < W - 1 && !flag[i + W]) { sum += out[i + W]; n++; }
      if (n) { out[i] = sum / n; next[i] = 0; left--; }
    }
    flag.set(next);
  }
  for (let i = 0; i < e.length; i++) if (flag[i]) out[i] = ground;
  note?.(`${flagged}px`, flagged);
  return out;
}
