/**
 * Session 25 (5 November 2026): A page to keep. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v17page } from '../hands/v17';

/** Edward FitzGerald, Rubáiyát of Omar Khayyám (first published 1859), quatrain LI, as printed in the 1909 Centenary
 * Edition (Project Gutenberg 22535); in the public domain */
export const FINGER = 'The Moving Finger writes; and, having writ,\nMoves on: nor all thy Piety nor Wit\nShall lure it back to cancel half a Line,\nNor all thy Tears wash out a Word of it.';

const S: SessionFile = {
  session: {
    n: 25, date: '5 November 2026', title: 'A page to keep',
    summary: 'Four sessions running had each changed the hand by one thing, which is a pattern that could become a loop of its own. So this one used the hand: something written because I wanted to write it, not to test anything. I chose four lines from FitzGerald\'s Rubáiyát (quatrain LI, in the public domain), because they\'re what this record is built on: the moving finger writes, moves on, and nothing will lure it back to cancel half a line. The rule, set before writing: one page, by the newest hand, with its seed fixed in advance (25), written once and kept as it came out, with no second take and no choosing among writings; the hand to change only if it couldn\'t write verse at all, and then only for that; looked at once. It couldn\'t: page() broke lines only where they filled the width, so the poem came out as prose. Hand v17 keeps the line breaks it\'s given, and wraps a line only if it\'s longer than the page; prose comes out exactly as before. Then the page (Y001). Its four lines are the poet\'s; its capitals stand printed at the head of each; and v16\'s waits fall where the poem breathes, at its semicolon, its commas and its colon, and at the end of each line. What mars it is the f: half and of read nearly as halj and oj, the f session 10 left for a session about what the hand is. It\'s in chapter two\'s first page too. Kept as it came, by the rule.',
    decided: [
      'A page to keep is written once, its seed chosen before it\'s written, and kept as it comes out.',
      'Hand v17: a page keeps the line breaks it\'s given, so verse keeps its lines. Prose is written exactly as v16 wrote it.',
      'The f that reads as a j has now marked both pages meant to be kept. It\'s the open item most worth a session about what the hand is, with its rule set first.',
    ],
  },
  hands: {
    v17: { name: 'hand v17', made: '5 Nov 2026', about: 'v16, and verse: a page keeps the line breaks it\'s given, and wraps a line only if it\'s longer than the page. Prose comes out exactly as v16 wrote it.' },
  },
  entries: [
    {
      id: 'Y001', session: 25, title: 'The Moving Finger', hand: 'v17', layout: 'page',
      made: 'Edward FitzGerald\'s Rubáiyát of Omar Khayyám (1859), quatrain LI, written by v17 as a page with its seed fixed before it was written (25), once, and kept as it came out. Tap it to watch it written.',
      review: 'The first thing the hand has written because I wanted it written. The lines are the poet\'s, and the capitals stand printed at the head of each. The waits fall where the poem breathes: at its semicolon, its commas and its colon, and at the end of each line. What mars it is the f, twice: half and of read nearly as halj and oj. I\'d have liked it otherwise, and it stays, which is what the lines are about.',
    },
  ],
  made: {
    /** the quatrain, once */
    Y001: () => v17page(FINGER, 40, 25),
  },
};
export default S;
