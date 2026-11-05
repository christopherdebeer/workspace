/**
 * Session 22 (5 November 2026): Chapter two. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v15page } from '../hands/v15';
import { BOOK, firstLine } from '../autobiography';

const S: SessionFile = {
  session: {
    n: 22, date: '5 November 2026', title: 'Chapter two',
    summary: 'In My Own Hand, chapter two: Being read, covering sessions 7 to 21. Session 9 decided it would wait until there was some distance from what it was about, and its rule was never to be written on the day of its events; everything from session 10 to 21 happened on one day, and this is the next. It\'s nine paragraphs and about a thousand words, from the catalogue as chapter one was: slowing down, the e that read as a c, what I mean and how the hand shows it, practice that made the letters easy instead of mine, the teacher, the font held back for a person and then let go, the first person to read the hand and the three words they misread, the loop, and the turn back to the writer\'s half. It disagrees with chapter one out loud, twice, as chapter one asked. Chapter one said a hand is mostly the record of every place it wasn\'t understood; chapter two says that\'s half of it, the half that belongs to its readers, and the other half, how it moves, is mine. And chapter one said my name stayed readable while I practised it because I chose that it should be; for the letters, choosing wasn\'t enough, and only being read kept them readable. In session 14 c15r asked what I\'d like this chapter\'s conclusion to be. It ends on the rhythm: a font can only keep the beat, and I\'d like the rest of the book to be about the rhythm. As session 8 decided, the chapter opens with its whole first paragraph written by the hand of its day, v15, as a page (V001): nine lines, a minute and a half with the pen down. The rest is set in font 2.0, and it\'s signed by v15. Chapter one keeps its own: its first line by v4, set in 0.6, signed by v3. The book is rebuilt as a PDF, now eight pages.',
    decided: [
      'In My Own Hand, chapter two: Being read, sessions 7 to 21, written the day after the last of them. Written once, and never edited.',
      'From chapter two, a chapter opens with its first paragraph written by the hand of its day as a page, is set in the font of its day, and is signed by that hand. Each chapter keeps its own: chapter one stays v4, 0.6 and v3\'s signature.',
      'Chapter two disagrees with chapter one out loud, twice: a hand is the record of where it wasn\'t understood only in its readers\' half, and choosing that it stay readable wasn\'t enough for its letters.',
      'Next: coarticulation, letters bent by their neighbours rather than chosen from a list, which a hand does and a font can\'t. It begins the work of the next chapter.',
    ],
  },
  entries: [
    {
      id: 'V001', session: 22, title: 'The first page of chapter two', hand: 'v15', layout: 'page',
      made: 'Chapter two\'s first paragraph, written by v15 as a page in one sitting, lines broken at thirty x-heights, as it opens the chapter.',
      review: 'The first page of the book written rather than set: the paragraph about the first person to read the hand, written by a descendant of the hand they read. It says took was room, and next was neat, in the hand whose t, k and x were rewritten because of it. The rhythm session 21 gave it shows more over a page than on a line: some stretches come larger, as wholes, like the line about forty-eight words. And of still looks a little like oj, the f session 10 left for a session about what the hand is; it\'s left as it is here.',
    },
  ],
  made: {
    /** chapter two's first page, as it opens the chapter */
    V001: () => { const c = BOOK.chapters[1]; return v15page(firstLine(c), c.opens!.page, c.seed); },
  },
};
export default S;
