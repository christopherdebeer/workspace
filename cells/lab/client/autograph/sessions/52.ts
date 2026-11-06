/**
 * Session 52 (6 November 2026): Marks for the margin. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { writeStyled as v32styled } from '../hands/v32';

/** the marks, a row of each kind, and a line that uses some as I would */
export const MARK_ROWS = ['→ ← ↑ ↓ ↗ ↘ ↙ ↖ ↩ ↪ ⤴ ⤵', '✓ ✗ ✱ ★ ⁂ 〰 • ○ ☐ ☑ ☒ ∴ ∵', '① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨', 'see → this one ✓ ∴ done ★'];
const lit = (t: string) => Array.from(t).map((ch) => ({ ch, e: [] }));

const S: SessionFile = {
  session: {
    n: 52, date: '6 November 2026', title: 'Marks for the margin',
    summary: 'c15r wondered what the equivalent of dingbats would be, to decorate and annotate the pages I write. I thought the marks a hand makes in a margin rather than ornaments: each something I\'d mean by it. Hand v32 adds them, each the Unicode character its meaning has, so they write wherever they\'re typed: arrows to point at a word (four ways, four slants, back at a line, round a corner), a check and a cross, an asterisk and a star, therefore and because, an asterism and a wave to break a section, a circle and boxes (empty, ticked, crossed), and numbers in circles for notes. Where a mark has a point or a corner its sides are strokes of their own meeting there, as session 51 learnt from brackets. Looked at, four needed more: therefore and because read as a colon beside a stop, the dots too small and too near and the hand\'s slant carrying the top dot over one of the others, so the top is drawn as far left as the slant carries it right; the wave was short enough to read as an m; the star and the asterism were cramped. A hand pointing (☞) was drawn and left out: it read as a flag, and the arrows point already. Claude Hand Marks 5.2 is the marks as a font, to set beside any face: 37 characters, eight writings each.',
    decided: [
      'Hand v32: the marks of the margin, written wherever their characters are. Everything else writes as v31; it\'s the newest hand.',
      'Claude Hand Marks 5.2, to set beside any face of Claude Hand. The pair test had nothing to pair in it; the sheet, looked at, is its check.',
      'The pointing hand was tried and left out.',
      'Next: the poster, written in time, its marks among its words.',
    ],
  },
  hands: {
    v32: { name: 'hand v32', made: '6 Nov 2026', about: 'v31, and the marks a hand makes in a margin, each the Unicode character its meaning has, drawn by the pen: arrows (four ways, four slants, back at a line, round a corner), a check and a cross, an asterisk and a star, therefore and because, an asterism and a wave, a circle and boxes, numbers in circles. A point or a corner is made where two strokes meet. Everything without them writes exactly as v31.' },
  },
  entries: [
    {
      id: 'AZ001', session: 52, title: 'The marks, by hand', hand: 'v32', text: MARK_ROWS.join(' '), layout: 'rows',
      made: 'Every mark, a row of each kind, and a line using some as I would (see → this one ✓ ∴ done ★), written by v32 literally (seeds 52 to 55).',
      review: 'Each reads as what it is: the arrows point, the boxes are boxes, the numbers sit in their circles, therefore and because are triangles of three dots. In the line they sit among the words as a hand\'s marks do. It looks right to me.',
    },
    {
      id: 'AZ002', session: 52, title: 'Claude Hand Marks 5.2', hand: 'font', font: '5.2',
      type: [{ text: MARK_ROWS[0], size: 34, family: 'Marks' }, { text: MARK_ROWS[1], size: 34, family: 'Marks' }, { text: MARK_ROWS[2], size: 34, family: 'Marks' }],
      made: 'The marks set in Claude Hand Marks 5.2, as any app sets it.',
      review: 'In type at 34 px they keep their points and corners, and look as the hand draws them.',
    },
  ],
  made: {
    /** each row of marks written by v32, literally (seeds 52 to 55) */
    AZ001: () => MARK_ROWS.map((t, i) => v32styled(lit(t), 52 + i)),
  },
};
export default S;
