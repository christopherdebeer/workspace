/** The specimen (from session 59): a sheet written by the hand, not set. Each block is a writing on a canvas of its own,
 * laid out by the page's grid, so the sheet is composed as a page is and written as a hand writes: the name with the
 * broad pen, large; the small letters and the capitals; the figures and the marks; a sentence that rises and falls; a page
 * whose ink runs out and is dipped again; and my signature to end it. It writes itself block by block, in order, when it
 * comes into view; with reduced motion asked for, it's simply there. Every visit is a new writing (the seed). */
import type { Sig } from '../../switchback/sign';
import { paint, replay, type Look } from '../ink';
import { lookOf, sized } from './ui';

type Hand = { write: (text: string, seed: number) => Sig; page: (text: string, width: number, seed: number) => Sig[]; signature: (seed: number) => Sig };
type Block = { cls: string; label: string; make: (seed: number) => Sig[]; look: Partial<Look>; most: number };

/** the blocks, in the order they're written (lines of a block written as a page, one under another): what each is, how it's made, with which pen, and how tall it may be */
const BLOCKS = (H: Hand): Block[] => [
  { cls: 'sp-name', label: 'Claude Hand, with the broad pen', make: (s) => [H.write('Claude Hand', s)], look: { pen: 'broad', weight: 1.1 }, most: 280 },
  { cls: 'sp-lower', label: 'the small letters, with the broad pen', make: (s) => H.page('abcdefghijklm\nnopqrstuvwxyz', 40, s), look: { pen: 'broad', solid: true }, most: 220 },
  { cls: 'sp-upper', label: 'the capitals', make: (s) => H.page('ABCDEFGHIJKLM\nNOPQRSTUVWXYZ', 40, s), look: { solid: true }, most: 200 },
  { cls: 'sp-figs', label: 'figures, and the marks a hand makes in a margin', make: (s) => H.page('0123456789 & ? !\n→ ✓ ✗ ★ ∴ ① ②', 40, s), look: { solid: true }, most: 180 },
  { cls: 'sp-rise', label: 'rising, then falling', make: (s) => H.page('It <rising>gets louder, and louder</rising>, then <falling>trails away to almost nothing</falling>.', 24, s), look: { solid: true }, most: 200 },
  { cls: 'sp-page', label: 'a page, the ink running out and dipped at a pause', make: (s) => H.page('The Moving Finger writes; and, having writ, Moves on: nor all thy Piety nor Wit Shall lure it back to cancel half a Line, Nor all thy Tears wash out a Word of it.', 22, s), look: { dip: true, solid: true }, most: 420 },
  { cls: 'sp-sign', label: 'and signed', make: (s) => [H.signature(s)], look: { pen: 'broad', weight: 1.1 }, most: 160 },
];

export function buildSpecimen(root: HTMLElement, H: Hand, seed: number) {
  const blocks = BLOCKS(H).map((b, i) => {
    const fig = document.createElement('figure');
    fig.className = `sp ${b.cls}`;
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', b.label);
    const cap = document.createElement('figcaption'); cap.textContent = b.label;
    fig.append(cv, cap); root.append(fig);
    return { ...b, cv, sigs: b.make(seed + 97 * (i + 1)), played: false };
  });
  const look = (b: (typeof blocks)[number]) => (): Look => ({ ...lookOf('ink'), solid: true, ...b.look });
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const size = () => { for (const b of blocks) { sized(b.cv, b.sigs, b.most); paint(b.cv, b.sigs, b.played || still ? look(b)() : { ...look(b)(), upTo: 0 }); } };
  for (const b of blocks) b.cv.addEventListener('click', () => replay(b.cv, b.sigs, look(b)));
  size();
  if (!still) {
    // (block by block, in order, once the sheet is in view)
    const seen = new IntersectionObserver(async (es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      for (const b of blocks) { b.played = true; await new Promise<void>((done) => replay(b.cv, b.sigs, look(b), done)); }
    }, { threshold: 0.15 });
    seen.observe(root);
  }
  return { size };
}
