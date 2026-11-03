/**
 * Switchback's sound, all made here (WebAudio, no files):
 *
 * - **the engine**: a two-stroke's buzz, three detuned oscillators driven hard through a soft clipper and a low-pass
 *   that opens as it revs. Its revs come from the pace through a gearbox (six gears, each from ~30% to full), so it
 *   climbs, drops a gear, climbs again; in the air the back wheel's free and it screams; braking, it falls to a burble.
 * - **the wind**: noise through a band-pass that rises with the pace, louder as the square of it.
 * - **the ground**: a gravel crunch under the tyres (noise, high-passed, roughened every frame), more in a slide, none
 *   in the air.
 * - **one-shots**: a landing's thump (a falling low tone and a dull burst), a crash (a longer, harder burst), a glance off
 *   rock (a short bright one), a checkpoint's two-note chime, and a flip's three.
 *
 * It starts only from a tap (the browser's rule), and sits under one master gain: the volume, or nothing.
 */
import type { Event, Rider } from './sim';
import { VMAX } from './sim';

/** the gearbox's tops (m/s): the engine's note climbs through each and drops at the change; the speed layer pulses there
 * too */
export const GEARS = [9, 16, 23, 30, 38, 46];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode; private engineGain!: GainNode; private windGain!: GainNode; private gravelGain!: GainNode;
  private oscs: OscillatorNode[] = []; private lp!: BiquadFilterNode; private windBand!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private rpm = 0.3; private gear = 0; private seen = 0;
  volume = 0.7; on = true; private quiet = 1;
  /** start (from a tap); safe to call again */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(ctx.destination);
    // (noise, two seconds of it, looped)
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // (the engine)
    const shaper = ctx.createWaveShaper(), curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3.2); }
    shaper.curve = curve;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 3;
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    const mix = ctx.createGain(); mix.gain.value = 0.35;
    for (const [type, mult, g] of [['sawtooth', 1, 0.6], ['square', 0.5, 0.35], ['sawtooth', 2.013, 0.18]] as [OscillatorType, number, number][]) {
      const o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = 80 * mult; og.gain.value = g;
      (o as unknown as { mult: number }).mult = mult; o.connect(og).connect(mix); o.start(); this.oscs.push(o);
    }
    mix.connect(shaper).connect(this.lp).connect(this.engineGain).connect(this.master);
    // (the wind)
    const wind = this.loop(); this.windBand = ctx.createBiquadFilter(); this.windBand.type = 'bandpass'; this.windBand.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0; wind.connect(this.windBand).connect(this.windGain).connect(this.master);
    // (the gravel)
    const grit = this.loop(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    this.gravelGain = ctx.createGain(); this.gravelGain.gain.value = 0; grit.connect(hp).connect(this.gravelGain).connect(this.master);
  }
  private loop() { const ctx = this.ctx!, s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }
  /** hush it (a menu open) or bring it back */
  hush(quiet: boolean) { this.quiet = quiet ? 0 : 1; }
  /** each frame: the rider's pace, its being in the air or braking or sliding, and the one-shots since last frame */
  update(r: Rider, braking: boolean, dt: number) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime, T = 0.06;
    this.master.gain.setTargetAtTime((this.on ? this.volume : 0) * this.quiet, now, 0.08);
    const v = Math.hypot(r.vx, r.vz), pace = Math.min(1, v / VMAX), down = r.crashT > 0;
    // (the gearbox: six gears; the revs within the gear the pace is in; free-revving in the air; braking, it falls)
    const tops = GEARS;
    let g = tops.findIndex((x) => v < x); if (g < 0) g = tops.length - 1;
    const lo = g ? tops[g - 1] : 0, within = Math.max(0, Math.min(1, (v - lo) / (tops[g] - lo)));
    const want = down ? 0.15 : r.air ? 1.05 : braking ? 0.3 : 0.32 + within * 0.68;
    this.rpm += (want - this.rpm) * (1 - Math.exp(-dt * (r.air ? 6 : g !== this.gear ? 18 : 9)));
    this.gear = g;
    const f = 48 + this.rpm * 165;
    for (const o of this.oscs) o.frequency.setTargetAtTime(f * (o as unknown as { mult: number }).mult, now, 0.03);
    this.lp.frequency.setTargetAtTime(500 + this.rpm * 2600, now, T);
    this.engineGain.gain.setTargetAtTime(down ? 0.05 : (braking ? 0.35 : 0.55) + this.rpm * 0.35, now, T);
    this.windBand.frequency.setTargetAtTime(300 + pace * 1400, now, T);
    this.windGain.gain.setTargetAtTime(0.03 + pace * pace * 0.5, now, T);
    this.gravelGain.gain.setTargetAtTime(r.air || down ? 0 : (pace * 0.1 + Math.min(0.4, Math.abs(r.slip) * 1.2)) * (0.6 + Math.random() * 0.8), now, 0.02);
    for (let i = this.seen; i < r.events.length; i++) this.once(r.events[i]);
    this.seen = r.events.length;
  }
  /** a new rider (a fresh run): its events start again */
  reset() { this.seen = 0; }
  /** after the frame (the speed layer trims the rider's event list): where to read from next */
  sync(n: number) { this.seen = n; }
  private once(e: Event) {
    const ctx = this.ctx!, now = ctx.currentTime;
    if (e.kind === 'land') { this.thump(now, 0.4 + e.k * 0.6, 95, 0.25); this.burst(now, 0.15 + e.k * 0.2, 700, 0.18); }
    else if (e.kind === 'crash') { this.thump(now, 1, 70, 0.4); this.burst(now, 0.6, 1400, 0.7); this.burst(now + 0.12, 0.35, 500, 0.5); }
    else if (e.kind === 'wall') { this.burst(now, 0.4, 2600, 0.12); this.thump(now, 0.5, 120, 0.15); }
    else if (e.kind === 'checkpoint') { this.note(now, 880, 0.12); this.note(now + 0.11, 1318.5, 0.22); }
    else if (e.kind === 'respawn') { this.note(now, 659.3, 0.18); }
    else if (e.kind === 'flip') { this.note(now, 659.3, 0.1); this.note(now + 0.09, 880, 0.1); this.note(now + 0.18, 1318.5, 0.26); }
  }
  /** a low tone falling away: a thump */
  private thump(at: number, k: number, f: number, len: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * 0.4, at + len);
    g.gain.setValueAtTime(0.9 * k, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(this.master); o.start(at); o.stop(at + len + 0.05);
  }
  /** a burst of noise through a low-pass, dying away */
  private burst(at: number, k: number, f: number, len: number) {
    const ctx = this.ctx!, s = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; lp.type = 'lowpass'; lp.frequency.setValueAtTime(f, at); lp.frequency.exponentialRampToValueAtTime(Math.max(60, f * 0.2), at + len);
    g.gain.setValueAtTime(0.8 * k, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
    s.connect(lp).connect(g).connect(this.master); s.start(at, Math.random()); s.stop(at + len + 0.05);
  }
  /** a bright short note (the chime) */
  private note(at: number, f: number, len: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.35, at + 0.01); g.gain.exponentialRampToValueAtTime(0.001, at + len);
    o.connect(g).connect(this.master); o.start(at); o.stop(at + len + 0.05);
  }
}
