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
 * held), `clean`, `marks=0`, `fov=<degrees>`, `mute`; `look=house|picture|drawing|ink|page|dusk|night` and each layer's dial by its name
 * (layers.ts); `grove=0` (the land alone), `clay` (the forms alone), `strokes=all`.
 */
import { World, ridges, CHUNK, type Trail, type Chunk } from './world';
import { Runner, LOPE, EYE } from './runner';
import type { Footing } from './footing';
import { strokes } from './strokes';
import { Renderer, type Frame } from './render';
import { readDials, address, layersPalette } from './layers';
import { skyAt } from './sky';
import { Presence, type Kind, type Cue } from './presence';
import { Chase } from './chase';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLDivElement | null;
if (hint && params.has('still')) hint.classList.add('gone');
const seed = Number(params.get('seed') ?? 1) || 1;
const world = new World(seed);
const renderer = new Renderer(canvas, ridges(seed), { clean: params.has('clean'), marks: params.get('marks') !== '0', shadows: params.get('shadows') !== '0' });
const auto = params.has('auto'), still = params.has('still');

// ─── how it's drawn: the layers, each its own (layers.ts), from the address, and the palette under 墨 ───
renderer.dials = readDials(params);
// (the land's shadows baked for the hour asked, from the first piece of it built)
world.light = [...skyAt(renderer.dials.hour, renderer.dials.mist).lightDir];
{
  const el = document.getElementById('layers'), btn = document.getElementById('inkbtn');
  if (el) {
    // (keep the address in step, so a setting can be passed on)
    const pal = layersPalette(el, () => renderer.dials, (d) => { renderer.dials = d; remember(true); });
    btn?.addEventListener('click', () => { el.classList.toggle('shown'); pal.refresh(); });
    for (const x of [el, btn]) x?.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
}
let t = Number(params.get('t') ?? 0);

// ─── you, and the land round you, built a chunk at a time as you go ───
const me = new Runner(world);
let held = false, pitch = -0.06, roll = 0, airK = 0, aimK = 0;
const keys = new Set<string>();
renderer.allStrokes = params.get('strokes') === 'all';
renderer.bare = params.get('grove') === '0';
renderer.clay = params.has('clay');
const stream = (budget: number) => me.stream(me.x, me.z, budget, (k, c) => renderer.add(k, c, strokes(world, c)), (k) => renderer.drop(k));

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
// (`at=x,z,heading,pitch`: start just there, as the address was left (and `t`, the time), and run on from it)
{
  const at = params.get('at')?.split(',').map(Number);
  if (at && at.length >= 4 && at.every(Number.isFinite)) { me.x = at[0]; me.z = at[1]; me.heading = me.move = at[2]; pitch = at[3]; }
}

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
    /** whether anything can be heard: the sound started (by a first touch) and running, and not muted */
    on() { return !!ac && ac.state === 'running'; },
    /** a burst of the noise through a band, rising in `att` and gone by `len` */
    burst(freq: number, q: number, gain: number, att: number, len: number, type: BiquadFilterType = 'bandpass') {
      if (!ac || !noise) return;
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(), now = ac.currentTime; g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(gain, now + att); g.gain.exponentialRampToValueAtTime(0.001, now + len);
      src.connect(f).connect(g).connect(ac.destination); src.start(now, Math.random()); src.stop(now + len + 0.05);
    },
    /** a footfall: crisp on stone and steps, a knock on a root, soft in the litter */
    step(on: Footing, hard: number) {
      const hardOn = on === 'stone' || on === 'step';
      this.burst(hardOn ? 1900 + Math.random() * 500 : on === 'root' ? 1200 + Math.random() * 200 : 900 + Math.random() * 500, hardOn ? 2.2 : on === 'root' ? 3 : 0.9, (hardOn ? 0.08 : 0.1) * hard, 0.006, hardOn ? 0.06 : 0.11);
    },
    /** a landing: the body's weight coming down (a low thud, heavier the harder), and the footing's own sound over it */
    land(on: Footing, impact: number) {
      const k = Math.min(1, impact / 6);
      this.burst(110 + Math.random() * 30, 0.7, 0.12 + 0.3 * k, 0.008, 0.16 + 0.2 * k, 'lowpass');
      this.step(on, 1 + k * 1.5);
    },
    /** a culm brushed past: a rustle of its leaves */
    brush(k: number) { this.burst(3800 + Math.random() * 1500, 0.6, 0.02 + 0.05 * k, 0.03, 0.3); },
    /** something else's sound (presence.ts), from where it was: to your left or right, fainter the further */
    cue(c: Cue, kind: Kind, eye: number[], yaw: number) {
      if (!ac || !noise) return;
      const dx = c.x - eye[0], dz = c.z - eye[2], d = Math.hypot(dx, dz);
      let a = Math.atan2(dx, dz) - yaw; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      const g = Math.min(1, (c.loud * 6) / Math.max(6, d)) * 0.9, pan = Math.max(-1, Math.min(1, -Math.sin(a)));
      const spec = c.kind === 'step' ? (kind === 'fox' ? [2200, 2.5, 0.05, 0.004, 0.05] : [800, 1.2, 0.08, 0.006, 0.1]) : c.kind === 'land' ? [260, 0.8, 0.12, 0.008, 0.18] : c.kind === 'rustle' ? [4200, 0.7, 0.05, 0.03, 0.32] : [3000, 0.4, 0.05, 0.12, 0.6];
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = spec[0] * (0.85 + Math.random() * 0.3); f.Q.value = spec[1];
      const gn = ac.createGain(), p = ac.createStereoPanner(), now = ac.currentTime; p.pan.value = pan;
      gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(spec[2] * g * 2.2, now + spec[3]); gn.gain.exponentialRampToValueAtTime(0.0005, now + spec[4]);
      src.connect(f).connect(gn).connect(p).connect(ac.destination); src.start(now, Math.random()); src.stop(now + spec[4] + 0.05);
    },
  };
})();

/** where you're going and looking: the ground the eye's line meets, looked past the culms (a culm crossing your line is
 * passed in a moment; the way on is what the drawing holds), kept between near and far, and moved to slowly (`focus`
 * eases toward it), so the drawing doesn't lurch with every culm that crosses */
let focus = 0;
function focusAt(eye: [number, number, number], yaw: number, pitch: number) {
  const dx = Math.sin(yaw), dz = Math.cos(yaw), cp = Math.max(0.05, Math.cos(pitch)), sp = Math.sin(pitch), NEAR = 7, FAR = 30;
  for (let d = NEAR; d < FAR; d += 0.75) if (eye[1] + sp * d < me.groundAt(eye[0] + dx * cp * d, eye[2] + dz * cp * d)) return d;
  return FAR;
}

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
const up = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) { drag = null; held = false; remember(true); } };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { keys.add(e.key); sound.start(); });
addEventListener('keyup', (e) => keys.delete(e.key));

// ─── the run ───
// ─── the chase (`chase=fox|runner|stir`): something crosses your way; stay with it as long as you can (presence.ts,
// chase.ts). Lost a while, and it's well away, the grove settles and a quiet line says so; a while later, another ───
const chaseKind = params.get('chase') as Kind | null;
let it: Presence | null = null, chase: Chase | null = null, again = 0, chaseSeed = seed * 31, settle = 0, yourNoise = 0;
const note = document.createElement('div'); note.id = 'chasenote'; document.body.appendChild(note);
function begin() {
  if (!chaseKind) return;
  const fx = Math.sin(me.heading), fz = Math.cos(me.heading), side = (chaseSeed % 2 ? 1 : -1);
  // (it crosses your way a little ahead; someone running, along the trail ahead of you, going your way)
  let x = me.x + fx * 13 - fz * 2 * side, z = me.z + fz * 13 + fx * 2 * side;
  const runner = chaseKind === 'runner', q = runner ? world.trailNear(me.x, me.z) : null;
  if (q?.trail && q.d < 12) {
    // (along your own trail, the way you're facing, sixteen metres on)
    const tr = q.trail, j = Math.min(tr.x.length - 2, q.i + 1), fwd = (tr.x[j] - tr.x[q.i]) * fx + (tr.z[j] - tr.z[q.i]) * fz >= 0 ? 1 : -1, k = Math.max(0, Math.min(tr.x.length - 1, q.i + fwd * 16));
    x = tr.x[k]; z = tr.z[k];
  }
  it = new Presence(chaseKind, me.feet, world, x, z, runner ? me.heading : me.heading + (Math.PI / 2) * side, chaseSeed++);
  chase = new Chase(it, me.feet); note.classList.remove('shown'); lastMe = [me.x, me.z]; settle = 0;
  // (`pose=walk|trot|gallop|gather|bound|contact|absorb|listen|lie`, with `still`: the body held just ahead, side on, to
  // see how it's made; a bound's phases as the fox sheet has them)
  const pose = params.get('pose');
  if (pose) {
    const pd = +(params.get('posed') ?? 5); it.x = me.x + fx * pd; it.z = me.z + fz * pd; it.heading = me.heading + Math.PI / 2; it.y = me.feet.at(it.x, it.z).y;
    it.v = pose === 'walk' ? 1.2 : pose === 'trot' ? 3.2 : pose === 'lie' || pose === 'listen' ? 0 : pose === 'gallop' ? 9 : 6;
    it.mode = pose === 'lie' ? 'rest' : pose === 'listen' ? 'pause' : 'go';
    if (pose === 'listen') it.look = -1.2;
    if (pose === 'gather') it.gather = 0.01;
    if (pose === 'absorb') { it.landT = 0.05; it.comp = 0.03; }
    if (pose === 'bound' || pose === 'contact') { it.air = true; it.flightT = 0.5; it.airT = pose === 'bound' ? 0.16 : 0.44; it.vx = Math.sin(it.heading) * 6; it.vz = Math.cos(it.heading) * 6; it.vy = pose === 'bound' ? 1.6 : -2; it.y += pose === 'bound' ? 0.45 : 0.22; }
    for (let k = 0; k < 40; k++) it.swing(0.05);
  }
}
/** where it's passed, still moving: the culms it brushed and the canopy it went through, settling over a second or two;
 * and where it is */
function wake(p: Presence) {
  const out: number[][] = [];
  for (let k = p.shakes.length - 1; k >= 0 && out.length < 8; k--) {
    const q = p.shakes[k], age = p.t - q.t;
    if (age > 2.6) break;
    out.push([q.x, q.z, q.k * Math.exp(-age / 0.9) * (p.kind === 'stir' ? 1 : 0.7), p.kind === 'stir' ? 5 : 1.4]);
  }
  renderer.stirs = out;
  renderer.stir = p.kind === 'stir' ? [p.x, p.z, 1, 7] : [p.x, p.z, 0.3, 1.4];
}
function chaseStep(dt: number, eye: [number, number, number], yaw: number, p: number, fov: number) {
  if (!chaseKind) return;
  const ran = Math.hypot(me.x - lastMe[0], me.z - lastMe[1]); lastMe = [me.x, me.z];
  yourNoise *= Math.exp(-dt * 2);
  const you = { x: me.x, z: me.z, y: eye[1], v: me.v, loud: yourNoise };
  if (!it) { renderer.presence = []; renderer.stirs = []; renderer.stir = [0, 0, 0, 1]; again -= dt; if (again <= 0) begin(); return; }
  it.step(dt, you);
  renderer.presence = it.parts(); wake(it);
  const d = Math.hypot(it.x - me.x, it.z - me.z);
  if (!chase) { if (d > 90) { it = null; again = 25; } return; }
  const hy = fov / 2, hx = Math.atan(Math.tan(hy) * innerWidth / innerHeight);
  chase.update(dt, {
    eye, yaw, pitch: p, hx, hy, px: (2 * Math.tan(hy)) / Math.max(1, innerHeight),
    legible: (x, y, z) => renderer.legible(x, y, z),
    // (you hear it only with the sound on; a gust, or your own running, drowns some of it)
    hearing: sound.on(), mask: gust.strength * Math.exp(-((eye[0] * gust.dir[0] + eye[2] * gust.dir[1] - gust.front) ** 2) / 900) * 0.5 + (me.v / LOPE) * 0.3,
  }, ran);
  for (const c of chase.heard) sound.cue(c, it.kind, eye, yaw);
  // (the end: once it's over and you've let it go, slowed or a few seconds on; no score, a line)
  if (chase.over) {
    settle += dt;
    if (settle > 6 || me.v < 1.5) {
      const what = it.kind === 'fox' ? 'the fox' : it.kind === 'runner' ? 'the runner' : 'whatever it was';
      note.textContent = chase.state === 'met' ? (it.kind === 'fox' ? 'the fox let you come close' : it.kind === 'runner' ? 'the runner stopped here' : 'it settled here') : `${what} has gone`;
      note.classList.add('shown');
      lastChase = { kind: it.kind, ended: chase.state, time: chase.time, run: chase.run, seen: chase.seenTime, traced: chase.tracedTime, searched: chase.searchTime, regained: chase.regained };
      chase = null;
    }
  }
}
let lastChase: Record<string, unknown> | null = null;
let lastMe = [0, 0];
function run(dt: number) {
  const go = held || keys.has('ArrowUp') || keys.has('w') || auto;
  let turn = 0;
  if (keys.has('ArrowLeft')) turn += dt * 1.6;
  if (keys.has('ArrowRight')) turn -= dt * 1.6;
  // (on its own, after whatever it's chasing, as near as it can tell where; else wandering)
  if (auto && chase && !chase.over) { const [gx, gz] = chase.guess(); let a = Math.atan2(gx - me.x, gz - me.z) - me.heading; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; turn += Math.max(-1.8 * dt, Math.min(1.8 * dt, a)); }
  else if (auto) turn += (Math.sin(t * 0.13 + 1.3) * 0.25 + Math.sin(t * 0.051) * 0.2) * dt;
  turn += dragTurn; dragTurn = 0;
  me.update(dt, { go, turn });
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
/** how well a frame from (x, z) looking along `heading` is composed, as the board's are: a stout culm or two near at
 * each side, framing it; the way ahead open; something standing in the middle distance */
const built = new Map<string, Chunk>();
function framing(x: number, z: number, heading: number) {
  let L = 0, R = 0, block = 0, mid = 0;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const ci = Math.floor(x / CHUNK) + a, cj = Math.floor(z / CHUNK) + b, k = `${ci},${cj}`;
    const c = built.get(k) ?? built.set(k, world.chunk(ci, cj)).get(k)!;
    for (let n = 0; n < c.tall; n++) {
      const q = c.culms[n], dx = q.x - x, dz = q.z - z, d = Math.hypot(dx, dz);
      if (d > 14) continue;
      let ang = Math.atan2(dx, dz) - heading; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
      if (Math.abs(ang) > 0.62) continue;
      if (d < 7 && Math.abs(ang) < 0.14) block++;
      else if (d > 1.2 && d < 5 && q.r >= 0.07 && Math.abs(ang) > 0.2) { if (ang < 0) L++; else R++; }
      else if (d > 7 && d < 14 && Math.abs(ang) < 0.3) mid++;
    }
  }
  return Math.min(L, 2) + Math.min(R, 2) + (L && R ? 1.5 : 0) + Math.min(mid, 3) * 0.3 - block * 2;
}
function findSpots(): Record<string, Spot> {
  const out: Record<string, Spot> = {};
  const all: Trail[] = [];
  for (let a = -2; a <= 1; a++) for (let b = -2; b <= 1; b++) all.push(...world.trails(a, b));
  // (a: at the foot of a flight of steps, looking up it)
  let best = -1e9;
  for (const tr of all) {
    for (let i = 8; i < tr.x.length - 12; i++) if (!tr.stair[i] && tr.stair[i + 4] && tr.stair[i + 9] && tr.y[i + 9] > tr.y[i] + 1) {
      const heading = Math.atan2(tr.x[i + 6] - tr.x[i], tr.z[i + 6] - tr.z[i]), f = framing(tr.x[i], tr.z[i], heading);
      if (f > best) { best = f; out.a = { x: tr.x[i], z: tr.z[i], heading, pitch: 0.12 }; }
    }
  }
  // (b: along a trail with the ground falling away beside it)
  best = -1e9;
  for (const tr of all) {
    for (let i = 10; i < tr.x.length - 10; i += 3) {
      if (tr.stair[i]) continue;
      const dx = tr.x[i + 1] - tr.x[i], dz = tr.z[i + 1] - tr.z[i], l = Math.hypot(dx, dz), sx = -dz / l, sz = dx / l;
      const left = world.ground(tr.x[i] + sx * 8, tr.z[i] + sz * 8) - tr.y[i], right = world.ground(tr.x[i] - sx * 8, tr.z[i] - sz * 8) - tr.y[i];
      if (Math.min(left, right) < -5 && Math.max(left, right) > 2) {
        const heading = Math.atan2(dx, dz) + (left < right ? 0.15 : -0.15), f = framing(tr.x[i], tr.z[i], heading);
        if (f > best) { best = f; out.b = { x: tr.x[i], z: tr.z[i], heading, pitch: -0.02 }; }
      }
    }
  }
  // (cliff: at a rim, looking out over the drop)
  for (let r = 10; r < 300 && !out.cliff; r += 6) for (let a = 0; a < 6.28 && !out.cliff; a += 0.2) {
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = world.ground(x, z);
    for (let k = 0; k < 8; k++) { const b = (k / 8) * 6.28, d = world.ground(x + Math.sin(b) * 3, z + Math.cos(b) * 3); if (h - d > 4 && world.trailNear(x, z).d > 4) { out.cliff = { x, z, heading: b, pitch: -0.12 }; break; } }
  }
  // (c, run: in the grove, off the trails)
  // (the best framed of a ring of places round about, off the trails)
  best = -1e9;
  for (let r = 14; r <= 50; r += 9) for (let a = 0; a < 6.28; a += 0.5) for (let hd = 0; hd < 6.28; hd += 0.785) {
    const x = me.x + Math.sin(a) * r, z = me.z + Math.cos(a) * r;
    if (world.trailNear(x, z).d < 6) continue;
    const f = framing(x, z, hd);
    if (f > best) { best = f; out.c = { x, z, heading: hd, pitch: 0.02 }; }
  }
  out.c ??= { x: me.x, z: me.z, heading: me.heading, pitch: 0.02 };
  out.run = { ...out.c, v: LOPE, pitch: -0.04 };
  out.up = { ...out.c, pitch: 1.35 };
  out.gust = { ...out.c, pitch: 0.18 };
  return out;
}
const refName = params.get('ref');
// (`?cam=x,z,heading,pitch[,speed]`: a camera pinned exactly, for the gates (devtools/bamboo-gates.mjs))
const cam = params.get('cam')?.split(',').map(Number);
const spot: Spot | null = cam && cam.length >= 4 && cam.every(Number.isFinite) ? { x: cam[0], z: cam[1], heading: cam[2], pitch: cam[3], v: cam[4] } : refName ? findSpots()[refName] ?? null : null;
if (spot) { me.x = spot.x; me.z = spot.z; me.heading = me.move = spot.heading; pitch = spot.pitch; me.v = spot.v ?? 0; me.phase = 0.35; }
stream(400);
me.onStep = (on, hard) => sound.step(on, hard);
me.onLand = (on, impact) => { sound.land(on, impact); yourNoise = Math.max(yourNoise, Math.min(1, impact / 5)); };
me.onBrush = (_side, k) => sound.brush(k);
me.y = me.groundAt(me.x, me.z);

// ─── the address keeps where you are: how it's drawn (the dials that differ from the house), and where you stand, which
// way you look and when (`at`, `t`), so a link opens on just this; written when you come to rest, finish looking round,
// change a dial, or leave the page; never while you run ───
let wrote = 0, wroteAt = '';
function remember(now = false) {
  if (spot) return;
  const at = [me.x, me.z, me.heading, pitch].map((v) => Math.round(v * 100) / 100).join(',');
  const stamp = performance.now();
  if (!now && ((at === wroteAt && stamp - wrote < 2000) || stamp - wrote < 600)) return;
  const u = new URL(address(renderer.dials), location.origin);
  for (const k of ['at', 't', 'seed']) u.searchParams.delete(k);
  const rest = u.searchParams.toString();
  history.replaceState(null, '', `${u.pathname}?seed=${seed}${rest ? '&' + rest : ''}&at=${at}&t=${Math.round(t * 10) / 10}${u.hash}`);
  wrote = stamp; wroteAt = at;
}
addEventListener('visibilitychange', () => { if (document.hidden) remember(true); });
// ─── the frame ───
let last = performance.now(), scale = 1, avgMs = 16, lastScale = 0;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * scale, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
// ─── the hour: the sky from the dials; when its light has moved, the land's shadows baked again, a few pieces a frame,
// nearest first ───
let relit: string[] = [];
function air() {
  const sky = skyAt(renderer.dials.hour, renderer.dials.mist), L = sky.lightDir, W = world.light;
  renderer.sky = sky;
  if (L[0] * W[0] + L[1] * W[1] + L[2] * W[2] < Math.cos(0.025)) {
    world.light = [...L];
    relit = [...me.chunks.entries()].sort(([, a], [, b]) => Math.hypot(a.x0 - me.x, a.z0 - me.z) - Math.hypot(b.x0 - me.x, b.z0 - me.z)).map(([k]) => k);
  }
  for (let n = 0; n < 4 && relit.length; n++) { const k = relit.shift()!, c = me.chunks.get(k); if (c) { world.relight(c); renderer.relight(k, c); } }
}
function frame(now: number) {
  // (the run keeps real time in its own fixed steps, however the frames come; held to a quarter second after a stall,
  // and never less than none (the first frame's time can come before the page's own))
  const dt = Math.max(0, Math.min(0.25, (now - last) / 1000)); last = now;
  if (!still) t += dt;
  resize();
  air();
  if (!spot && !still) run(dt);
  stream(1);
  // (the body, as the eye has it: the stride's bob and sway, let go of in the air and settling; sunk as it gathers, lands,
  // ducks, rolls; pushed aside by a brush; leaning into a gap shoulder first)
  airK += ((me.air ? 1 : 0) - airK) * (1 - Math.exp(-dt * (me.air ? 8 : 5)));
  const s = Math.min(1, me.v / LOPE) * (1 - airK), bob = Math.abs(Math.sin(me.phase * Math.PI)) * 0.065 * s, sway = Math.sin(me.phase * Math.PI) * 0.035 * s;
  const side = [Math.cos(me.move), -Math.sin(me.move)], lat = sway + me.nudge + me.shoulder * 0.06;
  const eye: [number, number, number] = [me.x + side[0] * lat, me.y + EYE + bob - me.low, me.z + side[1] * lat];
  if (refName === 'gust') { gust.dir = [-0.9, -0.43]; gust.front = eye[0] * gust.dir[0] + eye[2] * gust.dir[1] + 6; gust.strength = 1; }
  else if (!still) stepGust(dt, eye);
  // (looking: where you're heading; tipped a little with the ground ahead)
  const yaw = me.heading + me.shoulder * 0.2, gAhead = me.groundAt(me.x + Math.sin(yaw) * 6, me.z + Math.cos(yaw) * 6) - me.y;
  let p = pitch + Math.atan2(gAhead, 6) * 0.5 - me.pitchDown;
  // (in the air, the eye goes a little toward where you'll come down)
  if (me.aim) { const ad = Math.max(0.5, Math.hypot(me.aim[0] - eye[0], me.aim[2] - eye[2])); aimK += (Math.atan2(me.aim[1] + 0.3 - eye[1], ad) - aimK) * Math.min(1, dt * 6); }
  p += (aimK - p) * 0.4 * airK;
  const look: [number, number, number] = [eye[0] + Math.sin(yaw) * Math.cos(p), eye[1] + Math.sin(p), eye[2] + Math.cos(yaw) * Math.cos(p)];
  roll += (-me.turn * 0.5 * s + Math.sin(me.phase * Math.PI) * 0.012 * s + me.shoulder * 0.06 + (me.rollT >= 0 ? 0.07 * Math.sin(2 * Math.PI * me.rollT) : 0) - roll) * (1 - Math.exp(-dt * 6));
  const portrait = innerHeight > innerWidth, base = Number(params.get('fov')) || (portrait ? 74 : 60);
  const fov = (base + 12 * s) * Math.PI / 180;
  // (the focus: where you're going and looking, the page coming in round it)
  const target = focusAt(eye, yaw, p);
  focus = still || focus === 0 ? target : focus + (target - focus) * Math.min(1, dt * 0.8);
  const sheet = Math.min(devicePixelRatio || 1, 2);
  const f: Frame = { eye, look, fov, t, gust: [gust.dir[0], gust.dir[1], gust.front, gust.strength], speed: me.v, roll, focus, paper: [Math.round(innerWidth * sheet), Math.round(innerHeight * sheet)] };
  if (!still || chaseKind) chaseStep(still ? 0 : dt, eye, yaw, p, fov);
  renderer.draw(f, canvas.width, canvas.height);
  const ms = performance.now() - now;
  // (how finely it's drawn follows how long frames take, over a second or so, in steps, never frame to frame: a canvas
  // resized every frame makes everything tied to its pixels shimmer)
  if (!still && !spot) {
    avgMs = avgMs * 0.96 + ms * 0.04;
    if (now - lastScale > 1200) {
      const next = avgMs > 28 ? Math.max(0.6, scale - 0.1) : avgMs < 12 ? Math.min(1, scale + 0.1) : scale;
      if (next !== scale) { scale = next; lastScale = now; }
    }
  }
  // (at rest, the address catches up)
  if (me.v < 0.05 && !drag && !held) remember();
  (window as unknown as { __bamboo: unknown }).__bamboo = { seed, x: me.x, z: me.z, y: me.y, heading: me.heading, pitch, v: me.v, onTrail: me.onTrail, air: me.air, act: me.act, low: me.low, landedAs: me.landedAs, chase: chase && it ? { kind: it.kind, state: chase.state, time: chase.time, d: Math.hypot(it.x - me.x, it.z - me.z), x: it.x, y: it.y, z: it.z, alarm: it.alarm, air: it.air, parts: renderer.presence.length } : null, lastChase, presence: it ? { kind: it.kind, mode: it.mode, d: Math.hypot(it.x - me.x, it.z - me.z) } : null, again, t, chunks: me.chunks.size, frameMs: ms, scale };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
