/**
 * Piste: a fencing bout seen through your own mask. The bout (bout.ts) is everything that happens; this is only what
 * connects it to a person: who decides for each fencer (your thumbs, or a stand-in; the opponent), what the eye sees,
 * the lamps and the score, and the marks under your thumbs.
 *
 * Flags: weapon (epee | foil), ai (sparring | dummy | line: a dummy with its arm out), auto (a stand-in fences for
 * you), to (touches to win, 5), view (mask | side | over), time (slow it: 0.25), t (run this many seconds first),
 * readout, mask=0 (no mesh in front of the eye), seed, preview.
 */
import { Bout } from './bout';
import { WEAPONS, EPEE } from './weapons';
import { Opponent, Dummy, SPARRING } from './ai';
import type { Controller, Intent } from './intent';
import { Thumbs, GAIN } from './input';
import { Renderer, type View } from './draw';
import type { Light } from './box';
import { type V, add, lerp, madd } from './v3';
import { seedFrom } from '../kit/rng';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), auto = preview || qs.has('auto'), readout = qs.has('readout');
const seed = seedFrom(qs.get('seed')) ?? 1;
const weapon = WEAPONS[qs.get('weapon') ?? ''] ?? EPEE;
const timeScale = Math.min(4, Math.max(0.02, Number(qs.get('time') ?? 1) || 1));
const viewMode = (qs.get('view') ?? 'mask') as 'mask' | 'side' | 'over';
if (preview) document.body.classList.add('preview');
if (qs.get('mask') === '0' || viewMode !== 'mask') document.body.classList.add('nomask');
if (readout) document.body.classList.add('readout');

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
const bout = new Bout({ weapon, to: Math.max(1, Number(qs.get('to') ?? 5) || 5) });
const thumbs = new Thumbs(canvas);
const ai = qs.get('ai') ?? 'sparring';
const them: Controller = ai === 'dummy' ? new Dummy(0) : ai === 'line' ? new Dummy(1) : new Opponent(bout, 1, SPARRING, seed);
const standIn = new Opponent(bout, 0, SPARRING, seed + 101);
let driven: Intent | null = null;
const you: Controller = { intent: (dt) => driven ?? (auto ? standIn.intent(dt) : thumbs.intent()) };
const renderer = new Renderer(canvas);

// ─── what the eye sees ─────────────────────────────────────────────────────────────────────────────────────────────
let look: V | null = null;
function view(): View {
  const [me, op] = bout.fencers;
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  // (at least this wide across, but never taller than this)
  const wide = (Number(qs.get('fov')) || 80) * Math.PI / 180;
  const fov = Math.min(1.66, Math.max(0.75, 2 * Math.atan(Math.tan(wide / 2) / aspect)));
  if (viewMode === 'side') {
    const mid = (me.s + op.s) / 2;
    return { eye: [mid, 1.25, -4.2], at: [mid, 1.0, 0], fov: Math.min(1.2, fov), self: -1 };
  }
  // (the head watches their chest and their guard, a little below the horizon; it turns slowly, as a head does)
  const want = lerp(add(op.capsules[0].b, [0, -0.15, 0]), op.blade.guard, 0.35);
  look = look ? lerp(look, want, 0.12) : want;
  if (viewMode === 'over') {
    const eye = madd(madd(me.eye, me.frame.f, -1.5), me.frame.r, -0.8);
    return { eye: [eye[0], eye[1] + 0.35, eye[2]], at: look, fov: Math.min(fov, 1.3), self: -1 };
  }
  // (a tall view looks lower, so your own guard is in it; a wide one keeps their mask in it)
  const at = add(look, [0, -0.28 * Math.min(1, (fov - 0.75) / 0.9), 0]);
  return { eye: me.eye, at, fov, self: 0 };
}

// ─── the lamps, the score, the call ─────────────────────────────────────────────────────────────────────────────────
const lamp = (who: 0 | 1, l: Light | null) => {
  const el = $(who === 0 ? 'lampYou' : 'lampThem');
  el.className = l ? (l.valid ? 'on' : 'off') : '';
  el.title = l ? l.part : '';
};
function hear(dt: number) {
  for (const e of bout.drain()) {
    if (e.type === 'light') { if (e.who === 1) navigator.vibrate?.(60); }
    else if (e.type === 'halt') say(e.call || 'halt', `${e.points[0] || e.points[1] ? 'point' : 'no point'}`);
    else if (e.type === 'allez') { say('allez', ''); setTimeout(() => say('', ''), 700); }
    else if (e.type === 'over') say(e.winner === 0 ? 'you win' : 'they win', 'tap to fence again');
    else if (e.type === 'clash' && e.strength > 0.8) navigator.vibrate?.(Math.min(25, 4 + e.strength * 4));
  }
  // (the lamps are the box's own)
  lamp(0, bout.box.lights[0]); lamp(1, bout.box.lights[1]);
  // (the lamps and score read as the box does from where you stand: theirs on the left, yours on the right)
  $('score').textContent = `${bout.score[1]} · ${bout.score[0]}`;
  void dt;
}
function say(big: string, small: string) { $('say').textContent = big; $('sub').textContent = small; }
canvas.addEventListener('pointerdown', () => { $('hint').style.opacity = '0'; if (bout.phase === 'over') { bout.restart(); say('', ''); } });

// ─── the marks under the thumbs ─────────────────────────────────────────────────────────────────────────────────────
const markR = $('markR'), markRdot = $('markRdot'), markL = $('markL'), markLdot = $('markLdot');
function marks() {
  const { right, left, unit } = thumbs.touches;
  markR.hidden = markRdot.hidden = !right;
  if (right) {
    markR.style.cssText = `left:${right.x0}px;top:${right.y0}px;width:${unit * 2.5}px;height:${unit * 2.5}px`;
    markRdot.style.transform = `translate(${right.x}px,${right.y}px)`;
  }
  markL.hidden = markLdot.hidden = !left;
  if (left) {
    // a rail up from where the thumb landed: full extension, then the lunge
    markL.style.cssText = `left:${left.x0}px;top:${left.y0 - unit * GAIN.lungeAt}px;height:${unit * (GAIN.lungeAt + GAIN.retreatAt)}px;--ext:${(GAIN.lungeAt - GAIN.extendAt) * unit}px;--ret:${GAIN.retreatAt * unit}px`;
    markLdot.style.transform = `translate(${left.x0}px,${left.y}px)`;
  }
}

// ─── the readout ────────────────────────────────────────────────────────────────────────────────────────────────────
let peaks: [number, number] = [0, 0], frames = 0, fpsAt = 0, fps = 0;
function readOut() {
  if (!readout) return;
  const [me, op] = bout.fencers;
  peaks = [Math.max(peaks[0] * 0.97, bout.peak[0]), Math.max(peaks[1] * 0.97, bout.peak[1])];
  const f = (x: number, d = 2) => x.toFixed(d);
  $('readout').textContent = [
    `${weapon.name}  ${bout.phase}  t ${f(bout.t, 1)}  ${fps} fps`,
    `gap ${f(bout.gap)} m   you ${me.act?.kind ?? (me.lunge ? 'lunge' : 'en garde')}  them ${op.act?.kind ?? (op.lunge ? 'lunge' : 'en garde')}`,
    `tip  you ${f(peaks[0], 1)} N  them ${f(peaks[1], 1)} N   (closes at ${weapon.tipForce} N, ${weapon.tipDwell * 1000} ms)`,
    `bow  you ${f(me.blade.bow() * 100, 1)} cm  them ${f(op.blade.bow() * 100, 1)} cm`,
    `hand effort  you ${f(me.blade.effort[1] * 100, 0)}%  them ${f(op.blade.effort[1] * 100, 0)}%   ext ${f(me.extension)}`,
    them instanceof Opponent ? `them: ${them.tactic}` : `them: ${ai}`,
  ].join('\n');
}

// ─── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────────
function tick(dt: number) {
  bout.fencers[0].intent = { ...you.intent(dt) };
  bout.fencers[1].intent = { ...them.intent(dt) };
  bout.advance(dt);
}
// (run on first, for a still)
const t0 = Number(qs.get('t') ?? 0) || 0;
for (let s = 0; s < t0; s += 1 / 60) { tick(1 / 60); bout.drain(); }

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000) * timeScale;
  last = now;
  if (!qs.has('still')) tick(dt);
  hear(dt);
  renderer.resize(Math.min(devicePixelRatio || 1, 2));
  renderer.draw(bout, view());
  marks();
  frames++;
  if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
  readOut();
  publish();
  requestAnimationFrame(frame);
}

/** what the page reports (for the harness): and a way to fence for "you" from outside */
function publish() {
  (window as unknown as Record<string, unknown>).__piste = {
    ready: true, t: bout.t, phase: bout.phase, score: bout.score, gap: bout.gap, call: bout.call,
    lights: bout.box.lights, tactic: them instanceof Opponent ? them.tactic : ai,
    drive: (i: Intent | null) => { driven = i; },
  };
}
requestAnimationFrame(frame);
