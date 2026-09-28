/**
 * The river's sound, synthesised — nothing is sampled.
 *
 * Water sounds wet because of BUBBLES: every drip, plop, splash, trickle and
 * burble is dozens of tiny air bubbles ringing as they form. A bubble rings
 * at a pitch set by its size (Minnaert: ~3.3 kHz·mm / radius) and the pitch
 * RISES as it decays near the surface — the "plink". So the water here is a
 * bubble synthesiser running on the audio thread (an AudioWorklet), after
 * van den Doel's physically based liquid sounds:
 *
 *   river bed   a sparse, steady scatter of small bubbles + soft low lapping
 *   motion      rowing and the wake raise the bubble rate; the drive burbles
 *   drip        one small bubble (high, fast)
 *   plop        one large bubble + a short splash (a tap on the water)
 *   dip         the oar catch: a splash burst and a cluster of mid bubbles
 *   gurgle      the release: a few low bubbles, staggered
 *   knock       the hull on a leaf: three damped wooden modes and a click
 *   wind        breathy band noise with fast leaf-rustle flutter
 *
 * Every event is panned by where it happened on screen, and a short, dark
 * synthetic reverb gives the air around the river. If AudioWorklet isn't
 * there, the simpler node-based sounds are used instead.
 *
 * Nothing starts until the first tap that turns sound on — iOS will not start
 * an AudioContext any other way.
 */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

/** The worklet, as source: loaded from a Blob URL (no extra file to serve). */
const WATER_WORKLET = `
class Water extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sr = sampleRate;
    this.parts = [];      // ringing partials: bubbles and wood modes
    this.bursts = [];     // noise bursts: splashes, clicks
    this.rate = 8;        // ambient bubbles per second
    this.lap = 0.5;       // lapping level
    this.wind = 0;
    this.seed = 1234567;
    this.lp1 = 0; this.lp2 = 0;   // lapping filter state
    this.lapEnv = 0; this.lapTarget = 0; this.lapNext = 0;
    this.wl = 0; this.wb = 0; this.wh = 0; this.flutter = 0;
    this.t = 0;
    this.port.onmessage = (e) => this.msg(e.data);
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  bubble(f, amp, dur, rise, pan, delay) {
    if (this.parts.length > 160) return;
    const n = Math.max(1, Math.floor(dur * this.sr));
    this.parts.push({ ph: 0, w: 2 * Math.PI * f / this.sr, a: amp, dec: Math.pow(0.001, 1 / n), grow: Math.pow(rise, 1 / n), pan, wait: Math.floor((delay || 0) * this.sr), att: 0 });
  }
  /** Filtered noise; \`attack\` seconds of swell (0 = a crack — a snare, if it's bright). */
  burst(amp, dur, bright, pan, delay, attack) {
    const n = Math.max(1, Math.floor(dur * this.sr));
    const atk = attack ? 1 / Math.max(1, attack * this.sr) : 1;
    this.bursts.push({ a: amp, dec: Math.pow(0.001, 1 / n), bright, pan, wait: Math.floor((delay || 0) * this.sr), s1: 0, s2: 0, e: atk >= 1 ? 1 : 0, atk });
  }
  /** A rising cavity 'bloop': the air a blade drags under, collapsing. */
  plunge(f0, f1, amp, dur, pan, delay) {
    const n = Math.max(1, Math.floor(dur * this.sr));
    this.parts.push({ ph: 0, w: 2 * Math.PI * f0 / this.sr, a: amp, dec: Math.pow(0.001, 1 / n), grow: Math.pow(f1 / f0, 1 / n), pan, wait: Math.floor((delay || 0) * this.sr), att: 0, attRate: 1 / (0.012 * this.sr) });
  }
  /** A bubble of radius r millimetres (Minnaert pitch, rising as it decays). */
  bub(rmm, amp, pan, delay) {
    const f = 3300 / rmm * (0.9 + this.rnd() * 0.2);
    const dur = Math.min(0.25, 0.012 * rmm + 0.006);
    this.bubble(f, amp, dur, 1 + 0.1 + this.rnd() * 0.25, pan, delay);
  }
  msg(m) {
    const p = m.pan || 0;
    if (m.type === 'params') { this.rate = m.rate; this.lap = m.lap; this.wind = m.wind; return; }
    if (m.type === 'drip') { this.bub(1.1 + this.rnd() * 1.2, 0.09 * (m.s || 1), p); return; }
    if (m.type === 'plop') {
      const s = m.s || 1;
      this.bub(4 + this.rnd() * 3, 0.28 * s, p);
      this.burst(0.05 * s, 0.08, 0.3, p, 0, 0.006);
      for (let i = 0; i < 4; i++) this.bub(1.2 + this.rnd() * 2, 0.05 * s, p + (this.rnd() - 0.5) * 0.2, 0.03 + this.rnd() * 0.12);
      return;
    }
    if (m.type === 'dip') {
      // an oar going in is not a crack of noise (that's a snare) but: a low rising
      // bloop of dragged-under air, a dark swell of displaced water, spray as many
      // separate droplets thinning out, and bubbles rising after
      const s = m.s || 1;
      this.plunge(130 + this.rnd() * 40, 300 + this.rnd() * 80, 0.3 * s, 0.11, p, 0.005);
      this.burst(0.2 * s, 0.32, 0.08, p, 0, 0.035);
      for (let i = 0; i < 26; i++) {
        const t = Math.pow(this.rnd(), 1.8) * 0.28;
        this.bub(0.5 + this.rnd() * 1.1, (0.025 + this.rnd() * 0.03) * s * (1 - t * 2.5), p + (this.rnd() - 0.5) * 0.35, 0.01 + t);
      }
      for (let i = 0; i < 8; i++) this.bub(2 + this.rnd() * 5, 0.07 * s, p + (this.rnd() - 0.5) * 0.25, 0.04 + this.rnd() * 0.3);
      return;
    }
    if (m.type === 'gurgle') {
      const s = m.s || 1;
      for (let i = 0; i < 6; i++) this.bub(3 + this.rnd() * 6, 0.07 * s, p + (this.rnd() - 0.5) * 0.2, this.rnd() * 0.35);
      return;
    }
    if (m.type === 'knock') {
      const s = m.s || 1;
      const base = 170 + this.rnd() * 30;
      this.bubble(base, 0.22 * s, 0.22, 1.0, p);
      this.bubble(base * 2.62, 0.1 * s, 0.1, 1.0, p);
      this.bubble(base * 4.9, 0.05 * s, 0.05, 1.0, p);
      this.burst(0.05 * s, 0.015, 0.9, p);
      for (let i = 0; i < 3; i++) this.bub(2 + this.rnd() * 3, 0.04 * s, p, 0.02 + this.rnd() * 0.1);
      return;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const sr = this.sr;
    const pRate = this.rate / sr;
    for (let i = 0; i < L.length; i++) {
      // ambient bubbles: mostly small and high, now and then a lower one
      if (this.rnd() < pRate) {
        const r = this.rnd() < 0.85 ? 0.8 + this.rnd() * 2 : 2.5 + this.rnd() * 4;
        this.bub(r, 0.03 + this.rnd() * 0.05, (this.rnd() - 0.5) * 1.4);
      }
      // lapping: low noise swelling in slow, irregular laps against the hull
      if (this.t >= this.lapNext) { this.lapTarget = 0.4 + this.rnd() * 0.6; this.lapNext = this.t + (0.6 + this.rnd() * 1.6) * sr; }
      this.lapEnv += (this.lapTarget - this.lapEnv) * 0.00008;
      this.lapTarget *= 0.99996;
      const nz = this.rnd() * 2 - 1;
      this.lp1 += (nz - this.lp1) * 0.025;
      this.lp2 += (this.lp1 - this.lp2) * 0.025;
      let l = this.lp2 * this.lapEnv * this.lap * 1.4;
      let r = l;
      // wind: breath (band noise) with leaf-rustle flutter
      if (this.wind > 0.001) {
        const wn = this.rnd() * 2 - 1;
        this.wl += (wn - this.wl) * 0.08;
        this.wb += (this.wl - this.wb) * 0.3;
        this.wh = wn - this.wl;
        if ((this.t & 255) === 0) this.flutter = this.rnd();
        const rustle = this.wh * (0.3 + this.flutter * 0.7) * 0.25;
        const breath = (this.wl - this.wb) * 1.6;
        l += (breath + rustle) * this.wind * 0.25;
        r += (breath * 0.9 - rustle) * this.wind * 0.25;
      }
      // partials
      for (let k = this.parts.length - 1; k >= 0; k--) {
        const b = this.parts[k];
        if (b.wait > 0) { b.wait--; continue; }
        b.att = b.att < 1 ? b.att + (b.attRate || 0.02) : 1;
        const v = Math.sin(b.ph) * b.a * b.att;
        b.ph += b.w;
        b.w *= b.grow;
        b.a *= b.dec;
        l += v * (1 - b.pan) * 0.5;
        r += v * (1 + b.pan) * 0.5;
        if (b.a < 0.00005) this.parts.splice(k, 1);
      }
      // bursts: filtered noise, bright ones hissier
      for (let k = this.bursts.length - 1; k >= 0; k--) {
        const s = this.bursts[k];
        if (s.wait > 0) { s.wait--; continue; }
        const n = this.rnd() * 2 - 1;
        s.s1 += (n - s.s1) * (0.08 + s.bright * 0.6);
        s.s2 += (s.s1 - s.s2) * 0.05;
        if (s.e < 1) s.e = Math.min(1, s.e + s.atk);
        const v = (s.s1 - s.s2 * (1 - s.bright)) * s.a * s.e;
        if (s.e >= 1) s.a *= s.dec;
        l += v * (1 - s.pan) * 0.5;
        r += v * (1 + s.pan) * 0.5;
        if (s.a < 0.00005) this.bursts.splice(k, 1);
      }
      L[i] = l;
      R[i] = r;
      this.t++;
    }
    return true;
  }
}
registerProcessor('stillwater-water', Water);
`;

/** A short, dark stereo room: decaying noise, low-passed as it tails. */
function reverbImpulse(ctx: AudioContext, seconds = 1.6): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const n = Math.random() * 2 - 1;
      lp += (n - lp) * (0.5 - t * 0.42);
      d[i] = lp * Math.pow(1 - t, 3) * (i < 60 ? i / 60 : 1);
    }
  }
  return buf;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private water: AudioWorkletNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private starting = false;
  on = false;

  private async start() {
    if (this.ctx || this.starting) return;
    this.starting = true;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    // the air around the river
    const verb = ctx.createConvolver();
    verb.buffer = reverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    master.connect(verb).connect(wet).connect(comp);
    this.master = master;
    // noise for the fallback voices
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    try {
      const url = URL.createObjectURL(new Blob([WATER_WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.water = new AudioWorkletNode(ctx, 'stillwater-water', { numberOfInputs: 0, outputChannelCount: [2] });
      this.water.connect(master);
    } catch {
      this.fallbackBed(ctx, master);
    }
    this.fade();
  }

  /** Without a worklet: a filtered-noise bed and wind, as before. */
  private fallbackBed(ctx: AudioContext, master: GainNode) {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    src.connect(lp).connect(g).connect(master);
    src.start();
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noise;
    src2.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    src2.connect(bp).connect(wg).connect(master);
    src2.start();
    this.windGain = wg;
  }

  private fade() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.on ? 0.9 : 0.0001, ctx.currentTime, 0.4);
  }

  toggle(): boolean {
    this.on = !this.on;
    if (this.on && !this.ctx) this.start().catch(() => {});
    else this.fade();
    return this.on;
  }

  suspend(hidden: boolean) {
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend().catch(() => {});
    else if (this.on) this.ctx.resume().catch(() => {});
  }

  private send(m: Record<string, unknown>) {
    if (this.on && this.water) this.water.port.postMessage(m);
  }

  /**
   * The river's state, every frame: how busy the water is (boat speed, rowing
   * effort, wake) and the wind. Sent at most ~10 times a second.
   */
  private lastParams = 0;
  river(speed: number, effort: number, wind: number) {
    const now = performance.now();
    if (now - this.lastParams < 100) return;
    this.lastParams = now;
    const rate = 5 + speed * 0.5 + effort * 10 + wind * 20;
    this.send({ type: 'params', rate, lap: 0.35 + Math.min(1, speed / 30) * 0.5, wind });
    if (!this.water && this.windGain && this.ctx) this.windGain.gain.setTargetAtTime(wind * 0.9, this.ctx.currentTime, 0.2);
  }

  /** Wind level 0..1 (kept for callers; folded into `river`). */
  breeze(level: number) {
    this.windLevel = level;
  }
  windLevel = 0;

  private voice(freq: number, when: number, gain: number, decay: number, type: OscillatorType = 'sine', pan = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.on) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    o.type = type;
    o.frequency.value = freq;
    const t = ctx.currentTime + when;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    if (p) {
      p.pan.value = pan;
      o.connect(g).connect(p).connect(this.master);
    } else o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.1);
  }

  /** A soft bell for a chosen leaf: a sine with a faint inharmonic shimmer. */
  note(n: number, pan = 0) {
    const f = PENTA[Math.min(n, PENTA.length - 1)];
    this.voice(f, 0, 0.1, 2.8, 'sine', pan);
    this.voice(f * 2.76, 0.005, 0.018, 1.2, 'sine', pan);
    this.voice(f * 5.4, 0.01, 0.006, 0.6, 'sine', pan);
  }

  /** Passing exactly through ten on the way to a bigger number: one low, round bell. */
  ten(pan = 0) {
    const f = PENTA[0] / 2;
    this.voice(f, 0, 0.09, 3.6, 'sine', pan);
    this.voice(f * 2, 0.004, 0.03, 2.2, 'sine', pan);
    this.voice(f * 2.76, 0.008, 0.008, 1.1, 'sine', pan);
  }

  /** The dew gathered: a slow rising chord. */
  gathered() {
    [0, 2, 4, 7].forEach((k, i) => {
      this.voice(PENTA[k] / 2, i * 0.18, 0.08, 4.5, 'sine', (i - 1.5) * 0.3);
      this.voice((PENTA[k] / 2) * 2.76, i * 0.18 + 0.01, 0.01, 1.6, 'sine', (i - 1.5) * 0.3);
    });
  }

  /** Too many drops: a soft falling pair. */
  release() {
    this.voice(PENTA[2], 0, 0.05, 1.2);
    this.voice(PENTA[0], 0.15, 0.05, 1.6);
  }

  /** A tap on open water. */
  plop(strength = 1, pan = 0) {
    if (this.water) this.send({ type: 'plop', s: strength, pan });
    else this.fallbackSplash(strength, pan, 700);
  }

  /** An oar blade going in. */
  dip(strength: number, pan = 0) {
    if (this.water) this.send({ type: 'dip', s: strength, pan });
    else this.fallbackSplash(strength, pan, 420);
  }

  /** The blade coming out: a gurgle. */
  gurgle(strength: number, pan = 0) {
    this.send({ type: 'gurgle', s: strength, pan });
  }

  /** A drop falling back in. */
  drip(strength: number, pan = 0) {
    if (this.water) this.send({ type: 'drip', s: strength, pan });
    else this.voice(1300 + Math.random() * 900, 0, 0.012 * strength, 0.09, 'sine', pan);
  }

  /** The hull nudging a pad. */
  knock(strength: number, pan = 0) {
    if (this.water) this.send({ type: 'knock', s: strength, pan });
    else this.voice(82 + Math.random() * 18, 0, 0.12 * strength, 0.35, 'triangle', pan);
  }

  /** Dew condensing on a leaf. */
  glint() {
    this.voice(PENTA[7 + Math.floor(Math.random() * 3)], 0, 0.01, 0.8, 'sine', (Math.random() - 0.5) * 0.8);
  }

  private fallbackSplash(strength: number, pan: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.on || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.3 * strength, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = pan;
      src.connect(bp).connect(g).connect(p).connect(this.master);
    } else src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.35);
  }
}
