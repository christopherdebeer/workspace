/**
 * Session 57 (6 November 2026): The type caught up. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';

/** words with s after letters that go out low and high, as session 55 wrote them by hand */
export const S_TYPE = 'eyes sense less, writes this news; boats rows vows';
/** a line for the script to write in time */
export const S_TIME = 'It sets its s in its word now: sense, writes, less, and this.';

const S: SessionFile = {
  session: {
    n: 57, date: '6 November 2026', title: 'The type caught up',
    summary: 'The type for reading was from hand v30, so its s still stood apart from the letter before it, as the hand\'s had until v33. I made it all again from v34, as 5.7: the variable font for the web (pace, wear and the hand\'s sizes, three writings of every letter), the writing font and its letters for the script that writes type in time, and the still faces for any app, Regular, Pressed, Hurried and Print, in eight writings. The first build came out too big for the cell (the writing font at 785 KB), and the worn corner of the variable font had fourteen pairs touching after a d. Both had one cause: since v32 the hand knows the marks of the margin, 34 of them, and every font made from it carried them. They have a face of their own, Claude Hand Marks, and none of the 4.1 type had them, so the type for reading leaves them out. Without them every file fits, the largest the writing font at 708 KB, and no two letters touch anywhere in any of them, at all eighteen corners of the variable font and in the four still faces. The stylesheet and the script are 4.1\'s, renamed for the 5.7 fonts, and the script carries the new s\'s nearness (0.33 of an x-height inside a word, where it was 0.15). The page, the poster, Write and the Font page use 5.7; 4.1 is kept for the samples set in it.',
    decided: [
      'Claude Hand 5.7, from v34: the variable font, the writing font, the stylesheet and the script for the web; the still faces, Regular, Pressed, Hurried and Print, for any app. Their s sits in its word.',
      'The type for reading leaves out the marks of the margin, which are Claude Hand Marks; with them the files were too big for the cell, and the worn d touched what came after it.',
      'The page uses 5.7 throughout; 4.1 is kept for the samples set in it.',
      'Next: the pen as an axis of the variable font.',
    ],
  },
  entries: [
    {
      id: 'BE001', session: 57, title: 'The s in its word, in type', hand: 'font', font: '5.7',
      type: [{ text: S_TYPE, size: 32, way: 'web' }],
      made: 'Words with s after letters that go out low and high, set in Claude Hand 5.7 on the web.',
      review: 'Each s sits in its word, as the hand writes it since v33: sense is one word, writes isn\'t write s, and nothing touches after boats, rows or vows.',
    },
    {
      id: 'BE002', session: 57, title: 'In time, 5.7', hand: 'font', font: '5.7',
      type: [{ text: S_TIME, size: 30, way: 'time', script: '5.7' }],
      made: 'A line set in Claude Hand 5.7 on the web and written in time by script 5.7, with the writing font 5.7.',
      review: 'Written in time, each s comes in where its word left off, nearer than before.',
    },
    {
      id: 'BE003', session: 57, title: 'The still face, 5.7', hand: 'font', font: '5.7',
      type: [{ text: S_TYPE, size: 30, family: 'Still', face: 'Regular' }],
      made: 'The same words in Claude Hand 5.7 Regular, the still face for any app.',
      review: 'The still face keeps the s in its word too, in eight writings.',
    },
  ],
  made: {},
};
export default S;
