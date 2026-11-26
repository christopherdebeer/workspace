/**
 * Two thumbs on the glass, read as an Intent (and a keyboard and mouse, for the desk).
 *
 *   right thumb: the weapon hand. Two schemes (`thumb=`):
 *                hand (the default): sideways moves the hand across your body (a parry: quarte to the left, sixte to
 *                the right) while the wrist keeps the point toward them; up and down tilts the point (the high and the
 *                low lines). So a parry is one movement, and the point is still there for the riposte.
 *                point: where the thumb goes is where the point goes (the hand a little, the wrist a lot).
 *                Either way, let go and the hand comes back to its guard. A second finger rolls the hand.
 *   left thumb:  the body. Push up and the arm extends, as far as you push; push on past that and you lunge, and
 *                hold it there; let go to recover. A tap is an advance; pull down for a retreat (keep it down to keep
 *                retreating).
 *
 * Every number that shapes the feel is in GAIN, and the mapping is all in `intent()`: another scheme is another
 * class with the same face.
 */
import type { Intent } from './intent';
import { idle } from './intent';
import { clamp } from './v3';

export const GAIN = {
  /** a thumb's full travel, as a fraction of the screen's short side */
  reach: 0.17,
  /** (point scheme) what full travel does: the guard (m) and the wrist (rad), right/left and up/down */
  hand: [0.13, 0.08], point: [0.3, 0.34],
  /** (hand scheme) the hand across (m) and up (m); the point up (rad); how much the wrist holds the point on them
   * as the hand moves (1: fully, about `aimDist` away); and a little of the point's own aim across (rad) */
  across: 0.3, rise: 0.05, tilt: 0.55, hold: 0.6, aimDist: 1.6, nudge: 0.08,
  /** left thumb: travel (of `reach`) to full extension, and further to lunge; down to retreat */
  extendAt: 0.9, lungeAt: 1.45, retreatAt: 0.45,
  /** a tap: shorter than this (s) and moving less than this (px) */
  tapTime: 0.22, tapMove: 14,
  /** a held retreat repeats this often, s */
  repeat: 0.36,
  /** roll: full travel of the second right finger, rad */
  roll: 1.2,
};

export interface Thumb { id: number; x0: number; y0: number; x: number; y: number; t0: number; moved: number }

export class Thumbs {
  right: Thumb | null = null; left: Thumb | null = null; twist: Thumb | null = null;
  private I = idle();
  private lastRetreat = -1;
  private pendingStep: Intent['step'] = null;
  // the keyboard and mouse
  private keys = new Set<string>();
  private mouse: Thumb | null = null;

  /** which scheme the right thumb uses */
  scheme: 'hand' | 'point' = 'hand';
  /** which controls a lesson allows (all, in a bout) */
  allow = { feet: true, extend: true, lunge: true, hand: true };

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.pendingStep = 'advance';
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.pendingStep = 'retreat';
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  private get unit() { return GAIN.reach * Math.min(innerWidth, innerHeight); }
  private now() { return performance.now() / 1000; }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    this.el.setPointerCapture?.(e.pointerId);
    const th: Thumb = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: this.now(), moved: 0 };
    if (e.pointerType === 'mouse') { this.mouse = th; return; }
    const rightSide = e.clientX > innerWidth / 2;
    if (rightSide && !this.right) this.right = th;
    else if (rightSide && !this.twist) this.twist = th;
    else if (!rightSide && !this.left) this.left = th;
  };
  private move = (e: PointerEvent) => {
    for (const th of [this.right, this.left, this.twist, this.mouse]) if (th && th.id === e.pointerId) {
      th.x = e.clientX; th.y = e.clientY; th.moved = Math.max(th.moved, Math.hypot(th.x - th.x0, th.y - th.y0));
    }
  };
  private up = (e: PointerEvent) => {
    const id = e.pointerId;
    if (this.left?.id === id) {
      const l = this.left;
      if (this.now() - l.t0 < GAIN.tapTime && l.moved < GAIN.tapMove) this.pendingStep = 'advance';
      this.left = null;
    }
    if (this.right?.id === id) { this.right = this.twist; this.twist = null; if (this.right) { this.right.x0 = this.right.x; this.right.y0 = this.right.y; } }
    if (this.twist?.id === id) this.twist = null;
    if (this.mouse?.id === id) this.mouse = null;
  };

  /** a thumb's travel from where it landed, in units of `reach`, up positive, at most `max` */
  private travel(th: Thumb, max = 1.25): [number, number] {
    let x = (th.x - th.x0) / this.unit, y = -(th.y - th.y0) / this.unit;
    const l = Math.hypot(x, y);
    if (l > max) { x *= max / l; y *= max / l; }
    return [x, y];
  }

  intent(): Intent {
    const I = this.I, t = this.now(), k = this.keys;
    I.step = this.pendingStep; this.pendingStep = null;
    // the hand
    const hand = this.right ?? this.mouse;
    const [ax, ay] = hand ? this.travel(hand) : [0, 0];
    if (this.scheme === 'point') {
      I.hand = [ax * GAIN.hand[0], ay * GAIN.hand[1]];
      I.point = [ax * GAIN.point[0], ay * GAIN.point[1]];
    } else {
      const hx = ax * GAIN.across;
      I.hand = [hx, ay * GAIN.rise];
      I.point = [-Math.atan(hx / GAIN.aimDist) * GAIN.hold + ax * GAIN.nudge, ay * GAIN.tilt];
    }
    I.roll = this.twist ? clamp((this.twist.x - this.twist.x0) / this.unit, -1, 1) * GAIN.roll : 0;
    // the body
    let up = 0;
    if (this.left) up = this.travel(this.left, 2)[1];
    if (k.has('Space')) up = Math.max(up, GAIN.extendAt);
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE')) up = GAIN.lungeAt + 0.1;
    I.extend = clamp(up / GAIN.extendAt, 0, 1);
    I.lunge = up >= GAIN.lungeAt;
    if (this.left && up < -GAIN.retreatAt && t - this.lastRetreat > GAIN.repeat) { I.step = 'retreat'; this.lastRetreat = t; }
    const A = this.allow;
    if (!A.feet) I.step = null;
    if (!A.lunge) I.lunge = false;
    if (!A.extend) I.extend = 0;
    if (!A.hand) { I.hand = [0, 0]; I.point = [0, 0]; I.roll = 0; }
    return I;
  }

  /** for starting a bout: whether the right thumb (or the mouse, or Enter) is down, and where it is now (its stillness
   * is judged from there, so a touch that's been fencing can come to rest and count) */
  hold(): { down: boolean; x: number; y: number; unit: number } {
    const th = this.right ?? this.mouse;
    if (th) return { down: true, x: th.x, y: th.y, unit: this.unit };
    return { down: this.keys.has('Enter'), x: 0, y: 0, unit: this.unit };
  }

  /** for the marks drawn under the thumbs */
  get touches() { return { right: this.right, left: this.left, twist: this.twist, unit: this.unit }; }
}
