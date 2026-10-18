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
 * `?zoom=` · `?preview` · `?still`
 */
import { CENTER, World, inGrid, key, replay, type Cell, type Op } from './model';
import { buildMesh, inStone } from './mesh';
import { Renderer, camera, invert, type View } from './render';
import { carve, surface, tap, trace, type Pick } from './gesture';
import { story } from './demo';
import { DRESSINGS, PIECES, dress, dressAt, place, run, type Dressing, type Hand, type Piece } from './palette';
import { around, motifs, type Motif } from './motifs';
import { selectCell, selectMotif, type Selection } from './select';
import { DIRS } from './model';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), still = qs.has('still');
const canvas = document.getElementById('stone') as HTMLCanvasElement, guide = document.getElementById('guide') as HTMLCanvasElement;
const g2 = guide.getContext('2d')!;
const R = new Renderer(canvas);
R.print = qs.has('print');
R.shadows = !qs.has('noshadow');

// ─── what's built ───
const KEY = 'labyrinth.v3';
let world: World;
if (preview) world = story(4);
else if (qs.has('story')) world = story(Number(qs.get('story')));
else if (qs.has('ops')) world = replay(qs.get('ops')!);
else { let kept = ''; try { kept = localStorage.getItem(KEY) ?? ''; } catch { /* */ } world = replay(kept); }
const fixed = preview || qs.has('story') || qs.has('ops');
const keep = () => { if (fixed) return; try { localStorage.setItem(KEY, world.encode()); } catch { /* */ } };
let meshVersion = -1;
function remesh() { R.upload(buildMesh(world)); meshVersion = world.version; }

// ─── how it's seen ───
const corner = (k: number) => Math.PI / 4 + (k * Math.PI) / 2;
const view: View = { az: corner(Number(qs.get('turn') ?? 0)), el: 0.6, zoom: 1, target: [0, 0, 0] };
let zoomK = Number(qs.get('zoom') ?? 0.64), azGoal: number | null = null;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
  guide.width = Math.round(guide.clientWidth * dpr); guide.height = Math.round(guide.clientHeight * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
}
let aspect = 1;
/** what the view frames: the slab, however big it's grown (its middle, and how far to stand back to see it) */
function framing() {
  const e = world.extent(), half = (Math.max(e.i1 - e.i0, e.j1 - e.j0) / 2 + 1.5) * Math.SQRT2;
  return { cx: (e.i0 + e.i1 + 1) / 2 - CENTER, cz: (e.j0 + e.j1 + 1) / 2 - CENTER, fit: Math.max(half / aspect, half * 0.75) * 1.04, half };
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
    if (p[1] < 0) return { face: 'ground', hit: [-1, hit[1], hit[2]], to: [0, hit[1], hit[2]] };
    // (struck in the stone over an arch, from below its own cell: it's that cell's)
    if (!w.occupied(hit[0], hit[1], hit[2]) && !w.tree(hit[0], hit[1], hit[2]) && !w.tree(hit[0] - 1, hit[1], hit[2])) {
      for (let k = hit[0] + 1; k < 8; k++) if (w.span(k, hit[1], hit[2])) { hit[0] = k; break; }
    }
    const to = prev ? cell(prev) : [hit[0] + 1, hit[1], hit[2]] as [number, number, number];
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
};
let g: Gesture | null = null;
const fingers = new Map<number, { x: number; y: number }>();
let pinch0 = 0, zoom0 = 1, mid0 = 0;
const SAYS: Record<Exclude<Hand, 'auto'>, string> = { block: 'a block stands on the stone, or on stone', arch: 'an arch stands on the stone, or on stone', stair: 'a stair wants a floor to start from', bridge: 'a bridge goes across a gap, from stone to stone level with it', cypress: 'a cypress wants a floor, and room above it', pool: 'a pool is let into the stone itself', take: 'nothing of yours there to take' };
const bar = document.getElementById('hands')!, sheet = document.getElementById('sheet')!, pieceB = bar.querySelector('[data-brush="piece"]') as HTMLElement;
function showBrush() {
  for (const b of Array.from(bar.querySelectorAll('button')) as HTMLElement[]) { const on = b.dataset.brush === brush; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  // (the piece brush shows what it holds)
  const src = sheet.querySelector(`[data-held="${held}"]`) as HTMLElement | null;
  if (src) { pieceB.querySelector('svg')!.outerHTML = src.querySelector('svg')!.outerHTML; pieceB.querySelector('i')!.textContent = src.querySelector('i')!.textContent; }
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
  hand: () => 'drag to turn it · tap to ask what something is',
  auto: () => 'tap raises · trace builds, reaches out and climbs',
  piece: () => (isDress(held) ? `${held}: tap a stone, or stroke over stones, to dress them` : `${held}: tap to put one · trace for a run of them`),
  take: () => 'tap takes a piece away · trace carves through',
  select: () => 'tap something to take it up · tap again for the whole of it',
};
function hint(text?: string) {
  const el = document.getElementById('hint')!;
  el.textContent = text ?? (brush !== 'auto' ? '' : world.ops.length === 0 ? 'tap the stone to raise it · trace to build' : world.ops.length < 4 ? 'trace from a top to reach out · trace up to a higher top to climb' : '');
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
const cellOf = (p: Pick): Cell => (p.face === 'ground' ? [0, p.hit[1], p.hit[2]] : p.hit);
function selectAt(p: Pick) {
  const c = cellOf(p), same = sel && sel.cell.every((v, q) => v === c[q]);
  if (same && sel) {
    // (again: the whole it's part of, then the whole that's part of, then back to the piece)
    const idx = sel.idx + 1 < sel.whole.length ? sel.idx + 1 : -1;
    const s = idx < 0 ? selectCell(world, c, looking(), now()) : selectMotif(world, sel.whole[idx], now());
    if (s) { sel = { ...sel, idx, s, switched: null }; showSel(); return; }
  }
  const whole = around(motifsNow(), c), piece = p.face === 'ground' ? null : selectCell(world, c, looking(), now());
  const s = piece ?? (whole[0] ? selectMotif(world, whole[0], now()) : null);
  if (!s) { unselect(); say('nothing there to take up'); return; }
  sel = { cell: c, whole, idx: piece ? -1 : 0, s, switched: null };
  showSel();
}
function unselect() { sel = null; showSel(); }
function showSel() {
  document.body.classList.toggle('selecting', !!sel);
  card.classList.toggle('on', !!sel);
  if (!sel) return;
  const { s } = sel, next = s.readings[(s.at + 1) % s.readings.length];
  const more = sel.idx + 1 < sel.whole.length ? sel.whole[sel.idx + 1].label : '';
  (card.querySelector('#what') as HTMLElement).textContent = s.title;
  (card.querySelector('#reading') as HTMLElement).textContent = s.readings.length > 1 ? `read as ${s.readings[s.at].label}` : '';
  const sw = card.querySelector('#switch') as HTMLButtonElement, wh = card.querySelector('#whole') as HTMLButtonElement, tk = card.querySelector('#takeaway') as HTMLButtonElement, dr = card.querySelector('#dressit') as HTMLButtonElement;
  sw.hidden = s.readings.length < 2; sw.textContent = `→ ${next.label}`;
  wh.hidden = !more; wh.textContent = `the whole: ${more}`;
  tk.hidden = !s.remove;
  dr.hidden = !s.stone.length; dr.textContent = `dress: ${lastDress}`;
}
/** read what's taken up the next way: replacing the last switch if that's still the last thing done */
function switchReading() {
  if (!sel) return;
  const { s } = sel, at = (s.at + 1) % s.readings.length, op = s.readings[at].op;
  const again = !!sel.switched && world.ops[world.ops.length - 1] === sel.switched;
  if (again) { if (op) world.replaceLast(op, now()); else world.undo(now()); }
  else if (op) world.apply(op, now());
  sel.switched = again && !op ? null : op;
  s.at = at;
  kept(); showSel();
}
function takeAway() { if (!sel?.s.remove) return; world.apply(sel.s.remove, now()); kept(); unselect(); }
function dressSel() { if (!sel) return; const op = dress(world, lastDress, sel.s.stone); if (op) { world.apply(op, now()); kept(); } }
card.querySelector('#switch')!.addEventListener('click', switchReading);
card.querySelector('#whole')!.addEventListener('click', () => { if (sel) selectAt({ face: sel.cell[0] < 0 ? 'ground' : 'top', hit: sel.cell, to: sel.cell }); });
card.querySelector('#takeaway')!.addEventListener('click', takeAway);
card.querySelector('#dressit')!.addEventListener('click', dressSel);
card.querySelector('#close')!.addEventListener('click', unselect);
/** what a touch is on, said plainly (the hand brush's tap) */
function describe(p: Pick): string {
  const c = cellOf(p), s = p.face === 'ground' ? null : selectCell(world, c, looking(), now()), whole = around(motifsNow(), c);
  const what = s?.title ?? (p.face === 'ground' ? (world.courts.has(key(0, c[1], c[2])) ? 'the paving of a court' : 'the stone slab') : '');
  return [what, ...whole.slice(0, 1).map((m) => `part of ${m.label}`)].filter(Boolean).join(' · ');
}

/** where a trace might be going: a top (or a side) other than the column it started on; else nowhere ('') */
const goal = (p: Pick | null) => !p || p.face === 'ground' || !g?.start || (p.hit[1] === g.start.hit[1] && p.hit[2] === g.start.hit[2]) ? '' : `${surface(g.before!, p)}.${p.hit[1]}.${p.hit[2]}`;
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
  g.laid = sig;
}
/** a stroke under the finger (auto's trace, or a run of pieces): its columns, and what it builds, read again */
function traceStep(cx: number, cy: number, final: boolean) {
  if (!g?.start) return;
  if (!g.before) {
    // (read against the world as it was before this stroke: a copy, so picking never strikes the stroke's own stone)
    g.before = new World(world.seed); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now());
    g.h0 = surface(g.before, g.start); g.cells = [[g.start.hit[1], g.start.hit[2]]]; g.born = now();
  }
  const before = g.before;
  g.pts.push([cx, cy]);
  // (the columns crossed: on the plane the stroke starts from, each fixed once the finger's passed it)
  const c = onPlane(cx, cy, g.h0!), last = g.cells[g.cells.length - 1];
  if (c && (c[0] !== last[0] || c[1] !== last[1])) g.cells.push(c);
  if (g.mode === 'run') {
    const op = run(before, held as Piece, g.start, g.cells, looking(), g.born);
    lay(op);
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
  const op = trace(before, g.start, g.cells, g.target, (i, j) => g!.seen.get(`${i}.${j}`) ?? now(), g.born);
  const refused = op && 'refused' in op ? op.refused : '';
  if (refused && refused !== g.said) say(refused);
  g.said = refused;
  const built = op && !('refused' in op) ? op : null;
  lay(built);
  if (final && built) {
    const r = world.reached.get(world.ops[world.ops.length - 1]);
    settle(r?.cells ?? (built.add ?? []).map((q) => [q[0], q[1], q[2]])); kept();
    // (never quietly short: if it stopped on the way, it says where it joined)
    if (r && !r.reached) say(r.stopped > 0 ? 'it joins the stone it meets on the way' : 'nothing to build there');
  }
}
/** dressing, stroked over stone: each stone the finger passes over */
function paintAt(cx: number, cy: number) {
  if (!g) return;
  const p = pick(cx, cy), c = p && dressAt(world, p);
  if (c && !g.painted.some((q) => q.every((v, n) => v === c[n]))) g.painted.push(c);
  if (!g.before) { g.before = new World(world.seed); g.before.ops = world.ops.slice(0, g.base); g.before.rebuild(now()); }
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
    const [p, q] = [...fingers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); zoom0 = zoomK; mid0 = (p.x + q.x) / 2;
    return;
  }
  const start = pick(e.clientX, e.clientY);
  g = { id: e.pointerId, start, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: brush === 'hand' ? 'look' : !start ? 'turn' : 'pending', pts: [], base: world.ops.length, seen: new Map(), cut: [], painted: [], cells: [], target: null, cand: '', candPick: null, count: 0, laid: '', said: '', born: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  const dx = e.clientX - f.x; f.x = e.clientX; f.y = e.clientY;
  if (fingers.size === 2) {
    const [p, q] = [...fingers.values()], d = Math.hypot(p.x - q.x, p.y - q.y), mid = (p.x + q.x) / 2;
    if (pinch0 > 0) zoomK = Math.max(0.25, Math.min(1.3, zoom0 * (pinch0 / d)));
    view.az -= (mid - mid0) * 0.008; mid0 = mid;
    return;
  }
  if (!g || g.id !== e.pointerId) return;
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
  if (fingers.size === 0) azGoal = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2)));
  if (!g || g.id !== e.pointerId) return;
  const cancelled = e.type !== 'pointerup', m = g.mode, start = g.start;
  if (cancelled && m !== 'turn' && m !== 'look') { if (world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); } g = null; return; }
  if (m === 'look' && start) say(describe(start));
  else if (m === 'pending' && start) {
    // (a tap: what it does depends on the brush)
    if (brush === 'select') selectAt(start);
    else {
      unselect();
      let op: Op | null = null;
      if (brush === 'auto') op = tap(world, start, now());
      else if (brush === 'take') op = place(world, 'take', start, looking(), now());
      else if (isDress(held)) { const c = dressAt(world, start); op = c ? dress(world, held, [c]) : null; }
      else op = place(world, held, start, looking(), now());
      if (op) { world.apply(op, now()); settle([...(op.add ?? []), ...(op.arches ?? []), ...(op.stairs ?? [])].map((c) => [c[0], c[1], c[2]])); kept(); }
      else say(brush === 'auto' ? 'nothing more will stand there' : brush === 'take' ? SAYS.take : isDress(held) ? (held === 'lantern' || held === 'pot' ? 'that wants a top with room over it' : 'dressing goes on stone') : SAYS[held as Piece]);
    }
  } else if (m === 'trace' || m === 'run') { unselect(); traceStep(e.clientX, e.clientY, true); }
  else if (m === 'carve' || m === 'paint') { unselect(); kept(); }
  g = null;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomK = Math.max(0.25, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001))); }, { passive: false });
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
document.getElementById('again')!.addEventListener('click', () => { if (!world.ops.length || confirm('Clear the stone?')) { world.clear(); unselect(); kept(); } });
showPrint(); showBrush(); hint();
if (preview) document.body.classList.add('preview');

// ─── each frame ───
let last = performance.now(), zoomFit = framing().fit;
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (world.version !== meshVersion) remesh();
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  // (it frames what's built, but never while a hand's on it: what's under the finger stays under it)
  const fr = framing();
  if (!g || g.mode === 'turn') {
    const top = world.top(), q = 1 - Math.exp(-dt * 3);
    view.target[0] += (fr.cx - view.target[0]) * q; view.target[2] += (fr.cz - view.target[2]) * q;
    view.target[1] += (top * 0.35 - view.target[1]) * q;
    zoomFit += (fr.fit + top * 0.25 - zoomFit) * q;
  }
  R.area = [fr.cx, fr.cz, fr.half + 2];
  view.zoom = zoomFit * zoomK;
  R.draw(view, now(), Math.min(2, devicePixelRatio || 1));
  // (the guides, only while a finger's down: the stroke traced, in faint ink)
  g2.clearRect(0, 0, guide.clientWidth, guide.clientHeight);
  if (g && g.mode === 'trace' && g.pts.length > 1) {
    g2.strokeStyle = 'rgba(43,36,32,.35)'; g2.lineWidth = 1.5; g2.setLineDash([2, 5]); g2.lineCap = 'round';
    g2.beginPath(); g2.moveTo(g.pts[0][0], g.pts[0][1]); for (const [x, y] of g.pts) g2.lineTo(x, y); g2.stroke(); g2.setLineDash([]);
  }
  // (what's taken up: the edges of its cells, in a warm ink)
  if (sel) {
    g2.strokeStyle = 'rgba(176,92,30,.85)'; g2.lineWidth = 1.4;
    const seen = new Set<string>();
    g2.beginPath();
    for (const [k, i, j] of sel.s.cells) {
      const x = i - CENTER, z = j - CENTER;
      const P = (a: number, b: number, c: number) => screenOf(x + a, k + b, z + c);
      for (const [p, q] of [[[0, 0, 0], [1, 0, 0]], [[1, 0, 0], [1, 0, 1]], [[1, 0, 1], [0, 0, 1]], [[0, 0, 1], [0, 0, 0]], [[0, 1, 0], [1, 1, 0]], [[1, 1, 0], [1, 1, 1]], [[1, 1, 1], [0, 1, 1]], [[0, 1, 1], [0, 1, 0]], [[0, 0, 0], [0, 1, 0]], [[1, 0, 0], [1, 1, 0]], [[1, 0, 1], [1, 1, 1]], [[0, 0, 1], [0, 1, 1]]] as Array<[number[], number[]]>) {
        const id = [x + p[0], k + p[1], z + p[2], x + q[0], k + q[1], z + q[2]].join(',');
        if (seen.has(id)) continue;
        seen.add(id);
        const A = P(p[0], p[1], p[2]), B = P(q[0], q[1], q[2]);
        g2.moveTo(A[0], A[1]); g2.lineTo(B[0], B[1]);
      }
    }
    g2.stroke();
  }
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
requestAnimationFrame(frame);

(window as unknown as { __labyrinth: unknown }).__labyrinth = {
  get world() { return world; }, view, R, pick, onPlane, setHand: (h: Hand | Dressing | Brush) => setBrush(h), setBrush,
  get brush() { return brush; }, get held() { return held; },
  selection: () => (sel ? { title: sel.s.title, readings: sel.s.readings.map((r) => r.label), at: sel.s.at, whole: sel.idx, cells: sel.s.cells.length } : null),
  switchReading, takeAway, dressSel, motifs: () => motifsNow().map((m) => ({ kind: m.kind, label: m.label, cells: m.cells.length })),
  probe: () => ({ ops: world.ops.length, top: world.top(), stone: world.mass.size, stairs: world.stairs.size, piers: world.piers.size, arches: world.spans.length, courts: world.courts.size, decor: world.decor.length, whys: world.ops.map((o) => o.why ?? '') }),
  /** where a point of the room is on the screen (css pixels): a cell (i, j), at height y, fractions toward its sides */
  screenOf: (i: number, j: number, y: number) => screenOf(i - CENTER + 0.5, y, j - CENTER + 0.5),
};
