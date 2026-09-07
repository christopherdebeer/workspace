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
  let cabin = 0, enclosure = 0;
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
    master.gain.value = on ? 0.55 : 0;
    master.connect(ctx.destination);
    // The world's bus, through the filter enclosure closes.
    outLP = ctx.createBiquadFilter(); outLP.type = 'lowpass';
    outLP.frequency.value = 20000; outLP.Q.value = 0.4;
    outBus = ctx.createGain(); outBus.gain.value = 1;
    outBus.connect(outLP); outLP.connect(master);
    // The truck's bus, and the slap-back a hard ceiling gives it. 55 ms is a
    // road tunnel's own distance — long enough to hear as a separate return,
    // short enough not to read as a cathedral.
    nearBus = ctx.createGain(); nearBus.gain.value = 1;
    nearBus.connect(master);
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
    engFilt.connect(engGain); engGain.connect(nearBus);
    engA = ctx.createOscillator(); engA.type = 'sawtooth'; engA.frequency.value = 40;
    engB = ctx.createOscillator(); engB.type = 'square'; engB.frequency.value = 60;
    const engMix = ctx.createGain(); engMix.gain.value = 0.5;
    engA.connect(engFilt); engB.connect(engMix); engMix.connect(engFilt);
    engA.start(); engB.start();
    // Tire roar: bandpassed noise, centre frequency set by the surface.
    const roarSrc = ctx.createBufferSource(); roarSrc.buffer = noiseBuf; roarSrc.loop = true;
    roarFilt = ctx.createBiquadFilter(); roarFilt.type = 'bandpass'; roarFilt.frequency.value = 300; roarFilt.Q.value = 0.7;
    roarGain = ctx.createGain(); roarGain.gain.value = 0;
    roarSrc.connect(roarFilt); roarFilt.connect(roarGain); roarGain.connect(nearBus); roarSrc.start();
    // GRIT: the gravel bed. Not steady noise — a few seconds of individual
    // stone impacts (sharp attack, short decay, random pitch), looped and
    // sped up with the truck so loose ground CRUNCHES rather than hisses.
    const gritBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const gd = gritBuf.getChannelData(0);
    const grains = Math.floor(ctx.sampleRate * 4 * 0.012); // ~530 stones/sec of loop
    for (let g = 0; g < grains; g++) {
      const at = Math.floor(Math.random() * (gd.length - 900));
      const len = 60 + Math.floor(Math.random() * 700);
      const amp = 0.25 + Math.random() * 0.75;
      const ring = 0.04 + Math.random() * 0.5; // a little pitch per stone
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-i / len) * 6);
        gd[at + i] += (Math.random() * 2 - 1) * env * amp * 0.5 + Math.sin(i * ring) * env * amp * 0.12;
      }
    }
    let peak = 0;
    for (let i = 0; i < gd.length; i++) peak = Math.max(peak, Math.abs(gd[i]));
    if (peak > 0) for (let i = 0; i < gd.length; i++) gd[i] /= peak;
    gritSrc = ctx.createBufferSource(); gritSrc.buffer = gritBuf; gritSrc.loop = true;
    gritFilt = ctx.createBiquadFilter(); gritFilt.type = 'bandpass'; gritFilt.frequency.value = 1400; gritFilt.Q.value = 0.5;
    gritGain = ctx.createGain(); gritGain.gain.value = 0;
    gritSrc.connect(gritFilt); gritFilt.connect(gritGain); gritGain.connect(nearBus); gritSrc.start();
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
    sqSrc.start(); squealOsc.start();
    // Wind: highpassed noise that climbs with the square of speed.
    const windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilt = ctx.createBiquadFilter(); windFilt.type = 'highpass'; windFilt.frequency.value = 900;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilt); windFilt.connect(windGain); windGain.connect(outBus); windSrc.start();
    // Scrape: the continuous half of a collision — bodywork dragged along a
    // wall or rail. A mid bandpass with some bite; gain rides contact + speed.
    const scSrc = ctx.createBufferSource(); scSrc.buffer = noiseBuf; scSrc.loop = true;
    scrapeFilt = ctx.createBiquadFilter(); scrapeFilt.type = 'bandpass';
    scrapeFilt.frequency.value = 640; scrapeFilt.Q.value = 2.4;
    scrapeGain = ctx.createGain(); scrapeGain.gain.value = 0;
    scSrc.connect(scrapeFilt); scrapeFilt.connect(scrapeGain); scrapeGain.connect(nearBus); scSrc.start();
    // Water: the wash of a hull pushing through it — low, wide, speed-driven.
    const waSrc = ctx.createBufferSource(); waSrc.buffer = noiseBuf; waSrc.loop = true;
    waterFilt = ctx.createBiquadFilter(); waterFilt.type = 'bandpass';
    waterFilt.frequency.value = 420; waterFilt.Q.value = 0.8;
    waterGain = ctx.createGain(); waterGain.gain.value = 0;
    waSrc.connect(waterFilt); waterFilt.connect(waterGain); waterGain.connect(nearBus); waSrc.start();
    // ── the world without the car ──
    // Rustle: leaves as high thin noise the wind pushes around; River: the
    // steady wide wash of moving water nearby. Both live under everything
    // and only surface when the truck lets them (see ambience()).
    const ruSrc = ctx.createBufferSource(); ruSrc.buffer = noiseBuf; ruSrc.loop = true;
    rustleFilt = ctx.createBiquadFilter(); rustleFilt.type = 'bandpass';
    rustleFilt.frequency.value = 1750; rustleFilt.Q.value = 0.5;
    rustleGain = ctx.createGain(); rustleGain.gain.value = 0;
    ruSrc.connect(rustleFilt); rustleFilt.connect(rustleGain); rustleGain.connect(outBus); ruSrc.start();
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
    rvSrc.start();
    // Rain has two scales: a fine outdoor wash and resolved drops on the
    // roof. Both are persistent voices; weather only changes their envelopes.
    const rainSrc = ctx.createBufferSource(); rainSrc.buffer = noiseBuf; rainSrc.loop = true;
    const rainHP = ctx.createBiquadFilter(); rainHP.type = 'highpass'; rainHP.frequency.value = 1800;
    rainGain = ctx.createGain(); rainGain.gain.value = 0;
    rainSrc.connect(rainHP); rainHP.connect(rainGain); rainGain.connect(outBus); rainSrc.start();
    const rainBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    rainBuf.getChannelData(0).set(rainPattern(ctx.sampleRate));
    const roofSrc = ctx.createBufferSource(); roofSrc.buffer = rainBuf; roofSrc.loop = true;
    const roofLP = ctx.createBiquadFilter(); roofLP.type = 'lowpass'; roofLP.frequency.value = 2400;
    roofGain = ctx.createGain(); roofGain.gain.value = 0;
    roofSrc.connect(roofLP); roofLP.connect(roofGain); roofGain.connect(nearBus); roofSrc.start();
    // Brush: FOLIAGE ON THE BODYWORK — higher and thinner than the rustle
    // bed, because these leaves are against the panels, not across the
    // valley. Gain rides contact + speed like the scrape it is cousin to.
    const brSrc = ctx.createBufferSource(); brSrc.buffer = noiseBuf; brSrc.loop = true;
    brushFilt = ctx.createBiquadFilter(); brushFilt.type = 'bandpass';
    brushFilt.frequency.value = 2400; brushFilt.Q.value = 0.7;
    brushGain = ctx.createGain(); brushGain.gain.value = 0;
    brSrc.connect(brushFilt); brushFilt.connect(brushGain); brushGain.connect(nearBus); brSrc.start();
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
        // The room, so a test can assert a tunnel rather than describe one.
        // Before `build()` these read as OPEN SKY rather than as zero: an
        // unbuilt filter is not a shut one, and a mix read before the first
        // gesture should not say the truck is in a bore.
        out: outBus ? g(outBus) : 1, slap: g(slapSend),
        muffle: Math.round(outLP?.frequency.value ?? 20000),
        riverAt: +(riverPan?.pan.value ?? 0).toFixed(2) };
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
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
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
      q = 1, spin = 0, ambWind = 0, engF = 1): void {
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
          + (1 - grounded) * rev * 0.1 + Math.min(v / 60, 0.1)) * engF * duck, t, 0.09,
      );
      // Rubber that has stopped rolling — the levels were derived up top;
      // here it just sings at its pitch.
      const sf = 1250 + Math.min(v * 14, 620) + sq2 * 260;
      squealFilt.frequency.setTargetAtTime(sf, t, 0.08);
      squealOsc.frequency.setTargetAtTime(sf, t, 0.08);
      squealGain.gain.setTargetAtTime(sqT, t, 0.06);
      // Tarmac hisses high and thin; loose ground growls low and loud. A graded
      // track sits between the two — you can hear which tier you are on.
      const road = surf === 'road';
      // HOW HARD THE GROUND IS, continuously. This is the number the ear reads
      // as "what am I driving on" before the handling has said anything: a
      // high thin hiss on new tarmac, sliding down to a low growl as the
      // surface coarsens, and gone altogether on open ground.
      const hard = surf === 'water' ? 0 : surf === 'road' || surf === 'track'
        ? clamp(q, 0, 1) : 0.08;
      roarFilt.frequency.setTargetAtTime(320 + hard * 830, t, 0.12);
      roarGain.gain.setTargetAtTime(Math.min(v / 34, 1) * (0.26 - hard * 0.16) * grounded * duck, t, 0.1);
      // Rain rides the wind channel: same filtered noise, opened up and
      // lifted — and so does the WEATHER'S wind, which blows whether or not
      // the truck moves: a parked truck on a gusty pass is not silent.
      windFilt.frequency.setTargetAtTime(900 - rainAmt * 500 - ambWind * 250, t, 0.4);
      windGain.gain.setTargetAtTime(
        Math.min((v * v) / 2600, 0.9) * 0.13 + rainAmt * 0.16 + ambWind * 0.09, t, 0.15);
      // Gravel: absent on tarmac, dominant off it. Rate (playbackRate) AND
      // level rise with speed, so the crunch density tracks the wheels.
      // …and the grit is its complement, plus whatever the wheels are throwing
      // up because they have stopped hooking up. A spinning wheel on gravel is
      // the loudest thing the truck does.
      const loose = surf === 'water' ? 0.12
        : clamp(1 - Math.pow(clamp(q, 0, 1), 1.25), 0, 1) * (surf === 'ground' ? 1 : 0.92);
      gritSrc.playbackRate.setTargetAtTime(0.55 + Math.min(v / 26, 1.35), t, 0.12);
      gritFilt.frequency.setTargetAtTime(surf === 'water' ? 700 : 900 + Math.min(v * 26, 1400), t, 0.15);
      // Off the tarmac the grit IS the feedback — it is how a surface change
      // announces itself before the handling does — and at 0.3 it sat under the
      // engine at every speed that mattered.
      gritGain.gain.setTargetAtTime(
        (Math.min(v / 12, 1) * 0.46 * loose + spin * 0.3 * (0.25 + 0.75 * loose)) * grounded * duck, t, 0.09);
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
    ambience(rustle: number, river: number, birds: number, gusty: number, froth = 0, riverAt = 0): void {
      if (!live() || !ctx || !master || !rustleGain) return;
      const t = ctx.currentTime;
      rustleGain.gain.setTargetAtTime(rustle * 0.14, t, 0.5);
      rustleFilt.frequency.setTargetAtTime(1300 + gusty * 900, t, 0.8);
      // `froth` is the water's CHARACTER, from the same probes that found
      // it: 0 is still water lapping low and wide, 1 is rapids — brighter,
      // narrower, and a shade louder for the same nearness.
      riverGain.gain.setTargetAtTime(river * (0.16 + froth * 0.12), t, 0.6);
      // `riverAt` is −1 hard left through +1 hard right, in the TRUCK's frame,
      // and it glides slowly: water does not jump across the road, and a pan
      // that chases a noisy bearing is worse than no pan at all. Held short of
      // the hard edges — a river fully in one ear is a headphone effect, not a
      // valley.
      if (riverPan) riverPan.pan.setTargetAtTime(clamp(riverAt, -1, 1) * 0.75, t, 0.7);
      riverFilt.frequency.setTargetAtTime(340 + froth * 520, t, 0.9);
      riverFilt.Q.setTargetAtTime(0.8 - froth * 0.3, t, 0.9);
      if (on && birds > 0.03) {
        const nowP = performance.now();
        if (nowP > birdAt) {
          birdAt = nowP + 1500 + (Math.random() * 9000) / (0.15 + birds);
          const notes = 2 + Math.floor(Math.random() * 4);
          const base = 2300 + Math.random() * 1700;
          let at = t + Math.random() * 0.2;
          for (let i = 0; i < notes; i++) {
            const osc = ctx.createOscillator(); osc.type = 'sine';
            const f0 = base * (0.9 + Math.random() * 0.25);
            osc.frequency.setValueAtTime(f0, at);
            osc.frequency.exponentialRampToValueAtTime(
              f0 * (0.82 + Math.random() * 0.4), at + 0.05 + Math.random() * 0.05);
            const g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, at);
            g.gain.exponentialRampToValueAtTime(0.008 + 0.035 * clamp(birds, 0, 1), at + 0.015);
            g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + Math.random() * 0.07);
            osc.connect(g); g.connect(outBus);
            osc.start(at); osc.stop(at + 0.16);
            at += 0.07 + Math.random() * 0.12;
          }
        }
      }
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
    // A short filtered burst — landings, kerb strikes, scrapes.
    thud(force: number): void {
      if (!live() || !ctx || !master) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 220 + force * 180;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, force * 0.42), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      src.connect(bp); bp.connect(g); g.connect(nearBus);
      src.start(t); src.stop(t + 0.3);
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
      for (const [hz, q, amp, len] of modes) {
        const src = noise();
        const bp = ac.createBiquadFilter(); bp.type = 'bandpass';
        bp.frequency.value = hz; bp.Q.value = q;
        const g = ac.createGain();
        g.gain.setValueAtTime(Math.min(0.6, amp * (0.4 + f)), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len + f * 0.5);
        src.connect(bp); bp.connect(g); g.connect(nearBus);
        src.start(t); src.stop(t + len + f * 0.55);
      }
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
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110 + force * 40, t);
      osc.frequency.exponentialRampToValueAtTime(62, t + 0.14);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 260; bp.Q.value = 2.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(force * 0.11, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(bp); bp.connect(g); g.connect(nearBus);
      osc.start(t); osc.stop(t + 0.18);
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
      brushGain.gain.setTargetAtTime(Math.min(level, 1) * 0.17, t, 0.07);
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
      scrapeGain.gain.setTargetAtTime(level * 0.55, t, 0.05);
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
    space(enc: number): void {
      if (!live() || !ctx || !outBus) return;
      const t = ctx.currentTime, e = clamp(enc, 0, 1);
      outLP.frequency.setTargetAtTime(20000 - e * 19100, t, 0.45);
      outBus.gain.setTargetAtTime(1 - e * 0.6, t, 0.45);
      slapSend.gain.setTargetAtTime(e * 0.34, t, 0.45);
    },
    water(level: number): void {
      if (!live() || !ctx || !waterGain) return;
      const t = ctx.currentTime;
      waterGain.gain.setTargetAtTime(level * 0.3, t, 0.09);
      waterFilt.frequency.setTargetAtTime(380 + level * 280, t, 0.12);
    },
  };
}
