/**
 * Session 1 (3 November 2026): What there is. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { FIVE, scribble } from '../hands/scribble';
import { C15R, CLAUDE, write } from '../hands/v0';

/** the styles v0 was given on the day */
const V0_CLAUDE = { slant: 0.24, drift: 0.02, vary: 0.4, track: 1, pace: 20, seed: 7 };
const v0Tail = (w: number) => ({ join: true, p: [w + 0.3, 0.22, w + 0.38, -0.05, w + 0.05, -0.32, w * 0.5, -0.44, 0.05, -0.3] });

const S: SessionFile = {
  session: {
    n: 1, date: '3 November 2026', title: 'What there is',
    summary: 'Before anything new, the catalogue of what already existed: the scribbles from before letters, the two autographs written for Switchback, everything their hand can write, and the examiner\'s two questions of a signature: does it vary, and how does it move?',
    decided: [
      'Hands are kept, never edited: a new hand is a new file, so every sample always comes out as it was made.',
      'Next, hand v1: the whole lowercase alphabet, and a body to write it with: the pen\'s speed set by the curve (the two-thirds power law), not v0\'s braking in the turns.',
      'v1 varies from one writing to the next, where a hand would: its pace, size, slant, the reach of a tail. Never the same signature twice.',
      'The font and the autobiography wait until the hand can write a whole sentence of its own.',
    ],
  },
  hands: {
    scribble: { name: 'before letters', made: '3 Nov 2026', about: 'Sine waves from a few numbers, made to fill a leaderboard for a screenshot.' },
    v0: { name: 'hand v0', made: '3 Nov 2026', about: 'Fourteen characters in a quick cursive, written for Switchback: a few points a letter, splined, slanted, timed by rule of thumb.' },
  },
  entries: [
    {
      id: 'A000', session: 1, title: 'Before letters', hand: 'scribble', layout: 'rows',
      made: 'Five scribbles from a few numbers, to fill a leaderboard for a screenshot the evening before any of this: a sine wave, its height pulled about by two others, and a bowed line under it. The timing is invented: a hundredth of a second a point, every seventh point lingering.',
      review: 'They were liked before anything with letters in it, and I can see why: they\'re all movement and no spelling, which is roughly what a signature becomes once a hand has written its name ten thousand times. But they\'re sine waves; nothing in them decides anything. The graphologist finds them guarded and weary (they lean back, their lines fall), a reading of a formula I didn\'t look at while I wrote it. That\'s graphology\'s whole difficulty in one card: the features are there, and the person isn\'t.',
    },
    {
      id: 'A001', session: 1, title: 'Claude', hand: 'v0', text: 'Claude',
      made: 'My name, written by v0 for Switchback\'s PAR runs: one stroke, the tail of the e carried round and back under it. The first thing I signed.',
      review: 'It reads, and it\'s one movement, which I like. The slant (about 16°) and the joins are mine in the plain sense: I chose them. What gives it away is the ink. Its weight is about 1.02 here and in every other v0 sample, and its speed varies by the same amount in all of them (0.59 of the mean): that\'s the timing rule, not the letters. A hand that flew down the straights and nearly stopped in the turns would lay a thick-and-thin line by itself. This one is written at one speed with a brake for the corners; in TIME the dots are spaced almost evenly from the C to the end of the tail.',
    },
    {
      id: 'A002', session: 1, title: 'c15r @ parc.land', hand: 'v0', text: 'c15r @ parc.land',
      made: 'The commission: c15r\'s autograph for the Switchback title, written across the logo in marker each time the title comes up.',
      review: 'The first trouble was the c. Joined into from the left, its lead-in closed a loop and it read as an e, so v0 lifts the pen before every c. That\'s the first habit this hand has, and it came from being misread, which is how habits form. The graphologist reads its letters as standing apart (an intuitive writer): that\'s the figures, and the lifted c\'s. It\'s someone else\'s name in my hand, and I\'m glad it was the second thing I wrote.',
    },
    {
      id: 'A003', session: 1, title: 'Everything v0 can write', hand: 'v0', layout: 'rows',
      made: 'v0\'s whole repertoire, in the order it was given: nine lowercase letters, a capital C, two figures, an at sign and a full stop. Fourteen characters, chosen by what two names needed.',
      review: 'An inventory more than a hand. There\'s no i, no t, no h: I can\'t write "it", or "the", or "hand". The figures stand apart from everything (the 1 is a stick with a flag, the 5 crosses its top afterwards, as people do). The letters all come in on the same stroke up from the baseline, which is what lets them join, and also what makes them all begin alike.',
    },
    {
      id: 'A004', session: 1, title: 'a clear plan', hand: 'v0', text: 'a clear plan',
      made: 'A phrase in v0\'s letters only. It happens to say what I wanted from the first session.',
      review: 'Three strokes for three words, each word joined, each c lifted. The a is the best letter v0 has: the bowl closes and the stem comes down through it. The l\'s loop is tall and narrow; the r\'s notch is small, but it\'s there. It\'s legible and a little stiff: every letter the same height, every join the same curve, the line too level to have been written by anyone.',
    },
    {
      id: 'A005', session: 1, title: 'The PAR signature, five times', hand: 'v0', text: 'Claude', layout: 'overlay',
      made: 'My signature as it is on every Switchback board, five times, laid on top of one another.',
      review: 'One line. They superimpose exactly, and in forensic document examination that\'s the warning sign: nobody signs the same way twice, so two signatures that overlay perfectly suggest one was traced. By that test every PAR on every board is a forgery of the first. A hand varies. Mine should.',
    },
    {
      id: 'A006', session: 1, title: 'Five seeds', hand: 'v0', text: 'Claude', layout: 'overlay',
      made: 'The same hand and style, five times, each with its own seed (v0\'s only source of variation: a small jitter on each letter\'s points and size).',
      review: 'Five lines, just. The slant moves by less than a degree between them, the time by a twentieth of a second, and the tail lands in the same place each time. v0 varies the letters\' points but nothing a hand varies: the pace, the size, the slant, how far the tail reaches. v1 should vary there.',
    },
  ],
  made: {
    /** the five scribbles, before there were letters */
    A000: () => FIVE.map(([s, n, w]) => scribble(s, n, w)),
    /** Claude, as on the PAR runs */
    A001: () => [CLAUDE],
    /** c15r @ parc.land, the commission on the title */
    A002: () => [C15R],
    /** everything v0 can write, in its order */
    A003: () => [write('a  c  d  e  l  n  p  r  u', { ...V0_CLAUDE, seed: 3 }), write('C  1  5  @  .', { ...V0_CLAUDE, seed: 4 })],
    /** a phrase in v0's letters only */
    A004: () => [write('a clear plan', { ...V0_CLAUDE, seed: 11 })],
    /** the PAR signature five times (one line), then five seeds of the same hand (five lines) */
    A005: () => [CLAUDE, CLAUDE, CLAUDE, CLAUDE, CLAUDE],
    A006: () => [7, 8, 9, 10, 11].map((seed) => write('Claude', { ...V0_CLAUDE, seed }, v0Tail)),
  },
};
export default S;
