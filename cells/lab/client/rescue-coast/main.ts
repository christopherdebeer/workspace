/**
 * Rescue Race: Lily's game. You have a boat; out on the sea there are little people in tiny boats of every colour.
 * Steer near enough to one and its people come across onto your boat. Rescue as many as you can, then reach the finish
 * line. Four other boats are out there doing the same; the winner is the boat that rescued the most, and there's a 1st
 * place, a 2nd, a 3rd, a 4th and a 5th.
 *
 * The sea is `sea.ts` (from a seed), the rules `race.ts` (stepped here at 60 a second), the things `mesh.ts`, the
 * drawing `render.ts`, the marks on the water `fx.ts`, the sounds `sound.ts`. Here: the camera (looking up the course
 * from behind your boat, a little ahead of it), your hand on the wheel (hold a finger where you want to go; or the
 * arrow keys), the people's places (waiting and waving, jumping across, standing on deck), and the race's words on
 * the screen (the line-up, the count of three, your count, the places as they stand, how far to the finish, arrows to
 * tiny boats off the screen, the last call, the places at the end).
 *
 *   ?seed=  ?level=easy|medium|hard  ?boat=0..4  ?auto (every boat the game's)  ?t=40 (that far into the race)
 *   ?view=podium (to the end)  ?still (time held)  ?zoom=  ?near=n (tiny boat n and the big boat nearest it, in view)
 *   ?preview (small and quiet: the race the game's own, on and on)
 */
import { randomSeed, seedFrom, seedName } from '../kit/rng';
import { BOATS, GAP, JUMP, NEAR, SEATS, VMAX, along, newRace, runFor, spotOf, standings, start, step, type Input, type Level, type Race } from '../rescue/race';
import { BERTH_Z, HAIRS, L, SHIRTS, SKINS, START_Z, TINY_COLOURS, waveAt, type Sea } from './sea';
import { bigBoat, buoy, person, tinyBoat, worldMesh } from './mesh';
import { FX, Instances, Renderer, mat4, type Frame, type M4 } from './render';
import { Marks } from './fx';
import { Sound } from '../rescue/sound';

const params = new URLSearchParams(location.search);
const preview = params.has('preview'), auto = preview || params.has('auto'), still = params.has('still');
const STORE = 'rescue-coast:v1';
const saved: { boat?: number; level?: Level; sound?: boolean } = (() => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } })();
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* (no storage: kept only this time) */ } };
const LEVEL_NAMES: Level[] = ['easy', 'medium', 'hard'];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

let seed = seedFrom(params.get('seed')) ?? (preview ? 7 : randomSeed());
let level: Level = LEVEL_NAMES.includes(params.get('level') as Level) ? (params.get('level') as Level) : saved.level ?? 'easy';
let mine = clamp(Math.round(Number(params.get('boat') ?? saved.boat ?? 0)) || 0, 0, 4);

const canvas = document.getElementById('sea') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
const $ = (id: string) => document.getElementById(id)!;
if (preview || params.has('study')) document.body.classList.add('preview');
if (!gl) { document.body.classList.add('nogl'); throw new Error('WebGL2 is needed'); }
const R = new Renderer(gl);
R.addKind('big', bigBoat()); R.addKind('tiny', tinyBoat()); R.addKind('person', person(false)); R.addKind('hat', person(true)); R.addKind('buoy', buoy());
const marks = new Marks(), sound = new Sound();
sound.on = saved.sound ?? true;

// ─── the race ───
type Ui = 'lineup' | 'race' | 'podium';
let ui: Ui = 'lineup', race!: Race, sea: Sea | null = null, endAt = -1, vt = 0;
/** when each boat's crew last cheered (someone new aboard); when each boat last had a wake's droplets */
const cheerUntil = [0, 0, 0, 0, 0];
function setRace(s: number) {
  seed = s;
  race = newRace(seed, { level, mine, auto });
  if (race.sea !== sea) { sea = race.sea; R.setSea(sea, worldMesh(sea)); }
  marks.clear(); endAt = -1; cheerUntil.fill(0);
  $('seedname').textContent = seedName(seed);
}
function toLineup() {
  ui = 'lineup';
  document.body.className = document.body.className.replace(/\b(lineup|racing|podium)\b/g, '').trim();
  document.body.classList.add('lineup');
  lineupUi();
}
function go() {
  sound.arm();
  if (race.phase !== 'lineup') setRace(seed);
  start(race);
  ui = 'race'; usedHand = false;
  document.body.classList.remove('lineup', 'podium'); document.body.classList.add('racing');
}
function toPodium() {
  ui = 'podium';
  document.body.classList.remove('racing'); document.body.classList.add('podium');
  const st = standings(race), place = st.findIndex((b) => b.id === mine);
  const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
  $('result').textContent = auto ? `${st[0].name} wins!` : place === 0 ? 'You won! 1st place!' : `You came ${ORD[place]}!`;
  $('ranks').innerHTML = st.map((b, i) => `<li class="${b.id === mine && !auto ? 'me' : ''} p${i + 1}"><b>${ORD[i]}</b><i style="background:${css(b.colour)}"></i><span>${b.name}${b.id === mine && !auto ? ' <em>you</em>' : ''}</span><strong>${b.aboard.length}</strong><small>${b.finished >= 0 ? 'rescued' : 'rescued · not home'}</small></li>`).join('');
  sound.fanfare(auto ? 0 : place);
}
const css = (c: readonly number[]) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

// ─── the line-up: choose your boat, how good the others are, and go ───
function lineupUi() {
  $('boats').innerHTML = BOATS.map((b, i) => `<button data-boat="${i}" class="${i === mine ? 'on' : ''}"><i style="background:${css(b.colour)}"></i>${b.name}</button>`).join('');
  for (const el of $('levels').querySelectorAll('button')) el.classList.toggle('on', el.dataset.level === level);
}
$('boats').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button');
  if (!el) return;
  mine = Number(el.dataset.boat); saved.boat = mine; save();
  setRace(seed); lineupUi();
});
$('levels').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('button');
  if (!el) return;
  level = el.dataset.level as Level; saved.level = level; save();
  setRace(seed); lineupUi();
});
$('go').addEventListener('click', go);
$('newsea').addEventListener('click', () => { setRace(randomSeed()); lineupUi(); });
$('again').addEventListener('click', () => { setRace(seed); go(); });
$('next').addEventListener('click', () => { setRace(randomSeed()); go(); });
$('choose').addEventListener('click', () => { setRace(seed); toLineup(); });
$('sound').addEventListener('click', () => { sound.arm(); sound.toggle(); saved.sound = sound.on; save(); $('sound').textContent = sound.on ? 'sound on' : 'sound off'; });
$('sound').textContent = sound.on ? 'sound on' : 'sound off';

// ─── the camera: up the course from behind (south), looking down a little ahead of your boat ───
const EL = params.has('study') ? .26 : .38;
const cam = { x: 0, z: 0, w: 34, init: false };
let W = 1, H = 1, dpr = 1, aspect = 1, vp: M4 = new Float32Array(16), inv: M4 = new Float32Array(16), eye = [0, 0, 0], right = [1, 0, 0], up = [0, 1, 0];
/** the boat the camera follows: yours, or (in the preview) whoever's rescued most */
const followed = () => (auto ? standings(race)[0] : race.boats[mine]);
function camWant(): [number, number, number] {
  if (!sea) return [0, 0, 34];
  const wide = aspect > 1 ? Math.min(aspect, 1.9) * 0.78 : 1, zoom = Number(params.get('zoom') ?? 1);
  // (the line-up: yours in the top half of the screen (the sheet's below), its neighbours either side)
  if(params.has('study')) {const b=followed();return [b.x,b.z+3,19*wide*zoom];}
  if (ui === 'lineup') return [race.boats[mine].x, START_Z - 12, 36 * wide * zoom];
  // (the end: the harbour, every boat at its berth, in the top half of the screen (the places are below))
  if (ui === 'podium') return [sea.centre(BERTH_Z), BERTH_Z - 24, 58 * wide * zoom];
  // (racing: your boat a little below the middle, a little more of what's ahead of it in view)
  const b = followed(), lead = 2 + b.v * 0.4;
  // (`?near=n`: tiny boat n and the big boat nearest it, both in view (for pictures of a rescue))
  const near = race.tinies[Number(params.get('near') ?? -1)];
  if (near) { const o = [...race.boats].sort((p, q) => Math.hypot(p.x - near.x, p.z - near.z) - Math.hypot(q.x - near.x, q.z - near.z))[0]; return [(o.x + near.x) / 2, (o.z + near.z) / 2 - 2, 26 * wide * zoom]; }
  return [b.x + Math.sin(b.h) * lead, b.z + Math.cos(b.h) * lead + 3, (preview ? 40 : 25.5) * wide * zoom];
}
function camera(dt: number) {
  const [x, z, w] = camWant();
  if (!cam.init) { cam.x = x; cam.z = z; cam.w = w; cam.init = true; }
  const k = 1 - Math.exp(-dt * (ui === 'race' ? 3.2 : 1.6));
  cam.x += (x - cam.x) * k; cam.z += (z - cam.z) * k; cam.w += (w - cam.w) * k;
  const fovy = aspect < 1 ? 0.9 : 0.72, fovx = 2 * Math.atan(Math.tan(fovy / 2) * aspect), dist = cam.w / 2 / Math.tan(fovx / 2);
  eye = [cam.x, Math.sin(EL) * dist, cam.z - Math.cos(EL) * dist];
  const view = mat4.lookAt(eye, [cam.x, 0, cam.z], [0, 1, 0]), proj = mat4.perspective(fovy, aspect, 0.65, 850);
  vp = mat4.mul(proj, view); inv = mat4.invert(vp);
  right = [view[0], view[4], view[8]]; up = [view[1], view[5], view[9]];
}
/** a point on the screen (css px) to where it meets the water */
function onWater(sx: number, sy: number): { x: number; z: number } | null {
  const nx = (sx / W) * 2 - 1, ny = 1 - (sy / H) * 2;
  const un = (z: number) => { const v = [nx, ny, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += inv[k * 4 + i] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1), dy = b[1] - a[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = -a[1] / dy;
  if (t < 0) return null;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[2] + (b[2] - a[2]) * t };
}
/** a point in the world to the screen (css px), and whether it's in front */
function project(x: number, y: number, z: number): [number, number, boolean] {
  const m = vp, cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [((cx / cw) * 0.5 + 0.5) * W, (0.5 - (cy / cw) * 0.5) * H, cw > 0];
}

// ─── your hand on the wheel: a finger held where you want to go; or the arrow keys ───
let finger: { id: number; x: number; y: number } | null = null, usedHand = false;
canvas.addEventListener('pointerdown', (e) => {
  sound.arm();
  if (ui !== 'race') return;
  finger = { id: e.pointerId, x: e.clientX, y: e.clientY }; usedHand = true;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* (a synthetic pointer) */ }
});
canvas.addEventListener('pointermove', (e) => { if (finger && e.pointerId === finger.id) { finger.x = e.clientX; finger.y = e.clientY; } });
const lift = (e: PointerEvent) => { if (finger && e.pointerId === finger.id) finger = null; };
canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  if (ui === 'lineup' && (e.key === 'Enter' || e.key === ' ')) { go(); return; }
  keys.add(e.key.toLowerCase()); if (ui === 'race') usedHand = true;
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function hand(): Input {
  if (ui !== 'race' || auto) return {};
  if (finger) { const a = onWater(finger.x, finger.y); if (a) return { aim: a, throttle: 1 }; }
  const lt = keys.has('arrowleft') || keys.has('a'), rt = keys.has('arrowright') || keys.has('d'), fw = keys.has('arrowup') || keys.has('w'), bk = keys.has('arrowdown') || keys.has('s');
  // (the camera looks north: +x is on the screen's left, and a boat turning toward +x turns left)
  if (lt || rt || fw || bk) return { turn: (lt ? 1 : 0) - (rt ? 1 : 0), throttle: bk ? 0 : 1 };
  return {};
}

// ─── where everything is, this frame ───
const boats = new Instances(8), tinies = new Instances(64), people = new Instances(128), hats = new Instances(64), buoys = new Instances(128);
const NONE = [0, 0, 0];
/** the little people a little larger than life, so they read from the camera's height */
const PERSON = 1.34;
/** a boat on the waves: its height, and how the swell pitches and rolls it (sampled at bow, stern, and either side) */
function bob(x: number, z: number, h: number, len: number, beam: number, t: number): [number, number, number] {
  const s = Math.sin(h), c = Math.cos(h);
  const at = (f: number, w: number) => waveAt(sea, x + s * f + c * w, z + c * f - s * w, t)[0];
  const hb = at(len, 0), hs = at(-len, 0), hr = at(0, beam), hl = at(0, -beam);
  return [(hb + hs + hr + hl) / 4, Math.atan2(hb - hs, 2 * len), Math.atan2(hr - hl, 2 * beam)];
}
/** a point on a boat (its own x across, y up, z along) to the world, as the drawing turns it: roll, pitch, then its heading */
function onBoat(p: readonly number[], x: number, y: number, z: number, h: number, pitch: number, roll: number): [number, number, number] {
  let px = p[0], py = p[1], pz = p[2];
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(h), sy = Math.sin(h);
  [px, py] = [px * cr - py * sr, px * sr + py * cr];
  [py, pz] = [py * cp + pz * sp, -py * sp + pz * cp];
  [px, pz] = [px * cy + pz * sy, -px * sy + pz * cy];
  return [px + x, py + y, pz + z];
}
const boatPose: Array<[number, number, number]> = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
const tinyPose = new Map<number, [number, number, number, number]>();

function stage(t: number) {
  boats.clear(); tinies.clear(); people.clear(); hats.clear(); buoys.clear(); tinyPose.clear();
  for (const b of race.boats) {
    const [y, pitch, roll] = bob(b.x, b.z, b.h, 4.5, 1.9, t), fast = b.v / VMAX;
    const p: [number, number, number] = [y + fast * 0.12, pitch + fast * 0.05, roll - b.rudder * fast * 0.13];
    boatPose[b.id] = p;
    boats.push(b.x, p[0], b.z, b.h, p[1], p[2], 1, 0, b.colour, 0, NONE, NONE, b.id * 1.7);
  }
  for(const b of race.boats){
    const [by,bp,br]=boatPose[b.id];
    const crew=onBoat([-.78,1.05,-.55],b.x,by,b.z,b.h,bp,br);
    hats.push(crew[0],crew[1],crew[2],b.h,bp,br,PERSON, .16,[1,.72,.1],.25,SKINS[b.id%SKINS.length],HAIRS[b.id%HAIRS.length],0);
  }
  for (const tn of race.tinies) {
    let scale = 1;
    if (tn.claimedBy >= 0) {
      const gone = tn.claimedAt + 0.15 + (tn.people.length - 1) * GAP + JUMP + 1.2;
      scale = clamp(1 - (race.time - gone) / 0.8, 0, 1);
      if (scale <= 0) continue;
    }
    const [y, pitch, roll] = bob(tn.x, tn.z, tn.yaw, 1.4, 0.7, t);
    tinyPose.set(tn.id, [y, pitch, roll, scale]);
    tinies.push(tn.x, y, tn.z, tn.yaw, pitch, roll, scale * 1.18, 0, TINY_COLOURS[tn.colour], 0, NONE, NONE, 0);
  }
  for (const p of race.people) {
    const lk = p.look, list = lk.hat ? hats : people, shirt = SHIRTS[lk.shirt], skin = SKINS[lk.skin], hair = HAIRS[lk.hair];
    const tn = race.tinies[p.tiny], seat = SEATS[tn.people.length][p.seat], wav = Math.sin(t * 9 + p.id * 1.3);
    const seatAt = (): [number, number, number] => { const tp = tinyPose.get(tn.id) ?? [0, 0, 0, 1]; return onBoat([seat[0], -0.14, seat[1]], tn.x, tp[0], tn.z, tn.yaw, tp[1], tp[2]); };
    if (p.boat < 0 || !p.jumped) {
      if (!tinyPose.has(tn.id)) continue;
      // (waiting: facing the nearest big boat, and waving both arms when one's coming)
      let near = Infinity, face = tn.yaw;
      for (const b of race.boats) { const d = Math.hypot(b.x - tn.x, b.z - tn.z); if (d < near) { near = d; face = Math.atan2(b.x - tn.x, b.z - tn.z); } }
      const [x, y, z] = seatAt(), waving = near < 45 && race.phase !== 'lineup';
      list.push(x, y, z, face, 0, 0, PERSON, waving ? 2.45 + 0.4 * wav : 0.2, shirt, waving ? 2.45 - 0.4 * wav : 0.2, skin, hair, 0);
    } else {
      const b = race.boats[p.boat], [by, bp, br] = boatPose[b.id], spot = spotOf(p.spot);
      const deck = onBoat(spot, b.x, by, b.z, b.h, bp, br);
      if (!p.landed) {
        // (jumping across: in an arc from their seat to their spot on deck, arms up, turning once in the air)
        const s = clamp((race.time - p.jumpAt) / JUMP, 0, 1), from = tinyPose.has(tn.id) ? seatAt() : deck, d = Math.hypot(deck[0] - from[0], deck[2] - from[2]);
        const x = from[0] + (deck[0] - from[0]) * s, z = from[2] + (deck[2] - from[2]) * s, y = from[1] + (deck[1] - from[1]) * s + Math.sin(Math.PI * s) * (.30 + Math.min(d,6) * .045);
        list.push(x, y, z, b.h + Math.PI, 0.12*Math.sin(s*Math.PI), 0, PERSON, 1.9, shirt, 1.3, skin, hair, 0);
        if (!still && Math.random() < 0.015) marks.sparkle(x, y + 0.9, z, 1, [1, 0.95, 0.6], 0.3, 0.18);
      } else {
        // (aboard: facing aft (toward the camera, mostly), cheering when someone new comes aboard, waving at the end)
        const cheer = race.time < cheerUntil[b.id] || (b.finished >= 0 && race.time - b.finished < 4) || ui === 'podium';
        const armL = cheer ? 2.5 + 0.35 * wav : 0.18 + 0.05 * Math.sin(t * 1.3 + p.id), armR = cheer ? 2.5 - 0.35 * wav : 0.18 + 0.05 * Math.sin(t * 1.1 + p.id * 2);
        list.push(deck[0], deck[1], deck[2], b.h + Math.PI + ((p.id * 0.37) % 0.6) - 0.3, 0, 0, PERSON, armL, shirt, armR, skin, hair, 0);
      }
    }
  }
  for (const d of sea!.decor) {
    if (d.kind !== 'buoy' || d.z < frameZ[0] - 20 || d.z > frameZ[1] + 20) continue;
    const [y, pitch, roll] = bob(d.x, d.z, 0, 0.4, 0.4, t);
    const col = d.c === 0 ? [0.92, 0.22, 0.17] : d.c === 2 ? [0.1, 0.1, 0.12] : [0.98, 0.98, 0.96];
    buoys.push(d.x, y - 0.15, d.z, 0, pitch * 0.6, roll * 0.6, d.z > L - 1 ? 2 : 1.4, 0, col, 0, NONE, NONE, 0);
  }
}

// ─── what the race says: sounds, marks, the words on the screen ───
let lastLand = 0;
function happenings() {
  for (const e of race.events) {
    switch (e.kind) {
      case 'count': say(String(e.n)); sound.count(e.n); break;
      case 'go': say('Go!'); sound.count(0); sound.horn(); break;
      case 'claim': { const tn = race.tinies[e.tiny]; marks.ring(tn.x, tn.z, NEAR * 0.8, 4, 0.8, 0.9, race.boats[e.boat].colour); if (e.boat === mine) cheerUntil[mine] = race.time + 1.4; break; }
      case 'jump': {
        const p = race.people[e.person], tn = race.tinies[p.tiny];
        marks.splash(tn.x, 0.4, tn.z, 4, 2); marks.ring(tn.x, tn.z, 1.0, 2.6, 0.9, 0.55);
        if (e.boat === mine || Math.hypot(tn.x - cam.x, tn.z - cam.z) < 40) sound.jump(e.boat === mine);
        break;
      }
      case 'land': {
        const b = race.boats[e.boat], [by, bp, br] = boatPose[b.id], at = onBoat(spotOf(race.people[e.person].spot), b.x, by, b.z, b.h, bp, br);
        marks.sparkle(at[0], at[1] + 1.2, at[2], e.boat === mine ? 7 : 3, e.boat === mine ? [1, 0.92, 0.45] : b.colour);
        cheerUntil[b.id] = Math.max(cheerUntil[b.id], race.time + 0.9);
        if (e.boat === mine) { sound.hop(e.total, true); pop(`+1`, b.colour); lastLand = performance.now(); }
        else if (Math.hypot(b.x - cam.x, b.z - cam.z) < 45) sound.hop(e.total, false);
        break;
      }
      case 'finish': {
        const b = race.boats[e.boat];
        if (e.boat === mine && !auto) { say('Across the line!'); sound.horn(0.8); sound.cheer(); marks.sparkle(b.x, 4, b.z, 40, [1, 0.85, 0.3], 4, 0.5); }
        else toast(`${b.name} is across the line${e.order === 0 ? ' first' : ''}!`);
        break;
      }
      case 'lastcall': sound.bell(); if (!auto && race.boats[mine].finished < 0) say('Last call! Go for the finish!', true); break;
      case 'bump': if (e.boat === mine) { const b = race.boats[mine], [x, z] = along(b, 4.5); sound.bump(e.hard); marks.splash(x, 0.6, z, 8, 3); } break;
      case 'end': endAt = performance.now() + 2600; break;
    }
  }
  race.events.length = 0;
}

// ─── the words on the screen ───
let sayTimer = 0;
function say(text: string, long = false) {
  const el = $('big');
  el.textContent = text; el.classList.toggle('long', long); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(sayTimer); sayTimer = window.setTimeout(() => el.classList.remove('on'), long ? 2400 : 1100);
}
function toast(text: string) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function pop(text: string, col: readonly number[]) {
  const b = race.boats[mine], [sx, sy] = project(b.x, 4.5, b.z);
  const el = document.createElement('div');
  el.className = 'pop'; el.textContent = text; el.style.left = `${sx}px`; el.style.top = `${sy}px`; el.style.color = css(col);
  $('pops').appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
let placesKey = '';
function hud() {
  if (ui !== 'race') return;
  const st = standings(race), key = st.map((b) => `${b.id}:${b.rescued}`).join(',');
  if (key !== placesKey) {
    placesKey = key;
    $('places').innerHTML = st.map((b, i) => `<div class="chip${b.id === mine && !auto ? ' me' : ''}"><small>${ORD[i]}</small><i style="background:${css(b.colour)}"></i><b>${b.rescued}</b></div>`).join('');
    const me = race.boats[mine];
    $('count').textContent = String(me.rescued);
    $('me').classList.toggle('bump', performance.now() - lastLand < 300);
  }
  // (how far along: the five boats between the start and the finish)
  const tr = $('track');
  if (tr.children.length !== 6) tr.innerHTML = '<span class="flag"></span>' + race.boats.map((b) => `<i style="background:${css(b.colour)}" class="${b.id === mine ? 'me' : ''}"></i>`).join('');
  race.boats.forEach((b, k) => { (tr.children[k + 1] as HTMLElement).style.bottom = `${clamp(b.z / L, 0, 1) * 100}%`; });
  // (the last call)
  const call = $('call');
  if (race.lastCall >= 0 && race.phase === 'racing') {
    const left = Math.max(0, Math.ceil(race.callLength - (race.time - race.lastCall))), first = race.boats[race.order[0]];
    call.textContent = race.boats[mine].finished >= 0 && !auto ? `You're home! The others have ${left}s` : `${first.name} is home! Reach the finish: ${left}s`;
    call.classList.add('on'); call.classList.toggle('hurry', left <= 10);
  } else call.classList.remove('on');
  $('hint').classList.toggle('on', !auto && race.phase === 'racing' && !usedHand && race.time - race.goAt < 9);
  arrows();
}
/**
 * Arrows at the edge of the screen to the nearest tiny boats that are off it, each with how many are waiting; and, in
 * the last call, one to the finish
 */
function arrows() {
  const box = $('arrows'), me = race.boats[mine], want: Array<{ x: number; y: number; a: number; n: string; c: string; fin: boolean }> = [];
  if (!auto && me.finished < 0 && race.phase === 'racing') {
    const cx = W / 2, cy = H / 2, top = 120, bottom = 70, side = 26;
    const edge = (x: number, z: number) => {
      const [sx, sy, front] = project(x, 0.5, z);
      if (front && sx > side && sx < W - side && sy > top && sy < H - bottom) return null;
      let dx = sx - cx, dy = sy - cy;
      if (!front) { dx = -dx; dy = -dy; }
      const kx = dx > 0 ? (W - side - cx) / dx : dx < 0 ? (side - cx) / dx : Infinity, ky = dy > 0 ? (H - bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity, k = Math.min(kx, ky);
      return { x: cx + dx * k, y: cy + dy * k, a: Math.atan2(dy, dx) };
    };
    if (race.lastCall >= 0) { const e = edge(clamp(me.x, sea!.finish[0] + 15, sea!.finish[1] - 15), L); if (e) want.push({ ...e, n: '', c: '#183048', fin: true }); }
    const waiting = race.tinies.filter((tn) => tn.claimedBy < 0).map((tn) => ({ tn, d: Math.hypot(tn.x - me.x, tn.z - me.z) })).filter((o) => o.d < 160).sort((a, b) => a.d - b.d);
    for (const { tn } of waiting) {
      if (want.length >= 3) break;
      const e = edge(tn.x, tn.z);
      if (e) want.push({ ...e, n: String(tn.people.length), c: css(TINY_COLOURS[tn.colour]), fin: false });
    }
  }
  while (box.children.length < want.length) box.appendChild(Object.assign(document.createElement('div'), { className: 'arrow', innerHTML: '<span></span><b></b>' }));
  [...box.children].forEach((el, k) => {
    const h = el as HTMLElement, w = want[k];
    h.style.display = w ? '' : 'none';
    if (!w) return;
    h.classList.toggle('fin', w.fin);
    h.style.transform = `translate(${w.x}px, ${w.y}px)`;
    (h.firstChild as HTMLElement).style.transform = `rotate(${w.a}rad)`;
    (h.firstChild as HTMLElement).style.borderLeftColor = w.c;
    (h.lastChild as HTMLElement).textContent = w.n;
    (h.lastChild as HTMLElement).style.background = w.fin ? '' : w.c;
  });
}

// ─── the marks: wakes and ripples as things move; shadows and near-enough rings, afresh each frame ───
const rippleAt = new Map<number, number>();
function markUp(dt: number) {
  for (const b of race.boats) marks.wake(b.x, b.z, b.h, b.v, dt);
  for (const tn of race.tinies) {
    if (!tinyPose.has(tn.id) || Math.abs(tn.z - cam.z) > 90) continue;
    const next = rippleAt.get(tn.id) ?? vt + (tn.id % 7) * 0.4;
    if (vt >= next) { marks.ring(tn.x, tn.z, 1.4, 1.6, 2.4, 0.35); rippleAt.set(tn.id, vt + 2.2 + (tn.id % 5) * 0.3); }
  }
  marks.update(dt);
  const me = race.boats[mine];
  marks.pack((put) => {
    for (const b of race.boats) put(FX.SHADOW, b.x, 0, b.z, 2.6, 0.32, -b.h, 2.1, NONE, 0);
    // (the finish line: a chequered band floating right across, where it's in view)
    if (frameZ[0] < L + 2 && frameZ[1] > L - 2) for (let x = sea!.finish[0] + 1, k = 0; x < sea!.finish[1] - 1; x += 2, k++) put(FX.CHEQUER, x, 0, L, 1, 1, 0, 0.55, NONE, k % 2);
    // (at the line-up, a ring round yours)
    if (ui === 'lineup' && !auto) put(FX.NEAR, me.x, 0, me.z, 7.5, 0.95, vt * 0.3, 1, me.colour, 0);
    for (const tn of race.tinies) { const tp = tinyPose.get(tn.id); if (tp) put(FX.SHADOW, tn.x, 0, tn.z, 0.8 * tp[3], 0.3, -tn.yaw, 2, NONE, 0); }
    // (near enough: a dashed ring round each tiny boat near yours, brighter as you come in, in your colour when you're close)
    if (ui === 'race' && !auto && me.finished < 0) for (const tn of race.tinies) {
      if (tn.claimedBy >= 0) continue;
      const d = Math.hypot(tn.x - me.x, tn.z - me.z);
      if (d > 70) continue;
      const close = d < NEAR + 6;
      put(FX.NEAR, tn.x, 0, tn.z, NEAR, clamp((70 - d) / 30, 0, 1) * (close ? 0.95 : 0.55), vt * 0.2, 1, close ? me.colour : [1, 1, 1], 0);
    }
  });
}

// ─── the frame ───
let frameZ: [number, number] = [-100, 200];
let last = performance.now(), acc = 0, slow = 0, fast = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  W = w; H = h; aspect = w / h;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
}
dpr = Math.min(devicePixelRatio || 1, 1.65) * (preview ? 0.6 : 1);
addEventListener('resize', resize); resize();

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // (the resolution, to the frame time: down when frames are slow, up again when there's room)
  if (!preview) {
    if (dt > 0.024) { slow++; fast = 0; } else if (dt < 0.013) { fast++; slow = 0; }
    if (slow > 40 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); resize(); slow = 0; }
    if (fast > 240 && dpr < Math.min(devicePixelRatio || 1, 1.65)) { dpr = Math.min(Math.min(devicePixelRatio || 1, 1.65), dpr + 0.25); resize(); fast = 0; }
  }
  if (!still) {
    vt += dt; acc += dt;
    const input = hand();
    let n = 0;
    while (acc >= 1 / 60 && n < 8) { step(race, 1 / 60, input); acc -= 1 / 60; n++; }
    if (n === 8) acc = 0;
  }
  happenings();
  if (ui === 'race' && endAt > 0 && now >= endAt) {
    endAt = -1;
    if (preview) { setRace(seed + 1); start(race); } else toPodium();
  }
  camera(dt);
  // (what of the course is in view: where the screen's corners meet the water)
  const hits = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => onWater(x, y)).filter(Boolean) as Array<{ x: number; z: number }>;
  const zs = hits.map((p) => p.z), xs = hits.map((p) => p.x);
  frameZ = hits.length < 4 ? [cam.z-180,cam.z+700] : zs.length ? [Math.max(cam.z-180,Math.min(...zs)-40), Math.min(cam.z+700,Math.max(...zs)+100)] : [cam.z - 150, cam.z + 250];
  const centre: [number, number] = xs.length ? [xs.reduce((a, b) => a + b) / xs.length, zs.reduce((a, b) => a + b) / zs.length] : [cam.x, cam.z];
  stage(vt);
  markUp(still ? 0 : dt);
  sound.engine(ui === 'race' && !auto ? race.boats[mine].v / VMAX : 0);
  const f: Frame = { vp, eye, time: vt, right, up, zMin: frameZ[0], zMax: frameZ[1], centre, focus: [followed().x, followed().z], boats, tinies, people, hats, buoys, fx: marks.data, fxCount: marks.count };
  R.draw(f, canvas.width, canvas.height);
  hud();
  (window as unknown as { __rescue: unknown }).__rescue = { variant: 'coast', visualBuild: 'coast-fidelity-3',
    ui, phase: race.phase, time: Math.round(race.time * 10) / 10, seed, seedName: seedName(seed), level, mine, dpr,
    boats: race.boats.map((b) => ({ name: b.name, x: Math.round(b.x), z: Math.round(b.z), rescued: b.rescued, finished: b.finished >= 0 })),
    waiting: race.tinies.filter((t) => t.claimedBy < 0).length, places: standings(race).map((b) => b.name),
  };
  requestAnimationFrame(frame);
}

// ─── off we go: a sea; the line-up (or, asked, that far into the race, or its end) ───
setRace(seed);
const ff = Number(params.get('t') ?? 0);
if (preview) { start(race); ui = 'race'; document.body.classList.add('racing'); }
else if (params.get('view') === 'podium') {
  start(race); runFor(race, 1); for (let k = 0; k < 600 * 60 && race.phase !== 'done'; k++) step(race, 1 / 60); runFor(race, 30);
  race.events.length = 0; toPodium();
} else if (ff > 0) {
  // (that far in; the last few seconds with the wakes laid behind the boats, as if it had been running)
  start(race); runFor(race, Math.max(0, ff - 3));
  for (let k = 0; k < Math.min(ff, 3) * 60; k++) { step(race, 1 / 60); for (const b of race.boats) marks.wake(b.x, b.z, b.h, b.v, 1 / 60); marks.update(1 / 60); }
  race.events.length = 0; vt = race.time;
  ui = 'race'; document.body.classList.add('racing');
} else toLineup();
requestAnimationFrame(frame);

