/**
 * The coach: a controller a lesson drives. It does what it's told, plainly and on time: stands, opens a line, steps,
 * attacks along a chosen line at a chosen target, holds a lunge, recovers. A coach gives the blade (its hand is
 * softer than an opponent's) so that a parry done right works.
 */
import type { Fencer } from './fencer';
import { aimAt } from './fencer';
import type { Controller, Intent, Step } from './intent';
import { idle } from './intent';
import type { V } from './v3';

export class Coach implements Controller {
  /** where its point is kept (or null: its natural line, offset by `point`) */
  aim: (() => V) | null = null;
  extend = 0; lunge = false;
  /** how fast its arm extends (per second): a lesson's tempo, slower than a fencer's (Infinity: as fast as it can) */
  rate = 2.6;
  /** its arm as it stands */
  arm = 0;
  hand: [number, number] = [0, 0]; point: [number, number] = [0, 0];
  private next: Step | null = null;
  private I = idle();

  constructor(readonly me: Fencer) {
    // (a coach's hand gives: it won't wrestle a parry)
    me.blade.muscle.fGuard = 40; me.blade.muscle.fPommel = 24; me.blade.muscle.omega = 24;
  }

  /** stand en garde, the point in its line */
  rest() { this.aim = null; this.extend = 0; this.lunge = false; this.hand = [0, 0]; this.point = [0, 0]; this.arm = 0; }
  step(s: Step) { this.next = s; }

  intent(dt = 1 / 60): Intent {
    const I = this.I;
    this.arm += Math.max(-this.rate * dt * 2, Math.min(this.rate * dt, this.extend - this.arm));
    I.extend = this.arm; I.lunge = this.lunge; I.roll = 0;
    I.step = this.next; this.next = null;
    if (this.aim) {
      const a = aimAt(this.me, this.aim(), this.arm);
      I.hand = [a.hand[0] + this.hand[0], a.hand[1] + this.hand[1]];
      I.point = [a.point[0] + this.point[0], a.point[1] + this.point[1]];
    } else { I.hand = [...this.hand]; I.point = [...this.point]; }
    return I;
  }
}
