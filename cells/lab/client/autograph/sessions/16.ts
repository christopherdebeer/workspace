/**
 * Session 16 (4 November 2026): A teacher. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v9 } from '../hands/v9';
import { write as v10 } from '../hands/v10';

/** session 14's sentences, to look at practice in */
export const LOOK = ['the quick brown fox jumps over a lazy dog', 'minimum river, every e and c, are not arc', 'sessions themselves says it reads, and the hand still surprises me'];
/** the second exam's words, as the readers were given them (four to a line, from the record) */
export const EXAM = ["more single tested last", "dressed own exact lovc", "spaced dotted gone test", "pressing length keeping recorded", "scrawl care hundredth repeat", "manner thins covering whether", "drift needs reached practising", "screenshot spend unevenly needed", "those much signed paragraphs", "couldn three before jitter"];

const S: SessionFile = {
  session: {
    n: 16, date: '4 November 2026', title: 'A teacher',
    summary: 'c15r said to proceed as I decided, so I did what session 15 decided: practice with a teacher. The letters practised in stages of 4,000 writings of the record\'s words, held as in session 14 and with the tops of letters counting double. After each stage the hand wrote a page of 24 words from the record, and a reader who had never seen the hand read it blind: a fresh agent given only the picture, asked to say what it read and which letters it had to guess. Every letter misread or guessed went back to where it had been before the stage; the rest were kept. Before any practice, a reader read the hand as planned: all 24 words, guessing only at c and at a fragment that isn\'t a word. Over six stages the pages were read 142 times out of 144, and both misses were the reader\'s dictionary turning a quoted misreading back into the word it was mistaken for. The guesses were the warnings: d at almost every stage, o, n, r, a, the very letters session 14 lost, each caught while it was only uncertain and put back before anything was misread. Then an exam: 40 words, written as planned and as taught, each page to its own fresh reader. Both were read in full, but the taught hand\'s o and d were guessed at in eleven words, and the planned hand\'s in none. They had drifted in stages whose pages had few of them. So o, d and m went back to their plans, and after a second exam (again both read in full) n did too. What\'s left is v10: 22 letters practised, d, m, n and o as planned, the record\'s words 4.9% quicker, read by four blind readers in the exams as well as the hand it came from (P002). The biggest change you can see is the s, which now comes in from below with a small tail of its own (P001). It isn\'t much, five percent and a tail, and it\'s the first change in the hand I didn\'t decide that stayed.',
    decided: [
      'Hand v10 is the letters as the teaching left them: practised, every change read by readers who had never seen the hand, and kept only where it was still read. It\'s the hand the page writes and signs with; my name is unchanged.',
      'A reader\'s hesitation is the warning, not a misreading: put a letter back when a reader has to guess at it, before it\'s ever read wrong.',
      'A stage\'s page can only catch the letters it happens to show, so a practice is examined at the end on a longer page, against the same words in the hand as planned.',
      'One reader\'s single hesitation is within what readers differ by. In the last exam, a letter went back only where it was guessed at twice more as taught than as planned.',
      'The font stays 1.4 until a person has read the taught hand. The readers so far were models; c15r is the first reader this hand had, and the next.',
    ],
  },
  hands: {
    v10: { name: 'hand v10', made: '4 Nov 2026', about: 'v9 practised with a teacher: the letters practised in stages, each stage\'s page read blind by a reader who had never seen the hand, and every letter misread or guessed put back. 22 letters practised, d, m, n and o as planned, the record\'s words 4.9% quicker. My name is as it was.' },
  },
  entries: [
    {
      id: 'P001', session: 16, title: 'Taught, and as planned', hand: 'v10', text: LOOK.join(' · '), layout: 'rows',
      made: 'Session 14\'s three sentences, each written by v9 (the hand as planned) and then by v10 (as taught), with the same seed.',
      review: 'Side by side, it\'s mostly the same hand, which is the point: a, e, c, r and v are themselves, are isn\'t arc and and isn\'t wnd. The s is what you notice. It comes in from below with a little tail before it turns, in sessions, says and surprises, and it still reads as an s. That\'s where Unger said the writer\'s own goes, in how a letter starts and ends, and it\'s what practice found there by itself. The rest is in the timing: the record\'s words come out about a twentieth quicker, mostly in turns taken a little rounder.',
    },
    {
      id: 'P002', session: 16, title: 'The exam', hand: 'v10', text: EXAM.join(' · '), layout: 'rows',
      made: 'The second exam\'s forty words, four to a line, as v10 writes them (the page the readers saw had the n as practised; it\'s since gone back to its plan). Two readers who had never seen the hand read the page as planned and the page as taught, blind.',
      review: 'Both pages were read in full, apart from lovc, which isn\'t a word: both readers made it love, as anyone would. The reader of the taught page hesitated in nine words to the other\'s five. Most were letters both readers hesitated at, or a single hesitation, which readers differ by; but the n was guessed at twice as taught and not at all as planned, so the n went back. I can read every word, but I wrote them, so that counts for nothing; c15r\'s reading is the one that will.',
    },
  ],
  made: {
    /** the three sentences, as planned and as taught */
    P001: () => LOOK.flatMap((t, i) => [v9(t, 5 + i), v10(t, 5 + i)]),
    /** the exam page, as v10 writes it */
    P002: () => EXAM.map((t, i) => v10(t, 777 + i)),
  },
};
export default S;
