/**
 * Switchback's score, and the ways a run can go (its modes).
 *
 * Points come from riding well:
 * - **pace**: a steady trickle while you're going fast (nothing below ~90 km/h), straight into the score;
 * - **tricks**, into a combo: air (by how long you were up), a whip (by how far out you threw it), a flip (back, front,
 *   double), a landing square to the slope (CLEAN), a slide held through a turn;
 * - **checkpoints**: a bonus for each, more for reaching it under par.
 *
 * The **combo**: each trick adds its points to a pool and raises the multiplier (×1, ×1.5, … up to ×4). The pool banks
 * (pool × multiplier into the score) once you've ridden a couple of seconds on the ground without another trick, or at
 * a checkpoint. A fall before it banks wipes it, and costs points of its own.
 *
 * The **modes**: a RUN to a finish 3 km down; THREE LIVES, until the third fall; a TIME TRIAL over the same 3 km, the
 * clock the result; ENDLESS, until you call it a day (FINISH, in the menu).
 */
import type { Event, Rider } from './sim';
import { VMAX } from './sim';
import type { Sig } from './sign';

export type Mode = 'run' | 'lives' | 'time' | 'endless';
export const MODES: Record<Mode, { name: string; short: string; length?: number; lives?: number; about: string }> = {
  run: { name: 'RUN', short: 'RUN', length: 3000, about: '3 KM DOWN · SCORED' },
  lives: { name: 'THREE LIVES', short: 'LIVES', lives: 3, about: 'UNTIL THE THIRD FALL · SCORED' },
  time: { name: 'TIME TRIAL', short: 'TIME', length: 3000, about: '3 KM DOWN · AGAINST THE CLOCK' },
  endless: { name: 'ENDLESS', short: 'ENDLESS', about: 'ON AND ON · FINISH FROM THE MENU' },
};

/** a trick just put into the combo, or a combo just banked or wiped: for the HUD and the sound */
export type Moment = { kind: 'trick' | 'bank' | 'wipe' | 'checkpoint'; label: string; points: number };

export class Score {
  total = 0; pool = 0; mult = 1; chain: string[] = [];
  /** the run so far: its time, falls, tricks landed, the best combo banked */
  time = 0; falls = 0; tricks = 0; bestCombo = 0;
  moments: Moment[] = [];
  private airT = 0; private whipMax = 0; private quiet = 0; private slideT = 0; private wasAir = false; private lastFlag = 2; private flagT = 0;
  private flipped = false; private beats = 0;

  /** each step of the run (dt), after the sim's */
  update(r: Rider, dt: number) {
    this.time += dt; this.flagT += dt;
    if (r.crashT > 0) { this.wasAir = false; return; }
    if (r.air) {
      this.airT = r.airT; this.whipMax = Math.max(this.whipMax, Math.abs(r.whip));
    } else {
      // (pace: a trickle into the score, only when you're really moving)
      const pace = Math.max(0, (Math.hypot(r.vx, r.vz) - 25) / (VMAX - 25));
      this.total += pace * 30 * dt;
      // (a slide: really sideways, held long enough, a trick when it's straightened)
      if (Math.abs(r.slip) > 0.25) this.slideT += dt;
      else if (Math.abs(r.slip) < 0.1) { if (this.slideT > 0.6) { this.add('SLIDE', Math.round(this.slideT * 120)); this.beat(); } this.slideT = 0; }
      // (ridden quiet a while, the combo banks)
      if (this.slideT === 0) this.quiet += dt;
      if (this.pool && this.quiet > 2) this.bank();
    }
    this.wasAir = r.air;
  }

  /** what the sim threw this step */
  event(e: Event, r: Rider) {
    if (e.kind === 'flip') {
      const n = Math.abs(e.k), back = e.k > 0;
      this.add(`${n > 2 ? `${n}× ` : n === 2 ? 'DOUBLE ' : ''}${back ? 'BACKFLIP' : 'FRONT FLIP'}`, Math.round(n * (back ? 1000 : 1200) * (n > 1 ? 1.25 : 1)));
    } else if (e.kind === 'land') {
      // (a real jump just landed (not a crest's hop): its air, its whip, whether it came down square; one step up the
      // multiplier for the lot)
      if (this.airT > 0.8) {
        this.add(`AIR ${this.airT.toFixed(1)}S`, Math.round((this.airT - 0.5) * 10) * 10);
        if (this.whipMax > 0.35) this.add('WHIP', Math.round(this.whipMax * 57.3 * 6));
        if (r.lastMiss < 0.12) this.add('CLEAN', 100);
        this.beat();
      } else if (this.flipped) this.beat();
      this.airT = 0; this.whipMax = 0; this.flipped = false;
    } else if (e.kind === 'crash') {
      this.falls++;
      if (this.pool) this.moments.push({ kind: 'wipe', label: 'WIPED OUT', points: Math.round(this.pool * this.mult) });
      this.pool = 0; this.mult = 1; this.chain = []; this.airT = 0; this.whipMax = 0; this.slideT = 0; this.beats = 0; this.flipped = false;
      this.total = Math.max(0, this.total - 200);
    } else if (e.kind === 'checkpoint') {
      // (a checkpoint banks the combo, and pays for itself: more for reaching it under par)
      if (this.pool) this.bank();
      const par = (r.s - this.lastFlag) / 34, bonus = 250 + Math.max(0, Math.round((par - this.flagT) * 100));
      this.total += bonus; this.lastFlag = r.s; this.flagT = 0;
      this.moments.push({ kind: 'checkpoint', label: `CHECKPOINT ${e.k}`, points: bonus });
    } else if (e.kind === 'respawn') { this.lastFlag = r.s; this.flagT = 0; }
  }

  /** what's showing now: the score (whole points), and the combo pending */
  get shown() { return Math.floor(this.total); }
  get pending() { return Math.round(this.pool * this.mult); }

  /** at the end of a run: anything pending banks */
  close() { if (this.pool) this.bank(); }

  private add(label: string, points: number) {
    if (label.includes('FLIP')) this.flipped = true;
    this.pool += points; this.chain.push(label); this.tricks++; this.quiet = 0;
    if (this.chain.length > 4) this.chain.shift();
    this.moments.push({ kind: 'trick', label, points });
  }
  /** a move done (a flight, a slide): after the first in a combo, each lifts the multiplier half a step, to ×4 */
  private beat() { if (this.beats++) this.mult = Math.min(4, this.mult + 0.5); }
  private bank() {
    const got = Math.round(this.pool * this.mult);
    this.total += got; this.bestCombo = Math.max(this.bestCombo, got);
    this.moments.push({ kind: 'bank', label: `×${this.mult}`, points: got });
    this.pool = 0; this.mult = 1; this.chain = []; this.quiet = 0; this.beats = 0;
  }
}

/** a run's record, kept per mode and mountain: the best score (and, in a time trial, the best time) */
export type Best = { score: number; time: number };
const KEY = (mode: Mode, seed: number) => `switchback:best:${mode}:${seed}`;
export function bestOf(mode: Mode, seed: number): Best | null {
  try { const v = localStorage.getItem(KEY(mode, seed)); return v ? JSON.parse(v) : null; } catch { return null; }
}
/** keep the run if it beats the best: a higher score, or in a time trial a faster time. Says whether it did, and if it
 * did, where it went on the board (-1 if it didn't make it), and when it was ridden (its name there, to sign it by) */
export function keepBest(mode: Mode, seed: number, score: number, time: number) {
  const was = bestOf(mode, seed), better = !was || (mode === 'time' ? time < was.time : score > was.score);
  let rank = -1;
  const at = Date.now();
  if (better) {
    const list = board(mode);
    try { localStorage.setItem(KEY(mode, seed), JSON.stringify({ score, time })); } catch { /* (no matter) */ }
    rank = enter(mode, list, { score, time, seed, at });
  }
  return { better, was, rank, at };
}

/**
 * The board: a mode's best runs, in this browser. Each new best (on any mountain) goes up, and the top ten stay, each
 * signed or not. A time trial's go by the clock, the rest by the score.
 */
export type Entry = { score: number; time: number; seed: number; at: number; sig?: Sig };
const BOARD = (mode: Mode) => `switchback:board:${mode}`;
const TOP = 10;
const order = (mode: Mode) => (a: Entry, b: Entry) => (mode === 'time' ? a.time - b.time : b.score - a.score) || a.at - b.at;
export function board(mode: Mode): Entry[] {
  try {
    const v = localStorage.getItem(BOARD(mode));
    if (v) return JSON.parse(v);
    // (no board yet: it starts with the bests kept before there was one, unsigned)
    const list: Entry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const m = localStorage.key(i)?.match(/^switchback:best:(\w+):(\d+)$/);
      if (m && m[1] === mode) { const b = bestOf(mode, Number(m[2])); if (b) list.push({ score: b.score, time: b.time, seed: Number(m[2]), at: 0 }); }
    }
    return list.sort(order(mode)).slice(0, TOP);
  } catch { return []; }
}
function keepBoard(mode: Mode, list: Entry[]) { try { localStorage.setItem(BOARD(mode), JSON.stringify(list)); } catch { /* (no matter) */ } }
/** a run onto the board: where it went (0 the top), or -1 if it didn't make it */
function enter(mode: Mode, list: Entry[], e: Entry) {
  const top = [...list, e].sort(order(mode)).slice(0, TOP);
  keepBoard(mode, top);
  return top.indexOf(e);
}
/** a signature put to a run on the board (by when it was ridden); none, and it's unsigned again */
export function sign(mode: Mode, at: number, sig: Sig) {
  const list = board(mode), e = list.find((x) => x.at === at);
  if (!e) return;
  if (sig.length) e.sig = sig; else delete e.sig;
  keepBoard(mode, list);
}
