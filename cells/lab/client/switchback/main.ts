/**
 * Switchback: a downhill motocross run down a mountain that's made as you ride it, drawn flat and faceted, its speed
 * drawn as vector shards. Drag across to steer (nothing steers for you), up and down to drive (throttle, brake; in the air, the nose). Kickers launch you over gaps;
 * whoops throw you; the wall glances you off; the drop side can be ridden, but too far down it, or too hard a landing,
 * is a crash, and you're back at the last checkpoint flag.
 *
 * It opens on its title, the sim's own rider riding the mountain behind it; RIDE starts your run (and the sound, which
 * needs a tap). The menu (the button top left, or Esc) pauses, with the settings: sound and its volume, how far back the
 * eye rides, another mountain. Settings are kept in this browser.
 *
 * Flags: `seed=` the mountain; `auto` the sim's own rider rides (the preview does too); `t=` start that many seconds
 * down (ridden by it, for pinned frames); `still` hold the frame there; `preview` no HUD; `look=side|front|rear|quarter`
 * a close look at the bike. Any of these skips the title.
 */
import { Course } from './course';
import { Rider, autoSteer, VMAX } from './sim';
import { Trickster } from './tricks';
import { Renderer, View } from './render';
import { M, PALETTE, RUT_LIGHT } from './mesh';
import { Sound } from './audio';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still');
const look = q.get('look');
/** straight into it (tests, pinned frames, the preview): no title */
const direct = preview || still || q.has('auto') || q.has('t') || !!look;
let auto = q.has('auto') || preview || !direct;
// (the sim's own rider shows off on the title, and with `auto=tricks`: slides, whips, flips, whatever the jump allows)
const showing = q.get('auto') === 'tricks' || !direct, trickster = new Trickster();
const autoInput = () => (showing ? trickster.input(rider) : { steer: autoSteer(rider), brake: false });

document.getElementById('seed')!.textContent = String(seed);
if (preview) document.body.classList.add('preview');
const world = document.getElementById('world') as HTMLCanvasElement, speed = document.getElementById('speed') as HTMLCanvasElement;
const course = new Course(seed);
let rider = new Rider(course);
if (q.get('ruts') === 'light') PALETTE[M.RUT] = RUT_LIGHT;
const rd = new Renderer(world, speed, course);
rd.resize(); addEventListener('resize', () => rd.resize());
rd.speed = q.get('fx') !== '0'; rd.fog = q.get('fog') !== '0';
rd.style = q.get('rider') === 'facets' ? 'facets' : q.get('rider') === 'sil' ? 'sil' : 'cut'; rd.whip = (Number(q.get('whip') ?? 0) * Math.PI) / 180; rd.world = q.get('world') !== '0';
const sound = new Sound();

// (settings, kept in this browser where it can)
type Settings = { sound: boolean; volume: number; camera: 'close' | 'mid' | 'far' };
const settings: Settings = { sound: true, volume: 0.7, camera: 'mid' };
try { Object.assign(settings, JSON.parse(localStorage.getItem('switchback') ?? '{}')); } catch { /* (private, or blocked: defaults) */ }
const keep = () => { try { localStorage.setItem('switchback', JSON.stringify(settings)); } catch { /* (no matter) */ } };
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
// as you drag; in the air, the nose: down pulls it up and over, up pushes it down). Keys too. Not while the menu's open,
// and never from a press on the menu or a link)
const inp = { steer: 0, drive: 0 };
let drag: { x: number; y: number; id: number } | null = null;
const keys = new Set<string>();
const onUi = (e: Event) => !!(e.target as HTMLElement).closest('a,button,input,#menu');
addEventListener('pointerdown', (e) => { if (onUi(e) || menuOpen) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; if (direct) auto = false; hint(); });
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const span = Math.min(innerWidth, innerHeight) * 0.24;
  inp.steer = Math.max(-1, Math.min(1, (e.clientX - drag.x) / span));
  inp.drive = Math.max(-2, Math.min(2, (drag.y - e.clientY) / span)); // (past ±1 only matters in the air, from where the drag stood at take-off)
});
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; inp.steer = 0; inp.drive = 0; } };
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
const menu = document.getElementById('menu')!, go = document.getElementById('go') as HTMLButtonElement, again = document.getElementById('again') as HTMLButtonElement;
const sndBtn = document.getElementById('snd') as HTMLButtonElement, vol = document.getElementById('vol') as HTMLInputElement, another = document.getElementById('another') as HTMLButtonElement;
const camBtns = [...document.querySelectorAll<HTMLButtonElement>('[data-cam]')];
document.getElementById('mseed')!.textContent = String(seed);
let menuOpen = !direct, running = false, paused = false;
function showSettings() {
  sndBtn.textContent = settings.sound ? 'ON' : 'OFF'; sndBtn.setAttribute('aria-pressed', String(settings.sound));
  vol.value = String(Math.round(settings.volume * 100)); vol.disabled = !settings.sound;
  for (const b of camBtns) b.setAttribute('aria-pressed', String(b.dataset.cam === settings.camera));
  sound.on = settings.sound; sound.volume = settings.volume;
}
function open() {
  menuOpen = true; paused = running; menu.classList.add('on'); menu.removeAttribute('inert');
  go.textContent = running ? 'CARRY ON' : 'RIDE'; again.hidden = !running; sound.hush(true); go.focus();
}
function close() { menuOpen = false; paused = false; menu.classList.remove('on'); menu.setAttribute('inert', ''); sound.hush(false); }
function begin() {
  // (a fresh run: a new rider at the top, the eye with it, yours to ride)
  rider = new Rider(course); auto = false; running = true; sound.reset(); seen = 0; snapEye(); rd.trail.clear();
  hinted = false; hintEl.classList.remove('gone');
}
go.addEventListener('click', () => { sound.start(); if (!running) begin(); close(); });
again.addEventListener('click', () => { sound.start(); begin(); close(); });
sndBtn.addEventListener('click', () => { settings.sound = !settings.sound; keep(); showSettings(); if (settings.sound) sound.start(); });
vol.addEventListener('input', () => { settings.volume = Number(vol.value) / 100; keep(); showSettings(); });
for (const b of camBtns) b.addEventListener('click', () => { settings.camera = b.dataset.cam as Settings['camera']; keep(); showSettings(); });
another.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('seed', String(1 + Math.floor(Math.random() * 9999))); location.href = u.toString(); });
document.getElementById('menuBtn')!.addEventListener('click', () => open());
showSettings();
if (direct) { menu.classList.remove('on'); menu.setAttribute('inert', ''); document.body.classList.add('direct'); } else document.body.classList.add('titled');

/** a word across the screen for a moment (a checkpoint passed, a return to one) */
const note = document.getElementById('note')!;
let noteTimer = 0;
function say(text: string) { if (auto) return; note.textContent = text; note.classList.add('on'); clearTimeout(noteTimer); noteTimer = window.setTimeout(() => note.classList.remove('on'), 1400); }
const kmh = document.getElementById('kmh')!, dist = document.getElementById('dist')!, air = document.getElementById('air')!;
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
      rider.step(1 / 120, auto ? autoInput() : { steer, brake: false, drive, whip: steer });
      rd.trail.add(rider);
    }
  }
  for (let i = seen; i < rider.events.length; i++) {
    const e = rider.events[i];
    if (e.kind === 'land') cam.shake += e.k * 0.9;
    if (e.kind === 'crash' || e.kind === 'wall') cam.shake += 1.2;
    if (e.kind === 'checkpoint') say(`CHECKPOINT ${e.k}`);
    if (e.kind === 'flip') { const n = Math.abs(e.k); say(`${n > 2 ? `${n}× ` : n === 2 ? 'DOUBLE ' : ''}${e.k > 0 ? 'BACKFLIP' : 'FRONT FLIP'}`); }
    // (put back at the flag: the eye goes with you at once, not in a long swoop)
    if (e.kind === 'respawn') { say(e.k ? `CHECKPOINT ${e.k}` : 'START'); snapEye(); }
  }
  if (!auto) sound.update(rider, braking, paused ? 0 : dt);
  seen = rider.events.length;
  rd.frame(view(paused ? 0 : dt, t), rider, t, still || paused ? 0 : dt, drawn++ < 2 ? 99 : 1);
  seen = rider.events.length; sound.sync(seen);
  if (rider.air) bigAir = Math.max(bigAir, rider.airT);
  kmh.textContent = String(Math.round(Math.hypot(rider.vx, rider.vz) * 3.6));
  dist.textContent = `${Math.round(rider.dist)} m`;
  air.textContent = rider.air && rider.airT > 0.4 ? `AIR ${rider.airT.toFixed(1)}` : rider.crashes ? `× ${rider.crashes}` : '';
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

(window as unknown as { __switchback: unknown }).__switchback = {
  probe: () => ({ s: rider.s, u: rider.u, v: rider.v, air: rider.air, crashes: rider.crashes, jumps: rider.jumps, bestAir: rider.bestAir, dist: rider.dist, checkpoints: rider.checkpoints, fps, bigAir, menu: menuOpen, running }),
  get rider() { return rider; }, course,
};
export {};
