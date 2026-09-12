/**
 * ── THE OPENING GRAMMAR AS DATA: PURE, ENCODABLE, TESTABLE ──
 *
 * facade.ts owns the shader and needs THREE and a document; the tradition
 * atlas needs the grammar's SHAPE and its defaults and must stay pure (it is
 * tested in node in a second). So the interface, the shipped defaults and the
 * byte encoding the shader's lookup texture is built from live here, with no
 * imports at all, and facade.ts re-exports the names it always exported.
 *
 * WHY A TEXTURE, AND WHY BYTES. Buildings batch per tile, so "this building's
 * grammar" cannot be a uniform (one per draw) and cannot be sixteen floats on
 * every vertex (four attributes for what one float can index). The route is
 * the one the marks took for their tins: one float attribute — aGram, the
 * tradition's row — and a one-column-of-texels lookup, four RGBA8 texels a
 * row, read with texture2D, which GLSL ES 1.00 allows where a dynamically
 * indexed uniform array is illegal in a fragment shader. Eight bits a field
 * is 3 cm on a bay and 0.4% on a share, against a composite that quantises to
 * fourteen levels: precision nobody could see, and the test holds the round
 * trip to it anyway.
 */
export interface FacadeGrammar {
  /** The bay grid: metres across a bay, metres floor to floor. */
  bayM: number;
  storeyM: number;
  /** The window box, as shares of the bay (x) and the storey (y). */
  winX0: number;
  winX1: number;
  winY0: number;
  winY1: number;
  /** The door box; its sill is at the bay's floor. */
  doorX0: number;
  doorX1: number;
  doorY1: number;
  /** Share of ground-floor bays that are a door rather than a shopfront. */
  doorShare: number;
  /** Share of bays that carry an opening at all; the rest are blank wall. */
  openShare: number;
  /** The void: a fraction OF the wall, plus a per-bay variation. */
  glassShade: number;
  glassVar: number;
  /** The lintel line's darkening at the window head. */
  lintel: number;
  /** Ivy, as a multiplier on the column claim: 1 is the shipped amount. */
  ivy: number;
  /** Water staining under every horizontal break. */
  stain: number;
  // ── ARTICULATION: WHAT MAKES A WALL A BUILDING AND NOT A TEXTURE ──
  /** How deep an opening is set into the wall, metres: the reveal casts the
   *  sun's shadow onto the glass and holds a little ambient dark all round. */
  revealM: number;
  /** The sill's projection, metres: a lit line and a shadow under it. */
  sillM: number;
  /** The painted frame round an opening, 0..1, in the trim colour. */
  frame: number;
  /** Share of wide windows with a centre mullion (and tall ones a transom). */
  mullion: number;
  /** The sky reflected in the top of the pane, 0..1. */
  glassSky: number;
  /** A light line at each floor level, 0..1. */
  stringCourse: number;
  /** The band under the eave, 0..1, in the trim colour. */
  cornice: number;
  /** A darker dado band at the base, metres high (0 for none). */
  plinthM: number;
  /** Share of windows with shutters; a fifth of those are closed. */
  shutters: number;
  /** Share of upper-floor bays with a balcony and a door onto it. */
  balcony: number;
  /** Rain streaks from the sill corners, 0..1. */
  streaks: number;
  /** The damp band rising from the ground, metres. */
  dampM: number;
  /** Trim colour, an index into the shader's eight: 0 white, 1 cream, 2 green,
   *  3 blue, 4 grey, 5 brown, 6 oxide, 7 black. */
  trim: number;
  /** Shutter and door colour, the same eight. */
  shutterCol: number;
  /** Share of ground-floor bays that are a shopfront rather than a window. */
  shopfront: number;
  /** The eave's overhang, metres: its shadow on the wall under a high sun. */
  eaveM: number;
}

/** The shipped grammar — what the shader drew before any of this was a
 *  number — frozen, so the atlas can state a tradition as OVERRIDES of it
 *  and the game can fall back to it where the atlas is silent. */
export const FACADE_DEFAULTS: Readonly<FacadeGrammar> = Object.freeze({
  bayM: 2.75,
  storeyM: 3.1,
  winX0: 0.2,
  winX1: 0.8,
  winY0: 0.34,
  winY1: 0.86,
  doorX0: 0.33,
  doorX1: 0.67,
  doorY1: 0.6,
  doorShare: 0.36,
  openShare: 0.76,
  glassShade: 0.2,
  glassVar: 0.16,
  lintel: 0.25,
  ivy: 1,
  stain: 0.16,
  revealM: 0.14,
  sillM: 0.06,
  frame: 0.5,
  mullion: 0.6,
  glassSky: 0.5,
  stringCourse: 0,
  cornice: 0.35,
  plinthM: 0.5,
  shutters: 0,
  balcony: 0,
  streaks: 0.5,
  dampM: 0.4,
  trim: 0,
  shutterCol: 2,
  shopfront: 0.5,
  eaveM: 0.35,
});

/** The thirty-two fields in texel order — eight texels of four — with the
 *  scale each is stored under (a byte is 0..scale). The shader's decode
 *  multiplies by exactly these, so the two lists are one list; the two colour
 *  indices are stored under 8 and rounded back. */
export const GRAM_FIELDS: ReadonlyArray<[keyof FacadeGrammar, number]> = [
  ['bayM', 8], ['storeyM', 8], ['winX0', 1], ['winX1', 1],
  ['winY0', 1], ['winY1', 1], ['doorX0', 1], ['doorX1', 1],
  ['doorY1', 1], ['doorShare', 1], ['openShare', 1], ['glassShade', 1],
  ['glassVar', 1], ['lintel', 1], ['ivy', 2], ['stain', 1],
  ['revealM', 1], ['sillM', 1], ['frame', 1], ['mullion', 1],
  ['glassSky', 1], ['stringCourse', 1], ['cornice', 1], ['plinthM', 2],
  ['shutters', 1], ['balcony', 1], ['streaks', 1], ['dampM', 2],
  ['trim', 8], ['shutterCol', 8], ['shopfront', 1], ['eaveM', 1],
];
/** Bytes a row: eight RGBA texels. */
export const GRAM_ROW_BYTES = 32;

/** Write one grammar as a row of bytes at `o`. */
export function gramEncode(g: FacadeGrammar, out: Uint8Array, o: number): void {
  GRAM_FIELDS.forEach(([k, scale], i) => {
    out[o + i] = Math.round(Math.max(0, Math.min(1, g[k] / scale)) * 255);
  });
}

/** Read a row back — what the shader will see, for the test and the probe.
 *  `row` is the 1-based aGram value; row 0 is "the uniforms" and decodes to
 *  the defaults. */
export function gramDecode(data: Uint8Array, row: number): FacadeGrammar {
  if (row < 1 || (row - 1) * GRAM_ROW_BYTES + GRAM_ROW_BYTES > data.length) return { ...FACADE_DEFAULTS };
  const o = (row - 1) * GRAM_ROW_BYTES;
  const g = { ...FACADE_DEFAULTS } as FacadeGrammar;
  GRAM_FIELDS.forEach(([k, scale], i) => {
    const v = (data[o + i] / 255) * scale;
    g[k] = k === 'trim' || k === 'shutterCol' ? Math.round(v) : v;
  });
  return g;
}
