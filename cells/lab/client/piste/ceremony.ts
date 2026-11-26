/**
 * The bout outside the fencing: what the two fencers do before it, between touches and after it (`Options.ceremony`).
 *
 * - Warming up (a bout with a player, before it starts): you're free; the opponent loosens up on its line.
 * - Before: back to their lines (a player who's been warming up may be anywhere), they salute each other (a countdown
 *   runs over the salute) and come on guard for "en garde". Without a warm-up they loosen first.
 * - Between touches, instead of being put back on their lines: out of the lunge, up out of guard, the point lowered;
 *   back to the line (the opponent turns and walks; you step back facing them, so your view stays on them), shaking
 *   the arm out on the way, a moment on the line, and back on guard.
 * - After: they stand, lower their weapons and salute.
 *
 * It's a script per fencer, keyed to the bout's clock and a seed, so it's the same every time (a replay too). Each
 * substep it sets each fencer's `scene` (fencer.ts); the fencer's body does the rest. The bout asks it when it's done.
 */
import type { Fencer, Scene } from './fencer';

export type Rite = 'warmup' | 'prelude' | 'interlude' | 'over';

/** the timings, s */
export const RITE = { up: 0.5, onLine: 0.45, guard: 0.7, loosen: 1.4, salute: 2.3, overWait: 1.2 };

export class Ceremony {
  rite: Rite | null = null;
  /** seconds into it */
  t = 0;
  private seed: number;
  /** each fencer's script position: walking, arrived (when), and its arm's (what, since when) */
  private arrived: [number, number] = [-1, -1];
  private shakeAt: [number, number] = [-1, -1];
  private guardAt = -1;
  /** the prelude: whether it begins with loosening (no warm-up before it), and when the salute began */
  private loosen = true; private saluteAt = -1;
  /** the prelude after a warm-up: you've taken up your guard where you are; only the opponent makes ready */
  private youStay = false;

  constructor(seed = 1) { this.seed = seed; }

  begin(rite: Rite, n = 0, o: { loosen?: boolean; youStay?: boolean } = {}) {
    this.rite = rite; this.t = 0; this.arrived = [-1, -1]; this.guardAt = -1; this.saluteAt = -1; this.loosen = o.loosen ?? true; this.youStay = !!o.youStay;
    // (who shakes their arm out on the way back, and when: a little different each time)
    const r = (k: number) => { const x = Math.sin((this.seed + n * 7.31 + k * 3.7) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    this.shakeAt = [r(1) < 0.6 ? 0.6 + 0.8 * r(2) : -1, r(3) < 0.7 ? 0.5 + 0.9 * r(4) : -1];
  }

  /** run on a substep, setting the fencers' scenes; true once it's over (the fencers back on guard, or standing after
   * the bout, which never ends by itself) */
  update(h: number, fencers: [Fencer, Fencer], lines: [number, number]): boolean {
    if (!this.rite) return true;
    this.t += h;
    const t = this.t;
    if (this.rite === 'warmup') {
      // you're free; they loosen on their line, an arm shaken out every few seconds
      fencers[0].scene = null;
      const c = t % 4.2;
      fencers[1].scene = { stand: 1, walkTo: lines[1], turn: 0, arm: c > 1 && c < 2.3 ? 'shake' : 'down', armT: c - 1 };
      return false;
    }
    if (this.rite === 'prelude') {
      // (loosen, if there was no warm-up; back to the lines; salute; on guard)
      fencers.forEach((f, i) => { if ((Math.abs(f.s - lines[i]) < 0.03 || (i === 0 && this.youStay)) && this.arrived[i] < 0) this.arrived[i] = t; });
      const ready = this.arrived[0] >= 0 && this.arrived[1] >= 0;
      if (this.saluteAt < 0 && ready && t > (this.loosen ? RITE.loosen : 0.3)) this.saluteAt = t;
      const salute = this.saluteAt, guard = salute < 0 ? Infinity : salute + RITE.salute;
      fencers.forEach((f, i) => {
        // (you, after a warm-up, are already on guard where you came to rest: left to yourself)
        if (i === 0 && this.youStay) { f.scene = null; return; }
        const shake = i === 0 ? 0.15 : 0.45;
        const arm: Scene['arm'] = salute < 0 ? (this.loosen && t > shake && t < shake + 1.3 ? 'shake' : 'down') : t < guard ? 'salute' : 'guard';
        const armT = arm === 'shake' ? t - shake : arm === 'salute' ? t - salute : 0;
        f.scene = { stand: t < guard ? 1 : 0, walkTo: lines[i], turn: 0, arm, armT };
      });
      if (t > guard + RITE.guard) return this.end(fencers);
      return false;
    }
    if (this.rite === 'over') {
      fencers.forEach((f) => { f.scene = { stand: 1, walkTo: null, turn: 0, arm: t > RITE.overWait && t < RITE.overWait + RITE.salute ? 'salute' : 'down', armT: t - RITE.overWait }; });
      return false;
    }
    // between touches: up, back to the line, a moment there, on guard
    fencers.forEach((f, i) => {
      const away = Math.abs(f.s - lines[i]), there = away < 0.03;
      if (there && this.arrived[i] < 0 && t > RITE.up) this.arrived[i] = t;
      const walking = t > RITE.up && this.arrived[i] < 0;
      // (the opponent turns its back to walk to its line if it's far; you step back facing them)
      const turn = i === 1 && walking && away > 0.9 ? Math.PI : 0;
      const sh = this.shakeAt[i], arm: Scene['arm'] = this.guardAt >= 0 ? 'guard' : sh >= 0 && t > RITE.up + sh && t < RITE.up + sh + 1.3 ? 'shake' : 'down';
      f.scene = { stand: this.guardAt >= 0 ? 0 : 1, walkTo: t > RITE.up ? lines[i] : null, turn, arm, armT: arm === 'shake' ? t - RITE.up - sh : 0 };
    });
    const both = Math.max(this.arrived[0], this.arrived[1]);
    if (this.guardAt < 0 && this.arrived[0] >= 0 && this.arrived[1] >= 0 && t > both + RITE.onLine) this.guardAt = t;
    if (this.guardAt >= 0 && t > this.guardAt + RITE.guard) return this.end(fencers);
    return false;
  }

  /** whether you stay where you are when the prelude ends (you took up your guard there) */
  get stays() { return this.youStay; }
  /** in the prelude, seconds until the fencers are on guard (a countdown over the salute), or null before the salute */
  countdown(): number | null { return this.rite === 'prelude' && this.saluteAt >= 0 ? Math.max(0, this.saluteAt + RITE.salute + RITE.guard - this.t) : null; }

  private end(fencers: [Fencer, Fencer]) { this.rite = null; for (const f of fencers) f.scene = null; return true; }
}
