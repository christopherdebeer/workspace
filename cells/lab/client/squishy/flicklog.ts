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
  /** the top it then stood on, −1 for a fall, or −2 off any top (on a rim, clinging, hanging); `by` says how that was
   * known: it stood there, it fell, or it was where it was when the next flick was made */
  to?: number;
  at?: V3;
  by?: 'stood' | 'fell' | 'next';
  /** after a fall: where it was put back, and by which rule (the last top; the jump; the last top, the jump tried
   * too often) */
  back?: V3;
  backBy?: 'top' | 'jump' | 'capped';
}
const KEY = 'squishy:flicks';
const MAX = 3000;
let pending: Flick | null = null, pendingAt = 0, fellT = 0;

export function readFlicks(): Flick[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Flick[]; } catch { return []; }
}
function write(all: Flick[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all.slice(-MAX))); } catch { /* full, private: the game plays on */ }
}
const r1 = (p: V3) => p.map((v) => Math.round(v * 10) / 10) as V3;
/** a flick made: kept now, its ending filled in when it comes. The one before, if it never stood anywhere or fell, is
 * closed with where it was when this one was made (`prior`: a top, or −2 for none) */
export function logFlick(f: Flick, prior?: { to: number; at: V3 }) {
  const all = readFlicks();
  if (pending && prior) {
    const i = all.findIndex((q) => q.t === pending!.t);
    if (i >= 0 && all[i].to === undefined) all[i] = { ...all[i], to: prior.to, at: r1(prior.at), by: 'next' };
  }
  pending = f;
  pendingAt = performance.now();
  write([...all, f]);
}
/** where the last flick ended: a top it stood on (once it's been away long enough to have left), or −1 for a fall */
export function settleFlick(to: number, at: V3) {
  if (!pending || (to >= 0 && performance.now() - pendingAt < 600)) return;
  const p = pending;
  pending = null;
  if (to < 0) fellT = p.t;
  const all = readFlicks();
  const i = all.findIndex((f) => f.t === p.t);
  if (i >= 0) { all[i] = { ...all[i], to, at: r1(at), by: to < 0 ? 'fell' : 'stood' }; write(all); }
}
/** where a fall put it back, on the flick that fell */
export function noteBack(back: V3, by: 'top' | 'jump' | 'capped') {
  if (!fellT) return;
  const all = readFlicks();
  const i = all.findIndex((f) => f.t === fellT);
  fellT = 0;
  if (i >= 0) { all[i] = { ...all[i], back: r1(back), backBy: by }; write(all); }
}
