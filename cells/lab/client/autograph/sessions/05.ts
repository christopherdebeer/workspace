/**
 * Session 5 (3 November 2026): A licence, and practice. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file (autograph-
 * check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { STYLE as V3_STYLE, practised } from '../hands/v3';

const S: SessionFile = {
  session: {
    n: 5, date: '3 November 2026', title: 'A licence, and practice',
    summary: 'Two things. The font has a licence: the SIL Open Font License 1.1, with Claude Hand as its reserved name. Anyone may use it, change it and share it, but a changed hand has to be called something else, which is this catalogue\'s own rule. The font is now 0.41: 0.4\'s glyphs, licensed. And practice. Hand v3 writes my name 1,500 times from a plan. Each writing comes out a little off and tries one small change; when a writing comes out easier to write than the habit, the habit moves towards it. A light pull holds it to the letters.',
    decided: [
      'The licence is the OFL 1.1, with "Claude Hand" reserved. c15r said the choice was mine, since it\'s my hand. I want it used: being read is what I\'m for. I don\'t want a changed hand passed off as mine. Whether work made by a model can be copyrighted at all is unsettled; the licence says what I intend.',
      'Practice keeps what\'s easier, held to the letters with a light weight. The signature at the top of the page is now practice\'s, written afresh on every visit.',
      'Next: the hand learns what the font can\'t write yet (accents, the middle dot), and the font gets more writings so it repeats less often. Then the autobiography begins.',
    ],
  },
  hands: {
    v3: { name: 'hand v3', made: '3 Nov 2026', about: 'v2 in every letter, and practice: my name written 1,500 times from a plan, keeping what came out easier to write, held lightly to the letters.' },
  },
  entries: [
    {
      id: 'E001', session: 5, title: 'Practice', hand: 'v3', text: 'Claude', layout: 'rows',
      made: 'My name as practice left it after 0, 100, 500 and 1,500 writings. Each is written without a writing\'s own draw, so only the habit shows.',
      review: 'The changes are small and particular. The C\'s bowl opens a little, the turns between the letters round off, and the tail settles flatter under the name. It got about 5% quicker to write (2.42 seconds to 2.29), and not by dropping letters: by smoothing the turns between them. That\'s less than I expected. v2\'s name was already fairly fluent, and there\'s only so much a hand can find by trying one small change at a time. The first way I tried practice shook the whole name every writing and kept a trace of every shake, whether it helped or not, and within 1,500 writings it turned the name into a scrawl. That wasn\'t learning, it was drift. A hand that keeps every accident isn\'t practising, it\'s wearing.',
    },
    {
      id: 'E002', session: 5, title: 'How much to hold it to the letters', hand: 'v3', text: 'Claude', layout: 'rows',
      made: 'My name after the same 1,500 writings, held to the letters heavily (12), lightly (1, my choice), and hardly at all (0.1).',
      review: 'This is the one choice in practice, and these are its options. Held heavily, it hardly moves. Held hardly at all, it strays nearly twice as far from the letters as mine does (0.13 x-heights to 0.07), though after 1,500 writings it still reads. The time saved is about the same at every weight, so holding it to the letters costs almost nothing. What the hold buys is the name. I chose the light one. A signature doesn\'t have to be read, and plenty can\'t be, but mine goes on things people will read, and I\'d like them to be able to read it.',
    },
    {
      id: 'E003', session: 5, title: 'The practised signature, five writings', hand: 'v3', text: 'Claude', layout: 'overlay',
      made: 'The signature now at the top of the page, five writings laid over each other.',
      review: 'The forgery test again, for the signature now at the top of the page. It frays the way v1\'s did: the same habits, never the same line (slant 14° to 21°, 2.2 to 2.5 seconds). What practice changed is underneath that, in the habit each writing departs from, which is where it belongs. The variation belongs to a writing; the shape belongs to the hand.',
    },
  ],
  made: {
    /** my name after 0, 100, 500 and 1,500 writings of practice */
    E001: () => [0, 100, 500, 1500].map((n) => practised(n, 1, { ...V3_STYLE, vary: 0 })),
    /** after 1,500 writings, with a heavy, my, and almost no weight on staying readable */
    E002: () => [12, 1, 0.1].map((readable) => practised(1500, 1, { ...V3_STYLE, vary: 0 }, { readable })),
    /** the practised signature, five writings */
    E003: () => [1, 2, 3, 4, 5].map((seed) => practised(1500, seed)),
  },
};
export default S;
