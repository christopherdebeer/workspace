/**
 * WHAT A GAIN OF 1 IS WORTH, PER VOICE — the instrument behind `UNIT` in
 * client/audio.ts. Bundles the audio module, renders each steady voice's
 * chain OFFLINE at unit gain (the module's own pattern generators, the same
 * filter settings as build()), and prints the RMS it comes out at, full band
 * and through a 400 Hz highpass standing in for a phone speaker. Then the
 * scenarios the targets were written for, in dBFS after the master, so a
 * change to a filter shows up here as drift before it shows up from the seat.
 *
 *   node devtools/voice-levels.mjs
 */
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const WORK = process.env.DRIVE_WORK ?? join(process.env.TMPDIR ?? '/tmp', 'drive-tools');
const out = join(WORK, 'audio-iife.js');
execSync(`npx esbuild ${join(here, '../client/audio.ts')} --bundle --format=iife --global-name=__audio --log-level=error --outfile=${out}`, { stdio: 'inherit' });

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: out });
const res = await page.evaluate(async () => {
  const A = window.__audio;
  const SR = 48000, LEN = 4;
  const rms = (a, from = 0) => { let s = 0, n = 0; for (let i = from; i < a.length; i++) { s += a[i] * a[i]; n++; } return Math.sqrt(s / n); };
  const noiseBuf = (ctx) => { const b = ctx.createBuffer(1, SR * 2, SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  const patBuf = (ctx, data) => { const b = ctx.createBuffer(1, data.length, SR); b.getChannelData(0).set(data); return b; };
  const render = async (build) => { const ctx = new OfflineAudioContext(1, SR * LEN, SR); build(ctx); const o = await ctx.startRendering(); return o.getChannelData(0); };
  const phone = async (data) => render((ctx) => { const s = ctx.createBufferSource(); s.buffer = patBuf(ctx, data);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400; hp.Q.value = 0.7; s.connect(hp); hp.connect(ctx.destination); s.start(); });
  const filt = (ctx, type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q !== undefined) n.Q.value = q; return n; };
  const src = (ctx, buf, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; return s; };
  const chain = (buf, type, f, q, rate = 1) => (ctx) => { const s = src(ctx, buf(ctx), rate); const n = filt(ctx, type, f, q); s.connect(n); n.connect(ctx.destination); s.start(); };
  const grit = (ctx) => patBuf(ctx, A.gritPattern(SR)), rattle = (ctx) => patBuf(ctx, A.rattlePattern(SR));
  // The same settings as build()/update()/ambience() at a 12 km/h day (ambWind 0.22).
  const voices = {
    wind: ['HP 745', chain(noiseBuf, 'highpass', 745)],
    rustle: ['BP 1500 Q.5', chain(noiseBuf, 'bandpass', 1500, 0.5)],
    sward: ['BP 3264 Q1.1', chain(noiseBuf, 'bandpass', 3264, 1.1)],
    river: ['still, BP 340 Q.8', chain(noiseBuf, 'bandpass', 340, 0.8)],
    rapids: ['froth 1, BP 860 Q.5', chain(noiseBuf, 'bandpass', 860, 0.5)],
    boil: ['grit ×0.36, BP 380 Q.9', chain(grit, 'bandpass', 380, 0.9, 0.36)],
    rain: ['HP 1800', chain(noiseBuf, 'highpass', 1800)],
    bird: ['sine 3k', (ctx) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 3000; o.connect(ctx.destination); o.start(); }],
    rattle: ['shake 1: ×1.6, BP 3200 Q.5', chain(rattle, 'bandpass', 3200, 0.5, 1.6)],
    drone: ['spool 1 load .5, 3 osc BP 1300 + whoosh', (ctx) => {
      const f0 = 62 + 58 + 11;
      const mk = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
      const a = mk('sawtooth', f0), b = mk('sawtooth', f0 * 1.027), c = mk('triangle', f0 * 2.01);
      const mix = ctx.createGain(); mix.gain.value = 0.34; a.connect(mix); b.connect(mix); c.connect(mix);
      const bp = filt(ctx, 'bandpass', 1300, 0.7); mix.connect(bp); bp.connect(ctx.destination);
      const wh = src(ctx, noiseBuf(ctx)); const hp = filt(ctx, 'highpass', 2600); const wg = ctx.createGain(); wg.gain.value = 0.275;
      wh.connect(hp); hp.connect(wg); wg.connect(ctx.destination);
      a.start(); b.start(); c.start(); wh.start();
    }],
    // the truck, for context (linear gains, ear-tuned)
    engine: ['idle: saw+sq LP 650', (ctx) => { const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 51.6; const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 77.4; const m = ctx.createGain(); m.gain.value = 0.5; const lp = filt(ctx, 'lowpass', 650); a.connect(lp); b.connect(m); m.connect(lp); lp.connect(ctx.destination); a.start(); b.start(); }],
    grit: ['×0.98, BP 1190 Q.5', chain(grit, 'bandpass', 1190, 0.5, 0.977)],
    roarTar: ['tarmac BP 1150 Q.7', chain(noiseBuf, 'bandpass', 1150, 0.7)],
  };
  const unit = {};
  for (const [name, [desc, build]] of Object.entries(voices)) { const d = await render(build); const p = await phone(d); unit[name] = { desc, full: rms(d, SR), phone: rms(p, SR) }; }
  return { unit, UNIT: A.UNIT, MASTER: A.MASTER };
});
await browser.close();

const dB = (x) => (20 * Math.log10(Math.max(x, 1e-9))).toFixed(1);
console.log('chain RMS per unit gain — measured / recorded in UNIT (drift), and through a 400 Hz phone highpass:');
let drift = 0;
for (const [n, v] of Object.entries(res.unit)) {
  const rec = res.UNIT[n];
  const d = rec ? (20 * Math.log10(v.full / rec)) : null;
  if (d !== null) drift = Math.max(drift, Math.abs(d));
  console.log(`  ${n.padEnd(8)} ${v.desc.padEnd(36)} ${v.full.toFixed(3)}${rec ? ` / ${rec} (${d >= 0 ? '+' : ''}${d.toFixed(1)} dB)` : ''}   phone ${v.phone.toFixed(3)}`);
}
const M = res.MASTER, lvl = (u, db) => Math.pow(10, db / 20) / (u * M);
const U = res.UNIT, u = res.unit;
const show = (name, gain) => `${dB(u[name].full * gain * M)} dBFS (phone ${dB(u[name].phone * gain * M)})`;
const wAmb = (kmh) => Math.pow(Math.min(kmh / 55 / 0.73, 1.6), 0.55);
console.log('\nparked, engine off, on the bank of still water, full foliage, grass 1 — a 12 km/h day (gust at its mean):');
console.log(`  river   ${show('river', lvl(U.river, -26) * (1 - 0.3 * 0.5))}`);
console.log(`  wind    ${show('wind', lvl(U.wind, -26) * wAmb(12) * 0.775)}`);
console.log(`  rustle  ${show('rustle', lvl(U.rustle, -34) * 0.75)}`);
console.log(`  sward   ${show('sward', lvl(U.sward, -31) * wAmb(12) * 0.7)}`);
console.log(`  bird    ${show('bird', 0.11)} at the peak of a phrase`);
console.log('same, rapids on the bank (froth 1):');
console.log(`  rapids  ${show('rapids', lvl(U.river, -26) * 1.5)}  + boil ${show('boil', lvl(U.boil, -24))}`);
console.log('a 40 km/h day:');
console.log(`  wind    ${show('wind', lvl(U.wind, -26) * wAmb(40) * 0.775)}   rustle ${show('rustle', lvl(U.rustle, -34) * (0.727 / 0.22) * 0.75)}`);
console.log('driving, 40 km/h on open ground (shake 1), the truck for context:');
console.log(`  rattle  ${show('rattle', lvl(U.rattle, -28))}   grit ${show('grit', lvl(U.grit, -29) * 0.716)}   roar ${show('roarTar', lvl(U.roar, -31) * 0.327)} (tarmac)   engine ${show('engine', 0.2)}`);
console.log('drone at full spool, load .5:');
console.log(`  own     ${show('drone', lvl(U.drone, -20) * 0.85)}   10 m off ${show('drone', lvl(U.drone, -20) * 0.85 * 0.5)}   40 m off ${show('drone', lvl(U.drone, -20) * 0.85 / 17)}`);
console.log(`\nlargest UNIT drift: ${drift.toFixed(1)} dB ${drift > 1.5 ? '— RE-RECORD UNIT in client/audio.ts' : '(within a decibel and a half)'}`);
