/**
 * The wood's sound, all synthesised: wind in the trees (filtered noise that
 * rises and falls), steps in the grass while walking, and birds — more in the
 * light, a single far call now and then in the mist. Starts on the first touch
 * (browsers need one); the button turns it off.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private nextBird = 4;
  private nextStep = 0;
  on = false;

  arm() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // brown noise, two seconds, looped
    const n = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.noise = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.4;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
    this.on = true;
    this.master.gain.setTargetAtTime(0.6, ctx.currentTime, 1.5);
  }

  toggle(): boolean {
    if (!this.ctx) {
      this.arm();
      return this.on;
    }
    this.on = !this.on;
    this.master!.gain.setTargetAtTime(this.on ? 0.6 : 0, this.ctx.currentTime, 0.4);
    return this.on;
  }

  /** Each frame: the wind's breath, footsteps at walking pace, birds by the light. */
  update(dt: number, t: number, walking: number, sun: number, wind: number) {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const now = ctx.currentTime;
    const breath = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1);
    this.windFilter!.frequency.setTargetAtTime(260 + 700 * breath * wind, now, 0.5);
    this.windGain!.gain.setTargetAtTime(0.18 + 0.4 * breath * wind, now, 0.5);
    // steps: a soft swish in the grass, about two a second at a walk
    if (walking > 0.2) {
      this.nextStep -= dt * walking * 1.9;
      if (this.nextStep <= 0) {
        this.nextStep = 1 + (Math.random() - 0.5) * 0.12;
        this.swish(0.12 * walking);
      }
    } else this.nextStep = 0.3;
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      // the light is full of birds; the mist has one, far off, now and then
      this.nextBird = sun > 0.5 ? 2 + Math.random() * 7 : 9 + Math.random() * 16;
      if (sun > 0.5 || Math.random() < 0.6) this.bird(sun);
    }
  }

  /** Somewhere off in the fog: panned, and the further the more muffled (the fog and the trees take the highs). */
  private out(pan: number, far: number): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.on || !this.noise) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 9000 * Math.pow(0.12, Math.max(0, Math.min(1, far)));
    p.connect(lp).connect(this.master!);
    return p;
  }

  // ─── the wood's small voices: frogs in the wet, crickets in the open at night, cicadas in the heat
  private nextFrog = 3;
  private frogBout = 0;
  private nextCricket = 2;
  private cicada: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode } | null = null;

  /**
   * Each frame, from where you are: night (0 day … 1 night), the nearest wet ground (its pan and
   * distance, or none), how open it is about you, how warm the day (0 … 1).
   */
  creatures(dt: number, env: { night: number; wetPan: number; wetDist: number; open: number; heat: number }) {
    const ctx = this.ctx;
    if (!ctx || !this.on || !this.noise) return;
    // frogs: bouts of croaking from the wet, more at dusk and night, from its way, muffled by distance
    this.nextFrog -= dt;
    if (env.wetDist < 45 && this.nextFrog <= 0) {
      const active = 0.25 + 0.75 * env.night;
      if (this.frogBout > 0) {
        this.frogBout--;
        this.nextFrog = 0.35 + Math.random() * 0.6;
      } else {
        this.frogBout = Math.random() < active ? 2 + Math.floor(Math.random() * 6) : 0;
        this.nextFrog = this.frogBout ? 0.2 : 2 + Math.random() * 6 / active;
      }
      if (this.frogBout) {
        const near = 1 / (1 + env.wetDist / 10);
        this.croak(env.wetPan + (Math.random() - 0.5) * 0.4, 0.22 * near * active, env.wetDist / 60);
      }
    }
    // crickets: at night, in the open: chirps from all about, each a trill of three or four
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      const n = env.night * (0.2 + 0.8 * env.open);
      this.nextCricket = 0.12 + Math.random() * 0.5 / Math.max(n, 0.05);
      if (Math.random() < n) this.chirp(Math.random() * 1.8 - 0.9, 0.02 + 0.03 * Math.random());
    }
    // cicadas: in the heat of a warm day, in the open: a buzz that swells and fades
    const want = env.heat * (1 - env.night) * (0.4 + 0.6 * env.open);
    if (want > 0.05 && !this.cicada) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 5600;
      bp.Q.value = 6;
      const am = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 110;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      am.gain.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      src.connect(bp).connect(am).connect(gain).connect(pan).connect(this.master!);
      src.start();
      lfo.start();
      this.cicada = { src, gain, pan };
    }
    if (this.cicada) {
      const swell = 0.5 + 0.5 * Math.sin(ctx.currentTime * 0.4) * Math.sin(ctx.currentTime * 0.13 + 1);
      this.cicada.gain.gain.setTargetAtTime(want > 0.05 ? 0.12 * want * swell : 0, ctx.currentTime, 0.6);
      this.cicada.pan.pan.setTargetAtTime(Math.sin(ctx.currentTime * 0.05) * 0.6, ctx.currentTime, 2);
    }
  }

  /** A frog's croak: a throaty pulsed rasp, a quarter second. */
  private croak(pan: number, level: number, far: number) {
    const p = this.out(pan, far);
    if (!p) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.01;
    const len = 0.18 + Math.random() * 0.2;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 150 + Math.random() * 90;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.linearRampToValueAtTime(f0 * 0.85, at + len);
    // the throat (a formant) and the rasp (pulses, 25–40 a second)
    const throat = ctx.createBiquadFilter();
    throat.type = 'bandpass';
    throat.frequency.value = 520 + Math.random() * 300;
    throat.Q.value = 3;
    const pulse = ctx.createGain();
    pulse.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 25 + Math.random() * 15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    const bias = ctx.createConstantSource();
    bias.offset.value = 0.5;
    lfo.connect(lfoGain).connect(pulse.gain);
    bias.connect(pulse.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.03);
    g.gain.setValueAtTime(level, at + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    o.connect(throat).connect(pulse).connect(g).connect(p);
    for (const s of [o, lfo, bias]) {
      s.start(at);
      s.stop(at + len + 0.05);
    }
  }

  /** A cricket's chirp: three or four tiny pulses of a high, pure note. */
  private chirp(pan: number, level: number) {
    const p = this.out(pan, 0.15);
    if (!p) return;
    const ctx = this.ctx!;
    const f = 4300 + Math.random() * 600;
    let at = ctx.currentTime + 0.01;
    const n = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0003, at + 0.018);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + 0.03);
      at += 0.034;
    }
  }

  /** A deer's step in the leaves: a short dry rustle. */
  rustle(pan: number, level: number, far: number) {
    const p = this.out(pan, far);
    if (!p) return;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + Math.random() * 1600;
    f.Q.value = 0.7;
    const g = ctx.createGain();
    const now = ctx.currentTime + 0.01;
    const len = 0.08 + Math.random() * 0.12;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0004, now + len);
    src.connect(f).connect(g).connect(p);
    src.start(now, Math.random() * 1.5, len + 0.05);
  }

  /** A forefoot stamped on the ground: a dull thud. */
  stamp(pan: number, level: number, far: number) {
    const p = this.out(pan, far);
    if (!p) return;
    const ctx = this.ctx!;
    let at = ctx.currentTime + 0.01;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(95, at);
      o.frequency.exponentialRampToValueAtTime(48, at + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0005, at + 0.14);
      o.connect(g).connect(p);
      o.start(at);
      o.stop(at + 0.16);
      at += 0.32 + Math.random() * 0.1;
    }
  }

  /** The alarm bark: a hoarse, gruff "bōh", once. */
  bark(pan: number, level: number, far: number) {
    const p = this.out(pan, far);
    if (!p) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.02;
    const len = 0.22 + Math.random() * 0.08;
    const f0 = 210 + Math.random() * 60;
    // the voice: a sawtooth falling, through a throat (a formant), roughened with breath
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 1.15, at);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.8, at + len);
    const throat = ctx.createBiquadFilter();
    throat.type = 'bandpass';
    throat.frequency.value = 850 + Math.random() * 200;
    throat.Q.value = 2.2;
    const breath = ctx.createBufferSource();
    breath.buffer = this.noise;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 1300;
    bf.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.025);
    g.gain.setValueAtTime(level * 0.8, at + len * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0005, at + len);
    o.connect(throat).connect(g);
    breath.connect(bf).connect(g);
    g.connect(p);
    o.start(at);
    o.stop(at + len + 0.02);
    breath.start(at, Math.random() * 1.5, len + 0.02);
  }

  /** A twig snapping under a hoof, somewhere off in the fog: a crack, and a splinter or two after. */
  snap(pan: number, level: number, far = 0) {
    const p = this.out(pan, far);
    if (!p) return;
    const ctx = this.ctx!;
    let at = ctx.currentTime + 0.01;
    const cracks = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cracks; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1800 + Math.random() * 2400;
      hp.Q.value = 1.4;
      const g = ctx.createGain();
      const peak = level * (i === 0 ? 0.9 : 0.35 + Math.random() * 0.3);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.03 + Math.random() * 0.04);
      src.connect(hp).connect(g).connect(p);
      src.start(at, Math.random() * 1.5, 0.1);
      at += 0.02 + Math.random() * 0.07;
    }
  }

  private swish(level: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 900;
    f.Q.value = 0.9;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, now + 0.28);
    src.connect(f).connect(g).connect(this.master!);
    src.start(now, Math.random() * 1.5, 0.35);
  }

  /** A short phrase: a few rising or falling notes (a warbler), or one far, low call (the mist). */
  private bird(sun: number) {
    const ctx = this.ctx!;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    const far = ctx.createGain();
    far.gain.value = sun > 0.5 ? 0.05 + Math.random() * 0.06 : 0.035;
    pan.connect(far).connect(this.master!);
    let at = ctx.currentTime + 0.05;
    const phrase = sun > 0.5 ? 3 + Math.floor(Math.random() * 6) : 2;
    const base = sun > 0.5 ? 2600 + Math.random() * 1800 : 700 + Math.random() * 300;
    for (let i = 0; i < phrase; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const f0 = base * (1 + (Math.random() - 0.5) * 0.3);
      const len = sun > 0.5 ? 0.06 + Math.random() * 0.08 : 0.35;
      o.frequency.setValueAtTime(f0, at);
      o.frequency.exponentialRampToValueAtTime(f0 * (sun > 0.5 ? 0.7 + Math.random() * 0.8 : 0.82), at + len);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(1, at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, at + len);
      o.connect(g).connect(pan);
      o.start(at);
      o.stop(at + len + 0.02);
      at += len + (sun > 0.5 ? 0.03 + Math.random() * 0.06 : 0.45);
    }
  }
}
