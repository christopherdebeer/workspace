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
import { Baker, type Card } from './bake';
import { Renderer, type Draw, type View } from './render';
import { countWider, type Structure } from './tree';
import { clamp01, randomSeed, seedFrom, seedName } from './rng';
import { Wood, VIEW, type Kind, type Placed } from './world';
import { smooth as smoothstep } from './rng';

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
/** A far tree's card is baked as seen from one of twelve sides (a patch of grass from one). */
const SIDES = 12;
const keyOf = (kind: Kind, pool: number, level: number, side = 0) => `${kind}:${pool}:${level}:${side}`;
function forget() {
  for (const c of cards.values()) gl.deleteTexture(c.tex);
  cards.clear();
  texels = 0;
}
/** The sharpest card of this structure (from this side) that is ready, at or below `level` if possible. */
function bestCard(kind: Kind, pool: number, level: number, side: number): Card | null {
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

// ─── the wood ───────────────────────────────────────────────────────────────────
let seed = seedFrom(params.get('seed')) ?? randomSeed();
let wood!: Wood;
let walked = 0;
/** Where you stand, and which way you face (free: you walk the way you look). */
const start = Number(params.get('at')) || 0;
let posX = 0;
let posZ = start;
let heading = 0;
function stand(z: number) {
  posZ = z;
  posX = wood.pathX(z);
  heading = Math.atan(wood.pathSlope(z + 4)) + (Number(params.get('look')) || 0);
}
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
stand(start);
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
let yaw = heading;
let stride = 0;

// ─── input: hold to walk, drag to look ────────────────────────────────────────────
let holding = false;
let dragFrom: { x: number; heading: number } | null = null;
let keys = new Set<string>();
let walkedOnce = false;
const autoWalk = !!params.get('walk');
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  holding = true;
  dragFrom = { x: e.clientX, heading };
  sound.arm();
  soundBtn.textContent = sound.on ? 'sound on' : 'sound off';
});
canvas.addEventListener('pointermove', (e) => {
  // drag the view round (as if taking hold of the world); you walk the way you face
  if (dragFrom) heading = dragFrom.heading - (e.clientX - dragFrom.x) * 0.0032;
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
    stand(0);
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
let t = Number(params.get('time')) || 0;
const shade = new Float32Array(40 * 4);
const shadeOff = new Float32Array(40 * 2);
let shadeN = 0;
const sunAz = 0.25;
let last = performance.now();
/** Near trees are drawn as live geometry within this distance (m), up to this many segments a frame. */
const LIVE = 16;
const LIVE_BUDGET = 400000;
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
  if (keys.has('ArrowLeft')) heading -= dt * 0.8;
  if (keys.has('ArrowRight')) heading += dt * 0.8;
  speed += ((forward ? 1.1 : 0) - speed) * (1 - Math.exp(-dt * (forward ? 1.4 : 2.2)));
  walked += speed * dt;
  if (speed > 0.3 && !walkedOnce) {
    walkedOnce = true;
    hint.classList.remove('show');
  }
  stride += speed * dt * 1.8 * Math.PI;
  const W = canvas.width;
  const H = canvas.height;
  // you walk the way you face (the view turns a moment behind the hand, and sways a little)
  yaw += (heading - yaw) * (1 - Math.exp(-dt * 6));
  posX += Math.sin(yaw) * speed * dt;
  posZ += Math.cos(yaw) * speed * dt;
  view.z = posZ;
  view.x = posX + Math.sin(t * 0.037) * 0.12;
  view.yaw = yaw + Math.sin(t * 0.05) * 0.015;
  view.eye = 1.6 + Math.sin(stride) * 0.022 * clamp01(speed) + Math.sin(t * 0.06) * 0.03;
  view.f = H * 0.92;
  view.horizon = H * 0.4;

  // what stands in view, and the card each needs
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const density = wood.densityAt(walked + 20);
  const want: Array<{ kind: Kind; pool: number; level: number; px: number; side: number; right: [number, number] }> = [];
  const draws: Array<Draw & { d: number }> = [];
  let grows = 0;
  // what stands in view (grown the first time it is wanted, a few a frame)
  const seen: Array<{ p: Placed; st: Structure; hd: number; R: number; hM: number }> = [];
  for (const p of wood.around(view.x, view.z, VIEW)) {
    const rx = p.x - view.x;
    const rz = p.z - view.z;
    const cz = rx * s + rz * c;
    const cx = rx * c - rz * s;
    const hd = Math.hypot(cx, cz);
    if (hd > VIEW || hd < 0.4 || cz < -4) continue;
    if (p.kind === 'patch' && hd > 22) continue;
    if (!wood.grown(p.kind, p.pool)) {
      if (grows++ < 2) wood.structure(p.kind, p.pool);
      continue;
    }
    const st = wood.structure(p.kind, p.pool);
    const R = st.radius * p.scale;
    const hM = st.maxY * p.scale;
    // off to the side (cylindrical: across the screen is angle), allowing for its reach
    if (Math.abs(Math.atan2(cx, cz)) - Math.atan2(R, Math.max(hd, 0.1)) > W / (2 * view.f) + 0.05) continue;
    seen.push({ p, st, hd, R, hM });
  }
  // the nearest first: they get the live geometry while there is budget for it
  seen.sort((a, b) => a.hd - b.hd);
  let liveLeft = LIVE_BUDGET * quality * quality;
  for (const { p, st, hd, R, hM } of seen) {
    let liveAlpha = 0;
    if (p.kind !== 'patch' && hd < LIVE) {
      // only the segments that would still be a tenth of a pixel wide or more
      const n = countWider(st, (0.1 * hd) / (view.f * p.scale));
      if (n <= liveLeft) {
        liveLeft -= n;
        liveAlpha = 1 - smoothstep(LIVE - 4, LIVE, hd);
        draws.push({ live: true, buffer: baker.buffer(st), count: n, x: p.x, z: p.z, rot: p.rot, scale: p.scale, phase: p.phase, radius: st.radius, height: st.maxY, alpha: liveAlpha, d: hd });
      }
    }
    if (liveAlpha >= 0.999) continue;
    // a card, baked as the tree is seen from here (one of twelve sides)
    const ex = view.x - p.x;
    const ez = view.z - p.z;
    const el = Math.hypot(ex, ez) || 1;
    const rwx = -ez / el;
    const rwz = ex / el;
    let side = 0;
    let right: [number, number] = [1, 0];
    if (p.kind !== 'patch') {
      const cr = Math.cos(p.rot);
      const sr = Math.sin(p.rot);
      const lx = rwx * cr + rwz * sr;
      const lz = -rwx * sr + rwz * cr;
      side = ((Math.round(Math.atan2(lz, lx) / ((2 * Math.PI) / SIDES)) % SIDES) + SIDES) % SIDES;
      const a = (side * 2 * Math.PI) / SIDES;
      right = [Math.cos(a), Math.sin(a)];
    }
    // the pixels it needs: its size on screen, less as the fog takes it
    const fogged = 1 - Math.exp(-hd * density * 1.4);
    const need = ((Math.max(2 * R, hM) * view.f) / Math.max(hd, 0.5)) * (1 - 0.75 * fogged);
    const px = need * (need > 900 ? Math.max(bias, 0.8) : bias);
    const level = Math.max(64, Math.min(p.kind === 'patch' ? 1024 : 2048, nextPow2(px)));
    const card = bestCard(p.kind, p.pool, level, side);
    if (!card || card.level < level) want.push({ kind: p.kind, pool: p.pool, level, px, side, right });
    if (!card) continue;
    card.used = t;
    const left = card.left * p.scale;
    const width = card.width * p.scale;
    const flip = p.kind === 'patch' && p.flip;
    draws.push({
      live: false,
      card,
      x: p.x,
      z: p.z,
      rect: flip ? [-left, card.bottom * p.scale, -width, card.height * p.scale] : [left, card.bottom * p.scale, width, card.height * p.scale],
      flip,
      phase: p.phase,
      patch: p.kind === 'patch',
      alpha: 1 - liveAlpha,
      d: hd,
    });
  }
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
    const card = baker.bake(st, w.level, w.right);
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
    if (d.d > 28 || (!d.live && d.patch) || (!d.live && d.alpha < 0.5)) continue;
    const crown = d.live ? d.radius * d.scale * 0.8 : Math.abs(d.rect[2]) * 0.45;
    const tall = d.live ? d.height * d.scale : d.rect[3];
    shade.set([d.x, d.z, 0.35 + crown * 0.08, crown], shadeN * 4);
    shadeOff.set([-Math.sin(sunAz) * tall * 0.25, -Math.cos(sunAz) * tall * 0.25], shadeN * 2);
    shadeN++;
  }
  const wind = 0.55 + 0.45 * Math.sin(t * 0.11) * Math.sin(t * 0.067 + 1);
  renderer.draw(view, { shade, shadeOff, shadeN, seed, t, density, wind, path: wood.path, sun: [sunAz, 0.35] }, draws);
  sound.update(dt, t, speed, 0, wind);
  (window as unknown as { __mistwood: unknown }).__mistwood = {
    seed: seedName(seed),
    walked: Math.round(walked * 10) / 10,
    at: [Math.round(posX * 10) / 10, Math.round(posZ * 10) / 10],
    live: draws.filter((d) => d.live).length,
    segments: draws.reduce((n, d) => n + (d.live ? d.count : 0), 0),
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
