/**
 * THE CLIMATE FIELD, out of the browser.
 *
 * What makes one place different from another: temperature from latitude and
 * height, moisture from what grows nearby, and a treeline that says where the
 * forest stops. It decides the ground ramp, the species mixes, the bedrock,
 * the flowers and the fauna.
 *
 * IT LIVES HERE FOR THE REASON `roadsolve.ts` DOES, and the bill for leaving
 * it in the renderer was paid in full before this file existed: the first cut
 * sampled the field every 256m, which oversamples a quantity that varies over
 * tens of kilometres by two orders of magnitude. The far shell — 256×256
 * vertices over a hundred kilometres — then wanted some 150,000 cached corners
 * against a cache capped at six thousand, and thrashed. It presented as a
 * 120-second boot timeout with no page error, because a hot loop looks like
 * nothing at all from outside, and it cost an afternoon and three wrong
 * hypotheses. Every fact needed to predict it is arithmetic: a span, a
 * spacing, a cap. None of it needed a WebGL context. `corners()` below asserts
 * exactly that, in a millisecond, forever.
 *
 * Nothing here imports three, touches the DOM or reads a global. What it needs
 * from the world arrives as `ClimateEnv` — cover and terrain samplers that a
 * test supplies from a stub and the game supplies from live tiles.
 */

/** The five archetypes, in the order every weight vector uses. */
export const BIOME_ORDER = ['arid', 'tropical', 'temperate', 'boreal', 'alpine'] as const;
export type BiomeName = typeof BIOME_ORDER[number];
export const ALPINE = 4;

/** Metres between sampled corners. See the note at the head of this file: at
 *  256 this hung the boot. Climate does not vary meaningfully inside 2km, and
 *  bilinear interpolation across that lattice is smoother than the field. */
export const CLIM_G = 2048;
/** Cache ceiling. MUST exceed the working set of the largest consumer — the
 *  far shell — or it is not a cap but a thrash. See `corners()`. */
export const CLIM_CACHE_MAX = 20000;

/**
 * Where each archetype sits in (normalised temperature, moisture, amplitude).
 * Arid and tropical share a temperature and are told apart by water alone,
 * which is why moisture is weighted as heavily as heat.
 *
 * ── WHY ARID HAS TWO HOMES ──
 *
 * It had one, at hot-and-dry, which quietly asserted that dryness is a
 * property of hot places. It is not. The Great Basin, the Gobi, the Patagonian
 * steppe and the Colorado Plateau are all deserts that freeze, and with a
 * single hot home NONE of them could be expressed at any moisture: at a
 * normalised temperature of 0.36 the hot home's own Gaussian has already
 * fallen to 0.06, so the field had to answer boreal or alpine however dry the
 * ground was. A whole class of real landscape was unreachable.
 *
 * So an archetype may claim several homes and takes the BEST of them. The
 * amplitude on the cold-arid home is 0.9 rather than 1.0 because cold desert
 * is genuinely rarer than the temperate and boreal it now competes with, and
 * it should win where it is right without winning ties.
 */
export const CLIM_HOMES: Array<Array<[number, number, number]>> = [
  [[0.85, 0.12, 1.0],   // arid      — hot, dry
   [0.40, 0.08, 0.9]],  //           — …and cold, dry: steppe and cold desert
  [[0.88, 0.80, 1.0]],  // tropical  — hot, wet
  [[0.55, 0.55, 1.0]],  // temperate — mild, middling
  [[0.28, 0.50, 1.0]],  // boreal    — cold, middling
  // Amplitude 0.75, and deliberately: alpine's identity comes from being ABOVE
  // THE TREES, which applyTreeline supplies at up to 3.2x. Its home in the
  // temperature/moisture plane is a placeholder — the note on applyTreeline
  // says as much — and at full amplitude that placeholder was winning cold dry
  // LOWLANDS off the new cold-desert home, which is the one thing alpine
  // should never be. Weak here, decisive where the trees stop.
  [[0.20, 0.40, 0.75]], // alpine    — cold, and mostly a matter of height
];
/** The primary home of each archetype, kept for anything that wants one
 *  representative point rather than the set. */
export const CLIM_HOME: Array<[number, number]> =
  CLIM_HOMES.map((h) => [h[0][0], h[0][1]] as [number, number]);
/** How much water each land-cover class implies. `built` and `snow` are absent
 *  DELIBERATELY and abstain from the average: a car park says nothing about
 *  rainfall, and frozen is not dry. */
export const MOIST_OF: Record<number, number> = {
  10: 0.75,   // tree
  20: 0.28,   // shrub
  30: 0.45,   // grass
  40: 0.60,   // crop
  60: 0.08,   // bare
  80: 1.00,   // water
  90: 1.00,   // wetland
  95: 1.00,   // mangrove
  100: 0.50,  // moss
};

/**
 * Metres of elevation above which trees stop.
 *
 * Fits the Alps (46° → 2307m against a real ~2200) and Scandinavia (62° →
 * 924m against ~900), and reaches zero near 70°. It UNDER-reads continental
 * interiors — the Rockies at 40° run some 800m above this — and that residual
 * is honest rather than a bug: it is the moisture axis, from which this curve
 * does not yet take a term.
 */
export const treelineAt = (latAbs: number, moisture = 0.5): number => {
  // THE MOISTURE TERM THE COMMENT ABOVE HAS BEEN PROMISING. A dry continental
  // interior carries its treeline far higher than a maritime one at the same
  // latitude — the Rockies at 40° run some 800m above the pure-latitude curve,
  // and that residual has been sitting in this file as an acknowledged miss.
  // Dryness raises the line because what stops trees up there is desiccating
  // wind and a short growing season, not cold alone; a wet oceanic slope at
  // the same height is cloud forest to well below its theoretical limit.
  //
  // 1400m across the full moisture range, referenced to the middling 0.5 the
  // old curve implicitly assumed — so a caller that does not know the moisture
  // gets exactly the curve that was there before.
  const dry = (0.5 - moisture) * 1400;
  return Math.max(0, 4000 - 0.8 * latAbs * latAbs + dry);
};

/** Sea-level mean temperature, as a quadratic in latitude: 27°C at the
 *  equator, 13 at 45°, 2.5 at 60°, below freezing past 63. Far closer to the
 *  real profile than the linear latitude bands this replaced. */
export const seaTempAt = (latAbs: number): number => 27 - 0.0068 * latAbs * latAbs;
/** Standard atmospheric lapse, °C per metre. */
export const LAPSE = 0.0065;

export interface ClimateEnv {
  /** Land-cover class, or null where the raster has not reached. */
  coverAt(x: number, z: number): number | null;
  /** Absolute latitude in degrees. */
  latAbsAt(x: number, z: number): number;
  /** Ground height in metres, absolute. May throw before terrain exists —
   *  callers here tolerate that, see climCompute. */
  groundAt(x: number, z: number): number;
}

export interface ClimateSample {
  /** Weights over BIOME_ORDER after the treeline boost. What consumers read. */
  w: number[];
  /** The same weights BEFORE the boost: the pure temperature/moisture
   *  assignment. Kept because altitude varies far faster than climate, so the
   *  boost is re-applied per point rather than interpolated off the lattice. */
  w0: number[];
  domIdx: number;
  tempC: number;
  moisture: number;
  treeline: number;
  elevAbs: number;
  /** Did cover answer here? An entry with evidence is final; one without is
   *  provisional and recomputed when new cover lands. */
  hadCover: boolean;
  stamp: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Cover samples per corner: 5×5 at 400m, so ~1.6km — matched to CLIM_G, so a
 *  corner characterises the cell it stands for rather than one spot inside. */
/** Classes that only occur where there is water to spare. */
const WET_SIGNS = new Set([10, 40, 80, 90, 95]);   // tree, crop, water, wetland, mangrove
/** Classes that occur where there is not. */
const DRY_SIGNS = new Set([20, 60]);               // shrub, bare

export function moistureAt(env: ClimateEnv, x: number, z: number): number {
  let sum = 0, n = 0, wet = 0, dry = 0;
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const cv = env.coverAt(x + i * 400, z + j * 400);
    if (cv === null) continue;
    const m = MOIST_OF[cv];
    if (m === undefined) continue;          // built and snow abstain
    sum += m; n++;
    if (WET_SIGNS.has(cv)) wet++;
    else if (DRY_SIGNS.has(cv)) dry++;
  }
  if (!n) return 0.5;                       // no evidence: assume unremarkable
  const mean = sum / n;
  // ── ARIDITY FROM ABSENCE ──
  //
  // The mean alone reads steppe and wet meadow identically, because both are
  // mostly grass and grass is one number. What actually separates them is what
  // is NOT there: over 1.6km of temperate grassland you cross a hedgerow, a
  // pond, a copse. Over 1.6km of the Great Basin you cross none of those, and
  // that absence is evidence the average throws away — measured there at 0.43,
  // wet enough that the cold-desert archetype could not win however correct it
  // was. Wet signs count triple, because ONE pond in twenty-five samples is
  // enough to say this is not a desert.
  const aridity = Math.max(0, Math.min(1, dry / n - (wet / n) * 3));
  return mean * (1 - 0.55 * aridity);
}

/**
 * ALPINE IS A HEIGHT, NOT A TEMPERATURE. It sits close enough to boreal in the
 * temperature/moisture plane that the soft assignment can never separate them;
 * what distinguishes it is being ABOVE THE TREES. Taking its weight from the
 * treeline directly is what retires `elevAbs > 1500` — a rule that called the
 * Ethiopian highlands alpine and the Norwegian fjells forest.
 *
 * Applied PER POINT, never baked into the lattice: a corner speaks for four
 * square kilometres while altitude changes over a hundred metres of mountain
 * road. Measured before this split, a 2km transect up the Stelvio reported one
 * elevation and one treeline margin end to end — the whole altitude axis
 * invisible from the seat while every number looked plausible.
 */
export function applyTreeline(c: ClimateSample, elevAbs: number): void {
  c.elevAbs = elevAbs;
  const above = clamp((elevAbs - (c.treeline - 500)) / 700, 0, 1);
  const boost = above * above * (3 - 2 * above) * 3.2;
  let total = 0, dom = 0;
  for (let i = 0; i < 5; i++) { c.w[i] = c.w0[i]; total += c.w0[i]; }
  c.w[ALPINE] += boost * (total / 5);
  total += boost * (total / 5);
  for (let i = 0; i < 5; i++) { c.w[i] /= total; if (c.w[i] > c.w[dom]) dom = i; }
  c.domIdx = dom;
}

export function climCompute(env: ClimateEnv, x: number, z: number, stamp: number): ClimateSample {
  const latAbs = env.latAbsAt(x, z);
  // THE GROUND MAY NOT EXIST YET. This is asked during module load in the
  // game — critter populations roll their species before the terrain
  // subsystem is up — and the height sampler reaches through structures that
  // are still undefined then. Tolerating an absent heightfield fixes every
  // early caller at once, and costs nothing afterwards: such a corner carries
  // hadCover:false and is recomputed the moment cover lands.
  let elevAbs = 0;
  try { elevAbs = env.groundAt(x, z); } catch { /* terrain not up yet */ }
  const tempC = seaTempAt(latAbs) - LAPSE * Math.max(0, elevAbs);
  const moisture = moistureAt(env, x, z);
  const treeline = treelineAt(latAbs, moisture);
  const tempN = clamp((tempC + 10) / 40, 0, 1);
  const w: number[] = [];
  let total = 0;
  for (let i = 0; i < CLIM_HOMES.length; i++) {
    // BEST of the archetype's homes, not the sum: two homes are two distinct
    // ways of being that archetype, and a point between them is not more
    // arid than a point sitting on either one.
    let best = 0;
    for (const [ht, hm, amp] of CLIM_HOMES[i]) {
      const dt = tempN - ht, dm = moisture - hm;
      const v = amp * Math.exp(-(dt * dt * 12 + dm * dm * 10));
      if (v > best) best = v;
    }
    w.push(best); total += best;
  }
  for (let i = 0; i < w.length; i++) w[i] /= total;
  const c: ClimateSample = {
    w: w.slice(), w0: w, domIdx: 0, tempC, moisture, treeline, elevAbs,
    hadCover: env.coverAt(x, z) !== null, stamp,
  };
  applyTreeline(c, elevAbs);
  return c;
}

/**
 * How many corners a consumer of the given SPAN needs — the arithmetic that
 * would have caught the boot hang before it was written, and the reason this
 * module exists outside the renderer. A span whose corner count exceeds the
 * cache is not slow, it THRASHES: every read evicts a corner another read is
 * about to want, and twenty-five cover samples are paid again each time.
 */
export const corners = (spanM: number, g = CLIM_G): number =>
  Math.pow(Math.ceil(spanM / g) + 1, 2);

/** The cached, bilinearly-interpolated field. */
export class ClimateField {
  private cache = new Map<number, ClimateSample>();
  /** Bumped when cover lands, expiring evidence-free corners. */
  stamp = 0;
  private scratch: ClimateSample = {
    w: [0, 0, 0, 0, 0], w0: [0, 0, 0, 0, 0], domIdx: 2, tempC: 12, moisture: 0.5,
    treeline: 2000, elevAbs: 0, hadCover: false, stamp: 0,
  };
  constructor(private env: ClimateEnv) {}
  get size(): number { return this.cache.size; }
  /** New cover: every corner that had none gets one more chance. */
  noteCover(): void { this.stamp++; }
  corner(gx: number, gz: number): ClimateSample {
    const k = gx * 65536 + gz;
    const c = this.cache.get(k);
    // A corner that HAD cover is settled. One that did not is still cached —
    // it must be, or the far shell recomputes it per vertex — but only until
    // the next cover tile lands, at which point it is asked again, once.
    if (c && (c.hadCover || c.stamp === this.stamp)) return c;
    const fresh = climCompute(this.env, gx * CLIM_G, gz * CLIM_G, this.stamp);
    if (this.cache.size > CLIM_CACHE_MAX) this.cache.clear();
    this.cache.set(k, fresh);
    return fresh;
  }
  /**
   * The climate at a point. Returns a SHARED SCRATCH — read what you need and
   * do not retain it across another call; this runs per terrain vertex and per
   * sward texel, where an allocation is a collection mid-build.
   *
   * Bilinear, not nearest: a nearest-corner lookup would put a hard 2km grid
   * into the ground colour, which is the same checkerboard the sward's flower
   * patches drew when they thresholded a per-cell hash instead of a field.
   */
  at(x: number, z: number, elevAbs?: number): ClimateSample {
    const s = this.scratch;
    const fx = x / CLIM_G, fz = z / CLIM_G;
    const gx = Math.floor(fx), gz = Math.floor(fz);
    const tx = fx - gx, tz = fz - gz;
    const a = this.corner(gx, gz), b = this.corner(gx + 1, gz);
    const c = this.corner(gx, gz + 1), d = this.corner(gx + 1, gz + 1);
    const mix = (p: number, q: number, r: number, t: number): number =>
      (p * (1 - tx) + q * tx) * (1 - tz) + (r * (1 - tx) + t * tx) * tz;
    for (let i = 0; i < 5; i++) s.w0[i] = mix(a.w0[i], b.w0[i], c.w0[i], d.w0[i]);
    s.moisture = mix(a.moisture, b.moisture, c.moisture, d.moisture);
    s.treeline = mix(a.treeline, b.treeline, c.treeline, d.treeline);
    const lattice = mix(a.elevAbs, b.elevAbs, c.elevAbs, d.elevAbs);
    // THE ELEVATION IS THE CALLER'S IF IT HAS ONE. terrainPalette is handed the
    // true height of the very vertex it is colouring; using the lattice's
    // average instead throws away the one term that varies fast enough to
    // matter. Only a caller with no height of its own falls back to the corners.
    const elev = elevAbs ?? lattice;
    s.tempC = mix(a.tempC, b.tempC, c.tempC, d.tempC) + (lattice - elev) * LAPSE;
    // Provenance travels with the sample. Nothing downstream branches on it,
    // but a probe that cannot say whether it is looking at evidence or at a
    // placeholder is a probe that will one day be believed wrongly.
    s.hadCover = a.hadCover && b.hadCover && c.hadCover && d.hadCover;
    s.stamp = this.stamp;
    applyTreeline(s, elev);
    return s;
  }
}

/** Pick from a per-archetype weight table by climate: every archetype's row
 *  contributes in proportion to how much of it is present, so a margin grows
 *  both instead of flipping between them at a line. */
export function climPick<T>(table: Record<string, Array<[T, number]>>,
  w: number[], r: () => number): T | null {
  let total = 0;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (const [, wt] of row) total += wt * w[i];
  }
  if (total <= 0) return null;
  let t = r() * total;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (const [k, wt] of row) { t -= wt * w[i]; if (t <= 0) return k; }
  }
  return null;
}

/** The same, for tables whose rows are bare number arrays indexed by species
 *  (the fauna mixes). Returns the chosen index. */
export function climPickRow(table: Record<string, number[]>, w: number[], roll: number): number {
  const n = (table.temperate ?? []).length;
  const acc: number[] = new Array(n).fill(0);
  let total = 0;
  for (let i = 0; i < BIOME_ORDER.length; i++) {
    const row = table[BIOME_ORDER[i]];
    if (!row) continue;
    for (let k = 0; k < row.length && k < n; k++) { acc[k] += row[k] * w[i]; total += row[k] * w[i]; }
  }
  if (total <= 0) return 0;
  let t = roll * total;
  for (let k = 0; k < n; k++) { t -= acc[k]; if (t <= 0) return k; }
  return 0;
}

// ── ALTITUDE: THE ONE AXIS THAT PRODUCES AN ORDERED SEQUENCE ───────
//
// Most of what varies across ground varies simultaneously — climate, moisture,
// substrate are all just true at once. Altitude is the exception: it produces
// bands in a fixed order, each a different thing to draw rather than a thinner
// version of the last, which is what makes it worth naming precisely and the
// easiest to check against places we can drive to.

export const AltBand = {
  /** Closed forest. The default everywhere below the trees. */
  Montane: 0,
  /** The upper forest, thinning — trees still win but are losing. */
  Treeline: 1,
  /** Stunted, wind-flagged conifer. The same archetype at a third the size:
   *  a deformation, not a new asset. */
  Krummholz: 2,
  /** Alpine meadow — no trunked plant stands, and the sward gets its best
   *  season of the year. */
  Meadow: 3,
  /** Rock and shard only. */
  Scree: 4,
  /** Nothing grows. */
  Snow: 5,
} as const;
export type AltBand = typeof AltBand[keyof typeof AltBand];
export const ALT_BAND_NAMES = ['montane', 'treeline', 'krummholz', 'meadow', 'scree', 'snow'];

/** Band edges as metres RELATIVE TO THE TREELINE, so they follow it from the
 *  tropics to the Arctic instead of being absolute heights that are only ever
 *  right at one latitude — which is the mistake `elevAbs > 1500` was. */
export const ALT_EDGES = [-400, 0, 250, 700, 1200];

export function altBandAt(elevEff: number, treeline: number): AltBand {
  const d = elevEff - treeline;
  for (let i = 0; i < ALT_EDGES.length; i++) if (d < ALT_EDGES[i]) return i as AltBand;
  return AltBand.Snow;
}

/**
 * HOW TALL A TRUNKED PLANT MANAGES TO BE, 1 down in the forest and 0 where
 * nothing woody stands. The middle is the point: krummholz is not a different
 * species, it is a spruce that has spent a century being sheared by wind, and
 * a shared-mesh deformation says that far better than a new archetype would.
 * Smooth, because a hard line of full-height trees stopping dead is the single
 * most obvious tell of a synthetic mountain.
 */
export function krummholz(elevEff: number, treeline: number): number {
  const d = elevEff - treeline;
  if (d <= -400) return 1;
  if (d >= 250) return 0;
  // 1 → 0.28 across the treeline band, then 0.28 → 0 through the krummholz.
  if (d <= 0) return 1 - 0.72 * ((d + 400) / 400);
  return 0.28 * (1 - d / 250);
}

/**
 * WHAT THE SWARD DOES WITH HEIGHT. Grass thins in deep forest shade, has its
 * best year in the alpine meadow just above the trees, and stops entirely on
 * scree and snow. A single multiplier over whatever the cover class already
 * asked for.
 */
export function swardLift(elevEff: number, treeline: number): number {
  const d = elevEff - treeline;
  if (d >= 1000) return 0;                       // snow and bare rock
  if (d >= 500) return 1 - (d - 500) / 500;      // scree, thinning out
  if (d >= 0) return 1.35;                       // the meadow — its best season
  if (d >= -400) return 1 + 0.35 * ((d + 400) / 400);
  return 1;
}

/**
 * ASPECT, EXPRESSED AS EFFECTIVE ELEVATION.
 *
 * A slope that faces the pole gets less sun, so it is colder and wetter and
 * holds snow: more conifer, more moss, a treeline that sits lower on it than
 * on the sunny side of the same valley. The cheapest honest way to say all of
 * that at once is to treat it as HEIGHT — a poleward face behaves like ground
 * a hundred and fifty metres higher — because every consumer already reacts
 * correctly to height. One term, and the treeline, the temperature, the
 * species mix and the sward all follow without knowing aspect exists.
 *
 * We already sample the heightfield constantly and throw the bearing away;
 * this is the whole of what it costs to keep it.
 *
 * NORTH IS -Z in this world (see `heading = atan2(dx, -dz)`), and poleward
 * flips below the equator — a Chilean south-facing slope is the shaded one.
 */
export const ASPECT_LIFT = 150;
export function aspectLift(env: ClimateEnv, x: number, z: number, lat: number, step = 12): number {
  let h0: number, hx: number, hz: number;
  try {
    h0 = env.groundAt(x, z); hx = env.groundAt(x + step, z); hz = env.groundAt(x, z + step);
  } catch { return 0; }
  const gx = (hx - h0) / step, gz = (hz - h0) / step;
  const grade = Math.hypot(gx, gz);
  if (grade < 0.05) return 0;                    // flat ground has no aspect
  // Downhill is the negated gradient; poleward is -z north of the equator.
  const pole = lat >= 0 ? -1 : 1;
  const northness = (-gz / grade) * pole;        // +1 faces the pole, -1 the sun
  // Saturate the steepness term: past about a 1:2 slope, more grade does not
  // make the face any more shaded.
  return northness * ASPECT_LIFT * Math.min(1, grade / 0.5);
}

/**
 * ══════════════════════════════════════════════════════════════════
 * THE SITE: A CONTINUOUS ENVIRONMENT, AND A LOCAL ONE UNDER IT
 * ══════════════════════════════════════════════════════════════════
 *
 * Everything above this line answers one question — which of five biomes is
 * this — and answers it from latitude, height, and a moisture read off the
 * land cover. That last part is partly circular: the vegetation is being used
 * to predict the vegetation, and where cover is coarse or absent the model has
 * nothing left to say. And five classes is a compression that puts fynbos,
 * chaparral, savanna, steppe and monsoon forest in the same box.
 *
 * This is the layer under that. It does not classify. It reports the physical
 * facts a plant actually responds to — how hot, how wet, how seasonal, how
 * hard the winter, how far above the trees, how much sun THIS slope gets and
 * how much water THIS hollow keeps — and leaves the choosing to whatever sits
 * on top. Nothing here reads the land cover, so nothing here is circular.
 *
 * ── WHY THERE IS A LOCAL HALF AT ALL ──
 *
 * `CLIM_G` is 2048 and the note on it is right: climate does not vary
 * meaningfully inside two kilometres. But half the places worth getting right
 * vary inside two hundred metres, and not because of climate — because of
 * ASPECT and DRAINAGE. A Cape ravine holds forest while the slope above it
 * holds fynbos; a coastal California gully holds redwood while the ridge beside
 * it holds chaparral. Both pairs sit in one climate cell and differ by which
 * way the ground faces and where the water goes. No refinement of the climate
 * term reaches them, at any resolution, because the climate is the same. So
 * `insolation` and `wetness` are sampled from the terrain itself, at terrain
 * resolution, and layered on top of a climate that stays coarse and cheap.
 *
 * ── WHAT THESE NUMBERS ARE, AND ARE NOT ──
 *
 * The precipitation and seasonality curves are SHAPES FITTED TO THE GENERAL
 * CIRCULATION — the wet equator under the ITCZ, the dry belts under the
 * subtropical highs, the wet mid-latitudes under the storm track — modulated
 * by distance from the sea and by what the wind had to climb to get here.
 * They are not a climatology and they are not measured. A real bioclim raster
 * (WorldClim, CHELSA) would beat them everywhere and should replace them; the
 * point of putting them behind one sampler is that doing so is a swap rather
 * than a rewrite. Until then these are checked against real places rather than
 * against themselves — see devtools/climate-fixtures.test.mjs.
 */

export interface SiteEnv extends ClimateEnv {
  /** SIGNED latitude. The hemisphere decides which way a slope faces the sun,
   *  and the existing model only ever needed the absolute value. */
  latAt(x: number, z: number): number;
  /** Metres to the nearest coastline, or null where the coast is unknown —
   *  which is not the same as far from it, and is treated as "no evidence"
   *  rather than "inland". */
  coastAt(x: number, z: number): number | null;
}

export interface SiteClimate {
  /** Mean annual air temperature at this height, °C. */
  heatC: number;
  /** The warmest and coldest months, from the annual range. */
  summerC: number;
  winterC: number;
  /** Annual temperature range in °C — the thing that separates a maritime
   *  winter from a continental one at the same mean. */
  rangeC: number;
  /** Days a year below freezing, as a proxy. What excludes palms. */
  frostDays: number;
  /** Annual precipitation, mm. */
  waterMm: number;
  /** WHEN the water arrives, which matters more than how much. 0 means evenly
   *  spread; 1 means the whole of one half-year is dry. Mediterranean climates
   *  are summer-dry and savannas are winter-dry, and that single distinction
   *  is most of what separates chaparral from monsoon forest at the same
   *  latitude and rainfall. */
  summerDry: number;
  winterDry: number;
  /** 0 at the shore, approaching 1 deep in an interior. */
  contin: number;
  /** How much the upwind terrain took out of the air before it got here. */
  rainShadow: number;
  /** Metres above (+) or below (−) the treeline. The alpine axis, signed, so
   *  a caller can ask for "just below" as easily as "above". */
  treelineDelta: number;
  /** LOCAL. How much sun this slope takes, 0 (shaded pole-facing) through 0.5
   *  (flat) to 1 (steep sun-facing). Hemisphere-aware. */
  insolation: number;
  /** LOCAL. How much water this ground keeps: 0 a shedding ridge, 1 a
   *  collecting hollow. */
  wetness: number;
  /** LOCAL. Salt: low ground close to the sea, where mangrove and dune scrub
   *  live and nothing else does. */
  salt: number;
  /** LOCAL. Wind exposure from relief — a ridge takes what a valley does not. */
  exposure: number;
  elevAbs: number;
  /** False where the coast was unknown, so a caller can tell a maritime
   *  verdict from an unevidenced one. */
  hadCoast: boolean;
}

/** How fast the sea's influence dies inland, in metres. Beyond about a
 *  thousand kilometres the air has forgotten the ocean either way. */
const CONTIN_E = 400000;
/** Metres of upwind relief that count as a full rain shadow. */
const SHADOW_FULL = 1200;
/** Where the terrain is sampled for slope and for the hollow test. The first
 *  is a hillside's scale and the second a ravine's; both are far below the
 *  climate lattice and that is the entire point. */
const SLOPE_R = 90;
const HOLLOW_R = 220;

/**
 * PREVAILING WIND, BY LATITUDE BAND — trades below 30°, westerlies to 60°,
 * polar easterlies above. Returned as a unit vector pointing UPWIND (the
 * direction the air came FROM), because that is the direction a rain shadow
 * has to look in. `x` is east and `z` is south in this world's frame.
 */
export function upwindAt(lat: number): [number, number] {
  const a = Math.abs(lat);
  // Easterly bands blow from the east; the westerly belt blows from the west.
  const east = a < 30 || a > 60;
  return [east ? 1 : -1, 0];
}

/**
 * ANNUAL PRECIPITATION FROM THE CIRCULATION, before the land touches it.
 *
 * Three terms, each a belt: the ITCZ's rain over the equator, the storm
 * track's rain in the mid-latitudes, and a background nothing is ever drier
 * than. The trough between them at 25-ish degrees is where every hot desert on
 * earth is, and it falls out of the shape rather than being written in.
 */
export function beltRainAt(lat: number): number {
  const a = Math.abs(lat);
  // THE FLOOR IS LOW BECAUSE DESERTS ARE. At 180 the model gave Tamanrasset
  // 201mm against a real 45 — four times too wet, and wet enough that nothing
  // downstream could tell a true desert from a steppe. Ninety still keeps the
  // driest place on earth off zero, which is right: even the Atacama gets
  // something, and a hard zero makes every ratio built on this divide by it.
  return 2200 * Math.exp(-((lat / 12) ** 2))
    + 900 * Math.exp(-(((a - 52) / 16) ** 2))
    + 90;
}

const norm = (v: number, lo: number, hi: number): number => clamp((v - lo) / (hi - lo), 0, 1);

/**
 * The site, from the world. Pure: every input arrives through `env`, so this
 * is testable against real coordinates without a browser, a tile server or a
 * land-cover raster — which is what makes the fixtures worth having.
 */
export function siteAt(env: SiteEnv, x: number, z: number): SiteClimate {
  const lat = env.latAt(x, z);
  const latAbs = Math.abs(lat);
  let elevAbs = 0;
  try { elevAbs = env.groundAt(x, z); } catch { /* terrain not up yet */ }
  const coastRaw = env.coastAt(x, z);
  const hadCoast = coastRaw !== null;
  // No evidence is not the same as an interior. An unknown coast is treated as
  // middling rather than dry, so a world that has not streamed its coastline
  // does not turn every biome continental for the first thirty seconds.
  const contin = hadCoast ? 1 - Math.exp(-(coastRaw as number) / CONTIN_E) : 0.45;

  // ── THE SEA MOVES THE MEAN, NOT JUST THE RANGE ──
  //
  // The first cut had continentality widen the annual range and leave the mean
  // alone, and the fixtures caught it at once: Reykjavik came out at -1.2°C
  // against a real 5.0, and Irkutsk at 5.5 against a real 1.0 — six degrees
  // wrong in one direction and four in the other, at almost the same latitude.
  // That is one missing term with a sign, not two errors. A maritime high
  // latitude is far milder than its parallel (the ocean carries heat poleward
  // and gives it up all winter); a continental one is far colder. The effect
  // grows with latitude and vanishes in the tropics, where the sea is barely
  // warmer than the land.
  const seaShift = (0.5 - contin) * 2 * Math.max(0, (latAbs - 35) * 0.22);
  const heatC0 = seaTempAt(latAbs) + seaShift - LAPSE * Math.max(0, elevAbs);
  // The annual range grows with latitude (a longer lever on the sun) and with
  // distance from the sea (nothing to hold the heat). Reykjavik and Irkutsk sit
  // within a degree of latitude of each other and thirty degrees of range
  // apart; this is that axis.
  // ── the rain shadow: what the wind had to climb ──
  const [ux, uz] = upwindAt(lat);
  let upMax = elevAbs, upMin = elevAbs;
  for (let d = 15000; d <= 40000; d += 5000) {
    try {
      const h = env.groundAt(x + ux * d, z + uz * d);
      if (h > upMax) upMax = h;
      if (h < upMin) upMin = h;
    } catch { /* off the edge of what is loaded */ }
  }
  const rainShadow = clamp((upMax - elevAbs - 300) / SHADOW_FULL, 0, 1);
  // ── AND THE INTERIOR ONLY DRIES OUT AWAY FROM THE EQUATOR ──
  //
  // The distance-from-the-sea penalty was flat, and it halved Manaus: 1261mm
  // against a real 2300, on the wettest site in the fixture set. Fourteen
  // hundred kilometres from the Atlantic is nothing to the Amazon, because the
  // ITCZ delivers there regardless and the forest recycles its own water. It
  // is everything to Central Asia. So the penalty fades toward the equator.
  const rainContin = 0.45 * clamp((latAbs - 8) / 20, 0, 1);
  // ── AND TERRAIN GIVES AS WELL AS TAKES ──
  //
  // The model could only ever SUBTRACT for mountains, and Yosemite came out at
  // 464mm against a real 900. The Sierra is wet for exactly the reason the
  // Great Basin behind it is dry: air forced up a windward slope drops its
  // water on the way. One sampling of the upwind ground answers both — the
  // highest of it is the shadow you are standing behind, the lowest is the
  // climb the air made to reach you. Ignoring the second half was keeping
  // every windward range in the world at valley rainfall.
  const orographic = clamp((elevAbs - upMin) / 1500, 0, 1);
  const waterMm = beltRainAt(lat) * (1 - rainContin * contin)
    * (1 - 0.6 * rainShadow) * (1 + 0.9 * orographic);
  // ── A DRY SKY IS A HOT ONE ──
  //
  // Tamanrasset came out at 14.5°C against a real 22. The lapse rate was doing
  // its job on a 1380m plateau and the model had nothing to say about WHY a
  // desert is hot: no cloud, no evaporation, all the sun's energy arriving as
  // heat instead of going into water. Wet places run cool for the same reason
  // in reverse. This closes about half that gap; the rest is that a heated
  // plateau does not cool at the free-air lapse rate at all, which is a deeper
  // fix than a term here and is left honest rather than tuned away.
  const heatC = heatC0 + clamp((600 - waterMm) / 600, 0, 1) * 3.5;

  // The annual range grows with latitude (a longer lever on the sun) and with
  // distance from the sea (nothing to hold the heat). Reykjavik and Irkutsk
  // sit twelve degrees of latitude apart and thirty degrees of range apart;
  // this is that axis. It reads the finished mean, so the dry-sky term above
  // carries into the summer and winter figures too.
  const rangeC = (2 + 0.62 * latAbs) * (0.3 + 0.7 * contin);
  const summerC = heatC + rangeC / 2;
  const winterC = heatC - rangeC / 2;
  // A proxy, not a count: how far the cold month sits below freezing, spread
  // over the shoulder either side of it.
  const frostDays = clamp((4 - winterC) * 18, 0, 365);

  // ── WHEN the water arrives ──
  // The subtropical high migrates poleward in summer, so its dry edge — 30 to
  // 45 degrees — is dry in summer and wet in winter. That is every
  // Mediterranean climate on earth, and it is why the Cape and California and
  // the Mediterranean itself grow structurally similar scrub on three
  // continents. The ITCZ migrates the same way, so its dry edge — 5 to 20
  // degrees — is the opposite: wet summers, dry winters, which is savanna and
  // monsoon. West coasts feel both more sharply than interiors do.
  const marine = 1 - contin;
  const summerDry = clamp(Math.exp(-(((latAbs - 35) / 9) ** 2)) * (0.55 + 0.45 * marine), 0, 1);
  const winterDry = clamp(Math.exp(-(((latAbs - 13) / 8) ** 2)) * 0.95, 0, 1);

  // ── the local half: this slope, this hollow ──
  const hE = safeGround(env, x + SLOPE_R, z, elevAbs);
  const hW = safeGround(env, x - SLOPE_R, z, elevAbs);
  const hS = safeGround(env, x, z + SLOPE_R, elevAbs);
  const hN = safeGround(env, x, z - SLOPE_R, elevAbs);
  const dx = (hE - hW) / (2 * SLOPE_R), dz = (hS - hN) / (2 * SLOPE_R);
  const grade = Math.hypot(dx, dz);
  // The sun sits equatorward: south of you in the north, north of you in the
  // south. A slope faces the sun when its downhill direction points that way.
  // −z is north in this world, so the sunward sign flips with the hemisphere.
  const sunZ = lat >= 0 ? 1 : -1;
  const sunward = grade > 1e-4 ? (dz * sunZ) / grade : 0;
  const insolation = clamp(0.5 + 0.5 * sunward * clamp(grade * 2.2, 0, 1), 0, 1);

  // A hollow is ground with ground above it on most sides. Ring-sampled rather
  // than differenced, because a ravine floor is flat locally and reads as a
  // plain to any gradient — it is the WALLS that say what it is.
  let above = 0, seen = 0;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = safeGround(env, x + Math.cos(a) * HOLLOW_R, z + Math.sin(a) * HOLLOW_R, NaN);
    if (!Number.isFinite(h)) continue;
    seen++;
    above += clamp((h - elevAbs) / 60, 0, 1);
  }
  const wetness = seen ? above / seen : 0.3;
  // Exposure is its opposite, plus the height itself: a ridge at altitude
  // takes what a sheltered valley never does.
  const exposure = clamp((1 - wetness) * 0.7 + norm(elevAbs, 200, 2600) * 0.3, 0, 1);

  // Salt reaches a few hundred metres inland and a few metres up, and nowhere
  // else. Mangrove and dune scrub live in that sliver; the guild above decides
  // whether it is warm enough for either.
  const salt = hadCoast
    ? clamp(1 - (coastRaw as number) / 900, 0, 1) * clamp(1 - Math.max(0, elevAbs) / 6, 0, 1)
    : 0;

  const treeline = treelineAt(latAbs, 0.5);
  return {
    heatC, summerC, winterC, rangeC, frostDays, waterMm,
    summerDry, winterDry, contin, rainShadow,
    treelineDelta: elevAbs - treeline,
    insolation, wetness, salt, exposure, elevAbs, hadCoast,
  };
}

function safeGround(env: SiteEnv, x: number, z: number, fallback: number): number {
  try {
    const h = env.groundAt(x, z);
    return Number.isFinite(h) ? h : fallback;
  } catch { return fallback; }
}
