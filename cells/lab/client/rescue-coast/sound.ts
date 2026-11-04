/**
 * The sounds, made in the page (WebAudio, nothing to load): an engine that rises with the throttle, the sea's hiss,
 * the start horn and the count, a splash when the line goes over, a rising "pop" for each person aboard, a thud on the
 * rocks, the last-call bell, the radio's chirp when a call comes in, and a tune at the end.
 */
export class Sound {
  ctx: AudioContext | null = null; on = true;
  private engine: { o: OscillatorNode; f: BiquadFilterNode; g: GainNode } | null = null;
  private sea: GainNode | null = null;
  private master: GainNode | null = null;
  /** start (it has to be from a tap) */
  wake() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC()), master = (this.master = ctx.createGain());
    master.gain.value = this.on ? 0.6 : 0; master.connect(ctx.destination);
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 45; f.type = 'lowpass'; f.frequency.value = 220; g.gain.value = 0;
    o.connect(f).connect(g).connect(master); o.start();
    this.engine = { o, f, g };
    // (the sea: soft filtered noise)
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = (this.sea = ctx.createGain());
    n.buffer = buf; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 600; nf.Q.value = 0.4; ng.gain.value = 0.05;
    n.connect(nf).connect(ng).connect(master); n.start();
    // (rain: brighter noise, quiet unless it's raining)
    const r = ctx.createBufferSource(), rf = ctx.createBiquadFilter(), rg = (this.rainGain = ctx.createGain());
    r.buffer = buf; r.loop = true; rf.type = 'highpass'; rf.frequency.value = 3000; rg.gain.value = 0;
    r.connect(rf).connect(rg).connect(master); r.start(0, 0.7);
    this.weather(this.wind, this.rain);
  }
  private wind = 1; private rain = 0; private rainGain: GainNode | null = null;
  /** the weather's sounds: the sea and wind louder as it blows, rain hissing */
  weather(wind: number, rain: number) {
    this.wind = wind; this.rain = rain;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sea?.gain.setTargetAtTime(0.035 + 0.03 * wind, t, 0.5);
    this.rainGain?.gain.setTargetAtTime(0.08 * rain, t, 0.5);
  }
  thunder() { this.noise(2.6, 160, 1.1); this.noise(1.2, 420, 0.4, 0.15); }
  foghorn() { this.tone(98, 2.2, 'sawtooth', 0.09); this.tone(147, 2.2, 'sawtooth', 0.05); }
  toggle() { this.on = !this.on; if (this.master) this.master.gain.value = this.on ? 0.6 : 0; return this.on; }
  /** the engine: how hard it's working (0..1) */
  throttle(k: number) {
    if (!this.ctx || !this.engine) return;
    const t = this.ctx.currentTime;
    this.engine.o.frequency.setTargetAtTime(42 + 50 * k, t, 0.15);
    this.engine.f.frequency.setTargetAtTime(180 + 600 * k, t, 0.15);
    this.engine.g.gain.setTargetAtTime(0.05 + 0.1 * k, t, 0.2);
  }
  quiet() { if (this.ctx && this.engine) this.engine.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }
  private tone(freq: number, len: number, type: OscillatorType = 'sine', gain = 0.25, when = 0, slide = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + len);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + len + 0.05);
  }
  private noise(len: number, freq: number, gain: number, when = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when, buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * len), this.ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = buf; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = gain;
    s.connect(f).connect(g).connect(this.master); s.start(t);
  }
  horn() { this.tone(196, 0.9, 'sawtooth', 0.12); this.tone(247, 0.9, 'sawtooth', 0.08); }
  beep(last = false) { this.tone(last ? 880 : 587, last ? 0.5 : 0.18, 'square', 0.08); }
  splash() { this.noise(0.4, 1800, 0.3); }
  aboard(k: number) { this.tone(520 * Math.pow(1.122, Math.min(k, 14)), 0.16, 'triangle', 0.2); this.tone(1040 * Math.pow(1.122, Math.min(k, 14)), 0.12, 'sine', 0.06, 0.04); }
  bump() { this.noise(0.25, 300, 0.6); this.tone(70, 0.25, 'sine', 0.3); }
  /** the radio: two chirps, a call coming in */
  radio() { this.tone(1250, 0.07, 'square', 0.05); this.tone(1650, 0.09, 'square', 0.05, 0.11); }
  bell() { for (let i = 0; i < 3; i++) { this.tone(1320, 0.9, 'sine', 0.12, i * 0.45); this.tone(1980, 0.6, 'sine', 0.04, i * 0.45); } }
  tune(place: number) {
    const notes = place === 0 ? [523, 659, 784, 1047, 784, 1047] : place < 3 ? [523, 659, 784, 659] : [440, 523, 440];
    notes.forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.16, i * 0.16));
  }
}
