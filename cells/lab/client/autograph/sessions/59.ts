/**
 * Session 59 (6 November 2026): A specimen, written. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v34page } from '../hands/v34';

/** the specimen's letters, as it writes them: the small letters with the broad pen */
export const SPEC_LETTERS = 'abcdefghijklm\nnopqrstuvwxyz';

const S: SessionFile = {
  session: {
    n: 59, date: '6 November 2026', title: 'A specimen, written',
    summary: 'Since session 53 the plan had been a specimen written by the hand rather than set: the poster shows the family as type, and nowhere did the hand show itself as a composed sheet. Now the poster ends with one, its seventh plate, and all of it is written: the name with the broad pen across the sheet; the small letters with the broad pen beside the capitals; the figures and the marks of the margin beside a sentence that rises and falls; a page whose ink runs out and is dipped again; and my signature, with the broad pen, to end it. Each block is a writing on a canvas of its own and the page\'s grid lays them out, so the sheet is composed as a page is (six columns on a wide screen, one on a phone) and written as a hand writes: block by block, in order, when it comes into view, each a new writing on every visit, each written again when tapped. Lines of a block are written as a page, one under another: written separately and drawn together, the notebook\'s pen laid them over one another, the examiner\'s way. With reduced motion asked for, it\'s simply there.',
    decided: [
      'The poster\'s seventh plate is a specimen written by the hand, composed by the page\'s grid, written block by block as it comes into view.',
      'It uses everything the pen has: the broad pen for the name, letters and signature, the pen rising and falling, the ink running out.',
      'The three things waiting after session 56 are done: the type caught up (57), the pen in the font (58), and this.',
    ],
  },
  entries: [
    {
      id: 'BG001', session: 59, title: 'The specimen\'s letters', hand: 'v34', text: SPEC_LETTERS, layout: 'page', pen: 'broad',
      made: 'The small letters as the specimen writes them, by v34 as a page of two lines (seed 7), with the broad pen.',
      review: 'Every small letter with the broad pen, joined as the hand joins them, the s in its word, the dots diamonds.',
    },
  ],
  made: {
    BG001: () => v34page(SPEC_LETTERS, 40, 7),
  },
};
export default S;
