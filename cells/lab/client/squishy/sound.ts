/** Sound: squish, pop, boing, plop, a chime; made up as it's wanted, from sines and noise. Off with `?auto`. */
import { STORE, auto } from './env';

export let ac: AudioContext | null = null;
let master: GainNode | null = null;
export let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
/** on or off, remembered */
export function setSound(on: boolean) {
  soundOn = on;
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.2);
}
export function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
}
/** a soft blop: a sine that drops in pitch, with a little wet noise */
export function blop(f0: number, f1: number, dur: number, loud: number) {
  if (!ac || !master) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(loud, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
export const squish = (k: number) => { blop(260 + 140 * k, 90, 0.16, Math.min(0.35, 0.06 + 0.3 * k)); blop(900, 300, 0.05, Math.min(0.08, 0.04 * k)); };
export const pop = (k: number) => blop(380, 900, 0.09, 0.12 * k);
export const boing = () => { blop(220, 520, 0.22, 0.2); blop(520, 260, 0.3, 0.08); };
export const plop = () => blop(180, 60, 0.4, 0.25);
/** a sneeze: a quick rising breath, then the squeak out */
export function sneezeSound() { if (!ac) return; blop(300, 900, 0.14, 0.1); setTimeout(() => blop(1200, 400, 0.18, 0.2), 150); }
/** a lid lifted by steam: a hiss, and its rim rattling on the pot */
export function rattle() {
  if (!ac || !master || !soundOn) return;
  const t0 = ac.currentTime;
  for (let i = 0; i < 7; i++) blopAt(t0 + 0.1 + i * 0.09 + Math.random() * 0.03, 1900 + Math.random() * 600, 1200, 0.03, 0.05);
  // (the hiss: noise, shaped)
  const n = ac.createBuffer(1, ac.sampleRate * 0.9, ac.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ac.createBufferSource(); src.buffer = n;
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
  const g = ac.createGain(); g.gain.value = 0.05;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}
function blopAt(at: number, f0: number, f1: number, dur: number, loud: number) {
  if (!ac || !master) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(loud, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}
export function chime() { if (!ac) return; [660, 830, 990, 1320].forEach((f, i) => setTimeout(() => blop(f, f * 0.99, 0.5, 0.12), i * 110)); }
