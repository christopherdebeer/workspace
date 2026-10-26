/**
 * Rescue · Rocky Coast: the page. The line-up (choose your lifeboat and how good the others are), the race (the
 * joystick, the camera riding behind your boat, the places along the top), and the end (1st to 5th in the harbour).
 *
 * The camera: high behind your boat and a little to the side, turning with it (smoothed, so a quick turn doesn't
 * swing the world about); it leans in when you come alongside a little boat, so you can watch them climb aboard; it
 * rises over a cliff rather than look through it.
 *
 * Addresses: `?seed=` a coast; `?level=easy|medium|hard`; `?boat=0..4`; `?auto` (every boat the game's); `?t=40` that
 * far into the race; `?still` time held; `?view=podium`; `?near=n` little boat n and the boat coming for it;
 * `?weather=sunny|calm|windy|stormy|foggy|night|sunset`; `?study` a close look at your boat; `?zoom=`; `?hand=left` the joystick on the left (it's on the right unless asked); `?preview` small and quiet.
 */
import { CLEAR, GATE_HALF, GATE_Z, START_Z, groundAt, makeCoast, shoreAt, type Coast } from './coast';
import { BOATS, CLIMB, HALF_BEAM, LEVELS, LINE, VMAX, local, newRace, runFor, standings, start, step, world, type Level, type Race, type Rescue } from './race';
import { makeWorld } from './world';
import { FX, Instances, Renderer, mat4, type Draw, type Frame } from './render';
import { ROOF, ROOF_Y, SEATS, SHOULDER, WING, buoyMesh, craftMesh, deckAt, gull, lifeboat, person } from './models';
import { SEA, calmAt, heightAt } from './waves';
import { WEATHERS, WEATHER_ORDER, type Weather, type WeatherName } from './weather';
import { Marks, Wakes } from './fx';
import { Sound } from './sound';
import { Joystick } from './joystick';
import { MiniMap, clock } from './hud';

const params = new URLSearchParams(location.search);
const preview = params.has('preview'), still = params.has('still') || params.has('ref'), study = params.has('study');
const auto = params.has('auto') || preview;
const zoom = Number(params.get('zoom') ?? 1) || 1;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
if (preview || study) document.body.classList.add('preview');
if (params.get('hand') !== 'left') document.body.classList.add('hand-right');

// ─── looks (sRGB) ───
const SKINS = [[0.98, 0.82, 0.68], [0.93, 0.72, 0.55], [0.8, 0.57, 0.4], [0.62, 0.42, 0.28], [0.45, 0.3, 0.2], [0.99, 0.86, 0.74]];
const HAIRS = [[0.2, 0.13, 0.08], [0.45, 0.28, 0.12], [0.85, 0.65, 0.3], [0.1, 0.08, 0.07], [0.65, 0.25, 0.1], [0.95, 0.85, 0.55]];
const SHIRTS = [[0.9, 0.2, 0.2], [0.2, 0.5, 0.9], [0.95, 0.8, 0.2], [0.3, 0.7, 0.35], [0.9, 0.45, 0.7], [0.55, 0.35, 0.8], [0.2, 0.75, 0.8], [1, 0.55, 0.2]];
export const CRAFT_COLOURS = [[0.9, 0.15, 0.12], [0.15, 0.4, 0.85], [1, 0.8, 0.12], [0.2, 0.65, 0.3], [0.95, 0.45, 0.7], [0.12, 0.7, 0.75]];
const CREW = [1, 0.8, 0.08], NONE = [1, 1, 1];
const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const PERSON = 1.18;

// ─── the state ───
let seed = Number(params.get('seed') ?? 1 + Math.floor(Math.random() * 999)) || 1;
let level = (['easy', 'medium', 'hard'].includes(params.get('level') ?? '') ? params.get('level') : 'easy') as Level;
let mine = Math.max(0, Math.min(4, Number(params.get('boat') ?? 0) || 0));
let coast!: Coast, race!: Race;
let weather: Weather = WEATHERS.sunny;
/** the weather: the sea's height and steepness (the boats ride the same waves), the light, the air, the sounds */
function setWeather(name: WeatherName) {
  weather = WEATHERS[name] ?? WEATHERS.sunny;
  SEA.height = weather.height; SEA.chop = weather.chop;
  sound.weather(weather.wind, weather.rain);
}
let ui: 'title' | 'race' | 'podium' = 'title';
let paused = false, hornAt = -9;
const marks = new Marks(), wakes = new Wakes(), sound = new Sound();
const canvas = $('sea') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
if (!gl) { document.body.classList.add('nogl'); throw new Error('no WebGL2'); }
const renderer = new Renderer(gl);
renderer.addKind('boat', lifeboat());
renderer.addKind('crew', person('crew'), SHOULDER);
for (let s = 0; s < 3; s++) renderer.addKind('kid' + s, person('kid', s), SHOULDER);
for (const k of ['row', 'kayak', 'sail'] as const) renderer.addKind(k, craftMesh(k));
for (const k of ['red', 'green', 'yellow'] as const) renderer.addKind('buoy-' + k, buoyMesh(k));
renderer.addKind('gull', gull(), WING);
const lists: Record<string, Instances> = {};
for (const k of ['boat', 'crew', 'kid0', 'kid1', 'kid2', 'row', 'kayak', 'sail', 'buoy-red', 'buoy-green', 'buoy-yellow', 'gull']) lists[k] = new Instances(64);
const draws: Draw[] = Object.entries(lists).map(([kind, list]) => ({ kind, list }));
const stick = new Joystick($('stick'));
const minimap = new MiniMap($('map') as HTMLCanvasElement);

function newCoast(s: number) {
  seed = s; coast = makeCoast(seed);
  renderer.setCoast(coast, makeWorld(coast));
  minimap.paint(coast);
  showPath = makeShowPath();
  $('seedname').textContent = coast.name;
}
function newGame() {
  race = newRace(coast, { level, mine, auto });
  marks.clear(); wakes.clear(); stick.reset();
  poses.length = 0; camYaw = 0; told.clear();
}

// ─── poses: where each boat sits on the swell (smoothed) ───
interface Pose { y: number; pitch: number; roll: number; x: number; z: number; h: number }
const poses: Pose[] = [];
function poseOf(i: number, x: number, z: number, h: number, v: number, turn: number, t: number, dt: number): Pose {
  const k = calmAt(shoreAt(coast, x, z)), s = Math.sin(h), c = Math.cos(h);
  const at = (across: number, along: number) => heightAt(x - across * c + along * s, z + across * s + along * c, t, k);
  const bow = at(0, 4), stern = at(0, -4), port = at(-1.9, 0), star = at(1.9, 0), mid = at(0, 0);
  const want = { y: (bow + stern + port + star + mid * 2) / 6 - 0.08 + Math.min(1, Math.abs(v) / VMAX) * 0.12, pitch: Math.atan2(bow - stern, 8) * 0.8 + Math.min(1, Math.abs(v) / VMAX) * 0.07, roll: Math.atan2(port - star, 3.8) * 0.8 + turn * Math.min(1, Math.abs(v) / VMAX) * 0.14 };
  const p = poses[i];
  if (!p || dt <= 0) return (poses[i] = { ...want, x, z, h });
  const a = 1 - Math.exp(-dt * 6);
  p.y += (want.y - p.y) * a; p.pitch += (want.pitch - p.pitch) * a; p.roll += (want.roll - p.roll) * a; p.x = x; p.z = z; p.h = h;
  return p;
}
/** a point on a boat (model coordinates: x to its left, y up, z ahead) out in the world, as the shader places it */
function onBoat(p: Pose, x: number, y: number, z: number): [number, number, number] {
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll), cp = Math.cos(p.pitch), sp = Math.sin(p.pitch), cy = Math.cos(p.h), sy = Math.sin(p.h);
  let X = x * cr - y * sr, Y = x * sr + y * cr, Z = z;
  const Y2 = Y * cp + Z * sp, Z2 = -Y * sp + Z * cp; Y = Y2; Z = Z2;
  return [X * cy + Z * sy + p.x, Y + p.y, -X * sy + Z * cy + p.z];
}

// ─── the camera ───
let camYaw = 0, camDist = 26, camEl = 0.44, camLean = 0;
const camAt = { x: 0, y: 0, z: 0 };
const lens = { focus: 30, aperture: 0.4 };
let vp: Float32Array = new Float32Array(16), eye = [0, 20, -30], right = [1, 0, 0], up = [0, 1, 0];
function followed() {
  if (!auto) return race.boats[mine];
  if (params.has('boat')) return race.boats[mine];
  return standings(race)[0];
}
const nearArg = params.get('near');
function camera(dt: number, t: number, w: number, h: number) {
  const portrait = h > w, aspect = w / h;
  let target: number[], from: number[], fov = portrait ? 1.02 : 0.86, shift = 0;
  if (refCam) { target = refCam.target; from = refCam.from; fov = refCam.fov; }
  else if (ui === 'title') {
    // (low and ahead, to one side: your lifeboat charging toward you, the cliffs and the lighthouse behind it)
    const b = race.boats[mine], p = poses[b.id] ?? { y: 0 }, side = showPath.side, d = portrait ? 17 : 14;
    target = [b.x + (portrait ? side * 0.6 : -side * 1.2), p.y + 2.1, b.z + (portrait ? 0 : 1.5)];
    from = [b.x - side * (portrait ? 3.5 : 7) + Math.sin(b.h) * d, p.y + (portrait ? 4.2 : 3.4), b.z + Math.cos(b.h) * d];
    shift = portrait ? -0.18 : 0;
    fov = portrait ? 1.05 : 0.8;
  } else if (ui === 'podium') {
    const bx = coast.berths[2].x, bz = coast.berths[2].z;
    target = [bx, 3.2, bz - 1]; from = [bx - 7, 11 * zoom, bz - (portrait ? 46 : 34) * zoom];
    shift = portrait ? 0.4 : 0.22;
  } else if (study) {
    const b = followed(), p = poses[b.id] ?? { y: 0 }, a = b.h + 0.75;
    target = [b.x + Math.sin(b.h) * 1.5, p.y + 2.2, b.z + Math.cos(b.h) * 1.5]; from = [b.x + Math.sin(a) * 15 * zoom, p.y + 5.2, b.z + Math.cos(a) * 15 * zoom];
  } else {
    let b = followed();
    let k: Rescue | undefined = race.crafts.find((c) => c.by === b.id && (c.stage === 'line' || c.stage === 'climb'));
    const nearK = nearArg === null ? undefined : nearArg === 'any' ? race.crafts.find((c) => c.stage === 'climb' || c.stage === 'line') : race.crafts[Number(nearArg)];
    if (nearK) {
      const c = nearK;
      b = [...race.boats].sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
      k = c;
    }
    // (turning with the boat, smoothed; leaning in and round to watch a little boat come alongside)
    const wantLean = k ? Math.sign(local(b, k.x, k.z)[0] || 1) * 0.5 : 0;
    const a = dt > 0 ? 1 - Math.exp(-dt * 1.8) : 1;
    let dy = b.h - camYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    camYaw += dy * a; camLean += (wantLean - camLean) * a;
    const wantDist = (k ? 27 : portrait ? 40 : 33) * zoom * (preview ? 1.2 : 1), wantEl = k ? 0.34 : portrait ? 0.29 : 0.27;
    camDist += (wantDist - camDist) * a; camEl += (wantEl - camEl) * a;
    const yaw = camYaw + camLean, look = k ? 3 : 13;
    const tx = b.x + Math.sin(camYaw) * look, tz = b.z + Math.cos(camYaw) * look;
    camAt.x += (tx - camAt.x) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1); camAt.z += (tz - camAt.z) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
    target = [camAt.x, 1.5 + (poses[b.id]?.y ?? 0) * 0.6, camAt.z];
    // (rise over a cliff rather than look through it)
    let el = camEl;
    for (let tries = 0; tries < 6; tries++) {
      const ex = target[0] - Math.sin(yaw) * Math.cos(el) * camDist, ez = target[2] - Math.cos(yaw) * Math.cos(el) * camDist, ey = target[1] + Math.sin(el) * camDist;
      let blocked = false;
      for (let s = 0.25; s <= 1 && !blocked; s += 0.125) {
        const x = target[0] + (ex - target[0]) * s, z = target[2] + (ez - target[2]) * s, y = target[1] + (ey - target[1]) * s;
        const g = groundAt(coast, x, z) + (shoreAt(coast, x, z) < CLEAR ? 3 : 0);
        if (g > y - 1) blocked = true;
      }
      if (!blocked) break;
      el += 0.06;
    }
    from = [target[0] - Math.sin(yaw) * Math.cos(el) * camDist, target[1] + Math.sin(el) * camDist, target[2] - Math.cos(yaw) * Math.cos(el) * camDist];
    shift = 0.1;
  }
  eye = from;
  // (the lens: in focus where the camera looks, softening nearer and further; stronger for the still shots)
  lens.focus = refCam ? refCam.focus : ui === 'race' && !study ? Math.hypot(followed().x - from[0], followed().z - from[2]) : Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]);
  lens.aperture = refCam ? refCam.aperture : ui === 'title' ? 0.9 : ui === 'podium' ? 0.6 : study ? 0.8 : ui === 'race' && camLean !== 0 && Math.abs(camLean) > 0.2 ? 0.7 : 0.4;
  const view = mat4.lookAt(from, target, [0, 1, 0]), proj = mat4.perspective(fov, aspect, 0.5, 1800);
  proj[9] = -shift;
  vp = mat4.mul(proj, view);
  right = [view[0], view[4], view[8]]; up = [view[1], view[5], view[9]];
}

// ─── each frame: where everything is ───
const holes = new Float32Array(48), hulls = new Float32Array(24);
const told = new Set<string>();
/** the lifeboats for the sea's foam (x, z, heading, speed) */
function hullsOf() { race.boats.slice(0, 6).forEach((b, i) => hulls.set([b.x, b.z, b.h, Math.abs(b.v)], i * 4)); return Math.min(6, race.boats.length); }
function people(t: number, dt: number) {
  for (const l of Object.values(lists)) l.clear();
  // (the lifeboats, their crew, and everyone they've taken aboard)
  for (const b of race.boats) {
    const p = poseOf(b.id, b.x, b.z, b.h, b.v, b.turn, t, dt), col = BOATS[b.id].colour;
    lists.boat.push(b.x, p.y, b.z, b.h, p.pitch, p.roll, 1, 0, col, 0, NONE, 0, NONE, b.id * 1.7);
    const crewAt = (x: number, y: number, z: number, yaw: number, aL: number, aR: number, reach: number, look: number) => {
      const [X, Y, Z] = onBoat(p, x, y, z);
      lists.crew.push(X, Y, Z, b.h + yaw, p.pitch, p.roll, PERSON * 0.98, aL, CREW, aR, SKINS[(b.id * 2 + look) % 6], reach, NONE, 0);
    };
    // (two at the upper steering position, one on the aft deck to throw the line)
    const home = (b.finished !== null && b.home) || (b.id === mine && t - hornAt < 1.6), cheer = home ? Math.abs(Math.sin(t * 5 + b.id)) * 0.4 : 0;
    crewAt(0.5, ROOF_Y, 0.15, 0, home ? 2.7 + cheer : 0.25, home ? 2.7 + cheer : 0.9, home ? 0 : 1.1, 0);
    crewAt(-0.5, ROOF_Y, 0.1, 0, home ? 2.6 + cheer : 0.3, 0.2, 0, 1);
    const k = race.crafts.find((c) => c.by === b.id && (c.stage === 'line' || c.stage === 'climb'));
    if (k) {
      const side = local(b, k.x, k.z)[0] >= 0 ? -1 : 1; // (model x is to the boat's left)
      const throwing = k.stage === 'line';
      crewAt(side * 1.45, deckAt(-3.4), -3.4, side * 1.2, throwing && side > 0 ? 2.8 : 0.5, throwing && side < 0 ? 2.8 : 0.5, throwing ? 0.4 : 1.0, 2);
      // (the line: from the thrower's hand out to the little boat, thrown, then held)
      const hand = onBoat(p, side * 1.9, deckAt(-3.4) + 1.2, -3.4), kp = poses[100 + race.crafts.indexOf(k)];
      const end = [k.x, (kp?.y ?? 0) + 0.45, k.z];
      marks.line(hand, end, throwing ? 0.6 : 0.25, 0.075, [0.98, 0.8, 0.15], throwing ? Math.min(1, k.t / LINE) : 1);
    } else crewAt(0.9, deckAt(-3.6), -3.6, 0, 0.2, 0.2, 0, 2);
    // (aboard: the decks fill from aft, then forward, then the side decks; then the roof)
    b.aboard.forEach((a, i) => {
      const who = race.crafts[a.craft].craft.people[a.person];
      let x: number, z: number, y: number;
      if (i < SEATS.length) { [x, z] = SEATS[i]; x = -x; y = deckAt(z); }
      else { const r = ROOF[(i - SEATS.length) % ROOF.length]; x = -r[0]; z = r[1]; y = ROOF_Y; }
      const [X, Y, Z] = onBoat(p, x, y, z);
      const glee = home ? Math.abs(Math.sin(t * 6 + i)) : 0, wave = (t * 0.7 + i * 0.37) % 6 < 0.8;
      const arm = home ? 2.4 + glee * 0.5 : wave ? 2.5 + Math.sin(t * 12) * 0.3 : 0.15;
      lists['kid' + who.style].push(X, Y + glee * 0.15, Z, b.h + (i % 3 - 1) * 0.4, p.pitch, p.roll, PERSON * 0.92, arm, SHIRTS[who.shirt], home ? arm : 0.15, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    });
  }
  // (the little boats, and whoever's still in them; the one climbing aboard)
  let hc = 0;
  const me = race.boats[mine], fz = followed();
  const nearHoles = race.crafts.map((k, i) => [i, Math.hypot(k.x - fz.x, k.z - fz.z)] as const).filter(([i]) => race.crafts[i].craft.kind !== 'kayak').sort((a, b) => a[1] - b[1]).slice(0, 12);
  race.crafts.forEach((k, i) => {
    const kind = k.craft.kind, c = CRAFT_COLOURS[k.craft.colour];
    const s = calmAt(shoreAt(coast, k.x, k.z)), sh = Math.sin(k.yaw), ch = Math.cos(k.yaw);
    const hb = heightAt(k.x + sh * 1.4, k.z + ch * 1.4, t, s), hs = heightAt(k.x - sh * 1.4, k.z - ch * 1.4, t, s), hp = heightAt(k.x - ch * 0.7, k.z + sh * 0.7, t, s), hq = heightAt(k.x + ch * 0.7, k.z - sh * 0.7, t, s);
    const y = (hb + hs + hp + hq) / 4 + (kind === 'kayak' ? 0.12 : 0.24), pitch = Math.atan2(hb - hs, 2.8) * 0.8, roll = Math.atan2(hp - hq, 1.4) * 0.5;
    const pose = (poses[100 + i] = { x: k.x, z: k.z, h: k.yaw, y, pitch, roll });
    lists[kind].push(k.x, y, k.z, k.yaw, pitch, roll, 1, 0, c, 0, NONE, 0, NONE, i * 1.3);
    // (who's waiting: facing the nearest lifeboat; waving both arms when one's close)
    const seats = kind === 'row' ? [0.55, -0.35, -1.1] : kind === 'sail' ? [0.05, -0.95] : [-0.05];
    const ppl = k.craft.people, first = ppl.length - k.left;
    let nearB = race.boats[0], nd = 1e9;
    for (const b of race.boats) { const d = Math.hypot(b.x - k.x, b.z - k.z); if (d < nd) { nd = d; nearB = b; } }
    const face = Math.atan2(nearB.x - k.x, nearB.z - k.z);
    for (let j = first; j < ppl.length; j++) {
      const who = ppl[j], climbing = j === first && k.stage === 'climb', seatZ = seats[j % seats.length];
      const [sx, sy, sz] = onBoat(pose, 0, kind === 'kayak' ? -0.3 : -0.12, seatZ);
      if (climbing) {
        // (across to the hull, up its side, over the gunwale, to a place on deck)
        const b = race.boats[k.by], bp = poses[b.id], u = Math.min(1, k.t / CLIMB), slot = b.aboard.length;
        let dx: number, dz: number, dy: number;
        if (slot < SEATS.length) { [dx, dz] = SEATS[slot]; dx = -dx; dy = deckAt(dz); } else { const r = ROOF[(slot - SEATS.length) % ROOF.length]; dx = -r[0]; dz = r[1]; dy = ROOF_Y; }
        const [, alongK] = local(b, k.x, k.z), side = local(b, k.x, k.z)[0] >= 0 ? -1 : 1;
        const hullOut = onBoat(bp, side * (HALF_BEAM + 0.35), 0.15, Math.max(-4, Math.min(1.5, alongK)));
        const hullTop = onBoat(bp, side * (HALF_BEAM - 0.1), deckAt(alongK) + 0.2, Math.max(-4, Math.min(1.5, alongK)));
        const seat = onBoat(bp, dx, dy, dz);
        let X: number, Y: number, Z: number, aL = 2.7, aR = 2.7, reach = 0.6;
        const mix = (a: number[], b2: number[], f: number) => a.map((v, n) => v + (b2[n] - v) * f);
        if (u < 0.3) { const f = u / 0.3, q = mix([sx, sy, sz], hullOut, f); [X, Y, Z] = q; Y += Math.sin(Math.PI * f) * 0.4; reach = 1.4; aL = aR = 0.4; }
        else if (u < 0.75) { const f = (u - 0.3) / 0.45, q = mix(hullOut, hullTop, f); [X, Y, Z] = q; aL = 2.6 + Math.sin(f * 18) * 0.35; aR = 2.6 - Math.sin(f * 18) * 0.35; reach = 0.5; }
        else { const f = (u - 0.75) / 0.25, q = mix(hullTop, seat, f); [X, Y, Z] = q; Y += Math.sin(Math.PI * f) * 0.3; aL = aR = 0.6; }
        lists['kid' + who.style].push(X, Y, Z, b.h + Math.PI * (side > 0 ? 0.5 : -0.5), 0, 0, PERSON * 0.92, aL, SHIRTS[who.shirt], aR, SKINS[who.skin], reach, HAIRS[who.hair], 0);
        if (u > 0.92 && !told.has(`land${i}:${j}`)) { told.add(`land${i}:${j}`); for (let q = 0; q < 5; q++) marks.sparkle(seat[0] + (Math.random() - 0.5), seat[1] + 1.6, seat[2] + (Math.random() - 0.5), [1, 0.85, 0.3]); }
        continue;
      }
      const waving = nd < 32 && k.stage === 'wait', arm = waving ? 2.5 + Math.sin(t * 9 + j * 2) * 0.45 : 0.25 + Math.sin(t * 1.3 + j) * 0.08;
      lists['kid' + who.style].push(sx, sy, sz, face, pitch * 0.5, roll * 0.5, PERSON * 0.88, arm, SHIRTS[who.shirt], waving ? 2.5 + Math.sin(t * 9 + j * 2 + Math.PI) * 0.45 : arm, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    }
    // (the ring that says come alongside: round the little boats near you, in your colour)
    if (ui === 'race' && !auto && k.stage === 'wait' && k.left > 0 && race.boats[mine].finished === null) {
      const d = Math.hypot(k.x - me.x, k.z - me.z);
      if (d < 55) { const col = BOATS[mine].colour; marks.put(FX.RING, k.x, 0, k.z, 4.4, 0, 0, 0, col[0], col[1], col[2], Math.min(1, (55 - d) / 20) * 0.85); }
    }
  });
  for (const [i] of nearHoles) {
    const k = race.crafts[i];
    holes.set([k.x, k.z, k.yaw, k.craft.kind === 'sail' ? 1.7 : 1.52], hc * 4); hc++;
  }
  // (the buoys, bobbing)
  for (const y of coast.buoys) {
    const s = calmAt(shoreAt(coast, y.x, y.z)), h = heightAt(y.x, y.z, t, s);
    lists['buoy-' + y.kind].push(y.x, h - 0.05, y.z, 0, Math.sin(t * 1.3 + y.x) * 0.08, Math.cos(t * 1.1 + y.z) * 0.08, 1, 0, NONE, 0, NONE, 0, NONE, 0);
  }
  // (gulls, wheeling over the boat you follow)
  for (let i = 0; i < (weather.gulls ? 6 : 0); i++) {
    const a = t * (0.22 + i * 0.03) + i * 1.9, r = 16 + i * 4, cx = fz.x + Math.sin(i * 2.3) * 22, cz = fz.z + 26 + Math.cos(i * 1.7) * 30;
    const flap = Math.sin(t * 7 + i * 1.3) > -0.2 ? Math.sin(t * 9 + i) * 0.55 : 0.1;
    lists.gull.push(cx + Math.sin(a) * r, 15 + (i % 3) * 5 + Math.sin(t + i) * 1.2, cz + Math.cos(a) * r, a + Math.PI / 2, 0, Math.sin(a) * 0.2 - 0.25, 1.4, flap, NONE, flap, NONE, 0, NONE, 0);
  }
  return hc;
}

// ─── spray, foam, splashes on the rocks ───
function splashes(t: number, dt: number) {
  for (const b of race.boats) {
    wakes.record(b.id, b.x, b.z, b.h, b.v, t);
    const fast = Math.abs(b.v) / VMAX, p = poses[b.id];
    if (!p || dt <= 0) continue;
    const s = Math.sin(b.h), c = Math.cos(b.h);
    // (spray off the bow: more when going fast, most when it slams into a wave)
    const slam = Math.max(0, -p.pitch) * 6;
    const rough = 0.5 + 0.35 * weather.wind * SEA.height;
    if (fast > 0.3 && Math.random() < dt * (30 * fast + 60 * slam) * rough) for (const side of [-1, 1]) {
      const x = b.x + s * 4.3 - side * c * 1.2, z = b.z + c * 4.3 + side * s * 1.2;
      marks.spray(x, p.y + 0.4, z, -side * c * (2 + Math.random() * 3) + s * b.v * 0.5, 2 + Math.random() * 3 + slam * 3, side * s * (2 + Math.random() * 3) + c * b.v * 0.5, 0.25 + Math.random() * 0.3);
    }
    if (fast > 0.15 && Math.random() < dt * 25 * fast) for (const side of [-1, 1]) marks.foam(b.x + s * 3 - side * c * 2.3, b.z + c * 3 + side * s * 2.3, -side * c * 2.5, side * s * 2.5, 0.8 + Math.random() * 0.8, 1.4, 0.7);
  }
  // (the surf: bursts where a crest meets the rocks, near the camera)
  const S = coast.surf, n = S.length / 4;
  for (let q = 0; q < 24; q++) {
    const i = Math.floor(Math.random() * n), x = S[i * 4], z = S[i * 4 + 1];
    if (Math.abs(x - eye[0]) > 120 || Math.abs(z - eye[2]) > 160) continue;
    const h = heightAt(x, z, t, 1);
    if (h > 0.4 * SEA.height && Math.random() < dt * 30 * (0.5 + 0.5 * weather.wind)) {
      const nx = S[i * 4 + 2], nz = S[i * 4 + 3];
      for (let k = 0; k < 8; k++) marks.spray(x, 0.3, z, nx * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2, 3 + Math.random() * 4, nz * (1 + Math.random() * 2) + (Math.random() - 0.5) * 2, 0.18 + Math.random() * 0.3, 0.9);
      marks.foam(x + nx * 1.5, z + nz * 1.5, nx, nz, 2.2, 1.6, 0.8);
    }
  }
}

// ─── the air: rain, lightning, the lighthouses' beams, your searchlight ───
let flash = 0, nextBolt = 6, nextHorn = 8;
const spotAt = [0, 0, 0, 0], spotDir = [0, -1, 0];
function atmosphere(t: number, dt: number) {
  const fb = followed(), cx = camAt.x, cz = camAt.z;
  // (rain: streaks falling past the camera, slanted by the wind)
  if (weather.rain > 0) {
    const slant = weather.wind * 0.9;
    for (let i = 0; i < 420; i++) {
      const x = cx + ((i * 0.6180339) % 1 - 0.5) * 70 + Math.sin(i) * 3, z = cz - 20 + ((i * 0.3819660) % 1 - 0.5) * 80;
      const y = 22 - ((t * 17 + i * 7.31) % 22);
      marks.put(FX.LINE, x, y, z, 0.014, x - slant * 0.05, y - 0.8, z + slant * 0.03, 0.85, 0.88, 0.92, 0.22 * weather.rain);
    }
  }
  // (lightning: a flash, a flicker, thunder after)
  if (weather.lightning && dt > 0) {
    nextBolt -= dt;
    if (nextBolt <= 0) { flash = 1; nextBolt = 7 + Math.random() * 12; setTimeout(() => sound.thunder(), 500 + Math.random() * 1500); }
    flash *= Math.exp(-dt * 7);
    if (flash > 0.2 && flash < 0.35 && Math.random() < 0.3) flash = 0.7;
  } else flash = 0;
  // (a foghorn now and then, in the fog)
  if (weather.name === 'foggy' && ui === 'race' && dt > 0) { nextHorn -= dt; if (nextHorn <= 0) { sound.foghorn(); nextHorn = 22 + Math.random() * 10; } }
  // (the lighthouses' beams, turning, when it's dark or thick)
  if (weather.dark > 0.3) {
    let k = 0;
    for (const p of coast.props) if (p.kind === 'lighthouse') {
      if (Math.hypot(p.x - eye[0], p.z - eye[2]) > 650) continue;
      const small = p.v >= 2, y = p.y + ((small ? 7 : 12) + 1.3) * p.s, a = t * 0.75 + k++ * 1.7;
      for (const turn of [0, Math.PI]) {
        const dx = Math.sin(a + turn), dz = Math.cos(a + turn), L = small ? 45 : 80;
        marks.put(FX.BEAM, p.x, y, p.z, small ? 5 : 9, p.x + dx * L, y - 1.5, p.z + dz * L, 1, 0.9, 0.62, 0.3 * weather.dark);
      }
    }
  }
  // (your searchlight: on when it's dark, lighting the water ahead)
  const on = Math.max(0, Math.min(1, (weather.dark - 0.3) / 0.4));
  const p = poses[fb.id];
  if (on > 0 && p) {
    const lamp = onBoat(p, -0.9, ROOF_Y + 0.5, 0.8), pitch = -0.2;
    spotAt[0] = lamp[0]; spotAt[1] = lamp[1]; spotAt[2] = lamp[2]; spotAt[3] = on;
    spotDir[0] = Math.sin(fb.h) * Math.cos(pitch); spotDir[1] = Math.sin(pitch); spotDir[2] = Math.cos(fb.h) * Math.cos(pitch);
    marks.put(FX.BEAM, lamp[0], lamp[1], lamp[2], 5, lamp[0] + spotDir[0] * 32, lamp[1] + spotDir[1] * 32, lamp[2] + spotDir[2] * 32, 1, 0.95, 0.8, 0.16 * on);
  } else spotAt[3] = 0;
}

// ─── the title's hero shot: your lifeboat charging along off the lighthouse's headland ───
let showPath = { x: (z: number) => z * 0, z0: 0, z1: 1, side: 1 };
function makeShowPath() {
  const lh = coast.props.find((p) => p.kind === 'lighthouse' && p.v === 0) ?? coast.props.find((p) => p.kind === 'lighthouse')!;
  const side = Math.sign(lh.x - coast.centre(lh.z)) || 1;
  // (a line about thirty metres off the rocks on the lighthouse's side, running north from it)
  const x = (z: number) => { let xx = coast.centre(z); for (let i = 0; i < 80 && shoreAt(coast, xx + side * 2, z) > 30; i++) xx += side * 2; return xx; };
  return { x, z0: lh.z + 20, z1: lh.z + 170, side };
}
function showcase(t: number) {
  const b = race.boats[mine], span = showPath.z1 - showPath.z0, v = 8.5;
  const z = showPath.z0 + ((t * v) % span), x = showPath.x(z) + 4 * Math.sin(t * 0.25);
  const ahead = showPath.x(z + 6) + 4 * Math.sin((t + 0.7) * 0.25);
  if (Math.abs(z - b.z) > 20) wakes.clear();
  b.x = x; b.z = z; b.h = Math.atan2(ahead - x, 6); b.v = v; b.turn = 0;
}

// ─── what's said on the screen ───
const $count = $('count'), bar = $('bar'), bubbleEl = $('bubble'), arrows = $('arrows');
let shownCount = -1, hudAt = 0, note = { text: '', until: 0 };
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
/** say something in the bubble for a while (it gives way to nothing more pressing) */
function bubble(text: string, secs = 2.6) { note = { text, until: performance.now() / 1000 + secs }; }
function hud(t: number) {
  if (ui !== 'race') return;
  const st = standings(race), me = race.boats[mine], place = st.findIndex((b) => b.id === mine);
  // (the map: every frame, it turns with you)
  const dots: [number, number, string, number][] = race.crafts.filter((c) => c.stage === 'wait' && c.left > 0).map((c) => [c.x, c.z, css(CRAFT_COLOURS[c.craft.colour]), c.left]);
  const fb = auto ? followed() : me;
  minimap.draw(fb.x, fb.z, camYaw, dots, race.boats.map((b) => [b.x, b.z, b.h, css(BOATS[b.id].colour), b.id === fb.id]), coast.gateX);
  if (t - hudAt < 0.1) return;
  hudAt = t;
  if (fb.rescued !== shownCount) { if (shownCount >= 0) { $('stat-count').classList.add('bump'); setTimeout(() => $('stat-count').classList.remove('bump'), 160); } shownCount = fb.rescued; $count.textContent = String(fb.rescued); }
  $('place').textContent = ORD[auto ? 0 : place];
  // (the clock: the race's time; in the last call, the time left, in red)
  const timeEl = $('stat-time');
  if (race.lastCall && me.finished === null) { const left = race.lastCall.start + race.lastCall.length - race.t; $('clock').textContent = clock(left); timeEl.classList.add('hurry'); }
  else { $('clock').textContent = clock(race.t); timeEl.classList.remove('hurry'); }
  $('ladder').innerHTML = st.map((b, i) => `<div class="glass${b.id === fb.id ? ' me' : ''}"><small>${ORD[i]}</small><i style="background:${css(BOATS[b.id].colour)}"></i>${b.rescued}</div>`).join('');
  // (coming aboard: a lifebuoy and a bar that fills)
  const k = race.crafts.find((c) => c.by === fb.id && (c.stage === 'line' || c.stage === 'climb'));
  if (k) {
    const total = k.craft.people.length, done = total - k.left, f = (done + (k.stage === 'climb' ? k.t / CLIMB : 0)) / total;
    bar.classList.add('on'); (bar.querySelector('i') as HTMLElement).style.width = `${f * 100}%`; (bar.querySelectorAll('span')[1] as HTMLElement).textContent = `${done} of ${total} aboard`;
  } else bar.classList.remove('on');
  // (the bubble: what's happening now, else what to do next)
  let text = '';
  const now = performance.now() / 1000;
  if (now < note.until) text = note.text;
  else if (!auto && me.finished === null) {
    const slow = LEVELS[race.level].slow;
    if (race.phase === 'countdown') text = 'Get ready…';
    else if (race.t < 5) text = 'Push the stick to go!';
    else if (k) text = k.stage === 'line' ? 'Line away!' : 'Climbing aboard — hold still!';
    else if (race.crafts.some((c) => c.stage === 'wait' && c.left > 0 && Math.hypot(c.x - me.x, c.z - me.z) < 11 && Math.abs(me.v) > slow)) text = 'Slow down — let go of the stick!';
    else if (race.lastCall) text = 'Last call! Head for the harbour!';
    else if (race.t < 14) text = 'Find the little boats!';
  }
  if (text) bubbleEl.textContent = text;
  bubbleEl.classList.toggle('on', !!text);
  // (arrows at the edge to the nearest little boats out of sight; to the finish in the last call)
  const W = innerWidth, H = innerHeight, want: { x: number; z: number; n: number; fin?: boolean; col: number[] }[] = [];
  if (me.finished === null && !auto) {
    const waiting = race.crafts.filter((c) => c.stage === 'wait' && c.left > 0).map((c) => ({ c, d: Math.hypot(c.x - me.x, c.z - me.z) })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { c } of waiting) want.push({ x: c.x, z: c.z, n: c.left, col: CRAFT_COLOURS[c.craft.colour] });
    if (race.lastCall || !waiting.length) want.push({ x: coast.gateX, z: GATE_Z, n: 0, fin: true, col: [1, 1, 1] });
  }
  const html: string[] = [];
  for (const w of want) {
    const q = [w.x, 1, w.z, 1], cx = vp[0] * q[0] + vp[4] * q[1] + vp[8] * q[2] + vp[12], cy = vp[1] * q[0] + vp[5] * q[1] + vp[9] * q[2] + vp[13], cw = vp[3] * q[0] + vp[7] * q[1] + vp[11] * q[2] + vp[15];
    let sx = cx / cw, sy = cy / cw;
    if (cw > 0 && Math.abs(sx) < 0.95 && Math.abs(sy) < 0.9) continue;
    if (cw < 0) { sx = -sx; sy = -sy; }
    const m = Math.max(Math.abs(sx) / 0.84, Math.abs(sy) / 0.6), px = ((sx / m) * 0.5 + 0.5) * W, py = (0.5 - (sy / m) * 0.5) * H, ang = Math.atan2(-sy, sx);
    html.push(`<div class="arrow${w.fin ? ' fin' : ''}" style="transform:translate(${px}px,${py}px)"><span style="transform:rotate(${ang}rad) translateX(22px)"></span><b style="background:${css(w.col)}">${w.fin ? '' : w.n}</b></div>`);
  }
  arrows.innerHTML = html.join('');
}
function say(text: string, long = false) {
  const el = $('big'); el.textContent = text; el.classList.remove('on', 'long'); void el.offsetWidth; el.classList.add('on'); if (long) el.classList.add('long');
}

// ─── the title, its panels; the race; the end ───
function boatSvg(c: readonly number[]) {
  return `<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M8 44 L114 40 Q112 52 100 60 L22 61 Q12 56 8 44 Z" fill="#0d1d4c"/><path d="M13 55 L104 55 Q102 59 98 61 L22 61 Q16 59 13 55 Z" fill="#c0180f"/><path d="M8 44 L114 40" stroke="${css(c)}" stroke-width="4" stroke-linecap="round"/><rect x="36" y="22" width="38" height="20" rx="5" fill="${css(c)}"/><rect x="40" y="26" width="30" height="7" rx="2" fill="#1a2733"/><rect x="38" y="19" width="34" height="4" rx="2" fill="#eee"/><path d="M48 19 L52 2 L58 2 L62 19" stroke="#111" stroke-width="3" fill="none" stroke-linejoin="round"/><rect x="44" y="6" width="22" height="3" fill="#111"/><circle cx="55" cy="1.8" r="2" fill="#4a8cff"/><text x="80" y="51" font-size="8" font-weight="800" fill="#fff" font-family="system-ui">RNLI</text><circle cx="28" cy="30" r="4" fill="none" stroke="#f4561c" stroke-width="2.5"/></svg>`;
}
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* (private window: no keeping) */ } } };
const bests = (): Record<string, number> => { try { return JSON.parse(store.get('lily-rescue-boats-best') ?? '{}'); } catch { return {}; } };
function panel(name: '' | 'boats' | 'weather' | 'settings') {
  document.body.classList.remove('panel-boats', 'panel-weather', 'panel-settings');
  if (name) document.body.classList.add('panel-' + name);
  refreshTitle();
}
function refreshTitle() {
  const B = BOATS[mine], best = bests()[mine] ?? 0;
  $('chosen').innerHTML = `<span class="tag"><span class="dot" style="background:${css(B.colour)}"></span><b>${B.name}</b></span><span class="tag">${weather.icon} ${weather.label} · ${level}</span><span class="tag">${coast.name}</span>`;
  $('weather-icon').textContent = weather.icon;
  $('boat-show').innerHTML = `${boatSvg(B.colour)}<b>${B.name}</b><small>all-weather lifeboat · ${best ? `your best: ${best} rescued` : 'not raced yet'}</small>`;
  $('boats-list').innerHTML = BOATS.map((b, i) => `<button data-boat="${i}" class="${i === mine ? 'on' : ''}">${boatSvg(b.colour)}${b.name}</button>`).join('');
  for (const el of document.querySelectorAll<HTMLElement>('#boats-list button')) el.onclick = () => chooseBoat(Number(el.dataset.boat));
  const g = (c: readonly number[]) => css(c);
  $('weather-list').innerHTML = WEATHER_ORDER.map((n) => { const w = WEATHERS[n]; return `<button data-weather="${n}" class="${n === weather.name ? 'on' : ''}" style="background:linear-gradient(${g(w.skyTop)}, ${g(w.skyHorizon)} 55%, ${g(w.body)} 56%, ${g(w.deep)})"><span>${w.icon}</span>${w.label}</button>`; }).join('');
  for (const el of document.querySelectorAll<HTMLElement>('#weather-list button')) el.onclick = () => { setWeather(el.dataset.weather as WeatherName); refreshTitle(); };
  for (const el of document.querySelectorAll<HTMLElement>('#levels button')) { el.classList.toggle('on', el.dataset.level === level); el.onclick = () => { level = el.dataset.level as Level; refreshTitle(); }; }
  const right = document.body.classList.contains('hand-right');
  for (const el of document.querySelectorAll<HTMLElement>('#hands button')) { el.classList.toggle('on', (el.dataset.hand === 'right') === right); el.onclick = () => { document.body.classList.toggle('hand-right', el.dataset.hand === 'right'); refreshTitle(); }; }
  $('sound').textContent = sound.on ? 'on' : 'off';
}
function chooseBoat(i: number) { mine = (i + 5) % 5; newGame(); refreshTitle(); }
function title() {
  ui = 'title'; paused = false;
  document.body.classList.remove('racing', 'podium', 'paused'); document.body.classList.add('title');
  newGame(); panel('');
  sound.quiet();
}
function go() {
  if (ui !== 'title' && ui !== 'podium') return;
  sound.wake(); sound.horn();
  ui = 'race'; paused = false; snapUrl = '';
  document.body.classList.remove('title', 'podium', 'paused', 'panel-boats', 'panel-weather', 'panel-settings'); document.body.classList.add('racing');
  newGame(); start(race); shownCount = -1; lastCount = 4;
  camYaw = race.boats[mine].h; camAt.x = race.boats[mine].x; camAt.z = race.boats[mine].z;
}
const STAR = (on: boolean, d: number) => `<svg viewBox="0 0 48 48" class="pop ${on ? '' : 'off'}" style="animation-delay:${d}s"><path d="M24 3 L30 17 L45 18 L33.5 28 L37 43 L24 35 L11 43 L14.5 28 L3 18 L18 17 Z" fill="${on ? '#ffc83a' : '#ccc'}" stroke="#d48a00" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
function podium() {
  ui = 'podium'; paused = false;
  document.body.classList.remove('racing', 'paused'); document.body.classList.add('podium');
  const st = standings(race), place = st.findIndex((b) => b.id === mine), me = race.boats[mine];
  // (everyone in at the quay, 1st in the middle, the rest out to either side)
  const order = [2, 1, 3, 0, 4];
  st.forEach((b, i) => { const berth = coast.berths[order[i]]; b.x = berth.x; b.z = berth.z; b.h = berth.h; b.v = 0; b.home = b.finished !== null; });
  poses.length = 0;
  const stars = auto ? 3 : place === 0 ? 3 : place < 3 ? 2 : 1;
  $('result').textContent = auto ? `${BOATS[st[0].id].name} wins!` : place === 0 ? 'You won!' : `You came ${ORD[place]}!`;
  $('stars').innerHTML = [0, 1, 2].map((i) => STAR(i < stars, 0.2 + i * 0.2)).join('');
  $('ranks').innerHTML = st.map((b, i) => `<li class="p${i + 1}${b.id === mine && !auto ? ' me' : ''}"><b>${ORD[i]}</b><i style="background:${css(BOATS[b.id].colour)}"></i><span>${BOATS[b.id].name}<small>${b.finished === null ? 'not home' : 'rescued'}</small></span><strong>${b.rescued}</strong></li>`).join('');
  const who = auto ? st[0] : me;
  $('snapcap').textContent = `${who.rescued} rescued!`;
  if (!snapUrl) snapWanted = true; else ($('snap') as HTMLImageElement).src = snapUrl;
  if (!auto) {
    const b = bests(), was = b[mine] ?? 0;
    if (me.rescued > was) { b[mine] = me.rescued; store.set('lily-rescue-boats-best', JSON.stringify(b)); }
    $('best').textContent = me.rescued > was && was > 0 ? `A new best for ${BOATS[mine].name}!` : `${BOATS[mine].name}'s best: ${Math.max(was, me.rescued)} rescued`;
  } else $('best').textContent = '';
  sound.quiet(); sound.tune(place);
}
$('play').onclick = go;
$('open-boats').onclick = () => panel('boats');
$('open-weather').onclick = () => panel('weather');
$('open-settings').onclick = () => panel('settings');
for (const el of document.querySelectorAll<HTMLElement>('[data-close]')) el.onclick = () => panel('');
$('boat-prev').onclick = () => chooseBoat(mine - 1);
$('boat-next').onclick = () => chooseBoat(mine + 1);
addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && ui === 'title' && !document.body.className.includes('panel-')) { e.preventDefault(); go(); }
  if (e.key === 'Escape' && ui === 'race') pause(!paused);
});
$('again').onclick = () => go();
$('next').onclick = () => { newCoast(1 + Math.floor(Math.random() * 999)); go(); };
$('tomenu').onclick = () => title();
$('newsea').onclick = () => { newCoast(1 + Math.floor(Math.random() * 999)); newGame(); refreshTitle(); };
$('sound').onclick = () => { sound.toggle(); refreshTitle(); };
function pause(on: boolean) { paused = on; document.body.classList.toggle('paused', on); if (on) sound.quiet(); }
$('pause').onclick = () => pause(true);
$('resume').onclick = () => pause(false);
$('restart').onclick = () => go();
$('quit').onclick = () => title();
$('horn').onclick = () => { sound.wake(); sound.horn(); hornAt = vt; };

// ─── events from the race: sounds, words, marks ───
let lastCount = 4, snapWanted = false, snapUrl = '';
function events() {
  for (const e of race.events.splice(0)) {
    if (e.kind === 'go') { say('Go!'); sound.horn(); }
    else if (e.kind === 'line') { if (e.boat === mine) sound.splash(); const k = race.crafts[e.craft]; for (let q = 0; q < 6; q++) marks.spray(k.x, 0.4, k.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.3); }
    else if (e.kind === 'aboard') { if (e.boat === mine) sound.aboard(race.boats[mine].rescued); }
    else if (e.kind === 'clear') { if (e.boat === mine && !auto) bubble(`All aboard! ${race.crafts[e.craft].craft.people.length} rescued`); }
    else if (e.kind === 'letgo') { if (e.boat === mine && !auto) bubble('Come back — they’re still waiting!'); }
    else if (e.kind === 'bump') { if (e.boat === mine) sound.bump(); }
    else if (e.kind === 'finish') { if (e.boat === mine && !auto) { const f = $('finishflag'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); snapWanted = true; bubble(`${ORD[e.place - 1]} home!`, 3); } }
    else if (e.kind === 'lastcall') { sound.bell(); if (!auto && race.boats[mine].finished === null) { say('Last call!', true); bubble('Last call! Head for the harbour!', 4); } }
    else if (e.kind === 'over') setTimeout(() => { if (ui === 'race') podium(); }, 2500);
  }
}

// ─── the loop ───
let dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1), slowFor = 0, fastFor = 0, ema = 16;
function resize() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
addEventListener('resize', resize);
let last = performance.now(), vt = 0, frames = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frames++;
  ema += (dt * 1000 - ema) * 0.05;
  // (keep it smooth: fewer pixels when frames are slow, more when there's room)
  if (!still && !preview) {
    if (ema > 24) { slowFor += dt; fastFor = 0; } else if (ema < 15) { fastFor += dt; slowFor = 0; } else { slowFor = fastFor = 0; }
    const cap = Math.min(devicePixelRatio || 1, 1.75);
    if (slowFor > 1.5 && dpr > 0.8) { dpr = Math.max(0.8, dpr - 0.15); resize(); slowFor = 0; }
    if (fastFor > 4 && dpr < cap) { dpr = Math.min(cap, dpr + 0.15); resize(); fastFor = 0; }
  }
  if (!still) vt += dt;
  if (ui === 'title') { showcase(vt); for (const b of race.boats) wakes.record(b.id, b.x, b.z, b.h, b.v, vt); marks.step(dt); splashes(vt, dt); }
  else if (ui === 'race' && paused) marks.step(0);
  else if (ui === 'race' && !still) {
    if (race.phase === 'countdown' && Math.ceil(race.count) < lastCount && race.count > 0) { lastCount = Math.ceil(race.count); say(String(lastCount)); sound.beep(); }
    const inp = stick.read();
    step(race, dt, inp);
    if (!auto && race.boats[mine].finished === null) sound.throttle(Math.max(0, inp.throttle));
    events();
    marks.step(dt);
    splashes(vt, dt);
  } else if (ui === 'podium') { marks.step(dt); if (!still) for (const b of race.boats) wakes.record(b.id, b.x, b.z, b.h, b.v, vt); }
  else marks.step(0);
  const t = vt;
  camera(still ? 0 : dt, t, canvas.width, canvas.height);
  const hc = people(t, still ? 0 : dt);
  atmosphere(t, still ? 0 : dt);
  wakes.build(vt);
  hud(t);
  const fb = followed();
  const f: Frame = {
    vp, eye, time: t, right, up, near: 0.5, far: 1800, focusDist: lens.focus, aperture: lens.aperture,
    zMin: Math.min(eye[2], fb.z) - 160 - 400 * Math.max(0, -Math.cos(camYaw)), zMax: Math.max(eye[2], fb.z) + 160 + 700 * Math.max(0, Math.cos(camYaw)),
    focus: ui === 'podium' ? [coast.berths[2].x, coast.berths[2].z - 30] : [fb.x, fb.z], draws, wakes: wakes.data, wakeCount: wakes.count, fx: marks.data, fxCount: marks.count, holes, holeCount: hc, hulls, hullCount: hullsOf(),
    weather, flash, spot: spotAt, spotDir,
  };
  if (ui === 'title') { f.zMin = showPath.z0 - 400; f.zMax = showPath.z1 + 400; }
  if (ui === 'podium') { f.zMin = GATE_Z - 200; f.zMax = GATE_Z + 400; }
  renderer.draw(f, canvas.width, canvas.height);
  // (a picture for the end: taken the moment you cross the line, while the frame's still there to read)
  if (snapWanted) { snapWanted = false; try { snapUrl = canvas.toDataURL('image/jpeg', 0.82); ($('snap') as HTMLImageElement).src = snapUrl; } catch { /* (no picture, then) */ } }
  (window as unknown as { __rescue: unknown }).__rescue = {
    variant: 'coast', ui, paused, phase: race.phase, seed, weather: weather.name, name: coast.name, mine, level, t: race.t, auto, dpr, frameMs: ema,
    stick: { x: stick.x, y: stick.y, held: stick.held },
    boats: race.boats.map((b) => ({ x: b.x, z: b.z, h: b.h, v: b.v, rescued: b.rescued, finished: b.finished, home: b.home })),
    boarding: race.crafts.filter((k) => k.stage === 'line' || k.stage === 'climb').map((k) => ({ craft: k.craft.id, by: k.by, stage: k.stage })),
  };
  requestAnimationFrame(frame);
}

// ─── reference scenes: one fixed frame each, composed like the target studies, to judge the drawing by ───
let refCam: { from: number[]; target: number[]; fov: number; aperture: number; focus: number } | null = null;
const refArg = params.get('ref');
function refScene(kind: string) {
  document.body.classList.add('preview');
  ui = 'race'; document.body.classList.remove('title'); document.body.classList.add('racing');
  newGame(); race.phase = 'racing';
  const G = { x: coast.gateX, z: GATE_Z }, me = race.boats[mine];
  // (somewhere in open water near where it's wanted)
  const wet = (x: number, z: number, m = 8): [number, number] => { for (let i = 0; i < 40 && shoreAt(coast, x, z) < m; i++) x += (coast.centre(z) - x) * 0.15; return [x, z]; };
  const place = (b: { x: number; z: number; h: number; v: number }, x: number, z: number, h: number, v: number) => { [b.x, b.z] = wet(x, z, 10); b.h = h; b.v = v; };
  vt = 12;
  if (kind === 'rescue') {
    place(me, G.x, G.z - 230, 0.35, 0);
    const k = race.crafts[0], side = -1;
    me.aboard = [{ craft: 1, person: 0 }, { craft: 2, person: 0 }, { craft: 3, person: 0 }].filter((a) => race.crafts[a.craft]);
    me.rescued = me.aboard.length;
    const [kx, kz] = world(me, side * (HALF_BEAM + 1.25), -1.6);
    k.x = kx; k.z = kz; k.yaw = me.h; k.stage = 'climb'; k.by = mine; k.side = side; k.t = 0.42 * CLIMB;
    if (k.craft.people.length < 2) k.craft.people.push({ ...k.craft.people[0], skin: (k.craft.people[0].skin + 2) % 6, hair: 2, style: 1 }), k.left = k.craft.people.length;
    k.left = k.craft.people.length;
    for (const o of race.boats) if (o !== me) place(o, G.x + (o.id - 2) * 30, G.z - 120 - o.id * 12, 0.1, 6);
    const at = world(me, side * 9.5, -5.5), look = world(me, side * 2.6, -1.4);
    refCam = { from: [at[0], 2.4, at[1]], target: [look[0], 1.1, look[1]], fov: 0.62, aperture: 0.5, focus: 9 };
  } else {
    place(me, G.x - 3, G.z - 172, 0.04, 8);
    const others = race.boats.filter((o) => o !== me), spots = [[22, -122, -0.15], [-24, -96, 0.12], [6, -70, 0], [-10, -142, 0.22]];
    others.forEach((o, i) => place(o, G.x + spots[i][0], G.z + spots[i][1], spots[i][2], 7));
    const where = [[-19, -150], [16, -153], [-30, -128], [27, -138], [-12, -110], [14, -100], [31, -162]];
    race.crafts.forEach((k, i) => {
      if (i < where.length) { [k.x, k.z] = wet(G.x + where[i][0], G.z + where[i][1], 12); k.yaw = 1.3 * i; }
      else if (k.z > G.z - 320) k.z -= 450;
    });
    const back = 23, from = [me.x - Math.sin(me.h) * back + 2, 9.5, me.z - Math.cos(me.h) * back];
    refCam = { from, target: [me.x + Math.sin(me.h) * 26, 0.5, me.z + Math.cos(me.h) * 26], fov: 0.72, aperture: 0.5, focus: 25 };
  }
  // (their wakes and spray, as if they'd been going a while)
  for (const b of race.boats) if (b.v > 0) for (let s = -5.5; s <= 0; s += 0.08) wakes.record(b.id, b.x + Math.sin(b.h) * b.v * s, b.z + Math.cos(b.h) * b.v * s, b.h, b.v, vt + s);
  for (let i = 0; i < 40; i++) { people(vt - (40 - i) / 30, 1 / 30); splashes(vt - (40 - i) / 30, 1 / 30); marks.step(1 / 30); }
}

// ─── start ───
setWeather((params.get('weather') ?? 'sunny') as WeatherName);
newCoast(seed);
title();
const panelArg = params.get('panel');
if (refArg) refScene(refArg);
if (panelArg === 'boats' || panelArg === 'weather' || panelArg === 'settings') panel(panelArg);
if (!refArg && (auto || params.has('t') || params.get('view') === 'podium' || study)) {
  ui = 'race'; document.body.classList.remove('title'); document.body.classList.add('racing');
  newGame(); start(race);
  const T = params.get('view') === 'podium' ? 1e9 : Number(params.get('t') ?? 0);
  if (T > 0) {
    // (run the race on to that moment, keeping the last few seconds of wake)
    for (let s = 0; s < T + 3 && race.phase !== 'over'; s += 1 / 30) {
      step(race, 1 / 30, {});
      if (s > T + 3 - 6) for (const b of race.boats) wakes.record(b.id, b.x, b.z, b.h, b.v, s);
      // (and the last moment's spray, so a held frame has it)
      if (s > T + 3 - 1.2) { people(s, 1 / 30); splashes(s, 1 / 30); marks.step(1 / 30); }
    }
    vt = T + 3;
    race.events.length = 0;
    camYaw = followed().h; camAt.x = followed().x + Math.sin(camYaw) * 9; camAt.z = followed().z + Math.cos(camYaw) * 9;
    if (race.phase === 'over' || params.get('view') === 'podium') { runFor(race, 400); podium(); }
  } else { camYaw = 0; camAt.x = race.boats[mine].x; camAt.z = race.boats[mine].z + 9; }
}
resize();
requestAnimationFrame(frame);
