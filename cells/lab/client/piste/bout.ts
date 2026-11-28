/**
 * A bout: two fencers on a piste, the box between them, and the referee's few words. It owns time: `advance(dt)`
 * runs as many fixed substeps as dt holds (the blades need them small: 1/2000 s), and each substep is
 *
 *   bodies (footwork, pose, where each hand is sent) → blades predict → blades' own constraints →
 *   contacts (blade/blade, blade/bell, blade/body with the tip's force, floor) → velocities → the box.
 *
 * Fencer 0 is "you" only to the code that draws and listens; to the bout they're the same.
 */
import { Fencer, BODY } from './fencer';
import { Ceremony } from './ceremony';
import { Box, award, type Light } from './box';
import { BladePair, bodyContact, floorContact, guardContact, type ContactStats, type Surface, type TipContact } from './contact';
import { bareBody, nearSurface, type Body } from './look/body';
import type { Weapon } from './weapons';
import type { V } from './v3';

export const H = 1 / 2000;
/** the piste: 14 m, en garde lines 2 m either side of the middle */
export const PISTE = { half: 7, garde: 2, width: 1.5 };

/** warmup: before a bout with a player, free, nothing scoring, until they ask to begin; prelude: the salute; ready: on guard, waiting for allez; fence; halt: the referee's stopped it;
 * interlude: back to the lines between touches; over */
export type Phase = 'warmup' | 'prelude' | 'ready' | 'fence' | 'halt' | 'interlude' | 'over';
export type BoutEvent =
  | { type: 'clash'; t: number; at: V; strength: number; where: [number, number] }
  | { type: 'reset'; t: number }
  | { type: 'guard'; t: number; who: 0 | 1; strength: number }
  | { type: 'light'; t: number; who: 0 | 1; light: Light }
  | { type: 'halt'; t: number; call: string; points: [number, number] }
  | { type: 'allez'; t: number }
  | { type: 'over'; t: number; winner: 0 | 1 }
  | { type: 'time'; t: number }
  | { type: 'priority'; t: number; who: 0 | 1 };

export interface Options {
  weapon: Weapon; to: number;
  /** where a tip touches: the contact capsules (as the bout's lessons and opponent are tuned to), or the undressed body's
   * own surface and the kit's thickness over it (look/body.ts; `touch=body`: on trial) */
  touch?: 'capsules' | 'body';
  /** a referee (allez, halt, the score, en garde). Without one (a lesson), whoever runs the bout places the fencers and
   * reads the box, and the bout is always fencing. */
  referee?: boolean;
  /** the bout's time, s (three minutes); then, level, a priority minute */
  time?: number;
  /** for drawing priority, if it comes to that */
  seed?: number;
  /** before the bout, between touches and after it, what fencers do (ceremony.ts) instead of being put on their lines */
  ceremony?: boolean;
  /** (with a ceremony) a warm-up first, free and scoring nothing, until `begin()` */
  warmup?: boolean;
}

export class Bout {
  readonly fencers: [Fencer, Fencer];
  readonly box: Box;
  readonly pair: BladePair;
  t = 0;
  phase: Phase = 'ready';
  phaseAt = 0;
  score: [number, number] = [0, 0];
  call = '';
  /** what happened since the last `drain` */
  events: BoutEvent[] = [];
  /** this substep's contacts, for the readout */
  readonly tips: [TipContact, TipContact] = [{ part: null, axial: 0, force: 0 }, { part: null, axial: 0, force: 0 }];
  readonly clash: ContactStats = { clash: 0, at: [0, 0, 0], touching: false, where: [0, 0] };
  /** substeps run since the bout began (a replay is keyed to these) */
  n = 0;
  /** when the blades were last touching, s */
  lastTouch = -9;
  /** fencing time left, s (it runs only while they're fencing) */
  clock: number;
  /** the priority minute: who has priority (they win if it runs out level) */
  priority: 0 | 1 | null = null;
  private timeUp = false;
  /** the hardest each tip pressed since the fencers were placed or `resetPeak`, N (a press too brief or too light to
   * register still shows) */
  peak: [number, number] = [0, 0];
  private acc = 0;
  /** when each bell was last touched by the other blade */
  private bellAt: [number, number] = [-9, -9];
  private lastClash = -1;
  /** the ceremony outside the fencing, if the bout has one */
  readonly ceremony: Ceremony;

  constructor(readonly opts: Options) {
    this.fencers = [new Fencer(opts.weapon, -PISTE.garde, 1), new Fencer(opts.weapon, PISTE.garde, -1)];
    this.box = new Box(opts.weapon);
    this.pair = new BladePair(this.fencers[0].blade, this.fencers[1].blade);
    if (opts.referee === false) this.phase = 'fence';
    this.clock = opts.time ?? 180;
    this.ceremony = new Ceremony(opts.seed ?? 1);
    this.opening();
  }

  /** run on by dt (real seconds); returns how many substeps ran */
  advance(dt: number): number {
    this.acc += Math.min(dt, 0.05);
    let n = 0;
    while (this.acc >= H) { this.stepOnce(); this.acc -= H; n++; }
    return n;
  }

  /** fencer `i`'s surface for a tip at `tip`, if it's within a few centimetres (else null: the capsules do) */
  private surfaceOf(i: 0 | 1, tip: V): Surface | null {
    const f = this.fencers[i];
    let near = false;
    for (const c of f.capsules) {
      const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], ap = [tip[0] - c.a[0], tip[1] - c.a[1], tip[2] - c.a[2]];
      const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / Math.max(1e-12, ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
      const d = Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) - Math.max(c.ra, c.rb);
      if (d < 0.06) { near = true; break; }
    }
    if (!near) return null;
    // (built afresh for this substep, from the pose now: only while a tip is this near, which is a touch's few dozen
    // substeps; nothing kept, so a replay's copy of the bout meets exactly the same body)
    const body: Body = bareBody(f);
    return (p) => {
      const q = nearSurface(body, p), pt = q.part;
      // (what's there, and how far off the body the kit lies over it: the mask stands off the head, the glove and the
      // shoe are close, the jacket and the breeches a centimetre or so)
      const part = !pt ? null : pt.name.startsWith('hand') ? 'hand' : pt.name.startsWith('foot') ? 'foot' : pt.region === 'head' ? 'head' : pt.region === 'leg' ? 'leg' : pt.region === 'torso' ? 'torso' : 'arm';
      // (the mask's cage stands well off the face; the glove's gauntlet over the forearm; the jacket and the plastron under
      // it over the trunk; the breeches; the shoe's upper)
      const lie = part === 'head' ? 0.045 : part === 'hand' ? 0.012 : part === 'foot' ? 0.015 : part === 'torso' ? 0.012 : part === 'leg' ? 0.01 : pt && pt.name.startsWith('forearm') ? 0.02 : 0.01;
      return { d: q.d, normal: q.normal, part, lie };
    };
  }

  drain(): BoutEvent[] { const e = this.events; this.events = []; return e; }
  /** forget the tips' peak force (whoever reads it) */
  resetPeak() { this.peak = [0, 0]; }

  /** one substep (a replay steps these one at a time) */
  stepOnce() {
    const h = H, [A, B] = this.fencers;
    this.t += h;
    this.n++;
    this.referee();
    const moving = this.phase === 'fence' || this.phase === 'halt' || this.phase === 'warmup';
    for (const f of this.fencers) {
      // (before "allez", nobody moves their feet)
      if (!moving) { f.intent.step = null; f.intent.lunge = false; }
      f.step(h);
    }
    this.keepApart();
    for (const f of this.fencers) f.blade.predict(h);
    for (const f of this.fencers) f.blade.solve(h);
    this.pair.solve(this.clash);
    const g0 = guardContact(A.blade, B.blade), g1 = guardContact(B.blade, A.blade);
    const onBody = this.opts.touch === 'body';
    bodyContact(A.blade, B.capsules, h, this.tips[0], onBody ? this.surfaceOf(1, A.blade.tip) : null);
    bodyContact(B.blade, A.capsules, h, this.tips[1], onBody ? this.surfaceOf(0, B.blade.tip) : null);
    for (const f of this.fencers) floorContact(f.blade);
    // (once more for the blades' own lengths: the contacts pushed nodes about)
    for (const f of this.fencers) f.blade.solve(h);
    for (const f of this.fencers) f.blade.finish(h);
    this.peak[0] = Math.max(this.peak[0], this.tips[0].axial);
    this.peak[1] = Math.max(this.peak[1], this.tips[1].axial);
    // the box hears the tips
    if (this.phase === 'fence' || (this.phase === 'halt' && !this.box.locked(this.t) && this.box.first !== null)) {
      for (const i of [0, 1] as const) {
        const tc = this.tips[i], had = this.box.lights[i];
        this.box.tip(i, this.t, h, tc.part && tc.axial >= this.opts.weapon.tipForce ? tc.part : null);
        const now = this.box.lights[i];
        if (now && !had) this.events.push({ type: 'light', t: this.t, who: i, light: now });
      }
    }
    if (this.clash.touching) this.lastTouch = this.t;
    if (this.clash.clash > 0.3 && this.t - this.lastClash > 0.03) {
      this.lastClash = this.t;
      this.events.push({ type: 'clash', t: this.t, at: this.clash.at, strength: this.clash.clash, where: [...this.clash.where] as [number, number] });
    }
    // (a blade meeting a bell: once as it begins)
    for (const [who, g] of [[0, g0], [1, g1]] as const) {
      if (g > 0 && this.t - this.bellAt[who] > 0.03) this.events.push({ type: 'guard', t: this.t, who, strength: g });
      if (g > 0) this.bellAt[who] = this.t;
    }
  }

  /** how the bout opens: warming up, or straight into the prelude (or, without a ceremony, en garde) */
  private opening() {
    if (!this.rites) return;
    if (this.opts.warmup) { this.go('warmup'); this.ceremony.begin('warmup'); } else { this.go('prelude'); this.ceremony.begin('prelude'); }
  }
  /** from the warm-up (before the bout, or between touches), begin: you're on guard where you are; they salute on
   * their line (before the first touch) or come on guard; en garde */
  begin() {
    if (this.phase !== 'warmup') return;
    this.go('prelude'); this.ceremony.begin('prelude', 0, { loosen: false, youStay: true, salute: !this.opened });
  }
  /** whether the bout has had its first allez (the salute is before it) */
  private opened = false;
  /** the touch has been seen (a replay of it ended): call it now, without the rest of the halt's pause */
  hurry() { if (this.phase === 'halt' && this.box.locked(this.t)) this.phaseAt = Math.min(this.phaseAt, this.t - 1.4); }

  /** whether there's a ceremony: a referee'd bout that asked for one */
  private get rites() { return !!this.opts.ceremony && this.opts.referee !== false; }
  private get lines(): [number, number] { return [-PISTE.garde, PISTE.garde]; }

  /** the referee: en garde, allez, halt, the point, and the end */
  private referee() {
    if (this.opts.referee === false) return;
    // (the ceremony runs the bodies before the bout, between touches and after; done, they're on guard on their lines)
    if (this.ceremony.rite) { const stay = this.ceremony.stays; if (this.ceremony.update(H, this.fencers, this.lines) && (this.phase === 'prelude' || this.phase === 'interlude')) this.settle(stay); }
    const since = this.t - this.phaseAt;
    if (this.phase === 'ready' && since > 0.9) { this.opened = true; this.go('fence', () => this.events.push({ type: 'allez', t: this.t })); }
    if (this.phase === 'fence') {
      this.clock -= H;
      if (this.clock <= 0 && this.box.first === null) { this.clock = 0; this.timeUp = true; this.call = 'time'; this.events.push({ type: 'time', t: this.t }); this.go('halt'); return; }
      if (this.box.first !== null) this.go('halt');
      // (both feet over the end of the piste behind you: a touch against)
      for (const i of [0, 1] as const) {
        const f = this.fencers[i], rear = f.s + f.facing * f.back;
        if (Math.abs(rear) > PISTE.half && Math.sign(rear) === -f.facing) {
          this.box.register(i === 0 ? 1 : 0, this.t, 'torso');
          this.events.push({ type: 'light', t: this.t, who: i === 0 ? 1 : 0, light: this.box.lights[i === 0 ? 1 : 0]! });
          this.call = 'off the end';
          this.go('halt');
        }
      }
    }
    if (this.phase === 'halt' && since > 1.4 && (this.box.locked(this.t) || (this.timeUp && this.box.first === null))) {
      let { points, call } = award(this.opts.weapon, this.box.lights);
      // (a double at one touch from the end, both level, counts for nobody: they fence for the last touch; nor in the
      // priority minute, where the first touch alone wins)
      const last = this.opts.to - 1;
      if (points[0] && points[1] && ((this.score[0] === last && this.score[1] === last) || this.priority !== null)) { points = [0, 0]; call = 'coup double: annulled'; }
      this.score = [this.score[0] + points[0], this.score[1] + points[1]];
      this.call = this.call || call;
      this.events.push({ type: 'halt', t: this.t, call: this.call, points });
      const [a, b] = this.score, timeUp = this.timeUp;
      this.timeUp = false;
      let winner: 0 | 1 | null = null;
      if (a >= this.opts.to || b >= this.opts.to || (this.priority !== null && a !== b)) winner = a > b ? 0 : 1;
      else if (timeUp && a !== b) winner = a > b ? 0 : 1;
      else if (timeUp && this.priority !== null) winner = this.priority;
      else if (timeUp) {
        // level at time: a minute more, and priority drawn by lot (it wins if the minute runs out level)
        this.priority = ((this.opts.seed ?? 1) * 2654435761 >>> 0) % 2 === 0 ? 0 : 1;
        this.clock = 60;
        this.events.push({ type: 'priority', t: this.t, who: this.priority });
      }
      if (winner !== null) { this.go('over'); this.events.push({ type: 'over', t: this.t, winner }); if (this.rites) this.ceremony.begin('over'); }
      // (a player takes up their guard again themselves, as in the warm-up; a bout nobody's fencing walks both back)
      else if (this.rites && this.opts.warmup) { this.box.reset(); this.call = ''; this.go('warmup'); this.ceremony.begin('between', this.score[0] + this.score[1]); }
      else if (this.rites) { this.go('interlude'); this.ceremony.begin('interlude', this.score[0] + this.score[1]); }
      else this.enGarde();
    }
  }

  /** both back to their lines, the box cleared */
  enGarde() {
    this.fencers[0].reset(-PISTE.garde);
    this.fencers[1].reset(PISTE.garde);
    this.box.reset();
    this.call = '';
    this.peak = [0, 0];
    this.go('ready');
    this.events.push({ type: 'reset', t: this.t });
  }

  /** after the ceremony: on guard where they've walked to (their lines), the box cleared, waiting for allez */
  private settle(youStay = false) {
    const [A, B] = this.fencers;
    // (you, after a warm-up, stay where you took up your guard; they're on their line)
    if (!youStay) A.reset(this.lines[0]);
    B.reset(this.lines[1]);
    this.box.reset();
    this.call = '';
    this.peak = [0, 0];
    this.go('ready');
    this.events.push({ type: 'reset', t: this.t });
  }

  /** (no referee) put the fencers en garde with their fronts `gap` apart, about the middle, the box cleared */
  place(gap: number, mid = 0) {
    const [A, B] = this.fencers, half = BODY.stance / 2;
    A.reset(mid - gap / 2 - half); B.reset(mid + gap / 2 + half);
    this.box.reset();
    this.call = '';
    this.peak = [0, 0];
    this.phase = 'fence'; this.phaseAt = this.t;
    this.events.push({ type: 'reset', t: this.t });
  }
  restart() {
    this.opened = false;
    this.score = [0, 0]; this.clock = this.opts.time ?? 180; this.priority = null; this.timeUp = false; this.enGarde();
    this.opening();
  }

  private go(p: Phase, then?: () => void) { this.phase = p; this.phaseAt = this.t; then?.(); }

  /** bodies don't pass through each other (corps-à-corps): each is held back by half the overlap */
  private keepApart() {
    const [A, B] = this.fencers, gap = B.reachFront - A.reachFront;
    if (gap >= 0) return;
    A.s += gap / 2; B.s -= gap / 2;
    A.pose(); B.pose();
  }

  /** when the blades (or a blade and a bell) last met, s: a fencer feels it at once */
  get lastContact() { return Math.max(this.lastTouch, this.bellAt[0], this.bellAt[1]); }

  /** the distance between the fencers' fronts, m */
  get gap() { return this.fencers[1].reachFront - this.fencers[0].reachFront; }
}
