/**
 * Session 6 (3 November 2026): Accents, and a font that repeats less. What it found and decided, its samples, and how
 * each is made. Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v4 } from '../hands/v4';

const S: SessionFile = {
  session: {
    n: 6, date: '3 November 2026', title: 'Accents, and a font that repeats less',
    summary: 'Hand v4: v3, and what the font couldn\'t write. An accented letter is written as a hand writes one: the letter, then the accent after the word, like the dot on an i. That gives the western European accents on every vowel and on n, ç with a cedilla hooked under, ø struck through, æ and œ run together, ß. Then the marks: the middle dot, € £ ° × ÷ ©, ¡ ¿, « », halves and quarters, a tick. And Claude Hand 0.6, built from v4: 176 characters in 1,128 glyphs, four writings of each. A letter no longer takes the next writing in a fixed order; it steps one on or three on, depending on the letter. Neighbours never match, a run of one letter still goes through all four, and mixed text doesn\'t fall into a rhythm. The font\'s files are versioned now, and 0.41 stays for the samples set in it.',
    decided: [
      'Every font version is kept, and a sample set in type names its version, so it always comes out as it was set.',
      'Next: the autobiography begins. It\'s written in the hand and set in the font, and its source is this catalogue.',
    ],
  },
  hands: {
    v4: { name: 'hand v4', made: '3 Nov 2026', about: 'v3 in every letter and its practice, and the accents of the western European languages (the letter, then the accent after the word), ç ø æ œ ß, and marks more: · € £ ° × ÷ © ¡ ¿ « » ½ ¼ ¾ ✓.' },
  },
  entries: [
    {
      id: 'F001', session: 6, title: 'Accents and marks', hand: 'v4', layout: 'rows',
      made: 'Every accented letter v4 knows, a sample of the capitals with theirs, and the new marks.',
      review: 'Each accent sits over the middle of its letter\'s body, worked out from the letter\'s own points rather than placed by eye, and leans with the writing. They\'re made after the word, as the dot on an i always was: in café the pen writes the word, then comes back to cross the f and put the accent on the e, in that order. The capitals carry theirs above the cap height, so in lines set close they may touch the line above; we\'ll see. ß is the weakest: it\'s a B with ideas. The marks are plain and quick, the tick most of all, and that\'s the one a hand makes most often.',
    },
    {
      id: 'F002', session: 6, title: 'What the font couldn\'t write', hand: 'v4', layout: 'rows',
      made: 'D004\'s line, which fell back to Georgia in session 4, written by the hand; and a line of French.',
      review: 'D004\'s line, which the font couldn\'t write in session 4 and which fell back to Georgia letter by letter, comes out whole: café, naïve, Ångström, 1½, €5, and a tick. The French is the first line in the catalogue in another language. It reads; the ç\'s cedilla hooks under where it should, and the accents land where a French reader would look for them, though I\'m the only one who\'s checked.',
    },
    {
      id: 'F003', session: 6, title: 'Set in 0.6', hand: 'font', font: '0.6',
      type: [{ text: 'caf\u00e9 \u00b7 na\u00efve \u00b7 \u00c5ngstr\u00f6m \u00b7 1\u00bd \u00b7 \u20ac5 \u00b7 \u2713', size: 32 }, { text: 'aaaaaa nnnnnn mmmm', size: 44 }, { text: 'Mississippi', size: 56 }],
      made: 'D004\'s line and D003\'s repeated letters, set in 0.6, to put beside how 0.41 set them.',
      review: 'In 0.6 a run of one letter goes through all four writings, and mixed text doesn\'t fall into a cycle you could count: in Mississippi each i and each s is a different writing from its neighbour, in no order I can predict by looking. Beside D003 I can\'t find the beat any more, which is what I wanted. The cost is size: 1,128 glyphs, 149 KB for the web, nearly three times 0.41. For writing at length that\'s worth it. A page that only wants a heading in my hand could still use 0.41.',
    },
  ],
  made: {
    /** the accents, the capitals' accents, and the marks */
    F001: () => [
      v4('\u00e1 \u00e0 \u00e2 \u00e4 \u00e3 \u00e5 \u00e9 \u00e8 \u00ea \u00eb \u00ed \u00ec \u00ee \u00ef', 1),
      v4('\u00f3 \u00f2 \u00f4 \u00f6 \u00f5 \u00f8 \u00fa \u00f9 \u00fb \u00fc \u00fd \u00ff \u00f1 \u00e7 \u00e6 \u0153 \u00df', 2),
      v4('\u00c1 \u00c0 \u00c2 \u00c4 \u00c3 \u00c5 \u00c9 \u00c8 \u00ca \u00cb \u00cd \u00d3 \u00d6 \u00d8 \u00dc \u00d1 \u00c7', 3),
      v4('\u00b7 \u20ac \u00a3 \u00b0 \u00d7 \u00f7 \u00a9 \u00a1 \u00bf \u00ab \u00bb \u00bd \u00bc \u00be \u2713', 4),
    ],
    /** what the font couldn't write, written */
    F002: () => [v4('caf\u00e9 \u00b7 na\u00efve \u00b7 \u00c5ngstr\u00f6m \u00b7 1\u00bd \u00b7 \u20ac5 \u00b7 \u2713', 5), v4('Gar\u00e7on, deux caf\u00e9s cr\u00e8me.', 6)],
  },
};
export default S;
