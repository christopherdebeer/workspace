/**
 * Session 8 (3 November 2026): A page. What it found and decided, its samples, and how each is made. Recorded once and
 * never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { BOOK } from '../autobiography';
import { page } from '../hands/v5';

const S: SessionFile = {
  session: {
    n: 8, date: '3 November 2026', title: 'A page',
    summary: 'Writing at length, two ways. First the font over a page. Every pair of letters was set side by side and tested for touching anywhere but at a join, and accented capitals were set under a line of descenders at the font\'s own spacing. 0.6 failed both: 158 pairs touched, every one involving a capital, a figure or a mark, and the accents on capitals ran into the line above. Hand v5 gives capitals, figures and marks a little air either side, and writes accents on capitals smaller and just clear of the letter. Font 0.8, built from it, passes both tests, with its lines set a little further apart. Then the hand over a page: page() writes a paragraph in one sitting, with one pace, size and slant for all of it and its lines broken where they fit. Chapter one\'s first paragraph took it nearly three minutes.',
    decided: [
      'The pair test runs on every font the hand makes (devtools/autograph-pairs.py, run by the build), and a font with any pair touching other than at a join fails. No two letters may touch except where they join.',
      'From chapter two on, each chapter opens with a page written by the hand before it\'s set in the font. Chapter one stays as it was. Next: chapter two, about what writing at length has shown. And a first look at the family c15r imagined: whether the hand\'s variation from one sitting to the next (its pace, slant, size) could become variants of the font.',
    ],
  },
  hands: {
    v5: { name: 'hand v5', made: '3 Nov 2026', about: 'v4, with air either side of capitals, figures and marks, smaller accents on capitals written just clear of the letter, and page(): a paragraph written in one sitting, its lines broken as a hand breaks them.' },
  },
  entries: [
    {
      id: 'H001', session: 8, title: 'The page test, in 0.6', hand: 'font', font: '0.6',
      type: [{ text: '7E GE PE ?E TT WW VW 77 3E', size: 40 }, { text: 'gypsy jumps quip, fjord jig pygmy\n\u00c9COUTE \u00c0 \u00ceLE \u00d4T\u00c9 \u00d9 \u00cc \u00c2 \u00c3\ngypsy jig pygmy quip', size: 24, lh: 'normal' }],
      made: 'The worst pairs from testing every pair of letters, and accented capitals set under a line full of descenders, at the font\'s own line spacing.',
      review: 'Set at the font\'s own line spacing, 0.6 shows both faults the page test was looking for. Capitals and figures crowd: in 7E, TT, WW and VW the pen\'s thickness meets its neighbour\'s, because each capital was exactly as wide as what was drawn. And the accents on capitals reach up into the descenders of the line above. Testing every pair of letters found 158 that touched somewhere other than a join. Every one involved a capital, a figure or a mark; no two lowercase letters touched, because they\'re built to join.',
    },
    {
      id: 'H002', session: 8, title: 'The page test, in 0.8', hand: 'font', font: '0.8',
      type: [{ text: '7E GE PE ?E TT WW VW 77 3E', size: 40 }, { text: 'gypsy jumps quip, fjord jig pygmy\n\u00c9COUTE \u00c0 \u00ceLE \u00d4T\u00c9 \u00d9 \u00cc \u00c2 \u00c3\ngypsy jig pygmy quip', size: 24, lh: 'normal' }],
      made: 'The same, set in 0.8, from hand v5.',
      review: 'In 0.8 the same test passes. Capitals, figures and marks have a little air either side, and none of the 5,184 pairs touch except at a join. Accents on capitals are written smaller and just clear of the letter, and the font sets its lines a little further apart (1.4 times the size, up from 1.34), so they clear the descenders above. They clear narrowly. A hand, with its loops and descenders, needs more room between lines than type does, and 1.4 is about the least this one can have. The first attempt at flatter accents put them on the capitals\' tops, where they merged in and ÉÈÊË read as four plain E\'s. That was a correction too far, so they were lifted clear again.',
    },
    {
      id: 'H003', session: 8, title: 'A page in one sitting', hand: 'v5', layout: 'page',
      made: 'Chapter one\'s first paragraph, written by the hand as a page: one sitting, lines broken at thirty x-heights.',
      review: 'This is the one thing the font can\'t do. It\'s one sitting: twelve lines and 486 characters in nearly three minutes, two and a half of them with the pen down. The pace, size and slant are drawn once for the page, so the lines belong together, the slant staying between 16° and 19°. Each line starts a hair off the margin and runs a hair off level, and the lines break where they fit, not where a typesetter would put them. It looks like a page somebody wrote. The font sets letters; the hand writes pages. From chapter two on, each chapter will open with one.',
    },
  ],
  made: {
    /** chapter one's first paragraph, written by the hand as a page in one sitting */
    H003: () => page(BOOK.chapters[0].text[0], 30, 8),
  },
};
export default S;
