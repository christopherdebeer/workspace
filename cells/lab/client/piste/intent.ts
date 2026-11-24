/**
 * What a fencer means to do, this instant: the one interface between whatever decides (a thumb on the glass, a
 * keyboard, the opponent's mind, a test script) and the body that does it. Every controller speaks only this.
 *
 * It's in the fencer's own frame and in physical units, so a controller never needs to know how the arm is built:
 * where the hand goes off its en garde place, which way the point is turned off its line, how far the arm is
 * extended, how the hand is rolled, and what the feet should do.
 */
export type Step = 'advance' | 'retreat';
export interface Intent {
  /** the guard moved off its place: to the fencer's right (+) and up (+), m */
  hand: [number, number];
  /** the point turned off its line by the wrist: toward the fencer's right (+) and up (+), rad */
  point: [number, number];
  /** 0 a bent arm (en garde) .. 1 straight */
  extend: number;
  /** the hand rolled from thumb-up (supination −, pronation +), rad */
  roll: number;
  /** a step asked for now (taken when the feet are free) */
  step: Step | null;
  /** lunge while this is held; recover when it's let go */
  lunge: boolean;
}
export const idle = (): Intent => ({ hand: [0, 0], point: [0, 0], extend: 0, roll: 0, step: null, lunge: false });

/** Anything that decides for a fencer. `see` is what it may know: the world as it was (a controller may lag it). */
export interface Controller {
  intent(dt: number): Intent;
}
