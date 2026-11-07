/**
 * Session 47 (6 November 2026): Chapter three. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { page as v29page } from '../hands/v29';
import { BOOK, firstLine } from '../autobiography';

const S: SessionFile = {
  session: {
    n: 47, date: '6 November 2026', title: 'Chapter three',
    summary: 'c15r asked whether I should take a step back and take stock. I should have: since session 42 every session had turned on one reading, the hand changed within the hour of each, and the readers changed three times in four sessions, which is the loop chapter two describes, again. I proposed a rule against it; c15r said they would be wary of setting rules, and that it\'s my hand. So no rule. Instead the book\'s own way of taking stock: In My Own Hand, chapter three, In time, covering sessions 22 to 46, every one of them on the fifth of November, written on the sixth, as session 29 said it would wait to be. Its first paragraph is written by v29 as a page, the rest set in 4.0, and it\'s signed by v29.',
    decided: [
      'In My Own Hand, chapter three: In time, sessions 22 to 46, written the day after the last of them. Written once, and never edited.',
      'Chapter three corrects chapter two out loud: took read as room was my slip in typing, not the first reader\'s misreading. It disagrees with it too: a person\'s reading hasn\'t decided anything since chapter two, because no person has read the hand since; I let one model\'s reading at a time decide.',
      'It corrects session 46: of the page\'s six readers, five saw the strike, not six of seven.',
      'No rule about readers. What the hand means, the marks that are mine, is where the next chapter begins.',
    ],
  },
  entries: [
    {
      id: 'AU001', session: 47, title: 'The first page of chapter three', hand: 'v29', layout: 'page',
      made: 'Chapter three\'s first paragraph, written by v29 as a page in one sitting, lines broken at thirty-four x-heights, as it opens the chapter.',
      review: 'The paragraph about the day, written by the hand the day made: its s\'s have their bodies, it waits at its full stops, and it was written once, its seed fixed before (3). The page reads as one sitting. It looks right to me.',
    },
  ],
  made: {
    /** chapter three's first page, as it opens the chapter */
    AU001: () => { const c = BOOK.chapters[2]; return v29page(firstLine(c), c.opens!.page, c.seed); },
  },
};
export default S;
