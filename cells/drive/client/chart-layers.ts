/**
 * ── THE CHART IS SEVERAL MAPS, AND THE PLAYER CHOOSES WHICH ──
 *
 * Asked from the seat: "I wonder if it's possible to have overview separate
 * into layers (not just OSM) so that I can easily toggle say cover or eco
 * polygons with a key/legend" — and then, in order: cities only at wide views,
 * roads closer in, and togglable cover and ecoregion regions.
 *
 * The chart had exactly ONE layer and no way to say so. Its roads and its
 * place names arrive in the same tile and are drawn by the same pass; the
 * land cover exists as a raster that only the terrain painter reads, and the
 * ecoregions exist as polygons that only the guild reads. Neither has ever
 * been drawn on the map they describe, and there was no surface on which a
 * player could learn that they exist.
 *
 * THIS MODULE IS THE TABLE AND THE PALETTES, AND IT IS PURE. No THREE, no DOM,
 * no module state of the world — so `devtools/chart-layers.test.mjs` drives
 * the shipping functions in node in a second, and the same colours reach the
 * texture the shell wears and the swatch the key draws. A legend whose ink is
 * a second copy of the layer's ink is a legend that goes wrong silently; this
 * is the reason for the module rather than a record literal in main.ts.
 *
 * THE VOCABULARY IS DELIBERATELY SMALL. A layer is either a VECTOR layer the
 * chart already draws (roads, places) or a THEMATIC RASTER: one class per
 * texel, a flat colour per class, a legend naming only the classes actually on
 * screen. Everything new is the second kind, because both of the sources the
 * seat named — WorldCover and RESOLVE — answer "what class is it here" at a
 * point, which is what a thematic map is.
 */

/** What a layer draws, which decides how it is switched and how it is keyed. */
export type ChartLayerKind = 'vector' | 'thematic';

export interface ChartLayer {
  id: ChartLayerId;
  /** The word on the key. Short: the HUD is about 148 art pixels wide. */
  name: string;
  kind: ChartLayerKind;
  /** On for a player who has never touched the key. The base map is on; the
   *  thematic layers are not, because each is a claim over the whole frame and
   *  two of them at once is neither. */
  on: boolean;
  /** One line, for the record card and for anyone reading the table. */
  note: string;
  /** A chip only offered while the tile-debug overlay is up. The substrate's
   *  classification is an INSTRUMENT, not a map of the world: it says what the
   *  renderer believes the ground is made of, which is a question about this
   *  program rather than about the planet, and it belongs beside the tile
   *  counts and the ring state rather than beside COVER and ECO. */
  debug?: boolean;
}

export type ChartLayerId = 'roads' | 'places' | 'cover' | 'eco' | 'substrate';

/**
 * THE TABLE. Order is the order on the key, and the key reads top-down as the
 * map is built up: the base map first, then the thematic sheets under it.
 *
 * `roads` and `places` are one tile's two halves and are split here because
 * they answer different questions at different scales — at a continental zoom
 * the names ARE the map and the road network is a texture, and at a district
 * zoom the reverse. They have always been drawn together and there has never
 * been a way to have one without the other.
 */
export const CHART_LAYERS: readonly ChartLayer[] = Object.freeze([
  Object.freeze({ id: 'roads' as const, name: 'ROADS', kind: 'vector' as const, on: true,
    note: 'the coarse road network, water and coast — the overview ribbons' }),
  Object.freeze({ id: 'places' as const, name: 'PLACES', kind: 'vector' as const, on: true,
    note: 'settlement names, by rank, decluttered on a screen grid' }),
  Object.freeze({ id: 'cover' as const, name: 'COVER', kind: 'thematic' as const, on: false,
    note: 'ESA WorldCover classes as a thematic sheet over the shell' }),
  Object.freeze({ id: 'eco' as const, name: 'ECO', kind: 'thematic' as const, on: false,
    note: 'RESOLVE ecoregions by biome — the partition the guild plants from' }),
  // MATERIAL rather than SUBSTRATE on the chip, and the name is not a
  // compromise: the key's eight-character budget forced the question and the
  // shorter word is the better one. Beside COVER and ECO the three read as one
  // vocabulary — what grows here, what biome this is, what the ground is MADE
  // OF — where "substrate" names the renderer's module rather than the thing
  // the reader is looking at. The id stays `substrate`; a chip's label is a
  // word on glass and an id is a wire format.
  Object.freeze({ id: 'substrate' as const, name: 'MATERIAL', kind: 'thematic' as const,
    on: false, debug: true,
    note: 'what the renderer believes the ground is made of: outcrop, turf, regolith' }),
]);

/** The substrate view's own legend. Fixed rather than tallied: these are not
 *  classes of a dataset that may or may not be in frame, they are the three
 *  components every fragment is a mixture of, and the reader wants to know
 *  which colour means which whether or not any of it is on screen. The inks
 *  are the channel assignment in the shader — red, green, blue — and nothing
 *  is free to choose them differently. */
export const SUBSTRATE_LEGEND: ReadonlyArray<{ name: string; hex: string }> = Object.freeze([
  Object.freeze({ name: 'OUTCROP', hex: '#e03838' }),
  Object.freeze({ name: 'TURF', hex: '#38e038' }),
  Object.freeze({ name: 'REGOLITH', hex: '#3838e0' }),
]);

export const CHART_LAYER_IDS: readonly ChartLayerId[] =
  Object.freeze(CHART_LAYERS.map((l) => l.id));

export const chartLayer = (id: ChartLayerId): ChartLayer | undefined =>
  CHART_LAYERS.find((l) => l.id === id);

/**
 * ── THE PALETTES ──
 *
 * Flat, saturated and FAR APART, which is not a style choice here but the
 * post chain's rule: the composite quantises to fourteen levels and Bayer-
 * dithers, one palette step is about 0.07 sRGB — 18/255 — and anything subtler
 * is eaten. A thematic map whose classes are one step apart is a thematic map
 * with one colour on it.
 *
 * SO EVERY CLASS SITS ON A LATTICE OF 42, and no two in a layer share a
 * lattice point: 14, 56, 98, 140, 182, 224 in each channel, which puts any
 * pair at least two and a third palette steps apart in at least one channel.
 * The hand-picked colours came first and were snapped to it; the snapping is
 * what the test holds, because a palette chosen by eye goes wrong quietly.
 * `chart-layers.test.mjs` measured the first cut's tropical conifer against
 * its mangrove at EIGHT of 255 — half a palette step, two greens that were one
 * green on the glass — which is exactly the kind of thing nobody finds by
 * looking at a legend.
 *
 * They are also deliberately NOT the terrain's colours. `GROUND_RAMPS` paints
 * what a place looks like; this says what a place IS, and a thematic sheet
 * that half-resembles the ground under it reads as a rendering fault rather
 * than as an overlay.
 */
interface ClassInk { name: string; rgb: [number, number, number] }

/** ESA WorldCover, the eleven classes the raster carries. Keyed by the class
 *  BYTE, which is what the tile stores and what `sampleCoverShell` answers. */
export const COVER_INK: Record<number, ClassInk> = {
  10: { name: 'FOREST', rgb: [14, 98, 56] },
  20: { name: 'SCRUB', rgb: [140, 140, 56] },
  30: { name: 'GRASS', rgb: [182, 224, 98] },
  40: { name: 'CROPS', rgb: [224, 140, 56] },
  50: { name: 'BUILT', rgb: [224, 56, 56] },
  60: { name: 'BARE', rgb: [224, 182, 140] },
  70: { name: 'ICE', rgb: [224, 224, 224] },
  80: { name: 'WATER', rgb: [56, 98, 182] },
  90: { name: 'WETLAND', rgb: [56, 182, 182] },
  95: { name: 'MANGROVE', rgb: [14, 140, 98] },
  100: { name: 'LICHEN', rgb: [182, 182, 224] },
};

/**
 * RESOLVE's fourteen biomes. The names are `eco.ts`'s — the long ones, which
 * this shortens for a 148-pixel HUD without changing what the module of record
 * says. Grouped by family so a continent reads as a continent: forests green,
 * grasslands yellow, dry places ochre and orange, cold places pale.
 */
export const ECO_INK: Record<number, ClassInk> = {
  1: { name: 'TROP MOIST', rgb: [14, 98, 56] },
  2: { name: 'TROP DRY', rgb: [98, 140, 56] },
  3: { name: 'TROP CONIFER', rgb: [56, 140, 98] },
  4: { name: 'TEMP BROADLEAF', rgb: [56, 182, 56] },
  5: { name: 'TEMP CONIFER', rgb: [56, 98, 140] },
  6: { name: 'TAIGA', rgb: [98, 140, 182] },
  7: { name: 'TROP SAVANNA', rgb: [224, 182, 56] },
  8: { name: 'TEMP GRASSLAND', rgb: [224, 224, 98] },
  9: { name: 'FLOODED GRASS', rgb: [98, 182, 182] },
  10: { name: 'MONTANE', rgb: [182, 140, 182] },
  11: { name: 'TUNDRA', rgb: [224, 224, 224] },
  12: { name: 'MEDITERRANEAN', rgb: [182, 140, 56] },
  13: { name: 'DESERT', rgb: [224, 182, 140] },
  14: { name: 'MANGROVE', rgb: [14, 140, 98] },
};

/** Nothing is known here — not "no class", which is a class. Fully
 *  transparent, so a thematic sheet never paints over unmeasured ground: an
 *  overlay that fills its gaps with a colour is lying about its coverage, and
 *  the whole value of these layers is that they say where the data IS. */
export const CLASS_NONE: ClassInk = { name: '—', rgb: [0, 0, 0] };

export const inkFor = (layer: ChartLayerId, cls: number): ClassInk | null =>
  (layer === 'cover' ? COVER_INK[cls] : layer === 'eco' ? ECO_INK[cls] : undefined) ?? null;

/** `#rrggbb` for the HUD, which draws in CSS colours. One conversion, so the
 *  swatch on the key and the texel on the sheet cannot drift apart. */
export function inkHex(ink: ClassInk): string {
  const h = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(ink.rgb[0])}${h(ink.rgb[1])}${h(ink.rgb[2])}`;
}

/**
 * WHAT THE KEY SHOULD SAY, from what is actually on the screen.
 *
 * A legend listing every class the dataset defines is eleven or fourteen rows
 * of which two are in view, on a HUD about eighteen characters wide. So the
 * counts come back from the bake — one tally per class over the texels the
 * sheet drew — and the legend is the classes that hold more than `minShare` of
 * them, commonest first, capped. A class occupying a tenth of a percent of the
 * frame is not something a reader is looking for the name of.
 */
export function legendFor(layer: ChartLayerId, counts: Map<number, number>,
  opts: { max?: number; minShare?: number } = {}): Array<{ cls: number; name: string; hex: string; share: number }> {
  const max = opts.max ?? 6, minShare = opts.minShare ?? 0.02;
  let total = 0;
  for (const n of counts.values()) total += n;
  if (total <= 0) return [];
  const rows: Array<{ cls: number; name: string; hex: string; share: number }> = [];
  for (const [cls, n] of counts) {
    const ink = inkFor(layer, cls);
    if (!ink) continue;
    const share = n / total;
    if (share < minShare) continue;
    rows.push({ cls, name: ink.name, hex: inkHex(ink), share });
  }
  rows.sort((a, b) => b.share - a.share);
  return rows.slice(0, max);
}
