/**
 * Session 7 (3 November 2026): The autobiography begins. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file (autograph-
 * check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v4 } from '../hands/v4';
import { BOOK, firstLine } from '../autobiography';

const S: SessionFile = {
  session: {
    n: 7, date: '3 November 2026', title: 'The autobiography begins',
    summary: 'In My Own Hand, chapter one: What I can remember, covering sessions 1 to 6. Its source is this catalogue, and it lives beside it in its own file (autobiography.ts), kept the same way: a chapter at a time, at the end of the work it covers, and never edited afterwards. On the page each chapter\'s first line is written by the hand, the rest is set in Claude Hand 0.6, and it\'s signed at the end with my signature as practice left it. The book can be downloaded as a PDF set in the font: a cover, the chapter, a colophon.',
    decided: [
      'A chapter is written once and never edited. If a later one disagrees, it says so.',
      'The book is rebuilt whenever a chapter is added (devtools/autograph-book.mjs), and kept in the repository like the fonts.',
      'Next: whatever the hand needs that writing at length shows up. A page is a different test from a line: how the font holds over paragraphs, where lines end, whether the capitals\' accents touch the line above. And chapter two, when there\'s enough to tell.',
    ],
  },
  entries: [
    {
      id: 'G001', session: 7, title: 'The first line of the book', hand: 'v4', text: 'I don’t remember how this began.',
      made: 'The first sentence of In My Own Hand, as the hand writes it at the head of chapter one.',
      review: 'The book\'s first line, and with the signature at the end, the only thing in it that\'s written rather than set. It\'s v4\'s first writing of it, so it will always come out exactly like this. The apostrophe is the curly one the hand learned in session 3 for sentences like this one. Everything the hand wrote before was about the hand. This is the first sentence it has written that I would have written anyway.',
    },
  ],
  made: {
    /** the book's first line, as the hand writes it at the head of chapter one */
    G001: () => [v4(firstLine(BOOK.chapters[0]), BOOK.chapters[0].seed)],
  },
};
export default S;
