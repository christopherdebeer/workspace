/**
 * Labyrinth: a flat stone, and touches that build on it. Each touch raises the stone round it a level, as a stepped
 * mound of block mazes, each level's grid offset from the one below so it stands on arches over the passages beneath
 * (model.ts); a touch where it's already built builds higher. Drawn as the prints draw such things: from above at an
 * angle, square to nothing, in ink (render.ts).
 *
 * Touch to build. Drag sideways to turn it (it settles on a corner); pinch to come close. **print** draws it as a
 * lithograph; **again** clears the stone. What's built is kept on this device.
 *
 * `?seed=` · `?taps=i.j,i.j,…` (columns touched, in order: built at once) · `?print` · `?turn=` (quarter turns) ·
 * `?zoom=` · `?preview` (the index's card: a labyrinth built, turning slowly) · `?still`
 */
import { Labyrinth, N, H, replay } from './model';
import { buildMesh, inStone } from './mesh';
import { Renderer, camera, invert, type View } from './render';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview'), still = qs.has('still');
const canvas = document.getElementById('stone') as HTMLCanvasElement;
const R = new Renderer(canvas);
R.print = qs.has('print');
R.shadows = !qs.has('noshadow');

// ─── what's built ───
const KEY = 'labyrinth.v1';
const DEMO: Array<[number, number]> = [[8, 8], [8, 8], [8, 8], [4, 12], [12, 4], [8, 8], [12, 12], [4, 4], [8, 8]];
let model: Labyrinth;
const parseTaps = (s: string): Array<[number, number]> => s.split(',').filter(Boolean).map((t) => t.split('.').map(Number) as [number, number]);
if (qs.has('taps') || qs.has('seed') || preview) model = replay(Number(qs.get('seed') ?? 7), qs.has('taps') ? parseTaps(qs.get('taps')!) : preview ? DEMO : []);
else {
  let kept: { seed: number; taps: Array<[number, number]> } | null = null;
  try { kept = JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { /* */ }
  model = kept && typeof kept.seed === 'number' && Array.isArray(kept.taps) ? replay(kept.seed, kept.taps) : new Labyrinth((Math.random() * 1e9) | 0);
}
const keep = () => { if (preview || qs.has('taps')) return; try { localStorage.setItem(KEY, JSON.stringify({ seed: model.seed, taps: model.taps })); } catch { /* */ } };
let meshVersion = -1;
function remesh() { const m = buildMesh(model); R.upload(m); meshVersion = model.version; }

// ─── how it's seen ───
/** the four corners it settles on: a quarter turn apart, each looking down a diagonal */
const corner = (k: number) => Math.PI / 4 + (k * Math.PI) / 2;
const view: View = { az: corner(Number(qs.get('turn') ?? 0)), el: 0.58, zoom: 1, target: [0, 0, 0] };
let fit = 1, zoomK = Number(qs.get('zoom') ?? 0.82), azGoal: number | null = null;
function resize() {
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(canvas.clientWidth * dpr); canvas.height = Math.round(canvas.clientHeight * dpr);
  // (the whole slab across, and room above it for what's built)
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), half = (N / 2 + 1.2) * Math.SQRT2;
  fit = Math.max(half / aspect, half * 0.75) * 1.04;
}
addEventListener('resize', resize); resize();

// ─── touching it ───
let t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;
/** where a point on the screen looks into the stone: the column under it, or null */
function pick(cx: number, cy: number): [number, number] | null {
  const r = canvas.getBoundingClientRect(), x = ((cx - r.left) / r.width) * 2 - 1, y = 1 - ((cy - r.top) / r.height) * 2;
  const cam = camera(view, r.width / r.height), inv = invert(cam.vp);
  const un = (z: number) => { const v = [x, y, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) o[i] += inv[k * 4 + i] * v[k]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  // (along the ray, from where it comes over the top of anything built, a little at a time)
  const topY = model.top() * H + 0.5;
  let t = d[1] < 0 ? Math.max(0, (a[1] - topY) / -d[1]) : 0;
  for (; t < L; t += 0.02) {
    const p = [a[0] + d[0] * t, a[1] + d[1] * t, a[2] + d[2] * t];
    if (p[1] < -1) return null;
    if (inStone(model, p[0], p[1], p[2])) {
      const i = Math.floor(p[0] + N / 2), j = Math.floor(p[2] + N / 2);
      return i >= 0 && j >= 0 && i < N && j < N ? [i, j] : null;
    }
  }
  return null;
}
function touch(i: number, j: number): number {
  const made = model.touch(i, j, now());
  if (made) { keep(); hint(); }
  else { const el = document.getElementById('hint')!; el.textContent = 'nothing more will stand there: build round it first'; el.classList.add('on'); clearTimeout(hintT); hintT = window.setTimeout(hint, 2200); }
  return made;
}
let hintT = 0;
function hint() {
  const el = document.getElementById('hint')!, n = model.taps.length;
  el.textContent = n === 0 ? 'touch the stone' : n < 3 ? 'touch again to build higher · drag to turn' : '';
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
  if (fingers.size === 2) { const [p, q] = [...fingers.values()], d = Math.hypot(p.x - q.x, p.y - q.y); if (pinch0 > 0) zoomK = Math.max(0.3, Math.min(1.3, zoom0 * (pinch0 / d))); turned = true; return; }
  if (Math.hypot(e.clientX - f.x0, e.clientY - f.y0) > 8) { turned = true; view.az -= dx * 0.008; }
});
const up = (e: PointerEvent) => {
  const f = fingers.get(e.pointerId);
  fingers.delete(e.pointerId);
  if (!f) return;
  if (!turned && e.type === 'pointerup' && performance.now() - f.t0 < 500) { const c = pick(e.clientX, e.clientY); if (c) touch(c[0], c[1]); }
  // (let go, it settles on the nearest corner)
  if (fingers.size === 0) azGoal = corner(Math.round((view.az - Math.PI / 4) / (Math.PI / 2)));
};
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomK = Math.max(0.3, Math.min(1.3, zoomK * (1 + e.deltaY * 0.001))); }, { passive: false });

// ─── its buttons ───
const printB = document.getElementById('print')!, againB = document.getElementById('again')!;
const showPrint = () => { printB.classList.toggle('on', R.print); printB.setAttribute('aria-pressed', String(R.print)); };
printB.addEventListener('click', () => { R.print = !R.print; showPrint(); });
againB.addEventListener('click', () => { model = new Labyrinth((Math.random() * 1e9) | 0); keep(); hint(); });
showPrint(); hint();
if (preview) document.body.classList.add('preview');

// ─── each frame ───
let last = performance.now();
function frame() {
  const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (model.version !== meshVersion) remesh();
  if (preview && !still) view.az += dt * 0.12;
  else if (azGoal !== null) { const k = 1 - Math.exp(-dt * 8); view.az += (azGoal - view.az) * k; if (Math.abs(azGoal - view.az) < 1e-4) { view.az = azGoal; azGoal = null; } }
  // (it looks a little higher as it's built higher)
  const top = model.top() * H;
  view.target[1] += (top * 0.42 - view.target[1]) * (1 - Math.exp(-dt * 3));
  view.zoom = (fit + top * 0.35) * zoomK;
  R.draw(view, now(), Math.min(2, devicePixelRatio || 1));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __labyrinth: unknown }).__labyrinth = {
  get model() { return model; }, view, R,
  touch, pick,
  /** for tests and views: everything built so far, grown */
  grown: () => { t0 -= 60000; },
  probe: () => ({ seed: model.seed, taps: model.taps.length, top: model.top(), version: model.version }),
  /** where a voxel's top is on the screen (css pixels) */
  screenOf: (i: number, j: number, k: number) => {
    const r = canvas.getBoundingClientRect(), cam = camera(view, r.width / r.height), p = [i - N / 2 + 0.5, (k + 1) * H, j - N / 2 + 0.5, 1], m = cam.vp;
    const o = [0, 1, 3].map((row) => m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row] * p[3]);
    return [r.left + (o[0] / o[2] * 0.5 + 0.5) * r.width, r.top + (1 - (o[1] / o[2] * 0.5 + 0.5)) * r.height];
  },
};
