/**
 * Replays. The bout is deterministic, so a replay is a copy of the bout as it was (a snapshot) run on again with the
 * intents that were given, substep for substep: not a recording of positions, the same physics again, which can be
 * watched at any speed and from anywhere.
 *
 * The recorder keeps a snapshot every quarter second (for the last few seconds) and every intent given since; a
 * replay starts from the latest snapshot before the moment asked for and runs to the end asked for.
 */
import { Bout, type BoutEvent } from './bout';
import { BladePair } from './contact';
import type { Intent } from './intent';

// (a weapon is shared data with functions in it; a bout's options likewise; the pair's blades are the fencers')
const SHARED = new Set(['weapon', 'opts']);

/** copy everything about `src` into `dst`, an object of the same shape: typed arrays in place, class instances in
 * place (their prototypes kept), plain data cloned */
export function copyInto(dst: any, src: any) {
  for (const k of Object.keys(src)) {
    if (SHARED.has(k) || (src instanceof BladePair && (k === 'a' || k === 'b'))) continue;
    const v = src[k];
    if (ArrayBuffer.isView(v)) (dst[k] as Float64Array).set(v as Float64Array);
    else if (v instanceof Map) dst[k] = new Map([...v].map(([kk, vv]) => [kk, structuredClone(vv)]));
    else if (Array.isArray(v) && v.some(isInstance)) v.forEach((x, i) => (isInstance(x) ? copyInto(dst[k][i], x) : (dst[k][i] = structuredClone(x))));
    else if (isInstance(v)) copyInto(dst[k], v);
    else dst[k] = v === null || typeof v !== 'object' ? v : structuredClone(v);
  }
}
/** an instance of a class (copied in place), not plain data */
const isInstance = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v) && !(v instanceof Map) && Object.getPrototypeOf(v) !== Object.prototype;

/** a bout exactly as `src` is now, that can be run on without touching it */
export function cloneBout(src: Bout): Bout {
  const b = new Bout(src.opts);
  copyInto(b, src);
  return b;
}

interface Snap { n: number; t: number; bout: Bout }
interface Given { n: number; i: [Intent, Intent] }

export class Recorder {
  private snaps: Snap[] = [];
  private log: Given[] = [];
  constructor(readonly live: Bout, readonly every = 0.25, readonly keep = 5) { this.reset(); }

  /** everything before now is forgotten (the fencers were put back en garde): a replay starts here at the earliest */
  reset() { this.snaps = [{ n: this.live.n, t: this.live.t, bout: cloneBout(this.live) }]; this.log = []; }

  /** the intents about to be given (call just before the live bout runs on) */
  give(i0: Intent, i1: Intent) { this.log.push({ n: this.live.n, i: [structuredClone(i0), structuredClone(i1)] }); }

  /** (call after the live bout ran on) a snapshot if one is due; the oldest forgotten */
  after() {
    const last = this.snaps[this.snaps.length - 1];
    if (this.live.t - last.t >= this.every) this.snaps.push({ n: this.live.n, t: this.live.t, bout: cloneBout(this.live) });
    const span = this.keep / this.every;
    while (this.snaps.length > span) this.snaps.shift();
    const first = this.snaps[0].n;
    let cut = 0;
    while (cut < this.log.length && this.log[cut].n < first) cut++;
    if (cut) this.log.splice(0, cut);
  }

  /** a replay from (about) `from` to `to`, sim seconds */
  replay(from: number, to: number): Replay {
    let s = this.snaps[0];
    for (const q of this.snaps) if (q.t <= from) s = q;
    return new Replay(cloneBout(s.bout), this.log, to);
  }
  get earliest() { return this.snaps[0].t; }
}

export class Replay {
  private k = 0;
  /** what happened in it, so far */
  events: BoutEvent[] = [];
  constructor(readonly bout: Bout, private log: Given[], readonly to: number) {
    // (the snapshot holds the intents in force when it was taken; what was given before it is done with)
    while (this.k < log.length && log[this.k].n < bout.n) this.k++;
  }
  // (within the same hair of the end that run() stops short at: the bout's clock is a sum of substeps, so it can land a
  // rounding error below the end and never on it)
  get done() { return this.bout.t >= this.to - 1e-9; }
  get t() { return this.bout.t; }
  /** run on by `dt` sim seconds (any amount: substep by substep) */
  run(dt: number) {
    const b = this.bout, end = Math.min(this.to, b.t + dt);
    while (b.t < end - 1e-9) {
      while (this.k < this.log.length && this.log[this.k].n <= b.n) {
        const [i0, i1] = this.log[this.k].i;
        b.fencers[0].intent = structuredClone(i0); b.fencers[1].intent = structuredClone(i1);
        this.k++;
      }
      b.stepOnce();
    }
    this.events.push(...b.drain());
  }
}
