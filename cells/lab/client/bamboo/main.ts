/**
 * Bamboo · 竹径: a run through a wild moso grove on an endless mountainside, drawn as the board has it.
 *
 * Hold anywhere and you run, a long easy lope; let go and you ease to a stop. Drag left and right to turn, up and down
 * to look. You don't have to pick your way: the run weaves you between the culms, and the grove has its own runs, the
 * lanes a deer would take, that it carries you into. Uphill slows you, downhill quickens you.
 *
 * Now and then you meet something: a trail (join it, running along it, and it carries you on until you turn off), a
 * flight of stone steps where a trail climbs a cliff band, a cliff's rim (a small drop you leap down; a big one stops you
 * at its edge, with the valley beyond). Gusts come down through the grove.
 *
 * URL: `seed`, `ref=a|b|c|cliff|run|up|gust` (a fixed frame), `auto` (run on by itself), `t=<seconds>` and `still` (time
 * held), `clean`, `marks=0`, `fov=<degrees>`, `mute`.
 */
import { World, ridges, type Trail } from './world';
import { Runner, LOPE } from './runner';
import { Renderer, type Frame, type Reach } from './render';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLDivElement | null;
const seed = Number(params.get('seed') ?? 1) || 1;
const world = new World(seed);
const renderer = new Renderer(canvas, ridges(seed), { clean: params.has('clean'), marks: params.get('marks') !== '0', shadows: params.get('shadows') !== '0' });
const auto = params.has('auto'), still = params.has('still');

// ─── how far it's drawn: colour, then a wash of its tones in ink, then the marks alone on the paper, then the page ───
const PRESETS: Record<string, Reach> = {
  picture: { colour: 85, wash: 110, ink: 130, soft: 4, frame: 1, depth: 0.25 },
  board: { colour: 22, wash: 48, ink: 85, soft: 3, frame: 0.42, depth: 0.45 },
  drawing: { colour: 8, wash: 28, ink: 85, soft: 2.5, frame: 0.25, depth: 0.5 },
  marks: { colour: 0, wash: 0, ink: 90, soft: 2, frame: 0.4, depth: 0.4 },
};
{
  const p = PRESETS[params.get('reach') ?? 'board'] ?? PRESETS.board, num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
  renderer.reach = { colour: num('colour', p.colour), wash: num('wash', p.wash), ink: num('ink', p.ink), soft: num('soft', p.soft), frame: num('frame', p.frame), depth: num('depth', p.depth) };
}
{
  const panel = document.getElementById('reach'), btn = document.getElementById('inkbtn');
  const sliders = ['colour', 'wash', 'ink', 'frame', 'depth'] as const;
  const show = () => {
    for (const k of sliders) { (document.getElementById(`r-${k}`) as HTMLInputElement).value = String(renderer.reach[k]); document.getElementById(`v-${k}`)!.textContent = k === 'frame' || k === 'depth' ? renderer.reach[k].toFixed(2) : `${Math.round(renderer.reach[k])} m`; }
    for (const b of panel?.querySelectorAll('[data-p]') ?? []) { const q = PRESETS[(b as HTMLElement).dataset.p!]; b.classList.toggle('on', sliders.every((k) => q[k] === renderer.reach[k])); }
  };
  // (keep the address in step, so a reach can be passed on)
  const remember = () => { const u = new URL(location.href); for (const k of sliders) u.searchParams.set(k, String(renderer.reach[k])); u.searchParams.delete('reach'); history.replaceState(null, '', u); };
  btn?.addEventListener('click', () => { panel?.classList.toggle('open'); show(); });
  for (const k of sliders) document.getElementById(`r-${k}`)?.addEventListener('input', (e) => {
    const v = Number((e.target as HTMLInputElement).value), r = renderer.reach;
    r[k] = v;
    // (the bands stay in order: colour inside the wash, the wash inside the ink)
    if (k === 'colour') { r.wash = Math.max(r.wash, v); r.ink = Math.max(r.ink, r.wash + 5); }
    if (k === 'wash') { r.colour = Math.min(r.colour, v); r.ink = Math.max(r.ink, v + 5); }
    if (k === 'ink') { r.wash = Math.min(r.wash, v - 5); r.colour = Math.min(r.colour, r.wash); }
    show(); remember();
  });
  for (const b of panel?.querySelectorAll('[data-p]') ?? []) b.addEventListener('click', () => { renderer.reach = { ...PRESETS[(b as HTMLElement).dataset.p!] }; show(); remember(); });
  for (const el of [panel, btn]) el?.addEventListener('pointerdown', (e) => e.stopPropagation());
}
let t = Number(params.get('t') ?? 0);

// ─── you, and the land round you, built a chunk at a time as you go ───
const me = new Runner(world);
const EYE = 1.62;
let held = false, pitch = -0.06, roll = 0;
const keys = new Set<string>();
const stream = (budget: number) => me.stream(me.x, me.z, budget, (k, c) => renderer.add(k, c), (k) => renderer.drop(k));

/** a trail near the origin to start on, facing along it */
function startOnTrail() {
  let best: { t: Trail; i: number; d: number } | null = null;
  for (let a = -1; a <= 0; a++) for (let b = -1; b <= 0; b++) for (const tr of world.trails(a, b)) for (let i = 10; i < tr.x.length - 10; i += 5) {
    if (tr.stair[i]) continue;
    const d = Math.hypot(tr.x[i], tr.z[i]); if (!best || d < best.d) best = { t: tr, i, d };
  }
  if (!best) return;
  const { t: tr, i } = best;
  me.x = tr.x[i]; me.z = tr.z[i]; me.heading = me.move = Math.atan2(tr.x[i + 3] - tr.x[i], tr.z[i + 3] - tr.z[i]);
}
startOnTrail();

// ─── sound: the wind in the leaves (and past your ears, faster); your feet, by what they land on ───
const sound = (() => {
  let ac: AudioContext | null = null, hiss: GainNode | null = null, rush: GainNode | null = null, noise: AudioBuffer | null = null;
  const start = () => {
    if (ac || params.has('mute')) return;
    try {
      ac = new AudioContext();
      noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const chain = (freq: number, q: number) => { const src = ac!.createBufferSource(); src.buffer = noise; src.loop = true; const f = ac!.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; const g = ac!.createGain(); g.gain.value = 0; src.connect(f).connect(g).connect(ac!.destination); src.start(); return g; };
      hiss = chain(2600, 0.5); rush = chain(500, 0.4);
    } catch { ac = null; }
  };
  return {
    start,
    air(gust: number, speed: number) { if (ac && hiss && rush) { hiss.gain.setTargetAtTime(0.018 + gust * 0.1, ac.currentTime, 0.4); rush.gain.setTargetAtTime(speed * 0.012, ac.currentTime, 0.3); } },
    step(stone: boolean, hard: number) {
      if (!ac || !noise) return;
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = stone ? 1900 + Math.random() * 500 : 900 + Math.random() * 500; f.Q.value = stone ? 2.2 : 0.9;
      const g = ac.createGain(), now = ac.currentTime; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime((stone ? 0.08 : 0.1) * hard, now + 0.006); g.gain.exponentialRampToValueAtTime(0.001, now + (stone ? 0.06 : 0.11));
      src.connect(f).connect(g).connect(ac.destination); src.start(now, Math.random()); src.stop(now + 0.15);
    },
  };
})();

// ─── input: hold to run; drag across to turn, up and down to look ───
let drag: { x: number; y: number; id: number } | null = null, dragTurn = 0;
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; held = true; sound.start(); if (hint) hint.classList.add('gone'); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const k = 2.6 / Math.max(innerWidth, innerHeight);
  dragTurn -= (e.clientX - drag.x) * k * 1.3;
  pitch = Math.max(-0.7, Math.min(0.9, pitch - (e.clientY - drag.y) * k));
  drag.x = e.clientX; drag.y = e.clientY;
});
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; held = false; } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { keys.add(e.key); sound.start(); });
addEventListener('keyup', (e) => keys.delete(e.key));

// ─── the run ───
function run(dt: number) {
  const go = held || keys.has('ArrowUp') || keys.has('w') || auto;
  let turn = 0;
  if (keys.has('ArrowLeft')) turn += dt * 1.6;
  if (keys.has('ArrowRight')) turn -= dt * 1.6;
  if (auto) turn += (Math.sin(t * 0.13 + 1.3) * 0.25 + Math.sin(t * 0.051) * 0.2) * dt;
  turn += dragTurn; dragTurn = 0;
  me.step(dt, { go, turn });
}

// ─── gusts ───
const gust = { dir: [-0.9, -0.43] as [number, number], front: -1e4, strength: 0, next: 5 };
function stepGust(dt: number, eye: number[]) {
  gust.next -= dt;
  if (gust.next <= 0) { const a = Math.random() * 6.28; gust.dir = [Math.cos(a), Math.sin(a)]; gust.front = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] - 110; gust.next = 14 + Math.random() * 14; }
  gust.front += dt * 10;
  const along = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] - gust.front;
  gust.strength = along > -160 && along < 160 ? 1 : 0;
  sound.air(Math.exp(-(along * along) / 900) * gust.strength, me.v);
}

// ─── reference frames ───
interface Spot { x: number; z: number; heading: number; pitch: number; v?: number }
function findSpots(): Record<string, Spot> {
  const out: Record<string, Spot> = {};
  const all: Trail[] = [];
  for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) all.push(...world.trails(a, b));
  // (a: at the foot of a flight of steps, looking up it)
  for (const tr of all) {
    for (let i = 8; i < tr.x.length - 12 && !out.a; i++) if (!tr.stair[i] && tr.stair[i + 4] && tr.stair[i + 9] && tr.y[i + 9] > tr.y[i] + 1) out.a = { x: tr.x[i], z: tr.z[i], heading: Math.atan2(tr.x[i + 6] - tr.x[i], tr.z[i + 6] - tr.z[i]), pitch: 0.12 };
    if (out.a) break;
  }
  // (b: along a trail with the ground falling away beside it)
  for (const tr of all) {
    for (let i = 10; i < tr.x.length - 10 && !out.b; i += 3) {
      if (tr.stair[i]) continue;
      const dx = tr.x[i + 1] - tr.x[i], dz = tr.z[i + 1] - tr.z[i], l = Math.hypot(dx, dz), sx = -dz / l, sz = dx / l;
      const left = world.ground(tr.x[i] + sx * 8, tr.z[i] + sz * 8) - tr.y[i], right = world.ground(tr.x[i] - sx * 8, tr.z[i] - sz * 8) - tr.y[i];
      if (Math.min(left, right) < -5 && Math.max(left, right) > 2) out.b = { x: tr.x[i], z: tr.z[i], heading: Math.atan2(dx, dz) + (left < right ? 0.15 : -0.15), pitch: -0.02 };
    }
    if (out.b) break;
  }
  // (cliff: at a rim, looking out over the drop)
  for (let r = 10; r < 300 && !out.cliff; r += 6) for (let a = 0; a < 6.28 && !out.cliff; a += 0.2) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = world.ground(x, z);
    for (let k = 0; k < 8; k++) { const b = (k / 8) * 6.28, d = world.ground(x + Math.sin(b) * 3, z + Math.cos(b) * 3); if (h - d > 4 && world.trailNear(x, z).d > 4) { out.cliff = { x, z, heading: b, pitch: -0.12 }; break; } }
  }
  // (c, run: in the grove, off the trails)
  out.c = { x: me.x + Math.sin(me.heading + 1.4) * 22, z: me.z + Math.cos(me.heading + 1.4) * 22, heading: me.heading, pitch: 0.02 };
  out.run = { ...out.c, v: LOPE, pitch: -0.04 };
  out.up = { ...out.c, pitch: 1.35 };
  out.gust = { ...out.c, pitch: 0.18 };
  return out;
}
const refName = params.get('ref');
const spot = refName ? findSpots()[refName] ?? null : null;
if (spot) { me.x = spot.x; me.z = spot.z; me.heading = me.move = spot.heading; pitch = spot.pitch; me.v = spot.v ?? 0; me.phase = 0.35; }
stream(400);
me.onStep = (stone, hard) => sound.step(stone, hard);
me.y = me.groundAt(me.x, me.z);

// ─── the frame ───
let last = performance.now(), scale = 1;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * scale, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!still) t += dt;
  resize();
  if (!spot && !still) run(dt);
  stream(1);
  const s = Math.min(1, me.v / LOPE), bob = Math.abs(Math.sin(me.phase * Math.PI)) * 0.065 * s, sway = Math.sin(me.phase * Math.PI) * 0.035 * s;
  const side = [Math.cos(me.move), -Math.sin(me.move)];
  const eye: [number, number, number] = [me.x + side[0] * sway, me.y + EYE + bob - me.dip, me.z + side[1] * sway];
  if (refName === 'gust') { gust.dir = [-0.9, -0.43]; gust.front = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] + 6; gust.strength = 1; }
  else if (!still) stepGust(dt, eye);
  // (looking: where you're heading; tipped a little with the ground ahead)
  const yaw = me.heading, gAhead = me.groundAt(me.x + Math.sin(yaw) * 6, me.z + Math.cos(yaw) * 6) - me.y, p = pitch + Math.atan2(gAhead, 6) * 0.5;
  const look: [number, number, number] = [eye[0] + Math.sin(yaw) * Math.cos(p), eye[1] + Math.sin(p), eye[2] + Math.cos(yaw) * Math.cos(p)];
  roll = roll * 0.9 + (-me.turn * 0.5 * s + Math.sin(me.phase * Math.PI) * 0.012 * s) * 0.1;
  const portrait = innerHeight > innerWidth, base = Number(params.get('fov')) || (portrait ? 74 : 60);
  const fov = (base + 12 * s) * Math.PI / 180;
  const f: Frame = { eye, look, fov, t, gust: [gust.dir[0], gust.dir[1], gust.front, gust.strength], speed: me.v, roll };
  renderer.draw(f, canvas.width, canvas.height);
  const ms = performance.now() - now;
  if (!still && !spot) { if (ms > 28 && scale > 0.6) scale -= 0.05; else if (ms < 12 && scale < 1) scale += 0.02; }
  (window as unknown as { __bamboo: unknown }).__bamboo = { seed, x: me.x, z: me.z, y: me.y, v: me.v, onTrail: me.onTrail, air: me.air, t, chunks: me.chunks.size, frameMs: ms, scale };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
