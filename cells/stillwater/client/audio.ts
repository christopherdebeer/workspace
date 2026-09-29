/** Quiet procedural foley: broadband water displacement, short irregular air
 * pockets and separate leaf/wind texture. Collection voices retain their mix.
 * Environmental sound is dry: open water should not sound like a tiled room.
 */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

/** The worklet, as source: loaded from a Blob URL (no extra file to serve). */
const WATER_WORKLET = `
class Water extends AudioWorkletProcessor {
  constructor() {
    super(); this.sr = sampleRate; this.seed = 918273;
    this.grains = []; this.clock = 0; this.nextLap = 0;
    this.motion = 0; this.motionTo = 0; this.wind = 0; this.windTo = 0;
    this.low = [0,0]; this.mid = [0,0]; this.air = [0,0];
    this.port.onmessage = e => this.msg(e.data);
  }
  rnd() { this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0; return this.seed / 4294967296; }
  grain(amp, dur, cutoff, pan, delay = 0, tone = 0) {
    if (this.grains.length >= 96) return;
    this.grains.push({amp, n:0, len:Math.max(1,dur*this.sr), wait:delay*this.sr,
      k:1-Math.exp(-6.283*cutoff/this.sr), lp:0, slow:0, pan:Math.max(-0.9,Math.min(0.9,pan)),
      ph:0, w:6.283*tone/this.sr});
  }
  msg(m) {
    if (m.type === 'params') { this.motionTo = m.motion; this.windTo = m.wind; return; }
    const s = Math.max(0, Math.min(1.5, m.s ?? 1)), p = m.pan || 0;
    if (m.type === 'dip') {
      // blade catches, loads, then draws a soft turbulent sheet behind it
      this.grain(.24*s,.26,650,p);
      this.grain(.13*s,.65,1300,p,.06);
      for (let i=0;i<12;i++) this.grain((.012+this.rnd()*.022)*s,.025+this.rnd()*.065,
        1100+this.rnd()*2600,p+(this.rnd()-.5)*.2,this.rnd()*.3);
    } else if (m.type === 'gurgle') {
      // water tears away from the blade, then drains in separate droplets
      this.grain(.16*s,.24,1800,p);
      for(let i=0;i<9;i++) this.grain(.022*s,.018+this.rnd()*.045,
        800+this.rnd()*2200,p+(this.rnd()-.5)*.25,.04+this.rnd()*.42,
        i<3 ? 350+this.rnd()*550 : 0);
    } else if (m.type === 'plop') {
      // a fingertip on still water: a soft, rounded push of water, a breath of spray, no pitch
      this.grain(.09*s,.17,520,p);
      this.grain(.035*s,.07,1600,p,.012);
      for (let i=0;i<4;i++) this.grain((.006+this.rnd()*.01)*s,.02+this.rnd()*.03,
        1400+this.rnd()*1800,p+(this.rnd()-.5)*.15,.03+this.rnd()*.14);
    } else if (m.type === 'drip') {
      this.grain(.026*s,.018+this.rnd()*.025,2400,p,0,900+this.rnd()*700);
    } else if (m.type === 'knock') {
      // a wet flexible leaf against a hull, not a drum or a wooden mallet
      this.grain(.075*s,.16,420,p);
      this.grain(.026*s,.09,1400,p,.025);
    }
  }
  process(inputs, outputs) {
    const out=outputs[0], L=out[0], R=out[1] || out[0];
    const smooth=1-Math.exp(-1/(this.sr*.22));
    const lowK=1-Math.exp(-6.283*180/this.sr);
    const midK=1-Math.exp(-6.283*1800/this.sr);
    const airK=1-Math.exp(-6.283*4200/this.sr);
    for(let i=0;i<L.length;i++) {
      this.motion+=(this.motionTo-this.motion)*smooth;
      this.wind+=(this.windTo-this.wind)*smooth;
      if(this.clock>=this.nextLap) {
        this.grain(.025+this.motion*.065,.35+this.rnd()*.65,450+this.rnd()*650,(this.rnd()-.5)*1.2);
        this.nextLap=this.clock+this.sr*(.8+this.rnd()*2.8);
      }
      let l=0,r=0;
      for(let ch=0;ch<2;ch++) {
        const n=this.rnd()*2-1;
        this.low[ch]+=(n-this.low[ch])*lowK;
        this.mid[ch]+=(n-this.mid[ch])*midK;
        this.air[ch]+=(n-this.air[ch])*airK;
        const slow=.65+.2*Math.sin(this.clock/this.sr*.37+ch);
        const v=this.low[ch]*(.045+this.motion*.11)
          +(this.mid[ch]-this.low[ch])*this.motion*.023
          +(this.air[ch]-this.mid[ch])*this.wind*.06*slow;
        if(ch===0) l=v; else r=v;
      }
      for(let j=this.grains.length-1;j>=0;j--) {
        const g=this.grains[j]; if(g.wait>0) {g.wait--;continue;}
        const u=g.n/g.len;
        if(u>=1) {this.grains.splice(j,1);continue;}
        const n=this.rnd()*2-1;
        g.lp+=(n-g.lp)*g.k; g.slow+=(g.lp-g.slow)*lowK;
        // Rounded attack, irregular noise, no rising pitch chirps.
        const env=Math.min(1,u*12)*Math.pow(1-u,2.4);
        g.ph+=g.w;
        const v=(g.lp-g.slow*.4+(g.w ? Math.sin(g.ph)*.15 : 0))*g.amp*env;
        l+=v*Math.sqrt((1-g.pan)*.5); r+=v*Math.sqrt((1+g.pan)*.5);
        g.n++;
      }
      L[i]=l; R[i]=r; this.clock++;
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
  /** Sound names to skip (`?mute=dip,gurgle`): for telling the stroke's sounds apart by ear. */
  muted = new Set<string>();
  /** Which synthesis is live: the worklet, the plain-node fallback, or nothing yet. */
  path(): 'worklet' | 'fallback' | 'off' {
    return !this.ctx || !this.on ? 'off' : this.water ? 'worklet' : 'fallback';
  }
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private water: AudioWorkletNode | null = null;
  private environment: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private windGain: GainNode | null = null;
  private starting = false;
  on = false;

  private async start() {
    if (this.ctx || this.starting) return;
    this.starting = true;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) { this.starting = false; return; }
    const ctx = new AC();
    // Resume inside the original gesture, before awaiting the worklet on iOS.
    ctx.resume().catch(() => {});
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
    const environment = ctx.createGain();
    environment.gain.value = 0.0001;
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = 'highpass'; lowCut.frequency.value = 75; lowCut.Q.value = 0.5;
    environment.connect(lowCut).connect(comp);
    this.environment = environment;
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
      this.water.connect(environment);
    } catch {
      this.fallbackBed(ctx, environment);
    }
    this.starting = false;
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
    g.gain.value = 0.025;
    this.bedGain = g;
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
    src2.start(0, 0.731);
    this.windGain = wg;
  }

  private fade() {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.on ? 0.9 : 0.0001, ctx.currentTime, 0.4);
    this.environment?.gain.setTargetAtTime(this.on ? 0.9 : 0.0001, ctx.currentTime, 0.4);
  }

  /** The first touch turns the sound on (a user gesture is needed to start it at all). */
  arm(): boolean {
    if (!this.on) this.toggle();
    return this.on;
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
    const motion = Math.min(1, speed / 50) * 0.35 + Math.min(1, effort) * 0.65;
    this.send({ type: 'params', motion, wind: Math.min(1, wind) });
    if (!this.water && this.ctx) {
      this.windGain?.gain.setTargetAtTime(wind * 0.05, this.ctx.currentTime, 0.4);
      this.bedGain?.gain.setTargetAtTime(0.025 + motion * 0.09, this.ctx.currentTime, 0.3);
    }
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
    if (this.muted.has('plop')) return;
    if (this.water) this.send({ type: 'plop', s: strength, pan });
    else this.fallbackSplash(strength, pan, 700);
  }

  /** An oar blade going in. */
  dip(strength: number, pan = 0) {
    if (this.muted.has('dip')) return;
    if (this.water) this.send({ type: 'dip', s: strength, pan });
    else this.fallbackSplash(strength, pan, 420);
  }

  /** The blade coming out: a gurgle. */
  gurgle(strength: number, pan = 0) {
    if (this.muted.has('gurgle')) return;
    if (this.water) this.send({ type: 'gurgle', s: strength, pan });
    else this.fallbackSplash(strength * 0.55, pan, 1700);
  }

  /** A drop falling back in. */
  drip(strength: number, pan = 0) {
    if (this.muted.has('drip')) return;
    if (this.water) this.send({ type: 'drip', s: strength, pan });
    else this.fallbackSplash(strength * 0.12, pan, 2400);
  }

  /** The hull nudging a pad. */
  knock(strength: number, pan = 0) {
    if (this.muted.has('knock')) return;
    if (this.water) this.send({ type: 'knock', s: strength, pan });
    else this.fallbackSplash(strength * 0.4, pan, 350);
  }

  /** Dew condensing on a leaf. */
  glint() {
    this.voice(PENTA[7 + Math.floor(Math.random() * 3)], 0, 0.01, 0.8, 'sine', (Math.random() - 0.5) * 0.8);
  }

  private fallbackSplash(strength: number, pan: number, freq: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.on || !this.noise || !this.environment) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.45;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12 * strength, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) {
      p.pan.value = pan;
      src.connect(bp).connect(g).connect(p).connect(this.environment);
    } else src.connect(bp).connect(g).connect(this.environment);
    src.start(t, Math.random());
    src.stop(t + 0.35);
  }
}

