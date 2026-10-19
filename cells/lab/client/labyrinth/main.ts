/**
 * Labyrinth: architecture that follows the hand. A travertine slab on a table in the sun, and five brushes: hand, auto
 * (the gestures, gesture.ts: **tap** raises stone; **trace** builds a wall, extends a walkway, or joins two places, in
 * steps and landings if they're at different heights), piece (palette.ts: a piece, or dressing), take (a tap takes
 * away, a stroke carves), select (select.ts: take up a piece or a motif, motifs.ts, and read it another way). The rules
 * (model.ts) work out what it takes to stand: arches, arcades and piers under what has nothing beneath it, arched ways
 * where stone's cut from under stone, courtyards (paved, with water and a cypress) where walls close round the ground.
 *
 * One finger on the stone uses the brush; one finger on the background, or two anywhere, turns it (it settles on a corner);
 * pinch to come close. Undo, print, clear. What's built is kept on this device.
 *
 * `?story=1..4` (the storyboard: first touch, a wall traced, an elevated connection, a resolved labyrinth) ·
 * `?ops=` (operations, as the model writes them) · `?brush=` · `?sheet` · `?select=k.i.j[&whole]` · `?print` · `?turn=` ·
 * `?zoom=` · `?preview` · `?still` · `?instant` (no rising, no gliding, no dust, no cats: for pictures taken by a slow
 * renderer, where every transition is frames it hasn't time for)
 */
import { CENTER, World, inGrid, key, replay, unkey, type Alt, type Cell, type Op } from './model';
import { buildMesh, inLand, inStone, setBleed } from './mesh';
import { LAND } from './land';
import { Renderer, camera, invert, type View } from './render';
import { carve, surface, tap, trace, type Intent, type Pick } from './gesture';
import { story } from './demo';
import { randomSeed } from '../kit/rng';
import { DRESSINGS, PIECES, dress, dressAt, place, placeOr, run, type Dressing, type Hand, type Piece } from './palette';
import { around, motifs, type Motif } from './motifs';
import { selectCell, selectMotif, selectStructure, type Selection } from './select';
import { DIRS } from './model';
import { Out, POSES, cat, gait, type PoseName } from './catbody';
import { COATS, Cats, type Cat } from './cats';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), still = qs.has('still'), instant = qs.has('instant');
const canvas = document.getElementById('stone') as HTMLCanvasElement, guide = document.getElementById('guide') as HTMLCanvasElement;
const g2 = guide.getContext('2d')!;
const R = new Renderer(canvas);
R.print = qs.has('print');
R.shadows = !qs.has('noshadow');
// (the land as Taohua draws its hill: the open ground the paper itself, only its features drawn, bleeding into the page,
// no plinth; `?plinth`: on its plinth instead. The flat slab is always a slab on its table)
const bleedOn = !qs.has('plinth') || qs.has('bleed');
R.msaa = !qs.has('nomsaa');

// ─── what's built ───
const KEY = 'labyrinth.v3';
let world: World;
if (preview) world = story(4);
else if (qs.has('story')) world = story(Number(qs.get('story')));
else if (qs.has('ops')) world = replay(qs.get('ops')!);
else if (qs.has('land')) world = new World(1, Number(qs.get('land')) || 1);
// (what was built here last, kept; or, the first time, a new piece of land (`?flat`: the flat slab, kept the same way))
else {
  let kept = ''; try { kept = localStorage.getItem(KEY) ?? ''; } catch { /* */ }
  world = kept ? replay(kept) : new World(1, qs.has('flat') ? 0 : randomSeed());
  if (qs.has('flat') && world.land) world = new World(1);
}
const fixed = preview || qs.has('story') || qs.has('ops') || qs.has('land');
/** `?hold=n`: the last n things done kept back, to be done in front of the cats (`release()`) */
const held_back: Op[] = qs.has('hold') ? world.ops.splice(world.ops.length - Number(qs.get('hold')), Number(qs.get('hold'))) : [];
if (held_back.length) world.rebuild(0);
const keep = () => { if (fixed) return; try { localStorage.setItem(KEY, world.encode()); } catch { /* */ } };
R.bleed = bleedOn && !!world.land; setBleed(R.bleed);
let meshVersion = -1;
/** `?plain`: without the rules' own dressing (character.ts), only the hand's */
const plain = qs.has('plain');
/** the mesh, as the world is now and with what's taken up marked on it (worked out again when either changes) */
let meshSel = '';
const selKeys = () => (sel ? new Set(sel.s.cells.map((c) => key(...c))) : new Set<number>());
function remesh() { const ks = selKeys(); R.upload(buildMesh(world, plain, ks)); meshVersion = world.version; meshSel = [...ks].join(','); }

// ─── how it's seen ───
const corner = (k: number) => Math.PI / 4 + (k * Math.PI) / 2;
const view: View = { az: corner(Number(qs.get('turn') ?? 0)), el: Number(qs.get('el') ?? 0.6), zoom: 1, target: [0, 0, 0] };
let zoomK = Number(qs.get('zoom') ?? 0.64), azGoal: number | null = null;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
  guide.width = Math.round(guide.clientWidth * dpr); guide.height = Math.round(guide.clientHeight * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
}
let aspect = 1;
/**
 * What's drawn (cells, as a box [i0, j0, i1, j1], its far sides exclusive): what's built, and never less than the piece
 * of land the bare land showed round its middle. (The land drawn only round what's built would shrink the place to
 * the first thing built in it: the shelves and the water a hand was reading, gone the moment it touched them.)
 */
let shownOf: World | null = null, shownAt = -1, shownBox: [number, number, number, number] = [0, 0, 0, 0];
function shown(): [number, number, number, number] {
  if (shownOf === world && shownAt === world.version) return shownBox;
  shownOf = world; shownAt = world.version;
  const mid = world.land ? (LAND.i0 + LAND.i1 + 1) / 2 : CENTER;
  let i0 = mid - 3.5, i1 = mid + 3.5, j0 = mid - 3.5, j1 = mid + 3.5;
  for (const m of [world.mass, world.stairs, world.piers]) for (const v of m.keys()) { const [, i, j] = unkey(v); i0 = Math.min(i0, i); i1 = Math.max(i1, i + 1); j0 = Math.min(j0, j); j1 = Math.max(j1, j + 1); }
  return (shownBox = [i0, j0, i1, j1]);
}
/** the box the view frames (cells, far sides exclusive): on land, what's drawn and the drawing's fade round it; on the slab, the slab */
function frameBox(): [number, number, number, number] {
  const e = world.extent();
  if (!world.land) return [e.i0, e.j0, e.i1 + 1, e.j1 + 1];
  const [i0, j0, i1, j1] = shown(), m = 3;
  return [Math.max(e.i0, i0 - m), Math.max(e.j0, j0 - m), Math.min(e.i1 + 1, i1 + m), Math.min(e.j1 + 1, j1 + m)];
}
/** what the view frames: the slab, however big it's grown, or on land what's drawn of it (its middle, and how far to stand back to see it) */
function framing() {
  const [bi0, bj0, bi1, bj1] = frameBox(), e = { i0: bi0, i1: bi1 - 1, j0: bj0, j1: bj1 - 1 };
  const half = (Math.max(e.i1 - e.i0, e.j1 - e.j0) / 2 + 1.5) * Math.SQRT2, top = world.top();
  // (as wide as the slab, and as tall as what's on it: there's no cap on how high it goes)
  const fit = Math.max(Math.max(half / aspect, half * 0.75) * 1.04 + top * 0.25, (half * Math.sin(view.el) + top * Math.cos(view.el)) * 0.55 + 1);
  return { cx: (e.i0 + e.i1 + 1) / 2 - CENTER, cz: (e.j0 + e.j1 + 1) / 2 - CENTER, fit, half };
}
addEventListener('resize', resize); resize();

let t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;
/** a point on the screen as a ray into the room */
function ray(cx: number, cy: number) {
  const r = canvas.getBoundingClientRect(), x = ((cx - r.left) / r.width) * 2 - 1, y = 1 - ((cy - r.top) / r.height) * 2;
  const inv = invert(camera(view, r.width / r.height).vp);
  const un = (z: number) => { const v = [x, y, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += inv[k * 4 + i] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return { a, d: [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L], L };
}
/** what a point on the screen touches: the slab, a top, or a side; the cell struck and the free cell on that face's side */
function pick(cx: number, cy: number, w: World = world): Pick | null {
  const { a, d, L } = ray(cx, cy), topY = w.top() + 1;
  let t = d[1] < 0 ? Math.max(0, (a[1] - topY) / -d[1]) : 0, prev: number[] | null = null;
  const cell = (p: number[]) => [Math.floor(p[1]), Math.floor(p[0] + CENTER), Math.floor(p[2] + CENTER)] as [number, number, number];
  // (coarse steps through the air, then fine ones back from the first stone struck)
  let step = 0.06;
  for (; t < L; t += step) {
    const p = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    if (p[1] < -1) return null;
    if (!inStone(w, p[0], p[1], p[2])) { prev = p; continue; }
    if (step > 0.012) { t -= step; step = 0.012; continue; }
    const hit = cell(p);
    if (!w.onSlab(hit[1], hit[2])) return null;
    // (the ground: the slab, or the land where nothing built is struck there: its column's ground)
    if (p[1] < 0 || (inLand(w, p[0], p[1], p[2]) && !(w.occupied(hit[0], hit[1], hit[2]) && !w.earth(hit[0], hit[1], hit[2])))) { const g0 = w.ground(hit[1], hit[2]); return { face: 'ground', hit: [g0 - 1, hit[1], hit[2]], to: [g0, hit[1], hit[2]] }; }
    // (struck in the stone over an arch, from below its own cell: it's that cell's)
    if (!w.occupied(hit[0], hit[1], hit[2]) && !w.tree(hit[0], hit[1], hit[2]) && !w.tree(hit[0] - 1, hit[1], hit[2])) {
      for (let k = hit[0] + 1; k < w.levels; k++) if (w.span(k, hit[1], hit[2])) { hit[0] = k; break; }
    }
    let to = prev ? cell(prev) : [hit[0] + 1, hit[1], hit[2]] as [number, number, number];
    // (struck from the air inside its own cell (a wall's thinner than its cell): from above, its top; else the side the
    // air was on)
    if (prev && to[0] === hit[0] && to[1] === hit[1] && to[2] === hit[2]) {
      const fx = prev[0] + CENTER - hit[1] - 0.5, fz = prev[2] + CENTER - hit[2] - 0.5, fy = prev[1] - hit[0];
      if (fy > 0.97) to = [hit[0] + 1, hit[1], hit[2]];
      else { const d = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : fz > 0 ? 1 : 3; to = [hit[0], hit[1] + DIRS[d][0], hit[2] + DIRS[d][1]]; }
    }
    const face = to[1] === hit[1] && to[2] === hit[2] ? 'top' : 'side';
    // (how squarely: the struck point's distance from the face's nearest edge, in the face's two directions)
    const f = (v: number) => Math.min(v - Math.floor(v), Math.ceil(v) - v), [fx, fy, fz] = [f(p[0]), f(p[1]), f(p[2])];
    const inset = face === 'top' ? Math.min(fx, fz) : to[1] !== hit[1] ? Math.min(fy, fz) : Math.min(fx, fy);
    return { face, hit, to: face === 'top' ? [hit[0] + 1, hit[1], hit[2]] : [hit[0], to[1], to[2]], inset };
  }
  return null;
}
/** where a point on the screen is on the level plane at height y (a cell) */
function onPlane(cx: number, cy: number, y: number): [number, number] | null {
  const { a, d } = ray(cx, cy);
  if (Math.abs(d[1]) < 1e-6) return null;
  const t = (y - a[1]) / d[1], x = a[0] + d[0] * t, z = a[2] + d[2] * t;
  const i = Math.floor(x + CENTER), j = Math.floor(z + CENTER);
  return inGrid(i, j) ? [i, j] : null;
}
/** where a point of the room is on the screen (css pixels) */
function screenOf(x: number, y: number, z: number): [number, number] {
  const r = canvas.getBoundingClientRect(), m = camera(view, r.width / r.height).vp, p = [x, y, z, 1];
  const o = [0, 1, 3].map((row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row] * p[3]);
  return [r.left + (o[0] / o[2] * 0.5 + 0.5) * r.width, r.top + (1 - (o[1] / o[2] * 0.5 + 0.5)) * r.height];
}

// ─── dust, as stone settles ───
const dust: Array<{ x: number; y: number; vx: number; vy: number; life: number; r: number }> = [];
function settle(cells: Array<[number, number, number]>, at = 0.85) {
  if (instant) return;
  for (const [k, i, j] of cells.slice(0, 30)) {
    const [sx, sy] = screenOf(i - CENTER + 0.5, k, j - CENTER + 0.5);
    for (let q = 0; q < 9; q++) dust.push({ x: sx + (Math.random() - 0.5) * 14, y: sy + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 30, vy: -8 - Math.random() * 14, life: -at - Math.random() * 0.15, r: 0.6 + Math.random() * 1.2 });
  }
}

// ─── the brushes ───
/**
 * Five brushes: **hand** (turn it; a tap asks what something is), **auto** (the gestures, read), **piece** (one thing
 * exactly: a piece, or dressing; hold the brush, or touch it again, for the sheet of them), **take** (a tap takes a piece
 * away, a stroke carves through), **select** (take up a piece, or the whole it's part of, and read it another way).
 */
type Brush = 'hand' | 'auto' | 'piece' | 'take' | 'select';
let brush: Brush = 'auto', held: Piece | Dressing = 'block', lastDress: Dressing = 'moss';
const isDress = (h: string): h is Dressing => (DRESSINGS as string[]).includes(h);
/** a brush (or anything the old palette called a hand: a piece puts that piece in the piece brush) */
function setBrush(h: string) {
  if (h === 'hand' || h === 'auto' || h === 'take' || h === 'select') brush = h;
  else if (h === 'piece') brush = 'piece';
  else if ((PIECES as string[]).includes(h) || isDress(h)) { brush = 'piece'; held = h as Piece | Dressing; if (isDress(h)) lastDress = h; }
  if (brush !== 'select') unselect();
  showBrush(); hint();
}
/** the way the eye looks, along the ground: the nearest of the four ways */
const looking = () => { const dx = -Math.sin(view.az), dz = -Math.cos(view.az); return DIRS.findIndex(([a, b]) => a === (Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0) && b === (Math.abs(dx) > Math.abs(dz) ? 0 : Math.sign(dz))); };
type Gesture = {
  id: number; start: Pick | null; x0: number; y0: number; t0: number; mode: 'pending' | 'look' | 'trace' | 'run' | 'paint' | 'carve' | 'turn';
  pts: Array<[number, number]>; base: number; seen: Map<string, number>; cut: Array<[number, number, number]>; painted: Cell[];
  /** a stroke: the world as it was before it (what it's read against), the height it started from, the columns crossed
   * (each fixed once passed), where it's going (and what might be next, and for how many moves), what it last laid */
  before?: World; h0?: number; cells: Array<[number, number]>; target: Pick | null; cand: string; candPick: Pick | null; count: number; laid: string; said: string; born: number;
  /** what the stroke builds now (or why it can't), for the guides */
  op?: Op | null;
  /** where the finger paused on the way, and when it last moved */
  rest: Array<[number, number]>; moved: number;
  /** where the finger last came to rest, and when (for holding still to choose); whether it's been offered */
  still: { x: number; y: number; t: number }; offered?: boolean;
};
let g: Gesture | null = null;
const fingers = new Map<number, { x: number; y: number }>();
let pinch0 = 0, zoom0 = 1, mid0 = 0, midY0 = 0;
const SAYS: Record<Exclude<Hand, 'auto'>, string> = { block: 'a block stands on the stone, or on stone', wall: 'a wall stands on the stone, or on stone, or runs out from a side', arch: 'an arch stands on the stone, or on stone', stair: 'a stair wants a floor to start from', bridge: 'a bridge goes across a gap, from stone to stone level with it', cypress: 'a cypress wants a floor, and room above it', pool: 'a pool is let into the ground, or into a top', take: 'nothing of yours there to take' };
const bar = document.getElementById('hands')!, sheet = document.getElementById('sheet')!, pieceB = bar.querySelector('[data-brush="piece"]') as HTMLElement;
/**
 * What auto's strokes are for: mass (a stroke on the ground is a wall; from a top, it reaches out or climbs, as ever) or
 * a way (a stroke connects where it starts to where it ends, and the land says how: paving, flights, a bridge). Taps
 * raise either way. Kept between visits; on the land, a way, the first time.
 */
let intent: Intent = (() => { try { const v = localStorage.getItem('labyrinth.intent'); if (v === 'mass' || v === 'way') return v; } catch { /* */ } return world.land ? 'way' : 'mass'; })();
if (qs.get('intent') === 'mass' || qs.get('intent') === 'way') intent = qs.get('intent') as Intent;
const intentEl = document.getElementById('intent') as HTMLElement;
function setIntent(v: Intent) { intent = v; try { localStorage.setItem('labyrinth.intent', v); } catch { /* */ } showBrush(); hint(); }
for (const b of Array.from(intentEl.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => setIntent(b.dataset.intent as Intent));
function showBrush() {
  document.body.classList.toggle('auto', brush === 'auto');
  for (const b of Array.from(intentEl.querySelectorAll('button')) as HTMLElement[]) { const on = b.dataset.intent === intent; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  for (const b of Array.from(bar.querySelectorAll('button')) as HTMLElement[]) { const on = b.dataset.brush === brush; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  // (the piece brush is always 'piece'; it shows what it holds as its picture)
  const src = sheet.querySelector(`[data-held="${held}"]`) as HTMLElement | null;
  if (src) { pieceB.querySelector('svg')!.outerHTML = src.querySelector('svg')!.outerHTML; pieceB.setAttribute('aria-label', `piece: ${held} (hold for all the pieces and dressing)`); pieceB.dataset.held = held; }
  for (const b of Array.from(sheet.querySelectorAll('button')) as HTMLElement[]) b.classList.toggle('on', b.dataset.held === held);
}
const openSheet = (on: boolean) => { sheet.classList.toggle('on', on); pieceB.setAttribute('aria-expanded', String(on)); };
for (const b of Array.from(bar.querySelectorAll('button')) as HTMLElement[]) {
  let t = 0, long = false;
  b.addEventListener('pointerdown', () => { long = false; if (b.dataset.brush === 'piece') t = window.setTimeout(() => { long = true; openSheet(true); }, 380); });
  b.addEventListener('pointerup', () => clearTimeout(t));
  b.addEventListener('pointerleave', () => clearTimeout(t));
  b.addEventListener('click', () => {
    if (long) return;
    const was = brush;
    // (the piece brush touched again: the sheet of what it can hold)
    if (b.dataset.brush === 'piece' && was === 'piece') { openSheet(!sheet.classList.contains('on')); return; }
    openSheet(false); setBrush(b.dataset.brush!); say(BRUSH_SAYS[brush]());
  });
}
for (const b of Array.from(sheet.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => { setBrush(b.dataset.held!); openSheet(false); say(BRUSH_SAYS.piece()); });
const BRUSH_SAYS: Record<Brush, () => string> = {
  hand: () => 'drag to turn it · tap to ask what something is, or to meet a cat',
  auto: () => (intent === 'way' ? 'way: a stroke connects places; paving, flights and bridges as the land asks' : 'mass: tap raises · trace builds, reaches out and climbs'),
  piece: () => (isDress(held) ? `${held}: tap a stone, or stroke over stones, to dress them` : `${held}: tap to put one · trace for a run of them`),
  take: () => 'tap takes a piece away · trace carves through',
  select: () => 'tap something to take it up · tap again for the whole of it',
};
function hint(text?: string) {
  const el = document.getElementById('hint')!;
  el.textContent = text ?? (brush !== 'auto' ? '' : intent === 'way' ? (world.ops.length < 3 ? 'way: trace from one place to another · the land says how' : '') : world.ops.length === 0 ? (world.land ? 'tap the ground to raise it · trace to wall' : 'tap the stone to raise it · trace to build') : world.ops.length < 4 ? 'trace from a top to reach out · trace up to a higher top to climb' : '');
  el.classList.toggle('on', !!el.textContent);
}
let hintT = 0;
const say = (t: string) => { hint(t); clearTimeout(hintT); hintT = window.setTimeout(() => hint(), 2600); };
const kept = () => { keep(); hint(); };

// ─── what's what: motifs, and the selection ───
let found = { v: -1, list: [] as Motif[] };
const motifsNow = () => { if (found.v !== world.version) found = { v: world.version, list: motifs(world) }; return found.list; };
/** what's taken up: the piece (or the whole) at a cell, its readings, which it's read as now, and the reading the hand
 * last switched it to (so switching again replaces that, rather than piling up) */
let sel: { cell: Cell; whole: Motif[]; idx: number; s: Selection; switched: Op | null } | null = null;
const card = document.getElementById('card')!;
const cellOf = (p: Pick): Cell => (p.face === 'ground' ? p.to : p.hit);
/** the ways a cell can be taken up, smallest first: the piece itself (if it's one), each motif it's part of, and all
 * that's joined to it (−1 the piece, then the motifs, then the structure) */
function scopeAt(c: Cell, whole: Motif[], idx: number): Selection | null {
  if (idx < 0) return selectCell(world, c, looking(), now());
  if (idx < whole.length) return selectMotif(world, whole[idx], now());
  return selectStructure(world, c);
}
function selectAt(p: Pick) {
  const c = cellOf(p), same = sel && sel.cell.every((v, q) => v === c[q]);
  if (same && sel) {
    // (again: the next scope out, round to the piece)
    for (let n = 1; n <= sel.whole.length + 2; n++) {
      const idx = ((sel.idx + 1 + n) % (sel.whole.length + 2)) - 1, s = scopeAt(c, sel.whole, idx);
      if (s) { sel = { ...sel, idx, s, switched: null }; showSel(); return; }
    }
  }
  const whole = around(motifsNow(), c);
  for (let idx = p.face === 'ground' ? 0 : -1; idx <= whole.length; idx++) {
    const s = scopeAt(c, whole, idx);
    if (s) { sel = { cell: c, whole, idx, s, switched: null }; showSel(); return; }
  }
  unselect(); say('nothing there to take up');
}
function scopeTo(idx: number) { if (!sel) return; const s = scopeAt(sel.cell, sel.whole, idx); if (s) { sel = { ...sel, idx, s, switched: null }; showSel(); } }
function unselect() { sel = null; showSel(); }
/** a small drawing of each reading, so they can be told apart at a glance */
const READING_ICONS: Array<[RegExp, string]> = [
  [/no roof/, '<path d="M4 20V10h16v10"/><path d="M3 10h18" stroke-dasharray="2 2"/>'],
  [/hipped/, '<path d="M4 20V12h16v8"/><path d="M2 12l7-6h6l7 6z"/>'],
  [/gable/, '<path d="M4 20V12h16v8"/><path d="M2 12l10-8 10 8z"/>'],
  [/shed/, '<path d="M4 20V11h16v9"/><path d="M2 13l20-6v4"/>'],
  [/dome/, '<path d="M6 20v-8h12v8"/><path d="M6 12a6 6 0 0112 0"/><path d="M12 6V3"/>'],
  [/roof as/, '<path d="M4 20V12h16v8"/><path d="M2 12l10-8 10 8"/><circle cx="12" cy="16" r="1.5"/>'],
  [/colonnade|column/, '<path d="M2 5h20M3 8h18"/><path d="M5 8v12M9.7 8v12M14.3 8v12M19 8v12M3 20h18"/>'],
  [/lintel/, '<path d="M3 7h18M5 7v13M19 7v13"/>'],
  [/two bays/, '<path d="M3 20V6h18v14"/><path d="M5 20v-6a3 3 0 016 0v6M13 20v-6a3 3 0 016 0v6"/>'],
  [/solid/, '<rect x="4" y="6" width="16" height="14" fill="currentColor" opacity=".35"/><rect x="4" y="6" width="16" height="14"/>'],
  [/arcaded/, '<path d="M3 20V7h18v13"/><path d="M5 20v-5a2 2 0 014 0v5M10 20v-5a2 2 0 014 0v5M15 20v-5a2 2 0 014 0v5"/>'],
  [/thin wall/, '<path d="M10 4h4v16h-4z"/>'],
  [/arch/, '<path d="M3 20V6h18v14"/><path d="M7 20v-7a5 5 0 0110 0v7"/>'],
  [/pier/, '<path d="M9 21h6M10 21V6M14 21V6M8 6h8"/>'],
  [/block|wall$/, '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'],
  [/climbing|stair/, '<path d="M3 21h4v-4h4v-4h4V9h4V5h2"/>'],
];
const icon = (label: string) => `<svg viewBox="0 0 24 24">${READING_ICONS.find(([r]) => r.test(label))?.[1] ?? '<circle cx="12" cy="12" r="3"/>'}</svg>`;
function showSel() {
  document.body.classList.toggle('selecting', !!sel);
  card.classList.toggle('on', !!sel);
  if (!sel) return;
  const { s } = sel;
  (card.querySelector('#what') as HTMLElement).textContent = s.title;
  // (its scope: the piece, each whole it's part of, all that's joined to it)
  const scopes = card.querySelector('#scope') as HTMLElement;
  const opts: Array<[number, string]> = [];
  if (selectCell(world, sel.cell, looking(), now())) opts.push([-1, 'piece']);
  sel.whole.forEach((m, n) => opts.push([n, m.kind]));
  opts.push([sel.whole.length, 'structure']);
  scopes.innerHTML = opts.map(([n, l]) => `<button data-scope="${n}" class="${n === sel!.idx ? 'on' : ''}">${l}</button>`).join('');
  for (const b of Array.from(scopes.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => scopeTo(Number(b.dataset.scope)));
  // (every reading at once, the one it is now marked; a touch reads it that way)
  const rd = card.querySelector('#readings') as HTMLElement;
  rd.hidden = s.readings.length < 2;
  rd.innerHTML = s.readings.map((r, n) => `<button data-reading="${n}" class="${n === s.at ? 'on' : ''}" aria-pressed="${n === s.at}">${icon(r.label)}<i>${r.label}</i></button>`).join('');
  for (const b of Array.from(rd.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => switchTo(Number(b.dataset.reading)));
  // (dressing it, whole, straight from here)
  const dr = card.querySelector('#dressrow') as HTMLElement;
  dr.hidden = !s.stone.length && s.motif?.kind !== 'court';
  if (!dr.childElementCount) {
    dr.innerHTML = DRESSINGS.map((d) => `<button data-dress="${d}" aria-label="dress it: ${d}">${(sheet.querySelector(`[data-held="${d}"] svg`) as SVGElement | null)?.outerHTML ?? ''}<i>${d}</i></button>`).join('');
    for (const b of Array.from(dr.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => dressSel(b.dataset.dress as Dressing));
  }
  (card.querySelector('#takeaway') as HTMLElement).hidden = !s.remove;
}
/** read what's taken up a given way: replacing the last switch if that's still the last thing done */
function switchTo(at: number) {
  if (!sel || at === sel.s.at) return;
  const { s } = sel, op = s.readings[at].op;
  const again = !!sel.switched && world.ops[world.ops.length - 1] === sel.switched;
  if (again) { if (op) world.replaceLast(op, now()); else world.undo(now()); }
  else if (op) world.apply(op, now());
  else return;
  sel.switched = op;
  s.at = at;
  kept(); showSel();
}
const switchReading = () => { if (sel) switchTo((sel.s.at + 1) % sel.s.readings.length); };
function takeAway() { if (!sel?.s.remove) return; world.apply(sel.s.remove, now()); kept(); unselect(); }
function dressSel(kind: Dressing = lastDress) { if (!sel) return; lastDress = kind; const op = dress(world, kind, kind === 'pergola' && sel.s.motif?.kind === 'court' ? sel.s.cells : sel.s.stone); if (op) { world.apply(op, now()); kept(); } }
card.querySelector('#takeaway')!.addEventListener('click', takeAway);
card.querySelector('#close')!.addEventListener('click', unselect);
/** what a touch is on, said plainly (the hand brush's tap) */
function describe(p: Pick): string {
  const c = cellOf(p), s = p.face === 'ground' ? null : selectCell(world, c, looking(), now()), whole = around(motifsNow(), c);
  const what = s?.title ?? (p.face === 'ground' ? (world.courts.has(key(0, c[1], c[2])) ? 'the paving of a court' : world.land ? (world.pool(c[1], c[2]) ? 'the stream' : 'the ground') : 'the stone slab') : '');
  return [what, ...whole.slice(0, 1).map((m) => `part of ${m.label}`)].filter(Boolean).join(' · ');
}

/** where a trace might be going: a top (or a side) other than the column it started on; else nowhere ('') */
const goal = (p: Pick | null) => !p || p.face === 'ground' || !g?.start || (p.hit[1] === g.start.hit[1] && p.hit[2] === g.start.hit[2]) ? '' : `${surface(g.before!, p)}.${p.hit[1]}.${p.hit[2]}`;
/**
 * The other ways the last gesture could have been read: a row of chips over the brushes after it, the one it is now
 * marked. A touch reads it so instead (in place of what it built, as one more thing done); the row goes with the next
 * touch on the stone. A gesture refused offers what it could be instead the same way.
 */
const altsEl = document.getElementById('alts') as HTMLElement;
let altsNow: { list: Array<{ label: string; op: Op }>; at: number; base: number } | null = null;
function showAlts(first: Op | null, alts: Alt[] | undefined, base: number) {
  if (!alts?.length) { hideAlts(); return; }
  const list = [...(first ? [{ label: first.reading ?? first.note ?? 'as drawn', op: first }] : []), ...alts.map((a) => ({ label: a.label, op: { ...a.op, alts: undefined } }))];
  altsNow = { list, at: first ? 0 : -1, base };
  drawAlts();
}
function drawAlts() {
  if (!altsNow || !qs.has('chips')) return;
  altsEl.innerHTML = `<i>read as</i>${altsNow.list.map((a, n) => `<button data-alt="${n}" class="${n === altsNow!.at ? 'on' : ''}" aria-pressed="${n === altsNow!.at}">${a.label}</button>`).join('')}`;
  altsEl.classList.add('on');
  for (const b of Array.from(altsEl.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => readAs(Number(b.dataset.alt)));
}
function readAs(n: number) {
  if (!altsNow || n === altsNow.at) return;
  const op = { ...altsNow.list[n].op, alts: undefined };
  if (altsNow.at >= 0 && world.ops.length === altsNow.base + 1) world.replaceLast(op, now()); else { world.apply(op, now()); altsNow.base = world.ops.length - 1; }
  altsNow.at = n; drawAlts(); kept();
  say(op.note ?? altsNow.list[n].label);
}
function hideAlts() { altsNow = null; altsEl.classList.remove('on'); altsEl.innerHTML = ''; }
/**
 * Choosing by going on with the gesture: hold still at the end of a stroke (or on a tap) and, if it could be read
 * another way, the readings fan out above the finger; lean toward one and it's built that way at once; let go to keep
 * it. Lean far away instead (on a stroke) and the stroke simply goes on, as if nothing were offered.
 */
type Fan = { x: number; y: number; list: Array<{ label: string; op: Op }>; at: number; tap: boolean };
let fan: Fan | null = null, heldHints = 0;
const HOLD = 650, LEAN = 28, BEYOND = 170;
function readingsNow(): Array<{ label: string; op: Op }> | null {
  if (!g) return null;
  const strip = (o: Op): Op => ({ ...o, alts: undefined });
  if (g.mode === 'trace' && g.op?.alts?.length) return [{ label: g.op.reading ?? g.op.note ?? 'as drawn', op: strip(g.op) }, ...g.op.alts.map((a) => ({ label: a.label, op: strip(a.op) }))];
  if (g.mode === 'pending' && g.start && brush === 'auto') {
    const r = tap(world, g.start, now(), false, intent);
    if (!r) return null;
    const first = 'refused' in r ? null : r, list = [...(first ? [{ label: first.reading ?? first.note ?? 'raised', op: strip(first) }] : []), ...(r.alts ?? []).map((a) => ({ label: a.label, op: strip(a.op) }))];
    return list.length > 1 || (!first && list.length) ? list : null;
  }
  return null;
}
function openFan() {
  if (!g) return;
  g.offered = true;
  const list = readingsNow(), f = fingers.get(g.id);
  if (!list || !f) return;
  const tapped = g.mode === 'pending';
  if (tapped) world.apply(list[0].op, now());
  fan = { x: f.x, y: f.y, list, at: 0, tap: tapped };
  say('lean toward another reading · let go to keep it');
}
const fanAngle = (q: number, n: number) => -Math.PI / 2 + (n <= 2 ? 0 : ((q - 1) / (n - 2) - 0.5) * Math.PI * 0.85);
function choose(at: number) {
  if (!fan || at === fan.at) return;
  fan.at = at;
  world.replaceLast(fan.list[at].op, now());
  if (g) { g.laid = JSON.stringify(fan.list[at].op); g.op = fan.list[at].op; }
}
/** the finger moved while the readings are out: which it leans toward; false if it's gone on past them */
function leanFan(cx: number, cy: number): boolean {
  if (!fan) return false;
  const dx = cx - fan.x, dy = cy - fan.y, d = Math.hypot(dx, dy);
  let at = 0, best = Infinity;
  const a = Math.atan2(dy, dx);
  for (let q = 1; q < fan.list.length; q++) { const e = Math.abs(Math.atan2(Math.sin(a - fanAngle(q, fan.list.length)), Math.cos(a - fanAngle(q, fan.list.length)))); if (e < best) { best = e; at = q; } }
  // (gone on past them, or off another way than toward any: the stroke goes on)
  if (!fan.tap && (d > BEYOND || (d > 60 && best > 0.6))) { choose(0); fan = null; if (g) g.still = { x: cx, y: cy, t: performance.now() }; return false; }
  if (d < LEAN || best > 0.6) at = 0;
  choose(at);
  return true;
}
function keepFan() {
  if (!fan) return;
  const op = fan.list[fan.at].op;
  settle([...(op.add ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]]));
  say(op.note ?? fan.list[fan.at].label);
  altsNow = { list: fan.list, at: fan.at, base: world.ops.length - 1 };
  fan = null; kept();
}
/** the readings, drawn round where the finger held */
function drawFan() {
  if (!fan) return;
  const n = fan.list.length;
  g2.font = 'italic 12.5px "Iowan Old Style", Palatino, Georgia, serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
  const pill = (x: number, y: number, label: string, on: boolean) => {
    const wd = g2.measureText(label).width + 18, h = 26;
    g2.fillStyle = on ? 'rgba(43,36,32,.92)' : 'rgba(246,241,231,.94)'; g2.strokeStyle = 'rgba(43,36,32,.25)'; g2.lineWidth = 1;
    g2.beginPath(); g2.roundRect(x - wd / 2, y - h / 2, wd, h, 13); g2.fill(); if (!on) g2.stroke();
    g2.fillStyle = on ? '#f3ede1' : '#2b2420'; g2.fillText(label, x, y + 0.5);
  };
  g2.strokeStyle = 'rgba(176,92,30,.35)'; g2.lineWidth = 1.2; g2.setLineDash([2, 4]);
  g2.beginPath(); g2.arc(fan.x, fan.y, LEAN, 0, Math.PI * 2); g2.stroke(); g2.setLineDash([]);
  for (let q = 1; q < n; q++) { const a = fanAngle(q, n), r = 92; pill(fan.x + Math.cos(a) * r, fan.y + Math.sin(a) * r - 6, fan.list[q].label, fan.at === q); }
  pill(fan.x, fan.y + 46, fan.list[0].label, fan.at === 0);
}
/** gestures that came to nothing, or less than was asked: what, why (kept, for looking at what's still left unread) */
const declines: Array<{ what: string; why: string; t: number }> = [];
const declined = (what: string, why: string) => { declines.push({ what, why, t: Date.now() }); if (declines.length > 200) declines.shift(); };
/** how long the finger stays still on a stroke before it's a pause (a gate in a wall, a landing on a flight) */
const PAUSE = 450;

/** moves in a row a new destination has to be under the finger before the trace goes there instead */
const SURE = 3;
/** how far inside a top (from its edge, of a cell's 0.5) a touch counts as meaning it at once */
const SQUARE = 0.18;
/** put what a stroke builds as it now is: in place of what it built a move ago, and only if it's changed */
function lay(built: Op | null) {
  if (!g) return;
  const sig = built ? JSON.stringify(built) : '';
  if (sig === g.laid) return;
  if (world.ops.length > g.base) { if (built) world.replaceLast(built, now()); else { world.ops.length = g.base; world.rebuild(now()); } }
  else if (built) world.apply(built, now());
  g.laid = sig; g.op = built;
}
/** a stroke under the finger (auto's trace, or a run of pieces): its columns, and what it builds, read again */
function traceStep(cx: number, cy: number, final: boolean) {
  if (!g?.start) return;
  if (!g.before) {
    // (read against the world as it was before this stroke: a copy, so picking never strikes the stroke's own stone)
    g.before = new World(world.seed, world.landSeed); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now());
    g.h0 = surface(g.before, g.start); g.cells = [[g.start.hit[1], g.start.hit[2]]]; g.born = now();
  }
  const before = g.before;
  g.pts.push([cx, cy]);
  // (the columns crossed: on the plane the stroke starts from, each fixed once the finger's passed it)
  const c = onPlane(cx, cy, g.h0!), last = g.cells[g.cells.length - 1];
  // (the finger still a while, on the way: a pause where it is)
  const t = performance.now();
  if (!final && g.moved && t - g.moved > PAUSE && g.cells.length > 1 && !g.rest.some((r) => r[0] === last[0] && r[1] === last[1])) { g.rest.push(last); say('a pause: a gate here, or a landing'); }
  g.moved = t;
  if (c && (c[0] !== last[0] || c[1] !== last[1])) g.cells.push(c);
  if (g.mode === 'run') {
    const op = run(before, held as Piece, g.start, g.cells, looking(), g.born);
    lay(op); g.op = op;
    if (final && op) { settle([...(op.add ?? []), ...(op.arches ?? [])].map((q) => [q[0], q[1], q[2]])); kept(); }
    return;
  }
  // (where it's going: a new destination only once it's held under the finger a few moves; letting go changes nothing,
  // so what was shown under the finger is what's built)
  const end = final ? null : pick(cx, cy, before), k = goal(end);
  if (final) { /* (letting go isn't a move) */ } else if (k === goal(g.target)) g.count = 0;
  else if (k === g.cand) { g.count++; g.candPick = end; }
  else { g.cand = k; g.candPick = end; g.count = 1; }
  // (a top touched squarely is meant at once; near its edge, or leaving it, only once the finger stays)
  if (!final && k && k !== goal(g.target) && (end?.inset ?? 0) >= SQUARE) g.count = SURE;
  if (g.count >= SURE) { g.target = k ? g.candPick : null; g.count = 0; }
  for (const [i, j] of g.cells) if (!g.seen.has(`${i}.${j}`)) g.seen.set(`${i}.${j}`, now());
  const op = trace(before, g.start, g.cells, g.target, (i, j) => g!.seen.get(`${i}.${j}`) ?? now(), g.born, g.rest, intent);
  const refused = op && 'refused' in op ? op.refused : '';
  if (refused && refused !== g.said) say(refused);
  if (final && refused) declined('trace', refused);
  g.said = refused;
  const built = op && !('refused' in op) ? op : null;
  lay(built);
  if (!built) g.op = null;
  if (final && built) {
    const r = world.reached.get(world.ops[world.ops.length - 1]);
    settle(r?.cells ?? (built.add ?? []).map((q) => [q[0], q[1], q[2]])); kept();
    // (never quietly short: if it stopped on the way, it says where it joined)
    if (r && !r.reached && built.connect?.to) { say(r.stopped > 0 ? 'it joins the stone it meets on the way' : 'nothing to build there'); declined(built.why ?? 'trace', 'stopped short'); }
    else if (built.note) say(built.alts?.length && heldHints++ < 4 ? `${built.note} · hold at the end to read it otherwise` : built.note);
    showAlts(built, built.alts, g.base);
  }
}
/** dressing, stroked over stone: each stone the finger passes over */
function paintAt(cx: number, cy: number) {
  if (!g) return;
  const p = pick(cx, cy), c = p && dressAt(g.before ?? world, p, held as Dressing);
  if (c && !g.painted.some((q) => q.every((v, n) => v === c[n]))) g.painted.push(c);
  if (!g.before) { g.before = new World(world.seed, world.landSeed); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now()); }
  lay(g.painted.length ? dress(g.before, held as Dressing, g.painted) : null);
}
function carveAt(cx: number, cy: number) {
  if (!g) return;
  const p = pick(cx, cy), c = p && carve(world, p);
  if (!c || g.cut.some((q) => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) return;
  g.cut.push(c);
  if (world.ops.length > g.base) world.replaceLast({ cut: g.cut.slice(), why: 'carve' }, now()); else world.apply({ cut: g.cut.slice(), why: 'carve' }, now());
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  azGoal = null;
  openSheet(false);
  if (fingers.size === 2) {
    // (a second finger: whatever the first was doing is let go; the two turn it and pinch)
    if (g && g.mode !== 'turn' && g.mode !== 'look' && world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); }
    g = null;
    const [p, q] = [...fingers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); zoom0 = zoomK; mid0 = (p.x + q.x) / 2; midY0 = (p.y + q.y) / 2;
    return;
  }
  const start = pick(e.clientX, e.clientY);
  if (brush !== 'hand') hideAlts();
  g = { id: e.pointerId, start, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: brush === 'hand' ? 'look' : !start ? 'turn' : 'pending', pts: [], base: world.ops.length, seen: new Map(), cut: [], painted: [], cells: [], target: null, cand: '', candPick: null, count: 0, laid: '', said: '', born: 0, rest: [], moved: 0, still: { x: e.clientX, y: e.clientY, t: performance.now() } };
});
canvas.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  const dx = e.clientX - f.x; f.x = e.clientX; f.y = e.clientY;
  if (fingers.size === 2) {
    // (two fingers: across turns it, up and down tilts it, a pinch comes closer to where the fingers are)
    const [p, q] = [...fingers.values()], d = Math.hypot(p.x - q.x, p.y - q.y), mid = (p.x + q.x) / 2, midY = (p.y + q.y) / 2;
    if (pinch0 > 0) zoomAt(mid, midY, Math.max(0.06, Math.min(1.3, zoom0 * (pinch0 / d))));
    view.az -= (mid - mid0) * 0.008; mid0 = mid;
    view.el = Math.max(0.3, Math.min(1.2, view.el + (midY - midY0) * 0.004)); midY0 = midY;
    return;
  }
  if (!g || g.id !== e.pointerId) return;
  if (fan) { if (leanFan(e.clientX, e.clientY)) return; }
  if (Math.hypot(e.clientX - g.still.x, e.clientY - g.still.y) > 7) g.still = { x: e.clientX, y: e.clientY, t: performance.now() };
  const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 9;
  if (g.mode === 'turn') { view.az -= dx * 0.008; return; }
  if ((g.mode === 'look' || (g.mode === 'pending' && brush === 'select')) && moved) { g.mode = 'turn'; view.az -= (e.clientX - g.x0) * 0.008; return; }
  if (g.mode === 'pending' && moved) {
    // (a stroke: what it is depends on the brush)
    g.mode = brush === 'auto' ? 'trace' : brush === 'take' ? 'carve' : isDress(held) ? 'paint' : 'run';
    if (g.mode === 'carve') carveAt(g.x0, g.y0); else if (g.mode === 'paint') paintAt(g.x0, g.y0); else traceStep(g.x0, g.y0, false);
  }
  if (g.mode === 'trace' || g.mode === 'run') traceStep(e.clientX, e.clientY, false);
  else if (g.mode === 'carve') carveAt(e.clientX, e.clientY);
  else if (g.mode === 'paint') paintAt(e.clientX, e.clientY);
});
const up = (e: PointerEvent) => {
  fingers.delete(e.pointerId);
  // (let go near a corner, it settles on it; anywhere else, it stays where it was left)
  if (fingers.size === 0) { const c = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2))); azGoal = Math.abs(c - view.az) < 0.22 ? c : null; }
  if (!g || g.id !== e.pointerId) return;
  const cancelled = e.type !== 'pointerup', m = g.mode, start = g.start;
  if (fan && !cancelled) { keepFan(); g = null; return; }
  fan = null;
  if (cancelled && m !== 'turn' && m !== 'look') { if (world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); } g = null; return; }
  const pet = m === 'look' ? catAt(e.clientX, e.clientY) : null;
  if (pet) meet(pet);
  else if (m === 'look' && start) say(describe(start));
  else if (m === 'pending' && start) {
    // (a tap: what it does depends on the brush)
    if (brush === 'select') selectAt(start);
    else {
      unselect();
      let op: Op | null = null;
      if (brush === 'auto') {
        const r = tap(world, start, now(), false, intent);
        // (refused outright (rare now): its first other reading, if it has one, is what's built)
        if (r && 'refused' in r) { declined('tap', r.refused); say(r.alts?.length ? `${r.refused} · hold to ${r.alts[0].label}` : r.refused); g = null; return; }
        op = r;
        if (!op) declined('tap', 'nothing more will stand there');
      }
      else if (brush === 'take') op = place(world, 'take', start, looking(), now());
      else if (isDress(held)) { const c = dressAt(world, start, held); op = c ? dress(world, held, [c]) : null; }
      else op = placeOr(world, held, start, looking(), now());
      if (op) { world.apply(op, now()); settle([...(op.add ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]])); kept(); if (op.note) say(op.alts?.length ? `${op.note} · hold to read it otherwise` : op.note); }
      else say(brush === 'auto' ? 'nothing more will stand there' : brush === 'take' ? SAYS.take : isDress(held) ? (held === 'lantern' || held === 'pot' ? 'that wants a top with room over it' : held === 'pergola' ? 'a pergola wants a place to stand, with room over it' : 'dressing goes on stone') : SAYS[held as Piece]);
    }
  } else if (m === 'trace' || m === 'run') { unselect(); traceStep(e.clientX, e.clientY, true); }
  else if (m === 'carve' || m === 'paint') { unselect(); kept(); }
  g = null;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.max(0.06, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001)))); }, { passive: false });
{ const h = qs.get('hand') ?? qs.get('brush'); if (h) setBrush(h); }
// (for looking at them: `?sheet` opens the piece brush's sheet; `?select=k.i.j` takes up what's there, `&whole` the whole)
if (qs.has('sheet')) { setBrush('piece'); openSheet(true); }
if (qs.has('select')) {
  const [k, i, j] = qs.get('select')!.split('.').map(Number), p: Pick = { face: 'top', hit: [k, i, j], to: [k + 1, i, j] };
  setBrush('select'); selectAt(p); if (qs.has('whole')) selectAt(p);
}

// ─── its buttons ───
const printB = document.getElementById('print')!;
const showPrint = () => { printB.classList.toggle('on', R.print); printB.setAttribute('aria-pressed', String(R.print)); };
printB.addEventListener('click', () => { R.print = !R.print; showPrint(); });
document.getElementById('undo')!.addEventListener('click', () => { if (world.undo(now())) { unselect(); kept(); } });
/**
 * Start again: what's built cleared away, back to the land it was on; on bare land already, a new piece of land.
 * (`?flat`, the flat slab, stays flat.)
 */
function startAgain() {
  if (world.ops.length) { if (!confirm(world.land ? 'Clear what\'s built, back to the land?' : 'Clear the stone?')) return; world = new World(world.seed, qs.has('flat') ? 0 : world.landSeed || randomSeed()); }
  else world = new World(world.seed, qs.has('flat') ? 0 : randomSeed());
  meshVersion = -1; unselect(); hideAlts(); kept(); follow = true;
  say(world.ops.length ? '' : world.land ? 'a new piece of land' : 'the stone, bare');
}
document.getElementById('again')!.addEventListener('click', startAgain);
showPrint(); showBrush(); hint();
if (preview) document.body.classList.add('preview');

// ─── what the hand is asking for, while it's asking ───
const sayEl = document.getElementById('say')!;
const INK = 'rgba(43,36,32,', WARM = 'rgba(176,92,30,';
/** a point of the room (cell coordinates: i, j, at height y) on the screen */
const at3 = (i: number, j: number, y: number) => screenOf(i - CENTER, y, j - CENTER);
/**
 * The stroke's guides: the stroke itself, faint; where it started (a dot on the surface it started from); the route
 * it's asking for, along the heights it will walk (the intent, apart from the stone that holds it up); the top it's
 * going to (outlined; dashed while it's only being considered); and, if it stops short, where.
 */
function guides() {
  if (!g || !g.start || !(g.mode === 'trace' || g.mode === 'run' || g.mode === 'paint' || g.mode === 'carve')) return;
  if (g.pts.length > 1) {
    g2.strokeStyle = INK + '.28)'; g2.lineWidth = 1.5; g2.setLineDash([2, 5]); g2.lineCap = 'round';
    g2.beginPath(); g2.moveTo(g.pts[0][0], g.pts[0][1]); for (const [x, y] of g.pts) g2.lineTo(x, y); g2.stroke(); g2.setLineDash([]);
  }
  // (where it started)
  const st = g.start, [sk, si, sj] = st.hit;
  const sp = st.face === 'ground' ? at3(si + 0.5, sj + 0.5, sk + 1) : st.face === 'top' ? at3(si + 0.5, sj + 0.5, sk + 1) : at3(si + 0.5 + (st.to[1] - si) * 0.5, sj + 0.5 + (st.to[2] - sj) * 0.5, sk + 0.5);
  g2.fillStyle = WARM + '.9)'; g2.beginPath(); g2.arc(sp[0], sp[1], 3.5, 0, Math.PI * 2); g2.fill();
  g2.strokeStyle = WARM + '.5)'; g2.lineWidth = 1.2; g2.beginPath(); g2.arc(sp[0], sp[1], 8, 0, Math.PI * 2); g2.stroke();
  const op = g.op, c = op?.connect, r = op && c ? world.reached.get(world.ops[world.ops.length - 1]) : undefined;
  if (c) {
    // (the route: each column at the height it's walked)
    const walk = new Map<string, number>();
    for (const [k, i, j] of r?.cells ?? []) { const h = world.stair(k, i, j) >= 0 ? k + 0.5 : k + 1; walk.set(`${i}.${j}`, Math.max(walk.get(`${i}.${j}`) ?? -1, h)); }
    const cols = c.to ? [...c.path, [c.to[1], c.to[2]] as [number, number]] : c.path;
    g2.strokeStyle = WARM + '.75)'; g2.lineWidth = 2; g2.lineJoin = 'round';
    g2.beginPath();
    cols.forEach(([i, j], q) => { const h = q === 0 ? c.from[0] : q === cols.length - 1 && c.to ? c.to[0] : walk.get(`${i}.${j}`) ?? c.from[0]; const p = at3(i + 0.5, j + 0.5, h + 0.02); if (q) g2.lineTo(p[0], p[1]); else g2.moveTo(p[0], p[1]); });
    g2.stroke();
    // (where it stopped short, if it did)
    if (r && !r.reached && r.stopped >= 0 && c.path[r.stopped + 1]) {
      const [i, j] = c.path[r.stopped + 1], h = walk.get(`${c.path[r.stopped][0]}.${c.path[r.stopped][1]}`) ?? c.from[0], p = at3(i + 0.5, j + 0.5, h);
      g2.strokeStyle = WARM + '.95)'; g2.lineWidth = 2; g2.beginPath(); g2.moveTo(p[0] - 6, p[1] - 6); g2.lineTo(p[0] + 6, p[1] + 6); g2.moveTo(p[0] + 6, p[1] - 6); g2.lineTo(p[0] - 6, p[1] + 6); g2.stroke();
    }
  }
  // (the top it's going to; dashed while it's only being considered)
  const top = (p: Pick, dashed: boolean) => {
    const [, i, j] = p.hit, h = surface(g!.before ?? world, p), q = [at3(i, j, h), at3(i + 1, j, h), at3(i + 1, j + 1, h), at3(i, j + 1, h)];
    g2.strokeStyle = WARM + (dashed ? '.55)' : '.95)'); g2.lineWidth = dashed ? 1.4 : 2; g2.setLineDash(dashed ? [4, 4] : []);
    g2.beginPath(); q.forEach((v, n) => (n ? g2.lineTo(v[0], v[1]) : g2.moveTo(v[0], v[1]))); g2.closePath(); g2.stroke(); g2.setLineDash([]);
  };
  if (g.mode === 'trace') {
    if (g.target) top(g.target, false);
    if (g.cand && g.candPick && g.cand !== goal(g.target) && g.count > 0) top(g.candPick, true);
  }
}
/** what it is, said plainly by the finger: a wall, a bridge, climbing two levels, or why it can't be */
function label() {
  const f = g && fingers.get(g.id);
  let text = '', warn = false;
  if (g && f && (g.mode === 'trace' || g.mode === 'run' || g.mode === 'paint' || g.mode === 'carve')) {
    if (g.said) { text = g.said; warn = true; }
    else if (g.mode === 'carve') text = g.cut.length ? `carving through ${g.cut.length}` : 'carving';
    else text = g.op?.note ?? (g.mode === 'run' ? `${held}` : '');
    const rr = g.op?.connect && world.reached.get(world.ops[world.ops.length - 1]);
    if (rr && !rr.reached && rr.stopped > 0) text += ' · joining what it meets';
  }
  sayEl.textContent = text;
  sayEl.classList.toggle('on', !!text); sayEl.classList.toggle('warn', warn);
  if (text && f) { const wd = sayEl.offsetWidth; sayEl.style.transform = `translate(${Math.max(8, Math.min(innerWidth - wd - 8, f.x - wd / 2))}px, ${Math.max(70, f.y - 74)}px)`; }
}

// ─── where the eye is ───
/** whether the view frames what's built (and goes on doing so till it does), and the world it last checked */
let follow = true, edgeChecked = -1;
/** where a point on the screen is on the level plane through what the eye's looking at */
function groundAt(cx: number, cy: number): [number, number] | null {
  const { a, d } = ray(cx, cy), y = view.target[1];
  if (Math.abs(d[1]) < 1e-6) return null;
  const t = (y - a[1]) / d[1];
  return [a[0] + d[0] * t, a[2] + d[2] * t];
}
/** come closer (or stand back), keeping the point under the fingers (or the pointer) where it is */
function zoomAt(cx: number, cy: number, k: number) {
  const A = groundAt(cx, cy);
  zoomK = k; view.zoom = zoomFit * zoomK;
  const B = groundAt(cx, cy);
  if (A && B) { view.target[0] += A[0] - B[0]; view.target[2] += A[1] - B[1]; }
  follow = false;
}
/** whether what's built has reached the edge of the screen (or past it): the slab's corners, and as high as it goes */
function offScreen() {
  const [i0, j0, i1, j1] = frameBox(), top = world.top(), r = canvas.getBoundingClientRect();
  for (const i of [i0, i1]) for (const j of [j0, j1]) for (const y of [0, top]) {
    const [x, z] = screenOf(i - CENTER, y, j - CENTER);
    if (x < r.left + 12 || x > r.right - 12 || z < r.top + 64 || z > r.bottom - 84) return true;
  }
  return false;
}
document.getElementById('frame')!.addEventListener('click', () => { zoomK = Number(qs.get('zoom') ?? 0.64); follow = true; });

// ─── each frame ───
let last = performance.now(), zoomFit = framing().fit;
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (world.version !== meshVersion || [...selKeys()].join(',') !== meshSel) remesh();
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = instant ? 1 : 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  // (it frames what's built when asked to (at the start, the frame button, or when what's built reaches the edge of the
  // screen), and then stays put: the work doesn't shrink away from the hand as it grows, and never moves under a finger)
  const fr = framing();
  if (!g && world.version !== edgeChecked) { edgeChecked = world.version; if (offScreen()) follow = true; }
  if (follow && (!g || g.mode === 'turn')) {
    const top = world.top(), q = instant ? 1 : 1 - Math.exp(-dt * 3), ty = top * 0.35;
    view.target[0] += (fr.cx - view.target[0]) * q; view.target[2] += (fr.cz - view.target[2]) * q;
    view.target[1] += (ty - view.target[1]) * q;
    zoomFit += (fr.fit - zoomFit) * q;
    if (Math.abs(fr.cx - view.target[0]) + Math.abs(fr.cz - view.target[2]) + Math.abs(ty - view.target[1]) + Math.abs(fr.fit - zoomFit) < 0.01) follow = preview;
  }
  R.area = [fr.cx, fr.cz, fr.half + 2]; R.top = world.top();
  // (what's drawn of the land: what's built, and never less than the bare land's piece)
  { const [i0, j0, i1, j1] = shown(); R.built = [i0 - CENTER, j0 - CENTER, i1 - CENTER, j1 - CENTER]; }
  { const e = world.extent(); R.landBox = world.land ? [e.i0 - CENTER, e.j0 - CENTER, e.i1 + 1 - CENTER, e.j1 + 1 - CENTER] : [-1e3, -1e3, 1e3, 1e3]; }
  { const b = bleedOn && !!world.land; if (b !== R.bleed) { R.bleed = b; setBleed(b); meshVersion = -1; } }
  if (catsOn) {
    catMemory();
    cats.update(world, dt, !!g && g.mode !== 'turn' && g.mode !== 'look' && g.mode !== 'pending');
    followCat(dt); showCat(); keepCats(now());
  }
  moving(now());
  view.zoom = zoomFit * zoomK;
  // (instant: drawn as if long after, so everything's already risen)
  R.draw(view, now() + (instant ? 1e3 : 0), Math.min(2, devicePixelRatio || 1));
  // (the guides, only while a finger's down: the stroke traced, in faint ink)
  g2.clearRect(0, 0, guide.clientWidth, guide.clientHeight);
  // (held still long enough on a stroke, or a tap, that could be read another way: the readings fan out)
  if (g && !fan && !g.offered && fingers.size === 1 && (g.mode === 'trace' || (g.mode === 'pending' && brush === 'auto')) && performance.now() - g.still.t > HOLD) openFan();
  guides();
  drawFan();
  label();
  for (let q = dust.length - 1; q >= 0; q--) {
    const p = dust[q];
    p.life += dt;
    if (p.life > 1.1) { dust.splice(q, 1); continue; }
    if (p.life < 0) continue;
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 12 * dt; p.vx *= 0.97;
    g2.fillStyle = `rgba(150,128,100,${(0.45 * (1 - p.life / 1.1)).toFixed(3)})`;
    g2.beginPath(); g2.arc(p.x, p.y, p.r, 0, Math.PI * 2); g2.fill();
  }
  requestAnimationFrame(frame);
}
// ─── what moves ───
/** `?cats=study`: every pose, side by side (the motion sheet); `?cats=0`: none */
const study = qs.get('cats') === 'study';
const movingOut = new Out();
function moving(t: number) {
  const out = movingOut;
  out.n = 0;
  if (study) {
    const names = Object.keys(POSES) as PoseName[];
    names.forEach((nm, q) => {
      const p = nm === 'walk' ? gait(POSES.walk, t * 1.4) : POSES[nm];
      // (in rows across the screen, side on to it)
      const c = (q % 4) - 1.5, r = Math.floor(q / 4) - 1, sp = Number(qs.get('space') ?? 0.75), ax = Math.SQRT1_2;
      cat(out, { x: c * sp * ax - r * sp * ax, y: 0, z: -c * sp * ax - r * sp * ax, yaw: Number(qs.get('yaw') ?? -Math.PI / 4), pitch: 0, coat: q % 8, tone: 0.5 }, p, { t, breath: t / 3, twitch: 0, flick: 0 });
    });
  }
  if (catsOn) cats.draw(out);
  R.moving(out.data, out.count);
}

// ─── the cats ───
/**
 * The residents (cats.ts): as many as what's built is home for, each with its own ways and favourite places, kept on
 * this device for each piece of land. With the hand brush, a tap on one says who it is and what it's doing, and it can
 * be followed (the eye goes with it, close) until you return to building.
 */
const catsOn = !study && qs.get('cats') !== '0' && !instant;
const cats = new Cats(1);
const catKey = () => `labyrinth.cats.${world.landSeed || 'flat'}`;
let catMemFor = '';
function catMemory() {
  if (catMemFor === catKey() || fixed) return;
  catMemFor = catKey();
  try { cats.remember(JSON.parse(localStorage.getItem(catMemFor) ?? 'null')); } catch { cats.remember(null); }
}
let catSaved = 0;
function keepCats(t: number) { if (fixed || t - catSaved < 12) return; catSaved = t; try { localStorage.setItem(catKey(), JSON.stringify(cats.remembered())); } catch { /* */ } }
const catCard = document.getElementById('catcard')!, catFollowB = document.getElementById('catfollow')!;
/** the cat met (its card showing), and whether the eye's following it */
let met: Cat | null = null, following = false, zoomBefore = 0.64;
const COAT_CSS = ['#c98a4b', '#6d6f73', '#e4d7bf', '#87705a', '#252120', 'linear-gradient(160deg,#c98a4b 45%,#f1ece2 46%)', '#b3b2ae', 'linear-gradient(160deg,#252120 50%,#f1ece2 51%)'];
/** the cat under a point on the screen, if one's close to it */
function catAt(cx: number, cy: number): Cat | null {
  if (!catsOn) return null;
  let best: Cat | null = null, bd = Math.max(20, 26 * (0.2 / Math.max(0.06, zoomK)));
  for (const c of cats.list) {
    if (c.hidden || c.gone) continue;
    const h = cats.headOf(c), [hx, hy] = screenOf(h[0], h[1], h[2]), [bx, by] = screenOf(c.x, c.y + 0.1, c.z);
    const d = Math.min(Math.hypot(hx - cx, hy - cy), Math.hypot(bx - cx, by - cy));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function meet(c: Cat | null) {
  met = c;
  catCard.classList.toggle('on', !!c);
  if (!c) { if (following) unfollow(); return; }
  (catCard.querySelector('.coat') as HTMLElement).style.background = COAT_CSS[c.coat];
  (catCard.querySelector('.coat') as HTMLElement).title = COATS[c.coat];
  document.getElementById('catname')!.textContent = c.name;
  showCat();
}
function showCat() {
  if (!met) return;
  const el = document.getElementById('catdoing')!, t = met.doing || 'about';
  if (el.textContent !== t) el.textContent = t;
  catFollowB.textContent = following ? '‹ Return to building' : 'Follow ›';
}
function unfollow() { following = false; document.body.classList.remove('following'); zoomK = zoomBefore; follow = true; showCat(); }
catFollowB.addEventListener('click', () => { if (following) { unfollow(); return; } following = true; zoomBefore = zoomK; document.body.classList.add('following'); showCat(); });
document.getElementById('catclose')!.addEventListener('click', () => meet(null));
/** while following: the eye goes with the cat, close */
function followCat(dt: number) {
  if (!met || !following) return;
  if (met.gone) { meet(null); return; }
  const q = 1 - Math.exp(-dt * 4), y = met.y + 0.15;
  view.target[0] += (met.x - view.target[0]) * q; view.target[1] += (y - view.target[1]) * q; view.target[2] += (met.z - view.target[2]) * q;
  zoomK += (0.13 - zoomK) * q;
  follow = false;
}
// (`?catsat=s`: the cats' lives run on that long before it's shown, for a picture)
if (catsOn) { catMemory(); if (qs.has('catsat')) cats.run(world, Number(qs.get('catsat'))); }

// (`?at=i.j`: looking at that cell, not framing it all)
if (qs.has('at')) { const [i, j] = qs.get('at')!.split('.').map(Number); view.target = [i + 0.5 - CENTER, world.top() * 0.35, j + 0.5 - CENTER]; zoomFit = framing().fit; follow = false; }
requestAnimationFrame(frame);

(window as unknown as { __labyrinth: unknown }).__labyrinth = {
  get world() { return world; }, view, R, pick, onPlane, inStone: (x: number, y: number, z: number) => inStone(world, x, y, z), inLand: (x: number, y: number, z: number) => inLand(world, x, y, z), setHand: (h: Hand | Dressing | Brush) => setBrush(h), setBrush,
  get brush() { return brush; }, get held() { return held; }, get intent() { return intent; }, setIntent,
  cats: () => cats.list.map((c) => ({ name: c.name, coat: COATS[c.coat], doing: c.doing, x: c.x, y: c.y, z: c.z, at: c.at, want: c.want, air: c.air })), catScreen: (name: string) => { const c = cats.list.find((q) => q.name === name); if (!c) return null; const h = cats.headOf(c); return screenOf(h[0], h[1] - 0.04, h[2]); }, catsHome: () => cats.P?.capacity ?? 0,
  fan: () => (fan ? { labels: fan.list.map((f) => f.label), at: fan.at } : null), get gesture() { return g ? { mode: g.mode, id: g.id, rest: g.rest.length } : null; },
  release: () => { const op = held_back.shift(); if (op) world.apply(op, now()); return !!op; }, catsRun: (s: number) => cats.run(world, s),
  meet: (name: string) => meet(cats.list.find((c) => c.name === name) ?? null), get following() { return following; }, follow: () => { if (met && !following) catFollowB.click(); }, catAt,
  selection: () => (sel ? { title: sel.s.title, readings: sel.s.readings.map((r) => r.label), at: sel.s.at, whole: sel.idx, cells: sel.s.cells.length } : null),
  switchReading, takeAway, dressSel, alts: () => (altsNow ? { labels: altsNow.list.map((a) => a.label), at: altsNow.at } : null), readAs, declines: () => declines.slice(), motifs: () => motifsNow().map((m) => ({ kind: m.kind, label: m.label, cells: m.cells.length })),
  probe: () => ({ ops: world.ops.length, top: world.top(), stone: world.mass.size, stairs: world.stairs.size, piers: world.piers.size, arches: world.spans.length, courts: world.courts.size, decor: world.decor.length, whys: world.ops.map((o) => o.why ?? '') }),
  /** where a point of the room is on the screen (css pixels): a cell (i, j), at height y, fractions toward its sides */
  screenOf: (i: number, j: number, y: number) => screenOf(i - CENTER + 0.5, y, j - CENTER + 0.5),
};
