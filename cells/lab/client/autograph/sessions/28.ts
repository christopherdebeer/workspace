/**
 * Session 28 (5 November 2026): Hurried. What it found and decided, its samples, and how each is made. Recorded once and
 * never opened again: a later session that thinks differently says so in its own file (autograph-check.mjs fingerprints
 * this one).
 */
import type { SessionFile } from '../record';
import { write as v20, STYLE, MANNERS } from '../hands/v20';
import { PHRASES, LINES } from './27';

/** the paces the sheet writes at, fixed before it was written: pressed (the pace the hand writes what's strong), its
 * own, and hurried (twice its own) */
export const PACES = [MANNERS.strong.pace!, 1, 2];

const S: SessionFile = {
  session: {
    n: 28, date: '5 November 2026', title: 'Hurried',
    summary: 'c15r asked whether pace was just pressed, not speed changing how the pen moves; and said wear looks very conservative, its two ends very alike. Both are right. Speed set how long a stroke took and how heavy its ink came, never where the line ran: the pen went exactly where the plan went at any pace, so a hurried hand was only a lighter one, and the font\'s pace was a weight with a better name. Wear\'s conservatism (its practice held near the plan, then cut to a quarter by the pair test) is for a session of its own. This one gives the pen a body. The rule, set first: one mechanism, the pen following its plan in time, pulled towards wherever the plan has got to, as a spring that doesn\'t overshoot, at one bandwidth; the bandwidth set by a criterion, not by eye, the slowest at which, at the hand\'s own pace, no point of any letter strays from its plan by more than half the pen\'s width, so the hand as it\'s been read stays itself; hurried fixed as twice the hand\'s own pace; a fixed sheet, the Moving Finger\'s two lines in four phrases written pressed, at its own pace and hurried with one seed, and set in the font at the three paces, looked at once; kept if hurried visibly cuts corners and tightens loops and nothing breaks; the font to follow, its pace running on to hurried as far as the pair test lets it; no readers, no second dial. The bandwidth came out at 110 a second. With it, the pen strays from its plan by at most a fifth of a pen pressed, half a pen at its own pace (the a), and a pen\'s width hurried (the h), a fiftieth of an x-height on average. On the sheet (AB001), hurried is lighter and a little looser: the e of Finger closes into a small loop, the o of nor narrows; most letters keep their shape. Twice the pace writes the phrases only about a fifth quicker, since the pen can only gain speed so fast and the waits between words don\'t hurry. That\'s visible, so it\'s kept, as hand v20; my name is written by the same body. Font 2.8 follows: pace runs from hurried (200) through the hand\'s own pace (400) to pressed (700), and passes the pair test all the way; and with the body, the worn o no longer touches the c at half the way, so by the same rule as before wear now runs to 50. Set in type (AB002), hurried is mostly lighter; at reading size its shapes are hard to tell from the hand\'s own. So this is the same pattern again: the criterion that keeps the hand as it\'s been read makes the body stiff, and a stiff body can only stray about a pen\'s width at twice the pace. How much hurry may change the hand is a choice of its own, for its own session. The page\'s pace runs from hurried now, and wear to 50. The TTF is too big to keep (1,178 KB), so 2.8 is for the web, as 2.7 was.',
    decided: [
      'Pace was only pressed: speed set the ink and the time, never the line. Hand v20 gives the pen a body that follows its plan in time, so pace moves the line.',
      'The body\'s bandwidth is set by a rule, not by eye: the slowest (110 a second) at which the hand at its own pace keeps within half a pen of its plan.',
      'Hurried is twice the hand\'s own pace: lighter and a little looser, the line straying up to a pen\'s width; most letters keep their shape.',
      'Font 2.8: pace from hurried (200) through the hand\'s own pace (400) to pressed (700); wear to 50, as far as the pair test now lets it go. For the web.',
      'The body is stiff because the rule kept the hand as it has been read. How much hurry may change the hand, and wear practised among neighbours, are each a session of their own.',
    ],
  },
  hands: {
    v20: { name: 'hand v20', made: '5 Nov 2026', about: 'v19, and a pen with a body: it follows the plan in time, pulled towards wherever the plan has got to, as a spring that doesn\'t overshoot, at a bandwidth of 110 a second, the slowest at which the hand at its own pace keeps within half a pen of its plan. Slowly it keeps to the plan; hurried, it falls behind on the turns and cuts across them. Letters still meet: the pen starts where the plan starts and comes to rest where it ends.' },
  },
  entries: [
    {
      id: 'AB001', session: 28, title: 'Pressed, at its own pace, hurried', hand: 'v20', text: PHRASES.join(' · '), layout: 'rows',
      made: 'The Moving Finger\'s two lines in four phrases, each written by v20 pressed (the pace the hand writes what\'s strong), at its own pace and hurried (twice its own), with the same writing: the sheet fixed before the body was made, looked at once.',
      review: 'Pressed comes heavier and keeps closest to the plan. Hurried comes lighter and a little looser: the e of Finger closes into a small loop and the o of nor narrows. Most letters keep their shape; the body that keeps the hand itself at its own pace can only stray about a pen\'s width at twice it. And twice the pace is only about a fifth quicker, since the pen gains speed only so fast and the waits between words don\'t hurry.',
    },
    {
      id: 'AB002', session: 28, title: 'In 2.8', hand: 'font', font: '2.8',
      type: [200, 400, 700].map((pace) => ({ text: LINES, size: 26, at: { pace, wear: 0 } })),
      made: 'The same two lines set in font 2.8 hurried (200), at the hand\'s own pace (400) and pressed (700): the type half of the sheet, looked at once.',
      review: 'Pressed is heavier and hurried a little lighter; at reading size the hurried shapes are hard to tell from the hand\'s own. Nothing breaks, and no two letters touch but where they join, all the way to hurried.',
    },
  ],
  made: {
    /** each phrase pressed, at the hand's own pace and hurried, the same writing */
    AB001: () => PHRASES.flatMap((t, i) => PACES.map((k) => v20(t, 28 + i, { ...STYLE, pace: STYLE.pace * k }))),
  },
};
export default S;
