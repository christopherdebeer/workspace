/**
 * The flicks a player makes, kept on the device: where from, the control as dragged, what the aim ring showed
 * (if it was shown), and where it ended. The Level Lab (same origin) reads them back to lay real flicks over
 * its maps of the same level — the evidence that comes from use rather than from the lab.
 */
import type { V3 } from './level';

export interface Flick {
  t: number; level: number; seed: number; fp: string; skin: string;
  /** the top it was flicked from, and the control (world yaw, power 0–1, spin) */
  from: number; yaw: number; power: number; spin: number;
  /** the drag as made: its length and the screen it was made on (CSS px), and the camera's heading */
  drag: number; vw: number; vh: number; camYaw: number;
  /** how much aim was shown (easy: arc and ring; normal: the arc; hard: neither), and where a fall put it back */
  aim?: 'easy' | 'normal' | 'hard'; reset?: 'top' | 'jump';
  /** the top the aim ring was on at release (−1 none; null when no ring was shown) */
  ring: number | null;
  /** the top it then stood on, or −1 for a fall; absent while unsettled or when it was flicked again first */
  to?: number;
  at?: V3;
}
const KEY = 'squishy:flicks';
const MAX = 3000;
let pending: Flick | null = null, pendingAt = 0;

export function readFlicks(): Flick[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Flick[]; } catch { return []; }
}
function write(all: Flick[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX))); } catch { /* full, private: the game plays on */ }
}
/** a flick made: kept now, its ending filled in when it comes */
export function logFlick(f: Flick) {
  pending = f;
  pendingAt = performance.now();
  write([...readFlicks(), f]);
}
/** where the last flick ended: a top it stood on (once it's been away long enough to have left), or −1 for a fall */
export function settleFlick(to: number, at: V3) {
  if (!pending || (to >= 0 && performance.now() - pendingAt < 600)) return;
  const p = pending;
  pending = null;
  const all = readFlicks();
  const i = all.findIndex((f) => f.t === p.t);
  if (i >= 0) { all[i] = { ...all[i], to, at: at.map((v) => Math.round(v * 10) / 10) as V3 }; write(all); }
}
