/**
 * Labyrinth: a flat travertine stone, and touches that build on it, one piece at a time (model.ts): blocks, arches (an
 * arch on an arch makes one tall arch), stairs, bridges (the whole gap at once, on one arch), cypresses, pools. **auto**
 * reads where it's touched: the stone takes a block; a block's top, a block on it; a block's side, a stair up onto it,
 * or a bridge out from it to whatever's across the gap. Drawn as a model in the sun on a table, in travertine, with
 * light gathering in its arches (render.ts); or as a print.
 *
 * Touch to build. Drag sideways to turn it (it settles on a corner); pinch to come close. Undo; the eraser takes a
 * piece away (if nothing rests on it). What's built is kept on this device.
 *
 * `?p=` (pieces, as the model writes them) · `?demo` · `?print` · `?turn=` (quarter turns) · `?zoom=` · `?hand=` ·
 * `?preview` (the index's card: the demo, turning slowly) · `?still`
 */
import { DIRS, Labyrinth, N, H, decide, replay, type Kind } from './model';
import { buildMesh, inStone } from './mesh';
import { Renderer, camera, invert, type View } from './render';
import { demo } from './demo';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), still = qs.has('still');
const canvas = document.getElementById('stone') as HTMLCanvasElement;
const R = new Renderer(canvas);
R.print = qs.has('print');
R.shadows = !qs.has('noshadow');

// ─── what's built ───
const KEY = 'labyrinth.v2';
let model: Labyrinth;
if (preview || qs.has('demo')) model = demo();
else if (qs.has('p')) model = replay(qs.get('p')!);
else { let kept = ''; try { kept = localStorage.getItem(KEY) ?? ''; } catch { /* */ } model = replay(kept); }
const fixed = preview || qs.has('demo') || qs.has('p');
const keep = () => { if (fixed) return; try { localStorage.setItem(KEY, model.encode()); } catch { /* */ } };
let meshVersion = -1;
function remesh() { R.upload(buildMesh(model)); meshVersion = model.version; }

// ─── how it's seen ───
/** the four corners it settles on: a quarter turn apart, each looking down a diagonal */
const corner = (k: number) => Math.PI / 4 + (k * Math.PI) / 2;
const view: View = { az: corner(Number(qs.get('turn') ?? 0)), el: 0.6, zoom: 1, target: [0, 0, 0] };
let fit = 1, zoomK = Number(qs.get('zoom') ?? 0.64), azGoal: number | null = null;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), half = (N / 2 + 1) * Math.SQRT2;
  fit = Math.max(half / aspect, half * 0.75) * 1.04;
}
addEventListener('resize', resize); resize();
/** the way the eye looks, along the ground: the nearest of the four ways */
const looking = () => { const dx = -Math.sin(view.az), dz = -Math.cos(view.az); return DIRS.findIndex(([a, b]) => a === (Math.abs(dx) > Math.abs(dz) ? Math.sign(dx) : 0) && b === (Math.abs(dx) > Math.abs(dz) ? 0 : Math.sign(dz))); };

// ─── touching it ───
let t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;
/** what a point on the screen touches: the cell it strikes (k −1: the stone) and the free cell on that face's side */
function pick(cx: number, cy: number): { hit: [number, number, number]; to: [number, number, number] } | null {
  const r = canvas.getBoundingClientRect(), x = ((cx - r.left) / r.width) * 2 - 1, y = 1 - ((cy - r.top) / r.height) * 2;
  const cam = camera(view, r.width / r.height), inv = invert(cam.vp);
  const un = (z: number) => { const v = [x, y, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += inv[k * 4 + i] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  const topY = model.top() * H + 1;
  let t = d[1] < 0 ? Math.max(0, (a[1] - topY) / -d[1]) : 0, prev: number[] | null = null;
  const cell = (p: number[]) => [Math.floor(p[1]), Math.floor(p[0] + N / 2), Math.floor(p[2] + N / 2)] as [number, number, number];
  for (; t < L; t += 0.015) {
    const p = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    if (p[1] < -1) return null;
    if (!inStone(model, p[0], p[1], p[2])) { prev = p; continue; }
    const hit = cell(p);
    if (hit[1] < 0 || hit[2] < 0 || hit[1] >= N || hit[2] >= N) return null;
    if (p[1] < 0) return { hit: [-1, hit[1], hit[2]], to: [0, hit[1], hit[2]] };
    let to = prev ? cell(prev) : [hit[0] + 1, hit[1], hit[2]] as [number, number, number];
    if (to[0] === hit[0] && to[1] === hit[1] && to[2] === hit[2]) to = [hit[0] + 1, hit[1], hit[2]];
    return { hit, to: [Math.max(0, to[0]), to[1], to[2]] };
  }
  return null;
}
type Hand = Kind | 'auto' | 'erase';
let hand: Hand = (qs.get('hand') as Hand) ?? 'auto';
const SAYS: Partial<Record<Hand, string>> = { bridge: 'a bridge goes across a gap, from stone to stone level with it', pool: 'a pool is let into the stone itself', cypress: 'a cypress wants a floor, and room above it', stair: 'a stair wants a floor to start from', arch: 'an arch stands on the stone, or on stone', block: 'a block stands on the stone, or on stone', auto: 'nothing to build there' };
function touch(cx: number, cy: number): boolean {
  const at = pick(cx, cy);
  if (!at) return false;
  if (hand === 'erase') {
    const p = model.pieceAt(Math.max(0, at.hit[0]), at.hit[1], at.hit[2]);
    if (!p || (at.hit[0] < 0 && p.kind !== 'pool')) return false;
    if (!model.remove(p)) { say('something rests on it: take that away first'); return false; }
    keep(); hint(); return true;
  }
  const d = decide(model, hand, at.hit, at.to, looking());
  const p = d && model.place(d.kind, d.k, d.i, d.j, d.a, d.n, now());
  if (!p) { say(SAYS[hand] ?? ''); return false; }
  keep(); hint();
  return true;
}
let hintT = 0;
function say(text: string) { const el = document.getElementById('hint')!; el.textContent = text; el.classList.add('on'); clearTimeout(hintT); hintT = window.setTimeout(hint, 2400); }
function hint() {
  const el = document.getElementById('hint')!, n = model.pieces.length;
  el.textContent = n === 0 ? 'touch the stone to build' : n < 4 && hand === 'auto' ? 'touch a block’s top to raise it, its side to climb it' : '';
  el.classList.toggle('on', !!el.textContent);
}

// (a touch that doesn't move builds; a drag sideways turns it; two fingers, a pinch)
const fingers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
let pinch0 = 0, zoom0 = 1, turned = false;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  if (fingers.size === 2) { const [p, q] = [...fingers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); zoom0 = zoomK; }
  azGoal = null; turned = false;
});
canvas.addEventListener('pointermove', (e) => {
  const f = fingers.get(e.pointerId);
  if (!f) return;
  const dx = e.clientX - f.x; f.x = e.clientX; f.y = e.clientY;
  if (fingers.size === 2) { const [p, q] = [...fingers.values()], d = Math.hypot(p.x - q.x, p.y - q.y); if (pinch0 > 0) zoomK = Math.max(0.25, Math.min(1.3, zoom0 * (pinch0 / d))); turned = true; return; }
  if (Math.hypot(e.clientX - f.x0, e.clientY - f.y0) > 8) { turned = true; view.az -= dx * 0.008; }
});
const up = (e: PointerEvent) => {
  const f = fingers.get(e.pointerId);
  fingers.delete(e.pointerId);
  if (!f) return;
  if (!turned && e.type === 'pointerup' && performance.now() - f.t0 < 500) touch(e.clientX, e.clientY);
  if (fingers.size === 0) azGoal = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2)));
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomK = Math.max(0.25, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001))); }, { passive: false });

// ─── its buttons ───
const hands = document.getElementById('hands')!;
function showHand() { for (const b of Array.from(hands.querySelectorAll('button')) as HTMLElement[]) { b.classList.toggle('on', b.dataset.hand === hand); b.setAttribute('aria-pressed', String(b.dataset.hand === hand)); } }
for (const b of Array.from(hands.querySelectorAll('button')) as HTMLElement[]) b.addEventListener('click', () => { hand = b.dataset.hand as Hand; showHand(); hint(); });
const printB = document.getElementById('print')!;
const showPrint = () => { printB.classList.toggle('on', R.print); printB.setAttribute('aria-pressed', String(R.print)); };
printB.addEventListener('click', () => { R.print = !R.print; showPrint(); });
document.getElementById('undo')!.addEventListener('click', () => { if (model.undo()) { keep(); hint(); } });
document.getElementById('again')!.addEventListener('click', () => { if (!model.pieces.length || confirm('Clear the stone?')) { model = new Labyrinth(); keep(); hint(); } });
showHand(); showPrint(); hint();
if (preview) document.body.classList.add('preview');

// ─── each frame ───
let last = performance.now();
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (model.version !== meshVersion) remesh();
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  const top = model.top() * H;
  view.target[1] += (top * 0.4 - view.target[1]) * (1 - Math.exp(-dt * 3));
  view.zoom = (fit + top * 0.3) * zoomK;
  R.draw(view, now(), Math.min(2, devicePixelRatio || 1));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __labyrinth: unknown }).__labyrinth = {
  get model() { return model; }, view, R, pick, touch,
  setHand: (h: Hand) => { hand = h; showHand(); },
  probe: () => ({ pieces: model.pieces.length, top: model.top(), version: model.version, encoded: model.encode(), hand }),
  /** where a point of the room is on the screen (css pixels); (i, j) a cell, y a height */
  screenOf: (i: number, j: number, y: number) => {
    const r = canvas.getBoundingClientRect(), cam = camera(view, r.width / r.height), p = [i - N / 2 + 0.5, y, j - N / 2 + 0.5, 1], m = cam.vp;
    const o = [0, 1, 3].map((row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row] * p[3]);
    return [r.left + (o[0] / o[2] * 0.5 + 0.5) * r.width, r.top + (1 - (o[1] / o[2] * 0.5 + 0.5)) * r.height];
  },
};
