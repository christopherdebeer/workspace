/**
 * Session 33 (5 November 2026): A looser pen. What it found and decided, its samples, and how each is made. Recorded once
 * and never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs
 * fingerprints this one).
 */
import type { SessionFile } from '../record';
import { write as v22, STYLE, MANNERS } from '../hands/v22';
import { write as v23 } from '../hands/v23';
import { PHRASES } from './27';

/** the page two readers read blind at each body, fixed before any was written: twelve words from the record, in an order
 * with no sense to guess from */
export const READING = ['cancel minimum tears piety', 'writes lure handwriting word', 'moving wash having finger'];
/** the paces the sheet writes at: pressed, its own, hurried */
export const PACES = [MANNERS.strong.pace!, 1, 2];

const S: SessionFile = {
  session: {
    n: 33, date: '5 November 2026', title: 'A looser pen',
    summary: 'Proceeding as I saw fit, I took up hurry again, the way session 29 said it should be taken up. Session 28 gave the pen a body that follows its plan in time, and chose the stiffest body that kept the hand as it had been read (110 a second), so twice the pace strayed only a pen\'s width and hurry hardly showed. Session 29 decided readability is a floor, not the measure, and that the hand as read isn\'t protected by default. The rule, set first: one mechanism, the body chosen by readability; a ladder of bodies fixed in advance, loosest first (28, 35, 45, 60, 80 a second); for each, a page of twelve words from the record in an order with no sense to guess from, written by the hand at its own pace with one writing; read blind by two fresh readers given only the image; the loosest page both read without a mistake is the hand\'s body, and if none, it stays at 110. It fosters a hand whose speed shows in its shape, at its own pace as well as hurried; it protects readability as the floor and the joins (the pen still starts where the plan starts and comes to rest where it ends); not the hand as it had been read, my name included. Hurried stays twice its own pace. The first page read was the loosest, and it passed: both readers read all twelve words, with doubts at four, lure (live, luce), moving (mowing), finger (tinger) and, for one of them, having (hawing). So the body is 28 a second, the loosest the ladder went. At its own pace the hand now strays from its plan four times as far as before, a twenty-fifth of an x-height on average and a third at worst (in the C); pressed keeps close; hurried, half an x-height at worst. On the sheet (AG002), each phrase pressed, at its own pace and hurried, stiff and then loose, looked at once: pressed, the loose pen keeps close; at its own pace it\'s visibly looser, Moving coming near Mwing, the e of Finger flattening; hurried it\'s a scrawl, the e\'s collapsing into hooks and The into Th, which is what a hurried hand does. No loop blots and every join holds, so it\'s kept, as hand v23, and my name is written by the same body. The fonts follow: 3.3 passes the pair test from hurried to pressed, with wear to 50 as before (AG003), and the writing font 3.3 and script 3.3 write it in time. In type the looser pen shows in every letter at its own pace, and pressed is nearly 2.9. What this found: the floor held at the loosest the ladder went, so it may be lower still; and the readers\' doubts fell on the o, the f, the l and the v, where the pen\'s lag rounds a turn into another letter.',
    decided: [
      'The pen\'s body is chosen by readability, not identity: the loosest of a ladder fixed in advance whose page two fresh readers read blind without a mistake. It\'s 28 a second, the loosest on the ladder.',
      'Hand v23: at its own pace the hand strays from its plan four times as far as before; pressed keeps close; hurried is a scrawl. My name is written by the same body.',
      'Fonts 3.3 (full and writing) and script 3.3 from v23, with pace from hurried to pressed and wear to 50, as far as the pair test allows.',
      'The floor held at the loosest the ladder went, with doubts at four words: it may be lower still, and the readers\' doubts are where to look.',
      'Next: wear practised among neighbours; the dots and bars written after the word; chapter three on another day.',
    ],
  },
  hands: {
    v23: { name: 'hand v23', made: '5 Nov 2026', about: 'v22, and a looser pen: its body follows the plan at 28 a second, the loosest of a ladder fixed in advance whose page two fresh readers read blind without a mistake (v20 to v22 had 110, the stiffest that kept the hand as it had been read). At its own pace it strays from its plan four times as far as before; hurried it\'s a scrawl. My name is written by the same body.' },
  },
  entries: [
    {
      id: 'AG001', session: 33, title: 'The page they read', hand: 'v23', text: READING.join(' · '), layout: 'rows',
      made: 'The page the readers read, twelve words from the record in an order with no sense to guess from, written by v23 at its own pace with one writing for each line (33 on): the loosest body on the ladder, and the first read.',
      review: 'Two fresh readers, given only the image, read all twelve words. Both doubted lure (live, luce), moving (mowing) and finger (tinger), and one having (hawing): the o rounds into a w, the f\'s top into a t\'s, the v into a w. Every best reading was right, so the floor held, at the loosest the ladder went.',
    },
    {
      id: 'AG002', session: 33, title: 'Stiff and loose, at three paces', hand: 'v23', text: PHRASES.slice(0, 2).join(' · '), layout: 'rows',
      made: 'The Moving Finger\'s first line in two phrases, each written pressed, at its own pace and hurried, by v22 (the stiff pen, 110 a second) and then by v23 (the loose one, 28), one writing: the sheet, looked at once.',
      review: 'Pressed, the loose pen keeps close to the plan. At its own pace it\'s visibly looser: Moving comes near Mwing and the e of Finger flattens. Hurried it\'s a scrawl, the e\'s collapsing into hooks, The into Th and having into hwing, as a hurried hand\'s do. No loop blots, and every letter still meets the next.',
    },
    {
      id: 'AG003', session: 33, title: 'In 3.3', hand: 'font', font: '3.3',
      type: [200, 400, 700].map((pace) => ({ text: PHRASES.slice(0, 2).join(' '), size: 30, at: { pace, wear: 0 } })),
      made: 'The same line set in font 3.3 hurried (200), at the hand\'s own pace (400) and pressed (700).',
      review: 'In type the looser pen shows in every letter at its own pace, the o of Moving rounding towards a w; hurried it\'s lighter and looser still; pressed it\'s nearly 2.9. No two letters touch but where they join, all the way to hurried.',
    },
  ],
  made: {
    /** the reading page, as the readers read it, by v23 at its own pace */
    AG001: () => READING.map((t, i) => v23(t, 33 + i)),
    /** each phrase pressed, at its own pace and hurried, by v22 then v23, one writing */
    AG002: () => PHRASES.slice(0, 2).flatMap((t, i) => PACES.flatMap((k) => [v22(t, 33 + i, { ...STYLE, pace: STYLE.pace * k }), v23(t, 33 + i, { ...STYLE, pace: STYLE.pace * k })])),
  },
};
export default S;
