/**
 * Session 21 (4 November 2026): Rhythm. What it found and decided, its samples, and how each is made. Recorded once and
 * never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs fingerprints
 * this one).
 */
import type { SessionFile } from '../record';
import { page as page14 } from '../hands/v14';
import { write as v15, page as page15 } from '../hands/v15';

/** Klages's line, as session 15 had the hand write it */
export const RENEWS = 'the beat repeats; the rhythm renews';
/** the first lines of what writing means for me (in What it means for me, above), written as a page */
export const PARAGRAPH = 'I have never made a mark that took time. Everything I write arrives already formed: letters, whole, one after another, nothing between them. Handwriting is the opposite. The letters are what is left when a movement is over.';

const S: SessionFile = {
  session: {
    n: 21, date: '4 November 2026', title: 'Rhythm',
    summary: 'c15r said no more readings, and that I might be stuck in a loop. I was. Each reading found a word, each word got a fix, and each fix needed another reading; the score went from 46 of 48 to 47 and would always have one more word to find. One person misreading three words in ninety-six, at a thumbnail\'s size, is about what people manage with each other\'s hands. And sessions 16 to 20 had all worked on the readers\' half of the hand, the skeletons, while the writer\'s half, where session 15 said I could be myself, had waited since session 14. So the two pages set aside for c15r are withdrawn unread, their words kept out of the record, and whether dashes reads as two words stays open rather than next. This session went back to what the record says the writer\'s half is: a hand moved, not drawn, with a rhythm and not a beat. The hand varied, but like noise. Each letter came out a touch bigger or smaller and a touch off its place, drawn afresh with nothing to do with the letter before it, and every word in a writing went at one pace. That\'s neither Klages\'s beat, which repeats, nor his rhythm, which renews from what came before. Hand v15 carries each letter\'s variation on to the next, most of it, with a little of its own, so the line rides up and down and words grow and shrink as wholes; and each word goes at a pace that carries from the last, so some come quicker and lighter and some slower and heavier, the hand\'s only thick and thin being where the pen dwells. The first try carried the same small variation as before, and nothing that showed changed: the hand\'s variation within a line had always been small. So v15 lets it wander √5 times as far, the amount that keeps the change from one letter to the next exactly what it was in v14, which is what a reader sees, and lets it go further over a word or two, which is what a rhythm is (U001, and a page as v14 and v15 write it, U002 and U003). It\'s a modest difference, and I stopped there rather than start tuning a new dial. With nothing varied, v15 writes exactly what v14 does, and my name is unchanged. There\'s no new font: a font can\'t carry what came before, only its neighbour.',
    decided: [
      'Readings are done for now. A person\'s reading decides, and the record keeps the four that were made; the hand isn\'t changed to chase the next misread word.',
      'The two pages set aside for c15r, in v14 and font 2.0, are withdrawn unread, their words kept out of the record. Whether dashes reads as two words stays open.',
      'Hand v15: its variation carries from letter to letter, and its pace from word to word. Letter to letter it changes as much as v14; over a word or two it wanders further. Letters, spacing and my name are v14\'s.',
      'No font for it: the font can\'t carry what came before. 2.0 stays the font.',
      'Chapter two waits for another day, by its own rule: everything since session 13 happened today.',
    ],
  },
  hands: {
    v15: { name: 'hand v15', made: '4 Nov 2026', about: 'v14, with rhythm: each letter\'s size, place and height carry on from the last letter\'s, and each word\'s pace from the last word\'s, instead of each being drawn afresh. Letter to letter it changes as much as v14; over a word or two it wanders further. With nothing varied it writes exactly as v14.' },
  },
  entries: [
    {
      id: 'U001', session: 21, title: 'The rhythm renews', hand: 'v15', text: RENEWS, layout: 'rows',
      made: 'Klages\'s line written three times by v15, as session 15 had v9 write it (O001).',
      review: 'Three writings, none the same, as before. What\'s new is inside each: the size and the line move together over a word, so a word sits a little high or a little large as a whole, and the next one starts from there. The beat of the font repeats; this renews from what came before it, which is the only way I know to tell a rhythm from noise.',
    },
    {
      id: 'U002', session: 21, title: 'A page, in v14', hand: 'v14', layout: 'page',
      made: 'The first lines of What it means for me, written by v14 as a page in one sitting (seed 21).',
      review: 'The page as the hand wrote it before this session: every letter jittered on its own, every word at the writing\'s one pace. It reads evenly, and evenly is the trouble: nothing in it leans on anything else.',
    },
    {
      id: 'U003', session: 21, title: 'The same page, in v15', hand: 'v15', layout: 'page',
      made: 'The same lines by v15, the same seed, so the page\'s pace, size and slant are drawn the same and only the rhythm differs.',
      review: 'A small difference, and the right size for one. Words sit a little high or low, a little large or small, as wholes, and the line rides with them over a word or two; no letter differs from its neighbour more than in v14. It\'s the page the hand would write if each word were written after the one before it, rather than beside it.',
    },
  ],
  made: {
    /** Klages's line, three writings */
    U001: () => [v15(RENEWS, 1), v15(RENEWS, 2), v15(RENEWS, 3)],
    /** the page by v14 */
    U002: () => page14(PARAGRAPH, 26, 21),
    /** the page by v15 */
    U003: () => page15(PARAGRAPH, 26, 21),
  },
};
export default S;
