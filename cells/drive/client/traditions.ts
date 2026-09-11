import { BUILD_CULTURES, type BuildCulture, type RoofTex, type WallTex } from './culture';
import { FACADE_DEFAULTS, GRAM_ROW_BYTES, gramEncode, type FacadeGrammar } from './facade-grammar';
export { gramDecode, FACADE_DEFAULTS } from './facade-grammar';

/**
 * ── THE TRADITION ATLAS: WHAT A PLACE BUILDS LIKE, WRITTEN DOWN ──
 *
 * The building cultures in culture.ts are picked by CLIMATE — six looks
 * weighted by the five climate terms and a region hash — and climate is the
 * wrong key. Camps Bay came out brick under slate, because a temperate coast
 * is temperate; Suresnes came out limewash; and no refinement of a
 * temperature and a rainfall was ever going to know that the Cape whitewashes
 * and roofs in corrugated iron, that Paris is cut limestone under zinc, or
 * that a Karoo dorp is a rendered box under a red iron roof with a stoep.
 * That is a fact about PEOPLE, and the game already keeps facts about people
 * by hand: LANDMARKS for the monuments, conventionFor for the road markings.
 * This is the third such table, and the biggest.
 *
 * WHY HAND-AUTHORED. The census (morphology.ts) says the tags cannot carry
 * this — five percent of footprints have a level count, a third of a percent
 * a material — and the footprints carry the MASSING but not the wall. An
 * authored entry per building region is a few lines, it is reviewed like the
 * campaign is, and it is right where a climate rule is merely plausible.
 * Everywhere the atlas is silent the climate pick still answers, so a blank
 * region is the old look and not a blank.
 *
 * WHAT AN ENTRY IS. A base culture (its canvases and its palettes are the
 * starting point), the overrides that make the place — paints, wall and roof
 * material, pitch, storey — and the OPENING GRAMMAR: the bay rhythm and the
 * window and door boxes the façade shader draws, as overrides of
 * FACADE_DEFAULTS. Storeys, roof forms, the attached share and how the stock
 * ruins arrive with the phases that read them; a field nothing consumes is
 * a label, and this file has already recorded that lesson twice.
 *
 * WHAT A REGION IS. A lat/lon box, first match wins, specific before broad —
 * Paris inside Île-de-France inside central Europe. Boxes are crude and
 * honest: the drivable world is a few dozen places and a box is what a person
 * can author and check. Every coordinate this game is driven at is in the
 * test, so a box that drifts fails a case by name.
 *
 * THE PALETTES ARE JUDGEMENTS, not measurements; each note says what the
 * entry is modelled on, so the next person can argue with it in the lab
 * (/lab/facade lists every tradition beside the six cultures) and paste the
 * result back.
 */
export interface Tradition {
  key: string;
  /** What the stock is, plainly, and what this entry is modelled on. */
  note: string;
  /** The BuildCulture it starts from. Each field below overrides one of its. */
  base: string;
  wall?: number[];
  roof?: number[];
  wallTex?: WallTex;
  roofTex?: RoofTex;
  /** Base pitch, 0..1. Stated by the atlas; snow does NOT steepen it. */
  pitch?: number;
  storeyM?: number;
  /** The opening grammar, as overrides of FACADE_DEFAULTS. */
  grammar: Partial<FacadeGrammar>;
  /** Storeys of the untyped dwelling, lowest and highest: the stand norm
   *  runs the range and a building's own draw moves it half a storey.
   *  massHeight reads it for houses and the dwelling-sized untyped stock;
   *  blocks, halls, sheds and canopies keep their typology. */
  storeys: [number, number];
  /** Roof forms by weight. building() draws one per building; 'flat' is the
   *  extrusion's cap. Sheds, halls and true blocks keep their typology. */
  roofs: Partial<Record<RoofForm, number>>;
}

export type RoofForm = 'gabled' | 'hipped' | 'pyramidal' | 'skillion' | 'flat';
export const ROOF_FORMS: readonly RoofForm[] = ['gabled', 'hipped', 'pyramidal', 'skillion', 'flat'];

export interface TraditionRegion {
  key: string;
  /** [south, north] and [west, east], degrees. Half-open on the north/east. */
  lat: [number, number];
  lon: [number, number];
  note?: string;
}

export const TRADITIONS: Record<string, Tradition> = {
  haussmann: {
    key: 'haussmann',
    note: 'Paris inside the périphérique: cut limestone ashlar, tall French windows on every floor, a porte cochère, zinc and slate mansards. Six or seven storeys, wall to wall.',
    base: 'limewash', wallTex: 'stone', roofTex: 'slate',
    wall: [0xd8ccb2, 0xe2d7bf, 0xcdc1a6, 0xe9e0cb, 0xd3c6ab],
    roof: [0x5b6067, 0x6a7078, 0x4f545a],
    pitch: 0.62, storeyM: 3.2,
    grammar: { bayM: 3.4, storeyM: 3.2, winX0: 0.28, winX1: 0.72, winY0: 0.1, winY1: 0.9,
      doorX0: 0.34, doorX1: 0.66, doorY1: 0.88, doorShare: 0.18, openShare: 0.92, lintel: 0.32, ivy: 0.05, stain: 0.12 },
    storeys: [5, 7],
    roofs: { hipped: 0.55, gabled: 0.15, flat: 0.3 },
  },
  'ile-de-france': {
    key: 'ile-de-france',
    note: 'The Paris suburbs (Suresnes, Vélizy, Rueil): rendered walls in creams and beige, tile and slate roofs mixed, shuttered windows, two and three storeys, semi-attached.',
    base: 'limewash', roofTex: 'pantile',
    wall: [0xe8dfcc, 0xefe6d4, 0xdcd0b8, 0xe4d8c6, 0xf1eadb, 0xd5c9b0],
    roof: [0x9a5a3e, 0x5a5f66, 0x8a4f38, 0x6a6f76],
    pitch: 0.5, storeyM: 2.9,
    grammar: { bayM: 3.0, storeyM: 2.9, winX0: 0.25, winX1: 0.75, winY0: 0.22, winY1: 0.86, doorShare: 0.3, openShare: 0.82, ivy: 0.5 },
    storeys: [2, 3],
    roofs: { gabled: 0.5, hipped: 0.35, flat: 0.15 },
  },
  cape: {
    key: 'cape',
    note: 'The Cape Peninsula (Camps Bay, Hout Bay, Simon\'s Town, Kommetjie): white and off-white render, flat or shallow roofs in corrugated iron and concrete tile, big sea-facing glass, one and two storeys, detached.',
    base: 'limewash', wallTex: 'render', roofTex: 'corrugated',
    wall: [0xf3f0e8, 0xe9e5d9, 0xdedad0, 0xf6f3ec, 0xe2ddd0, 0xcfd3cf],
    roof: [0x474c52, 0x666b71, 0x8a8f95, 0x8c4a38],
    pitch: 0.2, storeyM: 3.0,
    grammar: { bayM: 3.3, storeyM: 3.0, winX0: 0.14, winX1: 0.86, winY0: 0.22, winY1: 0.9,
      doorX0: 0.35, doorX1: 0.65, doorY1: 0.72, doorShare: 0.22, openShare: 0.88, glassShade: 0.16, ivy: 0.25, stain: 0.1 },
    storeys: [1, 2],
    roofs: { flat: 0.45, hipped: 0.3, gabled: 0.2, skillion: 0.05 },
  },
  'lesotho-highland': {
    key: 'lesotho-highland',
    note: 'The Senqu valley and the Drakensberg foot: dressed-stone and block walls under corrugated iron, small deep windows, one storey. The rondavel cannot be a box and is not attempted.',
    base: 'stone', roofTex: 'corrugated',
    roof: [0x6a6f75, 0x8a3f2e, 0x555a60],
    pitch: 0.3, storeyM: 2.7,
    grammar: { bayM: 2.6, storeyM: 2.7, winX0: 0.32, winX1: 0.68, winY0: 0.4, winY1: 0.76,
      doorX0: 0.36, doorX1: 0.64, doorY1: 0.68, doorShare: 0.42, openShare: 0.6, glassShade: 0.25, ivy: 0, stain: 0.12 },
    storeys: [1, 1],
    roofs: { gabled: 0.55, hipped: 0.15, flat: 0.3 },
  },
  karoo: {
    key: 'karoo',
    note: 'The South African platteland (the Karoo, the Free State, the Overberg): single-storey rendered houses in cream and ochre under red-oxide or grey corrugated iron, a stoep along the front, detached on wide plots.',
    base: 'limewash', roofTex: 'corrugated',
    wall: [0xe8dec8, 0xdccba8, 0xf1e9d8, 0xcdb893, 0xe0d6c2],
    roof: [0x8b3f2f, 0x5c6167, 0x7a7f85, 0x4b5056],
    pitch: 0.32, storeyM: 3.1,
    grammar: { bayM: 3.0, storeyM: 3.1, winX0: 0.26, winX1: 0.74, winY0: 0.3, winY1: 0.84, doorShare: 0.3, openShare: 0.72, ivy: 0.1, stain: 0.1 },
    storeys: [1, 1],
    roofs: { gabled: 0.6, hipped: 0.3, flat: 0.1 },
  },
  'east-africa-savanna': {
    key: 'east-africa-savanna',
    note: 'East African towns and farms (the Serengeti margins, the Rift): fired brick and block, unrendered or rendered ochre, under corrugated iron, one storey, small windows.',
    base: 'brick', roofTex: 'corrugated',
    wall: [0xb27a5c, 0xc58c6a, 0x9d6b4f, 0xd9c6a8, 0xb89a78],
    roof: [0x6d7278, 0x8a3f2e, 0x555a60],
    pitch: 0.3, storeyM: 2.9,
    grammar: { bayM: 2.8, storeyM: 2.9, winX0: 0.3, winX1: 0.7, winY0: 0.4, winY1: 0.8, doorShare: 0.4, openShare: 0.66, ivy: 0, stain: 0.14 },
    storeys: [1, 1],
    roofs: { gabled: 0.6, hipped: 0.3, flat: 0.1 },
  },
  sahel: {
    key: 'sahel',
    note: 'The Sahel and the West African coast (Dakar): rendered concrete in white and ochre, flat roofs behind parapets, one to three storeys, attached along the street.',
    base: 'adobe', roofTex: 'flat',
    wall: [0xe1d4ba, 0xd3ba90, 0xf0e7d3, 0xc5a87c, 0xd8cfbd],
    pitch: 0.05, storeyM: 3.1,
    grammar: { bayM: 2.8, storeyM: 3.1, winX0: 0.3, winX1: 0.7, winY0: 0.36, winY1: 0.8, doorShare: 0.35, openShare: 0.66, glassShade: 0.22, ivy: 0, stain: 0.16 },
    storeys: [1, 3],
    roofs: { flat: 0.9, gabled: 0.05, skillion: 0.05 },
  },
  'north-africa': {
    key: 'north-africa',
    note: 'North Africa and the Sahara\'s towns (Giza, Tamanrasset): concrete frame with brick infill, sand-grey and unpainted more often than not, flat roofs, two to five storeys, wall to wall. Heavy staining under every sill.',
    base: 'adobe', roofTex: 'flat',
    wall: [0xcabb9d, 0xb6a58a, 0xd4c5a8, 0xa0937b, 0xc2b39a],
    pitch: 0.04, storeyM: 3.1,
    grammar: { bayM: 3.0, storeyM: 3.1, winX0: 0.25, winX1: 0.75, winY0: 0.3, winY1: 0.8, doorShare: 0.3, openShare: 0.7, ivy: 0, stain: 0.22 },
    storeys: [2, 5],
    roofs: { flat: 0.95, skillion: 0.05 },
  },
  mediterranean: {
    key: 'mediterranean',
    note: 'The Mediterranean rim (Provence, Liguria, the Spanish coasts): the ochre culture as it ships, with narrow bays and small shuttered windows, pantiles, two and three storeys, attached.',
    base: 'ochre',
    grammar: { bayM: 2.6, storeyM: 3.1, winX0: 0.3, winX1: 0.7, winY0: 0.3, winY1: 0.8, doorShare: 0.35, openShare: 0.72, glassShade: 0.14, ivy: 0.6 },
    storeys: [2, 3],
    roofs: { gabled: 0.6, hipped: 0.3, flat: 0.1 },
  },
  alpine: {
    key: 'alpine',
    note: 'The Alps (Valais, the Stelvio, the Tyrol): dark larch chalets on a stone base, close-set small windows, wide eaves under stone slab or slate, two and three storeys, detached.',
    base: 'timber', roofTex: 'slate',
    wall: [0x5e4030, 0x70503a, 0x4d3527, 0x7d5d46, 0x8a6a52],
    roof: [0x4f5358, 0x5d6166, 0x45494e],
    pitch: 0.5, storeyM: 2.6,
    grammar: { bayM: 2.4, storeyM: 2.6, winX0: 0.26, winX1: 0.74, winY0: 0.36, winY1: 0.8, doorShare: 0.3, openShare: 0.76, ivy: 0, stain: 0.1 },
    storeys: [2, 3],
    roofs: { gabled: 0.9, hipped: 0.05, skillion: 0.05 },
  },
  'swiss-mittelland': {
    key: 'swiss-mittelland',
    note: 'The Swiss plateau (Bern, Rubigen): rendered walls in cream and grey under steep clay-tile roofs with wide eaves, hipped as often as gabled, two and three storeys.',
    base: 'limewash', roofTex: 'pantile',
    wall: [0xe6e1d3, 0xd9d4c4, 0xefeadf, 0xcfc9b8, 0xe2dccb],
    roof: [0x8b4a34, 0x6e3f30, 0x9a5a40, 0x5c4e48],
    pitch: 0.6, storeyM: 2.9,
    grammar: { bayM: 3.0, storeyM: 2.9, winX0: 0.25, winX1: 0.75, winY0: 0.3, winY1: 0.85, doorShare: 0.3, openShare: 0.8, ivy: 0.3 },
    storeys: [2, 3],
    roofs: { gabled: 0.5, hipped: 0.4, flat: 0.1 },
  },
  netherlands: {
    key: 'netherlands',
    note: 'The Low Countries: brick in reds and browns, tall windows nearly floor to ceiling, steep gabled pantile roofs in orange and black, two and three storeys, terraced.',
    base: 'brick', roofTex: 'pantile',
    wall: [0x8b4a3a, 0x9c5a46, 0x7a4234, 0xa6604a, 0x6e3c30, 0x8f5545],
    roof: [0x9a5136, 0x4e4340, 0x7a4a3a, 0x3f3a38],
    pitch: 0.66, storeyM: 2.9,
    grammar: { bayM: 3.0, storeyM: 2.9, winX0: 0.22, winX1: 0.78, winY0: 0.14, winY1: 0.88, doorShare: 0.3, openShare: 0.86, lintel: 0.2, ivy: 0.3 },
    storeys: [2, 3],
    roofs: { gabled: 0.75, hipped: 0.15, flat: 0.1 },
  },
  'british-isles': {
    key: 'british-isles',
    note: 'Britain and Ireland: brick and stone terraces under slate, sash windows, a render here and there, two storeys, attached in runs.',
    base: 'brick', roofTex: 'slate',
    wall: [0x8f5a48, 0x7d4d3e, 0xa87360, 0xb0aa9d, 0xe3ddd0, 0x86584a],
    roof: [0x51565c, 0x464b51, 0x5c6167],
    pitch: 0.6, storeyM: 2.8,
    grammar: { bayM: 2.9, storeyM: 2.8, winX0: 0.22, winX1: 0.78, winY0: 0.28, winY1: 0.85, doorShare: 0.36, openShare: 0.8, ivy: 0.5 },
    storeys: [2, 2],
    roofs: { gabled: 0.7, hipped: 0.25, flat: 0.05 },
  },
  nordic: {
    key: 'nordic',
    note: 'Scandinavia: painted timber — falu red, ochre, white — under steep dark roofs, one and two storeys, detached.',
    base: 'timber', roofTex: 'slate',
    wall: [0x8b2f24, 0xa33a2c, 0xd9a441, 0xe8e4d8, 0x6b4a34, 0xc9b98a],
    roof: [0x3f4246, 0x8c4a34, 0x4a4d52],
    pitch: 0.7, storeyM: 2.6,
    grammar: { bayM: 2.6, storeyM: 2.6, winX0: 0.25, winX1: 0.75, winY0: 0.34, winY1: 0.82, doorShare: 0.3, openShare: 0.76, ivy: 0.15, stain: 0.1 },
    storeys: [1, 2],
    roofs: { gabled: 0.9, hipped: 0.1 },
  },
  'central-europe': {
    key: 'central-europe',
    note: 'The rest of temperate Europe: rendered walls in pale creams and greys, tile and slate, two and three storeys, semi-attached. The broad fallback under the specific European boxes.',
    base: 'limewash', roofTex: 'pantile',
    wall: [0xe9e2d2, 0xdcd3c1, 0xf0ebe0, 0xd2c8b4, 0xe4dccb, 0xc8bfae],
    roof: [0x8f4e38, 0x5a4a44, 0x9c5a40, 0x6a5a52],
    pitch: 0.58, storeyM: 2.9,
    grammar: { bayM: 3.0, storeyM: 2.9, winX0: 0.24, winX1: 0.76, winY0: 0.3, winY1: 0.85, doorShare: 0.32, openShare: 0.8 },
    storeys: [2, 3],
    roofs: { gabled: 0.6, hipped: 0.3, flat: 0.1 },
  },
  'california-coastal': {
    key: 'california-coastal',
    note: 'The Monterey and Big Sur coast (Carmel Highlands): timber frame in painted board and shingle — greys, whites, sage — under low shingle roofs, wide windows, one and two storeys, detached on the hillside.',
    base: 'timber', roofTex: 'shingle',
    wall: [0xdad4c4, 0xb9b19b, 0x9ba590, 0xc8b68f, 0xe2ddcd, 0x8e8b7d],
    roof: [0x5a5147, 0x6f665a, 0x4b443c],
    pitch: 0.35, storeyM: 2.9,
    grammar: { bayM: 3.4, storeyM: 2.9, winX0: 0.15, winX1: 0.85, winY0: 0.3, winY1: 0.86,
      doorX0: 0.36, doorX1: 0.64, doorY1: 0.72, doorShare: 0.24, openShare: 0.86, glassShade: 0.18, ivy: 0.3, stain: 0.08 },
    storeys: [1, 2],
    roofs: { gabled: 0.55, hipped: 0.25, skillion: 0.1, flat: 0.1 },
  },
  sierra: {
    key: 'sierra',
    note: 'The Sierra Nevada (Yosemite, Mariposa): dark-stained timber cabins under steep shingle and metal, small windows, one and two storeys, detached in the trees.',
    base: 'timber', roofTex: 'shingle',
    wall: [0x5a4030, 0x6b4c3a, 0x4a3326, 0x7c5a44, 0x8a6a52],
    roof: [0x4b443c, 0x5a5147, 0x3c3630],
    pitch: 0.7, storeyM: 2.7,
    grammar: { bayM: 2.8, storeyM: 2.7, winX0: 0.26, winX1: 0.74, winY0: 0.36, winY1: 0.8, doorShare: 0.34, openShare: 0.7, ivy: 0, stain: 0.1 },
    storeys: [1, 2],
    roofs: { gabled: 0.8, skillion: 0.15, hipped: 0.05 },
  },
  'southwest-desert': {
    key: 'southwest-desert',
    note: 'The American Southwest (Death Valley, San Juan County, the Sonoran towns): adobe and stucco in earth tones, flat roofs behind parapets, small deep windows, one storey, detached.',
    base: 'adobe', roofTex: 'flat',
    wall: [0xc9a67d, 0xb9956b, 0xd5b58f, 0xa9875e, 0xc4a480],
    pitch: 0.05, storeyM: 3.0,
    grammar: { bayM: 2.6, storeyM: 3.0, winX0: 0.3, winX1: 0.7, winY0: 0.4, winY1: 0.76, doorShare: 0.35, openShare: 0.64, glassShade: 0.22, ivy: 0, stain: 0.06 },
    storeys: [1, 1],
    roofs: { flat: 0.8, gabled: 0.15, skillion: 0.05 },
  },
  'us-general': {
    key: 'us-general',
    note: 'The contiguous United States, where nothing more specific is written: timber frame in white and pale siding under gabled asphalt shingle, one and two storeys, detached.',
    base: 'timber', roofTex: 'shingle',
    wall: [0xe8e6de, 0xd0cec5, 0xd9ceb5, 0xb8c1b9, 0xe3dac7, 0xa9a89f],
    roof: [0x4b4a46, 0x565650, 0x40403c, 0x6a5a52],
    pitch: 0.5, storeyM: 2.8,
    grammar: { bayM: 3.2, storeyM: 2.8, winX0: 0.22, winX1: 0.78, winY0: 0.3, winY1: 0.86, doorShare: 0.3, openShare: 0.8, ivy: 0.2 },
    storeys: [1, 2],
    roofs: { gabled: 0.6, hipped: 0.3, flat: 0.1 },
  },
  'andes-altiplano': {
    key: 'andes-altiplano',
    note: 'The Altiplano (Colcha K, the Uyuni margins): unrendered adobe brick under corrugated iron, tiny windows against the cold and the sun, one storey, attached along the street.',
    base: 'adobe', roofTex: 'corrugated',
    wall: [0xb18b63, 0xa17b55, 0xc19b71, 0x906f4d, 0xb5946e],
    roof: [0x7a4a3a, 0x6d7278, 0x8a3f2e],
    pitch: 0.25, storeyM: 2.6,
    grammar: { bayM: 2.4, storeyM: 2.6, winX0: 0.35, winX1: 0.65, winY0: 0.45, winY1: 0.75,
      doorX0: 0.36, doorX1: 0.64, doorY1: 0.7, doorShare: 0.45, openShare: 0.56, glassShade: 0.28, ivy: 0, stain: 0.1 },
    storeys: [1, 1],
    roofs: { gabled: 0.6, flat: 0.3, skillion: 0.1 },
  },
  amazon: {
    key: 'amazon',
    note: 'Amazonia\'s towns (Manaus): rendered concrete in strong paint — ochre, blue, lime — under corrugated iron and tile, one and two storeys, attached, and stained by the wet season.',
    base: 'ochre', roofTex: 'corrugated',
    wall: [0xd9a05b, 0x6fa8c8, 0xc8d2a0, 0xe0bc8c, 0xc07a52, 0xe6e1d3],
    roof: [0x8a3f2e, 0x6d7278, 0x9a5a40],
    pitch: 0.3, storeyM: 3.0,
    grammar: { bayM: 2.8, storeyM: 3.0, winX0: 0.28, winX1: 0.72, winY0: 0.34, winY1: 0.82, doorShare: 0.36, openShare: 0.7, ivy: 0.4, stain: 0.3 },
    storeys: [1, 2],
    roofs: { gabled: 0.5, hipped: 0.3, flat: 0.2 },
  },
  'bengal-delta': {
    key: 'bengal-delta',
    note: 'The Ganges delta (the Sundarbans margins): brick and concrete, rendered or bare, flat roofs, one to three storeys, and the heaviest monsoon staining in the atlas.',
    base: 'brick', roofTex: 'flat',
    wall: [0xa96b53, 0xc1856b, 0x8f5b45, 0xd7c1a9, 0xb8a58c, 0xe0d6c4],
    pitch: 0.08, storeyM: 3.0,
    grammar: { bayM: 2.8, storeyM: 3.0, winX0: 0.28, winX1: 0.72, winY0: 0.34, winY1: 0.8, doorShare: 0.36, openShare: 0.7, ivy: 0.3, stain: 0.34 },
    storeys: [1, 3],
    roofs: { flat: 0.7, gabled: 0.2, hipped: 0.1 },
  },
  australia: {
    key: 'australia',
    note: 'Australia: brick veneer and weatherboard under hipped corrugated iron, one storey, detached on a wide plot.',
    base: 'brick', roofTex: 'corrugated',
    wall: [0xa9674b, 0xc18b6f, 0xe7e0d3, 0xdad4c4, 0xb59a7e, 0x8f5a48],
    roof: [0x4a4f54, 0x8c4a38, 0x6d7278, 0x3f4a3f],
    pitch: 0.3, storeyM: 2.8,
    grammar: { bayM: 3.2, storeyM: 2.8, winX0: 0.2, winX1: 0.8, winY0: 0.3, winY1: 0.85, doorShare: 0.3, openShare: 0.8, ivy: 0.2 },
    storeys: [1, 1],
    roofs: { hipped: 0.5, gabled: 0.4, skillion: 0.1 },
  },
};

/**
 * FIRST MATCH WINS, SO THE SPECIFIC BOXES COME FIRST. Paris before
 * Île-de-France before central Europe; the Cape before the platteland; the
 * Alps before the Swiss plateau before central Europe. Where two boxes
 * genuinely overlap (Algiers falls in the Mediterranean box's latitudes) the
 * earlier entry answers, and the note says so rather than growing a polygon.
 */
export const TRADITION_REGIONS: readonly TraditionRegion[] = [
  { key: 'haussmann', lat: [48.815, 48.905], lon: [2.245, 2.42], note: 'Paris inside the périphérique' },
  { key: 'ile-de-france', lat: [48.4, 49.3], lon: [1.6, 3.2] },
  { key: 'cape', lat: [-34.45, -33.6], lon: [18.25, 18.95], note: 'the Cape Peninsula and the city bowl' },
  { key: 'lesotho-highland', lat: [-31.0, -28.5], lon: [27.0, 29.6] },
  { key: 'karoo', lat: [-35, -22], lon: [15, 33], note: 'southern Africa outside the Cape and Lesotho' },
  { key: 'east-africa-savanna', lat: [-12, 5], lon: [28, 42] },
  { key: 'sahel', lat: [4, 22], lon: [-18, 40] },
  { key: 'mediterranean', lat: [36.3, 44.5], lon: [-9.5, 18], note: 'takes Algiers and Tunis with it; a box, not a coastline' },
  { key: 'north-africa', lat: [22, 37.5], lon: [-17, 36] },
  { key: 'alpine', lat: [45.7, 46.75], lon: [5.9, 12.5], note: 'the main Alpine chain' },
  { key: 'alpine', lat: [46.6, 47.6], lon: [9.8, 13.2], note: 'the Tyrol and the eastern Alps' },
  { key: 'swiss-mittelland', lat: [46.6, 47.9], lon: [5.9, 9.8] },
  { key: 'netherlands', lat: [50.7, 53.6], lon: [3.3, 7.3] },
  { key: 'british-isles', lat: [49.9, 59], lon: [-11, 2] },
  { key: 'nordic', lat: [57, 71.5], lon: [4, 32] },
  { key: 'central-europe', lat: [44.5, 60], lon: [-11, 32] },
  { key: 'california-coastal', lat: [35.5, 37.2], lon: [-122.6, -121.4] },
  { key: 'sierra', lat: [36.4, 38.6], lon: [-120.6, -118.9] },
  { key: 'southwest-desert', lat: [31, 38.6], lon: [-118.2, -108] },
  { key: 'us-general', lat: [25, 49.5], lon: [-125, -66] },
  { key: 'andes-altiplano', lat: [-24, -13], lon: [-71, -63.5] },
  { key: 'amazon', lat: [-11, 5.5], lon: [-76, -44] },
  { key: 'bengal-delta', lat: [21, 27], lon: [86, 93] },
  { key: 'australia', lat: [-44, -10], lon: [112, 154] },
];

/** The tradition at a point, or null where the atlas is silent — and null
 *  means the climate pick answers, not a blank. */
export function traditionFor(lat: number, lon: number): Tradition | null {
  for (const r of TRADITION_REGIONS) {
    if (lat >= r.lat[0] && lat < r.lat[1] && lon >= r.lon[0] && lon < r.lon[1]) return TRADITIONS[r.key] ?? null;
  }
  return null;
}

/** The tradition as a BuildCulture: its base with the overrides applied, so
 *  buildLookAt, registerCulturePaint and the lab all take it exactly as they
 *  take one of the six. The key is the tradition's, which is how BuildLook
 *  and the __culture probe say where the look came from. */
export function traditionCulture(t: Tradition): BuildCulture {
  const base = BUILD_CULTURES.find((c) => c.key === t.base) ?? BUILD_CULTURES[0];
  return {
    ...base,
    key: t.key,
    wall: t.wall ?? base.wall,
    roof: t.roof ?? base.roof,
    wallTex: t.wallTex ?? base.wallTex,
    roofTex: t.roofTex ?? base.roofTex,
    pitch: t.pitch ?? base.pitch,
    storeyM: t.storeyM ?? base.storeyM,
  };
}

/** The traditions in a fixed order: row i of the grammar texture is
 *  TRADITION_LIST[i], and a building's aGram is i + 1 (0 is "no tradition —
 *  the uniforms"). Insertion order of the table, which is stable as long as
 *  entries are appended; an entry moved would re-dress every building on
 *  the next deploy, so append. */
export const TRADITION_LIST: readonly string[] = Object.keys(TRADITIONS);

/** aGram for a tradition key: its row plus one, and 0 for none. */
export function traditionIndex(key: string | undefined | null): number {
  if (!key) return 0;
  const i = TRADITION_LIST.indexOf(key);
  return i < 0 ? 0 : i + 1;
}

/** Every tradition's full grammar (the defaults with its overrides) as the
 *  bytes of the shader's lookup texture, one row each, in TRADITION_LIST
 *  order. Pure, so the test can decode what the shader will read. */
// Uint8Array<ArrayBuffer>, not Uint8Array: three's DataTexture takes a
// BufferSource, which TypeScript 5.7+ types as a view over a plain
// ArrayBuffer — the same annotation HydroTileField's arrays needed.
export function gramTable(): { data: Uint8Array<ArrayBuffer>; rows: number } {
  const rows = TRADITION_LIST.length;
  const data = new Uint8Array(Math.max(1, rows) * GRAM_ROW_BYTES);
  TRADITION_LIST.forEach((key, i) => {
    gramEncode({ ...FACADE_DEFAULTS, ...TRADITIONS[key].grammar }, data, i * GRAM_ROW_BYTES);
  });
  return { data, rows };
}

/** One roof form for a building of this tradition, from a draw u in [0,1):
 *  the weights laid end to end. null where the entry names none. */
export function roofFormFor(t: Tradition, u: number): RoofForm | null {
  let total = 0;
  for (const f of ROOF_FORMS) total += t.roofs[f] ?? 0;
  if (total <= 0) return null;
  let acc = 0;
  for (const f of ROOF_FORMS) {
    acc += (t.roofs[f] ?? 0) / total;
    if (u < acc) return f;
  }
  return ROOF_FORMS[ROOF_FORMS.length - 1];
}

/**
 * ── HOW A WALL RUINS DEPENDS ON WHAT IT IS MADE OF ──
 *
 * The ruin path stood every building on earth down the same way: walls kept
 * half to 85% of their height, one bay in eight fell entirely, every bay was
 * 55 to 67 cm thick, and the whole world's rubble was one grey (0x9a8f7c).
 * A timber house does not ruin like a stone one — it burns and rots to low
 * stubs with most bays gone, while ashlar stands nearly to its eaves and
 * loses a corner; earth erodes to thick rounded stumps; render washes off
 * masonry and leaves it grey. Keyed by the wall material the tradition (or
 * the culture) built with, so a Paris shell and a Sierra one differ before
 * their colour does. `grey` is how much of the building's own paint the
 * weather has taken: limewash to grey, brick keeps its red, stone was never
 * painted.
 */
export interface RuinProfile {
  /** Standing height as a share of the building's, lowest and highest. */
  stand: [number, number];
  /** The least a wall stands, metres — under this a ruin is a footprint.
   *  Masonry keeps a person's height; a burnt frame keeps a sill. Measured
   *  before it existed: a single 2.4 m floor put timber at a 0.6 share
   *  against a stated 0.15–0.45, because two storeys of 2.9 m is 5.8 m and
   *  2.4 is already 0.41 of it. */
  floorM: number;
  /** Share of bays that came down entirely. */
  bayLoss: number;
  /** Bay width, metres. */
  bay: number;
  /** Wall thickness, metres, lowest and highest. */
  thick: [number, number];
  /** How ragged the skyline is: 1 lets a bay keep as little as 42% of the
   *  standing height, 0 is a level cut. */
  ragged: number;
  /** How far the paint has gone toward weathered grey, 0..1. */
  grey: number;
}

export const RUIN_BY_MATERIAL: Record<WallTex, RuinProfile> = {
  // Lime render over masonry: the shipped profile, and the render gone.
  render: { stand: [0.5, 0.85], floorM: 2.4, bayLoss: 0.12, bay: 2.6, thick: [0.55, 0.67], ragged: 1, grey: 0.5 },
  // Ashlar stands: tall, even, a corner lost, its own colour throughout.
  stone: { stand: [0.62, 0.95], floorM: 2.4, bayLoss: 0.06, bay: 2.4, thick: [0.6, 0.8], ragged: 0.45, grey: 0.15 },
  // Brick holds its red and most of its height; the parapets go first.
  brick: { stand: [0.5, 0.85], floorM: 2.4, bayLoss: 0.1, bay: 2.6, thick: [0.45, 0.6], ragged: 0.65, grey: 0.3 },
  // Timber burns and rots: low stubs, most bays gone, silvered.
  timber: { stand: [0.15, 0.45], floorM: 1.1, bayLoss: 0.3, bay: 3.0, thick: [0.35, 0.5], ragged: 0.9, grey: 0.55 },
  // Earth erodes: thick rounded stumps, half height, still the colour of the ground.
  adobe: { stand: [0.3, 0.6], floorM: 1.6, bayLoss: 0.15, bay: 2.6, thick: [0.7, 1.0], ragged: 0.75, grey: 0.35 },
};
