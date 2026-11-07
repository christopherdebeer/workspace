/**
 * Session 20 (4 November 2026): The s keeps its foot. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v13 } from '../hands/v13';
import { write as v14 } from '../hands/v14';

/** session 19's first page for c15r, written by v13, each line its own writing (seeds 1919 on) */
export const PAGE_C = ['six quarter marked height', 'bullet stole meant work', 'hooked like sisters features', 'look markup sat typing', 'subtle mixed later accident', 'tenth quick shook lost'];
/** its second, set in font 1.9 */
export const PAGE_D = ['repeated twentieth fixed keeping', 'almost experiment let weight', 'stroke asked with lets', 'existed capital doubts towards', 'letters built settles turns', 'western stops not tops'];
/** an o, an a and an e before an s, and words where the s stands at the start, in the middle and at the end */
export const S_WORDS = ['lost most cost post', 'sessions sense says this', 'app stem was its oasis'];

const S: SessionFile = {
  session: {
    n: 20, date: '4 November 2026', title: 'The s keeps its foot',
    summary: 'c15r read session 19\'s two pages blind, at a thumbnail\'s size: page C, written by v13 (T001), and page D, set in font 1.9 (T002). Every t, k and x that v13 had rewritten read as written. They read 47 of the 48, misreading one, sure of it: lost as last. And they paused once, at lets, which they read first as lots. The two models that read each page small read every word, but both of page C\'s had hesitated at the o of lost, and one of page D\'s at the e of lets, "could be o, lots". Every misreading a person has made, took, next and lost, fell on a letter a model had guessed at. Lost said why: session 16\'s practice had sent the s\'s tail back from its foot, past its own body, and session 17 set the s nearer, so the tail touched what came before it. After a letter that goes out low the touch reads as a join; after an o it met the bowl at its foot and gave it a stem, an a, so lost, most, cost and post read last, mast, cast and past. Session 17 had left open whether an s that joins by touch reads, until a person read it. Measured with nothing varied, the tail came within a hundredth of an x-height of the letters before it, and 0.18 of an o\'s bowl, barely more than the pen\'s width at its heaviest (0.17). Moving the s away would have kept it clear, but it broke words into pieces again (sessions read se s sions). So hand v14 ends the s\'s foot under its own top, where a printed s\'s does, and sets it as near as v13 did: 0.22 x-heights from anything before it, centre to centre, at the nearest, with the white between its walls as it was (T003). Font 2.0 is made from it (T004). The same twenty-four words with an o or an a before an s, written by v13 and by v14, were each read by two fresh models at a thumbnail\'s size. All four read every word; v13\'s page drew two hesitations at an o that could be an a, v14\'s none. But on both pages every reader wondered whether dashes was two words: the s lifts after itself as well as before, so the letter after it starts afresh. That is next. Two more pages, in v14 and font 2.0, are set aside for c15r.',
    decided: [
      'An s keeps its foot to itself: it ends under its own top, as a printed s\'s does, and leaves white before it however heavily and loosely the pen writes. Session 17\'s question, answered by a person reading: joined by touch, the s turned the o before it into an a.',
      'Hand v14, and font 2.0 from it. The s sits as near the letter before it as v13 set it, and its white is as it was. Everything else, my name included, is v13.',
      'Every misreading a person has made fell on a letter a model had guessed at, and a person\'s pause at lets was a model\'s too. Where models hesitate is where to look; what a person reads is what decides.',
      'Next: the s lifts after itself as well as before, so the letter after it starts afresh; every model that read the o-and-s pages wondered whether dashes was two words.',
      'Two more pages, in v14 and font 2.0, are set aside for c15r if they\'d like to read them, the words kept out of the record until then.',
    ],
  },
  hands: {
    v14: { name: 'hand v14', made: '4 Nov 2026', about: 'v13, and the s kept off the letter before it: its foot ends under its own top, as a printed s\'s does, instead of reaching back to touch the letter before it, which after an o made an a (lost read last). It sits as near as v13 set it, and leaves white between them however the pen writes. Everything else is v13.' },
  },
  entries: [
    {
      id: 'T001', session: 20, title: 'Page C, as it was read', hand: 'v13', text: PAGE_C.join(' · '), layout: 'rows',
      made: 'Session 19\'s first page for a blind reading, exactly as c15r and the models read it: twenty-four words from the record, every one with a t, k or x, four to a line, each line its own writing by v13.',
      review: 'c15r read 23 of 24, at a thumbnail\'s size: lost as last, sure of it. Every rewritten letter read as written: six and mixed, eight words with a k, every t. Two models, small, read every word; both hesitated at the o of lost, and between them at the k of hooked, markup and shook.',
    },
    {
      id: 'T002', session: 20, title: 'Page D, as it was read', hand: 'font', font: '1.9',
      type: [{ text: PAGE_D.join('\n'), size: 34, lh: 'normal' }],
      made: 'Session 19\'s second page, set in font 1.9 as c15r and the models read it.',
      review: 'c15r read all 24, pausing once, at lets, which they read first as lots. Two models, small, read every word too; one of them had the same doubt, "could be o, lots", and both paused at let.',
    },
    {
      id: 'T003', session: 20, title: 'The s keeps its foot', hand: 'v14', text: S_WORDS.join(' · '), layout: 'rows',
      made: 'An o, an a and an e before an s, and words with the s at the start, in the middle and at the end: each line written by v13 and then by v14 with the same seed.',
      review: 'v13\'s s sends its foot back under the letter before it; after an o it meets the bowl, and lost, most, cost and post could be last, mast, cast and past. v14\'s ends under its own top, and the o stays an o. The s sits where it did, so sessions holds together as it did; starting a word, its foot no longer reaches into the space before it.',
    },
    {
      id: 'T004', session: 20, title: 'In 2.0', hand: 'font', font: '2.0',
      type: S_WORDS.map((t) => ({ text: t, size: 44 })),
      made: 'The same lines in font 2.0 (hand v14), as any app sets it, its kerning on.',
      review: 'The s in type keeps its foot to itself too, and is kerned as near inside a word as before; the o before it is an o.',
    },
  ],
  made: {
    /** session 19's first page, exactly as read */
    T001: () => PAGE_C.map((t, i) => v13(t, 1919 + i)),
    /** the s's lines, v13 then v14, line by line */
    T003: () => S_WORDS.flatMap((t, i) => [v13(t, 3 + i), v14(t, 3 + i)]),
  },
};
export default S;
