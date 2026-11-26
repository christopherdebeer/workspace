/**
 * Lessons: the fencing master's lesson, as a coach, a judge and a pace. Each lesson teaches one thing from the usual
 * order a beginner learns it (distance and footwork, the straight arm, the lunge, the advance-lunge, the simple
 * parries and ripostes, the stop-hit), as repetitions: the coach sets the situation (a distance, an opening, an
 * attack along a line) and the judge watches what you do with it.
 *
 * The judge reads the bout, so it can judge form, not only touches: whether the arm moved before the feet, where on
 * each blade a parry met, how hard the tip was pressed, which side the hand went.
 *
 * The pace is slow practice: a lesson starts slow and speeds up with each good repetition (and eases back after a
 * bad one); it's passed with three good repetitions at full speed.
 */
import type { Bout, BoutEvent } from './bout';
import type { Fencer } from './fencer';
import { Coach } from './coach';
import type { Light } from './box';
import { seeded, type Rand } from '../kit/rng';
import { type V, add, scale, clamp, lerp } from './v3';
import { reachFor } from './fencer';
import { TORSO_AT } from './ai';

export interface Controls { feet: boolean; extend: boolean; lunge: boolean; hand: boolean }
export interface Outcome { ok: boolean; say: string; detail?: string }

/** what the runner watches during a repetition, for the judges */
export interface Watch {
  /** when the lunge began (sim s since the rep began), and how extended the arm was then */
  lungeAt: number | null; extAtLunge: number;
  advances: number;
  /** blade contacts: when, where on each blade (0 forte .. 1 tip; [student, coach]), how hard */
  clashes: { at: number; where: [number, number]; strength: number; kind: 'blades' | 'your bell' | 'their bell' }[];
  /** the student's hand across, furthest each way, and their point lowest, since the coach's attack began */
  handMin: number; handMax: number; pointMin: number;
  /** when the coach's attack began */
  attackAt: number | null;
  /** the hardest the student pressed their tip, N */
  peak: number;
}

export interface Ctx {
  bout: Bout; coach: Coach; student: Fencer; them: Fencer;
  /** sim seconds since the repetition began */
  since: number;
  w: Watch; rnd: Rand;
  /** the lesson's own notes for this repetition */
  rep: Record<string, number | string | boolean | null>;
  lights: [Light | null, Light | null];
}

export interface Lesson {
  id: string; title: string;
  /** what the master says first */
  brief: string[];
  /** the line on screen during it */
  prompt: string;
  controls: Controls;
  /** the gap the fencers start each repetition at, m (front foot to front foot) */
  gap: number;
  /** the pace it starts at */
  start: number;
  /** the coach's part, each frame; and the judge: an outcome once the repetition is decided */
  frame(c: Ctx): Outcome | null;
}

const ALL: Controls = { feet: true, extend: true, lunge: true, hand: true };
/** the middle of the chest (where a point lands square; near the top the surface curves away) */
const chest = (f: Fencer): V => lerp(f.capsules[0].a, f.capsules[0].b, TORSO_AT);
const pct = (x: number) => (x < 0.34 ? 'forte' : x < 0.67 ? 'middle' : 'foible');
const N = (x: number) => `${x.toFixed(1)} N`;

/** the coach opens its line: hand out to its right and down, the point away: the chest is there for the taking */
function open(c: Ctx) { c.coach.rest(); c.coach.hand = [0.14, -0.1]; c.coach.point = [0.45, -0.45]; }
/** a touch for the student, valid */
const mine = (c: Ctx) => c.lights[0]?.valid ? c.lights[0] : null;

/** how high on the chest the coach's attacks come in the high-line parry lessons (above the middle: a high line), m */
const PARRY_HIGH = 0.08;
/** the distance the parry lessons start from: the coach's arm reaches you from here without a lunge, m */
/** every lesson's distance, measured for an athlete whose straight arm puts the guard 0.635 m from the shoulder; `reach`
 * is what's added for this athlete's longer arm (fencer.ts: an adult's arm, and shoulders set where an adult's are) */
export const DISTANCE: { reach: number; byLesson: Record<string, number> } = { reach: 0.1, byLesson: {} };
const PARRY_GAP = 1.1;
/** how fast the coach's arm goes out in the parry lessons (per second) */
const PARRY_TEMPO = 2;
/** the beat attack starts from here: their line just short of you, you a lunge from them, m */
const BEAT_GAP = 1.35;
/** the disengage: from where (you in arm's reach), and the coach's beat: its hand across (toward its left: your
 * blade's side) and its point */
/** the one-two: from where, how far your arm must go before it believes the feint, how long it takes to see it, and how
 * long its parry takes across */
/** second intention: from where, how soon it parries your lunge, its parry (hand across, wrist turn, how long), and its
 * riposte's tempo */
const SECOND = { gap: 1.72, react: 0.08, hand: -0.28, turn: 0.25, time: 0.25, tempo: 2.2 };
const ONETWO = { retreat: true, gap: 1.6, believe: 0.35, react: 0.12, time: 0.3, hand: -0.28, turn: 0.25 };
const DIS = { gap: 1.6, sweep: -0.28, sweepPoint: -0.1, time: 0.35 };
/** sixte: where the coach's hand starts (across, to your outside) and how far outside the middle of your chest it aims, m */
const SIXTE = { gap: 1.05, aim: 0.06, under: [0.12, -0.2] as [number, number], viaFor: 0.35, handAfter: -0.3 };
/** the low lines: where on the trunk (pelvis 0 .. chest 1) septime's attack goes, and how far down the thigh octave's */
const LOW = { at: 0.32, thigh: 0.25, gap: 1.05, tempo: 1.1, outside: 0.09, hand0: -0.16, octaveGap: 1.05, point0: 0 };

/**
 * A parry and its riposte, in one of the four lines. Each line says where the coach's point goes (`at`), where its hand
 * starts, whether it comes straight or goes round your blade first (`via`, a disengage: under your blade to the other
 * side), and what your parry is (`hand` across and `point` down, as your thumb would make them) so a wrong one can be
 * told apart.
 */
interface Line {
  id: string; name: string; where: string;
  /** your left (−1) or right (+1); and high or low */
  side: -1 | 1; low: boolean;
  /** what your right thumb does for it */
  thumb: string;
  /** where its point goes, and where its hand starts */
  at: (c: Ctx) => V; hand0: [number, number];
  /** where its point starts (a low attack starts low, under your blade) */
  point0?: [number, number];
  /** a disengage first: where its point passes on the way (under your blade), as it goes (u 0..1), for how long */
  via?: (c: Ctx, u: number) => V; viaFor?: number;
  /** where its hand goes once round (the hand follows the point over, so the blade lies on your outside) */
  handAfter?: [number, number];
  /** what you hold before it comes (sixte is taught from quarte: your outside line open), as a hint and for the judge */
  hold?: string;
  extra?: string;
  /** (low lines) where it starts from and how fast its arm goes, if not the high lines' */
  gap?: number; tempo?: number;
  /** may it lunge if out of reach */
  lunges?: boolean;
}
const LINES: Record<string, Line> = {
  quarte: { id: 'quarte', name: 'quarte', where: 'inside line (your left), high', side: -1, low: false, thumb: 'right thumb left',
    at: (c) => add(add(chest(c.student), [0, PARRY_HIGH, 0]), scale(c.student.frame.r, -0.04)), hand0: [0.04, 0] },
  sixte: { id: 'sixte', name: 'sixte', where: 'outside line (your right), high', side: 1, low: false, thumb: 'right thumb back to the right',
    hold: 'Hold their blade in quarte first (right thumb a little left): that leaves your outside open, and that\'s where they\'ll go, round under your hand. Then back to the right, a little: sixte is a small movement.',
    // (round under your blade to the outside: the point dips under it and comes up on your right)
    at: (c) => add(add(c.student.shoulder, [0, -0.06, 0]), scale(c.student.frame.r, SIXTE.aim)), hand0: [0.04, 0],
    // (straight down off your blade first, then across under your hand, then up on your outside)
    via: (c, u) => add(c.student.blade.guard, add(scale(c.student.frame.r, u < 0.45 ? -SIXTE.under[0] : SIXTE.under[0]), [0, SIXTE.under[1], 0])), viaFor: SIXTE.viaFor, handAfter: [SIXTE.handAfter, 0], gap: SIXTE.gap },
  septime: { id: 'septime', name: 'septime', where: 'inside line (your left), low', side: -1, low: true, thumb: 'right thumb down and a little left',
    at: (c) => add(lerp(c.student.capsules[0].a, c.student.capsules[0].b, LOW.at), scale(c.student.frame.r, -0.03)), hand0: [0.02, -0.06], gap: LOW.gap, tempo: LOW.tempo,
    extra: 'In the low lines the point drops and sweeps: the hand stays about where it was, the blade swings down across the attack like a pendulum.' },
  octave: { id: 'octave', name: 'octave', where: 'outside line (your right), low', side: 1, low: true, thumb: 'right thumb down and a little right',
    // (your outside low line: the outer side of your front leg, outside your blade)
    at: (c) => add(lerp(c.student.capsules[9].a, c.student.capsules[9].b, LOW.thigh), scale(c.student.frame.r, LOW.outside)), hand0: [LOW.hand0, -0.06], point0: [0, LOW.point0], gap: LOW.octaveGap, tempo: LOW.tempo,
    extra: 'In the low lines the point drops and sweeps: the hand stays about where it was, the blade swings down across the attack like a pendulum.' },
};

export const LESSONS: Lesson[] = [
  {
    id: 'distance', title: 'En garde and distance',
    brief: [
      'A fencer stands side-on, knees bent, weight between the feet, the front foot pointing at the opponent: en garde. From there you can go forward or back in a moment.',
      'Distance is most of fencing. Too close, and they can reach you with a lunge. Too far, and you can\'t reach them. The right distance is just outside their reach, where one step brings you into yours.',
      'Your opponent will step. Keep the gap where it is: when they step in, step back; when they step back, follow. Tap the left thumb to advance; pull it down to retreat.',
    ],
    prompt: 'keep the distance: mirror their steps',
    controls: { feet: true, extend: false, lunge: false, hand: false },
    gap: 1.9, start: 0.6,
    frame(c) {
      const r = c.rep;
      if (r.wait === undefined) { c.coach.rest(); r.wait = 0.5 + c.rnd() * 0.7; r.dir = c.rnd() < 0.5 ? 'advance' : 'retreat'; r.stepped = null; }
      if (r.stepped === null && c.since > (r.wait as number)) { c.coach.step(r.dir as 'advance' | 'retreat'); r.stepped = c.since; }
      if (r.stepped !== null && c.since - (r.stepped as number) > 1.3) {
        const g = c.bout.gap;
        if (g < 1.6) return { ok: false, say: 'too close', detail: `${g.toFixed(2)} m: they could hit you with a lunge. When they step in, step back.` };
        if (g > 2.2) return { ok: false, say: 'too far', detail: `${g.toFixed(2)} m: you couldn't reach them. When they step back, follow.` };
        return { ok: true, say: 'in distance', detail: `${g.toFixed(2)} m` };
      }
      return null;
    },
  },
  {
    id: 'extension', title: 'The straight arm',
    brief: [
      'The hit is made by the arm, not the legs. The point goes in a straight line from your guard to the target; the arm extends smoothly until it\'s straight, the point leading the hand.',
      'In épée the whole body is target, the arm included. A hit counts only when the tip is pressed home: 750 g, along the blade, for a couple of thousandths of a second.',
      'Your opponent is in reach and has opened their guard. Push the left thumb up to extend your arm.',
    ],
    prompt: 'extend: left thumb up',
    controls: { feet: false, extend: true, lunge: false, hand: true },
    gap: 0.9, start: 0.5,
    frame(c) {
      open(c);
      const l = mine(c);
      if (l) return { ok: true, say: 'touch', detail: `on the ${l.part}, ${N(c.w.peak)}` };
      if (c.since > 4) return { ok: false, say: 'no touch', detail: c.student.extension < 0.8 ? 'push the left thumb all the way up: the arm straight' : c.w.peak > 0 ? `the tip pressed only ${N(c.w.peak)}: it needs 7.35` : 'keep the point on their chest' };
      return null;
    },
  },
  {
    id: 'lunge', title: 'The lunge',
    brief: [
      'The lunge carries the straight arm a metre further: the front foot kicks forward, the back leg straightens, the body stays upright. Then you recover, back to en garde.',
      'Arm first, always. If the foot moves before the arm, you show your attack early, and you arrive with a bent arm.',
      'Push the left thumb up to extend; keep pushing past the top to lunge; let go to recover.',
    ],
    prompt: 'extend, then lunge',
    controls: { feet: false, extend: true, lunge: true, hand: true },
    gap: 1.3, start: 0.5,
    frame(c) {
      open(c);
      const l = mine(c), w = c.w;
      if (l) {
        if (w.lungeAt !== null && w.extAtLunge < 0.6) return { ok: false, say: 'feet first', detail: `the arm was only ${(w.extAtLunge * 100).toFixed(0)}% out when you lunged: extend, then lunge` };
        if (w.lungeAt === null) return { ok: false, say: 'no lunge', detail: 'they\'re too far for the arm alone: lunge' };
        return { ok: true, say: 'touch', detail: `arm first (${(w.extAtLunge * 100).toFixed(0)}%), on the ${l.part}, ${N(w.peak)}` };
      }
      if (w.lungeAt !== null && ((c.student.lunge === 0 && c.since - w.lungeAt > 0.5) || c.since - w.lungeAt > 1.2)) return { ok: false, say: 'short', detail: w.extAtLunge < 0.6 ? 'the feet went before the arm: extend fully first' : 'keep the arm straight and the point on their chest through the lunge' };
      if (c.since > 5) return { ok: false, say: 'no attack', detail: 'push the left thumb up, past the top' };
      return null;
    },
  },
  {
    id: 'advance-lunge', title: 'Advance, then lunge',
    brief: [
      'When they\'re a little out of reach, an advance brings you into it, and the lunge goes straight on from the step.',
      'Tap to advance; then push the left thumb up through the extension into the lunge. Arm before feet still.',
    ],
    prompt: 'advance, then extend and lunge',
    controls: ALL,
    gap: 1.75, start: 0.5,
    frame(c) {
      open(c);
      const l = mine(c), w = c.w;
      if (l) {
        if (w.advances < 1) return { ok: false, say: 'no advance', detail: 'that worked, but step in first: here the lunge alone is short' };
        if (w.extAtLunge < 0.6) return { ok: false, say: 'feet first', detail: 'the arm before the lunge' };
        return { ok: true, say: 'touch', detail: `advance, lunge: on the ${l.part}, ${N(w.peak)}` };
      }
      if (w.lungeAt !== null && ((c.student.lunge === 0 && c.since - w.lungeAt > 0.5) || c.since - w.lungeAt > 1.2)) return { ok: false, say: 'short', detail: w.advances ? 'lunge as the step lands, the arm already straight' : 'out of reach: advance first' };
      if (c.since > 6) return { ok: false, say: 'no attack', detail: 'tap to advance, then push up to lunge' };
      return null;
    },
  },
  parry(LINES.quarte),
  parry(LINES.sixte),
  parry(LINES.septime),
  parry(LINES.octave),
  {
    id: 'stop-hit', title: 'The stop-hit to the arm',
    brief: [
      'In épée there\'s no right of way: whoever is hit first is hit. So when an opponent prepares carelessly (steps in with the arm bent and the hand up), you can hit the nearest target: their arm.',
      'Extend into the preparation, as they step, not after: their attack comes right behind it. Hit inside 45 ms of each other and it\'s a double; both score.',
      'Left thumb up to extend; the right thumb up lifts the point to the forearm.',
    ],
    prompt: 'as they step in, hit the arm',
    controls: { feet: false, extend: true, lunge: false, hand: true },
    gap: 1.55, start: 0.4,
    frame(c) {
      const r = c.rep, co = c.coach;
      if (r.wait === undefined) { co.rest(); co.rate = 2.6; r.wait = 0.6 + c.rnd() * 0.7; r.stepAt = null; }
      if (r.stepAt === null && c.since > (r.wait as number)) {
        // (the careless preparation: a step in with the arm half out and the hand up, the point high)
        co.step('advance'); r.stepAt = c.since;
        co.extend = 0.45; co.hand = [0.06, 0.12]; co.point = [0.15, 0.5];
      }
      if (r.stepAt !== null && c.since - (r.stepAt as number) > 0.65 && c.w.attackAt === null) {
        // (the attack itself comes at a fencer's speed: the time to hit was during the step)
        co.hand = [0, 0]; co.point = [0, 0]; co.aim = () => chest(c.student); co.extend = 1; co.rate = 9; c.w.attackAt = c.since; r.attackT = c.bout.t;
      }
      if (c.w.attackAt !== null && c.them.extension > 0.6) co.lunge = true;
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (a && b && locked) return { ok: false, say: 'coup double', detail: 'both scored: in épée that\'s no use when it\'s close. Hit earlier, as they step' };
      if (b && locked) return { ok: false, say: 'touched', detail: a ? '' : 'too late: extend as they step forward, before their arm comes down' };
      if (a && locked && r.attackT !== undefined && a.t > (r.attackT as number) + 0.04) return { ok: false, say: 'late', detail: `you hit ${((a.t - (r.attackT as number)) * 1000).toFixed(0)} ms into their attack: they ran onto your point this time, but against a real attack that's a double or worse. Hit as they step` };
      if (a && locked) return { ok: a.part === 'arm' || a.part === 'hand', say: a.part === 'arm' || a.part === 'hand' ? 'stop-hit' : 'touch, but not the arm', detail: a.part === 'arm' || a.part === 'hand' ? `on the ${a.part}, before their attack` : `on the ${a.part}: it scored, but the arm was nearer. Lift the point (right thumb up)` };
      if (c.since > 5) return { ok: false, say: 'nothing', detail: 'extend as they step in' };
      return null;
    },
  },
  {
    id: 'line', title: 'The point in line',
    brief: [
      'Arm straight, point on their chest: a point in line. In épée it\'s a wall. Whoever walks onto it is hit, and they have to deal with it before they can attack you.',
      'Set it before they come, not as they arrive. Hold it while they step in, and they run onto it.',
      'It costs you. An arm held straight out tires within seconds: the point starts to tremble and sag, and a tired arm gives way to a beat. Hold it when it matters, then bend the arm and rest it.',
      'Left thumb up to extend; right thumb to keep the point on their chest.',
    ],
    prompt: 'set your line before they step in',
    controls: { feet: false, extend: true, lunge: false, hand: true },
    gap: 1.35, start: 0.5,
    frame(c) {
      const r = c.rep, co = c.coach;
      if (r.wait === undefined) { co.rest(); co.point = [0, 0.35]; r.wait = 0.9 + c.rnd() * 0.6; r.steps = 0; r.stepAt = null; r.extAtStep = 0; }
      // (careless: a step in with the point up off its line, then an attack)
      if (c.since > (r.wait as number) && (r.steps as number) < 1) {
        co.step('advance'); r.steps = (r.steps as number) + 1; r.stepAt = c.since;
        if (r.steps === 1) r.extAtStep = c.student.extension;
      }
      // (and in, carelessly, its point still up: it hasn't dealt with your blade at all)
      if (r.steps === 1 && c.since - (r.stepAt as number) > 0.5 && c.w.attackAt === null) { co.extend = 0.6; co.rate = 9; c.w.attackAt = c.since; }
      if (c.w.attackAt !== null && c.them.extension > 0.4) co.lunge = true;
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (b && locked) return { ok: false, say: a ? 'coup double' : 'touched', detail: a ? 'your line was late: set it before they step, and they run onto it first' : (r.extAtStep as number) < 0.8 ? 'no line: extend before they step in (left thumb up) and keep the point on their chest' : 'your point was off their chest: keep it on them (right thumb)' };
      if (a && locked && (r.extAtStep as number) < 0.8) return { ok: false, say: 'no line', detail: `it landed, but your arm was ${Math.round((r.extAtStep as number) * 100)}% out as they stepped: set the line first, then they walk onto it` };
      if (a && locked) return { ok: true, say: 'onto your line', detail: `set before they stepped; they came onto it: on the ${a.part}` };
      if (c.since > 6 || (c.w.attackAt !== null && c.since - c.w.attackAt > 1.6)) return { ok: false, say: 'nothing', detail: 'set your line before they step in: arm straight, the point on their chest' };
      return null;
    },
  },
  {
    id: 'beat', title: 'The beat attack',
    brief: [
      'Against a point in line you can\'t simply attack: you run onto their point. Knock it aside first.',
      'A beat is a sharp blow of your blade on theirs, just enough to throw their point off line. Then in at once, in the same movement, before it comes back. Beat with your middle on their foible, the weak end: it goes a long way for a little.',
      'They hold a line at you, on your inside. Right thumb left, sharply, to beat; then left thumb up and through into the lunge.',
    ],
    prompt: 'beat their blade aside, then lunge',
    controls: ALL,
    gap: BEAT_GAP, start: 0.45,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      // (it holds a line at your chest; beaten, it gives, its point thrown off, and is slow to bring it back)
      if (r.set === undefined) { co.rest(); co.aim = () => chest(c.student); co.extend = 1; co.rate = 6; r.set = true; w.attackAt = 0; }
      const beaten = w.clashes.find((k) => k.at > 0.25);
      if (beaten && !r.gave) { co.give(0.5, 0.15); r.gave = true; r.beatAt = beaten.at; }
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (a && b && locked) return { ok: false, say: 'coup double', detail: beaten ? 'you beat it, but too late or too softly: it came back before you arrived' : 'you ran onto their line: beat it aside first' };
      if (b && locked) return { ok: false, say: 'onto their point', detail: beaten ? 'the beat didn\'t carry it far enough aside' : 'beat their blade first (right thumb left, sharply)' };
      if (a && locked) {
        if (!beaten) return { ok: false, say: 'no beat', detail: 'it landed, but past their point by luck: beat it first' };
        return { ok: true, say: 'beat, touch', detail: `in ${(c.since - (r.beatAt as number)).toFixed(2)} s after the beat, on the ${a.part}` };
      }
      if (c.since > 6) return { ok: false, say: 'no attack', detail: beaten ? 'after the beat, at once: left thumb up, through into the lunge' : 'beat (right thumb left, sharply), then lunge' };
      return null;
    },
  },
  {
    id: 'disengage', title: 'The disengage',
    brief: [
      'When they go for your blade (a beat, a take), don\'t let them find it. Drop your point under their blade as it comes, bring it up on the other side, and hit: their blade sweeps through where yours was, and their line is open.',
      'It\'s a small movement of the fingers and wrist, not the arm: the point circles under their blade, a hand\'s breadth.',
      'They\'ll beat at your blade from your inside. As it comes: right thumb down and left (under), then left thumb up through the lunge.',
    ],
    prompt: 'as they go for your blade, slip under it and hit',
    controls: { feet: false, extend: true, lunge: true, hand: true },
    gap: DIS.gap, start: 0.4,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      if (r.wait === undefined) { co.rest(); r.wait = 0.8 + c.rnd() * 0.8; }
      // (its beat: its hand sweeps across onto your blade, from your inside to your outside)
      if (w.attackAt === null && c.since > (r.wait as number)) { w.attackAt = c.since; r.beatAt = c.bout.t; }
      // (at a lesson's tempo, so you can see it coming: across in a third of a second)
      const found = w.clashes.find((k) => w.attackAt !== null && k.at >= w.attackAt + 0.05);
      // (how far your point dipped below your hand since it began: under their blade)
      if (w.attackAt !== null) r.dip = Math.min((r.dip as number | undefined) ?? 0, c.student.blade.tip[1] - c.student.blade.guard[1]);
      if (w.attackAt !== null && !found) { const u = Math.min(1, (c.since - w.attackAt) / DIS.time); co.hand = [DIS.sweep * u, 0]; co.point = [DIS.sweepPoint * u, 0]; }
      // (it found your blade: in, at once)
      if (found && !co.aim) { co.hand = [0, 0]; co.point = [0, 0]; co.aim = () => chest(c.student); co.extend = 1; co.rate = 4; co.lunge = false; }
      // (it found nothing: its blade swept past, it comes back to guard, late)
      if (!found && w.attackAt !== null && c.since - w.attackAt > 0.45) { co.hand = [0, 0]; co.point = [0, 0]; }
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (a && w.attackAt === null) return { ok: false, say: 'too soon', detail: 'that was your own attack: wait for them to go for your blade' };
      if (b && locked) return { ok: false, say: 'found', detail: found ? 'they found your blade: as it comes, drop your point under it (right thumb down and left)' : 'touched' };
      if (a && locked) {
        if (found && found.at < c.since - 0.02) return { ok: false, say: 'found, but', detail: 'it landed, but they had your blade first: slip under before it arrives' };
        if (((r.dip as number | undefined) ?? 0) > -0.1) return { ok: false, say: 'counter-attack', detail: 'it landed, straight into their beat: that\'s a counter-attack, and against a quicker beat it\'s found. Go under it (right thumb down)' };
        return { ok: true, say: 'disengage, touch', detail: `their blade found nothing; on the ${a.part}` };
      }
      if (w.attackAt !== null && c.since - w.attackAt > 3) return { ok: false, say: found ? 'found' : 'no hit', detail: found ? 'they found your blade: drop under it as it comes' : 'slipped it well: now hit, left thumb up' };
      return null;
    },
  },
  {
    id: 'one-two', title: 'The one-two',
    brief: [
      'A compound attack: the first movement is a lie. Feint (show them an attack: the arm half out, the point threatening) and they\'ll parry it. Their parry is the moment: go round it, under their blade to the other side, and lunge. Their blade sweeps through where yours was.',
      'The feint has to be believable, the arm going out as if it meant it; and the disengage small and quick, the moment their blade moves.',
      'Step in with the feint: a tap to advance, the left thumb half up. When their blade comes: right thumb down and left (under), then left thumb all the way up through the lunge.',
    ],
    prompt: 'feint, and as they parry, go round it and lunge',
    controls: ALL,
    gap: ONETWO.gap, start: 0.4,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      if (r.set === undefined) { co.rest(); r.set = true; }
      // (your feint: it believes it, and parries it a moment later, its hand across onto your blade)
      // (and gives ground as it parries, a small retreat: its blade meets yours near the points, where going round works)
      if (w.attackAt === null && c.student.extension > ONETWO.believe) { w.attackAt = c.since + ONETWO.react; if (ONETWO.retreat) co.step('retreat'); }
      const parrying = w.attackAt !== null && c.since >= w.attackAt;
      const found = w.clashes.find((k) => w.attackAt !== null && k.at >= w.attackAt + 0.05);
      // (a parry with its forte: the hand across, the wrist turning the point back so it stays about where it was)
      if (parrying && !found) { const u = Math.min(1, (c.since - (w.attackAt as number)) / ONETWO.time); co.hand = [ONETWO.hand * u, 0]; co.point = [ONETWO.turn * u, 0]; }
      if (parrying) r.dip = Math.min((r.dip as number | undefined) ?? 0, c.student.blade.tip[1] - c.student.blade.guard[1]);
      // (its parry found your blade: it ripostes)
      if (found && !co.aim) { co.hand = [0, 0]; co.point = [0, 0]; co.aim = () => chest(c.student); co.extend = 1; co.rate = 4; }
      // (it found nothing: its blade has gone past; it's slow to come back)
      if (parrying && !found && c.since - (w.attackAt as number) > 0.6) { co.hand = [0, 0]; co.point = [0, 0]; }
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (b && locked) return { ok: false, say: found ? 'parried' : 'touched', detail: found ? 'their parry found your blade, and the riposte came: go under it as it comes (right thumb down and left)' : 'touched' };
      if (a && locked) {
        if (!parrying) return { ok: false, say: 'direct', detail: 'that was a direct attack (it landed before they parried): feint first, half an arm, and wait for their blade' };
        if (found) return { ok: false, say: 'parried, but', detail: 'it landed, but their parry had found your blade first: go round it before it arrives' };
        if (((r.dip as number | undefined) ?? 0) > -0.1) return { ok: false, say: 'not round', detail: 'it landed, but your point didn\'t go under their parry: it got lucky' };
        return { ok: true, say: 'one-two', detail: `their parry found nothing; on the ${a.part}` };
      }
      if (c.since > 7) return { ok: false, say: parrying ? (found ? 'parried' : 'no lunge') : 'no feint', detail: parrying ? (found ? 'their parry found your blade: go round it' : 'round it: now lunge, left thumb all the way up') : 'feint first: left thumb half up' };
      return null;
    },
  },
  {
    id: 'second-intention', title: 'Second intention',
    brief: [
      'An attack meant to be parried. You lunge, not to hit but to draw their parry and riposte, and you\'re ready for it: you parry their riposte from your lunge and hit them with the counter-riposte, while they\'re still answering an attack that was never the real one.',
      'Attack honestly enough to be believed, from just out of reach (they\'re a little far: the lunge will be parried, not land). Then, still down in the lunge, parry quarte as their riposte comes, and straight back: they\'re close now, so not much arm.',
      'Left thumb up through the lunge, and hold it. When their riposte comes: right thumb left, then the point back at them.',
    ],
    prompt: 'lunge, parry their riposte, hit back',
    controls: ALL,
    gap: SECOND.gap, start: 0.4,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      if (r.set === undefined) { co.rest(); r.set = true; }
      // (your attack: it parries it, a moment after the lunge begins)
      if (w.attackAt === null && (c.student.act?.kind === 'lunge' || c.student.extension > 0.6)) w.attackAt = c.since + SECOND.react;
      const parrying = w.attackAt !== null && c.since >= w.attackAt;
      const first = w.clashes.find((k) => w.attackAt !== null && k.at >= w.attackAt);
      if (parrying && !first) { const u = Math.min(1, (c.since - (w.attackAt as number)) / SECOND.time); co.hand = [SECOND.hand * u, 0]; co.point = [SECOND.turn * u, 0]; }
      // (it found your blade: its riposte, straight at you, at a lesson's tempo)
      if (first && r.ripAt === undefined) { r.ripAt = c.since + 0.08; }
      if (r.ripAt !== undefined && c.since >= (r.ripAt as number) && !co.aim) { co.hand = [0, 0]; co.point = [0, 0]; co.aim = () => chest(c.student); co.extend = 1; co.rate = SECOND.tempo; }
      // (your counter-parry: your hand going across after their riposte starts; a blade held still that it runs onto isn't one)
      if (r.ripAt !== undefined && c.since >= (r.ripAt as number)) r.across = Math.min((r.across as number | undefined) ?? 0, c.student.intent.hand[0]);
      const counter = r.ripAt !== undefined && ((r.across as number | undefined) ?? 0) < -0.1 ? w.clashes.find((k) => k.at >= (r.ripAt as number) + 0.05) : undefined;
      if (counter) { co.give(0.4, 0.45); co.extend = 0.3; }
      const [a, b] = c.lights, locked = c.bout.box.locked(c.bout.t);
      if (b && locked) return { ok: false, say: 'riposted', detail: first ? 'their riposte landed: from your lunge, parry quarte as it comes (right thumb left)' : 'touched' };
      if (a && locked) {
        if (!first) return { ok: false, say: 'first intention', detail: 'your attack landed: fine in a bout, but this one\'s meant to be parried. Attack, and expect the parry' };
        if (!counter) return { ok: false, say: 'no counter-parry', detail: 'it landed, but you didn\'t parry their riposte: it ran onto your blade. Parry it (right thumb left), then hit' };
        return { ok: true, say: 'second intention', detail: `attack, their parry, their riposte parried, counter-riposte: on the ${a.part}` };
      }
      if (c.since > 7) return { ok: false, say: first ? (counter ? 'no counter-riposte' : 'nothing') : 'no attack', detail: first ? (counter ? 'parried their riposte: now straight back' : 'parry their riposte (right thumb left)') : 'lunge: left thumb all the way up' };
      return null;
    },
  },
];

function parry(L: Line): Lesson {
  const name = L.name, side = L.side, cap = name[0].toUpperCase() + name.slice(1);
  return {
    id: L.id, title: `Parry ${name}, riposte`,
    brief: [
      `A parry turns their blade aside with yours. ${cap} guards your ${L.where}${L.low ? '' : ': the hand moves across, the point stays toward them'}.`,
      ...(L.extra ? [L.extra] : []),
      'Meet their blade with your forte, the strong third by the guard, against their foible, the weak end: leverage does the rest. Too early and there\'s nothing to parry; too late and you\'re hit.',
      'Then the riposte: back at them while their arm is still out, at whatever their bell leaves open.',
      ...(L.hold ? [L.hold] : []),
      `They'll attack your ${L.where}. ${L.thumb[0].toUpperCase() + L.thumb.slice(1)} to parry; left thumb up to riposte.`,
    ],
    prompt: `parry ${name} (${L.thumb}), then riposte`,
    controls: ALL,
    gap: L.gap ?? PARRY_GAP, start: 0.35,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      if (r.wait === undefined) { co.rest(); r.wait = 0.8 + c.rnd() * 0.9; co.hand = [...L.hand0]; co.point = L.point0 ? [...L.point0] : [0, 0]; }
      if (w.attackAt === null && c.since > (r.wait as number)) {
        const t0 = c.since;
        co.aim = () => (L.via && c.since - t0 < (L.viaFor ?? 0) ? L.via(c, (c.since - t0) / (L.viaFor ?? 1)) : L.at(c));
        r.t0 = t0;
        // (at a lesson's tempo: half a second from the first movement, time for a reaction and a parry at full pace)
        co.point = [0, 0]; co.extend = 1; co.rate = L.tempo ?? PARRY_TEMPO; w.attackAt = c.since;
      }
      if (L.handAfter && w.attackAt !== null && c.since - (r.t0 as number) > (L.viaFor ?? 0) * 0.55) co.hand = [...L.handAfter];
      // (a parry meets the attack as it comes: the blades touching as it sets off are only the blades touching)
      // (and a parry is a movement: your hand across for the high lines, your point down for the low; a blade it meets
      // where you left it isn't a parry)
      const moved = L.low ? w.pointMin < -0.15 : side < 0 ? w.handMin < -0.06 : w.handMax > 0.06;
      const [a, b] = c.lights, parried = moved ? w.clashes.find((k) => w.attackAt !== null && k.at >= w.attackAt + 0.05) : undefined;
      // (parried, it gives its blade the way it was pushed, and opens for the riposte. Your left is its right.)
      if (parried) { co.give(-side * 0.4, L.low ? -0.3 : 0.45); co.extend = 0.4; }
      // (out of its arm's reach, it lunges; parried, it recovers, and the riposte meets it at a distance a riposte lands from)
      if (w.attackAt !== null && L.lunges) co.lunge = !parried && c.them.extension > 0.5 && (co.lunge || reachFor(c.them, L.at(c)) > 1.02);
      if (b) {
        const went = side < 0 ? w.handMin : w.handMax, wrong = side < 0 ? w.handMax : w.handMin;
        if (!parried) {
          if (L.low && w.pointMin > -0.12 && Math.max(Math.abs(w.handMin), Math.abs(w.handMax)) > 0.06) return { ok: false, say: 'touched', detail: `that was a high parry: ${name} is low. Drop the point (right thumb down)` };
          if (!L.low && w.pointMin < -0.2) return { ok: false, say: 'touched', detail: `that was a low parry: ${name} is high, the point stays up` };
          return { ok: false, say: 'touched', detail: Math.abs(wrong) > 0.06 && Math.abs(wrong) > Math.abs(went) ? `wrong side: ${name} is to your ${side < 0 ? 'left' : 'right'}` : Math.abs(went) > 0.06 || w.pointMin < -0.15 ? 'late: move as their arm starts, not as it lands' : `no parry: ${L.thumb} as they come` };
        }
        return { ok: false, say: 'through', detail: `you met it on your ${pct(parried.where[0])}${parried.where[0] > 0.45 ? ': too far out, it slid through. Meet it nearer your guard' : ' but it wasn\'t carried far enough aside'}` };
      }
      if (a && w.attackAt === null) return { ok: false, say: 'too soon', detail: 'that was an attack of your own: wait for theirs, parry, then hit' };
      if (a && !parried) return { ok: false, say: 'counter-attack', detail: 'it landed, but that wasn\'t a parry: take their blade first' };
      if (a && c.bout.box.locked(c.bout.t)) return { ok: true, say: `${name}, riposte`, detail: `parried on your ${pct(parried!.where[0])} against their ${pct(parried!.where[1])}; touch on the ${a.part}` };
      if (w.attackAt !== null && c.since - w.attackAt > 3) return { ok: false, say: parried ? 'no riposte' : 'nothing', detail: parried ? 'parried well: now back at them, left thumb up' : `${L.thumb} as they attack` };
      return null;
    },
  };
}

export type Stage = 'brief' | 'set' | 'go' | 'result' | 'passed';

/**
 * Runs a lesson: places the fencers, lets the coach and the judge work, keeps the pace and the count. `update` is
 * called each frame with the wall time passed (stages wait in wall time: time to read), after the bout has run on.
 */
export class LessonRunner {
  stage: Stage = 'brief';
  pace: number;
  /** good repetitions at full speed, and all repetitions */
  good = 0; reps = 0;
  last: Outcome | null = null;
  readonly coach: Coach;
  /** the repetition as it stands (for a readout, and for tests that play the student) */
  c!: Ctx;
  private at = 0;
  private rnd: Rand;
  private lastTouch = -9;
  static NEED = 3;

  constructor(readonly bout: Bout, readonly lesson: Lesson, seed = 1) {
    this.coach = new Coach(bout.fencers[1]);
    this.pace = lesson.start;
    this.rnd = seeded(seed * 31 + 7);
  }

  begin() { this.set(); }
  /** after a result: on at once (a tap) */
  skip() { if (this.stage === 'result') this.next(); }

  private set() {
    this.stage = 'set'; this.at = 0;
    this.bout.place(this.lesson.gap + (DISTANCE.byLesson[this.lesson.id] ?? DISTANCE.reach));
    this.coach.rest();
    const [student, them] = this.bout.fencers;
    this.c = { bout: this.bout, coach: this.coach, student, them, since: 0, rnd: this.rnd, rep: {}, lights: [null, null],
      w: { lungeAt: null, extAtLunge: 0, advances: 0, clashes: [], handMin: 0, handMax: 0, pointMin: 0, attackAt: null, peak: 0 } };
  }
  private next() { if (this.good >= LessonRunner.NEED) this.stage = 'passed'; else this.set(); }

  /** is the student held still (before the go) */
  get frozen() { return this.stage !== 'go'; }

  /** what the bout said this frame */
  hear(events: BoutEvent[]) {
    if (this.stage !== 'go') return;
    for (const e of events) {
      if (e.type === 'clash') this.c.w.clashes.push({ at: this.c.since, where: e.where, strength: e.strength, kind: 'blades' });
      // (their blade on your bell: a parry at the very forte)
      if (e.type === 'guard' && e.who === 0) this.c.w.clashes.push({ at: this.c.since, where: [0, 0.6], strength: e.strength, kind: 'your bell' });
      // (yours on their bell: a beat that met their forte; never a parry)
      if (e.type === 'guard' && e.who === 1) this.c.w.clashes.push({ at: this.c.since, where: [0.6, 0], strength: e.strength, kind: 'their bell' });
    }
    // (blades that slid into contact without striking still met)
    const b = this.bout;
    if (b.lastTouch > this.lastTouch) { if (b.lastTouch > b.t - 0.05 && !this.c.w.clashes.some((k) => this.c.since - k.at < 0.1)) this.c.w.clashes.push({ at: this.c.since, where: [...b.clash.where] as [number, number], strength: 0, kind: 'blades' }); this.lastTouch = b.lastTouch; }
  }

  update(wall: number, sim: number) {
    this.at += wall;
    const c = this.c;
    if (this.stage === 'set' && this.at > 0.9) { this.stage = 'go'; this.at = 0; c.since = 0; }
    if (this.stage === 'go') {
      c.since += sim;
      const st = c.student, w = c.w;
      if (st.act?.kind === 'lunge' && w.lungeAt === null) { w.lungeAt = c.since; w.extAtLunge = st.extension; }
      if (st.act?.kind === 'advance' && !c.rep._adv) { w.advances++; c.rep._adv = true; }
      if (st.act?.kind !== 'advance') c.rep._adv = false;
      if (w.attackAt !== null) { w.handMin = Math.min(w.handMin, st.intent.hand[0]); w.handMax = Math.max(w.handMax, st.intent.hand[0]); w.pointMin = Math.min(w.pointMin, st.intent.point[1]); }
      w.peak = Math.max(w.peak, this.bout.peak[0]);
      c.lights = [this.bout.box.lights[0], this.bout.box.lights[1]];
      const o = this.lesson.frame(c);
      if (o) this.judged(o);
    }
    if (this.stage === 'result' && this.at > 2.4) this.next();
  }

  private judged(o: Outcome) {
    this.last = o; this.reps++;
    this.stage = 'result'; this.at = 0;
    if (o.ok) { if (this.pace >= 0.999) this.good++; this.pace = clamp(this.pace + 0.15, 0.3, 1); }
    else this.pace = clamp(this.pace - 0.1, 0.3, 1);
  }
}
