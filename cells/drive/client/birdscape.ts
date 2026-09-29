/**
 * ── BIRDSCAPE: Sentinels engine, lifted for drive ──
 *
 * Extracted from christopherdebeer/sentinels (index.html web engine v1.1).
 * Pure synthesis, no samples. Owns no world state — every continuous
 * parameter arrives via set(). Connect to any AudioNode (drive's outBus).
 *
 * Cohorts: uk-garden (8 voices), nz-bush (6 voices). Density 0–1 drives
 * cadence + emit probability; enclosure / cabin attenuate. Spatial per
 * strophe: pan + distance (air-absorption lowpass). Optional listener
 * motion enables a simple Doppler shift on new strophes.
 *
 * See sentinels audio/voices.md and the original scheduler for literature
 * grounding. This file is the drive-shaped surface over that work.
 *
 * EXPAND — habitat-driven chorus beyond birds:
 * The same scheduler + spatial chain can host frogs, crickets, cicadas,
 * and other ambient fauna once profiles exist. Drive already knows the
 * habitat (climate, vegetation, inland water, time-of-day / sun altitude,
 * rain). A future cohort (or parallel layer) should key off those signals
 * rather than a fixed species list: e.g. cicadas when hot + dry canopy,
 * frogs when near water at dusk, crickets on open ground after dark.
 * Templates would add pulse-train / chirp-rate primitives beside the
 * existing warble/trill/mechanical set; density and gap curves stay.
 * Keep birds as one cohort family; do not fold insects into the same
 * antiphonal rules — their timing statistics differ.
 */

import { clamp } from './num';

export type BirdCohort = 'uk-garden' | 'nz-bush';

export interface BirdscapeParams {
  /** 0 silent → 0.5 naturalistic → 1 saturated chorus */
  density?: number;
  /** 0 open sky → 1 enclosed (tunnel / dense canopy) — lowers rate + brightens less */
  enclosure?: number;
  /** 0 outside → 1 in cab — further attenuation of the habitat layer */
  cabin?: number;
  /** overall level multiplier, default 1 */
  gain?: number;
  /** which cohort is singing */
  cohort?: BirdCohort;
}

export interface ListenerPose {
  /** metres from the imagined habitat centre; 0 = at the birds */
  distance?: number;
  /** −1 left … +1 right, in the truck's frame */
  bearing?: number;
  /** listener velocity along the line to the source, m/s (positive = approaching) */
  radialSpeed?: number;
}

interface SpeciesProfile {
  label: string;
  template: string;
  strophe: { dur?: [number, number]; gap: [number, number] };
  amp: number;
  antiphonal: number;
  overlapAvoid: number;
  harmonics?: number;
  partialGains?: number[];
  // template-specific fields kept loose
  [k: string]: unknown;
}

interface VoiceState {
  nextStropheAt: number;
  activeUntil: number;
  pan: number;
  distance: number;
  holdUntil: number;
}

interface SpatialPos {
  pan: number;
  distance: number;
}

// ── Species profiles (literature-grounded; see sentinels audio/voices.md) ──

const SPECIES: Record<string, SpeciesProfile> = {
  robin: {
    label: 'robin', template: 'continuous-warble',
    strophe: { dur: [2.0, 2.8], gap: [2.0, 6.0] },
    syllable: { count: [4, 10], gap: [0.08, 0.16], dur: [0.08, 0.18] },
    freq: { peak: 4000, range: [3200, 6500], harmonics: 3 },
    amp: 0.16, antiphonal: 0.5, overlapAvoid: 0.6, harmonics: 3,
  },
  blackbird: {
    label: 'blackbird', template: 'motif-shrill',
    strophe: { dur: [3.0, 5.0], gap: [3.0, 10.0] },
    motif: { dur: [1.5, 2.5], freq: [1500, 3000], harmonics: 2, syllables: [3, 6] },
    shrill: { dur: [0.4, 0.8], freq: [4000, 6000], harmonics: 3, syllables: [3, 7] },
    amp: 0.14, antiphonal: 0.4, overlapAvoid: 0.5, harmonics: 2,
    partialGains: [1.0, 0.55, 0.18, 0.06],
  },
  songThrush: {
    label: 'song thrush', template: 'repeating-phrase',
    strophe: { dur: [4.0, 8.0], gap: [4.0, 12.0] },
    phrase: { dur: [0.3, 0.7], period: [0.5, 1.0], repeats: [2, 5], freq: [2000, 4500] },
    amp: 0.13, antiphonal: 0.35, overlapAvoid: 0.5, harmonics: 3,
  },
  greatTit: {
    label: 'great tit', template: 'two-note-motif',
    strophe: { gap: [2.5, 8.0] },
    motif: { low: [2800, 3200], high: [3800, 4200], dur: [0.12, 0.18], pairs: [3, 8] },
    amp: 0.12, antiphonal: 0.45, overlapAvoid: 0.4, harmonics: 2,
  },
  wren: {
    label: 'wren', template: 'trill-song',
    strophe: { dur: [3.0, 5.5], gap: [5.0, 15.0] },
    preamble: { clicks: [2, 5] },
    trill: { rate: [12, 18], freq: [4500, 7000], dur: [0.03, 0.05] },
    amp: 0.11, antiphonal: 0.3, overlapAvoid: 0.55, harmonics: 2,
  },
  blueTit: {
    label: 'blue tit', template: 'descending-trill',
    strophe: { dur: [1.5, 2.5], gap: [4.0, 12.0] },
    intro: { freq: 6500, dur: 0.12, count: [2, 3] },
    trill: { rate: [10, 14], freqStart: 6000, freqEnd: 4000, dur: 0.08 },
    amp: 0.10, antiphonal: 0.35, overlapAvoid: 0.4, harmonics: 2,
  },
  dunnock: {
    label: 'dunnock', template: 'continuous-warble',
    strophe: { dur: [1.5, 2.5], gap: [4.0, 12.0] },
    syllable: { count: [6, 14], gap: [0.05, 0.10], dur: [0.05, 0.12] },
    freq: { peak: 5000, range: [4000, 7000], harmonics: 2 },
    amp: 0.09, antiphonal: 0.25, overlapAvoid: 0.4, harmonics: 2,
  },
  contactCalls: {
    label: 'contact calls', template: 'contact-call',
    strophe: { gap: [3.0, 12.0] },
    call: { dur: [0.05, 0.15], freq: [3500, 7000] },
    amp: 0.08, antiphonal: 0.2, overlapAvoid: 0.3, harmonics: 2,
  },
  // NZ native bush
  korimako: {
    label: 'korimako', template: 'mixed-warble',
    strophe: { dur: [2.5, 5.0], gap: [3.0, 10.0] },
    amp: 0.17, antiphonal: 0.55, overlapAvoid: 0.5, harmonics: 2,
    partialGains: [1.0, 0.12, 0.04, 0.02], // bell-pure
  },
  tui: {
    label: 'tūī', template: 'mixed-warble',
    strophe: { dur: [3.0, 6.0], gap: [4.0, 14.0] },
    click: { fc: [3500, 6500], bw: 2500, dur: [0.008, 0.020] },
    rough: { fc: [1500, 3500], bw: 1500, dur: [0.030, 0.090] },
    whirr: { fc: [1200, 2800], modRate: [35, 70], dur: [0.10, 0.30] },
    amp: 0.18, antiphonal: 0.5, overlapAvoid: 0.5, harmonics: 3,
  },
  kereru: {
    label: 'kererū', template: 'flight-event',
    strophe: { gap: [25, 90] },
    flight: { rate: [3, 5], pulseDur: [0.05, 0.09], fc: [200, 600], bw: 400, dur: [1.5, 3.5] },
    amp: 0.13, antiphonal: 0.0, overlapAvoid: 0.2,
  },
  piwakawaka: {
    label: 'pīwakawaka', template: 'contact-call',
    strophe: { gap: [3.0, 10.0] },
    call: { dur: [0.04, 0.12], freq: [4500, 7500] },
    amp: 0.10, antiphonal: 0.3, overlapAvoid: 0.3, harmonics: 2,
  },
  riroriro: {
    label: 'riroriro', template: 'descending-trill',
    strophe: { dur: [2.0, 4.0], gap: [4.0, 12.0] },
    intro: { freq: 5500, dur: 0.18, count: [1, 2] },
    trill: { rate: [4, 7], freqStart: 5200, freqEnd: 3800, dur: 0.15 },
    amp: 0.12, antiphonal: 0.4, overlapAvoid: 0.5, harmonics: 2,
  },
  contactCallsNZ: {
    label: 'contact calls', template: 'contact-call',
    strophe: { gap: [4.0, 14.0] },
    call: { dur: [0.05, 0.18], freq: [3500, 7500] },
    amp: 0.09, antiphonal: 0.2, overlapAvoid: 0.3, harmonics: 2,
  },
};

interface CohortDef {
  label: string;
  species: string[];
  weights: Record<string, number>;
  spatial: Record<string, { panMean: number; panSpread: number; distMean: number; distSpread: number }>;
}

const COHORTS: Record<BirdCohort, CohortDef> = {
  'uk-garden': {
    label: 'UK garden',
    species: ['robin', 'blackbird', 'songThrush', 'greatTit', 'wren', 'blueTit', 'dunnock', 'contactCalls'],
    weights: {
      robin: 0.20, blackbird: 0.16, songThrush: 0.10, greatTit: 0.16,
      wren: 0.10, blueTit: 0.10, dunnock: 0.08, contactCalls: 0.10,
    },
    spatial: {
      robin:        { panMean:  0.00, panSpread: 0.40, distMean: 0.30, distSpread: 0.20 },
      blackbird:    { panMean: +0.55, panSpread: 0.25, distMean: 0.20, distSpread: 0.15 },
      songThrush:   { panMean: -0.40, panSpread: 0.20, distMean: 0.15, distSpread: 0.15 },
      greatTit:     { panMean: -0.30, panSpread: 0.30, distMean: 0.35, distSpread: 0.20 },
      wren:         { panMean: +0.25, panSpread: 0.35, distMean: 0.45, distSpread: 0.20 },
      blueTit:      { panMean: +0.50, panSpread: 0.25, distMean: 0.40, distSpread: 0.20 },
      dunnock:      { panMean: -0.55, panSpread: 0.25, distMean: 0.50, distSpread: 0.20 },
      contactCalls: { panMean:  0.00, panSpread: 0.60, distMean: 0.55, distSpread: 0.25 },
    },
  },
  'nz-bush': {
    label: 'NZ native bush',
    species: ['korimako', 'tui', 'kereru', 'piwakawaka', 'riroriro', 'contactCallsNZ'],
    weights: {
      korimako: 0.28, tui: 0.22, kereru: 0.08, piwakawaka: 0.18,
      riroriro: 0.14, contactCallsNZ: 0.10,
    },
    spatial: {
      korimako:       { panMean:  0.00, panSpread: 0.35, distMean: 0.25, distSpread: 0.18 },
      tui:            { panMean: +0.40, panSpread: 0.30, distMean: 0.30, distSpread: 0.20 },
      kereru:         { panMean: -0.20, panSpread: 0.40, distMean: 0.40, distSpread: 0.25 },
      piwakawaka:     { panMean: +0.55, panSpread: 0.30, distMean: 0.35, distSpread: 0.20 },
      riroriro:       { panMean: -0.50, panSpread: 0.25, distMean: 0.45, distSpread: 0.20 },
      contactCallsNZ: { panMean:  0.00, panSpread: 0.55, distMean: 0.55, distSpread: 0.25 },
    },
  },
};

const SPEED_OF_SOUND = 343; // m/s

function randn(): number {
  const u1 = Math.random() || 1e-9, u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function logNormalGap(lo: number, hi: number): number {
  const logLo = Math.log(Math.max(0.05, lo));
  const logHi = Math.log(Math.max(lo + 0.1, hi));
  const mu = (logLo + logHi) / 2;
  const sigma = (logHi - logLo) / (2 * 1.282);
  return Math.max(lo * 0.4, Math.min(hi * 2.5, Math.exp(mu + randn() * sigma)));
}

export interface Birdscape {
  /** continuous control — call every frame or every few frames */
  set(params: BirdscapeParams): void;
  /** optional listener pose for distance / bearing / simple Doppler */
  setListener(pose: ListenerPose): void;
  /** hang the whole layer off an existing node (drive outBus) */
  connect(destination: AudioNode): void;
  /** create context if needed and resume; safe to call from a gesture */
  arm(): void;
  /** start scheduling */
  start(): void;
  /** stop scheduling; leaves nodes connected */
  stop(): void;
  dispose(): void;
  /** which cohort is active */
  cohort(): BirdCohort;
  /** for the sound lab */
  levels(): { birds: number };
}

export function createBirdscape(opts?: {
  context?: AudioContext;
  cohort?: BirdCohort;
}): Birdscape {
  let ctx: AudioContext | null = opts?.context ?? null;
  let master: GainNode | null = null;
  let bus: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let connected = false;
  let playing = false;
  let timer: number | null = null;

  let density = 0.35;
  let enclosure = 0;
  let cabin = 0;
  let userGain = 1;
  let cohort: BirdCohort = opts?.cohort ?? 'uk-garden';

  let listenerDist = 0;
  let listenerBearing = 0;
  let radialSpeed = 0; // m/s toward source → positive Doppler

  const voiceState: Record<string, VoiceState> = {};
  let lastStropheEnd = 0;
  const stimulationDecay = 6.0;

  const ensure = (): boolean => {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0;
      bus = ctx.createGain();
      bus.gain.value = 1;
      bus.connect(master);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.65;
      master.connect(analyser);
      // 2 s of white noise for mechanical primitives
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return true;
  };

  const samplePosition = (name: string): SpatialPos => {
    const sp = COHORTS[cohort].spatial[name] || { panMean: 0, panSpread: 0.4, distMean: 0.4, distSpread: 0.2 };
    return {
      pan: clamp(sp.panMean + randn() * sp.panSpread, -1, 1),
      distance: clamp(sp.distMean + randn() * sp.distSpread, 0, 1),
    };
  };

  const initVoiceState = (): void => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const initSpread = 4 + (1 - density) * 40;
    for (const k of Object.keys(voiceState)) delete voiceState[k];
    for (const name of COHORTS[cohort].species) {
      const pos = samplePosition(name);
      voiceState[name] = {
        nextStropheAt: now + 0.4 + Math.random() * initSpread,
        activeUntil: 0,
        pan: pos.pan,
        distance: pos.distance,
        holdUntil: now + 20 + Math.random() * 30,
      };
    }
  };

  // ── Synthesis primitives ──

  const synthTone = (
    dest: AudioNode,
    at: number,
    dur: number,
    freqCurve: { points: Array<[number, number]> },
    amp: number,
    harmonics: number,
    partialGains?: number[],
    doppler = 1,
  ): void => {
    if (!ctx) return;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(amp, at + 0.012);
    env.gain.linearRampToValueAtTime(amp, at + dur * 0.85);
    env.gain.exponentialRampToValueAtTime(0.0008, at + dur);
    env.connect(dest);
    const gains = partialGains || [1.0, 0.40, 0.20, 0.10];
    for (let h = 1; h <= harmonics; h++) {
      const osc = ctx.createOscillator();
      const pg = ctx.createGain();
      osc.type = 'sine';
      pg.gain.value = gains[h - 1] || 0.05;
      freqCurve.points.forEach(([tFrac, f], i) => {
        const tAbs = at + tFrac * dur;
        const fScaled = Math.max(50, f * h * doppler);
        if (fScaled > 11000) return;
        if (i === 0) osc.frequency.setValueAtTime(fScaled, tAbs);
        else osc.frequency.exponentialRampToValueAtTime(fScaled, tAbs);
      });
      osc.connect(pg); pg.connect(env);
      osc.start(at); osc.stop(at + dur + 0.05);
    }
  };

  const synthClick = (dest: AudioNode, at: number, fc: number, bw: number, dur: number, amp: number): void => {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = fc / Math.max(bw, 100);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(amp, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    src.connect(bp); bp.connect(env); env.connect(dest);
    src.start(at, Math.random() * 0.5, dur + 0.02);
  };

  const synthRough = (dest: AudioNode, at: number, fc: number, bw: number, dur: number, amp: number): void => {
    if (!ctx || !noiseBuf) return;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = fc / Math.max(bw, 200);
    const env = ctx.createGain();
    const N = Math.max(8, Math.floor(dur * 200));
    const curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const shape = t < 0.15 ? t / 0.15 : t > 0.7 ? (1 - t) / 0.3 : 1;
      curve[i] = Math.max(0, amp * shape * (0.7 + 0.3 * Math.random()));
    }
    env.gain.setValueCurveAtTime(curve, at, dur);
    src.connect(bp); bp.connect(env); env.connect(dest);
    src.start(at, Math.random() * 0.5, dur + 0.02);
  };

  const synthWhirr = (dest: AudioNode, at: number, fc: number, modRate: number, dur: number, amp: number): void => {
    if (!ctx) return;
    const osc = ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(fc * 0.95, at);
    osc.frequency.linearRampToValueAtTime(fc * 1.05, at + dur);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = modRate;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = amp * 0.45;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(amp * 0.55, at + 0.03);
    env.gain.linearRampToValueAtTime(amp * 0.55, at + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    lfo.connect(lfoGain); lfoGain.connect(env.gain);
    osc.connect(env); env.connect(dest);
    osc.start(at); osc.stop(at + dur + 0.02);
    lfo.start(at); lfo.stop(at + dur + 0.02);
  };

  // ── Spatial chain for one strophe ──

  const spatialDest = (pos: SpatialPos, at: number): AudioNode => {
    if (!ctx || !bus) return bus!;
    const g = ctx.createGain();
    // distance 0 → 1.0, distance 1 → 0.45, plus listener distance falloff
    const listenAtten = 1 / Math.sqrt(1 + Math.pow(listenerDist / 25, 2));
    g.gain.value = (1.0 - 0.55 * pos.distance) * listenAtten;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (11000 - pos.distance * 7800) * (0.55 + 0.45 * listenAtten);
    lp.Q.value = 0.7;
    let panner: StereoPannerNode | null = null;
    try { panner = ctx.createStereoPanner(); } catch { /* mono */ }
    const pan = clamp(pos.pan + listenerBearing * 0.35, -1, 1);
    if (panner) panner.pan.value = pan;
    g.connect(lp);
    if (panner) { lp.connect(panner); panner.connect(bus); }
    else lp.connect(bus);
    // disconnect after the strophe so nodes can GC
    const life = 8;
    window.setTimeout(() => {
      try { g.disconnect(); lp.disconnect(); panner?.disconnect(); } catch { /* */ }
    }, life * 1000);
    return g;
  };

  const dopplerFactor = (): number => {
    // classic approximation: f' = f * (c / (c - v_radial))
    // radialSpeed > 0 means listener approaching source → higher pitch
    const v = clamp(radialSpeed, -40, 40);
    return SPEED_OF_SOUND / (SPEED_OF_SOUND - v);
  };

  // ── Strophe emitters (simplified but recognisable templates) ──

  const emitContinuousWarble = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const syl = profile.syllable as { count: [number, number]; gap: [number, number]; dur: [number, number] };
    const freq = profile.freq as { peak: number; range: [number, number]; harmonics: number };
    const n = Math.floor(syl.count[0] + Math.random() * (syl.count[1] - syl.count[0] + 1));
    let t = at;
    for (let i = 0; i < n; i++) {
      const dur = syl.dur[0] + Math.random() * (syl.dur[1] - syl.dur[0]);
      const f0 = freq.range[0] + Math.random() * (freq.range[1] - freq.range[0]);
      const f1 = freq.range[0] + Math.random() * (freq.range[1] - freq.range[0]);
      synthTone(dest, t, dur, { points: [[0, f0], [1, f1]] }, profile.amp, profile.harmonics || 3, profile.partialGains, dop);
      t += dur + syl.gap[0] + Math.random() * (syl.gap[1] - syl.gap[0]);
    }
    return t;
  };

  const emitMotifShrill = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const motif = profile.motif as { dur: [number, number]; freq: [number, number]; harmonics: number; syllables: [number, number] };
    const shrill = profile.shrill as { dur: [number, number]; freq: [number, number]; harmonics: number; syllables: [number, number] };
    let t = at;
    const mDur = motif.dur[0] + Math.random() * (motif.dur[1] - motif.dur[0]);
    const mN = Math.floor(motif.syllables[0] + Math.random() * (motif.syllables[1] - motif.syllables[0]));
    for (let i = 0; i < mN; i++) {
      const d = mDur / mN;
      const f = motif.freq[0] + Math.random() * (motif.freq[1] - motif.freq[0]);
      synthTone(dest, t, d * 0.85, { points: [[0, f], [1, f * 1.05]] }, profile.amp, motif.harmonics, profile.partialGains, dop);
      t += d;
    }
    const sN = Math.floor(shrill.syllables[0] + Math.random() * (shrill.syllables[1] - shrill.syllables[0]));
    for (let i = 0; i < sN; i++) {
      const d = (shrill.dur[0] + Math.random() * (shrill.dur[1] - shrill.dur[0])) / sN;
      const f = shrill.freq[0] + Math.random() * (shrill.freq[1] - shrill.freq[0]);
      synthTone(dest, t, d, { points: [[0, f], [1, f * 0.92]] }, profile.amp * 0.9, shrill.harmonics, profile.partialGains, dop);
      t += d + 0.02;
    }
    return t;
  };

  const emitRepeatingPhrase = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const phrase = profile.phrase as { dur: [number, number]; period: [number, number]; repeats: [number, number]; freq: [number, number] };
    const reps = Math.floor(phrase.repeats[0] + Math.random() * (phrase.repeats[1] - phrase.repeats[0]));
    let t = at;
    for (let r = 0; r < reps; r++) {
      const dur = phrase.dur[0] + Math.random() * (phrase.dur[1] - phrase.dur[0]);
      const fLo = phrase.freq[0] + Math.random() * 400;
      const fHi = phrase.freq[1] - Math.random() * 400;
      synthTone(dest, t, dur, { points: [[0, fLo], [0.5, fHi], [1, fLo]] }, profile.amp, profile.harmonics || 3, profile.partialGains, dop);
      t += phrase.period[0] + Math.random() * (phrase.period[1] - phrase.period[0]);
    }
    return t;
  };

  const emitTwoNote = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const motif = profile.motif as { low: [number, number]; high: [number, number]; dur: [number, number]; pairs: [number, number] };
    const pairs = Math.floor(motif.pairs[0] + Math.random() * (motif.pairs[1] - motif.pairs[0]));
    let t = at;
    for (let i = 0; i < pairs; i++) {
      const d = motif.dur[0] + Math.random() * (motif.dur[1] - motif.dur[0]);
      const lo = motif.low[0] + Math.random() * (motif.low[1] - motif.low[0]);
      const hi = motif.high[0] + Math.random() * (motif.high[1] - motif.high[0]);
      synthTone(dest, t, d * 0.45, { points: [[0, lo], [1, lo]] }, profile.amp, 2, profile.partialGains, dop);
      synthTone(dest, t + d * 0.5, d * 0.45, { points: [[0, hi], [1, hi]] }, profile.amp, 2, profile.partialGains, dop);
      t += d + 0.04;
    }
    return t;
  };

  const emitTrill = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const trill = profile.trill as { rate: [number, number]; freq: [number, number]; dur: [number, number] };
    const stropheDur = (profile.strophe.dur as [number, number]) || [3, 5];
    const end = at + stropheDur[0] + Math.random() * (stropheDur[1] - stropheDur[0]);
    const rate = trill.rate[0] + Math.random() * (trill.rate[1] - trill.rate[0]);
    const period = 1 / rate;
    let t = at;
    let i = 0;
    while (t < end) {
      const wave = Math.sin(i * 0.4) * 0.5 + Math.sin(i * 0.13) * 0.5;
      const fBase = (trill.freq[0] + trill.freq[1]) / 2;
      const fSpread = (trill.freq[1] - trill.freq[0]) / 2;
      const f0 = fBase + wave * fSpread * 0.6 - 200;
      const f1 = fBase + wave * fSpread * 0.6 + 200;
      const d = trill.dur[0] + Math.random() * (trill.dur[1] - trill.dur[0]);
      synthTone(dest, t, d, { points: [[0, f0], [1, f1]] }, profile.amp, profile.harmonics || 2, profile.partialGains, dop);
      t += period; i++;
    }
    return end;
  };

  const emitDescendingTrill = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const intro = profile.intro as { freq: number; dur: number; count: [number, number] };
    const trill = profile.trill as { rate: [number, number]; freqStart: number; freqEnd: number; dur: number };
    let t = at;
    const nIntro = intro.count[0] + Math.floor(Math.random() * (intro.count[1] - intro.count[0] + 1));
    for (let i = 0; i < nIntro; i++) {
      synthTone(dest, t, intro.dur, { points: [[0, intro.freq], [1, intro.freq * 0.95]] }, profile.amp, 2, profile.partialGains, dop);
      t += intro.dur + 0.04;
    }
    const rate = trill.rate[0] + Math.random() * (trill.rate[1] - trill.rate[0]);
    const steps = Math.max(3, Math.round(rate * 1.2));
    for (let i = 0; i < steps; i++) {
      const frac = i / (steps - 1);
      const f = trill.freqStart + (trill.freqEnd - trill.freqStart) * frac;
      synthTone(dest, t, trill.dur, { points: [[0, f], [1, f * 0.97]] }, profile.amp, 2, profile.partialGains, dop);
      t += trill.dur + 0.02;
    }
    return t;
  };

  const emitContact = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    const call = profile.call as { dur: [number, number]; freq: [number, number] };
    const n = 1 + Math.floor(Math.random() * 3);
    let t = at;
    for (let i = 0; i < n; i++) {
      const d = call.dur[0] + Math.random() * (call.dur[1] - call.dur[0]);
      const f = call.freq[0] + Math.random() * (call.freq[1] - call.freq[0]);
      synthTone(dest, t, d, { points: [[0, f], [1, f * 0.96]] }, profile.amp, profile.harmonics || 2, profile.partialGains, dop);
      t += d + 0.06 + Math.random() * 0.08;
    }
    return t;
  };

  const emitMixedWarble = (dest: AudioNode, profile: SpeciesProfile, at: number, dop: number): number => {
    // tonal syllables + optional mechanical for tūī
    let t = at;
    const n = 4 + Math.floor(Math.random() * 6);
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      if (profile.click && roll < 0.2) {
        const c = profile.click as { fc: [number, number]; bw: number; dur: [number, number] };
        const d = c.dur[0] + Math.random() * (c.dur[1] - c.dur[0]);
        synthClick(dest, t, c.fc[0] + Math.random() * (c.fc[1] - c.fc[0]), c.bw, d, profile.amp);
        t += d + 0.04;
      } else if (profile.whirr && roll < 0.35) {
        const w = profile.whirr as { fc: [number, number]; modRate: [number, number]; dur: [number, number] };
        const d = w.dur[0] + Math.random() * (w.dur[1] - w.dur[0]);
        synthWhirr(dest, t, w.fc[0] + Math.random() * (w.fc[1] - w.fc[0]),
          w.modRate[0] + Math.random() * (w.modRate[1] - w.modRate[0]), d, profile.amp);
        t += d + 0.05;
      } else if (profile.rough && roll < 0.5) {
        const r = profile.rough as { fc: [number, number]; bw: number; dur: [number, number] };
        const d = r.dur[0] + Math.random() * (r.dur[1] - r.dur[0]);
        synthRough(dest, t, r.fc[0] + Math.random() * (r.fc[1] - r.fc[0]), r.bw, d, profile.amp);
        t += d + 0.04;
      } else {
        const f0 = 2000 + Math.random() * 3500;
        const d = 0.08 + Math.random() * 0.14;
        synthTone(dest, t, d, { points: [[0, f0], [1, f0 * (0.9 + Math.random() * 0.2)]] },
          profile.amp, profile.harmonics || 2, profile.partialGains, dop);
        t += d + 0.06 + Math.random() * 0.1;
      }
    }
    return t;
  };

  const emitFlight = (dest: AudioNode, profile: SpeciesProfile, at: number): number => {
    if (!ctx || !noiseBuf) return at;
    const flight = profile.flight as { rate: [number, number]; pulseDur: [number, number]; fc: [number, number]; bw: number; dur: [number, number] };
    const dur = flight.dur[0] + Math.random() * (flight.dur[1] - flight.dur[0]);
    const rate = flight.rate[0] + Math.random() * (flight.rate[1] - flight.rate[0]);
    const period = 1 / rate;
    let t = at;
    while (t < at + dur) {
      const pd = flight.pulseDur[0] + Math.random() * (flight.pulseDur[1] - flight.pulseDur[0]);
      const fc = flight.fc[0] + Math.random() * (flight.fc[1] - flight.fc[0]);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = 1.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(profile.amp, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0005, t + pd);
      src.connect(bp); bp.connect(env); env.connect(dest);
      src.start(t, Math.random() * 0.3, pd + 0.02);
      t += period;
    }
    return at + dur;
  };

  const emitStrophe = (name: string, profile: SpeciesProfile, at: number, pos: SpatialPos): number => {
    const dest = spatialDest(pos, at);
    const dop = dopplerFactor();
    switch (profile.template) {
      case 'continuous-warble': return emitContinuousWarble(dest, profile, at, dop);
      case 'motif-shrill': return emitMotifShrill(dest, profile, at, dop);
      case 'repeating-phrase': return emitRepeatingPhrase(dest, profile, at, dop);
      case 'two-note-motif': return emitTwoNote(dest, profile, at, dop);
      case 'trill-song': return emitTrill(dest, profile, at, dop);
      case 'descending-trill': return emitDescendingTrill(dest, profile, at, dop);
      case 'contact-call': return emitContact(dest, profile, at, dop);
      case 'mixed-warble': return emitMixedWarble(dest, profile, at, dop);
      case 'flight-event': return emitFlight(dest, profile, at);
      default: return emitContact(dest, profile, at, dop);
    }
  };

  // ── Scheduler ──

  const scheduleAhead = (): void => {
    if (!playing || !ctx || !master) return;
    if (density <= 0.001) return;

    const now = ctx.currentTime;
    const horizon = now + 2.0;
    const driftDensity = 0.85 + 0.15 * Math.sin(now * 0.013);
    const sinceLast = now - lastStropheEnd;
    const stimulation = sinceLast < stimulationDecay ? Math.exp(-sinceLast / 2.5) * 0.8 : 0;
    const enc = enclosure;
    const effectiveDensity = density * (1 - enc * 0.55) * (1 - cabin * 0.7);
    const overlapAvoidScale = 1.0 - effectiveDensity * 0.4;
    const weights = COHORTS[cohort].weights;
    const maxW = Math.max(...Object.values(weights));

    for (const name of COHORTS[cohort].species) {
      const profile = SPECIES[name];
      const vs = voiceState[name];
      if (!profile || !vs) continue;
      if (vs.nextStropheAt > horizon) continue;

      const cohortNorm = (weights[name] || 0.1) / maxW;
      const densityCurve = effectiveDensity * (0.3 + 0.7 * effectiveDensity);
      const emitProb = Math.min(1, densityCurve * driftDensity * (1 + stimulation * profile.antiphonal) * cohortNorm);

      const otherActive = Object.entries(voiceState).some(([k, s]) => k !== name && s.activeUntil > vs.nextStropheAt);
      if (otherActive && Math.random() < profile.overlapAvoid * overlapAvoidScale) {
        const maxActive = Math.max(...Object.values(voiceState).map(s => s.activeUntil));
        vs.nextStropheAt = maxActive + 0.3 + Math.random() * 0.8;
        continue;
      }
      if (Math.random() > emitProb) {
        vs.nextStropheAt += 0.5 + Math.random() * 1.5;
        continue;
      }

      if (now > vs.holdUntil) {
        const pos = samplePosition(name);
        vs.pan = pos.pan; vs.distance = pos.distance;
        vs.holdUntil = now + 20 + Math.random() * 30;
      }

      const pos = { pan: vs.pan, distance: vs.distance };
      // small per-strophe jitter
      pos.pan = clamp(pos.pan + (Math.random() - 0.5) * 0.1, -1, 1);
      pos.distance = clamp(pos.distance + (Math.random() - 0.5) * 0.06, 0, 1);

      const stropheEnd = emitStrophe(name, profile, Math.max(vs.nextStropheAt, now + 0.05), pos);
      vs.activeUntil = stropheEnd;
      lastStropheEnd = stropheEnd;

      const gapRange = profile.strophe.gap;
      const gapScale = 5.0 - effectiveDensity * 4.6;
      const gap = logNormalGap(gapRange[0] * gapScale, gapRange[1] * gapScale);
      vs.nextStropheAt = stropheEnd + gap;
    }

    // master gain from cabin / enclosure / user
    const level = userGain * (1 - cabin * 0.55) * (1 - enclosure * 0.25);
    master.gain.setTargetAtTime(level * 0.55, now, 0.2);
  };

  const tick = (): void => {
    scheduleAhead();
    if (playing) timer = window.setTimeout(tick, 180) as unknown as number;
  };

  return {
    set(params) {
      if (params.density !== undefined) density = clamp(params.density, 0, 1);
      if (params.enclosure !== undefined) enclosure = clamp(params.enclosure, 0, 1);
      if (params.cabin !== undefined) cabin = clamp(params.cabin, 0, 1);
      if (params.gain !== undefined) userGain = clamp(params.gain, 0, 2);
      if (params.cohort && params.cohort !== cohort) {
        cohort = params.cohort;
        if (ctx) initVoiceState();
      }
    },
    setListener(pose) {
      if (pose.distance !== undefined) listenerDist = Math.max(0, pose.distance);
      if (pose.bearing !== undefined) listenerBearing = clamp(pose.bearing, -1, 1);
      if (pose.radialSpeed !== undefined) radialSpeed = pose.radialSpeed;
    },
    connect(destination) {
      if (!ensure() || !master) return;
      if (!connected) {
        master.connect(destination);
        connected = true;
      }
    },
    arm() {
      if (!ensure() || !ctx) return;
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        ctx.resume().catch(() => { /* need gesture */ });
      }
    },
    start() {
      if (!ensure() || !ctx) return;
      if (!Object.keys(voiceState).length) initVoiceState();
      playing = true;
      if (timer == null) tick();
    },
    stop() {
      playing = false;
      if (timer != null) { clearTimeout(timer); timer = null; }
      if (master && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    },
    dispose() {
      this.stop();
      try { master?.disconnect(); analyser?.disconnect(); bus?.disconnect(); } catch { /* */ }
      master = bus = analyser = null;
      connected = false;
    },
    cohort: () => cohort,
    levels() {
      if (!analyser) return { birds: -120 };
      const buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      return { birds: rms > 1e-6 ? 20 * Math.log10(rms) : -120 };
    },
  };
}
