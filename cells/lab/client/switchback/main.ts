/**
 * Switchback: a downhill motocross run down a mountain that's made as you ride it, drawn flat and faceted, its speed
 * drawn as vector shards. Drag across to steer (nothing steers for you), up and down to drive (throttle, brake; on a ramp, down pulls for a backflip; in the air, the throttle and brake trim it, and across are the body's tricks). Kickers launch you over gaps;
 * whoops throw you; the wall glances you off; the drop side can be ridden, but too far down it, or too hard a landing,
 * is a crash, and you're back at the last checkpoint flag.
 *
 * It opens on its title, the sim's own rider riding the mountain behind it; RIDE starts your run (and the sound, which
 * needs a tap). The menu (the button top left, or Esc) pauses, with the settings: sound and its volume, how far back the
 * eye rides, another mountain. Settings are kept in this browser.
 *
 * Flags: `seed=` the mountain; `auto` the sim's own rider rides a run, scored and ended in the page's mode like yours but
 * never kept on your board (`auto=tricks` showing off; the preview rides too); `t=` start that many seconds
 * down (ridden by it, for pinned frames); `still` hold the frame there; `preview` nothing over the picture (with `auto`, as
 * the lab's listing shows it, the sim's run with its score and calls, riding again when it ends); `look=side|front|rear|quarter`
 * a close look at the bike. Any of these skips the title. `ruts=bolts` the ruts as they were before they were carved
 * (`ruts=light`, with them, paler than the road). `wake=fixed` the air on the rider as it was
 * (three streaks set at the helmet and the bars); `wake=0` none on the rider at all. `paint=0|1` the look for this page (painted is the default, and a setting): everything painted in brush strokes, laid by a paint front ahead of you (`stretch=0…2` how far its strokes stretch along their motion; `front=700,110` how far ahead the front lays the masses and the detail).
 */
import { Course } from './course';
import { BODY, Rider, TRICKS, autoSteer, VMAX } from './sim';
import type { Trick } from './sim';
import { Stroke } from './gesture';
import { Trickster } from './tricks';
import { Renderer, View } from './render';
import { M, PALETTE, RUT_LIGHT } from './mesh';
import { Sound } from './audio';
import { MODES, Mode, PAR, Score, bestOf, board, keepBest, overPar, sign } from './score';
import { Pad, replay, show as ink } from './sign';
import { C15R } from './hand';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still');
const look = q.get('look');
const zjit = q.has("zjit"), ejit = q.has("ejit"), hold = q.has("hold"), t0 = performance.now();
let heldView: View | null = null;
/** straight into it (tests, pinned frames, the preview): no title */
const direct = preview || still || q.has('auto') || q.has('t') || !!look;
let auto = q.has('auto') || preview || !direct;
// (the sim's own rider shows off on the title, and with `auto=tricks`: slides, whips, flips, whatever the jump allows)
const showing = q.get('auto') === 'tricks' || !direct;
/** `auto` (or `auto=tricks`) is a run like yours, in the mode chosen: scored, called, ended as the mode ends, with its card
 * (but the sim's runs are never kept on your board); held frames (`still`, `look=`) aren't runs */
const demo = q.has('auto') && !still && !look;
let trickster = new Trickster();
const autoInput = () => (showing ? trickster.input(rider) : { steer: autoSteer(rider), brake: false });

document.getElementById('seed')!.textContent = String(seed);
// (the preview, as the lab's listing shows it: the sim's run with its score and calls, `preview&auto=tricks`, or held
// frames with nothing over them)
if (preview) document.body.classList.add(demo ? 'demo' : 'preview');
const world = document.getElementById('world') as HTMLCanvasElement, speed = document.getElementById('speed') as HTMLCanvasElement;
const course = new Course(seed);
let rider = new Rider(course);
if (q.get('ruts') === 'light') PALETTE[M.RUT] = RUT_LIGHT;
const rd = new Renderer(world, speed, course);
rd.resize(); addEventListener('resize', () => rd.resize());
rd.speed = q.get('fx') !== '0'; rd.fog = q.get('fog') !== '0';
/** `wake=fixed`: the air on the rider as three streaks set at the helmet and the bars, as it was; `wake=0`: none at all */
if (q.get('wake') === 'fixed') rd.wake = 'fixed'; else if (q.get('wake') === '0') rd.wake = 'none';
/** `ruts=bolts`: the ruts as they were before they were carved */
if (q.get('ruts') === 'bolts') { rd.rutStyle = 'bolts'; rd.trail.cut = false; }
/** `paint=1`: the mountain laid in brush strokes over its facets (paint.ts); `stretch=` how far its strokes stretch along their motion (0 none, 1 as drawn, 2 twice) */
/** the look: painted (the default) or cut facets; kept in the settings, `paint=0|1` for this page only */
const paintFlag = q.has('paint') ? q.get('paint') !== '0' : null;
// (`bg=yaw,pitch,fov` (degrees): only the backdrop (the sky, the ranges, the valley), looking that way from where you are,
// for judging the far off on its own)
const bgFlag = q.has('bg') ? (q.get('bg') ?? '').split(',').map(Number) : null;
/** `front=700,110`: how far ahead of the rider the paint front lays the masses and the detail (m) */
if (q.has('front')) { const [a, b] = (q.get('front') ?? '').split(',').map(Number); if (a > 0 && b > 0) rd.leadWanted = [a, b]; }
if (q.has('stretch')) rd.stretchWanted = Math.max(0, Math.min(2, Number(q.get('stretch')) || 0));
rd.style = q.get('rider') === 'facets' ? 'facets' : q.get('rider') === 'sil' ? 'sil' : 'cut'; rd.whip = (Number(q.get('whip') ?? 0) * Math.PI) / 180; rd.world = q.get('world') !== '0';
const sound = new Sound();

// (settings, kept in this browser where it can)
type Settings = { sound: boolean; volume: number; camera: 'close' | 'mid' | 'far'; mode: Mode; paint: boolean; v: number };
const settings: Settings = { sound: true, volume: 0.7, camera: 'mid', mode: 'lives', paint: true, v: 2 };
try {
  // (settings kept before THREE LIVES was the first choice: the mode they kept was only ever the old first one, so it goes)
  const kept = JSON.parse(localStorage.getItem('switchback') ?? '{}');
  if (kept.v !== 2) delete kept.mode;
  Object.assign(settings, kept, { v: 2 });
} catch { /* (private, or blocked: defaults) */ }
if (!MODES[settings.mode]) settings.mode = 'lives';
if (typeof settings.paint !== 'boolean') settings.paint = true;
rd.paint = paintFlag ?? settings.paint;
const keep = () => { try { localStorage.setItem('switchback', JSON.stringify(settings)); } catch { /* (no matter) */ } };
/** `mode=run|lives|time|endless` for this page only */
const modeFlag = q.get('mode') as Mode | null;
if (modeFlag && MODES[modeFlag]) settings.mode = modeFlag;
/** the eye's three distances: MID as it always was; CLOSE tight behind the rider and low; FAR high and well back, an
 * overview of the road ahead (each a scale on how far back, how high, how far to the side, how far ahead it looks, how
 * far down, and its field) */
const CAMERA = {
  close: { back: 0.5, high: 0.72, side: 0.6, ahead: 0.62, drop: 1.05, fov: 0.92 },
  mid: { back: 1, high: 1, side: 1, ahead: 1, drop: 1, fov: 1 },
  far: { back: 2.3, high: 2.2, side: 1.6, ahead: 1.45, drop: 1.9, fov: 0.95 },
};
/** `cam=close|mid|far` for this page only (not kept): for pinned frames */
const camFlag = q.get('cam') as keyof typeof CAMERA | null;

// (input: a drag from where it began: across, it steers; up and down, it drives (up the throttle, down the brake, as far
// as you drag; on a ramp, down is the pull: a backflip, committed at the lip; in the air, up and down trim it, and across
// does nothing). A touch that starts in the air (a fresh one, or a second finger) is a gesture: drawn, it's read into a
// trick (gesture.ts) and held while it's down; one still down as you land becomes the steering. Keys too (in the air Z
// X C V R F T G the body's tricks, Q E the whip). Not while the menu's open, and never from a press on the menu or a link)
const inp = { steer: 0, drive: 0 };
let drag: { x: number; y: number; id: number } | null = null;
let gest: { id: number; stroke: Stroke } | null = null, trace: { stroke: Stroke; fade: number } | null = null;
const trickKeys: [string, Trick][] = [['z', 'hands'], ['x', 'feet'], ['c', 'superman'], ['v', 'cancan'], ['r', 'heel'], ['f', 'nacnac'], ['t', 'grab'], ['g', 'rock'], ['q', 'whipL'], ['e', 'whipR']];
const keys = new Set<string>();
const onUi = (e: Event) => !!(e.target as HTMLElement).closest('a,button,input,#menu');
addEventListener('pointerdown', (e) => {
  if (onUi(e) || menuOpen) return;
  if (direct) auto = false; hint();
  if (rider.air && rider.crashT <= 0 && !auto && !gest) { const st = new Stroke(Math.min(innerWidth, innerHeight)); st.add(e.clientX, e.clientY); gest = { id: e.pointerId, stroke: st }; trace = { stroke: st, fade: 1 }; return; }
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
addEventListener('pointermove', (e) => {
  if (gest && e.pointerId === gest.id) { gest.stroke.add(e.clientX, e.clientY); return; }
  if (!drag || e.pointerId !== drag.id) return;
  const span = Math.min(innerWidth, innerHeight) * 0.24;
  inp.steer = Math.max(-1, Math.min(1, (e.clientX - drag.x) / span));
  inp.drive = Math.max(-2, Math.min(2, (drag.y - e.clientY) / span)); // (past ±1 only matters in the air, from where the drag stood at take-off)
});
const up = (e: PointerEvent) => { if (gest && e.pointerId === gest.id) gest = null; if (drag && e.pointerId === drag.id) { drag = null; inp.steer = 0; inp.drive = 0; } };
addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !direct) { if (menuOpen && running) close(); else open(); return; }
  if (menuOpen || (e.target as HTMLElement).closest('input')) return;
  keys.add(e.key.toLowerCase()); if (direct) auto = false; hint();
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let hinted = false;
const hintEl = document.getElementById('hint')!;
function hint() { if (!hinted) { hinted = true; hintEl.classList.add('gone'); } }

// (start down the hill if asked, ridden by the sim's rider)
const T0 = Number(q.get('t') ?? 0);
for (let t = 0; t < T0; t += 1 / 120) { rider.step(1 / 120, autoInput()); rd.trail.add(rider); }
rider.events.length = 0;

// (the chase eye: behind and above, over the drop-side shoulder, swinging round after the bike, never into the ground;
// how far back it rides is a setting)
const cam = { h: rider.travel, eye: [rider.x, rider.y + 4, rider.z - 8], shake: 0, fovKick: 0, air: 0 };
/** a close look at the bike and rider (`look=side|front|rear|quarter`), for judging the model: the eye held off the bike */
function closeLook(): View | null {
  if (!look) return null;
  const fx = Math.sin(rider.heading), fz = Math.cos(rider.heading), rx = -Math.cos(rider.heading), rz = Math.sin(rider.heading);
  const at = (f: number, s: number, h: number) => [rider.x + fx * f + rx * s, rider.y + h, rider.z + fz * f + rz * s];
  const eye = look === 'side' ? at(0, 3.6, 1.1) : look === 'front' ? at(4.2, 0.4, 1.3) : look === 'rear' ? at(-4, 0.3, 1.4) : at(-2.6, 2.8, 1.7);
  return { eye, target: at(0, 0, 0.85), fov: 0.8, roll: 0 };
}
function snapEye() { cam.h = rider.travel; cam.eye = [rider.x - Math.sin(rider.travel) * 6, rider.y + 3.5, rider.z - Math.cos(rider.travel) * 6]; cam.shake = 0; }
function view(dt: number, t: number): View {
  const close = closeLook(); if (close) return close;
  const k = 1 - Math.exp(-dt * (rider.air ? 1.6 : 3.2));
  // (after the way you're going, not the way the bike points, so a slide shows as the bike yawed across the frame)
  if (rider.crashT <= 0) cam.h += Math.atan2(Math.sin(rider.travel - cam.h), Math.cos(rider.travel - cam.h)) * k;
  const fx = Math.sin(cam.h), fz = Math.cos(cam.h), rx = -Math.cos(cam.h), rz = Math.sin(cam.h), d = CAMERA[camFlag ?? settings.camera] ?? CAMERA.mid;
  // (a long flight: the eye eases out to the drop side and holds the rider in the middle of the frame, so a flip or a whip
  // reads as a turn of the whole figure; it comes back in as you come down)
  cam.air += ((rider.air && rider.crashT <= 0 && rider.airT > 0.35 ? 1 : 0) - cam.air) * (1 - Math.exp(-dt * 1.6));
  const pace = Math.min(1, Math.hypot(rider.vx, rider.vz) / VMAX), back = (4.6 + pace * 1.1 + cam.air * 1.5) * d.back, high = (3.3 + pace * 0.4 - cam.air * 1.2) * d.high, side = (1.5 + cam.air * 4.5) * d.side;
  const want = [rider.x - fx * back + rx * side, rider.y + high, rider.z - fz * back + rz * side];
  if (rider.crashT > 0) { want[0] = cam.eye[0]; want[2] = cam.eye[2]; }
  const ke = 1 - Math.exp(-dt * 7);
  for (let i = 0; i < 3; i++) cam.eye[i] += (want[i] - cam.eye[i]) * (i === 1 ? 1 - Math.exp(-dt * 4) : ke);
  // (never into the ground: the eye stays above the slope under it)
  const loc = course.locate(cam.eye[0], cam.eye[2], Math.max(0, rider.s - 8)), gy = course.point(loc.s, Math.max(-9, Math.min(9, loc.u))).y;
  cam.eye[1] = Math.max(cam.eye[1], gy + 1.8);
  cam.shake *= Math.exp(-dt * 7);
  const sh = cam.shake, jx = Math.sin(t * 61) * sh * 0.3, jy = Math.sin(t * 47 + 1) * sh * 0.25;
  const ah = 12 * d.ahead * (1 - cam.air * 0.75), dr = 3 * d.drop * (1 - cam.air * 0.8);
  const target = rider.crashT > 0 ? [rider.x, rider.y + 0.5, rider.z] : [rider.x + fx * ah, rider.y - dr, rider.z + fz * ah];
  cam.fovKick += ((rider.air ? 0.06 : 0) - cam.fovKick) * (1 - Math.exp(-dt * 3));
  return { eye: [cam.eye[0] + jx, cam.eye[1] + jy, cam.eye[2]], target, fov: (58 + pace * 16) * d.fov * Math.PI / 180 + cam.fovKick + rd.fx.push * 0.035 - rd.fx.brake * 0.05 + rd.fx.shift * 0.015, roll: rider.lean * 0.15 + Math.sin(t * 53) * sh * 0.02 };
}

// (the title and the menu: one panel. On the title the sim's rider rides behind it; RIDE starts your run. In a run, the
// menu pauses it: CARRY ON, START AGAIN)
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = $('menu'), go = $<HTMLButtonElement>('go'), again = $<HTMLButtonElement>('again'), finishBtn = $<HTMLButtonElement>('finish'), quit = $<HTMLButtonElement>('quit');
const sndBtn = $<HTMLButtonElement>('snd'), vol = $<HTMLInputElement>('vol'), another = $<HTMLButtonElement>('another');
const lookBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-look]')], camBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-cam]')], modeBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
const toBoard = $<HTMLButtonElement>('toBoard'), boardBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-board]')];
const panels = { main: $('main'), prefs: $('prefs'), board: $('board'), card: $('card') };
/** which of the menu's panels shows: the main one (ride, the mode), the settings, the leaderboard, a finished run's card */
const show = (k: keyof typeof panels) => { for (const [n, el] of Object.entries(panels)) el.hidden = n !== k; menu.dataset.panel = k; };
$('mseed').textContent = String(seed);
/** (this run was the sim's, if only to begin with: it's never kept) */
let simRun = demo;
let menuOpen = !direct, running = demo, paused = false, finished = false, mode: Mode = settings.mode, score = new Score();
const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
function showSettings() {
  sndBtn.textContent = settings.sound ? 'ON' : 'OFF'; sndBtn.setAttribute('aria-pressed', String(settings.sound));
  vol.value = String(Math.round(settings.volume * 100)); vol.disabled = !settings.sound;
  for (const b of camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === settings.camera));
  for (const b of lookBtns) b.setAttribute('aria-pressed', String((b.dataset.look === 'paint') === rd.paint));
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === settings.mode));
  const best = bestOf(settings.mode, seed), m = settings.mode, mark = (b: { score: number; time: number }) => (m === 'time' ? clock(b.time) : fmt(b.score));
  $('about').textContent = `${MODES[m].about} · PAR ${mark(PAR[m])}${best ? ` · BEST ${mark(best)}` : ''}`;
  sound.on = settings.sound; sound.volume = settings.volume;
}
function open() {
  menuOpen = true; paused = running; menu.classList.add('on'); menu.removeAttribute('inert'); show('main');
  go.textContent = running ? 'CARRY ON' : 'RIDE'; again.hidden = !running; quit.hidden = !running; toBoard.hidden = running;
  // (an endless run is finished by hand: that's when it's scored)
  finishBtn.hidden = !(running && mode === 'endless'); $('modeSet').hidden = running;
  sound.hush(true); go.focus();
}
function close() { menuOpen = false; paused = false; menu.classList.remove('on'); menu.setAttribute('inert', ''); sound.hush(false); }
function begin() {
  // (a fresh run in the mode chosen: a new rider at the top, the eye with it, yours to ride, the score at nothing)
  // (on a page the sim rides, `auto`: the sim's run again, yours as soon as you touch)
  rider = new Rider(course); auto = demo; simRun = demo; running = true; finished = false; mode = settings.mode; score = new Score();
  if (demo) trickster = new Trickster();
  sound.reset(); seen = 0; snapEye(); rd.trail.clear();
  hinted = false; hintEl.classList.remove('gone');
}
/** back to the title: the sim's own rider showing off again behind it, and the title signed again */
function toTitle() {
  running = false; finished = false; rider = new Rider(course); auto = true; trickster = new Trickster(); seen = 0; sound.reset(); snapEye(); rd.trail.clear();
  showSettings(); open(); autograph(400);
}
/** the title's autograph, c15r's, written across the logo (the ink a marker's on a poster, a little heavier) */
const autoCv = $<HTMLCanvasElement>('autograph'), AUTOGRAPH_INK = '#111';
const autograph = (delay: number) => replay(autoCv, C15R, AUTOGRAPH_INK, delay, 230, 1.3);
addEventListener('resize', () => ink(autoCv, C15R, AUTOGRAPH_INK, Infinity, 1.3));
/** the leaderboard for a mode: its best runs in this browser, each signature written out again as it was, one after
 * another down the board; the run just signed in orange */
let lastAt = 0;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'ST' : n % 10 === 2 && n !== 12 ? 'ND' : n % 10 === 3 && n !== 13 ? 'RD' : 'TH'}`;
function showBoard(m: Mode) {
  for (const b of boardBtns) b.setAttribute('aria-pressed', String(b.dataset.board === m));
  const list = board(m), ol = $('boardList');
  ol.textContent = '';
  list.forEach((e, i) => {
    const li = document.createElement('li'), now = !!e.at && e.at === lastAt;
    const day = e.at ? new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase() : '';
    const what = m === 'time' ? clock(e.time) : fmt(e.score), where = e.par ? 'PAR · ANY MOUNTAIN' : `MOUNTAIN ${e.seed}${day ? ` · ${day}` : ''}`;
    li.className = now ? 'now' : e.par ? 'par' : '';
    li.innerHTML = `<b class="n">${i + 1}</b><canvas aria-hidden="true"></canvas><span class="pts">${what}<small>${where}</small></span>`;
    li.setAttribute('aria-label', `${ordinal(i + 1)}: ${what}, ${e.par ? 'par, signed Claude' : `mountain ${e.seed}${e.sig ? ', signed' : ''}`}`);
    ol.append(li);
    if (e.sig?.length) replay(li.querySelector('canvas')!, e.sig, now ? '#ff7428' : '#fff', 150 + i * 180);
  });
  // (only the PAR on it: an invitation)
  if (list.every((e) => e.par)) ol.insertAdjacentHTML('beforeend', `<li class="none">NO ${MODES[m].name} RUNS OF YOURS YET<br>BEAT PAR, SIGN THE BOARD</li>`);
}
/** the pad on a new best's card: each stroke put to the run on the board as it's made (so there's nothing to confirm:
 * leave it blank and the run stays unsigned) */
const signEl = $('sign'), clearSig = $<HTMLButtonElement>('clearSig');
let signing: { mode: Mode; at: number } | null = null;
const pad = new Pad($<HTMLCanvasElement>('pad'), (sig) => {
  if (signing) sign(signing.mode, signing.at, sig);
  signEl.classList.toggle('inked', sig.length > 0); clearSig.hidden = !sig.length;
});
pad.cv.addEventListener('pointerdown', () => signEl.classList.add('inked'));
clearSig.addEventListener('click', () => pad.clear());
addEventListener('resize', () => pad.paint());

/** the run's over (its finish reached, its lives gone, or called a day): scored, kept if it's the best, and shown */
function finish() {
  // (the listing's preview has no card: it just rides again)
  if (preview && simRun) { begin(); return; }
  score.close(); finished = true; running = false;
  // (the sim's own run: shown like yours, but not kept, so it's never on your board)
  const sims = simRun, { better, was, rank, at } = sims ? { better: false, was: bestOf(mode, seed), rank: -1, at: 0 } : keepBest(mode, seed, score.shown, score.time), card = $('card');
  $('cardMode').textContent = `${MODES[mode].name} · MOUNTAIN ${seed}`;
  $('cardBig').textContent = mode === 'time' ? clock(score.time) : fmt(score.shown);
  $('cardNew').textContent = sims ? `THE SIM'S RUN · NOT KEPT${overPar(mode, score.shown, score.time) ? ' · PAR BEATEN' : ''}`
    : (!was ? 'FIRST RUN' : better ? 'A NEW BEST' : `BEST ${mode === 'time' ? clock(was.time) : fmt(was.score)}`) + (rank >= 0 ? ` · ${ordinal(rank + 1)} ON THE BOARD` : '')
    + (overPar(mode, score.shown, score.time) ? ' · PAR BEATEN' : '');
  card.classList.toggle('best', better && !!was);
  const row = (k: string, v: string) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  $('cardRows').innerHTML = row('DISTANCE', `${(Math.max(0, rider.s - 2) / 1000).toFixed(1)} KM`) + row('TIME', clock(score.time)) + (mode === 'time' ? row('SCORE', fmt(score.shown)) : '')
    + row('TRICKS', String(score.tricks)) + row('BEST COMBO', fmt(score.bestCombo)) + row('FALLS', String(score.falls));
  // (on the board: it's yours to sign)
  signing = rank >= 0 ? { mode, at } : null; signEl.hidden = !signing; card.classList.toggle('signing', !!signing); signEl.classList.remove('inked'); clearSig.hidden = true;
  if (signing) lastAt = at;
  menuOpen = true; paused = true; menu.classList.add('on'); menu.removeAttribute('inert'); show('card'); sound.hush(true);
  pad.reset();
  sound.chime(better && !!was ? 3 : 2); $('cardAgain').focus({ preventScroll: true }); card.parentElement!.scrollTop = 0; menu.scrollTop = 0;
}
go.addEventListener('click', () => { sound.start(); if (!running) begin(); close(); });
again.addEventListener('click', () => { sound.start(); begin(); close(); });
finishBtn.addEventListener('click', () => finish());
quit.addEventListener('click', () => toTitle());
$('cardAgain').addEventListener('click', () => { sound.start(); begin(); close(); });
$('cardMenu').addEventListener('click', () => toTitle());
$('toPrefs').addEventListener('click', () => { show('prefs'); $('fromPrefs').focus(); });
$('fromPrefs').addEventListener('click', () => { show('main'); $('toPrefs').focus(); });
toBoard.addEventListener('click', () => { show('board'); showBoard(settings.mode); boardBtns.find((b) => b.dataset.board === settings.mode)?.focus(); });
for (const b of boardBtns) b.addEventListener('click', () => showBoard(b.dataset.board as Mode));
$('fromBoard').addEventListener('click', () => { show('main'); toBoard.focus(); });
sndBtn.addEventListener('click', () => { settings.sound = !settings.sound; keep(); showSettings(); if (settings.sound) sound.start(); });
vol.addEventListener('input', () => { settings.volume = Number(vol.value) / 100; keep(); showSettings(); });
for (const b of camBtns) b.addEventListener('click', () => { settings.camera = b.dataset.cam as Settings['camera']; keep(); showSettings(); });
for (const b of lookBtns) b.addEventListener('click', () => { settings.paint = rd.paint = b.dataset.look === 'paint'; keep(); showSettings(); });
for (const b of modeBtns) b.addEventListener('click', () => { settings.mode = b.dataset.mode as Mode; keep(); showSettings(); });
another.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('seed', String(1 + Math.floor(Math.random() * 9999))); location.href = u.toString(); });
$('menuBtn').addEventListener('click', () => open());
showSettings();
if (direct) { menu.classList.remove('on'); menu.setAttribute('inert', ''); document.body.classList.add('direct'); } else { document.body.classList.add('titled'); autograph(900); }

/** a word across the screen for a moment (a checkpoint passed, a return to one) */
const note = document.getElementById('note')!;
let noteTimer = 0;
function say(text: string) { if (auto && !running) return; note.textContent = text; note.classList.add('on'); clearTimeout(noteTimer); noteTimer = window.setTimeout(() => note.classList.remove('on'), 1400); }
const scoreEl = $('score'), statusEl = $('status'), comboEl = $('combo');
let flashT = 0, flashText = '';
let last = performance.now(), acc = 0, t = 0, drawn = 0, frames = 0, fps = 60, fpsT = 0, seen = 0, bigAir = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const driveKeys = (keys.has('arrowup') || keys.has('w') ? 1 : 0) - (keys.has('arrowdown') || keys.has('s') ? 1 : 0);
  const drive = auto ? 0 : driveKeys || inp.drive, braking = drive < -0.3;
  if (!still && !paused) {
    acc += dt;
    const steerKeys = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    while (acc >= 1 / 120) {
      acc -= 1 / 120; t += 1 / 120;
      const steer = steerKeys || inp.steer;
      // (down with a gesture still held: it becomes the steering, from where the finger is now)
      if (gest && !rider.air) { const p = gest.stroke.pts[gest.stroke.pts.length - 1]; if (!drag) drag = { x: p.x, y: p.y, id: gest.id }; gest = null; }
      const trick = gest?.stroke.trick ?? trickKeys.find(([k]) => keys.has(k))?.[1] ?? null;
      rider.step(1 / 120, auto ? autoInput() : rider.air ? { steer: 0, brake: false, drive, trick } : { steer, brake: false, drive });
      rd.trail.add(rider);
      if (running && !finished) score.update(rider, 1 / 120);
    }
  }
  for (let i = seen; i < rider.events.length; i++) {
    const e = rider.events[i];
    if (running && !finished) score.event(e, rider);
    if (e.kind === 'land') cam.shake += e.k * 0.9;
    if (e.kind === 'crash' || e.kind === 'wall') cam.shake += 1.2;
    if (e.kind === 'checkpoint') say(`CHECKPOINT ${e.k}`);
    if (e.kind === 'trick') say(TRICKS[BODY[e.k]].name);
    if (e.kind === 'refuse') say(e.k ? 'NO ROOM TO FLIP' : 'NOT ENOUGH AIR');
    if (e.kind === 'crash' && rider.crashWhy) say(({ short: 'SHORT', face: 'INTO THE FACE', 'off the bike': 'STILL OFF THE BIKE', whip: 'STILL WHIPPED', 'nose up': 'NOSE UP', 'nose down': 'NOSE DOWN', hard: 'TOO HARD', over: 'OVER THE EDGE', wall: 'INTO THE WALL' } as Record<string, string>)[rider.crashWhy] ?? 'DOWN');
    if (e.kind === 'flip') { const n = Math.abs(e.k); say(`${n > 2 ? `${n}× ` : n === 2 ? 'DOUBLE ' : ''}${e.k > 0 ? 'BACKFLIP' : 'FRONT FLIP'}`); }
    // (put back at the flag: the eye goes with you at once, not in a long swoop)
    if (e.kind === 'respawn') { say(e.k ? `CHECKPOINT ${e.k}` : 'START'); snapEye(); }
  }
  if (!auto) sound.update(rider, braking, paused ? 0 : dt);
  seen = rider.events.length;
  // (`zjit`: every face's depth nudged a few steps every other frame, nothing else moved, for finding where faces fight in
  // depth: a held frame that changes under it is fighting)
  rd.zjit = zjit ? (drawn % 2) * 2.4e-7 : 0;
  // (`ejit`: the eye moved 1 cm every other frame, for seeing what a small move of the eye does to the strokes)
  // (a test (`zjit`, `ejit`, `hold`) holds the eye where it's settled after a few seconds, so only what's tested moves)
  const vw = (zjit || ejit || hold) && heldView && performance.now() - t0 > 4000 ? heldView : view(paused ? 0 : dt, t);
  if ((zjit || ejit || hold) && !heldView && performance.now() - t0 > 4000) heldView = { ...vw, eye: vw.eye.slice(), target: vw.target.slice() };
  if (ejit) { const e = (drawn % 2) * 0.01; vw.eye = [vw.eye[0] + e, vw.eye[1], vw.eye[2]]; vw.target = [vw.target[0] + e, vw.target[1], vw.target[2]]; }
  if (bgFlag) { const [yw = 0, pc = 4, fv = 60] = bgFlag.map((v) => (v * Math.PI) / 180), d = 100; rd.bgOnly = true; vw.target = [vw.eye[0] + Math.sin(yw) * Math.cos(pc) * d, vw.eye[1] + Math.sin(pc) * d, vw.eye[2] + Math.cos(yw) * Math.cos(pc) * d]; vw.roll = 0; vw.fov = fv; }
  rd.frame(vw, rider, t, still || paused ? 0 : dt, drawn++ < 2 ? 99 : 1);
  seen = rider.events.length; sound.sync(seen);
  if (rider.air) bigAir = Math.max(bigAir, rider.airT);
  // (the run's end: its finish reached, its last life gone (once you're put back after the third fall))
  const progress = Math.max(0, rider.s - 2), length = MODES[mode].length ?? Infinity;
  if (running && !finished && !paused && (progress >= length || (MODES[mode].lives && rider.crashes >= MODES[mode].lives! && rider.crashT <= 0))) finish();
  // (the score, where the speed was: big; in a time trial the clock. Under it how the run's going, and the combo pending,
  // its moves, its multiplier, what it'll bank)
  for (const m of score.moments) {
    if (m.kind === 'bank') { flashText = `+${fmt(m.points)} ${m.label}`; flashT = 1.3; scoreEl.classList.add('up'); sound.chime(m.points > 2000 ? 2 : 1); }
    if (m.kind === 'wipe') { flashText = `WIPED OUT −${fmt(m.points)}`; flashT = 1.3; }
  }
  score.moments.length = 0; flashT -= dt; if (flashT < 1) scoreEl.classList.remove('up');
  scoreEl.textContent = mode === 'time' ? clock(score.time) : fmt(score.shown);
  statusEl.textContent = MODES[mode].lives ? `${'● '.repeat(Math.max(0, 3 - rider.crashes))}${'○ '.repeat(Math.min(3, rider.crashes))}`.trim() : length < Infinity ? `${(Math.min(progress, length) / 1000).toFixed(1)} / ${length / 1000} KM` : `${(progress / 1000).toFixed(1)} KM`;
  comboEl.innerHTML = score.pool ? `${score.chain.join(' · ')} <i>×${score.mult}</i> +${fmt(score.pending)}` : flashT > 0 ? flashText : '';
  drawTrace(dt);
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/** the gesture as it's drawn: a white line where the finger went, orange from where a trick was read; it fades once
 * the finger's lifted */
const inkCv = $<HTMLCanvasElement>('ink'), inkCx = inkCv.getContext('2d')!;
function drawTrace(dt: number) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (inkCv.width !== w || inkCv.height !== h) { inkCv.width = w; inkCv.height = h; }
  inkCx.clearRect(0, 0, w, h);
  if (!trace) return;
  if (!gest || gest.stroke !== trace.stroke) trace.fade -= dt / 0.4;
  if (trace.fade <= 0) { trace = null; return; }
  const { pts, reads } = trace.stroke, first = reads.length ? reads[0].at : pts.length;
  inkCx.lineCap = inkCx.lineJoin = 'round'; inkCx.lineWidth = 7 * dpr;
  const run = (a: number, b: number, col: string) => {
    if (b - a < 1) return;
    inkCx.strokeStyle = col; inkCx.beginPath(); inkCx.moveTo(pts[a].x * dpr, pts[a].y * dpr);
    for (let i = a + 1; i <= b; i++) inkCx.lineTo(pts[i].x * dpr, pts[i].y * dpr);
    inkCx.stroke();
  };
  inkCx.globalAlpha = 0.75 * trace.fade;
  run(0, Math.min(first, pts.length - 1), '#fff');
  run(first, pts.length - 1, rider.refused ? '#9aa4c8' : '#ff6a1a');
  inkCx.globalAlpha = 1;
}

(window as unknown as { __switchback: unknown }).__switchback = {
  probe: () => ({ score: score.shown, mode, finished, s: rider.s, u: rider.u, v: rider.v, air: rider.air, crashes: rider.crashes, jumps: rider.jumps, bestAir: rider.bestAir, dist: rider.dist, checkpoints: rider.checkpoints, fps, bigAir, menu: menuOpen, running }),
  get rider() { return rider; }, course,
};
export {};
