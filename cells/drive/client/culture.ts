/**
 * ── CULTURE: WHY TWO VILLAGES ARE NOT THE SAME VILLAGE ──
 *
 * The world already varies faithfully in WHAT is present — cover, tags and
 * elevation see to that. This file is about how it LOOKS, which until now
 * barely varied at all. The specific thing it replaces:
 *
 *     bPaint(id) = hash(osm_id) % 12
 *
 * Twelve near-white limewash creams, chosen by a hash of the OSM id. That is
 * decorrelated — neighbours differ — but decorrelation is exactly the wrong
 * property. A village is not twelve random creams; it is three or four paints
 * that AGREE, because the same lime pit and the same fashion served the whole
 * parish. Randomness per building produces a place with no identity, and it
 * reads as noise however carefully the twelve are picked.
 *
 * So the fix is not a better palette. It is a SEED HIERARCHY (M3): a seed that
 * is stable within a named radius, so a region agrees with itself at 100km, a
 * settlement agrees with itself at 300m, and only the last step is per
 * building. That is what turns random into characterful.
 *
 * ── WHY LAT/LON AND NOT WORLD X,Z ──
 *
 * World coordinates REBASE. The attract cycle re-origins the world to keep
 * float precision usable, and anything keyed to x,z would repaint every
 * building in the world when it did. Latitude and longitude are the only
 * coordinates here that name a place rather than an offset, so every seed in
 * this file is computed from them, through a local equirectangular projection
 * into metres. A building keeps its paint across a rebase, a reload, and a
 * session — which is the whole point of deterministic seeding.
 *
 * ── WHY THE REGION BOUNDARIES ARE VORONOI AND NOT A GRID ──
 *
 * Paid for once already, in the flower patches: `floor(cell / 20m)` plus one
 * hash drew a visible checkerboard across every hillside, because a grid
 * cell's boundary is a STRAIGHT LINE and the eye finds a straight line in a
 * landscape instantly. Regions here are jittered Voronoi cells — a site per
 * coarse cell, displaced by its own hash, nearest site wins. The boundary is
 * then an arbitrary polyline that runs at no particular angle, which is what a
 * cultural border looks like from a truck. It costs a 3×3 neighbourhood scan.
 *
 * Nothing in this file touches THREE, WebGL or the DOM: it is arithmetic over
 * a position and a set of climate weights, which is why it can be tested in a
 * third of a second instead of five minutes in a browser.
 */

/** The coherence scopes, in metres. These are radii of AGREEMENT, not sizes of
 *  thing: `settlement` is 320m because that is about how far you can see down
 *  a village street, so a street that agrees over 320m reads as one place. */
export const SCOPE = {
  /** Road and building culture — markings, materials, the broad look. */
  region: 96000,
  /** Within a culture, the local dialect of it: which paints, which roof. */
  district: 6000,
  /** A village agreeing with itself. The one that does the visible work. */
  settlement: 320,
  /** Geology and flower species; a stand of the same thing. */
  stand: 32,
} as const;
export type ScopeName = keyof typeof SCOPE;

/** Metres per degree of latitude. Longitude is scaled by cos(lat) at the
 *  sample's own latitude — a local equirectangular projection. Over a 96km
 *  region the resulting distortion is well under a percent, and it keeps the
 *  cells metric rather than making them wedges that swell toward the pole. */
const M_PER_DEG = 111320;

/** One round of a decent integer mix. Every step forced unsigned, because
 *  `^=` evaluates to a SIGNED int32 and a negative hash has already cost this
 *  codebase half its buildings once (see bPaint's note on B_MATS[-5]). */
export function hash3(a: number, b: number, salt: number): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2246822b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x3266489b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** A seed as a unit float. Not a generator: one seed in, one number out, so
 *  the same query always answers the same regardless of call order. Call order
 *  independence is a hard requirement here — tiles stream in whatever sequence
 *  the network delivers, and a paint that depended on arrival order would
 *  change between two visits to the same street. */
export const unit = (seed: number): number => (seed >>> 8) / 0x1000000;

/** A second, third, … independent draw from one seed, without a generator. */
export const unitN = (seed: number, n: number): number => unit(hash3(seed, n, 0x51ed));

export interface CultureEnv {
  /** [latitude, longitude] in degrees for a world point. The one input that
   *  survives an origin rebase. */
  latLonAt(x: number, z: number): [number, number];
}

/** A point projected into absolute metres from the equator/prime meridian. */
export function absMetres(lat: number, lon: number): [number, number] {
  const ez = lat * M_PER_DEG;
  const ex = lon * M_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return [ex, ez];
}

export interface Cell {
  /** The cell's seed — stable anywhere inside it. */
  seed: number;
  /** Integer cell coordinates of the winning site. */
  ix: number;
  iz: number;
  /** Distance to the winning site, and to the runner-up, both in metres.
   *  `(d2 - d1)` is small near a boundary, which is what lets a consumer fade
   *  across one instead of switching on a line. */
  d1: number;
  d2: number;
}

/**
 * The nearest jittered site on a `scale`-metre lattice. `salt` separates the
 * lattices: region, district and settlement all quantise the same plane, and
 * without a salt a settlement boundary would land exactly on a district
 * boundary everywhere, stacking every change onto one line.
 *
 * Jitter is 0.42 of a cell, not 0.5: at a full half-cell two adjacent sites
 * can coincide, which produces a zero-area region and a boundary that folds
 * back on itself. 0.42 keeps every cell non-degenerate while still leaving no
 * trace of the lattice it came from.
 */
export function cellAt(ex: number, ez: number, scale: number, salt: number): Cell {
  const cx = Math.floor(ex / scale);
  const cz = Math.floor(ez / scale);
  let d1 = Infinity, d2 = Infinity, bx = cx, bz = cz, bs = 0;
  for (let oz = -1; oz <= 1; oz++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gz = cz + oz;
      const s = hash3(gx, gz, salt);
      // Two independent draws for the site's offset inside its own cell.
      const jx = (unit(s) - 0.5) * 0.84;
      const jz = (unitN(s, 1) - 0.5) * 0.84;
      const px = (gx + 0.5 + jx) * scale;
      const pz = (gz + 0.5 + jz) * scale;
      const d = Math.hypot(ex - px, ez - pz);
      if (d < d1) { d2 = d1; d1 = d; bx = gx; bz = gz; bs = s; }
      else if (d < d2) { d2 = d; }
    }
  }
  return { seed: bs, ix: bx, iz: bz, d1, d2 };
}

/** The scope lattices, salted apart so their boundaries never coincide. */
const SALT: Record<ScopeName, number> = {
  region: 0x9e37, district: 0x85eb, settlement: 0xc2b2, stand: 0x27d4,
};

/** M3, the headline: a seed stable within `scope` metres of any point. */
export function seedAt(env: CultureEnv, x: number, z: number, scope: ScopeName): number {
  const [lat, lon] = env.latLonAt(x, z);
  const [ex, ez] = absMetres(lat, lon);
  return cellAt(ex, ez, SCOPE[scope], SALT[scope]).seed;
}

// ── THE BUILDING CULTURES ─────────────────────────────────────────
//
// Six, because six is enough to make a continent feel travelled and few enough
// that each one is recognisable on sight. Each is a real building tradition
// reduced to the two things visible at driving speed: what the walls are made
// of and what the roof is made of. Everything subtler than that — window
// rhythm, eaves depth — is below the resolution of a truck at 80km/h and is
// not modelled.
//
// AFFINITY IS THE POINT. A culture is not drawn uniformly at random from six;
// it is drawn weighted by the climate the region sits in. Slate roofs and
// timber gables in the Sahara would be exactly the "different coloured grass"
// failure again — variety that ignores the world it varies over. The affinity
// vector runs over BIOME_ORDER: [arid, tropical, temperate, boreal, alpine].

export type WallTex = 'render' | 'stone' | 'brick' | 'timber' | 'adobe';
export type RoofTex = 'pantile' | 'slate' | 'shingle' | 'corrugated' | 'flat';

export interface BuildCulture {
  key: string;
  /** The paints a settlement may draw from. A settlement takes THREE of
   *  these; the region's whole set never appears on one street. */
  wall: number[];
  roof: number[];
  wallTex: WallTex;
  roofTex: RoofTex;
  /** Base roof pitch, 0..1, before snow load steepens it. */
  pitch: number;
  affinity: number[];
}

export const BUILD_CULTURES: BuildCulture[] = [
  {
    // The current world's only look, kept — but now as ONE of six, and
    // confined to the climates where lime render actually belongs.
    key: 'limewash',
    wall: [0xefe9dc, 0xe8dfcc, 0xf2ede4, 0xe3d8c4, 0xefe2cc, 0xe9dcc6, 0xece5d2],
    roof: [0xa8613c, 0x9c5a38, 0xb06a42, 0x8f5334],
    wallTex: 'render', roofTex: 'pantile', pitch: 0.42,
    affinity: [0.18, 0.5, 1.0, 0.25, 0.3],
  },
  {
    // Mediterranean render: the same technique, a warmer and far braver
    // palette. Ochre, sienna, rose — the walls carry the colour here.
    key: 'ochre',
    wall: [0xd9a05b, 0xc98a4e, 0xdcb173, 0xc07a52, 0xd69a76, 0xe0bc8c],
    roof: [0xa2593a, 0x93502f, 0xb06844],
    wallTex: 'render', roofTex: 'pantile', pitch: 0.36,
    affinity: [1.0, 0.6, 0.55, 0.05, 0.15],
  },
  {
    // Upland stone. Grey and buff ashlar under slate, pitched steep because
    // the snow has to come off it.
    key: 'stone',
    wall: [0xa8a49a, 0x9c968a, 0xb5b0a4, 0x8e8a80, 0xc0baac, 0x99927f],
    roof: [0x51565c, 0x464b51, 0x5c6167, 0x3e4349],
    wallTex: 'stone', roofTex: 'slate', pitch: 0.72,
    affinity: [0.10, 0.05, 0.7, 0.85, 1.0],
  },
  {
    // Northern timber: dark stained board, white trim, shingle roof. The one
    // culture whose walls are darker than its roof.
    key: 'timber',
    wall: [0x7b4a38, 0x8a5340, 0x6d4132, 0x94604a, 0x5f3a2c, 0xa8705a],
    roof: [0x4a4a46, 0x565650, 0x40403c],
    wallTex: 'timber', roofTex: 'shingle', pitch: 0.78,
    affinity: [0.03, 0.1, 0.45, 1.0, 0.6],
  },
  {
    // Earth construction: flat roofs, walls the colour of the ground they
    // were dug from. Pitch near zero — this is the silhouette that says
    // "somewhere hot" before any colour registers.
    key: 'adobe',
    wall: [0xd8bf95, 0xcbb083, 0xe2cda8, 0xc0a375, 0xd5b98e, 0xb99a6c],
    roof: [0xc4ab84, 0xb89d76, 0xd0b891],
    wallTex: 'adobe', roofTex: 'flat', pitch: 0.06,
    affinity: [1.0, 0.75, 0.15, 0.0, 0.1],
  },
  {
    // Fired brick and dark tile: the temperate lowland industrial stock.
    key: 'brick',
    wall: [0x8f5a48, 0x9c6552, 0x7d4d3e, 0xa87360, 0x86584a, 0x6f4438],
    roof: [0x5a4a44, 0x64534c, 0x4e3f3a],
    wallTex: 'brick', roofTex: 'slate', pitch: 0.58,
    affinity: [0.05, 0.3, 1.0, 0.35, 0.12],
  },
];

// ── THE ROAD CULTURES ─────────────────────────────────────────────
//
// Markings are what the eye actually reads as "where am I" — a yellow centre
// line is North America before any building is in shot. Four, because the
// distinctions past four are not visible from the cab.

export interface RoadCulture {
  key: string;
  /** Centre-line paint. */
  centre: number;
  /** Are the carriageway edges painted at all? Much of Europe leaves minor
   *  roads unmarked at the edge; North America almost never does. */
  edge: boolean;
  edgeCol: number;
  /** Base asphalt tone. Chip seal is far paler than fresh bitumen, and that
   *  difference survives dust, rain and night lighting. */
  surface: number;
  /** How beaten up: patching, edge break-up, faded paint. 0..1. */
  wear: number;
  affinity: number[];
}

/**
 * Measured at Gordes: temperate France drew `nordic` — yellow centre line, no
 * edge markings, heavy frost wear — in one region out of five, because the
 * first affinity table was nearly flat and a 21% tail is not a tail. Road
 * markings are a NATIONAL convention: they hold over enormous areas and change
 * at a border, which is the opposite of building tradition, where the next
 * valley genuinely does build differently. So these are deliberately much
 * sharper than BUILD_CULTURES above — off-climate entries are near zero rather
 * than merely smaller.
 */
export const ROAD_CULTURES: RoadCulture[] = [
  {
    // White throughout, dark bitumen, edges marked on anything major.
    key: 'euro', centre: 0xf0eee6, edge: true, edgeCol: 0xf0eee6,
    surface: 0x38363a, wear: 0.3,
    affinity: [0.10, 0.25, 1.0, 0.55, 0.75],
  },
  {
    // Yellow centre, white edge — the North American convention.
    key: 'yellow', centre: 0xf2c53d, edge: true, edgeCol: 0xf0eee6,
    surface: 0x403e40, wear: 0.4,
    affinity: [0.45, 0.40, 0.42, 0.30, 0.40],
  },
  {
    // Chip seal over a pale aggregate, markings sun-bleached to nearly
    // nothing. Hot, dry and not recently resurfaced.
    key: 'chipseal', centre: 0xd8d2bc, edge: false, edgeCol: 0xd8d2bc,
    surface: 0x6b6154, wear: 0.85,
    affinity: [1.0, 0.75, 0.10, 0.02, 0.10],
  },
  {
    // Cold-climate: no edge line worth painting under snow, gritted-pale
    // surface, heavy frost damage.
    key: 'nordic', centre: 0xe8d98a, edge: false, edgeCol: 0xf0eee6,
    surface: 0x4a4a4e, wear: 0.65,
    affinity: [0.0, 0.0, 0.02, 1.0, 0.85],
  },
  // White centre, YELLOW edge: southern Africa's convention. Zero affinity,
  // so the climate pick never lands on it; geography asks for it by name.
  {
    key: 'za', centre: 0xf0eee6, edge: true, edgeCol: 0xf2c53d,
    surface: 0x3c3a3c, wear: 0.45,
    affinity: [0.0, 0.0, 0.0, 0.0, 0.0],
  },
];

/**
 * ── A BORDER IS NOT A BLEND ──
 *
 * The climate field answers in WEIGHTS, which is right for anything that
 * genuinely gradates — a tree mix, a ground colour, the flowers. Road markings
 * do not gradate. They are a national convention, uniform over a country and
 * discontinuous at a border, and treating them as a blend produced exactly the
 * artefact you would predict: measured at Gordes, temperate France carries a
 * boreal weight of 0.21 — perfectly reasonable for the climate — and that was
 * enough to paint one region in five with arctic markings.
 *
 * Raising the weights to a power and renormalising keeps the field's answer
 * while making the DOMINANT archetype the one that decides. At 2.5 a 0.21
 * minority weight falls to a twentieth of a 0.56 majority instead of a third
 * of it, which is the difference between a mixed border zone and a country.
 */
export function sharpen(w: number[], p = 2.5): number[] {
  const out = w.map((v) => Math.pow(Math.max(0, v), p));
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((v) => v / sum) : w.slice();
}

/**
 * Pick from a culture set by region seed, weighted by the climate there.
 *
 * The roll is the region's own seed, so every point inside one region gets the
 * same answer without any shared state — no cache, no fill order, nothing that
 * could depend on which tile arrived first.
 */
export function pickCulture<T extends { affinity: number[] }>(
  set: T[], w: number[], roll: number, bias?: (c: T) => number,
): T {
  let total = 0;
  const acc: number[] = [];
  for (const c of set) {
    let s = 0;
    for (let i = 0; i < w.length && i < c.affinity.length; i++) s += w[i] * c.affinity[i];
    if (bias) s *= bias(c);
    // A floor, so a climate no culture wants still resolves rather than
    // dividing by zero and handing back undefined.
    total += Math.max(s, 1e-4);
    acc.push(total);
  }
  const t = roll * total;
  for (let i = 0; i < acc.length; i++) if (t < acc[i]) return set[i];
  return set[set.length - 1];
}

export interface BuildLook {
  culture: BuildCulture;
  /** The three paints THIS settlement uses. The agreement that makes a
   *  village a place rather than twelve creams. */
  palette: number[];
  roofCol: number;
  /** Roof pitch after snow load. */
  pitch: number;
  /** Distance from the settlement boundary, 0..1 — 0 on the edge between two
   *  settlements. Consumers may use it to soften a transition. */
  edge: number;
}

/**
 * A ROOF MATERIAL IS A CLIMATE DECISION, NOT ONLY A PITCH.
 *
 * Measured at Flagstaff: 2100m, snow load 0.89, and the world built Provençal
 * lime render under clay pantiles. Steepening the pitch — which the first cut
 * did — makes that a STEEP pantile roof under a metre of snow, which is worse,
 * not better: pantiles lift and shatter under a freeze, which is exactly why
 * nobody builds them where it snows. Slate and shingle are what survive.
 *
 * So snow suppresses the materials that cannot take it and favours the ones
 * that can, before the region ever rolls. Below half a load this does nothing
 * at all, because most of the world is not a snow problem.
 */
export function roofSnowBias(rt: RoofTex, snow: number): number {
  if (snow < 0.5) return 1;
  const s = (snow - 0.5) / 0.5;
  if (rt === 'flat') return Math.max(0.04, 1 - s * 0.96);      // ponds, then collapses
  if (rt === 'pantile') return Math.max(0.10, 1 - s * 0.90);   // lifts and shatters
  if (rt === 'slate' || rt === 'shingle') return 1 + s * 0.8;  // what actually gets built
  return 1;
}

/** How much the roof has to shed. Snow load is the one climate fact with a
 *  direct, universally observed effect on building shape, and it is why an
 *  alpine roof is steep and a desert roof is flat. Driven by the boreal and
 *  alpine weights plus raw altitude, both of which the field already knows. */
export function snowLoad(w: number[], elevAbs: number): number {
  const cold = (w[3] ?? 0) * 0.7 + (w[4] ?? 0) * 1.0;
  const high = Math.min(1, Math.max(0, (elevAbs - 400) / 1600));
  return Math.min(1, cold * 0.75 + high * 0.55);
}

/**
 * The whole building answer for a point: which culture, which three paints
 * this settlement agreed on, and how steep the roofs are.
 *
 * Two scopes stacked. The REGION picks the culture — so the look holds for
 * roughly a day's driving. The SETTLEMENT picks three paints out of that
 * culture's set and one roof colour — so a village agrees with itself, and the
 * next village along wears the same tradition in a different key. Neither step
 * consults an OSM id, so the answer is the same whichever way you arrive.
 */
export function buildLookAt(env: CultureEnv, x: number, z: number, w: number[], elevAbs: number): BuildLook {
  const [lat, lon] = env.latLonAt(x, z);
  const [ex, ez] = absMetres(lat, lon);
  const reg = cellAt(ex, ez, SCOPE.region, SALT.region);
  // Snow is computed first because it VETOES materials, not just steepens
  // them — see roofSnowBias. Picking the culture and then discovering it
  // cannot survive the winter is the wrong order.
  const snow = snowLoad(w, elevAbs);
  const culture = pickCulture(BUILD_CULTURES, w, unit(reg.seed), (c) => roofSnowBias(c.roofTex, snow));
  const set = cellAt(ex, ez, SCOPE.settlement, SALT.settlement);
  // Three paints, drawn without replacement from the culture's set. Without
  // replacement matters: drawn with it, a settlement can roll the same paint
  // three times and the whole village becomes one flat colour.
  const pool = culture.wall.slice();
  const palette: number[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    palette.push(pool.splice(Math.floor(unitN(set.seed, i + 1) * pool.length), 1)[0]);
  }
  const roofCol = culture.roof[Math.floor(unitN(set.seed, 9) * culture.roof.length)];
  // Snow steepens, and the district adds a little scatter so two villages in
  // one region are not identical in section.
  const pitch = Math.min(0.95, culture.pitch * (1 + 0.5 * snow) + (unitN(set.seed, 11) - 0.5) * 0.08);
  const edge = Math.min(1, (set.d2 - set.d1) / SCOPE.settlement);
  return { culture, palette, roofCol, pitch, edge };
}

/** Which of the settlement's paints THIS building wears. Keyed on the
 *  building's own position quantised to 8m — never on its OSM id, and never
 *  on an array index, because an index moves when the batch is re-seated.
 *  Takes the env rather than raw metres so no caller has to remember to
 *  project first; getting that wrong would silently key on world coordinates,
 *  which is the one thing this whole file exists to avoid. */
export function paintFor(env: CultureEnv, look: BuildLook, x: number, z: number): number {
  const [lat, lon] = env.latLonAt(x, z);
  const [ex, ez] = absMetres(lat, lon);
  const h = hash3(Math.round(ex / 8), Math.round(ez / 8), 0x1b0d);
  return look.palette[h % look.palette.length];
}

/** The road answer for a point: one region-scope pick, same contract. */
export function roadLookAt(env: CultureEnv, x: number, z: number, w: number[]): RoadCulture {
  const [lat, lon] = env.latLonAt(x, z);
  const [ex, ez] = absMetres(lat, lon);
  // A DIFFERENT salt from the building region, deliberately. Road convention
  // and building tradition do not change at the same line in the real world —
  // markings follow a state, materials follow a valley — and stacking both
  // onto one boundary would make every transition an event.
  const reg = cellAt(ex, ez, SCOPE.region, SALT.region ^ 0x5bf0);
  // Sharpened, unlike the building pick: see the note on `sharpen`. Building
  // tradition genuinely does blend across a climate gradient — the next valley
  // really is a bit different — but road markings do not.
  return pickCulture(ROAD_CULTURES, sharpen(w), unit(reg.seed));
}

// ── SUBSTRATE: THE VILLAGE IS BUILT OF THE HILL BEHIND IT ──────────
//
// The rock family already existed, but it was rolled per CLUMP off a free
// random: coherent within one scree slope and independent of the next, and
// invisible to everything that was not a rock. So a stone village could sit on
// red sandstone country wearing generic grey, which is the same category of
// miss as the twelve creams — a fact the world already knows, not carried to
// the things that should show it.
//
// Bedrock belongs on the DISTRICT scope, not the stand: geology changes over
// kilometres, not over the width of a field. Putting it there means the rocks
// on a hillside, the cutting the road was blasted through, and the walls of
// the village below it all come from the same answer.

/** Which rock family this district stands on. `mixRows` is one row of family
 *  weights per archetype, in BIOME_ORDER, and `w` the climate weights — so a
 *  granite country shading into limestone shades gradually, as ground does. */
export function bedrockAt(env: CultureEnv, x: number, z: number, mixRows: number[][], w: number[]): number {
  const [lat, lon] = env.latLonAt(x, z);
  const [ex, ez] = absMetres(lat, lon);
  const cell = cellAt(ex, ez, SCOPE.district, SALT.district);
  const n = mixRows[0]?.length ?? 0;
  const mix = new Array<number>(n).fill(0);
  let total = 0;
  for (let bi = 0; bi < mixRows.length && bi < w.length; bi++) {
    for (let i = 0; i < n; i++) { const v = mixRows[bi][i] * w[bi]; mix[i] += v; total += v; }
  }
  if (total <= 0) return 0;
  let t = unit(cell.seed) * total;
  for (let i = 0; i < n; i++) { t -= mix[i]; if (t <= 0) return i; }
  return n - 1;
}

/**
 * Three wall tones out of one rock family, for a settlement that builds in
 * local stone. `family` is [hue, hueSpan, sat, satSpan, lit, litSpan] — the
 * same six numbers the rock table already carries.
 *
 * Walls are NOT the rock verbatim. Dressed and coursed stone reads lighter and
 * less saturated than the same rock in a cliff face: it is cut, it is dry, and
 * it has a century of weathering on it. Taking the family straight gave black
 * basalt villages that disappeared into their own shadows.
 */
export function stoneWalls(family: number[], seed: number): Array<[number, number, number]> {
  const [hu, hv, sa, sv, li, lv] = family;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < 3; i++) {
    const a = unitN(seed, 20 + i), b = unitN(seed, 30 + i), c = unitN(seed, 40 + i);
    out.push([
      hu + a * hv,
      Math.max(0, Math.min(1, (sa + b * sv) * 0.6)),
      // Lifted toward 0.62 and never allowed below 0.3: a wall has to read as
      // a wall at dusk, and the basalt family bottoms out at 0.11.
      Math.max(0.3, Math.min(0.86, (li + c * lv) * 0.55 + 0.34)),
    ]);
  }
  return out;
}
