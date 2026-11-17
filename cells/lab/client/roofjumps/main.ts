/**
 * Roof Jumps: a figure running over an endless city of rooftops, leaping whatever is in the way, in any direction.
 * A study of two things only: the procedural geometry (city.ts: chunks of boxes on a lattice) and the rigged figure
 * moving over it (runner.ts: the body and its judgement; rig.ts: the skeleton posed from it). It is drawn as plainly
 * as it can be (render.ts), on purpose, so that looks can be tried over the same geometry later.
 *
 * Drag anywhere and the figure runs that way (the drag is a stick: further is faster). What it does about what's in
 * front of it is its own: it hops clutter, bounds and flips gaps, springs up a storey, dives down one and rolls out,
 * glides the long ones, dashes off a clean landing, balances along ledges, runs along and up walls. Tap to jump (and
 * once more in the air). A second finger turns the eye. Keys: WASD or the arrows, space, Q and E; P the plan, O the
 * dials, K hold time, L one step of it.
 *
 * The dials (tune.ts, under `dials`): every number of the run, the plan, the eye and time, turned while it runs; the
 * address keeps the ones that differ from the house, by their keys (`?gravity=14&plan&time=0.25`). The plan (plan.ts,
 * `?plan`): where this heading leads over the next few seconds, drawn into the city, with the best way to the left and
 * to the right of it; `?readout` says it in words; `?assist=1` steers onto the best.
 *
 * Other flags: `seed=` the city · `look=grid|clay|wire|tags|normals` how it's drawn · `auto` it runs itself, wandering
 * (by the plan's best way) · `t=` start that many seconds into such a run · `still` hold the frame · `preview` nothing
 * over the picture (and `auto`) · `far=` chunks drawn each way (4) · `side=90&zoom=1.6` the eye swung round the figure
 * and brought closer: for looking at the rig · `study=<move>&mu=` one move's pose held, that far through it (0..1).
 */
import { noise1 } from '../kit/rng';
import { City } from './city';
import { Runner } from './runner';
import type { Body, Input, Move } from './runner';
import { Rig } from './rig';
import { LOOKS, Renderer } from './render';
import type { Look } from './render';
import { lookAt, mul, perspective } from './m4';
import { TUNE, readTune, writeTune } from './tune';
import { palette } from './palette';
import { plan, words } from './plan';
import type { Plan, Route } from './plan';
import { planStrokes } from './plandraw';

const q = new URLSearchParams(location.search);
const seed = Number(q.get('seed') ?? 1) | 0 || 1, preview = q.has('preview'), still = q.has('still');
readTune(q);
if (preview) TUNE.auto = 1;
if (q.get('follow') === '0') TUNE.follow = 0;
if (preview) document.body.classList.add('preview');

const canvas = document.getElementById('world') as HTMLCanvasElement;
const city = new City(seed), runner = new Runner(city), rig = new Rig(), rd = new Renderer(canvas, city);
rd.radius = Math.max(1, Math.min(8, Number(q.get('far') ?? 4) | 0));
if ((LOOKS as readonly string[]).includes(q.get('look') ?? '')) rd.look = q.get('look') as Look;
rd.resize(); addEventListener('resize', () => rd.resize());

// ─── the eye ──────────────────────────────────────────────────────────────────
/** `zoom=`: the eye brought that many times closer, for looking at the rig */
const zoom = Math.max(0.2, Number(q.get('zoom') ?? 1));
/** the eye's heading, and what a second finger has added to its height */
let yaw = 0.6, lift = TUNE.side ? -0.15 : 0;
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
    if (o.moved) { yaw += dx * 0.007; lift = Math.max(-0.3, Math.min(1, lift + dy * 0.005)); o.x = e.clientX; o.y = e.clientY; }
  }
});
const up = (e: PointerEvent) => {
  const tap = (t: number, moved: boolean) => { if (!moved && performance.now() - t < 260) jump = true; };
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
const pal = palette(dialsEl, () => { remember(); thought = -1; });
dialsBtn.addEventListener('click', () => { const on = dialsEl.classList.toggle('shown'); dialsBtn.setAttribute('aria-expanded', String(on)); });
const flip = (key: string) => { TUNE[key] = TUNE[key] ? 0 : 1; remember(); pal.refresh(); thought = -1; };
let stepOnce = false;
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  if (e.code === 'Space' && !e.repeat) jump = true;
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
  if (TUNE.auto) {
    // (by itself: wandering, the heading a slow noise, drawn toward the city's own two directions: along its alleys, its walls, its ledges)
    const w = 7 * noise1(seed + 9, t * 0.06) + t * 0.04, a = w - 0.22 * Math.sin(4 * w);
    return { x: Math.sin(a), z: Math.cos(a), jump: false };
  }
  let sx = stick.x + k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), sy = stick.y + k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp');
  const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; }
  const fx = Math.sin(yaw), fz = Math.cos(yaw), j = jump; jump = false;
  return { x: fx * -sy + -fz * sx, z: fz * -sy + fx * sx, jump: j };
}
/** the plan about what's asked (with nothing asked, about the way it faces) */
function think(a: Input, t: number): void {
  const m = Math.hypot(a.x, a.z);
  thinking = plan(runner, m > 0.1 ? a.x / m : Math.sin(runner.heading), m > 0.1 ? a.z / m : Math.cos(runner.heading)); thought = t;
}
/** what the runner is given: what's asked, leant onto the plan's best way as far as `assist` says (all the way, by itself) */
function input(t: number, dt: number): Input {
  const a = asked(t), mag = Math.hypot(a.x, a.z);
  if (wantsPlan() && (thought < 0 || t - thought >= 0.12)) think(a, t);
  const by = TUNE.auto ? 1 : TUNE.assist;
  lean += ((thinking && by > 0 && mag > 0.1 ? thinking.best.off * by : 0) - lean) * (1 - Math.exp(-5 * dt));
  if (Math.abs(lean) < 1e-4 || mag <= 0.1) return a;
  // (to the right is a smaller angle: see plan.ts)
  const c = Math.cos(-lean), s = Math.sin(-lean);
  return { x: a.x * c + a.z * s, z: a.z * c - a.x * s, jump: a.jump };
}

// ─── a pose held, to be looked at (`study=`, and `__roofjumps.pose`) ───────────
let held: Body | null = null;
function hold(move: string, mu: number, lead = 1, wallSide = 1): void {
  const ground = ['run', 'dash', 'ledge', 'roll', 'land', 'stand'].includes(move);
  held = {
    x: runner.x, y: runner.y, z: runner.z, heading: 0, turn: 0, lead, wallSide, mu,
    move: (move === 'land' || move === 'stand' ? 'run' : move) as Move,
    state: ground ? 'ground' : move === 'climb' ? 'climb' : move === 'wallrun' ? 'wall' : 'air',
    speed: move === 'stand' ? 0 : move === 'land' ? 5 : move === 'dash' ? 18 : move === 'ledge' ? 8 : 12,
    phase: mu * 2 * Math.PI, climbT: mu * 0.42, wallT: mu * 0.45, land: move === 'land' ? 1 - mu : 0,
  };
  yaw = 0; lift = -0.14;
}
if (q.get('study')) hold(q.get('study')!, Number(q.get('mu') ?? 0.5), Number(q.get('lead') ?? 1), Number(q.get('wall') ?? 1));

// ─── the frame ────────────────────────────────────────────────────────────────
const DT = 1 / 120;
let time = 0, acc = 0, last = performance.now(), frames = 0, rush = 0, near = 1;
const advance = (dt: number) => { runner.step(dt, input(time, dt)); rig.update(dt, runner); time += dt; };
// (`t=`: run on to there before the first frame)
for (let n = Math.round(Number(q.get('t') ?? 0) / DT); n > 0; n--) advance(DT);
Object.assign(eyeAt, { x: runner.x, y: runner.y, z: runner.z });
if (TUNE.auto && runner.speed > 1) yaw = Math.atan2(runner.vx, runner.vz);
rd.stream(runner.x, runner.z, 9);

const lookBtn = document.getElementById('look')!;
const showLook = () => { lookBtn.textContent = rd.look; };
lookBtn.addEventListener('click', () => { rd.look = LOOKS[(LOOKS.indexOf(rd.look) + 1) % LOOKS.length]; showLook(); const u = new URL(location.href); u.searchParams.set('look', rd.look); history.replaceState(null, '', u); });
showLook();
document.getElementById('seed')!.textContent = String(seed);
document.getElementById('another')!.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.set('seed', String(1 + Math.floor(Math.random() * 9999))); location.href = u.href; });

/** a route in a line: how far off the way asked, its moves, what it's worth */
const line = (name: string, r: Route | null, p: Plan) => (r ? `${r === p.best ? '★' : ' '} ${name} ${r.off ? `${r.off > 0 ? '→' : '←'}${Math.abs(Math.round((r.off * 180) / Math.PI))}° ` : ''}${words(r)}  [${r.score.toFixed(0)}${r.streets ? ', street' : ''}]` : '');

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (held) rig.update(1, held);
  else if (stepOnce) { advance(DT); stepOnce = false; }
  else if (!still && !TUNE.pause) { acc += dt * TUNE.time; while (acc >= DT) { advance(DT); acc -= DT; } }
  // (a plan asked for while nothing moves: thought now)
  if (!held && wantsPlan() && thought < 0) think(asked(time), time);
  yaw += (k('KeyE') - k('KeyQ')) * 1.8 * dt;
  // (the eye: close behind the figure and a little above, wide, and round behind wherever it's going)
  const e = (r: number) => (still ? 1 : 1 - Math.exp(-r * dt));
  eyeAt.x += (runner.x - eyeAt.x) * e(10); eyeAt.z += (runner.z - eyeAt.z) * e(10); eyeAt.y += (runner.y - eyeAt.y) * e(6);
  if (TUNE.follow > 0 && !held && !others.size && !TUNE.pause && runner.speed > 2) {
    let d = Math.atan2(runner.vx, runner.vz) - yaw; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    yaw += d * Math.max(0, Math.cos(d / 2)) * TUNE.follow * (TUNE.auto ? 1.8 : 1) * TUNE.time * dt;
  }
  // (and wider the faster it goes)
  rush += ((held ? 0 : TUNE.rush * Math.max(0, Math.min(1, (runner.speed - 10) / 8))) - rush) * e(4);
  rd.resize();
  const aspect = canvas.width / canvas.height, dist = (TUNE.eyeDist * (aspect < 1 ? 1.22 : 1)) / zoom, fov = ((zoom > 1 ? 50 : TUNE.fov + (aspect < 1 ? 12 : 0)) + rush) * Math.PI / 180;
  const pitch = Math.max(0.02, Math.min(1.45, (TUNE.eyePitch * Math.PI) / 180 + lift));
  const tx = eyeAt.x, ty = eyeAt.y + (zoom > 1 ? 0.95 : 1.7), tz = eyeAt.z, c = Math.cos(pitch), ya = yaw + (TUNE.side * Math.PI) / 180;
  // (never inside a building: the eye comes in along its own line to just short of whatever is between it and the figure)
  const at = (f: number) => [tx - Math.sin(ya) * c * dist * f, ty + Math.sin(pitch) * dist * f, tz - Math.cos(ya) * c * dist * f];
  let room = 1;
  if (!held) for (let f = 0.1; f <= 1.001; f += 0.1) { const p = at(f); if (city.heightAt(p[0], p[2]) > p[1] - 0.25) { room = Math.max(0.12, f - 0.1); break; } }
  near += (room - near) * (room < near ? 1 : e(3));
  const eye = at(near);
  const vp = mul(perspective(fov, aspect, 0.15, rd.radius * 64 * 1.5), lookAt(eye, [tx, ty, tz], [0, 1, 0]));
  rd.stream(runner.x, runner.z, 2);
  const under = city.heightAt(runner.x, runner.z), h = Math.max(0, runner.y - under);
  rd.draw(vp, eye, rig.bones(held ?? runner), { x: runner.x, y: under, z: runner.z, r: 0.5 * (1 - 0.4 * Math.min(1, h / 12)), a: 0.4 * (1 - 0.6 * Math.min(1, h / 20)) });
  if (TUNE.plan && thinking && !held) rd.lines(vp, eye, planStrokes(thinking));
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
    move: runner.move, leaps: runner.leaps, climbs: runner.climbs, walls: runner.walls, rolls: runner.rolls, dashes: runner.dashes, streets: runner.streets, made: runner.made,
    look: rd.look, tris: rd.tris, pending: rd.pending(runner.x, runner.z),
    plan: thinking && { ahead: words(thinking.primary), score: thinking.primary.score, left: thinking.left && { off: thinking.left.off, score: thinking.left.score }, right: thinking.right && { off: thinking.right.off, score: thinking.right.score }, best: thinking.best.off },
  }),
  tune: TUNE,
  /** set a dial by its key */
  set: (key: string, v: number) => { TUNE[key] = v; remember(); pal.refresh(); thought = -1; },
  /** swing the eye round the figure, to that many degrees */
  view: (deg: number) => { TUNE.side = deg; },
  /** hold a move's pose, `mu` through it (and null: let go) */
  pose: (move: string | null, mu = 0.5, lead = 1, wall = 1) => { if (move) hold(move, mu, lead, wall); else held = null; },
};
