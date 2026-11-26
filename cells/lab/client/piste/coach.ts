/**
 * The coach: a controller a lesson drives. It does what it's told, plainly and on time: stands, opens a line, steps,
 * attacks along a chosen line at a chosen target, holds a lunge, recovers. A coach gives the blade (its hand is
 * softer than an opponent's) so that a parry done right works.
 */
import type { Fencer } from './fencer';
import { aimAt, reachFor } from './fencer';
import type { Controller, Intent, Step } from './intent';
import { idle } from './intent';
import { type V, clamp, norm, sub, toLocal } from './v3';

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
  private corr: [number, number] = [0, 0];

  constructor(readonly me: Fencer) {
    // (a coach's hand gives: it won't wrestle a parry)
    me.blade.muscle.fGuard = 34; me.blade.muscle.fPommel = 20; me.blade.muscle.omega = 22;
  }

  /** its blade has been taken: it gives it (stops steering its point, and lets it go `across` the way the parry
   * pushed it, rad toward its own right, and lifts it `up` out of the way of the riposte: a coach opens for it) */
  give(across = 0, up = 0) { if (!this.given) { this.given = true; this.held = { hand: [...this.I.hand] as [number, number], point: [this.I.point[0] + across, this.I.point[1] + up] }; } }
  private given = false;
  private held: { hand: [number, number]; point: [number, number] } | null = null;

  /** stand en garde, the point in its line */
  rest() { this.given = false; this.held = null; this.aim = null; this.extend = 0; this.lunge = false; this.hand = [0, 0]; this.point = [0, 0]; this.arm = 0; }
  step(s: Step) { this.next = s; }

  intent(dt = 1 / 60): Intent {
    const I = this.I;
    // (with a target, no further than reaches it: too long an arm and the point slides past)
    // (and once its blade's been beaten or found it holds the arm where it was: a deflected point doesn't lengthen)
    const want = this.aim && !this.given ? Math.min(this.extend, Math.max(0.15, reachFor(this.me, this.aim()))) : this.given ? Math.min(this.extend, this.arm) : this.extend;
    this.arm += Math.max(-this.rate * dt * 2, Math.min(this.rate * dt, want - this.arm));
    I.extend = this.arm; I.lunge = this.lunge; I.roll = 0;
    I.step = this.next; this.next = null;
    if (this.given && this.held) { I.hand = [...this.held.hand]; I.point = [...this.held.point]; }
    else if (this.aim) {
      // (it watches its point, as a fencer does, and puts it where it means to)
      const p = this.aim(), me = this.me, a = aimAt(me, p, this.arm, this.hand);
      if (me.extension > 0.5) {
        const F = { ...me.frame, o: [0, 0, 0] as V }, g = me.blade.guard;
        const want = toLocal(F, norm(sub(p, g))), have = toLocal(F, norm(sub(me.blade.tip, g)));
        const dy = Math.atan2(want[2], want[0]) - Math.atan2(have[2], have[0]);
        const dp = Math.atan2(want[1], Math.hypot(want[0], want[2])) - Math.atan2(have[1], Math.hypot(have[0], have[2]));
        this.corr = [clamp(this.corr[0] + dy * 0.15, -0.35, 0.35), clamp(this.corr[1] + dp * 0.15, -0.35, 0.35)];
      }
      I.hand = [a.hand[0] + this.hand[0], a.hand[1] + this.hand[1]];
      I.point = [a.point[0] + this.point[0] + this.corr[0], a.point[1] + this.point[1] + this.corr[1]];
    } else { I.hand = [...this.hand]; I.point = [...this.point]; this.corr = [0, 0]; }
    return I;
  }
}
