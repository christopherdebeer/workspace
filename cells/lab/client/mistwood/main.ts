/**
 * Mistwood — a walk through a seeded wood in fog.
 *
 * Hold still to walk; drag to look about (and, while walking, to steer). The seed is in the address
 * (?seed=moss-ford-7) and at the foot of the screen; touch it for another wood.
 *
 * The work is on the GPU: every tree, shrub and patch of grass is a card baked
 * from its grown structure at the resolution it needs on screen (baked again,
 * sharper, as you come close), drawn at its true place in the wood so walking
 * and looking give real parallax; the fog, the mist banks and the wind are all
 * in the shaders (render.ts).
 *
 * Flags (the address): all declared in flags.ts, read only through `flag()`; `?tune` shows them all
 * in a panel to change, with what the wood reports of itself (window.__mistwood).
 */
import { Sound } from './audio';
import { Baker, type Card } from './bake';
import { Renderer, type Anomaly, type Draw, type View, type WoodEnv } from './render';
import { countWider, type Species, type Structure } from './tree';
import { atmosphere, moonPhase } from './sky';
import { Deerland } from './deer';
import { DeerRig } from './deermesh';
import { flag, onFlag, setFlag, setFlags } from './flags';
import { mountTune } from './tune';
import { hash, seeded } from '../kit/rng';
import { clamp01, randomSeed, seedFrom, seedName } from '../kit/rng';
import { Wood, VIEW, type Kind, type Placed } from './world';
import { smooth as smoothstep } from '../kit/rng';

const canvas = document.getElementById('wood') as HTMLCanvasElement;
const veil = document.getElementById('veil')!;
const title = document.getElementById('title')!;
const hint = document.getElementById('hint')!;
const seedBtn = document.getElementById('seed') as HTMLButtonElement;
const soundBtn = document.getElementById('sound') as HTMLButtonElement;

let renderer: Renderer;
try {
  renderer = new Renderer(canvas, flag('style') === 'sketch');
} catch (e) {
  hint.textContent = (e as Error).message;
  hint.classList.add('show');
  throw e;
}
const gl = renderer.gl;
const baker = new Baker(gl, renderer.compile, renderer.sketch);
const sound = new Sound();

// ─── sprites: coloured pictures stood in the wood by another experiment ───────────────────────
/** a picture standing on the ground at (x, z): w × h metres, its foot `sink` m into the ground,
 *  its texture (premultiplied, bottom row first) made with `spriteTexture` */
export interface Sprite { x: number; z: number; w: number; h: number; sink: number; alpha: number; tex: WebGLTexture | null }
export const sprites = new Map<string, Sprite>();
/** things drawn into the wood by another experiment, as real geometry (render.ts CustomDraw): where
 *  each stands, how tall, and how to draw it */
export interface Custom {
  x: number;
  z: number;
  top: number;
  draw: (env: WoodEnv) => void;
  /** how far off it is still drawn (m; default the wood's VIEW) */
  range?: number;
  /** drawn before everything else (a thing that writes its depth, or lies on the ground): the trees
   *  and grass then go in front of it or behind it by the depth it wrote. Higher, sooner (what
   *  writes its depth before what only tests it) */
  first?: number;
  /** drawn after everything else (to take the finished wood) */
  last?: boolean;
}
export const customs = new Map<string, Custom>();
/** anomalies another experiment sets into the wood, each changing the wood about it (its light in
 *  the mist, the ground, the trees: render.ts Anomaly). The nearest four are drawn */
export const anomalies: Anomaly[] = [];
/** what another experiment has set solid in the wood (the Field Journal's crystals and giant
 *  stalks): how far (m) a point is outside it, as stoneDist. You walk along it, not through it */
export const obstacle: { at: ((x: number, z: number) => number) | null } = { at: null };
const nearestAnomalies = () => (anomalies.length <= 4 ? anomalies : [...anomalies].sort((a, b) => Math.hypot(a.x - posX, a.z - posZ) - Math.hypot(b.x - posX, b.z - posZ)).slice(0, 4));
/** a texture in the wood's context from a picture (a canvas: another renderer's frame) */
export function spriteTexture(src: TexImageSource, into?: WebGLTexture | null): WebGLTexture {
  const tex = into ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// ─── the cards: baked per structure and resolution, kept while there is room ────────
const cards = new Map<string, Card>();
let texels = 0;
/** Resolution asked of every card (lowered while over the budget). */
let bias = 1;
/** What a phone can hold: about 64 MB of cards. */
const BUDGET = 16e6;
/** A far tree's card is baked as seen from one of twelve sides (a patch of grass from one). */
const SIDES = 12;
/** Grass and rushes: low cover, one card side, mirrored, straw-coloured. */
const low = (kind: Kind) => kind === 'patch' || kind === 'rush' || kind === 'scrub';
const keyOf = (kind: Kind, pool: number, level: number, side = 0) => `${kind}:${pool}:${level}:${side}`;
function forget() {
  for (const c of cards.values()) gl.deleteTexture(c.tex);
  cards.clear();
  texels = 0;
}
/** The sharpest card of this structure from this side that is ready, at or below `level` if possible. */
function cardFrom(kind: Kind, pool: number, level: number, side: number): Card | null {
  for (let l = level; l >= 32; l /= 2) {
    const c = cards.get(keyOf(kind, pool, l, side));
    if (c) return c;
  }
  for (let l = level * 2; l <= 2048; l *= 2) {
    const c = cards.get(keyOf(kind, pool, l, side));
    if (c) return c;
  }
  return null;
}
/** This side's card, or else the nearest side that is ready (a tree is never missing while its side bakes). */
function bestCard(kind: Kind, pool: number, level: number, side: number): Card | null {
  for (let k = 0; k <= SIDES / 2; k++)
    for (const sd of k ? [side + k, side - k] : [side]) {
      const c = cardFrom(kind, pool, level, ((sd % SIDES) + SIDES) % SIDES);
      if (c) return c;
    }
  return null;
}

// ─── the wood ───────────────────────────────────────────────────────────────────
let seed = seedFrom(flag('seed')) ?? randomSeed();
let wood!: Wood;
let walked = 0;
/** Where you stand, and which way you face (free: you walk the way you look). */
const start = flag('at') ?? 0;
let posX = 0;
let posZ = start;
let heading = 0;
/** Begin on a path, facing along it. */
function stand(z: number, resume = false) {
  // going on from where the address says you were (x, y, heading)
  const fx = flag('x');
  const fy = flag('y');
  const fh = flag('heading');
  if (resume && fx !== null && fy !== null) {
    posX = fx;
    posZ = fy;
    heading = fh !== null ? (fh * Math.PI) / 180 : wood.findPath(fx, fy).heading;
  } else {
    const at = wood.findPath(0, z);
    posX = at.x;
    posZ = at.z;
    heading = at.heading;
  }
  heading += flag('look') ?? 0;
  // debug `?find=pond|log|veteran|glade`: stand some metres off the nearest, facing it
  const find = flag('find');
  if (find) {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    const consider = (x: number, z: number) => {
      const d = Math.hypot(x - posX, z - posZ);
      if (d < bd) {
        bd = d;
        best = { x, z };
      }
    };
    // (a wall: stand off to its side, square to it — not on its line, end-on)
    let side: [number, number] | null = null;
    if (find === 'wall') {
      for (let r = 40; r <= 600 && !best; r += 80)
        for (const w of wood.wallsNear(posX, posZ, r))
          if (w.h > 0.7 && Math.hypot(w.x1 - w.x0, w.z1 - w.z0) > 8) {
            const before: { x: number; z: number } | null = best;
            consider((w.x0 + w.x1) / 2, (w.z0 + w.z1) / 2);
            if (best !== before) {
              const L = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
              side = [-(w.z1 - w.z0) / L, (w.x1 - w.x0) / L];
            }
          }
    } else if (find === 'creek' || find === 'ford') {
      // the creek: on its bank, looking across · a ford: on the path, looking along it to the stones
      for (let r = 0; r < 900 && !best; r += 6)
        for (let a = 0; a < 64; a++) {
          const x = posX + Math.cos((a / 64) * 6.283) * r;
          const z = posZ + Math.sin((a / 64) * 6.283) * r;
          const c = wood.creek(x, z);
          if (c.d > 0.8 || c.cut - c.lvl < 0.05) continue;
          if (find === 'creek' ? c.ford === 0 && c.cut - c.lvl > 0.25 : c.ford > 0.9) {
            const before: { x: number; z: number } | null = best;
            consider(x, z);
            if (best !== before) {
              if (find === 'creek') {
                const toward = Math.sign(-c.fz * (posX - x) + c.fx * (posZ - z)) || 1;
                side = [-c.fz * toward, c.fx * toward];
              } else {
                const h = wood.findPath(x, z).heading;
                side = [-Math.sin(h), -Math.cos(h)];
              }
            }
          }
        }
    } else if (find === 'tower' || find === 'viaduct') {
      for (let r = 100; r <= 1600 && !best; r += 250) for (const s of wood.structuresNear(posX, posZ, r)) if (s.kind === find) consider(s.x, s.z);
    } else if (find === 'pond' || find === 'glade')
      for (let r = 0; r < 400 && !best; r += 4)
        for (let a = 0; a < 48; a++) {
          const x = posX + Math.cos((a / 48) * 6.283) * r;
          const z = posZ + Math.sin((a / 48) * 6.283) * r;
          const f = wood.place(x, z);
          if (find === 'pond' ? f.water > 0.3 : f.open > 0.9) consider(x, z);
        }
    else
      for (let r = 20; r <= 300 && !best; r += 40)
        for (const p of wood.around(posX, posZ, r)) if (find === 'log' ? p.kind === 'log' : p.scale > 1.6) consider(p.x, p.z);
    if (best) {
      const b = best as { x: number; z: number };
      const off = flag('off') ?? (find === 'pond' ? 14 : find === 'glade' ? 0 : find === 'tower' ? 22 : find === 'viaduct' ? 30 : find === 'wall' ? 7 : find === 'creek' ? 7 : find === 'ford' ? 9 : 9);
      const a = side ? Math.atan2(side[0], side[1]) : Math.atan2(posX - b.x, posZ - b.z);
      posX = b.x + Math.sin(a) * off;
      posZ = b.z + Math.cos(a) * off;
      heading = Math.atan2(b.x - posX, b.z - posZ) + (flag('look') ?? 0);
      if (wood.place(posX, posZ).water > 0) {
        posX = b.x + Math.sin(a) * off * 1.6;
        posZ = b.z + Math.cos(a) * off * 1.6;
      }
    }
  }
  // debug `?near=2`: stand that far from the nearest tree, facing it (to look at bark)
  const near = flag('near');
  if (near) {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (const p of wood.around(posX, posZ, 25)) {
      if (low(p.kind) || p.kind === 'log' || p.kind.startsWith('h') || p.kind.startsWith('s')) continue;
      const d = Math.hypot(p.x - posX, p.z - posZ);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) {
      const a = Math.atan2(posX - best.x, posZ - best.z);
      posX = best.x + Math.sin(a) * near;
      posZ = best.z + Math.cos(a) * near;
      heading = Math.atan2(best.x - posX, best.z - posZ) + (flag('look') ?? 0);
    }
  }
}
let deer!: Deerland;
/** the deer's skeletons: each one's step cycle, kept as it goes */
const deerRig = new DeerRig();
/** The trees drawn live last frame (they keep their place in the budget). */
const live = new Set<Placed>();
/** A live tree's extra turn (rad): the side its card showed when it came alive (see the frame). */
const liveTurn = new Map<Placed, number>();
/** The side each tree's card is seen from (kept, with some hysteresis). */
let sideOf = new WeakMap<Placed, number>();
function plant(s: number) {
  seed = s;
  wood = new Wood(seed);
  deer = new Deerland({ seed, place: (x, z) => wood.place(x, z), pathDist: (x, z) => wood.pathDist(x, z) });
  wood.only = flag('only');
  forget();
  baker.dispose();
  live.clear();
  liveTurn.clear();
  sideOf = new WeakMap();
  seedBtn.textContent = seedName(seed).replace(/-/g, ' · ');
  setFlag('seed', seedName(seed), { reload: false, by: 'app' });
}
plant(seed);
(window as unknown as { __wood: () => Wood }).__wood = () => wood;
stand(start, true);
requestAnimationFrame(() => veil.classList.add('clear'));

// ─── the view ───────────────────────────────────────────────────────────────────
let quality = 1;
// a preview (?preview, the lab's index): drawn small and pixelated, standing still (the wind, the
// mist and the deer still move), quiet, without its hints or buttons — one of several on a page, so it costs little
const preview = flag('preview');
if (preview) {
  quality = 0.3;
  canvas.style.imageRendering = 'pixelated';
  const quiet = document.createElement('style');
  quiet.textContent = '#hint, #title, #seed, #sound, #readme { display: none !important; }';
  document.head.append(quiet);
}
let slow = 0;
let quick = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

const view: View = { x: 0, z: 0, eye: 1.6, yaw: 0, f: 1, horizon: 0 };
let speed = 0;
let yaw = heading;
let stride = 0;
let footY = wood.groundH(posX, posZ);
/** Flying (dev, ?fly): the eye's height (m). */
let flyY = footY + 1.6;

// ─── input: where you touch says what you mean ─────────────────────────────────────────
// Touch the ground (below the horizon) and you walk, at once, and the finger steers like a
// tiller: held right of the middle you keep bearing right, left of it left, the further out the
// sharper (a still middle band goes straight) — no need to lift and drag again. Touch the
// sky (above it) and you look: across turns you, heavily, as a head turns; up and down cranes
// your neck, harder the further it goes, and eases back level, slowly, when you let go. Two
// fingers pinch to look closer (eases back too). Walking on, the pace builds from a walk to a
// brisk one and, if you keep on, a run. Where the device reports real pressure (Apple Pencil;
// not an iPhone's touch, which reports a fixed 0.5), pressing harder goes faster.
let holding = false;
/** The view's tilt (rad, up +), where the hand would hold it, and how fast it is moving (a spring). */
let pitch = 0;
let pitchTo = 0;
let pitchV = 0;
/** Looking closer: 1 is the eye's own field; more narrows it (a spring too). */
let zoom = 1;
let zoomTo = 1;
let zoomV = 0;
/** How long you have been walking (s): the pace builds with it. */
let walkTime = 0;
/** Real pressure from the pointer, 0 … 1, or null where the device has none. */
let pressure: number | null = null;
const PITCH = 0.55;
const ZOOM = 4;
/** How far a drag turns you (rad per CSS px): a head, not a camera. */
const TURN = 0.0024;
const SLOP = 6;
/** The touches down now (CSS px). */
const touches = new Map<number, { x: number; y: number }>();
/** What the first touch is doing: walking (from the ground) or looking (from the sky). */
let gesture: { kind: 'walk' | 'look' | 'stick'; id: number; x: number; y: number; heading: number; moved: boolean; at: number; atY: number; pitch0: number } | null = null;
/** Flying: how fast you are going (m/s, world x, up, z), easing toward what the stick asks. */
const flyV = [0, 0, 0];
/** Walking, how fast the finger's offset from the middle turns you (rad/s at the edge). */
const STEER = 1.3;
/** Two touches: the pinch, from its first spread and the zoom then. */
let pinch: { d: number; zoom: number } | null = null;
/** Where the pinch looks closer (rad from the view's middle: across, up): kept under the fingers. */
let zoomAt = { across: 0, up: 0 };
let keys = new Set<string>();
let walkedOnce = false;

/** Where the horizon is on the page (CSS px from the top). */
const horizonY = () => innerHeight - view.horizon * (innerHeight / canvas.height);
const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  readPressure(e);
  sound.arm();
  soundBtn.textContent = sound.on ? 'sound on' : 'sound off';
  if (touches.size === 2) {
    // a second finger: a pinch (and a pause: no walking while you look closer)
    pinch = { d: Math.max(spread(), 1), zoom: zoomTo };
    // what lies between the fingers (as angles from the middle of the eye's own field)
    const [a, b] = [...touches.values()];
    const f = innerHeight * 0.92;
    zoomAt = { across: ((a.x + b.x) / 2 - innerWidth / 2) / f, up: Math.atan((horizonY() - (a.y + b.y) / 2) / f) };
    holding = false;
    gesture = null;
    return;
  }
  if (touches.size > 2 || pinch) return;
  // flying (dev): twin sticks — the left half moves you (push from where you touched: up is on,
  // down is back, aside is aside), the right half looks (and the tilt stays)
  const kind = flag('fly') ? (e.clientX < innerWidth / 2 ? 'stick' : 'look') : e.clientY > horizonY() ? 'walk' : 'look';
  gesture = { kind, id: e.pointerId, x: e.clientX, y: e.clientY, heading, moved: false, at: e.clientX, atY: e.clientY, pitch0: pitchTo };
  holding = kind === 'walk';
});
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (!t) return;
  t.x = e.clientX;
  t.y = e.clientY;
  readPressure(e);
  if (pinch && touches.size >= 2) {
    zoomTo = Math.max(1, Math.min(ZOOM, (pinch.zoom * spread()) / pinch.d));
    return;
  }
  const g = gesture;
  if (!g || g.id !== e.pointerId) return;
  // walking: the finger is a tiller (read each frame), not a grip on the world; flying, a stick
  g.at = e.clientX;
  g.atY = e.clientY;
  if (g.kind === 'walk' || g.kind === 'stick') return;
  if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > SLOP) {
    g.moved = true;
    // (no jump for the slop)
    g.x = e.clientX;
    g.y = e.clientY;
  }
  if (!g.moved) return;
  // drag the world round (as if taking hold of it), heavier the closer you look
  heading = g.heading - ((e.clientX - g.x) * TURN) / zoom;
  if (g.kind === 'look') {
    // drag it down and you look up; the neck resists more the further it cranes
    const raw = ((e.clientY - g.y) * TURN * 1.1) / zoom;
    const lim = flag('fly') ? 1.3 : PITCH;
    pitchTo = flag('fly') ? Math.max(-lim, Math.min(lim, g.pitch0 + raw)) : PITCH * Math.tanh(raw / PITCH);
  }
});
function readPressure(e: PointerEvent) {
  // a touch without pressure reports 0.5 while down (or 0); anything else is the real thing
  if (e.pressure > 0 && e.pressure !== 0.5) pressure = e.pressure;
}
const lift = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (pinch) {
    // the pinch ends when a finger lifts; the view eases back out
    if (touches.size < 2) {
      pinch = null;
      zoomTo = 1;
      zoomV = 0;
    }
    if (touches.size === 0) release();
    return;
  }
  if (gesture?.id === e.pointerId) release();
};
const release = () => {
  holding = false;
  gesture = null;
  pinch = null;
  if (!flag('fly')) pitchTo = 0;
  zoomTo = 1;
  // (from rest: the head settles back, easing in and out, not flung on past where it was)
  pitchV = 0;
  zoomV = 0;
  pressure = null;
  touches.clear();
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (['ArrowUp', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  sound.arm();
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => {
  keys = new Set();
  release();
});
// away from the page: nothing to draw, and the time away is not a slow frame
let hidden = false;
document.addEventListener('visibilitychange', () => {
  hidden = document.hidden;
  if (hidden) release();
  else last = performance.now();
});
let changing = false;
seedBtn.addEventListener('click', () => {
  if (changing) return;
  changing = true;
  veil.classList.remove('clear');
  setTimeout(() => {
    plant(randomSeed());
    walked = 0;
    speed = 0;
    stand(0);
    footY = wood.groundH(posX, posZ);
    yaw = heading;
    veil.classList.add('clear');
    changing = false;
  }, 1300);
});
soundBtn.addEventListener('click', () => {
  soundBtn.textContent = sound.toggle() ? 'sound on' : 'sound off';
});
setTimeout(() => title.classList.add('away'), 4200);
setTimeout(() => !walkedOnce && hint.classList.add('show'), 3000);

// ─── each frame ───────────────────────────────────────────────────────────────────
let t = flag('time') ?? 0;
const shade = new Float32Array(40 * 4);
/** The wood's small voices: the nearest wet ground (its way, its distance), and how open it is here. */
let lookedAbout = -9;
const voices = { wetPan: 0, wetDist: Infinity, open: 0, creekDist: Infinity, creekAt: 0, creekFord: 0 };
const structA = new Float32Array(24);
const structB = new Float32Array(24);
const wallA = new Float32Array(96);
const ford = new Float32Array(24);
const wallB = new Float32Array(96);
const shadeOff = new Float32Array(40 * 2);
let shadeN = 0;
/** The time of day: your clock (or ?hour=), passing in real time. */
function hourAt() {
  const p = flag('hour');
  const now = new Date();
  return p !== null ? p + t / 3600 : now.getHours() + now.getMinutes() / 60;
}
// debug `?deer`: a herd ahead, now
function bringDeer() {
  if (!flag('deer')) return;
  const d = flag('deerAt') ?? 30;
  deer.bring(posX + Math.sin(heading) * d, posZ + Math.cos(heading) * d, flag('deerBed'), hourAt());
}
bringDeer();
let last = performance.now();
/** Near trees are drawn as live geometry within this distance (m), up to this many segments a frame. */
const LIVE = 16;
const DARK: [number, number, number] = [0.1, 0.095, 0.08];
/** Rushes: dark, olive. */
const RUSH: [number, number, number] = [0.13, 0.14, 0.07];
const LIVE_BUDGET = 400000;
/** Depth of field: the lens's aperture (m) — what is near blurs (a twig at half a metre to a faint smear). */
const APERTURE = 0.012;
const nextPow2 = (x: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, x))));

function frame(now: number) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  // (frozen, the wind, the mist and the grain hold still; you can still walk and look)
  if (!flag('freeze')) t += dt;
  if (hidden) {
    requestAnimationFrame(frame);
    return;
  }
  // the resolution follows the frame rate, down when slow, and back up when there is room
  // (a long gap — a stall, a tab coming back — says nothing about the drawing)
  if (raw < 0.25) {
    slow = raw > 0.028 ? slow + raw : Math.max(0, slow - raw * 0.5);
    quick = raw < 0.019 ? quick + raw : 0;
  }
  if (!flag('fixed') && !preview) {
    if (slow > 3 && quality > 0.5) {
      quality = Math.max(0.5, quality * 0.82);
      slow = 0;
      quick = -10; // (a while before trying higher again)
      resize();
    } else if (quick > 6 && quality < 1) {
      quality = Math.min(1, quality / 0.9);
      quick = 0;
      resize();
    }
  }
  const flying = flag('fly');
  const forward = holding || flag('walk') || keys.has('ArrowUp') || keys.has('w') || keys.has(' ');
  if (gesture?.kind === 'walk') {
    // the tiller: offset from the middle (−1 … 1), a still band in the middle, sharper outwards
    const off = (gesture.at - innerWidth / 2) / (innerWidth / 2);
    const bear = Math.sign(off) * Math.pow(smoothstep(0.12, 1, Math.abs(off)), 1.4);
    heading += dt * STEER * bear;
  }
  if (keys.has('ArrowLeft')) heading -= dt * 0.8;
  if (keys.has('ArrowRight')) heading += dt * 0.8;
  // the pace: a walk, building to a brisk one as you keep on (or as hard as you press)
  walkTime = forward ? walkTime + dt : 0;
  // a walk (1.2 m/s), brisk after a few seconds (2), and on into a run if you keep on (3.8)
  // (a walk 2.4 m/s, brisk 4, a run 7.6 — and flying, three times that)
  const pace = flying ? 0 : pressure !== null ? 1.4 + 6.2 * pressure : 2.4 + 1.6 * smoothstep(3, 9, walkTime) + 3.6 * smoothstep(12, 18, walkTime);
  speed += ((forward ? pace : 0) - speed) * (1 - Math.exp(-dt * (forward ? 1.4 : 2.2)));
  walked += speed * dt;
  if (speed > 0.3 && !walkedOnce) {
    walkedOnce = true;
    hint.classList.remove('show');
  }
  // footfalls: a step is half a stride (π of its phase). The step lengthens far more than it
  // quickens: two a second at a walk, a little under three at a run, where each is a long bound
  const running = smoothstep(4.2, 7, speed);
  const cadence = Math.min(speed / 1.2, 2 + 0.8 * running);
  const foot = Math.floor(stride / Math.PI);
  stride += dt * Math.PI * cadence;
  if (Math.floor(stride / Math.PI) !== foot && speed > 0.4 && !flying) sound.step(clamp01(speed / 2.4), running, foot % 2 ? 1 : -1);
  const W = canvas.width;
  const H = canvas.height;
  // you walk the way you face (the view turns a moment behind the hand, and sways a little)
  // the head turns after the hand, with some weight
  yaw += (heading - yaw) * (1 - Math.exp(-dt * 3.5));
  // flying (dev): the way you look, up and down too, through anything
  if (flying) {
    // the stick (left thumb): how far it is pushed from where it touched, up to 70 px; the keys too
    let on = 0;
    let aside = 0;
    if (gesture?.kind === 'stick') {
      const sx = (gesture.at - gesture.x) / 70;
      const sy = (gesture.atY - gesture.y) / 70;
      const m = Math.hypot(sx, sy);
      const k = m > 1 ? 1 / m : 1;
      on = -sy * k;
      aside = sx * k;
    }
    on += (keys.has('ArrowUp') || keys.has('w') ? 1 : 0) - (keys.has('ArrowDown') || keys.has('s') ? 1 : 0);
    aside += (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    const shape = (v: number) => Math.sign(v) * Math.pow(Math.min(Math.abs(v), 1), 1.5);
    const top = 14;
    // the way you look (up and down too), and across it
    const cp = Math.cos(pitch);
    const look = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
    const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const lift = ((keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0)) * 0.6;
    for (let i = 0; i < 3; i++) {
      const want = (look[i] * shape(on) + right[i] * shape(aside) + (i === 1 ? lift : 0)) * top;
      flyV[i] += (want - flyV[i]) * (1 - Math.exp(-dt * 3));
    }
    posX += flyV[0] * dt;
    posZ += flyV[2] * dt;
    flyY = Math.max(flyY + flyV[1] * dt, wood.groundH(posX, posZ) + 0.4);
  }
  // you walk to the water's edge, not into it
  const nx = flying ? posX : posX + Math.sin(yaw) * speed * dt;
  const nz = flying ? posZ : posZ + Math.cos(yaw) * speed * dt;
  // and not through stone: along it instead (the move less its part into the wall)
  let mx = nx;
  let mz = nz;
  const near = wood.structuresNear(nx, nz, 12);
  const nearWalls = wood.wallsNear(nx, nz, 6);
  if (!flying && (near.length || nearWalls.length) && wood.stoneDist(nx, nz, near, nearWalls) < 0.45) {
    const e = 0.05;
    const gx = wood.stoneDist(nx + e, nz, near, nearWalls) - wood.stoneDist(nx - e, nz, near, nearWalls);
    const gz = wood.stoneDist(nx, nz + e, near, nearWalls) - wood.stoneDist(nx, nz - e, near, nearWalls);
    const gl = Math.hypot(gx, gz) || 1;
    const vx = nx - posX;
    const vz = nz - posZ;
    const into = Math.min(0, (vx * gx + vz * gz) / gl);
    mx = posX + vx - (into * gx) / gl;
    mz = posZ + vz - (into * gz) / gl;
    if (wood.stoneDist(mx, mz, near, nearWalls) < 0.4) {
      mx = posX;
      mz = posZ;
    }
  }
  // nor through anything set solid in the wood from outside: along it instead
  const solid = obstacle.at;
  if (!flying && solid && solid(mx, mz) < 0.45) {
    const e = 0.05;
    const gx = solid(mx + e, mz) - solid(mx - e, mz);
    const gz = solid(mx, mz + e) - solid(mx, mz - e);
    const gl = Math.hypot(gx, gz) || 1;
    const vx = mx - posX;
    const vz = mz - posZ;
    const into = Math.min(0, (vx * gx + vz * gz) / gl);
    mx = posX + vx - (into * gx) / gl;
    mz = posZ + vz - (into * gz) / gl;
    if (solid(mx, mz) < 0.4 && solid(mx, mz) < solid(posX, posZ)) {
      mx = posX;
      mz = posZ;
    }
  }
  // nor into water: a pond past its shallows, the creek where it runs deep (a ford takes you over);
  // along the bank instead (and out of it, if you are somehow in it)
  const deep = (x: number, z: number) => Math.max(wood.relief[2] - 0.15 - wood.landH(x, z), wood.creekDepth(x, z) - 0.2);
  const here = flying ? 0 : deep(posX, posZ);
  const can = (x: number, z: number) => { const d = deep(x, z); return d <= 0 || d < here; };
  if (flying || can(mx, mz)) {
    posX = mx;
    posZ = mz;
  } else if (can(mx, posZ)) posX = mx;
  else if (can(posX, mz)) posZ = mz;
  view.z = posZ;
  // standing still is still: the sway and the breath are the walk's
  const going = clamp01(speed / 1.1);
  // (the body over each foot in turn: a sway to the side, one way and back each stride)
  const sway = Math.sin(stride) * (0.025 + 0.03 * running) * going;
  view.x = posX + Math.sin(t * 0.037) * 0.12 * going + Math.cos(yaw) * sway;
  view.z = posZ - Math.sin(yaw) * sway;
  // looking closer, turned toward what is between the fingers (the more, the closer)
  const toward = 1 - 1 / zoom;
  view.yaw = yaw + Math.sin(t * 0.05) * 0.015 * going + zoomAt.across * toward;
  // the eye rides the ground (a moment behind it, as legs take a slope)
  footY += (wood.groundH(posX, posZ) - footY) * (1 - Math.exp(-dt * 5));
  // the bob: lowest as each foot comes down, highest between; at a run, a bound (the drop sharper)
  const lift = Math.pow(Math.abs(Math.sin(stride)), 1 - 0.4 * running) - 0.6;
  view.eye = flying ? flyY : footY + 1.6 + lift * (0.03 + 0.06 * running) * going + Math.sin(t * 0.06) * 0.03 * going;
  view.f = H * 0.92;
  // the tilt follows the hand, and settles back level when let go
  // springs: stiff while held (the neck following the hand, a little behind), soft and slow when
  // let go (the head settling back level, easing in and out)
  const spring = (x: number, to: number, v: number, k: number) => {
    const c = 2 * Math.sqrt(k);
    v += (k * (to - x) - c * v) * dt;
    return [x + v * dt, v];
  };
  // (at rest the head is level — or as ?tilt holds it, to look at the ground in a picture)
  // (flying, the tilt stays where you leave it)
  [pitch, pitchV] = spring(pitch, gesture?.kind === 'look' || flying ? pitchTo : (flag('tilt') ?? 0), pitchV, gesture?.kind === 'look' ? 30 : 3);
  [zoom, zoomV] = spring(zoom, zoomTo, zoomV, pinch ? 40 : 4);
  view.f *= zoom;
  view.horizon = H * 0.4 - Math.tan(pitch + zoomAt.up * toward) * view.f;

  // what stands in view, and the card each needs
  const c = Math.cos(view.yaw);
  const s = Math.sin(view.yaw);
  const density = wood.densityAt(posX, posZ) * (flag('fog') ?? 1);
  const atmos = atmosphere(hourAt(), flag('moon') ?? moonPhase(new Date()), flag('warm') ?? 0);
  const sunAz = atmos.at[0];
  const want: Array<{ kind: Kind; pool: number; level: number; px: number; side: number; right: [number, number] }> = [];
  const draws: Array<Draw & { d: number }> = [];
  const ungrown: Array<{ p: Placed; hd: number }> = [];
  // what stands in view (grown the first time it is wanted, a few a frame)
  const seen: Array<{ p: Placed; st: Structure; hd: number; R: number; hM: number; base: number }> = [];
  for (const p of wood.around(view.x, view.z, VIEW)) {
    const rx = p.x - view.x;
    const rz = p.z - view.z;
    const cz = rx * s + rz * c;
    const cx = rx * c - rz * s;
    const hd = Math.hypot(cx, cz);
    // (what is very near is not cut away: it blurs out, in the shaders)
    if (hd > VIEW || hd < 0.12 || cz < -4) continue;
    // low cover is drawn near (grass to 22 m, scrub further); beyond, the ground shader's scrub
    if (low(p.kind) && hd > (p.kind === 'scrub' ? 38 : 22)) continue;
    if (!wood.grown(p.kind, p.pool)) {
      ungrown.push({ p, hd });
      continue;
    }
    const st = wood.structure(p.kind, p.pool);
    const R = st.radius * p.scale;
    const hM = st.maxY * p.scale;
    // off to the side (cylindrical: across the screen is angle), allowing for its reach
    if (Math.abs(Math.atan2(cx, cz)) - Math.atan2(R, Math.max(hd, 0.1)) > W / (2 * view.f) + 0.05) continue;
    // its foot on the ground (grass a little into it, so a slope does not lift its edge)
    const base = wood.groundH(p.x, p.z) - (low(p.kind) ? 0.03 : p.kind === 'log' ? 0.1 : 0.05);
    seen.push({ p, st, hd, R, hM, base });
  }
  // grow a few of what is wanted and not yet grown, the nearest first
  ungrown.sort((a, b) => a.hd - b.hd);
  for (let k = 0, grows = 0; k < ungrown.length && grows < 2; k++) {
    const { p } = ungrown[k];
    if (wood.grown(p.kind, p.pool)) continue;
    wood.structure(p.kind, p.pool);
    grows++;
  }
  // the nearest first get the live geometry while there is budget — and those already live keep
  // their place ahead of newcomers, so a tree does not flicker between live and card
  seen.sort((a, b) => a.hd - (live.has(a.p) ? 3 : 0) - (b.hd - (live.has(b.p) ? 3 : 0)));
  let liveLeft = LIVE_BUDGET * quality * quality;
  const nowLive = new Set<Placed>();
  for (const { p, st, hd, R, hM, base } of seen) {
    // which side of it you see: its card is baked from the nearest of twelve, kept until you are
    // well past the halfway to the next (no flicker at the boundary). A live tree is drawn turned
    // by the difference between where you truly see it from and the side its card showed when it
    // came alive — so card and tree coincide at the handover, and only true parallax remains
    // (the tree's turn is arbitrary: it keeps that turn while it stays live)
    const ex = view.x - p.x;
    const ez = view.z - p.z;
    const el = Math.hypot(ex, ez) || 1;
    const rwx = -ez / el;
    const rwz = ex / el;
    let rotUse = p.rot + (liveTurn.get(p) ?? 0);
    let side = 0;
    let right: [number, number] = [1, 0];
    let aExact = 0;
    const STEP = (2 * Math.PI) / SIDES;
    if (!low(p.kind)) {
      const cr = Math.cos(rotUse);
      const sr = Math.sin(rotUse);
      aExact = Math.atan2(-rwx * sr + rwz * cr, rwx * cr + rwz * sr);
      const at = aExact / STEP;
      const prev = sideOf.get(p);
      const off = prev === undefined ? 1 : Math.abs((((at - prev) % SIDES) + SIDES * 1.5) % SIDES - SIDES / 2);
      side = off < 0.75 ? prev! : ((Math.round(at) % SIDES) + SIDES) % SIDES;
      sideOf.set(p, side);
      const a = side * STEP;
      right = [Math.cos(a), Math.sin(a)];
    }
    // the pixels it needs: its size on screen, less as the fog takes it
    const fogged = 1 - Math.exp(-hd * density * 1.4);
    const need = ((Math.max(2 * R, hM) * view.f) / Math.max(hd, 0.5)) * (1 - 0.75 * fogged);
    const pxNeed = need * (need > 900 ? Math.max(bias, 0.8) : bias);
    const level = Math.max(64, Math.min(low(p.kind) ? 1024 : 2048, nextPow2(pxNeed)));
    const card = bestCard(p.kind, p.pool, level, side);
    // the handover: coming near, the live tree fades in over its card (LIVE → LIVE − 2.5 m),
    // then the card fades out from under it (→ LIVE − 5 m); coverage never dips between them
    let liveAlpha = 0;
    let cardAlpha = 1;
    if (!low(p.kind) && hd < LIVE) {
      // the segments that would still be a tenth of a pixel wide or more; short of budget, fewer
      // (they come thickest first), down to those over half a pixel; less than that, a card
      const px = hd / (view.f * p.scale);
      let n = countWider(st, 0.1 * px);
      if (n > liveLeft && countWider(st, 0.5 * px) <= liveLeft) n = Math.floor(liveLeft);
      if (n <= liveLeft && n > 0) {
        liveLeft -= n;
        nowLive.add(p);
        if (!liveTurn.has(p)) {
          // coming alive: turned to the side its card shows (the wrapped difference)
          const turn = card ? Math.atan2(Math.sin(aExact - card.side * STEP), Math.cos(aExact - card.side * STEP)) : 0;
          liveTurn.set(p, turn);
          rotUse += turn;
        }
        const g = wood.genomeOf(p.kind);
        liveAlpha = 1 - smoothstep(LIVE - 2.5, LIVE, hd);
        cardAlpha = smoothstep(LIVE - 5, LIVE - 2.5, hd);
        draws.push({ live: true, buffer: baker.buffer(st), count: n, wide: Math.min(n, countWider(st, 3 * px)), x: p.x, z: p.z, base, mist: [0, 0], top: st.maxY * p.scale, rot: rotUse, scale: p.scale, phase: p.phase, radius: st.radius, height: st.maxY, alpha: liveAlpha, bark: g?.bark ?? DARK, barkP: g ? [g.barkRough, g.barkScale, g.lichen, g.moss] : [0.5, 1, 0.3, 0.3], viewAz: Math.atan2(view.x - p.x, view.z - p.z) + rotUse, d: hd - 1e-3 });
      }
    }
    if (cardAlpha <= 0.001) continue;
    if (!card || card.level < level) want.push({ kind: p.kind, pool: p.pool, level, px: pxNeed, side, right });
    if (!card) continue;
    card.used = t;
    const left = card.left * p.scale;
    const width = card.width * p.scale;
    const flip = low(p.kind) && p.flip;
    draws.push({
      live: false,
      card,
      x: p.x,
      z: p.z,
      rect: flip ? [-left, card.bottom * p.scale, -width, card.height * p.scale] : [left, card.bottom * p.scale, width, card.height * p.scale],
      flip,
      phase: p.phase,
      patch: p.kind === 'patch' || p.kind === 'scrub',
      base,
      mist: [0, 0],
      top: low(p.kind) ? 0 : (card.bottom + card.height) * p.scale,
      bark: p.kind === 'rush' ? RUSH : wood.genomeOf(p.kind)?.bark ?? DARK,
      alpha: cardAlpha,
      d: hd,
    });
  }
  live.clear();
  for (const p of nowLive) live.add(p);
  // a tree no longer live goes back to its own turn
  for (const p of liveTurn.keys()) if (!nowLive.has(p)) liveTurn.delete(p);
  // bake what is wanted, biggest on screen first, a little each frame
  want.sort((a, b) => b.px - a.px);
  let budget = 150000;
  const baked = new Set<string>();
  for (const w of want) {
    const key = keyOf(w.kind, w.pool, w.level, w.side);
    if (baked.has(key) || cards.has(key)) continue;
    const st = wood.structure(w.kind, w.pool);
    if (budget - st.count < 0 && baked.size) break;
    budget -= st.count;
    baked.add(key);
    const card = baker.bake(st, w.level, w.right, low(w.kind));
    card.used = t;
    card.side = w.side;
    cards.set(key, card);
    texels += card.texels;
  }
  // over budget: let go of the cards least recently used (never one in use this frame)
  if (texels > BUDGET) {
    const old = [...cards.entries()].filter(([, cd]) => cd.used < t).sort((a, b) => a[1].used - b[1].used);
    for (const [k, cd] of old) {
      if (texels <= BUDGET * 0.85) break;
      gl.deleteTexture(cd.tex);
      cards.delete(k);
      texels -= cd.texels;
    }
  }
  // still over (everything in view is in use): ask for less everywhere, and recover slowly
  if (texels > BUDGET * 1.05) bias = Math.max(0.3, bias * 0.7);
  else if (texels < BUDGET * 0.6) bias = Math.min(1, bias + dt * 0.02);
  // deer: living here, heard before they are seen
  deer.calm = flag('deerCalm');
  const heard = (x: number, z: number) => {
    const a = Math.atan2(x - view.x, z - view.z) - view.yaw;
    const dist = Math.hypot(x - view.x, z - view.z);
    return { pan: Math.sin(a) * 0.9, at: 1 / (1 + dist / 14), far: dist / 70 };
  };
  deer.step(flag('freeze') ? 0 : dt, t, { x: view.x, z: view.z, yaw: view.yaw, speed, vis: 2.3 / Math.max(density, 1e-3), hour: hourAt() }, {
    snap: (x, z, loud) => {
      const h = heard(x, z);
      sound.snap(h.pan, 0.6 * loud * h.at, h.far);
    },
    rustle: (x, z, loud) => {
      const h = heard(x, z);
      sound.rustle(h.pan, 0.35 * loud * h.at, h.far);
    },
    stamp: (x, z, loud) => {
      const h = heard(x, z);
      sound.stamp(h.pan, 0.5 * loud * h.at, h.far);
    },
    bark: (x, z, loud) => {
      const h = heard(x, z);
      sound.bark(h.pan, 0.5 * loud * Math.sqrt(h.at), h.far);
    },
  });
  for (const d of deer.all()) {
    const hd = Math.hypot(d.x - view.x, d.z - view.z);
    if (hd > VIEW || hd < 0.5) continue;
    // its skeleton posed for what it is doing: its gait from its speed, its head, lying up or not
    const base = wood.groundH(d.x, d.z);
    const coat = flag('deerCoat');
    draws.push({ live: false, bones: deerRig.pose(d, base, view, flag('freeze') ? 0 : dt), x: d.x, z: d.z, base, mist: [0, 0], top: 1.9 * d.size, alpha: 1, coat: coat ? (coat === 'dappled' ? 1 : 0) : d.coat, d: hd });
  }
  // things set into the wood from outside (the Field Journal's finds): coloured sprites standing
  // on the ground, drawn in their place among the trees, in the same fog
  for (const sp of sprites.values()) {
    const hd = Math.hypot(sp.x - view.x, sp.z - view.z);
    if (hd > VIEW || hd < 0.4 || !sp.tex) continue;
    draws.push({ live: false, card: { tex: sp.tex, level: 0, texels: 0, used: t, left: -sp.w / 2, bottom: 0, width: sp.w, height: sp.h, side: 0 } as Card, x: sp.x, z: sp.z, rect: [-sp.w / 2, -sp.sink, sp.w, sp.h], flip: false, phase: 0, patch: false, sprite: true, base: wood.groundH(sp.x, sp.z), mist: [0, 0], top: sp.h, bark: DARK, alpha: sp.alpha, d: hd });
  }
  for (const cu of customs.values()) {
    const hd = Math.hypot(cu.x - view.x, cu.z - view.z);
    if (hd > (cu.range ?? VIEW) || (cu.first === undefined && !cu.last && hd < 0.2)) continue;
    draws.push({ live: false, custom: cu.draw, x: cu.x, z: cu.z, base: wood.groundH(cu.x, cu.z), mist: [0, 0], top: cu.top, alpha: 1, bark: DARK, d: cu.first !== undefined ? 1e6 * (1 + cu.first) - hd : cu.last ? -1e6 : hd });
  }
  // the mist along the way to each (to its foot, and to its top): it lies between you and it, so
  // walking, the banks pass in front of things and you walk into and through them
  for (const dr of draws) {
    const foot = wood.mistAlong(view.x, view.eye, view.z, dr.x, dr.base + 0.3, dr.z, t, dr.top > 0.5 ? 6 : 3);
    dr.mist = [foot, dr.top > 0.5 ? wood.mistAlong(view.x, view.eye, view.z, dr.x, dr.base + dr.top, dr.z, t, 6) : foot];
  }
  draws.sort((a, b) => b.d - a.d);
  // the nearest trees shade the ground (contact at the foot, a soft pool under the crown,
  // set away from the brighter place where the sun is behind the fog)
  shadeN = 0;
  for (const { p, st, hd } of seen) {
    if (shadeN >= 40 || hd > 28) break;
    if (low(p.kind) || p.kind === 'log') continue;
    const crown = st.radius * p.scale * 0.8;
    const tall = st.maxY * p.scale;
    shade.set([p.x, p.z, 0.35 + crown * 0.08, crown], shadeN * 4);
    shadeOff.set([-Math.sin(sunAz) * tall * 0.25, -Math.cos(sunAz) * tall * 0.25], shadeN * 2);
    shadeN++;
  }
  const wind = 0.55 + 0.45 * Math.sin(t * 0.11) * Math.sin(t * 0.067 + 1);
  // the sun, behind the fog, in the view's terms (for shading the round wood)
  const [sx, sy, sz] = atmos.dir;
  const sl = Math.hypot(sx, sy, sz);
  const cy = Math.cos(view.yaw);
  const syw = Math.sin(view.yaw);
  const light: [number, number, number] = [(sx * cy - sz * syw) / sl, sy / sl, -(sx * syw + sz * cy) / sl];
  // the stone near you, for the shader (the nearest six)
  const stone = wood.structuresNear(view.x, view.z, 140).sort((a, b) => Math.hypot(a.x - view.x, a.z - view.z) - Math.hypot(b.x - view.x, b.z - view.z)).slice(0, 6);
  stone.forEach((s, i) => {
    structA.set([s.x, s.z, s.rot, s.kind === 'tower' ? 1 : 2], i * 4);
    structB.set(s.kind === 'tower' ? [s.base, s.a, s.b, s.c] : [s.base, s.a, s.b, s.c], i * 4);
  });
  // the walls near you, nearest first (24 stretches: walls further off are lost in the fog)
  const wallsHere = wood
    .wallsNear(view.x, view.z, 70)
    .map((w) => ({ w, d: Math.hypot((w.x0 + w.x1) / 2 - view.x, (w.z0 + w.z1) / 2 - view.z) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 24);
  wallsHere.forEach(({ w }, i) => {
    wallA.set([w.x0, w.z0, w.x1, w.z1], i * 4);
    wallB.set([w.y0, w.y1, w.h, w.caps * 1000 + w.seed], i * 4);
  });
  // the fords in sight, for the shader
  const fordsHere = wood.fordsNear(view.x, view.z, 60).sort((a, b) => Math.hypot(a.x - view.x, a.z - view.z) - Math.hypot(b.x - view.x, b.z - view.z)).slice(0, 6);
  fordsHere.forEach((f, i) => ford.set([f.x, f.z, f.nx, f.nz], i * 4));
  const sketch = flag('style') === 'sketch'
    ? { pencil: flag('pencil') ?? 1, hatch: flag('hatch') ?? 5, loose: flag('loose') ?? 1, lines: flag('lines') ?? 1, boil: flag('boil') ?? 0, tooth: flag('tooth') ?? 0.6, spare: flag('spare') ?? 0.3, haze: flag('haze') ?? 0.05 }
    : null;
  renderer.draw(view, { light, shade, shadeOff, shadeN, seed, t, density, wind, path: wood.path, atmos, relief: wood.relief, openness: wood.openness, creek: wood.creekK, ford, fordN: fordsHere.length, structA, structB, structN: stone.length, wallA, wallB, wallN: wallsHere.length, blur: view.f * APERTURE * (flag('dof') ?? 1), focus: flag('focus') ?? 5, sketch, anom: nearestAnomalies() }, draws);
  sound.update(dt, t, speed, atmos.day, wind);
  // the small voices: where the nearest wet ground is (looked for now and then), how open it is
  if (t - lookedAbout > 1) {
    lookedAbout = t;
    let bd = Infinity;
    let ba = 0;
    for (const r of [6, 15, 28, 42])
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const f = wood.place(posX + Math.sin(a) * r, posZ + Math.cos(a) * r);
        if ((f.wet > 0.75 || f.water > 0) && r < bd) {
          bd = r;
          ba = a;
        }
      }
    voices.wetDist = bd;
    voices.wetPan = Math.sin(ba - view.yaw);
    voices.open = wood.place(posX, posZ).open;
    // the creek: its nearest water, and whether it runs over a ford there
    voices.creekDist = Infinity;
    for (const r of [0, 3, 7, 12, 19, 28, 40])
      for (let k = 0; k < (r ? 12 : 1); k++) {
        const a = (k / 12) * Math.PI * 2;
        const x = posX + Math.sin(a) * r;
        const z = posZ + Math.cos(a) * r;
        const c = wood.creek(x, z);
        if (c.cut > c.lvl && r < voices.creekDist) {
          voices.creekDist = r;
          voices.creekAt = a;
          voices.creekFord = c.ford;
        }
      }
  }
  sound.water(dt, { near: Number.isFinite(voices.creekDist) ? Math.exp(-voices.creekDist / 14) : 0, pan: voices.creekDist > 0 ? Math.sin(voices.creekAt - view.yaw) : 0, ford: voices.creekFord });
  sound.creatures(dt, { night: 1 - atmos.day, wetPan: voices.wetPan, wetDist: voices.wetDist, open: voices.open, heat: atmos.day * Math.max(0, flag('warm') ?? 0) });
  // (the camera, for whatever is drawn over the wood: a point's place on the screen follows from
  // these — see render.ts, the world's projection — and the ground's height under it)
  (window as unknown as { __mistwoodView: unknown }).__mistwoodView = { x: view.x, z: view.z, eye: view.eye, yaw: view.yaw, f: view.f, horizon: view.horizon, W: canvas.width, H: canvas.height, seed, density, ground: (x: number, z: number) => wood.groundH(x, z) };
  (window as unknown as { __mistwood: unknown }).__mistwood = {
    seed: seedName(seed),
    walked: Math.round(walked * 10) / 10,
    /** how far the creek's nearest water is (m; null if none within 40 m) */
    creek: Number.isFinite(voices.creekDist) ? voices.creekDist : null,
    at: [Math.round(posX * 10) / 10, Math.round(posZ * 10) / 10],
    live: draws.filter((d) => d.live).length,
    segments: draws.reduce((n, d) => n + (d.live ? d.count : 0), 0),
    deer: [...deer.herds.values()].map((h) => `${h.key} ${h.mode} ×${h.deer.length} alarm ${h.alarm.toFixed(2)} ${Math.round(Math.hypot(h.deer[0].x - view.x, h.deer[0].z - view.z))}m`),
    cards: draws.length,
    baked: cards.size,
    mb: Math.round((texels * 4) / 1e6),
    bias: Math.round(bias * 100) / 100,
    waiting: want.length,
    /** everything in view grown and baked as sharp as it is wanted (a screenshot now is the real one) */
    settled: want.length === 0 && ungrown.length === 0,
    heading: Math.round(((((heading * 180) / Math.PI) % 360) + 360) % 360),
    quality: Math.round(quality * 100) / 100,
    /** the game clock (s): headless frames are slow, so tests wait on this, not on the wall clock */
    clock: Math.round(t * 100) / 100,
    eye: Math.round(view.eye * 100) / 100,
    pace: Math.round(speed * 100) / 100,
    pitch: Math.round(pitch * 1000) / 1000,
    zoom: Math.round(zoom * 100) / 100,
    pressure,
    place: Object.fromEntries(Object.entries(wood.place(posX, posZ)).map(([k, v]) => [k, Math.round(v * 100) / 100])),
  };
  keepAddress(now);
  requestAnimationFrame(frame);
}

// ─── the journey in the address: where you are and which way you face, kept up to date (about
// once a second, when it changed) so a reload — or a link — goes on from there. And the other
// way: a change to x, y or heading (the overlay, a test in the same page) moves you there now,
// and a new seed is a new wood, without making the page again.
let written = '';
let writtenAt = 0;
const round1 = (v: number) => Math.round(v * 10) / 10;
function keepAddress(now: number) {
  if (now - writtenAt < 1000) return;
  const deg = Math.round(((((heading * 180) / Math.PI) % 360) + 360) % 360) % 360;
  const key = `${round1(posX)},${round1(posZ)},${deg}`;
  if (key === written) return;
  writtenAt = now;
  written = key;
  setFlags({ x: round1(posX), y: round1(posZ), heading: deg }, { by: 'app' });
}
/** Stand here now (no walking there): the eye on the ground, facing `h` if given. */
function moveTo(x: number, z: number, h?: number) {
  posX = x;
  posZ = z;
  if (h !== undefined) {
    heading = h;
    yaw = h;
  }
  footY = wood.groundH(posX, posZ);
  written = '';
}
onFlag((name, by) => {
  // flying: up from where the eye is now; landing: the head level again
  if (name === 'fly') {
    flyY = view.eye;
    if (!flag('fly')) pitchTo = 0;
  }
  if (by === 'app') return;
  if (name === 'x' || name === 'y' || name === 'heading') {
    const h = flag('heading');
    moveTo(flag('x') ?? posX, flag('y') ?? posZ, name === 'heading' && h !== null ? (h * Math.PI) / 180 : undefined);
  } else if (name === 'seed') {
    // another wood: from its start, unless the address also says where
    plant(seedFrom(flag('seed')) ?? randomSeed());
    walked = 0;
    speed = 0;
    stand(0);
    moveTo(posX, posZ, heading);
    bringDeer();
  }
});
// for a test in the same page: read and set the flags as the overlay does
(window as unknown as { __flags: unknown }).__flags = { flag, setFlag, setFlags };
requestAnimationFrame((n) => {
  last = n;
  requestAnimationFrame(frame);
});
// development: every flag in a panel (`?tune`)
if (flag('tune')) mountTune(() => (window as unknown as { __mistwood: unknown }).__mistwood);
