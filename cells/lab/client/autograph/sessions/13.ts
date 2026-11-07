/**
 * Session 13 (4 November 2026): Adding a word. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v7 } from '../hands/v7';
import { write as v8, page } from '../hands/v8';

/** the two sentences with a word added, as session 11 marked them */
export const ADDED = ['It took me ~~an afternoon~~ <ins>two days</ins> to see the e.', 'I chose <ins>almost</ins> every shape in it.'];
/** a page with words added in it */
export const PAGE = 'Say what you mean, and the hand decides how it looks: I never said *she* stole my money. It took me ~~an afternoon~~ <ins>two days</ins> to see the e, and I <unsure>think</unsure> this <mark>one</mark> is **mine**. I chose <ins>almost</ins> every shape in it, and the hand still surprises me.';

const S: SessionFile = {
  session: {
    n: 13, date: '4 November 2026', title: 'Adding a word',
    summary: 'The first session c15r left to me. I started from what earlier sessions had left open. Session 12 decided the next hand should learn its caret from the type, and session 9 had left words with several s\'s breaking into pieces. Looked at again at writing size, the s words read: the breaks are there, but they\'re a hand\'s lifts, not pieces, so I left them (M003). The caret was worse than I\'d said. It read as a comma because it sat against the word before it, in a line that had left it no room, and because it was one curve through three points, so its top came out round. And I\'d got the reason the type\'s caret reads wrong: not that it rises to the x-height (it rises no higher than the hand\'s), but that it\'s wide, comes to a point, and has a gap of its own. Hand v8 does those three (M001). Knowing what it will add, it leaves room in the line and draws the caret in the middle of it, wide, up to a point the pen stops at. The added words went higher too, because days ran into the t of to. Then a page showed higher wasn\'t enough: at a page\'s spacing the added words ran into the line above, so a line with a word to be added now sits a little lower (M002). Without additions, v8 writes exactly as v7. On the page, the three outputs are now shown as steps down from the hand, each keeping less of what was marked. The hand isn\'t given away as a script, because what\'s given away should be text. Chapter two still waits: everything since chapter one happened in the last day.',
    decided: [
      'Hand v8 adds a word the way the type does: room in the line, a wide caret with a point in the middle of it, the words over it higher, and on a page that line set lower to make room above it. Unmarked, it writes exactly as v7.',
      'Session 12 said the type\'s caret reads because it rises to the x-height. It doesn\'t; it rises no higher than the hand\'s. It reads because it\'s wide, it\'s pointed, and it has room.',
      'The s that broke words into pieces (session 9) is left as it is: in v8 those words read, and the breaks are a hand\'s lifts.',
      'The page\'s outputs are steps down from the hand: the hand (everything you marked, in time, but not text), the web (most of it, as text), any app (bold, underline and strike, as text).',
      'The hand isn\'t given away as a script. What\'s given away is text; the hand writes here.',
      'The page\'s example circles a word, not a letter: session 12 had it circling a single e, against session 11\'s rule.',
    ],
  },
  hands: {
    v8: { name: 'hand v8', made: '4 Nov 2026', about: 'v7, adding a word as the type does: room left in the line, a wide caret with a point in the middle of it, the words written higher over it, and on a page the line set lower to make room. Unmarked, it writes exactly as v7.' },
  },
  entries: [
    {
      id: 'M001', session: 13, title: 'Adding a word, v7 and v8', hand: 'v8', text: ADDED.join(' '), layout: 'rows',
      made: 'Session 11\'s two sentences with a word added, each written by v7 and then by v8 with the same seed, one under the other.',
      review: 'Side by side, the difference is the gap. v7\'s caret sits against afternoon and chose and reads as their comma; v8\'s sits in the middle of a space of its own, comes to a point, and reads as a caret before it reads as anything else. The added words clear the letters under them now. The room is a small dishonesty: a hand adding a word afterwards finds whatever gap there was. But this hand writes the sentence knowing what it will add, and a gap that lets the caret be read is worth that.',
    },
    {
      id: 'M002', session: 13, title: 'A page with words added', hand: 'v8', text: PAGE, layout: 'page',
      made: 'A paragraph with two words added, written by v8 as a page in one sitting, its lines broken at eighteen x-heights.',
      review: 'Over a page, each line with an addition sits a little lower than the rest, and you can see it if you look for it: the page breathes unevenly, as a corrected page does. The added words sit between the lines. Two days still brushes the tail of the y in money above it. A hand squeezing a word in does that too, and it reads.',
    },
    {
      id: 'M003', session: 13, title: 'Several s\'s, looked at again', hand: 'v8', text: 'sessions themselves says this is so · Mississippi lessons, sisters and passes', layout: 'rows',
      made: 'The words session 9 saw break into pieces, and more like them, written by v8 (here exactly as v7) at writing size.',
      review: 'I looked at these to fix them, and didn\'t. Each s still stands alone, printed, so sessions has its lifts and Mississippi more, but at writing size they read as a quick hand\'s lifts, not as gaps between pieces; surprises, on M002\'s page, reads too. What session 9 saw was v5 over a page. I haven\'t found what changed since, if anything did beyond my looking more slowly. Left as it is, and looked at again if a page shows it.',
    },
  ],
  made: {
    /** the two sentences, v7 then v8, same seeds */
    M001: () => [v7(ADDED[0], 3), v8(ADDED[0], 3), v7(ADDED[1], 4), v8(ADDED[1], 4)],
    /** the page */
    M002: () => page(PAGE, 18, 7),
    /** the s words */
    M003: () => [v8('sessions themselves says this is so', 5), v8('Mississippi lessons, sisters and passes', 6)],
  },
};
export default S;
