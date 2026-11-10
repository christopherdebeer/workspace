/**
 * Session 27 (5 November 2026): Pace and wear. What it found and decided, its samples, and how each is made. Recorded
 * once and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v19, worn } from '../hands/v19';
import { FINGER } from './25';

/** the sheet fixed before the font was made: the Moving Finger's first two lines */
export const LINES = FINGER.split('\n').slice(0, 2).join('\n');
/** where on the axes the sheet sets them: the ends and the middle of wear, at each end of pace */
export const AT = [[400, 0], [400, 12.5], [400, 25], [700, 0], [700, 12.5], [700, 25]];
/** the same two lines in four phrases, short enough to write as rows */
export const PHRASES = ['The Moving Finger writes;', 'and, having writ,', 'Moves on: nor all', 'thy Piety nor Wit'];

const S: SessionFile = {
  session: {
    n: 27, date: '5 November 2026', title: 'Pace and wear',
    summary: 'c15r asked which variables I\'d expose if the font varied, remembering how interesting the hand looked hurried; and said they were a little sad to see the old f go, and that the new off looks off. They\'re right about why: session 26\'s rule asked only whether every f was plainly an f, never whether it belonged to the hand, and a printed letter in a cursive hand shows its seam where two stand together. The f stays as it is for now, and that question is open. For the font I said I\'d expose causes rather than effects, the hand\'s own states rather than a typographer\'s dials. Pace, how slowly the pen moves and so how heavy the ink comes, of which Regular and Pressed are already two points; and wear, the letters as they stand and as practice for ease leaves them, the practice that in session 14 wore them into the confusions of a hurried hand. The rule, set first: one mechanism, the font made variable, each end of each axis written by the hand and nothing drawn; the practice fixed in advance (the hand\'s own settings, 30,000 writings of the words of the whole record, run once); kept if at no wear it inks what 2.6 inks, if the pair test passes at every corner (and if it fails worn all the way, wear ends at the furthest quarter that passes), and if a fixed sheet, looked at once, moves smoothly with nothing broken; not judged on legibility; no readers, no second dial; the old f at the hurried end left out, as a second mechanism. Practice needed mending first: it still began from v9\'s plan, which five letters have left since, so hand v19 begins it from the letters as they stand, and writes exactly as v18 does. Practised once, the record\'s words came out 5.3% quicker; the d, the a, the y and the o strayed most. Then the outlines. A variable font moves each outline\'s points from one state to the next, so every state of a letter needs the same points, and the font\'s unioned outlines never had them; now each stroke is outlined on its own, the pen\'s edge divided evenly along it, round at its ends and where the pen turns back, the strokes overlapping as a pen\'s do. At no wear, font 2.7 inks what 2.6 inks: of the pixels either inks, 96 in a hundred are the same at the hand\'s own pace and 97 pressed. Pace passed the pair test at both ends. Wear didn\'t: worn all the way, the d and the o lean into the letter after them, 15 pairs touching at the hand\'s own pace and 29 pressed; at three quarters 6 and 8; at half, one, an o into a c, pressed. So by the rule wear ends at a quarter. On the sheet (AA001) every row moves smoothly into the next and nothing breaks, so 2.7 is kept; and at a quarter, wear hardly shows. Written by the hand, with nothing to stop it (AA002), worn all the way, and reads anel, and the o opens at its top towards a c. That\'s the finding: practice for ease wears each letter alone, and a letter worn alone leans on its neighbours; a font has to keep them apart, so wear that goes further would have to be practised among neighbours. A variable font with three states of every letter is too big a TTF to keep (895 KB), so 2.7 is for the web; for any app, 2.6\'s two faces stay. The type box on the page now has pace and wear to turn.',
    decided: [
      'The rule set first: one mechanism, the font made variable, its axes the hand\'s own states; kept if at no wear it inks what 2.6 does, if the pair test passes at every corner (wear ending at the furthest quarter that does), and if the sheet, looked at once, moves smoothly with nothing broken. All held, with wear ending at a quarter.',
      'Font 2.7: one variable font from hand v19. Pace (wght, 400 to 700): the hand at its own pace to the pace it writes what\'s strong, so bold is the hand pressing. Wear (WEAR, 0 to 25): the letters as they stand, a quarter of the way to where practice for ease left them.',
      'Wear stops where letters would touch. Practice wears each letter alone, and the worn d and o lean on the letter after them; wear that goes further has to be practised among neighbours.',
      'Hand v19: practice begins from the letters as they stand. It writes exactly as v18 does.',
      'Each stroke is outlined on its own, with the same points in every state; at no wear 2.7 inks what 2.6 does. It\'s for the web; for any app, 2.6\'s two faces.',
      'Open: whether the f that stands on the line belongs to the hand (c15r: the new off looks off), and the old f at the hurried end.',
    ],
  },
  hands: {
    v19: { name: 'hand v19', made: '5 Nov 2026', about: 'v18, and its practice begun from its letters as they stand: it still began from v9\'s plan, which the t, k, x, s and f have left since. Where practice for ease once left them is kept (WORN), the far end of the font\'s wear. It writes exactly as v18 does.' },
  },
  entries: [
    {
      id: 'AA001', session: 27, title: 'Pace and wear', hand: 'font', font: '2.7',
      type: AT.map(([pace, wear]) => ({ text: LINES, size: 26, at: { pace, wear } })),
      made: 'The Moving Finger\'s first two lines set in font 2.7 at the ends and the middle of wear (0, 12.5 and 25), at the hand\'s own pace (400) and pressed (700): the sheet fixed before the font was made, looked at once.',
      review: 'Pace reads plainly: the pressed rows are the same letters, heavier. Wear, at its end, hardly shows at this size; a quarter of the way to where practice left the letters is a small change. Every row moves smoothly into the next, and nothing breaks.',
    },
    {
      id: 'AA002', session: 27, title: 'Worn all the way', hand: 'v19', text: PHRASES.join(' · '), layout: 'rows',
      made: 'The same two lines in four phrases, each written by v19 as the letters stand and then with the letters as practice for ease left them (WORN), the same writing: wear all the way, where the font can\'t go.',
      review: 'Worn, and reads anel: the d\'s bowl opens into an e and its stem stands off like an l. The o opens at its top towards a c, so on and nor come near cn and ncr. Capitals, figures and marks don\'t wear; practice only ever wrote the small letters. The font goes a quarter of the way here; the rest of the way, the d and the o run into the letter after them.',
    },
  ],
  made: {
    /** each phrase as the letters stand, then with the letters as practice left them, the same writing */
    AA002: () => PHRASES.flatMap((t, i) => [v19(t, 27 + i), worn(() => v19(t, 27 + i))]),
  },
};
export default S;
