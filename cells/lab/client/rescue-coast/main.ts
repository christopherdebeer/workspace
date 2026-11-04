/**
 * Rescue · Rocky Coast: the page. The title (Play: the Rescue Service; Rally: Lily's race; your lifeboat, the weather,
 * how good the other crews are), out on the water (the joystick, the camera riding behind your boat, the counts along
 * the top), and the end (everyone home and the crews' honours; or 1st to 5th).
 *
 * The camera: low and close behind your boat, the coast ahead on the horizon, turning with it (smoothed, so a quick
 * turn doesn't swing the world about); easing down and round as you slow for someone waiting; cutting in low beside the
 * hull while a little boat is alongside, to watch them climb aboard; rising over a cliff rather than look through it.
 * (The Service: while the count goes down, a look over the pier at the crews moored in the harbour first.)
 *
 * The Service's day on the page: its own coast (rebuilt when you switch to the Rally and back), the calls on the radio,
 * the weather as the race has it (blended, the coastguard warning of each change), and the town on the
 * pier: a few to see the crews off, joined by everyone they land.
 *
 * Addresses: `?seed=` a coast; `?level=easy|medium|hard`; `?boat=0..4`; `?auto` (every boat the game's); `?t=40` that
 * far into the race; `?still` time held; `?view=podium`; `?near=n` little boat n and the boat coming for it;
 * `?mode=rally` the Rally; `?at=` the title's clock (seconds round its loop); `?weather=sunny|calm|windy|stormy|foggy|night|sunset`; `?study` a close look at your boat; `?zoom=`; `?hand=touch|left|right` where you steer from (wherever you touch unless asked, or a stick in a bottom corner); `?preview` small and quiet.
 */
import { CLEAR, GATE_HALF, GATE_Z, START_Z, groundAt, makeCoast, mooring, seaAt, seaward, shoreAt, type Coast, type CoastKind } from './coast';
import { BOATS, CLIMB, HALF_BEAM, HALF_LEN, HELP, KINDS, LEVELS, LINE, VMAX, everyoneAboard, insideHome, local, newRace, runFor, serviceCrews, standings, start, step, world, type BoatKind, type Level, type Mode, type Race, type Rescue } from './race';
import { makeWorld } from './world';
import { FX, Instances, Renderer, mat4, type Draw, type Frame } from './render';
import { LAYOUTS, SHOULDER, WING, buoyMesh, craftMesh, gull, inshore, launch, lifeboat, person } from './models';
import { SEA, heightAt } from './waves';
import { WEATHERS, WEATHER_ORDER, voyage, weatherAt, type Weather, type WeatherName } from './weather';
import { Marks, Wakes } from './fx';
import { Sound } from './sound';
import { Joystick, type Steer } from './joystick';
import { MiniMap, clock } from './hud';

const params = new URLSearchParams(location.search);
const preview = params.has('preview'), still = params.has('still') || params.has('ref'), study = params.has('study');
let auto = params.has('auto') || preview;
const zoom = Number(params.get('zoom') ?? 1) || 1;
const $ = (id: string) => document.getElementById(id) as HTMLElement;
if (preview || study) document.body.classList.add('preview');

// ─── looks (sRGB) ───
const SKINS = [[0.98, 0.82, 0.68], [0.93, 0.72, 0.55], [0.8, 0.57, 0.4], [0.62, 0.42, 0.28], [0.45, 0.3, 0.2], [0.99, 0.86, 0.74]];
const HAIRS = [[0.2, 0.13, 0.08], [0.45, 0.28, 0.12], [0.85, 0.65, 0.3], [0.1, 0.08, 0.07], [0.65, 0.25, 0.1], [0.95, 0.85, 0.55]];
const SHIRTS = [[0.9, 0.2, 0.2], [0.2, 0.5, 0.9], [0.95, 0.8, 0.2], [0.3, 0.7, 0.35], [0.9, 0.45, 0.7], [0.55, 0.35, 0.8], [0.2, 0.75, 0.8], [1, 0.55, 0.2]];
export const CRAFT_COLOURS = [[0.9, 0.15, 0.12], [0.15, 0.4, 0.85], [1, 0.8, 0.12], [0.2, 0.65, 0.3], [0.95, 0.45, 0.7], [0.12, 0.7, 0.75]];
const CREW = [1, 0.8, 0.08], NONE = [1, 1, 1];
/** how high each kind of little boat sits on the water */
const FLOAT = { row: 0.24, sail: 0.24, kayak: 0.12, paddle: 0.05, yacht: 0.3, fishing: 0.28 } as const;
/** (the Service) a few from the town on the quay, seeing the crews off */
const TOWNSFOLK = [[1, 0, 5, 1], [3, 3, 1, 0], [0, 2, 7, 2], [4, 1, 2, 1], [2, 5, 0, 0], [5, 0, 3, 2], [0, 4, 6, 1]].map(([skin, hair, shirt, style]) => ({ skin, hair, shirt, style }));
const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const PERSON = 1.18;

// ─── the state ───
let seed = Number(params.get('seed') ?? 1 + Math.floor(Math.random() * 999)) || 1;
let level = (['easy', 'medium', 'hard'].includes(params.get('level') ?? '') ? params.get('level') : 'easy') as Level;
/** your crew (Lily's boats: 0-4) and the kind of boat you take out (the Service's; the Rally's are all lifeboats); and
 * which of the race's boats is yours (the Service: you're at the first station; the Rally: your crew's place in line) */
let crew = Math.max(0, Math.min(4, Number(params.get('boat') ?? 0) || 0));
let boatKind: BoatKind = 'lifeboat';
let mine = 0;
/** the Rescue Service (all the crews together: everyone home) or the Rally (Lily's race) */
let mode: Mode = params.get('mode') === 'rally' ? 'rally' : 'service';
let coast!: Coast, race!: Race;
/** (the Service) the neighbouring stations' quays by their berths: where, and the way inland */
let quays: [number, number, number, number][] = [];
let weather: Weather = WEATHERS.sunny, chosen: WeatherName = 'sunny';
/** the weather: the sea's height and steepness (the boats ride the same waves), the light, the air, the sounds; the one
 * chosen is the title's, the Rally's, and where the Service's day starts (it changes as the day goes on: the race
 * keeps the sea to it, the page the rest) */
function setWeather(name: WeatherName) {
  chosen = WEATHERS[name] ? name : 'sunny';
  showWeather(WEATHERS[chosen]);
}
function showWeather(w: Weather) {
  weather = w;
  SEA.height = weather.height; SEA.chop = weather.chop;
  sound.weather(weather.wind, weather.rain);
}
/** what the coastguard says as the weather turns */
const SKY_SAY: Record<WeatherName, string> = {
  sunny: 'It’s clearing up — blue sky on the way', calm: 'The wind’s dropping — a calm sea coming', windy: 'The wind’s getting up — it’ll be bumpier out there',
  stormy: 'Gale warning! A squall’s coming through — hold on tight', foggy: 'Fog rolling in — watch for the lighthouses', night: 'Night’s falling — searchlights on',
  sunset: 'The light’s changing — sun low on the water',
};
let skyLeg = 0, skySound = 0;
let ui: 'title' | 'race' | 'podium' = 'title';
let paused = false, hornAt = -9;
const marks = new Marks(), wakes = new Wakes(), sound = new Sound();
const canvas = $('sea') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
if (!gl) { document.body.classList.add('nogl'); throw new Error('no WebGL2'); }
const renderer = new Renderer(gl);
renderer.addKind('lifeboat', lifeboat()); renderer.addKind('inshore', inshore()); renderer.addKind('launch', launch());
renderer.addKind('crew', person('crew'), SHOULDER);
for (let s = 0; s < 3; s++) renderer.addKind('kid' + s, person('kid', s), SHOULDER);
for (const k of ['row', 'kayak', 'sail', 'paddle', 'yacht', 'fishing'] as const) renderer.addKind(k, craftMesh(k));
for (const k of ['red', 'green', 'yellow'] as const) renderer.addKind('buoy-' + k, buoyMesh(k));
renderer.addKind('gull', gull(), WING);
const lists: Record<string, Instances> = {};
for (const k of ['lifeboat', 'inshore', 'launch', 'crew', 'kid0', 'kid1', 'kid2', 'row', 'kayak', 'sail', 'paddle', 'yacht', 'fishing', 'buoy-red', 'buoy-green', 'buoy-yellow', 'gull']) lists[k] = new Instances(64);
const draws: Draw[] = Object.entries(lists).map(([kind, list]) => ({ kind, list }));
const stick = new Joystick($('stick'), $('ghost'));
/** where you steer from: wherever you touch (that's the stick's middle while your finger's down), or a stick in a bottom
 * corner; and whether you've steered yet this time out (until you have, a faint ring low down shows how) */
let steer: Steer = 'touch', steered = false;
function setSteer(s: Steer, keep = true) {
  steer = s;
  document.body.classList.toggle('steer-touch', s === 'touch'); document.body.classList.toggle('hand-right', s !== 'left');
  if (keep) store.set('lily-rescue-boats-steer', s);
}
stick.anywhere(canvas, () => {
  if (steer !== 'touch' || ui !== 'race' || paused || preview) return false;
  // (the game steering everyone: a touch takes your boat back, unless the picture's held still)
  if (auto) { if (still) return false; takeOver(); }
  return true;
});
/** the game was steering every boat (`?auto`): yours is yours again */
function takeOver() {
  auto = false; race.auto = false; race.boats[mine].ai = null; steered = true;
}
const minimap = new MiniMap($('map') as HTMLCanvasElement);

/** each way to play has its own coast: the Rally's channel to the harbour; the Service's harbour and the open sea beyond
 * (the reference scenes are composed on the Rally's) */
const kindFor = (m: Mode): CoastKind => (m === 'rally' || (refArg && refArg !== 'harbour' && refArg !== 'neighbour') ? 'rally' : 'service');
function newCoast(s: number) {
  seed = s; coast = makeCoast(seed, kindFor(mode));
  renderer.setCoast(coast, makeWorld(coast));
  // (the neighbours' quays, by their berths: the edge of the quay inland of each, and the way inland from it)
  quays = coast.stations.slice(1).map((st) => {
    let x = st.x, z = st.z;
    for (let i = 0; i < 40 && shoreAt(coast, x, z) > -0.8; i++) z += 0.5;
    const [ox, oz] = seaward(coast, x, z);
    return [x, z, -ox, -oz];
  });
  minimap.paint(coast);
  showPath = makeShowPath(); titleCam = null;
  $('seedname').textContent = coast.name;
}
function newGame() {
  mine = mode === 'service' ? 0 : crew;
  race = newRace(coast, { mode, level, mine, auto, sky: mode === 'service' ? voyage(seed, chosen) : undefined, ...(mode === 'service' ? serviceCrews(seed, crew, boatKind) : {}) });
  skyLeg = 0; if (weather !== WEATHERS[chosen]) showWeather(WEATHERS[chosen]);
  marks.clear(); wakes.clear(); stick.reset(); steered = false;
  poses.length = 0; camYaw = 0; camCut = 0; cutTo = null; told.clear();
}

// ─── poses: where each boat sits on the swell (smoothed) ───
interface Pose { y: number; pitch: number; roll: number; x: number; z: number; h: number }
const poses: Pose[] = [];
function poseOf(i: number, x: number, z: number, h: number, v: number, turn: number, t: number, dt: number, wob = 1): Pose {
  const k = seaAt(coast, x, z), s = Math.sin(h), c = Math.cos(h);
  const at = (across: number, along: number) => heightAt(x - across * c + along * s, z + across * s + along * c, t, k);
  const bow = at(0, 4), stern = at(0, -4), port = at(-1.9, 0), star = at(1.9, 0), mid = at(0, 0);
  const want = { y: (bow + stern + port + star + mid * 2) / 6 - 0.08 + Math.min(1, Math.abs(v) / VMAX) * 0.12, pitch: Math.atan2(bow - stern, 8) * 0.8 * wob + Math.min(1, Math.abs(v) / VMAX) * 0.07, roll: Math.atan2(port - star, 3.8) * 0.8 * wob + turn * Math.min(1, Math.abs(v) / VMAX) * 0.14 };
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
let camYaw = 0, camDist = 26, camEl = 0.44, camLean = 0, camCut = 0;
/** the rescue the camera last cut in to (so it can ease back out) */
let cutTo: { b: number; k: Rescue } | null = null;
/** the title's camera, eased (null: put it straight where it wants to be) */
let titleCam: { from: number[]; target: number[] } | null = null;
const camAt = { x: 0, y: 0, z: 0 };
const lens = { focus: 30, aperture: 0.4 };
let vp: Float32Array = new Float32Array(16), eye = [0, 20, -30], right = [1, 0, 0], up = [0, 1, 0];
let watching = -1;
function followed() {
  if (refBoat !== null) return race.boats[refBoat];
  if (!auto) {
    const me = race.boats[mine];
    // (the Service, home with others still out: watch a crew at work, the same one until it's in)
    if (mode === 'service' && ui === 'race' && me.finished !== null && race.phase === 'racing') {
      if (watching < 0 || race.boats[watching].finished !== null) {
        const busy = race.crafts.find((k) => k.by >= 0 && k.by !== mine && (k.stage === 'line' || k.stage === 'climb'));
        watching = busy ? busy.by : race.boats.find((b) => b.finished === null)?.id ?? -1;
      }
      if (watching >= 0) return race.boats[watching];
    }
    return me;
  }
  if (params.has('follow')) return race.boats[Math.min(race.boats.length - 1, Number(params.get('follow')) || 0)];
  if (params.has('boat')) return race.boats[mine];
  return standings(race)[0];
}
const nearArg = params.get('near');
function camera(dt: number, t: number, w: number, h: number) {
  const portrait = h > w, aspect = w / h;
  let target: number[], from: number[], fov = portrait ? 1.02 : 0.86, shift = 0, shiftX = 0;
  if (refCam) { target = refCam.target; from = refCam.from; fov = refCam.fov; }
  else if (ui === 'title' && showroom) {
    // (choosing your boat: a three-quarter look from across the water at the one chosen, the pier and the town behind; the
    // camera eases along the pier as you choose another; the boat kept clear of the drawer)
    const b = race.boats[Math.max(0, BOAT_KINDS.indexOf(boatKind))], p = poses[b.id] ?? { y: 0 };
    const wantT = [b.x + 0.6, p.y + 1.5, b.z], wantF = [b.x + (portrait ? 13 : 12), p.y + (portrait ? 9 : 5.2), b.z + (portrait ? 25 : 14)];
    const snap = dt <= 0 || !titleCam, kf = snap ? 1 : 1 - Math.exp(-dt * 2.5), kt = snap ? 1 : 1 - Math.exp(-dt * 3.5);
    if (!titleCam) titleCam = { from: wantF.slice(), target: wantT.slice() };
    for (let i = 0; i < 3; i++) { titleCam.from[i] += (wantF[i] - titleCam.from[i]) * kf; titleCam.target[i] += (wantT[i] - titleCam.target[i]) * kt; }
    target = titleCam.target.slice(); from = titleCam.from.slice();
    shift = portrait ? 0.36 : 0.1; shiftX = portrait ? 0 : 0.42;
    fov = portrait ? 0.95 : 0.7;
  } else if (ui === 'title') {
    // (low and ahead, to one side: your lifeboat charging toward you, the cliffs and the lighthouse behind it; the camera
    // waits a little way round the loop ahead of the boat, and eases after where it wants to be, so it never jumps)
    const b = race.boats[mine], p = poses[b.id] ?? { y: 0 }, side = showPath.side, ahead = onLoop(vt * SHOW_V + (portrait ? 17 : 14));
    const ux = -Math.cos(ahead.h) * side, uz = Math.sin(ahead.h) * side, bx = -Math.cos(b.h) * side, bz = Math.sin(b.h) * side, off = portrait ? 3.5 : 7, lean = portrait ? -0.6 : 1.2;
    const wantT = [b.x + bx * lean + (portrait ? 0 : Math.sin(b.h) * 1.5), p.y + 2.1, b.z + bz * lean + (portrait ? 0 : Math.cos(b.h) * 1.5)];
    const wantF = [ahead.x + ux * off, p.y + (portrait ? 4.2 : 3.4), ahead.z + uz * off];
    const snap = dt <= 0 || !titleCam, kf = snap ? 1 : 1 - Math.exp(-dt * 1.4), kt = snap ? 1 : 1 - Math.exp(-dt * 3.5);
    if (!titleCam) titleCam = { from: wantF.slice(), target: wantT.slice() };
    for (let i = 0; i < 3; i++) { titleCam.from[i] += (wantF[i] - titleCam.from[i]) * kf; titleCam.target[i] += (wantT[i] - titleCam.target[i]) * kt; }
    target = titleCam.target.slice(); from = titleCam.from.slice();
    shift = portrait ? -0.18 : 0;
    fov = portrait ? 1.05 : 0.8;
  } else if (ui === 'podium' && coast.pier) {
    // (the Service: over the pier, everyone you brought home on it, your crew moored at its end)
    const bx = coast.pier.x1 - 22, bz = coast.berths[0].z;
    target = [bx + 4, 3.4, bz - 6]; from = [bx + (portrait ? 34 : 28) * zoom, 12 * zoom, bz - (portrait ? 44 : 34) * zoom];
    shift = portrait ? 0.3 : 0.18;
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
      b = c.by >= 0 ? race.boats[c.by] : [...race.boats].sort((p, q) => Math.hypot(p.x - c.x, p.z - c.z) - Math.hypot(q.x - c.x, q.z - c.z))[0];
      k = c.stage === 'line' || c.stage === 'climb' ? c : undefined;
    }
    // (travelling: low and close behind, the coast ahead on the horizon; easing down and round a little as you slow for
    // someone waiting; then, when they're alongside, cutting in low beside the hull to watch them climb aboard)
    const slow = LEVELS[race.level].slow;
    const near = k ? undefined : race.crafts.find((c) => c.stage === 'wait' && c.left > 0 && Math.hypot(c.x - b.x, c.z - b.z) < 22 && Math.abs(b.v) < slow + 2.5 && local(b, c.x, c.z)[1] > -4);
    const wantLean = near ? Math.sign(local(b, near.x, near.z)[0] || 1) * 0.28 : 0;
    const a = dt > 0 ? 1 - Math.exp(-dt * 1.8) : 1;
    let dy = b.h - camYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    camYaw += dy * a; camLean += (wantLean - camLean) * a;
    if (k) cutTo = { b: b.id, k };
    camCut += ((k ? 1 : 0) - camCut) * (dt > 0 ? 1 - Math.exp(-dt * (k ? 1.6 : 1.1)) : 1);
    if (!k && camCut < 0.01) cutTo = null;
    const wantDist = (portrait ? 40 : 29) * zoom * (preview ? 1.2 : 1) * (near ? 0.85 : 1), wantEl = (portrait ? 0.2 : 0.19) * (near ? 0.85 : 1);
    camDist += (wantDist - camDist) * a; camEl += (wantEl - camEl) * a;
    const yaw = camYaw + camLean, look = near ? 8 : 15, py = poses[b.id]?.y ?? 0;
    const tx = b.x + Math.sin(camYaw) * look, tz = b.z + Math.cos(camYaw) * look;
    camAt.x += (tx - camAt.x) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1); camAt.z += (tz - camAt.z) * (dt > 0 ? 1 - Math.exp(-dt * 6) : 1);
    target = [camAt.x, 1.8 + py * 0.6, camAt.z];
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
    fov = portrait ? 1.0 : 0.82;
    shift = 0.12;
    if (cutTo && camCut > 0.001) {
      // (low off the quarter on their side, looking along the hull at the rail where they come aboard)
      const cb = race.boats[cutTo.b], ck = cutTo.k, cp = poses[cb.id]?.y ?? 0;
      const [across, alongK] = local(cb, ck.x, ck.z), side = Math.sign(across) || 1, along = Math.max(-3, Math.min(1.5, alongK));
      const fr = world(cb, side * (portrait ? 9.5 : 8.2), along - (portrait ? 10.5 : 9)), tg = world(cb, side * 2.2, along - 0.6);
      let rf = [fr[0], cp + (portrait ? 3.8 : 3.1), fr[1]];
      // (never inside a cliff: in closer and higher if the water's narrow there)
      if (shoreAt(coast, rf[0], rf[2]) < 4) rf = [(rf[0] + cb.x) / 2, rf[1] + 4, (rf[2] + cb.z) / 2];
      const rt = [tg[0], cp + 1.7, tg[1]], e = camCut * camCut * (3 - 2 * camCut);
      from = from.map((v, i) => v + (rf[i] - v) * e); target = target.map((v, i) => v + (rt[i] - v) * e);
      fov += ((portrait ? 0.95 : 0.78) - fov) * e; shift *= 1 - e;
    }
    // (the Service: while the count goes down, a look at the harbour — over the pier, the town come down on it to see the
    // crews off, at the lifeboats moored along it and the hill behind; then round behind your boat as it sets out)
    const intro = mode === 'service' && !auto && !nearK ? (race.phase === 'countdown' ? 1 : race.phase === 'racing' ? Math.max(0, 1 - race.t / 1.8) : 0) : 0;
    if (intro > 0) {
      const me = race.boats[mine], e = intro * intro * (3 - 2 * intro);
      const iF = [me.x + (portrait ? 26 : 30), portrait ? 9 : 8, me.z - (portrait ? 40 : 32)], iT = [me.x - 12, 3.6, me.z - 3];
      from = from.map((v, i) => v + (iF[i] - v) * e); target = target.map((v, i) => v + (iT[i] - v) * e);
      shift *= 1 - e;
    }
  }
  eye = from;
  // (the lens: in focus where the camera looks, softening nearer and further; stronger for the still shots)
  const fk = cutTo && camCut > 0.5 ? cutTo.k : followed();
  lens.focus = refCam ? refCam.focus : ui === 'race' && !study ? Math.hypot(fk.x - from[0], fk.z - from[2]) : Math.hypot(target[0] - from[0], target[1] - from[1], target[2] - from[2]);
  lens.aperture = refCam ? refCam.aperture : ui === 'title' ? 0.22 : ui === 'podium' ? 0.4 : study ? 0.5 : 0.3 + 0.22 * camCut;
  const view = mat4.lookAt(from, target, [0, 1, 0]), proj = mat4.perspective(fov, aspect, 0.5, 1800);
  proj[9] = -shift; proj[8] = shiftX;
  vp = mat4.mul(proj, view);
  right = [view[0], view[4], view[8]]; up = [view[1], view[5], view[9]];
}

// ─── each frame: where everything is ───
const holes = new Float32Array(48), hulls = new Float32Array(24);
const told = new Set<string>();
/** the lifeboats for the sea's foam (x, z, heading, speed) */
function hullsOf() { race.boats.slice(0, 6).forEach((b, i) => hulls.set([b.x, b.z, b.h, Math.abs(b.v)], i * 4)); return Math.min(6, race.boats.length); }
/** where the `i`th one aboard goes on a boat laid out so (model x, z, y) */
function aboardAt(L: (typeof LAYOUTS)['lifeboat'], i: number): [number, number, number] {
  if (i < L.seats.length) { const [x, z] = L.seats[i]; return [-x, z, L.deckAt(z)]; }
  const [x, z] = L.top[(i - L.seats.length) % L.top.length];
  return [-x, z, L.topY];
}
function people(t: number, dt: number) {
  for (const l of Object.values(lists)) l.clear();
  // (the lifeboats, their crew, and everyone they've taken aboard)
  for (const b of race.boats) {
    const p = poseOf(b.id, b.x, b.z, b.h, b.v, b.turn, t, dt, KINDS[b.kind].roll), col = BOATS[b.crew].colour, L = LAYOUTS[b.kind], deckAt = L.deckAt;
    lists[b.kind].push(b.x, p.y, b.z, b.h, p.pitch, p.roll, 1, 0, col, 0, NONE, 0, NONE, b.id * 1.7);
    const crewAt = (x: number, y: number, z: number, yaw: number, aL: number, aR: number, reach: number, look: number) => {
      const [X, Y, Z] = onBoat(p, x, y, z);
      lists.crew.push(X, Y, Z, b.h + yaw, p.pitch, p.roll, PERSON * 0.98, aL, CREW, aR, SKINS[(b.id * 2 + look) % 6], reach, NONE, 0);
    };
    // (two at the helm (the lifeboat's upper steering position, the RIB's console, the launch's wheelhouse door), one aft
    // to throw the line)
    const home = (b.finished !== null && b.home) || (b.id === mine && t - hornAt < 1.6), cheer = home ? Math.abs(Math.sin(t * 5 + b.id)) * 0.4 : 0;
    crewAt(L.helm[0][0], L.helm[0][1], L.helm[0][2], 0, home ? 2.7 + cheer : 0.25, home ? 2.7 + cheer : 0.9, home ? 0 : 1.1, 0);
    crewAt(L.helm[1][0], L.helm[1][1], L.helm[1][2], 0, home ? 2.6 + cheer : 0.3, 0.2, 0, 1);
    const k = race.crafts.find((c) => c.by === b.id && (c.stage === 'line' || c.stage === 'climb'));
    if (k) {
      const side = local(b, k.x, k.z)[0] >= 0 ? -1 : 1; // (model x is to the boat's left)
      const throwing = k.stage === 'line';
      if (throwing) {
        crewAt(side * (L.rail - 0.05), deckAt(L.aft), L.aft, side * 1.2, side > 0 ? 2.8 : 0.5, side < 0 ? 2.8 : 0.5, 0.4, 2);
        // (the line: from the thrower's hand out to the little boat, thrown)
        const hand = onBoat(p, side * (L.rail + 0.4), deckAt(L.aft) + 1.2, L.aft), kp = poses[100 + race.crafts.indexOf(k)];
        marks.line(hand, [k.x, (kp?.y ?? 0) + 0.45, k.z], 0.6, 0.075, [0.98, 0.8, 0.15], Math.min(1, k.t / LINE));
      } else {
        // (at the rail where they come aboard: leaning right over and reaching down, taking the hand, pulling, then upright with an arm out)
        const u = Math.min(1, k.t / CLIMB), a = Math.max(-4, Math.min(1.5, local(b, k.x, k.z)[1]));
        const lean = u < 0.4 ? 0.75 - 0.25 * (u / 0.4) : u < 0.7 ? 0.5 - 0.5 * ((u - 0.4) / 0.3) : 0;
        const rch = u < 0.4 ? 1.15 + 0.25 * (u / 0.4) : u < 0.7 ? 1.4 + 0.7 * ((u - 0.4) / 0.3) : 0.9;
        const [X, Y, Z] = onBoat(p, side * L.rail, deckAt(a), a);
        lists.crew.push(X, Y, Z, b.h + side * Math.PI / 2, p.pitch - lean, p.roll, PERSON * 0.98, u > 0.75 && side < 0 ? 0.9 : 0, CREW, u > 0.75 && side > 0 ? 0.9 : 0, SKINS[(b.id * 2 + 2) % 6], rch, NONE, 0);
        // (the line, held slack from the deck to the little boat)
        const kp = poses[100 + race.crafts.indexOf(k)];
        marks.line(onBoat(p, side * (L.rail + 0.4), deckAt(L.aft) + 1.0, L.aft), [k.x, (kp?.y ?? 0) + 0.45, k.z], 0.25, 0.075, [0.98, 0.8, 0.15], 1);
      }
    } else crewAt(0.9, deckAt(L.aft - 0.2), L.aft - 0.2, 0, 0.2, 0.2, 0, 2);
    // (aboard: the decks fill from aft, then forward, then the side decks; then the roof, or the RIB's tubes)
    b.aboard.forEach((a, i) => {
      const who = race.crafts[a.craft].craft.people[a.person];
      const [x, z, y] = aboardAt(L, i);
      const [X, Y, Z] = onBoat(p, x, y, z);
      const glee = home ? Math.abs(Math.sin(t * 6 + i)) : 0, wave = (t * 0.7 + i * 0.37) % 6 < 0.8;
      const arm = home ? 2.4 + glee * 0.5 : wave ? 2.5 + Math.sin(t * 12) * 0.3 : 0.15;
      lists['kid' + who.style].push(X, Y + glee * 0.15, Z, b.h + (i % 3 - 1) * 0.4, p.pitch, p.roll, PERSON * 0.92, arm, SHIRTS[who.shirt], home ? arm : 0.15, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    });
  }
  // (the little boats, and whoever's still in them; the one climbing aboard)
  let hc = 0;
  const me = race.boats[mine], fz = followed();
  const nearHoles = race.crafts.map((k, i) => [i, Math.hypot(k.x - fz.x, k.z - fz.z)] as const).filter(([i]) => (race.crafts[i].craft.kind === 'row' || race.crafts[i].craft.kind === 'sail') && race.crafts[i].called).sort((a, b) => a[1] - b[1]).slice(0, 12);
  race.crafts.forEach((k, i) => {
    // (the Service: not there until its call comes in)
    if (!k.called) return;
    const kind = k.craft.kind, c = CRAFT_COLOURS[k.craft.colour];
    const s = seaAt(coast, k.x, k.z), sh = Math.sin(k.yaw), ch = Math.cos(k.yaw);
    const hb = heightAt(k.x + sh * 1.4, k.z + ch * 1.4, t, s), hs = heightAt(k.x - sh * 1.4, k.z - ch * 1.4, t, s), hp = heightAt(k.x - ch * 0.7, k.z + sh * 0.7, t, s), hq = heightAt(k.x + ch * 0.7, k.z - sh * 0.7, t, s);
    const held = (k.stage === 'line' || k.stage === 'climb') ? 1 - 0.6 * k.lee : 1;
    const y = (hb + hs + hp + hq) / 4 + FLOAT[kind], pitch = Math.atan2(hb - hs, 2.8) * 0.8 * held, roll = Math.atan2(hp - hq, 1.4) * 0.5 * held;
    const pose = (poses[100 + i] = { x: k.x, z: k.z, h: k.yaw, y, pitch, roll });
    lists[kind].push(k.x, y, k.z, k.yaw, pitch, roll, 1, 0, c, 0, NONE, 0, NONE, i * 1.3);
    // (who's waiting: facing the nearest lifeboat; waving both arms when one's close)
    const seats = kind === 'row' ? [0.55, -0.35, -1.1] : kind === 'sail' ? [0.05, -0.95] : kind === 'yacht' ? [-1.0, -1.7, -2.4, 1.6, 2.2] : kind === 'fishing' ? [-0.7, -1.45, -2.0] : [-0.05];
    const seatY = kind === 'kayak' ? -0.3 : kind === 'paddle' ? 0.1 : kind === 'yacht' ? 0.5 : kind === 'fishing' ? 0.3 : -0.12;
    const ppl = k.craft.people, first = ppl.length - k.left;
    let nearB = race.boats[0], nd = 1e9;
    for (const b of race.boats) { const d = Math.hypot(b.x - k.x, b.z - k.z); if (d < nd) { nd = d; nearB = b; } }
    const face = Math.atan2(nearB.x - k.x, nearB.z - k.z);
    for (let j = first; j < ppl.length; j++) {
      const who = ppl[j], climbing = j === first && k.stage === 'climb', seatZ = seats[j % seats.length];
      const [sx, sy, sz] = onBoat(pose, 0, seatY, seatZ);
      if (climbing) {
        // (across to the hull, up its side, over the gunwale, to a place on deck)
        const b = race.boats[k.by], bp = poses[b.id], u = Math.min(1, k.t / CLIMB), slot = b.aboard.length;
        const BL = LAYOUTS[b.kind], deckAt = BL.deckAt, [dx, dz, dy] = aboardAt(BL, slot);
        const [, alongK] = local(b, k.x, k.z), side = local(b, k.x, k.z)[0] >= 0 ? -1 : 1;
        const hullOut = onBoat(bp, side * (HALF_BEAM + 0.35), 0.15, Math.max(-4, Math.min(1.5, alongK)));
        const mix = (a: number[], b2: number[], f: number) => a.map((v, n) => v + (b2[n] - v) * f) as [number, number, number];
        const seat = onBoat(bp, dx, dy, dz);
        // (the four moments of the boards: come alongside — to the edge of the little boat, standing, reaching up; take the
        // hand — held, lifted a little; climb aboard — feet on the fender, up the side, over the rail; safe on deck — down
        // beside the crew, then to a place)
        const a = Math.max(-4, Math.min(1.5, alongK));
        const edge = mix([sx, sy, sz], hullOut, 0.55);
        const fender = onBoat(bp, side * (HALF_BEAM + 0.32), deckAt(a) - 0.95, a), rail = onBoat(bp, side * (HALF_BEAM - 0.15), deckAt(a) + 0.3, a);
        const beside = onBoat(bp, side * (HALF_BEAM - 1.25), deckAt(a), a + 0.7);
        let X: number, Y: number, Z: number, aL = 0, aR = 0, reach = 2.5, lean = 0, face = b.h + Math.PI * (side > 0 ? 0.5 : -0.5);
        const ease = (f: number) => f * f * (3 - 2 * f);
        if (u < 0.2) { const f = ease(u / 0.2); [X, Y, Z] = mix([sx, sy, sz], edge, f); reach = 0.4 + 2.1 * f; }
        else if (u < 0.4) { const f = (u - 0.2) / 0.2; [X, Y, Z] = edge; Y += 0.18 * ease(f); reach = 2.55; lean = -0.1 * f; }
        else if (u < 0.7) {
          const f = (u - 0.4) / 0.3, g = ease(f < 0.5 ? f * 2 : (f - 0.5) * 2);
          [X, Y, Z] = f < 0.5 ? mix(edge, fender, g) : mix(fender, rail, g);
          aL = Math.sin(f * 9) > 0 ? 0.3 : 0; aR = Math.sin(f * 9) > 0 ? 0 : 0.3; reach = 2.3 + Math.sin(f * 9) * 0.25; lean = -0.25;
        }
        else if (u < 0.82) { const f = ease((u - 0.7) / 0.12); [X, Y, Z] = mix(rail, beside, f); Y += Math.sin(Math.PI * f) * 0.35; reach = 1.2; aL = aR = 0.6; lean = -0.15 * (1 - f); }
        else { const f = ease((u - 0.82) / 0.18); [X, Y, Z] = mix(beside, seat, f); Y += Math.abs(Math.sin(Math.PI * f * 2)) * 0.12; aL = aR = 0.3 + 2.2 * (1 - f) * (u > 0.9 ? 1 : 0); reach = 0.4; face = b.h; }
        lists['kid' + who.style].push(X, Y, Z, face, lean, 0, PERSON * 0.92, aL, SHIRTS[who.shirt], aR, SKINS[who.skin], reach, HAIRS[who.hair], 0);
        if (u > 0.92 && !told.has(`land${i}:${j}`)) { told.add(`land${i}:${j}`); for (let q = 0; q < 5; q++) marks.sparkle(seat[0] + (Math.random() - 0.5), seat[1] + 1.6, seat[2] + (Math.random() - 0.5), [1, 0.85, 0.3]); }
        continue;
      }
      const waving = nd < 32 && k.stage === 'wait', arm = waving ? 2.5 + Math.sin(t * 9 + j * 2) * 0.45 : 0.25 + Math.sin(t * 1.3 + j) * 0.08;
      lists['kid' + who.style].push(sx, sy, sz, face, pitch * 0.5, roll * 0.5, PERSON * 0.88, arm, SHIRTS[who.shirt], waving ? 2.5 + Math.sin(t * 9 + j * 2 + Math.PI) * 0.45 : arm, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    }
    // (the ring that says come alongside: round the little boats near you, in your colour)
    if (ui === 'race' && !auto && k.stage === 'wait' && k.left > 0 && race.boats[mine].finished === null) {
      const d = Math.hypot(k.x - me.x, k.z - me.z);
      if (d < 55) { const col = BOATS[me.crew].colour; marks.put(FX.RING, k.x, 0, k.z, 4.4, 0, 0, 0, col[0], col[1], col[2], Math.min(1, (55 - d) / 20) * 0.85); }
    }
  });
  // (steering from wherever you touch, until you have: the faint ring low down, its dot drifting up, says how)
  stick.hint(ui === 'race' && !auto && !paused && steer === 'touch' && !steered && !stick.held && race.boats[mine].finished === null);
  for (const [i] of nearHoles) {
    const k = race.crafts[i];
    holes.set([k.x, k.z, k.yaw, k.craft.kind === 'sail' ? 1.7 : 1.52], hc * 4); hc++;
  }
  // (the Service: out on the pier by the mouth, a few from the town to wave the crews off; and everyone landed joins
  // them, waving the lifeboats in)
  const pier = coast.pier;
  if (mode === 'service' && pier) {
    const folk = [...TOWNSFOLK, ...race.ashore.filter((a) => race.boats[a.boat].station === 0).map((a) => race.crafts[a.craft].craft.people[a.person])].slice(0, 75);
    folk.forEach((who, n) => {
      const row = n % 3, x = pier.x1 - 3 - Math.floor(n / 3) * 1.6 + (row - 1) * 0.5, z = pier.z0 + 1.6 + row * 1.9, y = Math.max(2.95, groundAt(coast, x, z));
      const waving = (t * 0.6 + n * 0.31) % 3 < 1.2, arm = waving ? 2.5 + Math.sin(t * 10 + n) * 0.4 : 0.2;
      lists['kid' + who.style].push(x, y, z, Math.atan2(coast.gateX - x, GATE_Z - z) + Math.sin(n * 2.1) * 0.5, 0, 0, PERSON * 0.92, arm, SHIRTS[who.shirt], waving ? 2.5 + Math.sin(t * 10 + n + 2) * 0.4 : 0.2, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    });
  }
  // (the neighbours' quays too: a few from their town, and whoever their crews have landed)
  if (mode === 'service') quays.forEach(([qx, qz, ox, oz], i) => {
    const folk = [...TOWNSFOLK.slice(i * 2, i * 2 + 4), ...race.ashore.filter((a) => race.boats[a.boat]?.station === i + 1).map((a) => race.crafts[a.craft].craft.people[a.person])].slice(0, 40);
    folk.forEach((who, n) => {
      const row = n % 3, along = (Math.floor(n / 3) - 2) * 1.6 + (row - 1) * 0.5, back = 1.4 + row * 1.7, x = qx - oz * along + ox * back, z = qz + ox * along + oz * back, y = Math.max(2.95, groundAt(coast, x, z));
      const waving = (t * 0.6 + n * 0.31) % 3 < 1.2, arm = waving ? 2.5 + Math.sin(t * 10 + n) * 0.4 : 0.2;
      lists['kid' + who.style].push(x, y, z, Math.atan2(-ox, -oz) + Math.sin(n * 2.1) * 0.5, 0, 0, PERSON * 0.92, arm, SHIRTS[who.shirt], waving ? 2.5 + Math.sin(t * 10 + n + 2) * 0.4 : 0.2, SKINS[who.skin], 0, HAIRS[who.hair], 0);
    });
  });
  // (the Service's harbour: the boats moored along the jetties and at their buoys, riding the little swell there; someone
  // out on each jetty)
  coast.moored.forEach((m, i) => {
    const s = seaAt(coast, m.x, m.z), sh = Math.sin(m.yaw), ch = Math.cos(m.yaw), sway = m.buoy ? Math.sin(t * 0.13 + i) * 0.25 : 0;
    const hb = heightAt(m.x + sh * 1.4, m.z + ch * 1.4, t, s), hs = heightAt(m.x - sh * 1.4, m.z - ch * 1.4, t, s), hp = heightAt(m.x - ch * 0.7, m.z + sh * 0.7, t, s), hq = heightAt(m.x + ch * 0.7, m.z - sh * 0.7, t, s);
    lists[m.kind].push(m.x, (hb + hs + hp + hq) / 4 + FLOAT[m.kind], m.z, m.yaw + sway, Math.atan2(hb - hs, 2.8) * 0.8, Math.atan2(hp - hq, 1.4) * 0.5, 1, 0, CRAFT_COLOURS[m.colour], 0, NONE, 0, NONE, i * 1.7);
    if (m.buoy) { const bx = m.x + Math.sin(m.yaw + sway) * 4.5, bz = m.z + Math.cos(m.yaw + sway) * 4.5; lists['buoy-red'].push(bx, heightAt(bx, bz, t, s) - 0.25, bz, 0, 0, 0, 0.42, 0, NONE, 0, NONE, 0, NONE, 0); }
  });
  for (const p of coast.props) if (p.kind === 'jetty') {
    const n = Math.round(p.x * 7 + p.z * 3) >>> 0, who = TOWNSFOLK[n % TOWNSFOLK.length], along = p.v * (0.45 + (n % 5) * 0.1), sx = Math.sin(p.yaw), sz = Math.cos(p.yaw), side = n % 2 ? 1 : -1;
    const x = p.x + sx * along + sz * side * 0.7, z = p.z + sz * along - sx * side * 0.7, wave = (t * 0.5 + n) % 4 < 1.2;
    lists['kid' + who.style].push(x, 2.35, z, p.yaw + side * 1.3, 0, 0, PERSON * 0.95, wave ? 2.5 + Math.sin(t * 9) * 0.4 : 0.25, SHIRTS[(who.shirt + n) % 8], 0.25, SKINS[who.skin], 0, HAIRS[(who.hair + n) % 6], 0);
  }
  // (the buoys, bobbing)
  for (const y of coast.buoys) {
    const s = seaAt(coast, y.x, y.z), h = heightAt(y.x, y.z, t, s);
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
    if (fast > 0.15 && Math.random() < dt * 25 * fast) for (const side of [-1, 1]) marks.foam(b.x + s * 3 - side * c * 2.3, b.z + c * 3 + side * s * 2.3, -side * c * 2.5, side * s * 2.5, 0.5 + Math.random() * 0.5, 1.2, 0.5);
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
    const lamp = onBoat(p, -0.9, LAYOUTS[fb.kind].topY + 0.5, 0.8), pitch = -0.2;
    spotAt[0] = lamp[0]; spotAt[1] = lamp[1]; spotAt[2] = lamp[2]; spotAt[3] = on;
    spotDir[0] = Math.sin(fb.h) * Math.cos(pitch); spotDir[1] = Math.sin(pitch); spotDir[2] = Math.cos(fb.h) * Math.cos(pitch);
    marks.put(FX.BEAM, lamp[0], lamp[1], lamp[2], 5, lamp[0] + spotDir[0] * 32, lamp[1] + spotDir[1] * 32, lamp[2] + spotDir[2] * 32, 1, 0.95, 0.8, 0.16 * on);
  } else spotAt[3] = 0;
}

// ─── the title's hero shot: your lifeboat charging along off the lighthouse's headland ───
/**
 * The title's route: worked out once for each coast, a smooth closed loop in open water off the lighthouse's headland:
 * a stadium round a spine that follows the coast thirty-odd metres out (found exactly, not stepped, then smoothed hard).
 * Out along the rocks, a wide slow half circle, back further out, a half circle home; laid out a metre a step, so the
 * boat goes round at an even speed with its heading always the curve's (and leaning into the turns). A loop never ends,
 * so the title never jumps back.
 */
interface ShowLoop { pts: Float32Array; len: number; side: number; z0: number; z1: number }
let showPath: ShowLoop = { pts: new Float32Array(4), len: 1, side: 1, z0: 0, z1: 1 };
function makeShowPath(): ShowLoop {
  const lh = coast.props.find((p) => p.kind === 'lighthouse' && p.v === 0) ?? coast.props.find((p) => p.kind === 'lighthouse')!;
  const side = Math.sign(lh.x - coast.centre(lh.z)) || 1, W = 15;
  const z0 = lh.z + 20, z1 = Math.min(lh.z + 190, GATE_Z - 70);
  // (the line that many metres off the rocks on the lighthouse's side: walked out from mid-channel, then pinned down by halving)
  const lane = (z: number, d: number) => {
    let a = coast.centre(z);
    if (shoreAt(coast, a, z) < d) return a;
    let b = a;
    for (let i = 0; i < 60; i++) { b = a + side * 4; if (shoreAt(coast, b, z) < d) break; a = b; }
    for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (shoreAt(coast, m, z) < d) b = m; else a = m; }
    return a;
  };
  // (the loop's spine: a line W metres further out than thirty off the rocks, smoothed hard; where smoothing has brought
  // the near side too close to a headland, eased back out and smoothed again)
  const zs: number[] = [];
  for (let z = z0; z <= z1; z += 4) zs.push(z);
  let c = zs.map((z) => lane(z, 30 + W));
  const smooth = (v: number[]) => v.map((_, i) => { let t = 0, n = 0; for (let j = -6; j <= 6; j++) { const k = Math.max(0, Math.min(v.length - 1, i + j)); t += v[k]; n++; } return t / n; });
  for (let k = 0; k < 6; k++) {
    c = smooth(smooth(c));
    c = c.map((x, i) => { const near = shoreAt(coast, x + side * W, zs[i]), far = shoreAt(coast, x - side * W, zs[i]); return x - side * Math.max(0, 22 - near) + side * Math.max(0, 18 - far); });
  }
  const spine = (z: number) => { const u = Math.max(0, Math.min(zs.length - 1.001, (z - z0) / 4)), i = Math.floor(u), f = u - i; return c[i] * (1 - f) + c[i + 1] * f; };
  // (a stadium round the spine: out along the rocks, a half circle, back further out, a half circle home)
  const loop: [number, number][] = [], zA = z0 + W, zB = z1 - W;
  for (let z = zA; z < zB; z += 1) loop.push([spine(z) + side * W, z]);
  for (let i = 0; i <= 40; i++) { const a = (Math.PI * i) / 40; loop.push([spine(zB) + side * W * Math.cos(a), zB + W * Math.sin(a)]); }
  for (let z = zB; z > zA; z -= 1) loop.push([spine(z) - side * W, z]);
  for (let i = 0; i <= 40; i++) { const a = Math.PI + (Math.PI * i) / 40; loop.push([spine(zA) + side * W * Math.cos(a), zA + W * Math.sin(a)]); }
  // (a last light smoothing round the joins, then laid out a metre a step)
  let L = loop;
  for (let k = 0; k < 3; k++) L = L.map((_, i) => { let x = 0, z = 0; for (let j = -3; j <= 3; j++) { const q = L[(i + j + L.length) % L.length]; x += q[0]; z += q[1]; } return [x / 7, z / 7] as [number, number]; });
  const cum = [0];
  for (let i = 1; i <= L.length; i++) cum.push(cum[i - 1] + Math.hypot(L[i % L.length][0] - L[i - 1][0], L[i % L.length][1] - L[i - 1][1]));
  const len = cum[cum.length - 1], n = Math.floor(len), pts = new Float32Array(n * 2);
  for (let k = 0, i = 0; k < n; k++) {
    const s = (k / n) * len;
    while (cum[i + 1] < s) i++;
    const f = (s - cum[i]) / (cum[i + 1] - cum[i] || 1), p = L[i], q = L[(i + 1) % L.length];
    pts[k * 2] = p[0] + (q[0] - p[0]) * f; pts[k * 2 + 1] = p[1] + (q[1] - p[1]) * f;
  }
  return { pts, len: n, side, z0, z1 };
}
/** a point on the title's loop, `s` metres round: where, which way (heading), how sharply it's turning (rad per metre) */
function onLoop(s: number) {
  const L = showPath, n = L.len;
  const pos = (u: number) => { const i = Math.floor(u), f = u - i, a = ((i % n) + n) % n, b = (a + 1) % n; return [L.pts[a * 2] + (L.pts[b * 2] - L.pts[a * 2]) * f, L.pts[a * 2 + 1] + (L.pts[b * 2 + 1] - L.pts[a * 2 + 1]) * f]; };
  // (the heading from points either side, themselves in between the metre marks, so it turns smoothly, not a tick a metre)
  const head = (u: number) => { const a = pos(u - 2), b = pos(u + 2); return Math.atan2(b[0] - a[0], b[1] - a[1]); };
  const [x, z] = pos(s), h0 = head(s);
  let dh = head(s + 2) - head(s - 2); while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
  return { x, z, h: h0, bend: dh / 4 };
}
const SHOW_V = 8.5;
function showcase(t: number) {
  const b = race.boats[mine], o = onLoop(t * SHOW_V);
  b.x = o.x; b.z = o.z; b.h = o.h; b.v = SHOW_V;
  // (leaning into the turns: the boat's turn is the way its heading is going, as the race has it)
  b.turn = -o.bend * SHOW_V;
}

// ─── what's said on the screen ───
const $count = $('count'), bar = $('bar'), bubbleEl = $('bubble'), arrows = $('arrows');
let shownCount = -1, hudAt = -1, note = { text: '', until: 0 };
const ORD = ['1st', '2nd', '3rd', '4th', '5th'];
/** say something in the bubble for a while (it gives way to nothing more pressing) */
function bubble(text: string, secs = 2.6) { note = { text, until: performance.now() / 1000 + secs }; }
function hud(t: number) {
  if (ui !== 'race') return;
  const service = mode === 'service', st = standings(race), me = race.boats[mine], place = st.findIndex((b) => b.id === mine);
  // (the map: every frame, it turns with you; in the Service a little boat another crew is going for has their colour round it)
  const dots: [number, number, string, number, string?][] = race.crafts.filter((c) => c.stage === 'wait' && c.left > 0 && c.called).map((c) => [c.x, c.z, css(CRAFT_COLOURS[c.craft.colour]), c.left, service && c.claim >= 0 && c.claim !== mine ? css(BOATS[race.boats[c.claim].crew].colour) : undefined]);
  const fb = auto ? followed() : me;
  minimap.draw(fb.x, fb.z, camYaw, dots, race.boats.map((b) => [b.x, b.z, b.h, css(BOATS[b.crew].colour), b.id === fb.id]), coast.gateX);
  if (t - hudAt < 0.1) return;
  hudAt = t;
  // (the Service counts everyone rescued so far against everyone whose call has come in)
  const folk = race.crafts.reduce((n, k) => n + (k.called ? k.craft.people.length : 0), 0), fleet = race.boats.reduce((n, b) => n + b.rescued, 0);
  const shown = service ? fleet * 1000 + folk : fb.rescued;
  if (shown !== shownCount) { if (shownCount >= 0) { $('stat-count').classList.add('bump'); setTimeout(() => $('stat-count').classList.remove('bump'), 160); } shownCount = shown; $count.textContent = service ? `${fleet}/${folk}` : String(fb.rescued); }
  // (the second pill: your place in the Rally; in the Service, your own crew's count, in your colour)
  if (service) { $('place').textContent = String(fb.rescued); $('place-ic').innerHTML = `<i class="dot" style="background:${css(BOATS[fb.crew].colour)}"></i>`; $('place-sub').textContent = 'your crew'; }
  else { $('place').textContent = ORD[auto ? 0 : place]; $('place-ic').textContent = '🏆'; $('place-sub').textContent = ''; }
  // (the clock: the time out (the Service's with the weather as it is now); in the Rally's last call, the time left, in red)
  const timeEl = $('stat-time');
  $('time-ic').textContent = service ? weather.icon : '⏱️';
  if (!service && race.lastCall && me.finished === null) { const left = race.lastCall.start + race.lastCall.length - race.t; $('clock').textContent = clock(left); timeEl.classList.add('hurry'); }
  else { $('clock').textContent = clock(race.t); timeEl.classList.remove('hurry'); }
  // (under the map: the Rally's places; the Service's crews, each with its count, in their own order)
  $('ladder').innerHTML = (service ? race.boats : st).map((b, i) => `<div class="glass${b.id === fb.id ? ' me' : ''}">${service ? '' : `<small>${ORD[i]}</small>`}<i style="background:${css(BOATS[b.crew].colour)}"></i>${b.rescued}${service && b.finished !== null ? ' ⚓' : ''}</div>`).join('');
  // (coming aboard: a lifebuoy and a bar that fills; in the Service it fills as fast as you hold steady, amber when it's rough)
  const k = race.crafts.find((c) => c.by === fb.id && (c.stage === 'line' || c.stage === 'climb'));
  if (k) {
    const total = k.craft.people.length, done = total - k.left, f = (done + (k.stage === 'climb' ? k.t / CLIMB : 0)) / total;
    bar.classList.add('on'); bar.classList.toggle('rough', service && k.stage === 'climb' && k.steady < 0.55);
    (bar.querySelector('i') as HTMLElement).style.width = `${f * 100}%`; (bar.querySelectorAll('span')[1] as HTMLElement).textContent = `${done} of ${total} aboard`;
  } else bar.classList.remove('on', 'rough');
  // (the bubble: what's happening now, else what to do next)
  let text = '';
  const now = performance.now() / 1000, everyone = service ? everyoneAboard(race) : race.crafts.every((c) => c.left <= 0);
  const waitingAny = race.crafts.some((c) => c.called && c.stage === 'wait' && c.left > 0), inside = service ? insideHome(race, me) : false;
  if (now < note.until) text = note.text;
  else if (!auto && me.finished === null) {
    const slow = LEVELS[race.level].slow;
    if (race.phase === 'countdown') text = 'Get ready…';
    else if (race.t < 5 || (!steered && race.t < 15)) text = steer === 'touch' ? 'Put your finger on the sea and drag up to go!' : 'Push the stick to go!';
    else if (k && k.stage === 'line') text = 'Line away!';
    else if (k && !service) text = 'Climbing aboard — hold still!';
    else if (k) text = Math.abs(me.v) > slow * 0.6 || Math.abs(me.turn) > 0.25 ? 'Ease off — hold her steady' : k.steady > 0.75 ? 'Nice and steady — climbing aboard!' : k.lee < 0.35 ? 'Bumpy here! Turn side-on to the waves to shelter them' : 'Hold her steady…';
    else if (service && inside && me.aboard.length && Math.abs(me.v) >= 7) text = 'Slow down so they can step ashore';
    else if (service && inside && me.aboard.length) text = 'Home! Stepping ashore…';
    else if (race.crafts.some((c) => c.called && c.stage === 'wait' && c.left > 0 && Math.hypot(c.x - me.x, c.z - me.z) < 11 && Math.abs(me.v) > slow)) text = steer === 'touch' ? 'Slow down — let go!' : 'Slow down — let go of the stick!';
    else if (!service && race.lastCall) text = 'Last call! Head for the harbour!';
    else if (service && everyone && me.aboard.length) text = 'Everyone’s aboard! Bring them home to the harbour';
    else if (service && everyone) text = 'Everyone’s safe! Back to the harbour';
    else if (service && !waitingAny) text = 'Listening for the next call…';
    else if (race.t < 14) text = service ? 'Find someone who needs help!' : 'Find the little boats!';
  } else if (!auto && service && race.phase === 'racing') text = 'Home safe! The other crews are bringing the last ones in';
  if (text) bubbleEl.textContent = text;
  bubbleEl.classList.toggle('on', !!text);
  $('skip').classList.toggle('on', !auto && service && me.finished !== null && race.phase === 'racing');
  // (arrows at the edge to the nearest little boats out of sight — in the Service, the ones no other crew has — and to the harbour when it's time)
  const W = innerWidth, H = innerHeight, want: { x: number; z: number; n: number; fin?: boolean; col: number[] }[] = [];
  if (me.finished === null && !auto) {
    // (in the Service, your own stretch's, and another's that's been waiting a while with no one going for it)
    const waiting = race.crafts.filter((c) => c.called && c.stage === 'wait' && c.left > 0 && (!service || ((c.claim < 0 || c.claim === mine) && (c.craft.station === me.station || race.t - c.calledAt > HELP)))).map((c) => ({ c, d: Math.hypot(c.x - me.x, c.z - me.z) })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { c } of waiting) want.push({ x: c.x, z: c.z, n: c.left, col: CRAFT_COLOURS[c.craft.colour] });
    // (the way home: in the Rally's last call, or with no one to go for; in the Service, once everyone's aboard, until you're in)
    const homeward = service ? !inside && everyone : race.lastCall || !waiting.length;
    if (homeward) { const [hx, hz] = service ? coast.stations[me.station].mouth : [coast.gateX, GATE_Z]; want.push({ x: hx, z: hz, n: 0, fin: true, col: [1, 1, 1] }); }
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
/** a card's bar: a label and four pips, so many lit */
const pips = (label: string, n: number) => `<span class="pips"><i>${label}</i>${[0, 1, 2, 3].map((j) => `<b class="${j < n ? 'on' : ''}"></b>`).join('')}</span>`;
const BOAT_KINDS: BoatKind[] = ['lifeboat', 'inshore', 'launch'];
/** (the Boats drawer) the three kinds of boat moored side by side along your harbour's pier, all in your crew's colour;
 * the camera goes along to the one chosen, and a tap on one chooses it */
let showroom = false;
function showroomPlace() {
  BOAT_KINDS.forEach((k, i) => { const b = race.boats[i], m = mooring(coast.pier!, i); b.kind = k; b.crew = crew; b.x = m.x; b.z = m.z; b.h = m.h; b.v = 0; b.turn = 0; });
}
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* (private window: no keeping) */ } } };
const bestKey = () => mode === 'rally' ? 'lily-rescue-boats-best' : 'lily-rescue-boats-service-best';
const bests = (): Record<string, number> => { try { return JSON.parse(store.get(bestKey()) ?? '{}'); } catch { return {}; } };
function panel(name: '' | 'boats' | 'weather' | 'settings') {
  // (choosing your boat: off to your harbour, where the three kinds are moored along the pier; and back out after)
  const was = showroom;
  showroom = name === 'boats';
  if (showroom && !was) { mode = 'service'; if (coast.kind !== 'service') newCoast(seed); newGame(); titleCam = null; }
  if (was && !showroom) { newGame(); titleCam = null; }
  document.body.classList.remove('panel-boats', 'panel-weather', 'panel-settings');
  if (name) document.body.classList.add('panel-' + name);
  refreshTitle();
}
function refreshTitle() {
  const B = BOATS[crew], K = KINDS[boatKind], best = bests()[crew] ?? 0;
  // (the Service's forecast: the day's weather, as it'll go)
  const forecast = voyage(seed, chosen).map((l) => WEATHERS[l.w].icon).join(' → ');
  $('chosen').innerHTML = `<span class="tag"><span class="dot" style="background:${css(B.colour)}"></span><b>${B.name}</b> · ${K.name.toLowerCase()}</span><span class="tag">${forecast} · ${level}</span><span class="tag">${coast.name}</span>`;
  $('weather-icon').textContent = weather.icon;
  // (the drawer: the boat chosen (you see it, moored, behind), its bars; the kinds; the crews, each in its colour)
  $('boat-show').innerHTML = `<b>${K.name}</b><small>${B.name} · ${best ? `your best: ${best} rescued` : 'not out yet'}</small><span class="bars">${pips('Speed', K.bars[0])}${pips('Steady', K.bars[1])}</span>`;
  $('kinds-list').innerHTML = BOAT_KINDS.map((k) => `<button data-kind="${k}" class="${k === boatKind ? 'on' : ''}">${KINDS[k].name}</button>`).join('');
  for (const el of document.querySelectorAll<HTMLElement>('#kinds-list button')) el.onclick = () => chooseKind(el.dataset.kind as BoatKind);
  $('boats-list').innerHTML = BOATS.map((b, i) => `<button data-boat="${i}" class="${i === crew ? 'on' : ''}"><i style="background:${css(b.colour)}"></i>${b.name}</button>`).join('');
  for (const el of document.querySelectorAll<HTMLElement>('#boats-list button')) el.onclick = () => chooseBoat(Number(el.dataset.boat));
  const g = (c: readonly number[]) => css(c);
  $('weather-list').innerHTML = WEATHER_ORDER.map((n) => { const w = WEATHERS[n]; return `<button data-weather="${n}" class="${n === weather.name ? 'on' : ''}" style="background:linear-gradient(${g(w.skyTop)}, ${g(w.skyHorizon)} 55%, ${g(w.body)} 56%, ${g(w.deep)})"><span>${w.icon}</span>${w.label}</button>`; }).join('');
  for (const el of document.querySelectorAll<HTMLElement>('#weather-list button')) el.onclick = () => { setWeather(el.dataset.weather as WeatherName); refreshTitle(); };
  for (const el of document.querySelectorAll<HTMLElement>('#levels button')) { el.classList.toggle('on', el.dataset.level === level); el.onclick = () => { level = el.dataset.level as Level; refreshTitle(); }; }
  for (const el of document.querySelectorAll<HTMLElement>('#hands button')) { el.classList.toggle('on', el.dataset.hand === steer); el.onclick = () => { setSteer(el.dataset.hand as Steer); refreshTitle(); }; }
  $('sound').textContent = sound.on ? 'on' : 'off';
}
function chooseBoat(i: number) { crew = (i + 5) % 5; if (!showroom) newGame(); refreshTitle(); }
function chooseKind(k: BoatKind) { boatKind = k; store.set('lily-rescue-boats-kind', k); if (!showroom) newGame(); refreshTitle(); }
const nextKind = (d: number) => chooseKind(BOAT_KINDS[(BOAT_KINDS.indexOf(boatKind) + d + 3) % 3]);
function title() {
  ui = 'title'; paused = false;
  document.body.classList.remove('racing', 'podium', 'paused'); document.body.classList.add('title');
  newGame(); panel('');
  sound.quiet();
}
function go(m: Mode = mode) {
  if (ui !== 'title' && ui !== 'podium') return;
  mode = m; watching = -1;
  if (coast.kind !== kindFor(mode)) newCoast(seed);
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
  const service = mode === 'service', st = standings(race), place = st.findIndex((b) => b.id === mine), me = race.boats[mine];
  // (everyone in: the Service's each at its own station; the Rally's at the quay, 1st in the middle, the rest to either side)
  const order = [2, 1, 3, 0, 4];
  st.forEach((b, i) => { const berth = coast.berths[service ? b.station : order[i]]; b.x = berth.x; b.z = berth.z; b.h = berth.h; b.v = 0; b.home = b.finished !== null; });
  poses.length = 0;
  const folk = race.crafts.reduce((n, k) => n + k.craft.people.length, 0), fleet = race.boats.reduce((n, b) => n + b.rescued, 0), all = fleet === folk;
  const who = auto ? st[0] : me;
  let stars: number;
  if (service) {
    // (the Service: everyone home first of all; then the crews' honours, by Lily's rule, as the postscript)
    const ashore = race.ashore.length, home = ashore === folk;
    stars = home ? (who.rescued >= folk / 5 ? 3 : 2) : 1;
    $('result').textContent = home ? 'Everyone home!' : 'Home safe';
    $('fleet').textContent = `${ashore} of ${folk} safe ashore · ${['', 'one crew', 'two crews', 'three crews', 'four crews', 'five crews'][race.boats.length]} · ${auto ? '' : `your crew brought ${me.rescued} home · `}crew honours:`;
  } else {
    stars = auto ? 3 : place === 0 ? 3 : place < 3 ? 2 : 1;
    $('result').textContent = auto ? `${BOATS[st[0].crew].name} wins!` : place === 0 ? 'You won!' : `You came ${ORD[place]}!`;
    $('fleet').textContent = '';
  }
  $('stars').innerHTML = [0, 1, 2].map((i) => STAR(i < stars, 0.2 + i * 0.2)).join('');
  $('ranks').innerHTML = st.map((b, i) => `<li class="p${i + 1}${b.id === mine && !auto ? ' me' : ''}"><b>${ORD[i]}</b><i style="background:${css(BOATS[b.crew].colour)}"></i><span>${BOATS[b.crew].name}<small>${b.finished === null ? 'not home' : 'rescued'}</small></span><strong>${b.rescued}</strong></li>`).join('');
  $('snapcap').textContent = `${who.rescued} rescued!`;
  if (!snapUrl) snapWanted = true; else ($('snap') as HTMLImageElement).src = snapUrl;
  if (!auto) {
    const b = bests(), was = b[crew] ?? 0;
    if (me.rescued > was) { b[crew] = me.rescued; store.set(bestKey(), JSON.stringify(b)); }
    $('best').textContent = me.rescued > was && was > 0 ? `A new best for ${BOATS[crew].name}!` : `${BOATS[crew].name}'s best: ${Math.max(was, me.rescued)} rescued`;
  } else $('best').textContent = '';
  sound.quiet(); sound.tune(service ? (all ? 0 : 2) : place);
}
$('play').onclick = () => go('service');
$('rally').onclick = () => go('rally');
$('skip').onclick = () => { if (ui === 'race') { runFor(race, 1500); events(); } };
$('open-boats').onclick = () => panel('boats');
$('open-weather').onclick = () => panel('weather');
$('open-settings').onclick = () => panel('settings');
for (const el of document.querySelectorAll<HTMLElement>('[data-close]')) el.onclick = () => panel('');
$('boat-prev').onclick = () => nextKind(-1);
$('boat-next').onclick = () => nextKind(1);
/** (in the drawer) where each of the boats moored along the pier is on the screen (CSS px): its bow, middle and stern,
 * those in front of the camera */
function showroomPicks() {
  return BOAT_KINDS.map((_, i) => {
    const b = race.boats[i];
    return [-4, 0, 4].map((along): [number, number] | null => {
      const q = [b.x + Math.sin(b.h) * along, 1.6, b.z + Math.cos(b.h) * along], cw = vp[3] * q[0] + vp[7] * q[1] + vp[11] * q[2] + vp[15];
      return cw <= 0 ? null : [((vp[0] * q[0] + vp[4] * q[1] + vp[8] * q[2] + vp[12]) / cw * 0.5 + 0.5) * innerWidth, (0.5 - (vp[1] * q[0] + vp[5] * q[1] + vp[9] * q[2] + vp[13]) / cw * 0.5) * innerHeight];
    }).filter((q): q is [number, number] => !!q);
  });
}
// (a tap on one of them chooses it)
canvas.addEventListener('pointerup', (e) => {
  if (ui !== 'title' || !showroom) return;
  let best = -1, bd = 80;
  showroomPicks().forEach((qs, i) => { for (const q of qs) { const d = Math.hypot(q[0] - e.clientX, q[1] - e.clientY); if (d < bd) { bd = d; best = i; } } });
  if (best >= 0) chooseKind(BOAT_KINDS[best]);
});
addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && ui === 'title' && !document.body.className.includes('panel-')) { e.preventDefault(); go('service'); }
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
let lastCount = 4, snapWanted = false, snapUrl = '', landed = { n: 0, at: -9 };
const CRAFT_SAY = { row: 'a rowing boat', kayak: 'a kayaker', sail: 'a sailing dinghy', paddle: 'a paddleboarder', yacht: 'a yacht that’s lost its mast', fishing: 'a fishing boat with engine trouble' } as const;
const WHERE = ['just outside the harbour', 'along the coast', 'out at sea'];
/** the coastguard's call on the radio: who, how many, where */
function callText(k: Rescue) {
  const n = k.craft.people.length, say = CRAFT_SAY[k.craft.kind], who = n === 1 && (k.craft.kind === 'kayak' || k.craft.kind === 'paddle') ? `A${say.slice(1)}` : `${say[0].toUpperCase()}${say.slice(1)}, ${['', 'one', 'two', 'three', 'four', 'five'][n] ?? n} aboard`;
  return `📻 Coastguard: ${who}, in trouble ${WHERE[k.craft.zone] ?? 'nearby'}!`;
}
function events() {
  for (const e of race.events.splice(0)) {
    if (e.kind === 'go') { say('Go!'); sound.horn(); if (mode === 'service' && !auto) bubble(`📻 Coastguard: Launch! People need help outside the harbour — ${steer === 'touch' ? 'drag up on the sea' : 'push the stick'} to go!`, 4.5); }
    else if (e.kind === 'call') { sound.radio(); if (!auto && race.boats[mine].finished === null) bubble(callText(race.crafts[e.craft]), 3.6); }
    else if (e.kind === 'edge') { if (e.boat === mine && !auto) bubble('📻 Coastguard: That’s the edge of the search area — turn back!', 3); }
    else if (e.kind === 'ashore') {
      if (e.boat === mine && !auto) { landed = { n: race.t - landed.at < 3 ? landed.n + 1 : 1, at: race.t }; sound.aboard(landed.n + 2); bubble(`${landed.n} safe ashore!`, 2); }
    }
    else if (e.kind === 'line') { if (e.boat === mine) sound.splash(); const k = race.crafts[e.craft]; for (let q = 0; q < 6; q++) marks.spray(k.x, 0.4, k.z, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.3); }
    else if (e.kind === 'aboard') { if (e.boat === mine) sound.aboard(race.boats[mine].rescued); }
    else if (e.kind === 'clear') { if (e.boat === mine && !auto) bubble(`All aboard! ${race.crafts[e.craft].craft.people.length} rescued`); }
    else if (e.kind === 'letgo') { if (e.boat === mine && !auto) bubble('Come back — they’re still waiting!'); }
    else if (e.kind === 'bump') { if (e.boat === mine) sound.bump(); }
    else if (e.kind === 'finish') { if (e.boat === mine && !auto) { const f = $('finishflag'); f.textContent = mode === 'service' ? 'HOME' : 'FINISH'; f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); snapWanted = true; bubble(mode === 'service' ? `All in! Your crew rescued ${race.boats[mine].rescued}` : `${ORD[e.place - 1]} home!`, 3); } }
    else if (e.kind === 'yield') { if (e.to === mine && !auto) bubble(`${BOATS[race.boats[e.boat].crew].name}: All yours, ${BOATS[crew].name} — we’ll find someone else!`, 3.2); }
    else if (e.kind === 'allaboard') { sound.bell(); if (!auto) say('Everyone’s aboard!', true); }
    else if (e.kind === 'lastcall') { sound.bell(); if (!auto && race.boats[mine].finished === null) { say('Last call!', true); bubble('Last call! Head for the harbour!', 4); } }
    else if (e.kind === 'over') setTimeout(() => { if (ui === 'race') podium(); }, 2500);
  }
}

/** the Service's weather, as the day goes on: drawn as the race has it, the sound following, the coastguard warning of
 * each change a little before it starts */
function sky() {
  if (!race.sky) return;
  weather = weatherAt(race.sky, race.t);
  if (Math.floor(race.t) !== skySound) { skySound = Math.floor(race.t); sound.weather(weather.wind, weather.rain); }
  const next = race.sky[skyLeg + 1];
  if (next && race.t > next.at - 6) { skyLeg++; if (!auto && race.boats[mine].finished === null && race.phase === 'racing') { sound.radio(); bubble(`📻 Coastguard: ${SKY_SAY[next.w]}`, 4); } }
}

// ─── the loop ───
let dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1), slowFor = 0, fastFor = 0, ema = 16;
let ceiling = Math.min(devicePixelRatio || 1, 1.75), droppedAt = -1e9;
function resize() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
addEventListener('resize', resize);
let last = performance.now(), vt = Number(params.get('at') ?? 0) || 0, frames = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; frames++;
  ema += (dt * 1000 - ema) * 0.05;
  // (keep it smooth: fewer pixels when frames are slow, more when there's room; but never see-sawing: a level that was too
  // slow isn't tried again for half a minute, and on the title it only ever steps down, so the picture behind the menu
  // doesn't keep sharpening and softening)
  if (!still && !preview) {
    if (ema > 24) { slowFor += dt; fastFor = 0; } else if (ema < 15) { fastFor += dt; slowFor = 0; } else { slowFor = fastFor = 0; }
    const cap = Math.min(devicePixelRatio || 1, 1.75);
    if (now - droppedAt > 30000) ceiling = cap;
    if (slowFor > 1.5 && dpr > 0.8) { ceiling = dpr - 0.01; droppedAt = now; dpr = Math.max(0.8, dpr - 0.15); resize(); slowFor = 0; }
    if (fastFor > 4 && dpr + 0.15 <= ceiling && ui !== 'title') { dpr = Math.min(cap, dpr + 0.15); resize(); fastFor = 0; }
  }
  if (!still) vt += dt;
  if (ui === 'title') { if (showroom) showroomPlace(); else showcase(vt); for (const b of race.boats) wakes.record(b.id, b.x, b.z, b.h, b.v, vt); marks.step(dt); splashes(vt, dt); }
  else if (ui === 'race' && paused) marks.step(0);
  else if (ui === 'race' && !still) {
    if (race.phase === 'countdown' && Math.ceil(race.count) < lastCount && race.count > 0) { lastCount = Math.ceil(race.count); say(String(lastCount)); sound.beep(); }
    const inp = stick.read();
    if (inp.active) steered = true;
    step(race, dt, inp);
    sky();
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
    focus: ui === 'podium' ? (coast.pier ? [coast.pier.x1 - 22, coast.berths[0].z - 30] : [coast.berths[2].x, coast.berths[2].z - 30]) : [fb.x, fb.z], draws, wakes: wakes.data, wakeCount: wakes.count, fx: marks.data, fxCount: marks.count, holes, holeCount: hc, hulls, hullCount: hullsOf(),
    weather, flash, spot: spotAt, spotDir, rally: mode === 'rally',
  };
  if (ui === 'title') { f.zMin = showroom ? GATE_Z - 150 : showPath.z0 - 400; f.zMax = showroom ? GATE_Z + 400 : showPath.z1 + 400; }
  if (ui !== 'title') titleCam = null;
  if (ui === 'podium') { f.zMin = GATE_Z - 200; f.zMax = GATE_Z + 400; }
  renderer.draw(f, canvas.width, canvas.height);
  // (a picture for the end: taken the moment you cross the line, while the frame's still there to read)
  if (snapWanted) { snapWanted = false; try { snapUrl = canvas.toDataURL('image/jpeg', 0.82); ($('snap') as HTMLImageElement).src = snapUrl; } catch { /* (no picture, then) */ } }
  (window as unknown as { __rescue: unknown }).__rescue = {
    variant: 'coast', mode, coast: coast.kind, ui, paused, phase: race.phase, seed, fleet: race.boats.reduce((n, b) => n + b.rescued, 0), ashore: race.ashore.length, called: race.crafts.filter((k) => k.called).length, weather: weather.name, name: coast.name, mine, crew, kind: boatKind, level, t: race.t, auto, dpr, frameMs: ema,
    stick: { x: stick.x, y: stick.y, held: stick.held }, steer, showroom, picks: showroom ? showroomPicks() : null,
    boats: race.boats.map((b) => ({ x: b.x, z: b.z, h: b.h, v: b.v, rescued: b.rescued, finished: b.finished, home: b.home, crew: b.crew, kind: b.kind, station: b.station })),
    boarding: race.crafts.filter((k) => k.stage === 'line' || k.stage === 'climb').map((k) => ({ craft: k.craft.id, by: k.by, stage: k.stage })),
  };
  requestAnimationFrame(frame);
}

// ─── reference scenes: one fixed frame each, composed like the target studies, to judge the drawing by ───
let refCam: { from: number[]; target: number[]; fov: number; aperture: number; focus: number } | null = null;
/** the boat a reference scene follows (null: as usual) */
let refBoat: number | null = null;
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
    const k = race.crafts.find((c) => c.craft.kind === 'row') ?? race.crafts[0], side = -1;
    me.aboard = [{ craft: 1, person: 0 }, { craft: 2, person: 0 }, { craft: 3, person: 0 }].filter((a) => race.crafts[a.craft]);
    me.rescued = me.aboard.length;
    const [kx, kz] = world(me, side * (HALF_BEAM + 0.95), -1.6);
    k.x = kx; k.z = kz; k.yaw = me.h + Math.PI; k.stage = 'climb'; k.by = mine; k.side = side; k.t = Number(params.get('u') ?? 0.32) * CLIMB;
    if (k.craft.people.length < 2) k.craft.people.push({ ...k.craft.people[0], skin: (k.craft.people[0].skin + 2) % 6, hair: 2, style: 1 }), k.left = k.craft.people.length;
    k.left = k.craft.people.length;
    for (const o of race.boats) if (o !== me) place(o, G.x + (o.id - 2) * 30, G.z - 120 - o.id * 12, 0.1, 6);
    const at = world(me, side * 8, -9), look = world(me, side * 2.2, -1.0);
    refCam = { from: [at[0], 2.3, at[1]], target: [look[0], 1.6, look[1]], fov: 0.66, aperture: 0.5, focus: 10 };
  } else if (kind === 'harbour') {
    // (the Service's harbour from above its mouth: the crews moored at the pier, the jetties and their boats, the town)
    const H = coast.harbour;
    refCam = { from: [H.x + 62, 46, H.z - 92], target: [H.x - 12, 1, H.z + 8], fov: 0.82, aperture: 0.2, focus: 110 };
  } else if (kind === 'neighbour') {
    // (the Service: a neighbouring station's little harbour, from the sea off its mouth)
    refBoat = Math.max(1, Math.min(2, Number(params.get('n') ?? 1)));
    const st = coast.stations[refBoat], A = st.area!;
    refCam = { from: [st.mouth[0] + 70, 40, st.mouth[1] - 55], target: [A.x + 4, 1, A.z + 2], fov: 0.8, aperture: 0.2, focus: 90 };
  } else if (kind === 'coast') {
    // (from the sea off the big headland, looking along the cliffs: the lighthouse and cottages on top, the rocks and surf below)
    const L = coast.props.find((p) => p.kind === 'lighthouse' && p.v === 0) ?? coast.props.find((p) => p.kind === 'lighthouse')!;
    const [ox, oz] = seaward(coast, L.x, L.z), tx = -oz, tz = ox;
    for (const o of race.boats) place(o, L.x + ox * 60 + tx * (o.id * 9 - 10), L.z + oz * 60 + tz * (o.id * 9 - 10) + 30, 0.2, 5);
    refCam = { from: [L.x + ox * 85 - tx * 70, 26, L.z + oz * 85 - tz * 70], target: [L.x + ox * 10 + tx * 25, 6, L.z + oz * 10 + tz * 25], fov: 0.8, aperture: 0.3, focus: 90 };
  } else if (kind === 'hero-rally') {
    // (the old hero, up the Rally's approach to the finish banner: kept to compare against)
    mode = 'rally';
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
  } else {
    // (the hero: out in the open sea heading for the stacks — the lighthouse islet off one bow, the cliffs of the coast
    // off the other, the horizon open between — the crews strung out at different distances, one of them alongside a
    // dinghy taking its people off, and a dinghy close by waving us on)
    const S = coast.islets.find((i) => i.kind === 'stacks') ?? coast.islets.find((i) => i.kind === 'islet') ?? coast.islets[0];
    const ahead = Number(params.get('ahead') ?? 200), [sx, sz] = wet(S.x - 0.45 * ahead, S.z + 0.9 * ahead, 30);
    const h = Math.atan2(S.x - sx, S.z - sz), dx = Math.sin(h), dz = Math.cos(h);
    // (f metres ahead along the heading, n to its right)
    const at = (f: number, n: number): [number, number] => [sx + dx * f - dz * n, sz + dz * f + dx * n];
    place(me, sx, sz, h, 8);
    const others = race.boats.filter((o) => o !== me), spots: [number, number, number][] = [[38, 16, 0], [72, -10, 6], [104, 34, 7], [56, 52, 5]];
    others.forEach((o, i) => place(o, ...at(spots[i][0], spots[i][1]), h + (i - 1.5) * 0.15, spots[i][2]));
    const crafts = race.crafts.filter((k) => k.craft.kind === 'row' || k.craft.kind === 'kayak' || k.craft.kind === 'paddle');
    // (alongside the nearest crew: a dinghy with its people climbing aboard)
    const busy = others[0], kb = crafts[0];
    if (kb) {
      const side = -1, [kx, kz] = world(busy, side * (HALF_BEAM + 0.95), -1.6);
      kb.x = kx; kb.z = kz; kb.yaw = busy.h + Math.PI; kb.stage = 'climb'; kb.by = busy.id; kb.side = side; kb.t = 0.4 * CLIMB; kb.called = true;
    }
    const where: [number, number][] = [[12, 11], [30, -16], [64, 30], [90, 2], [128, 18]];
    crafts.slice(1).forEach((k, i) => { if (i < where.length) { [k.x, k.z] = wet(...at(where[i][0], where[i][1]), 12); k.yaw = 1.3 * i + 0.4; k.called = true; } });
    for (const k of race.crafts) if (!crafts.slice(0, where.length + 1).includes(k)) k.z -= 2000;
    const back = 18.5, from = [me.x - dx * back - dz * 2.5, 7.4, me.z - dz * back + dx * 2.5];
    refCam = { from, target: [me.x + dx * 30, 0.8, me.z + dz * 30], fov: 0.8, aperture: 0.22, focus: 19 };
  }
  // (their wakes and spray, as if they'd been going a while)
  for (const b of race.boats) if (b.v > 0) for (let s = -5.5; s <= 0; s += 0.08) wakes.record(b.id, b.x + Math.sin(b.h) * b.v * s, b.z + Math.cos(b.h) * b.v * s, b.h, b.v, vt + s);
  for (let i = 0; i < 40; i++) { people(vt - (40 - i) / 30, 1 / 30); splashes(vt - (40 - i) / 30, 1 / 30); marks.step(1 / 30); }
}

// ─── start ───
setWeather((params.get('weather') ?? 'sunny') as WeatherName);
{
  const h = params.get('hand') ?? store.get('lily-rescue-boats-steer');
  setSteer(h === 'left' || h === 'right' ? h : 'touch', false);
}
{
  const k = params.get('kind') ?? store.get('lily-rescue-boats-kind');
  if (k === 'lifeboat' || k === 'inshore' || k === 'launch') boatKind = k;
}
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
    race.events.length = 0; sky();
    camYaw = followed().h; camAt.x = followed().x + Math.sin(camYaw) * 9; camAt.z = followed().z + Math.cos(camYaw) * 9;
    if (race.phase === 'over' || params.get('view') === 'podium') { runFor(race, 400); podium(); }
  } else { camYaw = 0; camAt.x = race.boats[mine].x; camAt.z = race.boats[mine].z + 9; }
}
resize();
requestAnimationFrame(frame);
