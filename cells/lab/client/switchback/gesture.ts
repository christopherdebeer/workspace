/**
 * Switchback's air gestures: a stroke drawn in the air, read as it's drawn into a trick. A straight line is one of the
 * body's tricks by its direction (→ no hander, ← no footer, ↑ superman, ↓ can-can); a loop drawn round is the whip, the
 * way it goes round the way the bike swings (clockwise, its nose to the right). The trick is asked as soon as the shape
 * is clear and held while the finger stays down; the stroke goes on being read from there, so a second shape drawn
 * without lifting strings the next trick on (a line then a loop, a line then another line).
 *
 * Read on the stroke resampled to even steps (so the speed it's drawn at doesn't count): its length, how straight it is
 * (the chord against the length) and how far it's turned (the signed sum of each step's turn). A line must be long
 * enough and straight, nearly unturned; a loop must turn most of the way round. A big slow arc starts out looking like a
 * line, so a line has to be clearly straight before it's read.
 */
import type { Trick } from './sim';

export type Pt = { x: number; y: number };
export type Read = { trick: Trick; at: number };

export class Stroke {
  /** the stroke so far (resampled), where the shape being read now began, and what's been read */
  pts: Pt[] = []; private from = 0; trick: Trick | null = null; reads: Read[] = [];
  /** `size`: the screen's smaller side, px (a line is a sixth of it, a loop at least a quarter of it round) */
  constructor(private size: number, private step = Math.max(4, size / 90)) {}

  /** a point of the stroke (screen px, y down); the trick asked now (null until a shape's read) */
  add(x: number, y: number): Trick | null {
    const last = this.pts[this.pts.length - 1];
    if (!last) { this.pts.push({ x, y }); return this.trick; }
    // (resampled: a point every `step` px along the way the finger went)
    let d = Math.hypot(x - last.x, y - last.y), p = last;
    while (d >= this.step) {
      const f = this.step / d; p = { x: p.x + (x - p.x) * f, y: p.y + (y - p.y) * f };
      this.pts.push(p); d = Math.hypot(x - p.x, y - p.y);
      const t = this.read(); if (t) { this.trick = t; this.reads.push({ trick: t, at: this.pts.length - 1 }); this.from = this.pts.length - 1; }
    }
    return this.trick;
  }

  /** the shape drawn since the last one read, if it's clear yet */
  private read(): Trick | null {
    const seg = this.pts.slice(this.from);
    if (seg.length < 4) return null;
    const len = (seg.length - 1) * this.step, a = seg[0], b = seg[seg.length - 1], chord = Math.hypot(b.x - a.x, b.y - a.y);
    let turn = 0;
    for (let i = 2; i < seg.length; i++) {
      const h1 = Math.atan2(seg[i - 1].y - seg[i - 2].y, seg[i - 1].x - seg[i - 2].x), h2 = Math.atan2(seg[i].y - seg[i - 1].y, seg[i].x - seg[i - 1].x);
      turn += Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    }
    // (a loop: most of the way round (screen y is down, so a positive turn is clockwise on the screen))
    if (Math.abs(turn) > 4.6 && len > this.size * 0.25) return turn > 0 ? 'whipR' : 'whipL';
    // (a line: long enough, straight, nearly unturned; its direction to the nearest of four)
    if (len > this.size / 6 && chord / len > 0.95 && Math.abs(turn) < 0.25) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x), q = Math.round(ang / (Math.PI / 2));
      const t: Trick = q === 0 ? 'hands' : q === 2 || q === -2 ? 'feet' : q === -1 ? 'superman' : 'cancan';
      // (the same line drawn on in the same direction isn't a new trick: keep reading from here)
      return t === this.trick ? (this.from = this.pts.length - 1, null) : t;
    }
    return null;
  }
}
