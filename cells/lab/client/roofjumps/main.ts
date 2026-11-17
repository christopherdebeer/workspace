/**
 * Roof Jumps: a figure running over an endless city of rooftops, leaping whatever is in the way, in any direction.
 * A study of two things only: the procedural geometry (city.ts: chunks of boxes on a lattice) and the rigged figure
 * moving over it (runner.ts: the body and its judgement; rig.ts: the skeleton posed from it). It is drawn as plainly
 * as it can be (render.ts), on purpose, so that looks can be tried over the same geometry later.
 *
 * Drag anywhere and the figure runs that way (the drag is a stick: further is faster); it leaps gaps, steps and
 * clutter, runs up walls and rolls out of long drops by itself. Tap to jump (and once more in the air). A second
 * finger turns the eye. Keys: WASD or the arrows, space, Q and E.
 *
 * Flags: `seed=` the city · `look=grid|clay|wire|tags|normals` how it's drawn · `auto` it runs itself, wandering ·
 * `t=` start that many seconds into such a run · `still` hold the frame · `preview` nothing over the picture (and
 * `auto`) · `follow=0` the eye never turns by itself · `far=` chunks drawn each way (4) · `side=` the eye swung round the
 * figure by that many degrees (90: side on) and `zoom=` brought that many times closer: for looking at the rig.
 */
import { noise1 } from '../kit/rng';
import { City } from './city';
import { Runner } from './runner';
import type { Input } from './runner';
import { Rig } from './rig';
import { LOOKS, Renderer } from './render';
import type { Look } from './render';
import { lookAt, mul, perspective } from './m4';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still');
const auto = q.has('auto') || preview, follow = q.get('follow') !== '0';
if (preview) document.body.classList.add('preview');

const canvas = document.getElementById('world') as HTMLCanvasElement;
const city = new City(seed), runner = new Runner(city), rig = new Rig(), rd = new Renderer(canvas, city);
rd.radius = Math.max(1, Math.min(8, Number(q.get('far') ?? 4) | 0));
if ((LOOKS as readonly string[]).includes(q.get('look') ?? '')) rd.look = q.get('look') as Look;
rd.resize(); addEventListener('resize', () => rd.resize());

// ─── the eye ──────────────────────────────────────────────────────────────────
/** `side=`, `zoom=`: the eye swung round the figure and brought closer, for looking at the rig */
const side = Number(q.get('side') ?? 0) * Math.PI / 180, zoom = Math.max(0.2, Number(q.get('zoom') ?? 1));
let yaw = 0.6, pitch = side ? 0.15 : 0.42;
const eyeAt = { x: runner.x, y: runner.y, z: runner.z };

// ─── the hand ─────────────────────────────────────────────────────────────────
// (the first finger down is the stick, wherever it lands; any other turns the eye; a short touch that hasn't moved is a jump)
const stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0, t: 0, moved: false };
const others = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
const keys = new Set<string>();
let jump = false;
const knob = document.getElementById('stick')!, nub = knob.firstElementChild as HTMLElement;
const REACH = 56;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (stick.id < 0) {
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0, t: performance.now(), moved: false });
    knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`; nub.style.transform = '';
  } else others.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
  document.body.classList.add('played');
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === stick.id) {
    let x = (e.clientX - stick.x0) / REACH, y = (e.clientY - stick.y0) / REACH; const l = Math.hypot(x, y);
    if (l > 0.18) { stick.moved = true; knob.classList.add('on'); }
    if (l > 1) { x /= l; y /= l; }
    stick.x = x; stick.y = y; nub.style.transform = `translate(${x * REACH}px,${y * REACH}px)`;
  } else {
    const o = others.get(e.pointerId); if (!o) return;
    const dx = e.clientX - o.x, dy = e.clientY - o.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) o.moved = true;
    if (o.moved) { yaw += dx * 0.007; pitch = Math.max(0.08, Math.min(1.2, pitch + dy * 0.005)); o.x = e.clientX; o.y = e.clientY; }
  }
});
const up = (e: PointerEvent) => {
  const tap = (t: number, moved: boolean) => { if (!moved && performance.now() - t < 260) jump = true; };
  if (e.pointerId === stick.id) { tap(stick.t, stick.moved); stick.id = -1; stick.x = stick.y = 0; knob.classList.remove('on'); }
  else { const o = others.get(e.pointerId); if (o) tap(o.t, o.moved); others.delete(e.pointerId); }
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) jump = true; keys.add(e.code); if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault(); document.body.classList.add('played'); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

/** what's asked of the runner now: a direction on the ground, turned from the screen's by the eye */
function input(t: number): Input {
  if (auto) {
    // (by itself: wandering, the heading a slow noise)
    const a = 7 * noise1(seed + 9, t * 0.06) + t * 0.04;
    return { x: Math.sin(a), z: Math.cos(a), jump: false };
  }
  const k = (...c: string[]) => (c.some((x) => keys.has(x)) ? 1 : 0);
  let sx = stick.x + k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), sy = stick.y + k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
  const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; }
  const fx = Math.sin(yaw), fz = Math.cos(yaw), j = jump; jump = false;
  return { x: fx * -sy + -fz * sx, z: fz * -sy + fx * sx, jump: j };
}

// ─── the frame ────────────────────────────────────────────────────────────────
const DT = 1 / 120;
let time = 0, acc = 0, last = performance.now(), frames = 0;
const advance = (dt: number) => { runner.step(dt, input(time)); rig.update(dt, runner); time += dt; };
// (`t=`: run on to there before the first frame)
for (let n = Math.round(Number(q.get('t') ?? 0) / DT); n > 0; n--) advance(DT);
Object.assign(eyeAt, { x: runner.x, y: runner.y, z: runner.z });
if (auto && runner.speed > 1) yaw = Math.atan2(runner.vx, runner.vz);
rd.stream(runner.x, runner.z, 9);

const lookBtn = document.getElementById('look')!;
const showLook = () => { lookBtn.textContent = rd.look; };
lookBtn.addEventListener('click', () => { rd.look = LOOKS[(LOOKS.indexOf(rd.look) + 1) % LOOKS.length]; showLook(); const u = new URL(location.href); u.searchParams.set('look', rd.look); history.replaceState(null, '', u); });
showLook();
document.getElementById('seed')!.textContent = String(seed);
document.getElementById('another')!.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('seed', String(1 + Math.floor(Math.random() * 9999))); location.href = u.href; });

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!still) { acc += dt; while (acc >= DT) { advance(DT); acc -= DT; } }
  yaw += (k('KeyE') - k('KeyQ')) * 1.8 * dt;
  // (the eye: after the figure, quick across and slower up and down, so a leap is seen against the roofs; and, gently, round behind where it's going)
  const e = (r: number) => (still ? 1 : 1 - Math.exp(-r * dt));
  eyeAt.x += (runner.x - eyeAt.x) * e(10); eyeAt.z += (runner.z - eyeAt.z) * e(10); eyeAt.y += (runner.y - eyeAt.y) * e(runner.state === 'climb' ? 6 : 3.5);
  if (follow && !others.size && runner.speed > 2) {
    let d = Math.atan2(runner.vx, runner.vz) - yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    yaw += d * Math.max(0, Math.cos(d / 2)) * (auto ? 1.2 : 0.55) * dt;
  }
  rd.resize();
  const aspect = canvas.width / canvas.height, dist = (aspect < 1 ? 11.5 : 9.5) / zoom, fov = (aspect < 1 ? 62 : 52) * Math.PI / 180;
  const tx = eyeAt.x, ty = eyeAt.y + (zoom > 1 ? 1 : 1.5), tz = eyeAt.z, c = Math.cos(pitch), ya = yaw + side;
  const eye = [tx - Math.sin(ya) * c * dist, ty + Math.sin(pitch) * dist, tz - Math.cos(ya) * c * dist];
  const vp = mul(perspective(fov, aspect, 0.3, rd.radius * 64 * 1.5), lookAt(eye, [tx, ty, tz], [0, 1, 0]));
  rd.stream(runner.x, runner.z, 2);
  const under = city.heightAt(runner.x, runner.z), h = Math.max(0, runner.y - under);
  rd.draw(vp, eye, rig.bones(runner), { x: runner.x, y: under, z: runner.z, r: 0.5 * (1 - 0.4 * Math.min(1, h / 12)), a: 0.4 * (1 - 0.6 * Math.min(1, h / 20)) });
  frames++;
  requestAnimationFrame(frame);
}
const k = (c: string) => (keys.has(c) ? 1 : 0);
requestAnimationFrame(frame);

/** what a test (or the curious) can ask of it */
(window as unknown as Record<string, unknown>).__roofjumps = {
  probe: () => ({
    seed, t: time, frames, x: runner.x, y: runner.y, z: runner.z, state: runner.state, speed: runner.speed, dist: runner.dist,
    leaps: runner.leaps, climbs: runner.climbs, rolls: runner.rolls, look: rd.look, tris: rd.tris, pending: rd.pending(runner.x, runner.z),
  }),
};
