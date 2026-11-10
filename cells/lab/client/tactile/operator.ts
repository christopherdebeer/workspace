/**
 * A scripted operator: a closed loop that reads what the device shows and moves the hand the
 * way the device asks, as a person following its tutorial would, then reads the narrative and
 * visits its linked words. It drives the quiet preview and the end-to-end test; it knows nothing
 * the screen and the hint line do not say, apart from the rate (which a reader feels).
 */
import type { Frame, ReaderState } from './core';

export interface Intent { roll: number; pitch: number }
const NEUTRAL: Intent = { roll: 0, pitch: 0 };
const TURN = 0.45, TIP = 0.5;

export class Operator {
  private want: string[] = [];
  private visited = 0;
  private wordsInside = 0;
  private lastWord = '';
  private settleUntil = 0;
  private depth = 0;
  private lastSection = '';
  private entering = false;
  /** links seen, in order: what the operator chose to enter */
  log: string[] = [];

  constructor(private links: string[] = ['bell', 'study', 'garden', 'stairs']) { this.want = [...links]; }

  next(t: number, f: Frame, s: ReaderState): Intent {
    if (f.section !== this.lastSection) {
      if (this.lastSection) {
        const deeper = s.tutorial ? 0 : (f.section !== 'hall' && this.depth === 0 ? 1 : f.section === 'hall' ? -1 : 0);
        this.depth = Math.max(0, this.depth + deeper);
      }
      this.lastSection = f.section;
      this.entering = false;
      this.settleUntil = t + 0.4;
      this.wordsInside = 0;
    }
    if (f.word !== this.lastWord) { this.lastWord = f.word; this.wordsInside++; }
    if (t < this.settleUntil) return NEUTRAL;
    if (!s.ready) return NEUTRAL;
    if (s.tutorial) return this.tutorial(f, s);
    return this.narrative(f, s);
  }

  private tutorial(f: Frame, s: ReaderState): Intent {
    if (f.hint.startsWith('return')) return NEUTRAL;
    switch (s.stage) {
      case 'faster': case 'forward': return { roll: TURN, pitch: 0 };
      case 'reverse': case 'pause': return { roll: -TURN, pitch: 0 };
      case 'enter': return s.latched ? NEUTRAL : { roll: 0, pitch: TIP };
      case 'exit': return s.latched ? NEUTRAL : { roll: 0, pitch: -TIP };
      default: return NEUTRAL;
    }
  }

  private narrative(f: Frame, s: ReaderState): Intent {
    if (s.latched) { this.entering = false; return NEUTRAL; }
    if (this.entering) return { roll: 0, pitch: TIP };
    if (this.depth > 0) {
      // read a little of the passage at its own pace, then come back out
      if (this.wordsInside < 7) return s.rate < 0.9 ? { roll: TURN * 0.6, pitch: 0 } : NEUTRAL;
      return s.rate !== 0 ? { roll: -TURN, pitch: 0 } : { roll: 0, pitch: -TIP };
    }
    const target = this.want[this.visited % this.want.length];
    const onTarget = f.word === target;
    if (s.rate === 0) {
      if (onTarget) {
        if (!s.focused) return NEUTRAL;
        this.log.push(target); this.visited++; this.entering = true;
        return { roll: 0, pitch: TIP };
      }
      return { roll: TURN * 0.5, pitch: 0 };          // creep forward
    }
    if (onTarget) return { roll: -TURN, pitch: 0 };   // stop on it
    if (s.rate > 0.35) return { roll: -TURN * 0.5, pitch: 0 };
    return NEUTRAL;                                   // crawl toward it
  }
}
