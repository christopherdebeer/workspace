/**
 * The Tactile reader, as the device runs it: firmware/main/afterword.c compiled to WebAssembly
 * (devtools/tactile-core.mjs). This wrapper only moves numbers in and strings out; every
 * decision about pace, focus, depth and the tutorial is the firmware's.
 */
export interface Frame { section: string; word: string; after: string; hint: string }
export interface ReaderState {
  roll: number; pitch: number; rate: number; ready: boolean; rollActive: boolean; rollArmed: boolean;
  latched: boolean; focused: boolean; tutorial: boolean; tutorialDone: boolean; stageIndex: number; stage: string; anchor: number;
}
export interface Setup { pace: number; invertRoll: boolean; invertPitch: boolean; tutorialDone: boolean; note: string; now: number }

type Exports = {
  memory: WebAssembly.Memory;
  sim_gravity(): number; sim_gyro(): number; sim_note(): number; sim_frame(): number; sim_state(): number; sim_frame_field(): number;
  sim_init(pace: number, ir: number, ip: number, done: number, now: number): void;
  sim_tick(now: number, live: number): void; sim_restart_tutorial(now: number): void; sim_stage_name(i: number): number;
  aw_set_pace_ms(ms: number): number; aw_pace_ms(): number; aw_set_inversions(r: number, p: number): void;
};

export class Core {
  private constructor(private x: Exports) {}

  static async load(bytes: Uint8Array): Promise<Core> {
    const noop = () => {};
    const { instance } = await WebAssembly.instantiate(new WebAssembly.Module(bytes as BufferSource), { env: { sim_print: noop, sim_assert_failed: noop } }).then((instance) => ({ instance }));
    return new Core(instance.exports as unknown as Exports);
  }

  /** Synchronous: the core is ~15 KB, well under the browsers' main-thread compile limit. */
  static loadSync(bytes: Uint8Array): Core {
    const noop = () => {};
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes as BufferSource), { env: { sim_print: noop, sim_assert_failed: noop } });
    return new Core(instance.exports as unknown as Exports);
  }

  private text(ptr: number, max = 96): string {
    const b = new Uint8Array(this.x.memory.buffer, ptr, max);
    const end = b.indexOf(0);
    return new TextDecoder().decode(b.subarray(0, end < 0 ? max : end));
  }

  init(s: Setup): void {
    const note = new TextEncoder().encode(s.note.slice(0, 95));
    const at = new Uint8Array(this.x.memory.buffer, this.x.sim_note(), 96);
    at.fill(0); at.set(note);
    this.x.sim_init(s.pace, +s.invertRoll, +s.invertPitch, +s.tutorialDone, s.now >>> 0);
  }

  /** One reader-task cycle: gravity in m/s², angular velocity in rad/s, device axes (x right, y up the screen, z out of it). */
  tick(now: number, gravity: ArrayLike<number>, gyro: ArrayLike<number>, live: boolean): { frame: Frame; state: ReaderState } {
    new Float32Array(this.x.memory.buffer, this.x.sim_gravity(), 3).set(gravity);
    new Float32Array(this.x.memory.buffer, this.x.sim_gyro(), 3).set(gyro);
    this.x.sim_tick(now >>> 0, +live);
    return this.read();
  }

  restartTutorial(now: number) { this.x.sim_restart_tutorial(now >>> 0); return this.read(); }
  setPace(ms: number): boolean { return !!this.x.aw_set_pace_ms(ms); }
  pace(): number { return this.x.aw_pace_ms(); }
  setInversions(roll: boolean, pitch: boolean) { this.x.aw_set_inversions(+roll, +pitch); }

  read(): { frame: Frame; state: ReaderState } {
    const f = this.x.sim_frame(), n = this.x.sim_frame_field();
    const s = new Float32Array(this.x.memory.buffer, this.x.sim_state(), 12);
    return {
      frame: { section: this.text(f, n), word: this.text(f + 2 * n, n), after: this.text(f + 3 * n, n), hint: this.text(f + 4 * n, n) },
      state: {
        roll: s[0], pitch: s[1], rate: s[2], ready: !!s[3], rollActive: !!s[4], rollArmed: !!s[5], latched: !!s[6],
        focused: !!s[7], tutorial: !!s[8], tutorialDone: !!s[9], stageIndex: s[10], stage: this.text(this.x.sim_stage_name(s[10]), 16), anchor: s[11],
      },
    };
  }
}
