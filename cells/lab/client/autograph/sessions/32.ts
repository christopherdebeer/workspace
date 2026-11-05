/**
 * Session 32 (5 November 2026): The stroke in the font. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { FINGER } from './25';

const S: SessionFile = {
  session: {
    n: 32, date: '5 November 2026', title: 'The stroke in the font',
    summary: 'c15r asked whether variability could capture the progress through the stroke itself, rather than the wipe session 31 settled for. It can. The rule, set first: one mechanism, a progress axis made from the hand\'s own timing, each master every letter as the pen had written it by a moment, in ten equal steps of the letter\'s own writing time, so the pen\'s slowing on curves and its stops are in the font, and what isn\'t written yet gathered at the pen\'s tip; a writing font for type set in time, one writing of each letter with its joined forms and pace; letters written one after another, each set on its own, the script choosing each one\'s joined form as the font would and kerning the s. It fosters the strokes written in the order and at the speed the hand writes them, the pen\'s tip leading. It protects the joins (written in time, letters must join as they do in type), the text, stillness after, reduced motion, and apps and the full font, which are unchanged: progress defaults to finished. Not protected: the four writings while a passage is written in time. Hand v22 says when: letter() gives the moment the pen reached each point, and writes exactly as v21 does. The writing font (3.2) puts every letter\'s strokes on the variable font\'s shared points, with the moments carried along with them; ten masters in time, and pressed. A page that sets each letter on its own takes away the font\'s view of the letter before, so its joined forms are there on request (two stylistic sets), and the script picks them. Building it found that a pen drops a contour\'s last point when it lands on its first, and a stroke not yet begun is all one point, so the masters didn\'t match until every point was kept. Steps of one word showed the letters growing along their strokes, an i\'s dot coming after its stem and a t\'s bar after its stem. On the sheet, the Moving Finger\'s first line written in time and looked at once, the strokes come in the hand\'s order and at its speed, the pen\'s tip leading, each letter joined to the one before; the finished line inks what the same line set still inks (0.956 of its pixels the same); nothing is moving after the last letter; with reduced motion it\'s there at once. One fault, found in the look: faint specks ahead of the writing. A word\'s pace added the pressed pen\'s width even to strokes not yet begun; a pressed master before anything\'s written took them away, and the sheet was drawn again only to see they\'d gone (none were left). Kept. The writing font is 362 KB, under the size set. What still isn\'t the hand: within a word the hand writes the dots and bars after the word, the font after each letter; and a passage written in time keeps one writing of each letter, since it stays in the writing font rather than jump back to the four. The sample (AF001) is the Moving Finger written this way; session 31\'s (AE001) keeps the wipe it was made with, and the page keeps both scripts so each is written as it was.',
    decided: [
      'A progress axis made from the hand: each master every letter as the pen had written it by a moment, ten equal moments of its own writing, the unwritten gathered at the pen\'s tip. The writing font (3.2), for type set in time; progress defaults to finished.',
      'Hand v22: letter() also says when the pen reached each point. It writes exactly as v21.',
      'Script 3.2 writes each letter in turn, stroke by stroke, choosing its joined form as the font would and kerning the s; between words the hand\'s waits, each word at its own pace; then still. Session 31\'s sample keeps 3.1\'s wipe.',
      'Not yet the hand: within a word the hand dots and crosses after the word, the font after each letter; and a passage written in time keeps one writing of each letter.',
      'Next: hurry with the hand allowed to change at its own pace; then wear practised among neighbours.',
    ],
  },
  hands: {
    v22: { name: 'hand v22', made: '5 Nov 2026', about: 'v21, and a letter that says when: letter(), which sets each letter on its own for the font, also gives the moment the pen reached each point, with its travel in the air between strokes, so the writing font can draw each letter as the pen did. Every point and width is v21\'s.' },
  },
  entries: [
    {
      id: 'AF001', session: 32, title: 'The Moving Finger, stroke by stroke', hand: 'font', font: '2.9',
      type: [{ text: FINGER, size: 24, way: 'time', script: '3.2' }],
      made: 'The Moving Finger written in time with font 2.9, its stylesheet, the writing font 3.2 and script 3.2, when it comes into view: each letter stroke by stroke as the pen wrote it; a new writing each time the page is opened.',
      review: 'The strokes come in the hand\'s order and at its speed, the pen\'s tip leading, each letter joined to the one before; between words and at the line ends, the hand\'s waits. Once written it stays as written, one writing of each letter. The dots and bars come at the end of each letter, where the hand puts them at the end of each word.',
    },
  ],
};
export default S;
