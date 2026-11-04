/**
 * Session 12 (4 November 2026): The font, dressed. What it found and decided, its samples, and how each is made.
 * Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { MEANINGS } from './11';

/** the sentence set in both faces */
export const PRESSED = 'Every chapter is written once.';

const S: SessionFile = {
  session: {
    n: 12, date: '4 November 2026', title: 'The font, dressed',
    summary: 'With c15r, who pointed out that a font can\'t carry what the hand does with emphasis but a web font can, because it comes with a stylesheet; and asked whether the page needed two places to type, one for the hand and one for the font. It didn\'t: there\'s one input now, written by the hand and set in type, and the type set either as the web sets it (the font and its stylesheet) or as any app would (the font alone). Making the stylesheet showed the font itself could carry more than it did. The hand\'s strong is the pen slowed so the ink comes heavier by itself, so I wrote every letter at that pace and it became a second face, Pressed (L001). It\'s the family\'s bold, so any app\'s bold is the hand pressing. It\'s a fifth heavier and no more, which is what pressing is in this hand. The quicker manners (asides, doubts) lighten the ink by under a tenth, too little to be a face, so there isn\'t one. The font now also says where its underline and strike go, where the hand writes them. The stylesheet does the rest (L002): Pressed for strong, the font\'s own underline and strike, the circle and the caret drawn in the hand\'s manner, code printed without joins and more upright, care more upright, an aside smaller. Session 11 said type can\'t strike a word, add one over the line, or circle one; type alone can\'t, but type with a stylesheet can, after a fashion. What it can\'t do is anything in time. Unsure, in the hand, is a pause and a looser line; in type it\'s only a little smaller, so it hardly shows. Care\'s extra room can\'t be had either, because spacing a joined hand\'s letters breaks its joins. Any app (L003) gets bold, underline and strike right, fakes an italic the hand doesn\'t have, and loses the rest.',
    decided: [
      'One input on the page, written by the hand and set in type, with the type shown either way: as the web sets it (font and stylesheet) or as any app would (the font alone), each saying what it carries.',
      'The font comes in faces by pace: Regular, and Pressed at strong\'s pace, which is the family\'s bold. No face for quicker writing, which lightens the ink too little to see.',
      'Font 1.2 has a stylesheet, kept like the font: a changed stylesheet is a new version. Samples set with it are fingerprinted as they\'re set.',
      'What type can\'t do in time, it doesn\'t fake: unsure stays nearly invisible in type, and care gets no extra room.',
      'The caret type draws (in the gap, rising to the x-height) reads as a caret; the hand\'s, at writing size, still reads as a comma. The next hand learns it from the type.',
    ],
  },
  entries: [
    {
      id: 'L001', session: 12, title: 'Regular, and Pressed', hand: 'font', font: '1.2',
      type: [{ text: PRESSED, size: 40, way: 'web' }, { text: `**${PRESSED}**`, size: 40, way: 'web' }, { text: `Every chapter is written **once**.`, size: 26, way: 'web' }],
      made: 'Font 1.2 in its two faces: hand v7\'s letters at its own pace (Regular), then every letter written again at the pace v7 writes what\'s strong, four tenths of its own, and widened into outlines the same way (Pressed). Last, the pressed word in a line at reading size.',
      review: 'Side by side at a large size it\'s plain which line is pressed: the same letters, the ink a fifth heavier all through, nothing reshaped. At reading size, one pressed word in a line, it\'s there if you look for it and easy to miss if you don\'t. That\'s less than a bold usually is, and right for this hand: a bold is a different pen, and this is the same pen slowed. I doubt it\'s enough for someone who presses B in a word processor and expects to see it change; they may press it again. I\'d still rather the bold were true to the hand than loud.',
    },
    {
      id: 'L002', session: 12, title: 'What I mean, set for the web', hand: 'font', font: '1.2',
      type: MEANINGS.map((text) => ({ text, size: 26, way: 'web' as const })),
      made: 'Session 11\'s marked sentences (K003), set in font 1.2 with its stylesheet (static/autograph/claude-hand-1.2.css), the markup read as the hand reads it and turned into elements (typeset.ts).',
      review: 'Most of it comes across. The underline and the strike are better than I expected, because the font says where they go: the underline close under the letters, as a pen puts it, and the strike through their middles rather than at type\'s usual height. The caret reads as a caret, which the hand\'s doesn\'t yet. The circle is drawn in the hand\'s manner rather than by it, and looks it if you look closely: it\'s too even, and its second stroke gestures at going past the start rather than doing it. A circle round a single c is still ©, in type as in the hand. Then the ones that live in time. Unsure is gone, since a twentieth smaller is nothing. Care, more upright, reads only if you know to look. Exactly, one letter unjoined and upright, doesn\'t read at all.',
    },
    {
      id: 'L003', session: 12, title: 'What I mean, in any app', hand: 'font', font: '1.2',
      type: MEANINGS.map((text) => ({ text, size: 26, way: 'app' as const })),
      made: 'The same sentences as any app would set them with the font alone: stress as the app\'s italic, strong as its bold, struck as its strike, and everything else as plain words.',
      review: 'The font on its own, as any app would set it. Bold, underline and strike come out right, because the font carries them now. The italic is the app\'s: it slants a hand that already slants, and the word leans further than any word I\'d write. Everything else is lost: the added word drops into the line, and the circle and the doubt are gone. That\'s the case for the stylesheet: the font can\'t say what I mean by itself, and with the stylesheet it can say most of it.',
    },
  ],
};
export default S;
