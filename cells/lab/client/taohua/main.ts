/**
 * Taohua (桃花) — a journey up a hillside of peach blossom, by ways that part and meet, past the
 * mountain temples and casts from Changes written on the hillside, on forever. After a print: peach
 * trees in flower, black rocks, stone steps where the way is steep, a temple of teal tiles and red
 * columns, a walker in a straw hat with a staff, the paper's cream under it all.
 *
 * Tap a way to walk there, by whichever ways lead there; tap open ground near one to go there across
 * it; tap anywhere else to go to the nearest place on a way to where it falls on the hill, seen or not;
 * ↑, W walk on up (at a fork, the way most nearly ahead), ↓, S back down. A drag looks about a little. The seed
 * and where the walker is are in the address (?seed=…&at=…). `?preview` climbs by itself, quietly.
 */
import { hash, randomSeed, seedFrom, seedName, seeded } from '../kit/rng';
import { RISE, WIDTH, Ways, type V3, type Way } from './ways';
import { invert, lookAt, mulM, perspective, Renderer, type Drawn, type M4 } from './render';
import { stationsNear } from './compose';
import { attach, covers, isOpen as sheetOpen, present, type Place } from './surfaces';
import { identify } from '../changes/model';
import { deerNear, type DeerKind } from './herds';
import { Deer, deerParts } from './deer';
import { hexagrams, moving } from '../changes/model';
import { ATLAS, BAND, TYPE, INK, JETTY, M, Mesh, NAMES, POLE_L, TILE, TSTEP, boat, boatReflection, ground, moorings, SHADOW, groundCut, landingsOf, laidPole, makeBand, onJetty, poleMesh, type Landing, setBench, setOldRefl, setOldShade, setSpecimens, templeSurface, templesNear, type Band } from './world';
import { plan, type P2 } from './roam';
import { ribbon } from './marks';
import { RIVER_L } from './water';
import { BENCHES, bench, RIVER_SCENES, SCENES, TREE_SCENES, treeBench, WAY_SCENES, type RiverScene, type Scene, type TreeScene, type WayScene } from './bench';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const review = params.has('review');
/** the composition view: the print as broad strokes only, stepped back, to judge its arrangement on its own (`?ink`, or C) */
let ink = params.has('ink');
/** how far into the composition view: eased toward it (1) or back from it (0) over a little over half a second, so each thing in the print is seen to become its mass */
let inkT = ink ? 1 : 0;
/**
 * How near the camera stands, by pinching (or the wheel): in the print, nearer only (down to 0.08 of its
 * distance; the nearest of it coming down behind the walker, to look over their shoulder up the hill); in the composition view, further only (out to twice its distance). Each view keeps its own.
 */
let zoomN = 1, zoomI = 1;
const ZOOM_N: [number, number] = [0.08, 1], ZOOM_I: [number, number] = [1, 2];
const zoomBy = (k: number) => {
  if (ink) zoomI = Math.max(ZOOM_I[0], Math.min(ZOOM_I[1], zoomI * k));
  else zoomN = Math.max(ZOOM_N[0], Math.min(ZOOM_N[1], zoomN * k));
};
const ease = (t: number) => t * t * (3 - 2 * t);
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
// (the ways bench: fixed places on one hill, each a kind of way to study; see bench.ts)
const waysScene = params.get('bench') === 'ways' ? WAY_SCENES[(params.get('scene') ?? 'flight') as WayScene] ?? WAY_SCENES.flight : null;
if (waysScene) { params.set('seed', '1'); params.set('at', waysScene); }
// (the river bench: places at the foot of one hill, or the arrival held part way; see bench.ts)
const riverScene = params.get('bench') === 'river' ? RIVER_SCENES[(params.get('scene') ?? 'jetty') as RiverScene] ?? RIVER_SCENES.jetty : null;
if (riverScene) { params.set('seed', '1'); if ('at' in riverScene) params.set('at', riverScene.at); else { params.delete('at'); params.set('intro', String(riverScene.intro)); } }
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
// (`?refl=old`: the old hand-laid reflections, to compare with the drawing's own)
const oldRefl = params.get('refl') === 'old';
setOldRefl(oldRefl);
// (`?shade=old`: the old shade, patches laid on the ground, to compare with the drawing's own)
const oldShade = params.get('shade') === 'old';
setOldShade(oldShade);
// (the water bench: a hill of its own, its four streams, a scene of one of them; see bench.ts)
const benchScene = params.get('bench') === 'water' ? ((params.get('scene') ?? 'pond') as Scene) : null;
if (benchScene) {
  setBench(true);
  const [bx, bz] = bench(ways, benchScene in SCENES ? benchScene : 'pond');
  params.set('at', `@${bx.toFixed(2)},${bz.toFixed(2)}`);
  document.body.classList.add('bench');
}
if (waysScene) { setBench(true); document.body.classList.add('bench'); }
// (the tree bench: a hill of its own, its trees set out as given, each from its own seed; see bench.ts)
if (params.get('bench') === 'tree') {
  const sc = (params.get('scene') ?? 'lone') as TreeScene;
  const tb = treeBench(ways, sc in TREE_SCENES ? sc : 'lone', Number(params.get('tree')) || 1);
  setBench(true); setSpecimens(tb.trees);
  params.set('at', `@${tb.at[0].toFixed(2)},${tb.at[1].toFixed(2)}`);
  document.body.classList.add('bench');
}

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
  // (and the lines beside it go with it)
  const poem = document.getElementById('poem');
  if (poem) { poem.style.transform = el.style.transform; poem.style.visibility = el.style.visibility; }
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

// ─── the walker: a straw hat, a robe with wide sleeves, a sash, a tall staff; in ink, a figure in a print ─
// (dark: the robe nearly black, the sash and face a little less; the hat a mid grey, so it reads)
const FIG = { robe: [0.2, 0.18, 0.17] as [number, number, number], sash: [0.27, 0.24, 0.22] as [number, number, number], skin: [0.3, 0.27, 0.25] as [number, number, number], hat: [0.45, 0.42, 0.39] as [number, number, number] };
// (in parts, each placed by its own turning: the body, which sways and leans as they walk; the head
// under its hat, which looks about when they stand; the free arm, which swings; the shoes; the
// staff; and their shadow on the ground, which does none of that)
const part = (build: (m: Mesh) => void) => { const m = new Mesh(); build(m); return R.mesh(m.v.out()); };
const body = part((m) => {
  // (the robe: full at the hem, narrowing to the shoulders; the sash about it)
  m.tube([0, 0.03, 0], [0, 0.82, 0], 0.31, 0.21, FIG.robe, M.robe, 12);
  m.tube([0, 0.82, 0], [0, 1.34, 0], 0.21, 0.16, FIG.robe, M.robe, 12);
  m.tube([0, 0.76, 0], [0, 0.9, 0], 0.225, 0.22, FIG.sash, M.robe, 12);
  m.tube([0.05, 0.8, 0.2], [0.08, 0.45, 0.24], 0.04, 0.03, FIG.sash, M.robe, 4);
  // (the arm to the staff, its wide sleeve, the hand)
  m.tube([0.15, 1.28, 0], [0.36, 1.0, 0.12], 0.07, 0.13, FIG.robe, M.robe, 8);
  m.tube([0.38, 0.99, 0.13], [0.43, 0.96, 0.15], 0.05, 0.045, FIG.skin, M.skin, 6);
});
const head = part((m) => {
  // (the head, the black hair gathered behind under the hat; the hat a wide shallow cone)
  m.tube([0, 1.32, 0], [0, 1.56, 0.02], 0.1, 0.09, FIG.skin, M.skin, 8);
  m.tube([0, 1.36, -0.05], [0, 1.56, -0.04], 0.095, 0.09, INK.dark, M.dark, 8);
  m.tube([0, 1.52, 0], [0, 1.76, 0], 0.44, 0.02, FIG.hat, M.hat, 16);
});
const freeArm = part((m) => m.tube([-0.15, 1.28, 0], [-0.25, 0.9, 0.02], 0.07, 0.14, FIG.robe, M.robe, 8));
const shadow = part((m) => {
  // (their shade, cast away from the sun as they stand, about as long as they're tall; deeper at their feet. In the
  // world's frame, not theirs: it doesn't turn as they do)
  const [sx, sz] = SHADOW, L = Math.hypot(sx, sz), ux = sx / L, uz = sz / L;
  const patch = (cx: number, cz: number, rx: number, rz: number, deep: number) => {
    for (let k = 0; k < 14; k++) {
      const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2, P = (a: number): [number, number] => [cx + ux * Math.cos(a) * rx - uz * Math.sin(a) * rz, cz + uz * Math.cos(a) * rx + ux * Math.sin(a) * rz];
      const p0 = P(a0), p1 = P(a1);
      m.v.push(cx, 0.03, cz, 0, 1, 0, 0, 0, deep, M.shade);
      m.v.push(p1[0], 0.03, p1[1], 0, 1, 0, Math.cos(a1), Math.sin(a1), deep, M.shade);
      m.v.push(p0[0], 0.03, p0[1], 0, 1, 0, Math.cos(a0), Math.sin(a0), deep, M.shade);
    }
  };
  patch(sx * 0.75, sz * 0.75, L * 0.85 + 0.25, 0.26, 0.24);
  patch(sx * 0.08, sz * 0.08, 0.36, 0.28, 0.32);
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

// ─── the boat, on the river (world.ts `boat`): moored at the jetty, the arrival in it, going about in it
const boatD = part((m) => boat(m)), mooringsD = part((m) => moorings(m));
/** its reflection, for each of sixteen headings */
const boatReflD = Array.from({ length: 16 }, (_, k) => part((m) => boatReflection(m, (k / 16) * Math.PI * 2)));
/** where the walker sits in it: low, behind its canopy (in its own frame) */
const SEAT: V3 = [0, -0.06, -1.3];
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * The arrival: unless the address says where to start, the journey begins on the river, in the boat,
 * out on the broad water, drifting down at about the river's own pace into the narrows and in to the
 * jetty, slowing over its last few metres to lie alongside; then the walker steps off onto its deck. A
 * tap ends it at once. (`intro`: how long it's been going, in seconds; -1 once it's over.)
 */
let intro = -1;
const ARRIVE = (() => {
  const E = JETTY.boat, W = ways.water, sx = E[0] + 22;
  const P0 = [sx, W.riverMid(sx) + 4], P1 = [E[0] + 8, W.riverMid(E[0] + 8) + 1.8], P2 = [E[0], E[2]];
  const pts: Array<[number, number]> = [], cum: number[] = [];
  for (let i = 0; i <= 240; i++) {
    const k = i / 240, q: [number, number] = [(1 - k) ** 2 * P0[0] + 2 * (1 - k) * k * P1[0] + k * k * P2[0], (1 - k) ** 2 * P0[1] + 2 * (1 - k) * k * P1[1] + k * k * P2[1]];
    cum.push(i ? cum[i - 1] + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0);
    pts.push(q);
  }
  const L = cum[cum.length - 1];
  // (its pace: about a metre a second, the river carrying it; easing over its last metres into the mooring)
  const speed = (s: number) => 1.05 * (0.1 + 0.9 * sm(0, 8, L - s));
  const ts: number[] = [0];
  for (let s = 0; s < L - 0.005 && ts.length < 40000;) { s = Math.min(L, s + speed(s) * 0.05 + 0.0004); ts.push(s); }
  return { pts, cum, L, ts, T: (ts.length - 1) * 0.05 };
})();
const STEP = 1.4;
/** where the boat is, t seconds into its arrival, and its heading (its bow along +z at 0) */
function boatPose(t: number): { p: V3; yaw: number } {
  const f = Math.min(ARRIVE.ts.length - 1, Math.max(0, t / 0.05)), i = Math.floor(f), s = ARRIVE.ts[i] + (ARRIVE.ts[Math.min(i + 1, ARRIVE.ts.length - 1)] - ARRIVE.ts[i]) * (f - i);
  let j = 0;
  while (j < ARRIVE.cum.length - 2 && ARRIVE.cum[j + 1] < s) j++;
  const a = ARRIVE.pts[j], b = ARRIVE.pts[j + 1], u = Math.min(1, (s - ARRIVE.cum[j]) / Math.max(1e-6, ARRIVE.cum[j + 1] - ARRIVE.cum[j]));
  const e = sm(ARRIVE.L - 6, ARRIVE.L, s), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  return { p: [a[0] + (b[0] - a[0]) * u, JETTY.boat[1], a[1] + (b[1] - a[1]) * u], yaw: yaw + wrapA(JETTY.boatYaw - yaw) * e };
}
/** the landings along the river, from the seed (world.ts `landingsOf`); and where the boat's moored */
const LANDS = landingsOf(ways, seed);
let moored: Landing = LANDS[0];
const laidPoleD = part((m) => laidPole(m)), poleD = part((m) => poleMesh(m));
/** where the walker stands to pole: on the stern deck, a little to one side (in the boat's frame) */
const POLER: V3 = [0.12, 0.06, -1.75];
/**
 * Moored, it rides on its lines in the current: pushed down the river by it (as the square of its
 * speed there, which comes and goes in slow gusts), the lines pulling it back, so it eases off a hand's
 * breadth and back, and swings a little about them. (A spring and its damping, a step at a time.)
 */
const ride = { off: 0, offV: 0, yaw: 0, yawV: 0, t: 0 };
function rideOn(dt: number) {
  if (dt <= 0) return;
  ride.t += dt;
  const sp = ways.water.riverFlow(moored.boat[0], moored.boat[2])[2];
  const gust = 0.55 + 0.45 * Math.sin(ride.t * 0.37) * Math.sin(ride.t * 0.21 + 1.3) + 0.15 * Math.sin(ride.t * 1.3);
  const push = sp * sp * gust * 1.6;
  for (let k = 0; k < 4; k++) {
    const h = dt / 4;
    ride.offV += (push - 9 * ride.off - 2.6 * ride.offV) * h; ride.off += ride.offV * h;
    ride.yawV += (push * 0.9 - 6 * ride.yaw - 2.2 * ride.yawV) * h; ride.yaw += ride.yawV * h;
  }
}
/**
 * Afloat: going about on the river, as a sampan's poled. The current carries the boat: what the walker
 * does is through the water, and the water's moving. The pole's the engine (as Stillwater's oars are):
 * a tap on the water is a stroke of it, toward there; a stroke is a whole cycle, one phase (`s`, on
 * and on; at rest a quarter, the end of a push): swinging the pole forward through the air (the
 * recovery), planting it on the bed beside the boat (the catch, at .75), leaning on it and walking the
 * boat past it (the drive: only then does it push, the boat surging and then gliding), lifting it out
 * (the release, at .25). Taps queue strokes, two ahead at most. The water drags on its way through it,
 * so it comes to go with the current. Its heading turns to where it's going through the water, as fast
 * as it's going; drifting, it swings slowly as the current has it. It keeps off the banks and the pier.
 * A tap on a landing takes it there: brought in, it comes alongside by itself (or noses into the reeds,
 * and rests there, the walker sitting in it, until the next stroke).
 */
interface Afloat { p: [number, number]; v: [number, number]; yaw: number; to: Landing | null; resting: boolean; s: number; sTo: number; aim: [number, number]; tip: V3 | null; lift: V3 | null }
/** the next release of the stroke (its phase at .25), from s: s itself if it's at one */
const nextRelease = (s: number) => Math.ceil(s - 0.25 - 1e-6) + 0.25;
let afloat: Afloat | null = null;
/** a step from one place to another (into the boat, or out of it), so long, and then what */
let hop: { t: number; dur: number; from: () => V3; to: () => V3; dir: [number, number]; done: () => void } | null = null;
/** on the way to the boat to board it: to there, then in */
let boardWhenThere = false, boardVia: Landing | null = null;
const boatLog: string[] = [];
function boatPoseNow(): { p: V3; yaw: number } {
  if (intro >= 0) return boatPose(intro);
  if (afloat) return { p: [afloat.p[0], RIVER_L, afloat.p[1]], yaw: afloat.yaw };
  const [fx, fz, sp] = ways.water.riverFlow(moored.boat[0], moored.boat[2]), u = sp > 1e-4 ? 1 / sp : 0;
  return { p: [moored.boat[0] + fx * u * ride.off, RIVER_L, moored.boat[2] + fz * u * ride.off], yaw: moored.yaw - ride.yaw };
}
function boatAt(time: number): M4 {
  // (it rocks: rolling a little, pitching less, rising and falling on the current's swell; pushed, its stern dips)
  const pose = boatPoseNow(), [x, y, z] = pose.p, push = afloat?.tip ? Math.max(0, Math.cos(afloat.s * Math.PI * 2)) : 0;
  return mulM(mulM(Tm(x, y + 0.012 * Math.sin(time * 0.9), z), Ry(pose.yaw)), mulM(Rz(0.022 * Math.sin(time * 1.1) + 0.008 * Math.sin(time * 2.3)), Rx(0.01 * Math.sin(time * 0.73 + 1) - 0.014 * push)));
}
const apply = (m: M4, l: V3): V3 => [m[0] * l[0] + m[4] * l[1] + m[8] * l[2] + m[12], m[1] * l[0] + m[5] * l[1] + m[9] * l[2] + m[13], m[2] * l[0] + m[6] * l[1] + m[10] * l[2] + m[14]];
/** how far into the push of a stroke (0 not pushing; 1 its hardest), for the poler's lean */
const pushing = () => (afloat?.tip ? Math.max(0, Math.cos(afloat.s * Math.PI * 2)) : 0);
/** where the poler's hands hold the pole, in the world: at the stern, up and to the side they're poling on, lower as they lean on it */
function handsAt(time: number): V3 {
  const lean = pushing();
  return apply(boatAt(time), [POLER[0] + 0.3, POLER[1] + 1.2 - 0.18 * lean, POLER[2] + 0.2 + 0.22 * lean]);
}
/** where the pole goes in: on the bed beside the boat, by the poler, a little toward where it's to push */
function catchAt(time: number): V3 {
  const a = afloat!, p = apply(boatAt(time), [POLER[0] + 0.62, 0, POLER[2] + 0.45]);
  return [p[0] + a.aim[0] * 0.35, RIVER_L - 1.1, p[2] + a.aim[1] * 0.35];
}
/** The pole, held: from the hands to its tip (planted on the bed through the push; swung forward through the air between; at rest, held upright, its foot in the water by the boat). */
function poleNow(time: number): { top: V3; tip: V3 } {
  const a = afloat!, h = handsAt(time), ph = ((a.s % 1) + 1) % 1, B = boatAt(time);
  let tip: V3;
  if (a.tip) tip = a.tip;
  else if (a.sTo > a.s + 1e-3 && ph >= 0.25 && ph <= 0.75 && a.lift) {
    // (swung forward through the air, from where it came out to where it'll go in, lifted on the way)
    // (from where it came out as the boat has it, so it goes with the boat, not left behind on the water)
    const f = (ph - 0.25) / 0.5, e = f * f * (3 - 2 * f), to = catchAt(time), from = apply(B, a.lift);
    tip = [from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e + 1.1 * Math.sin(Math.PI * f), from[2] + (to[2] - from[2]) * e];
  } else { const q = apply(B, [POLER[0] + 0.5, 0, POLER[2] + 0.3]); tip = [q[0], RIVER_L - 0.9, q[2]]; }
  // (a pole of its own length, from its tip up through the hands, which slide along it as a poler's do)
  const d: V3 = [h[0] - tip[0], h[1] - tip[1], h[2] - tip[2]], L = Math.hypot(d[0], d[1], d[2]) || 1;
  return { top: [tip[0] + (d[0] / L) * POLE_L, tip[1] + (d[1] / L) * POLE_L, tip[2] + (d[2] / L) * POLE_L], tip };
}
/** a matrix taking the pole's own (0,0,0)-(0,1,0) to the world, from its top to its tip */
function poleModel(top: V3, tip: V3): M4 {
  const y: V3 = [tip[0] - top[0], tip[1] - top[1], tip[2] - top[2]], L = Math.hypot(y[0], y[1], y[2]) || 1, n: V3 = [y[0] / L, y[1] / L, y[2] / L];
  const ref: V3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let x: V3 = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
  const xl = Math.hypot(x[0], x[1], x[2]) || 1; x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const z: V3 = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
  return new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, top[0], top[1], top[2], 1]);
}
/** the boat, its pole, and moored at the jetty, its lines; and the ripples about it */
function boatDraw(dt: number, time: number): Array<{ d: Drawn; model: M4 }> {
  rideOn(dt);
  const out = [{ d: boatD, model: boatAt(time) }];
  if (afloat && !afloat.resting) { const pl = poleNow(time); out.push({ d: poleD, model: poleModel(pl.top, pl.tip) }); }
  else out.push({ d: laidPoleD, model: boatAt(time) });
  if (oldRefl) { const pose = boatPoseNow(); out.push({ d: boatReflD[((Math.round(pose.yaw / (Math.PI / 8)) % 16) + 16) % 16], model: Tm(pose.p[0], RIVER_L, pose.p[2]) }); }
  if (intro < 0 && !afloat && !hop && moored.kind === 'jetty') out.push({ d: mooringsD, model: Tm(0, 0, 0) });
  if (dt > 0) ripplesOn(dt);
  if (ripplesD.count) out.push({ d: ripplesD, model: Tm(0, 0, 0) });
  return out;
}
/** where the arrival steps off onto the jetty's deck */
const ARRIVE_ON: P2 = [JETTY.x - 0.15, JETTY.z0 + 1.6];
/** where the walker stands, t seconds into the arrival: in the boat, sitting; then stepping off */
function introStand(t: number, time: number): { p: V3; dir: [number, number] } {
  const aboard = apply(boatAt(time), SEAT), yaw = boatPose(Math.min(t, ARRIVE.T)).yaw;
  if (t < ARRIVE.T) return { p: aboard, dir: [Math.sin(yaw), Math.cos(yaw)] };
  const f = Math.min(1, (t - ARRIVE.T) / STEP), e = f * f * (3 - 2 * f), on: V3 = [ARRIVE_ON[0], JETTY.y, ARRIVE_ON[1]];
  return { p: [aboard[0] + (on[0] - aboard[0]) * e, aboard[1] + (on[1] - aboard[1]) * e + 0.12 * Math.sin(Math.PI * f), aboard[2] + (on[2] - aboard[2]) * e], dir: [0, 1] };
}
/** Into the boat from beside it, standing at its stern with the pole; cast off. */
function board() {
  const from: V3 = [posNow[0], posNow[1], posNow[2]];
  hop = { t: 0, dur: STEP, from: () => from, to: () => apply(boatAt(time), POLER), dir: [Math.sin(moored.yaw), Math.cos(moored.yaw)], done: () => {
    const pose = boatPoseNow();
    // (cast off, pushed off from the bank, out into the river)
    const out = Math.sign(ways.water.riverMid(pose.p[0]) - pose.p[2]) || -1;
    afloat = { p: [pose.p[0], pose.p[2]], v: [moored.kind === 'jetty' ? 0.35 : 0, 0.55 * out], yaw: pose.yaw, to: null, resting: false, s: 0.25, sTo: 0.25, aim: [Math.sin(pose.yaw), Math.cos(pose.yaw)], tip: null, lift: null };
  } };
}
/** Alongside at a landing: moored there, the walker steps out (at the stone landing, then up its stones to the way). */
function landAt(l: Landing) {
  boatLog.push('landAt ' + l.kind + ' ' + (new Error().stack ?? '').split('\n').slice(1, 4).join(' / '));
  afloat = null; moored = l;
  ride.off = 0; ride.offV = 0; ride.yaw = 0; ride.yawV = 0;
  const by = l.by!;
  hop = { t: 0, dur: STEP, from: () => apply(boatAt(time), POLER), to: () => by, dir: [0, 1], done: () => {
    off = [by[0], by[2]]; offDir = [0, 1]; trail = []; join = null;
    if (l.trail.length) { trail = l.trail.slice(1).map((q) => [q[0], q[1]] as P2); join = l.join ? { w: l.join.w, u: l.join.u } : null; }
  } };
}
/**
 * The pole lifted out: where it came out kept as the boat has it, for the swing forward. Early (the boat
 * gone so far past it that the hands would run off its end), the stroke's drive is over then too.
 */
function release(a: Afloat, early: boolean) {
  if (!a.tip) return;
  const B = boatAt(time), dx = a.tip[0] - B[12], dz = a.tip[2] - B[14], c = B[0], sn = B[8];
  // (in the boat's frame: across it and along it, at the water)
  a.lift = [c * dx - sn * dz, 0, sn * dx + c * dz];
  ripple('drip', a.tip[0], a.tip[2]); a.tip = null; dripsLeft = 3;
  if (early) a.s = Math.min(a.sTo, nextRelease(a.s));
}
/** A stroke asked for, toward (dx, dz): queued, two ahead of the one going at most; each ends with the pole out of the water. */
function queueStroke(a: Afloat, dx: number, dz: number) {
  const d = Math.hypot(dx, dz) || 1;
  a.to = null; a.resting = false; a.aim = [dx / d, dz / d];
  a.sTo = Math.min(nextRelease(a.s) + 2, Math.max(a.sTo, a.s) + 1);
}
/** The boat a step on, afloat. */
function sail(dt: number) {
  if (!afloat || dt <= 0) return;
  const W = ways.water, a = afloat, [cx, cz] = W.riverFlow(a.p[0], a.p[1]);
  // (the stroke: its phase on, toward the strokes asked for; at the catch, the pole planted; at the release, lifted)
  const before = a.s;
  if (a.sTo > a.s) {
    const ph = ((a.s % 1) + 1) % 1, driving = ph > 0.75 || ph < 0.25;
    a.s = Math.min(a.sTo, a.s + dt * (driving ? 0.62 : 0.45));
  }
  const crossed = (at: number) => Math.floor(a.s - at) > Math.floor(before - at);
  if (crossed(0.75)) { a.tip = catchAt(time); ripple('ring', a.tip[0], a.tip[2]); }
  if (crossed(0.25)) release(a, false);
  const drive = pushing();
  if (a.to) {
    // (brought in: to where it lies at the landing, slower as it comes)
    // (round the end of the pier, if it stands between: out past its end first)
    const across = (a.p[0] - JETTY.x) * (a.to.boat[0] - JETTY.x) < 0 && a.to.kind !== 'jetty' && a.p[1] > JETTY.z0 - 3;
    const H: V3 = across ? [a.p[0] + (a.to.boat[0] - a.p[0]) * 0.15, RIVER_L, JETTY.z0 - 4.2] : a.to.boat;
    const dx = H[0] - a.p[0], dz = H[2] - a.p[1], d = across ? Math.max(3, Math.hypot(dx, dz)) : Math.hypot(dx, dz), want = Math.min(0.75, 0.12 + d * 0.3);
    const k = 1 - Math.exp(-dt * 1.4);
    a.v[0] += ((dx / Math.max(d, 1e-3)) * want - a.v[0]) * k; a.v[1] += ((dz / Math.max(d, 1e-3)) * want - a.v[1]) * k;
    if (!across && d < 0.25) {
      if (a.to.kind === 'reeds') { a.resting = true; a.p = [H[0], H[2]]; a.v = [0, 0]; a.yaw = a.to.yaw; a.to = null; a.tip = null; }
      else { landAt(a.to); return; }
    }
  } else if (a.resting) {
    a.v = [0, 0];
  } else {
    // (the push, through the water, toward where it's aimed; the water dragging on its way through it)
    let rx = a.v[0] - cx + a.aim[0] * 1.5 * drive * dt, rz = a.v[1] - cz + a.aim[1] * 1.5 * drive * dt;
    const k = Math.exp(-dt * 0.45);
    rx *= k; rz *= k;
    const rl = Math.hypot(rx, rz);
    if (rl > 1.5) { rx *= 1.5 / rl; rz *= 1.5 / rl; }
    a.v = [cx + rx, cz + rz];
  }
  if (a.resting) return;
  a.p[0] += a.v[0] * dt; a.p[1] += a.v[1] * dt;
  // (its hull's reach, from its middle, along the river and across it, as it lies)
  const reachX = 0.6 + 2.2 * Math.abs(Math.sin(a.yaw)), reachZ = 0.6 + 2.2 * Math.abs(Math.cos(a.yaw));
  const hw = W.riverHalf(a.p[0]), mid = W.riverMid(a.p[0]), across = a.p[1] - mid, room = hw - 0.5 - reachZ;
  if (!a.to && Math.abs(across) > room) { const sd = Math.sign(across); a.p[1] = mid + sd * room; if (a.v[1] * sd > 0) a.v[1] *= -0.2; }
  // (and off the pier)
  const px = a.p[0] - JETTY.x, lim = JETTY.hw + 0.15 + reachX;
  if (Math.abs(px) < lim && a.p[1] > JETTY.z0 - reachZ - 0.2 && a.p[1] < JETTY.z1 + 0.5 && a.to?.kind !== 'jetty') { const sd = px >= 0 ? 1 : -1; a.p[0] = JETTY.x + sd * lim; if (a.v[0] * sd < 0) a.v[0] *= -0.2; }
  // (planted, and the boat gone so far past it that the hands would come off its end: lifted out)
  if (a.tip && Math.hypot(...(handsAt(time).map((v, i) => v - a.tip![i]) as V3)) > POLE_L - 0.5) release(a, true);
  // (its heading: where it's going through the water, as fast as it's going; drifting, swinging slowly as the current has it)
  const rx = a.v[0] - cx, rz = a.v[1] - cz, rl = Math.hypot(rx, rz);
  let want = rl > 0.1 ? Math.atan2(rx, rz) : Math.atan2(cx, cz);
  if (a.to) { const dd = Math.hypot(a.to.boat[0] - a.p[0], a.to.boat[2] - a.p[1]), e = sm(3, 0.5, dd); want = a.yaw + wrapA(a.to.yaw - a.yaw) * e + wrapA(Math.atan2(a.v[0], a.v[1]) - a.yaw) * (1 - e); }
  a.yaw += wrapA(want - a.yaw) * (1 - Math.exp(-dt * (a.to ? 1.1 : rl > 0.1 ? 0.25 + rl * 1.2 : 0.1)));
}
/** A tap while afloat: on a landing (or the water by it), there; on the water anywhere else, a stroke toward there. */
function tapAfloat(px: number, py: number) {
  if (!afloat || !lastVP) return;
  const iv = invert(lastVP), nx = (px / innerWidth) * 2 - 1, ny = 1 - (py / innerHeight) * 2;
  const P = (z: number): V3 => { const x = iv[0] * nx + iv[4] * ny + iv[8] * z + iv[12], y = iv[1] * nx + iv[5] * ny + iv[9] * z + iv[13], zz = iv[2] * nx + iv[6] * ny + iv[10] * z + iv[14], w = iv[3] * nx + iv[7] * ny + iv[11] * z + iv[15]; return [x / w, y / w, zz / w]; };
  const a = P(-1), b = P(1), t = (RIVER_L - a[1]) / (b[1] - a[1] || 1e-6), q = [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
  const hit = LANDS.find((l) => (l.kind === 'jetty' ? Math.abs(q[0] - JETTY.x) < 4.5 && q[1] > JETTY.z0 - 1.5 && q[1] < JETTY.z1 + 6 : Math.hypot(q[0] - l.at[0], q[1] - l.at[1]) < 4.5));
  markP = [q[0], RIVER_L + 0.02, q[1]]; markAt = performance.now();
  afloat.resting = false;
  // (to a landing: the stroke going is finished, and no more)
  if (hit) { afloat.to = hit; afloat.sTo = Math.min(afloat.sTo, nextRelease(afloat.s)); return; }
  queueStroke(afloat, q[0] - afloat.p[0], q[1] - afloat.p[1]);
}
/**
 * Ripples: marks on the water born of what happens there, and gone again: rings spreading where the
 * pole goes in, a smaller one where it comes out, and drops falling from it as it's swung forward; and
 * the boat's wake, crests off either side of its bow, made as it goes through the water (none as it
 * drifts with the current: it's not going through the water then). Each is carried off by the current,
 * spreads, thins and goes. (Drawn as the water's other marks are, a ribbon at a time; made afresh each frame.)
 */
interface Ripple { x: number; z: number; age: number; life: number; kind: 'ring' | 'drip' | 'crest'; dir: [number, number]; seed: number }
const ripples: Ripple[] = [];
let wakeD = 0, rippleSeed = 1, dripsLeft = 0, dripT = 0, lastBoat: V3 | null = null;
const ripplesD = R.mesh(new Float32Array(0));
function ripple(kind: Ripple['kind'], x: number, z: number, dir: [number, number] = [0, 1], life = kind === 'ring' ? 3.4 : kind === 'drip' ? 1.6 : 4.2) {
  if (ripples.length > 90) ripples.shift();
  ripples.push({ x, z, age: 0, life, kind, dir, seed: rippleSeed++ });
}
function ripplesOn(dt: number) {
  const W = ways.water, pose = boatPoseNow();
  // (the wake: by how far it's gone through the water since the last frame)
  if (lastBoat) {
    const [cx, cz] = W.riverFlow(pose.p[0], pose.p[2]), vx = (pose.p[0] - lastBoat[0]) / dt - cx, vz = (pose.p[2] - lastBoat[2]) / dt - cz, rl = Math.hypot(vx, vz);
    wakeD += rl * dt;
    if (rl > 0.12 && wakeD > 0.55) {
      wakeD = 0;
      const c = Math.cos(pose.yaw), sn = Math.sin(pose.yaw), bx = pose.p[0] + sn * 1.9, bz = pose.p[2] + c * 1.9;
      for (const sd of [-1, 1]) { const ox = c * sd, oz = -sn * sd; ripple('crest', bx + ox * 0.55, bz + oz * 0.55, [ox * 0.8 - sn * 0.6, oz * 0.8 - c * 0.6]); }
    }
  }
  lastBoat = pose.p;
  // (drops off the pole as it's swung forward)
  if (afloat && dripsLeft > 0 && (dripT += dt) > 0.22) { dripT = 0; dripsLeft--; const pl = poleNow(time); if (pl.tip[1] > RIVER_L) ripple('drip', pl.tip[0], pl.tip[2]); }
  for (const r of ripples) {
    r.age += dt;
    const [fx, fz] = W.riverFlow(r.x, r.z);
    r.x += fx * dt; r.z += fz * dt;
    if (r.kind === 'crest') { r.x += r.dir[0] * 0.22 * dt; r.z += r.dir[1] * 0.22 * dt; }
  }
  for (let i = ripples.length - 1; i >= 0; i--) if (ripples[i].age > ripples[i].life) ripples.splice(i, 1);
  const out: number[] = [], push = (v: number[]) => { for (const x of v) out.push(x); };
  for (const r of ripples) {
    const f = r.age / r.life, fade = (1 - f) * (1 - f), rr = seeded(r.seed), w = W.at(r.x, r.z);
    if (!w || w.s > -0.1) continue;
    const y = w.L + 0.026;
    if (r.kind !== 'crest') {
      // (rings, one and then another inside it, each broken into arcs; a drop's, one, small)
      const big = r.kind === 'ring' ? 1 : 0.32;
      for (let k = 0; k < (r.kind === 'ring' ? 2 : 1); k++) {
        const R0 = (0.18 + 1.1 * Math.pow(f, 0.55)) * (1 - 0.38 * k) * big;
        for (let a = rr() * 6.3, end = a + 6.283; a < end;) {
          const span = 0.6 + rr() * 1.4, pts: V3[] = [];
          for (let t = a; t <= Math.min(end, a + span); t += 0.16) pts.push([r.x + Math.cos(t) * R0, y, r.z + Math.sin(t) * R0 * 0.9]);
          ribbon(push, pts, (0.05 + 0.035 * (1 - f)) * (1 - 0.25 * k) * (0.6 + 0.4 * big), 4, Math.min(0.97, 0.9 * fade + 0.07), M.mark);
          a += span + 0.3 + rr() * 0.6;
        }
      }
    } else {
      // (a crest: an arc across its way, longer as it spreads)
      const L = 0.3 + 0.9 * Math.pow(f, 0.7), px = -r.dir[1], pz = r.dir[0], pts: V3[] = [];
      for (let t = -1; t <= 1.0001; t += 0.25) pts.push([r.x + px * t * L * 0.5 - r.dir[0] * 0.08 * t * t, y, r.z + pz * t * L * 0.5 - r.dir[1] * 0.08 * t * t]);
      ribbon(push, pts, 0.055 + 0.03 * (1 - f), 0, Math.min(0.95, 0.85 * fade + 0.07), M.mark);
    }
  }
  R.refill(ripplesD, new Float32Array(out));
}
/** Whether a tap on the screen is on (or by) the boat. */
function onBoat(px: number, py: number): boolean {
  const pose = boatPoseNow(), q = project([pose.p[0], pose.p[1] + 0.4, pose.p[2]]);
  return q[2] > 0 && Math.hypot(q[0] - px, q[1] - py) < 64;
}

// ─── the paper surfaces: what the painting tells them (surfaces.ts) ─────────────────────────────────
const KIND_EN: Record<string, string> = { gate: 'Temple gate', hall: 'Temple hall', pavilion: 'Pavilion', pagoda: 'Pagoda', shrine: 'Shrine' };
attach({
  here: () => {
    let best: { d: number; name: number } | null = null;
    for (const t of templesNear(ways, posNow[2] - 80, posNow[2] + 160)) { const d = Math.hypot(t.c[0] - posNow[0], t.c[2] - posNow[2]); if (!best || d < best.d) best = { d, name: t.name }; }
    return best ? NAMES[best.name % NAMES.length] : 'This place';
  },
  nearby: () => {
    const out: Place[] = [], [px, , pz] = posNow, free = () => intro < 0 && !hop && !afloat;
    const dist = (x: number, z: number) => Math.hypot(x - px, z - pz);
    for (const t of templesNear(ways, pz - 60, pz + 220)) {
      const n = ways.nearest(t.c[0], t.c[2]);
      out.push({ kind: 'temple', title: KIND_EN[t.kind] ?? 'Temple', han: NAMES[t.name % NAMES.length], sub: t.c[2] > pz ? 'Up the hill' : 'Down the hill', dist: dist(t.c[0], t.c[2]), go: () => { if (free()) goTo({ w: n.w, u: n.u }); } });
    }
    for (const st of stationsNear(ways, seed, pz - 60, pz + 220)) {
      const h = identify(st.lines);
      out.push({ kind: 'station', title: h.title, han: h.han, sub: 'A cast on the hill: read it', dist: dist(st.c[0], st.c[2]), lines: st.lines, read: { kind: 'station', seed, station: st.i, lines: st.lines } });
    }
    for (const l of LANDS) {
      const title = l.kind === 'jetty' ? 'The jetty' : l.kind === 'stone' ? 'Stone landing' : 'Reed bank', sub = l.kind === 'jetty' ? 'Where the journey began' : l.kind === 'stone' ? 'Under a lone tree, down the river' : 'Up the river; by boat only';
      out.push({ kind: 'landing', title, sub, dist: dist(l.at[0], l.at[1]), go: l.kind === 'reeds' ? undefined : () => { if (!free()) return; if (l.kind === 'stone' && l.join) goTo({ w: l.join.w, u: l.join.u }); else goTo({ w: ways.first(), u: 0 }); } });
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, 12);
  },
  ink: () => ink,
  setInk: (on) => setInk(on),
  benches: () => BENCHES,
});
document.getElementById('book')?.addEventListener('click', () => present({ surface: 'side', encounter: { kind: 'atlas', tab: 'nearby' } }));

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
interface Live { band: Band; solid: Drawn; puffs: Drawn; petals: Drawn; cover: Map<number, number[]> }
const live = new Map<string, Live>();
/** Keep the tiles about where the eye looks made, and drop those it's left: across the hill as far as the view reaches, up it ahead and a little behind. */
function keepBands(x: number, z: number) {
  const aspect = canvas.width / Math.max(1, canvas.height);
  const wide = ink || inkT > 0.001, zi = wide ? zoomI : 1;
  const half = (aspect < 1 ? 22 : 46) * (wide ? 1.8 * zi : 1);
  const lo = Math.floor((z - (wide ? 40 * zi * zi : 24)) / BAND), hi = Math.floor((z + (wide ? 130 * zi : 70)) / BAND);
  const il = Math.floor((x - half) / TILE), ih = Math.floor((x + half) / TILE);
  for (const [key, l] of live) if (l.band.j < lo - 1 || l.band.j > hi + 1 || l.band.i < il - 1 || l.band.i > ih + 1) { R.drop(l.solid); R.drop(l.puffs); R.drop(l.petals); live.delete(key); }
  // (one tile a frame, nearest the walker first, so a climb never stutters; two, while the
  // composition view stands far off, so its wider view fills in)
  for (let n = 0; n < (wide && zi > 1.2 ? 2 : 1); n++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let j = lo; j <= hi; j++) for (let i = il; i <= ih; i++) {
      if (live.has(`${i},${j}`)) continue;
      const d = Math.hypot((i + 0.5) * TILE - x, ((j + 0.5) * BAND - z) * (j * BAND < z - 6 ? 2 : 1));
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) add(best[0], best[1]); else break;
  }
}
function add(i: number, j: number) {
  const band = makeBand(ways, seed, i, j);
  const pet = new Float32Array((band.petals.length / 6) * 7);
  for (let k = 0; k < band.petals.length / 6; k++) { pet.set(band.petals.subarray(k * 6, k * 6 + 6), k * 7); pet[k * 7 + 6] = 0; }
  live.set(`${i},${j}`, { band, solid: R.mesh(band.verts), puffs: R.instances('puff', band.puffs), petals: R.instances('petal', pet), cover: coverOf(band) });
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
  // (off the ways, on the open hill: there, and the way nearest it to go back to)
  const offAt = /^@(-?[\d.]+),(-?[\d.]+)$/.exec(at);
  if (offAt) { const x = Number(offAt[1]), z = Number(offAt[2]), n = ways.nearest(x, z); off = [x, z]; return { w: n.w, u: n.u }; }
  const [id, u] = at.split(':');
  const w = id ? ways.byId(id) : null;
  if (w) return { w, u: Math.max(0, Math.min(w.len, Number(u) || 0)) };
  // (else on the jetty, by the boat, at the foot of the hill across the river)
  const [jx, jz] = ARRIVE_ON, n = ways.nearest(jx, jz);
  off = [jx, jz];
  // (`?intro=t`: the arrival, t seconds in: held there, in a review)
  if (params.has('intro')) intro = Math.max(0, Number(params.get('intro')) || 0);
  else if (!review && !preview && !params.has('bench')) intro = 0;
  return { w: n.w, u: n.u };
}
/**
 * Off the ways: where the walker stands on the open hill (null while they're on a way); the way
 * they're taking across it (points still to come); and where they'll join a way at its end, to go on by
 * the ways to `goal`.
 */
let off: P2 | null = null, trail: P2[] = [], join: Spot | null = null, offDir: [number, number] = [0, 1];
let here: Spot = startSpot();
let speed = 0, want = 0, phase = 0, stride = 0, facing = NaN, backward = false;
/** the walker's pace (m/s); `?pace=…` times it, for trying things out quickly */
const PACE = Math.max(0.1, Math.min(40, Number(params.get('pace')) || 1)), WALK = 1.25 * PACE;
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
  // (where the tap falls on the ground: a way there must be about under it, not one projected wildly from just before the eye)
  const h = onHill(px, py);
  for (const sp of spots(0.2)) {
    const at = ways.at(sp.w, sp.u), q = project(at.p);
    if (q[2] <= 2 || q[0] < -40 || q[1] < -40 || q[0] > innerWidth + 40 || q[1] > innerHeight + 40) continue;
    if (h && Math.hypot(at.p[0] - h[0], at.p[2] - h[2]) > WIDTH * 1.5) continue;
    // (how wide the way is there, on the glass)
    const e = project([at.p[0] + at.dir[1] * WIDTH * 0.5, at.p[1], at.p[2] - at.dir[0] * WIDTH * 0.5]);
    const half = Math.min(60, Math.max(12, Math.hypot(e[0] - q[0], e[1] - q[1]) * 1.15));
    const k = Math.hypot(px - q[0], py - q[1]) / half;
    if (k < bestK) { bestK = k; best = sp; }
  }
  return best;
}
/**
 * Where on the hill a point on the screen (CSS pixels) lies: down through whatever stands over it
 * (blossom, a tree, a roof), as if it weren't there, to the ground under it.
 */
function onHill(px: number, py: number): V3 | null {
  if (!lastVP) return null;
  const iv = invert(lastVP), nx = (px / innerWidth) * 2 - 1, ny = 1 - (py / innerHeight) * 2;
  const P = (z: number): V3 => { const x = iv[0] * nx + iv[4] * ny + iv[8] * z + iv[12], y = iv[1] * nx + iv[5] * ny + iv[9] * z + iv[13], zz = iv[2] * nx + iv[6] * ny + iv[10] * z + iv[14], w = iv[3] * nx + iv[7] * ny + iv[11] * z + iv[15]; return [x / w, y / w, zz / w]; };
  const a = P(-1), b = P(1), d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(d[0], d[1], d[2]);
  const at = (t: number): V3 => [a[0] + (d[0] * t) / L, a[1] + (d[1] * t) / L, a[2] + (d[2] * t) / L];
  const under = (t: number) => { const q = at(t); return q[1] < ground(ways, q[0], q[2]); };
  // (along the line of sight, a step at a time, to where it first goes under the ground; then closer)
  let t0 = 0;
  for (let t = 0.5; t < Math.min(L, 400); t += 0.5) {
    if (!under(t)) { t0 = t; continue; }
    let lo = t0, hi = t;
    for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (under(m)) hi = m; else lo = m; }
    return at(hi);
  }
  return null;
}
/**
 * Where on a way is nearest a point on the screen that isn't on one (the hillside, a temple, a
 * tree, blossom): the place on the hill under the finger, and the way nearest it there, seen or not.
 */
function nearestTo(px: number, py: number): Spot | null {
  const h = onHill(px, py);
  if (!h) return null;
  const n = ways.nearest(h[0], h[2]);
  return { w: n.w, u: n.u };
}
// ─── the open hill: where the walker may go off the ways ─────────────────────────────────────────
/** whether (x, z) is on a way, where the walker may always go */
const onWay = (x: number, z: number) => ways.nearest(x, z).d < WIDTH / 2 - 0.1;
/**
 * Whether the ground at (x, z) is open, for the walker to stand on off the ways: not under a crown,
 * nor on a rock, a temple's terrace or by its walls, a cast's sheet, its cairn or its shrine; not in
 * water, nor on a bank cut steep for it. (What the tiles about it hold: those made.)
 */
function isOpen(x: number, z: number): boolean {
  // (the jetty's deck is open, over the water)
  if (onJetty(x, z)) return true;
  if (ways.dryOf(x, z) < 0.4 || groundCut(ways, x, z).cut > 0.3) return false;
  for (const t of templesNear(ways, z - 20, z + 20)) {
    const dx = x - t.c[0], dz = z - t.c[2], ax = Math.abs(dx * -t.face[1] + dz * t.face[0]), az = dx * t.face[0] + dz * t.face[1];
    if ((ax < t.tw + 1 && az < t.T + 1.2 + (t.front.n + 1) * TSTEP && az > -t.T - 1.2 - (t.back ? (t.back.n + 1) * TSTEP : 0)) || (t.gate && ax < t.tw + 6.8 && Math.abs(az + 0.3) < 1.3)) return false;
  }
  const i = Math.floor(x / TILE), j = Math.floor(z / BAND), key = coverKey(x, z);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    const l = live.get(`${i + di},${j + dj}`);
    const c = l?.cover.get(key);
    if (c) for (let n = 0; n < c.length; n += 3) if (Math.hypot(x - c[n], z - c[n + 1]) < c[n + 2]) return false;
  }
  return true;
}
/** (the cover's buckets: 2 m across) */
const coverKey = (x: number, z: number) => Math.floor(x / 2) * 100003 + Math.floor(z / 2);
/** What in a tile covers the ground against the walker, bucketed: its crowns (each clump's footprint, and a little more), and what stands in the way. */
function coverOf(band: Band): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const put = (x: number, z: number, r: number) => {
    for (let bx = Math.floor((x - r) / 2); bx <= Math.floor((x + r) / 2); bx++) for (let bz = Math.floor((z - r) / 2); bz <= Math.floor((z + r) / 2); bz++) {
      const k = bx * 100003 + bz;
      (m.get(k) ?? m.set(k, []).get(k)!).push(x, z, r);
    }
  };
  const P = band.puffs;
  for (let n = 0; n < P.length; n += 6) put(P[n], P[n + 2], P[n + 3] * 0.9 + 0.3);
  const B = band.blocks;
  for (let n = 0; n < B.length; n += 3) put(B[n], B[n + 1], B[n + 2]);
  return m;
}
/** where a tap's answer is marked, for a moment */
let markP: V3 | null = null;
/** where the walker is now (for planning from) */
let posNow: V3 = [0, 0, 0];
/**
 * Off the ways, to a place on the open hill (within fifteen metres of a way): a way there across the
 * open ground, from wherever they are; if there's none, false.
 */
function roamTo(h: V3): boolean {
  boardWhenThere = false; boardVia = null;
  if (ways.nearest(h[0], h[2]).d > 15 || !isOpen(h[0], h[2])) return false;
  const from: P2 = off ?? [posNow[0], posNow[2]];
  const route = plan(from, [h[0], h[2]], isOpen, onWay);
  if (!route) return false;
  off = from; trail = route.slice(1); join = null; goal = null; legs = [];
  markP = [h[0], ground(ways, h[0], h[2]), h[2]]; markAt = performance.now();
  return true;
}
/** Go there: the route, through the junctions, from where they are. */
function goTo(sp: Spot) {
  boardWhenThere = false; boardVia = null;
  goal = sp; markAt = performance.now(); markP = spotP(sp);
  if (off) {
    // (off the ways: back across the open ground to the nearest, then on by the ways)
    const n = ways.nearest(off[0], off[1]);
    join = { w: n.w, u: n.u };
    trail = plan(off, [n.p[0], n.p[2]], isOpen, onWay)?.slice(1) ?? [[n.p[0], n.p[2]]];
    legs = [];
    return;
  }
  legs = ways.route(here.w, here.u, sp.w, sp.u);
}
// (a press is only a tap if it lets go where it began, soon: then the walker goes there; any drag looks about, wherever it began)
// (two fingers: a pinch, nearer or further; it's never a tap, nor a look about)
const touches = new Map<number, [number, number]>();
let pinch0 = 0;
const spread = () => { const p = [...touches.values()]; return p.length < 2 ? 0 : Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]); };
// (Safari's own pinch, which would zoom the page: not here)
for (const g of ['gesturestart', 'gesturechange']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false } as AddEventListenerOptions);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
canvas.addEventListener('pointerdown', (e) => {
  // (a tap while arriving: there at once)
  if (intro >= 0) { intro = -1; return; }
  touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size >= 2) { pinch0 = spread(); downAt = null; looking = false; return; }
  canvas.setPointerCapture(e.pointerId);
  downAt = { x: e.clientX, y: e.clientY, id: e.pointerId, on: false, t: e.timeStamp };
  looking = false;
  $('hint').classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, [e.clientX, e.clientY]);
  if (touches.size >= 2) { const d = spread(); if (pinch0 > 0 && d > 0) zoomBy(pinch0 / d); pinch0 = d; return; }
  if (!downAt || downAt.id !== e.pointerId) return;
  const dx = e.clientX - downAt.x, dy = e.clientY - downAt.y;
  if (!looking && Math.hypot(dx, dy) > 10) looking = true;
  if (looking) {
    lookYaw = Math.max(-0.7, Math.min(0.7, lookYaw - (e.movementX || 0) * 0.005 * (1 - 0.5 * firstT)));
    lookPitch = Math.max(-0.25, Math.min(0.3, lookPitch + (e.movementY || 0) * 0.003));
    lookAt0 = performance.now();
  }
});
/** Which station's cast a tap falls on, if it falls on one's words: the words are drawn there, so the one whose sheet is nearest where they are. */
function castTapped(px: number, py: number) {
  if (R.matAt(px * (canvas.width / innerWidth), py * (canvas.height / innerHeight)) !== M.type) return null;
  let best = null as ReturnType<typeof stationsNear>[number] | null, bd = 160;
  for (const st of stationsNear(ways, seed, posNow[2] - 40, posNow[2] + 120)) {
    const az = st.c[2] + st.rz * 0.25, q = project([st.c[0], ground(ways, st.c[0], az) + 1.8, az]);
    const d = Math.hypot(q[0] - px, q[1] - py);
    if (q[2] > 0 && d < bd) { bd = d; best = st; }
  }
  return best;
}
const up = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) pinch0 = 0;
  if (downAt?.id !== e.pointerId) return;
  // (a tap: on a way, there; on open ground near one, there; anywhere else, the nearest place on a way to where it falls on the hill)
  const tapped = !looking && e.type === 'pointerup' && e.timeStamp - downAt.t < 600;
  const reading = tapped && !hop && !afloat ? castTapped(e.clientX, e.clientY) : null;
  if (reading) {
    // (a tap on a cast's words: its page, to read it; the walker stays where they are)
    present({ surface: 'page', encounter: { kind: 'station', seed, station: reading.i, lines: reading.lines } });
  } else if (tapped && (hop || afloat)) {
    // (afloat, a tap's for the boat: see tapAfloat; stepping in or out, it waits)
    if (afloat) tapAfloat(e.clientX, e.clientY);
  } else if (tapped && onBoat(e.clientX, e.clientY) && moored.by && Math.hypot(posNow[0] - moored.by[0], posNow[2] - moored.by[2]) < 40) {
    // (a tap on the boat: to beside it, if not there, and in: at the jetty across its deck; at the stone
    // landing, by the ways to where its stones go down, and down them)
    const by = moored.by;
    if (off && Math.hypot(off[0] - by[0], off[1] - by[2]) < 1.2) board();
    else if (moored.kind === 'jetty') { if (roamTo(by)) boardWhenThere = true; }
    else if (moored.join) {
      const top = moored.trail[moored.trail.length - 1];
      if (off && Math.hypot(off[0] - top[0], off[1] - top[1]) < 3) { trail = [...moored.trail].reverse().slice(1).map((q) => [q[0], q[1]] as P2); join = null; boardWhenThere = true; }
      else { goTo({ w: moored.join.w, u: moored.join.u }); boardVia = moored; }
    }
  } else if (tapped) {
    // (on a way, there; on open ground near one, there, across it; else the nearest way to where it falls)
    const at = pick(e.clientX, e.clientY);
    if (at !== null) goTo(at);
    else {
      // (off the ways only to open ground that's seen: where the tap falls on the ground itself, not on blossom over it)
      const seenGround = OPEN.has(R.matAt(e.clientX * (canvas.width / innerWidth), e.clientY * (canvas.height / innerHeight)));
      const h = onHill(e.clientX, e.clientY);
      if (!h || !seenGround || !roamTo(h)) { const n = nearestTo(e.clientX, e.clientY); if (n) goTo(n); }
    }
  }
  downAt = null; looking = false;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  // (while a sheet's open, the keys are its)
  if (sheetOpen()) return;
  if (e.key.toLowerCase() === 'c') { setInk(!ink); return; }
  // (arriving, stepping in or out, or afloat, the keys don't walk: the walker's in the boat)
  if (intro >= 0 || hop || afloat) return;
  boardWhenThere = false; boardVia = null;
  keys.add(e.key.toLowerCase()); goal = null; legs = []; $('hint').classList.remove('on');
  if (off && !join && ['arrowup', 'arrowdown', 'w', 's'].includes(e.key.toLowerCase())) { const n = ways.nearest(off[0], off[1]); join = { w: n.w, u: n.u }; trail = plan(off, [n.p[0], n.p[2]], isOpen, onWay)?.slice(1) ?? [[n.p[0], n.p[2]]]; }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { keys.clear(); });

// ─── the camera: high, looking up the hill, the walker low in the frame ──────────────────────────
const cam = { t: [0, 0, 0] as V3, x: 0 };
let camInit = false;
/** how far into seeing through the walker's eyes (0: not at all; 1: there) */
let firstT = 0;
const norm3 = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
function camera(p: V3, dt: number) {
  const k = 1 - Math.exp(-dt * 2.2);
  // (looking a little ahead up the hill; nearer, as the camera comes nearer, so the walker keeps their place in the print)
  const low = (1 - ease(inkT)) * smoothstep(0.4, 0.1, zoomN);
  const ahead = 7 * Math.max(0.4, zoomN + (1 - zoomN) * ease(inkT));
  const target: V3 = [p[0], p[1] + 1.2, p[2] + ahead];
  if (!camInit) { cam.t = [...target]; cam.x = p[0]; camInit = true; }
  for (let i = 0; i < 3; i++) cam.t[i] += (target[i] - cam.t[i]) * k;
  // (it swings across slowly as the path zigzags)
  cam.x += (p[0] - cam.x) * (1 - Math.exp(-dt * (1.2 + 4 * low)));
  // (looked about by hand, it comes back after a while)
  if (!looking && performance.now() - lookAt0 > 2500) { lookYaw *= Math.exp(-dt * 1.2); lookPitch *= Math.exp(-dt * 1.2); }
  const aspect = canvas.width / canvas.height;
  // (the composition view stands further off: the camera eases back as it comes in, and in again as it goes)
  const zk = ease(inkT), zoom = zoomN + (zoomI - zoomN) * zk;
  const dist = ((aspect < 1 ? 56 : 44) + (preview ? 6 : 0)) * (1 + 0.8 * zk) * Math.max(0.4, zoom);
  const pitch = 0.76 + lookPitch, yaw = lookYaw;
  const t: V3 = [cam.x + (cam.t[0] - p[0]) * 0, cam.t[1], cam.t[2]];
  t[0] = cam.x;
  const eye: V3 = [t[0] - Math.sin(yaw) * Math.cos(pitch) * dist, t[1] + Math.sin(pitch) * dist, t[2] - Math.cos(yaw) * Math.cos(pitch) * dist];
  if (low > 0) {
    // nearest of all, through their eyes. The view lifts first, from looking down on the hill to
    // looking out along their way, while the camera's still high behind them, so they drop out of the
    // bottom of the shot; only then does it come down and in, to just where their eyes are.
    const q = posNow, f = facing;
    const fy = f + lookYaw * 1.8, fp = 0.05 + lookPitch * 1.2;
    const eyeAt: V3 = [q[0] + Math.sin(f) * 0.12, q[1] + 1.55, q[2] + Math.cos(f) * 0.12];
    // (the way there: first in to a place some five metres behind them and well over their head,
    // looking out over them, so they're below the shot; then down, and in, to their eyes)
    const above: V3 = [q[0] - Math.sin(f) * 5, q[1] + 4.5, q[2] - Math.cos(f) * 5];
    const look: V3 = [Math.sin(fy) * Math.cos(fp), Math.sin(fp), Math.cos(fy) * Math.cos(fp)];
    const d0 = norm3([t[0] - eye[0], t[1] - eye[1], t[2] - eye[2]]);
    const a1 = ease(Math.min(1, low / 0.55)), a2 = ease(Math.max(0, (low - 0.55) / 0.45));
    const turn = smoothstep(0.1, 0.5, low);
    const d = norm3([d0[0] + (look[0] - d0[0]) * turn, d0[1] + (look[1] - d0[1]) * turn, d0[2] + (look[2] - d0[2]) * turn]);
    for (let i = 0; i < 3; i++) eye[i] = eye[i] + (above[i] - eye[i]) * a1 + (eyeAt[i] - above[i]) * a2;
    for (let i = 0; i < 3; i++) t[i] = eye[i] + d[i] * 10;
  }
  firstT = low;
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
  // (the stations: their hexagrams drawn small in their middles)
  for (const st of stationsNear(ways, seed, pos[2] - 30, pos[2] + 140)) {
    const q = project(st.c);
    st.lines.forEach((v, k) => {
      const y = q[1] + 15 - k * 6;
      g.fillStyle = moving(v) ? '#b8382c' : '#2a2420';
      if (v % 2) g.fillRect(q[0] - 12, y - 2, 24, 4); else { g.fillRect(q[0] - 12, y - 2, 10, 4); g.fillRect(q[0] + 2, y - 2, 10, 4); }
    });
  }
  const w = project([pos[0], pos[1] + 0.8, pos[2]]);
  g.fillStyle = '#b8382c';
  g.beginPath(); g.arc(w[0], w[1], 5, 0, Math.PI * 2); g.fill();
}

// ─── the frame ───────────────────────────────────────────────────────────────────────────────────
let last = performance.now(), time = 0, idleLook = 0, urlAt = '', urlT = -1e9;
function frame(now: number) {
  // (under the page, the painting's set aside: not drawn, nor moving on)
  if (covers()) { last = now; requestAnimationFrame(frame); return; }
  const dt = review ? 0 : Math.max(0, Math.min(0.05, (now - last) / 1000));
  { const to = ink ? 1 : 0, step = review ? 1 : Math.min(0.12, Math.max(0, (now - last) / 1000)) / 0.6; inkT = to > inkT ? Math.min(to, inkT + step) : Math.max(to, inkT - step); }
  last = now; time += dt;
  const dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const W = Math.round(innerWidth * dpr), H = Math.round(innerHeight * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  if (off) {
    // off the ways: along their way across the open ground, a little more carefully; at its end, if
    // it joins a way, on by the ways
    const rem = trail.reduce((acc, t, k) => acc + Math.hypot(t[0] - (k ? trail[k - 1][0] : off![0]), t[1] - (k ? trail[k - 1][1] : off![1])), 0);
    want = trail.length ? Math.min(1, rem * 1.4 + 0.15) : 0;
    speed = Math.max(0, speed + (want - speed) * (1 - Math.exp(-dt * 4)));
    let move = speed * WALK * 0.85 * dt * (1 + 0.14 * Math.sin(phase * 2 - 0.8) * stride);
    while (move > 1e-6 && trail.length) {
      const t = trail[0], o: P2 = off, dx: number = t[0] - o[0], dz: number = t[1] - o[1], d = Math.hypot(dx, dz);
      if (d > 1e-4) offDir = [dx / d, dz / d];
      if (d <= move) { off = [t[0], t[1]]; move -= d; trail.shift(); } else { off = [o[0] + (dx / d) * move, o[1] + (dz / d) * move]; move = 0; }
    }
    if (!trail.length && join) {
      here = join; join = null; off = null;
      legs = goal ? ways.route(here.w, here.u, goal.w, goal.u) : [];
      if (!legs.length) { goal = null; speed = 0; } else speed = Math.abs(speed) * Math.sign(legs[0].u1 - legs[0].u0 || 1);
    }
  } else {
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
  }
  phase += Math.abs(speed) * WALK * dt * 4.4;
  stride += ((Math.abs(speed) > 0.05 ? 1 : 0) - stride) * (1 - Math.exp(-dt * 5));
  const z0 = off ? off[1] : ways.at(here.w, here.u, true).p[2];
  nearTemples = templesNear(ways, z0 - 20, z0 + 20);
  // (off the ways, on the ground there; where they cross a way, on its tread or stone)
  let st = off ? (() => { const n = ways.nearest(off![0], off![1]); const y = onJetty(off![0], off![1]) ? JETTY.y : n.d < WIDTH / 2 ? ways.surface(n.w, n.u, off![1]) : ground(ways, off![0], off![1]) - 0.03; return { p: [off![0], y, off![1]] as V3, dir: offDir }; })() : stand(here);
  if (intro >= 0) {
    // (arriving: aboard as the boat comes in, then stepping off onto the jetty)
    intro += dt * PACE;
    st = introStand(intro, time);
    if (intro > ARRIVE.T + STEP) intro = -1;
  } else if (hop) {
    // (stepping into the boat, or out of it)
    hop.t += dt * PACE;
    const f = Math.min(1, hop.t / hop.dur), e = f * f * (3 - 2 * f), a = hop.from(), b = hop.to();
    st = { p: [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e + 0.12 * Math.sin(Math.PI * f), a[2] + (b[2] - a[2]) * e], dir: hop.dir };
    if (f >= 1) { const h = hop; hop = null; h.done(); }
  } else if (afloat) {
    // (afloat: standing at the stern with the pole; resting in the reeds, sitting)
    sail(dt * PACE);
    if (afloat) st = { p: apply(boatAt(time), afloat.resting ? SEAT : POLER), dir: [Math.sin(afloat.yaw), Math.cos(afloat.yaw)] };
  } else if (boardWhenThere && off && !trail.length && !join) {
    // (come to beside the boat: in)
    boardWhenThere = false;
    if (moored.by && Math.hypot(off[0] - moored.by[0], off[1] - moored.by[2]) < 1.3) board();
  } else if (boardVia && !off && !legs.length && !goal) {
    // (come down the ways to where the stones go down to the landing: down them, and in)
    const l = boardVia; boardVia = null;
    off = [posNow[0], posNow[2]]; offDir = [0, -1];
    trail = [...l.trail].reverse().slice(1).map((q) => [q[0], q[1]] as P2); join = null; boardWhenThere = true;
  }
  if (Number.isNaN(facing)) facing = Math.atan2(st.dir[0], st.dir[1]);
  const bob = 0.03 * Math.abs(Math.sin(phase)) * stride;
  const pos: V3 = [st.p[0], st.p[1] + bob, st.p[2]];
  posNow = pos;
  // (they turn to face their way, not at once)
  // (facing down the way while they go down it, and still so once they stop: they turn only when they set off again)
  if (Math.abs(speed) > 0.05) backward = !off && speed < 0;
  if (off) backward = false;
  const want_yaw = Math.atan2(st.dir[0], st.dir[1]) + (backward ? Math.PI : 0);
  facing += Math.atan2(Math.sin(want_yaw - facing), Math.cos(want_yaw - facing)) * (1 - Math.exp(-dt * 5));
  const yaw = facing;
  keepBands(cam.x || pos[0], pos[2]);
  keepHerds(pos[2]);

  // (passing a temple beside the path, the view leans toward it, so it's in the print with the walker)
  let lean = 0;
  for (let k = 0, near = 0; k < nearTemples.length; k++) {
    const tp = nearTemples[k];
    if (tp.gate) continue;
    const d = Math.hypot(tp.c[0] - pos[0], tp.c[2] - pos[2]), n = 1 - smoothstep(9, 16, d);
    if (n > near) { near = n; lean = (tp.c[0] - pos[0]) * 0.45 * n; }
  }
  const { eye, t } = camera([pos[0] + lean, pos[1], pos[2]], dt);
  const aspect = W / H;
  const near = 1 - 0.85 * firstT, far = (160 + 100 * ease(inkT)) * Math.max(1, zoomI * ease(inkT));
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
  // (in the boat: poling, standing at its stern, leaning into each push and up again; or sitting)
  const poling = !!afloat && !afloat.resting && !hop, seated = intro >= 0 && intro < ARRIVE.T || !!afloat?.resting;
  const poleLean = poling ? 0.32 * pushing() + 0.06 : 0;
  const ground_: M4 = new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1] - bob, pos[2], 1]);
  // (the body: a sway from foot to foot, a lean into the climb, a little twist with each step; still, it breathes)
  const sw = Math.sin(phase) * stride;
  const climbing = off ? 0 : Math.max(0, Math.min(1, (st.p[1] - stand({ w: here.w, u: Math.max(0, here.u - 0.5 * Math.sign(speed || 1)) }).p[1]) * 4 * Math.sign(speed || 1)));
  const model: M4 = mulM(new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, pos[0], pos[1], pos[2], 1]),
    mulM(Ry(0.06 * sw), mulM(Rz(0.045 * sw), mulM(Rx(0.05 * stride + 0.06 * climbing * stride + poleLean), Tm(0, 0.006 * Math.sin(time * 1.7) * (1 - stride), 0)))));
  // (the head: turned back a little against the body's twist as they walk; standing, it looks about, now one way, now another)
  idleLook += ((1 - stride) * (0.5 * Math.sin(time * 0.31) + 0.35 * Math.sin(time * 0.53 + 1.3)) - idleLook) * (1 - Math.exp(-dt * 1.5));
  const headAt = mulM(model, about(NECK, mulM(Ry(-0.05 * sw + idleLook), Rx(0.03 * Math.sin(phase * 2) * stride))));
  // (the free arm swings against the step)
  const armAt = mulM(model, about(SHOULDER, poling ? mulM(Rz(-0.35), Rx(-0.95 - 0.5 * pushing())) : Rx(-0.4 * sw)));
  // (each step a foot forward, the other back; the staff swung forward with one, planted, and the walker passing it)
  const shoeAt = (k: number) => mulM(ground_, Tm(0, Math.max(0, Math.cos(phase) * (k ? 1 : -1)) * 0.05 * stride, (k ? 1 : -1) * sw * 0.15));
  const staffAt = mulM(model, about(HAND, Rx(-0.42 * Math.sin(phase + 0.6) * stride)));
  const bands = [...live.values()];
  lastVP = vp;
  // (the masses, and the ways brushed over them, come in as the camera finishes stepping back, and go first on the way in)
  const massT = ease(Math.max(0, Math.min(1, (inkT - 0.4) / 0.6)));
  brush.style.display = massT > 0.005 ? 'block' : 'none';
  brush.style.opacity = massT.toFixed(3);
  if (massT > 0.005) brushPath(pos);
  placeTitle(pos);
  // (the mark where they're going: a ring of vermilion on its place on the path, for a moment, as the tap is answered)
  const mark = $('mark'), ma = (performance.now() - markAt) / 1000;
  if (markP !== null && ma < 1.1) {
    const q = project(markP);
    mark.style.transform = `translate(${q[0].toFixed(1)}px, ${q[1].toFixed(1)}px) scale(${(0.8 + 0.35 * Math.min(1, ma * 4)).toFixed(3)})`;
    mark.style.opacity = `${(0.95 * (1 - smoothstep(0.45, 1.1, ma))).toFixed(3)}`;
  } else mark.style.opacity = '0';
  R.frame({ vp, ivp: invert(vp), eye, right: v.right, up: v.up, fwd: v.fwd, near, far, dpr, ink: massT, time: review ? 0 : performance.now() / 1000, marks: params.has('marks'), oldRefl, oldShade },
    [...bands.map((l) => ({ d: l.solid })), ...(firstT > 0.6 ? [] : [{ d: body, model }, { d: head, model: headAt }, { d: freeArm, model: armAt }, ...(intro >= 0 || afloat || hop ? [] : [{ d: shadow, model: Tm(pos[0], pos[1] - bob, pos[2]) }]), { d: shoes[0], model: shoeAt(0) }, { d: shoes[1], model: shoeAt(1) }, ...(poling || seated ? [] : [{ d: staff, model: staffAt }])]), ...liveDeer(review ? 1 / 30 : dt, time, pos), ...boatDraw(dt, review ? 0 : time)],
    bands.map((l) => l.puffs), [...bands.map((l) => l.petals), fallDrawn]);

  // (the address keeps where they are: the seed, and how far along the path, so a reload, or the
  // link, comes back to the same place; written a couple of times a second at most, as they move)
  const atNow = off ? `@${off[0].toFixed(1)},${off[1].toFixed(1)}` : `${here.w.id}:${here.u.toFixed(1)}`;
  if (!preview && !review && atNow !== urlAt && now - urlT > 400) {
    urlAt = atNow; urlT = now;
    const u = new URL(location.href);
    u.searchParams.set('seed', seedName(seed)); u.searchParams.set('at', atNow);
    history.replaceState(null, '', u);
  }

  // what it reports of itself, for the checks
  (window as unknown as { __taohua: unknown }).__taohua = { pass: PASS, review, seed, intro: () => intro, sheet: (surface: 'side' | 'drawer', tab = 'nearby') => present(surface === 'side' ? { surface, encounter: { kind: 'atlas', tab: tab as 'nearby' } } : { surface, encounter: { kind: 'cast' } }), read: () => { const st = stationsNear(ways, seed, posNow[2] - 40, posNow[2] + 200)[0]; if (st) present({ surface: 'page', encounter: { kind: 'station', seed, station: st.i, lines: st.lines } }); return st?.i ?? null; }, boatLog: () => boatLog, pole: () => { if (!afloat) return null; const q = poleNow(time); return [q.top.map((v) => +v.toFixed(2)), q.tip.map((v) => +v.toFixed(2)), handsAt(time).map((v) => +v.toFixed(2))]; }, landTo: (k: string) => { const l = LANDS.find((q) => q.kind === k); if (afloat && l) { afloat.to = l; afloat.resting = false; afloat.sTo = Math.min(afloat.sTo, nextRelease(afloat.s)); } }, strokeAt: (x: number, z: number) => { if (afloat) queueStroke(afloat, x - afloat.p[0], z - afloat.p[1]); }, arriveT: ARRIVE.T, scr: (x: number, y: number, z: number) => project([x, y, z]).map((v) => Math.round(v)), boat: () => { const p = boatPoseNow(); return { afloat: afloat && { p: afloat.p.map((v) => +v.toFixed(2)), v: afloat.v.map((v) => +v.toFixed(2)), to: afloat.to?.kind ?? null, resting: afloat.resting, s: +afloat.s.toFixed(2), tip: !!afloat.tip, sTo: +afloat.sTo.toFixed(3) }, moored: moored.kind, lands: LANDS.map((l) => ({ kind: l.kind, at: l.at.map((v) => +v.toFixed(1)), scr: project([l.at[0], RIVER_L, l.at[1]]).map((v) => Math.round(v)) })), hop: !!hop, p: p.p.map((v) => +v.toFixed(2)), scr: project([p.p[0], p.p[1] + 0.4, p.p[2]]).map((v) => Math.round(v)), ripples: ripples.length, rverts: ripplesD.count }; }, at: atNow, goal: goal ? `${goal.w.id}:${goal.u.toFixed(1)}` : null, legs: legs.length, pos, steps: Math.round(pos[1] / RISE), bands: live.size, puffs: bands.reduce((a, l) => a + l.puffs.count, 0), deer: () => [...herds.values()].flat().map((d) => ({ kind: d.kind, mode: d.mode, x: +d.x.toFixed(1), z: +d.z.toFixed(1), s: project([d.x, ground(ways, d.x, d.z) + 0.8, d.z]).map((v) => Math.round(v)) })), screen: (id: string, u: number) => { const w = ways.byId(id); return w ? project(spotP({ w, u })) : null; }, here: () => ({ id: here.w.id, u: here.u, len: here.w.len, ahead: ways.outOf(here.w.to).length }), pick: (x: number, y: number) => { const p = pick(x, y); return p && `${p.w.id}:${p.u.toFixed(1)}`; }, nearestSeen: (x: number, y: number) => { const p = nearestTo(x, y); return p && `${p.w.id}:${p.u.toFixed(1)}`; }, onHill: (x: number, y: number) => onHill(x, y), isOpen: (x: number, z: number) => isOpen(x, z), roam: (x: number, z: number) => roamTo([x, ground(ways, x, z), z]), zoom: (k: number) => zoomBy(k), go: (id: string, u: number) => { const w = ways.byId(id); if (w) goTo({ w, u }); }, off: () => off && { off, trail: trail.length, join: join && `${join.w.id}:${join.u.toFixed(1)}` }, mat: (x: number, y: number) => R.matAt(x * (canvas.width / innerWidth), y * (canvas.height / innerHeight)) };
  $('climb').textContent = `${Math.max(0, Math.round(pos[1] / RISE))}`;
  requestAnimationFrame(frame);
}
if (review) {
  $('hint').textContent = PASS + ' · seed ' + seed + ' · at ' + (params.get('at')?.startsWith('@') ? params.get('at')! : here.w.id + ':' + here.u.toFixed(1));
  $('hint').classList.add('on');
} else if (!preview) setTimeout(() => $('hint').classList.add('on'), 1200);
void WIDTH;
requestAnimationFrame(frame);
