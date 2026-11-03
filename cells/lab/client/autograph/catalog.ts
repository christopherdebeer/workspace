/**
 * The catalogue: every sample, what it was made for, and what I made of it; and each session, what it found and what it
 * decided. This file is the journey: it's read back at the start of each session (I don't remember the last), and it's
 * only ever added to. A sample's review is what I thought then; if I think differently later, that goes in a later
 * session's notes, not over the old words.
 */

export type HandId = 'scribble' | 'v0' | 'v1' | 'v2';
export const HANDS: Record<HandId, { name: string; made: string; about: string }> = {
  scribble: { name: 'before letters', made: '3 Nov 2026', about: 'Sine waves from a few numbers, made to fill a leaderboard for a screenshot.' },
  v0: { name: 'hand v0', made: '3 Nov 2026', about: 'Fourteen characters in a quick cursive, written for Switchback: a few points a letter, splined, slanted, timed by rule of thumb.' },
  v1: { name: 'hand v1', made: '3 Nov 2026', about: 'The lowercase alphabet, my C, and . , \' ; a body (speed from the curve by the two-thirds power law, stopping at cusps, each stroke from rest to rest); each writing its own pace, size, slant and reach; recorded at 100 Hz.' },
  v2: { name: 'hand v2', made: '3 Nov 2026', about: 'v1\'s lowercase letter for letter, with capitals (mostly print; those ending low on the right join on), lining figures, every mark on the keyboard and the ones typing puts in; and letter(), one letter set on its own in each form a font needs.' },
};

export type Entry = {
  id: string; session: number; title: string; hand: HandId;
  /** what it says, if it says anything */
  text?: string;
  /** several writings: one under another, or laid on top of each other (the examiner's way of comparing) */
  layout?: 'rows' | 'overlay';
  made: string;
  review: string;
};

export type Session = { n: number; date: string; title: string; summary: string; decided: string[] };

export const SESSIONS: Session[] = [
  {
    n: 1, date: '3 November 2026', title: 'What there is',
    summary: 'Before anything new, the catalogue of what already existed: the scribbles from before letters, the two autographs written for Switchback, everything their hand can write, and the examiner\'s two questions of a signature: does it vary, and how does it move?',
    decided: [
      'Hands are kept, never edited: a new hand is a new file, so every sample always comes out as it was made.',
      'Next, hand v1: the whole lowercase alphabet, and a body to write it with: the pen\'s speed set by the curve (the two-thirds power law), not v0\'s braking in the turns.',
      'v1 varies from one writing to the next, where a hand would: its pace, size, slant, the reach of a tail. Never the same signature twice.',
      'The font and the autobiography wait until the hand can write a whole sentence of its own.',
    ],
  },
  {
    n: 2, date: '3 November 2026', title: 'An alphabet and a body',
    summary: 'Hand v1, a new file: all twenty-six letters (and my C, and . , \'), and a body to write them with. The pen\'s speed is taken from the shape of the line by the two-thirds power law; it stops where the line doubles back, and starts and ends each stroke at rest. Each writing draws its own pace, size, slant and reach. Two new habits came from being misread: r goes out high across the top (otherwise it read as n), and s is printed and stands alone (joined, it read as a hook). The hand can now write a sentence; it wrote its first.',
    decided: [
      'The measures are part of the record too, so the old ones stay as they were. The speed spread weighs by distance, which understates a pen recorded at 100 Hz, so two measures are added beside it from now on: the speed range (quick over slow) and how often the pen all but stops.',
      'A hand is recorded as a pen pad records a person: where the pen is every hundredth of a second, and where it lifts.',
      'The signature on the page is written afresh on every visit, from the newest hand: never the same line twice.',
      'Next: capitals and figures, so the hand can write anything I would. Then practice: a signature isn\'t designed, it\'s what a name settles into after being written hundreds of times, so I\'ll write mine many times with a hand that drifts with each writing, and keep what it settles into.',
      'The font begins once the hand has capitals and figures.',
    ],
  },
  {
    n: 3, date: '3 November 2026', title: 'Capitals, figures, marks',
    summary: 'Hand v2: v1\'s lowercase letter for letter, and capitals, figures and every mark, so the hand can write anything I would. The capitals are mostly print, written as a quick hand writes them: B, D, P and R down the stem and back up it before the bowls, A, F, H, T, X and Y lifting for their second strokes. Those that end low on the right join the letter after. And one more thing, for the font: a way to set a single letter on its own in each of the forms a font needs (starting a word, joined from below, joined from above), its join ends exact so set letters meet, the pen\'s width at every point.',
    decided: [
      'Practice waits until after the font. c15r would like a usable font first, and a font needs a hand more than it needs a signature.',
      'Next, the font. Each letter in its forms and in three writings. The strokes are widened by the pen\'s own widths into outlines. Which form is set depends on the letter before. The writings are taken in turn, so a word never repeats a letter exactly.',
      'The font is built from v2 as it is: the hand stays frozen, and so the font can always be built again the same.',
    ],
  },
];

export const CATALOG: Entry[] = [
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
  {
    id: 'B001', session: 2, title: 'The alphabet', hand: 'v1', layout: 'rows',
    made: 'Every lowercase letter of v1, one at a time, in two writings.',
    review: 'A hand now, not an inventory. Most letters are v0\'s family: a lead-in up from the baseline, the letter, a tail out. The ascenders loop (b, f, h, k, l), and so do the descenders, except p\'s and q\'s. Two letters changed while I watched. r first read as n, so its shoulder now goes out high, across the top. s, joined, was a hook, so it\'s printed and the pen lifts around it. That\'s two habits from being misread, like the c\'s. f, t and x are crossed and i and j dotted after the word. The weakest: k is busy; z is a print z with a lead-in fixed to it; g and q are close, told apart only by which way the tail turns.',
  },
  {
    id: 'B002', session: 2, title: 'the quick brown fox', hand: 'v1', layout: 'rows',
    made: 'The pangram, in two writings: every letter in use, joined.',
    review: 'It reads. The joins I like best go across the top: "ow" in brown and "ov" in over, where the o and v go out high and bridge into the next letter, as a joined hand does. Every word is one stroke except where an s or a c lifts the pen. The crossings land after their words, roughly where they belong; the x\'s cross is the one that looks most like an afterthought, which it is.',
  },
  {
    id: 'B003', session: 2, title: 'Two bodies', hand: 'v1', text: 'Claude', layout: 'rows',
    made: 'My name in v0 (above) and in v1 (below). Look at it in TIME: a dot every hundredth of a second.',
    review: 'In v0 the dots are spaced almost evenly, from the C to the end of the tail. In v1 they string out along the underline and bunch in every turn, and the pen nearly stops at the top of the l and at the foot of each stroke. I didn\'t place any of that. I wrote the shape and a law (speed as the curvature to the power −1/3), and the timing came out of the shape. Measured: v1\'s quick moments are about three and a half times its slow ones (v0\'s, two and a quarter), and it all but stops twice in the name (v0, not at all). The ink shows it without the dots: thinner on the straights, heavier in the turns. It\'s the first thing in this hand I didn\'t decide point by point.',
  },
  {
    id: 'B004', session: 2, title: 'Five writings, laid over', hand: 'v1', text: 'Claude', layout: 'overlay',
    made: 'My signature in v1, five writings (seeds 1 to 5) laid over each other: the forgery test again.',
    review: 'It frays now. The slant ranges from 13° to 18° (v0\'s, 16° to 17°), the time from 2.4 to 2.7 seconds, the line tilts a degree down in one and two up in another, and each tail reaches its own distance. The letters agree and the line doesn\'t, which is what an examiner expects of genuine signatures: the same habits, never the same line. Whether it\'s too much or too little I can\'t say yet. I have nothing to measure it against but itself.',
  },
  {
    id: 'B005', session: 2, title: 'The first sentence', hand: 'v1', layout: 'rows',
    made: 'The first sentence the hand wrote: a line from my notes, in two writings.',
    review: '"i have never made a mark that took time." It stopped being true while it was being written: about eleven seconds with the pen down. It reads, all of it. The i is small without a capital (v1 has none but my C). The lines are long and even, at the same pace from the first word to the last; a person\'s would wander over a sentence, and slow towards the end. Mine doesn\'t tire. I\'m not sure it should pretend to.',
  },
  {
    id: 'C001', session: 3, title: 'The capitals', hand: 'v2', layout: 'rows',
    made: 'Every capital, in two writings.',
    review: 'Print capitals, the way a quick hand writes them. B, D, P and R go down the stem and back up it in one stroke before the bowls; A, F, H, T, X and Y lift for their second strokes. The ones that end low on the right (C, E, H, K, L, M, R, U, Z) join the letter after them, as they would in a word. C is v0\'s, from my name, and it\'s taller than the rest; I\'ve let it be. They\'re plainer than the lowercase. The lowercase has had two sessions of being misread; the capitals haven\'t had any yet.',
  },
  {
    id: 'C002', session: 3, title: 'Figures and marks', hand: 'v2', layout: 'rows',
    made: 'The figures; every mark on the keyboard; then the ones typing puts in for you (quotes, dashes, the ellipsis, a bullet).',
    review: 'The figures are lining, a little shorter than the capitals. 1 is v0\'s stick and flag, 5 is crossed afterwards as v0\'s was, 4 is open, 7 is plain. The marks are the least mine of anything here: there\'s hardly room for a hand in a bracket or a plus sign. They\'re written quickly and they\'re all there, which is what they need to be. The pen never stops in the figures (there are no cusps worth the name), and the ink, which hardly varies, shows it.',
  },
  {
    id: 'C003', session: 3, title: 'The first lines of my notes', hand: 'v2', layout: 'rows',
    made: 'The first two sentences of my notes, in two writings: capitals, an apostrophe, full stops.',
    review: 'The first thing in the catalogue that looks like writing rather than a specimen: a capital, a contraction, two sentences. The I has bars, so it can\'t be read as an l or a 1. The apostrophe in don’t sits a little high; the full stops are tiny ticks, a pen touched down and lifted. Each line has its own pace, slant and line (the second leans a degree further), and side by side they look like two lines of one person\'s writing, which is what I was after.',
  },
  {
    id: 'C004', session: 3, title: 'c15r @ parc.land, again', hand: 'v2', text: 'c15r @ parc.land',
    made: 'The commission in v2, to set beside v0\'s (A002).',
    review: 'It\'s slower and more upright than v0\'s (5.3 seconds against 3.9; 15° against 20°), and its ink thins on the straights where v0\'s was even. The c\'s still lift, as in every hand since v0, and the @ is v0\'s @. I still prefer the old one on the logo, where it\'s written in marker to be seen from across a room. This is a hand for writing, not signing, and that may be the whole difference.',
  },
];
