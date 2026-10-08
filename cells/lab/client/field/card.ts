/**
 * A find's card: the seal card shell Markovs Chains uses (seals/seal.ts `card`), the find's own seal
 * in it at its finest, its name and number and the day it was recorded — drawn in light by the page
 * (every line and word lit, nothing solid) — and a few lines about it, as a journal would have them.
 */
import { hash } from '../kit/rng';
import { card as sealCard } from '../seals/seal';
import { pick } from '../crystals/mineral';
import { findSeal, GLYPH, STYLE } from './emblem';
import type { Find, FindKind } from './finds';

export interface Recorded { kind: FindKind; seed: number; name: string; id: string; reach?: number }
/** the seal's place on the card (mm) */
const SEAL_AT = { x: 31.5, y: 41.2, r: 22.5 };
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export function cardFor(f: Find | Recorded, wood: number, at: number): string {
  const st = STYLE[f.kind];
  const inner = findSeal(f.kind, f.seed, 3).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const k = SEAL_AT.r / 62;
  return sealCard({
    style: st, seed: hash(wood, f.seed), faces: null, id: `c${f.seed}`, rank: 1,
    title: `${GLYPH[f.kind]} · ${f.kind === 'crystal' ? 'MINERAL' : 'FUNGUS'}`,
    index: { rank: GLYPH[f.kind], glyph: '', color: st.ink },
    body: { svg: `<g transform="translate(${SEAL_AT.x} ${SEAL_AT.y}) scale(${k.toFixed(4)})">${inner}</g>`, zone: { k: 'circle', c: [SEAL_AT.x, SEAL_AT.y], r: SEAL_AT.r } },
    caption: { line: f.name.length > 22 ? f.name.slice(0, 21) + '…' : f.name, sum: `No. ${f.seed} · ${fmtDate(at)}` },
  }).svg;
}
/** a few lines on it, as a journal would have them */
export function notes(f: Find | Recorded): string {
  const reach = 'reach' in f && f.reach ? f.reach : 36;
  if (f.kind === 'crystal') {
    const sp = pick(f.seed);
    return `${sp.name}, broken up out of the ground: ${sp.kind} grown past any size it has a right to. The litter crusted pale for ${reach} m about it, the ground split; the trees near it gone to stone. Through it, the wood behind, bent; in it, the wood about.`;
  }
  return `${f.name}, grown gigantic: caps over the canopy, a ring of lesser ones ${Math.round(reach * 0.8)} m out where the grass runs lush. The ground between white with threads; the trees dark and soft, crusted at the foot.`;
}

