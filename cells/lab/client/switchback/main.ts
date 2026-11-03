/**
 * Switchback: a downhill motocross run down a mountain that's made as you ride it, drawn flat and faceted, its speed
 * drawn as vector shards. Drag to steer (the bike follows the line by itself; you choose where on it), hold low to
 * brake. Kickers launch you over gaps; whoops throw you; the wall glances you off; the drop is the end of that run.
 *
 * Flags: `seed=` the mountain; `auto` the rider rides itself (the preview does too); `t=` start that many seconds
 * down (ridden by the auto rider, for pinned frames); `still` hold the frame there; `preview` no HUD.
 */
import { Course } from './course';
import { Rider, autoSteer, VMAX } from './sim';
import { Renderer, View } from './render';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still');
let auto = q.has('auto') || preview;

document.getElementById('seed')!.textContent = String(seed);
if (preview) document.body.classList.add('preview');
const world = document.getElementById('world') as HTMLCanvasElement, speed = document.getElementById('speed') as HTMLCanvasElement;
const course = new Course(seed), rider = new Rider(course);
const rd = new Renderer(world, speed, course);
rd.resize(); addEventListener('resize', () => rd.resize());

// (input: a drag steers from where it began; low in the drag brakes; keys too)
const inp = { steer: 0, brake: false };
let drag: { x: number; y: number; id: number } | null = null;
const keys = new Set<string>();
addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('a')) return; drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; auto = false; hint(); });
addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const span = Math.min(innerWidth, innerHeight) * 0.24;
  inp.steer = Math.max(-1, Math.min(1, (e.clientX - drag.x) / span));
  inp.brake = e.clientY - drag.y > 70;
});
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; inp.steer = 0; inp.brake = false; } };
addEventListener('pointerup', up); addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); auto = false; hint(); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let hinted = false;
function hint() { if (!hinted) { hinted = true; document.getElementById('hint')!.classList.add('gone'); } }

// (start down the hill if asked, ridden by the auto rider)
const T0 = Number(q.get('t') ?? 0);
for (let t = 0; t < T0; t += 1 / 120) rider.step(1 / 120, { steer: autoSteer(rider), brake: false });
rider.events.length = 0;

// (the chase eye: behind and above, a touch to the wall side, swinging round after the bike, never into the ground)
const cam = { h: rider.travel, eye: [rider.x, rider.y + 4, rider.z - 8], shake: 0, fovKick: 0 };
/** a close look at the bike and rider (`look=side|front|rear|quarter`), for judging the model: the eye held off the bike */
const look = q.get('look');
function closeLook(): View | null {
  if (!look) return null;
  const fx = Math.sin(rider.heading), fz = Math.cos(rider.heading), rx = -Math.cos(rider.heading), rz = Math.sin(rider.heading);
  const at = (f: number, s: number, h: number) => [rider.x + fx * f + rx * s, rider.y + h, rider.z + fz * f + rz * s];
  const eye = look === 'side' ? at(0, 3.6, 1.1) : look === 'front' ? at(4.2, 0.4, 1.3) : look === 'rear' ? at(-4, 0.3, 1.4) : at(-2.6, 2.8, 1.7);
  return { eye, target: at(0, 0, 0.85), fov: 0.8, roll: 0 };
}
function view(dt: number, t: number): View {
  const close = closeLook(); if (close) return close;
  const k = 1 - Math.exp(-dt * (rider.air ? 1.6 : 3.2));
  // (after the way you're going, not the way the bike points, so a slide shows as the bike yawed across the frame)
  if (rider.crashT <= 0) cam.h += Math.atan2(Math.sin(rider.travel - cam.h), Math.cos(rider.travel - cam.h)) * k;
  const fx = Math.sin(cam.h), fz = Math.cos(cam.h), rx = -Math.cos(cam.h), rz = Math.sin(cam.h);
  const pace = Math.min(1, Math.hypot(rider.vx, rider.vz) / VMAX), back = 4.6 + pace * 1.1, high = 3.3 + pace * 0.4, side = 1.5;
  const want = [rider.x - fx * back + rx * side, rider.y + high, rider.z - fz * back + rz * side];
  if (rider.crashT > 0) { want[0] = cam.eye[0]; want[2] = cam.eye[2]; }
  const ke = 1 - Math.exp(-dt * 7);
  for (let i = 0; i < 3; i++) cam.eye[i] += (want[i] - cam.eye[i]) * (i === 1 ? 1 - Math.exp(-dt * 4) : ke);
  // (never into the ground: the eye stays above the slope under it)
  const loc = course.locate(cam.eye[0], cam.eye[2], Math.max(0, rider.s - 8)), gy = course.point(loc.s, Math.max(-9, Math.min(9, loc.u))).y;
  cam.eye[1] = Math.max(cam.eye[1], gy + 1.8);
  cam.shake *= Math.exp(-dt * 7);
  const sh = cam.shake, jx = Math.sin(t * 61) * sh * 0.3, jy = Math.sin(t * 47 + 1) * sh * 0.25;
  const target = rider.crashT > 0 ? [rider.x, rider.y + 0.5, rider.z] : [rider.x + fx * 12, rider.y - 3, rider.z + fz * 12];
  cam.fovKick += ((rider.air ? 0.06 : 0) - cam.fovKick) * (1 - Math.exp(-dt * 3));
  return { eye: [cam.eye[0] + jx, cam.eye[1] + jy, cam.eye[2]], target, fov: (58 + pace * 16) * Math.PI / 180 + cam.fovKick, roll: rider.lean * 0.15 + Math.sin(t * 53) * sh * 0.02 };
}

const kmh = document.getElementById('kmh')!, dist = document.getElementById('dist')!, air = document.getElementById('air')!;
let last = performance.now(), acc = 0, t = 0, drawn = 0, frames = 0, fps = 60, fpsT = 0, seen = 0, bigAir = 0;
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!still) {
    acc += dt;
    const steerKeys = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    while (acc >= 1 / 120) {
      acc -= 1 / 120; t += 1 / 120;
      const steer = auto ? autoSteer(rider) : steerKeys || inp.steer;
      rider.step(1 / 120, { steer, brake: !auto && (inp.brake || keys.has('arrowdown') || keys.has('s')) });
    }
  }
  for (let i = seen; i < rider.events.length; i++) { const e = rider.events[i]; if (e.kind === 'land') cam.shake += e.k * 0.9; if (e.kind === 'crash' || e.kind === 'wall') cam.shake += 1.2; }
  seen = rider.events.length;
  rd.frame(view(dt, t), rider, t, still ? 0 : dt, drawn++ < 2 ? 99 : 1);
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
