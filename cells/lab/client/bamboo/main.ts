/**
 * Bamboo · 竹径: a walk up through a wild moso grove on a mountainside, drawn as the board has it.
 *
 * Hold anywhere and you walk; let go and you slow to a stop. Drag while you hold (or without) to look round; let it be
 * and the eye comes back to the way ahead. The way sets the pace: a brisk walk along the contour, slower up a stair,
 * quicker down. Where a way forks you take the branch you're looking along. Gusts come down the slope through the
 * grove; you see them coming before they reach you.
 *
 * URL: `seed`, `ref=a|b|c|up|gust` (a fixed frame laid out like the board's), `at=<way>:<metres>` (where to start),
 * `auto` (walk on by itself), `t=<seconds>` and `still` (time held), `clean`, `marks=0`, `fov=<degrees>`.
 */
import { makeLand, along, NODES, type Land, type Way } from './land';
import { makeGrove } from './grove';
import { Renderer, type Frame } from './render';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const caption = document.getElementById('caption') as HTMLDivElement | null;
const hint = document.getElementById('hint') as HTMLDivElement | null;
const seed = Number(params.get('seed') ?? 1) || 1;
const land: Land = makeLand(seed);
const grove = makeGrove(land);
const renderer = new Renderer(canvas, land, grove, { clean: params.has('clean'), marks: params.get('marks') !== '0' });

// ─── where you are: on a way, so far along it, facing along it or back ───
const walker = { way: 0, s: 2, dir: 1, v: 0, yaw: 0, pitch: 0, lookYaw: 0, lookPitch: 0, camY: 0, stepPhase: 0, idle: 0 };
{
  const at = params.get('at');
  if (at) { const [w, s] = at.split(':').map(Number); walker.way = Math.max(0, Math.min(land.ways.length - 1, w | 0)); walker.s = s || 0; }
  if (params.get('back') !== null) walker.dir = -1;
}
const PACE = 1.4, EYE = 1.62;
const auto = params.has('auto'), still = params.has('still');
let t = Number(params.get('t') ?? 0), held = false;

/** the ways that meet at a node, each as you'd set off along it from there */
function leaving(node: string, except: Way | null) {
  const out: { way: Way; dir: number; s: number; dx: number; dz: number }[] = [];
  for (const w of land.ways) {
    if (w === except && w.a !== w.b) continue;
    if (w.a === node) { const p = along(w, 0.5); out.push({ way: w, dir: 1, s: 0, dx: p.dx, dz: p.dz }); }
    if (w.b === node) { const p = along(w, w.length - 0.5); out.push({ way: w, dir: -1, s: w.length, dx: -p.dx, dz: -p.dz }); }
  }
  return out;
}
/** the way you'd take at the next node, given where you're looking */
let forkChoice = 0;
function choose(node: string, from: Way, commit = true) {
  const opts = leaving(node, from);
  if (!opts.length) return null;
  const ly = walker.yaw + walker.lookYaw, lx = Math.sin(ly), lz = Math.cos(ly);
  if (auto) return opts[(commit ? forkChoice++ : forkChoice) % opts.length];
  return opts.reduce((a, b) => (a.dx * lx + a.dz * lz >= b.dx * lx + b.dz * lz ? a : b));
}
const nodeAhead = () => (walker.dir > 0 ? land.ways[walker.way].b : land.ways[walker.way].a);
const toNodeAhead = () => (walker.dir > 0 ? land.ways[walker.way].length - walker.s : walker.s);

// ─── gusts: every so often a front comes down the slope, through the grove, past you and on ───
const gust = { dir: norm2(-0.9, -0.43), front: -1e4, strength: 0, next: 6 + (seed % 5) };
function norm2(x: number, z: number): [number, number] { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }
function stepGust(dt: number, eye: number[]) {
  gust.next -= dt;
  if (gust.next <= 0) { gust.front = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] - 110; gust.next = 18 + Math.random() * 14; }
  gust.front += dt * 9;
  const along = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] - gust.front;
  gust.strength = along > -160 && along < 160 ? 1 : 0;
  sound.wind(Math.exp(-(along * along) / 900) * gust.strength);
}

// ─── sound: the wind in the leaves, louder in a gust; footsteps by what's underfoot (starts on the first touch) ───
const sound = (() => {
  let ac: AudioContext | null = null, hiss: GainNode | null = null, noise: AudioBuffer | null = null;
  const start = () => {
    if (ac || params.has('mute')) return;
    try {
      ac = new AudioContext();
      noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.5;
      hiss = ac.createGain(); hiss.gain.value = 0.02;
      src.connect(bp).connect(hiss).connect(ac.destination); src.start();
    } catch { ac = null; }
  };
  return {
    start,
    wind(g: number) { if (ac && hiss) hiss.gain.setTargetAtTime(0.02 + g * 0.11, ac.currentTime, 0.4); },
    step(stone: boolean) {
      if (!ac || !noise) return;
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = stone ? 'bandpass' : 'lowpass'; f.frequency.value = stone ? 1800 + Math.random() * 600 : 520 + Math.random() * 200; f.Q.value = stone ? 2 : 0.7;
      const g = ac.createGain(), now = ac.currentTime; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(stone ? 0.09 : 0.16, now + 0.008); g.gain.exponentialRampToValueAtTime(0.001, now + (stone ? 0.07 : 0.16));
      src.connect(f).connect(g).connect(ac.destination); src.start(now, Math.random()); src.stop(now + 0.2);
    },
  };
})();

// ─── input: hold to walk, drag to look ───
let drag: { x: number; y: number; id: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; held = true; sound.start(); if (hint) hint.classList.add('gone'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const k = 2.4 / Math.max(innerWidth, innerHeight);
  walker.lookYaw -= (e.clientX - drag.x) * k; walker.lookPitch = Math.max(-0.9, Math.min(1.1, walker.lookPitch - (e.clientY - drag.y) * k));
  walker.lookYaw = Math.max(-2.6, Math.min(2.6, walker.lookYaw));
  drag.x = e.clientX; drag.y = e.clientY; walker.idle = 0;
});
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; held = false; } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.key); sound.start(); });
addEventListener('keyup', (e) => keys.delete(e.key));

// ─── the walk ───
function stepWalk(dt: number) {
  let w = land.ways[walker.way];
  const go = held || keys.has('ArrowUp') || keys.has('w') || auto;
  if (keys.has('ArrowLeft')) walker.lookYaw += dt * 1.2;
  if (keys.has('ArrowRight')) walker.lookYaw -= dt * 1.2;
  // (the pace the way sets: up a stair slower, down it a little quicker)
  const here = along(w, walker.s), ahead = along(w, walker.s + walker.dir * 1.2);
  const climb = (ahead.y - here.y) / 1.2;
  const pace = here.stair || ahead.stair ? (climb > 0 ? 0.78 : 1.05) : PACE * (1 - Math.max(0, climb) * 1.2);
  const target = go ? pace : 0;
  walker.v += (target - walker.v) * Math.min(1, dt * (go ? 2.2 : 3.2));
  walker.s += walker.v * dt * walker.dir;
  // (at the end of a way, on along the one you're looking toward)
  const end = walker.dir > 0 ? walker.s - w.length : -walker.s;
  if (end > 0) {
    const node = nodeAhead(), next = choose(node, w);
    if (next) { walker.way = next.way.id; walker.dir = next.dir; walker.s = next.s + next.dir * end; w = next.way; }
    else { walker.dir = -walker.dir; walker.s = walker.dir > 0 ? 0 : w.length; }
  }
  const p = along(w, walker.s);
  // (heading: along the way, looking a little ahead round its bends)
  const la = along(w, walker.s + walker.dir * 5), hx = la.x - p.x, hz = la.z - p.z;
  const want = Math.atan2(hx, hz);
  let dy = want - walker.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  walker.yaw += dy * Math.min(1, dt * 2.5);
  // (left be, the eye comes back to the way ahead, and up the stair or down it)
  walker.idle += dt;
  if (!drag && walker.idle > 2.2) { walker.lookYaw *= 1 - Math.min(1, dt * 0.9); walker.lookPitch *= 1 - Math.min(1, dt * 0.9); }
  const slopeLook = Math.atan2(la.y - p.y, 5) * 0.6;
  walker.pitch += (slopeLook - walker.pitch) * Math.min(1, dt * 2);
  // (the eye's height: the tread underfoot, eased, so a stair comes step by step; a little rise and fall with each step)
  walker.camY += (p.y + EYE - walker.camY) * Math.min(1, dt * (p.stair ? 9 : 5));
  const stride = p.stair ? 0.42 : 0.72, before = walker.stepPhase;
  walker.stepPhase += (walker.v * dt) / stride;
  if (Math.floor(walker.stepPhase) !== Math.floor(before)) sound.step(w.kind === 'stone' && p.stair);
  const bob = Math.abs(Math.sin(walker.stepPhase * Math.PI)) * 0.025 * Math.min(1, walker.v / PACE);
  return { x: p.x, y: walker.camY + bob, z: p.z };
}

// ─── reference frames, laid out like the board's ───
interface Ref { way: number; s: number; dir: number; lookYaw?: number; pitch?: number; fov?: number; t?: number; gust?: boolean }
const REFS: Record<string, Ref> = {
  // (A: up the stone stair toward the turn at its top, the boulder to the right)
  a: { way: 1, s: 30, dir: 1, pitch: 0.16, lookYaw: 0.05 },
  // (B: along the lower track, the grove on one side, the valley's mist on the other)
  b: { way: 0, s: 104, dir: -1, pitch: 0.02, lookYaw: 0.12 },
  // (C: along the contour, the dense bank on the right, the valley opening on the left)
  c: { way: 0, s: 44, dir: 1, pitch: 0.05, lookYaw: 0.18 },
  up: { way: 4, s: 60, dir: 1, pitch: 1.35 },
  gust: { way: 4, s: 80, dir: 1, pitch: 0.12, gust: true },
};
const ref = REFS[params.get('ref') ?? ''];
if (ref) {
  walker.way = ref.way; walker.s = ref.s; walker.dir = ref.dir; walker.lookYaw = ref.lookYaw ?? 0;
  if (ref.gust) { gust.next = 1e9; }
}
{
  const w = land.ways[walker.way], p = along(w, walker.s), la = along(w, walker.s + walker.dir * 5);
  walker.yaw = Math.atan2(la.x - p.x, la.z - p.z); walker.camY = p.y + EYE;
}

// ─── the frame ───
let last = performance.now(), scale = 1;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * scale;
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!still) t += dt;
  resize();
  const pos = ref ? (() => { const w = land.ways[walker.way], p = along(w, walker.s); return { x: p.x, y: p.y + EYE, z: p.z }; })() : stepWalk(still ? 0 : dt);
  const eye: [number, number, number] = [pos.x, pos.y, pos.z];
  if (ref?.gust) { gust.front = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] + 6; gust.strength = 1; }
  else if (!still) stepGust(dt, eye);
  const yaw = walker.yaw + walker.lookYaw, pitch = ref ? ref.pitch ?? 0 : walker.pitch + walker.lookPitch;
  const look: [number, number, number] = [eye[0] + Math.sin(yaw) * Math.cos(pitch), eye[1] + Math.sin(pitch), eye[2] + Math.cos(yaw) * Math.cos(pitch)];
  const portrait = innerHeight > innerWidth;
  const fov = (Number(params.get('fov')) || ref?.fov || (portrait ? 74 : 58)) * Math.PI / 180;
  const f: Frame = { eye, look, fov, t, gust: [gust.dir[0], gust.dir[1], gust.front, gust.strength] };
  renderer.draw(f, canvas.width, canvas.height);
  // (near a fork, the branch you'd take, named)
  if (caption) {
    const node = nodeAhead(), forks = leaving(node, land.ways[walker.way]).length > 1, near = toNodeAhead() < 14;
    if (forks && near && !ref) { const c = choose(node, land.ways[walker.way], false); caption.textContent = c?.way.name ?? ''; caption.classList.add('on'); }
    else caption.classList.remove('on');
  }
  // (if the frame's slow, draw fewer pixels)
  const ms = performance.now() - now;
  if (!still && !ref) { if (ms > 28 && scale > 0.6) scale -= 0.05; else if (ms < 12 && scale < 1) scale += 0.02; }
  (window as unknown as { __bamboo: unknown }).__bamboo = { seed, way: walker.way, name: land.ways[walker.way].name, s: walker.s, dir: walker.dir, v: walker.v, t, culms: grove.culms.length, sprays: grove.sprays.length, frameMs: ms, scale, nodes: Object.keys(NODES) };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
