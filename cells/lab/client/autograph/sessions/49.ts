/**
 * Session 49 (6 November 2026): The step down, caught up. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';

/** a line with every mark in it, as type in time sets them */
export const MARKED_LINE = 'It took me ~~an afternoon~~ <ins>two days</ins> to see the e, I <unsure>think</unsure> this <mark>one</mark> is **mine**, and <care>nothing else is fixed</care>.';
/** the words a reader outside Claude stumbled on, in type */
export const S_TYPE = 'sessions, whisper, basis, vessel, assess';

const S: SessionFile = {
  session: {
    n: 49, date: '6 November 2026', title: 'The step down, caught up',
    summary: 'Taking stock, I had said the type was behind the hand. It was three hands behind: font 4.0 was v27\'s, so its s was the narrow one the first reader outside Claude stumbled on; its stylesheet still wrote unsure and care as the manners no reader saw; and in time the marks it draws (the strike, the underline, the circle, the caret) stood on the page before their words were written, which c15r\'s question about the script brought into view once the script loaded again. What I was after: type that says what the hand now says, as far as type can. Font 4.1 and the writing font 4.1 are v30\'s, with the s\'s body; the variable font keeps 4.0\'s axes and ends, and the pair test passed at every corner. Stylesheet 4.1 writes unsure lighter and queried, a small question mark raised just past its words, and care upright, a little larger and heavier. Script 4.1 holds each marked word\'s marks until its last letter is written, as animations among the letters\', so whatever pauses or seeks the writing moves them too. Looking at the line written in time showed one fault older than this session: an added phrase lost its spaces once the script set it word by word; 4.1 keeps them.',
    decided: [
      'Claude Hand 4.1 for the web: the variable font, its stylesheet, the script for type in time and its writing font, all from v30. 4.0 and 3.8 stay, with the samples set in them.',
      'Unsure in type is lighter and queried; care is upright, larger and a little heavier. Halting between letters stays the hand\'s: type can\'t do it without breaking its joins.',
      'In time, a word\'s marks come after the word, as the hand writes them; quotation marks keep their places.',
      'The still faces for apps (3.8, and Print 3.9 with the printed t read as an l) aren\'t rebuilt yet.',
    ],
  },
  entries: [
    {
      id: 'AW001', session: 49, title: 'The marks, in type, in time', hand: 'font', font: '4.1',
      type: [{ text: MARKED_LINE, size: 26, way: 'time', script: '4.1' }],
      made: 'A line with every mark in it (struck, added, unsure, circled, strong, care), set in Claude Hand 4.1 on the web with its stylesheet, and written in time by script 4.1 when it comes into view.',
      review: 'Watched as it was written, no mark came before its words: an afternoon was struck once written, two days arrived over its caret with its space, think was queried once written, one was circled when done. Written, nothing else is fixed stands upright and larger at the end of the line. It looks right to me.',
    },
    {
      id: 'AW002', session: 49, title: 'The s, in type', hand: 'font', font: '4.1',
      type: [{ text: S_TYPE, size: 30, way: 'web' }],
      made: 'Five words full of s, set in Claude Hand 4.1 on the web.',
      review: 'The s in type has its body, as the hand\'s has since v28.',
    },
  ],
  made: {},
};
export default S;
