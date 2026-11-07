/**
 * A session: the hand (or the phone, or a recording) feeding the firmware core on the device's
 * own clock. The IMU is sampled at 100 Hz; the reader task runs every 20 ms on the latest
 * every-other sample (firmware/main/main.c), so timing artefacts of the real device are kept.
 *
 * It also watches what happens, as a study would: passages entered and left, the notices the
 * firmware raises when an intention is refused, tutorial stage times, words shown, reversals.
 * And it keeps a log in the firmware's own telemetry schema (protocol/telemetry.md), so a
 * simulated session can go through tools/replay.py and a device capture can be replayed here.
 */
import { Core, type Frame, type ReaderState, type Setup } from './core';
import { Hand, NATURAL, type Reading, type Realism, type V3 } from './imu';
import { Operator } from './operator';

export const NOTICES = ['nothing beneath', 'too deep', 'already here', 'slow to focus', 'finish pace first',
  'top edge away', 'top edge toward you', 'tutorial complete'];

export interface SimEvent { t: number; kind: 'enter' | 'exit' | 'notice' | 'stage' | 'focus'; detail: string }
export interface Metrics {
  words: number; reversals: number; maxRate: number; minRate: number; pausedSeconds: number;
  stages: Record<string, number>; notices: Record<string, number>; enters: number; exits: number; tutorialDoneAt: number | null;
}
export interface Observation {
  schema_version: 1; type: 'observation'; device_id: string; role: string; firmware_version: string;
  sequence: number; monotonic_us: number; dropped: 0; acceleration_mps2: V3; angular_velocity_rps: V3; magnetic_field_ut: null;
  reader: Record<string, unknown>; button: false; capacitance: []; pressure: []; quality_flags: 3; provenance: string;
}

export interface Options extends Partial<Setup> { realism?: Realism; seed?: number; firmware?: string }

export class Session {
  readonly hand: Hand;
  frame: Frame = { section: '', word: '', after: '', hint: '' };
  state!: ReaderState;
  t = 0;                       // seconds since boot
  events: SimEvent[] = [];
  metrics: Metrics = this.freshMetrics();
  log: Observation[] = [];
  recording = false;
  /** when set, readings come from outside (the phone's IMU, a recording) at each sample time, instead of the hand */
  source: ((t: number) => Reading) | null = null;
  private latest: Reading;
  private sampleAt = 0;
  private tickAt = 0;
  private sequence = 0;
  private stack: string[] = [];
  private lastStage = '';
  private stageSince = 0;
  private lastRate = 1;
  private lastWord = '';
  private lastAfter = '';
  private wasFocused = false;
  private setup: Setup;

  constructor(readonly core: Core, opts: Options = {}) {
    this.hand = new Hand(opts.realism ?? NATURAL, opts.seed ?? 1);
    this.setup = { pace: opts.pace ?? 440, invertRoll: opts.invertRoll ?? false, invertPitch: opts.invertPitch ?? false,
      tutorialDone: opts.tutorialDone ?? false, note: opts.note ?? '', now: 0 };
    this.firmware = opts.firmware ?? 'sim';
    this.latest = this.hand.step(0.01);
    this.reset(this.setup);
  }
  readonly firmware: string;

  private freshMetrics(): Metrics {
    return { words: 0, reversals: 0, maxRate: 1, minRate: 1, pausedSeconds: 0, stages: {}, notices: {}, enters: 0, exits: 0, tutorialDoneAt: null };
  }

  /** Boot the device again: as at power-on, with these settings. */
  reset(setup: Partial<Setup> = {}) {
    this.setup = { ...this.setup, ...setup, now: Math.round(this.t * 1000) };
    this.core.init(this.setup);
    const r = this.core.read();
    this.frame = r.frame; this.state = r.state;
    this.events = []; this.metrics = this.freshMetrics(); this.log = [];
    this.stack = this.state.tutorial ? [] : ['hall'];
    this.lastStage = this.state.stage; this.stageSince = this.t; this.lastRate = 1;
    this.tickAt = this.t;
  }

  restartTutorial() {
    const r = this.core.restartTutorial(Math.round(this.t * 1000));
    this.frame = r.frame; this.state = r.state; this.stack = [];
    this.lastStage = this.state.stage; this.stageSince = this.t;
    this.metrics.tutorialDoneAt = null; this.metrics.stages = {};
  }

  /** Advance by dt seconds of device time. */
  advance(dt: number) {
    const end = this.t + dt;
    while (true) {
      const next = Math.min(this.sampleAt, this.tickAt);
      if (next > end) break;
      this.t = next;
      if (this.sampleAt <= this.tickAt) {
        this.latest = this.source ? this.source(this.t) : this.hand.step(0.01);
        this.sampleAt += 0.01;
      } else {
        this.tick();
        this.tickAt += 0.02;
      }
    }
    this.t = end;
  }

  private tick() {
    const now = Math.round(this.t * 1000);
    const { frame, state } = this.core.tick(now, this.latest.accel, this.latest.gyro, true);
    this.observe(frame, state);
    this.frame = frame; this.state = state;
    this.sequence += 2;
    if (this.recording) this.log.push(this.observation(now));
  }

  private emit(kind: SimEvent['kind'], detail: string) { this.events.push({ t: this.t, kind, detail }); }

  private observe(f: Frame, s: ReaderState) {
    const m = this.metrics;
    if (f.word !== this.lastWord) { m.words++; this.lastWord = f.word; }
    if (s.rate !== 0 && this.lastRate !== 0 && Math.sign(s.rate) !== Math.sign(this.lastRate)) m.reversals++;
    if (s.rate !== 0) this.lastRate = s.rate; else m.pausedSeconds += 0.02;
    m.maxRate = Math.max(m.maxRate, s.rate); m.minRate = Math.min(m.minRate, s.rate);
    if (s.stage !== this.lastStage) {
      m.stages[this.lastStage] = (m.stages[this.lastStage] ?? 0) + (this.t - this.stageSince);
      this.emit('stage', `${this.lastStage} → ${s.stage}`);
      if (s.stage === 'done') { m.tutorialDoneAt = this.t; this.stack = ['hall']; }
      this.lastStage = s.stage; this.stageSince = this.t;
    }
    if (f.after !== this.lastAfter && NOTICES.includes(f.after)) {
      m.notices[f.after] = (m.notices[f.after] ?? 0) + 1;
      this.emit('notice', f.after);
    }
    this.lastAfter = f.after;
    if (s.focused && !this.wasFocused && !s.tutorial) this.emit('focus', f.word);
    this.wasFocused = s.focused;
    if (!s.tutorial && f.section && f.section !== this.stack[this.stack.length - 1]) {
      if (this.stack.length > 1 && f.section === this.stack[this.stack.length - 2]) { this.stack.pop(); m.exits++; this.emit('exit', f.section); }
      else { this.stack.push(f.section); m.enters++; this.emit('enter', f.section); }
    }
  }

  get depth(): string[] { return [...this.stack]; }
  get reading(): Reading { return this.latest; }

  private observation(now: number): Observation {
    const s = this.state;
    return {
      schema_version: 1, type: 'observation', device_id: 'sim000', role: 'sim-01', firmware_version: this.firmware,
      sequence: this.sequence, monotonic_us: now * 1000, dropped: 0,
      acceleration_mps2: this.latest.accel.map((v) => +v.toFixed(6)) as V3,
      angular_velocity_rps: this.latest.gyro.map((v) => +v.toFixed(6)) as V3, magnetic_field_ut: null,
      reader: { ready: s.ready, roll_rad: +s.roll.toFixed(4), pitch_rad: +s.pitch.toFixed(4), rate: +s.rate.toFixed(3),
        roll_active: s.rollActive, roll_armed: s.rollArmed, tilt_latched: s.latched, focused: s.focused,
        tutorial_active: s.tutorial, tutorial_complete: s.tutorialDone, tutorial_stage: s.stage },
      button: false, capacitance: [], pressure: [], quality_flags: 3, provenance: 'lab-sim',
    };
  }
}

export interface RunOptions extends Options { seconds: number; idle?: boolean }

/** A headless session: the scripted operator (or an idle hand) for `seconds`. */
export async function run(bytes: Uint8Array, opts: RunOptions) {
  const core = await Core.load(bytes);
  const s = new Session(core, opts);
  const op = new Operator();
  for (let k = 0; k < opts.seconds * 50; k++) {
    if (!opts.idle) { const i = op.next(s.t, s.frame, s.state); s.hand.targetRoll = i.roll; s.hand.targetPitch = i.pitch; }
    s.advance(0.02);
  }
  const m = s.metrics;
  return {
    tutorialDoneAt: m.tutorialDoneAt, lastStage: s.state.stage, stages: m.stages, words: m.words, notices: m.notices,
    entered: s.events.filter((e) => e.kind === 'enter').map((e) => e.detail), exits: m.exits, finalRate: s.state.rate,
    events: s.events,
  };
}
