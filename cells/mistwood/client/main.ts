/**
 * Mistwood — a walk through a seeded wood in fog.
 *
 * Hold to walk; drag to look about. The seed is in the address
 * (?seed=moss-ford-7) and at the foot of the screen; touch it for another wood.
 *
 * The work is on the GPU: every tree, shrub and patch of grass is a card baked
 * from its grown structure at the resolution it needs on screen (baked again,
 * sharper, as you come close), drawn at its true place in the wood so walking
 * and looking give real parallax; the fog, the mist banks and the wind are all
 * in the shaders (render.ts).
 *
 * Debug: ?at=<metres> · ?walk=1 · ?look=<radians> · ?fixed · window.__mistwood
 */
import { Sound } from './audio';
import { Baker, cardExtent, type Card } from './bake';
import { Renderer, type Draw, type View } from './render';
import { clamp01, randomSeed, seedFrom, seedName } from './rng';
import { Wood, VIEW, type Kind } from './world';

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
const gl = renderer.gl;
const baker = new Baker(gl, renderer.compile);
const sound = new Sound();

// ─── the cards: baked per structure and resolution, kept while there is room ────────
const cards = new Map<string, Card>();
let texels = 0;
/** Resolution asked of every card (lowered while over the budget). */
let bias = 1;
/** What a phone can hold: about 64 MB of cards. */
const BUDGET = 16e6;
const keyOf = (kind: Kind, pool: number, level: number) => `${kind}:${pool}:${level}`;
function forget() {
  for (const c of cards.values()) gl.deleteTexture(c.tex);
  cards.clear();
  texels = 0;
}
/** The sharpest card of this structure that is ready, at or below `level` if possible. */
function bestCard(kind: Kind, pool: number, level: number): Card | null {
  for (let l = level; l >= 32; l /= 2) {
    const c = cards.get(keyOf(kind, pool, l));
    if (c) return c;
  }
  for (let l = level * 2; l <= 2048; l *= 2) {
    const c = cards.get(keyOf(kind, pool, l));
    if (c) return c;
  }
  return null;
}

// ─── the wood ───────────────────────────────────────────────────────────────────
let seed = seedFrom(params.get('seed')) ?? randomSeed();
let wood!: Wood;
let walked = Number(params.get('at')) || 0;
function plant(s: number) {
  seed = s;
  wood = new Wood(seed);
  forget();
  seedBtn.textContent = seedName(seed).replace(/-/g, ' · ');
  const url = new URL(location.href);
  url.searchParams.set('seed', seedName(seed));
  history.replaceState(null, '', url);
}
plant(seed);
requestAnimationFrame(() => veil.classList.add('clear'));

// ─── the view ───────────────────────────────────────────────────────────────────
let quality = 1;
let slow = 0;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);

const view: View = { x: 0, z: 0, eye: 1.6, yaw: 0, f: 1, horizon: 0 };
let speed = 0;
let look = Number(params.get('look')) || 0;
let yaw = 0;
let stride = 0;

// ─── input: hold to walk, drag to look ────────────────────────────────────────────
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
  if (dragFrom) look = Math.max(-1, Math.min(1, dragFrom.look - (e.clientX - dragFrom.x) * 0.0032));
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
setTimeout(() => title.classList.add('away'), 4200);
setTimeout(() => !walkedOnce && hint.classList.add('show'), 3000);

// ─── each frame ───────────────────────────────────────────────────────────────────
let t = Number(params.get('time')) || 0;
const shade = new Float32Array(40 * 4);
const shadeOff = new Float32Array(40 * 2);
let shadeN = 0;
const sunAz = 0.25;
let last = performance.now();
const nextPow2 = (x: number) => Math.pow(2, Math.ceil(Math.log2(Math.max(1, x))));

function frame(now: number) {
  const raw = (now - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = now;
  t += dt;
  slow = raw > 0.028 ? slow + raw : Math.max(0, slow - raw * 0.5);
  if (slow > 3 && quality > 0.5 && !params.has('fixed')) {
    quality = Math.max(0.5, quality * 0.82);
    slow = 0;
    resize();
  }
  const forward = holding || autoWalk || keys.has('ArrowUp') || keys.has('w') || keys.has(' ');
  if (keys.has('ArrowLeft')) look = Math.min(1, look + dt * 0.7);
  if (keys.has('ArrowRight')) look = Math.max(-1, look - dt * 0.7);
  speed += ((forward ? 1.1 : 0) - speed) * (1 - Math.exp(-dt * (forward ? 1.4 : 2.2)));
  walked += speed * dt;
  if (speed > 0.3 && !walkedOnce) {
    walkedOnce = true;
    hint.classList.remove('show');
  }
  stride += speed * dt * 1.8 * Math.PI;
  const W = canvas.width;
  const H = canvas.height;
  // on the path, standing a little easy (a slow sway even when still)
  view.z = walked;
  view.x = wood.pathX(walked) + Math.sin(t * 0.037) * 0.2;
  yaw += (Math.atan(wood.pathSlope(walked + 6)) * 0.8 + look + Math.sin(t * 0.05) * 0.02 - yaw) * (1 - Math.exp(-dt * 2.5));
  view.yaw = yaw;
  view.eye = 1.6 + Math.sin(stride) * 0.022 * clamp01(speed) + Math.sin(t * 0.06) * 0.03;
  view.f = H * 0.92;
  view.horizon = H * 0.4;

  // what stands in view, and the card each needs
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const density = wood.densityAt(walked + 20);
  const want: Array<{ kind: Kind; pool: number; level: number; px: number }> = [];
  const draws: Array<Draw & { d: number }> = [];
  let grows = 0;
  for (const p of wood.between(walked - 2, walked + VIEW)) {
    const rx = p.x - view.x;
    const rz = p.z - view.z;
    const cz = rx * s + rz * c;
    const cx = rx * c - rz * s;
    if (cz < 0.6) continue;
    if (p.kind === 'patch' && cz > 26) continue;
    // grow the structure the first time (a few a frame)
    if (!wood.grown(p.kind, p.pool)) {
      if (grows++ < 2) wood.structure(p.kind, p.pool);
      continue;
    }
    const st = wood.structure(p.kind, p.pool);
    const wM = (st.maxX - st.minX) * p.scale;
    const hM = st.maxY * p.scale;
    // off to the side, allowing for its width
    if (Math.abs(cx) - wM > (cz * W) / (2 * view.f) + 1) continue;
    // the pixels it needs: its size on screen, less as the fog takes it (detail it hides is not needed)
    const fogged = 1 - Math.exp(-cz * density * 1.4);
    const need = ((Math.max(wM, hM) * view.f) / cz) * (1 - 0.75 * fogged);
    // under memory pressure the small, fogged cards give way first; the near trees keep their detail
    const px = need * (need > 900 ? Math.max(bias, 0.8) : bias);
    const level = Math.max(64, Math.min(p.kind === 'patch' ? 1024 : 2048, nextPow2(px)));
    const card = bestCard(p.kind, p.pool, level);
    if (!card || card.level < level) want.push({ kind: p.kind, pool: p.pool, level, px });
    if (!card) continue;
    card.used = t;
    const ext = cardExtent(st, card.level);
    const left = ext.left * p.scale;
    const width = ext.width * p.scale;
    draws.push({
      card,
      x: p.x,
      z: p.z,
      rect: p.flip ? [-left, ext.bottom * p.scale, -width, ext.height * p.scale] : [left, ext.bottom * p.scale, width, ext.height * p.scale],
      flip: p.flip,
      phase: p.phase,
      patch: p.kind === 'patch',
      d: cz,
    });
  }
  // bake what is wanted, biggest on screen first, a little each frame
  want.sort((a, b) => b.px - a.px);
  let budget = 150000;
  const baked = new Set<string>();
  for (const w of want) {
    const key = keyOf(w.kind, w.pool, w.level);
    if (baked.has(key) || cards.has(key)) continue;
    const st = wood.structure(w.kind, w.pool);
    if (budget - st.count < 0 && baked.size) break;
    budget -= st.count;
    baked.add(key);
    const card = baker.bake(st, w.level);
    card.used = t;
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
  draws.sort((a, b) => b.d - a.d);
  // the nearest trees shade the ground (contact at the foot, a soft pool under the crown,
  // set away from the brighter place where the sun is behind the fog)
  shadeN = 0;
  for (let k = draws.length - 1; k >= 0 && shadeN < 40; k--) {
    const d = draws[k];
    if (d.patch || d.d > 28) continue;
    const crown = Math.abs(d.rect[2]) * 0.45;
    shade.set([d.x, d.z, 0.35 + crown * 0.08, crown], shadeN * 4);
    shadeOff.set([-Math.sin(sunAz) * d.rect[3] * 0.25, -Math.cos(sunAz) * d.rect[3] * 0.25], shadeN * 2);
    shadeN++;
  }
  const wind = 0.55 + 0.45 * Math.sin(t * 0.11) * Math.sin(t * 0.067 + 1);
  renderer.draw(view, { shade, shadeOff, shadeN, seed, t, density, wind, path: wood.path, sun: [sunAz, 0.35] }, draws);
  sound.update(dt, t, speed, 0, wind);
  (window as unknown as { __mistwood: unknown }).__mistwood = {
    seed: seedName(seed),
    walked: Math.round(walked * 10) / 10,
    cards: draws.length,
    baked: cards.size,
    mb: Math.round((texels * 4) / 1e6),
    bias: Math.round(bias * 100) / 100,
    waiting: want.length,
    quality: Math.round(quality * 100) / 100,
  };
  requestAnimationFrame(frame);
}
requestAnimationFrame((n) => {
  last = n;
  requestAnimationFrame(frame);
});
