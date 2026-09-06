/**
 * ── MARKS: WHAT PEOPLE WROTE ON THE WORLD ──
 *
 * A village that varies in paint, roof pitch and stonework still reads as
 * uninhabited, because none of it was DONE BY ANYONE. Marks are the cheapest
 * evidence of a person: someone stood at this wall, at reachable height, and
 * left something. They are also the one decoration in this world that can
 * later carry meaning — see THE SERVICE below.
 *
 * ── WHY A SETTLEMENT SHARES A SIGIL ──
 *
 * The same argument culture.ts makes about paint, and for the same reason it
 * is easy to get wrong: a hash per building gives every wall its own tag,
 * which is decorrelated, and decorrelation reads as noise. Real marks come
 * from a small number of hands working one neighbourhood — a crew, a slogan,
 * one can of paint used until it runs out. So the SIGIL and the COLOUR are
 * drawn at settlement scope (320m, the scope that already exists for paint),
 * and only the placement and the minor variants are per wall.
 *
 * ── WHY DENSITY IS THE WHOLE DESIGN ──
 *
 * Marks everywhere is not "a lived-in world", it is vandalism as wallpaper,
 * and it costs the world its silence. Density is therefore keyed hard: a
 * region's culture sets a ceiling, and the honest signal is that graffiti
 * means PEOPLE — dense in a town, thinning at the edge, absent on a barn on
 * an empty moor. Arriving somewhere should be legible from the walls.
 *
 * ── THE SERVICE ──
 *
 * The atlas keeps its last four cells for marks nobody sprayed: a route
 * arrow, a station sigil, a warning, a tally. In free drive they are rare —
 * an occasional oddity. On THE LINE they are the vocabulary the run is
 * written in, and they read as a message precisely BECAUSE the player has
 * driven past a thousand meaningless tags first. That is the whole trick, and
 * it only works if the procedural marks come first and are honestly
 * meaningless.
 *
 * Nothing here touches THREE or the DOM. The canvas drawing takes a plain 2D
 * context, so the atlas can be rendered and asserted in a test.
 */

import { SCOPE, hash3, seedAt, unit, unitN, type CultureEnv } from './culture';

/** Atlas geometry: sixteen marks, four to a side. */
export const MARK_N = 16;
export const MARK_COLS = 4;
/** The last four cells are the Service's, not a crew's. */
export const MARK_SERVICE_FIRST = 12;

/**
 * The spray tin, and it is a SHORT list on purpose. Real graffiti in one town
 * is two or three colours because that is what the shop sold; a rainbow reads
 * as a colour picker. Kept dark and saturated so they sit in the world's
 * palette rather than glowing out of it — the quantiser promotes anything
 * near white into a lamp, which is how the first water splash became comedy.
 */
export const MARK_PALETTE = [
  0x1c1a1c,   // near-black, the commonest tag there is
  0xb8352c,   // oxide red
  0x2f5e8c,   // sign blue
  0xd8c23a,   // yellow
  0xe4e0d6,   // whitewash
  0x2f6b40,   // green
  0x7a3f8c,   // purple
  0xc4632a,   // orange
] as const;

export interface MarkCulture {
  key: string;
  /** Indices into MARK_PALETTE this region actually uses. */
  tins: number[];
  /** Ceiling on how much of a wall carries a mark, 0..1. */
  density: number;
  /** Which mark families this region favours, as weights over the atlas's
   *  four bands: sigils, throw-ups, tags, stencils. */
  bands: [number, number, number, number];
  affinity: number[];
}

/**
 * Sharper than BUILD_CULTURES for the same reason ROAD_CULTURES are: what
 * people write, and whether they write at all, holds over large areas and is
 * a matter of convention rather than of the next valley's stone.
 */
export const MARK_CULTURES: MarkCulture[] = [
  {
    // Dense, colourful, European-urban: throw-ups and tags on every gable.
    key: 'urban', tins: [0, 1, 2, 3, 4], density: 0.5,
    bands: [0.8, 1.0, 1.0, 0.35],
    affinity: [0.35, 0.55, 1.0, 0.6, 0.25],
  },
  {
    // Hot and dry: whitewash and oxide, stencilled notices, political slogans
    // painted rather than sprayed.
    key: 'painted', tins: [4, 1, 0, 7], density: 0.34,
    bands: [1.0, 0.3, 0.55, 1.0],
    affinity: [1.0, 0.85, 0.35, 0.1, 0.15],
  },
  {
    // Cold and thin: a few marks, dark, weathered, mostly on concrete.
    key: 'sparse', tins: [0, 4, 2], density: 0.16,
    bands: [0.7, 0.4, 0.9, 0.5],
    affinity: [0.2, 0.15, 0.5, 1.0, 1.0],
  },
  {
    // Wet and green: heavy, layered, fast-growing — and the moss eats it.
    key: 'lush', tins: [5, 3, 0, 6], density: 0.42,
    bands: [0.5, 1.0, 0.9, 0.3],
    affinity: [0.1, 1.0, 0.55, 0.25, 0.05],
  },
];

export interface MarkLook {
  culture: MarkCulture;
  /** The settlement's own mark, an atlas index below MARK_SERVICE_FIRST. */
  sigil: number;
  /** Its tin, an index into MARK_PALETTE. */
  tin: number;
  /** How much of this wall may carry marks, after the settlement's own
   *  appetite and the region's ceiling. */
  density: number;
}

/** Softmax-ish pick over a weight vector — the same shape culture.ts uses for
 *  its own tables, kept local so this module has no dependency on its
 *  internals beyond the seed hierarchy. */
function pick<T extends { affinity: number[] }>(list: T[], w: number[], seed: number): T {
  let best = list[0], bestScore = -Infinity;
  for (let i = 0; i < list.length; i++) {
    let s = 0;
    for (let k = 0; k < w.length; k++) s += w[k] * (list[i].affinity[k] ?? 0);
    // A little jitter, so a region on a boundary does not snap on a contour.
    s *= 0.82 + 0.36 * unitN(seed, i);
    if (s > bestScore) { bestScore = s; best = list[i]; }
  }
  return best;
}

/**
 * What this place writes, and how much of it. `w` is the climate weight
 * vector — the same one BUILD_CULTURES and ROAD_CULTURES are chosen with.
 *
 * `people` is the caller's own estimate of how built-up this is (0 open
 * country, 1 town centre). It is the term that keeps marks off a barn, and
 * the reason it is an argument rather than something computed here is that
 * only the game knows how many buildings and roads are actually around.
 */
export function markLookAt(
  env: CultureEnv, x: number, z: number, w: number[], people: number,
): MarkLook {
  const region = seedAt(env, x, z, 'region');
  const town = seedAt(env, x, z, 'settlement');
  const culture = pick(MARK_CULTURES, w, region);
  const tin = culture.tins[Math.floor(unit(town) * culture.tins.length) % culture.tins.length];
  // The settlement's sigil: one mark, from the bands this region favours.
  const bands = culture.bands;
  const total = bands[0] + bands[1] + bands[2] + bands[3];
  let roll = unitN(town, 7) * total, band = 0;
  while (band < 3 && roll > bands[band]) { roll -= bands[band]; band++; }
  const sigil = Math.min(MARK_SERVICE_FIRST - 1, band * 3 + Math.floor(unitN(town, 11) * 3));
  // A settlement has its own appetite too — one village is tagged end to end
  // and the next is nearly clean, which is true and is what stops the density
  // reading as a global setting.
  const appetite = 0.35 + 1.3 * unitN(town, 23);
  return {
    culture, sigil, tin,
    density: Math.max(0, Math.min(0.9, culture.density * appetite * people)),
  };
}

/**
 * THE VERTEX ATTRIBUTE. One float carries the whole look, because a building
 * batch already pays for `aBase` and a second float is free where a second
 * attribute is not: the integer part is sigil*8+tin, the fraction is density.
 * Unpacked in the facade shader.
 */
export function packMark(look: MarkLook): number {
  const idx = look.sigil * 8 + look.tin;
  return idx + Math.min(0.999, Math.max(0, look.density));
}

/** The Service's own marks, for callers that place rather than seed them. */
export const SERVICE_MARK = {
  route: MARK_SERVICE_FIRST,      // an arrow: the way on
  station: MARK_SERVICE_FIRST + 1, // a station's sigil
  warning: MARK_SERVICE_FIRST + 2, // do not
  tally: MARK_SERVICE_FIRST + 3,   // someone counted something here
} as const;

type Rand = () => number;

/**
 * ── DRAWING THE ATLAS ──
 *
 * Sixteen marks in a 4x4 grid, WHITE ON TRANSPARENT so the shader can tint
 * each one with the settlement's tin. Every cell keeps a margin: the texture
 * is mipmapped (distant walls shimmer otherwise, the same lesson the wall
 * textures record) and mip bleeding across a cell boundary would smear one
 * mark into its neighbour.
 *
 * The marks are drawn with a flat brush and no anti-aliasing worth the name,
 * because the composite quantises and dithers everything anyway: a bold
 * silhouette survives that, a delicate one becomes noise. Same doctrine as
 * the water sheets.
 */
export function drawMarkAtlas(c: CanvasRenderingContext2D, size: number, r: Rand): void {
  const cell = size / MARK_COLS;
  const pad = cell * 0.14;
  const inner = cell - pad * 2;
  c.clearRect(0, 0, size, size);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (let i = 0; i < MARK_N; i++) {
    const ox = (i % MARK_COLS) * cell + pad;
    const oy = Math.floor(i / MARK_COLS) * cell + pad;
    c.save();
    c.translate(ox, oy);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#ffffff';
    if (i < 3) sigilMark(c, inner, r, i);
    else if (i < 6) throwUp(c, inner, r);
    else if (i < 9) tagMark(c, inner, r);
    else if (i < MARK_SERVICE_FIRST) stencilMark(c, inner, r, i - 9);
    else serviceMark(c, inner, i - MARK_SERVICE_FIRST);
    c.restore();
  }
}

/** A crew's sigil: geometric, symmetric, repeatable by hand. */
function sigilMark(c: CanvasRenderingContext2D, s: number, r: Rand, v: number): void {
  const m = s * 0.5;
  c.lineWidth = s * 0.11;
  if (v === 0) {
    c.beginPath(); c.arc(m, m, s * 0.32, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(m, s * 0.1); c.lineTo(m, s * 0.9); c.stroke();
  } else if (v === 1) {
    c.beginPath();
    c.moveTo(m, s * 0.12); c.lineTo(s * 0.88, s * 0.78); c.lineTo(s * 0.12, s * 0.78);
    c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(s * 0.28, s * 0.56); c.lineTo(s * 0.72, s * 0.56); c.stroke();
  } else {
    for (let k = 0; k < 3; k++) {
      const y = s * (0.24 + k * 0.24);
      c.beginPath();
      c.moveTo(s * 0.16, y); c.lineTo(m, y - s * 0.13); c.lineTo(s * 0.84, y);
      c.stroke();
    }
  }
  drips(c, s, r, 2);
}

/** A throw-up: fat overlapping strokes, the commonest thing on a wall. */
function throwUp(c: CanvasRenderingContext2D, s: number, r: Rand): void {
  c.lineWidth = s * (0.17 + r() * 0.07);
  const n = 2 + Math.floor(r() * 2);
  for (let k = 0; k < n; k++) {
    const x0 = s * (0.12 + r() * 0.2), x1 = s * (0.6 + r() * 0.28);
    const y0 = s * (0.28 + r() * 0.34);
    c.beginPath();
    c.moveTo(x0, y0);
    c.bezierCurveTo(x0 + s * 0.1, y0 - s * 0.3 * (r() + 0.4),
      x1 - s * 0.1, y0 + s * 0.3 * (r() + 0.2), x1, y0 - s * 0.12);
    c.stroke();
  }
  drips(c, s, r, 4);
}

/** A tag: an angular scrawl, one gesture, no lifting the can. */
function tagMark(c: CanvasRenderingContext2D, s: number, r: Rand): void {
  c.lineWidth = s * (0.075 + r() * 0.05);
  c.beginPath();
  let x = s * 0.1, y = s * (0.4 + r() * 0.2);
  c.moveTo(x, y);
  const n = 4 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    x += s * (0.1 + r() * 0.14);
    const ny = s * (0.22 + r() * 0.46);
    c.lineTo(x, ny);
    y = ny;
  }
  // The flick: every tag ends with one, and it is what says HAND rather than
  // FONT at four pixels across.
  c.lineTo(Math.min(x + s * 0.16, s * 0.96), y - s * 0.2);
  c.stroke();
  drips(c, s, r, 2);
}

/** A stencil: an arrow, a cross, a bar — the marks that mean something. */
function stencilMark(c: CanvasRenderingContext2D, s: number, r: Rand, v: number): void {
  const m = s * 0.5;
  c.lineWidth = s * 0.13;
  if (v === 0) {
    c.beginPath(); c.moveTo(s * 0.16, m); c.lineTo(s * 0.84, m); c.stroke();
    c.beginPath();
    c.moveTo(s * 0.58, m - s * 0.2); c.lineTo(s * 0.86, m); c.lineTo(s * 0.58, m + s * 0.2);
    c.stroke();
  } else if (v === 1) {
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.2); c.lineTo(s * 0.8, s * 0.8);
    c.moveTo(s * 0.8, s * 0.2); c.lineTo(s * 0.2, s * 0.8);
    c.stroke();
  } else {
    for (let k = 0; k < 4; k++) {
      const x = s * (0.24 + k * 0.15);
      c.beginPath(); c.moveTo(x, s * 0.28); c.lineTo(x, s * 0.72); c.stroke();
    }
  }
  drips(c, s, r, 1);
}

/**
 * The Service's marks. Drawn with a ruler, not a hand: these are the ones
 * that are supposed to look official, and the contrast with the scrawl around
 * them is what makes them legible as a message.
 */
function serviceMark(c: CanvasRenderingContext2D, s: number, v: number): void {
  const m = s * 0.5;
  c.lineWidth = s * 0.12;
  if (v === 0) {
    // ROUTE: a chevron pointing on, over a bar.
    c.beginPath();
    c.moveTo(s * 0.2, s * 0.56); c.lineTo(m, s * 0.22); c.lineTo(s * 0.8, s * 0.56);
    c.stroke();
    c.beginPath(); c.moveTo(s * 0.22, s * 0.78); c.lineTo(s * 0.78, s * 0.78); c.stroke();
  } else if (v === 1) {
    // STATION: a ringed dot — the same shape the chart uses for a station.
    c.beginPath(); c.arc(m, m, s * 0.34, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(m, m, s * 0.12, 0, Math.PI * 2); c.fill();
  } else if (v === 2) {
    // WARNING: a bar in a box. No words: a word needs a language.
    c.strokeRect(s * 0.16, s * 0.16, s * 0.68, s * 0.68);
    c.fillRect(s * 0.3, s * 0.44, s * 0.4, s * 0.13);
  } else {
    // TALLY: four and a cross. Someone counted something here.
    for (let k = 0; k < 4; k++) {
      const x = s * (0.24 + k * 0.13);
      c.beginPath(); c.moveTo(x, s * 0.26); c.lineTo(x, s * 0.74); c.stroke();
    }
    c.beginPath(); c.moveTo(s * 0.18, s * 0.72); c.lineTo(s * 0.74, s * 0.28); c.stroke();
  }
}

/** Paint runs. One detail, and the one that says WET PAINT ON A WALL rather
 *  than a decal — so it is worth the four lines it costs. */
function drips(c: CanvasRenderingContext2D, s: number, r: Rand, n: number): void {
  c.lineWidth = s * 0.035;
  for (let k = 0; k < n; k++) {
    if (r() > 0.65) continue;
    const x = s * (0.15 + r() * 0.7), y = s * (0.5 + r() * 0.2);
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y + s * (0.08 + r() * 0.22));
    c.stroke();
  }
}

