import { clamp } from './num';

/**
 * ── THE SOUNDSCAPE: EVERYTHING SYNTHESISED, NOTHING DOWNLOADED ──
 *
 * An engine whose pitch follows the drivetrain, tire roar coloured by the
 * surface underneath, wind that rises with speed, the world's own bed of
 * leaves and water under all of it, and impacts when the truck meets
 * something. One noise buffer, a handful of nodes, no assets — and it must be
 * armed by a gesture (iOS autoplay policy).
 *
 * LIFTED OUT OF main.ts WHOLE, and it was the easiest thing in that file to
 * lift: 624 lines reaching exactly three things outside itself — `clamp`, a
 * four-word string union, and a callback that turned out to do nothing (see
 * `arm`). Everything else it needs arrives as arguments, every frame, which is
 * what a mixer is: a function of the world's state and nothing else.
 *
 * The rule this file keeps is that it OWNS NO WORLD STATE and asks the world
 * for nothing. `update` and `ambience` are told; the one-shots are told. If a
 * voice here ever needs to reach back for a fact, that fact belongs in the
 * argument list instead — otherwise this becomes a second copy of the game.
 */

/** What the truck HIT, material and all — kept regardless of whether the
 *  audio context is armed, because the harness verifies with this list what
 *  an ear cannot: that a rail clangs, a rock crunches, a façade crashes. */
export type ImpactKind = 'shell' | 'metal' | 'stone' | 'wood';

/**
 * What the wheels are on, as the mixer needs it. Deliberately a SEPARATE
 * declaration from main.ts's `Surface` rather than an import: audio is a
 * consumer of this idea and must not own a world type. Structural typing keeps
 * them interchangeable, and if the world ever grows a fifth surface the call
 * site fails to compile — which is the conversation that should happen.
 */
export type AudioSurface = 'road' | 'track' | 'water' | 'ground';

export interface Impact { t: number; kind: ImpactKind; force: number }

/** A bounded, repeatable bed of soft roof impacts, generated only at arm.
 * Individual drops ring briefly; a rain channel made only from noise sounds
 * like more wind. No event allocation is needed while the truck is driving. */
export function rainPattern(rate: number): Float32Array {
  const data = new Float32Array(Math.round(rate * 3));
  let seed = 0x7261696e;
  const rand = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let drop = 0; drop < 720; drop++) {
    const at = Math.floor(rand() * data.length);
    const hz = 650 + rand() * 2100, amp = 0.08 + rand() * 0.2;
    const len = Math.round(rate * (0.004 + rand() * 0.009));
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-6 * i / len);
      data[(at + i) % data.length] += amp * env * (Math.sin(i * hz * Math.PI * 2 / rate) * 0.7 + (rand() * 2 - 1) * 0.3);
    }
  }
  return data;
}

/** A seeded generator, so a pattern is the same on every device and every
 *  arm: the bed under the truck is a property of the game, not of the draw. */
const seeded = (seed: number): (() => number) => {
  let s0 = seed >>> 0;
  return () => { s0 = (Math.imul(s0, 1664525) + 1013904223) >>> 0; return s0 / 4294967296; };
};
const normalise = (d: Float32Array): Float32Array => {
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] /= peak;
  return d;
};

/**
 * THE GRAVEL BED, as a pattern. Not steady noise but individual stone
 * events, looped and sped up with the truck so loose ground CRUNCHES rather
 * than hisses. Two kinds of event and NO PITCH: a great many short CRACKLES
 * (a stone against the tread — one to eight milliseconds, most of them small
 * and a few of them large) and a few CRUNCHES a second (a stone rolling
 * under the load — twenty to sixty milliseconds, low, with mass).
 *
 * THE FIRST CUT WAS A BUBBLING BROOK. It gave every stone "a little pitch",
 * a sine ring with a decay, and through the low-mid bandpass it wore that is
 * the recipe for a water bubble: a short pitched chirp, dying. Nobody heard
 * it for as long as the bed sat at −42 dBFS; at −29 the first report from
 * the seat was a brook. Gravel is broadband and crackly and has no pitch,
 * so the pitch is gone from here and the pattern that had it is the rapids'
 * now (`bubblePattern`), where it was right all along.
 */
export function gritPattern(rate: number): Float32Array {
  const gd = new Float32Array(rate * 4);
  const rand = seeded(0x67726974);
  const crackles = Math.floor(rate * 4 * 0.006);   // ~290 a second of loop
  for (let g = 0; g < crackles; g++) {
    const at0 = Math.floor(rand() * (gd.length - 600));
    const len = Math.round(rate * (0.001 + rand() * 0.007));
    const r = rand(), amp = 0.15 + r * r * 0.85;     // most small, a few large
    for (let i = 0; i < len; i++) gd[at0 + i] += (rand() * 2 - 1) * Math.exp(-6 * i / len) * amp;
  }
  for (let g = 0; g < 28; g++) {                       // seven crunches a second
    const at0 = Math.floor(rand() * (gd.length - 3200));
    const len = Math.round(rate * (0.02 + rand() * 0.04));
    const amp = 0.4 + rand() * 0.6, k = 0.1 + rand() * 0.1;   // a one-pole lowpass, ~800–1500 Hz
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += ((rand() * 2 - 1) - lp) * k; gd[at0 + i] += lp * Math.exp(-4 * i / len) * amp * 2.5; }
  }
  return normalise(gd);
}

/** FAST WATER, as a pattern: a great many short pitched chirps, each dying
 *  — which is what a bubble is, and what the gravel bed used to be made of
 *  (see gritPattern). Slowed and held low under the rapids' wash it is the
 *  boil; it is not under the wheels any more. */
export function bubblePattern(rate: number): Float32Array {
  const gd = new Float32Array(rate * 4);
  const rand = seeded(0x62756262);
  const grains = Math.floor(rate * 4 * 0.012);
  for (let g = 0; g < grains; g++) {
    const at0 = Math.floor(rand() * (gd.length - 900));
    const len = 60 + Math.floor(rand() * 700);
    const amp = 0.25 + rand() * 0.75;
    const ring = 0.04 + rand() * 0.5;
    for (let i = 0; i < len; i++) {
      const env = Math.exp((-i / len) * 6);
      gd[at0 + i] += (rand() * 2 - 1) * env * amp * 0.5 + Math.sin(i * ring) * env * amp * 0.12;
    }
  }
  return normalise(gd);
}

/**
 * THE CHASSIS WORKING, as a pattern. A loose part BUZZES: a burst of clicks
 * at thirty to ninety a second — each a millisecond of noise with two
 * inharmonic metal partials — swelling and dying over a tenth to a third of
 * a second, from several different parts of the truck; and under it the
 * heavier things, a toolbox, the tailgate on its catch, as low knocks a few
 * times a second. Looped, and sped up as the ground gets rougher, so
 * washboard sounds like a truck being shaken rather than like more gravel.
 *
 * The first cut was seven hundred random sine tinkles at three to thirteen
 * milliseconds — wind chimes, or the other half of the brook the gravel was
 * making. What separates a rattle from a tinkle is the REPETITION: a panel
 * on a loose fixing hits the same thing thirty times a second, and that
 * periodicity is the whole character. Deterministic, like the rain.
 */
export function rattlePattern(rate: number): Float32Array {
  const data = new Float32Array(Math.round(rate * 3));
  const rand = seeded(0x72617474);
  for (let b = 0; b < 14; b++) {
    const start = Math.floor(rand() * data.length);
    const dur = Math.round(rate * (0.08 + rand() * 0.28));
    const rep = Math.round(rate / (30 + rand() * 60));
    const p1 = 2200 + rand() * 2600, p2 = p1 * (1.31 + rand() * 0.4);   // an inharmonic pair
    const amp = 0.3 + rand() * 0.7;
    for (let t = 0; t < dur; t += rep + Math.floor((rand() - 0.5) * rep * 0.3)) {
      const env = Math.sin(Math.PI * t / dur);
      const len = Math.round(rate * (0.002 + rand() * 0.004));
      for (let i = 0; i < len; i++) {
        const e = Math.exp(-7 * i / len), ph = i * Math.PI * 2 / rate;
        data[(start + t + i) % data.length] += amp * env * e
          * ((rand() * 2 - 1) * 0.5 + Math.sin(ph * p1) * 0.3 + Math.sin(ph * p2) * 0.2);
      }
    }
  }
  for (let k = 0; k < 24; k++) {
    const at0 = Math.floor(rand() * data.length);
    const len = Math.round(rate * (0.02 + rand() * 0.025));
    const amp = 0.5 + rand() * 0.5, kk = 0.05 + rand() * 0.06;   // a one-pole lowpass, ~400–850 Hz
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += ((rand() * 2 - 1) - lp) * kk; data[(at0 + i) % data.length] += lp * Math.exp(-5 * i / len) * amp * 3; }
  }
  return normalise(data);
}

/** The rattle the seat never heard as a rattle: seven hundred random sine
 *  tinkles. Kept ONLY as the B side of the sound lab's comparison, so the
 *  argument for the buzz can be heard rather than read. */
export function tinklePattern(rate: number): Float32Array {
  const data = new Float32Array(Math.round(rate * 3));
  const rand = seeded(0x74696e6b);
  for (let k = 0; k < 720; k++) {
    const at0 = Math.floor(rand() * data.length);
    const low = rand() < 0.12;
    const hz = low ? 110 + rand() * 160 : 1600 + rand() * 4200;
    const len = Math.round(rate * (low ? 0.02 + rand() * 0.04 : 0.003 + rand() * 0.01));
    const amp = (low ? 0.5 : 0.22) + rand() * 0.5;
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-5 * i / len);
      data[(at0 + i) % data.length] += amp * env * (Math.sin(i * hz * Math.PI * 2 / rate) * 0.8 + (rand() * 2 - 1) * 0.2);
    }
  }
  return normalise(data);
}

/**
 * ── THE TARGETS, IN ONE PLACE, AND MUTABLE ──
 *
 * Every decibel the world's voices (and the truck's two restated surface
 * voices) are written to. Exported and mutable so the SOUND LAB can move
 * them from the seat — the only ear this project has — and its COPY puts
 * this literal on the clipboard paste-ready. Change a target here, not
 * inline; `birds` is a multiplier on the phrase's gain rather than a level,
 * because a phrase is an event and its peak is what the ear rates.
 */
export const TARGETS = {
  river: -26, boil: -24, wind: -26, rustle: -34, sward: -31, birds: 1,
  roar: -31, grit: -29, rattle: -28, drone: -20,
};

/** The mix's ONE volume, applied last, before the limiter. Every decibel
 *  target below is written for the far side of it, so a voice's number is
 *  what the level probe reads and not what its gain node says. */
export const MASTER = 0.55;
/**
 * ── WHAT A GAIN OF 1 IS WORTH, PER VOICE ──
 *
 * A gain number means nothing on its own. A voice is white noise through a
 * filter, and a bandpass at 340 Hz passes one percent of the noise's energy
 * where a highpass at 900 Hz passes ninety-six — so "river 0.16, wind 0.02"
 * said the river was eight times the wind, and it was three decibels under
 * it. Every level in the world's bed was tuned by those numbers and the
 * whole bed sat forty decibels down, which from the seat was "little to
 * nothing" parked beside a river with the engine off.
 *
 * These are the RMS levels each chain renders AT UNIT GAIN, measured by
 * devtools/voice-levels.mjs — an offline render of the same chain — and
 * they are what lets a target be written in decibels and read back by
 * `levels()`. Re-measure when a filter moves; the devtool prints drift.
 * The truck's own bus keeps its linear gains: those were adjusted from the
 * seat over many rounds, and the ear was right even where the reading of
 * the numbers was wrong.
 */
export const UNIT = {
  wind: 0.58, rustle: 0.233, sward: 0.23, river: 0.095, rapids: 0.184, boil: 0.037,
  rain: 0.58, bird: 0.707, rattle: 0.043, drone: 0.19,
  // The two surface voices of the truck's bus, restated too: at their old
  // gains the tarmac roar at 100 km/h rendered at −40 dBFS and the gravel
  // at 40 km/h at −42, which is the surface feedback the doctrine calls
  // "the loudest thing the truck does" being inaudible on a phone. The
  // engine, squeal, scrape and brush keep their linear gains for now; their
  // measured levels are in CLAUDE.md as the next list.
  roar: 0.18, grit: 0.051,
} as const;
/** The gain that puts a voice at `dbfs` RMS after the master — see UNIT. */
export const lvl = (unit: number, dbfs: number): number => Math.pow(10, dbfs / 20) / (unit * MASTER);

export function createAudio() {
  const impactLog: Impact[] = [];
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engA: OscillatorNode, engB: OscillatorNode, engFilt: BiquadFilterNode, engGain: GainNode;
  let roarGain: GainNode, roarFilt: BiquadFilterNode, windGain: GainNode, windFilt: BiquadFilterNode;
  let gritSrc: AudioBufferSourceNode, gritGain: GainNode, gritFilt: BiquadFilterNode;
  let squealGain: GainNode, squealFilt: BiquadFilterNode, squealOsc: OscillatorNode;
  let scrapeGain: GainNode, scrapeFilt: BiquadFilterNode;
  let waterGain: GainNode, waterFilt: BiquadFilterNode;
  let rustleGain: GainNode, rustleFilt: BiquadFilterNode;
  let riverGain: GainNode, riverFilt: BiquadFilterNode;
  let brushGain: GainNode, brushFilt: BiquadFilterNode;
  let rainGain: GainNode, roofGain: GainNode;
  let swardGain: GainNode, swardFilt: BiquadFilterNode;
  let boilGain: GainNode, boilSrc: AudioBufferSourceNode;
  let rattleGain: GainNode, rattleFilt: BiquadFilterNode, rattleSrc: AudioBufferSourceNode;
  let droneGain: GainNode, droneFilt: BiquadFilterNode, droneOscA: OscillatorNode, droneOscB: OscillatorNode,
    droneOscC: OscillatorNode, whooshGain: GainNode, dronePan: StereoPannerNode | null = null;
  let limiter: DynamicsCompressorNode;
  let gritBuf: AudioBuffer, bubbleBuf: AudioBuffer, rattleBuf: AudioBuffer, tinkleBuf: AudioBuffer;
  /** Voices the lab has silenced. `m(name)` is the factor every steady gain
   *  carries, 1 or 0 — a mute is not a volume, so it is not a target. */
  const muted = new Set<string>();
  const m = (name: string): number => (muted.has(name) ? 0 : 1);
  /** Where the probe listens: one analyser per bus and per voice worth
   *  asking about. An analyser costs nothing until it is read. */
  const taps = new Map<string, AnalyserNode>();
  let tapBuf: Float32Array<ArrayBuffer> | null = null;
  let gustL = 0;                  // the wind's slow envelope, for the probe
  let cabin = 0, enclosure = 0, parkedL = 0;
  let crashAt = 0, creakAt = 0;   // one-shot cooldowns — a scrape is not a drum roll
  let birdAt = 0;                 // next phrase, spaced by how alive the spot is
  let scrapeLast = 0;             // the scrape's live level, for the sidechain below
  /**
   * ── TWO BUSES, BECAUSE ENCLOSURE IS NOT A VOLUME KNOB ──
   *
   * Under a bridge or in a bore the world outside goes away and YOUR OWN
   * noise comes back at you. One master gain cannot say that: muffling
   * everything would take the engine with it, and the engine is the thing a
   * tunnel makes louder. So the world's voices (wind, leaves, water at a
   * distance, birds, thunder) share `outBus` and the truck's own (engine,
   * tyres, grit, rubber, bodywork, every impact) share `nearBus`. Enclosure
   * closes a lowpass over the first and opens a short slap-back on the second.
   *
   * AT ZERO ENCLOSURE THE PATH IS THE OLD ONE: the filter sits at 20 kHz, the
   * bus at unity and the send at silence, so an open road sounds exactly as it
   * did and the whole mechanism costs three nodes nobody hears.
   */
  let outBus: GainNode, outLP: BiquadFilterNode, nearBus: GainNode;
  let slapSend: GainNode, slapDelay: DelayNode, slapFb: GainNode;
  /** The river's bearing, panned. Null on a browser without a stereo panner —
   *  Safari has had one for years, but a missing node must not silence the
   *  water. */
  let riverPan: StereoPannerNode | null = null;
  let noiseBuf: AudioBuffer;
  let on = true;
  try { on = localStorage.getItem('drive.mute') !== '1'; } catch { /* fine */ }
  const build = (): void => {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const Ctor = AC.AudioContext ?? AC.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = on ? MASTER : 0;
    // ── THE LIMITER IS WHAT LETS THE BED UP ──
    //
    // The master sat at 0.55 to leave headroom for a crash, and the world's
    // bed paid for that headroom permanently: a river on its bank rendered
    // at −41 dBFS, below what a phone speaker can say. A hard knee at the
    // top catches the peaks instead, so the quiet things can be as loud as
    // they are. A DynamicsCompressor applies its own make-up (about +3.5 dB
    // for these settings, uniform over everything); `levels()` reads on
    // BOTH sides of it so the targets are checked where they are written.
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 2; limiter.ratio.value = 16;
    limiter.attack.value = 0.003; limiter.release.value = 0.12;
    master.connect(limiter); limiter.connect(ctx.destination);
    const tap = (name: string, node: AudioNode): void => {
      if (!ctx) return;
      const an = ctx.createAnalyser(); an.fftSize = 2048; node.connect(an); taps.set(name, an);
    };
    tap('master', master); tap('out', limiter);
    // The world's bus, through the filter enclosure closes.
    outLP = ctx.createBiquadFilter(); outLP.type = 'lowpass';
    outLP.frequency.value = 20000; outLP.Q.value = 0.4;
    outBus = ctx.createGain(); outBus.gain.value = 1;
    outBus.connect(outLP); outLP.connect(master); tap('world', outLP);
    // The truck's bus, and the slap-back a hard ceiling gives it. 55 ms is a
    // road tunnel's own distance — long enough to hear as a separate return,
    // short enough not to read as a cathedral.
    nearBus = ctx.createGain(); nearBus.gain.value = 1;
    nearBus.connect(master); tap('truck', nearBus);
    slapDelay = ctx.createDelay(0.4); slapDelay.delayTime.value = 0.055;
    slapFb = ctx.createGain(); slapFb.gain.value = 0.36;
    slapSend = ctx.createGain(); slapSend.gain.value = 0;
    nearBus.connect(slapSend); slapSend.connect(slapDelay);
    slapDelay.connect(slapFb); slapFb.connect(slapDelay);
    slapDelay.connect(master);
    // Two seconds of white noise, looped — the source of tires and wind.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Engine: detuned saw + square through a lowpass that opens with revs.
    engFilt = ctx.createBiquadFilter(); engFilt.type = 'lowpass'; engFilt.frequency.value = 700;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    engFilt.connect(engGain); engGain.connect(nearBus); tap('eng', engGain);
    engA = ctx.createOscillator(); engA.type = 'sawtooth'; engA.frequency.value = 40;
    engB = ctx.createOscillator(); engB.type = 'square'; engB.frequency.value = 60;
    const engMix = ctx.createGain(); engMix.gain.value = 0.5;
    engA.connect(engFilt); engB.connect(engMix); engMix.connect(engFilt);
    engA.start(); engB.start();
    // Tire roar: bandpassed noise, centre frequency set by the surface.
    const roarSrc = ctx.createBufferSource(); roarSrc.buffer = noiseBuf; roarSrc.loop = true;
    roarFilt = ctx.createBiquadFilter(); roarFilt.type = 'bandpass'; roarFilt.frequency.value = 300; roarFilt.Q.value = 0.7;
    roarGain = ctx.createGain(); roarGain.gain.value = 0;
    roarSrc.connect(roarFilt); roarFilt.connect(roarGain); roarGain.connect(nearBus); roarSrc.start(); tap('roar', roarGain);
    // GRIT: the gravel bed. Not steady noise — a few seconds of individual
    // stone impacts (sharp attack, short decay, random pitch), looped and
    // sped up with the truck so loose ground CRUNCHES rather than hisses.
    gritBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    gritBuf.getChannelData(0).set(gritPattern(ctx.sampleRate));
    gritSrc = ctx.createBufferSource(); gritSrc.buffer = gritBuf; gritSrc.loop = true;
    // WIDE AND HIGH. A crunch is broadband — one to eight kilohertz of
    // crackle over the low body of the crunches — and the old band (900 to
    // 2300 Hz at Q 0.5) was the second half of what made it water.
    gritFilt = ctx.createBiquadFilter(); gritFilt.type = 'bandpass'; gritFilt.frequency.value = 2400; gritFilt.Q.value = 0.35;
    gritGain = ctx.createGain(); gritGain.gain.value = 0;
    gritSrc.connect(gritFilt); gritFilt.connect(gritGain); gritGain.connect(nearBus); gritSrc.start(); tap('grit', gritGain);
    // THE BOIL: fast water is not a hum, it is a great many small events —
    // the pitched-chirp pattern (bubblePattern) slowed to a third and held
    // low, so rapids churn rather than hiss. Opens with froth only.
    bubbleBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    bubbleBuf.getChannelData(0).set(bubblePattern(ctx.sampleRate));
    boilSrc = ctx.createBufferSource(); boilSrc.buffer = bubbleBuf; boilSrc.loop = true;
    boilSrc.playbackRate.value = 0.36;
    const boilFilt = ctx.createBiquadFilter(); boilFilt.type = 'bandpass';
    boilFilt.frequency.value = 380; boilFilt.Q.value = 0.9;
    boilGain = ctx.createGain(); boilGain.gain.value = 0;
    boilSrc.connect(boilFilt); boilFilt.connect(boilGain); boilSrc.start(); tap('boil', boilGain);
    // THE RATTLE: the chassis being shaken. See rattlePattern; the gain
    // rides `shake` (the washboard at the four wheels) in update().
    rattleBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    rattleBuf.getChannelData(0).set(rattlePattern(ctx.sampleRate));
    tinkleBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    tinkleBuf.getChannelData(0).set(tinklePattern(ctx.sampleRate));
    rattleSrc = ctx.createBufferSource(); rattleSrc.buffer = rattleBuf; rattleSrc.loop = true;
    rattleFilt = ctx.createBiquadFilter(); rattleFilt.type = 'bandpass';
    rattleFilt.frequency.value = 2000; rattleFilt.Q.value = 0.4;
    rattleGain = ctx.createGain(); rattleGain.gain.value = 0;
    rattleSrc.connect(rattleFilt); rattleFilt.connect(rattleGain); rattleGain.connect(nearBus); rattleSrc.start();
    tap('rattle', rattleGain);
    // SQUEAL: a tyre that is sliding rather than rolling. Noise through a very
    // narrow bandpass, plus a thin sawtooth at the same pitch so it has an edge
    // — pure filtered noise reads as wind, not rubber.
    const sqSrc = ctx.createBufferSource(); sqSrc.buffer = noiseBuf; sqSrc.loop = true;
    squealFilt = ctx.createBiquadFilter(); squealFilt.type = 'bandpass';
    squealFilt.frequency.value = 1500; squealFilt.Q.value = 14;
    squealGain = ctx.createGain(); squealGain.gain.value = 0;
    sqSrc.connect(squealFilt);
    squealOsc = ctx.createOscillator(); squealOsc.type = 'sawtooth'; squealOsc.frequency.value = 1500;
    const sqMix = ctx.createGain(); sqMix.gain.value = 0.09;   // the EDGE — noise alone reads as wind
    squealOsc.connect(sqMix); sqMix.connect(squealFilt);
    squealFilt.connect(squealGain); squealGain.connect(nearBus);
    sqSrc.start(); squealOsc.start(); tap('squeal', squealGain);
    // Wind: highpassed noise that climbs with the square of speed.
    const windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilt = ctx.createBiquadFilter(); windFilt.type = 'highpass'; windFilt.frequency.value = 900;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilt); windFilt.connect(windGain); windGain.connect(outBus); windSrc.start(); tap('wind', windGain);
    // Scrape: the continuous half of a collision — bodywork dragged along a
    // wall or rail. A mid bandpass with some bite; gain rides contact + speed.
    const scSrc = ctx.createBufferSource(); scSrc.buffer = noiseBuf; scSrc.loop = true;
    scrapeFilt = ctx.createBiquadFilter(); scrapeFilt.type = 'bandpass';
    scrapeFilt.frequency.value = 640; scrapeFilt.Q.value = 2.4;
    scrapeGain = ctx.createGain(); scrapeGain.gain.value = 0;
    scSrc.connect(scrapeFilt); scrapeFilt.connect(scrapeGain); scrapeGain.connect(nearBus); scSrc.start(); tap('scrape', scrapeGain);
    // Water: the wash of a hull pushing through it — low, wide, speed-driven.
    const waSrc = ctx.createBufferSource(); waSrc.buffer = noiseBuf; waSrc.loop = true;
    waterFilt = ctx.createBiquadFilter(); waterFilt.type = 'bandpass';
    waterFilt.frequency.value = 420; waterFilt.Q.value = 0.8;
    waterGain = ctx.createGain(); waterGain.gain.value = 0;
    waSrc.connect(waterFilt); waterFilt.connect(waterGain); waterGain.connect(nearBus); waSrc.start(); tap('water', waterGain);
    // ── the world without the car ──
    // Rustle: leaves as high thin noise the wind pushes around; River: the
    // steady wide wash of moving water nearby. Both live under everything
    // and only surface when the truck lets them (see ambience()).
    const ruSrc = ctx.createBufferSource(); ruSrc.buffer = noiseBuf; ruSrc.loop = true;
    rustleFilt = ctx.createBiquadFilter(); rustleFilt.type = 'bandpass';
    rustleFilt.frequency.value = 1750; rustleFilt.Q.value = 0.5;
    rustleGain = ctx.createGain(); rustleGain.gain.value = 0;
    ruSrc.connect(rustleFilt); rustleFilt.connect(rustleGain); rustleGain.connect(outBus); ruSrc.start(); tap('rustle', rustleGain);
    // SWARD: grass is not leaves. Thinner and higher than the rustle, a hiss
    // rather than a flutter, and it answers to the ground cover under the
    // truck rather than to the trees around it — a meadow with no tree in
    // it used to be as silent as a car park.
    const swSrc = ctx.createBufferSource(); swSrc.buffer = noiseBuf; swSrc.loop = true;
    swardFilt = ctx.createBiquadFilter(); swardFilt.type = 'bandpass';
    swardFilt.frequency.value = 3400; swardFilt.Q.value = 1.1;
    swardGain = ctx.createGain(); swardGain.gain.value = 0;
    swSrc.connect(swardFilt); swardFilt.connect(swardGain); swardGain.connect(outBus); swSrc.start(); tap('sward', swardGain);
    const rvSrc = ctx.createBufferSource(); rvSrc.buffer = noiseBuf; rvSrc.loop = true;
    riverFilt = ctx.createBiquadFilter(); riverFilt.type = 'bandpass';
    riverFilt.frequency.value = 470; riverFilt.Q.value = 0.8;
    riverGain = ctx.createGain(); riverGain.gain.value = 0;
    rvSrc.connect(riverFilt); riverFilt.connect(riverGain);
    // WATER HAS A SIDE. The ring that measures how much water is near already
    // knows WHERE it is; until now the mixer was told only the amount, so a
    // river you were driving alongside sat in the middle of your head.
    try { riverPan = ctx.createStereoPanner(); } catch { riverPan = null; }
    if (riverPan) { riverGain.connect(riverPan); riverPan.connect(outBus); } else riverGain.connect(outBus);
    rvSrc.start(); tap('river', riverGain);
    boilGain.connect(riverPan ?? outBus);   // the boil is the same water, from the same side
    // THE DRONE. Four rotors are four blade-pass tones a hair apart — the
    // beat between them is what a quad sounds like, and one clean tone is a
    // dentist. A triangle an octave up gives the airframe some body, the
    // bandpass keeps it a machine rather than a synth, and a thin whoosh of
    // highpassed noise is the downwash. Pitch and level ride the spool and
    // the load; distance and bearing are the caller's, see drone().
    droneOscA = ctx.createOscillator(); droneOscA.type = 'sawtooth'; droneOscA.frequency.value = 90;
    droneOscB = ctx.createOscillator(); droneOscB.type = 'sawtooth'; droneOscB.frequency.value = 92.4;
    droneOscC = ctx.createOscillator(); droneOscC.type = 'triangle'; droneOscC.frequency.value = 181;
    const droneMix = ctx.createGain(); droneMix.gain.value = 0.34;
    droneOscA.connect(droneMix); droneOscB.connect(droneMix); droneOscC.connect(droneMix);
    droneFilt = ctx.createBiquadFilter(); droneFilt.type = 'bandpass';
    droneFilt.frequency.value = 720; droneFilt.Q.value = 0.7;
    droneGain = ctx.createGain(); droneGain.gain.value = 0;
    droneMix.connect(droneFilt); droneFilt.connect(droneGain);
    const whSrc = ctx.createBufferSource(); whSrc.buffer = noiseBuf; whSrc.loop = true;
    const whHP = ctx.createBiquadFilter(); whHP.type = 'highpass'; whHP.frequency.value = 2600;
    whooshGain = ctx.createGain(); whooshGain.gain.value = 0;
    whSrc.connect(whHP); whHP.connect(whooshGain); whooshGain.connect(droneGain); whSrc.start();
    try { dronePan = ctx.createStereoPanner(); } catch { dronePan = null; }
    if (dronePan) { droneGain.connect(dronePan); dronePan.connect(outBus); } else droneGain.connect(outBus);
    droneOscA.start(); droneOscB.start(); droneOscC.start(); tap('drone', droneGain);
    // Rain has two scales: a fine outdoor wash and resolved drops on the
    // roof. Both are persistent voices; weather only changes their envelopes.
    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    const rainHP = ctx.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 1800;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rainHP); rainHP.connect(rainGain); rainGain.connect(outBus); rainSrc.start(); tap('rain', rainGain);
    const rainBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    rainBuf.getChannelData(0).set(rainPattern(ctx.sampleRate));
    const roofSrc = ctx.createBufferSource(); roofSrc.buffer = rainBuf; roofSrc.loop = true;
    const roofLP = ctx.createBiquadFilter(); roofLP.type = 'lowpass'; roofLP.frequency.value = 2400;
    roofGain = ctx.createGain(); roofGain.gain.value = 0;
    roofSrc.connect(roofLP); roofLP.connect(roofGain); roofGain.connect(nearBus); roofSrc.start(); tap('roof', roofGain);
    // Brush: FOLIAGE ON THE BODYWORK — higher and thinner than the rustle
    // bed, because these leaves are against the panels, not across the
    // valley. Gain rides contact + speed like the scrape it is cousin to.
    const brSrc = ctx.createBufferSource(); brSrc.buffer = noiseBuf; brSrc.loop = true;
    brushFilt = ctx.createBiquadFilter(); brushFilt.type = 'bandpass';
    brushFilt.frequency.value = 2400; brushFilt.Q.value = 0.7;
    brushGain = ctx.createGain(); brushGain.gain.value = 0;
    brSrc.connect(brushFilt); brushFilt.connect(brushGain); brushGain.connect(nearBus); brSrc.start(); tap('brush', brushGain);
  };
  /**
   * ── WHAT "LIVE" MEANS, IN ONE PLACE ──
   *
   * Every voice needs the same four facts before it may speak: a context, a
   * master, a RUNNING context, and the dial on. Centralising the file made
   * visible that they did not agree — eight one-shots asked all four, `update`
   * and `ambience` omitted `on` (safe only because the context is suspended
   * when the dial is off, which is a coincidence and not a reason), and
   * `brush`, `scrape` and `water` asked NEITHER, writing gain automation onto
   * a suspended context whose clock is not advancing.
   *
   * Nothing was audibly wrong — the master sits at zero and the context is
   * suspended — but three voices were relying on someone else's guard, and the
   * next voice copied from one of them would inherit that. One predicate now,
   * so a new voice cannot be written with the weaker half.
   */
  const live = (): boolean => !!ctx && !!master && ctx.state === 'running' && on;
  /**
   * THE BOX, RUNG. The truck's steel shell has two low modes any strike
   * excites, and whatever hit it adds its own on top — a rail's bright
   * tuning-fork set, a boulder's one dead thump. Shared by the crash and
   * the landing, because a drop onto rock IS a collision the ground threw
   * and it must sound like the same vehicle. Each mode is detuned noise
   * through a resonant bandpass: the same wreck twice is a sample.
   */
  const ringModes = (t: number, f: number, modes: Array<[number, number, number, number]>): void => {
    if (!ctx) return;
    for (const [hz, q, amp, len] of modes) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      src.playbackRate.value = 0.82 + Math.random() * 0.36;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = hz; bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.6, amp * (0.4 + f)), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len + f * 0.5);
      src.connect(bp); bp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + len + f * 0.55);
    }
  };

  const arm = (): void => {
    // ── MUTED MEANS NO CONTEXT AT ALL ──
    //
    // Building the graph and turning the master gain to zero is not silence,
    // it is silence WITH THE AUDIO HARDWARE HELD. On a phone that is enough to
    // duck or stop whatever the player was listening to — reported from the
    // seat as the game stealing audio with the dial off, which is exactly what
    // it did. There is nothing to arm when the answer is no sound: `toggle`
    // calls arm() on the way back up, so the graph is built the moment it is
    // actually wanted.
    if (!on) return;
    // ── AND WHEN IT IS WANTED, IT SHARES ──
    //
    // 'playback' is the category that says "I am the thing you are listening
    // to", and iOS honours it by interrupting everyone else. That was chosen
    // to beat the RINGER SWITCH, which silences Web Audio otherwise — a real
    // problem, fixed at the cost of killing the player's podcast.
    //
    // 'ambient' is the other side of that trade and the right one for a game:
    // it MIXES, so music keeps playing underneath. The cost is honest and
    // worth stating — with the ringer switch off, the game is silent, which is
    // how every other game on the phone behaves and what a player flicking
    // that switch is asking for.
    try {
      const ns = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (ns) ns.type = 'ambient';
    } catch { /* not supported — silent switch still applies */ }
    if (!ctx) build();
    if (!ctx) return;
    // Must be *inside* the gesture: resume, then push a 1-sample silent buffer
    // through — Safari only truly unlocks once something has been played.
    if (ctx.state !== 'running') void ctx.resume();
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch { /* fine */ }
    // NOTHING TO TELL. This called `syncBtn()`, which main.ts declared as an
    // empty arrow with the comment "label is drawn from audio state each
    // frame" — a callback kept alive for a button that had stopped needing
    // one. The extraction is what made it visible: it was the only thing in
    // 624 lines reaching back into the game, and it did nothing when it got
    // there.
  };
  /** A few whistled notes from one place in the world — allocated only when a
   *  bird speaks and released after its tail. */
  const phrase = (birds: number): void => {
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2300 + Math.random() * 1700;
    let birdPan: StereoPannerNode | null = null;
    try { birdPan = ctx.createStereoPanner(); } catch { /* mono fallback */ }
    if (birdPan) { birdPan.pan.value = (Math.random() * 2 - 1) * 0.65; birdPan.connect(outBus); }
    let at0 = t + Math.random() * 0.2;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      const f0 = base * (0.9 + Math.random() * 0.25);
      osc.frequency.setValueAtTime(f0, at0);
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.82 + Math.random() * 0.4), at0 + 0.05 + Math.random() * 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at0);
      // −27 dBFS at the peak of a phrase where it was −35: the one thing a
      // parked driver could hear, and only just. TARGETS.birds scales it.
      g.gain.exponentialRampToValueAtTime((0.02 + 0.09 * clamp(birds, 0, 1)) * TARGETS.birds, at0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, at0 + 0.05 + Math.random() * 0.07);
      osc.connect(g); g.connect(birdPan ?? outBus);
      const lastNote = i === notes - 1;
      osc.onended = () => { osc.disconnect(); g.disconnect(); if (lastNote) birdPan?.disconnect(); };
      osc.start(at0); osc.stop(at0 + 0.16);
      at0 += 0.07 + Math.random() * 0.12;
    }
  };
  return {
    arm,
    /** The impact ledger, newest last — written whether or not the context is
     *  armed, so a muted or headless run still records what the physics
     *  charged. */
    impacts(): Impact[] { return impactLog.slice(-25); },
    /** The MIX, measured — what each channel's gain actually is right now,
     *  because "should be audible" has been asserted from this desk twice
     *  and disproved from the seat twice. Numbers or it did not happen. */
    mix(): object {
      const g = (n: GainNode | undefined): number => +(n?.gain.value ?? 0).toFixed(3);
      return { state: ctx?.state ?? 'none', on,
        eng: g(engGain), roar: g(roarGain), squeal: g(squealGain), scrape: g(scrapeGain),
        grit: g(gritGain), wind: g(windGain), brush: g(brushGain),
        rain: g(rainGain), roof: g(roofGain), cabin, enclosure,
        rustle: g(rustleGain), river: g(riverGain), water: g(waterGain),
        sward: g(swardGain), boil: g(boilGain), rattle: g(rattleGain), drone: g(droneGain),
        gust: +gustL.toFixed(2), parked: parkedL, muted: [...muted].join(','),
        // The room, so a test can assert a tunnel rather than describe one.
        // Before `build()` these read as OPEN SKY rather than as zero: an
        // unbuilt filter is not a shut one, and a mix read before the first
        // gesture should not say the truck is in a bore.
        out: outBus ? g(outBus) : 1, slap: g(slapSend),
        muffle: Math.round(outLP?.frequency.value ?? 20000),
        riverAt: +(riverPan?.pan.value ?? 0).toFixed(2) };
    },
    /**
     * THE LEVELS, MEASURED — dBFS RMS over the last 43 ms at every tap. This
     * is the number `mix()` was being read as and is not: a gain is what a
     * node multiplies by, a level is what comes out, and per voice the two
     * differ by up to 22 dB (see UNIT). `master` is before the limiter,
     * where the targets are written; `out` is after it, what the speaker
     * gets. Nothing is computed until this is called.
     */
    levels(): Record<string, number> {
      const o: Record<string, number> = {};
      if (!ctx) return o;
      // EVERY TAP IN THE SAME FRAME. The voice and bus taps sit BEFORE the
      // master gain and `out` after the limiter, so read raw they disagreed
      // with each other and with the targets by the master's 5.2 dB — the
      // lab's first run had the river 4 dB "hot" against a target it was
      // exactly on. The master's gain is applied to everything upstream of
      // it here, so a voice's number is the number its target names.
      const masterDb = 20 * Math.log10(master?.gain.value || MASTER);
      for (const [name, an] of taps) {
        if (!tapBuf || tapBuf.length !== an.fftSize) tapBuf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(tapBuf);
        let s2 = 0;
        for (let i = 0; i < tapBuf.length; i++) s2 += tapBuf[i] * tapBuf[i];
        const raw = 20 * Math.log10(Math.max(Math.sqrt(s2 / tapBuf.length), 1e-6));
        o[name] = +(name === 'master' || name === 'out' ? raw : raw + masterDb).toFixed(1);
      }
      return o;
    },
    /** Stand the graph down — a backgrounded tab must not keep an engine
     *  running in it. `arm()` brings it back. */
    hush(): void { try { void ctx?.suspend(); } catch { /* fine */ } },
    get on(): boolean { return on; },
    get state(): string { return ctx ? ctx.state : 'none'; },
    toggle(): boolean {
      on = !on;
      try { localStorage.setItem('drive.mute', on ? '0' : '1'); } catch { /* fine */ }
      if (on) arm();
      if (master && ctx) master.gain.setTargetAtTime(on ? MASTER : 0, ctx.currentTime, 0.05);
      // MUTING GIVES THE HARDWARE BACK. A suspended context releases the audio
      // session, so turning the dial off mid-drive stops ducking whatever else
      // is playing rather than merely going quiet over the top of it.
      if (!on) { try { void ctx?.suspend(); } catch { /* fine */ } }
      return on;
    },
    // Called every frame; all parameters glide so nothing zippers.
    /**
     * `q` is the ground's own QUALITY, 0 a sand piste and 1 new asphalt, and it
     * is what lets a surface sound like itself. The three-tier road/track/
     * ground split was audible but coarse: cobbles sounded like an autobahn
     * and a grade-5 forestry track like a graded gravel road, because the tier
     * is all the mixer was told. `spin` is the wheels asking for more than the
     * ground will give — the sound of traction being lost rather than of a
     * surface being crossed.
     */
    update(speed: number, throttle: number, surf: AudioSurface, grounded: number, rainAmt = 0, rev = 0, gear = 0, slip = 0,
      q = 1, spin = 0, ambWind = 0, engF = 1, shake = 0, surfaceWet = rainAmt): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime, v = Math.abs(speed);
      // THE EVENT LEVELS FIRST, because the whole bed answers to them.
      // A SEALED SURFACE SQUEALS; LOOSE GROUND JUST HISSES — the bite
      // follows the quality rather than the tier. A SKID IS BOTH AXES, and
      // THE LAMP AND THE EAR MUST AGREE: the HUD calls SLIP from 0.06 and
      // the 0.55 curve opens the voice there rather than at a committed
      // slide.
      // …with a FLOOR under the sealed tiers. slip-sig caught the real
      // silencer at last: q read 0.2 ON THE ROAD at Chapman's (worst-wheel
      // sampling off the verge, thin surface data — either way), and
      // 0.2^1.6 throttled a healthy skid signal to nothing. A worn road
      // still screeches — only genuinely loose ground gets to not sing.
      const bite = surf === 'road' ? Math.max(Math.pow(clamp(q, 0, 1), 1.6), 0.55)
        : surf === 'track' ? Math.max(Math.pow(clamp(q, 0, 1), 1.6), 0.25) : 0.12;
      const sq2 = Math.pow(clamp(Math.max(slip, spin * 0.85), 0, 1), 0.55);
      const sqT = sq2 * bite * grounded * Math.min((v + spin * 9) / 8, 1) * 0.6;
      // THE SIDECHAIN. Measured at Chapman's Peak (mix-audit): scrape peaked
      // at 0.08 and squeal at 0.03 against an engine at 0.34 and grit at
      // 0.40 — no per-channel raise wins against that bed, which is why two
      // rounds of raises changed nothing from the seat. When rubber or
      // bodywork speaks, the steady bed steps back; every real mix works
      // this way.
      const duck = 1 - 0.55 * clamp((sqT + scrapeLast * 1.2) * 2.2, 0, 1);
      // Revs come from the DRIVETRAIN, not from road speed — the two part
      // company the moment the wheels leave the ground, and the flare over a
      // jump is the whole reason for the distinction.
      const f = 42 + rev * 96 + gear * 10;
      engA.frequency.setTargetAtTime(f, t, 0.07);
      engB.frequency.setTargetAtTime(f * 1.5, t, 0.07);
      engFilt.frequency.setTargetAtTime(500 + rev * 1500 + v * 22, t, 0.09);
      // Airborne the engine gets LOUDER, not quieter: it is unloaded and
      // screaming. Multiplying by `grounded` had it fade out over every jump.
      // `engF` is the IGNITION: 1 running, a fraction while the starter
      // turns it, 0 with the key off — the whole engine voice hangs on it.
      engGain.gain.setTargetAtTime(
        (0.1 + Math.abs(throttle) * 0.16 * (0.45 + 0.55 * grounded)
          + (1 - grounded) * rev * 0.1 + Math.min(v / 60, 0.1)) * engF * duck * m('eng'), t, 0.09,
      );
      // Rubber that has stopped rolling — the levels were derived up top;
      // here it just sings at its pitch.
      const sf = 1250 + Math.min(v * 14, 620) + sq2 * 260;
      squealFilt.frequency.setTargetAtTime(sf, t, 0.08);
      squealOsc.frequency.setTargetAtTime(sf, t, 0.08);
      squealGain.gain.setTargetAtTime(sqT * m('squeal'), t, 0.06);
      // Tarmac hisses high and thin; loose ground growls low and loud. A graded
      // track sits between the two — you can hear which tier you are on.
      const road = surf === 'road';
      // HOW HARD THE GROUND IS, continuously. This is the number the ear reads
      // as "what am I driving on" before the handling has said anything: a
      // high thin hiss on new tarmac, sliding down to a low growl as the
      // surface coarsens, and gone altogether on open ground.
      const hard = surf === 'water' ? 0 : surf === 'road' || surf === 'track'
        ? clamp(q, 0, 1) : 0.08;
      // A shower stops before the road dries. Use the weather field's stored
      // wetness; rain remains the input to the drops and roof voices below.
      const wetRoad = clamp(surfaceWet, 0, 1) * hard;
      roarFilt.frequency.setTargetAtTime(320 + hard * 830 + wetRoad * 850, t, 0.12);
      // IN DECIBELS: −31 dBFS at 100 km/h on dry tarmac; gravel is eight
      // decibels over that and lower, wet tarmac five over and brighter —
      // the same shape as before, normalised so the tarmac case is the one
      // written down.
      roarGain.gain.setTargetAtTime(
        lvl(UNIT.roar, TARGETS.roar) * Math.min(v / 34, 1) * ((0.26 - hard * 0.16 + wetRoad * 0.08) / 0.1)
          * grounded * duck * m('roar'), t, 0.1);
      // The weather's wind blows even when parked. Rain has its own wash
      // and impacts now, so rainfall does not masquerade as stronger wind.
      // ── AND IT GUSTS. A steady level is a fan; wind is an envelope that
      // rises and falls over seconds, and the leaves answer it a moment
      // late (see ambience). Two incommensurate sines of the clock, so the
      // pattern never quite repeats and costs nothing.
      const gust = 0.5 + 0.5 * (0.6 * Math.sin(t * 0.29 + 1.3) + 0.4 * Math.sin(t * 0.73));
      gustL = gust;
      windFilt.frequency.setTargetAtTime(900 - ambWind * 250 - gust * 200, t, 0.4);
      // IN DECIBELS: −34 dBFS on a 12 km/h day and −26 at forty; the truck's
      // own speed adds −28 at a hundred. The old linear numbers put the
      // 12 km/h day at −44, which no phone can say.
      const windAmb = Math.pow(clamp(ambWind / 0.73, 0, 1.6), 0.55);
      const windSpeed = Math.min((v * v) / 2600, 0.9) * 3.2;
      windGain.gain.setTargetAtTime(
        lvl(UNIT.wind, TARGETS.wind) * (windAmb + windSpeed) * (0.55 + 0.45 * gust) * m('wind'), t, 0.15);
      // THE CHASSIS, SHAKEN. `shake` is the washboard's rate at the four
      // wheels — 0 on tarmac, 1 on open ground at speed, worn dampers folded
      // in by the caller. The bed gets DENSER as well as louder, so rough
      // ground is the truck being shaken rather than more gravel. −28 dBFS
      // flat out, beside the grit and under the engine.
      const sh = Math.pow(clamp(shake, 0, 1), 0.8) * clamp(v / 0.5, 0, 1);
      rattleSrc.playbackRate.setTargetAtTime(0.7 + sh * 0.9, t, 0.15);
      rattleFilt.frequency.setTargetAtTime(1600 + sh * 1000, t, 0.2);
      rattleGain.gain.setTargetAtTime(lvl(UNIT.rattle, TARGETS.rattle) * sh * grounded * duck * m('rattle'), t, 0.08);
      const rain = clamp(rainAmt, 0, 1);
      rainGain.gain.setTargetAtTime(rain * 0.12 * m('rain'), t, 0.45);
      // A roof overhead shelters the rig too. The cabin brings its own roof
      // closer to the ear; a tunnel must not amplify rain that cannot hit it.
      roofGain.gain.setTargetAtTime(rain * (0.08 + cabin * 0.24) * (1 - enclosure) * m('roof'), t, 0.45);
      // Gravel: absent on tarmac, dominant off it. Rate (playbackRate) AND
      // level rise with speed, so the crunch density tracks the wheels.
      // …and the grit is its complement, plus whatever the wheels are throwing
      // up because they have stopped hooking up. A spinning wheel on gravel is
      // the loudest thing the truck does.
      const loose = surf === 'water' ? 0.12
        : clamp(1 - Math.pow(clamp(q, 0, 1), 1.25), 0, 1) * (surf === 'ground' ? 1 : 0.92);
      gritSrc.playbackRate.setTargetAtTime(0.55 + Math.min(v / 26, 1.35), t, 0.12);
      gritFilt.frequency.setTargetAtTime(surf === 'water' ? 900 : 2000 + Math.min(v * 40, 2000), t, 0.15);
      // Off the tarmac the grit IS the feedback — it is how a surface change
      // announces itself before the handling does — and at 0.3 it sat under the
      // engine at every speed that mattered.
      // IN DECIBELS: −29 dBFS at speed on open ground, a spinning wheel four
      // over that. The old 0.46 rendered at −42, under everything.
      gritGain.gain.setTargetAtTime(
        lvl(UNIT.grit, TARGETS.grit) * (Math.min(v / 12, 1) * loose + spin * 0.65 * (0.25 + 0.75 * loose))
          * grounded * duck * m('grit'), t, 0.09);
    },
    /** The starter: four compressions through a low filter, dying if the
     *  catch has not happened by the end — the engine's own voice takes over
     *  from tick as engineSt turns on. */
    crank(): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(24, t);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      for (let i = 0; i < 4; i++) {
        const at = t + i * 0.15;
        g.gain.setValueAtTime(0.001, at);
        g.gain.exponentialRampToValueAtTime(0.15, at + 0.04);
        g.gain.exponentialRampToValueAtTime(0.004, at + 0.13);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);
      osc.connect(lp); lp.connect(g); g.connect(nearBus);
      osc.start(t); osc.stop(t + 0.7);
    },
    /** The key off: one soft mechanical sigh as everything spins down. */
    engOff(): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      src.connect(lp); lp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + 0.32);
    },
    /** The world's own bed, set every frame like update(): leaves in the
     *  wind, a river nearby, and now and then a bird — audible exactly as
     *  much as the truck lets them be. `gusty` shifts the rustle's colour;
     *  birds are PHRASES, not a loop: a few whistled notes, spaced by how
     *  alive the spot is. */
    ambience(rustle: number, river: number, birds: number, gusty: number, froth = 0, riverAt = 0, grass = 0): void {
      if (!live() || !ctx || !master || !rustleGain) return;
      const t = ctx.currentTime;
      // IN DECIBELS. `rustle` arrives as wind × foliage × the bed's duck, so
      // 0.22 is full foliage on a 12 km/h day: −36 dBFS there, −27 at forty.
      // The leaves ride the gust the wind set in update(), and the half-second
      // glide is the lag between a gust arriving and a tree answering it.
      rustleGain.gain.setTargetAtTime((rustle / 0.22) * lvl(UNIT.rustle, TARGETS.rustle) * (0.5 + 0.5 * gustL) * m('rustle'), t, 0.5);
      rustleFilt.frequency.setTargetAtTime(1300 + gusty * 900, t, 0.8);
      // GRASS. `grass` is the cover under and around the truck (with the
      // same duck as the rustle); it hisses in the wind where leaves flutter,
      // thinner and higher, and a meadow is no longer a car park.
      swardGain.gain.setTargetAtTime(
        grass * Math.pow(clamp(gusty / 0.73, 0, 1.6), 0.55) * lvl(UNIT.sward, TARGETS.sward) * (0.4 + 0.6 * gustL) * m('sward'), t, 0.5);
      swardFilt.frequency.setTargetAtTime(3000 + gusty * 1200, t, 0.8);
      // `froth` is the water's CHARACTER, from the same probes that found
      // it: 0 is still water lapping low and wide, 1 is rapids — brighter,
      // narrower, and a shade louder for the same nearness.
      // IN DECIBELS: −26 on the bank of still water. The rapids' own chain
      // is five decibels hotter for the same gain before froth adds half
      // again, and the boil (see build) comes in under it. Still water LAPS:
      // the level breathes at the rate water moves against a bank, which is
      // what stops a bandpass being a hum.
      const lap = 0.5 + 0.5 * (0.7 * Math.sin(t * 0.62) + 0.3 * Math.sin(t * 1.7 + 0.8));
      riverGain.gain.setTargetAtTime(
        river * lvl(UNIT.river, TARGETS.river) * (1 + froth * 0.5) * (1 - (1 - froth) * 0.3 * lap) * m('river'), t, 0.6);
      boilGain.gain.setTargetAtTime(river * froth * lvl(UNIT.boil, TARGETS.boil) * m('boil'), t, 0.6);
      // `riverAt` is −1 hard left through +1 hard right, in the TRUCK's frame,
      // and it glides slowly: water does not jump across the road, and a pan
      // that chases a noisy bearing is worse than no pan at all. Held short of
      // the hard edges — a river fully in one ear is a headphone effect, not a
      // valley.
      if (riverPan) riverPan.pan.setTargetAtTime(clamp(riverAt, -1, 1) * 0.75, t, 0.7);
      riverFilt.frequency.setTargetAtTime(340 + froth * 520, t, 0.9);
      riverFilt.Q.setTargetAtTime(0.8 - froth * 0.3, t, 0.9);
      if (on && birds > 0.03 && m('birds') > 0) {
        const nowP = performance.now();
        if (nowP > birdAt) {
          birdAt = nowP + 1500 + (Math.random() * 9000) / (0.15 + birds);
          phrase(birds);
        }
      }
    },
    /** One bird, now — for the lab. `strength` is the birds level the phrase
     *  would have been spaced and pitched by. */
    bird(strength = 0.6): void {
      if (!live()) return;
      phrase(strength);
    },
    /** Silence one voice, or give it back. A mute is not a volume and is not
     *  a target: it is how the lab isolates a sound, and it never leaves the
     *  lab because nothing in the game calls it. */
    mute(name: string, off: boolean): void {
      if (off) muted.add(name); else muted.delete(name);
    },
    mutes(): string[] { return [...muted]; },
    /**
     * THE A/B. The gravel as the crackle that ships or as the pitched chirps
     * it used to be; the rattle as the buzz that ships or as the tinkle it
     * used to be. For the lab, so the seat can HEAR the argument in
     * gritPattern's comment rather than read it. A buffer source cannot
     * change its buffer, so the swap is a new source on the same filter.
     */
    pattern(kind: 'grit' | 'rattle', which: 'a' | 'b'): void {
      if (!ctx || !gritSrc || !rattleSrc) return;
      const buf = kind === 'grit' ? (which === 'a' ? gritBuf : bubbleBuf) : (which === 'a' ? rattleBuf : tinkleBuf);
      const cur = kind === 'grit' ? gritSrc : rattleSrc;
      if (cur.buffer === buf) return;
      try { cur.stop(); } catch { /* already stopped */ }
      cur.disconnect();
      const next = ctx.createBufferSource(); next.buffer = buf; next.loop = true;
      next.playbackRate.value = cur.playbackRate.value;
      if (kind === 'grit') { gritSrc = next; next.connect(gritFilt); } else { rattleSrc = next; next.connect(rattleFilt); }
      next.start();
    },
    // Thunder: a low rumble whose attack softens and whose tail lengthens with
    // distance — a near strike cracks, a far one rolls.
    thunder(far: number): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420 - far * 300; lp.Q.value = 0.7;
      const g = ctx.createGain();
      const dur = 0.9 + far * 2.6, atk = 0.005 + far * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 - far * 0.32, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp); lp.connect(g); g.connect(outBus);
      src.start(t); src.stop(t + dur + 0.1);
    },
    // A stone spat out from under a tire — sharp, pitched, very short.
    stone(): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1100 + Math.random() * 2600; bp.Q.value = 4 + Math.random() * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 + Math.random() * 0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.06);
      src.connect(bp); bp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + 0.14);
    },
    /**
     * A LANDING IS THE SAME BOX BEING HIT. The old thud was a lowpassed
     * burst with none of the truck in it: its gain clamped at 0.5 from a
     * fifth of the way up the range, so a hop and a drop were the same
     * loudness, and a wall hit rang chassis modes a landing never had, as
     * if two vehicles were involved. The burst is now the strike alone and
     * the crash's own two modes carry the body, both scaled continuously
     * with the force the suspension reported (0..3, see the bump stops).
     */
    thud(force: number): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime, f = clamp(force / 3, 0, 1);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 220 + f * 540;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14 + f * 0.42, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 + f * 0.12);
      src.connect(bp); bp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + 0.35);
      ringModes(t, 0.25 + f * 0.75, [[58 + Math.random() * 16, 9, 0.42, 0.4], [132 + Math.random() * 30, 7, 0.26, 0.3]]);
    },
    // ── the rig meeting the world ──────────────────────────────────
    /**
     * THE RIG MEETING THE WORLD, AND LOSING SOMETHING TO IT.
     *
     * A collision is not an impact, it is an EVENT WITH A SHAPE: the strike,
     * the shell ringing under it, metal giving way, the grinding as momentum
     * drags the damage along, and the bits coming to rest. The old one had the
     * first two only, over inside 300ms, with a bright 1.5k clatter on top —
     * which from the seat read as a large stone thrown against the door rather
     * than the rig folding around something. Reported that way, and right.
     *
     * Five layers, and what separates a knock from a wreck is mostly HOW LONG
     * the world keeps making noise about it, so force lengthens the event as
     * well as loudening it: half a second for a scrape, a second and a half
     * for a real one.
     */
    crash(force: number, kind: ImpactKind = 'shell'): void {
      // The ledger first, the loudspeaker second — a muted or headless run
      // still records what the physics charged.
      if (force >= 0.2) {
        impactLog.push({ t: Math.round(performance.now()), kind, force: +clamp(force, 0, 1).toFixed(2) });
        if (impactLog.length > 60) impactLog.shift();
      }
      if (!live() || !ctx || !master) return;
      const now = performance.now();
      // A light knock may repeat quickly; a heavy one holds the floor, or a
      // tumble down a bank arrives as mush instead of a sequence of hits.
      if (now - crashAt < 260 + force * 340 || force < 0.2) return;
      crashAt = now;
      const ac = ctx;                        // narrowed once, for the closures
      const f = clamp(force, 0, 1);
      const t = ac.currentTime;
      const dur = 0.5 + f * 0.95;
      /** A noise voice, detuned per hit — the same wreck twice is a sample. */
      const noise = (rate = 1): AudioBufferSourceNode => {
        const s2 = ac.createBufferSource();
        s2.buffer = noiseBuf; s2.loop = true;
        s2.playbackRate.value = rate * (0.82 + Math.random() * 0.36);
        return s2;
      };
      // 1 · THE STRIKE. Broadband, gone in a blink. On its own this IS the old
      // sound; here it is only the leading edge of one.
      {
        const src = noise();
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.value = 2600 + f * 1800;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.28 + f * 0.34, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(lp); lp.connect(g); g.connect(nearBus);
        src.start(t); src.stop(t + 0.07);
      }
      // 2 · THE BODY OF THE SOUND — two voices, and the TRUCK is always one
      // of them: its steel box has two low modes rung by ANY strike. What
      // was hit adds its own on top — a guard rail rings bright and long, a
      // tuning fork bolted to posts; stone adds one dead extra thump and
      // nothing more. (The first cut swapped the chassis out for the stone,
      // and a boulder strike came back from the seat as "a dull thud" — the
      // rock does not sing about being hit, but the truck folding around it
      // still does.)
      const modes: Array<[number, number, number, number]> = [
        [58 + Math.random() * 16, 9, 0.42, 0.55], [132 + Math.random() * 30, 7, 0.26, 0.4],
      ];
      if (kind === 'metal') {
        modes.push([330 + Math.random() * 140, 15, 0.24, 0.6],
          [880 + Math.random() * 320, 13, 0.17, 0.7], [1650 + Math.random() * 500, 11, 0.09, 0.55]);
      }
      if (kind === 'stone') modes.push([64 + Math.random() * 18, 3, 0.5, 0.3]);
      ringModes(t, f, modes);
      // 3 · THE BUCKLE. Metal yielding is PITCH THAT FALLS: the panel gives,
      // and what was ringing at one frequency is suddenly ringing lower. A
      // light knock buckles nothing, so this layer only shows up under load.
      // It is the TRUCK'S panel folding, whatever it folded around — a rock
      // dents the wing exactly as hard as a wall does.
      if (f > 0.32) {
        const osc = ac.createOscillator(); osc.type = 'sawtooth';
        const f0 = 150 + Math.random() * 90;
        osc.frequency.setValueAtTime(f0, t + 0.01);
        osc.frequency.exponentialRampToValueAtTime(f0 * 0.34, t + 0.1 + f * 0.22);
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.value = 520; lp.Q.value = 3;
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 + f * 0.13, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + f * 0.3);
        osc.connect(lp); lp.connect(g); g.connect(nearBus);
        osc.start(t); osc.stop(t + 0.22 + f * 0.32);
      }
      // 4 · THE GRAUNCH. Momentum drags the damage along whatever it hit, and
      // that is a GRITTY, IRREGULAR band — chopped into grains on purpose,
      // because a smooth envelope over the same noise is just wind. The steps
      // are the whole character of the layer.
      {
        const src = noise(kind === 'stone' ? 0.9 : 1.3);
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
        // Metal grinds bright, rubble grinds LOW — dragged gravel, not paint.
        bp.frequency.setValueAtTime((kind === 'metal' ? 2100 : kind === 'stone' ? 800 : 1500) + Math.random() * 700, t);
        bp.frequency.exponentialRampToValueAtTime(kind === 'stone' ? 240 : 420, t + dur);
        bp.Q.value = 1.1;
        const g = ac.createGain();
        const peak = 0.06 + f * 0.2;
        g.gain.setValueAtTime(0.0001, t);
        const steps = Math.round(dur / 0.045);
        for (let i2 = 1; i2 < steps; i2++) {
          const st = t + i2 * 0.045;
          const fade = 1 - i2 / steps;
          g.gain.setValueAtTime(Math.max(0.0002, peak * fade * (0.25 + Math.random())), st);
        }
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
        src.connect(bp); bp.connect(g); g.connect(nearBus);
        src.start(t + 0.02); src.stop(t + dur + 0.08);
      }
      // 5 · THE SETTLING. Trim, grit and panels finding their rest — scattered
      // ticks across the tail, thinning as it goes. The reason a wreck sounds
      // finished rather than cut off.
      // Stone settles as RUBBLE — more pieces, heavier, duller — where a car
      // sheds a few bright bits of trim.
      const bits = Math.round((kind === 'stone' ? 4 : 2) + f * (kind === 'stone' ? 9 : 6));
      for (let i2 = 0; i2 < bits; i2++) {
        const at = t + 0.12 + Math.random() * dur;
        const src = noise();
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = (kind === 'stone' ? 420 : 700) + Math.random() * (kind === 'stone' ? 1100 : 1900);
        bp.Q.value = (kind === 'stone' ? 3 : 5) + Math.random() * 7;
        const g = ac.createGain();
        const late = clamp(1 - (at - t) / (dur + 0.1), 0.15, 1);
        g.gain.setValueAtTime((0.03 + Math.random() * 0.05) * (0.4 + f) * late, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + Math.random() * 0.07);
        src.connect(bp); bp.connect(g); g.connect(nearBus);
        src.start(at); src.stop(at + 0.14);
      }
    },
    /** The chassis working — a short low groan for hits that flex the
     *  suspension without bottoming it. */
    creak(force: number): void {
      if (!live() || !ctx || !master) return;
      const now = performance.now();
      if (now - creakAt < 220) return;
      creakAt = now;
      // −49 dBFS at its old level: a sawtooth sweeping OUT of a narrow
      // bandpass, at a tenth of the gain, for 160 ms — the groan nobody had
      // heard. A lowpass keeps the fundamental as it falls, and the level
      // and length now say a chassis is working rather than a hinge.
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120 + force * 50, t);
      osc.frequency.exponentialRampToValueAtTime(58, t + 0.24);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(force * 0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(lp); lp.connect(g); g.connect(nearBus);
      osc.start(t); osc.stop(t + 0.32);
    },
    /** Hitting water at speed: a broad wet slap, then the wash channel
     *  carries the rest. */
    splash(force: number): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.min(0.5, 0.2 + force * 0.35), t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      src.connect(lp); lp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + 0.55);
    },
    /** Continuous channels, set every frame from tick like everything in
     *  update(): 0 releases them. */
    /** Foliage against the panels, continuous like scrape — 0 releases it. */
    brush(level: number): void {
      if (!live() || !ctx || !brushGain) return;
      const t = ctx.currentTime;
      brushGain.gain.setTargetAtTime(Math.min(level, 1) * 0.17 * m('brush'), t, 0.07);
      brushFilt.frequency.setTargetAtTime(2000 + Math.min(level, 1) * 900, t, 0.1);
    },
    /** One stem giving way. Woody is a TRUNK — a knock with a snap on top,
     *  the sound of the bull bar finding the one hard thing in the hedge;
     *  leafy is a whip of twigs dragged over the roof. */
    whip(force: number, woody: boolean): void {
      if (force >= 0.2 && woody) {
        impactLog.push({ t: Math.round(performance.now()), kind: 'wood', force: +clamp(force, 0, 1).toFixed(2) });
        if (impactLog.length > 60) impactLog.shift();
      }
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const f = clamp(force, 0, 1);
      if (woody) {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = 150 + Math.random() * 70; bp.Q.value = 5;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.12 + f * 0.22, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        src.connect(bp); bp.connect(g); g.connect(nearBus);
        src.start(t); src.stop(t + 0.2);
      }
      const snap = ctx.createBufferSource(); snap.buffer = noiseBuf; snap.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
      hp.frequency.value = woody ? 1300 : 1700;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime((woody ? 0.1 : 0.05) + f * 0.1, t);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + (woody ? 0.06 : 0.13));
      snap.connect(hp); hp.connect(g2); g2.connect(nearBus);
      snap.start(t); snap.stop(t + 0.16);
    },
    /** `bright` is the MATERIAL under the bodywork: 0.35 is concrete and
     *  masonry, 1 is a steel rail — the same drag reads as a grind on one
     *  and a screech on the other. */
    scrape(level: number, bright = 0.35): void {
      if (!live() || !ctx || !scrapeGain) return;
      const t = ctx.currentTime;
      scrapeLast = level;   // the sidechain in update() reads this
      // 0.55, third raise — but the real change is the sidechain: this is
      // the one sound telling you the paint is going, and the bed now makes
      // room for it instead of burying every raise.
      scrapeGain.gain.setTargetAtTime(level * 0.55 * m('scrape'), t, 0.05);
      scrapeFilt.frequency.setTargetAtTime(340 + bright * 640 + level * 620, t, 0.08);
    },
    /**
     * ── ENCLOSURE: A CEILING, NOT A VOLUME ──
     *
     * `enc` is 0 under open sky and 1 inside a bore. What it does is what a
     * tunnel does: the world outside is muffled and turned down (a lowpass
     * closing from 20 kHz to 900 Hz over `outBus`), and the truck's own noise
     * comes back at it (a 55 ms slap with feedback on `nearBus`). Those are
     * the two halves people actually recognise — the second is why a tunnel
     * feels loud even though less sound is reaching you.
     *
     * The glide is long on purpose. A portal is a hard edge in geometry and a
     * soft one in air: you hear a tunnel a moment before you are in it and for
     * a moment after you leave, and snapping the filter at the portal reads as
     * a bug rather than as an entrance.
     */
    space(enc: number, cab = 0, parked = 0): void {
      cabin = clamp(cab, 0, 1); enclosure = clamp(enc, 0, 1); parkedL = clamp(parked, 0, 1);
      if (!live() || !ctx || !outBus) return;
      const t = ctx.currentTime, e = clamp(enc, 0, 1);
      // THE WINDOW COMES DOWN. Parked with the key out, the cab still took
      // 4.7 dB off the world and shut it above 4.8 kHz — the one moment a
      // driver stops to listen was the moment they could not. A driver who
      // has stopped has the window down; the shell closes again as the
      // engine catches and the truck moves off.
      const cabF = cabin * (1 - parkedL * 0.8);
      outLP.frequency.setTargetAtTime((20000 - e * 19100) * (1 - cabF * 0.76), t, 0.45);
      outBus.gain.setTargetAtTime((1 - e * 0.6) * (1 - cabF * 0.42), t, 0.45);
      slapSend.gain.setTargetAtTime(e * 0.34, t, 0.45);
    },
    /**
     * THE DRONE, HEARD. It never had a voice — every revision was searched.
     * `spool` 0..1 is the rotors, `load` 0..1 how hard they are working (a
     * climb, a dash, a lean), `dist` metres from the listener and `bearing`
     * −1..1 which ear, in the truck's frame; `own` is the drone view, where
     * the listener is riding it and distance does not apply. −20 dBFS on
     * board at full spool; a hover ten metres off the rack is −26, forty
     * metres is a mosquito, which is right for a small quad.
     */
    drone(spool: number, dist: number, load: number, bearing = 0, own = false): void {
      if (!live() || !ctx || !droneGain) return;
      const t = ctx.currentTime, sp = clamp(spool, 0, 1), ld = clamp(load, 0, 1);
      // Blade-pass: four rotors a hair apart beat against each other, and
      // the pitch climbs with the spool and again under load.
      const f0 = 62 + sp * 58 + ld * 22;
      droneOscA.frequency.setTargetAtTime(f0, t, 0.12);
      droneOscB.frequency.setTargetAtTime(f0 * 1.027, t, 0.12);
      droneOscC.frequency.setTargetAtTime(f0 * 2.01, t, 0.12);
      const near = own ? 1 : 1 / (1 + Math.pow(Math.max(dist, 0) / 10, 2));
      // Air takes the top off a distant machine before it takes the level.
      droneFilt.frequency.setTargetAtTime((650 + sp * 500 + ld * 300) * (own ? 1 : 0.55 + 0.45 * near), t, 0.15);
      droneGain.gain.setTargetAtTime(lvl(UNIT.drone, TARGETS.drone) * Math.pow(sp, 1.6) * (0.7 + 0.3 * ld) * near * m('drone'), t, 0.1);
      whooshGain.gain.setTargetAtTime(sp * sp * (0.15 + ld * 0.25) * (own ? 1.4 : 1), t, 0.15);
      if (dronePan) dronePan.pan.setTargetAtTime(own ? 0 : clamp(bearing, -1, 1) * 0.6, t, 0.3);
    },
    water(level: number): void {
      if (!live() || !ctx || !waterGain) return;
      const t = ctx.currentTime;
      waterGain.gain.setTargetAtTime(level * 0.3 * m('water'), t, 0.09);
      waterFilt.frequency.setTargetAtTime(380 + level * 280, t, 0.12);
    },
  };
}
