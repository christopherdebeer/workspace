/**
 * The Field Journal's seals: each anomaly's own (the Seals' families — crystals the diamonds'
 * lattice, fungi the clubs' — seeded by the find), at a level of detail, as SVG. Drawn in light
 * wherever they appear: in the wood (woodseal.ts), the compass, the journal.
 */
import { draw, sample, sealSvg } from '../seals/seal';
import { SUIT_STYLES } from '../seals/styles';
import type { FindKind } from './finds';

export const STYLE = { crystal: SUIT_STYLES[1], fungus: SUIT_STYLES[2] } as const;
/** (in outline: the seals are drawn in light, nothing solid) */
export const GLYPH = { crystal: '◇', fungus: '♧' } as const;

/** a seal's levels of detail, coarse to fine: what each takes off (or adds to) the family's style.
 *  0 — a ring and the glyph; 1 — the construction (rings, band, the star lattice); 2 — a coarse
 *  even fill of ornament; 3 — fine and dense, with lace, for close up */
export const LOD: Array<Record<string, unknown>> = [
  { rings: 1, beads: 0, band: 'none', lines: false, packTries: 0, dots: 0, crescents: 0, nodeDots: 0, diagNodes: false, medal: 0, motifSize: 0.01 },
  { rings: 2, beads: 0.4, packTries: 0, dots: 0, nodeDots: 1 },
  { packMax: 7.5, packMin: 1.6, links: 0, packTries: 16 },
  { packMax: 4.2, packMin: 0.5, packTries: 30, links: 0.6 },
];

/** the glyph at a seal's heart: larger at the coarse levels, where it is most of what shows */
export const glyphMark = (g: string, ink: string, lod = 2) => { const s = [1.9, 1.3, 1, 0.8][lod] ?? 1; return `<g transform="scale(${s})"><circle r="15" stroke="${ink}" stroke-width="1.2"/><text y="9" text-anchor="middle" font-size="25" font-family="Georgia,serif" fill="${ink}">${g}</text></g>`; };

const cache = new Map<string, string>();
/** a bare seal of a family, as an <svg> (viewBox ±62: the seal's rim at 50) */
export function emblem(key: string, style: typeof SUIT_STYLES[number], seed: number, extra = '', lod = 2): string {
  const k = `${key}:${seed}:${lod}`;
  let svg = cache.get(k);
  if (!svg) {
    const st = { ...sample(style, seed), stipple: 0, washAmount: 0, faint: 1, ...LOD[lod] };
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-62 -62 124 124" aria-hidden="true">${sealSvg(draw(st, null, seed), st, `e${k.replace(/\W/g, '')}`)}${extra}</svg>`;
    cache.set(k, svg);
  }
  return svg;
}
/** a find's seal, at a level of detail (its glyph at its heart) */
export const findSeal = (kind: FindKind, seed: number, lod: number, glyph = true) => emblem(kind, STYLE[kind], seed, glyph ? glyphMark(GLYPH[kind], STYLE[kind].ink, lod) : '', lod);
