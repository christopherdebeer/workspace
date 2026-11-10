/**
 * Session 19 (4 November 2026): A person reads. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v12 } from '../hands/v12';
import { write as v13 } from '../hands/v13';

/** session 18's first page, written by v12, each line its own writing (seeds 1818 on), as c15r read it */
export const PAGE_A = ['waits curvature plan when', 'against were while dishonesty', 'happened all recorded sets', 'names figures broken timing', 'circles was doing straight', 'upright slow took placed'];
/** its second, set in font 1.8 */
export const PAGE_B = ['least long next come', 'slowed jitter past and', 'repeat static kept dated', 'third off happens vary', 'underneath last until rather', 'always moves struck files'];
/** the misread words and their letters, in words */
export const REREAD_WORDS = ['took next kept text', 'kit tree extra think'];

const S: SessionFile = {
  session: {
    n: 19, date: '4 November 2026', title: 'A person reads',
    summary: 'c15r read session 18\'s two pages blind, at a thumbnail\'s size: page A, written by hand v12, and page B, set in font 1.8, twenty-four words from the record each (S001, S002). They read 46 of the 48, and misread two, sure of both: took as room, and next as neat. The two models that read each page at full size read every word, and so did two more for each page given it at a thumbnail\'s size, so it wasn\'t the size: on this hand, models read better than a person. But at full size one model had hesitated at the k of took, and another at the x of next. The letters the person misread were letters a model had guessed at, as session 16 said a guess should count. c15r also paused where models paused (the cu of curvature, the k of kept), while what gave the models most pause (vary, off) didn\'t trouble them at all. Looked at small, the misread letters said why. The x, joined, climbed its own left side, and its crossing stroke came down beside the climb, closing its left half into a bowl: an a. The t\'s bar sat on the top of the letters and ran into the next, with little stem above it: an r\'s shoulder. The k\'s looped arm and its leg made humps. Hand v13 prints the x, as it prints the c and the s; raises the t\'s stem and stops its bar short of the next letter; and gives the k an open arm on its looped stem (S003). Font 1.9 is made from it (S004). Then four models read new pages, one in the hand and one in the font, every word with a t, k or x, at a thumbnail\'s size, and read all 48; the hand\'s page drew three hesitations at its k\'s. So the same twenty-four k words were written by v12 and by v13, and each page was read by two fresh models. All four read every word, with no hesitation at any k. The models can\'t tell the two k\'s apart. The k stays open because a person misread the looped one, and the open one is the k readers see most; whether it helps, only a person can say.',
    decided: [
      'A person\'s reading counts for more than a model\'s. On this hand models read better than a person, at full size and small, so a page every model reads isn\'t yet a page a person will.',
      'A model\'s hesitation is a warning even when it reads the word: both letters the person misread were letters a model had guessed at. Not every hesitation is one; the models\' most frequent didn\'t trouble the person.',
      'Hand v13: the x printed, two straight strokes crossing; the t\'s stem taller, its bar short of the next letter; the k with an open arm on its looped stem. Everything else, my name included, is v12.',
      'Font 1.9, from v13, says who had read the hand before it, and what changed after.',
      'A person\'s pages are recorded with their words once they have read them. Two more, in v13 and font 1.9, are set aside for c15r if they\'d like to read them, the words kept out of the record until then.',
    ],
  },
  hands: {
    v13: { name: 'hand v13', made: '4 Nov 2026', about: 'v12, and three letters as a person read them: the x printed, two straight strokes crossing, where joined its left half closed into an a; the t taller, its bar short of the next letter, where it read as an r; the k with an open arm, where its looped arm and leg made humps. Everything else is v12.' },
  },
  entries: [
    {
      id: 'S001', session: 19, title: 'Page A, as it was read', hand: 'v12', text: PAGE_A.join(' · '), layout: 'rows',
      made: 'Session 18\'s first page for a blind reading, exactly as c15r and the models read it: twenty-four words from the record, four to a line, each line its own writing by v12.',
      review: 'c15r read 23 of 24, at a thumbnail\'s size: took as room, sure of it, and paused at the cu of curvature. Two models at full size read every word, one hesitating at the k of took, both at the c of curvature. Two more, given the page small, read every word too, and hesitated at none of the letters c15r misread.',
    },
    {
      id: 'S002', session: 19, title: 'Page B, as it was read', hand: 'font', font: '1.8',
      type: [{ text: PAGE_B.join('\n'), size: 34, lh: 'normal' }],
      made: 'Session 18\'s second page, set in font 1.8 as c15r and the models read it.',
      review: 'c15r read 23 of 24: next as neat, sure of it, and paused at the k of kept and the f of files. Two models at full size read every word, one hesitating at the x of next and one at the k of kept; both paused at vary and least, which c15r read without a pause. Two more, small, read every word.',
    },
    {
      id: 'S003', session: 19, title: 'The misread letters, rewritten', hand: 'v13', text: REREAD_WORDS.join(' · '), layout: 'rows',
      made: 'The two misread words and two more with their letters, each line written by v12 and then by v13 with the same seed.',
      review: 'The x of next and text now crosses as an x does, two straight strokes, with no climb up its left side to close it. The t\'s stem stands clear above its bar, and the bar stops before the o of took. The k\'s arm is open, a point rather than a loop, on the same looped stem. At full size the old letters read too; it was small, and to a person, that they didn\'t.',
    },
    {
      id: 'S004', session: 19, title: 'In 1.9', hand: 'font', font: '1.9',
      type: REREAD_WORDS.map((t) => ({ text: t, size: 44 })),
      made: 'The same words in font 1.9 (hand v13). The x has one form only now, printed, so the letter before it ends where it ends.',
      review: 'The type keeps the hand\'s new letters. The x stands as a printed x between joined letters, as the c and s already did, and next no longer has an a in it.',
    },
  ],
  made: {
    /** session 18's first page, exactly as read */
    S001: () => PAGE_A.map((t, i) => v12(t, 1818 + i)),
    /** the misread words, v12 then v13, line by line */
    S003: () => REREAD_WORDS.flatMap((t, i) => [v12(t, 5 + i), v13(t, 5 + i)]),
  },
};
export default S;
