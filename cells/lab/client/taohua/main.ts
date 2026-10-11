/**
 * Taohua (桃花) — a climb up a stone stair through peach blossom, to the mountain temples, on
 * forever. After a print: a hillside of peach trees in flower, black rocks along a zigzag of
 * steps, a temple of teal tiles and red columns, a walker in a straw hat with a staff, the
 * paper's cream under it all and Bai Juyi's lines down its side.
 *
 * Hold anywhere (or ↑, W) to walk on up; ↓, S, back down. Drag to look about a little. The seed is
 * in the address (?seed=…): the same seed, the same hillside, step for step. `?preview` climbs by
 * itself, quietly.
 */
import { hash, randomSeed, seedFrom, seeded } from '../kit/rng';
import { Path, RISE, WIDTH, type V3 } from './path';
import { lookAt, mulM, perspective, Renderer, type Drawn, type M4 } from './render';
import { BAND, INK, M, Mesh, NAMES, SPAN, ground, makeBand, type Band } from './world';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const seed = seedFrom(params.get('seed')) ?? (preview ? 1 : randomSeed());
const canvas = document.getElementById('print') as HTMLCanvasElement;
const $ = (id: string) => document.getElementById(id)!;
if (preview) document.body.classList.add('preview');

let R: Renderer;
try { R = new Renderer(canvas); } catch (e) {
  document.body.classList.add('nogl');
  throw e;
}

const path = new Path(seed);

// ─── the poems down the side: a couplet at a time, the next at each temple ─────────────────────
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
let poemAt = -1;
function showPoem(i: number) {
  if (i === poemAt) return;
  poemAt = i;
  const p = POEMS[i % POEMS.length];
  const el = $('poem');
  el.classList.remove('on');
  setTimeout(() => {
    el.querySelector('.l1')!.textContent = p[0];
    el.querySelector('.l2')!.textContent = p[1];
    el.querySelector('.by')!.textContent = p[2];
    el.classList.add('on');
  }, preview ? 0 : 700);
}
function showName(i: number) { $('name').textContent = NAMES[i % NAMES.length]; }

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
const walker = (() => {
  const m = new Mesh();
  // (the robe: full at the hem, narrowing to the shoulders; the sash about it)
  m.tube([0, 0.03, 0], [0, 0.82, 0], 0.31, 0.21, INK.robe, M.robe, 12);
  m.tube([0, 0.82, 0], [0, 1.34, 0], 0.21, 0.16, INK.robe, M.robe, 12);
  m.tube([0, 0.76, 0], [0, 0.9, 0], 0.225, 0.22, INK.red, M.red, 12);
  m.tube([0.05, 0.8, 0.2], [0.08, 0.45, 0.24], 0.04, 0.03, INK.red, M.red, 4);
  // (wide sleeves, the arms bent: one to the staff, one hanging)
  m.tube([0.15, 1.28, 0], [0.3, 0.98, 0.1], 0.07, 0.13, INK.robe, M.robe, 8);
  m.tube([-0.15, 1.28, 0], [-0.27, 0.92, -0.02], 0.07, 0.14, INK.robe, M.robe, 8);
  m.tube([0.31, 0.98, 0.11], [0.34, 0.95, 0.13], 0.05, 0.045, INK.skin, M.skin, 6);
  // (the head, the black hair gathered behind under the hat; the hat a wide shallow cone)
  m.tube([0, 1.32, 0], [0, 1.56, 0.02], 0.1, 0.09, INK.skin, M.skin, 8);
  m.tube([0, 1.36, -0.05], [0, 1.56, -0.04], 0.095, 0.09, INK.dark, M.dark, 8);
  m.tube([0, 1.52, 0], [0, 1.76, 0], 0.44, 0.02, INK.hat, M.hat, 16);
  // (shoes, just showing under the hem)
  for (const sx of [-1, 1]) m.tube([sx * 0.09, 0.02, 0.05], [sx * 0.09, 0.02, 0.2], 0.045, 0.04, INK.dark, M.dark, 6);
  // (the staff, taller than they are)
  m.tube([0.37, 2.1, -0.04], [0.36, -0.02, 0.36], 0.022, 0.022, INK.trunk, M.trunk, 5);
  // (their shadow: a stroke or two of grey, off to the side away from the light)
  for (let k = 0; k < 14; k++) {
    const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2, cx = -0.5, rx = 0.6, rz = 0.24;
    m.v.push(cx, 0.03, 0.05, 0, 1, 0, 0, 0, 0.3, M.shade);
    m.v.push(cx + Math.cos(a1) * rx, 0.03, 0.05 + Math.sin(a1) * rz, 0, 1, 0, Math.cos(a1), Math.sin(a1), 0.3, M.shade);
    m.v.push(cx + Math.cos(a0) * rx, 0.03, 0.05 + Math.sin(a0) * rz, 0, 1, 0, Math.cos(a0), Math.sin(a0), 0.3, M.shade);
  }
  return R.mesh(m.v.out());
})();

// ─── the bands of the hill, made as they're needed, dropped behind ───────────────────────────────
interface Live { band: Band; solid: Drawn; puffs: Drawn; petals: Drawn }
const live = new Map<number, Live>();
function keepBands(z: number) {
  const lo = Math.floor((z - 14) / BAND), hi = Math.floor((z + 52) / BAND);
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
let s = Math.max(2, Number(params.get('at')) || 2), speed = 0, want = 0, phase = 0;
const WALK = 1.25;
/** Where the walker stands at s: on the step under them, lifting onto the next as they come to its edge. */
function stand(sAt: number): { p: V3; dir: [number, number] } {
  const f = path.flightAt(sAt), d = sAt - f.s0;
  const at = path.at(sAt);
  if (d < f.ll) return at;
  const u = d - f.ll, k = Math.min(f.steps - 1, Math.floor(u / f.run)), fr2 = u / f.run - k;
  const lift = k < f.steps - 1 ? RISE * smoothstep(0.62, 1, fr2) : 0;
  return { p: [at.p[0], f.a[1] + (k + 1) * RISE + lift, at.p[2]], dir: at.dir };
}
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// holding anywhere walks; dragging looks about; keys
let holding = false, held = 0, downAt: { x: number; y: number; id: number } | null = null, looking = false;
let lookYaw = 0, lookPitch = 0, lookAt0 = -9;
const keys = new Set<string>();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); downAt = { x: e.clientX, y: e.clientY, id: e.pointerId }; holding = true; looking = false; $('hint').classList.remove('on'); });
canvas.addEventListener('pointermove', (e) => {
  if (!downAt || downAt.id !== e.pointerId) return;
  const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
  if (!looking && Math.hypot(dx, dy) > 14) { looking = true; holding = false; }
  if (looking) {
    lookYaw = Math.max(-0.7, Math.min(0.7, lookYaw - (e.movementX || 0) * 0.005));
    lookPitch = Math.max(-0.25, Math.min(0.3, lookPitch + (e.movementY || 0) * 0.003));
    lookAt0 = performance.now();
  }
});
const up = (e: PointerEvent) => { if (downAt?.id === e.pointerId) { downAt = null; holding = false; looking = false; } };
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); $('hint').classList.remove('on'); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); holding = false; });

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
  const dist = (aspect < 1 ? 50 : 40) + (preview ? 6 : 0);
  const pitch = 0.7 + lookPitch, yaw = lookYaw;
  const t: V3 = [cam.x + (cam.t[0] - p[0]) * 0, cam.t[1], cam.t[2]];
  t[0] = cam.x;
  const eye: V3 = [t[0] - Math.sin(yaw) * Math.cos(pitch) * dist, t[1] + Math.sin(pitch) * dist, t[2] - Math.cos(yaw) * Math.cos(pitch) * dist];
  return { eye, t };
}

// ─── the frame ───────────────────────────────────────────────────────────────────────────────────
let last = performance.now(), time = 0;
let reached = 0;
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now; time += dt;
  const dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  // walk: held, on; ↓, back; let go, slow to a stop
  if (holding) held += dt; else held = 0;
  want = preview ? 0.8 : keys.has('arrowup') || keys.has('w') || (holding && held > 0.12) ? 1 : keys.has('arrowdown') || keys.has('s') ? -0.7 : 0;
  speed += (want - speed) * (1 - Math.exp(-dt * 4));
  s = Math.max(1, s + speed * WALK * dt);
  phase += Math.abs(speed) * WALK * dt * 2.6;
  const st = stand(s);
  const bob = 0.035 * Math.abs(Math.sin(phase));
  const pos: V3 = [st.p[0], st.p[1] + bob, st.p[2]];
  const yaw = Math.atan2(st.dir[0], st.dir[1]) + (speed < -0.05 ? Math.PI : 0);
  path.extend(pos[2] + 80);
  keepBands(pos[2]);

  // the temple last passed: its couplet, its name
  let n = 0;
  for (const f of path.flights) { if (f.b[2] > pos[2] - 2) break; if (f.temple) n++; }
  if (n !== reached || poemAt < 0) { reached = n; showPoem(n); showName(n > 0 ? n - 1 : 0); }

  const { eye, t } = camera(pos, dt);
  const aspect = W / H;
  const near = 1, far = 160;
  const fov = aspect < 1 ? 0.5 : 0.4;
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
  const model: M4 = new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1], pos[2], 1]);
  const bands = [...live.values()];
  // (where the walker is on the glass, and how far: the blossom between is thinned away)
  const wc = [pos[0], pos[1] + 0.9, pos[2]];
  const cx = vp[0] * wc[0] + vp[4] * wc[1] + vp[8] * wc[2] + vp[12], cy = vp[1] * wc[0] + vp[5] * wc[1] + vp[9] * wc[2] + vp[13], cw = vp[3] * wc[0] + vp[7] * wc[1] + vp[11] * wc[2] + vp[15];
  const cut: [number, number, number, number] = [cx / cw, cy / cw, 0.16, Math.hypot(wc[0] - eye[0], wc[1] - eye[1], wc[2] - eye[2])];
  R.frame({ vp, eye, right: v.right, up: v.up, fwd: v.fwd, near, far, dpr, cut },
    [...bands.map((l) => ({ d: l.solid })), { d: walker, model }],
    bands.map((l) => l.puffs), [...bands.map((l) => l.petals), fallDrawn]);

  // what it reports of itself, for the checks
  (window as unknown as { __taohua: unknown }).__taohua = { seed, s, pos, steps: Math.round(pos[1] / RISE), bands: live.size, reached, puffs: bands.reduce((a, l) => a + l.puffs.count, 0) };
  $('climb').textContent = `${Math.max(0, Math.round(pos[1] / RISE))}`;
  requestAnimationFrame(frame);
}
showPoem(0);
showName(0);
if (!preview) setTimeout(() => $('hint').classList.add('on'), 1200);
void SPAN; void WIDTH;
requestAnimationFrame(frame);
