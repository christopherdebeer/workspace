/**
 * Taohua (桃花) — a journey up a hillside of peach blossom, by ways that part and meet, past the
 * mountain temples and casts from Changes written on the hillside, on forever. After a print: peach
 * trees in flower, black rocks, stone steps where the way is steep, a temple of teal tiles and red
 * columns, a walker in a straw hat with a staff, the paper's cream under it all.
 *
 * Tap a way (or press on it and slide along it) to walk there, by whichever ways lead there; tap
 * anywhere else to go to the nearest place on a way that can be seen; ↑, W walk on up (at a fork,
 * the way most nearly ahead), ↓, S back down. Drag off the ways to look about a little. The seed
 * and where the walker is are in the address (?seed=…&at=…). `?preview` climbs by itself, quietly.
 */
import { hash, randomSeed, seedFrom, seedName, seeded } from '../kit/rng';
import { RISE, WIDTH, Ways, type V3, type Way } from './ways';
import { invert, lookAt, mulM, perspective, Renderer, type Drawn, type M4 } from './render';
import { stationsNear } from './compose';
import { deerNear, type DeerKind } from './herds';
import { Deer, deerParts } from './deer';
import { hexagrams, moving } from '../changes/model';
import { ATLAS, BAND, TYPE, INK, M, Mesh, NAMES, TILE, ground, makeBand, templeSurface, templesNear, type Band } from './world';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const review = params.has('review');
/** the composition view: the print as broad strokes only, stepped back, to judge its arrangement on its own (`?ink`, or C) */
let ink = params.has('ink');
const setInk = (on: boolean) => {
  ink = on; document.body.classList.toggle('ink', on);
  document.getElementById('inkt')?.setAttribute('aria-pressed', String(on));
  // (the address keeps it, so a reload or a shared link comes back to the same view)
  const u = new URL(location.href);
  if (on) u.searchParams.set('ink', ''); else u.searchParams.delete('ink');
  history.replaceState(null, '', u.toString().replace(/ink=(&|$)/, 'ink$1'));
};
// (the composition view's seal, under the steps: a tap toggles it, as C does)
document.getElementById('inkt')?.addEventListener('click', () => setInk(!ink));
setInk(ink);
const PASS = 'journey-1';
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

const ways = new Ways(seed);

// ─── Changes: at each station a cast, its words inked on the hillside in the space kept for it ──
// (the words come from a sheet, ink on nothing: each hexagram's name, its characters one under the
// other; 之; each hexagram's number and title, small, plain and after an arrow. The world lays them
// on the hill, where what stands before them stands before them)
function words() {
  const c = document.createElement('canvas');
  c.width = TYPE.w; c.height = TYPE.h;
  const g = c.getContext('2d')!;
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#2b2420';
  g.font = '104px "Noto Serif SC", "Songti SC", "STSong", serif';
  const column = (r: number[], text: string) => [...text].forEach((ch, j) => g.fillText(ch, r[0] + 64, r[1] + 64 + j * 128));
  hexagrams.forEach((h, k) => column(TYPE.han(k), h.han));
  column(TYPE.zhi, '之');
  g.textAlign = 'left'; g.fillStyle = '#463d36';
  const en = (r: number[], text: string) => {
    g.font = 'italic 40px "Iowan Old Style", Palatino, Georgia, serif';
    const w = g.measureText(text).width;
    if (w > r[2] - 8) g.font = `italic ${Math.floor(40 * (r[2] - 8) / w)}px "Iowan Old Style", Palatino, Georgia, serif`;
    g.fillText(text, r[0] + 2, r[1] + r[3] / 2);
  };
  hexagrams.forEach((h, k) => { en(TYPE.en(k, false), `${h.number} · ${h.title}`); en(TYPE.en(k, true), `→ ${h.number} · ${h.title}`); });
  R.setType(c);
}
words();
void document.fonts?.load('104px "Noto Serif SC"', hexagrams.map((h) => h.han).join('') + '之').then(() => words());

// ─── the title, at the foot of the print where the journey starts: the first temple's name over
// 桃花, large, and the seal 桃源. It's of the hillside there, and is walked away from ───────────────
let titleAt: V3 | null = null, titleFoot: [number, number] = [0, 0];
/** where the title's foot stands on the print, untouched */
function titleRest() {
  const el = $('title'), t = el.style.transform;
  el.style.transform = '';
  const b = el.getBoundingClientRect();
  el.style.transform = t;
  titleFoot = [b.left + b.width / 2, b.bottom];
}
addEventListener('resize', titleRest);
function placeTitle(pos: V3) {
  const el = $('title');
  if (!titleAt) {
    // (its name the first temple's up the hill from where the journey starts)
    let first: { z: number; name: number } | null = null;
    for (const t of templesNear(ways, pos[2], pos[2] + 400)) if (t.c[2] > pos[2] && (!first || t.c[2] < first.z)) first = { z: t.c[2], name: t.name };
    showName(first ? first.name : 0);
    // (the hill under its foot, as the print starts: it stays with that, as the hill moves)
    titleRest();
    let best = Infinity;
    for (let dz = -30; dz <= 30; dz += 0.25) for (let dx = -24; dx <= 24; dx += 0.5) {
      const x = pos[0] + dx, z = pos[2] + dz, p: V3 = [x, ways.hill(z), z], q = project(p), d = Math.hypot(q[0] - titleFoot[0], q[1] - titleFoot[1]);
      if (q[2] > 0 && d < best) { best = d; titleAt = p; }
    }
  }
  const q = project(titleAt!);
  const dx = q[0] - titleFoot[0], dy = q[1] - titleFoot[1];
  el.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  el.style.visibility = q[2] > 0 && Math.abs(dy) < innerHeight * 1.5 && Math.abs(dx) < innerWidth * 1.5 ? '' : 'hidden';
}
function showName(i: number) { $('name').textContent = NAMES[i % NAMES.length]; }

// ─── the plaques: each temple's name in gold on its dark board, red framed ──────────────────────
function plaques() {
  const c = document.createElement('canvas');
  c.width = ATLAS.w * ATLAS.cols; c.height = ATLAS.h * ATLAS.rows;
  const g = c.getContext('2d')!;
  // (cell i: column i % cols; row i / cols, counted up from the bottom, as the drawing's v is)
  const at = (i: number) => [(i % ATLAS.cols) * ATLAS.w, (ATLAS.rows - 1 - Math.floor(i / ATLAS.cols)) * ATLAS.h];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  NAMES.forEach((name, i) => {
    const [x, y] = at(i);
    g.fillStyle = '#a3321f'; g.fillRect(x, y, 512, 160);
    g.fillStyle = '#3a2620'; g.fillRect(x + 14, y + 14, 484, 132);
    g.strokeStyle = '#c9a55a'; g.lineWidth = 4; g.strokeRect(x + 24, y + 24, 464, 112);
    g.fillStyle = '#e2c27a';
    g.font = '96px "Ma Shan Zheng", "STKaiti", "KaiTi", "Songti SC", serif';
    g.fillText(name, x + 256, y + 84);
  });
  R.setPlaque(c);
}
plaques();
void document.fonts?.load('96px "Ma Shan Zheng"', NAMES.join('') + hexagrams.map((h) => h.han).join('') + '之').then(() => plaques());

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

// ─── deer: now and then a few, a little off the ways (herds.ts); each of its kind's parts (deer.ts)
const deerKinds = new Map<DeerKind, { body: Drawn; neck: Drawn; head: Drawn; legs: Drawn[]; shadow: Drawn }>();
const kindParts = (k: DeerKind) => {
  let d = deerKinds.get(k);
  if (!d) { const p = deerParts(k); d = { body: R.mesh(p.body.v.out()), neck: R.mesh(p.neck.v.out()), head: R.mesh(p.head.v.out()), legs: p.legs.map((l) => R.mesh(l.v.out())), shadow: R.mesh(p.shadow.v.out()) }; deerKinds.set(k, d); }
  return d;
};
const herds = new Map<number, Deer[]>();
/** The herds about where the walker is, living; those left far behind, let go. */
function keepHerds(z: number) {
  for (const site of deerNear(ways, seed, z - 40, z + 110)) if (!herds.has(site.k)) herds.set(site.k, site.deer.map((d, n) => new Deer(d, site.drink, site.k * 3 + n)));
  for (const [k, h] of herds) if (h.every((d) => d.z < z - 90 || d.z > z + 200)) herds.delete(k);
}
/** Each deer a step on, and its parts where it's got to: for the drawing. */
function liveDeer(dt: number, time: number, pos: V3): Array<{ d: Drawn; model: M4 }> {
  const out: Array<{ d: Drawn; model: M4 }> = [];
  for (const h of herds.values()) {
    // (when one bounds away, the others go with it)
    let scared = h.some((d) => d.mode === 'flee');
    for (const d of h) if (d.step(dt, ways, pos[0], pos[2], scared)) scared = true;
    for (const d of h) {
      const p = d.pose(ways, time), m = kindParts(d.kind);
      out.push({ d: m.shadow, model: p.shadow }, { d: m.body, model: p.body }, { d: m.neck, model: p.neck }, { d: m.head, model: p.head }, ...m.legs.map((l, i) => ({ d: l, model: p.legs[i] })));
    }
  }
  return out;
}

// ─── the bands of the hill, made as they're needed, dropped behind ───────────────────────────────
interface Live { band: Band; solid: Drawn; puffs: Drawn; petals: Drawn }
const live = new Map<string, Live>();
/** Keep the tiles about where the eye looks made, and drop those it's left: across the hill as far as the view reaches, up it ahead and a little behind. */
function keepBands(x: number, z: number) {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const half = (aspect < 1 ? 22 : 46) * (ink ? 1.8 : 1);
  const lo = Math.floor((z - (ink ? 40 : 24)) / BAND), hi = Math.floor((z + (ink ? 130 : 70)) / BAND);
  const il = Math.floor((x - half) / TILE), ih = Math.floor((x + half) / TILE);
  for (const [key, l] of live) if (l.band.j < lo - 1 || l.band.j > hi + 1 || l.band.i < il - 1 || l.band.i > ih + 1) { R.drop(l.solid); R.drop(l.puffs); R.drop(l.petals); live.delete(key); }
  // (one tile a frame at most, nearest the walker first, so a climb never stutters)
  let best: [number, number] | null = null, bd = Infinity;
  for (let j = lo; j <= hi; j++) for (let i = il; i <= ih; i++) {
    if (live.has(`${i},${j}`)) continue;
    const d = Math.hypot((i + 0.5) * TILE - x, ((j + 0.5) * BAND - z) * (j * BAND < z - 6 ? 2 : 1));
    if (d < bd) { bd = d; best = [i, j]; }
  }
  if (best) add(best[0], best[1]);
}
function add(i: number, j: number) {
  const band = makeBand(ways, seed, i, j);
  const pet = new Float32Array((band.petals.length / 6) * 7);
  for (let k = 0; k < band.petals.length / 6; k++) { pet.set(band.petals.subarray(k * 6, k * 6 + 6), k * 7); pet[k * 7 + 6] = 0; }
  live.set(`${i},${j}`, { band, solid: R.mesh(band.verts), puffs: R.instances('puff', band.puffs), petals: R.instances('petal', pet) });
}

// ─── petals falling, about where you are ─────────────────────────────────────────────────────────
const FALL = preview ? 90 : 260;
const fall = new Float32Array(FALL * 7);
const fallV = new Float32Array(FALL * 4);
const fr = seeded(hash(seed, 0xfa11));
function respawn(i: number, at: V3, anywhere: boolean) {
  fall[i * 7] = at[0] + (fr() - 0.5) * 26;
  fall[i * 7 + 2] = at[2] + (fr() - 0.35) * 34;
  fall[i * 7 + 1] = ground(ways, fall[i * 7], fall[i * 7 + 2]) + (anywhere ? fr() * 9 : 7 + fr() * 3);
  fall[i * 7 + 3] = 0.05 + fr() * 0.06; fall[i * 7 + 5] = fr();
  fallV[i * 4] = 0.35 + fr() * 0.45; fallV[i * 4 + 1] = fr() * 6.28; fallV[i * 4 + 2] = 0.6 + fr() * 1.4; fallV[i * 4 + 3] = (fr() - 0.5) * 0.6;
}
let fallDrawn: Drawn | null = null;

// ─── walking ─────────────────────────────────────────────────────────────────────────────────────
/** a place on the ways: which way, and how far along it */
interface Spot { w: Way; u: number }
// (`?at=way:metres`: start there; else at the foot of the hill)
function startSpot(): Spot {
  const at = params.get('at') ?? '';
  const [id, u] = at.split(':');
  const w = id ? ways.byId(id) : null;
  if (w) return { w, u: Math.max(0, Math.min(w.len, Number(u) || 0)) };
  return { w: ways.first(), u: 0.5 };
}
let here: Spot = startSpot();
let speed = 0, want = 0, phase = 0, stride = 0, facing = NaN;
const WALK = 1.25;
/** Where the walker stands at a spot: on the step under them, lifting onto the next as they come to its edge; on a temple's terrace or stair, on that. */
function stand(sp: Spot): { p: V3; dir: [number, number] } {
  const at = ways.at(sp.w, sp.u, true), p = at.p;
  for (const t of nearTemples) { const y = templeSurface(t, p[0], p[2]); if (y !== null) return { p: [p[0], y, p[2]], dir: at.dir }; }
  // (over water: on a bridge's deck, or on the stepping stones, a little hop from one to the next)
  const c = sp.w.cross;
  if (c && sp.u >= c.u0 && sp.u <= c.u1) {
    let y = ways.surface(sp.w, sp.u, p[2]);
    if (c.kind === 'stones') { const e = Math.min(sp.u - c.u0, c.u1 - sp.u); y += 0.07 * Math.abs(Math.sin((Math.PI * (sp.u - c.u0)) / 0.62)) * smoothstep(0.3, 0.9, e); }
    return { p: [p[0], y, p[2]], dir: at.dir };
  }
  const st = ways.stairAt(sp.w, sp.u);
  if (!st) return { p: [p[0], ways.hill(p[2]) - 0.1, p[2]], dir: at.dir };
  const f = ((sp.u - st.u0) / (st.u1 - st.u0)) * st.n, k = Math.min(st.n - 1, Math.floor(f));
  const top = st.h0 + ((k + 1) / st.n) * (st.h1 - st.h0), rise = (st.h1 - st.h0) / st.n;
  const lift = k < st.n - 1 ? rise * smoothstep(0.62, 1, f - k) : 0;
  return { p: [p[0], top + lift, p[2]], dir: at.dir };
}
let nearTemples: ReturnType<typeof templesNear> = [];
const dotDir = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** where a spot is, to the eye: where they'd stand there */
const spotP = (sp: Spot): V3 => stand(sp).p;

// tap a way (or press on it and slide along it) and they walk there, by whichever ways lead there;
// tap anywhere else, to the nearest place on a way that can be seen; drag off the ways to look
// about; keys walk on or back
let markAt = -1e9, goal: Spot | null = null, legs: Array<{ w: Way; u0: number; u1: number }> = [];
let downAt: { x: number; y: number; id: number; on: boolean; t: number } | null = null, looking = false;
let lookYaw = 0, lookPitch = 0, lookAt0 = -9;
const keys = new Set<string>();
/** the last frame's view, to find what's under a finger */
let lastVP: M4 | null = null;
const project = (p: V3): [number, number, number] => {
  const m = lastVP!;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [((x / w) * 0.5 + 0.5) * innerWidth, (0.5 - (y / w) * 0.5) * innerHeight, w];
};
/** what a way, seen, is: its steps and stones, the ground and what lies on it */
const OPEN = new Set<number>([M.step, M.earth, M.ground, M.shade, M.petal, M.grass]);
/** what a temple is drawn in: its roof, walls, paint, plaque, door, and its terrace's stone */
const TEMPLE = new Set<number>([M.tile, M.ridge, M.red, M.wall, M.plaque, M.dark, M.stone]);
/** every place on the ways about where the walker is, to the eye, every so far along */
function* spots(step: number): Generator<Spot> {
  const z = here.w.a[2] + (here.w.b[2] - here.w.a[2]) * (here.u / here.w.len);
  for (const w of ways.waysNear(z - 40, z + 100)) for (let u = 0; u <= w.len; u += step) yield { w, u };
}
/** Where on a way a point on the screen (CSS pixels) falls, if it falls on one where it can be seen. */
function pick(px: number, py: number): Spot | null {
  if (!lastVP) return null;
  // (only where the way is to be seen: not a tree, a rock, a temple standing in front of it)
  const m = R.matAt(px * (canvas.width / innerWidth), py * (canvas.height / innerHeight));
  if (!OPEN.has(m)) return null;
  let best: Spot | null = null, bestK = 1;
  for (const sp of spots(0.2)) {
    const at = ways.at(sp.w, sp.u), q = project(at.p);
    if (q[2] <= 0) continue;
    // (how wide the way is there, on the glass)
    const e = project([at.p[0] + at.dir[1] * WIDTH * 0.5, at.p[1], at.p[2] - at.dir[0] * WIDTH * 0.5]);
    const half = Math.max(12, Math.hypot(e[0] - q[0], e[1] - q[1]) * 1.15);
    const k = Math.hypot(px - q[0], py - q[1]) / half;
    if (k < bestK) { bestK = k; best = sp; }
  }
  return best;
}
/**
 * Where on a way is nearest a point on the screen that isn't on one (the hillside, a temple, a
 * tree): of the places along the ways that can be seen (not behind blossom, a rock, a roof), the
 * one nearest the finger on the glass, so the walker goes there and is seen to arrive.
 */
function nearestSeen(px: number, py: number): Spot | null {
  if (!lastVP) return null;
  const m = R.mats();
  if (!m) return null;
  const kx = canvas.width / innerWidth, ky = canvas.height / innerHeight;
  // (a tap on a temple: the way behind it counts as seen, as the temple stands over it there)
  const onTemple = TEMPLE.has(m.at(px * kx, py * ky));
  const seen = (mat: number) => OPEN.has(mat) || (onTemple && TEMPLE.has(mat));
  let best: Spot | null = null, bestD = Infinity;
  for (const sp of spots(0.25)) {
    const q = project(spotP(sp));
    if (q[2] <= 0 || q[0] < 8 || q[1] < 8 || q[0] > innerWidth - 8 || q[1] > innerHeight - 8) continue;
    const d = Math.hypot(px - q[0], py - q[1]);
    if (d >= bestD) continue;
    // (seen: what's drawn there is the way, or the ground beside it, about the place and just above, where the walker would stand)
    if (![[0, 0], [0, -10], [-4, -4], [4, -4]].every(([dx, dy]) => seen(m.at((q[0] + dx) * kx, (q[1] + dy) * ky)))) continue;
    bestD = d; best = sp;
  }
  return best;
}
/** Go there: the route, through the junctions, from where they are. */
function goTo(sp: Spot) {
  goal = sp; markAt = performance.now();
  legs = ways.route(here.w, here.u, sp.w, sp.u);
}
// (a press is only a tap if it lets go where it began, soon: then the walker goes there; any drag looks about, wherever it began)
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, t: performance.now() };
  looking = false;
  $('hint').classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  if (!downAt || downAt.id !== e.pointerId) return;
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
  // (a tap: on a way, there; anywhere else, the nearest place on one that can be seen)
  if (!looking && e.type === 'pointerup' && performance.now() - downAt.t < 600) {
    const at = pick(e.clientX, e.clientY) ?? nearestSeen(e.clientX, e.clientY);
    if (at !== null) goTo(at);
  }
  downAt = null; looking = false;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') { setInk(!ink); return; }
  keys.add(e.key.toLowerCase()); goal = null; legs = []; $('hint').classList.remove('on');
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
  // (each way its own stroke: heavy where it's steps, dry and broken where it's a trail)
  for (const w of ways.waysNear(pos[2] - 60, pos[2] + 160)) {
    let prev: [number, number, number] | null = null;
    for (let u = 0; u <= w.len + 0.01; u += 0.5) {
      const at = ways.at(w, Math.min(u, w.len)), q = project(at.p);
      if (prev && q[2] > 0 && prev[2] > 0) {
        const e = project([at.p[0] + at.dir[1] * WIDTH * 0.5, at.p[1], at.p[2] - at.dir[0] * WIDTH * 0.5]);
        const wpx = Math.min(12, Math.max(1.5, Math.hypot(e[0] - q[0], e[1] - q[1]) * 1.4));
        const trail = !ways.stairAt(w, u);
        g.strokeStyle = trail ? '#9c948a' : '#2a2420';
        g.lineWidth = wpx * (trail ? 0.45 : 1) * (0.85 + 0.3 * Math.sin(u * 0.7));
        g.setLineDash(trail ? [wpx * 0.6, wpx * 0.5] : []);
        g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(q[0], q[1]); g.stroke();
      }
      prev = q;
    }
  }
  g.setLineDash([]);
  // (the stations' spaces: outlined in vermilion, their hexagrams drawn small in their middles)
  for (const st of stationsNear(ways, seed, pos[2] - 30, pos[2] + 140)) {
    g.beginPath();
    for (let k = 0; k <= 32; k++) {
      const a = (k / 32) * Math.PI * 2, q = project([st.c[0] + Math.cos(a) * st.rx, st.c[1], st.c[2] + Math.sin(a) * st.rz]);
      if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]);
    }
    g.setLineDash([6, 5]); g.lineWidth = 1.5;
    g.strokeStyle = '#b8382c';
    g.stroke();
    const q = project(st.c);
    st.lines.forEach((v, k) => {
      const y = q[1] + 15 - k * 6;
      g.fillStyle = moving(v) ? '#b8382c' : '#2a2420';
      if (v % 2) g.fillRect(q[0] - 12, y - 2, 24, 4); else { g.fillRect(q[0] - 12, y - 2, 10, 4); g.fillRect(q[0] + 2, y - 2, 10, 4); }
    });
  }
  g.setLineDash([]);
  const w = project([pos[0], pos[1] + 0.8, pos[2]]);
  g.fillStyle = '#b8382c';
  g.beginPath(); g.arc(w[0], w[1], 5, 0, Math.PI * 2); g.fill();
}

// ─── the frame ───────────────────────────────────────────────────────────────────────────────────
let last = performance.now(), time = 0, idleLook = 0, urlAt = '', urlT = -1e9;
function frame(now: number) {
  const dt = review ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now; time += dt;
  const dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  // walk: by the route to where was tapped, slowing as they come to it; or on, or back, by the keys
  // (speed is along the way they're on: up it, +; down it, -)
  if (legs.length) {
    const leg = legs[0], togo = leg.u1 - here.u;
    const left = Math.abs(togo) + legs.slice(1).reduce((a, l) => a + Math.abs(l.u1 - l.u0), 0);
    want = Math.sign(togo || 1) * Math.min(1, left * 1.4 + 0.15);
  } else want = preview ? 0.8 : keys.has('arrowup') || keys.has('w') ? 1 : keys.has('arrowdown') || keys.has('s') ? -0.7 : 0;
  if (Math.sign(want) !== Math.sign(speed) && Math.abs(speed) < 0.3) speed = Math.sign(want) * Math.abs(speed);
  speed += (want - speed) * (1 - Math.exp(-dt * 4));
  let move = speed * WALK * dt * (1 + 0.14 * Math.sin(phase * 2 - 0.8) * stride);
  for (let guard = 0; guard < 4 && Math.abs(move) > 1e-6; guard++) {
    if (legs.length) {
      // (along the leg; at its end, on to the next, or there)
      const leg = legs[0], togo = leg.u1 - here.u;
      if (Math.abs(togo) <= Math.abs(move) || Math.abs(togo) < 0.02) {
        here.u = leg.u1; move = Math.sign(move) * Math.max(0, Math.abs(move) - Math.abs(togo));
        legs.shift();
        if (legs.length) { here = { w: legs[0].w, u: legs[0].u0 }; speed = Math.abs(speed) * Math.sign(legs[0].u1 - legs[0].u0 || 1); move = Math.abs(move) * Math.sign(speed); }
        else { goal = null; speed = 0; move = 0; }
      } else { here.u += Math.sign(togo) * Math.abs(move); move = 0; }
      continue;
    }
    // (by the keys: on along the way; at a junction, on by the way most nearly ahead, up or down)
    const nu = here.u + move;
    if (nu > here.w.len) {
      const end = ways.at(here.w, here.w.len, true).dir, j = here.w.to;
      const next = ways.outOf(j).sort((a, b) => dotDir(ways.at(b, 0, true).dir, end) - dotDir(ways.at(a, 0, true).dir, end))[0];
      if (!next) { here.u = here.w.len; speed = 0; break; }
      move = nu - here.w.len; here = { w: next, u: 0 };
    } else if (nu < 0) {
      const start = ways.at(here.w, 0, true).dir, j = here.w.from;
      const prev = ways.into(j).sort((a, b) => dotDir(ways.at(b, b.len, true).dir, start) - dotDir(ways.at(a, a.len, true).dir, start))[0];
      if (!prev) { here.u = 0; speed = 0; break; }
      move = nu; here = { w: prev, u: prev.len };
    } else { here.u = nu; move = 0; }
  }
  phase += Math.abs(speed) * WALK * dt * 4.4;
  stride += ((Math.abs(speed) > 0.05 ? 1 : 0) - stride) * (1 - Math.exp(-dt * 5));
  const z0 = ways.at(here.w, here.u, true).p[2];
  nearTemples = templesNear(ways, z0 - 20, z0 + 20);
  const st = stand(here);
  if (Number.isNaN(facing)) facing = Math.atan2(st.dir[0], st.dir[1]);
  const bob = 0.03 * Math.abs(Math.sin(phase)) * stride;
  const pos: V3 = [st.p[0], st.p[1] + bob, st.p[2]];
  // (they turn to face their way, not at once)
  const want_yaw = Math.atan2(st.dir[0], st.dir[1]) + (speed < -0.05 ? Math.PI : 0);
  facing += Math.atan2(Math.sin(want_yaw - facing), Math.cos(want_yaw - facing)) * (1 - Math.exp(-dt * 5));
  const yaw = facing;
  keepBands(cam.x || pos[0], pos[2]);
  keepHerds(pos[2]);

  // (passing a temple beside the path, the view leans toward it, so it's in the print with the walker)
  let lean = 0;
  for (const tp of nearTemples) if (!tp.gate) { const d = Math.hypot(tp.c[0] - pos[0], tp.c[2] - pos[2]); lean = (tp.c[0] - pos[0]) * 0.45 * (1 - smoothstep(9, 16, d)); }
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
    if (fall[o + 1] < ground(ways, fall[o], fall[o + 2]) || fall[o + 2] < pos[2] - 12 || fall[o + 2] > pos[2] + 30) respawn(i, pos, false);
  }
  R.update(fallDrawn, fall, 7);

  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const ground_: M4 = new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1] - bob, pos[2], 1]);
  // (the body: a sway from foot to foot, a lean into the climb, a little twist with each step; still, it breathes)
  const sw = Math.sin(phase) * stride;
  const climbing = Math.max(0, Math.min(1, (st.p[1] - stand({ w: here.w, u: Math.max(0, here.u - 0.5 * Math.sign(speed || 1)) }).p[1]) * 4 * Math.sign(speed || 1)));
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
  placeTitle(pos);
  // (the mark where they're going: a ring of vermilion on its place on the path, for a moment, as the tap is answered)
  const mark = $('mark'), ma = (performance.now() - markAt) / 1000;
  if (goal !== null && ma < 1.1) {
    const q = project(spotP(goal));
    mark.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) scale(${(0.8 + 0.35 * Math.min(1, ma * 4)).toFixed(3)})`;
    mark.style.opacity = `${(0.95 * (1 - smoothstep(0.45, 1.1, ma))).toFixed(3)}`;
  } else mark.style.opacity = '0';
  R.frame({ vp, ivp: invert(vp), eye, right: v.right, up: v.up, fwd: v.fwd, near, far, dpr, ink, time: review ? 0 : performance.now() / 1000 },
    [...bands.map((l) => ({ d: l.solid })), { d: body, model }, { d: head, model: headAt }, { d: freeArm, model: armAt }, { d: shadow, model: ground_ }, { d: shoes[0], model: shoeAt(0) }, { d: shoes[1], model: shoeAt(1) }, { d: staff, model: staffAt }, ...liveDeer(review ? 1 / 30 : dt, time, pos)],
    bands.map((l) => l.puffs), [...bands.map((l) => l.petals), fallDrawn]);

  // (the address keeps where they are: the seed, and how far along the path, so a reload, or the
  // link, comes back to the same place; written a couple of times a second at most, as they move)
  const atNow = `${here.w.id}:${here.u.toFixed(1)}`;
  if (!preview && !review && atNow !== urlAt && now - urlT > 400) {
    urlAt = atNow; urlT = now;
    const u = new URL(location.href);
    u.searchParams.set('seed', seedName(seed)); u.searchParams.set('at', atNow);
    history.replaceState(null, '', u);
  }

  // what it reports of itself, for the checks
  (window as unknown as { __taohua: unknown }).__taohua = { pass: PASS, review, seed, at: atNow, goal: goal ? `${goal.w.id}:${goal.u.toFixed(1)}` : null, legs: legs.length, pos, steps: Math.round(pos[1] / RISE), bands: live.size, puffs: bands.reduce((a, l) => a + l.puffs.count, 0), deer: () => [...herds.values()].flat().map((d) => ({ kind: d.kind, mode: d.mode, x: +d.x.toFixed(1), z: +d.z.toFixed(1), s: project([d.x, ground(ways, d.x, d.z) + 0.8, d.z]).map((v) => Math.round(v)) })), screen: (id: string, u: number) => { const w = ways.byId(id); return w ? project(spotP({ w, u })) : null; }, here: () => ({ id: here.w.id, u: here.u, len: here.w.len, ahead: ways.outOf(here.w.to).length }), pick: (x: number, y: number) => { const p = pick(x, y); return p && `${p.w.id}:${p.u.toFixed(1)}`; }, nearestSeen: (x: number, y: number) => { const p = nearestSeen(x, y); return p && `${p.w.id}:${p.u.toFixed(1)}`; }, mat: (x: number, y: number) => R.matAt(x * (canvas.width / innerWidth), y * (canvas.height / innerHeight)) };
  $('climb').textContent = `${Math.max(0, Math.round(pos[1] / RISE))}`;
  requestAnimationFrame(frame);
}
if (review) {
  $('hint').textContent = PASS + ' · seed ' + seed + ' · at ' + here.w.id + ':' + here.u.toFixed(1);
  $('hint').classList.add('on');
} else if (!preview) setTimeout(() => $('hint').classList.add('on'), 1200);
void WIDTH;
requestAnimationFrame(frame);
