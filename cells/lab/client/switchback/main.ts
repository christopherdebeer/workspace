/**
 * Switchback: a downhill motocross run down a mountain made as you ride it, its road switchbacking down a cliff face,
 * drawn flat and faceted, its speed drawn as vector shards. Drag to steer: the bike turns as far as your drag has moved
 * from where it began, and holds there (drag further, past a third of the screen, and it keeps turning); drag down to
 * brake. Nothing steers for you. Brake assist (on unless `assist=0`) eases off for a turn you'd otherwise run wide in.
 *
 * Flags: `seed=` the mountain; `auto` the sim's own rider rides (the preview does too); `t=` start that many seconds
 * down (ridden there by it, for pinned frames); `still` hold the frame; `preview` no HUD; `assist=0` no brake assist.
 */
import { Course } from './course';
import { Rider, autoRide, safeSpeed, VMAX } from './sim';
import { Renderer, View } from './render';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still'), assist = q.get('assist') !== '0';
let auto = q.has('auto') || preview;

document.getElementById('seed')!.textContent = String(seed);
if (preview) document.body.classList.add('preview');
const world = document.getElementById('world') as HTMLCanvasElement, speed = document.getElementById('speed') as HTMLCanvasElement;
const course = new Course(seed), rider = new Rider(course);
const rd = new Renderer(world, speed, course);
rd.resize(); addEventListener('resize', () => rd.resize());
rd.shadows = q.get('shadows') !== '0';

// (input: a drag aims the bike: its heading is the one it had when the drag began, turned by how far the drag has moved,
// a radian for a third of the screen's short side; past that it keeps turning, faster the further; low in the drag brakes)
const keys = new Set<string>();
let drag: { x: number; y: number; id: number; h0: number; dx: number; dy: number } | null = null;
const span = () => Math.min(innerWidth, innerHeight) * 0.33;
addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('a')) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId, h0: rider.heading, dx: 0, dy: 0 }; auto = false; hint(); });
addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y; } });
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); auto = false; hint(); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let hinted = false;
function hint() { if (!hinted) { hinted = true; document.getElementById('hint')!.classList.add('gone'); } }
/** this step's input: the sim's own rider, or yours */
function input(dt: number) {
  if (auto) return autoRide(rider);
  const brake = (drag ? drag.dy > 60 : false) || keys.has('arrowdown') || keys.has('s');
  const steerKeys = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
  let aim: number | undefined;
  if (drag && !steerKeys) {
    const f = drag.dx / span(), over = Math.abs(f) - 1;
    if (over > 0) drag.h0 -= Math.sign(f) * Math.min(1.5, over) * 2.4 * dt;
    aim = drag.h0 - Math.max(-1, Math.min(1, f));
  }
  // (brake assist: ease off for a turn ahead that this pace would run wide in)
  const assisted = assist && rider.v > safeSpeed(rider) + 3 && course.at(rider.s).feature !== 'ramp';
  return { steer: steerKeys, aim, brake: brake || assisted };
}

// (start down the hill if asked, ridden there by the sim's rider)
const T0 = Number(q.get('t') ?? 0);
for (let t = 0; t < T0; t += 1 / 120) rider.step(1 / 120, autoRide(rider));
rider.events.length = 0;

// (the chase eye: close behind and above, over the shoulder on the drop side, looking down the road and over the edge;
// swinging round after the way you're going; never into the ground)
const cam = { h: rider.travel, eye: [rider.x, rider.y + 4, rider.z - 8], shake: 0, fovKick: 0, side: 1.3 };
function view(dt: number, t: number): View {
  const k = 1 - Math.exp(-dt * (rider.air ? 1.6 : 3.4));
  if (rider.crashT <= 0) cam.h += Math.atan2(Math.sin(rider.travel - cam.h), Math.cos(rider.travel - cam.h)) * k;
  cam.side += (course.at(rider.s).drop * 1.3 - cam.side) * (1 - Math.exp(-dt * 1.2));
  const fx = Math.sin(cam.h), fz = Math.cos(cam.h), rx = -Math.cos(cam.h), rz = Math.sin(cam.h);
  const pace = Math.min(1, Math.hypot(rider.vx, rider.vz) / VMAX), back = 3.3 + pace * 1.2, high = 3.3 + pace * 0.5;
  const want = [rider.x - fx * back + rx * cam.side, rider.y + high, rider.z - fz * back + rz * cam.side];
  if (rider.crashT > 0) { want[0] = cam.eye[0]; want[2] = cam.eye[2]; }
  const ke = 1 - Math.exp(-dt * 8);
  for (let i = 0; i < 3; i++) cam.eye[i] += (want[i] - cam.eye[i]) * (i === 1 ? 1 - Math.exp(-dt * 5) : ke);
  cam.eye[1] = Math.max(cam.eye[1], course.ground(cam.eye[0], cam.eye[2]) + 1.3);
  cam.shake *= Math.exp(-dt * 7);
  const sh = cam.shake, jx = Math.sin(t * 61) * sh * 0.25, jy = Math.sin(t * 47 + 1) * sh * 0.2;
  const target = rider.crashT > 0 ? [rider.x, rider.y + 0.5, rider.z] : [rider.x + fx * 9 + rx * cam.side * 0.6, rider.y - 3.4, rider.z + fz * 9 + rz * cam.side * 0.6];
  cam.fovKick += ((rider.air ? 0.06 : 0) - cam.fovKick) * (1 - Math.exp(-dt * 3));
  return { eye: [cam.eye[0] + jx, cam.eye[1] + jy, cam.eye[2]], target, fov: (62 + pace * 12) * Math.PI / 180 + cam.fovKick, roll: rider.lean * 0.15 + Math.sin(t * 53) * sh * 0.02 };
}

const kmh = document.getElementById('kmh')!, dist = document.getElementById('dist')!, air = document.getElementById('air')!;
let last = performance.now(), acc = 0, t = 0, drawn = 0, frames = 0, fps = 60, fpsT = 0, seen = 0, bigAir = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!still) {
    acc += dt;
    while (acc >= 1 / 120) { acc -= 1 / 120; t += 1 / 120; rider.step(1 / 120, input(1 / 120)); }
  }
  for (let i = seen; i < rider.events.length; i++) { const e = rider.events[i]; if (e.kind === 'land') cam.shake += e.k * 0.9; if (e.kind === 'crash' || e.kind === 'wall') cam.shake += 1.2; }
  seen = rider.events.length;
  rd.frame(view(dt, t), rider, t, still ? 0 : dt, drawn++ < 2 ? 999 : 2);
  seen = rider.events.length;
  if (rider.air) bigAir = Math.max(bigAir, rider.airT);
  kmh.textContent = String(Math.round(Math.hypot(rider.vx, rider.vz) * 3.6));
  dist.textContent = `${Math.round(rider.dist)} m`;
  air.textContent = rider.air && rider.airT > 0.4 ? `AIR ${rider.airT.toFixed(1)}` : rider.crashes ? `× ${rider.crashes}` : '';
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

(window as unknown as { __switchback: unknown }).__switchback = {
  probe: () => ({ s: rider.s, u: rider.u, v: rider.v, air: rider.air, crashes: rider.crashes, jumps: rider.jumps, bestAir: rider.bestAir, dist: rider.dist, fps, bigAir }),
  rider, course,
};
export {};
