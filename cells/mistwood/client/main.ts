/**
 * Mistwood — a walk through a seeded wood, beside a stream, towards the light.
 *
 * Hold to walk; drag to look about. The seed is in the address (?seed=moss-ford-7)
 * and at the foot of the screen; touch it for another wood. Nothing to do,
 * nothing to finish: the light over the water stays ahead.
 *
 * Debug: ?at=<metres> starts further along; ?walk=1 walks on its own; ?fixed keeps full resolution;
 * ?look=<radians>; window.__mistwood reports where you are.
 */
import { Sound } from './audio';
import { Renderer, STRIDE, type View } from './render';
import { clamp01, randomSeed, seedFrom, seedName } from './rng';
import { paintAtlas } from './sprites';
import { Wood, VIEW } from './world';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('wood') as HTMLCanvasElement;
const veil = document.getElementById('veil')!;
const title = document.getElementById('title')!;
const hint = document.getElementById('hint')!;
const seedBtn = document.getElementById('seed') as HTMLButtonElement;
const soundBtn = document.getElementById('sound') as HTMLButtonElement;

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  hint.textContent = (e as Error).message;
  hint.classList.add('show');
  throw e;
}
const sound = new Sound();

let seed = seedFrom(params.get('seed')) ?? randomSeed();
let wood!: Wood;
let walked = Number(params.get('at')) || 0;

function plant(s: number) {
  seed = s;
  wood = new Wood(seed);
  const atlas = paintAtlas(seed);
  wood.sprites = atlas.keys;
  wood.aspect = atlas.sprites.map((sp) => sp.aspect);
  renderer.setAtlas(atlas.canvas);
  sprites = atlas.sprites;
  seedBtn.textContent = seedName(seed).replace(/-/g, ' · ');
  const url = new URL(location.href);
  url.searchParams.set('seed', seedName(seed));
  history.replaceState(null, '', url);
}
let sprites: ReturnType<typeof paintAtlas>['sprites'] = [];
plant(seed);
requestAnimationFrame(() => veil.classList.add('clear'));

// ─── the view ─────────────────────────────────────────────────────────────────
let dpr = 1;
/** Resolution scale, lowered if frames are slow (a phone keeps its calm, not its pixels). */
let quality = 1;
let slow = 0;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

const view: View = { x: 0, z: 0, eye: 1.65, yaw: 0, f: 1, horizon: 0 };
let speed = 0;
let look = Number(params.get('look')) || 0;
let yaw = 0;
let stride = 0;

// ─── input: hold to walk, drag to look ─────────────────────────────────────────
let holding = false;
let dragFrom: { x: number; look: number } | null = null;
let keys = new Set<string>();
let walkedOnce = false;
const autoWalk = !!params.get('walk');

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  holding = true;
  dragFrom = { x: e.clientX, look };
  sound.arm();
  soundBtn.textContent = sound.on ? 'sound on' : 'sound off';
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragFrom) return;
  look = Math.max(-0.9, Math.min(0.9, dragFrom.look - (e.clientX - dragFrom.x) * 0.0035));
});
const release = () => {
  holding = false;
  dragFrom = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
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

// another wood: the mist comes in, and clears on a new one
let changing = false;
seedBtn.addEventListener('click', () => {
  if (changing) return;
  changing = true;
  veil.classList.remove('clear');
  setTimeout(() => {
    plant(randomSeed());
    walked = 0;
    speed = 0;
    look = 0;
    veil.classList.add('clear');
    changing = false;
  }, 1300);
});
soundBtn.addEventListener('click', () => {
  soundBtn.textContent = sound.toggle() ? 'sound on' : 'sound off';
});

// the name, then the hint, then only the wood
setTimeout(() => title.classList.add('away'), 3800);
setTimeout(() => !walkedOnce && hint.classList.add('show'), 2600);

// ─── the walk ───────────────────────────────────────────────────────────────────
const instances = { data: new Float32Array(STRIDE * 512) };
let t = Number(params.get('time')) || 0;
let last = performance.now();

function frame(now: number) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  // slower than ~40 fps for a few seconds: draw fewer pixels
  slow = raw > 0.026 ? slow + raw : Math.max(0, slow - raw * 0.5);
  if (slow > 3 && quality > 0.55 && !params.has('fixed')) {
    quality = Math.max(0.55, quality * 0.8);
    slow = 0;
    resize();
  }
  t += dt;
  const forward = holding || autoWalk || keys.has('ArrowUp') || keys.has('w') || keys.has(' ');
  if (keys.has('ArrowLeft')) look = Math.max(-0.9, look + dt * 0.8);
  if (keys.has('ArrowRight')) look = Math.min(0.9, look - dt * 0.8);
  // an easy walking pace, starting and stopping gently
  speed += ((forward ? 1.35 : 0) - speed) * (1 - Math.exp(-dt * (forward ? 1.6 : 2.4)));
  walked += speed * dt;
  if (speed > 0.3 && !walkedOnce) {
    walkedOnce = true;
    hint.classList.remove('show');
  }
  stride += speed * dt * 1.9 * Math.PI;
  // on the bank, a step to the side of the stream, facing along it (and where you look)
  const W = canvas.width;
  const H = canvas.height;
  view.z = walked;
  view.x = wood.pathX(walked) + 0.9;
  yaw += (Math.atan(wood.pathSlope(walked + 7)) * 0.85 + look - yaw) * (1 - Math.exp(-dt * 3));
  view.yaw = yaw;
  view.eye = 1.62 + Math.sin(stride) * 0.025 * clamp01(speed);
  view.f = H * 0.9;
  view.horizon = H * 0.57;
  const mood = wood.moodAt(walked + 25);
  const pal = wood.palette(mood);
  const wind = 0.6 + 0.4 * Math.sin(t * 0.13) * Math.sin(t * 0.071 + 1) + (1 - pal.sun) * 0.3;

  // the trees in view, back to front
  const trees = wood.between(walked - 4, walked + VIEW);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const seen: Array<{ d: number; i: number }> = [];
  trees.forEach((tr, i) => {
    const rx = tr.x - view.x;
    const rz = tr.z - view.z;
    const cz = rx * s + rz * c;
    const cx = rx * c - rz * s;
    if (cz < 0.9) return;
    // off to the side (with room for its width)
    if (Math.abs(cx) - Math.abs(tr.w) > (cz * W) / (2 * view.f) + 1) return;
    // tufts only close by
    if (tr.kind === 'tuft' && cz > 26) return;
    seen.push({ d: cz, i });
  });
  seen.sort((a, b) => b.d - a.d);
  if (instances.data.length < seen.length * STRIDE) instances.data = new Float32Array(seen.length * STRIDE * 2);
  const a = instances.data;
  seen.forEach(({ i }, k) => {
    const tr = trees[i];
    const sp = sprites[tr.sprite];
    const o = k * STRIDE;
    a[o] = tr.x;
    a[o + 1] = tr.z;
    a[o + 2] = tr.w;
    a[o + 3] = tr.h;
    a[o + 4] = sp.u0;
    a[o + 5] = sp.v0;
    a[o + 6] = sp.u1;
    a[o + 7] = sp.v1;
    a[o + 8] = tr.phase;
    a[o + 9] = tr.sway;
  });
  renderer.draw(view, pal, t, seed, wood.path, wood.crags, a, seen.length, wind);
  sound.update(dt, t, speed, pal.sun, wind);
  (window as unknown as { __mistwood: unknown }).__mistwood = { seed: seedName(seed), walked: Math.round(walked * 10) / 10, mood: Math.round(mood * 100) / 100, trees: seen.length, speed: Math.round(speed * 100) / 100 };
  requestAnimationFrame(frame);
}
requestAnimationFrame((n) => {
  last = n;
  requestAnimationFrame(frame);
});
