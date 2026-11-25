/**
 * Bullet time: how fast the bout runs against the clock on the wall. It slows at the moments that decide a touch,
 * judged only from what a fencer could see (their point coming at you, your point arriving, the blades meeting), never
 * from what the opponent is thinking. How much it slows is the assist (1: down to a fifth of real time; 0: never),
 * which falls away with the level. It eases in quickly and out slowly, and won't linger: a long bind is fenced at
 * speed.
 *
 * `base` is a lesson's own pace (slow practice), under any assist.
 */
import type { Bout } from './bout';
import { type V, clamp, dot, norm, sub } from './v3';

export const SLOWEST = 0.2;

export class TimeDirector {
  /** 0..1: how far the critical moments slow it */
  assist: number;
  /** a lesson's pace, under everything */
  base = 1;
  /** how critical this moment is (0..1), and the slowing as it stands */
  critical = 0;
  slow = 1;
  private held = 0;
  private calm = 0;

  constructor(readonly bout: Bout, assist = 0, readonly me: 0 | 1 = 0) { this.assist = assist; }

  /** the rate of sim time to wall time now, after `wall` seconds on the wall */
  update(wall: number): number {
    const c = this.assist > 0 ? this.measure() : 0;
    // (it won't linger: past a second and a half slowed, it fades out until things are calm again)
    if (this.slow < 0.7) this.held += wall; else this.held = Math.max(0, this.held - wall * 2);
    if (c < 0.1) { this.calm += wall; if (this.calm > 0.5) this.held = 0; } else this.calm = 0;
    const tired = clamp(1 - (this.held - 1.5) / 0.5, 0, 1);
    this.critical = c * tired;
    const want = 1 - this.assist * (1 - SLOWEST) * this.critical;
    const k = 1 - Math.exp(-wall / (want < this.slow ? 0.06 : 0.35));
    this.slow += (want - this.slow) * k;
    return this.base * this.slow;
  }

  /** the moment's criticality, from what can be seen */
  measure(): number {
    const b = this.bout;
    if (b.phase !== 'fence') return 0;
    const me = b.fencers[this.me], them = b.fencers[1 - this.me];
    const coming = (from: V, vel: V, at: V, near: number) => {
      const to = sub(at, from), d = Math.hypot(...to), v = dot(vel, norm(to));
      return clamp((v - 0.8) / 1.6, 0, 1) * clamp((near - d) / (near - 0.15), 0, 1);
    };
    const chest = (f: typeof me) => f.capsules[0].b;
    const threat = coming(them.blade.tip, them.blade.velAt(them.blade.n - 1), chest(me), 1.2);
    const attack = coming(me.blade.tip, me.blade.velAt(me.blade.n - 1), chest(them), 1.0) * 0.7;
    const blades = b.t - b.lastTouch < 0.15 ? 0.6 : 0;
    return Math.max(threat, attack, blades);
  }
}
