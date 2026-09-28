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
  private wind: GainNode | null = null;
  private noise: AudioBuffer | null = null;
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
    // wind: the same noise, bright and band-passed, silent until a gust
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const wind = ctx.createGain();
    wind.gain.value = 0;
    const src2 = ctx.createBufferSource();
    src2.buffer = buf;
    src2.loop = true;
    src2.playbackRate.value = 2.3;
    src2.connect(bp).connect(wind).connect(master);
    src2.start();
    this.ctx = ctx;
    this.master = master;
    this.bed = bed;
    this.wind = wind;
    this.noise = buf;
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

  /** A gust over the water, 0..1. */
  breeze(level: number) {
    if (!this.ctx || !this.wind) return;
    this.wind.gain.setTargetAtTime(level * 0.9, this.ctx.currentTime, level > this.wind.gain.value ? 0.08 : 0.5);
  }

  /** An oar blade going in: a soft, low plunk of filtered noise. */
  dip(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.on || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.2;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380 + Math.random() * 120;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * strength, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.35);
  }

  /** A drop falling back in: a tiny, bright tick. */
  drip(strength: number) {
    this.voice(1300 + Math.random() * 900, 0, 0.012 * strength, 0.09);
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
