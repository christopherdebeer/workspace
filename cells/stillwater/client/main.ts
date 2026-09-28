/**
 * stillwater — a quiet numeracy journey down an endless lily river.
 *
 * There are no rounds and no screens. The boat drifts; the pond holds dew on
 * some of its leaves; the dots at the top ask for a number. Touch (or trace
 * across) leaves whose dew makes that number and the drops lift, drift to the
 * lantern at the bow, and the rower takes a few long strokes further down the
 * river — through pads that shoulder aside and bump and turn, over fish that
 * scatter, past lilies — until the next number settles on the water.
 *
 * Wiring only: the rules are numeracy.ts, the place is world.ts, the fish are
 * fish.ts, the pixels are render.ts/shaders.ts, the words are ui.ts.
 */
import { School } from './fish';
import * as N from './numeracy';
import { drawOrder, Camera, Light, Mote, Renderer } from './render';
import { Sound } from './audio';
import { Overlay } from './ui';
import { layDrops, liveCount, Pad, Pond, seeded } from './world';

const canvas = document.getElementById('pond') as HTMLCanvasElement;
const ui = new Overlay();
const sound = new Sound();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;

// ─── progress (kept per device; losing it costs nothing) ───────────────────
const SAVE = 'stillwater.v2';
let stageIx = 0;
let stageSolves = 0;
try {
  const saved = JSON.parse(localStorage.getItem(SAVE) ?? 'null') as { stage?: number; solves?: number } | null;
  if (saved && typeof saved.stage === 'number') {
    stageIx = Math.max(0, Math.min(N.STAGES.length - 1, saved.stage));
    stageSolves = saved.solves ?? 0;
  }
} catch {
  /* storage unavailable */
}
const save = () => {
  try {
    localStorage.setItem(SAVE, JSON.stringify({ stage: stageIx, solves: stageSolves }));
  } catch {
    /* storage unavailable */
  }
};
{
  // `?stage=groups` starts at a stage (for trying one out; progress still saves from there)
  const ask = new URLSearchParams(location.search).get('stage');
  const ix = N.STAGES.findIndex((st) => st.id === ask);
  if (ix >= 0) {
    stageIx = ix;
    stageSolves = 0;
  }
}
const stage = () => N.STAGES[stageIx];

// ─── world ─────────────────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const urlSeed = Number(params.get('seed'));
/** Test harnesses on software GL run at a few fps; they can ask the river to hurry. */
const timeScale = Math.max(0.1, Math.min(8, Number(params.get('timescale')) || 1));
const rand = seeded(urlSeed || (Date.now() % 100000) + 7);
const pond = new Pond(Math.floor(rand() * 1e9));
pond.dewFor = (r) => N.dewFor(stage(), r);
const school = new School(reduced ? 18 : 34, pond.boat.x, pond.boat.y + 200);

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (err) {
  document.body.classList.add('nogl');
  ui.say('this pond needs WebGL2 — try a newer browser', 0);
  console.error(err);
  throw err;
}

const cam: Camera = { x: pond.boat.x, y: 0, zoom: 1, cssW: 1, cssH: 1 };
let dpr = 1;
let scale = touch ? 0.8 : 1;

function resize() {
  cam.cssW = innerWidth;
  cam.cssH = innerHeight;
  cam.zoom = Math.max(0.85, Math.min(1.5, Math.min(cam.cssW / 400, cam.cssH / 760)));
  dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.resize(cam.cssW, cam.cssH, dpr, scale);
  const need = cam.cssW / (2 * cam.zoom) + 160;
  if (need > pond.halfW) pond.regrow(need, cam.y - cam.cssH / cam.zoom);
}
addEventListener('resize', resize);
resize();

/** Where the boat sits on screen (fraction from the top). */
const BOAT_AT = 0.7;
const followY = () => pond.boat.y + ((BOAT_AT - 0.5) * cam.cssH) / cam.zoom;
cam.y = followY();

const toScreen = (x: number, y: number): [number, number] => [
  (x - cam.x) * cam.zoom + cam.cssW / 2,
  cam.cssH / 2 - (y - cam.y) * cam.zoom,
];
const toWorld = (sx: number, sy: number): [number, number] => [
  cam.x + (sx - cam.cssW / 2) / cam.zoom,
  cam.y - (sy - cam.cssH / 2) / cam.zoom,
];

// ─── the numeracy loop ─────────────────────────────────────────────────────
let target: N.Target | null = null;
let selection: Pad[] = [];
/** While > 0 (seconds), touches are ignored: the dew is lifting, or slipping back. */
let lock = 0;
let releaseAt = 0;
let nextTargetAt = 1.2;
let firstTarget = true;
let lastSolved: number | undefined;
let checkAt = 0;

/** Leaves with dew that the player can plainly see: ahead of the boat, clear of the header. */
function visibleDewy(): Pad[] {
  const out: Pad[] = [];
  for (const p of pond.pads) {
    if (!p.drops.length) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    const m = Math.max(18, p.r * 0.5 * cam.zoom);
    if (sx < m || sx > cam.cssW - m) continue;
    if (sy < cam.cssH * 0.15 || sy > cam.cssH * (BOAT_AT - 0.06)) continue;
    out.push(p);
  }
  return out;
}

/** Leaves in view that could take new dew (dry, not a lily). */
function visibleDry(): Pad[] {
  return pond.pads
    .filter((p) => {
      if (p.drops.length || p.flower) return false;
      const [sx, sy] = toScreen(p.x, p.y);
      const m = Math.max(24, p.r * 0.6 * cam.zoom);
      return sx > m && sx < cam.cssW - m && sy > cam.cssH * 0.18 && sy < cam.cssH * (BOAT_AT - 0.12);
    })
    .sort((a, b) => b.r - a.r);
}

function condense(p: Pad, count: number) {
  p.drops = layDrops(count, p.r, rand);
  sound.glint();
}

function counts(pads: Pad[]) {
  return pads.map(liveCount);
}

function setTarget() {
  const st = stage();
  const seen = visibleDewy();
  let t = N.chooseTarget(st, counts(seen), rand, lastSolved);
  if (!t) {
    // the pond in view can't make anything in range yet: pick a number and let dew form for it
    const value = st.min + Math.floor(rand() * (st.max - st.min + 1));
    const dry = visibleDry();
    const all = [...seen, ...dry];
    const fix = N.repair(st, counts(all), value);
    if (fix) {
      fix.forEach((c, i) => condense(all[i], c));
      const k = st.rule === 'groups' ? [...fix.values()][0] : undefined;
      t = st.rule === 'groups' && k ? { value, rows: value / k, cols: k } : { value };
    } else {
      nextTargetAt = pond.t + 1;
      return;
    }
  }
  target = t;
  ui.setTarget(t, st.display);
  ui.say(N.hintFor(st, t, firstTarget), firstTarget ? 9 : 5);
  firstTarget = false;
}

/** Drift can carry a needed leaf out of view: condense dew so the ask stays answerable. */
function keepSolvable() {
  if (!target || lock > 0) return;
  const st = stage();
  const seen = visibleDewy();
  if (N.solvable(st, counts(seen), target.value)) return;
  const dry = visibleDry();
  const all = [...seen, ...dry];
  const fix = N.repair(st, counts(all), target.value);
  if (fix) fix.forEach((c, i) => condense(all[i], c));
}

function gathered() {
  return selection.reduce((s, p) => s + liveCount(p), 0);
}

function clearSelection() {
  for (const p of selection) p.selected = false;
  selection = [];
  ui.progress(0);
}

function choose(p: Pad) {
  if (!target || lock > 0) return;
  const i = selection.indexOf(p);
  if (i >= 0) {
    // touching a chosen leaf lets it go
    p.selected = false;
    selection.splice(i, 1);
    ui.progress(gathered());
    return;
  }
  if (!liveCount(p)) return;
  p.selected = true;
  selection.push(p);
  const st = stage();
  const verdict = N.judge(st, target.value, counts(selection));
  sound.note(selection.length - 1 + Math.min(4, liveCount(p) - 1));
  switch (verdict.kind) {
    case 'partial':
      ui.progress(verdict.gathered);
      break;
    case 'mismatch':
      for (const q of selection.slice(0, -1)) q.selected = false;
      selection = [p];
      ui.progress(verdict.gathered);
      ui.say('leaves that match', 3);
      break;
    case 'over':
      ui.progress(Math.min(verdict.gathered, target.value));
      ui.say('let a few drops return to the water', 3);
      lock = 1.2;
      releaseAt = pond.t + 1.1;
      break;
    case 'solved':
      ui.progress(verdict.gathered);
      solve();
      break;
  }
}

interface Lift {
  x0: number;
  y0: number;
  t: number;
  dur: number;
  delay: number;
  bend: number;
}
let lifts: Lift[] = [];
let lantern = 0;

function solve() {
  if (!target) return;
  const value = target.value;
  sound.gathered();
  let k = 0;
  for (const p of selection) {
    const c = Math.cos(p.ang);
    const s = Math.sin(p.ang);
    for (const d of p.drops) {
      if (d.to <= 0) continue;
      d.to = 0;
      const lx = d.x * p.r;
      const ly = d.y * p.r;
      lifts.push({ x0: p.x + c * lx - s * ly, y0: p.y + s * lx + c * ly, t: 0, dur: 1.5 + rand() * 0.6, delay: k++ * 0.07, bend: (rand() * 2 - 1) * 60 });
    }
    pond.impulses.push({ x: p.x, y: p.y, r: p.r * 0.6, s: 0.6 });
  }
  const done = selection;
  selection = [];
  window.setTimeout(() => done.forEach((p) => (p.selected = false)), 900);
  lock = 2.2;
  lastSolved = value;
  target = null;
  pond.propel(90 + value * 14);
  ui.say(['and the water carries you', 'onward', 'the river opens', 'further down the water'][Math.floor(rand() * 4)], 3);
  stageSolves++;
  const st = stage();
  if (stageSolves >= st.solves && stageIx < N.STAGES.length - 1) {
    stageIx++;
    stageSolves = 0;
  }
  save();
  nextTargetAt = pond.t + 3.4;
}

// ─── input ─────────────────────────────────────────────────────────────────
let pointerId: number | null = null;
let lastHit: Pad | null = null;
let started = false;

function hit(sx: number, sy: number): Pad | null {
  const [wx, wy] = toWorld(sx, sy);
  const order = drawOrder(pond.pads);
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i];
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy < p.r * p.r * 0.94) return p;
  }
  return null;
}

function touchPad(p: Pad) {
  p.bob = 1;
  p.vx += (rand() - 0.5) * 6;
  p.vy += (rand() - 0.5) * 6;
  p.va += (rand() - 0.5) * 0.3;
  pond.impulses.push({ x: p.x + p.r * 0.8, y: p.y, r: 8, s: 0.5 });
  pond.impulses.push({ x: p.x - p.r * 0.8, y: p.y, r: 8, s: 0.5 });
}

function begin() {
  if (started) return;
  started = true;
  ui.fadeTitle();
}

canvas.addEventListener('pointerdown', (e) => {
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  begin();
  const p = hit(e.clientX, e.clientY);
  lastHit = p;
  if (p) {
    touchPad(p);
    choose(p);
  } else {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    pond.impulses.push({ x: wx, y: wy, r: 10, s: 1.4 });
    school.scare(wx, wy);
    if (selection.length && lock <= 0) clearSelection();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  const p = hit(e.clientX, e.clientY);
  if (!p || p === lastHit) return;
  // tracing back onto the previous leaf lets the last one go
  if (selection.length > 1 && selection[selection.length - 2] === p) {
    const last = selection.pop()!;
    last.selected = false;
    ui.progress(gathered());
  } else if (!selection.includes(p)) {
    touchPad(p);
    choose(p);
  }
  lastHit = p;
});

const end = (e: PointerEvent) => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  lastHit = null;
};
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);

// keyboard: arrows walk the dewy leaves in view (reading order), Enter/Space chooses
let focusIx = -1;
canvas.addEventListener('keydown', (e) => {
  const pads = visibleDewy().sort((a, b) => b.y - a.y || a.x - b.x);
  if (e.key === 'Escape') {
    clearSelection();
    return;
  }
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    begin();
    const cur = pads.findIndex((p) => p.focus);
    for (const p of pond.pads) p.focus = false;
    if (!pads.length) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    focusIx = ((cur < 0 ? (step > 0 ? -1 : 0) : cur) + step + pads.length) % pads.length;
    pads[focusIx].focus = true;
    ui.announce(`Leaf with ${liveCount(pads[focusIx])} drops${pads[focusIx].selected ? ', chosen' : ''}.`);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const p = pond.pads.find((q) => q.focus);
    if (p) {
      touchPad(p);
      choose(p);
    }
  }
});

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
soundBtn.addEventListener('click', () => {
  const on = sound.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'sound on' : 'sound off';
});

document.addEventListener('visibilitychange', () => {
  sound.suspend(document.hidden);
  last = performance.now();
});

// ─── light: a slow drift of the sun across the afternoon ──────────────────
function lightAt(t: number): Light {
  const ph = Math.sin((t / 480) * Math.PI * 2);
  const az = 2.35 + ph * 0.3; // from the upper left
  const el = 0.78 + ph * 0.06;
  const sx = Math.sin(az) * Math.cos(el) * -1;
  const sy = -Math.cos(az) * Math.cos(el);
  const sz = Math.sin(el);
  const warm = 0.5 + 0.5 * ph;
  return {
    sun: [sx, sy, sz],
    sunCol: [1.02, 0.95 - warm * 0.06, 0.82 - warm * 0.12],
    amb: [0.27, 0.36, 0.35],
    sky0: [0.42, 0.55, 0.52],
    sky1: [0.82, 0.88, 0.82],
  };
}

// ─── ambient motes ─────────────────────────────────────────────────────────
const pollen = Array.from({ length: reduced ? 20 : 46 }, () => ({ x: rand(), y: rand(), p: rand() * 10, s: 1.6 + rand() * 2.4 }));

function motes(dt: number): Mote[] {
  const out: Mote[] = [];
  const hw = cam.cssW / (2 * cam.zoom);
  const hh = cam.cssH / (2 * cam.zoom);
  for (const m of pollen) {
    m.p += dt;
    // anchored to the water (they wrap around the view as it moves)
    const wrap = (v: number, span: number) => ((v % span) + span) % span;
    const x = cam.x - hw + wrap(m.x * hw * 2 + Math.sin(m.p * 0.13) * 40 + pond.t * 3 - cam.x, hw * 2);
    const y = cam.y - hh + wrap(m.y * hh * 2 + Math.cos(m.p * 0.11) * 30 - cam.y, hh * 2);
    const tw = 0.1 + 0.25 * Math.max(0, Math.sin(m.p * 0.6));
    out.push({ x, y, size: m.s * 3, r: 1, g: 0.95, b: 0.75, a: tw, core: 0.4 });
  }
  const [bx, by] = pond.bow();
  lifts = lifts.filter((l) => l.t < l.dur + l.delay);
  let arrived = 0;
  for (const l of lifts) {
    l.t += dt;
    const k = Math.max(0, Math.min(1, (l.t - l.delay) / l.dur));
    if (k <= 0) continue;
    const e = k * k * (3 - 2 * k);
    const mx = (l.x0 + bx) / 2 + l.bend;
    const my = (l.y0 + by) / 2 + 40;
    const x = (1 - e) * (1 - e) * l.x0 + 2 * (1 - e) * e * mx + e * e * bx;
    const y = (1 - e) * (1 - e) * l.y0 + 2 * (1 - e) * e * my + e * e * by;
    out.push({ x, y, size: 16 - 6 * e, r: 1, g: 0.93, b: 0.7, a: 0.9 * (1 - e * 0.3), core: 1 });
    if (l.t - l.delay + dt >= l.dur) arrived++;
  }
  lantern = Math.min(1.5, lantern + arrived * 0.12) * Math.exp(-0.25 * dt);
  out.push({ x: bx, y: by, size: 26 + lantern * 30, r: 1, g: 0.8, b: 0.45, a: 0.25 + lantern * 0.4, core: 0.3 });
  return out;
}

// ─── frame ─────────────────────────────────────────────────────────────────
let last = performance.now();
let frameMs = 16;
let slowFor = 0;
let fastFor = 0;

function adapt(ms: number, dt: number) {
  frameMs += (ms - frameMs) * 0.05;
  if (frameMs > 24) {
    slowFor += dt;
    fastFor = 0;
  } else if (frameMs < 13) {
    fastFor += dt;
    slowFor = 0;
  } else {
    slowFor = fastFor = 0;
  }
  const next = slowFor > 1.5 ? scale - 0.1 : fastFor > 5 ? scale + 0.1 : scale;
  const clamped = Math.max(0.5, Math.min(1, Math.round(next * 10) / 10));
  if (clamped !== scale) {
    scale = clamped;
    slowFor = fastFor = 0;
    renderer.resize(cam.cssW, cam.cssH, dpr, scale);
  }
}

function frame(now: number) {
  const ms = now - last;
  const dt = Math.min(ms / 1000 || 1 / 60, 1 / 20) * timeScale;
  last = now;

  const hh = cam.cssH / (2 * cam.zoom);
  pond.ensure(cam.y + hh + 500);
  pond.cull(cam.y - hh - 600);

  // physics at a fixed step
  const steps = Math.max(1, Math.round(dt * 60));
  for (let i = 0; i < steps; i++) pond.step(dt / steps, { y0: cam.y - hh - 200, y1: cam.y + hh + 300 }, reduced);
  const shift = pond.rebaseIfNeeded();
  if (shift) {
    cam.y -= shift;
    renderer.shiftSim(shift);
    for (const l of lifts) l.y0 -= shift;
  }
  school.step(dt, pond.boat, { x: cam.x, y: cam.y, hw: cam.cssW / (2 * cam.zoom), hh }, shift);

  // the camera follows the boat, easing sideways toward the channel
  const b = pond.boat;
  cam.x += (b.x * 0.75 + pond.channel(b.y + 120) * 0.25 - cam.x) * (1 - Math.exp(-1.2 * dt));
  cam.y += (followY() - cam.y) * (1 - Math.exp(-3 * dt));

  for (const bump of pond.bumps) {
    sound.knock(bump.strength);
    school.scare(bump.x, bump.y);
  }
  pond.bumps.length = 0;

  // the rules
  lock = Math.max(0, lock - dt);
  if (releaseAt && pond.t >= releaseAt) {
    releaseAt = 0;
    clearSelection();
    sound.release();
  }
  if (!target && pond.t >= nextTargetAt) setTarget();
  if (pond.t >= checkAt) {
    checkAt = pond.t + 0.8;
    keepSolvable();
    // a dewy leaf drifting under another sheds the hidden drops rather than hiding them
    shedHidden();
  }

  const order = drawOrder(pond.pads);
  const thread: Array<[number, number]> = [];
  if (selection.length > 1) {
    for (let i = 0; i < selection.length - 1; i++) {
      const a = selection[i];
      const c = selection[i + 1];
      for (let k = 0; k < 12; k++) {
        const u = k / 12;
        const sag = Math.sin(u * Math.PI) * 10;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        thread.push([a.x + dx * u - (dy / l) * sag, a.y + dy * u + (dx / l) * sag]);
      }
    }
    const z = selection[selection.length - 1];
    thread.push([z.x, z.y]);
  }

  renderer.render(
    {
      cam,
      light: lightAt(pond.t),
      time: pond.t,
      pond,
      pads: order,
      fish: school.fish,
      motes: motes(dt),
      thread,
      lantern,
    },
    dt,
  );
  adapt(ms, dt);
  requestAnimationFrame(frame);
}

function shedHidden() {
  const order = drawOrder(pond.pads);
  const idx = new Map(order.map((p, i) => [p, i]));
  for (const p of order) {
    if (!p.drops.length || p.selected) continue;
    const c = Math.cos(p.ang);
    const s = Math.sin(p.ang);
    const i = idx.get(p)!;
    for (const d of p.drops) {
      if (d.to <= 0) continue;
      const wx = p.x + (c * d.x - s * d.y) * p.r;
      const wy = p.y + (s * d.x + c * d.y) * p.r;
      for (let j = i + 1; j < order.length; j++) {
        const q = order[j];
        if (Math.abs(q.y - wy) > q.r || Math.abs(q.x - wx) > q.r) continue;
        if (Math.hypot(q.x - wx, q.y - wy) < q.r * 0.95) {
          d.to = 0;
          break;
        }
      }
    }
  }
}

// debug/test surface: read on demand, not rebuilt per frame
Object.defineProperty(window, '__stillwater', {
  get: () => ({
    renderer: 'webgl2',
    stage: stage().id,
    target: target?.value ?? null,
    gathered: gathered(),
    selected: selection.map((p) => p.id),
    boatY: pond.boat.y + pond.origin,
    scale,
    frameMs: Math.round(frameMs * 10) / 10,
    sim: renderer.simOn,
    pads: visibleDewy().map((p) => {
      const [x, y] = toScreen(p.x, p.y);
      return { id: p.id, x: Math.round(x), y: Math.round(y), n: liveCount(p) };
    }),
  }),
});

requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});
