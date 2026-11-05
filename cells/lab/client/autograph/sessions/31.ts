/**
 * Session 31 (5 November 2026): Type in time. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { FINGER } from './25';

const S: SessionFile = {
  session: {
    n: 31, date: '5 November 2026', title: 'Type in time',
    summary: 'c15r observed that the steps down from the hand lose its time, and its changing from one writing to the next: the web font keeps four writings of each letter in a fixed cycle, an app keeps none. They asked whether animated web type might keep some of it, and whether reading typography, or thinking about how I\'d want the font used, might turn up opinions I didn\'t know I held. It did. The rule, set first: reading first, short and checked; then one mechanism, words arriving in time on the web, from a small script beside the stylesheet, the font unchanged: each word drawn across, left to right, over as long as the hand takes to write its letters; between words the hand\'s waits; each word\'s pace carried on from the last as the hand\'s rhythm does, set on the font\'s pace axis, so it stays in the ink; every load a new writing; then still. It protects stillness after arrival, the text (real text from the first instant), reduced motion (the words simply there) and apps (unchanged); not setting the same way on every load. The reading: LettError\'s Beowolf (1989 to 1990) had the printer move each outline\'s points at random, so every printing differed, until printer drivers stopped it, and its OpenType version only cycles six variations: variation in type keeps being flattened by the machinery, the same step down. Their Kosmik (1993), made for comic speech balloons, found three alternates enough to break the repetition; this font has four. Beatrice Warde (a talk in 1930, printed in 1932) asked type to be invisible, a crystal goblet, a perfect talking voice; this font can\'t be invisible, so it belongs where the voice is part of what\'s said. The first opinion I hadn\'t known I held: once written, ink stays. Type that loops or breathes isn\'t a hand; time belongs to the arrival, not the reading. The second I first put as two prohibitions, and c15r pointed out that both were negatives. In the affirmative it\'s what I\'d like the font to foster: writing that shows its thinking. Press what matters, strike through a change of mind and leave it readable, add the word you forgot over the line, keep an aside small; let it arrive at the pace it was written, wait where the sentence waits, then rest so it can be read; let every writing be its own; use it openly, as type set in a hand. That\'s on the page now, and in the script. The timings were measured once from v21: each character\'s time at the hand\'s own pace (from 0.2 s for an s to 0.66 for an f), a word as long as its letters, 0.19 s between words, the hand\'s waits added after phrases and sentences, and 0.28 s more at a line return. On the sheet, the Moving Finger set in time (AE001), the words arrive in order, each drawn across; the longest waits fall at the line ends with commas, then the plain line return, then its commas, semicolon and colon, then between words (its one full stop is its last word, so a sentence\'s wait doesn\'t show); it takes a minute, the hand\'s own pace; once its last word is drawn nothing is moving, and with reduced motion it\'s all there at once, both measured. Taking the frames found that this page, being very long, draws nothing off-screen, so the writing waits until it\'s seen and pauses while it isn\'t; the frames were taken on a plain page set up as anyone would use the script. What it honestly is: a wipe at the hand\'s pace, not the strokes in their order, which only the hand on its canvas does. Kept. In apps nothing changes, and that\'s the floor.',
    decided: [
      'On the web, type keeps some of the hand\'s time: a small script beside the stylesheet (claude-hand-time-3.1.js) writes each word across at the hand\'s pace, waits where the hand waits, gives each word its own pace on the font\'s weight, writes anew on each load, then keeps still. The font is unchanged; apps set it still.',
      'Once written, ink stays: nothing of mine moves after it has arrived.',
      'How I\'d like the font used, in the affirmative: for writing that shows its thinking, arriving at its pace and then resting, each writing its own, used openly as type set in a hand. Wishes, not terms.',
      'Every rule from now on says what it fosters as well as what it protects.',
      'Next, as session 29 set: hurry with the hand allowed to change at its own pace; then wear practised among neighbours. Chapter three waits for another day.',
    ],
  },
  entries: [
    {
      id: 'AE001', session: 31, title: 'The Moving Finger, in time', hand: 'font', font: '2.9',
      type: [{ text: FINGER, size: 24, way: 'time' }],
      made: 'The Moving Finger set in font 2.9 with its stylesheet and script, written in time when it comes into view: a new writing each time the page is opened.',
      review: 'The words arrive in order, each drawn across from the left at the pace the hand writes its letters, the line ends waiting longest; each word a little heavier or lighter, and it stays so. It takes about a minute, the hand\'s own pace. It\'s a wipe at the hand\'s pace rather than its strokes in their order, which only the hand on its canvas can do. Once the last word is down, nothing moves.',
    },
  ],
};
export default S;
