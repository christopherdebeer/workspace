/**
 * Piste: a fencing bout seen through your own mask. The bout (bout.ts) is everything that happens; this is what
 * connects it to a person: who decides for each fencer (your thumbs, a stand-in, the opponent, a coach), the pace
 * (bullet time, a lesson's slow practice), what the eye sees, the replays, the lamps and the words.
 *
 * Three ways in: the menu (no flags), a lesson (`lesson=<id>`), or a bout (`level=0..3`, or any bout flag).
 *
 * Flags: lesson, level (0 novice .. 3 master), assist (0..1: bullet time, overriding the level's), weapon (epee |
 * foil), ai (sparring | dummy | line), auto (a stand-in fences for you), to (touches to win), view (mask | side |
 * over), thumb (hand | point: the right thumb's scheme), replay=0, time (slow everything: 0.25), t (run on this many
 * seconds first), still, readout, mask=0, seed, preview.
 */
import { Bout, type BoutEvent } from './bout';
import { WEAPONS, EPEE } from './weapons';
import { Opponent, Dummy, SPARRING, LEVELS } from './ai';
import type { Controller, Intent } from './intent';
import { idle } from './intent';
import { Thumbs, GAIN } from './input';
import { Renderer, type View } from './draw';
import type { Light } from './box';
import { TimeDirector } from './time';
import { Recorder, type Replay } from './replay';
import { LESSONS, LessonRunner } from './lessons';
import { type V, add, clamp, lerp, madd } from './v3';
import { seedFrom } from '../kit/rng';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), auto = preview || qs.has('auto'), readout = qs.has('readout');
const seed = seedFrom(qs.get('seed')) ?? 1;
const weapon = WEAPONS[qs.get('weapon') ?? ''] ?? EPEE;
const timeScale = Math.min(4, Math.max(0.02, Number(qs.get('time') ?? 1) || 1));
const viewMode = (qs.get('view') ?? 'mask') as 'mask' | 'side' | 'over';
const lesson = LESSONS.find((l) => l.id === qs.get('lesson')) ?? null;
const BOUT_FLAGS = ['auto', 'preview', 'level', 'ai', 'weapon', 'to', 'view', 't', 'still', 'readout', 'time', 'assist', 'seed'];
const mode: 'menu' | 'lesson' | 'bout' = lesson ? 'lesson' : BOUT_FLAGS.some((f) => qs.has(f)) ? 'bout' : 'menu';
const level = LEVELS[clamp(Math.round(Number(qs.get('level') ?? 2)), 0, LEVELS.length - 1)] ?? LEVELS[2];
const assist = preview ? 0 : qs.has('assist') ? clamp(Number(qs.get('assist')) || 0, 0, 1) : mode === 'lesson' ? 0 : level.assist;
const replays = !preview && qs.get('replay') !== '0';

const body = document.body;
body.classList.add(mode);
if (preview) body.classList.add('preview');
if (qs.get('mask') === '0' || viewMode !== 'mask') body.classList.add('nomask');
if (readout) body.classList.add('readout');

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
const bout = new Bout({ weapon, to: Math.max(1, Number(qs.get('to') ?? 5) || 5), referee: mode !== 'lesson' });
const thumbs = new Thumbs(canvas);
thumbs.scheme = qs.get('thumb') === 'point' ? 'point' : 'hand';
const ai = qs.get('ai') ?? 'sparring';
const runner = lesson ? new LessonRunner(bout, lesson, seed) : null;
const them: Controller = runner ? runner.coach : ai === 'dummy' ? new Dummy(0) : ai === 'line' ? new Dummy(1) : new Opponent(bout, 1, qs.has('level') ? level.style : SPARRING, seed);
const standIn = new Opponent(bout, 0, SPARRING, seed + 101);
let driven: Intent | null = null;
const you: Controller = {
  intent: (dt) => {
    if (driven) return driven;
    if (auto) return standIn.intent(dt);
    const I = thumbs.intent();
    return runner?.frozen ? idle() : I;
  },
};
if (lesson) thumbs.allow = { ...lesson.controls };
const renderer = new Renderer(canvas);
const director = new TimeDirector(bout, assist);
const recorder = replays ? new Recorder(bout) : null;

// ─── what the eye sees ─────────────────────────────────────────────────────────────────────────────────────────────
let look: V | null = null;
const fovOf = () => {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), wide = (Number(qs.get('fov')) || 80) * Math.PI / 180;
  return Math.min(1.66, Math.max(0.75, 2 * Math.atan(Math.tan(wide / 2) / aspect)));
};
function view(b: Bout): View {
  const [me, op] = b.fencers, fov = fovOf();
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

// ─── replays: the touch again, slowly, from the side, with what happened written as it happens ──────────────────────
let replay: { r: Replay; light: number; marks: NonNullable<View['marks']>; notes: string[]; first: number | null } | null = null;
let replayedFor = -1;
const where = (x: number) => (x < 0.34 ? 'forte' : x < 0.67 ? 'middle' : 'foible');
function startReplay(from: number, to: number, light: number) {
  if (!recorder) return;
  replay = { r: recorder.replay(Math.max(recorder.earliest, from), to), light, marks: [], notes: [], first: null };
  body.classList.add('replaying');
  $('replayNotes').textContent = '';
}
function endReplay() { replay = null; body.classList.remove('replaying'); }
function runReplay(wall: number) {
  const R = replay!;
  const ahead = R.light - R.r.t;
  const speed = ahead > 0 ? 0.15 + 0.55 * clamp(ahead / 0.9, 0, 1) : 0.3;
  R.r.run(wall * speed);
  for (const e of R.r.events.splice(0)) {
    if (e.type === 'clash') { R.notes.push(`blades meet: your ${where(e.where[0])} on their ${where(e.where[1])}`); R.marks.push({ p: e.at, c: [1, 1, 1], r: 0.012 }); }
    if (e.type === 'guard') R.notes.push(e.who === 0 ? 'their blade on your bell' : 'your blade on their bell');
    if (e.type === 'light') {
      const f = R.r.bout.fencers[e.who];
      if (R.first === null) R.first = e.t;
      const late = e.t - R.first > 1e-6 ? ` (+${((e.t - R.first) * 1000).toFixed(0)} ms)` : '';
      R.notes.push(`${e.who === 0 ? 'you' : 'them'}: ${e.light.valid ? '' : 'off target, '}${e.light.part}${late}`);
      R.marks.push({ p: f.blade.tip, c: e.who === 0 ? [0.25, 0.9, 0.4] : [1, 0.25, 0.2], r: 0.03 });
    }
  }
  $('replayNotes').textContent = R.notes.slice(-4).join('\n');
  $('replayRate').textContent = `replay · ${speed.toFixed(2)}×`;
  if (R.r.done) endReplay();
}
function replayView(b: Bout): View {
  // (the action is between the guards; a wide screen sees it from the side, both fencers fitted in; a tall one from
  // high behind your shoulder, down the piste, which is the shape of a tall screen)
  const [me, op] = b.fencers, mid = lerp(me.blade.guard, op.blade.guard, 0.5), at: V = [mid[0], 1.0, 0];
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), fov = 0.8;
  if (aspect >= 1) {
    const span = Math.abs(op.s - me.s) + 2.6, d = clamp(span / 2 / (Math.tan(fov / 2) * aspect), 2.6, 10);
    return { eye: [mid[0] - 0.4, 1.4, -d], at: [at[0], 0.95, 0], fov, self: -1, marks: replay?.marks };
  }
  const eye = madd(madd(me.eye, me.frame.f, -2.3), me.frame.r, -1.1);
  return { eye: [eye[0], eye[1] + 1.5, eye[2]], at, fov: 0.95, self: -1, marks: replay?.marks };
}
$('replay').addEventListener('pointerdown', (e) => { e.stopPropagation(); endReplay(); });

// ─── the lamps, the score, the words ────────────────────────────────────────────────────────────────────────────────
const lamp = (who: 0 | 1, l: Light | null) => {
  const el = $(who === 0 ? 'lampYou' : 'lampThem');
  el.className = l ? (l.valid ? 'on' : 'off') : '';
};
function say(big: string, small: string) { $('say').textContent = big; $('sub').textContent = small; }
function hear(events: BoutEvent[]) {
  for (const e of events) {
    if (e.type === 'light') { if (e.who === 1) navigator.vibrate?.(60); }
    else if (e.type === 'halt' && mode === 'bout') say(e.call || 'halt', `${e.points[0] || e.points[1] ? 'point' : 'no point'}`);
    else if (e.type === 'allez' && mode === 'bout') { say('allez', ''); setTimeout(() => { if ($('say').textContent === 'allez') say('', ''); }, 700); }
    else if (e.type === 'over') say(e.winner === 0 ? 'you win' : 'they win', 'tap to fence again');
    else if (e.type === 'time') say('time', '');
    else if (e.type === 'priority') say('a minute more', `priority: ${e.who === 0 ? 'you' : 'them'} (it wins if the minute runs out level)`);
    else if (e.type === 'clash' && e.strength > 0.8) navigator.vibrate?.(Math.min(25, 4 + e.strength * 4));
  }
}
/** the lamps (the box's own) and the score, read as the box is from where you stand: theirs left, yours right */
function scoreboard(b: Bout) {
  lamp(0, b.box.lights[0]); lamp(1, b.box.lights[1]);
  $('score').textContent = `${b.score[1]} · ${b.score[0]}`;
  const t = Math.max(0, Math.ceil(b.clock));
  $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${b.priority === null ? '' : b.priority === 0 ? '  · priority you' : '  · priority them'}`;
  // (your arm: how tired it is, shown once it starts to tell)
  const f = b.fencers[0].fatigue;
  $('arm').style.setProperty('--f', String(f));
  $('arm').classList.toggle('on', f > 0.12);
}
canvas.addEventListener('pointerdown', () => { $('hint').style.opacity = '0'; if (bout.phase === 'over') { bout.restart(); say('', ''); } });

// ─── a lesson: its brief, its count and pace, its verdicts ──────────────────────────────────────────────────────────
const PASSED = 'piste.passed';
const passed = (): string[] => { try { return JSON.parse(localStorage.getItem(PASSED) ?? '[]'); } catch { return []; } };
const markPassed = (id: string) => { try { localStorage.setItem(PASSED, JSON.stringify([...new Set([...passed(), id])])); } catch { /* (private window) */ } };
let shown = '';
function lessonHud() {
  if (!runner || !lesson) return;
  const st = runner.stage;
  $('lTitle').textContent = lesson.title;
  $('lPrompt').textContent = st === 'go' || st === 'set' ? lesson.prompt : '';
  $('lPace').textContent = `pace ${Math.round(runner.pace * 100)}%`;
  $('lDots').innerHTML = Array.from({ length: LessonRunner.NEED }, (_, i) => `<i class="${i < runner.good ? 'on' : ''}"></i>`).join('');
  if (st === shown) return;
  shown = st;
  $('brief').hidden = st !== 'brief';
  $('verdict').hidden = st !== 'result';
  $('passed').hidden = st !== 'passed';
  if (st === 'set') say('', '');
  if (st === 'result' && runner.last) {
    const o = runner.last;
    $('vSay').textContent = o.say; $('vSay').className = o.ok ? 'ok' : 'no';
    $('vDetail').textContent = o.detail ?? '';
    navigator.vibrate?.(o.ok ? 20 : [30, 40, 30]);
  }
  if (st === 'passed') {
    markPassed(lesson.id);
    const i = LESSONS.indexOf(lesson), next = LESSONS[i + 1];
    ($('pNext') as HTMLAnchorElement).hidden = !next;
    if (next) ($('pNext') as HTMLAnchorElement).href = `?lesson=${next.id}`;
  }
}
if (lesson) {
  $('bTitle').textContent = lesson.title;
  $('bText').innerHTML = lesson.brief.map((p) => `<p>${p}</p>`).join('');
  $('bGo').addEventListener('click', () => runner!.begin());
  $('vNext').addEventListener('click', () => runner!.skip());
  $('vAgain').addEventListener('click', () => { const t = bout.t; startReplay(t - 2.4, t, bout.box.first ?? t); });
  ($('pAgain') as HTMLAnchorElement).href = `?lesson=${lesson.id}`;
}

// ─── the menu ───────────────────────────────────────────────────────────────────────────────────────────────────────
if (mode === 'menu') {
  const done = passed();
  $('mLessons').innerHTML = LESSONS.map((l, i) => `<a href="?lesson=${l.id}"><b>${i + 1}</b>${l.title}${done.includes(l.id) ? '<em>✓</em>' : ''}</a>`).join('');
  const help = ['bullet time at every crisis', 'some bullet time', 'a little bullet time', 'no help'];
  $('mLevels').innerHTML = LEVELS.map((l, i) => `<a href="?level=${i}"><b>${l.name}</b><span>${help[i]}</span></a>`).join('');
}

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
function readOut(rate: number) {
  if (!readout) return;
  const [me, op] = bout.fencers;
  peaks = [Math.max(peaks[0] * 0.97, bout.peak[0]), Math.max(peaks[1] * 0.97, bout.peak[1])];
  bout.resetPeak();
  const f = (x: number, d = 2) => x.toFixed(d);
  $('readout').textContent = [
    `${weapon.name}  ${bout.phase}  t ${f(bout.t, 1)}  ${fps} fps  ${f(rate)}×`,
    `gap ${f(bout.gap)} m   you ${me.act?.kind ?? (me.lunge ? 'lunge' : 'en garde')}  them ${op.act?.kind ?? (op.lunge ? 'lunge' : 'en garde')}`,
    `tip  you ${f(peaks[0], 1)} N  them ${f(peaks[1], 1)} N   (closes at ${weapon.tipForce} N, ${weapon.tipDwell * 1000} ms)`,
    `bow  you ${f(me.blade.bow() * 100, 1)} cm  them ${f(op.blade.bow() * 100, 1)} cm`,
    `hand effort  you ${f(me.blade.effort[1] * 100, 0)}%  them ${f(op.blade.effort[1] * 100, 0)}%   ext ${f(me.extension)}`,
    `critical ${f(director.critical)}  assist ${f(director.assist)}   arm fatigue you ${f(me.fatigue)}  them ${f(op.fatigue)}`,
    them instanceof Opponent ? `them: ${them.tactic}` : runner ? `lesson: ${runner.stage}` : `them: ${ai}`,
  ].join('\n');
}

// ─── the loop ───────────────────────────────────────────────────────────────────────────────────────────────────────
function tick(dt: number, record: boolean) {
  const i0 = { ...you.intent(dt) }, i1 = { ...them.intent(dt) };
  if (record) recorder?.give(i0, i1);
  bout.fencers[0].intent = i0; bout.fencers[1].intent = i1;
  bout.advance(dt);
  if (record) recorder?.after();
}
// (run on first, for a still)
const t0 = Number(qs.get('t') ?? 0) || 0;
for (let s = 0; s < t0; s += 1 / 60) { tick(1 / 60, false); bout.drain(); }
recorder?.reset();

let last = performance.now(), rate = 1;
function frame(now: number) {
  const wall = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (replay) runReplay(wall);
  else if (mode !== 'menu' && !qs.has('still')) {
    director.base = runner ? runner.pace : 1;
    rate = director.update(wall) * timeScale;
    const dt = wall * rate;
    tick(dt, true);
    const events = bout.drain();
    if (events.some((e) => e.type === 'reset')) recorder?.reset();
    runner?.hear(events);
    runner?.update(wall, dt);
    hear(events);
    // (the box has locked on a touch: see it again before the referee goes on)
    if (mode === 'bout' && replays && bout.phase === 'halt' && bout.box.first !== null && bout.box.locked(bout.t) && replayedFor !== bout.box.first) {
      replayedFor = bout.box.first;
      startReplay(bout.box.first - 1.3, bout.box.first + 0.25, bout.box.first);
    }
  }
  body.style.setProperty('--slow', String(replay ? 0 : clamp((1 - director.slow) / (1 - 0.2), 0, 1)));
  $('rate').textContent = !replay && director.slow < 0.93 ? `${director.slow.toFixed(2)}×` : '';
  scoreboard(replay ? replay.r.bout : bout);
  renderer.resize(Math.min(devicePixelRatio || 1, 2));
  renderer.draw(replay ? replay.r.bout : bout, replay ? replayView(replay.r.bout) : view(bout));
  marks();
  lessonHud();
  frames++;
  if (now - fpsAt > 1000) { fps = frames; frames = 0; fpsAt = now; }
  readOut(rate);
  publish();
  requestAnimationFrame(frame);
}

/** what the page reports (for the harness): and a way to fence for "you" from outside */
function publish() {
  (window as unknown as Record<string, unknown>).__piste = {
    ready: true, mode, t: bout.t, phase: bout.phase, score: bout.score, gap: bout.gap, call: bout.call,
    lights: bout.box.lights, tactic: them instanceof Opponent ? them.tactic : ai, slow: director.slow, replaying: !!replay,
    lesson: runner ? { stage: runner.stage, pace: runner.pace, good: runner.good, last: runner.last } : null,
    drive: (i: Intent | null) => { driven = i; },
    begin: () => runner?.begin(),
    startReplay: (from: number, to: number) => startReplay(from, to, to),
  };
}
requestAnimationFrame(frame);
