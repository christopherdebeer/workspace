/**
 * An opponent: a controller like any other (it gives an Intent and nothing else), seeing the bout as it was a
 * reaction time ago. It keeps its distance, holds its point toward you, takes its chance to attack (an extension, and
 * a lunge behind it; an advance first when it's a little far), and when your point comes at it, parries to the side
 * your blade is on and ripostes.
 *
 * It's deliberately small and plain: a few tactics, each a function from what it sees to what it means, chosen by a
 * little state machine. A better fencer is more of these, or a different controller entirely.
 */
import type { Bout } from './bout';
import type { Controller, Intent } from './intent';
import { idle } from './intent';
import { type Fencer, aimAt } from './fencer';
import { seeded, type Rand } from '../kit/rng';
import { type V, add, dot, madd, norm, sub, toLocal } from './v3';

/** what it saw: the other's tip and how it moved, where they stood */
interface Seen { t: number; tip: V; tipVel: V; s: number; lunge: number; ext: number; gap: number }

export interface Style {
  /** how long it takes to see, s */
  reaction: number;
  /** the gap (front to front) it likes, m, and how restless it is about it */
  measure: number;
  /** attacks per second of opportunity, and how often it parries a threat it sees (0..1) */
  aggression: number; parry: number;
}
export const SPARRING: Style = { reaction: 0.2, measure: 1.75, aggression: 0.5, parry: 0.75 };

/** The levels of opponent, and how much bullet time each allows you (the assist falls away as they get better). */
export interface Level { name: string; style: Style; assist: number }
export const LEVELS: Level[] = [
  { name: 'novice', style: { reaction: 0.32, measure: 1.95, aggression: 0.22, parry: 0.35 }, assist: 1 },
  { name: 'club', style: { reaction: 0.25, measure: 1.85, aggression: 0.38, parry: 0.6 }, assist: 0.6 },
  { name: 'competitor', style: SPARRING, assist: 0.25 },
  { name: 'master', style: { reaction: 0.16, measure: 1.7, aggression: 0.68, parry: 0.88 }, assist: 0 },
];

type Tactic = 'measure' | 'attack' | 'recover' | 'parry' | 'riposte';

export class Opponent implements Controller {
  private seen: Seen[] = [];
  private rnd: Rand;
  tactic: Tactic = 'measure';
  private since = 0;
  private lastStep = 0;
  private side = 1;
  private aimAt: 'torso' | 'arm' = 'torso';
  private I: Intent = idle();
  private want: number;

  constructor(readonly bout: Bout, readonly me: 0 | 1, readonly style: Style = SPARRING, seed = 1) {
    this.rnd = seeded(seed * 7919 + me);
    this.want = style.measure;
  }

  private get self(): Fencer { return this.bout.fencers[this.me]; }
  private get other(): Fencer { return this.bout.fencers[1 - this.me]; }

  intent(dt: number): Intent {
    const b = this.bout, o = this.other;
    this.seen.push({ t: b.t, tip: o.blade.tip, tipVel: o.blade.velAt(o.blade.n - 1), s: o.s, lunge: o.lunge, ext: o.extension, gap: b.gap });
    while (this.seen.length > 2 && this.seen[1].t <= b.t - this.style.reaction) this.seen.shift();
    const see = this.seen[0];
    this.since += dt;
    const I = this.I;
    I.step = null;
    if (b.phase !== 'fence') { this.tactic = 'measure'; this.since = 0; Object.assign(I, idle()); return I; }
    const me = this.self, torso = this.target(me, 'torso');
    // a threat: their point coming at my body
    const toMe = sub(torso, see.tip), d = Math.hypot(...toMe), closing = dot(see.tipVel, norm(toMe));
    const threatened = d < 0.75 && closing > 1.0;
    switch (this.tactic) {
      case 'measure': {
        I.lunge = false;
        I.extend = 0.12;
        this.inLine(I, this.target(o, 'torso'));
        // keep the distance it likes (and change its mind about it now and then)
        if (this.rnd() < dt * 0.4) this.want = this.style.measure + (this.rnd() - 0.5) * 0.5;
        if (b.t - this.lastStep > 0.42) {
          if (see.gap < this.want - 0.2) { I.step = 'retreat'; this.lastStep = b.t; }
          else if (see.gap > this.want + 0.25) { I.step = 'advance'; this.lastStep = b.t; }
        }
        if (threatened && this.rnd() < this.style.parry) { this.begin('parry'); this.side = this.sideOf(see.tip); break; }
        if (see.gap < 1.55 && this.rnd() < dt * this.style.aggression * 3) { this.aimAt = see.gap < 1.1 && this.rnd() < 0.5 ? 'arm' : 'torso'; this.begin('attack'); }
        else if (see.gap < 2.05 && this.rnd() < dt * this.style.aggression) { this.aimAt = 'torso'; I.step = 'advance'; this.lastStep = b.t; this.begin('attack'); }
        break;
      }
      case 'attack': {
        // the arm first, then the legs; the point kept on its target all the way
        I.extend = 1;
        this.inLine(I, this.target(o, this.aimAt), 1);
        if (me.extension > 0.55 && !me.act) I.lunge = this.aimAt === 'torso' || see.gap > 0.9;
        if ((me.lunge > 0.98 && this.since > 0.45) || this.since > 1.3) this.begin('recover');
        break;
      }
      case 'recover': {
        I.lunge = false; I.extend = 0.2;
        this.inLine(I, this.target(o, 'torso'));
        if (me.lunge === 0 && this.since > 0.2) { if (this.rnd() < 0.6) { I.step = 'retreat'; this.lastStep = b.t; } this.begin('measure'); }
        break;
      }
      case 'parry': {
        // the hand goes to the side their blade is on, the point stays near the line: their blade is taken on my forte
        I.lunge = false; I.extend = 0.15;
        I.hand = [0.15 * this.side, 0.02];
        I.point = [0.12 * this.side, 0.05];
        if (this.since > 0.2) this.begin(this.rnd() < 0.8 ? 'riposte' : 'measure');
        break;
      }
      case 'riposte': {
        I.extend = 1; I.lunge = see.gap > 1.0;
        this.inLine(I, this.target(o, 'torso'), 1);
        if (this.since > 0.55) this.begin('recover');
        break;
      }
    }
    return I;
  }

  private begin(t: Tactic) { this.tactic = t; this.since = 0; }

  /** which side of my line (my right +1, my left −1) their point is on */
  private sideOf(p: V) {
    const F = this.self.frame, l = toLocal(F, p), g = toLocal(F, this.self.blade.guard);
    return l[2] > g[2] - 0.03 ? 1 : -1;
  }

  /** the middle of a fencer's chest, or their weapon wrist */
  private target(f: Fencer, what: 'torso' | 'arm'): V {
    if (what === 'arm') return madd(f.hand, norm(sub(f.elbow, f.hand)), 0.08);
    const c = f.capsules[0];
    return add(c.b, [0, -0.08, 0]);
  }

  /** point the weapon at `p` (the wrist, and the hand a little) */
  private inLine(I: Intent, p: V, e = I.extend) {
    const a = aimAt(this.self, p, e);
    I.point = a.point; I.hand = a.hand;
  }
}

/** A fencer who stands en garde and does nothing: something to practise on. */
export class Dummy implements Controller {
  private I = idle();
  constructor(readonly extend = 0) { this.I.extend = extend; }
  intent(): Intent { return this.I; }
}
