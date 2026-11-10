/**
 * Tactile: the pebble in the hand, on a phone.
 *
 * A hardware simulation of the AtomS3R reader: the firmware's own interaction logic
 * (afterword.c, compiled unchanged to WebAssembly) fed by a simulated hand and IMU, drawn on a
 * 3D device whose screen is the device's screen. Three ways to hold it: drag it (the hand mode:
 * sideways turns it like a dial, up and down tips its top edge away or toward you), hold the
 * phone itself as the device (phone mode: its accelerometer and gyro become the BMI270), or
 * replay a capture from the real device. Everything the firmware decides is shown as it decides
 * it: the gauges carry its thresholds, the events are its refusals, and a session records in
 * its telemetry schema.
 *
 * Query: `preview` (quiet, the scripted operator holds it), `auto` (the operator, with the
 * instruments), `mode=motion`, `tutorial=0|1`, `pace=<ms>`, `walk=<0..1.5>`, `tremor=<deg>`.
 */
import { Core } from './core';
import { CORE } from './core.gen';
import { anglesOf, poseQuat, NATURAL, type Quat, type Reading, type Realism, type V3 } from './imu';
import { drawReader, LCD } from './lcd';
import { Operator } from './operator';
import { DeviceView } from './render';
import { Session, type Observation, type SimEvent } from './session';

const C = CORE.constants as Record<string, number>;
const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const STORE = 'tactile:v1';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface Saved { tutorialDone: boolean; pace: number; invertRoll: boolean; invertPitch: boolean; note: string; hold: 'return' | 'hold'; realism: Realism; haptics: boolean }
const defaults: Saved = { tutorialDone: false, pace: C.DEFAULT_PACE_MS, invertRoll: false, invertPitch: false, note: '', hold: 'return', realism: { ...NATURAL }, haptics: false };
function load(): Saved {
  let s: Saved = { ...defaults, realism: { ...defaults.realism } };
  if (!preview) try { const j = JSON.parse(localStorage.getItem(STORE) ?? 'null'); if (j) s = { ...s, ...j, realism: { ...s.realism, ...j.realism } }; } catch { /* private window */ }
  if (params.has('tutorial')) s.tutorialDone = params.get('tutorial') === '0';
  if (params.has('pace')) s.pace = +params.get('pace')! || s.pace;
  if (params.has('walk')) s.realism.walk = +params.get('walk')!;
  if (params.has('tremor')) s.realism.tremor = +params.get('tremor')!;
  if (preview) s.tutorialDone = false;
  return s;
}
const saved = load();
const persist = () => { if (!preview) try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* fine */ } };

if (preview) document.documentElement.classList.add('preview');
$('fw').textContent = `fw ${CORE.firmware} · ${CORE.commit}`;
($('fw') as HTMLAnchorElement).href = `https://github.com/christopherdebeer/tactile/blob/${CORE.commit}/firmware/main/afterword.c`;

const core = Core.loadSync(Uint8Array.from(atob(CORE.wasm), (c) => c.charCodeAt(0)));
const session = new Session(core, { ...saved, realism: saved.realism, seed: 11, firmware: CORE.firmware });
session.hand.place(0, 0);

// --- the screen and the body -----------------------------------------------------------------
const lcd = document.createElement('canvas');
lcd.width = lcd.height = LCD;
const g = lcd.getContext('2d')!;
const view = new DeviceView($('view') as HTMLCanvasElement);
let lastFrameKey = '', lastFrameChange = 0;

// --- input -------------------------------------------------------------------------------------
type Mode = 'hand' | 'motion' | 'replay';
let mode: Mode = 'hand';
let operator: Operator | null = preview || params.has('auto') ? new Operator() : null;
const stage = $('stage');
const PX = 0.0062;                         // rad per CSS pixel of drag (≈ 80 px for a 28° turn)
let drag: { x: number; y: number; roll: number; pitch: number; id: number } | null = null;
stage.addEventListener('pointerdown', (e) => {
  if (mode !== 'hand' || operator) return;
  stage.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, roll: session.hand.targetRoll, pitch: session.hand.targetPitch, id: e.pointerId };
  stage.classList.add('held');
  $('coach').style.opacity = '0';
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  session.hand.targetRoll = clamp(drag.roll + (e.clientX - drag.x) * PX, -1.2, 1.2);
  session.hand.targetPitch = clamp(drag.pitch - (e.clientY - drag.y) * PX, -0.9, 0.9);
});
const release = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null; stage.classList.remove('held');
  if (saved.hold === 'return') { session.hand.targetRoll = 0; session.hand.targetPitch = 0; }
};
stage.addEventListener('pointerup', release);
stage.addEventListener('pointercancel', release);
// keys: arrows turn and tip while held (desktop, and a check that nothing needs a finger)
const keys = new Set<string>();
addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow')) { keys.add(e.key); e.preventDefault(); } });
addEventListener('keyup', (e) => keys.delete(e.key));

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

// phone: its IMU becomes the BMI270 (same axes: x right, y up the screen, z out of it)
let phone: Reading | null = null, phoneStatus = '';
const ios = typeof (window as unknown as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent?.requestPermission === 'function';
function onMotion(e: DeviceMotionEvent) {
  const a = e.accelerationIncludingGravity, r = e.rotationRate;
  if (!a || a.x === null) return;
  const sign = ios ? -1 : 1;                       // iOS reports gravity, not specific force
  let acc: V3 = [sign * (a.x ?? 0), sign * (a.y ?? 0), sign * (a.z ?? 0)];
  const d = Math.PI / 180;
  let gyr: V3 = [(r?.beta ?? 0) * d, (r?.gamma ?? 0) * d, (r?.alpha ?? 0) * d];
  const turn = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;   // landscape: rotate into the screen's axes
  if (turn) { const c = Math.cos(turn), s = Math.sin(turn); acc = [c * acc[0] + s * acc[1], -s * acc[0] + c * acc[1], acc[2]]; gyr = [c * gyr[0] + s * gyr[1], -s * gyr[0] + c * gyr[1], gyr[2]]; }
  const { roll, pitch } = anglesOf(acc);
  phone = { accel: acc, gyro: gyr, q: [0, 0, 0, 1], roll, pitch };
}
async function startMotion(): Promise<boolean> {
  const M = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
  if (!M) { phoneStatus = 'no motion sensors here'; return false; }
  try {
    if (typeof M.requestPermission === 'function' && (await M.requestPermission()) !== 'granted') { phoneStatus = 'motion refused: allow Motion & Orientation for this site'; return false; }
  } catch { phoneStatus = 'tap phone again to allow motion'; return false; }
  addEventListener('devicemotion', onMotion);
  phoneStatus = 'hold the phone upright, screen facing you';
  return true;
}
function setMode(m: Mode) {
  mode = m;
  $('m-hand').setAttribute('aria-pressed', String(m === 'hand'));
  $('m-motion').setAttribute('aria-pressed', String(m === 'motion'));
  session.source = m === 'motion' ? () => phone ?? session.hand.step(0.01) : m === 'replay' ? replaySource : null;
  $('coach').textContent = m === 'motion' ? phoneStatus || 'the phone is the device' : m === 'replay' ? 'replaying a capture' : 'drag sideways to turn · up / down to tip';
  $('coach').style.opacity = '1';
}
$('m-hand').onclick = () => setMode('hand');
$('m-motion').onclick = async () => { if (await startMotion()) setMode('motion'); else { $('coach').textContent = phoneStatus; $('coach').style.opacity = '1'; } };
if (params.get('mode') === 'motion') void startMotion().then((ok) => ok && setMode('motion'));

// --- replay a capture --------------------------------------------------------------------------
let replay: { rows: Observation[]; t0: number; i: number; start: number; agree: number; total: number; rateAgree: number } | null = null;
function replaySource(t: number): Reading {
  if (!replay) return session.hand.step(0.01);
  const due = replay.t0 + (t - replay.start) * 1e6;
  while (replay.i + 1 < replay.rows.length && replay.rows[replay.i + 1].monotonic_us <= due) replay.i++;
  const r = replay.rows[replay.i];
  const a = r.acceleration_mps2 as V3, w = r.angular_velocity_rps as V3;
  const { roll, pitch } = anglesOf(a);
  return { accel: a, gyro: w, q: poseQuat(roll, pitch), roll, pitch };
}
function startReplay(text: string) {
  const rows = text.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((o): o is Observation => o && o.type === 'observation' && Array.isArray(o.acceleration_mps2) && Array.isArray(o.angular_velocity_rps));
  if (!rows.length) { $('trace-status').textContent = 'No observation records in that file.'; return; }
  const first = rows[0].reader as { tutorial_complete?: boolean } | undefined;
  session.reset({ tutorialDone: first?.tutorial_complete ?? saved.tutorialDone });
  replay = { rows, t0: rows[0].monotonic_us, i: 0, start: session.t, agree: 0, total: 0, rateAgree: 0 };
  operator = null; ($('s-auto') as HTMLInputElement).checked = false;
  setMode('replay');
  $('trace-status').textContent = `Replaying ${rows.length} observations (${((rows[rows.length - 1].monotonic_us - rows[0].monotonic_us) / 1e6).toFixed(1)} s) from ${rows[0].role ?? 'a device'} · firmware ${rows[0].firmware_version ?? '?'}.`;
}
function checkReplay() {
  if (!replay) return;
  const r = replay.rows[replay.i].reader as { tutorial_stage?: string; rate?: number } | undefined;
  if (r?.tutorial_stage !== undefined) {
    replay.total++;
    if (r.tutorial_stage === session.state.stage) replay.agree++;
    if (Math.abs((r.rate ?? 0) - session.state.rate) < 0.15) replay.rateAgree++;
  }
  if (replay.i >= replay.rows.length - 1) {
    const pct = (n: number) => replay!.total ? `${Math.round((100 * n) / replay!.total)}%` : 'n/a';
    $('trace-status').textContent = `Replay finished. The recorded reader state agreed with this core on tutorial stage ${pct(replay.agree)} and rate (±0.15) ${pct(replay.rateAgree)} of ticks.`;
    replay = null; setMode('hand');
  }
}

// --- settings ------------------------------------------------------------------------------------
const bindRange = (id: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
  const el = $(`s-${id}`) as HTMLInputElement, out = $(`v-${id}`);
  el.value = String(get()); out.textContent = fmt(get());
  el.oninput = () => { set(+el.value); out.textContent = fmt(+el.value); persist(); };
};
bindRange('pace', () => saved.pace, (v) => { saved.pace = v; core.setPace(v); }, (v) => `${v} ms`);
bindRange('tremor', () => saved.realism.tremor, (v) => { saved.realism.tremor = v; session.hand.realism = saved.realism; }, (v) => `${v.toFixed(2)}°`);
bindRange('walk', () => saved.realism.walk, (v) => { saved.realism.walk = v; }, (v) => (v ? `${v.toFixed(2)}×` : 'still'));
bindRange('noise', () => saved.realism.noise, (v) => { saved.realism.noise = v; }, (v) => `${v.toFixed(1)}×`);
bindRange('bias', () => saved.realism.bias, (v) => { saved.realism.bias = v; }, (v) => `${(v * 57.3).toFixed(2)} °/s`);
session.hand.realism = saved.realism;
const check = (id: string, get: () => boolean, set: (v: boolean) => void) => {
  const el = $(`s-${id}`) as HTMLInputElement; el.checked = get(); el.onchange = () => { set(el.checked); persist(); };
};
check('invert-roll', () => saved.invertRoll, (v) => { saved.invertRoll = v; core.setInversions(saved.invertRoll, saved.invertPitch); });
check('invert-pitch', () => saved.invertPitch, (v) => { saved.invertPitch = v; core.setInversions(saved.invertRoll, saved.invertPitch); });
check('haptics', () => saved.haptics, (v) => { saved.haptics = v; });
check('auto', () => !!operator, (v) => { operator = v ? new Operator() : null; if (!v) { session.hand.targetRoll = 0; session.hand.targetPitch = 0; } });
const hold = $('s-hold') as HTMLSelectElement;
hold.value = saved.hold; hold.onchange = () => { saved.hold = hold.value as Saved['hold']; persist(); };
const note = $('s-note') as HTMLTextAreaElement;
note.value = saved.note;
note.onchange = () => {
  saved.note = note.value.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 95);
  note.value = saved.note; persist();
  session.reset({ note: saved.note, tutorialDone: saved.tutorialDone });
};
$('reset').onclick = () => session.reset({ tutorialDone: saved.tutorialDone, pace: saved.pace, invertRoll: saved.invertRoll, invertPitch: saved.invertPitch });
$('restart').onclick = () => { saved.tutorialDone = false; persist(); session.restartTutorial(); };

for (const b of document.querySelectorAll<HTMLButtonElement>('#tabs button')) b.onclick = () => {
  for (const o of document.querySelectorAll<HTMLButtonElement>('#tabs button')) o.setAttribute('aria-selected', String(o === b));
  for (const p of document.querySelectorAll<HTMLElement>('#panel section')) p.hidden = p.dataset.panel !== b.dataset.tab;
};

// trace
$('rec').onclick = () => {
  session.recording = !session.recording;
  $('rec').setAttribute('aria-pressed', String(session.recording));
  $('rec').textContent = session.recording ? '■ Stop' : '● Record';
  if (session.recording) session.log = [];
  $('trace-status').textContent = session.recording ? 'Recording at the reader\'s 50 Hz…' : `${session.log.length} observations recorded.`;
};
$('save').onclick = () => {
  const blob = new Blob([session.log.map((o) => JSON.stringify(o)).join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `tactile-sim-${new Date().toISOString().replace(/[:.]/g, '_')}.jsonl`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('load').onclick = () => $('file').click();
($('file') as HTMLInputElement).onchange = async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) startReplay(await f.text()); };

// --- instruments -------------------------------------------------------------------------------
const NS = 'http://www.w3.org/2000/svg';
const el = (parent: Element, tag: string, attrs: Record<string, string | number>) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  parent.appendChild(n); return n;
};
const ROLL_SPAN = 1.0;                 // ±57° of turn across the dial
const polar = (a: number, r: number) => [80 + r * Math.sin(a), 84 - r * Math.cos(a)];
const arc = (a0: number, a1: number, r: number) => {
  const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};
const dialA = (roll: number) => (clamp(roll, -ROLL_SPAN, ROLL_SPAN) / ROLL_SPAN) * (Math.PI / 2);
const rollSvg = $('g-roll') as unknown as SVGSVGElement;
const rollLabel = rollSvg.parentElement!.querySelector('.lab')!;
el(rollSvg, 'path', { d: arc(-Math.PI / 2, Math.PI / 2, 66), fill: 'none', stroke: 'var(--edge)', 'stroke-width': 10 });
el(rollSvg, 'path', { d: arc(dialA(C.ROLL_DEADZONE), dialA(C.ROLL_FULL_SCALE), 66), fill: 'none', stroke: 'var(--teal)', 'stroke-width': 10, opacity: 0.55 });
el(rollSvg, 'path', { d: arc(dialA(-C.ROLL_FULL_SCALE), dialA(-C.ROLL_DEADZONE), 66), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 10, opacity: 0.55 });
el(rollSvg, 'text', { x: 150, y: 90, 'font-size': 8, fill: 'var(--muted)', 'text-anchor': 'end' }).textContent = 'faster';
el(rollSvg, 'text', { x: 10, y: 90, 'font-size': 8, fill: 'var(--muted)' }).textContent = 'slower';
const intentNeedle = el(rollSvg, 'line', { x1: 80, y1: 84, x2: 80, y2: 26, stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '3 3' });
const rollNeedle = el(rollSvg, 'line', { x1: 80, y1: 84, x2: 80, y2: 22, stroke: 'var(--ink)', 'stroke-width': 2.5, 'stroke-linecap': 'round' });
el(rollSvg, 'circle', { cx: 80, cy: 84, r: 4, fill: 'var(--ink)' });

const P_SPAN = 0.6, py = (p: number) => 46 - (clamp(p, -P_SPAN, P_SPAN) / P_SPAN) * 40;
const pitchSvg = $('g-pitch') as unknown as SVGSVGElement;
el(pitchSvg, 'rect', { x: 24, y: 6, width: 12, height: 80, rx: 6, fill: 'var(--edge)' });
for (const s of [1, -1]) {
  el(pitchSvg, 'line', { x1: 18, x2: 42, y1: py(s * C.TILT_THRESHOLD), y2: py(s * C.TILT_THRESHOLD), stroke: s > 0 ? 'var(--teal)' : 'var(--accent)', 'stroke-width': 2 });
  el(pitchSvg, 'line', { x1: 20, x2: 40, y1: py(s * C.TILT_RELEASE), y2: py(s * C.TILT_RELEASE), stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '2 2' });
}
el(pitchSvg, 'text', { x: 46, y: py(C.TILT_THRESHOLD) + 3, 'font-size': 7, fill: 'var(--muted)' }).textContent = 'in';
el(pitchSvg, 'text', { x: 46, y: py(-C.TILT_THRESHOLD) + 3, 'font-size': 7, fill: 'var(--muted)' }).textContent = 'out';
const pitchIntent = el(pitchSvg, 'line', { x1: 14, x2: 46, y1: 46, y2: 46, stroke: 'var(--muted)', 'stroke-dasharray': '3 2' });
const pitchDot = el(pitchSvg, 'circle', { cx: 30, cy: 46, r: 6, fill: 'var(--ink)' });

const R_MIN = C.RATE_MIN, R_MAX = C.RATE_MAX, rx = (v: number) => 10 + ((clamp(v, R_MIN, R_MAX) - R_MIN) / (R_MAX - R_MIN)) * 140;
const rateSvg = $('g-rate') as unknown as SVGSVGElement;
el(rateSvg, 'rect', { x: 10, y: 50, width: 140, height: 10, rx: 5, fill: 'var(--edge)' });
el(rateSvg, 'rect', { x: rx(R_MIN), y: 50, width: rx(0) - rx(R_MIN), height: 10, rx: 5, fill: 'var(--accent)', opacity: 0.25 });
for (const v of [-2, -1, 0, 1, 2, 3, 4]) {
  el(rateSvg, 'line', { x1: rx(v), x2: rx(v), y1: 62, y2: v === 0 ? 70 : 66, stroke: 'var(--muted)', 'stroke-width': v === 0 ? 1.5 : 1 });
  el(rateSvg, 'text', { x: rx(v), y: 80, 'font-size': 8, 'text-anchor': 'middle', fill: 'var(--muted)' }).textContent = `${v}×`;
}
const rateBar = el(rateSvg, 'rect', { x: rx(0), y: 50, width: 0, height: 10, rx: 3, fill: 'var(--ink)' });
const rateText = el(rateSvg, 'text', { x: 80, y: 36, 'font-size': 16, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-family': 'ui-monospace,monospace' });

const deg = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r * 57.2958).toFixed(0)}°`;
function instruments() {
  const s = session.state;
  const a = dialA(s.roll), [x, y] = polar(a, 62);
  rollNeedle.setAttribute('x2', x.toFixed(1)); rollNeedle.setAttribute('y2', y.toFixed(1));
  const intent = mode === 'hand' ? session.hand.targetRoll : s.roll;
  const [ix, iy] = polar(dialA(intent), 58);
  intentNeedle.setAttribute('x2', ix.toFixed(1)); intentNeedle.setAttribute('y2', iy.toFixed(1));
  rollLabel.textContent = `roll ${s.ready ? deg(s.roll) : '—'} · pace`;
  pitchDot.setAttribute('cy', py(s.pitch).toFixed(1));
  pitchDot.setAttribute('fill', s.latched ? 'var(--warn)' : 'var(--ink)');
  const pi = py(mode === 'hand' ? session.hand.targetPitch : s.pitch).toFixed(1);
  pitchIntent.setAttribute('y1', pi); pitchIntent.setAttribute('y2', pi);
  const x0 = rx(0), x1 = rx(s.rate);
  rateBar.setAttribute('x', String(Math.min(x0, x1))); rateBar.setAttribute('width', String(Math.abs(x1 - x0)));
  rateBar.setAttribute('fill', s.rate < 0 ? 'var(--accent)' : 'var(--ink)');
  rateText.textContent = s.rate === 0 ? 'paused' : `${s.rate < 0 ? '◂ ' : ''}${Math.abs(s.rate).toFixed(2)}×`;
  const flag = (id: string, on: boolean) => $(id).classList.toggle('on', on);
  flag('f-ready', s.ready); flag('f-armed', s.rollArmed); flag('f-active', s.rollActive); flag('f-focused', s.focused); flag('f-latched', s.latched);
  $('f-stage').textContent = s.tutorial ? `tutorial · ${s.stage}` : `${CORE.firmware} reader`;
  $('trail').textContent = s.tutorial ? '' : session.depth.join(' › ');
}

let shown = 0;
function events() {
  if (session.events.length === shown) return;
  for (const e of session.events.slice(shown)) haptic(e);
  shown = session.events.length;
  $('log-empty').hidden = shown > 0;
  const items = session.events.slice(-80).reverse().map((e) =>
    `<li class="${e.kind}"><time>${e.t.toFixed(1)}s</time><span>${e.kind}</span><span>${e.detail}</span></li>`);
  $('log').innerHTML = items.join('');
}
function metrics() {
  const m = session.metrics;
  const stages = Object.entries(m.stages).filter(([k]) => k !== 'done').map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(' · ') || '—';
  const notices = Object.entries(m.notices).filter(([k]) => k !== 'tutorial complete').map(([k, v]) => `${k} ×${v}`).join(' · ') || 'none';
  const rows: [string, string][] = [
    ['session', `${session.t.toFixed(0)} s`],
    ['tutorial', m.tutorialDoneAt !== null ? `done in ${m.tutorialDoneAt.toFixed(1)} s` : session.state.tutorial ? `at ${session.state.stage}` : 'skipped'],
    ['stage times', stages],
    ['words shown', String(m.words)],
    ['entered / left', `${m.enters} / ${m.exits}`],
    ['refused intentions', notices],
    ['reversals', String(m.reversals)],
    ['rate range', `${m.minRate.toFixed(2)}× … ${m.maxRate.toFixed(2)}×`],
    ['time paused', `${m.pausedSeconds.toFixed(1)} s`],
    ['thresholds', `roll ${deg(C.ROLL_DEADZONE)}…${deg(C.ROLL_FULL_SCALE)} · tilt ${deg(C.TILT_THRESHOLD)} for ${C.TILT_DWELL_MS} ms · focus ${C.FOCUS_DWELL_MS} ms`],
  ];
  $('metrics').innerHTML = rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
}
function haptic(e: SimEvent) {
  if (!saved.haptics || !navigator.vibrate) return;
  const p = e.kind === 'enter' ? [28] : e.kind === 'exit' ? [12, 40, 12] : e.kind === 'focus' ? [6] : e.kind === 'notice' && e.detail !== 'tutorial complete' ? [60] : null;
  if (p) navigator.vibrate(p);
}

// --- the loop ------------------------------------------------------------------------------------
let last = performance.now(), ui = 0;
const report = {} as Record<string, unknown>;
(window as unknown as { __tactile: unknown }).__tactile = report;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'hand') {
    if (operator) {
      const i = operator.next(session.t, session.frame, session.state);
      session.hand.targetRoll = i.roll; session.hand.targetPitch = i.pitch;
    } else if (keys.size) {
      const r = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), p = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
      session.hand.targetRoll = 0.45 * r; session.hand.targetPitch = 0.5 * p;
    } else if (!drag && saved.hold === 'return' && !operator) { /* the spring brings it home */ }
  }
  session.advance(dt);
  if (mode === 'replay') checkReplay();
  if (session.state.tutorialDone && !saved.tutorialDone && !preview) { saved.tutorialDone = true; persist(); }
  if (preview && session.t > 150) { session.reset({ tutorialDone: false }); operator = new Operator(); }

  const f = session.frame, key = `${f.section}|${f.word}|${f.after}|${f.hint}|${session.state.anchor}`;
  if (key !== lastFrameKey) { drawReader(g, f, session.state.anchor); view.screen(lcd); lastFrameKey = key; lastFrameChange = session.t; }
  // the firmware's backlight: dims 30 s after the screen last changed, off after two minutes
  const idle = session.t - lastFrameChange;
  const backlight = idle > 120 ? 0 : idle > 30 ? 20 / 112 : 1;
  const r = session.reading;
  let q: Quat, light: V3;
  if (mode === 'motion') {
    q = [0, 0, 0, 1];
    const a = r.accel, n = Math.hypot(a[0], a[1], a[2]) || 1;
    light = [a[0] / n * 0.7 - 0.25, a[1] / n * 0.7 + 0.2, 0.75];
  } else {
    q = r.q; light = [-0.45, 0.75, 0.62];
  }
  view.draw({ q, light, backlight });
  instruments();
  if (now - ui > 200) { events(); metrics(); ui = now; }
  Object.assign(report, { t: session.t, mode, frame: f, state: session.state, depth: session.depth, events: session.events.length, metrics: session.metrics });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
