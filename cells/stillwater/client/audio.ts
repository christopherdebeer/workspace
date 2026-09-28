/**
 * Quiet sound, off until asked for: a bed of moving water (filtered brown
 * noise breathing on a slow LFO), a pentatonic note per leaf chosen, a soft
 * chord when the dew is gathered, and a low wooden knock when the hull nudges
 * a pad. Nothing is created until the first tap that turns it on — iOS will
 * not start an AudioContext any other way.
 */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bed: GainNode | null = null;
  on = false;

  private start() {
    if (this.ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    // moving water: brown noise → lowpass, amplitude breathing
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const bed = ctx.createGain();
    bed.gain.value = 0.22;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.08;
    lfo.connect(lfoGain).connect(bed.gain);
    src.connect(lp).connect(bed).connect(master);
    src.start();
    lfo.start();
    this.ctx = ctx;
    this.master = master;
    this.bed = bed;
  }

  toggle(): boolean {
    this.on = !this.on;
    if (this.on) this.start();
    const ctx = this.ctx;
    if (ctx && this.master) {
      ctx.resume().catch(() => {});
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(this.on ? 0.5 : 0.0001, ctx.currentTime, 0.4);
    }
    return this.on;
  }

  suspend(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else if (this.on) this.ctx.resume().catch(() => {});
  }

  private voice(freq: number, when: number, gain: number, decay: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.on) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.1);
  }

  /** A leaf chosen: the n-th note of the pentatonic ladder. */
  note(n: number) {
    this.voice(PENTA[Math.min(n, PENTA.length - 1)], 0, 0.16, 2.6);
    this.voice(PENTA[Math.min(n, PENTA.length - 1)] * 2, 0.01, 0.03, 1.4);
  }

  /** The dew gathered: a slow rising chord. */
  gathered() {
    [0, 2, 4, 7].forEach((k, i) => this.voice(PENTA[k] / 2, i * 0.18, 0.11, 4.5));
  }

  /** Too many drops: a soft falling pair. */
  release() {
    this.voice(PENTA[2], 0, 0.06, 1.2);
    this.voice(PENTA[0], 0.15, 0.06, 1.6);
  }

  /** The hull nudging a pad. */
  knock(strength: number) {
    this.voice(82 + Math.random() * 18, 0, 0.12 * strength, 0.35, 'triangle');
  }

  /** Dew condensing on a leaf. */
  glint() {
    this.voice(PENTA[7 + Math.floor(Math.random() * 3)], 0, 0.015, 0.8);
  }
}
