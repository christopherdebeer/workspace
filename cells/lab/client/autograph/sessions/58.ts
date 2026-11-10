/**
 * Session 58 (6 November 2026): The pen in the font. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';

/** the sentence that rises, falls and speaks in another voice (session 56), set in type */
export const RISE58 = 'It <rising>gets louder, and louder, and louder</rising>, then <falling>trails away to almost nothing</falling>. Said in a round hand, then <broad>in another voice</broad>.';
/** the broad pen set large, in the font itself */
export const LARGE58 = '<broad>Claude Hand</broad>';

const S: SessionFile = {
  session: {
    n: 58, date: '6 November 2026', title: 'The pen in the font',
    summary: 'In type the pen could only change face: a rise barely showed, since the font\'s heaviest is not much heavier, and the broad voice was a separate family. So the variable font has a pen of its own now, a fourth axis, EDGE, from the round pen (0) to the broad (100). The variable font outlines each stroke on its own with the same points in every master; here the pen is an ellipse, round when its two axes are equal and the broad pen when it\'s an edge at 40 degrees, and each point of the outline is where the pen touches the line on that side, which moves continuously as the line turns. So the broad master has the same points as the round one, and everything between is a pen too; a broad dot is the nib moved across its own width. The pair test, at every corner of four axes, found three places where the broad pen pressed and set small brought letters together (s before c, t before E, a bracket before c) and one where the size axis, run further, brought q\'s tail to j\'s: each pair is given a twenty-fifth of an x-height, in a kerning lookup of its own, since merging the masters folded it into the kerning after ink and lost it. The font\'s broad edge is 1.65 of the round pen, not Broad\'s 1.8, for the same reason. With a fourth master the file was over the cell\'s size until the strokes were outlined in slightly longer steps; it\'s 717 KB. One thing looking showed: set large, the size axis fines the pen, and added to the broad pen it fined it away, so where the pen is broad the size axis is held at text size; held, the font\'s broad pen is the Broad face\'s. In type, from 5.8, the pen\'s elements use the axis: the broad voice is the pen at 100, and a rise is heavier and broader as it goes. Stylesheet 5.8 adds .claude-hand-broad. The writing font and the script for type in time are 5.7\'s, which have no pen: in time a broad word is written round and settles broad.',
    decided: [
      'Claude Hand 5.8: the variable font with a fourth axis, the pen (EDGE, round 0 to broad 100), every corner pair-tested; four pairs given room.',
      'Where the pen is broad, the size axis is held at text size, so a large size doesn\'t fine it away (stylesheet 5.8, .claude-hand-broad).',
      'In type from 5.8, <broad> is the pen at 100 and <rising> heavier and broader as it goes; earlier samples keep how they were set.',
      'The pen isn\'t yet in the writing font or the script for type in time.',
      'Next: a specimen written by the hand.',
    ],
  },
  entries: [
    {
      id: 'BF001', session: 58, title: 'Louder, and softer, in the font', hand: 'font', font: '5.8',
      type: [{ text: RISE58, size: 30, way: 'web' }],
      made: 'The sentence of session 56 set in Claude Hand 5.8 on the web, the pen a word at a time on its own axis.',
      review: 'Beside 4.1\'s (BD004) the rise is a little stronger, the last louder broader as well as darker, but at this size it\'s still modest: type rises less than the hand. The other voice is the font\'s own broad pen now, in the same family and joined as it is.',
    },
    {
      id: 'BF002', session: 58, title: 'The broad pen, set large', hand: 'font', font: '5.8',
      type: [{ text: LARGE58, size: 72, way: 'web' }],
      made: 'Claude Hand set at 72 px in 5.8 with the pen at 100, the size axis held at text size.',
      review: 'It\'s the Broad face\'s broad pen, from the font that sets text: thick and thin, the capitals with presence.',
    },
  ],
  made: {},
};
export default S;
