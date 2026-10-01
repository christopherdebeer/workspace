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
import { Renderer, type Draw, type View } from './render';
import { countWider, type Species, type Structure } from './tree';
import { atmosphere, moonPhase } from './sky';
import { Deerland } from './deer';
import { flag, onFlag, setFlag, setFlags } from './flags';
import { mountTune } from './tune';
import { hash, seeded } from './rng';
import { clamp01, randomSeed, seedFrom, seedName } from './rng';
import { Wood, VIEW, type Kind, type Placed } from './world';
import { smooth as smoothstep } from './rng';

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
    if (find === 'pond' || find === 'glade')
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
      const off = flag('off') ?? (find === 'pond' ? 14 : find === 'glade' ? 0 : 9);
      const a = Math.atan2(posX - b.x, posZ - b.z);
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
/** The trees drawn live last frame (they keep their place in the budget). */
const live = new Set<Placed>();
function plant(s: number) {
  seed = s;
  wood = new Wood(seed);
  deer = new Deerland({ seed, place: (x, z) => wood.place(x, z), pathDist: (x, z) => wood.pathDist(x, z) });
  wood.only = flag('only');
  forget();
  baker.dispose();
  live.clear();
  seedBtn.textContent = seedName(seed).replace(/-/g, ' · ');
  setFlag('seed', seedName(seed), { reload: false, by: 'app' });
}
plant(seed);
(window as unknown as { __wood: () => Wood }).__wood = () => wood;
stand(start, true);
requestAnimationFrame(() => veil.classList.add('clear'));

// ─── the view ───────────────────────────────────────────────────────────────────
let quality = 1;
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

// ─── input: a still hold walks; a drag looks (and steers, once walking) ───────────────
// Across turns you (and stays turned); up and down tilts the view only while you hold it, and
// it eases back level when you let go. Walking on, the pace builds. Where the device reports
// real pressure (Apple Pencil, some styluses; not an iPhone's touch, which reports a fixed 0.5),
// pressing harder walks faster.
let holding = false;
/** The view's tilt (rad, up +) and where the hand holds it. */
let pitch = 0;
let pitchTo = 0;
/** How long you have been walking (s): the pace builds with it. */
let walkTime = 0;
/** Real pressure from the pointer, 0 … 1, or null where the device has none. */
let pressure: number | null = null;
const PITCH = 0.5;
let dragFrom: { x: number; y: number; heading: number; moved: boolean } | null = null;
let holdTimer = 0;
/** How long a touch must stay still to mean "walk", and how far it may move and still be still. */
const HOLD_MS = 220;
const SLOP = 10;
let keys = new Set<string>();
let walkedOnce = false;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  dragFrom = { x: e.clientX, y: e.clientY, heading, moved: false };
  readPressure(e);
  clearTimeout(holdTimer);
  // a touch that stays put is a step forward; one that moves first is a look
  holdTimer = window.setTimeout(() => {
    if (dragFrom && !dragFrom.moved) holding = true;
  }, HOLD_MS);
  sound.arm();
  soundBtn.textContent = sound.on ? 'sound on' : 'sound off';
});
canvas.addEventListener('pointermove', (e) => {
  // drag the view round (as if taking hold of the world); you walk the way you face
  if (!dragFrom) return;
  if (!dragFrom.moved && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > SLOP) {
    dragFrom.moved = true;
    // turn from here (no jump for the slop)
    dragFrom.x = e.clientX;
    dragFrom.y = e.clientY;
  }
  readPressure(e);
  if (!dragFrom.moved) return;
  heading = dragFrom.heading - (e.clientX - dragFrom.x) * 0.0032;
  // (taking hold of the world: drag it down and you look up)
  pitchTo = Math.max(-PITCH, Math.min(PITCH, (e.clientY - dragFrom.y) * 0.0032));
});
function readPressure(e: PointerEvent) {
  // a touch without pressure reports 0.5 while down (or 0); anything else is the real thing
  if (e.pressure > 0 && e.pressure !== 0.5) pressure = e.pressure;
}
const release = () => {
  clearTimeout(holdTimer);
  holding = false;
  dragFrom = null;
  pitchTo = 0;
  pressure = null;
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
const APERTURE = 0.02;
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
  if (!flag('fixed')) {
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
  const forward = holding || flag('walk') || keys.has('ArrowUp') || keys.has('w') || keys.has(' ');
  if (keys.has('ArrowLeft')) heading -= dt * 0.8;
  if (keys.has('ArrowRight')) heading += dt * 0.8;
  // the pace: a walk, building to a brisk one as you keep on (or as hard as you press)
  walkTime = forward ? walkTime + dt : 0;
  const pace = 1.1 * (pressure !== null ? 0.6 + 1.4 * pressure : 1 + 0.8 * smoothstep(3, 10, walkTime));
  speed += ((forward ? pace : 0) - speed) * (1 - Math.exp(-dt * (forward ? 1.4 : 2.2)));
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
  // you walk to the water's edge, not into it
  const nx = posX + Math.sin(yaw) * speed * dt;
  const nz = posZ + Math.cos(yaw) * speed * dt;
  if (wood.groundH(nx, nz) > wood.relief[2] - 0.15) {
    posX = nx;
    posZ = nz;
  }
  view.z = posZ;
  // standing still is still: the sway and the breath are the walk's
  const going = clamp01(speed / 1.1);
  view.x = posX + Math.sin(t * 0.037) * 0.12 * going;
  view.yaw = yaw + Math.sin(t * 0.05) * 0.015 * going;
  // the eye rides the ground (a moment behind it, as legs take a slope)
  footY += (wood.groundH(posX, posZ) - footY) * (1 - Math.exp(-dt * 5));
  view.eye = footY + 1.6 + Math.sin(stride) * 0.022 * going + Math.sin(t * 0.06) * 0.03 * going;
  view.f = H * 0.92;
  // the tilt follows the hand, and settles back level when let go
  pitch += (pitchTo - pitch) * (1 - Math.exp(-dt * (dragFrom ? 10 : 2.5)));
  view.horizon = H * 0.4 - Math.tan(pitch) * view.f;

  // what stands in view, and the card each needs
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
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
        const g = wood.genomeOf(p.kind);
        liveAlpha = 1 - smoothstep(LIVE - 2.5, LIVE, hd);
        cardAlpha = smoothstep(LIVE - 5, LIVE - 2.5, hd);
        draws.push({ live: true, buffer: baker.buffer(st), count: n, wide: Math.min(n, countWider(st, 3 * px)), x: p.x, z: p.z, base, mist: [0, 0], top: st.maxY * p.scale, rot: p.rot, scale: p.scale, phase: p.phase, radius: st.radius, height: st.maxY, alpha: liveAlpha, bark: g?.bark ?? DARK, barkP: g ? [g.barkRough, g.barkScale, g.lichen, g.moss] : [0.5, 1, 0.3, 0.3], viewAz: Math.atan2(view.x - p.x, view.z - p.z) + p.rot, d: hd - 1e-3 });
      }
    }
    if (cardAlpha <= 0.001) continue;
    // a card, baked as the tree is seen from here (one of twelve sides)
    const ex = view.x - p.x;
    const ez = view.z - p.z;
    const el = Math.hypot(ex, ez) || 1;
    const rwx = -ez / el;
    const rwz = ex / el;
    let side = 0;
    let right: [number, number] = [1, 0];
    if (!low(p.kind)) {
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
    const level = Math.max(64, Math.min(low(p.kind) ? 1024 : 2048, nextPow2(px)));
    const card = bestCard(p.kind, p.pool, level, side);
    if (!card || card.level < level) want.push({ kind: p.kind, pool: p.pool, level, px, side, right });
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
    const rx = d.x - view.x;
    const rz = d.z - view.z;
    const hd = Math.hypot(rx, rz);
    if (hd > VIEW || hd < 1) continue;
    // side-on as seen from here: which way it faces on screen, and how foreshortened
    const toward = Math.atan2(rx, rz);
    const rel = Math.sin(d.heading - toward);
    const face = (rel >= 0 ? 1 : -1) / Math.max(0.45, Math.abs(rel));
    // the legs: a walk is a small stride, a run the full bound
    const run = Math.min(1, d.speed / 5 + Math.min(d.speed, 0.6) * 0.25);
    draws.push({ live: false, pose: [d.headUp, d.headTurn, d.gait, run], bed: d.bed, x: d.x, z: d.z, base: wood.groundH(d.x, d.z), mist: [0, 0], top: 2.1 * d.size, size: d.size, face, alpha: 1, bark: [0.13, 0.1, 0.08], d: hd });
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
  renderer.draw(view, { light, shade, shadeOff, shadeN, seed, t, density, wind, path: wood.path, atmos, relief: wood.relief, openness: wood.openness, blur: view.f * APERTURE * (flag('dof') ?? 1), focus: flag('focus') ?? 9 }, draws);
  sound.update(dt, t, speed, atmos.day, wind);
  (window as unknown as { __mistwood: unknown }).__mistwood = {
    seed: seedName(seed),
    walked: Math.round(walked * 10) / 10,
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
    settled: want.length === 0 && ungrown.length === 0 && groundReady,
    heading: Math.round(((((heading * 180) / Math.PI) % 360) + 360) % 360),
    quality: Math.round(quality * 100) / 100,
    pace: Math.round(speed * 100) / 100,
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
/** The near ground's textures have come (or will not). */
let groundReady = false;
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
// the near ground's textures (static/ground/: Poly Haven, CC0): drawn without them until they come
{
  const load = (src: string) =>
    new Promise<HTMLImageElement>((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = fail;
      img.src = src;
    });
  Promise.all([load('/ground/leaf_scattered_gravel_diff.webp'), load('/ground/leaf_scattered_gravel_nor.webp')])
    .then(([c, n]) => renderer.setGround(c, n))
    .catch(() => console.warn('mistwood: the ground textures did not load; the ground is painted'))
    .finally(() => (groundReady = true));
}
// development: every flag in a panel (`?tune`)
if (flag('tune')) mountTune(() => (window as unknown as { __mistwood: unknown }).__mistwood);
