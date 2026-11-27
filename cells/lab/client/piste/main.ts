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
import { mergeDrafts } from './look/athlete';
import { useFabric, OLD_FABRIC } from './look/cloth';
import { Bout, type BoutEvent } from './bout';
import { WEAPONS, EPEE } from './weapons';
import { Opponent, Dummy, SPARRING, LEVELS } from './ai';
import type { Controller, Intent } from './intent';
import { idle } from './intent';
import { Thumbs, GAIN } from './input';
import { GpuCloth } from './look/cloth';
import { Renderer, type View } from './draw';
import type { Light } from './box';
import { TimeDirector } from './time';
import { Recorder, type Replay } from './replay';
import { LESSONS, LessonRunner } from './lessons';
import { type V, add, clamp, lerp, madd } from './v3';
import { seedFrom } from '../kit/rng';
import { CHOICES, loadSettings, saveSettings, challengeBeaten, setChallengeBeaten, type Settings } from './settings';

const qs = new URLSearchParams(location.search);
// (the player's settings, kept on this device; a flag in the address wins over one)
const settings = loadSettings();
const pick = <K extends keyof Settings>(k: K): string => qs.get(k) ?? settings[k];
const preview = qs.has('preview'), watchFlag = preview || qs.has('auto');
const seed = seedFrom(qs.get('seed')) ?? 1;
const weapon = WEAPONS[qs.get('weapon') ?? ''] ?? EPEE;
const timeScale = Math.min(4, Math.max(0.02, Number(qs.get('time') ?? 1) || 1));
const lesson = LESSONS.find((l) => l.id === qs.get('lesson')) ?? null;
const BOUT_FLAGS = ['study', 'auto', 'preview', 'level', 'ai', 'weapon', 'to', 'view', 't', 'still', 'readout', 'time', 'assist', 'seed'];
const mode: 'menu' | 'lesson' | 'bout' = lesson ? 'lesson' : BOUT_FLAGS.some((f) => qs.has(f)) ? 'bout' : 'menu';
// (the menu has a bout of its own running behind it, two of the AI fencing, from the side on a wide screen and from high
// behind on a tall one)
const auto = watchFlag || mode === 'menu', readout = mode !== 'menu' && (qs.has('readout') || settings.readout === 'on');
const viewMode = (mode === 'menu' ? (innerWidth >= innerHeight ? 'side' : 'over') : pick('view')) as 'mask' | 'side' | 'over';
const levelIdx = clamp(Math.round(Number(qs.get('level') ?? 2)), 0, LEVELS.length - 1), challenge = qs.has('challenge');
const level = LEVELS[levelIdx] ?? LEVELS[2];
const assist = preview ? 0 : qs.has('assist') ? clamp(Number(qs.get('assist')) || 0, 0, 1) : mode === 'lesson' ? 0 : level.assist;
/**
 * The study: five seconds in the room, nearly uneventful, to judge the look by: the opponent takes one step closer, you
 * roll your wrist a little, both settle (and again). Can you feel how much distance closed, and see what your hand did?
 */
const study = qs.has('study'), clothStudy = qs.get('study') === 'cloth', retreatStudy = qs.get('study') === 'retreat';
/** (`study=near`: framed as the look's targets are (devtools/refs/piste): the opponent near, in guard, then reaching
 * toward you slowly and back, so the kit's seen large: its folds, its fullness, its weight) */
const nearStudy = qs.get('study') === 'near';
/** look flags: the figures as plain grey models; the contact capsules over them */
const clay = qs.has('clay'), bodies = qs.has('bodies');
const replays = !preview && !study && mode !== 'menu' && pick('replay') !== '0' && pick('replay') !== 'off';

const body = document.body;
body.classList.add(mode);
if (study) body.classList.add('study');
if (preview) body.classList.add('preview');
if (clothStudy || qs.get('mask') === '0' || viewMode !== 'mask') body.classList.add('nomask');
if (readout) body.classList.add('readout');

const $ = (id: string) => document.getElementById(id)!;
const canvas = document.querySelector('canvas')!;
// (the ceremony: before the bout, between touches and after it; `ceremony=0` puts them straight back on their lines)
const bout = new Bout({ weapon, to: Math.max(1, Number(qs.get('to') ?? 5) || 5), referee: mode !== 'lesson' && !study, ceremony: (mode === 'bout' || mode === 'menu') && pick('ceremony') !== '0' && pick('ceremony') !== 'off', warmup: mode === 'bout' && !auto && !study });
/** the study's script, by the bout's clock (it loops every six seconds) */
const STUDY = { step: 0.9, roll: [2.0, 2.8] as [number, number], rollTo: 0.6, loop: 6 };
const studyClock = () => bout.t % STUDY.loop;
const studyYou: Controller = { intent: () => {
  const t = studyClock(), u = Math.min(1, Math.max(0, (t - STUDY.roll[0]) / (STUDY.roll[1] - STUDY.roll[0]))), e = u * u * (3 - 2 * u);
  return { ...idle(), extend: 0.12, roll: STUDY.rollTo * e };
} };
let studyLap = -1, studyStepped = -1;
const studyThem: Controller = { intent: () => {
  const lap = Math.floor(bout.t / STUDY.loop), t = studyClock();
  if (clothStudy) {
    // One second to extend, a full second under tension, then a slow release.
    const phase = clamp(Math.min(t - 0.75, (4.5 - t) / 1.5), 0, 1);
    return { ...idle(), extend: 0.05 + 0.94 * phase * phase * (3 - 2 * phase) };
  }
  // (each lap from the en garde lines again; the near study from close, reaching slowly and back)
  if (lap !== studyLap) { studyLap = lap; bout.place(nearStudy ? 2.15 : 3.32); }
  if (nearStudy) { const phase = clamp(Math.min(t - 1.0, (5.0 - t) / 1.2), 0, 1); return { ...idle(), extend: 0.1 + 0.85 * phase * phase * (3 - 2 * phase) }; }
  const I = { ...idle(), extend: 0.12 };
  // (`study=retreat`: a step back instead, to judge the figure mid-retreat, as it's most often seen)
  if (t >= STUDY.step && studyStepped !== lap) { studyStepped = lap; I.step = retreatStudy ? 'retreat' : 'advance'; }
  return I;
} };

const thumbs = new Thumbs(canvas);
thumbs.scheme = pick('thumb') === 'point' ? 'point' : 'hand';
const ai = qs.get('ai') ?? 'sparring';
const runner = lesson ? new LessonRunner(bout, lesson, seed) : null;
const them: Controller = study ? studyThem : runner ? runner.coach : ai === 'dummy' ? new Dummy(0) : ai === 'line' ? new Dummy(1) : new Opponent(bout, 1, qs.has('level') ? level.style : SPARRING, seed);
const standIn = new Opponent(bout, 0, SPARRING, seed + 101);
let driven: Intent | null = null;
const you: Controller = {
  intent: (dt) => {
    if (study) return studyYou.intent(dt);
    if (driven) return driven;
    if (auto) return standIn.intent(dt);
    const I = thumbs.intent();
    return runner?.frozen ? idle() : I;
  },
};
if (lesson) thumbs.allow = { ...lesson.controls };
// (`fabric=old`: the kit in the lighter, stiffer cloth the dials were first set for, to compare)
if (qs.get('fabric') === 'old') useFabric(OLD_FABRIC);
const renderer = new Renderer(canvas, { cloth: pick('cloth') === 'sim', clothStress: Number(qs.get('clothx') ?? 1) || 1 });
// (`exposure=0.8`: the camera's exposure, for judging the light)
if (qs.has('exposure')) renderer.exposure = Number(qs.get('exposure')) || renderer.exposure;
// (the fencers wear the jacket drafted and settled by devtools/piste-jacket.mjs; `jacket=loft`: the lofted one it replaced)
// (dressed before anything runs, so a still's cloth has the same history in either jacket)
const dressed: Promise<void> = (() => {
  const root = document.documentElement.dataset.assets;
  // (`body=bare`: the fencers undressed, the body the kit's fitted to)
  if (qs.get('body') === 'bare') { renderer.setBare(); return Promise.resolve(); }
  if (qs.get('jacket') === 'loft' || !root) return Promise.resolve();
  // (and the breeches, drafted and settled by devtools/piste-breeches.mjs; `breeches=loft`: the lofted ones)
  const get = (f: string) => fetch(root + f).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return Promise.all([get('jacket-draft.json'), qs.get('breeches') === 'loft' ? null : get('breeches-draft.json')])
    .then(([j, b]) => { if (j) renderer.setDraft(b ? mergeDrafts(j, b) : j); }).catch((e) => console.warn('no drafted kit', e));
})();
const director = new TimeDirector(bout, assist);
const recorder = replays ? new Recorder(bout) : null;

// ─── what the eye sees ─────────────────────────────────────────────────────────────────────────────────────────────
let look: V | null = null;
/** the first-person eye: how far right of the head, back, down; how far right and down it looks of their chest */
const FP = { fov: 1.20, right: 0.060, back: -0.042, down: -0.070, aimRight: 0.125, aimDown: 0.68 };
const fovOf = () => {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), wide = (Number(qs.get('fov')) || 80) * Math.PI / 180;
  return Math.min(1.66, Math.max(0.75, 2 * Math.atan(Math.tan(wide / 2) / aspect)));
};
function view(b: Bout): View {
  const [me, op] = b.fencers, fov = fovOf();
  if (clothStudy) {
    const at = madd(op.frame.o, op.frame.f, 0.20);
    at[1] = 1.24;
    const eye = madd(madd(at, op.frame.f, 0.72), op.frame.r, 1.48);
    eye[1] = 1.46;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    return { eye, at, fov: clamp(2 * Math.atan(0.34 / aspect), 0.60, 1.14), self: -1 };
  }
  if (viewMode === 'side') {
    const mid = (me.s + op.s) / 2;
    // (from under the windows, the dark wall behind them: the room is 7.2 m across)
    // (wide enough to hold both fencers whatever the screen's shape)
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), span = Math.abs(op.s - me.s) + 1.8;
    return { eye: [mid, 1.2, -3.2], at: [mid, 0.95, 0], fov: clamp(2 * Math.atan(span / 2 / 3.2 / aspect), 0.7, 2.0), self: -1 };
  }
  // (the head watches their chest and their guard, a little below the horizon; it turns slowly, as a head does)
  const want = lerp(add(op.capsules[0].b, [0, -0.15, 0]), op.blade.guard, 0.35);
  look = look ? lerp(look, want, 0.12) : want;
  if (viewMode === 'over') {
    const eye = madd(madd(me.eye, me.frame.f, -1.5), me.frame.r, -0.8);
    return { eye: [eye[0], eye[1] + 0.35, eye[2]], at: look, fov: Math.min(fov, 1.3), self: -1 };
  }
  // (a tall view looks lower, so your own guard is in it; a wide one keeps their mask in it)
  // (a tighter lens than the old wide one: the opponent at a size you can read them by, your own bell coming into the
  // lower right, as it would to your eye looking past it)
  // (the eye just behind and above the line of the weapon hand: your sleeve comes in from the lower right corner, the
  // bell large, the blade going away from it toward them)
  const fp = Math.min(fov, FP.fov);
  const eye = add(madd(madd(me.eye, me.frame.r, FP.right), me.frame.f, FP.back), [0, FP.down, 0]);
  const at = add(madd(look, me.frame.r, FP.aimRight), [0, -FP.aimDown * Math.min(1, (fp - 0.75) / 0.7), 0]);
  return { eye, at, fov: fp, self: 0 };
}

// ─── replays: the touch again, slowly, from the side, with what happened written as it happens ──────────────────────
let replay: { r: Replay; light: number; marks: NonNullable<View['marks']>; notes: string[]; first: number | null; from: number; to: number; ended: boolean } | null = null;
let replayedFor = -1;
const where = (x: number) => (x < 0.34 ? 'forte' : x < 0.67 ? 'middle' : 'foible');
function startReplay(from: number, to: number, light: number) {
  if (!recorder) return;
  replay = { r: recorder.replay(Math.max(recorder.earliest, from), to), light, marks: [], notes: [], first: null, from, to, ended: false };
  body.classList.add('replaying'); body.classList.remove('replayEnded');
  $('replayNotes').textContent = '';
}
// (gone on from: the touch is called at once, and the next begins from here, with no more of the halt's pause)
function endReplay() { replay = null; body.classList.remove('replaying', 'replayEnded'); bout.hurry(); }
/** the same touch again, from the start */
function againReplay() { if (replay) { const { from, to, light } = replay; startReplay(from, to, light); } }
function runReplay(wall: number) {
  const R = replay!;
  if (R.ended) return;
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
  // (at its end it waits, the last moment held, to be seen again or gone on from; a bout with nobody watching goes on)
  if (R.r.done && !R.ended) { R.ended = true; if (auto) endReplay(); else { body.classList.add('replayEnded'); $('replayRate').textContent = 'replay · held'; } }
}
function replayView(b: Bout): View {
  // (the action is between the guards; a wide screen sees it from the side, both fencers fitted in; a tall one from
  // high behind your shoulder, down the piste, which is the shape of a tall screen)
  const [me, op] = b.fencers, mid = lerp(me.blade.guard, op.blade.guard, 0.5), at: V = [mid[0], 1.0, 0];
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  if (aspect >= 1) {
    const d = 3.1, span = Math.abs(op.s - me.s) + 2.6, wide = clamp(2 * Math.atan(span / 2 / d / aspect), 0.6, 1.3);
    return { eye: [mid[0] - 0.3, 1.35, -d], at: [at[0], 0.95, 0], fov: wide, self: -1, marks: replay?.marks };
  }
  const eye = madd(madd(me.eye, me.frame.f, -2.3), me.frame.r, -1.1);
  return { eye: [eye[0], eye[1] + 1.5, eye[2]], at, fov: 0.95, self: -1, marks: replay?.marks };
}
$('replay').addEventListener('pointerdown', (e) => { e.stopPropagation(); endReplay(); });
$('rAgain').addEventListener('pointerdown', (e) => { e.stopPropagation(); againReplay(); });
$('rOn').addEventListener('pointerdown', (e) => { e.stopPropagation(); endReplay(); });

// ─── the lamps, the score, the words ────────────────────────────────────────────────────────────────────────────────
const lamp = (who: 0 | 1, l: Light | null) => {
  const el = $(who === 0 ? 'lampYou' : 'lampThem');
  el.className = l ? (l.valid ? 'on' : 'off') : '';
};
function say(big: string, small: string) { $('say').textContent = big; $('sub').textContent = small; }
function hear(events: BoutEvent[]) {
  for (const e of events) {
    if (e.type === 'light') { if (e.who === 1) navigator.vibrate?.(60); }
    else if (e.type === 'halt' && mode === 'bout') { say(e.call || 'halt', `${e.points[0] || e.points[1] ? 'point' : 'no point'}`); calledAt = performance.now(); }
    else if (e.type === 'reset' && mode === 'bout' && bout.phase === 'ready') say('en garde', '');
    else if (e.type === 'allez' && mode === 'bout') { say('allez', ''); setTimeout(() => { if ($('say').textContent === 'allez') say('', ''); }, 700); }
    else if (e.type === 'over') {
      // (the challenge: beating the level you're on unlocks the next; a tap goes on to it, or tries again)
      if (challenge && e.winner === 0 && challengeBeaten() <= levelIdx) setChallengeBeaten(levelIdx + 1);
      const next = challenge && e.winner === 0 ? levelIdx + 1 : -1;
      say(e.winner === 0 ? 'you win' : 'they win', challenge ? (next >= LEVELS.length ? 'the challenge is done: every level beaten' : next > 0 ? `next: ${LEVELS[next].name} · tap to go on` : 'tap to try again') : 'tap to fence again');
    }
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
canvas.addEventListener('pointerdown', () => {
  // (in the menu, a tap on the room hides the menu to watch the bout behind it: see the watching camera, which tells a
  // tap from a drag)
  if (mode === 'menu') return;
  $('hint').style.opacity = '0';
  if (bout.phase === 'over') {
    if (challenge && bout.score[0] > bout.score[1] && levelIdx + 1 < LEVELS.length) { location.search = `?level=${levelIdx + 1}&challenge`; return; }
    bout.restart(); say('', '');
  }
});

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
  // (the challenge: the levels in turn, from the first not yet beaten)
  const beaten = challengeBeaten(), at = Math.min(beaten, LEVELS.length - 1);
  ($('mChallenge') as HTMLAnchorElement).href = `?level=${at}&challenge`;
  $('mChallengeSub').textContent = beaten >= LEVELS.length ? 'every level beaten: fence the master again' : beaten > 0 ? `next: ${LEVELS[at].name} (${beaten} of ${LEVELS.length} beaten)` : `beat each level in turn, from ${LEVELS[0].name}`;
  // (the settings: each a row of choices, kept as they're tapped)
  const opts = $('mOpts');
  const paint = () => {
    opts.innerHTML = CHOICES.map((c) => `<div class="opt"><span>${c.label}</span><div>${c.options.map(([v, l]) => `<button data-k="${c.key}" data-v="${v}" class="${settings[c.key] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('');
  };
  paint();
  opts.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    (settings as unknown as Record<string, string>)[b.dataset.k!] = b.dataset.v!; saveSettings(settings); paint();
  });
  // (the home screen's calls to action open their panels; back returns)
  const show = (id: string) => { for (const p of ['mHome', 'mLearn', 'mPractice', 'mSettings']) $(p).hidden = p !== id; };
  document.querySelectorAll<HTMLElement>('#menu [data-go]').forEach((el) => el.addEventListener('click', () => show(el.dataset.go!)));
  document.querySelectorAll<HTMLElement>('#menu .back').forEach((el) => el.addEventListener('click', () => show('mHome')));
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
    renderer.cloth ? `cloth: simulated ×${renderer.cloth.stress}, ${renderer.cloth.passes} passes a frame` : pick('cloth') === 'sim' ? `cloth: posed (failed: ${GpuCloth.failure ?? 'unknown'})` : 'cloth: posed',
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
function runOn() { for (let s = 0; s < t0; s += 1 / 60) { tick(1 / 60, false); bout.drain(); if (s > t0 - 1.5) renderer.simulate(bout); } recorder?.reset(); }

// ─── the camera by hand, while watching (a replay; a bout nobody's fencing): drag to orbit, pinch to zoom, two fingers
// (or the right button, or shift) to pan, a double tap to put it back. It moves the automatic camera, which goes on
// following the fencers ────────────────────────────────────────────────────────────────────────────────────────────
const cam = { yaw: 0, pitch: 0, zoom: 1, pan: [0, 0, 0] as V, used: false };
function resetCam() { cam.yaw = cam.pitch = 0; cam.zoom = 1; cam.pan = [0, 0, 0]; cam.used = false; }
// (`orbit=yaw,pitch,zoom,panX,panY,panZ` sets it from the address: for the devtools to look from an angle)
if (qs.has('orbit')) { const [y, p2, z, px, py, pz] = (qs.get('orbit') ?? '').split(',').map(Number); cam.yaw = y || 0; cam.pitch = p2 || 0; cam.zoom = z || 1; cam.pan = [px || 0, py || 0, pz || 0]; cam.used = true; }
const watchable = () => !!replay || auto;
/** the view as the hand has moved it: orbited about where it looks, nearer or further, and shifted */
function byHand(v: View): View {
  if (!cam.used) return v;
  const off = [v.eye[0] - v.at[0], v.eye[1] - v.at[1], v.eye[2] - v.at[2]], r = Math.hypot(off[0], off[1], off[2]) || 1;
  const yaw = Math.atan2(off[0], off[2]) + cam.yaw, pitch = clamp(Math.asin(clamp(off[1] / r, -1, 1)) + cam.pitch, -0.05, 1.45), d = clamp(r * cam.zoom, 0.7, 16);
  const at: V = [v.at[0] + cam.pan[0], v.at[1] + cam.pan[1], v.at[2] + cam.pan[2]];
  const eye: V = [at[0] + d * Math.sin(yaw) * Math.cos(pitch), Math.max(0.15, at[1] + d * Math.sin(pitch)), at[2] + d * Math.cos(yaw) * Math.cos(pitch)];
  // (out of anyone's head now: both bodies drawn)
  return { ...v, eye, at, self: -1 };
}
{
  const ptrs = new Map<number, { x: number; y: number; button: number }>();
  let tapLater: ReturnType<typeof setTimeout> | undefined;
  let start: { t: number; moved: number } | null = null, lastTap = 0, prev: { cx: number; cy: number; d: number } | null = null;
  const centre = () => { const ps = [...ptrs.values()]; const cx = ps.reduce((s2, p) => s2 + p.x, 0) / ps.length, cy = ps.reduce((s2, p) => s2 + p.y, 0) / ps.length; return { cx, cy, d: ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0 }; };
  // (panning moves where the camera looks, across and up the screen, in proportion to how far away it is)
  const pan = (dx: number, dy: number) => {
    const v = replay ? replayView(replay.r.bout) : view(bout), f = [v.at[0] - v.eye[0], v.at[2] - v.eye[2]], l = Math.hypot(f[0], f[1]) || 1;
    const right: V = [-f[1] / l, 0, f[0] / l], k = 0.0016 * Math.hypot(v.eye[0] - v.at[0], v.eye[1] - v.at[1], v.eye[2] - v.at[2]) * cam.zoom;
    cam.pan = [cam.pan[0] - right[0] * dx * k, cam.pan[1] + dy * k, cam.pan[2] - right[2] * dx * k];
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (!watchable()) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (ptrs.size === 1) start = { t: performance.now(), moved: 0 };
    prev = centre();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p || !watchable()) return;
    p.x = e.clientX; p.y = e.clientY;
    const c = centre(); if (!prev) { prev = c; return; }
    const dx = c.cx - prev.cx, dy = c.cy - prev.cy;
    if (start) start.moved += Math.hypot(dx, dy);
    if (ptrs.size > 1) { if (prev.d > 0 && c.d > 0) cam.zoom = clamp(cam.zoom * prev.d / c.d, 0.25, 4); pan(dx, dy); }
    else if (p.button === 2 || e.shiftKey) pan(dx, dy);
    else { cam.yaw -= dx * 0.006; cam.pitch += dy * 0.004; }
    if (start && start.moved > 6) cam.used = true;
    prev = c;
  });
  const up = (e: PointerEvent) => {
    if (!ptrs.delete(e.pointerId)) return;
    prev = ptrs.size ? centre() : null;
    if (ptrs.size || !start) return;
    // (a tap, not a drag: in the menu it hides or brings back the menu; two quick taps put the camera back)
    if (start.moved < 8 && performance.now() - start.t < 350) {
      const now = performance.now();
      // (a single tap waits a moment, in case it's the first of two)
      if (now - lastTap < 320) { resetCam(); lastTap = 0; clearTimeout(tapLater); }
      else { lastTap = now; if (mode === 'menu') tapLater = setTimeout(() => body.classList.toggle('watching'), 330); }
    }
    start = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (!watchable()) return; e.preventDefault(); cam.zoom = clamp(cam.zoom * Math.exp(e.deltaY * 0.001), 0.25, 4); cam.used = true; }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => { if (watchable()) e.preventDefault(); });
}

// ─── the warm-up: free until the right thumb comes to rest for a few seconds, where you are then being your guard;
// the count over their salute, then allez ──────────────────────────────────────────────────────────────────────────
const HOLD = 3, STILL = 0.08;
let holdT = 0, holdAt: [number, number] | null = null, said = '', calledAt = -1e9;
function warmup(real: number) {
  if (bout.phase === 'warmup') {
    const h = thumbs.hold();
    // (still: within a small circle of where it settled; moving past it starts the count again from there)
    if (!h.down) { holdT = 0; holdAt = null; }
    else if (!holdAt || Math.hypot(h.x - holdAt[0], h.y - holdAt[1]) > STILL * h.unit) { holdAt = [h.x, h.y]; holdT = 0; }
    else holdT += real;
    if (holdT >= HOLD) { holdT = 0; holdAt = null; bout.begin(); }
  } else { holdT = 0; holdAt = null; }
  body.classList.toggle('warmup', bout.phase === 'warmup');
  body.style.setProperty('--hold', String(Math.min(1, holdT / HOLD)));
  // (the words: what to do warming up; the count over the salute)
  let w = '';
  if (bout.phase === 'warmup') w = holdT > 0.25 ? 'warm up|hold still: en garde' : 'warm up|rest the right thumb to begin';
  else if (bout.phase === 'prelude') { const cd = bout.ceremony.countdown(); w = cd !== null && cd > 0 ? `${Math.ceil(Math.min(3, cd))}|` : '|'; }
  // (what's shown is redrawn when it isn't what should be: the referee's call is left up a moment first)
  const shown = `${$('say').textContent}|${$('sub').textContent}`;
  if ((w !== said || (w && shown !== w)) && performance.now() - calledAt > 1500) { if (w || said) { const [a, b2] = w.split('|'); say(a ?? '', b2 ?? ''); } said = w; }
}

let last = performance.now(), rate = 1;
function frame(now: number) {
  const real = Math.max(0, (now - last) / 1000), wall = Math.min(0.05, real);
  last = now;
  if (replay) runReplay(wall);
  else if (!qs.has('still')) {
    // (a bout nobody's fencing starts again a few seconds after it's over)
    if (auto && bout.phase === 'over' && bout.t - bout.phaseAt > 4) bout.restart();
    director.base = runner ? runner.pace : 1;
    rate = director.update(wall) * timeScale;
    const dt = wall * rate;
    tick(dt, true);
    // (the hold is counted in real seconds, whatever the frame rate)
    warmup(Math.min(0.5, real));
    const events = bout.drain();
    if (events.some((e) => e.type === 'reset')) recorder?.reset();
    runner?.hear(events);
    runner?.update(wall, dt);
    hear(events);
    // (the box has locked on a touch: see it again before the referee goes on)
    if (mode === 'bout' && replays && bout.phase === 'halt' && bout.box.first !== null && bout.box.locked(bout.t) && replayedFor !== bout.box.first) {
      replayedFor = bout.box.first;
      resetCam(); startReplay(bout.box.first - 1.3, bout.box.first + 0.25, bout.box.first);
    }
  }
  body.style.setProperty('--slow', String(replay ? 0 : clamp((1 - director.slow) / (1 - 0.2), 0, 1)));
  $('rate').textContent = !replay && director.slow < 0.93 ? `${director.slow.toFixed(2)}×` : '';
  scoreboard(replay ? replay.r.bout : bout);
  renderer.resize(Math.min(devicePixelRatio || 1, 2));
  const shown = replay ? replayView(replay.r.bout) : view(bout);
  renderer.draw(replay ? replay.r.bout : bout, { ...(watchable() ? byHand(shown) : shown), clay, bodies });
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
dressed.then(() => { runOn(); requestAnimationFrame(frame); });

