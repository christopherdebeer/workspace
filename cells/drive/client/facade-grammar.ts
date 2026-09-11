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
});

/** The sixteen fields in texel order — four texels of four — with the scale
 *  each is stored under (a byte is 0..scale). The shader's decode multiplies
 *  by exactly these, so the two lists are one list. */
export const GRAM_FIELDS: ReadonlyArray<[keyof FacadeGrammar, number]> = [
  ['bayM', 8], ['storeyM', 8], ['winX0', 1], ['winX1', 1],
  ['winY0', 1], ['winY1', 1], ['doorX0', 1], ['doorX1', 1],
  ['doorY1', 1], ['doorShare', 1], ['openShare', 1], ['glassShade', 1],
  ['glassVar', 1], ['lintel', 1], ['ivy', 2], ['stain', 1],
];
/** Bytes a row: four RGBA texels. */
export const GRAM_ROW_BYTES = 16;

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
  GRAM_FIELDS.forEach(([k, scale], i) => { g[k] = (data[o + i] / 255) * scale; });
  return g;
}
