/**
 * The rescue race's sounds, all made here (WebAudio, nothing loaded): a ship's horn at the start, the count of three,
 * a little rising hop for each person landing on your deck (higher for each one more), a bump, the last call's bell, a
 * cheer, a tune for your place at the end; under it all your engine, by how fast you're going, and the sea.
 */
export class Sound {
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null; private engineGain: GainNode | null = null;
  private seaGain: GainNode | null = null;
  on = true;

  /** the first touch: sound can only start from a person's hand */
  arm() {
    if (this.ac) { void this.ac.resume(); return; }
    try { this.ac = new AudioContext(); } catch { return; }
    const ac = this.ac;
    this.out = ac.createGain(); this.out.gain.value = this.on ? 0.8 : 0; this.out.connect(ac.destination);
    // (the engine: a low buzz through a soft filter, louder and higher the faster you go)
    this.engineOsc = ac.createOscillator(); this.engineOsc.type = 'sawtooth'; this.engineOsc.frequency.value = 48;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    this.engineGain = ac.createGain(); this.engineGain.gain.value = 0;
    this.engineOsc.connect(lp); lp.connect(this.engineGain); this.engineGain.connect(this.out);
    this.engineOsc.start();
    // (the sea: noise, filtered low, swelling slowly)
    const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 520;
    this.seaGain = ac.createGain(); this.seaGain.gain.value = 0.05;
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 0.03;
    lfo.connect(lg); lg.connect(this.seaGain.gain); lfo.start();
    src.connect(sf); sf.connect(this.seaGain); this.seaGain.connect(this.out); src.start();
  }
  toggle(on = !this.on) {
    this.on = on;
    if (this.out && this.ac) this.out.gain.setTargetAtTime(on ? 0.8 : 0, this.ac.currentTime, 0.05);
  }
  /** the engine, by your speed (0..1) */
  engine(speed: number) {
    if (!this.ac || !this.engineOsc || !this.engineGain) return;
    const t = this.ac.currentTime;
    this.engineOsc.frequency.setTargetAtTime(44 + speed * 38, t, 0.15);
    this.engineGain.gain.setTargetAtTime(0.018 + speed * 0.05, t, 0.2);
  }

  private tone(freq: number, dur: number, opt: { type?: OscillatorType; vol?: number; to?: number; at?: number; attack?: number } = {}) {
    if (!this.ac || !this.out || !this.on) return;
    const ac = this.ac, t = ac.currentTime + (opt.at ?? 0), o = ac.createOscillator(), g = ac.createGain();
    o.type = opt.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + dur);
    const v = opt.vol ?? 0.2, a = opt.attack ?? 0.008;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, freq: number, vol: number, at = 0) {
    if (!this.ac || !this.out || !this.on) return;
    const ac = this.ac, t = ac.currentTime + at, buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8; g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t);
  }

  /** a ship's horn: two low notes together, held */
  horn(long = 1.1) {
    for (const [f, v] of [[110, 0.14], [138.6, 0.1], [220, 0.04]] as const) this.tone(f, long, { type: 'sawtooth', vol: v, attack: 0.06 });
  }
  count(n: number) { this.tone(n === 0 ? 880 : 523, n === 0 ? 0.5 : 0.22, { type: 'triangle', vol: 0.22 }); }
  /** someone landing aboard: a hop, higher the more you've got */
  hop(k: number, mine: boolean) {
    const f = 420 * Math.pow(2, Math.min(k, 30) / 18);
    this.tone(f, 0.16, { type: 'triangle', vol: mine ? 0.2 : 0.05, to: f * 1.6 });
    if (mine) this.tone(f * 2, 0.12, { type: 'sine', vol: 0.06, at: 0.05 });
  }
  /** a jump (a little whoosh up) */
  jump(mine: boolean) { if (mine) this.tone(300, 0.22, { type: 'sine', vol: 0.06, to: 700 }); }
  splash(vol = 0.18) { this.noise(0.35, 900, vol); }
  bump(hard: number) { this.tone(90, 0.25, { type: 'sine', vol: 0.25 * hard + 0.08, to: 50 }); this.noise(0.2, 400, 0.12 * hard); }
  /** the last call: a ship's bell, twice */
  bell() { for (const at of [0, 0.45]) { this.tone(1046, 1.4, { type: 'sine', vol: 0.12, at }); this.tone(2617, 0.8, { type: 'sine', vol: 0.04, at }); } }
  /** a cheer: a quick run up */
  cheer() { [523, 659, 784, 1046].forEach((f, k) => this.tone(f, 0.2, { type: 'triangle', vol: 0.12, at: k * 0.08 })); }
  /** the tune at the end, by your place: a fanfare for the first, gentler further down */
  fanfare(place: number) {
    const tunes: number[][] = [[523, 659, 784, 1046, 784, 1046], [523, 659, 784, 988], [523, 659, 784], [440, 523, 659], [392, 440, 523]];
    tunes[Math.min(4, place)].forEach((f, k, a) => this.tone(f, k === a.length - 1 ? 0.7 : 0.18, { type: 'triangle', vol: 0.16, at: k * 0.16 }));
  }
}
