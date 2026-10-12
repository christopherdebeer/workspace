/**
 * Taohua (桃花) — a climb up a stone stair through peach blossom, to the mountain temples, on
 * forever. After a print: a hillside of peach trees in flower, black rocks along a zigzag of
 * steps, a temple of teal tiles and red columns, a walker in a straw hat with a staff, the
 * paper's cream under it all and Bai Juyi's lines down its side.
 *
 * Tap the path (or press on it and slide along it) to walk there; ↑, W walk on up, ↓, S back down. Drag off
 * the path to look about a little. The seed is
 * in the address (?seed=…): the same seed, the same hillside, step for step. `?preview` climbs by
 * itself, quietly.
 */
import { hash, randomSeed, seedFrom, seeded } from '../kit/rng';
import { Path, RISE, WIDTH, type V3 } from './path';
import { invert, lookAt, mulM, perspective, Renderer, type Drawn, type M4 } from './render';
import { stationsNear, type Station } from './compose';
import { BAND, INK, M, Mesh, NAMES, SPAN, ground, makeBand, templesNear, type Band } from './world';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const review = params.has('review');
/** the composition view: the print as broad strokes only, stepped back, to judge its arrangement on its own (`?ink`, or C) */
let ink = params.has('ink');
const setInk = (on: boolean) => { ink = on; document.body.classList.toggle('ink', on); };
setInk(ink);
const PASS = 'trees-1';
const seed = seedFrom(params.get('seed')) ?? (preview || review ? 1 : randomSeed());
const canvas = document.getElementById('print') as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;
if (preview) document.body.classList.add('preview');
if (review) canvas.style.pointerEvents = 'none';

let R: Renderer;
try { R = new Renderer(canvas); } catch (e) {
  document.body.classList.add('nogl');
  throw e;
}

const path = new Path(seed);

// ─── the poems: a couplet at each station along the way, written on the hillside ────────────────────────────────────
const POEMS: Array<[string, string, string]> = [
  ['人间四月芳菲尽，', '山寺桃花始盛开。', '唐 · 白居易'],
  ['长恨春归无觅处，', '不知转入此中来。', '唐 · 白居易'],
  ['去年今日此门中，', '人面桃花相映红。', '唐 · 崔护'],
  ['人面不知何处去，', '桃花依旧笑春风。', '唐 · 崔护'],
  ['竹外桃花三两枝，', '春江水暖鸭先知。', '宋 · 苏轼'],
  ['桃花潭水深千尺，', '不及汪伦送我情。', '唐 · 李白'],
  ['桃花流水窅然去，', '别有天地非人间。', '唐 · 李白'],
  ['夹岸数百步，', '中无杂树，芳草鲜美，落英缤纷。', '晋 · 陶渊明'],
];
// (each couplet written on the hillside, in the space kept for it at a station beside the path: the
// walker passes it as they climb. Its words are set to the space as the eye sees it)
const verses = new Map<number, HTMLElement>();
function verseEl(st: Station) {
  let el = verses.get(st.i);
  if (el) return el;
  const p = POEMS[Math.floor(st.i - Math.floor(st.i / 3)) % POEMS.length];
  el = document.createElement('div');
  el.className = 'verse';
  for (const [cls, t] of [['l1', p[0]], ['l2', p[1]], ['by', p[2]], ['seal', '春山']]) { const sp = document.createElement('span'); sp.className = cls; sp.textContent = t; el.appendChild(sp); }
  document.body.appendChild(el);
  verses.set(st.i, el);
  return el;
}
let titleBox = $('title').getBoundingClientRect();
addEventListener('resize', () => { titleBox = $('title').getBoundingClientRect(); });
void document.fonts?.ready.then(() => { titleBox = $('title').getBoundingClientRect(); });
function placeVerses(z: number) {
  const near = stationsNear(path, seed, z - 30, z + 90);
  const keep = new Set<number>();
  for (const st of near) {
    if (st.kind !== 'verse') continue;
    keep.add(st.i);
    const el = verseEl(st);
    const q = project(st.c);
    el.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) translate(-50%, -50%)`;
    // (shown while it's on the print; not while it passes under the title, which keeps its place)
    const b = el.getBoundingClientRect(), t = titleBox;
    const under = b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top;
    el.classList.toggle('on', q[2] > 0 && q[1] > -40 && q[1] < innerHeight + 40 && !under);
  }
  for (const [i, el] of verses) if (!keep.has(i)) { el.remove(); verses.delete(i); }
}
function showName(i: number) { $('name').textContent = NAMES[i % NAMES.length]; titleBox = $('title').getBoundingClientRect(); }

// ─── the plaques: each temple's name in gold on its dark board, red framed ──────────────────────
function plaques() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160 * NAMES.length;
  const g = c.getContext('2d')!;
  NAMES.forEach((name, i) => {
    // (row i is the texture's v from i/N to (i+1)/N, counted up from the bottom)
    const y = (NAMES.length - 1 - i) * 160;
    g.fillStyle = '#a3321f'; g.fillRect(0, y, 512, 160);
    g.fillStyle = '#3a2620'; g.fillRect(14, y + 14, 484, 132);
    g.strokeStyle = '#c9a55a'; g.lineWidth = 4; g.strokeRect(24, y + 24, 464, 112);
    g.fillStyle = '#e2c27a';
    g.font = '96px "Ma Shan Zheng", "STKaiti", "KaiTi", "Songti SC", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256, y + 84);
  });
  R.setPlaque(c);
}
plaques();
void document.fonts?.load('96px "Ma Shan Zheng"', NAMES.join('')).then(() => plaques());

// ─── the walker: a straw hat, a grey-blue robe with wide sleeves and a red sash, a tall staff ─────
// (in parts, each placed by its own turning: the body, which sways and leans as they walk; the head
// under its hat, which looks about when they stand; the free arm, which swings; the shoes; the
// staff; and their shadow on the ground, which does none of that)
const part = (build: (m: Mesh) => void) => { const m = new Mesh(); build(m); return R.mesh(m.v.out()); };
const body = part((m) => {
  // (the robe: full at the hem, narrowing to the shoulders; the sash about it)
  m.tube([0, 0.03, 0], [0, 0.82, 0], 0.31, 0.21, INK.robe, M.robe, 12);
  m.tube([0, 0.82, 0], [0, 1.34, 0], 0.21, 0.16, INK.robe, M.robe, 12);
  m.tube([0, 0.76, 0], [0, 0.9, 0], 0.225, 0.22, INK.red, M.red, 12);
  m.tube([0.05, 0.8, 0.2], [0.08, 0.45, 0.24], 0.04, 0.03, INK.red, M.red, 4);
  // (the arm to the staff, its wide sleeve, the hand)
  m.tube([0.15, 1.28, 0], [0.36, 1.0, 0.12], 0.07, 0.13, INK.robe, M.robe, 8);
  m.tube([0.38, 0.99, 0.13], [0.43, 0.96, 0.15], 0.05, 0.045, INK.skin, M.skin, 6);
});
const head = part((m) => {
  // (the head, the black hair gathered behind under the hat; the hat a wide shallow cone)
  m.tube([0, 1.32, 0], [0, 1.56, 0.02], 0.1, 0.09, INK.skin, M.skin, 8);
  m.tube([0, 1.36, -0.05], [0, 1.56, -0.04], 0.095, 0.09, INK.dark, M.dark, 8);
  m.tube([0, 1.52, 0], [0, 1.76, 0], 0.44, 0.02, INK.hat, M.hat, 16);
});
const freeArm = part((m) => m.tube([-0.15, 1.28, 0], [-0.25, 0.9, 0.02], 0.07, 0.14, INK.robe, M.robe, 8));
const shadow = part((m) => {
  // (a stroke or two of grey, off to the side away from the light)
  for (let k = 0; k < 14; k++) {
    const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2, cx = -0.5, rx = 0.6, rz = 0.24;
    m.v.push(cx, 0.03, 0.05, 0, 1, 0, 0, 0, 0.3, M.shade);
    m.v.push(cx + Math.cos(a1) * rx, 0.03, 0.05 + Math.sin(a1) * rz, 0, 1, 0, Math.cos(a1), Math.sin(a1), 0.3, M.shade);
    m.v.push(cx + Math.cos(a0) * rx, 0.03, 0.05 + Math.sin(a0) * rz, 0, 1, 0, Math.cos(a0), Math.sin(a0), 0.3, M.shade);
  }
});
const shoe = (sx: number) => part((m) => m.tube([sx * 0.09, 0.03, -0.05], [sx * 0.09, 0.03, 0.12], 0.045, 0.04, INK.dark, M.dark, 6));
const shoes = [shoe(-1), shoe(1)];
const staff = part((m) => m.tube([0.46, 2.15, 0.15], [0.46, -0.02, 0.15], 0.024, 0.024, INK.trunk, M.trunk, 5));
/** where each turns: the hand that holds the staff; the neck; the free shoulder */
const HAND: V3 = [0.46, 0.96, 0.15], NECK: V3 = [0, 1.32, 0], SHOULDER: V3 = [-0.15, 1.28, 0];
/** matrices: a move; a turn about x (forward), y (about), z (sideways); about a point */
const Tm = (x: number, y: number, z: number): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const Rx = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const Ry = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const Rz = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
const about = (p: V3, r: M4): M4 => mulM(Tm(p[0], p[1], p[2]), mulM(r, Tm(-p[0], -p[1], -p[2])));

// ─── the bands of the hill, made as they're needed, dropped behind ───────────────────────────────
interface Live { band: Band; solid: Drawn; puffs: Drawn; petals: Drawn }
const live = new Map<number, Live>();
function keepBands(z: number) {
  const lo = Math.floor((z - (ink ? 40 : 24)) / BAND), hi = Math.floor((z + (ink ? 130 : 70)) / BAND);
  for (const [j, l] of live) if (j < lo - 1 || j > hi + 1) { R.drop(l.solid); R.drop(l.puffs); R.drop(l.petals); live.delete(j); }
  // (one band a frame at most, nearest first, so a climb never stutters)
  for (let j = Math.floor(z / BAND); j <= hi; j++) if (!live.has(j)) { add(j); return; }
  for (let j = lo; j <= hi; j++) if (!live.has(j)) { add(j); return; }
}
function add(j: number) {
  const band = makeBand(path, seed, j);
  const pet = new Float32Array((band.petals.length / 6) * 7);
  for (let i = 0; i < band.petals.length / 6; i++) { pet.set(band.petals.subarray(i * 6, i * 6 + 6), i * 7); pet[i * 7 + 6] = 0; }
  live.set(j, { band, solid: R.mesh(band.verts), puffs: R.instances('puff', band.puffs), petals: R.instances('petal', pet) });
}

// ─── petals falling, about where you are ─────────────────────────────────────────────────────────
const FALL = preview ? 90 : 260;
const fall = new Float32Array(FALL * 7);
const fallV = new Float32Array(FALL * 4);
const fr = seeded(hash(seed, 0xfa11));
function respawn(i: number, at: V3, anywhere: boolean) {
  fall[i * 7] = at[0] + (fr() - 0.5) * 26;
  fall[i * 7 + 2] = at[2] + (fr() - 0.35) * 34;
  fall[i * 7 + 1] = ground(path, fall[i * 7], fall[i * 7 + 2]) + (anywhere ? fr() * 9 : 7 + fr() * 3);
  fall[i * 7 + 3] = 0.05 + fr() * 0.06; fall[i * 7 + 5] = fr();
  fallV[i * 4] = 0.35 + fr() * 0.45; fallV[i * 4 + 1] = fr() * 6.28; fallV[i * 4 + 2] = 0.6 + fr() * 1.4; fallV[i * 4 + 3] = (fr() - 0.5) * 0.6;
}
let fallDrawn: Drawn | null = null;

// ─── walking ─────────────────────────────────────────────────────────────────────────────────────
// (`?at=…`: start so far up the path, for looking at a stretch of it)
let s = Math.max(2, Number(params.get('at')) || 2), speed = 0, want = 0, phase = 0, stride = 0, facing = NaN;
const WALK = 1.25;
/** Where the walker stands at s: on the step under them, lifting onto the next as they come to its edge. */
function stand(sAt: number): { p: V3; dir: [number, number] } {
  const f = path.flightAt(sAt), d = sAt - f.s0;
  const at = path.at(sAt);
  if (f.kind === 'trail' || d < f.ll) return at;
  const u = d - f.ll, k = Math.min(f.steps - 1, Math.floor(u / f.run)), fr2 = u / f.run - k;
  const lift = k < f.steps - 1 ? RISE * smoothstep(0.62, 1, fr2) : 0;
  return { p: [at.p[0], f.a[1] + (k + 1) * RISE + lift, at.p[2]], dir: at.dir };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// tap the path (or press on it and slide along it) and they walk there; tap anywhere else and nothing moves;
// drag off the path to look about; keys walk on or back
let markAt = -1e9, goal: number | null = null, downAt: { x: number; y: number; id: number; on: boolean } | null = null, looking = false;
let lookYaw = 0, lookPitch = 0, lookAt0 = -9;
const keys = new Set<string>();
/** the last frame's view, to find what's under a finger */
let lastVP: M4 | null = null;
const project = (p: V3): [number, number, number] => {
  const m = lastVP!;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [((x / w) * 0.5 + 0.5) * innerWidth, (0.5 - (y / w) * 0.5) * innerHeight, w];
};
/** what the path, seen, is: its steps and stones, the ground and what lies on it */
const OPEN = new Set<number>([M.step, M.earth, M.ground, M.shade, M.petal, M.grass]);
/** what a temple is drawn in: its roof, walls, paint, plaque, door, and its terrace's stone */
const TEMPLE = new Set<number>([M.tile, M.ridge, M.red, M.wall, M.plaque, M.dark, M.stone]);
/** Where on the path a point on the screen (CSS pixels) falls, if it falls on it where it can be seen: how far along it. */
function pick(px: number, py: number): number | null {
  if (!lastVP) return null;
  // (only where the path is to be seen: not a tree, a rock, a temple standing in front of it)
  const m = R.matAt(px * (canvas.width / innerWidth), py * (canvas.height / innerHeight));
  if (!OPEN.has(m)) return null;
  let best: number | null = null, bestK = 1;
  for (let si = Math.max(1, s - 40); si < s + 90; si += 0.2) {
    const at = path.at(si);
    const q = project(at.p);
    if (q[2] <= 0) continue;
    // (how wide the path is there, on the glass)
    const e = project([at.p[0] + at.dir[1] * WIDTH * 0.5, at.p[1], at.p[2] - at.dir[0] * WIDTH * 0.5]);
    const half = Math.max(12, Math.hypot(e[0] - q[0], e[1] - q[1]) * 1.15);
    const k = Math.hypot(px - q[0], py - q[1]) / half;
    if (k < bestK) { bestK = k; best = si; }
  }
  return best;
}
/**
 * Where on the path is nearest a point on the screen that isn't on it (the hillside, a temple, a
 * tree): of the places along the path that can be seen (not behind blossom, a rock, a roof), the
 * one nearest the finger on the glass, so the walker goes there and is seen to arrive.
 */
function nearestSeen(px: number, py: number): number | null {
  if (!lastVP) return null;
  const m = R.mats();
  if (!m) return null;
  const kx = canvas.width / innerWidth, ky = canvas.height / innerHeight;
  // (a tap on a temple: the path behind it counts as seen, as the temple stands over it there)
  const onTemple = TEMPLE.has(m.at(px * kx, py * ky));
  const seen = (mat: number) => OPEN.has(mat) || (onTemple && TEMPLE.has(mat));
  let best: number | null = null, bestD = Infinity;
  for (let si = Math.max(1, s - 40); si < s + 90; si += 0.25) {
    const q = project(path.at(si).p);
    if (q[2] <= 0 || q[0] < 8 || q[1] < 8 || q[0] > innerWidth - 8 || q[1] > innerHeight - 8) continue;
    const d = Math.hypot(px - q[0], py - q[1]);
    if (d >= bestD) continue;
    // (seen: what's drawn there is the path, or the ground beside it, about the place and just above, where the walker would stand)
    if (![[0, 0], [0, -10], [-4, -4], [4, -4]].every(([dx, dy]) => seen(m.at((q[0] + dx) * kx, (q[1] + dy) * ky)))) continue;
    bestD = d; best = si;
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const at = pick(e.clientX, e.clientY);
  downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, on: at !== null };
  if (at !== null) { goal = at; markAt = performance.now(); }
  looking = false;
  $('hint').classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  if (!downAt || downAt.id !== e.pointerId) return;
  if (downAt.on) {
    // (pressed on the path: slid along it, the goal follows the finger, so long as it's on the path)
    const at = pick(e.clientX, e.clientY);
    if (at !== null) { goal = at; markAt = performance.now(); }
    return;
  }
  const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
  if (!looking && Math.hypot(dx, dy) > 10) looking = true;
  if (looking) {
    lookYaw = Math.max(-0.7, Math.min(0.7, lookYaw - (e.movementX || 0) * 0.005));
    lookPitch = Math.max(-0.25, Math.min(0.3, lookPitch + (e.movementY || 0) * 0.003));
    lookAt0 = performance.now();
  }
});
const up = (e: PointerEvent) => {
  if (downAt?.id !== e.pointerId) return;
  // (a tap off the path, not a drag: to the nearest place on the path that can be seen)
  if (!downAt.on && !looking && e.type === 'pointerup') { const at = nearestSeen(e.clientX, e.clientY); if (at !== null) { goal = at; markAt = performance.now(); } }
  downAt = null; looking = false;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') { setInk(!ink); return; }
  keys.add(e.key.toLowerCase()); goal = null; $('hint').classList.remove('on');
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); });

// ─── the camera: high, looking up the hill, the walker low in the frame ──────────────────────────
const cam = { t: [0, 0, 0] as V3, x: 0 };
let camInit = false;
function camera(p: V3, dt: number) {
  const k = 1 - Math.exp(-dt * 2.2);
  const target: V3 = [p[0], p[1] + 1.2, p[2] + 7];
  if (!camInit) { cam.t = [...target]; cam.x = p[0]; camInit = true; }
  for (let i = 0; i < 3; i++) cam.t[i] += (target[i] - cam.t[i]) * k;
  // (it swings across slowly as the path zigzags)
  cam.x += (p[0] - cam.x) * (1 - Math.exp(-dt * 1.2));
  // (looked about by hand, it comes back after a while)
  if (!looking && performance.now() - lookAt0 > 2500) { lookYaw *= Math.exp(-dt * 1.2); lookPitch *= Math.exp(-dt * 1.2); }
  const aspect = canvas.width / canvas.height;
  const dist = ((aspect < 1 ? 56 : 44) + (preview ? 6 : 0)) * (ink ? 1.8 : 1);
  const pitch = 0.76 + lookPitch, yaw = lookYaw;
  const t: V3 = [cam.x + (cam.t[0] - p[0]) * 0, cam.t[1], cam.t[2]];
  t[0] = cam.x;
  const eye: V3 = [t[0] - Math.sin(yaw) * Math.cos(pitch) * dist, t[1] + Math.sin(pitch) * dist, t[2] - Math.cos(yaw) * Math.cos(pitch) * dist];
  return { eye, t };
}

// ─── the composition view's brush: the path as one stroke, thick and thin, dry where it's a trail;
// the walker a dot of vermilion; where they're going, a ring ───────────────────────────────────────
const brush = document.getElementById('brush') as HTMLCanvasElement;
function brushPath(pos: V3) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (brush.width !== W || brush.height !== H) { brush.width = W; brush.height = H; }
  const g = brush.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  g.lineCap = 'round'; g.lineJoin = 'round';
  // (each piece of the path its own stroke, so a stair reads heavier than a trail)
  let prev: [number, number, number] | null = null;
  for (let si = Math.max(1, s - 60); si < s + 160; si += 0.5) {
    const at = path.at(si), q = project(at.p);
    const f = path.flightAt(si);
    if (prev && q[2] > 0 && prev[2] > 0) {
      const e = project([at.p[0] + at.dir[1] * WIDTH * 0.5, at.p[1], at.p[2] - at.dir[0] * WIDTH * 0.5]);
      const wpx = Math.min(12, Math.max(1.5, Math.hypot(e[0] - q[0], e[1] - q[1]) * 1.4));
      const trail = f.kind === 'trail';
      g.strokeStyle = trail ? '#9c948a' : '#2a2420';
      g.lineWidth = wpx * (trail ? 0.45 : 1) * (0.85 + 0.3 * Math.sin(si * 0.7));
      g.setLineDash(trail ? [wpx * 0.6, wpx * 0.5] : []);
      g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(q[0], q[1]); g.stroke();
    }
    prev = q;
  }
  g.setLineDash([]);
  // (the stations' spaces: outlined, the verse's in ink, Changes' in vermilion with its sign)
  for (const st of stationsNear(path, seed, pos[2] - 30, pos[2] + 140)) {
    g.beginPath();
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2, q = project([st.c[0] + Math.cos(a) * st.rx, st.c[1], st.c[2] + Math.sin(a) * st.rz]);
      if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
    }
    g.setLineDash([6, 5]); g.lineWidth = 1.5;
    g.strokeStyle = st.kind === 'changes' ? '#b8382c' : 'rgba(42,36,32,.6)';
    g.stroke();
    if (st.kind === 'changes') { const q = project(st.c); g.fillStyle = '#b8382c'; g.font = '22px "Noto Serif SC", serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('易', q[0], q[1]); }
  }
  g.setLineDash([]);
  const w = project([pos[0], pos[1] + 0.8, pos[2]]);
  g.fillStyle = '#b8382c';
  g.beginPath(); g.arc(w[0], w[1], 5, 0, Math.PI * 2); g.fill();
}

// ─── the frame ───────────────────────────────────────────────────────────────────────────────────
let last = performance.now(), time = 0, idleLook = 0;
let reached = 0;
function frame(now: number) {
  const dt = review ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now; time += dt;
  const dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  // walk: to where the path was tapped, slowing as they come to it; or on, or back, by the keys
  if (goal !== null) {
    const togo = goal - s;
    want = Math.abs(togo) < 0.08 ? 0 : Math.sign(togo) * Math.min(togo > 0 ? 1 : 0.75, Math.abs(togo) * 1.4 + 0.15);
    if (Math.abs(togo) < 0.08 && !downAt) { s = goal; speed = 0; goal = null; }
  } else want = preview ? 0.8 : keys.has('arrowup') || keys.has('w') ? 1 : keys.has('arrowdown') || keys.has('s') ? -0.7 : 0;
  speed += (want - speed) * (1 - Math.exp(-dt * 4));
  if (goal !== null && Math.abs(goal - s) < Math.abs(speed * WALK * dt)) { s = goal; speed = 0; } else s = Math.max(1, s + speed * WALK * dt * (1 + 0.14 * Math.sin(phase * 2 - 0.8) * stride));
  phase += Math.abs(speed) * WALK * dt * 4.4;
  stride += ((Math.abs(speed) > 0.05 ? 1 : 0) - stride) * (1 - Math.exp(-dt * 5));
  const st = stand(s);
  if (Number.isNaN(facing)) facing = Math.atan2(st.dir[0], st.dir[1]);
  const bob = 0.03 * Math.abs(Math.sin(phase)) * stride;
  const pos: V3 = [st.p[0], st.p[1] + bob, st.p[2]];
  // (they turn to face their way, not at once)
  const want_yaw = Math.atan2(st.dir[0], st.dir[1]) + (speed < -0.05 ? Math.PI : 0);
  facing += Math.atan2(Math.sin(want_yaw - facing), Math.cos(want_yaw - facing)) * (1 - Math.exp(-dt * 5));
  const yaw = facing;
  path.extend(pos[2] + 80);
  keepBands(pos[2]);

  // the temple last passed: its couplet, its name
  let n = 0;
  for (const f of path.flights) { if (f.b[2] > pos[2] - 2) break; if (f.temple) n++; }
  if (n !== reached) { reached = n; showName(n > 0 ? n - 1 : 0); }

  // (passing a temple beside the path, the view leans toward it, so it's in the print with the walker)
  let lean = 0;
  for (const tp of templesNear(path, pos[2] - 8, pos[2] + 8)) if (!tp.gate) { const d = Math.hypot(tp.c[0] - pos[0], tp.c[2] - pos[2]); lean = (tp.c[0] - pos[0]) * 0.45 * (1 - smoothstep(9, 16, d)); }
  const { eye, t } = camera([pos[0] + lean, pos[1], pos[2]], dt);
  const aspect = W / H;
  const near = 1, far = ink ? 260 : 160;
  const fov = aspect < 1 ? 0.56 : 0.42;
  const v = lookAt(eye, t);
  const vp = mulM(perspective(fov, aspect, near, far), v.m);

  // petals falling about the walker
  if (!fallDrawn) { for (let i = 0; i < FALL; i++) respawn(i, pos, true); fallDrawn = R.instances('petal', fall, true); }
  for (let i = 0; i < FALL; i++) {
    const o = i * 7;
    fall[o + 1] -= fallV[i * 4] * dt;
    fallV[i * 4 + 1] += dt * fallV[i * 4 + 2];
    fall[o] += Math.sin(fallV[i * 4 + 1]) * 0.25 * dt + fallV[i * 4 + 3] * dt;
    fall[o + 4] += dt * fallV[i * 4 + 2] * 0.8;
    fall[o + 6] = 0.9 * Math.sin(fallV[i * 4 + 1] * 1.3);
    if (fall[o + 1] < ground(path, fall[o], fall[o + 2]) || fall[o + 2] < pos[2] - 12 || fall[o + 2] > pos[2] + 30) respawn(i, pos, false);
  }
  R.update(fallDrawn, fall, 7);

  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const ground_: M4 = new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1] - bob, pos[2], 1]);
  // (the body: a sway from foot to foot, a lean into the climb, a little twist with each step; still, it breathes)
  const sw = Math.sin(phase) * stride;
  const climbing = Math.max(0, Math.min(1, (st.p[1] - stand(s - 0.5).p[1]) * 4));
  const model: M4 = mulM(new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1], pos[2], 1]),
    mulM(Ry(0.06 * sw), mulM(Rz(0.045 * sw), mulM(Rx(0.05 * stride + 0.06 * climbing * stride), Tm(0, 0.006 * Math.sin(time * 1.7) * (1 - stride), 0)))));
  // (the head: turned back a little against the body's twist as they walk; standing, it looks about, now one way, now another)
  idleLook += ((1 - stride) * (0.5 * Math.sin(time * 0.31) + 0.35 * Math.sin(time * 0.53 + 1.3)) - idleLook) * (1 - Math.exp(-dt * 1.5));
  const headAt = mulM(model, about(NECK, mulM(Ry(-0.05 * sw + idleLook), Rx(0.03 * Math.sin(phase * 2) * stride))));
  // (the free arm swings against the step)
  const armAt = mulM(model, about(SHOULDER, Rx(-0.4 * sw)));
  // (each step a foot forward, the other back; the staff swung forward with one, planted, and the walker passing it)
  const shoeAt = (k: number) => mulM(ground_, Tm(0, Math.max(0, Math.cos(phase) * (k ? 1 : -1)) * 0.05 * stride, (k ? 1 : -1) * sw * 0.15));
  const staffAt = mulM(model, about(HAND, Rx(-0.42 * Math.sin(phase + 0.6) * stride)));
  const bands = [...live.values()];
  lastVP = vp;
  if (ink) brushPath(pos);
  // (the mark where they're going: a ring of vermilion on its place on the path, for a moment, as the tap is answered)
  const mark = $('mark'), ma = (performance.now() - markAt) / 1000;
  if (goal !== null && ma < 1.1) {
    const q = project(path.at(goal).p);
    mark.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) scale(${(0.8 + 0.35 * Math.min(1, ma * 4)).toFixed(3)})`;
    mark.style.opacity = `${(0.95 * (1 - smoothstep(0.45, 1.1, ma))).toFixed(3)}`;
  } else mark.style.opacity = '0';
  placeVerses(pos[2]);
  R.frame({ vp, ivp: invert(vp), eye, right: v.right, up: v.up, fwd: v.fwd, near, far, dpr, ink },
    [...bands.map((l) => ({ d: l.solid })), { d: body, model }, { d: head, model: headAt }, { d: freeArm, model: armAt }, { d: shadow, model: ground_ }, { d: shoes[0], model: shoeAt(0) }, { d: shoes[1], model: shoeAt(1) }, { d: staff, model: staffAt }],
    bands.map((l) => l.puffs), [...bands.map((l) => l.petals), fallDrawn]);

  // what it reports of itself, for the checks
  (window as unknown as { __taohua: unknown }).__taohua = { pass: PASS, review, seed, s, goal, pos, steps: Math.round(pos[1] / RISE), bands: live.size, reached, puffs: bands.reduce((a, l) => a + l.puffs.count, 0), screen: (si: number) => project(path.at(si).p), pick, nearestSeen, mat: (x: number, y: number) => R.matAt(x * (canvas.width / innerWidth), y * (canvas.height / innerHeight)) };
  $('climb').textContent = `${Math.max(0, Math.round(pos[1] / RISE))}`;
  requestAnimationFrame(frame);
}
showName(0);
if (review) {
  $('hint').textContent = PASS + ' · seed ' + seed + ' · at ' + s.toFixed(1);
  $('hint').classList.add('on');
} else if (!preview) setTimeout(() => $('hint').classList.add('on'), 1200);
void SPAN; void WIDTH;
requestAnimationFrame(frame);
