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
import { TORSO_AT } from './ai';

export interface Controls { feet: boolean; extend: boolean; lunge: boolean; hand: boolean }
export interface Outcome { ok: boolean; say: string; detail?: string }

/** what the runner watches during a repetition, for the judges */
export interface Watch {
  /** when the lunge began (sim s since the rep began), and how extended the arm was then */
  lungeAt: number | null; extAtLunge: number;
  advances: number;
  /** blade contacts: when, where on each blade (0 forte .. 1 tip; [student, coach]), how hard */
  clashes: { at: number; where: [number, number]; strength: number }[];
  /** the student's hand across, furthest each way, since the coach's attack began */
  handMin: number; handMax: number;
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
const PARRY_GAP = 1.0;
/** how fast the coach's arm goes out in the parry lessons (per second) */
const PARRY_TEMPO = 2;
/** sixte: where the coach's hand starts (across, to your outside) and how far outside the middle of your chest it aims, m */
const SIXTE = { hand: 0.04, aim: 0.04 };

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
  parry('quarte', -1),
  // (parry('sixte', 1) is set aside for now: side on, the outside line is the sword arm's own, and an attack there
  // that a sixte parry is the answer to needs a disengage this coach doesn't have yet)
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
];

/** a simple parry on one side (−1 quarte, your left; +1 sixte, your right), and a riposte */
function parry(name: string, side: -1 | 1): Lesson {
  const where = side < 0 ? 'inside line (your left)' : 'outside line (your right)';
  return {
    id: name, title: `Parry ${name}, riposte`,
    brief: [
      `A parry turns their blade aside with yours. ${name[0].toUpperCase() + name.slice(1)} guards your ${where}: the hand moves across, the point stays toward them.`,
      'Meet their blade with your forte, the strong third by the guard, against their foible, the weak end: leverage does the rest. Too early and there\'s nothing to parry; too late and you\'re hit.',
      'Then the riposte: straight back at them, while their arm is still out.',
      `They'll attack on your ${where}. Right thumb ${side < 0 ? 'left' : 'right'} to parry; left thumb up to riposte.`,
    ],
    prompt: `parry ${name} (right thumb ${side < 0 ? 'left' : 'right'}), then riposte`,
    controls: ALL,
    gap: PARRY_GAP, start: 0.35,
    frame(c) {
      const r = c.rep, co = c.coach, w = c.w;
      if (r.wait === undefined) {
        co.rest(); r.wait = 0.7 + c.rnd() * 0.9; co.hand = side < 0 ? [0.04, 0] : [SIXTE.hand, 0]; co.point = [0, 0];
      }
      if (w.attackAt === null && c.since > (r.wait as number)) {
        // along the line: its hand on that side, its point at your chest on that side
        // (in quarte it comes at the inside of your chest; in sixte it comes round to the outside, well clear of your
        // blade held in quarte)
        // (side on, your outside line isn't your chest: it's your front shoulder and arm, outside your blade)
        co.aim = () => side < 0 ? add(add(chest(c.student), [0, PARRY_HIGH, 0]), scale(c.student.frame.r, -0.04)) : add(c.student.shoulder, scale(c.student.frame.r, SIXTE.aim));
        // (at a lesson's tempo: half a second from the first movement, time for a reaction and a parry at full pace)
        co.point = [0, 0]; co.extend = 1; co.rate = PARRY_TEMPO; w.attackAt = c.since;
      }
      // (a parry meets the attack as it comes: the blades touching as it sets off are only the blades touching)
      const [a, b] = c.lights, parried = w.clashes.find((k) => w.attackAt !== null && k.at >= w.attackAt + 0.05);
      // (your left is its right: a parry to your left carries its point to its right)
      // (parried, it gives its blade and opens for the riposte; it attacks from where its arm reaches, without a lunge,
      // so the riposte is at a distance a riposte can land from)
      if (parried) { co.give(-side * 0.4, 0.45); co.extend = 0.4; }
      if (b) {
        const went = side < 0 ? w.handMin : w.handMax, wrong = side < 0 ? w.handMax : w.handMin;
        if (!parried) return { ok: false, say: 'touched', detail: Math.abs(wrong) > 0.06 && Math.abs(wrong) > Math.abs(went) ? `wrong side: ${name} is to your ${side < 0 ? 'left' : 'right'}` : Math.abs(went) > 0.06 ? 'late: move as their arm starts, not as it lands' : `no parry: right thumb ${side < 0 ? 'left' : 'right'} as they come` };
        return { ok: false, say: 'through', detail: `you met it on your ${pct(parried.where[0])}${parried.where[0] > 0.45 ? ': too far out, it slid through. Meet it nearer your guard' : ' but it wasn\'t carried far enough aside'}` };
      }
      if (a && w.attackAt === null) return { ok: false, say: 'too soon', detail: 'that was an attack of your own: wait for theirs, parry, then hit' };
      if (a && !parried) return { ok: false, say: 'counter-attack', detail: 'it landed, but that wasn\'t a parry: take their blade first' };
      if (a && c.bout.box.locked(c.bout.t)) return { ok: true, say: `${name}, riposte`, detail: `parried on your ${pct(parried!.where[0])} against their ${pct(parried!.where[1])}; touch on the ${a.part}` };
      if (w.attackAt !== null && c.since - w.attackAt > 3) return { ok: false, say: parried ? 'no riposte' : 'nothing', detail: parried ? 'parried well: now straight back, left thumb up' : 'move the right thumb as they attack' };
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
    this.bout.place(this.lesson.gap);
    this.coach.rest();
    const [student, them] = this.bout.fencers;
    this.c = { bout: this.bout, coach: this.coach, student, them, since: 0, rnd: this.rnd, rep: {}, lights: [null, null],
      w: { lungeAt: null, extAtLunge: 0, advances: 0, clashes: [], handMin: 0, handMax: 0, attackAt: null, peak: 0 } };
  }
  private next() { if (this.good >= LessonRunner.NEED) this.stage = 'passed'; else this.set(); }

  /** is the student held still (before the go) */
  get frozen() { return this.stage !== 'go'; }

  /** what the bout said this frame */
  hear(events: BoutEvent[]) {
    if (this.stage !== 'go') return;
    for (const e of events) {
      if (e.type === 'clash') this.c.w.clashes.push({ at: this.c.since, where: e.where, strength: e.strength });
      // (their blade on your bell: a parry at the very forte)
      if (e.type === 'guard' && e.who === 0) this.c.w.clashes.push({ at: this.c.since, where: [0, 0.6], strength: e.strength });
      // (yours on their bell: a beat or a parry that met their forte)
      if (e.type === 'guard' && e.who === 1) this.c.w.clashes.push({ at: this.c.since, where: [0.6, 0], strength: e.strength });
    }
    // (blades that slid into contact without striking still met)
    const b = this.bout;
    if (b.lastTouch > this.lastTouch) { if (b.lastTouch > b.t - 0.05 && !this.c.w.clashes.some((k) => this.c.since - k.at < 0.1)) this.c.w.clashes.push({ at: this.c.since, where: [...b.clash.where] as [number, number], strength: 0 }); this.lastTouch = b.lastTouch; }
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
      if (w.attackAt !== null) { w.handMin = Math.min(w.handMin, st.intent.hand[0]); w.handMax = Math.max(w.handMax, st.intent.hand[0]); }
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
