/**
 * Blocks: set stone blocks on a lattice with a finger. No block has a shape or a part of its own: each is read from
 * the blocks round it, and theirs (rules.ts), as a few plain quantities (how open each face is, how much rests on it,
 * what stands near it, what pushes on it), and one shape program makes it from those (shape.ts). Columns, arches and
 * buttresses come where the quantities fall that way, and nothing names them. Its carving is chosen by its
 * surroundings too, turned to a canonical orientation (render.ts): blocks with the same surroundings are carved alike.
 * Every block reads two cells each way, so one block set changes the shapes of those up to four away, and the change
 * runs out from the finger ring by ring.
 *
 * The hand: touch to see where the block would go (it shows already as it would be there); lift to set it. Drag to
 * lay a run of them in the plane you touched (a floor across a top, a wall up a side). Hold on a block to take it, and
 * drag on to take more. Two fingers turn the view and pinch it nearer; on a desktop, right-drag turns, the wheel
 * zooms, a right click takes. Undo, take, begin again and sound in the bar.
 *
 * Responsive first: the block under the finger and its ring are shaped at once; the rest of what it changes comes over
 * the next frames (a few milliseconds of shaping a frame), each shape made once and kept by name (shape.ts). Shapes
 * spring, settle and sink in the vertex shader, so a touch is felt without any work on the CPU.
 *
 * `?demo=…` starts from a build (demos.ts); `?preview` builds one by itself, slowly, turning (the lab's index);
 * `?debug=1` no shadows, `2` normals, `3` each block coloured by its code. `window.__blocks` is for the harness.
 */
import { World, key, unkey } from './world';
import { Reads, read, thinning, type Read } from './rules';
import { patch, cellMesh, cacheStats, known, keep, type Mesh } from './shape';
import type { Job, Done } from './mesher';
import { Renderer, chunkOf, perspective, ortho, lookAt, mul, invert, type Drawn } from './render';
import { DEMOS, type Cell } from './demos';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
/** `?debug=1` no shadows, `2` normals */
const debug = Number(params.get('debug') ?? 0);
if (preview) document.body.classList.add('preview');
const STORE = 'blocks:v1';

// ─── the world, and what's drawn of it ───
let world = new World();
try { if (!preview && !params.has('demo')) { const s = localStorage.getItem(STORE); if (s) world = World.decode(s); } } catch { /* nothing kept */ }
const has = (x: number, y: number, z: number) => world.has(x, y, z);
const reads = new Reads(has);
const canvas = document.getElementById('blocks') as HTMLCanvasElement;
const R = new Renderer(canvas);
R.debug = debug;
const t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;

/** each drawn cell: its mesh, the name of its patch, its animation */
type Cellv = Drawn & { name: string };
const drawn = new Map<number, Cellv>();
const chunkCells = new Map<string, Set<number>>();
const dirty = new Set<string>();
/** cells to shape again, by ring (how far from the edit that changed them) */
const RINGS = 5;
const queue: Array<Set<number>> = Array.from({ length: RINGS }, () => new Set());
/** blocks sinking away, drawn until they're gone */
let leaving: Array<Drawn & { until: number }> = [];
let leavingDirty = false;

const readAt = (x: number, y: number, z: number) => reads.at(x, y, z);

/** shape a cell again: at once if its shape's known (or `now`), else asked of a worker and put in when it comes */
function reshape(k: number, ring: number, born: Set<number>, sync: boolean) {
  const [x, y, z] = unkey(k);
  const p = patch(readAt, x, y, z), had = drawn.get(k);
  want.set(k, p.name);
  if ((had?.name ?? '') === p.name) return;
  const mesh = !p.name ? cellMesh(p) : known(p.name) ?? (sync || !pool.length ? cellMesh(p) : null);
  if (mesh) { put(k, p.name, mesh, born.has(k), ring); return; }
  // (asked of a worker; every cell waiting on the same shape gets it when it comes)
  const w = asked.get(p.name);
  if (w) { w.cells.push([k, ring, born.has(k)]); return; }
  const id = ++jobs, worker = pool[id % pool.length];
  asked.set(p.name, { cells: [[k, ring, born.has(k)]], id });
  names.set(id, p.name);
  worker.postMessage({ id, reads: p.reads, floor: p.floor } satisfies Job);
}
function put(k: number, name: string, mesh: Mesh, isBorn: boolean, ring: number) {
  const [x, y, z] = unkey(k), t = now(), ch = chunkOf(x, y, z), had = drawn.get(k);
  if (!mesh.i.length) { if (had) { drawn.delete(k); chunkCells.get(ch)?.delete(k); dirty.add(ch); } return; }
  // (the set block springs up; those round it settle, later and less the further they are)
  const amp = isBorn ? 1 : 0.07 / (1 + ring), at = isBorn ? t : t + ring * 0.045;
  drawn.set(k, { mesh, x, y, z, t0: at, amp, name });
  let set = chunkCells.get(ch);
  if (!set) chunkCells.set(ch, (set = new Set()));
  set.add(k); dirty.add(ch);
}

// ─── the workers: this bundle again, shaping (none where it can't be loaded as one: shaped here, a few ms a frame) ───
/** what each cell's shape should be now (its patch's name), so a shape that comes late is put in only if it still is */
const want = new Map<number, string>();
const asked = new Map<string, { cells: Array<[number, number, boolean]>; id: number }>();
const names = new Map<number, string>();
let jobs = 0;
const pool: Worker[] = [];
try {
  // (the bundle's own address, from the page's script: not import.meta, which a page that loads the bundle as a
  // classic script couldn't parse)
  const url = (document.querySelector('script[type=module][src]') as HTMLScriptElement | null)?.src;
  if (url && typeof Worker !== 'undefined' && !params.has('noworkers')) {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      const u = new URL(url); u.searchParams.set('worker', 'blocks');
      const w = new Worker(u, { type: 'module' });
      w.onmessage = (e: MessageEvent<Done>) => {
        const name = names.get(e.data.id);
        names.delete(e.data.id);
        if (!name) return;
        const mesh = { v: e.data.v, i: e.data.i };
        keep(name, mesh);
        const job = asked.get(name);
        asked.delete(name);
        for (const [k, ring, isBorn] of job?.cells ?? []) if (want.get(k) === name) put(k, name, mesh, isBorn, ring);
      };
      w.onerror = () => { pool.length = 0; for (const [name, job] of asked) for (const [k, ring] of job.cells) { queue[Math.min(ring, RINGS - 1)].add(k); want.delete(k); } asked.clear(); void name; };
      pool.push(w);
    }
  }
} catch { pool.length = 0; }

let born = new Set<number>();
/** cells changed: what's round them is read again, and shaped again, nearest first */
function changed(cells: number[], added: number[]) {
  born = new Set(added);
  for (const k of cells) { const [x, y, z] = unkey(k); reads.changed(x, y, z); }
  for (const k of cells) {
    const [x, y, z] = unkey(k);
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) for (let c = -4; c <= 4; c++) {
      if (y + b < 0) continue;
      const ring = Math.max(Math.abs(a), Math.abs(b), Math.abs(c)), kk = key(x + a, y + b, z + c);
      // (in the nearest ring it's in)
      let nearer = false;
      for (let r = 0; r < ring && !nearer; r++) nearer = queue[r].has(kk);
      if (!nearer) queue[ring].add(kk);
    }
  }
  // (the touched cell at once (its shape's known already, from the ghost); its ring as soon as it can be)
  pump(pool.length ? 3 : 4, 1);
}
/** shape what's waiting, nearest ring first, for up to `ms` (or through ring `upTo`) */
function pump(ms: number, upTo = RINGS - 1) {
  const end = performance.now() + ms;
  for (let r = 0; r <= upTo; r++) {
    for (const k of queue[r]) {
      queue[r].delete(k);
      for (let q = r + 1; q < RINGS; q++) queue[q].delete(k);
      reshape(k, r, born, r === 0);
      if (r > 0 && performance.now() > end) return;
    }
  }
}
const waiting = () => queue.reduce((n, q) => n + q.size, 0) + asked.size;

function flush() {
  for (const ch of dirty) {
    const cells: Drawn[] = [];
    for (const k of chunkCells.get(ch) ?? []) { const d = drawn.get(k); if (d) cells.push(d); }
    R.setChunk(ch, cells);
  }
  dirty.clear();
  const t = now();
  if (leaving.some((l) => l.until < t)) { leaving = leaving.filter((l) => l.until >= t); leavingDirty = true; }
  if (leavingDirty) { R.setChunk('leaving', leaving); leavingDirty = false; }
}

/** every cell drawn again from nothing (a new world) */
function rebuildAll() {
  R.clearChunks(); drawn.clear(); chunkCells.clear(); reads.clear();
  for (const q of queue) q.clear();
  const near = new Set<number>();
  for (const k of world.cells) { const [x, y, z] = unkey(k); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if (y + b >= 0) near.add(key(x + a, y + b, z + c)); }
  born = new Set();
  for (const k of near) queue[2].add(k);
}

// ─── edits ───
let saveTimer = 0;
function save() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => { try { if (!preview) localStorage.setItem(STORE, world.encode()); } catch { /* not kept */ } }, 400); }
let lastEditMs = 0;
function commit(add: number[], del: number[], join = false) {
  const t = performance.now();
  // (what's taken sinks away as it was)
  for (const k of del) { const d = drawn.get(k); if (d && world.cells.has(k)) { leaving.push({ ...d, t0: now(), amp: -1, until: now() + 0.2 }); leavingDirty = true; } }
  const e = world.apply(add, del, join);
  if (!e) return null;
  changed([...e.add, ...e.del], e.add);
  lastEditMs = performance.now() - t;
  save();
  return e;
}
function undo() {
  const e = world.undo();
  if (!e) return;
  changed([...e.add, ...e.del], e.add);
  click(0, 1, false);
  save();
}

// ─── the camera ───
/** a focus the harness holds the view on */
let held: number[] | null = null;
const cam = { yaw: -0.65, pitch: 0.62, dist: 16, focus: [0, 1, 0], goal: [0, 1, 0] };
let vp: Float32Array = new Float32Array(16), eye = [0, 0, 0];
function frameCamera(dt: number) {
  // (the view keeps the build in the middle of it, unless a hand's at work)
  if (held) cam.goal = [...held];
  else if (!stroke) {
    let n = 0, sx = 0, sz = 0, top = 0;
    for (const k of world.cells) { const [x, y, z] = unkey(k); sx += x; sz += z; top = Math.max(top, y); n++; }
    if (n) cam.goal = [sx / n, Math.min(top * 0.45, 6), sz / n];
  }
  const f = 1 - Math.exp(-dt * 3);
  for (let i = 0; i < 3; i++) cam.focus[i] += (cam.goal[i] - cam.focus[i]) * f;
  const cp = Math.cos(cam.pitch);
  eye = [cam.focus[0] + Math.sin(cam.yaw) * cp * cam.dist, cam.focus[1] + Math.sin(cam.pitch) * cam.dist, cam.focus[2] + Math.cos(cam.yaw) * cp * cam.dist];
  const aspect = canvas.clientWidth / Math.max(canvas.clientHeight, 1);
  const fov = aspect < 1 ? 0.95 : 0.75;
  vp = mul(perspective(fov, aspect, 0.2, 400), lookAt(eye, cam.focus, [0, 1, 0]));
}
const SUN = (() => { const s = [-0.48, 0.78, 0.4], l = Math.hypot(s[0], s[1], s[2]); return s.map((v) => v / l); })();
function lightMatrix(): Float32Array {
  // (the sun's view, fitted round the build)
  let r = 8;
  for (const k of world.cells) { const [x, y, z] = unkey(k); r = Math.max(r, Math.hypot(x - cam.focus[0], y, z - cam.focus[2]) + 2); }
  r = Math.min(r, 60);
  const c = cam.focus, e = [c[0] + SUN[0] * 80, c[1] + SUN[1] * 80, c[2] + SUN[2] * 80];
  return mul(ortho(-r, r, -r, r, 1, 200), lookAt(e, c, [0, 1, 0]));
}

// ─── picking: the ray from a point on the screen, through the lattice, to a block or the ground ───
type Hit = { cell: Cell; normal: Cell; ground: boolean; at: number[] };
function ray(cx: number, cy: number): { o: number[]; d: number[] } {
  const r = canvas.getBoundingClientRect(), nx = ((cx - r.left) / r.width) * 2 - 1, ny = 1 - ((cy - r.top) / r.height) * 2;
  const inv = invert(vp);
  const un = (z: number) => { const v = [nx, ny, z, 1], o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o[i] += inv[j * 4 + i] * v[j]; return [o[0] / o[3], o[1] / o[3], o[2] / o[3]]; };
  const a = un(-1), b = un(1), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(d[0], d[1], d[2]);
  return { o: a, d: d.map((v) => v / l) };
}
function pick(cx: number, cy: number, only?: (x: number, y: number, z: number) => boolean): Hit | null {
  const { o, d } = ray(cx, cy);
  const tg = d[1] < -1e-6 ? (-0.5 - o[1]) / d[1] : Infinity;
  // (the lattice, cell by cell along the ray: cells are centred on whole numbers)
  const p = [o[0] + 0.5, o[1] + 0.5, o[2] + 0.5], c = p.map(Math.floor), step = d.map((v) => (v > 0 ? 1 : -1));
  const tMax = [0, 1, 2].map((i) => (d[i] === 0 ? Infinity : ((d[i] > 0 ? c[i] + 1 - p[i] : p[i] - c[i]) / Math.abs(d[i]))));
  const tDelta = d.map((v) => (v === 0 ? Infinity : 1 / Math.abs(v)));
  let n: Cell = [0, 0, 0], t = 0;
  const test = only ?? has;
  for (let i = 0; i < 600 && t < Math.min(tg, 300); i++) {
    if (c[1] >= 0 && test(c[0], c[1], c[2])) return { cell: [c[0], c[1], c[2]], normal: n, ground: false, at: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] };
    const ax = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[ax]; c[ax] += step[ax]; tMax[ax] += tDelta[ax];
    n = [0, 0, 0]; n[ax] = -step[ax];
  }
  if (tg < 300) { const g = [o[0] + d[0] * tg, -0.5, o[2] + d[2] * tg]; return { cell: [Math.floor(g[0] + 0.5), -1, Math.floor(g[2] + 0.5)], normal: [0, 1, 0], ground: true, at: g }; }
  return null;
}
/** the cell under a point of the screen, in the plane a stroke is laid in */
function onPlane(cx: number, cy: number, s: Stroke): Cell | null {
  const { o, d } = ray(cx, cy), ax = s.axis, at = s.plane;
  if (Math.abs(d[ax]) < 1e-4) return null;
  const t = (at - o[ax]) / d[ax];
  if (t < 0 || t > 300) return null;
  const q = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t].map((v) => Math.floor(v + 0.5)) as Cell;
  q[ax] = s.layer;
  if (q[1] < 0) return null;
  return q;
}

// ─── the ghost: the block to come, as it would be there ───
function asIf(add: Cell): Mesh {
  const ka = key(...add);
  const look = (x: number, y: number, z: number) => has(x, y, z) || (y >= 0 && key(x, y, z) === ka);
  const memo = new Map<number, Read>();
  const at = (x: number, y: number, z: number) => { const k = key(x, y, z); let r = memo.get(k); if (!r) memo.set(k, (r = read(look, x, y, z))); return r; };
  return cellMesh(patch(at, ...add));
}
let ghostAt = '';
function showGhost(c: Cell | null) {
  const id = c ? c.join() : '';
  if (id === ghostAt) return;
  ghostAt = id;
  R.setGhost(c && !has(...c) ? [{ mesh: asIf(c), x: c[0], y: c[1], z: c[2], t0: now(), amp: 1 }] : []);
}
let markAt = '';
function showMark(c: Cell | null) {
  const id = c ? c.join() : '';
  if (id === markAt) return;
  markAt = id;
  const d = c ? drawn.get(key(...c)) : undefined;
  R.setMark(d ? [{ ...d, t0: 0, amp: 0 }] : []);
}

// ─── the hand ───
type Stroke = { id: number; x0: number; y0: number; axis: number; plane: number; layer: number; last: Cell; taking: boolean; started: boolean; moved: boolean; hold: number; first: Hit };
let stroke: Stroke | null = null;
let taking = false;
const touches = new Map<number, { x: number; y: number }>();
let twoFinger: { d: number; cx: number; cy: number } | null = null;
let orbiting: { id: number; x: number; y: number } | null = null;

function placeFor(h: Hit): Cell { return [h.cell[0] + h.normal[0], h.cell[1] + h.normal[1], h.cell[2] + h.normal[2]]; }
function beginStroke(e: PointerEvent, h: Hit) {
  const take = taking || e.button === 2;
  const target = take ? h.cell : placeFor(h);
  const axis = h.normal[0] ? 0 : h.normal[1] ? 1 : 2;
  // (the plane of the face touched: a run is laid across it, at the height (or depth) of the block set on it)
  const plane = target[axis] - h.normal[axis] * 0.5;
  stroke = { id: e.pointerId, x0: e.clientX, y0: e.clientY, axis, plane, layer: target[axis], last: target, taking: take, started: false, moved: false, hold: 0, first: h };
  if (take) { if (!h.ground) showMark(h.cell); }
  else showGhost(target);
  // (held still on a block: take it, and what the drag goes over after)
  if (!take && !h.ground) stroke.hold = window.setTimeout(() => {
    if (!stroke || stroke.moved) return;
    stroke.taking = true; stroke.started = true; showGhost(null);
    take1(h.cell, false);
    buzz(14);
  }, 380);
}
function take1(c: Cell, join: boolean) {
  if (!has(...c)) return;
  const e = commit([], [key(...c)], join);
  if (e) { click(c[1], 1, true); buzz(6); }
  showMark(null);
}
function set1(c: Cell, join: boolean) {
  if (c[1] < 0 || has(...c)) return;
  const e = commit([key(...c)], [], join);
  if (e) { const r = reads.at(...c), [tx, tz] = thinning(r); click(c[1], 1 + 0.35 * Math.min(tx, tz) - 0.2 * (1 - r.soft / 7), false); buzz(5); }
}
function moveStroke(e: PointerEvent) {
  const s = stroke!;
  if (!s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < 6) return;
  s.moved = true; clearTimeout(s.hold);
  if (s.taking) {
    const h = pick(e.clientX, e.clientY);
    if (h && !h.ground) { take1(h.cell, s.started); s.started = true; }
    return;
  }
  const c = onPlane(e.clientX, e.clientY, s);
  if (!c || c.join() === s.last.join()) return;
  // (every cell from the last to this, so a quick drag leaves no gaps)
  if (!s.started) { set1(s.last, false); s.started = true; }
  for (const q of line(s.last, c, s.axis)) set1(q, true);
  s.last = c;
  showGhost(null);
}
function endStroke(cancel = false) {
  const s = stroke;
  if (!s) return;
  clearTimeout(s.hold);
  stroke = null;
  if (!cancel && !s.started) {
    if (s.taking) { if (!s.first.ground) take1(s.first.cell, false); }
    else set1(s.last, false);
  }
  showGhost(null); showMark(null);
}
/** the cells from a to b in a stroke's plane, a step at a time (a's left out) */
function line(a: Cell, b: Cell, axis: number): Cell[] {
  const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const out: Cell[] = [], du = b[u] - a[u], dv = b[v] - a[v], n = Math.max(Math.abs(du), Math.abs(dv));
  let pu = a[u], pv = a[v];
  for (let i = 1; i <= n; i++) {
    const nu = a[u] + Math.round((du * i) / n), nv = a[v] + Math.round((dv * i) / n);
    // (no diagonal steps: a run joins face to face)
    if (nu !== pu && nv !== pv) { const q = [...a] as Cell; q[u] = nu; q[v] = pv; out.push(q); }
    const q = [...a] as Cell; q[u] = nu; q[v] = nv; out.push(q);
    pu = nu; pv = nv;
  }
  return out;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  if (preview) return;
  canvas.setPointerCapture(e.pointerId);
  audio();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    // (a second finger: whatever the first began is no stroke after all)
    if (stroke) endStroke(true);
    orbiting = null;
    const [a, b] = [...touches.values()];
    twoFinger = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  if (touches.size > 2) return;
  if (e.button === 1 || (e.button === 2 && e.pointerType === 'mouse') || e.shiftKey) { orbiting = { id: e.pointerId, x: e.clientX, y: e.clientY }; rightTap = { x: e.clientX, y: e.clientY, button: e.button }; return; }
  const h = pick(e.clientX, e.clientY);
  // (on the sky: turn the view)
  if (!h) { orbiting = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
  beginStroke(e, h);
});
let rightTap: { x: number; y: number; button: number } | null = null;
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (t) { t.x = e.clientX; t.y = e.clientY; }
  if (twoFinger && touches.size >= 2) {
    const [a, b] = [...touches.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    turn(cx - twoFinger.cx, cy - twoFinger.cy);
    cam.dist = clamp(cam.dist * (twoFinger.d / Math.max(d, 1)), 4, 70);
    twoFinger = { d, cx, cy };
    return;
  }
  if (orbiting && orbiting.id === e.pointerId) { turn(e.clientX - orbiting.x, e.clientY - orbiting.y); orbiting.x = e.clientX; orbiting.y = e.clientY; return; }
  if (stroke && stroke.id === e.pointerId) { moveStroke(e); return; }
  // (a mouse hovering: where a block would go)
  if (e.pointerType === 'mouse' && !e.buttons && !preview) {
    const h = pick(e.clientX, e.clientY);
    if (taking) { showGhost(null); showMark(h && !h.ground ? h.cell : null); }
    else { showMark(null); showGhost(h ? placeFor(h) : null); }
  }
});
const up = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (twoFinger) { if (touches.size < 2) twoFinger = null; return; }
  if (orbiting && orbiting.id === e.pointerId) {
    orbiting = null;
    // (a right click that didn't turn: take what's under it)
    if (rightTap && rightTap.button === 2 && Math.hypot(e.clientX - rightTap.x, e.clientY - rightTap.y) < 5) { const h = pick(e.clientX, e.clientY); if (h && !h.ground) take1(h.cell, false); }
    rightTap = null;
    return;
  }
  if (stroke && stroke.id === e.pointerId) endStroke(e.type === 'pointercancel');
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('pointerleave', () => { if (!stroke) { showGhost(null); showMark(null); } });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * Math.exp(e.deltaY * 0.0015), 4, 70); }, { passive: false });
function turn(dx: number, dy: number) {
  cam.yaw -= dx * 0.008;
  cam.pitch = clamp(cam.pitch + dy * 0.006, 0.12, 1.45);
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ─── the bar ───
const $ = (id: string) => document.getElementById(id);
$('undo')?.addEventListener('click', undo);
const takeBtn = $('take');
function setTaking(on: boolean) { taking = on; takeBtn?.classList.toggle('on', on); showGhost(null); showMark(null); }
takeBtn?.addEventListener('click', () => setTaking(!taking));
$('again')?.addEventListener('click', () => {
  if (!world.cells.size) return;
  const all = [...world.cells];
  commit([], all);
  click(0, 0.8, true);
});
let soundOn = true;
try { soundOn = localStorage.getItem('blocks:sound') !== 'off'; } catch { /* default */ }
const soundBtn = $('sound');
const showSound = () => { if (soundBtn) soundBtn.textContent = `sound · ${soundOn ? 'on' : 'off'}`; };
showSound();
soundBtn?.addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('blocks:sound', soundOn ? 'on' : 'off'); } catch { /* not kept */ } showSound(); });
addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo(); }
  else if (e.key === 'x' || e.key === 'e') setTaking(!taking);
});

// ─── touch felt: a click of stone on stone, higher up the higher it's set; a buzz ───
let ac: AudioContext | null = null;
function audio() {
  if (ac || preview) return;
  try { ac = new AudioContext(); } catch { ac = null; }
}
/** `tone`: the stone's own (higher for a slender one, deeper in a mass) */
function click(y: number, tone: number, down: boolean) {
  if (!ac || !soundOn) return;
  if (ac.state === 'suspended') void ac.resume();
  const t = ac.currentTime, f = (down ? 180 : 320) * Math.pow(2, Math.min(y, 14) / 14) * tone;
  // (the knock: a short burst of noise through a band, and the stone's own note under it)
  const n = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.04), ac.sampleRate), ch = n.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3);
  const src = ac.createBufferSource(); src.buffer = n;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 4; bp.Q.value = 3;
  const g = ac.createGain(); g.gain.value = 0.35;
  src.connect(bp).connect(g).connect(ac.destination); src.start(t);
  const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (down ? 0.6 : 0.92), t + 0.12);
  const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.28, t + 0.004); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  o.connect(og).connect(ac.destination); o.start(t); o.stop(t + 0.16);
}
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* none */ } };

// ─── the preview: a build by itself, a block at a time ───
const demo = params.get('demo');
let script: Cell[] = [], scriptAt = 0, scriptNext = 0;
if (preview) { script = DEMOS[demo ?? 'castle']?.() ?? DEMOS.castle(); cam.dist = 20; cam.pitch = 0.55; }
else if (demo && DEMOS[demo]) { world = new World(); for (const c of DEMOS[demo]()) world.cells.add(key(...c)); }
if (world.cells.size) rebuildAll();
const hint = $('hint');
if (hint && !world.cells.size && !preview) { hint.classList.add('on'); setTimeout(() => hint.classList.remove('on'), 6000); }
function autobuild(t: number) {
  if (!preview || t < scriptNext) return;
  if (scriptAt < script.length) { const c = script[scriptAt++]; commit([key(...c)], [], scriptAt > 1); scriptNext = t + 0.12; }
  else if (scriptAt === script.length) { scriptAt++; scriptNext = t + 5; }
  else { commit([], [...world.cells]); world.history.length = 0; scriptAt = 0; scriptNext = t + 1.2; }
}

// ─── each frame ───
let frames = 0, last = now(), meshMs = 0;
function frame() {
  const t = now(), dt = Math.min(t - last, 0.1);
  last = t;
  autobuild(t);
  if (preview) cam.yaw += dt * 0.12;
  const m0 = performance.now();
  pump(preview ? 4 : 6);
  flush();
  meshMs = performance.now() - m0;
  frameCamera(dt);
  R.draw({ vp, eye, light: lightMatrix(), sun: SUN, time: t, focus: cam.focus, cursor: null, ghostAlpha: 0.5 + 0.14 * Math.sin(t * 7) });
  frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ─── for the harness ───
(window as unknown as { __blocks: unknown }).__blocks = {
  get frames() { return frames; },
  get cells() { return world.cells.size; },
  get waiting() { return waiting(); },
  get drawn() { return drawn.size; },
  get lastEditMs() { return lastEditMs; },
  get meshMs() { return meshMs; },
  get workers() { return pool.length; },
  cache: cacheStats,
  place: (x: number, y: number, z: number) => commit([key(x, y, z)], []),
  take: (x: number, y: number, z: number) => commit([], [key(x, y, z)]),
  read: (x: number, y: number, z: number) => reads.at(x, y, z),
  view: (yaw: number, pitch: number, dist: number, focus?: number[]) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; if (focus) { held = focus; cam.focus = [...focus]; cam.goal = [...focus]; } },
  settled: () => waiting() === 0,
  undo,
};
