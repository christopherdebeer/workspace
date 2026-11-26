/**
 * An opponent: a controller like any other (it gives an Intent and nothing else), seeing the bout as it was a
 * reaction time ago. It keeps its distance, holds its point toward you, takes its chance to attack (an extension, a
 * lunge behind it, an advance first when it's a little far), and when your point comes at it, parries to the side
 * your blade is on and ripostes.
 *
 * What it sees is what a fencer sees: where your point is and how fast it is closing on its chest (whoever is doing
 * the moving: stepping onto a still point is as dangerous as being thrust at), how far your arm is out, whether your
 * point is in line (arm straight, point on its chest). A line is a wall, and it won't walk into one. It answers it:
 *
 *   beat    knocks your blade aside and attacks in the same moment
 *   take    attacks with its blade pressed on yours, holding your point off its line all the way (opposition)
 *   wait    stays out of reach until your arm comes down, and attacks as it does
 *
 * How often it notices a line, and which answers it favours, is its style; better opponents notice more and answer
 * better. A few tactics chosen by a little state machine: a better fencer is more of them.
 */
import type { Bout } from './bout';
import type { Controller, Intent } from './intent';
import { idle } from './intent';
import { type Fencer, aimAt, reachFor, REACH_GAIN } from './fencer';
import { seeded, type Rand } from '../kit/rng';
import { type V, add, dot, lerp, madd, norm, sub, toLocal } from './v3';

/** what it saw */
interface Seen {
  t: number; tip: V; tipVel: V; s: number; lunge: number; ext: number; gap: number;
  /** their point's distance from my chest, and whether it's in line (arm straight, aimed at my chest) */
  dChest: number; line: boolean;
}

export type Answer = 'beat' | 'take' | 'wait';
export interface Style {
  /** how long it takes to see, s */
  reaction: number;
  /** the gap (front to front) it likes, m */
  measure: number;
  /** attacks per second of opportunity, and how often it parries a threat it sees (0..1) */
  aggression: number; parry: number;
  /** how likely it is to notice your point in line (0: walks onto it) */
  lineSense: number;
  /** how it likes to answer a line (weights) */
  answers: Record<Answer, number>;
}
export const SPARRING: Style = { reaction: 0.2, measure: 1.75, aggression: 0.5, parry: 0.75, lineSense: 0.85, answers: { beat: 1.4, take: 0.4, wait: 0.8 } };

/** The levels of opponent, and how much bullet time each allows you (the assist falls away as they get better). */
export interface Level { name: string; style: Style; assist: number }
export const LEVELS: Level[] = [
  { name: 'novice', style: { reaction: 0.32, measure: 1.95, aggression: 0.22, parry: 0.35, lineSense: 0.3, answers: { beat: 0.6, take: 0, wait: 1 } }, assist: 1 },
  { name: 'club', style: { reaction: 0.25, measure: 1.85, aggression: 0.38, parry: 0.6, lineSense: 0.6, answers: { beat: 1, take: 0.2, wait: 1 } }, assist: 0.6 },
  { name: 'competitor', style: SPARRING, assist: 0.25 },
  { name: 'master', style: { reaction: 0.16, measure: 1.7, aggression: 0.68, parry: 0.88, lineSense: 1, answers: { beat: 1.6, take: 0.5, wait: 0.7 } }, assist: 0 },
];

/** where on the forearm it aims at an arm (how far back from the hand, how far up from its middle). (Against a straight
 * arm held in line the bell covers the wrist from the front, as an épée bell is made to: openTarget goes elsewhere.) */
export const WRIST = { back: 0.14, top: 0.02 };

/** the beat: how long, how far across the hand goes and how far the point turns, and how much it keeps its blade on
 * that side after (opposition) */
/** where on the torso it aims, from the pelvis (0) to the top of the chest (1) */
export const TORSO_AT = 0.62;

/** how far its arm is out when it's only watching (below where an arm starts to tire) */
export const CARRIAGE = 0.45;

export const BEAT = { time: 0.3, hand: 0.34, point: 0.3, hold: -0.06 };

export type Tactic = 'measure' | 'attack' | 'recover' | 'parry' | 'riposte' | 'beat' | 'take' | 'wait' | 'draw';

export class Opponent implements Controller {
  private seen: Seen[] = [];
  /** what it has perceived (the delayed samples), for how things are changing */
  private percepts: Seen[] = [];
  private rnd: Rand;
  tactic: Tactic = 'measure';
  private since = 0;
  private lastStep = 0;
  private side = 1;
  private aimAt: 'torso' | 'arm' = 'torso';
  private I: Intent = idle();
  private want: number;
  /** a line it has seen, and whether it noticed it */
  private lineSeen = false; private lineNoticed = false; private lineFor = 0;
  /** when the current action began (for whether it has met their blade since) */
  private from = 0;
  /** how often they've stop-hit its advances (their arm shooting out as it steps in): it learns to draw that out */
  stopHits = 0;
  private stepAt = -9; private extAtStep = 0; private counted = false;

  constructor(readonly bout: Bout, readonly me: 0 | 1, readonly style: Style = SPARRING, seed = 1) {
    this.rnd = seeded(seed * 7919 + me);
    // (the style's distances were measured for an athlete with a shorter reach: fencer.ts)
    this.want = style.measure + REACH_GAIN;
  }

  private get self(): Fencer { return this.bout.fencers[this.me]; }
  private get other(): Fencer { return this.bout.fencers[1 - this.me]; }

  intent(dt: number): Intent {
    const b = this.bout, o = this.other, me = this.self;
    const chest = this.chestOf(me), tip = o.blade.tip;
    this.seen.push({ t: b.t, tip, tipVel: o.blade.velAt(o.blade.n - 1), s: o.s, lunge: o.lunge, ext: o.extension, gap: b.gap, dChest: Math.hypot(...sub(chest, tip)), line: inLine(o, chest) });
    while (this.seen.length > 2 && this.seen[1].t <= b.t - this.style.reaction) this.seen.shift();
    const see = this.seen[0];
    this.percepts.push(see);
    while (this.percepts.length > 2 && this.percepts[1].t <= see.t - 0.06) this.percepts.shift();
    const before = this.percepts[0], span = see.t - before.t;
    // how fast their point is closing on my chest (from its motion or mine)
    const closing = span > 0.02 ? (before.dChest - see.dChest) / span : 0;
    this.since += dt;
    const I = this.I;
    I.step = null;
    if (b.phase !== 'fence') { this.tactic = 'measure'; this.since = 0; this.lineSeen = this.lineNoticed = false; Object.assign(I, idle()); return I; }
    const threatened = see.dChest < 0.8 && closing > 0.9;
    // a line: noticed (or not) once, when it appears
    if (see.line && !this.lineSeen) { this.lineSeen = true; this.lineNoticed = this.rnd() < this.style.lineSense; this.lineFor = 0; }
    if (!see.line && see.ext < 0.6) { this.lineSeen = false; this.lineNoticed = false; }
    if (this.lineSeen) this.lineFor += dt;
    const respect = this.lineNoticed;
    const canStep = b.t - this.lastStep > 0.42;
    const step = (s: 'advance' | 'retreat') => { I.step = s; this.lastStep = b.t; if (s === 'advance') { this.stepAt = b.t; this.extAtStep = see.ext; this.counted = false; } };
    // (their arm shot out as it stepped in: remember it)
    if (!this.counted && see.t > this.stepAt && see.t - this.stepAt < 0.45 && see.ext - this.extAtStep > 0.4) { this.stopHits++; this.counted = true; }
    switch (this.tactic) {
      case 'measure': {
        // (a modern épée carriage: the arm well forward, the point toward their chest, short of a line (it doesn't tire))
        I.lunge = false; I.extend = CARRIAGE;
        this.inLine(I, this.target(o, 'torso'));
        if (threatened && this.rnd() < this.style.parry) { this.begin('parry'); this.side = this.sideOf(see.tip); break; }
        if (respect) {
          // a line: never onto it; back off if it's near; then answer it
          if (see.dChest < 0.62) { if (canStep) step('retreat'); break; }
          if (this.lineFor > 0.25) { const a = this.answer(see); if (a) { this.begin(a); if (a === 'beat' || a === 'take') this.side = this.sideOf(lerp(o.blade.guard, o.blade.tip, 0.75)); break; } }
          // (in its own time, closer, if a step wouldn't put it on their point)
          if (canStep && see.dChest > 1.05 && see.gap > 1.7 + REACH_GAIN) step('advance');
          break;
        }
        // keep the distance it likes (and change its mind about it now and then)
        if (this.rnd() < dt * 0.4) this.want = this.style.measure + REACH_GAIN + (this.rnd() - 0.5) * 0.5;
        if (canStep) {
          if (see.gap < this.want - 0.2) step('retreat');
          else if (see.gap > this.want + 0.25) step('advance');
        }
        if (see.gap < 1.55 + REACH_GAIN && this.rnd() < dt * this.style.aggression * 3) { this.aimAt = see.gap < 1.1 + REACH_GAIN && this.rnd() < 0.5 ? 'arm' : 'torso'; this.begin('attack'); }
        else if (see.gap < 2.05 + REACH_GAIN && this.rnd() < dt * this.style.aggression) {
          // (if they stop-hit its advances, the step is a lure: it draws the arm out, to parry it and riposte)
          if (this.stopHits > 0 && this.rnd() < Math.min(0.85, 0.4 + 0.2 * this.stopHits) * this.style.lineSense) { step('advance'); this.begin('draw'); }
          else { this.aimAt = 'torso'; step('advance'); this.begin('attack'); }
        }
        break;
      }
      case 'draw': {
        // a step in, arm bent, point in line, the hand ready: their extension is what it's waiting for
        I.extend = 0.1; I.lunge = false;
        this.inLine(I, this.target(o, 'torso'));
        if (closing > 0.6 && see.dChest < 1.0) { this.side = this.sideOf(see.tip); this.begin('parry'); break; }
        if (this.since > 0.9) { this.aimAt = 'torso'; this.begin(see.gap < 1.5 + REACH_GAIN ? 'attack' : 'measure'); }
        break;
      }
      case 'attack': {
        // the arm first, then the legs; the point kept on its target all the way
        { const tg = this.target(o, this.aimAt), e = see.gap < 0.9 + REACH_GAIN ? Math.max(0.15, Math.min(1, reachFor(me, tg))) : 1;
          I.extend = e; this.inLine(I, tg, e); }
        if (me.extension > 0.55 && !me.act && !I.lunge) I.lunge = this.aimAt === 'torso' || see.gap > 0.9 + REACH_GAIN;
        if ((me.lunge > 0.98 && this.since > 0.45) || this.since > 1.3) this.begin('recover');
        break;
      }
      case 'beat': {
        // closer first if need be (the beat as the step lands); then a sharp blow on their blade toward the side it's
        // on, and straight in
        if (this.approach(see, canStep, step)) break;
        if (this.since < 0.001) this.from = b.t;
        // the blow goes on until it meets their blade; the attack starts the instant it does (the same tempo); a blow
        // that has met nothing by then has missed, and it doesn't go on onto their point
        const met = b.lastContact >= this.from;
        if (!met && !this.struck) {
          if (this.since > BEAT.time) { if (canStep) step('retreat'); this.begin('recover'); break; }
          I.extend = 0.45; I.hand = [BEAT.hand * this.side, 0.02]; I.point = [BEAT.point * this.side, 0];
        } else {
          this.struck = true;
          I.extend = 1; this.inLine(I, this.target(o, 'torso'), 1, [BEAT.hold * this.side, 0.03]);
          if (!me.act && !I.lunge) I.lunge = see.gap > 0.95 + REACH_GAIN;
        }
        if ((me.lunge > 0.98 && this.since > 0.55) || this.since > 1.4) this.begin('recover');
        break;
      }
      case 'take': {
        // into the attack with the blade held on theirs, pushing it off its line all the way
        if (this.approach(see, canStep, step)) break;
        I.extend = 1;
        this.inLine(I, this.target(o, 'torso'), 1, [0.22 * this.side, 0.04]);
        if (me.extension > 0.45 && !me.act && !I.lunge) I.lunge = see.gap > 0.95 + REACH_GAIN;
        if ((me.lunge > 0.98 && this.since > 0.55) || this.since > 1.4) this.begin('recover');
        break;
      }
      case 'wait': {
        // out of reach, point in its own line, until their arm comes down: then at once
        I.extend = CARRIAGE; I.lunge = false;
        this.inLine(I, this.target(o, 'torso'));
        if (canStep && see.dChest < 0.95) step('retreat');
        if (see.ext < 0.5) {
          this.aimAt = 'torso';
          if (see.gap <= 1.5 + REACH_GAIN) this.begin('attack');
          // (from further, a step in first; and if they stop-hit its steps, the step is a lure)
          else if (canStep) { step('advance'); this.begin(this.stopHits > 0 && this.rnd() < Math.min(0.85, 0.4 + 0.2 * this.stopHits) * this.style.lineSense ? 'draw' : 'attack'); }
        }
        else if (this.since > 2.5 + 2 * this.style.answers.wait) this.begin('measure');
        if (threatened && this.rnd() < this.style.parry) { this.begin('parry'); this.side = this.sideOf(see.tip); }
        break;
      }
      case 'recover': {
        I.lunge = false; I.extend = 0.2;
        this.inLine(I, this.target(o, 'torso'));
        if (me.lunge === 0 && this.since > 0.2) { if (this.rnd() < 0.6 && canStep) step('retreat'); this.begin('measure'); }
        break;
      }
      case 'parry': {
        // the hand goes to the side their blade is on, the point stays near the line: their blade is taken on my forte
        I.lunge = false; I.extend = 0.15;
        I.hand = [0.15 * this.side, 0.02];
        I.point = [0.12 * this.side, 0.05];
        if (this.since < 0.001) this.from = b.t;
        // (a riposte only off a parry that found their blade: a parry that met nothing has nothing to answer)
        if (this.since > 0.2) this.begin(b.lastContact >= this.from && this.rnd() < 0.85 ? 'riposte' : 'measure');
        break;
      }
      case 'riposte': {
        // (as long an arm as the distance wants: close, a straight arm slides past)
        { const tg = this.target(o, 'torso'), e = Math.max(0.15, Math.min(1, reachFor(me, tg)));
          I.extend = e; if (!I.lunge) I.lunge = see.gap > 1.0 + REACH_GAIN && e >= 1;
          this.inLine(I, tg, e); }
        if (this.since > 0.55) this.begin('recover');
        break;
      }
    }
    return I;
  }

  /**
   * (beat, take) closing to where the blades overlap: an advance if it's far, and the action starts as the step lands.
   * Returns true while still closing (the clock of the action held at zero until then).
   */
  private approach(see: Seen, canStep: boolean, step: (s: 'advance') => void): boolean {
    const me = this.self, I = this.I;
    if (see.gap > 1.72 + REACH_GAIN && this.since < 1.5) {
      if (!me.act && canStep) step('advance');
      I.extend = 0.15; this.inLine(I, this.target(this.other, 'torso'));
      this.since = Math.min(this.since, 0.001);
      return true;
    }
    return false;
  }

  /**
   * Which answer to a line (or null: not yet). A fresh line is a strong arm: it's waited out, out of reach. A line held
   * for seconds is a tired arm (it trembles, sags, gives way): that's the one to beat or take.
   */
  private answer(see: Seen): Answer | null {
    const w = this.style.answers, tired = Math.min(1, Math.max(0, (this.lineFor - 2) / 3));
    const weight = (a: Answer) => (a === 'wait' ? w.wait * (1.6 - 1.4 * tired) : w[a] * (0.25 + tired));
    const fit: Answer[] = ['wait'];
    // (beat and take close in themselves, from not too far)
    if (see.gap < 2.4 + REACH_GAIN && see.gap > 1.1 + REACH_GAIN) fit.push('beat', 'take');
    const total = fit.reduce((s, a) => s + weight(a), 0);
    if (total <= 0 || this.rnd() > 0.05) return null;
    let r = this.rnd() * total;
    for (const a of fit) { r -= weight(a); if (r <= 0) return a; }
    return fit[fit.length - 1];
  }

  private begin(t: Tactic) { this.tactic = t; this.since = 0; this.from = this.bout.t; this.I.lunge = false; this.struck = false; this.picked = null; }
  /** the target it has picked for this action */
  private picked: number | null = null;
  /** (beat) it has met their blade */
  private struck = false;

  /** which side of my line (my right +1, my left −1) a point of theirs is on */
  private sideOf(p: V) {
    const F = this.self.frame, l = toLocal(F, p), g = toLocal(F, this.self.blade.guard);
    return l[2] > g[2] - 0.03 ? 1 : -1;
  }

  /** a target on `f`: their weapon forearm, or (for 'torso') the best open target, see `openTarget` */
  private target(f: Fencer, what: 'torso' | 'arm'): V {
    if (what === 'arm') return add(madd(f.hand, norm(sub(f.elbow, f.hand)), WRIST.back), [0, WRIST.top, 0]);
    if (this.picked === null) this.picked = openTarget(this.self, f);
    return TARGETS[this.picked].at(f);
  }

  /** the middle of a fencer's chest */
  private chestOf(f: Fencer): V {
    // (the middle of the chest, where the surface faces the point square: near the top it curves away, and a thrust
    // there glances off instead of pressing home)
    const c = f.capsules[0];
    return lerp(c.a, c.b, TORSO_AT);
  }

  /** what it has learned about its own aim this action: a correction to the wrist, from watching its point */
  private corr: [number, number] = [0, 0];
  private corrFor: V | null = null;

  /**
   * Point the weapon at `p`: the wrist and the hand as the arm's geometry says (feed-forward), and a correction from
   * watching where the point actually is (a fencer sees their own point and puts it where they mean it), learned
   * while the arm is out and forgotten when the target changes.
   */
  private inLine(I: Intent, p: V, e = I.extend, extraHand: [number, number] = [0, 0]) {
    const me = this.self, a = aimAt(me, p, e, extraHand);
    if (!this.corrFor || Math.hypot(...sub(p, this.corrFor)) > 0.2) this.corr = [0, 0];
    this.corrFor = p;
    if (me.extension > 0.5) {
      const F = { ...me.frame, o: [0, 0, 0] as V }, g = me.blade.guard;
      const want = toLocal(F, norm(sub(p, g))), have = toLocal(F, norm(sub(me.blade.tip, g)));
      const dy = Math.atan2(want[2], want[0]) - Math.atan2(have[2], have[0]);
      const dp = Math.atan2(want[1], Math.hypot(want[0], want[2])) - Math.atan2(have[1], Math.hypot(have[0], have[2]));
      // (harder as the arm straightens: late in an attack is when the point is steered onto the target)
      const k = me.extension > 0.85 ? 0.3 : 0.1, lim = me.extension > 0.85 ? 0.5 : 0.35;
      this.corr = [Math.max(-lim, Math.min(lim, this.corr[0] + dy * k)), Math.max(-lim, Math.min(lim, this.corr[1] + dp * k))];
    }
    I.point = [a.point[0] + this.corr[0], a.point[1] + this.corr[1]]; I.hand = [a.hand[0] + extraHand[0], a.hand[1] + extraHand[1]];
  }
}

/** the targets a point can go for on a fencer, and what each costs over its distance (the chest is the default) */
export const TARGETS: { name: string; at: (f: Fencer) => V; cost: number }[] = [
  { name: 'chest', at: (f) => lerp(f.capsules[0].a, f.capsules[0].b, TORSO_AT), cost: 0 },
  { name: 'belly', at: (f) => lerp(f.capsules[0].a, f.capsules[0].b, 0.32), cost: 0.05 },
  { name: 'shoulder', at: (f) => add(f.shoulder, [0, 0.03, 0]), cost: 0.08 },
  { name: 'upper arm', at: (f) => lerp(f.capsules[4].a, f.capsules[4].b, 0.5), cost: 0.1 },
  { name: 'mask', at: (f) => add(f.capsules[2].a, [0, -0.02, 0]), cost: 0.12 },
  { name: 'thigh', at: (f) => lerp(f.capsules[9].a, f.capsules[9].b, 0.35), cost: 0.15 },
];

/**
 * Which target `me` should go for on `f` (an index into TARGETS): the nearest one their bell doesn't hide. An épée
 * bell is a shield 13.5 cm across at the end of the arm; held out, it covers the chest from the front, which is why
 * épée is so often won on the arm, the shoulder, the mask, the thigh. So: from my guard, which can my point reach
 * without passing behind their bell, and which is nearest. A fencer picks one and keeps it for the action.
 */
export function openTarget(me: Fencer, f: Fencer): number {
  const g = f.blade.guard, from = me.blade.guard, R = f.weapon.guardR + 0.035;
  let best = 0, score = Infinity;
  TARGETS.forEach((tg, i) => {
    const p = tg.at(f), d = sub(p, from), l2 = dot(d, d), t = Math.max(0, Math.min(1, dot(sub(g, from), d) / l2));
    // (how close the line from my guard to it passes their bell: inside its rim and the point meets steel)
    const near = Math.hypot(...sub(add(from, [d[0] * t, d[1] * t, d[2] * t]), g));
    const sc = Math.sqrt(l2) + tg.cost + (near < R && t < 0.97 ? 10 : 0);
    if (sc < score) { score = sc; best = i; }
  });
  return best;
}

/** Is `f`'s point in line at `chest`: arm (nearly) straight, and the blade aimed within a hand's breadth of it. */
export function inLine(f: Fencer, chest: V): boolean {
  if (f.extension < 0.8) return false;
  const g = f.blade.guard, ax = norm(sub(f.blade.tip, g)), d = sub(chest, g), along = dot(d, ax);
  if (along < 0) return false;
  const off = Math.hypot(d[0] - ax[0] * along, d[1] - ax[1] * along, d[2] - ax[2] * along);
  return off < 0.14;
}

/** A fencer who stands en garde and does nothing: something to practise on. */
export class Dummy implements Controller {
  private I = idle();
  constructor(readonly extend = 0) { this.I.extend = extend; }
  intent(): Intent { return this.I; }
}
