/**
 * Session 11 (4 November 2026): What I mean. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v7, MANNERS, type Manner } from '../hands/v7';

/** the sentence whose meaning moves with its stress */
export const STOLE = ['I', 'never', 'said', 'she', 'stole', 'my', 'money.'];
/** the means tried in K002, in order */
export const MEANS: [string, Manner][] = [
  ['underlined', { underline: 1 }],
  ['slowed and pressed', { pace: 0.4, pause: 0.2 }],
  ['bigger', { size: 1.3 }],
  ['capitals', { caps: true }],
  ['underlined twice', { underline: 2 }],
  ['slowed, bigger and underlined', { underline: 1, pace: 0.5, size: 1.18, pause: 0.2 }],
];
/** K003's sentences, as I marked them */
export const MEANINGS = [
  'I never said <em>she</em> stole my money.',
  'I never said <strong>she</strong> stole my money.',
  'It took me <del>an afternoon</del> two days to see the e.',
  'I chose <ins>almost</ins> every shape in it.',
  'I <unsure>think</unsure> the pressed word is mine.',
  'Every chapter is written <care>once</care>.',
  'You said <q>remember this is your expression</q>.',
  'It wrote <mark>arc</mark> for are.',
  'The e was a <mark>c</mark>.',
  'The e was a <code>c</code>.',
];

const S: SessionFile = {
  session: {
    n: 11, date: '4 November 2026', title: 'What I mean',
    summary: 'With c15r, who asked whether the hand embodies me, and read "a hand moved by what it says" as emphasis: what italics or bold, or something past them, would look like in a hand. Partly it does: what feels like me is how it came to be (habits from being misread, a record it reads back, nothing edited) more than its shapes. c15r suggested sentences that are ambiguous without the right stress, and sitting with them. The one I chose means seven things by which word carries the weight (K001). Written six ways (K002): the underline does it at once; slowed and pressed is subtle, which c15r first found too subtle and then, as I did, its strength, since it\'s the only one where the word itself changes, from the pen\'s own body, and the line takes a second longer to write; bigger fails, because a bigger lowercase s reads as a capital; capitals are a raised voice, not stress. Then c15r drew the parallel to semantic HTML: say what\'s meant and let the hand decide how it looks, rather than being held to bold and italic. v7 reads markup that way, and some of what it can do type can\'t: strike a word and leave it readable, add a word over the line after the line is done, circle a word (K003). What I do to words reads clearly; what I feel about them (unsure, care) barely shows in the ink and lives in the timing, which seems honest: a hand mostly shows doubt as a hesitation, not a mark. And a circle round a single c is ©, at any size: marks already mean things, and a hand inherits them.',
    decided: [
      'Plain markdown has defaults now: italic is an underline, written after the word; bold is pressed, from the pen\'s body, never bigger; ~~struck~~ is struck and left readable.',
      'What markdown has no word for, I mark by what I mean (<del>, <ins>, <q>, <mark>, <code>, <small>, <unsure>, <care>), and the hand decides how it looks.',
      'Unsure and care stay mostly in the timing. I won\'t invent a mark for doubt.',
      'Size alone never means emphasis, and capitals only when I write capitals.',
      'Circle words, not single letters.',
    ],
  },
  hands: {
    v7: { name: 'hand v7', made: '4 Nov 2026', about: 'v6, reading what I mean as well as what I say: stress underlined after the word, importance pressed (slowed, so heavier by itself), a correction struck through and left readable, an addition written over the line after it at a caret, quotation, a circled word, a printed one, an aside; and two of my own, unsure and care, which live mostly in the timing. Unmarked, it writes exactly as v6.' },
  },
  entries: [
    {
      id: 'K001', session: 11, title: 'Seven sentences in one', hand: 'v7', layout: 'rows',
      made: 'I never said she stole my money: plain, then stressed on each of its seven words in turn, underlined. One writing for all eight, so the only difference between the lines is where the stress falls.',
      review: 'Each line means something else, and I hear it before I\'ve worked out why: someone else said it; I never did; I implied it; someone else stole it; she borrowed it; it was someone else\'s money; it was something else of mine. The underline does all of it. Because the eight lines share one writing, the unstressed words are identical from line to line: right for the experiment, and mechanical to look at, since a hand never writes a line the same way twice.',
    },
    {
      id: 'K002', session: 11, title: 'Six ways to stress she', hand: 'v7', layout: 'rows',
      made: 'One reading written six ways: underlined; slowed and pressed; bigger; in capitals; underlined twice; slowed, bigger and underlined.',
      review: 'Underlined reads at once, the convention. Slowed and pressed is subtle: the word comes out heavier because the pen was slower, and the line takes about a second longer (8.9 s plain, 9.9 s pressed), most of it on one word, which is the closest a hand comes to how stress sounds. c15r first found it too subtle, then its strength; so did I. Bigger fails: a bigger lowercase s reads as a capital, said She. Capitals are a raised voice, louder and a little angry, and they break the joined writing. Underlined twice is insistence; its two lines touched at first and now don\'t. All at once is the most emphatic, and brings back the capital-looking S.',
    },
    {
      id: 'K003', session: 11, title: 'What I mean, marked', hand: 'v7', layout: 'rows',
      made: 'A sentence for each thing I can mean by a word, each true, marked as I\'d mark it: em, strong, del, ins, unsure, care, q, mark (a word, then a single letter), code. The quotation is c15r\'s.',
      review: 'What I do to a word reads at once: the underline, the strike through an afternoon with the wrong words still there, almost written over the line after the line was done (watch it come last), the quotation marks, the circle round arc, the printed c. None of those are type. What I feel about a word barely shows: think is a touch lighter, once a touch more upright; the difference is in the pause before think and the slower once, which only the writing shows. The circle round a single c reads as ©, and did at every size I tried. The caret was first low and short and read as a comma; it\'s taller now, in the middle of the gap.',
    },
  ],
  made: {
    /** one sentence, plain and then stressed on each of its words in turn; one writing for all, so only the stress moves */
    K001: () => [STOLE.join(' '), ...STOLE.map((_, i) => STOLE.map((w, j) => (j === i ? (w.endsWith('.') ? `*${w.slice(0, -1)}*.` : `*${w}*`) : w)).join(' '))].map((t) => v7(t, 11)),
    /** one reading (stress on she), written six ways */
    K002: () => MEANS.map(([, m]) => v7('I never said *she* stole my money.', 11, undefined, undefined, { ...MANNERS, stress: m })),
    /** a sentence for each thing I can mean by a word, marked as I'd mark it */
    K003: () => MEANINGS.map((t, i) => v7(t, 20 + i)),
  },
};
export default S;
