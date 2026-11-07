/**
 * Splats: a first Gaussian splat viewer for the phone, written from scratch to learn from (format.ts the data, sort.ts
 * the ordering, render.ts the projection and blending). An orbit camera (one finger turns, two pinch and pan, double
 * tap frames it again), a few scenes (one made here, three captured ones loaded from the web, or a file of your own,
 * .splat or the trainer's .ply), and ways to see the parts: each splat's ellipse, its footprint, the centres alone.
 *
 * Flags: `?scene=garden|plush|nike|train` · `?url=` (a .splat or .ply anywhere CORS lets it be read) · `?mode=0..3` ·
 * `?size=` (the splats' size, 1 as made) · `?res=` (pixels per CSS pixel, capped at the screen's) · `?preview` (a
 * small turning picture, no controls) · `?noworkers` (sort on the page's thread).
 *
 * One Stone (`?scene=stone`, stone.ts): a drawing made of splats, each feature of a boulder drawing itself (the seam a
 * broken line, the ledge's underside a wash, moss a stipple, the profile a few accents chosen for this view), on paper.
 * `?look=dry|wash` · `?detail=0..1` (how much of the drawing is kept; by each mark's rank, or `?thin=even` thinned
 * evenly to the same number) · `?view=hero|grazing|reverse` · `?orbit` (one turn round it, the same every time) ·
 * `?brush` (a finger brings the detail back where it touches, on the stone, and it stays there) · `?occluder=0`.
 */
import { Renderer } from './render';
import { bounds, garden, parse, type Splats } from './format';
import { Sorter, type SortDone } from './sort';
import { MARK, STATES, oneStone, stoneShape, type Look, type Stone } from './stone';
import { brushScene, type BrushScene } from './subjects';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (preview) document.documentElement.classList.add('preview');
if (qs.has('clean')) document.documentElement.classList.add('clean');

/** the captured scenes: from the antimatter15 viewer's examples (hosted on Hugging Face), with an up for each */
const SCENES: Record<string, { label: string; url?: string; mb?: number; up: 1 | -1 }> = {
  stone: { label: 'one stone', up: 1 },
  brushes: { label: 'brushes', up: 1 },
  garden: { label: 'garden', up: 1 },
  plush: { label: 'plush', url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/plush.splat', mb: 9, up: -1 },
  nike: { label: 'shoe', url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat', mb: 8.7, up: -1 },
  train: { label: 'train', url: 'https://huggingface.co/cakewalk/splat-data/resolve/main/train.splat', mb: 33, up: -1 },
};

const canvas = $<HTMLCanvasElement>('view');
let R: Renderer;
try { R = new Renderer(canvas); } catch (e) { $('status').textContent = String((e as Error).message); throw e; }

// ─── the scene ───
let scene: Splats | null = null, up: 1 | -1 = 1, loadMs = 0, sceneName = '';
const cam = { yaw: 0.6, pitch: 0.35, dist: 4, target: [0, 0, 0] as [number, number, number], fov: 50 * Math.PI / 180 };
let home = { ...cam, target: [...cam.target] as [number, number, number] };

function show(s: Splats, name: string, u: 1 | -1) {
  scene = s; up = u; sceneName = name;
  R.load(s);
  if (name !== 'stone') stone = null;
  if (name !== 'brushes') brushes = null;
  if (name !== 'stone' && name !== 'brushes') R.setOccluder(null);
  ranks = s.rank ? Float32Array.from(s.rank).sort() : null;
  document.documentElement.classList.toggle('paper', name === 'stone' || name === 'brushes');
  const b = bounds(s);
  cam.target = b.centre; cam.dist = b.radius * 2.2; cam.yaw = 0.6; cam.pitch = 0.3;
  home = { ...cam, target: [...cam.target] as [number, number, number] };
  sorter.data(s);
  lastDir = null;
  $('status').textContent = '';
}

async function fetchWithProgress(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`couldn't load (${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0), reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    $('status').textContent = total ? `loading ${Math.round((got / total) * 100)}% of ${(total / 1e6).toFixed(1)} MB` : `loading ${(got / 1e6).toFixed(1)} MB`;
  }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

async function open(name: string) {
  const sc = SCENES[name];
  document.querySelectorAll<HTMLButtonElement>('#scenes button[data-scene]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scene === name)));
  const t0 = performance.now();
  try {
    if (name === 'stone') openStone();
    else if (name === 'brushes') openBrushes();
    else if (!sc || !sc.url) { show(garden(Number(qs.get('count') ?? 120000)), 'garden', 1); }
    else show(parse(await fetchWithProgress(sc.url)), name, sc.up);
    loadMs = performance.now() - t0;
  } catch (e) { $('status').textContent = String((e as Error).message); }
}
async function openUrl(url: string) {
  const t0 = performance.now();
  try { show(parse(await fetchWithProgress(url)), url.split('/').pop() ?? 'url', Number(qs.get('up') ?? -1) < 0 ? -1 : 1); loadMs = performance.now() - t0; }
  catch (e) { $('status').textContent = String((e as Error).message); }
}

// ─── One Stone ───
let stone: Stone | null = null, look: Look = qs.get('look') === 'wash' ? 'wash' : 'dry', ranks: Float32Array | null = null;
let detail = Number(qs.get('detail') ?? 1), thin = qs.get('thin') === 'even' ? 1 : 0, brush = qs.has('brush'), occlude = qs.get('occluder') !== '0';
/** `?only=fracture|wash|stipple|contour|shadow|lip|chip`: one kind of mark alone */
let only = qs.has('only') ? (MARK as Record<string, number>)[qs.get('only')!] ?? -1 : -1;
/** how far the brush has developed each of the drawing's features (stone.ts FEATURE) */
const features = new Float32Array(16);
let lastPaint: [number, number, number] | null = null;
const shape = (() => { let s: Stone | null = null; return () => (s ??= stoneShape()); })();
/** the Brushes scene (subjects.ts): the same brushes on a stone, a culm, a corner and a written gesture */
let brushes: BrushScene | null = null;
/** what the camera frames on a drawing: where, and from how far */
let framing = { target: [0, 0.3, 0] as [number, number, number], dist: 4.4 };
function openBrushes() {
  const B = brushScene(look);
  show(B.drawing, 'brushes', 1);
  brushes = B;
  R.setOccluder(B.occluder);
  frameSubject(qs.get('subject'));
  setView((qs.get('view') as 'hero' | 'grazing' | 'reverse') ?? 'hero');
  syncStone();
}
/** frame one of the Brushes subjects (stone, corner, culm, gesture), or all of them */
function frameSubject(s: string | null) {
  const c = s && brushes?.centres[s];
  framing = c ? { target: [c[0], c[1], c[2]], dist: s === 'gesture' ? 2.4 : 3.2 } : { target: [0, 0.6, 0.2], dist: 7.8 };
}
function openStone() {
  framing = { target: [0, 0.3, 0], dist: 4.4 };
  const S = shape();
  show(oneStone(look, S), 'stone', 1);
  stone = S;
  // (its shape, drawn into the depth buffer only, shrunk a little toward its middle so the marks on its surface stand in
  // front of it, and only what's on the far side is hidden)
  const k = 0.99, tri = new Float32Array(S.tris.length * 3);
  for (let i = 0; i < S.tris.length; i++) for (let a = 0; a < 3; a++) tri[i * 3 + a] = S.centre[a] + (S.pos[S.tris[i] * 3 + a] - S.centre[a]) * k;
  R.setOccluder(tri);
  setView((qs.get('view') as 'hero' | 'grazing' | 'reverse') ?? 'reverse');
  syncStone();
}
const VIEWS = { hero: { yaw: 0.6, pitch: 0.32 }, grazing: { yaw: 1.35, pitch: 0.035 }, reverse: { yaw: 0.6 + Math.PI, pitch: 0.3 } };
function setView(v: keyof typeof VIEWS) {
  const V = VIEWS[v] ?? VIEWS.hero;
  Object.assign(cam, { yaw: V.yaw, pitch: V.pitch, dist: framing.dist, target: [...framing.target] as [number, number, number] });
  home = { ...cam, target: [...cam.target] as [number, number, number] };
  orbitFrom = null;
}
/** the orbit: one turn at the hero's height, the same every time */
let orbitFrom: number | null = null;
const ORBIT_S = 16;
/** the share of marks the detail keeps by rank (so the even thinning can keep the same number) */
const shareAt = (d: number) => { if (!ranks) return 1; const thr = 1 - d; let lo = 0, hi = ranks.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ranks[m] < thr) lo = m + 1; else hi = m; } return (ranks.length - lo) / ranks.length; };

// ─── the sort: in a worker if there is one (the same bundle, `?worker=splats`), else here ───
const sorter = (() => {
  let worker: Worker | null = null;
  try {
    const src = (document.querySelector('script[type=module][src]') ?? document.querySelector('script[src]'))?.getAttribute('src');
    if (src && typeof Worker !== 'undefined' && !qs.has('noworkers')) { const u = new URL(src, location.href); u.searchParams.set('worker', 'splats'); worker = new Worker(u, { type: 'module' }); }
  } catch { worker = null; }
  const local = new Sorter();
  let asked = 0, out = false, data: Splats | null = null;
  const landed = (d: SortDone) => { if (d.id !== asked) return; out = false; R.setOrder(d.order); sortMs = d.ms; };
  if (worker) { worker.onmessage = (e: MessageEvent<SortDone>) => landed(e.data); worker.onerror = () => { worker = null; out = false; }; }
  return {
    get worker() { return !!worker; },
    get busy() { return out; },
    data(s: Splats) { data = s; asked++; out = false; worker?.postMessage({ kind: 'data', pos: s.pos.slice(), n: s.n }); },
    ask(dir: [number, number, number]) {
      if (!data) return;
      asked++;
      if (worker) { out = true; worker.postMessage({ kind: 'sort', id: asked, dir }); return; }
      const t0 = performance.now(), order = local.sort(data.pos, data.n, dir);
      landed({ id: asked, order, ms: performance.now() - t0 });
    },
  };
})();
let sortMs = 0, lastDir: [number, number, number] | null = null;

// ─── the camera: orbiting a target (yaw about up, pitch over it) ───
function eye(): { pos: [number, number, number]; view: Float32Array; fwd: [number, number, number] } {
  const cp = Math.cos(cam.pitch), u = up;
  // (in a y-up world; a y-down capture is turned over by flipping y in the view)
  const off: [number, number, number] = [Math.sin(cam.yaw) * cp * cam.dist, Math.sin(cam.pitch) * cam.dist * u, Math.cos(cam.yaw) * cp * cam.dist];
  const pos: [number, number, number] = [cam.target[0] + off[0], cam.target[1] + off[1], cam.target[2] + off[2]];
  const f = norm([-off[0], -off[1], -off[2]]), r = norm(cross(f, [0, u, 0])), uu = cross(r, f);
  const view = new Float32Array([r[0], uu[0], -f[0], 0, r[1], uu[1], -f[1], 0, r[2], uu[2], -f[2], 0, -dot(r, pos), -dot(uu, pos), dot(f, pos), 1]);
  return { pos, view, fwd: f };
}
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]): [number, number, number] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function perspective(fovy: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

// ─── touch: one finger turns, two pinch and pan; a mouse drags, wheels, right-drags; a double tap frames it ───
const pts = new Map<number, { x: number; y: number }>();
let lastTap = 0, touched = performance.now();
/** a brush stroke on the stone: where the finger's ray meets it, detail brought back round there */
function paint(x: number, y: number): boolean {
  if (!stone) return false;
  const { pos, view } = eye(), r = canvas.getBoundingClientRect(), th = Math.tan(cam.fov / 2), asp = r.width / r.height;
  const sx = ((x - r.left) / r.width) * 2 - 1, sy = 1 - ((y - r.top) / r.height) * 2;
  const R0: [number, number, number] = [view[0], view[4], view[8]], U: [number, number, number] = [view[1], view[5], view[9]], F: [number, number, number] = [-view[2], -view[6], -view[10]];
  const d = norm([F[0] + R0[0] * sx * th * asp + U[0] * sy * th, F[1] + R0[1] * sx * th * asp + U[1] * sy * th, F[2] + R0[2] * sx * th * asp + U[2] * sy * th]);
  const h = stone.ray(pos, d);
  if (!h) return false;
  // (a patch already near here, on the same side, covers it: patches merge, so a long session keeps what it brushed)
  // (the feature touched develops a little with each stretch of the stroke: its own marks come back in its own order,
  // heart first, so what's revealed has the feature's shape, not the brush's)
  const f = stone.featureAt(h.p, h.region);
  if (!f) return false;
  if (lastPaint && Math.hypot(lastPaint[0] - h.p[0], lastPaint[1] - h.p[1], lastPaint[2] - h.p[2]) < 0.025) return true;
  lastPaint = h.p; features[f] = Math.min(1, features[f] + 0.07);
  return true;
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); touched = performance.now();
  if (brush && stone && pts.size === 1) { paint(e.clientX, e.clientY); return; }
  if (pts.size === 1) { const t = performance.now(); if (t - lastTap < 300) Object.assign(cam, { ...home, target: [...home.target] }); lastTap = t; }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  touched = performance.now();
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (brush && stone && pts.size === 1) { paint(e.clientX, e.clientY); p.x = e.clientX; p.y = e.clientY; return; }
  if (pts.size === 1 && !(e.buttons & 2) && !e.shiftKey) {
    cam.yaw -= dx * 0.006; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.006));
  } else if (pts.size === 1) pan(dx, dy);
  else if (pts.size === 2) {
    const [a, b] = [...pts.entries()], o = a[0] === e.pointerId ? b[1] : a[1];
    const before = Math.hypot(p.x - o.x, p.y - o.y), after = Math.hypot(e.clientX - o.x, e.clientY - o.y);
    if (before > 10) cam.dist *= before / after;
    pan(dx / 2, dy / 2);
  }
  p.x = e.clientX; p.y = e.clientY;
});
const lift = (e: PointerEvent) => pts.delete(e.pointerId);
canvas.addEventListener('pointerup', lift); canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist *= Math.exp(e.deltaY * 0.001); touched = performance.now(); }, { passive: false });
function pan(dx: number, dy: number) {
  const { view } = eye(), k = (cam.dist * Math.tan(cam.fov / 2) * 2) / canvas.clientHeight;
  for (let a = 0; a < 3; a++) cam.target[a] += (-dx * view[a * 4] + dy * view[a * 4 + 1]) * k;
}

// ─── the controls ───
let mode = Number(qs.get('mode') ?? 0), size = Number(qs.get('size') ?? 1), res = Number(qs.get('res') ?? 1.5);
const MODES = ['splats', 'ellipses', 'footprints', 'centres'];
const NOTES = [
  'Each splat a soft ellipse, blended back to front.',
  'Each splat\'s 1σ and 2σ contour: the shape the shader projects from its 3D covariance.',
  'Each splat\'s quad, solid, out to 3σ: how much screen every one of them costs to fill.',
  'Only the centres: the point cloud the splats were grown from.',
];
const modeBar = $('modes');
MODES.forEach((m, k) => { const b = document.createElement('button'); b.textContent = m; b.onclick = () => { mode = k; syncModes(); }; modeBar.append(b); });
function syncModes() { [...modeBar.querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', String(k === mode))); $('note').textContent = NOTES[mode]; }
syncModes();
const sceneBar = $('scenes');
for (const [k, s] of Object.entries(SCENES)) {
  const b = document.createElement('button'); b.dataset.scene = k; b.textContent = s.mb ? `${s.label} · ${Math.round(s.mb)} MB` : s.label;
  b.onclick = () => void open(k); sceneBar.insertBefore(b, $('file-label'));
}
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const t0 = performance.now();
  $('status').textContent = `reading ${f.name}`;
  try { show(parse(await f.arrayBuffer()), f.name, Number(qs.get('up') ?? -1) < 0 ? -1 : 1); loadMs = performance.now() - t0; document.querySelectorAll('#scenes button').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
  catch (err) { $('status').textContent = String((err as Error).message); }
});
const slider = (id: string, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
  const el = $<HTMLInputElement>(id), v = $(`${id}-v`); el.value = String(get()); v.textContent = fmt(get());
  el.oninput = () => { set(Number(el.value)); v.textContent = fmt(get()); };
};
slider('size', () => size, (v) => { size = v; }, (v) => `${v.toFixed(2)}×`);
slider('res', () => res, (v) => { res = v; }, (v) => `${Math.min(v, devicePixelRatio).toFixed(2)}`);
// (One Stone's own)
/** the current drawing again in the other look, from where the camera is */
function reopen() { const c = { ...cam, target: [...cam.target] }; if (brushes) openBrushes(); else openStone(); Object.assign(cam, c); }
const seg = (id: string, items: Array<[string, () => void, () => boolean]>) => {
  const el = $(id);
  for (const [label, act] of items) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { act(); syncStone(); }; el.append(b); }
  return () => [...el.querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', String(items[k][2]())));
};
const syncs = [
  seg('looks', [['dry', () => { look = 'dry'; reopen(); }, () => look === 'dry'], ['wash', () => { look = 'wash'; reopen(); }, () => look === 'wash']]),
  seg('states', [['sparse', () => { detail = STATES.sparse; syncDetail(); }, () => Math.abs(detail - STATES.sparse) < 0.01], ['intermediate', () => { detail = STATES.intermediate; syncDetail(); }, () => Math.abs(detail - STATES.intermediate) < 0.01], ['resolved', () => { detail = STATES.resolved; syncDetail(); }, () => detail === 1]]),
  seg('thins', [['by rank', () => { thin = 0; }, () => thin === 0], ['evenly', () => { thin = 1; }, () => thin === 1]]),
  seg('views', [['hero', () => setView('hero'), () => false], ['grazing', () => setView('grazing'), () => false], ['reverse', () => setView('reverse'), () => false], ['orbit', () => { setView('hero'); orbitFrom = performance.now(); }, () => orbitFrom !== null]]),
  seg('tools', [['brush', () => { brush = !brush; }, () => brush], ['clear', () => { features.fill(0); lastPaint = null; }, () => false], ['occluder', () => { occlude = !occlude; }, () => occlude]]),
];
function syncStone() { syncs.forEach((f) => f()); $('stone-controls').hidden = !stone && !brushes; }
slider('detail', () => detail, (v) => { detail = v; syncStone(); }, (v) => `${Math.round(v * 100)}%`);
function syncDetail() { const el = $<HTMLInputElement>('detail'); el.value = String(detail); $('detail-v').textContent = `${Math.round(detail * 100)}%`; }
$('fold').onclick = () => { const f = document.documentElement.classList.toggle('folded'); $('fold').setAttribute('aria-expanded', String(!f)); $('fold').textContent = f ? 'controls' : 'hide'; };
$('fold').textContent = 'hide';
$('flip').onclick = () => { up = up === 1 ? -1 : 1; lastDir = null; };
$('home').onclick = () => Object.assign(cam, { ...home, target: [...home.target] });

// ─── each frame ───
let frames = 0, fpsT = performance.now(), fps = 0, last = performance.now();
const theme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? [0.07, 0.075, 0.08] : [0.11, 0.115, 0.12]) as [number, number, number];
function frame() {
  const t = performance.now(), dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (orbitFrom !== null) {
    const u = (t - orbitFrom) / 1000 / ORBIT_S;
    cam.yaw = VIEWS.hero.yaw + Math.min(1, u) * Math.PI * 2;
    if (u >= 1) { orbitFrom = null; syncStone(); }
  } else if (!stone && !brushes && (preview || t - touched > 8000)) cam.yaw += dt * 0.15;
  else if ((stone || brushes) && preview) cam.yaw += dt * 0.25;
  // (the canvas at the resolution asked, never past the screen's)
  const dpr = Math.min(res, devicePixelRatio || 1), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const { view, fwd, pos } = eye();
  // (sorted again once the view's turned more than a little, and the last sort's in)
  if (scene && !sorter.busy && (!lastDir || dot(lastDir, fwd) < 0.9995)) { lastDir = fwd; sorter.ask(fwd); }
  const near = Math.max(0.01, cam.dist * 0.01), proj = perspective(cam.fov, w / h, near, cam.dist * 100);
  const fy = h / (2 * Math.tan(cam.fov / 2));
  const share = shareAt(detail);
  R.draw(view, proj, [fy, fy], { size, mode, bg: stone || brushes ? [0.937, 0.906, 0.847] : theme(), detail, thin, share, features, eye: pos, occlude, only });
  frames++;
  if (t - fpsT > 500) {
    fps = (frames * 1000) / (t - fpsT); frames = 0; fpsT = t;
    $('stats').textContent = (stone || brushes) && scene ? `${Math.round(shareAt(detail) * scene.n)} of ${scene.n} marks${features.some((v) => v > 0) ? ' + brushed' : ''} · ${fps.toFixed(0)} fps` : scene ? `${(scene.n / 1000).toFixed(0)}k splats · ${fps.toFixed(0)} fps · sort ${sortMs.toFixed(0)} ms${sorter.worker ? '' : ' (here)'} · ${w}×${h} · loaded in ${(loadMs / 1000).toFixed(1)} s` : '';
  }
  requestAnimationFrame(frame);
}

(window as unknown as { __splats: unknown }).__splats = {
  get scene() { return scene ? { name: sceneName, n: scene.n } : null; }, cam, get fps() { return fps; }, get sortMs() { return sortMs; }, get drawn() { return R.drawn; },
  setMode: (m: number) => { mode = m; syncModes(); }, open, openUrl,
  stone: { setView, setDetail: (d: number) => { detail = d; syncDetail(); syncStone(); }, setThin: (k: number) => { thin = k; }, setLook: (l: Look) => { look = l; if (brushes) openBrushes(); else openStone(); }, frame: (s: string | null) => { frameSubject(s); setView('hero'); }, paint, clear: () => { features.fill(0); lastPaint = null; }, features,
    /** a touch at a point of the stone (world), as the brush would make it from the eye; and the stone's own lines */
    touch: (p: [number, number, number]) => { if (!stone) return 0; const { pos } = eye(), d = norm([p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]]), h = stone.ray(pos, d); if (!h) return 0; const f = stone.featureAt(h.p, h.region); if (f) features[f] = Math.min(1, features[f] + 0.07); return f; },
    lines: () => (stone ? { seam: stone.seam, lip: stone.lip, crown: stone.crown } : null), setBrush: (b: boolean) => { brush = b; }, setOccluder: (b: boolean) => { occlude = b; }, setOnly: (k: number) => { only = k; }, orbit: () => { setView('hero'); orbitFrom = performance.now(); }, at: (yaw: number, pitch: number) => { cam.yaw = yaw; cam.pitch = pitch; orbitFrom = null; } },
};
if (qs.has('url')) void openUrl(qs.get('url')!); else void open(qs.get('scene') ?? 'garden');
if (qs.has('orbit')) setTimeout(() => { setView('hero'); orbitFrom = performance.now(); }, 300);
requestAnimationFrame(frame);
