/**
 * Roof Jumps: a figure running over an endless city of rooftops, leaping whatever is in the way, in any direction.
 * A study of two things only: the procedural geometry (city.ts: chunks of boxes on a lattice) and the rigged figure
 * moving over it (runner.ts: the body and its judgement; rig.ts: the skeleton posed from it). It is drawn as plainly
 * as it can be (render.ts), on purpose, so that looks can be tried over the same geometry later.
 *
 * Top right: settings (the dials, with the look, another city and the notes in their looks tab) and the menu.
 *
 * Drag anywhere and the figure runs that way (the drag is a stick: further is faster). What it does about what's in
 * front of it is its own: it hops clutter, bounds and flips gaps, springs up a storey, dives down one and rolls out,
 * glides the long ones, dashes off a clean landing, balances along ledges, runs along and up walls. Tap to jump (and
 * once more in the air). A second finger turns the eye. Keys: WASD or the arrows, space, Q and E; P the plan, O the
 * dials, K hold time, L one step of it.
 *
 * It opens on the menu (menu.ts): every character along a high ledge over the city, backs turned, the eye behind one.
 * Swipe sideways on a character to choose who runs, on the sky for the time of day, on the city for another city, on
 * the roof for another look; tap (or Space) and the one chosen jumps where it stands; swipe up (or Take control, W,
 * ↑) and that one leaps off into the city. `?play` (or any
 * other flag) skips it; `?menu` asks for it whatever else is set; `time=dusk|golden hour|day|morning` the light.
 *
 * The studies (the dials' last tab): every scene and scripted test run above as a link, the dials kept.
 * The dials (tune.ts, under `dials`): every number of the run, the plan, the eye and time, turned while it runs; the
 * address keeps the ones that differ from the house, by their keys (`?gravity=14&plan&time=0.25`). The plan (plan.ts,
 * `?plan`): where this heading leads over the next few seconds, drawn into the city, with the best way to the left and
 * to the right of it; `?readout` says it in words; `?assist=1` steers onto the best.
 *
 * Other flags: `seed=` the city · `look=grid|clay|wire|tags|normals` how it's drawn · `auto` it runs itself, wandering
 * (by the plan's best way) · `t=` start that many seconds into such a run · `still` hold the frame · `preview` nothing
 * over the picture (and `auto`) · `far=` chunks drawn each way (4) · `side=90&zoom=1.6` the eye swung round the figure
 * and brought closer: for looking at the rig · `study=<move>&mu=` one move's pose held, that far through it (0..1) ·
 * `sheet=<move,move…>` a pose sheet: each of those moves at five points through it, the figure alone (with `side=90`,
 * from the side) · `scene=<key>` an authored scene (scenes.ts) · `from=x,z` start there (the street) · `hold=<radians>` one world direction held · `brush=1` from a stand, light pushes every way and a turn round (brush.ts), to see the feet (`brush=filmed`: the one 12 px back brush Astra filmed) · `strip=<seconds>` a stretch of its own run from there laid out frame by frame, the move named on
 * each (`frames=24`, `every=0.1`, `cols=6`).
 */
import { noise1 } from '../kit/rng';
import { City } from './city';
import { Runner } from './runner';
import type { Body, Input, Move } from './runner';
import { Rig } from './rig';
import { LOOKS, Renderer, invert } from './render';
import type { Look } from './render';
import { lookAt, mul, perspective } from './m4';
import { TUNE, readTune, writeTune, HOUSE } from './tune';
import { palette } from './palette';
import { plan, words } from './plan';
import type { Plan, Route } from './plan';
import { holdStrokes, planStrokes } from './plandraw';
import { follow } from './direct';
import { brushInput, FILMED } from './brush';
import { sceneByKey, SCENES } from './scenes';
import { heldBody } from './poses';
import { CHARACTERS, characterByName } from './character';
import { EYE_BACK, EYE_UP, TIMES, findLedge, idlePose, sunOf, underAt } from './menu';
import type { Ledge, Under } from './menu';
import type { Bone } from './rig';
import type { Follow, Waypoint } from './direct';

const q = new URLSearchParams(location.search);
let seed = Number(q.get('seed') ?? 1) | 0 || 1;
const preview = q.has('preview'), still = q.has('still');
readTune(q);
// (a preview is the picture alone: no tags on it)
if (preview) { TUNE.auto = 1; if (!q.has('holds')) TUNE.holds = 0; }
if (q.get('follow') === '0') TUNE.follow = 0;
if (preview) document.body.classList.add('preview');
// (nothing to be told when it's running itself, or held)
if (TUNE.auto || still) document.body.classList.add('played');

const canvas = document.getElementById('world') as HTMLCanvasElement;
const practiceLine = q.get('line') === 'transfer';
/** `scene=<key>`: one of the authored scenes (scenes.ts): its course, its scripted stick */
const scene = sceneByKey(q.get('scene')), sceneMem: Record<string, number> = {};
/** `character=<name>`: who runs (character.ts): its proportions, what it wears, its colours */
let character = characterByName(q.get('character'));
let city = new City(seed, practiceLine, scene?.course ?? null), runner = new Runner(city, character), rig = new Rig(character);
const rd = new Renderer(canvas, city);
rd.palette = character.palette;
/** the way the body faced at the start, that `brush=` pushes are turned from */
const brushHeading = runner.heading;
// (`from=x,z`: start there instead, on whatever's there: the street, to see it find its way up)
if (q.has('from')) { const [fx, fz] = q.get('from')!.split(',').map(Number); runner.x = fx; runner.z = fz; runner.y = city.heightAt(fx, fz); }
if (q.has('cost')) rd.strokes.cost = { depth: 0, city: 0, shadow: 0, figure: 0, stamps: 0, chunks: 0 };
rd.radius = Math.max(1, Math.min(8, Number(q.get('far') ?? 4) | 0));
if ((LOOKS as readonly string[]).includes(q.get('look') ?? '')) rd.look = q.get('look') as Look;
rd.resize(); addEventListener('resize', () => rd.resize());

// ─── the eye ──────────────────────────────────────────────────────────────────
/** `zoom=`: the eye brought that many times closer, for looking at the rig */
const zoom = Math.max(0.2, Number(q.get('zoom') ?? 1));
/** `fixed=x,y,z`: a still eye at that point in the world, turning only to keep the figure in view (a wide tripod on a
 * room, to judge it whole: what's there to be seen before it's needed); a scene may name its own (`Scene.eye`) */
const fixedEye = ((v) => (v && v.length === 3 && v.every(Number.isFinite) ? v : null))(q.get('fixed')?.split(',').map(Number));
/** the eye's heading, and what a second finger has added to its height */
let yaw = practiceLine ? 0 : 0.6, lift = TUNE.side ? -0.15 : 0;
/** the eye by what's happening: out wide and steady for a climb, low for a sprint (0..1, eased) */
let wideK = 0, lowK = 0;
const eyeAt = { x: runner.x, y: runner.y, z: runner.z };

// ─── the hand ─────────────────────────────────────────────────────────────────
// (the first finger down is the stick, wherever it lands; any other turns the eye; a short touch that hasn't moved is a jump)
const stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0, t: 0, moved: false };
const others = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
const keys = new Set<string>();
let jump = false;
/** when a jump was last tapped (performance.now ms) */
let tappedAt = -1e9;
const knob = document.getElementById('stick')!, nub = knob.firstElementChild as HTMLElement;
const REACH = 56;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (menu.active) { if (!menu.swipe) menu.swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), under: menuUnder(e.clientX, e.clientY) }; return; }
  if (stick.id < 0) {
    Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0, t: performance.now(), moved: false });
    knob.style.left = `${e.clientX}px`; knob.style.top = `${e.clientY}px`; nub.style.transform = '';
  } else others.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
  document.body.classList.add('played');
});
canvas.addEventListener('pointermove', (e) => {
  if (menu.active) return;
  if (e.pointerId === stick.id) {
    let x = (e.clientX - stick.x0) / REACH, y = (e.clientY - stick.y0) / REACH; const l = Math.hypot(x, y);
    // (a thumb that's moved the runner isn't a tap: the same tenth of the stick's reach that starts it moving (runner `on`), so a
    // small drag ending in a jump never happens)
    if (l > 0.1) { stick.moved = true; knob.classList.add('on'); }
    if (l > 1) { x /= l; y /= l; }
    stick.x = x; stick.y = y; nub.style.transform = `translate(${x * REACH}px,${y * REACH}px)`;
  } else {
    const o = others.get(e.pointerId); if (!o) return;
    const dx = e.clientX - o.x, dy = e.clientY - o.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) o.moved = true;
    if (o.moved) { yaw += dx * 0.007; lift = Math.max(-0.3, Math.min(1, lift + dy * 0.005)); o.x = e.clientX; o.y = e.clientY; }
  }
});
const up = (e: PointerEvent) => {
  if (menu.active) {
    // (sideways: change what's under the finger; up (a push forward): take control)
    const sw = menu.swipe; if (!sw || sw.id !== e.pointerId) return; menu.swipe = null;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
    if (e.type !== 'pointercancel' && Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.2) menuSwipe(sw.under, dx < 0 ? 1 : -1);
    else if (e.type !== 'pointercancel' && dy < -50 && -dy > Math.abs(dx)) takeControl();
    // (a tap: the one chosen jumps, there on the ledge, as a tap jumps in play)
    else if (e.type !== 'pointercancel' && Math.hypot(dx, dy) < 12 && performance.now() - sw.t < 260) menuJump();
    return;
  }
  const tap = (t: number, moved: boolean) => { if (e.type !== 'pointercancel' && !moved && performance.now() - t < 260) { jump = true; tappedAt = performance.now(); } };
  if (e.pointerId === stick.id) { tap(stick.t, stick.moved); stick.id = -1; stick.x = stick.y = 0; knob.classList.remove('on'); }
  else { const o = others.get(e.pointerId); if (o) tap(o.t, o.moved); others.delete(e.pointerId); }
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
const k = (...c: string[]) => (c.some((x) => keys.has(x)) ? 1 : 0);

// ─── the dials, and the plan ──────────────────────────────────────────────────
const dialsEl = document.getElementById('dials')!, dialsBtn = document.getElementById('dialsbtn')!, readout = document.getElementById('readout')!;
/** the plan as last thought, when, and how far the heading is being leant onto its best way (rad) */
let thinking: Plan | null = null, thought = -1, lean = 0;
/** the address keeps the dials that differ from the house */
function remember(): void { const u = new URL(location.href); writeTune(u.searchParams); history.replaceState(null, '', u); }
/**
 * The studies, from the dials: each authored scene (scenes.ts) and each scripted run the tests and tools use, as a link
 * that opens the page in it, the dials kept. What's running now, again from the start, or back to the free run.
 */
/** the eye's dials as a whole, by name: the chase eye (the house's), and a painter's (high, a long lens, framed for a tall
 * picture with the figure in its city, as the painted stills are) */
const CAMERAS: Record<string, Record<string, number>> = {
  chase: Object.fromEntries(['fov', 'eyeDist', 'eyePitch', 'rush', 'side'].map((k) => [k, HOUSE[k]])),
  painter: { fov: 30, eyeDist: 10, eyePitch: 34, rush: 2, side: 20 },
};
const STUDY_KEYS = ['scene', 'fixed', 'line', 'takeoff', 'catch', 'brush', 'from', 'hold', 'direct', 'sheet', 'study', 'mu', 'strip', 'frames', 'every', 'cols', 't', 'side', 'zoom', 'auto', 'lead', 'wall'];
const studyHref = (set: Record<string, string>) => { const u = new URL(location.href); for (const k of STUDY_KEYS) u.searchParams.delete(k); for (const [k, v] of Object.entries(set)) u.searchParams.set(k, v); return u.href; };
/** a street spot near the start for this seed, clear on every side (as the street-start tests find theirs) */
function streetSpot(): [number, number] | null {
  const c0 = city.start();
  for (let a = 0; a < 40; a++) { const ang = a * 2.39, d = 8 + a * 1.3, x = c0.x + Math.cos(ang) * d, z = c0.z + Math.sin(ang) * d; if (city.heightAt(x, z) < 0.5 && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([u, v]) => city.heightAt(x + u * 1.5, z + v * 1.5) < 0.5)) return [x, z]; }
  return null;
}
function studies(): HTMLElement[] {
  const now = location.search, here = (set: Record<string, string>) => { const want = new URL(studyHref(set)).searchParams; return STUDY_KEYS.every((k) => want.get(k) === new URLSearchParams(now).get(k)); };
  const link = (label: string, set: Record<string, string>, title = '', mark = true) => { const a = document.createElement('a'); a.textContent = label; a.href = studyHref(set); if (title) a.title = title; if (mark && here(set)) a.className = 'on'; return a; };
  const group = (name: string, items: HTMLElement[]) => { const g = document.createElement('div'); g.className = 'studies'; const h = document.createElement('h3'); h.textContent = name; const l = document.createElement('div'); l.className = 'list'; l.append(...items); g.append(h, l); return g; };
  const cur = Object.fromEntries(STUDY_KEYS.filter((k) => q.has(k)).map((k) => [k, q.get(k) ?? '']));
  const spot = streetSpot();
  return [
    group('now', [link('free run', {}), ...(Object.keys(cur).length ? [link('again', cur, 'this study from its start', false)] : []), link('it runs itself', { auto: '1' }, 'wandering by the plan\'s best way')]),
    group('scenes', SCENES.flatMap((sc) => [link(sc.title, { scene: sc.key }, sc.asks), ...(sc.eye ? [link('↳ still eye', { scene: sc.key, fixed: '1' }, `${sc.title}, from a still eye on the room`)] : [])])),
    group('test runs', [
      link('the transfer line', { line: 'transfer' }), link('takeoff: standing', { line: 'transfer', takeoff: 'stand' }), link('takeoff: off a step', { line: 'transfer', takeoff: 'step' }), link('takeoff: at a run', { line: 'transfer', takeoff: 'run' }),
      link('catch: clean', { line: 'transfer', catch: 'clean' }), link('catch: turned late', { line: 'transfer', catch: 'late' }), link('catch: corrected in the air', { line: 'transfer', catch: 'correct' }),
      link('brushes from a stand', { brush: '1' }, 'light pushes every way and a turn round, to see the feet'), link('the filmed brush', { brush: 'filmed' }, '12 px straight back for 133 ms, from a stand: the first regression for small moves'),
      ...(spot ? [0, 1, 2, 3].map((k) => link(`from the street, held ${['north', 'east', 'south', 'west'][k]}`, { from: `${spot[0].toFixed(1)},${spot[1].toFixed(1)}`, hold: String(((k * Math.PI) / 2 + 0.3).toFixed(3)) })) : []),
      ...[0, 1, 2, 3].map((k) => link(`a held line ${['north', 'east', 'south', 'west'][k]}`, { hold: String(((k * Math.PI) / 2 + 0.1).toFixed(3)) })),
      link('poses on the ground', { sheet: 'run,dash,ledge,roll', side: '90', zoom: '2.1' }), link('poses in the air', { sheet: 'hop,bound,flip,spring,dive', side: '90', zoom: '2.1' }), link('its own run, frame by frame', { strip: '5', frames: '30', every: '0.1' }),
    ]),
  ];
}
/** the looks (looks.ts), from the dials: each a button, the one drawn marked; kept in the address */
function looks(): HTMLElement[] {
  const group = (title: string, items: [string, boolean, () => void][]) => {
    const g = document.createElement('div'); g.className = 'studies'; const h = document.createElement('h3'); h.textContent = title; const l = document.createElement('div'); l.className = 'list';
    for (const [name, on, act] of items) { const a = document.createElement('a'); a.textContent = name; a.href = '#'; if (on) a.className = 'on'; a.addEventListener('click', (e) => { e.preventDefault(); act(); pal.refresh(); }); l.append(a); }
    g.append(h, l); return g;
  };
  const cam = (name: string) => Object.entries(CAMERAS[name]).every(([k, v]) => TUNE[k] === v);
  const notes = (document.getElementById('notes') as HTMLAnchorElement | null)?.href;
  return [
    group('page', [['another city', false, anotherCity], ...(notes ? [['notes', false, () => { location.href = notes; }] as [string, boolean, () => void]] : [])]),
    group('look', LOOKS.map((name) => [name, name === rd.look, () => setLook(name)])),
    group('character', CHARACTERS.map((c) => [c.title, c.name === character.name, () => { const u = new URL(location.href); if (c.name === 'runner') u.searchParams.delete('character'); else u.searchParams.set('character', c.name); location.href = u.href; }])),
    group('camera', Object.keys(CAMERAS).map((name) => [name, cam(name), () => { for (const [k, v] of Object.entries(CAMERAS[name])) TUNE[k] = v; remember(); }])),
  ];
}
const pal = palette(dialsEl, () => { remember(); thought = -1; }, [{ name: 'looks', build: looks }, { name: 'studies', build: studies }]);
dialsBtn.addEventListener('click', () => { const on = dialsEl.classList.toggle('shown'); dialsBtn.setAttribute('aria-expanded', String(on)); });
const flip = (key: string) => { TUNE[key] = TUNE[key] ? 0 : 1; remember(); pal.refresh(); thought = -1; };
let stepOnce = false;
addEventListener('keydown', (e) => {
  if (menu.active) {
    const c = e.code;
    if (c === 'ArrowLeft' || c === 'KeyA') menuSwipe({ kind: 'character', i: menu.sel }, -1);
    else if (c === 'ArrowRight' || c === 'KeyD') menuSwipe({ kind: 'character', i: menu.sel }, 1);
    else if (c === 'ArrowUp' || c === 'KeyW' || c === 'Enter') takeControl();
    else if (c === 'Space') { if (!e.repeat) menuJump(); }
    else if (c === 'KeyT') menuSwipe({ kind: 'sky' }, 1);
    else if (c === 'KeyG') menuSwipe({ kind: 'city' }, 1);
    else if (c === 'KeyV') menuSwipe({ kind: 'roof' }, 1);
    else return;
    e.preventDefault(); return;
  }
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Space' && !e.repeat) { jump = true; tappedAt = performance.now(); }
  if (e.code === 'KeyP') flip('plan');
  if (e.code === 'KeyK') flip('pause');
  if (e.code === 'KeyL') stepOnce = true;
  if (e.code === 'KeyO') dialsBtn.click();
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  document.body.classList.add('played');
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const wantsPlan = () => !!(TUNE.plan || TUNE.readout || TUNE.assist > 0 || TUNE.auto);

/** what's asked: a direction on the ground (the stick's, turned from the screen's by the eye; or a wander's) */
function asked(t: number): Input {
  // (`takeoff=stand|step|run`, on the practice line: a scripted approach up the first roof and a tap, to film the takeoffs side
  // by side: standing still, off a single step, at a run)
  // (`catch=clean|late|correct`, on the practice line: a diagonal run to the first gap and the bound across it, three ways:
  // clean; turned late, just before the lip; corrected shallowly in the flight. To see where the save's foot goes)
  // (`direct=x,z;x,z…`: a directed run (devtools/roofjumps-direct.mjs), its waypoints followed as the director followed them)
  // (`brush=1`: from a stand, short light pushes every way and a turn round (brush.ts), to see the feet)
  if (brushStudy) return brushInput(t, brushHeading, q.get('brush') === 'filmed' ? FILMED : undefined);
  // (on the frame's own time, as runScene gives it: a summed clock drifts, and a scene's timing can turn on one frame)
  if (scene) return scene.input(Math.round(t / DT) * DT, runner, sceneMem);
  // (`hold=<radians>`: one world direction held hard, as the tests hold a line; with `from=x,z`, from the street)
  if (holdAt !== null) return { x: Math.sin(holdAt), z: Math.cos(holdAt), jump: false };
  if (directed) return follow(runner, directed, directedAt, DT);
  if (catchStudy) {
    const r = runner, d = { x: 0.3, z: 0.95 };
    if (catchStudy === 'late' && r.z > 13.4 && r.state === 'ground' && r.z < 16) return { x: 0.55, z: 0.83, jump: false };
    if (catchStudy === 'correct' && r.state === 'air') return { x: -0.2, z: 0.98, jump: false };
    return { ...d, jump: false };
  }
  if (takeoff) {
    const go = takeoff === 'stand' ? 0 : takeoff === 'step' ? 0.1 : 0.35, tapAt = go + 0.25;
    const moving = takeoff !== 'stand' && t < tapAt + 1.5;
    return { x: 0, z: moving ? (takeoff === 'step' ? 0.35 : 1) : 0, jump: Math.abs(t - tapAt) < 0.5 / 120 };
  }
  // (just taken control from the menu: off the ledge, out over the city, before the hand's own)
  if (menu.launch > 0 && t < menu.launch && Math.hypot(stick.x, stick.y) < 0.2) return { x: Math.sin(menu.heading), z: Math.cos(menu.heading), jump: false };
  let sx = stick.x + k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), sy = stick.y + k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
  const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; }
  const fx = Math.sin(yaw), fz = Math.cos(yaw), j = jump; jump = false;
  // (the jump held, to glide: Space held, or a touch held still past a tap)
  const now = performance.now(), still = (o: { t: number; moved: boolean }) => !o.moved && now - o.t > 260;
  // (but not the thumb resting on the stick from before the jump: with two fingers, the other taps the jump, and a still thumb
  // isn't holding it; with one, the finger that tapped and pressed again is)
  const hold = keys.has('Space') || (stick.id >= 0 && still(stick) && stick.t >= tappedAt - 300) || [...others.values()].some(still);
  const own: Input = { x: fx * -sy + -fz * sx, z: fz * -sy + fx * sx, jump: j, hold };
  if (TUNE.auto) {
    // (by itself: wandering, the heading a slow noise, drawn toward the city's own two directions: along its alleys, its
    // walls, its ledges. But a hand on it takes over at once (the stick, the keys, a tap, a hold), for as long as it's on;
    // let go, the wander comes back in over a second and a half, from the way it was last sent)
    const w = 7 * noise1(seed + 9, t * 0.06) + t * 0.04, a = w - 0.22 * Math.sin(4 * w), wander = { x: Math.sin(a), z: Math.cos(a) };
    const m = Math.hypot(own.x, own.z);
    if (m > 0.1 || own.jump || own.hold) { taken = t; if (m > 0.1) { ownDir.x = own.x / m; ownDir.z = own.z / m; } return own; }
    const back = Math.min(1, (t - taken) / 1.5), e = back * back * (3 - 2 * back), bx = ownDir.x * (1 - e) + wander.x * e, bz = ownDir.z * (1 - e) + wander.z * e, bl = Math.hypot(bx, bz) || 1;
    return taken > -9 && back < 1 ? { x: bx / bl, z: bz / bl, jump: false } : { ...wander, jump: false };
  }
  return own;
}
/** auto, taken over: when a hand was last on it, and the way it sent it */
let taken = -99; const ownDir = { x: 0, z: 1 };
const takenOver = (t: number) => t - taken < 1.5;
/** the plan about what's asked (with nothing asked, about the way it faces) */
function think(a: Input, t: number): void {
  const m = Math.hypot(a.x, a.z);
  // (foreseen at the press actually held: easing off shows a careful line, not a committed one; let go, where a full press
  // would take it)
  const k = m > 0.1 ? Math.min(1, m) / m : 0;
  thinking = plan(runner, m > 0.1 ? a.x * k : Math.sin(runner.heading), m > 0.1 ? a.z * k : Math.cos(runner.heading)); thought = t;
}
/** what the runner is given: what's asked, leant onto the plan's best way as far as `assist` says (all the way, by itself) */
function input(t: number, dt: number): Input {
  const a = asked(t), mag = Math.hypot(a.x, a.z);
  if (wantsPlan() && (thought < 0 || t - thought >= 0.12)) think(a, t);
  // (by itself, all the way onto the plan; taken over, only as far as `assist` says, like any run of yours)
  const by = takeoff || catchStudy || directed || brushStudy || scene || holdAt !== null ? 0 : TUNE.auto && !takenOver(t) ? 1 : TUNE.assist;
  lean += ((thinking && by > 0 && mag > 0.1 ? thinking.best.off * by : 0) - lean) * (1 - Math.exp(-5 * dt));
  if (Math.abs(lean) < 1e-4 || mag <= 0.1) return a;
  // (to the right is a smaller angle: see plan.ts)
  const c = Math.cos(-lean), s = Math.sin(-lean);
  return { x: a.x * c + a.z * s, z: a.z * c - a.x * s, jump: a.jump, hold: a.hold };
}

// ─── a pose held, to be looked at (`study=`, and `__roofjumps.pose`) ───────────
let held: Body | null = null;
function hold(move: string, mu: number, lead = 1, wallSide = 1): void {
  held = heldBody(runner, move, mu, lead, wallSide, runner.build.reachScale);
  yaw = 0; lift = -0.14;
}
if (q.get('study')) hold(q.get('study')!, Number(q.get('mu') ?? 0.5), Number(q.get('lead') ?? 1), Number(q.get('wall') ?? 1));

// ─── the study sheets: many small pictures in the one canvas ───────────────────
const labels = document.getElementById('labels')!;
/** `sheet=`: the moves to lay out, each at these points through it */
const sheet = q.get('sheet')?.split(',').filter(Boolean) ?? null, MUS = [0.05, 0.28, 0.5, 0.72, 0.95];
/** `strip=`: moments of the run, each kept as it was: the figure's bones, where it was, which way it was going */
interface Moment { bones: ReturnType<Rig['bones']>; x: number; y: number; z: number; yaw: number; label: string; feet: number[][]; saved: boolean; wide: number }
let strip: Moment[] | null = null;
const stripCols = Math.max(1, Number(q.get('cols') ?? 6) | 0);
function grid(cols: number, names: string[]): void {
  document.body.classList.add('sheet');
  labels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  labels.replaceChildren(...names.map((n) => { const s = document.createElement('span'); s.textContent = n; return s; }));
}

// ─── the frame ────────────────────────────────────────────────────────────────
const DT = 1 / 120;
/** `takeoff=`: a scripted takeoff to film (see `asked`) */
const takeoff = q.get('takeoff'), catchStudy = q.get('catch'), brushStudy = q.has('brush'), holdAt = q.has('hold') ? Number(q.get('hold')) : null;
const directed: Waypoint[] | null = q.get('direct') ? q.get('direct')!.split(';').map((p) => { const [x, z, a, s] = p.split(',').map(Number); return [x, z, a, s] as Waypoint; }) : null, directedAt: Follow = { i: 0, t: 0 };
let time = 0, acc = 0, last = performance.now(), frames = 0, rush = 0, near = 1;
const advance = (dt: number) => { runner.step(dt, input(time, dt)); rig.update(dt, runner); time += dt; };
// (`t=`: run on to there before the first frame)
for (let n = Math.round(Number(q.get('t') ?? 0) / DT); n > 0; n--) advance(DT);
Object.assign(eyeAt, { x: runner.x, y: runner.y, z: runner.z });
if (TUNE.auto && runner.speed > 1) yaw = Math.atan2(runner.vx, runner.vz);
if (sheet) grid(MUS.length, sheet.flatMap((m) => MUS.map((u) => `${m} ${u}`)));
if (q.has('strip')) {
  // (run on to there, then on from there a frame at a time, keeping each)
  if (!takeoff && !catchStudy && !directed && !brushStudy && !scene && holdAt === null) TUNE.auto = 1; strip = [];
  const n = Math.max(1, Number(q.get('frames') ?? 24) | 0), every = Math.max(DT, Number(q.get('every') ?? 0.1));
  for (let i = Math.round(Number(q.get('strip')) / DT); i > 0; i--) advance(DT);
  for (let f = 0; f < n; f++) {
    const saving = !!runner.saveKind;
    strip.push({ bones: rig.bones(runner), x: runner.x, y: runner.y, z: runner.z, yaw: runner.speed > 1 && (runner.state === 'ground' || runner.state === 'air') ? Math.atan2(runner.vx, runner.vz) : runner.heading, wide: ['climb', 'plant', 'chimney', 'swing', 'wall'].includes(runner.state) || runner.move === 'kick' ? 1 : 0, label: `${time.toFixed(2)}s ${runner.move}${saving ? ` save:${runner.saveKind}` : ''} ${runner.speed.toFixed(0)}m/s`, feet: [runner.reach.fl, runner.reach.fr].filter(Boolean).map((f) => [...f!]), saved: saving });
    for (let i = Math.round(every / DT); i > 0; i--) advance(DT);
  }
  grid(stripCols, strip.map((m) => m.label));
}
rd.stream(runner.x, runner.z, 9);

function setLook(name: string): void { rd.look = name; const u = new URL(location.href); u.searchParams.set('look', rd.look); history.replaceState(null, '', u); }
document.getElementById('seed')!.textContent = String(seed);
/** another city: on the menu, its next ledge, there and then; in play, the page again on a new seed */
function anotherCity(): void {
  if (menu.active) { menuSwipe({ kind: 'city' }, 1 + Math.floor(Math.random() * 50)); return; }
  const u = new URL(location.href); u.searchParams.set('seed', String(1 + Math.floor(Math.random() * 9999))); location.href = u.href;
}
document.getElementById('menubtn')?.addEventListener('click', backToMenu);

/** a route in a line: how far off the way asked, its moves, what it's worth */
const line = (name: string, r: Route | null, p: Plan) => (r ? `${r === p.best ? '★' : ' '} ${name} ${r.off ? `${r.off > 0 ? '→' : '←'}${Math.abs(Math.round((r.off * 180) / Math.PI))}° ` : ''}${words(r)}  [${r.score.toFixed(0)}${r.streets ? ', street' : ''}]` : '');

/** the eye for a figure at (x, y, z) going `heading`: the matrix, and where the eye is (never inside a building: it
 * comes in along its own line to just short of whatever is between it and the figure, as far as `room` says, 0..1) */
function eyeFor(x: number, y: number, z: number, heading: number, aspect: number, room: (at: (f: number) => number[]) => number, wide = 0, low = 0, shake: number[] = [0, 0, 0, 0]) {
  const dist = (TUNE.eyeDist * (aspect < 1 ? 1.22 : 1) * (1 + 0.6 * wide - 0.1 * low)) / zoom, fov = ((zoom > 1 ? 50 : TUNE.fov + (aspect < 1 ? 12 : 0)) + rush) * Math.PI / 180;
  const pitch = Math.max(0.02, Math.min(1.45, ((TUNE.eyePitch + 12 * wide - 6 * low) * Math.PI) / 180 + lift));
  const ty = y + (zoom > 1 ? 0.95 : 1.7), c = Math.cos(pitch), ya = heading + (TUNE.side * Math.PI) / 180;
  const at = (f: number) => [x - Math.sin(ya) * c * dist * f, ty + Math.sin(pitch) * dist * f, z - Math.cos(ya) * c * dist * f];
  const far = room(at), e0 = at(far);
  // (the eye's own motion (lope and impact): a shift of the eye across and up, a roll about its line, a narrowing of the lens)
  const rx = Math.cos(ya), rz = -Math.sin(ya), eye = [e0[0] + rx * shake[0], e0[1] + shake[1], e0[2] + rz * shake[0]], roll = shake[2];
  const up = [Math.sin(roll) * rx, Math.cos(roll), Math.sin(roll) * rz];
  return { far, eye, vp: mul(perspective(fov - shake[3] * Math.PI / 180, aspect, 0.15, rd.radius * 64 * 1.5), lookAt(eye, [x, ty + shake[1] * 0.4, z], up)) };
}
/** how far out the eye can be before something is in the way */
const clearTo = (at: (f: number) => number[]) => {
  // (along its line, and a little to either side of it: in an alley the walls beside the line are in the way too)
  const o = at(0), q = at(1), lx = q[2] - o[2], lz = -(q[0] - o[0]), ll = Math.hypot(lx, lz) || 1, sx = (lx / ll) * 0.45, sz = (lz / ll) * 0.45;
  for (let f = 0.1; f <= 1.001; f += 0.1) { const p = at(f); if ([0, 1, -1].some((k) => city.heightAt(p[0] + sx * k, p[2] + sz * k) > p[1] - 0.25)) return Math.max(0.12, f - 0.1); }
  return 1;
};
const shadowAt = (x: number, y: number, z: number) => { const under = city.heightAt(x, z), h = Math.max(0, y - under); return { x, y: under, z, r: 0.5 * (1 - 0.4 * Math.min(1, h / 12)), a: 0.4 * (1 - 0.6 * Math.min(1, h / 20)) }; };

/** A sheet: the canvas cut into cells, a picture in each. */
function cells(cols: number, n: number, each: (i: number, aspect: number, rect: [number, number, number, number]) => void): void {
  rd.resize();
  const rows = Math.ceil(n / cols), w = canvas.width / cols, h = canvas.height / rows;
  for (let i = 0; i < n; i++) each(i, w / h, [Math.round((i % cols) * w), Math.round(canvas.height - (Math.floor(i / cols) + 1) * h), Math.round(w), Math.round(h)]);
}

// ─── the menu (menu.ts): the page as it opens, the characters along a ledge ────
/** the menu, when the page is opened plainly (only these flags, or `menu`); `play` (or any other flag) skips it */
const MENU_FLAGS = new Set(['seed', 'look', 'character', 'time', 'far', 'menu']);
const menu = {
  active: q.has('menu') || [...q.keys()].every((key) => MENU_FLAGS.has(key)),
  ledge: null as Ledge | null, sel: 0, at: 0, timeI: 0, rigs: [] as Rig[],
  /** the others, left on the ledge once one's taken, and which one was */
  crew: [] as Bone[], crewI: -1,
  vp: null as Float32Array | null, eye: [0, 0, 0], target: [0, 0, 0], fov: 1,
  launch: -1, heading: 0, blend: 1, from: null as { eye: number[]; target: number[]; fov: number } | null,
  swipe: null as { id: number; x: number; y: number; t: number; under: Under } | null,
  /** the one chosen, jumping where it stands (a tap): a runner of its own for the while, the game's own jump */
  hop: null as { i: number; r: Runner; rig: Rig; acc: number; jump: boolean; up: boolean; down: number; t: number } | null,
  /** how attentive each is (0 resting … 1 chosen, eased), and when each was last chosen (s, for the look back) */
  attention: [] as number[], chosenAt: [] as number[],
};
/** who stands where along the ledge, left to right as the eye sees them: the runner centre-left, as on the poster */
const ORDER = ((names) => { const o = names.map((nm) => CHARACTERS.findIndex((c) => c.name === nm)).filter((i) => i >= 0); for (let i = 0; i < CHARACTERS.length; i++) if (!o.includes(i)) o.push(i); return o; })(['broad', 'teen', 'runner', 'slight', 'child', 'older']);
const menuEl = document.getElementById('menu'), menuSay = document.getElementById('menusay');
let sayUntil = 0;
function say(text: string): void { if (!menuSay) return; menuSay.textContent = text; sayUntil = performance.now() + 1800; }
/** a time of day for the light: relative to the way the ledge looks (or north, out of the menu) */
function applyTime(): void { const T = TIMES[menu.timeI]; rd.time = { sun: sunOf(T, menu.ledge?.heading ?? 0), sky: T.sky, fog: T.fog, fogNear: T.fogNear }; }
/** find this city's ledge and stand everyone along it (another seed tried if this one has none) */
function placeMenu(): void {
  for (let n = 0; n < 12 && !(menu.ledge = findLedge(city, CHARACTERS.length)); n++) { seed++; city = new City(seed); rd.setCity(city); }
  // (the first landing, across the gap from the middle of the line: the paint picks it out)
  // (the first roof below the ledge that the eye can see, out along the way it looks: what's under a roof right at the
  // lip is mostly hidden by the lip itself)
  {
    const L = menu.ledge; rd.focus = null;
    if (L) {
      const m = L.spots[L.spots.length >> 1], eye = [m[0] - L.n[0] * EYE_BACK, m[1] + EYE_UP, m[2] - L.n[2] * EYE_BACK];
      // (and enough of it seen to be a place to land, not a sliver past the lip: three metres of its top in view)
      const seenOf = new Map<object, number>();
      for (let s = 1.2; s < 40 && !rd.focus; s += 0.5) {
        const x = m[0] + L.n[0] * s, z = m[2] + L.n[2] * s, h = city.heightAt(x, z);
        if (h < 2 || h > L.y - 0.5) continue;
        let seen = true;
        for (let k = 0.05; k < 0.97 && seen; k += 0.03) { const qx = eye[0] + (x - eye[0]) * k, qz = eye[2] + (z - eye[2]) * k, qy = eye[1] + (h - eye[1]) * k; if (city.heightAt(qx, qz) > qy + 0.05) seen = false; }
        const b = seen ? city.topAt(x, z) : null; if (!b) continue;
        const n = (seenOf.get(b) ?? 0) + 0.5; seenOf.set(b, n);
        if (n >= 3) rd.focus = { x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1, y: b.y1 };
      }
    }
  }
  menu.rigs = CHARACTERS.map((c) => new Rig(c));
  rd.palette = CHARACTERS.flatMap((c) => c.palette);
  applyTime();
  document.getElementById('seed')!.textContent = String(seed);
}
/**
 * Everyone on the ledge but `skip`, standing about, facing out (menu.ts idlePose): the one chosen attentive, looking back
 * over its shoulder at the eye as it's chosen; once one has gone (`watch`), the rest following it with their heads.
 * Each dressed from its own eight of the palette.
 */
function crewBones(skip: number, dt = 0, watch: number[] | null = null): Bone[] {
  const L = menu.ledge!, out: Bone[] = [], now = performance.now() / 1000;
  ORDER.forEach((i, slot) => {
    if (i === skip) return;
    const p = L.spots[slot], rg = menu.rigs[i], body = heldBody({ x: p[0], y: p[1], z: p[2] }, 'stand', 0.15 + ((i * 0.37) % 0.7), i % 2, 1, rg.body.reachScale);
    body.heading = L.heading; rg.update(1, body);
    const want = !watch && menu.active && slot === menu.sel ? 1 : 0, cur = menu.attention[i] ?? want;
    menu.attention[i] = cur + (want - cur) * (1 - Math.exp(-(want > cur ? 5 : 2.5) * dt));
    // (the look: back at the eye just after being chosen (a rise, a hold, a turn away again); or toward the runner)
    let yaw = 0, pitch = 0;
    const toward = (q: number[], most: number) => {
      const dx = q[0] - p[0], dz = q[2] - p[2]; let a = Math.atan2(dx, dz) - L.heading; a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
      return Math.max(-most, Math.min(most, a));
    };
    if (watch) { yaw = toward(watch, 1.3); pitch = Math.max(-0.5, Math.min(0.3, Math.atan2(watch[1] - p[1] - 1.6, Math.hypot(watch[0] - p[0], watch[2] - p[2]) + 0.1))) * -1; }
    else if (want) {
      const s = now - (menu.chosenAt[i] ?? -99), g = s < 0 ? 0 : s < 0.35 ? s / 0.35 : s < 0.95 ? 1 : s < 1.7 ? 1 - (s - 0.95) / 0.75 : 0;
      yaw = g * g * (3 - 2 * g) * toward(menu.eye, 1.15); pitch = -0.08 * g;
    }
    if (menu.hop && menu.hop.i === i) { for (const b of menu.hop.rig.bones(menu.hop.r)) out.push({ ...b, mat: (b.mat ?? 0) + 8 * i }); return; }
    const bones = rg.bones(body);
    idlePose(bones, { heading: L.heading, attention: menu.attention[i], look: { yaw, pitch }, t: now, seed: i + 1 });
    for (const b of bones) out.push({ ...b, mat: (b.mat ?? 0) + 8 * i });
  });
  return out;
}
/** the runner's bones, and (once taken from the menu) the others on the ledge with it */
function withCrew(own: Bone[], dt = 0): Bone[] { if (menu.crewI < 0) return own; menu.crew = crewBones(menu.crewI, dt, [runner.x, runner.y + 1, runner.z]); return [...own.map((b) => ({ ...b, mat: (b.mat ?? 0) + 8 * menu.crewI })), ...menu.crew]; }
/** the eye on the ledge: behind the one chosen (between two, as it moves along), a little above their heads, looking out */
function menuView(aspect: number, now: number) {
  const L = menu.ledge!, s = Math.max(0, Math.min(L.spots.length - 1, menu.at)), i0 = Math.floor(s), i1 = Math.min(L.spots.length - 1, i0 + 1), f = s - i0;
  const P = [0, 1, 2].map((k) => L.spots[i0][k] + (L.spots[i1][k] - L.spots[i0][k]) * f), n = L.n, t = L.t, back = aspect < 1 ? EYE_BACK : EYE_BACK - 1.2;
  // (breathing: a hand-held eye, barely)
  const sway = 0.25 + Math.sin(now * 0.31) * 0.07, bob = Math.sin(now * 0.23) * 0.04;
  const eye = [P[0] - n[0] * back + t[0] * sway, P[1] + EYE_UP + bob, P[2] - n[2] * back + t[2] * sway], target = [P[0] + n[0] * 30, P[1] - 5.5, P[2] + n[2] * 30];
  const fov = ((aspect < 1 ? 48 : 38) * Math.PI) / 180;
  return { eye, target, fov, vp: mul(perspective(fov, aspect, 0.15, rd.radius * 64 * 1.5), lookAt(eye, target, [0, 1, 0])) };
}
/** a tap in the menu: the one chosen jumps where it stands (again, in the air: the second jump, as in play) */
function menuJump(): void {
  const L = menu.ledge; if (!L) return;
  const i = ORDER[menu.sel];
  if (menu.hop && menu.hop.i === i) { menu.hop.jump = true; return; }
  const p = L.spots[menu.sel], r = new Runner(city, CHARACTERS[i]); r.x = p[0]; r.y = p[1]; r.z = p[2]; r.heading = L.heading;
  const rg = new Rig(CHARACTERS[i]); rg.update(1, r);
  menu.hop = { i, r, rig: rg, acc: 0, jump: true, up: false, down: 0, t: 0 };
}
/** the jump on: stepped as play steps, until it's down, settled, and back to standing about */
function hopFrame(dt: number): void {
  const h = menu.hop; if (!h) return;
  h.acc += dt;
  while (h.acc >= DT) {
    h.r.step(DT, { x: 0, z: 0, jump: h.jump }); h.jump = false; h.rig.update(DT, h.r); h.acc -= DT; h.t += DT;
    if (h.r.state !== 'ground') h.up = true; else if (h.up) h.down += DT;
  }
  // (down and still a moment, or it never left, or it has wandered: back to its place, standing about)
  const p = menu.ledge!.spots[ORDER.indexOf(h.i)];
  if ((h.up && h.down > 0.6 && h.r.speed < 0.4) || (!h.up && h.t > 1) || h.t > 4 || Math.hypot(h.r.x - p[0], h.r.z - p[2]) > 1.5) menu.hop = null;
}
function menuFrame(dt: number): void {
  const L = menu.ledge!;
  hopFrame(dt);
  if (menu.hop && menu.hop.i !== ORDER[menu.sel] && menu.hop.r.state === 'ground') menu.hop = null;
  menu.at += (menu.sel - menu.at) * (1 - Math.exp(-6 * dt));
  rd.resize();
  const v = menuView(canvas.width / canvas.height, performance.now() / 1000);
  Object.assign(menu, { vp: v.vp, eye: v.eye, target: v.target, fov: v.fov });
  const c = L.spots[Math.round(menu.at)];
  rd.stream(c[0], c[2], 3);
  rd.draw(v.vp, v.eye, crewBones(-1, dt), shadowAt(c[0], c[1], c[2]));
  if (menuSay && sayUntil && performance.now() > sayUntil) { menuSay.textContent = 'Swipe to choose'; sayUntil = 0; }
}
/** what's under a point of the page, on the ledge's picture */
function menuUnder(cx: number, cy: number): Under {
  if (!menu.vp || !menu.ledge) return { kind: 'city' };
  return underAt([(cx / canvas.clientWidth) * 2 - 1, 1 - (cy / canvas.clientHeight) * 2], menu.vp, invert(menu.vp), menu.eye, city, menu.ledge);
}
/** a sideways swipe on something: the next (d = 1) or the last of what it changes */
function menuSwipe(u: Under, d: number): void {
  if (u.kind === 'character') { const s = Math.max(0, Math.min(ORDER.length - 1, menu.sel + d)); if (s !== menu.sel) { menu.sel = s; menu.chosenAt[ORDER[s]] = performance.now() / 1000; } say(CHARACTERS[ORDER[menu.sel]].title); }
  else if (u.kind === 'sky') { menu.timeI = (menu.timeI + d + TIMES.length) % TIMES.length; applyTime(); say(TIMES[menu.timeI].name); }
  else if (u.kind === 'roof') { setLook(LOOKS[(LOOKS.indexOf(rd.look) + d + LOOKS.length) % LOOKS.length]); say(rd.look); }
  else {
    seed = Math.max(1, seed + d); city = new City(seed); rd.setCity(city); runner = new Runner(city, character); placeMenu(); say(`seed ${seed}`);
  }
  const u2 = new URL(location.href);
  u2.searchParams.set('seed', String(seed)); u2.searchParams.set('character', CHARACTERS[ORDER[menu.sel]].name); u2.searchParams.set('time', TIMES[menu.timeI].name); u2.searchParams.set('look', rd.look);
  history.replaceState(null, '', u2);
}
/**
 * Back to the menu (the round button): the line on the ledge again, the eye behind whoever was running. From play that
 * began on the menu, in place; from a study or a scene, the page opened afresh on its city's menu.
 */
function backToMenu(): void {
  if (menu.active) return;
  if (!menu.ledge) { const u = new URL(location.origin + location.pathname); for (const k of ['seed', 'look', 'character', 'time']) { const v = new URL(location.href).searchParams.get(k); if (v) u.searchParams.set(k, v); } u.searchParams.set('menu', ''); location.href = u.href; return; }
  Object.assign(menu, { active: true, crewI: -1, crew: [], hop: null, launch: -1, from: null, blend: 1, swipe: null });
  menu.sel = menu.at = Math.max(0, ORDER.indexOf(CHARACTERS.findIndex((c) => c.name === character.name)));
  menu.chosenAt[ORDER[menu.sel]] = performance.now() / 1000 + 0.6;
  rd.palette = CHARACTERS.flatMap((c) => c.palette);
  dialsEl.classList.remove('shown'); dialsBtn.setAttribute('aria-expanded', 'false');
  document.body.classList.add('menu'); if (menuEl) menuEl.hidden = false;
}
/** the one the eye is behind takes the leap: it's the runner now, and the hand's */
function takeControl(): void {
  if (!menu.active || !menu.ledge) return;
  menu.hop = null;
  const L = menu.ledge, i = ORDER[menu.sel], p = L.spots[menu.sel];
  character = CHARACTERS[i]; runner = new Runner(city, character); runner.x = p[0]; runner.y = p[1]; runner.z = p[2]; runner.heading = L.heading;
  rig = new Rig(character); rig.update(1, runner);
  menu.crew = crewBones(i); menu.crewI = i;
  yaw = L.heading; Object.assign(eyeAt, { x: p[0], y: p[1], z: p[2] }); near = 1;
  menu.from = { eye: menu.eye, target: menu.target, fov: menu.fov }; menu.blend = 0;
  menu.launch = time + 1.4; menu.heading = L.heading; menu.active = false;
  document.body.classList.remove('menu'); document.body.classList.add('played'); if (menuEl) menuEl.hidden = true;
  const u = new URL(location.href); u.searchParams.set('character', character.name); history.replaceState(null, '', u);
}
if (menu.active) {
  if (!q.has('look')) rd.look = 'gouache';
  menu.sel = menu.at = Math.max(0, ORDER.indexOf(CHARACTERS.findIndex((c) => c.name === character.name)));
  menu.timeI = Math.max(0, TIMES.findIndex((t) => t.name === q.get('time')));
  placeMenu();
  // (the one the eye opens behind glances back at it, a moment after)
  menu.chosenAt[ORDER[menu.sel]] = performance.now() / 1000 + 1.2;
  document.body.classList.add('menu'); if (menuEl) menuEl.hidden = false;
  document.getElementById('take')?.addEventListener('click', takeControl);
} else if (q.has('time')) { const i = TIMES.findIndex((t) => t.name === q.get('time')); if (i >= 0) { menu.timeI = i; applyTime(); } }

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (sheet) {
    // (each move, at each point through it: the figure alone, on its shadow)
    cells(MUS.length, sheet.length * MUS.length, (i, aspect, rect) => {
      hold(sheet[Math.floor(i / MUS.length)], MUS[i % MUS.length], Number(q.get('lead') ?? 1), Number(q.get('wall') ?? 1));
      rig.update(1, held!);
      const { vp, eye } = eyeFor(runner.x, runner.y, runner.z, 0, aspect, () => 1);
      rd.draw(vp, eye, rig.bones(held!), { x: runner.x, y: runner.y, z: runner.z, r: 0.5, a: 0.3 }, rect, true);
    });
    frames++; requestAnimationFrame(frame); return;
  }
  if (strip) {
    rd.stream(strip[strip.length >> 1].x, strip[strip.length >> 1].z, 4);
    cells(stripCols, strip.length, (i, aspect, rect) => {
      // (seen from the side asked; from the other, where a wall's in the way of that)
      const m = strip![i], side = TUNE.side;
      // (framed as the eye in play would: out wider and higher up a face, between walls, on a bar)
      let v = eyeFor(m.x, m.y, m.z, m.yaw, aspect, clearTo, m.wide);
      const still = fixedEye ?? scene?.eye ?? null;
      if (still && q.has('fixed')) v = { far: 1, eye: still, vp: mul(perspective((50 * Math.PI) / 180, aspect, 0.15, rd.radius * 64 * 1.5), lookAt(still, [m.x, m.y + 1, m.z], [0, 1, 0])) };
      else if (v.far < 0.6 && side) { TUNE.side = -side; const o = eyeFor(m.x, m.y, m.z, m.yaw, aspect, clearTo, m.wide); if (o.far > v.far) v = o; TUNE.side = side; }
      // (walls close: up and over rather than in close)
      if (v.far < 0.75) { const l0 = lift; for (const up of [0.2, 0.4, 0.7]) { lift = l0 + up; const o = eyeFor(m.x, m.y, m.z, m.yaw, aspect, clearTo, m.wide); if (o.far > v.far + 0.05) v = o; if (v.far >= 0.75) break; } lift = l0; }
      // (still hemmed in (backed into a corner, facing it): round to one side or the other, whichever sees it)
      if (v.far < 0.5 && !(still && q.has('fixed'))) for (const turn of [0.8, -0.8]) { const o = eyeFor(m.x, m.y, m.z, m.yaw + turn, aspect, clearTo, m.wide); if (o.far > v.far + 0.1) v = o; }
      rd.draw(v.vp, v.eye, m.bones, shadowAt(m.x, m.y, m.z), rect);
      // (each planted foot marked on the roof: orange while a save is being made, so the footfall that saved it shows)
      if (m.feet.length && rd.def.guides !== false && q.get('marks') !== '0') rd.lines(v.vp, v.eye, m.feet.flatMap((f) => { const c = m.saved ? [0.98, 0.45, 0.08, 1] : [0.1, 0.1, 0.12, 0.9], y = f[1] + 0.03; return [{ pts: [f[0] - 0.1, y, f[2], f[0] + 0.1, y, f[2]], cols: [...c, ...c], w: 2 }, { pts: [f[0], y, f[2] - 0.1, f[0], y, f[2] + 0.1], cols: [...c, ...c], w: 2 }]; }));
    });
    frames++; requestAnimationFrame(frame); return;
  }
  if (menu.active && menu.ledge) { menuFrame(dt); frames++; requestAnimationFrame(frame); return; }
  if (held) rig.update(1, held);
  else if (stepOnce) { advance(DT); stepOnce = false; }
  else if (!still && !TUNE.pause) { acc += dt * TUNE.time; while (acc >= DT) { advance(DT); acc -= DT; } }
  // (a plan asked for while nothing moves: thought now)
  if (!held && !directed && wantsPlan() && thought < 0) think(asked(time), time);
  yaw += (k('KeyE') - k('KeyQ')) * 1.8 * dt;
  // (the eye: close behind the figure and a little above, wide, and round behind wherever it's going)
  const e = (r: number) => (still ? 1 : 1 - Math.exp(-r * dt));
  // (by what it's doing: going up a face, out wider and higher and steadier, so the climb reads whole; flat out, lower)
  const up = ['climb', 'plant', 'chimney'].includes(runner.state) ? 1 : 0, flat = runner.state === 'ground' && runner.speed > 12 ? 1 : 0;
  wideK += (up - wideK) * e(2.5); lowK += (flat - lowK) * e(2);
  const follow = 1 - 0.6 * wideK;
  // (the eye's own motion, dialled from none (0) through full (1, a hand-held eye) to exaggerated (2). Lope: riding the stride,
  // a bob on each footfall, a sway each stride, a roll into turns. Impact: a landing's dip, by how hard, a shake on a heavy
  // one, a lurch on a short save; exaggerated, the lens punched in and the dip held)
  const L = held ? 0 : TUNE.eyeLope, I = held ? 0 : TUNE.eyeImpact, ground = runner.state === 'ground' && runner.move !== 'roll', pace = Math.min(1, runner.speed / 8);
  const bob = ground ? -L * (0.03 + 0.02 * Math.max(0, L - 1)) * pace * Math.cos(2 * runner.phase) : 0, sway = ground ? L * 0.025 * pace * Math.sin(runner.phase) : 0;
  const roll = -L * Math.max(-0.12, Math.min(0.12, runner.turn * 0.025 * pace));
  const it = runner.impactT, hit = runner.impact, hang = I > 1 ? (I - 1) * 0.08 : 0, te = Math.max(0, it - hang);
  const dip = I * hit * 0.3 * (it < hang ? 1 : Math.exp(-te * 9)) * Math.sin(Math.min(Math.PI / 2 + (it < hang ? 0 : te * 18), Math.PI));
  const shk = I * Math.max(0, hit - 0.5) * 0.08 * Math.exp(-it * 14), jx = shk * Math.sin(it * 71), jy = shk * Math.sin(it * 53 + 1);
  const lurch = runner.saveKind === 'short' ? I * 0.12 * Math.exp(-(runner.saveT ?? 0) * 8) : 0, punch = I > 1 ? (I - 1) * 7 * hit * Math.exp(-it * 6) : 0;
  const shakeV = [sway + jx, bob - dip * 0.3 + jy - lurch * 0.5, roll, punch];
  const dipE = dip + TUNE.emphasis * hit * 0.35 * Math.exp(-it * 9) * Math.sin(Math.min(Math.PI, it * 18));
  eyeAt.x += (runner.x - eyeAt.x) * e(10 * follow); eyeAt.z += (runner.z - eyeAt.z) * e(10 * follow); eyeAt.y += (runner.y - dipE - eyeAt.y) * e(6 * follow);
  if (TUNE.follow > 0 && !held && !others.size && !TUNE.pause && runner.speed > 2) {
    let d = Math.atan2(runner.vx, runner.vz) - yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    yaw += d * Math.max(0, Math.cos(d / 2)) * TUNE.follow * (TUNE.auto ? 1.8 : 1) * TUNE.time * dt;
  }
  // (and wider the faster it goes)
  rush += ((held ? 0 : TUNE.rush * Math.max(0, Math.min(1, (runner.speed - 10) / 8))) - rush) * e(4);
  rd.resize();
  const tripod = q.has('fixed') ? fixedEye ?? scene?.eye ?? null : null;
  let { vp, eye } = tripod ? { eye: tripod, vp: mul(perspective((50 * Math.PI) / 180, canvas.width / canvas.height, 0.15, rd.radius * 64 * 1.5), lookAt(tripod, [runner.x, runner.y + 1, runner.z], [0, 1, 0])) } : eyeFor(eyeAt.x, eyeAt.y, eyeAt.z, yaw, canvas.width / canvas.height, (at) => { const room = held ? 1 : clearTo(at); near += (room - near) * (room < near ? 1 : e(3)); return near; }, held ? 0 : wideK, held ? 0 : lowK, shakeV);
  rd.stream(runner.x, runner.z, 2);
  // (just come from the menu: the eye carried from where it was on the ledge to the chase, over most of a second)
  if (menu.from && menu.blend < 1) {
    menu.blend = Math.min(1, menu.blend + dt / 0.9); const b = menu.blend * menu.blend * (3 - 2 * menu.blend), aspect = canvas.width / canvas.height;
    const E = [0, 1, 2].map((i) => menu.from!.eye[i] + (eye[i] - menu.from!.eye[i]) * b), T = [0, 1, 2].map((i) => menu.from!.target[i] + ([runner.x, runner.y + 1.7, runner.z][i] - menu.from!.target[i]) * b);
    const fov = menu.from.fov + (((TUNE.fov + (aspect < 1 ? 12 : 0)) * Math.PI) / 180 - menu.from.fov) * b;
    vp = mul(perspective(fov, aspect, 0.15, rd.radius * 64 * 1.5), lookAt(E, T, [0, 1, 0])); eye = E;
  }
  rd.draw(vp, eye, withCrew(rig.bones(held ?? runner), dt), shadowAt(runner.x, runner.y, runner.z));
  const guides = rd.def.guides !== false;
  if (guides && TUNE.holds && !held) rd.lines(vp, eye, holdStrokes(city.holdsNear(runner.x, runner.z, TUNE.holdsNear), runner.reach, runner.x, runner.y, runner.z, TUNE.holdsNear));
  if (guides && TUNE.plan && thinking && !held) rd.lines(vp, eye, planStrokes(thinking));
  const say = !!TUNE.readout && !!thinking && !held;
  readout.hidden = !say;
  if (say && frames % 6 === 0) {
    const p = thinking!;
    readout.textContent = [`${runner.move} · ${runner.speed.toFixed(1)} m/s · ${runner.y.toFixed(0)} m up${TUNE.time !== 1 ? ` · time ×${TUNE.time}` : ''}${TUNE.pause ? ' · held' : ''}`, line('ahead', p.primary, p), line('left ', p.left, p), line('right', p.right, p)].join('\n');
  }
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/** what a test (or the curious) can ask of it */
(window as unknown as Record<string, unknown>).__roofjumps = {
  probe: () => ({
    seed, t: time, frames, x: runner.x, y: runner.y, z: runner.z, state: runner.state, speed: runner.speed, dist: runner.dist,
    move: runner.move, leaps: runner.leaps, climbs: runner.climbs, walls: runner.walls, wallSteps: runner.wallSteps, braces: runner.braces, rolls: runner.rolls, dashes: runner.dashes, streets: runner.streets, made: runner.made,
    look: rd.look, tris: rd.tris, pending: rd.pending(runner.x, runner.z),
    focus: rd.focus, menu: menu.active, hop: menu.hop && { state: menu.hop.r.state, move: menu.hop.r.move, y: menu.hop.r.y, t: menu.hop.t, up: menu.hop.up, down: menu.hop.down, speed: menu.hop.r.speed }, chosen: CHARACTERS[ORDER[menu.sel]]?.name, character: character.name, timeOfDay: TIMES[menu.timeI].name,
    plan: thinking && { ahead: words(thinking.primary), score: thinking.primary.score, left: thinking.left && { off: thinking.left.off, score: thinking.left.score }, right: thinking.right && { off: thinking.right.off, score: thinking.right.score }, best: thinking.best.off },
  }),
  tune: TUNE,
  /** brushwork: what each pass cost last frame (with `?cost`), and how many stamps were drawn */
  cost: () => ({ ...(rd.strokes.cost ?? {}), stamps: rd.strokes.stamps }),
  /** brushwork: count the paint's fragments a pixel, pass by pass, on the next frame (read it back after with `overdraw`) */
  count: (on: boolean) => { rd.strokes.counting = on; },
  overdraw: () => rd.strokes.overdraw,
  /** set a dial by its key */
  set: (key: string, v: number) => { TUNE[key] = v; remember(); pal.refresh(); thought = -1; },
  /** run on (at once) until it's in that move, that far through it, and hold there, the eye behind it; false if it never came */
  seek: (move: string, mu = 0.5) => {
    const through = () => (runner.state === 'wall' ? runner.wallT / 0.6 : runner.state === 'climb' ? runner.climbT / 0.3 : runner.move === 'dash' || runner.move === 'ledge' || runner.move === 'run' ? 1 : runner.mu);
    let n = 0; advance(DT);
    while (!(runner.move === move && through() >= mu) && n++ < 120 * 180) advance(DT);
    TUNE.pause = 1; Object.assign(eyeAt, { x: runner.x, y: runner.y, z: runner.z }); near = 1;
    if (runner.speed > 1) yaw = Math.atan2(runner.vx, runner.vz);
    if (wantsPlan()) think(asked(time), time);
    return runner.move === move;
  },
  /** swing the eye round the figure, to that many degrees */
  view: (deg: number) => { TUNE.side = deg; },
  /** hold a move's pose, `mu` through it (and null: let go) */
  pose: (move: string | null, mu = 0.5, lead = 1, wall = 1) => { if (move) hold(move, mu, lead, wall); else held = null; },
};
