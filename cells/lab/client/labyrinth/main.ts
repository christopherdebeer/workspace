/**
 * Labyrinth: architecture that follows the hand. A travertine slab on a table in the sun, and three gestures
 * (gesture.ts): **tap** raises stone; **trace** builds a wall, extends a walkway, or joins two places (in steps and
 * landings if they're at different heights); **hold, then trace** carves. The hand decides the shape; the rules
 * (model.ts) work out what it takes to stand: arches, arcades and piers under what has nothing beneath it, arched ways
 * where stone's cut from under stone, courtyards (paved, with water and a cypress) where walls close round the ground.
 *
 * One finger on the stone builds; one finger on the background, or two anywhere, turns it (it settles on a corner);
 * pinch to come close. Undo, print, clear. What's built is kept on this device.
 *
 * `?story=1..4` (the storyboard: first touch, a wall traced, an elevated connection, a resolved labyrinth) ·
 * `?ops=` (operations, as the model writes them) · `?print` · `?turn=` · `?zoom=` · `?preview` · `?still`
 */
import { N, World, replay } from './model';
import { buildMesh, inStone } from './mesh';
import { Renderer, camera, invert, type View } from './render';
import { carve, surface, tap, trace, type Pick } from './gesture';
import { story } from './demo';

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
let fit = 1, zoomK = Number(qs.get('zoom') ?? 0.64), azGoal: number | null = null;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
  guide.width = Math.round(guide.clientWidth * dpr); guide.height = Math.round(guide.clientHeight * dpr);
  g2.setTransform(dpr, 0, 0, dpr, 0, 0);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), half = (N / 2 + 1) * Math.SQRT2;
  fit = Math.max(half / aspect, half * 0.75) * 1.04;
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
function pick(cx: number, cy: number): Pick | null {
  const { a, d, L } = ray(cx, cy), topY = world.top() + 1;
  let t = d[1] < 0 ? Math.max(0, (a[1] - topY) / -d[1]) : 0, prev: number[] | null = null;
  const cell = (p: number[]) => [Math.floor(p[1]), Math.floor(p[0] + N / 2), Math.floor(p[2] + N / 2)] as [number, number, number];
  for (; t < L; t += 0.012) {
    const p = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    if (p[1] < -1) return null;
    if (!inStone(world, p[0], p[1], p[2])) { prev = p; continue; }
    const hit = cell(p);
    if (hit[1] < 0 || hit[2] < 0 || hit[1] >= N || hit[2] >= N) return null;
    if (p[1] < 0) return { face: 'ground', hit: [-1, hit[1], hit[2]], to: [0, hit[1], hit[2]] };
    // (struck in the stone over an arch, from below its own cell: it's that cell's)
    while (!world.occupied(hit[0], hit[1], hit[2]) && hit[0] + 1 < 8) hit[0]++;
    const to = prev ? cell(prev) : [hit[0] + 1, hit[1], hit[2]] as [number, number, number];
    const face = to[1] === hit[1] && to[2] === hit[2] ? 'top' : 'side';
    return { face, hit, to: face === 'top' ? [hit[0] + 1, hit[1], hit[2]] : [hit[0], to[1], to[2]] };
  }
  return null;
}
/** where a point on the screen is on the level plane at height y (a cell) */
function onPlane(cx: number, cy: number, y: number): [number, number] | null {
  const { a, d } = ray(cx, cy);
  if (Math.abs(d[1]) < 1e-6) return null;
  const t = (y - a[1]) / d[1], x = a[0] + d[0] * t, z = a[2] + d[2] * t;
  const i = Math.floor(x + N / 2), j = Math.floor(z + N / 2);
  return i >= 0 && j >= 0 && i < N && j < N ? [i, j] : null;
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
    const [sx, sy] = screenOf(i - N / 2 + 0.5, k, j - N / 2 + 0.5);
    for (let q = 0; q < 9; q++) dust.push({ x: sx + (Math.random() - 0.5) * 14, y: sy + (Math.random() - 0.5) * 6, vx: (Math.random() - 0.5) * 30, vy: -8 - Math.random() * 14, life: -at - Math.random() * 0.15, r: 0.6 + Math.random() * 1.2 });
  }
}

// ─── the hand ───
type Gesture = { id: number; start: Pick | null; x0: number; y0: number; t0: number; mode: 'pending' | 'trace' | 'carve' | 'turn'; pts: Array<[number, number]>; base: number; seen: Map<string, number>; hold: number; cut: Array<[number, number, number]> };
let g: Gesture | null = null;
const fingers = new Map<number, { x: number; y: number }>();
let pinch0 = 0, zoom0 = 1, mid0 = 0;
function hint(text?: string) {
  const el = document.getElementById('hint')!;
  el.textContent = text ?? (world.ops.length === 0 ? 'tap the stone to raise it · trace to build · hold to carve' : world.ops.length < 4 ? 'trace from a top to reach out · trace up to a higher top to climb' : '');
  el.classList.toggle('on', !!el.textContent);
}
let hintT = 0;
const say = (t: string) => { hint(t); clearTimeout(hintT); hintT = window.setTimeout(() => hint(), 2400); };
const kept = () => { keep(); hint(); };

function traceStep(cx: number, cy: number, final: boolean) {
  if (!g?.start) return;
  // (read against the world as it was before this trace)
  if (world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); }
  const h0 = surface(world, g.start), end = pick(cx, cy);
  const h1 = end && end.face !== 'ground' ? surface(world, end) : h0;
  const pts = g.pts, cells: Array<[number, number]> = [[g.start.hit[1], g.start.hit[2]]];
  pts.forEach(([x, y], q) => { const c = onPlane(x, y, h0 + ((h1 - h0) * q) / Math.max(1, pts.length - 1)); if (c) cells.push(c); });
  for (const [i, j] of cells) if (!g.seen.has(`${i}.${j}`)) g.seen.set(`${i}.${j}`, now());
  const op = trace(world, g.start, cells, end, (i, j) => g!.seen.get(`${i}.${j}`) ?? now());
  if (op) world.apply(op, now());
  if (final && op) { settle((op.add ?? []).map((c) => [c[0], c[1], c[2]])); kept(); }
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
  if (fingers.size === 2) {
    // (a second finger: whatever the first was doing is let go; the two turn it and pinch)
    if (g && g.mode !== 'turn' && world.ops.length > g.base) { world.ops.length = g.base; world.rebuild(now()); }
    if (g) clearTimeout(g.hold);
    g = null;
    const [p, q] = [...fingers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); zoom0 = zoomK; mid0 = (p.x + q.x) / 2;
    return;
  }
  const start = pick(e.clientX, e.clientY);
  g = { id: e.pointerId, start, x0: e.clientX, y0: e.clientY, t0: performance.now(), mode: start ? 'pending' : 'turn', pts: [], base: world.ops.length, seen: new Map(), hold: 0, cut: [] };
  if (start) g.hold = window.setTimeout(() => { if (g && g.mode === 'pending') { g.mode = 'carve'; navigator.vibrate?.(8); carveAt(g.x0, g.y0); } }, 420);
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
  if (g.mode === 'pending' && moved) { g.mode = 'trace'; clearTimeout(g.hold); g.pts.push([g.x0, g.y0]); }
  if (g.mode === 'trace') { g.pts.push([e.clientX, e.clientY]); traceStep(e.clientX, e.clientY, false); }
  if (g.mode === 'carve') carveAt(e.clientX, e.clientY);
});
const up = (e: PointerEvent) => {
  fingers.delete(e.pointerId);
  if (fingers.size === 0) azGoal = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2)));
  if (!g || g.id !== e.pointerId) return;
  clearTimeout(g.hold);
  const cancelled = e.type !== 'pointerup';
  if (g.mode === 'pending' && !cancelled && g.start) {
    const op = tap(world, g.start, now());
    if (op) { world.apply(op, now()); settle(op.add!.map((c) => [c[0], c[1], c[2]])); kept(); } else say('nothing more will stand there');
  } else if (g.mode === 'trace') {
    if (cancelled) { world.ops.length = g.base; world.rebuild(now()); } else traceStep(e.clientX, e.clientY, true);
  } else if (g.mode === 'carve') kept();
  g = null;
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomK = Math.max(0.25, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001))); }, { passive: false });

// ─── its buttons ───
const printB = document.getElementById('print')!;
const showPrint = () => { printB.classList.toggle('on', R.print); printB.setAttribute('aria-pressed', String(R.print)); };
printB.addEventListener('click', () => { R.print = !R.print; showPrint(); });
document.getElementById('undo')!.addEventListener('click', () => { if (world.undo(now())) kept(); });
document.getElementById('again')!.addEventListener('click', () => { if (!world.ops.length || confirm('Clear the stone?')) { world.clear(); kept(); } });
showPrint(); hint();
if (preview) document.body.classList.add('preview');

// ─── each frame ───
let last = performance.now(), zoomFit = fit;
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (world.version !== meshVersion) remesh();
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  // (it frames what's built, but never while a hand's on it: what's under the finger stays under it)
  if (!g || g.mode === 'turn') {
    const top = world.top();
    view.target[1] += (top * 0.35 - view.target[1]) * (1 - Math.exp(-dt * 3));
    zoomFit += (fit + top * 0.25 - zoomFit) * (1 - Math.exp(-dt * 3));
  }
  view.zoom = zoomFit * zoomK;
  R.draw(view, now(), Math.min(2, devicePixelRatio || 1));
  // (the guides, only while a finger's down: the stroke traced, in faint ink; the ring a hold fills before it carves)
  g2.clearRect(0, 0, guide.clientWidth, guide.clientHeight);
  if (g && g.mode === 'trace' && g.pts.length > 1) {
    g2.strokeStyle = 'rgba(43,36,32,.35)'; g2.lineWidth = 1.5; g2.setLineDash([2, 5]); g2.lineCap = 'round';
    g2.beginPath(); g2.moveTo(g.pts[0][0], g.pts[0][1]); for (const [x, y] of g.pts) g2.lineTo(x, y); g2.stroke(); g2.setLineDash([]);
  }
  if (g && (g.mode === 'pending' || g.mode === 'carve') && g.start) {
    const held = Math.min(1, (performance.now() - g.t0) / 420), f = fingers.get(g.id), x = f?.x ?? g.x0, y = f?.y ?? g.y0;
    if (held > 0.35 || g.mode === 'carve') {
      g2.strokeStyle = g.mode === 'carve' ? 'rgba(43,36,32,.55)' : 'rgba(43,36,32,.3)'; g2.lineWidth = 1.5;
      g2.beginPath(); g2.arc(x, y, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (g.mode === 'carve' ? 1 : (held - 0.35) / 0.65)); g2.stroke();
    }
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
  get world() { return world; }, view, R, pick, onPlane,
  probe: () => ({ ops: world.ops.length, top: world.top(), stone: world.mass.size, stairs: world.stairs.size, piers: world.piers.size, arches: world.spans.length, courts: world.courts.size, decor: world.decor.length, whys: world.ops.map((o) => o.why ?? '') }),
  /** where a point of the room is on the screen (css pixels): a cell (i, j), at height y, fractions toward its sides */
  screenOf: (i: number, j: number, y: number) => screenOf(i - N / 2 + 0.5, y, j - N / 2 + 0.5),
};
