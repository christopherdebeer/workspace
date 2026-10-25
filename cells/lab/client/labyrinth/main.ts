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
 * `?ops=` (operations, as the model writes them) · `?brush=` · `?sheet` · `?select=k.i.j[&whole]` · `?print` (the layers in hand) · `?paper` · `?marks` (the drawing's marks by why they're there) · `?turn=` ·
 * `?zoom=` · `?plan=0.5` (squeezed in plan: a half-grid world seen in its own proportions, for looking only; static/labyrinth-grid.md) · `?preview` · `?still` · `?held` (the view never reframes on its own) · `?look=picture` · `?built= ?terrain= ?water= ?colour= ?colourreach= ?shade= ?cast= ?hollow= ?landlight= ?lightreach= ?lines= ?edges= ?inkreach= ?inkfade= ?under= ?toward=` (the dials: picture and drawing, judged apart) · `?instant` (no rising, no gliding, no dust, no cats: for pictures taken by a slow
 * renderer, where every transition is frames it hasn't time for)
 */
import { CENTER, World, inGrid, key, replay, unkey, type Alt, type Cell, type Op } from './model';
import { STRIDE, buildMesh, drawnBox, inLand, inStone, setBleed } from './mesh';
import { STROKE_STRIDE } from './strokes';
import { Renderer, camera, invert, type View } from './render';
import { asDrawn, carve, lift, stroke, surface, tap, touch, trace, type Intent, type Pick } from './gesture';
import { story } from './demo';
import { randomSeed } from '../kit/rng';
import { DRESSINGS, PIECES, dress, dressAt, place, placeOr, run, type Dressing, type Hand, type Piece } from './palette';
import { around, motifs, type Motif } from './motifs';
import { selectCell, selectMotif, selectStructure, type Selection } from './select';
import { DIRS } from './model';
import { Out, POSES, cat, gait, type PoseName } from './catbody';
import { COATS, Cats, type Cat } from './cats';
import { perf } from './perf';
import { HOUSE, PRESETS, address, layersPalette, type Dials } from './layers';
import { ORDER, setRegions, type GrammarId, type RegionMode } from './regions';

const qs = new URLSearchParams(location.search);
/** `?region=`: the land held to one tradition (mediterranean, persian, timber, eaves), or `mixed`, districts of the first
 * two (regions.ts); unset, the land's own */
{ const r = qs.get('region'); if (r === 'mixed' || ORDER.includes(r as GrammarId)) setRegions(r as RegionMode); }
const preview = qs.has('preview'), still = qs.has('still'), instant = qs.has('instant'), heldView = qs.has('held');
const canvas = document.getElementById('stone') as HTMLCanvasElement, guide = document.getElementById('guide') as HTMLCanvasElement;
const g2 = guide.getContext('2d')!;
const R = new Renderer(canvas);
// (`?paper`: the whole of it drawn on the paper, as one fixed look, for the harnesses; `?print` opens print, below)
R.print = qs.has('paper');
R.marks = qs.has('marks');
R.clay = qs.has('clay');
// (the dials, to judge the picture and the drawing apart, each a layer's strength or its reach (layers.ts): the colour,
// `?built=`, `?terrain=`, `?water=` 0–1 (`?colour=`, or `color`, all; the water as the land unless set) and
// `?colourreach=`; the light by kind, `?shade= ?cast= ?hollow=` 0–2, `?landlight=` the land's share of its shade and
// hollows, `?lightreach=`; the ink, `?lines=` (the marks, and the contours and hatching laid into the picture),
// `?edges=` (the outlines), `?inkreach=`, `?inkfade=` 0 thinning out, 1 fading; `?under=` how much of the drawing lies
// under the picture; `?toward=` how far everything's taken to the page. The reaches are multiples (1 as it was). Unset,
// they're at the house setting (static/labyrinth-look.md, "The house setting"); `?look=picture`: the whole picture as
// it's lit, every dial at its plain value)
{
  const dial = (k: string, lo: number, hi: number) => { const v = Number(qs.get(k)); return qs.has(k) && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
  const base = qs.get('look') === 'picture' ? PRESETS.picture : HOUSE;
  // (the older dials still read: \`?shadow=\` every kind of light at once, \`?landshadow=\` the land's share of it, \`?fade=\`
  // every reach at once)
  const colour = dial('colour', 0, 1) ?? dial('color', 0, 1), shadow = dial('shadow', 0, 2), landshadow = dial('landshadow', 0, 2), fade = dial('fade', 0.1, 10);
  const land = dial('terrain', 0, 1) ?? colour ?? base.land;
  R.dials = {
    built: dial('built', 0, 1) ?? colour ?? base.built, land, water: dial('water', 0, 1) ?? (colour ?? dial('terrain', 0, 1) ?? base.water),
    colourreach: dial('colourreach', 0.1, 10) ?? fade ?? base.colourreach,
    shade: dial('shade', 0, 2) ?? shadow ?? base.shade, cast: dial('cast', 0, 2) ?? shadow ?? base.cast, hollow: dial('hollow', 0, 2) ?? shadow ?? base.hollow,
    landlight: dial('landlight', 0, 2) ?? (landshadow !== null ? landshadow / Math.max(shadow ?? 1, 0.05) : base.landlight),
    lightreach: dial('lightreach', 0.1, 10) ?? fade ?? base.lightreach,
    lines: dial('lines', 0, 1) ?? base.lines, edges: dial('edges', 0, 1) ?? base.edges, inkreach: dial('inkreach', 0.1, 10) ?? fade ?? base.inkreach, inkfade: dial('inkfade', 0, 1) ?? base.inkfade,
    under: dial('under', 0, 1) ?? base.under, toward: dial('toward', 0, 1) ?? base.toward,
  };
}
R.shadows = !qs.has('noshadow');
// (the land as Taohua draws its hill: the open ground the paper itself, only its features drawn, bleeding into the page,
// no plinth; `?plinth`: on its plinth instead. The flat slab is always a slab on its table)
const bleedOn = !qs.has('plinth') || qs.has('bleed');
R.msaa = qs.has('msaa');

// ─── what's built ───
const KEY = 'labyrinth.v3';
/** `?grid=half`: a new world on the half grid (each cell four squares in plan: static/labyrinth-grid.md); one kept on
 * the other grid is set aside for a new one */
const gridBay = qs.get('grid') === 'half' ? 2 : 1;
let world: World;
if (preview) world = story(4);
else if (qs.has('story')) world = story(Number(qs.get('story')));
else if (qs.has('ops')) world = replay(qs.get('ops')!);
else if (qs.has('land')) world = new World(1, Number(qs.get('land')) || 1, gridBay);
// (what was built here last, kept; or, the first time, a new piece of land (`?flat`: the flat slab, kept the same way))
else {
  let kept = ''; try { kept = localStorage.getItem(KEY) ?? ''; } catch { /* */ }
  world = kept ? replay(kept) : new World(1, qs.has('flat') ? 0 : randomSeed(), gridBay);
  if (qs.has('flat') && world.land) world = new World(1, 0, world.bay);
  if (qs.has('grid') && world.bay !== gridBay) world = new World(1, qs.has('flat') ? 0 : randomSeed(), gridBay);
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
/** how long a remesh takes (building the mesh, handing it to the GPU): the last, the slowest, and how many */
const meshTimes = { last: 0, upload: 0, max: 0, n: 0 };
/** whether the ground's been taken as it was (while drawing), and is still to be worked out again */
let groundStale = false;
/**
 * What's drawn squeezed in plan, its storeys as tall as they were: a world on the half grid seen in its own proportions
 * (a square half a cell). Built and struck in its own squares (the grid), drawn and seen in cells (the room): `plan()`
 * the room's size of a square; a touch's ray taken into the grid's (`pick`, `onPlane`), and a square's place out to the
 * screen (`screenOf`). `?plan=` sets it, to look at a world as if it were on the other grid.
 */
const plan = () => (qs.has('plan') ? Number(qs.get('plan')) : 1 / world.bay);
function squeeze(m: ReturnType<typeof buildMesh>) {
  const planScale = plan();
  if (planScale === 1) return m;
  const mesh = (a: Float32Array, n: number) => { const o = a.slice(); for (let q = 0; q < n; q++) { const b = q * STRIDE; o[b] *= planScale; o[b + 2] *= planScale; const nx = o[b + 3] / planScale, nz = o[b + 5] / planScale, l = Math.hypot(nx, o[b + 4], nz) || 1; o[b + 3] = nx / l; o[b + 4] /= l; o[b + 5] = nz / l; } return o; };
  const st = m.strokes.slice(); for (let q = 0; q < st.length; q += STROKE_STRIDE) { st[q] *= planScale; st[q + 2] *= planScale; st[q + 3] *= planScale; st[q + 5] *= planScale; }
  return { ...m, data: mesh(m.data, m.count), ground: m.ground ? mesh(m.ground, m.ground.length / STRIDE) : m.ground, strokes: st };
}
function remesh(keepGround = false) { const ks = selKeys(), t0 = performance.now(), m = squeeze(buildMesh(world, plain, ks, keepGround)), t1 = performance.now(); groundStale = keepGround; R.upload(m); meshVersion = world.version; meshSel = [...ks].join(','); const t2 = performance.now(); meshTimes.last = t1 - t0; meshTimes.upload = t2 - t1; perf.add('mesh.build', t1 - t0); perf.add('mesh.upload', t2 - t1); perf.tag('remesh'); meshTimes.max = Math.max(meshTimes.max, t1 - t0); meshTimes.n++; }

// ─── how it's seen ───
const corner = (k: number) => Math.PI / 4 + (k * Math.PI) / 2;
const view: View = { az: corner(Number(qs.get('turn') ?? 0)), el: Number(qs.get('el') ?? 0.6), zoom: 1, target: [0, 0, 0] };
let zoomK = Number(qs.get('zoom') ?? 0.64), azGoal: number | null = null;
/** the drawing's resolution, as a share of the screen's (the profile sweep tries less) */
let resScale = 1;
function resize() { perf.tag('resize'); perf.time('resize', resizeNow); }
function resizeNow() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr * resScale); canvas.height = Math.round(canvas.clientHeight * dpr * resScale);
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
  const B = world.bay, mid = world.land ? (world.land.box.i0 + world.land.box.i1 + 1) / 2 : CENTER * B;
  let i0 = mid - 3.5 * B, i1 = mid + 3.5 * B, j0 = mid - 3.5 * B, j1 = mid + 3.5 * B;
  for (const m of [world.mass, world.stairs, world.piers, world.pools, world.basins, world.paving]) for (const v of m.keys()) { const [, i, j] = unkey(v); i0 = Math.min(i0, i); i1 = Math.max(i1, i + 1); j0 = Math.min(j0, j); j1 = Math.max(j1, j + 1); }
  return (shownBox = [i0, j0, i1, j1]);
}
/**
 * How far each point of the land is from what's built, for the drawing to gather round (render.ts `focus`): two texels
 * a cell over the land, each the distance in cells to the nearest built column (a chamfer: a pass down and a pass back),
 * as a byte, 32 cells at most. With nothing built yet, round the middle of the bare land's piece.
 */
let focusOf: World | null = null, focusAt = -1, focusBled = false;
function focusOn() {
  if (focusOf === world && focusAt === world.version && focusBled === R.bleed) return;
  focusOf = world; focusAt = world.version; focusBled = R.bleed;
  if (!world.land) return;
  const e = drawnBox(world), S = 2, W = (e.i1 + 1 - e.i0) * S, H = (e.j1 + 1 - e.j0) * S, d = new Float32Array(W * H).fill(1e9);
  const cols = new Set<number>();
  // (what's built: stone, stairs, piers, and the water and the paving the hand laid: a pool, a basin, a way's ground)
  for (const m of [world.mass, world.stairs, world.piers, world.pools, world.basins, world.paving]) for (const v of m.keys()) { const [, i, j] = unkey(v); cols.add(j * 4096 + i); }
  if (!cols.size) { const B = world.bay, mid = (world.land.box.i0 + world.land.box.i1 + 1) / 2; for (let i = Math.floor(mid - 1.5 * B); i < mid + 1.5 * B; i++) for (let j = Math.floor(mid - 1.5 * B); j < mid + 1.5 * B; j++) cols.add(j * 4096 + i); }
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) if (cols.has((e.j0 + Math.floor(b / S)) * 4096 + e.i0 + Math.floor(a / S))) d[b * W + a] = 0;
  const D = Math.SQRT2, at = (a: number, b: number) => (a < 0 || b < 0 || a >= W || b >= H ? 1e9 : d[b * W + a]);
  for (let b = 0; b < H; b++) for (let a = 0; a < W; a++) d[b * W + a] = Math.min(d[b * W + a], at(a - 1, b) + 1, at(a, b - 1) + 1, at(a - 1, b - 1) + D, at(a + 1, b - 1) + D);
  for (let b = H - 1; b >= 0; b--) for (let a = W - 1; a >= 0; a--) d[b * W + a] = Math.min(d[b * W + a], at(a + 1, b) + 1, at(a, b + 1) + 1, at(a + 1, b + 1) + D, at(a - 1, b + 1) + D);
  const field = new Uint8Array(W * H);
  // (in cells, as the drawing reads it; placed in the room)
  for (let q = 0; q < W * H; q++) field[q] = Math.round(Math.min(32, d[q] / S / world.bay) / 32 * 255);
  const s = plan();
  R.focus(field, W, H, [(e.i0 - CENTER) * s, (e.j0 - CENTER) * s, (e.i1 + 1 - CENTER) * s, (e.j1 + 1 - CENTER) * s]);
}
/** the box the view frames (cells, far sides exclusive): on land, what's drawn and the drawing's fade round it; on the slab, the slab */
function frameBox(): [number, number, number, number] {
  const e = world.extent();
  if (!world.land) return [e.i0, e.j0, e.i1 + 1, e.j1 + 1];
  const [i0, j0, i1, j1] = shown(), m = 3 * world.bay;
  return [Math.max(e.i0, i0 - m), Math.max(e.j0, j0 - m), Math.min(e.i1 + 1, i1 + m), Math.min(e.j1 + 1, j1 + m)];
}
/** what the view frames: the slab, however big it's grown, or on land what's drawn of it (its middle, and how far to stand back to see it) */
function framing() {
  const [bi0, bj0, bi1, bj1] = frameBox(), e = { i0: bi0, i1: bi1 - 1, j0: bj0, j1: bj1 - 1 };
  // (squeezed in plan (`?plan=`), framed as it's drawn)
  const planScale = plan(), half = ((Math.max(e.i1 - e.i0, e.j1 - e.j0) / 2) * planScale + 1.5) * Math.SQRT2, top = world.top();
  // (as wide as the slab, and as tall as what's on it: there's no cap on how high it goes)
  const fit = Math.max(Math.max(half / aspect, half * 0.75) * 1.04 + top * 0.25, (half * Math.sin(view.el) + top * Math.cos(view.el)) * 0.55 + 1);
  return { cx: ((e.i0 + e.i1 + 1) / 2 - CENTER) * planScale, cz: ((e.j0 + e.j1 + 1) / 2 - CENTER) * planScale, fit, half };
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
  // (the ray taken into the grid's squares: unsqueezed in plan)
  const r = ray(cx, cy), s = plan(), a = [r.a[0] / s, r.a[1], r.a[2] / s], dl = Math.hypot(r.d[0] / s, r.d[1], r.d[2] / s), d = [r.d[0] / s / dl, r.d[1] / dl, r.d[2] / s / dl], L = r.L * dl, topY = w.top() + 1;
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
  const t = (y - a[1]) / d[1], s = plan(), x = (a[0] + d[0] * t) / s, z = (a[2] + d[2] * t) / s;
  const i = Math.floor(x + CENTER), j = Math.floor(z + CENTER);
  return inGrid(i, j) ? [i, j] : null;
}
/** where a point is on the screen (css pixels): given in the grid's squares (x and z from CENTER), squeezed into the
 * room as it's drawn */
function screenOf(x: number, y: number, z: number): [number, number] {
  const r = canvas.getBoundingClientRect(), m = camera(view, r.width / r.height).vp, s = plan(), p = [x * s, y, z * s, 1];
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
// (it opens in the hand: looking, turning, taking things up, before building)
let brush: Brush = 'hand', held: Piece | Dressing = 'block', lastDress: Dressing = 'moss';
const isDress = (h: string): h is Dressing => (DRESSINGS as string[]).includes(h);
/** a brush (or anything the old palette called a hand: a piece puts that piece in the piece brush) */
function setBrush(h: string) {
  if (h === 'hand' || h === 'auto' || h === 'take' || h === 'select') brush = h;
  else if (h === 'piece') brush = 'piece';
  else if ((PIECES as string[]).includes(h) || isDress(h)) { brush = 'piece'; held = h as Piece | Dressing; if (isDress(h)) lastDress = h; }
  // (what's taken up stays taken up in the hand and in select: only building puts it down)
  if (brush !== 'select' && brush !== 'hand') unselect();
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
  /** refused, what it could be instead: held, they're offered, none taken unasked */
  instead?: Alt[];
  /** the stroke read in full (its other kind of reading too), for when it's held */
  full?: () => Op | null;
  /** where the finger paused on the way, and when it last moved */
  rest: Array<[number, number]>; moved: number;
  /** whether it's lifting (or lowering) the stone it started on: drawn straight up or down the screen from it; and what
   * it pulls (what was selected when it began, or the part touched) */
  lifting?: boolean; pulls?: 'part' | Array<[number, number]>;
  /** for each column crossed, the point of the stroke it was crossed at (what a brush took in, before it turned to lift) */
  cellPt?: number[];
  /** where the finger last came to rest, and when (for holding still to choose); whether it's been offered */
  still: { x: number; y: number; t: number; f?: number }; offered?: boolean;
};
let g: Gesture | null = null;
const fingers = new Map<number, { x: number; y: number }>();
let pinch0 = 0, zoom0 = 1, mid0 = 0, midY0 = 0;
const SAYS: Record<Exclude<Hand, 'auto'>, string> = { block: 'a block stands on the stone, or on stone', wall: 'a wall stands on the stone, or on stone, or runs out from a side', arch: 'an arch stands on the stone, or on stone', stair: 'a stair wants a floor to start from', bridge: 'a bridge goes across a gap, from stone to stone level with it', cypress: 'a cypress wants a floor, and room above it', pool: 'a pool is let into the ground, or into a top', take: 'nothing there to take' };
const bar = document.getElementById('hands')!, sheet = document.getElementById('sheet')!, pieceB = bar.querySelector('[data-brush="piece"]') as HTMLElement;
/**
 * What auto's strokes are for isn't said ahead: each is read from where it's drawn (`stroke`, `touch` in gesture.ts),
 * mass or a way, the other kind offered with it. `?intent=mass|way` holds one fixed, for the harnesses.
 */
let intent: Intent | null = qs.get('intent') === 'mass' || qs.get('intent') === 'way' ? (qs.get('intent') as Intent) : null;
function setIntent(v: Intent | null) { intent = v; hint(); }
const tapNow = (p: Pick) => perf.time('gesture.tap', () => (intent ? tap(world, p, now(), false, intent) : touch(world, p, now())));
function showBrush() {
  document.body.classList.toggle('auto', brush === 'auto');
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
  hand: () => 'drag to turn it · tap to take something up, again for more of it · or to meet a cat',
  auto: () => 'tap raises · trace builds, connects and climbs · hold at the end to read it otherwise',
  piece: () => (isDress(held) ? `${held}: tap a stone, or stroke over stones, to dress them` : `${held}: tap to put one · trace for a run of them`),
  take: () => 'tap takes a piece away · trace carves through',
  select: () => 'tap something to take it up · tap again for the whole of it',
};
function hint(text?: string) {
  const el = document.getElementById('hint')!;
  el.textContent = text ?? (brush === 'hand' && !sel && world.ops.length === 0 ? 'tap to take something up · drag to turn · auto to build' : brush !== 'auto' ? '' : world.ops.length === 0 ? (world.land ? 'tap the ground to raise it · trace from place to place for a way' : 'tap the stone to raise it · trace to build') : world.ops.length < 4 ? 'trace from a top to reach out · trace up to a higher top to climb' : '');
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
function selectAt(p: Pick, quiet = false): boolean {
  const c = cellOf(p), same = sel && sel.cell.every((v, q) => v === c[q]);
  if (same && sel) {
    // (again: the next scope out, round to the piece)
    for (let n = 1; n <= sel.whole.length + 2; n++) {
      const idx = ((sel.idx + 1 + n) % (sel.whole.length + 2)) - 1, s = scopeAt(c, sel.whole, idx);
      if (s) { sel = { ...sel, idx, s, switched: null }; showSel(); return true; }
    }
  }
  const whole = around(motifsNow(), c);
  for (let idx = p.face === 'ground' ? 0 : -1; idx <= whole.length; idx++) {
    const s = scopeAt(c, whole, idx);
    if (s) { sel = { cell: c, whole, idx, s, switched: null }; showSel(); return true; }
  }
  unselect(); if (!quiet) say('nothing there to take up');
  return false;
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
/** whether the card's details are open (kept from one selection to the next): shut, it's only what's taken up, and the
 * selection holds all the same */
let detailed = false;
function showSel() {
  document.body.classList.toggle('selecting', !!sel && detailed);
  card.classList.toggle('on', !!sel);
  card.classList.toggle('detailed', detailed);
  (card.querySelector('#more') as HTMLElement).setAttribute('aria-expanded', String(detailed));
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
for (const el of [card.querySelector('#more')!, card.querySelector('#what')!]) el.addEventListener('click', () => { detailed = !detailed; showSel(); });
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
  if (g.mode === 'trace' && !g.op && g.instead?.length) return g.instead.map((a) => ({ label: a.label, op: strip(a.op) }));
  if (g.mode === 'trace' && g.full && g.op) { const f = g.full(); if (f?.alts?.length) g.op = { ...g.op, alts: f.alts }; g.full = undefined; }
  if (g.mode === 'trace' && g.op?.alts?.length) return [{ label: g.op.reading ?? g.op.note ?? 'as drawn', op: strip(g.op) }, ...g.op.alts.map((a) => ({ label: a.label, op: strip(a.op) }))];
  if (g.mode === 'pending' && g.start && brush === 'auto') {
    const r = tapNow(g.start);
    if (!r) return null;
    const first = 'refused' in r ? null : r, list = [...(first ? [{ label: first.reading ?? first.note ?? 'raised', op: strip(first) }] : []), ...(r.alts ?? []).map((a) => ({ label: a.label, op: strip(a.op) }))];
    return list.length > 1 || (!first && list.length) ? list : null;
  }
  return null;
}
function openFan() {
  if (!g) return;
  // (offered once a gesture; nothing to offer yet (a touch with one reading, say) isn't the offer)
  const list = readingsNow(), f = fingers.get(g.id);
  if (!list || !f) return;
  g.offered = true;
  const tapped = g.mode === 'pending';
  if (tapped) world.apply(list[0].op, now());
  // (a stroke refused: what it could be instead, the first of them laid while they're out)
  else if (!g.op) lay(list[0].op);
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
  if (!fan.tap && (d > BEYOND || (d > 60 && best > 0.6))) { choose(0); fan = null; if (g) g.still = { x: cx, y: cy, t: performance.now(), f: frameNo }; return false; }
  // (a touch held, its readings fanned out, then drawn away well past them: it wasn't a touch, it's a stroke)
  if (fan.tap && d > 90) { if (g && world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); } fan = null; if (g) { g.offered = true; g.laid = ''; g.still = { x: cx, y: cy, t: performance.now(), f: frameNo }; } return false; }
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
function traceStep(cx: number, cy: number, final: boolean) { perf.time(final ? 'gesture.release' : 'gesture.trace', () => traceStepNow(cx, cy, final)); }
function traceStepNow(cx: number, cy: number, final: boolean) {
  if (!g?.start) return;
  if (!g.before) {
    // (read against the world as it was before this stroke: a copy, so picking never strikes the stroke's own stone)
    g.before = new World(world.seed, world.landSeed, world.bay); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now());
    g.h0 = surface(g.before, g.start); g.cells = [[g.start.hit[1], g.start.hit[2]]]; g.cellPt = [0]; g.born = now();
  }
  const before = g.before;
  g.pts.push([cx, cy]);
  // (the columns crossed: on the plane the stroke starts from, each fixed once the finger's passed it)
  const c = onPlane(cx, cy, g.h0!), last = g.cells[g.cells.length - 1];
  // (the finger still a while, on the way: a pause where it is)
  const t = performance.now();
  if (!final && g.moved && t - g.moved > PAUSE && g.cells.length > 1 && !g.rest.some((r) => r[0] === last[0] && r[1] === last[1])) { g.rest.push(last); say('a pause: a gate here, or a landing'); }
  g.moved = t;
  if (c && (c[0] !== last[0] || c[1] !== last[1])) { g.cells.push(c); g.cellPt?.push(g.pts.length - 1); }
  // (stone touched and drawn straight up or down the screen, the way no stroke across the ground goes: it's lifted, or
  // lowered, a course for each course's height the finger's gone, there under the finger as it goes)
  if (g.mode === 'trace' && g.start.face !== 'ground') {
    const [k0, i0, j0] = g.start.hit, a = at3(i0 + 0.5, j0 + 0.5, k0 + 1), b = at3(i0 + 0.5, j0 + 0.5, k0 + 2), per = Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1]));
    // (a brush, then a lift: the stroke run across the top first takes in what it passes over, at the height it began;
    // then, turned straight up or down the screen, lifts (or lowers) that. Where the run up or down began)
    let t = g.pts.length - 1;
    while (t > 0) { const [px, py] = g.pts[t - 1]; if (Math.abs(cx - px) > Math.abs(cy - py) * 0.3 + 4) break; t--; }
    const brushed = g.start.face === 'top' && t > 0 && !g.lifting ? g.cells.filter((c, n) => (g!.cellPt?.[n] ?? 0) <= t && before.topFrom(before.ground(c[0], c[1]) - 1, c[0], c[1]) === g!.h0) : [];
    const brush = brushed.length >= 2 ? brushed : null;
    const [ox, oy] = brush ? g.pts[t] : [g.x0, g.y0];
    const dx = cx - ox, dy = cy - oy, upright = Math.abs(dy) >= per * 0.6 && Math.abs(dx) <= Math.abs(dy) * 0.3;
    // (lowering only while the finger's still on the stone it lowers, its face or its top: a stroke that runs on down the
    // screen out over the land is going somewhere, however the view's turned; and one that ends on the ground at its foot
    // is a way down to there (after the authored reviews: a block's foot is where a way down off it ends), never the
    // block taken away. Raising goes up into what's behind, so it's not held to that)
    const under = pick(cx, cy, before), lowered = brush ?? [[i0, j0]];
    const onIt = !under ? dy <= 0 : under.face !== 'ground' && lowered.some(([x, z]) => under.hit[1] === x && under.hit[2] === z);
    if (dy > 0 && !onIt) g.lifting = false;
    // (a side grabbed is always lifted; from a top, only with mass in hand, and not if it's come to rest on another top:
    // that's a stroke to it. A way drawn up the screen from a top goes somewhere)
    const there = final ? null : pick(cx, cy, before), other = !!goal(there) && (there?.inset ?? 0) >= SQUARE;
    const may = g.start.face === 'side' || (intent !== 'way' && !other);
    // (and letting go never turns a stroke into a lift it wasn't already: what was shown under the finger is what's built)
    if (may && (upright || g.lifting) && (dy <= 0 || onIt) && (!final || g.lifting)) {
      if (brush && !g.lifting) { g.pulls = brush; g.x0 = ox; g.y0 = oy; }
      const n = Math.round(-(cy - g.y0) / per);
      g.lifting = upright || Math.abs(cx - g.x0) <= Math.abs(cy - g.y0) * 0.45;
      if (g.lifting) {
        g.pulls ??= sel ? [...new Map(sel.s.cells.map(([, i, j]) => [`${i}.${j}`, [i, j] as [number, number]])).values()] : 'part';
        const r = lift(before, g.start, n, g.born, g.pulls);
        let op = r && !('refused' in r) ? r : null;
        // (said as it's read, not only when refused: a lowering under the finger is named before it's let go)
        const said = r && 'refused' in r ? r.refused : op?.note ?? '';
        if (said && said !== g.said) say(said);
        g.said = said;
        // (lowered, on letting go: the stroke read as going somewhere (a way down to where it ended) offered with it, so a
        // way meant isn't only to be had by undoing a block taken away)
        if (final && op && n < 0) {
          const seen = (i: number, j: number) => g!.seen.get(`${i}.${j}`) ?? now(), go = intent ? trace(before, g.start, g.cells, g.target, seen, g.born, g.rest, intent) : stroke(before, g.start, g.cells, g.target, seen, g.born, g.rest, true);
          if (go && !('refused' in go)) op = { ...op, alts: [{ label: go.reading ?? go.note ?? 'a way down to there', op: { ...go, alts: undefined } }, ...(op.alts ?? [])] };
        }
        lay(op); g.op = op;
        if (final && op) { settle([...(op.add ?? []), ...(op.walls ?? [])].map((q) => [q[0], q[1], q[2]])); kept(); say(op.alts?.length && heldHints++ < 4 ? `${op.note} · hold at the end to read it otherwise` : op.note ?? ''); showAlts(op, op.alts, g.base); }
        return;
      }
    }
  }
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
  const bornAt = (i: number, j: number) => g!.seen.get(`${i}.${j}`) ?? now(), op = intent ? trace(before, g.start, g.cells, g.target, bornAt, g.born, g.rest, intent) : stroke(before, g.start, g.cells, g.target, bornAt, g.born, g.rest, final);
  if (!intent && !final) { const [s0, c0, t0, b0, r0] = [g.start, g.cells.slice(), g.target, g.born, g.rest.slice()]; g.full = () => { const o = stroke(before, s0, c0, t0, bornAt, b0, r0, true); return o && !('refused' in o) ? o : null; }; }
  const refused = op && 'refused' in op ? op.refused : '';
  g.instead = op && 'refused' in op ? op.alts : undefined;
  if (refused && refused !== g.said) say(g.instead?.length ? `${refused} · hold to ${g.instead[0].label}` : refused);
  if (final && refused) declined('trace', refused);
  let built = op && !('refused' in op) ? op : null;
  // (its jogs run straight: the stroke as drawn, every turn kept, offered next after it (worked out once, on letting go))
  if (final && built?.took?.includes('smoothed')) {
    const exact = asDrawn(before, g.start, g.cells, g.target, bornAt, g.born, g.rest, intent ?? (built.connect ? 'way' : 'mass'));
    if (exact) built = { ...built, alts: [{ label: exact.reading ?? 'as drawn', op: exact }, ...(built.alts ?? [])] };
  }
  // (and what it's read as, as it's drawn: a refusal said while the stroke was still too short to lay anything is
  // replaced once it reads as something, so what's under the finger is what letting go builds)
  const reads = !final && built ? built.reading ?? built.note ?? '' : '';
  if (reads && reads !== g.said) say(reads);
  g.said = refused || reads;
  // (drawn up or down the screen from stone, but read as going somewhere: lifting it, the other reading)
  if (built && g.start.face !== 'ground') {
    const [k0, i0, j0] = g.start.hit, a = at3(i0 + 0.5, j0 + 0.5, k0 + 1), b = at3(i0 + 0.5, j0 + 0.5, k0 + 2), per = Math.max(8, Math.hypot(a[0] - b[0], a[1] - b[1]));
    const dx = cx - g.x0, dy = cy - g.y0;
    if (Math.abs(dy) >= per * 0.6 && Math.abs(dx) <= Math.abs(dy) * 0.3) {
      const n = Math.round(-dy / per), l = lift(before, g.start, n, g.born, g.pulls ?? 'part');
      if (l && !('refused' in l)) built = { ...built, alts: [...(built.alts ?? []), { label: n > 0 ? 'raise it instead' : 'lower it instead', op: { ...l, alts: undefined } }] };
    }
  }
  lay(built);
  if (!built) g.op = null;
  if (final && built) {
    const r = world.reached.get(world.ops[world.ops.length - 1]);
    settle(r?.cells ?? (built.add ?? []).map((q) => [q[0], q[1], q[2]])); kept();
    // (never quietly short: if it stopped on the way, it says where it joined)
    if (r && !r.reached && built.connect?.to) { say(r.stopped > 0 ? 'it joins the stone it meets on the way' : 'nothing to build there'); declined(built.why ?? 'trace', 'stopped short'); }
    // (and one going nowhere in particular that stops short of where the stroke ended: said, not left to be noticed)
    else if (r && !r.reached && built.connect) { say(`${built.note ?? built.why}: it stops short, where what's in its way rises to meet it`); declined(built.why ?? 'trace', 'stopped short'); }
    else if (built.note) say(built.alts?.length && heldHints++ < 4 ? `${built.note} · hold at the end to read it otherwise` : built.note);
    showAlts(built, built.alts, g.base);
  }
}
/** dressing, stroked over stone: each stone the finger passes over */
function paintAt(cx: number, cy: number) {
  if (!g) return;
  const p = pick(cx, cy), c = p && dressAt(g.before ?? world, p, held as Dressing);
  if (c && !g.painted.some((q) => q.every((v, n) => v === c[n]))) g.painted.push(c);
  if (!g.before) { g.before = new World(world.seed, world.landSeed, world.bay); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now()); }
  lay(g.painted.length ? dress(g.before, held as Dressing, g.painted) : null);
}
function carveAt(cx: number, cy: number) {
  if (!g) return;
  const p = pick(cx, cy), c = p && carve(world, p);
  if (!c || g.cut.some((q) => q[0] === c[0] && q[1] === c[1] && q[2] === c[2])) return;
  g.cut.push(c);
  if (world.ops.length > g.base) world.replaceLast({ cut: g.cut.slice(), why: 'carve' }, now()); else world.apply({ cut: g.cut.slice(), why: 'carve' }, now());
}

canvas.addEventListener('pointerdown', perf.wrap('input.down', (e: PointerEvent) => {
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
  g = { id: e.pointerId, start, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: brush === 'hand' || following ? 'look' : !start ? 'turn' : 'pending', pts: [], base: world.ops.length, seen: new Map(), cut: [], painted: [], cells: [], target: null, cand: '', candPick: null, count: 0, laid: '', said: '', born: 0, rest: [], moved: 0, still: { x: e.clientX, y: e.clientY, t: performance.now(), f: frameNo } };
}));
canvas.addEventListener('pointermove', perf.wrap('input.move', (e: PointerEvent) => {
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
  if (Math.hypot(e.clientX - g.still.x, e.clientY - g.still.y) > 7) g.still = { x: e.clientX, y: e.clientY, t: performance.now(), f: frameNo };
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
}));
const up = perf.wrap('input.up', (e: PointerEvent) => {
  fingers.delete(e.pointerId);
  // (let go near a corner, it settles on it; anywhere else, it stays where it was left)
  if (fingers.size === 0) { const c = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2))); azGoal = Math.abs(c - view.az) < 0.22 ? c : null; }
  if (!g || g.id !== e.pointerId) return;
  const cancelled = e.type !== 'pointerup', m = g.mode, start = g.start;
  if (fan && !cancelled) { keepFan(); g = null; return; }
  fan = null;
  if (cancelled && m !== 'turn' && m !== 'look') { if (world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); } g = null; return; }
  const pet = m === 'look' ? catAt(e.clientX, e.clientY) : null;
  // (following one: a tap is where it's shown to go, a tap on it a touch, a tap on another follows that one instead)
  if (m === 'look' && following && met) { if (pet === met) say(cats.pet(met)); else if (pet) meet(pet); else if (start) say(cats.call(met, start.to)); g = null; return; }
  if (pet) meet(pet);
  // (the hand's tap: what's touched taken up (again, more of it); where there's nothing to take up, what it is said; on
  // nothing, what was taken up put down)
  else if (m === 'look' && start) { if (!selectAt(start, true)) say(describe(start)); }
  else if (m === 'look' && !start && !cancelled) unselect();
  else if (m === 'pending' && start) {
    // (a tap: what it does depends on the brush)
    if (brush === 'select') selectAt(start);
    else {
      unselect();
      let op: Op | null = null;
      if (brush === 'auto') {
        const r = tapNow(start);
        // (refused outright (rare now): its first other reading, if it has one, is what's built)
        if (r && 'refused' in r) { declined('tap', r.refused); say(r.alts?.length ? `${r.refused} · hold to ${r.alts[0].label}` : r.refused); g = null; return; }
        op = r;
        if (!op) declined('tap', 'nothing more will stand there');
      }
      else if (brush === 'take') op = place(world, 'take', start, looking(), now());
      else if (isDress(held)) { const c = dressAt(world, start, held); op = c ? dress(world, held, [c]) : null; }
      else op = placeOr(world, held, start, looking(), now());
      // (every tap named: what it raised, or what it did)
      const named = op?.note ?? (op?.why === 'raise' ? 'a block raised' : op?.why === 'course' ? 'a course higher' : '');
      if (op) { world.apply(op, now()); settle([...(op.add ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]])); kept(); if (named) say(op.alts?.length ? `${named} · hold to read it otherwise` : named); }
      else say(brush === 'auto' ? 'nothing more will stand there' : brush === 'take' ? (world.earth(...start.hit) ? 'the land itself stays' : SAYS.take) : isDress(held) ? (held === 'lantern' || held === 'pot' ? 'that wants a top with room over it' : held === 'pergola' ? 'a pergola wants a place to stand, with room over it' : 'dressing goes on stone') : SAYS[held as Piece]);
    }
  } else if (m === 'trace' || m === 'run') { unselect(); traceStep(e.clientX, e.clientY, true); }
  else if (m === 'carve' || m === 'paint') { unselect(); kept(); }
  g = null;
});
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', perf.wrap('input.wheel', (e: WheelEvent) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.max(0.06, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001)))); }), { passive: false });
{ const h = qs.get('hand') ?? qs.get('brush'); if (h) setBrush(h); }
// (for looking at them: `?sheet` opens the piece brush's sheet; `?select=k.i.j` takes up what's there, `&whole` the whole)
if (qs.has('sheet')) { setBrush('piece'); openSheet(true); }
if (qs.has('select')) {
  const [k, i, j] = qs.get('select')!.split('.').map(Number), p: Pick = { face: 'top', hit: [k, i, j], to: [k + 1, i, j] };
  detailed = true; setBrush('select'); selectAt(p); if (qs.has('whole')) selectAt(p);
}

// ─── its buttons ───
/**
 * Print: the brushes give way to the drawing's layers (layers.ts), each touched for its sliders; the stone's only turned
 * and asked about while it's open (the hand), and the brush that was in hand comes back after. The address keeps what's
 * set (`?print` and the dials that differ from the house's).
 */
const printB = document.getElementById('print')!, layersEl = document.getElementById('layers')!;
let printing = false, brushBefore: Brush = 'auto';
const pal = layersPalette(layersEl, () => R.dials as Dials, (d) => { R.dials = d; history.replaceState(null, '', address(d, printing)); });
function setPrinting(on: boolean) {
  if (on === printing) return;
  printing = on;
  document.body.classList.toggle('printing', on);
  printB.classList.toggle('on', on); printB.setAttribute('aria-pressed', String(on));
  if (on) { brushBefore = brush; openSheet(false); setBrush('hand'); pal.refresh(); say('the layers of the print: touch one for its values'); }
  else setBrush(brushBefore);
  history.replaceState(null, '', address(R.dials as Dials, on));
}
printB.addEventListener('click', () => setPrinting(!printing));
document.getElementById('undo')!.addEventListener('click', () => { if (world.undo(now())) { unselect(); kept(); } });
/**
 * Start again: what's built cleared away, back to the land it was on; on bare land already, a new piece of land.
 * (`?flat`, the flat slab, stays flat.)
 */
function startAgain() {
  if (world.ops.length) { if (!confirm(world.land ? 'Clear what\'s built, back to the land?' : 'Clear the stone?')) return; world = new World(world.seed, qs.has('flat') ? 0 : world.landSeed || randomSeed(), world.bay); }
  else world = new World(world.seed, qs.has('flat') ? 0 : randomSeed(), world.bay);
  meshVersion = -1; unselect(); hideAlts(); kept(); follow = true;
  say(world.ops.length ? '' : world.land ? 'a new piece of land' : 'the stone, bare');
}
document.getElementById('again')!.addEventListener('click', startAgain);
showBrush(); hint();
// (once the rest is set up: what it says is further on)
if (qs.has('print')) queueMicrotask(() => setPrinting(true));
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
let last = performance.now(), zoomFit = framing().fit, lastRemesh = 0, lastDrawing = -1e9;
/** frames drawn: a hold is a finger still over several of them as well as for long enough (a slow frame isn't a hold) */
let frameNo = 0;
/** each frame's interval and the time spent in it on the CPU (the last few hundred): what telemetry reports */
const intervals = new Float32Array(600), busy = new Float32Array(600);
function frame() {
  frameNo++;
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000);
  intervals[frameNo % 600] = t - last;
  // (the frame before this one, closed now: from its start to this one's, what it did and whatever came in after it
  // (a pointer's handlers) before this one could begin)
  perf.frame(last, t - last, busy[(frameNo - 1) % 600]);
  last = t;
  // (while a finger's drawing, the mesh is worked out again at most every 140 ms (what the stroke would build is still
  // read at every move); at once when it lifts, or for anything else)
  if (world.version !== meshVersion || [...selKeys()].join(',') !== meshSel) {
    const drawing = !!g && (g.mode === 'trace' || g.mode === 'run' || g.mode === 'paint' || g.mode === 'carve');
    if (drawing) lastDrawing = t;
    // (the ground and its strokes are the slowest part to work out (on a phone, more than a second): while drawing, and
    // just after, kept as they were, so what's built shows at once; worked out again a moment later)
    if (!drawing || t - lastRemesh > 140) { remesh(drawing || t - lastDrawing < 300); lastRemesh = t; } else perf.tag('remesh deferred');
  } else if (groundStale && !g && t - lastDrawing > 300) { remesh(false); perf.tag('ground caught up'); }
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = instant ? 1 : 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  // (it frames what's built when asked to (at the start, the frame button, or when what's built reaches the edge of the
  // screen), and then stays put: the work doesn't shrink away from the hand as it grows, and never moves under a finger)
  const fr = framing();
  if (!g && world.version !== edgeChecked) { edgeChecked = world.version; if (!heldView && offScreen()) follow = true; }
  if (follow && (!g || g.mode === 'turn')) {
    const top = world.top(), q = instant ? 1 : 1 - Math.exp(-dt * 3), ty = top * 0.35;
    view.target[0] += (fr.cx - view.target[0]) * q; view.target[2] += (fr.cz - view.target[2]) * q;
    view.target[1] += (ty - view.target[1]) * q;
    zoomFit += (fr.fit - zoomFit) * q;
    if (Math.abs(fr.cx - view.target[0]) + Math.abs(fr.cz - view.target[2]) + Math.abs(ty - view.target[1]) + Math.abs(fr.fit - zoomFit) < 0.01) follow = preview;
  }
  R.area = [fr.cx, fr.cz, fr.half + 2]; R.top = world.top();
  // (what's drawn of the land: gathered round what's built)
  focusOn();
  { const e = drawnBox(world), s = plan(); R.landBox = world.land ? [(e.i0 - CENTER) * s, (e.j0 - CENTER) * s, (e.i1 + 1 - CENTER) * s, (e.j1 + 1 - CENTER) * s] : [-1e3, -1e3, 1e3, 1e3]; }
  { const b = bleedOn && !!world.land; if (b !== R.bleed) { R.bleed = b; setBleed(b); meshVersion = -1; } }
  if (catsOn) {
    catMemory();
    perf.time('cats', () => { cats.update(world, dt, !!g && g.mode !== 'turn' && g.mode !== 'look' && g.mode !== 'pending'); followCat(dt); showCat(); keepCats(now()); });
  }
  perf.time('cats.draw', () => moving(now()));
  view.zoom = zoomFit * zoomK;
  // (instant: drawn as if long after, so everything's already risen)
  perf.time('draw', () => R.draw(view, now() + (instant ? 1e3 : 0), Math.min(2, devicePixelRatio || 1)));
  // (the guides, only while a finger's down: the stroke traced, in faint ink)
  perf.begin('overlay');
  g2.clearRect(0, 0, guide.clientWidth, guide.clientHeight);
  // (held still long enough on a stroke, or a tap, that could be read another way: the readings fan out)
  if (g && !fan && !g.offered && fingers.size === 1 && (g.mode === 'trace' || (g.mode === 'pending' && brush === 'auto')) && performance.now() - g.still.t > HOLD) openFan();
  guides();
  shownTo();
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
  perf.end();
  busy[frameNo % 600] = performance.now() - t;
  // (what was going on, for telling heavy frames apart)
  if (g) perf.tag(`gesture:${g.mode}`); if (following) perf.tag('following'); if (fingers.size > 1) perf.tag('two fingers'); if (profiling) perf.tag('profiling');
  perfMeter();
  requestAnimationFrame(frame);
}
// ─── the meter (\`?perf\`): where the last two seconds went, on the screen, each phase's mean per frame; heavy frames counted ───
const meterEl = qs.has('perf') ? Object.assign(document.createElement('pre'), { id: 'perfmeter' }) : null;
if (meterEl) { Object.assign(meterEl.style, { position: 'fixed', left: '6px', top: '64px', zIndex: '50', margin: '0', padding: '6px 8px', font: '10px/1.35 ui-monospace,monospace', color: '#2b2420', background: 'rgba(247,242,232,.86)', borderRadius: '6px', pointerEvents: 'none', whiteSpace: 'pre' }); document.body.appendChild(meterEl); }
let meterAt = 0;
function perfMeter() {
  if (!meterEl || performance.now() - meterAt < 250) return;
  meterAt = performance.now();
  const r = perf.recent(2), h = perf.heavy[perf.heavy.length - 1];
  meterEl.textContent = `${r.fps} fps · p95 ${r.p95.toFixed(1)} ms · heavy ${r.heavy}\n` + Object.entries(r.phases).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k.padEnd(8)} ${v.toFixed(2)}`).join('\n') + (h ? `\nlast heavy: ${h.cause} — ${h.why}`.slice(0, 160) : '');
}
// ─── telemetry: a double tap on the title copies what drawing costs on this device, to be pasted where it's needed ───
function telemetry(): string {
  const gl = R.gl, dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const n = Math.min(frameNo, 600), take = (a: Float32Array) => Array.from(a.slice(0, n)).filter((x) => x > 0).sort((p, q) => p - q);
  const stat = (a: number[]) => a.length ? { mean: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2), p50: +a[Math.floor(a.length * 0.5)].toFixed(2), p95: +a[Math.floor(a.length * 0.95)].toFixed(2), p99: +a[Math.floor(a.length * 0.99)].toFixed(2), max: +a[a.length - 1].toFixed(2) } : null;
  const iv = take(intervals), cpu = take(busy);
  return JSON.stringify({
    when: new Date().toISOString(), url: location.search, ua: navigator.userAgent,
    screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio, drawn: [R.canvas.width, R.canvas.height] },
    gl: {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      maxSamples: gl.getParameter(gl.MAX_SAMPLES), msaa: R.msaa, maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      ext: ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_disjoint_timer_query_webgl2', 'OES_texture_float_linear', 'EXT_float_blend'].filter((e) => !!gl.getSupportedExtensions()?.includes(e)),
    },
    frames: { counted: iv.length, fps: iv.length ? +(1000 / stat(iv)!.mean).toFixed(1) : 0, interval: stat(iv), cpuInFrame: stat(cpu), cpuDraw: +R.timing.cpuDraw.toFixed(2) },
    gpu: R.timing.gpu ?? (gl.getExtension('EXT_disjoint_timer_query_webgl2') ? 'timing (needs 30 frames)' : 'not timed here (no EXT_disjoint_timer_query_webgl2)'),
    mesh: { ...R.counts, buildMs: +meshTimes.last.toFixed(1), uploadMs: +meshTimes.upload.toFixed(1), slowestMs: +meshTimes.max.toFixed(1), builds: meshTimes.n },
    world: { ops: world.ops.length, land: world.land ? world.landSeed : null, meetings: world.meetings.length, top: world.top() },
    view: { zoom: +view.zoom.toFixed(3), el: +view.el.toFixed(3), az: +view.az.toFixed(3), shadows: R.shadows, bleed: R.bleed },
    memory: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
    profile: lastProfile ?? 'none yet (long-press the title to run one)',
    perf: perf.report(),
  }, null, 1);
}
/**
 * The profile sweep (a long press on the title): the same view drawn as it is, then with one thing at a time taken
 * away (the sun's map, multisampling, the contact shade, the leaves' cutting, some of the resolution), a few dozen frames
 * each; how long a frame takes in each says what each costs on this device, where the GPU can't be timed directly.
 */
let lastProfile: unknown = null, profiling = false;
async function profileSweep(say: (t: string) => void) {
  if (profiling) return;
  profiling = true;
  const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
  const measure = async () => { for (let q = 0; q < 12; q++) await nextFrame(); const ts: number[] = []; let t0 = await nextFrame(); for (let q = 0; q < 36; q++) { const t = await nextFrame(); ts.push(t - t0); t0 = t; } ts.sort((a, b) => a - b); return { median: +ts[18].toFixed(1), mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1), p90: +ts[32].toFixed(1) }; };
  const configs: Array<[string, () => void, () => void]> = [
    ['as it is', () => {}, () => {}],
    ['no sun map', () => { R.shadows = false; }, () => { R.shadows = !qs.has('noshadow'); }],
    [R.msaa ? 'no multisampling' : 'with multisampling', () => { R.msaa = !R.msaa; }, () => { R.msaa = qs.has('msaa'); }],
    ['no contact shade', () => { R.contact = false; }, () => { R.contact = true; }],
    ['no leaf cutting', () => { R.leafCut = false; }, () => { R.leafCut = true; }],
    ['three-quarter resolution', () => { resScale = 0.75; resize(); }, () => { resScale = 1; resize(); }],
    ['half resolution', () => { resScale = 0.5; resize(); }, () => { resScale = 1; resize(); }],
  ];
  const out: Record<string, unknown> = { drawn: [R.canvas.width, R.canvas.height], vertices: R.counts };
  for (const [n, [name, on, off]] of configs.entries()) { say(`profiling ${n + 1}/${configs.length}`); on(); out[name] = await measure(); off(); }
  lastProfile = out; profiling = false;
  say('profiled · double tap to copy');
}

{
  const title = document.querySelector('nav h1') as HTMLElement | null;
  if (title) {
    title.style.pointerEvents = 'auto'; title.style.touchAction = 'manipulation'; title.style.cursor = 'default'; title.style.userSelect = 'none'; title.style.setProperty('-webkit-user-select', 'none'); title.style.setProperty('-webkit-touch-callout', 'none');
    const small = title.querySelector('small'), was = small?.textContent ?? '';
    let lastTap = 0;
    const copy = async () => {
      const text = telemetry();
      let ok = false;
      // (the clipboard as it's asked for now, given a moment; if it doesn't answer, the older way)
      try { ok = await Promise.race([navigator.clipboard.writeText(text).then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 600))]); } catch { ok = false; }
      if (!ok) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch { ok = false; } ta.remove(); }
      if (small) { small.textContent = ok ? 'telemetry copied' : 'couldn\'t copy'; setTimeout(() => { small.textContent = was; }, 1600); }
    };
    let held: ReturnType<typeof setTimeout> | null = null;
    title.addEventListener('pointerdown', () => { held = setTimeout(() => { held = null; lastTap = 0; void profileSweep((t) => { if (small) small.textContent = t; }); }, 800); });
    title.addEventListener('pointerup', (e) => { if (held) { clearTimeout(held); held = null; } else return; const t = e.timeStamp; if (t - lastTap < 350) { lastTap = 0; void copy(); } else lastTap = t; });
    title.addEventListener('pointercancel', () => { if (held) { clearTimeout(held); held = null; } });
    title.addEventListener('contextmenu', (e) => e.preventDefault());
  }
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
  if (catsOn) cats.draw(out, 1, plan());
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
let met: Cat | null = null, following = false;
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
function unfollow() { following = false; document.body.classList.remove('following'); follow = true; showCat(); }
catFollowB.addEventListener('click', () => { if (following) { unfollow(); return; } following = true; document.body.classList.add('following'); showCat(); say(`tap somewhere to show ${met?.name ?? 'it'} where to go`); });
document.getElementById('catclose')!.addEventListener('click', () => meet(null));
/** while following: where the cat's been shown to go, marked until it's there (dashed: as near as it can get) */
function shownTo() {
  const c = following && met?.call;
  if (!c) return;
  const [x, y] = screenOf(c.x, c.y + 0.02, c.z), r = 7 + 2 * Math.sin(performance.now() / 260);
  g2.strokeStyle = WARM + '.85)'; g2.lineWidth = 1.6; g2.setLineDash(c.short ? [3, 4] : []);
  g2.beginPath(); g2.ellipse(x, y, r * 1.4, r * 0.8, 0, 0, Math.PI * 2); g2.stroke(); g2.setLineDash([]);
  g2.fillStyle = WARM + '.9)'; g2.beginPath(); g2.arc(x, y, 2, 0, Math.PI * 2); g2.fill();
}
/** while following: the eye goes with the cat, kept on it; how close is the hand's (pinch), never taken over */
function followCat(dt: number) {
  if (!met || !following) return;
  if (met.gone) { meet(null); return; }
  const q = 1 - Math.exp(-dt * 4), y = met.y + 0.15;
  const s = plan();
  view.target[0] += (met.x * s - view.target[0]) * q; view.target[1] += (y - view.target[1]) * q; view.target[2] += (met.z * s - view.target[2]) * q;
  follow = false;
}
// (`?catsat=s`: the cats' lives run on that long before it's shown, for a picture)
if (catsOn) { catMemory(); if (qs.has('catsat')) cats.run(world, Number(qs.get('catsat'))); }

// (`?at=i.j`: looking at that cell, not framing it all)
if (qs.has('at')) { const [i, j] = qs.get('at')!.split('.').map(Number); view.target = [(i + 0.5 - CENTER) * plan(), world.top() * 0.35, (j + 0.5 - CENTER) * plan()]; zoomFit = framing().fit; follow = false; edgeChecked = world.version; }
requestAnimationFrame(frame);

(window as unknown as { __labyrinth: unknown }).__labyrinth = {
  telemetry, profileSweep, perf: () => perf.report(), perfReset: () => perf.reset(),
  get world() { return world; }, view, R, pick, onPlane, inStone: (x: number, y: number, z: number) => inStone(world, x, y, z), inLand: (x: number, y: number, z: number) => inLand(world, x, y, z), setHand: (h: Hand | Dressing | Brush) => setBrush(h), setBrush,
  get brush() { return brush; }, get held() { return held; }, get intent() { return intent; }, setIntent,
  cats: () => cats.list.map((c) => ({ name: c.name, coat: COATS[c.coat], doing: c.doing, x: c.x, y: c.y, z: c.z, at: c.at, want: c.want, air: c.air, asleep: c.asleep, call: c.call })), catScreen: (name: string) => { const c = cats.list.find((q) => q.name === name); if (!c) return null; const h = cats.headOf(c); return screenOf(h[0], h[1] - 0.04, h[2]); }, catsHome: () => cats.P?.capacity ?? 0,
  fan: () => (fan ? { labels: fan.list.map((f) => f.label), at: fan.at } : null), get gesture() { return g ? { mode: g.mode, id: g.id, rest: g.rest.length } : null; },
  release: () => { const op = held_back.shift(); if (op) world.apply(op, now()); return !!op; }, catsRun: (s: number) => cats.run(world, s),
  meet: (name: string) => meet(cats.list.find((c) => c.name === name) ?? null), get following() { return following; }, follow: () => { if (met && !following) catFollowB.click(); }, catAt, callTo: (k: number, i: number, j: number) => (met && following ? cats.call(met, [k, i, j]) : null), pet: () => (met ? cats.pet(met) : null),
  selection: () => (sel ? { title: sel.s.title, readings: sel.s.readings.map((r) => r.label), at: sel.s.at, whole: sel.idx, cells: sel.s.cells.length } : null),
  switchReading, takeAway, dressSel, alts: () => (altsNow ? { labels: altsNow.list.map((a) => a.label), at: altsNow.at } : null), readAs, declines: () => declines.slice(), motifs: () => motifsNow().map((m) => ({ kind: m.kind, label: m.label, cells: m.cells.length })),
  probe: () => ({ ops: world.ops.length, top: world.top(), stone: world.mass.size, stairs: world.stairs.size, piers: world.piers.size, arches: world.spans.length, courts: world.courts.size, decor: world.decor.length, whys: world.ops.map((o) => o.why ?? '') }),
  /** where a point of the room is on the screen (css pixels): a cell (i, j), at height y, fractions toward its sides */
  screenOf: (i: number, j: number, y: number) => screenOf(i - CENTER + 0.5, y, j - CENTER + 0.5),
};
