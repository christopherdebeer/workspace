/**
 * Session 53 (6 November 2026): The poster, in time. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';

/** the poster's marked line, as its second plate has it */
export const POSTER_LINE = 'It took me ~~a day~~ <ins>three days</ins>; it’s **mine**, I <unsure>think</unsure>, and this <mark>one</mark> I wrote <care>with care</care>.';

const S: SessionFile = {
  session: {
    n: 53, date: '6 November 2026', title: 'The poster, in time',
    summary: 'c15r thought the landing should be far more ambitious, a beautifully designed typographic poster showing the family\'s range, perhaps written in time as a journey through what the hand is and does. With a face for code and marks for the margin made, I made it. The landing is now a sheet wider than the page\'s column: a masthead (Claude Hand as large as the screen allows, my signature written afresh beside a paragraph saying what this is, captions in Claude Hand Mono), and six numbered plates, each one thing the hand does, titled in my own words: it takes its time (pace); it says what I mean (the marks, numbered over the words with a legend in red); small, and large, with the same pen; it has relations (Fair, Nib, Running, Print, Mono, Marks); it arrives as it was written; every letter, and the marks between. The plate numbers are circled numbers from the Marks, hung in the margin on a wide screen. The sheet is written as a score: each plate plays as it comes into view, its steps in order as the markup says (data-step, what it does, how long it waits, how long the next waits for it), so the poster is composed in its HTML and a small runner plays it. Lines are written in time by the font\'s script, notes by the hand in red, still faces brought up, and the numbers come over the marked words once the line is written. The writing font is fetched only when the first plate written in time is near; with reduced motion asked for, everything is simply there. Phone first: one column there.',
    decided: [
      'The landing is a typographic poster written as a score, six plates, each played as it comes into view. Its markup says the score.',
      'Captions in Claude Hand Mono, numbers and marks in Claude Hand Marks: the family set beside itself.',
      'A long line needn\'t keep its note waiting: a step can hold the next for a while rather than until it\'s done.',
      'Nothing in the hand or the fonts changed.',
    ],
  },
  entries: [
    {
      id: 'BA001', session: 53, title: 'The poster’s line', hand: 'font', font: '4.1',
      type: [{ text: POSTER_LINE, size: 28, way: 'time', script: '4.1' }],
      made: 'The marked line of the poster\'s second plate, set in Claude Hand 4.1 on the web and written in time by script 4.1, its marks after its words.',
      review: 'On the poster each marked word gets a circled number over it once the line is written, matched to a legend in red; here it\'s the line alone, as anyone\'s page would set it.',
    },
  ],
  made: {},
};
export default S;
