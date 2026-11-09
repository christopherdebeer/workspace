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
import { MARK, STATES, stoneShape, type Look, type Stone } from './stone';
import { inkScene, type InkStats } from './ink';
import { fetchField, fieldDrawing } from './field';
import { TAUGHT } from './taught';
import { TAUGHT_FIT } from './taughtfit';
import { drawer, lift as drawerLift } from '../drawer/drawer';
import { sections } from '../drawer/sections';
import { brushScene, composedScene, stoneDrawing, REF_CAM, type BrushScene, type ComposedScene } from './subjects';
import { LIT, mistScene, referenceColours, sunDir, referenceAt, referenceLight, type MistScene } from './mist';
import { NET, ANALYTIC, BAKE, RESULTS } from './mistnet';
import { benchScene, PRESSURES } from './bench';
import { penScene, type PenScene } from './penscene';
import { paint as autographPaint } from '../autograph/ink';
import type { Editor, EditItem, Snapshot } from './edit';
import { competitionOf, controls, ease, features as groupFeatures, learned, taught, taughtFit, taughtMap, marksAtDetail, marksOf, matchBudget, rules, jitter, type GroupInfo, type Treatment, type ViewIn } from './policy';
import { POLICY } from './policynet';
import type { Material, V as BV } from './brush';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
if (preview) document.documentElement.classList.add('preview');
if (qs.has('clean')) document.documentElement.classList.add('clean');

/** the captured scenes: from the antimatter15 viewer's examples (hosted on Hugging Face), with an up for each */
const SCENES: Record<string, { label: string; url?: string; mb?: number; up: 1 | -1 }> = {
  stone: { label: 'one stone', up: 1 },
  brushes: { label: 'brushes', up: 1 },
  composed: { label: 'composed', up: 1 },
  pen: { label: 'pen', up: 1 },
  field: { label: 'fitted', up: 1 },
  bench: { label: 'bench', up: 1 },
  mist: { label: 'mist', up: 1 },
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
  if (captured && captured.name !== name) { captured = null; inkStats = null; }
  if (name !== 'stone') stone = null;
  if (name !== 'brushes' && name !== 'composed') brushes = null;
  if (name !== 'composed') composed = false;
  if (name !== 'mist') mist = null;
  if (name !== 'bench' && name !== 'composed') { bench = null; benchSel = -1; syncBench(); }
  if (name !== 'pen') { penS = null; showReference(false); }
  if (name !== 'stone' && name !== 'brushes' && name !== 'mist' && name !== 'bench' && name !== 'composed' && name !== 'pen' && name !== 'field') R.setOccluder(null);
  ranks = s.rank ? Float32Array.from(s.rank).sort() : null;
  document.documentElement.classList.toggle('paper', (inkOn && !!s.mark && !['stone', 'brushes', 'bench', 'composed', 'pen', 'mist'].includes(name)) || name === 'stone' || name === 'brushes' || name === 'bench' || name === 'composed' || name === 'pen' || name === 'field');
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
    else if (name === 'mist') openMist();
    else if (name === 'bench') openBench();
    else if (name === 'composed') openComposed();
    else if (name === 'pen') openPen();
    else if (name === 'field') await openField();
    else if (!sc || !sc.url) { showCaptured(garden(Number(qs.get('count') ?? 120000)), 'garden', 1); }
    else showCaptured(parse(await fetchWithProgress(sc.url)), name, sc.up);
    loadMs = performance.now() - t0;
  } catch (e) { $('status').textContent = String((e as Error).message); }
}
/**
 * A captured scene (a preset, a URL, a file): shown as captured, or in ink (ink.ts: its own splats as paper, outline and
 * tone). `?ink` or the *ink* button; the captured splats are kept so it toggles without loading again.
 */
let captured: { s: Splats; name: string; up: 1 | -1 } | null = null, inkOn = qs.has('ink'), inkStats: InkStats | null = null;
function showCaptured(s: Splats, name: string, up: 1 | -1) {
  if (inkOn) { const r = inkScene(s); inkStats = r.stats; show(r.drawing, name, up); if (!qs.has('detail')) { detail = 0.5; syncDetail(); } } else { inkStats = null; show(s, name, up); }
  captured = { s, name, up }; syncStone();
}
async function openUrl(url: string) {
  const t0 = performance.now();
  try { showCaptured(parse(await fetchWithProgress(url)), url.split('/').pop() ?? 'url', Number(qs.get('up') ?? -1) < 0 ? -1 : 1); loadMs = performance.now() - t0; }
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
/**
 * Mist (mist.ts): the same splats lit four ways: the expensive reference (worked out here, a chunk at a time), baked (the
 * reference under one sun and view, frozen), the analytic formula, and the tiny trained network (both in the shader).
 */
let mist: MistScene | null = null, light = qs.get('light') ?? 'neural', sunAz = Number(qs.get('az') ?? 0.9), sunEl = Number(qs.get('el') ?? 0.5), bank = Number(qs.get('bank') ?? 1);
let refJob = 0, refReady = false;
const LIGHTS = ['reference', 'baked', 'analytic', 'neural'];
function openMist() {
  const M = mistScene(bank, Number(qs.get('count') ?? 10000));
  show(M.drawing, 'mist', 1);
  mist = M;
  R.setGrid(M.grid); R.setNet(NET, ANALYTIC); R.setOccluder(M.occluder);
  framing = { target: [0, 0.55, 0], dist: 4.2 };
  setView('hero');
  relight();
  syncMist();
}
/**
 * The mist's stored light, worked out here a chunk at a time and then uploaded: in red, the method's own if it's stored
 * (the reference, or baked); in green, the reference, for the error view (`?diff`).
 */
let diff = qs.has('diff');
function relight() {
  if (!mist) return;
  const M = mist, job = ++refJob, pts = M.points, eye: [number, number, number] = [...eyePos()] as [number, number, number];
  refReady = false; $('status').textContent = '';
  const needRef = light === 'reference' || diff, needBake = light === 'baked';
  if (!needRef && !needBake) { refReady = true; return; }
  const sun = sunDir(sunAz, sunEl), bakeSun = sunDir(BAKE.az, BAKE.el), bakeEye: [number, number, number] = [3.4, 1.8, 2.4];
  const lightAt = (p: number[], s: number[], from: number[]) => { const v = norm([from[0] - p[0], from[1] - p[1], from[2] - p[2]]); return referenceLight(referenceAt(M.shape, p as [number, number, number], s as [number, number, number]), v[0] * s[0] + v[1] * s[1] + v[2] * s[2]); };
  const enc = (L: number) => Math.max(0, Math.min(255, Math.round((L / 3) * 255)));
  let i = 0;
  const chunk = () => {
    if (job !== refJob || mist !== M) return;
    const end = Math.min(pts.length, i + 500);
    for (; i < end; i++) {
      const p = pts[i].p, ref = needRef ? lightAt(p, sun, eye) : 0;
      // (the mist's splats come after the stems' marks)
      const o = (M.stems + i) * 4;
      if (needRef) M.drawing.rgba[o + 1] = enc(ref);
      M.drawing.rgba[o] = enc(needBake ? lightAt(p, bakeSun, bakeEye) : ref);
    }
    $('status').textContent = i < pts.length ? `working out the ${needRef ? 'reference' : 'baked'} light ${Math.round((i / pts.length) * 100)}%` : '';
    if (i < pts.length) setTimeout(chunk, 0); else { R.load(M.drawing); lastDir = null; refReady = true; }
  };
  chunk();
}
void referenceColours; void LIT;
const eyePos = () => eye().pos;
function syncMist() {
  [...$('lights').querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', String(k < LIGHTS.length ? LIGHTS[k] === light : diff)));
  [...$('banks').querySelectorAll('button')].forEach((b, k) => b.setAttribute('aria-pressed', String([1, 9][k] === bank)));
  $('mist-controls').hidden = !mist;
  const r = RESULTS.unseenBankUnseenSuns;
  $('mist-note').textContent = mist ? `measured against the reference where a camera sees an unseen bank under unseen suns (mean light ${r.meanLight}): baked mae ${r.baked.mae}, analytic ${r.analytic.mae}, neural ${r.neural.mae}` : '';
}
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
/**
 * The composed scene (subjects.ts `composedScene`): a stone, three culms and a corner together, with the relationships
 * (importance, one ground, the halo) on, or each drawn as if alone (`?compose=0`, the relate row).
 */
let composed = false, compose = qs.get('compose') !== '0', haloOn = qs.get('halo') !== '0', haloPx = Number(qs.get('halopx') ?? 18);
function openComposed() {
  const B = composedScene(look, compose);
  show(B.drawing, 'composed', 1);
  brushes = B; composed = true;
  editHere(B.editor); gateVals = null; policyInfo = null; policyPrev = null;
  if (judge.on) setTimeout(judgeNext, 200);
  R.setOccluder(B.occluder, B.objects);
  frameSubject(qs.get('subject'));
  setView((qs.get('view') as 'hero' | 'grazing' | 'reverse') ?? 'hero');
  // (its default view is the reference camera, the stone's designed side; ?view= for the others)
  if (qs.get('cam') === 'ref' || !qs.get('view')) camRef();
  syncStone();
}
/** the camera nearest the reference drawings' composition (devtools/splats/targets): the culm across the stone's right, the corner behind to the left */
function camRef() { Object.assign(cam, { yaw: REF_CAM.yaw, pitch: REF_CAM.pitch, dist: REF_CAM.dist, target: [...REF_CAM.target] as [number, number, number] }); home = { ...cam, target: [...cam.target] as [number, number, number] }; }
/**
 * The pen scene (penscene.ts): an Autograph stroke carried through the brush, on a board and round a culm, against the
 * brush's static stroke; and a Bamboo bank edge drawn by a hand and the pen. `reference` lays Autograph's own rendering
 * of the same writing over the screen.
 */
let penS: PenScene | null = null;
function openPen() {
  const P = penScene();
  show(P.drawing, 'pen', 1);
  penS = P; R.setOccluder(P.occluder);
  penFrame(qs.get('part') ?? 'word');
  if (qs.has('reference')) showReference(true);
}
function penFrame(name: string) {
  const c = penS?.centres[name]; if (!c) return;
  Object.assign(cam, { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: [...c.target] as [number, number, number] }); home = { ...cam, target: [...cam.target] as [number, number, number] };
}
let refCanvas: HTMLCanvasElement | null = null;
function showReference(on: boolean) {
  if (!on) { refCanvas?.remove(); refCanvas = null; return; }
  if (!penS) return;
  refCanvas ??= Object.assign(document.createElement('canvas'), { style: 'position:fixed;inset:0;width:100%;height:100%;z-index:4;background:#efe7d8' });
  document.body.append(refCanvas);
  autographPaint(refCanvas, [penS.sig], { mode: 'ink', ink: '#24201b', faint: '#bbb', pen: 'broad', dip: true, solid: true });
}
/**
 * The composed scene's gates, each frame: how much of the stone's tone is in sight from here (its shadowed faces'
 * washes, weighted by how far each faces the eye); its lit-side alternative shown as that falls; the other objects'
 * tone capped by how much tone the stone shows. Eased toward their targets, so nothing pops as the view turns.
 */
let gateVals: Float32Array | null = null, gateFresh = true, gateNow = { vis: 0, stoneTone: 0 };
function updateGates(dt: number): Float32Array | null {
  const C = brushes as ComposedScene | null;
  if (!composed || !compose || !C?.gates?.length) return null;
  if (!gateVals || gateVals.length !== C.gateBase + C.gates.length) { gateVals = new Float32Array(C.gateBase + C.gates.length); gateFresh = true; }
  const { pos } = eye(), e = norm([pos[0] - C.stoneCentre[0], pos[1] - C.stoneCentre[1], pos[2] - C.stoneCentre[2]]);
  const ds2 = (pos[0] - C.stoneCentre[0]) ** 2 + (pos[1] - C.stoneCentre[1]) ** 2 + (pos[2] - C.stoneCentre[2]) ** 2;
  let num = 0, den = 0; for (const t of C.tone) { num += t.weight * Math.max(0, dot(t.facing, e)); den += t.weight; }
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // (how much of the stone's tone faces the eye: 0.09 to 0.43 round the scene, measured)
  const vis = ss(0.08, 0.42, num / Math.max(1e-6, den));
  const tgt = new Float32Array(C.gates.length); let lit = 0, stoneApp = num / ds2;
  C.gates.forEach((g, i) => { if (g.kind === 'lit') { tgt[i] = ss(0.05, 0.5, dot(g.facing, e)) * (1 - vis); lit = Math.max(lit, tgt[i]); stoneApp += gateVals![g.index] * g.weight * Math.max(0, dot(g.facing, e)) / ds2; } });
  // (each other wash: its apparent weight from here, capped at 30% of the stone's)
  C.gates.forEach((g, i) => {
    if (g.kind !== 'cap') return;
    const d = [pos[0] - g.centre[0], pos[1] - g.centre[1], pos[2] - g.centre[2]], d2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, app = g.weight * Math.max(0, dot(g.facing, norm(d))) / d2;
    tgt[i] = Math.max(0.3, Math.min(1, (0.3 * stoneApp) / Math.max(1e-9, app)));
  });
  const stoneTone = Math.max(vis, lit * 0.8);
  const k = gateFresh ? 1 : 1 - Math.exp(-dt * 4);
  C.gates.forEach((g, i) => { gateVals![g.index] += (tgt[i] - gateVals![g.index]) * k; });
  gateFresh = false; gateNow = { vis, stoneTone };
  return gateVals;
}
/** frame one of the Brushes subjects (stone, corner, culm, gesture), or all of them */
function frameSubject(s: string | null) {
  const c = s && brushes?.centres[s];
  if (composed) { const k = (c || brushes!.centres.all) as [number, number, number]; framing = { target: [k[0], k[1], k[2]], dist: !c || s === 'all' ? 6.4 : s === 'stone' ? 3.6 : 2.2 }; return; }
  framing = c ? { target: [c[0], c[1], c[2]], dist: s === 'gesture' ? 2.4 : 3.2 } : { target: [0, 0.6, 0.2], dist: 7.8 };
}
function openStone() {
  framing = { target: [0, 0.3, 0], dist: 4.4 };
  const S = shape();
  show(stoneDrawing(look), 'stone', 1);
  stone = S;
  // (its shape, drawn into the depth buffer only, shrunk a little toward its middle so the marks on its surface stand in
  // front of it, and only what's on the far side is hidden)
  const k = 0.99, tri = new Float32Array(S.tris.length * 3);
  for (let i = 0; i < S.tris.length; i++) for (let a = 0; a < 3; a++) tri[i * 3 + a] = S.centre[a] + (S.pos[S.tris[i] * 3 + a] - S.centre[a]) * k;
  R.setOccluder(tri);
  setView((qs.get('view') as 'hero' | 'grazing' | 'reverse') ?? 'reverse');
  syncStone();
}
/**
 * The stone's drawing fitted as a field (field.ts): discs whose ink depends on where they're seen from, fitted to the
 * brush-drawn stone from 36 views. `&field=flat` for the baseline (the same discs, one constant opacity each).
 */
async function openField() {
  // (`field=stone` (the default), `composed`, `composed-resolved` (taught by the reference study too); `flat` (or the old
  // `field=flat`) for the stone's baseline)
  const which = qs.get('field') === 'flat' ? 'stone' : qs.get('field') ?? 'stone', flat = qs.has('flat') || qs.get('field') === 'flat';
  $('status').textContent = `fetching the fitted field (${which})`;
  const file = await fetchField(which);
  if (which.startsWith('composed')) {
    const sc = composedScene('wash', true);
    framing = { target: [...REF_CAM.target] as [number, number, number], dist: REF_CAM.dist };
    show(fieldDrawing(file, flat), 'field', 1); R.setOccluder(sc.occluder);
    camRef();
  } else {
    framing = { target: [0, 0.3, 0], dist: 4.4 };
    show(fieldDrawing(file, flat), 'field', 1);
    const S = shape(), k = 0.99, tri = new Float32Array(S.tris.length * 3);
    for (let i = 0; i < S.tris.length; i++) for (let a = 0; a < 3; a++) tri[i * 3 + a] = S.centre[a] + (S.pos[S.tris[i] * 3 + a] - S.centre[a]) * k;
    R.setOccluder(tri);
    setView((qs.get('view') as 'hero' | 'grazing' | 'reverse') ?? 'reverse');
  }
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


// ─── the Bench (bench.ts): one brush made dependable, and one stroke made editable ───
/** what's editable in the open scene (the Bench, or the composed scene): its editor and its items */
let bench: { editor: Editor; items: EditItem[] } | null = null, benchSel = -1, benchDirty = false, benchMsg = '';
const undoStack: Snapshot[] = [];
function editHere(ed: Editor) { bench = { editor: ed, items: ed.items }; benchSel = -1; undoStack.length = 0; benchMsg = `${ed.total.toLocaleString()} marks from ${ed.order.length} elements`; buildItems(); }
function openBench() {
  const B = benchScene();
  show(B.editor.drawing(-1), 'bench', 1);
  editHere(B.editor);
  R.setOccluder(B.occluder);
  framing = { target: [0, 0.62, 0], dist: 3.9 };
  setView('hero');
  syncBench();
}
/** the drawing again from the cache (after an edit), keeping the camera */
function benchUpload() {
  if (!bench) return;
  const d = bench.editor.drawing(benchSel); scene = d; R.load(d); sorter.data(d); lastDir = null; policyInfo = null; policyTarget = null;
  ranks = Float32Array.from(d.rank).sort();
}
/** an edit to the selected stroke: remember how it was (for undo), apply it, deposit again only what it affects */
function benchEdit(apply: () => void, remember = true) {
  if (!bench || benchSel < 0) return;
  if (remember) undoStack.push(bench.editor.snapshot(benchSel));
  apply(); benchRegen(benchSel);
}
function benchRegen(which: number | 'all') {
  if (!bench) return;
  const r = bench.editor.regenerate(which), t0 = performance.now();
  benchUpload();
  lastEdit = { deposit: r.ms, upload: performance.now() - t0, elements: r.elements, marks: r.marks };
  benchMsg = `deposited again: ${r.elements} of ${bench.editor.order.length} elements, ${r.marks.toLocaleString()} of ${bench.editor.total.toLocaleString()} marks, in ${r.ms.toFixed(0)} ms (assembled and uploaded in ${lastEdit.upload.toFixed(0)} ms)`;
  syncBench();
}
let lastEdit = { deposit: 0, upload: 0, elements: 0, marks: 0 };
function benchSelect(i: number) { benchSel = i; benchUpload(); syncBench(); }
/** a ray from the eye through a point of the screen */
function rayAt(x: number, y: number): { pos: [number, number, number]; d: [number, number, number] } {
  const { pos, view } = eye(), r = canvas.getBoundingClientRect(), th = Math.tan(cam.fov / 2), asp = r.width / r.height;
  const sx = ((x - r.left) / r.width) * 2 - 1, sy = 1 - ((y - r.top) / r.height) * 2 - viewShift;
  const R0 = [view[0], view[4], view[8]], U = [view[1], view[5], view[9]], F = [-view[2], -view[6], -view[10]];
  return { pos, d: norm([F[0] + R0[0] * sx * th * asp + U[0] * sy * th, F[1] + R0[1] * sx * th * asp + U[1] * sy * th, F[2] + R0[2] * sx * th * asp + U[2] * sy * th]) };
}
/** a point of the scene on the screen (CSS pixels), or null behind the eye */
function toScreen(p: number[]): [number, number] | null {
  const { view } = eye(), r = canvas.getBoundingClientRect(), f = 1 / Math.tan(cam.fov / 2), asp = r.width / r.height;
  const cx = view[0] * p[0] + view[4] * p[1] + view[8] * p[2] + view[12], cy = view[1] * p[0] + view[5] * p[1] + view[9] * p[2] + view[13], cz = view[2] * p[0] + view[6] * p[1] + view[10] * p[2] + view[14];
  if (cz > -0.02) return null;
  return [r.left + ((f / asp) * (cx / -cz) + 1) * 0.5 * r.width, r.top + (1 - (f * (cy / -cz) + viewShift)) * 0.5 * r.height];
}
/** the stroke nearest a tap (within a finger's width of one of its marks), or -1 */
function benchPick(x: number, y: number): number {
  if (!bench) return -1;
  let best = -1, bd = 28;
  bench.items.forEach((it, i) => { for (const d of bench!.editor.deps(it.stroke.id)) { const s = toScreen(d.p); if (!s) continue; const e = Math.hypot(s[0] - x, s[1] - y); if (e < bd) { bd = e; best = i; } } });
  return best;
}
// (the selected stroke's control points as handles over the canvas: drag one to bend the stroke)
const handles = $('handles');
let dragging: { k: number; P0: [number, number, number]; fwd: [number, number, number] } | null = null;
function placeHandles() {
  const want = bench && benchSel >= 0 ? bench.items[benchSel].handles() : [];
  while (handles.children.length < want.length) {
    const h = document.createElement('div'), k = handles.children.length;
    h.addEventListener('pointerdown', (e) => {
      if (!bench || benchSel < 0) return;
      e.stopPropagation(); h.setPointerCapture(e.pointerId);
      undoStack.push(bench.editor.snapshot(benchSel));
      const c = bench.items[benchSel].handles()[k];
      dragging = { k, P0: [c[0], c[1], c[2]], fwd: eye().fwd };
    });
    h.addEventListener('pointermove', (e) => {
      if (!dragging || !bench || benchSel < 0 || dragging.k !== k) return;
      // (the finger's ray meets the plane through the point facing the eye; on a surface the point is then taken onto it)
      const { pos, d } = rayAt(e.clientX, e.clientY), f = dragging.fwd, t = dot([dragging.P0[0] - pos[0], dragging.P0[1] - pos[1], dragging.P0[2] - pos[2]], f) / dot(d, f);
      if (bench.editor.setHandle(benchSel, k, [pos[0] + d[0] * t, pos[1] + d[1] * t, pos[2] + d[2] * t] as BV)) benchDirty = true;
    });
    const up = () => { dragging = null; };
    h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    handles.append(h);
  }
  [...handles.children].forEach((h, k) => {
    const el = h as HTMLElement, s = k < want.length ? toScreen(want[k]) : null;
    el.style.display = s ? 'block' : 'none';
    if (s) { el.style.left = `${s[0]}px`; el.style.top = `${s[1]}px`; }
  });
}
let syncBench = () => {}, buildItems = () => {};

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
let tapFrom: { x: number; y: number; t: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); touched = performance.now();
  tapFrom = pts.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now() } : null;
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
const lift = (e: PointerEvent) => {
  // (on the Bench, a tap (no drag) selects the stroke under it, or none)
  if (bench && tapFrom && e.type === 'pointerup' && Math.hypot(e.clientX - tapFrom.x, e.clientY - tapFrom.y) < 8 && performance.now() - tapFrom.t < 350) { const i = benchPick(e.clientX, e.clientY); if (i !== benchSel) benchSelect(i); }
  tapFrom = null; pts.delete(e.pointerId);
};
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
{ const b = document.createElement('button'); b.id = 'ink-toggle'; b.textContent = 'ink'; b.setAttribute('aria-pressed', String(inkOn)); b.title = 'draw a captured scene in ink, from its own splats';
  b.onclick = () => { inkOn = !inkOn; b.setAttribute('aria-pressed', String(inkOn)); if (captured) showCaptured(captured.s, captured.name, captured.up); };
  sceneBar.append(b); }
$<HTMLInputElement>('file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const t0 = performance.now();
  $('status').textContent = `reading ${f.name}`;
  try { showCaptured(parse(await f.arrayBuffer()), f.name, Number(qs.get('up') ?? -1) < 0 ? -1 : 1); loadMs = performance.now() - t0; document.querySelectorAll('#scenes button').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
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
function reopen() { const c = { ...cam, target: [...cam.target] }; if (composed) openComposed(); else if (brushes) openBrushes(); else openStone(); Object.assign(cam, c); }
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
  seg('relations', [['compose', () => { compose = !compose; reopen(); }, () => compose], ['halo', () => { haloOn = !haloOn; }, () => haloOn]]),
  seg('policies', [['ranks', () => { policyMode = 'ranks'; policyTarget = null; }, () => policyMode === 'ranks'], ['rules', () => { policyMode = 'rules'; policyTarget = null; }, () => policyMode === 'rules'], ['learned', () => { policyMode = 'learned'; policyTarget = null; }, () => policyMode === 'learned'], ['taught', () => { policyMode = 'taught'; policyTarget = null; }, () => policyMode === 'taught'], ['judge', () => { judge.on = true; judgeNext(); }, () => judge.on]]),
  // (whose decisions a taught drawing follows: an image model's three sumi-e restyles of the scene's wireframes)
  seg('teachers', (['sumi', 'sumi-bold', 'sumi-light'] as const).map((t) => [t.replace('sumi-', ''), () => { teacher = t; policyTarget = null; }, () => teacher.replace(/-minus-right$/, '') === t] as [string, () => void, () => boolean])),
  seg('tools', [['brush', () => { brush = !brush; }, () => brush], ['clear', () => { features.fill(0); lastPaint = null; }, () => false], ['occluder', () => { occlude = !occlude; }, () => occlude]]),
];
function syncStone() { syncs.forEach((f) => f()); $('stone-controls').hidden = !stone && !brushes && !(captured && inkOn); $('composition').hidden = !composed; $('teachers').hidden = policyMode !== 'taught'; syncPanel(); }
/**
 * The panel is a drawer (client/drawer, made for every experiment): closed to its grip and a line (the scene, its
 * stats); focus, the scene chips and status; full, the sections (drawing, stroke, light, display), one open at a time,
 * each saying what it's set to while shut, and a control's name tapped narrows it to that control. As it opens, the
 * camera lifts the subject clear of it (`viewShift`, eased toward the drawer's share of the screen).
 */
let viewShift = 0, viewShiftGoal = 0;
const panel = drawer($('panel'), { persist: 'splats-drawer', start: 'focus', cap: 0.62, onHeight: (h) => { viewShiftGoal = getComputedStyle($('panel')).display === 'none' ? 0 : drawerLift(h, innerHeight, 0.5); } });
const panelSections = sections($('panel'), {
  persist: 'splats-panel',
  summaries: () => ({
    drawing: `${look} · detail ${Math.round(detail * 100)}%${composed ? ` · ${policyMode}${policyMode === 'taught' ? ` by ${teacher.replace(/-minus-right$/, '')}` : ''}` : ''}`,
    bench: bench && benchSel >= 0 ? `${bench.items[benchSel].name} · ${bench.items[benchSel].stroke.material}` : 'none selected',
    mist: `${light} · sun ${sunAz.toFixed(1)}, ${sunEl.toFixed(1)}`,
    display: `${MODES[mode]} · size ${size.toFixed(2)} · res ${res}`,
  }),
});
function syncPanel() {
  panelSections.refresh();
  const t = `${sceneName || 'splats'} · ${$('stats').textContent ?? ''}`;
  if ($('psum').textContent !== t) $('psum').textContent = t;
}
slider('detail', () => detail, (v) => { detail = v; syncStone(); }, (v) => `${Math.round(v * 100)}%`);
function syncDetail() { const el = $<HTMLInputElement>('detail'); el.value = String(detail); $('detail-v').textContent = `${Math.round(detail * 100)}%`; }
LIGHTS.forEach((l) => { const b = document.createElement('button'); b.textContent = l; b.onclick = () => { light = l; relight(); syncMist(); }; $('lights').append(b); });
(() => { const b = document.createElement('button'); b.textContent = 'error'; b.id = 'diffb'; b.onclick = () => { diff = !diff; relight(); syncMist(); }; $('lights').append(b); })();
[[1, 'trained bank'], [9, 'unseen bank']].forEach(([k, l]) => { const b = document.createElement('button'); b.textContent = String(l); b.onclick = () => { bank = Number(k); openMist(); }; $('banks').append(b); });
slider('sunaz', () => sunAz, (v) => { sunAz = v; if (light === 'reference') relight(); }, (v) => `${Math.round((v * 180) / Math.PI)}°`);
slider('sunel', () => sunEl, (v) => { sunEl = v; if (light === 'reference') relight(); }, (v) => `${Math.round((v * 180) / Math.PI)}°`);
// (the Bench's own)
{
  const segB = (id: string, items: Array<[string, () => void, () => boolean]>) => {
    const el = $(id);
    for (const [label, act] of items) { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { act(); syncBench(); }; el.append(b); }
    return () => [...el.querySelectorAll('button')].forEach((b, k) => { b.setAttribute('aria-pressed', String(items[k][2]())); (b as HTMLButtonElement).disabled = id !== 'b-items' && benchSel < 0; });
  };
  const it = () => (bench && benchSel >= 0 ? bench.items[benchSel] : null);
  // (the items row: one button an editable stroke, rebuilt for each scene)
  let itemSync = () => {};
  buildItems = () => {
    const el = $('b-items'); [...el.querySelectorAll('button')].forEach((b) => b.remove());
    itemSync = bench ? segB('b-items', bench.items.map((x, i) => [x.name, () => benchSelect(benchSel === i ? -1 : i), () => benchSel === i] as [string, () => void, () => boolean])) : () => {};
  };
  const fs = [
    () => itemSync(),
    segB('b-materials', (['ink', 'dry', 'washline', 'pen'] as Material[]).map((m) => [m === 'washline' ? 'wash-line' : m, () => benchEdit(() => bench!.editor.setMaterial(benchSel, m)), () => it()?.stroke.material === m] as [string, () => void, () => boolean])),
    segB('b-pressures', Object.keys(PRESSURES).map((p) => [p, () => benchEdit(() => bench!.editor.setPressure(benchSel, p)), () => it()?.pressure === p] as [string, () => void, () => boolean])),
  ];
  const wEl = $<HTMLInputElement>('b-weight'), dEl = $<HTMLInputElement>('b-density'), aEl = $<HTMLInputElement>('b-wash');
  let wFrom: Snapshot | null = null;
  // (a slider's drag is one edit: remembered when it starts, kept when it ends)
  const sliderEdit = (el: HTMLInputElement, apply: (v: number) => void, label: string) => {
    el.onpointerdown = () => { if (bench && benchSel >= 0) wFrom = bench.editor.snapshot(benchSel); };
    el.oninput = () => { if (!bench || benchSel < 0) return; if (!wFrom) wFrom = bench.editor.snapshot(benchSel); apply(Number(el.value)); benchDirty = true; $(label).textContent = `${Number(el.value).toFixed(2)}×`; };
    el.onchange = () => { if (wFrom) undoStack.push(wFrom); wFrom = null; syncBench(); };
  };
  sliderEdit(wEl, (v) => bench!.editor.setWeight(benchSel, v), 'b-weight-v');
  sliderEdit(aEl, (v) => bench!.editor.setWash(benchSel, v), 'b-wash-v');
  dEl.oninput = () => { if (!bench) return; bench.editor.density = Number(dEl.value); $('b-density-v').textContent = `${bench.editor.density}×`; benchRegen('all'); };
  $('b-undo').onclick = () => { const s = undoStack.pop(); if (!bench || !s) return; bench.editor.restore(s); benchSel = s.item; benchRegen(s.item); };
  $('b-none').onclick = () => benchSelect(-1);
  syncBench = () => {
    $('bench-controls').hidden = !bench;
    if (!bench) { placeHandles(); return; }
    fs.forEach((f) => f());
    wEl.disabled = benchSel < 0; aEl.disabled = benchSel < 0 || !bench.items[benchSel].deps.length;
    $('b-weight-v').textContent = benchSel >= 0 ? `${bench.editor.weight(benchSel).toFixed(2)}×` : ''; $('b-wash-v').textContent = benchSel >= 0 ? `${bench.editor.washScale(benchSel).toFixed(2)}×` : '';
    if (benchSel >= 0) { wEl.value = String(bench.editor.weight(benchSel)); aEl.value = String(bench.editor.washScale(benchSel)); }
    dEl.value = String(bench.editor.density); $('b-density-v').textContent = `${bench.editor.density}×`;
    ($('b-undo') as HTMLButtonElement).disabled = !undoStack.length;
    $('b-note').textContent = (benchSel >= 0 ? `${bench.items[benchSel].name} stroke selected: drag its points to bend it. ` : 'tap a stroke to select it. ') + benchMsg;
  };
}

$('j-a').onclick = () => judgeChoose('A'); $('j-b').onclick = () => judgeChoose('B');
$('j-same').onclick = () => judgeChoose('same'); $('j-skip').onclick = () => judgeChoose('skip'); $('j-export').onclick = judgeExport;
$('j-close').onclick = () => { judge.on = false; judge.stage = 'idle'; $('judge').hidden = true; syncStone(); };
$('flip').onclick = () => { up = up === 1 ? -1 : 1; lastDir = null; };
$('home').onclick = () => Object.assign(cam, { ...home, target: [...home.target] });

// ─── the drawing policy (policy.ts): each group's treatment from the view, held to the mark budget the detail gives ───
let drawNow = () => {};
let policyTarget: Treatment | null = null, policyTick = 0, policyMs = 0, policyMode = qs.get('policy') ?? (POLICY ? 'learned' : 'rules'), policyPrev: Treatment | null = null, policyInfo: GroupInfo[] | null = null, policyNote = '';
/** what the policy knows about the composed scene's groups (again after an edit) */
const infosNow = () => (policyInfo ??= composed ? (brushes as ComposedScene).infos() : null);
function viewIn(pos: number[], fwd: number[]): ViewIn { return { eye: [pos[0], pos[1], pos[2]], fwd: [fwd[0], fwd[1], fwd[2]], focalPx: canvas.clientHeight / (2 * Math.tan(cam.fov / 2)), detail }; }
/** the rank-based treatment as a treatment (what the global detail keeps), so every policy draws through the same controls */
function ranksAsTreatment(G: GroupInfo[]): Treatment { const e = new Float32Array(G.length), s = new Float32Array(G.length).fill(1); G.forEach((g, i) => { e[i] = Math.max(0, Math.min(1, (g.hi - (1 - detail) + 0.0001) / (g.hi - g.lo + 0.03))); }); return { e, s }; }
function treatmentFor(kind: string, G: GroupInfo[], F: number[][], budget: number): Treatment {
  // (taught by a drawn teacher: its decisions for each edge and face, as they are; `?teacher=sumi|sumi-bold|sumi-light`,
  // or with `-minus-right` for scoring on a view its table never saw)
  // (fitted where it's been fitted (never on the right view, so `-minus-right` names the same fit), else by hand)
  if (kind === 'taught') { const t = teacher; return taughtFit(G, TAUGHT_FIT[t.replace(/-minus-right$/, '')]) ?? taught(G, TAUGHT, t); }
  if (kind === 'learned' && POLICY) return learned(POLICY, G, F, budget);
  if (kind === 'rules' || kind === 'learned') return matchBudget(G, rules(G, F, detail), budget);
  return ranksAsTreatment(G);
}
/** the teacher a taught drawing follows (`?teacher=sumi|sumi-bold|sumi-light`) */
let teacher = qs.get('teacher') ?? 'sumi';
/** a treatment set from outside (devtools/splats-taught-fit.mjs, fitting one): applied as given, not eased */
let policyOverride: Treatment | null = null;
function applyPolicy(dt: number, pos: number[], fwd: number[]) {
  if (composed && compose && policyOverride && !judge.on) { const G = infosNow(); if (G) { R.setControls(controls(G, policyOverride)); policyNote = `set from outside · ${marksOf(G, policyOverride)} marks`; } return; }
  if (!composed || !compose || policyMode === 'ranks' || judge.on) { if (!judge.on) R.setControls(null); policyPrev = null; policyTarget = null; return; }
  const G = infosNow(); if (!G) return;
  const t0 = performance.now(), v = viewIn(pos, fwd), comp = competitionOf(G, v), prevE = policyPrev?.e;
  const F = G.map((g, i) => groupFeatures(g, v, (brushes as ComposedScene).proxies, comp[i], prevE ? prevE[i] : 0));
  // (the target worked out every third frame, eased toward every frame: decisions change slowly, so this costs a third)
  const budget = marksAtDetail(G, detail);
  if (!policyTarget || policyTick++ % 3 === 0) policyTarget = treatmentFor(policyMode, G, F, budget);
  policyPrev = ease(policyPrev, policyTarget, 1 - Math.exp(-dt * 5));
  R.setControls(controls(G, policyPrev));
  policyMs = policyMs * 0.9 + (performance.now() - t0) * 0.1;
  policyNote = `${policyMode}${policyMode === 'learned' && !POLICY ? ' (no model yet: rules)' : ''} · ${marksOf(G, policyPrev)} of ${budget} marks · ${policyMs.toFixed(1)} ms`;
}

// ─── judging (?judge): two treatments of one view, side by side, unlabelled; the better one picked; kept to train on ───
interface Judged { view: ViewIn; budget: number; F: number[][]; A: { kind: string; e: number[]; s: number[] }; B: { kind: string; e: number[]; s: number[] }; choice: 'A' | 'B' | 'same'; cam: { yaw: number; pitch: number; dist: number }; at: string }
const judge = { on: qs.has('judge'), stage: 'idle' as 'idle' | 'settle' | 'shown', wait: 0, pair: null as null | Omit<Judged, 'choice' | 'at'>, flip: false };
const JKEY = 'splats-judgements';
const judged = (): Judged[] => { try { return JSON.parse(localStorage.getItem(JKEY) ?? '[]'); } catch { return []; } };
let jr = Date.now() % 2147483647 || 7; const jrnd = () => ((jr = (jr * 48271) % 2147483647) / 2147483647);
function judgeNext() {
  if (!composed) return;
  // (round the scene's own middle: half the views near its designed side, half anywhere round it; far enough back that
  // the whole group is in frame on a narrow portrait screen too)
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight), back = Math.min(1.9, Math.max(1, 1 / aspect) ** 0.8);
  const yaw = jrnd() < 0.5 ? REF_CAM.yaw + (jrnd() - 0.5) * 2.1 : jrnd() * Math.PI * 2;
  Object.assign(cam, { yaw, pitch: 0.12 + jrnd() * 0.4, dist: REF_CAM.dist * (1.05 + jrnd() * 0.5) * back, target: [...REF_CAM.target] as [number, number, number] });
  detail = jrnd() < 0.5 ? STATES.sparse : STATES.intermediate; syncDetail();
  judge.stage = 'settle'; judge.wait = 4; $('judge').hidden = false; $('j-a').removeAttribute('src'); $('j-b').removeAttribute('src');
}
function judgeStep() {
  if (!judge.on || judge.stage !== 'settle' || !composed) return;
  if (sorter.busy || --judge.wait > 0) return;
  const G = infosNow(); if (!G) return;
  const { pos, fwd } = eye(), v = viewIn(pos, fwd), comp = competitionOf(G, v);
  const F = G.map((g, i) => groupFeatures(g, v, (brushes as ComposedScene).proxies, comp[i], 0)), budget = marksAtDetail(G, detail);
  // (which two: the rules against a variation of them; the rules against the ranks; the model against the rules)
  const base = matchBudget(G, rules(G, F, detail), budget), roll = jrnd();
  let A = { kind: 'rules', t: base }, B: { kind: string; t: Treatment };
  if (POLICY && roll < 0.3) B = { kind: 'learned', t: learned(POLICY, G, F, budget) };
  else if (roll < 0.55) B = { kind: 'ranks', t: ranksAsTreatment(G) };
  else B = { kind: 'variation', t: matchBudget(G, jitter(G, base, jrnd), budget) };
  if (jrnd() < 0.5) [A, B] = [B, A];
  // (both drawn, then both cropped to the same box round what either drew, so they compare at one scale with no empty
  // paper round them)
  const grab = (t: Treatment) => { R.setControls(controls(G, t)); drawNow(); const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height; c.getContext('2d')!.drawImage(canvas, 0, 0); return c; };
  const ca = grab(A.t), cb = grab(B.t), box = inkBox([ca, cb]);
  ($('j-a') as HTMLImageElement).src = crop(ca, box); ($('j-b') as HTMLImageElement).src = crop(cb, box);
  judge.pair = { view: v, budget, F, A: { kind: A.kind, e: [...A.t.e], s: [...A.t.s] }, B: { kind: B.kind, e: [...B.t.e], s: [...B.t.s] }, cam: { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist } };
  judge.stage = 'shown';
  $('j-count').textContent = `${judged().length} judged`;
}
/** the box round everything drawn in any of the canvases (where a pixel differs from the paper), with a margin */
function inkBox(cs: HTMLCanvasElement[]): [number, number, number, number] {
  const W = cs[0].width, H = cs[0].height;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const c of cs) {
    const d = c.getContext('2d')!.getImageData(0, 0, W, H).data, r0 = d[0], g0 = d[1], b0 = d[2];
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 4; if (Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  }
  if (x1 < 0) return [0, 0, W, H];
  const m = Math.round(Math.max(W, H) * 0.03);
  return [Math.max(0, x0 - m), Math.max(0, y0 - m), Math.min(W, x1 + m), Math.min(H, y1 + m)];
}
function crop(c: HTMLCanvasElement, [x0, y0, x1, y1]: [number, number, number, number]): string {
  const o = document.createElement('canvas'); o.width = x1 - x0; o.height = y1 - y0;
  o.getContext('2d')!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o.toDataURL('image/jpeg', 0.9);
}
function judgeChoose(c: 'A' | 'B' | 'same' | 'skip') {
  if (judge.pair && c !== 'skip') { const all = judged(); all.push({ ...judge.pair, choice: c, at: new Date().toISOString() }); try { localStorage.setItem(JKEY, JSON.stringify(all)); } catch { /* storage full or blocked: the pair is lost */ } }
  judgeNext();
}
function judgeExport() {
  const blob = new Blob([JSON.stringify(judged())], { type: 'application/json' }), a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `splats-judgements-${new Date().toISOString().slice(0, 10)}.json`; a.click();
}

// ─── measuring on the device (&perf): each configuration in turn while the camera turns, then edits; a table to copy ───
const perf = { rec: null as number[] | null, sorts: [] as number[], spin: false };
const quantile = (a: number[], q: number) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(q * b.length))] : 0; };
async function runPerf() {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  type Phase = { name: string; apply: () => void };
  const phases: Phase[] = composed
    ? [
        { name: 'resolved · halo · ranks', apply: () => { detail = 1; haloOn = true; policyMode = 'ranks'; } },
        { name: 'resolved · no halo · ranks', apply: () => { detail = 1; haloOn = false; policyMode = 'ranks'; } },
        { name: 'sparse · halo · ranks', apply: () => { detail = STATES.sparse; haloOn = true; policyMode = 'ranks'; } },
        { name: 'sparse · halo · rules', apply: () => { detail = STATES.sparse; haloOn = true; policyMode = 'rules'; policyTarget = null; } },
        { name: 'resolved · halo · rules', apply: () => { detail = 1; haloOn = true; policyMode = 'rules'; policyTarget = null; } },
      ]
    : mist
      ? ['reference', 'analytic', 'neural'].map((l) => ({ name: `light: ${l === 'reference' ? 'stored (no lighting work)' : l}`, apply: () => { light = l; diff = false; relight(); } }))
      : [{ name: 'as it is', apply: () => {} }];
  const rows: string[][] = [];
  $('status').textContent = 'measuring…';
  for (const ph of phases) {
    ph.apply(); syncDetail(); syncStone();
    perf.spin = true; await wait(1500);
    perf.rec = []; perf.sorts = []; const pm0 = policyMs;
    await wait(6000);
    const d = perf.rec; perf.rec = null;
    rows.push([ph.name, (1000 / (d.reduce((a, b) => a + b, 0) / Math.max(1, d.length))).toFixed(0), quantile(d, 0.5).toFixed(1), quantile(d, 0.95).toFixed(1), quantile(perf.sorts, 0.5).toFixed(0), policyMode !== 'ranks' ? policyMs.toFixed(1) : '–']);
    void pm0;
  }
  perf.spin = false;
  // (edits: the seam dragged a little, ten times, each deposited again and uploaded)
  const edits: string[] = [];
  if (composed && bench) {
    const si = bench.items.findIndex((x) => x.name === 'seam');
    if (si >= 0) {
      benchSelect(si); detail = 1; policyMode = 'ranks';
      const dep: number[] = [], up: number[] = [];
      for (let k = 0; k < 10; k++) { const h = bench.items[si].handles()[2]; benchEdit(() => bench!.editor.setHandle(si, 2, [h[0] + (k % 2 ? -0.01 : 0.01), h[1] + 0.01, h[2]])); dep.push(lastEdit.deposit); up.push(lastEdit.upload); await wait(150); }
      for (let k = 0; k < 10; k++) $('b-undo').click();
      benchSelect(-1);
      edits.push(`seam edit: deposit ${quantile(dep, 0.5).toFixed(1)} ms, assemble + upload ${quantile(up, 0.5).toFixed(1)} ms (median of 10)`);
    }
  }
  const gl = R.gl, ext = gl.getExtension('WEBGL_debug_renderer_info'), gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  const head = `${sceneName} · ${scene?.n ?? 0} marks · ${canvas.width}×${canvas.height} (dpr ${devicePixelRatio}) · ${gpu} · ${navigator.userAgent.replace(/^Mozilla\/5.0 /, '')}`;
  const table = ['configuration\tfps\tframe p50 ms\tframe p95 ms\tsort ms\tpolicy ms', ...rows.map((r) => r.join('\t'))].join('\n');
  const text = `${head}\n${table}${edits.length ? '\n' + edits.join('\n') : ''}`;
  try { localStorage.setItem('splats-perf', text); } catch { /* not kept */ }
  const box = Object.assign(document.createElement('div'), { id: 'perf' });
  box.setAttribute('style', 'position:fixed;inset:auto 8px 8px 8px;z-index:5;background:var(--bg,#efe7d8);border:1px solid #999;padding:10px;font:12px ui-monospace,monospace;white-space:pre-wrap;max-height:70vh;overflow:auto');
  box.textContent = text;
  const copy = Object.assign(document.createElement('button'), { textContent: 'copy' }), close = Object.assign(document.createElement('button'), { textContent: 'close' });
  copy.onclick = () => { void navigator.clipboard?.writeText(text).then(() => { copy.textContent = 'copied'; }, () => { copy.textContent = 'select and copy'; }); };
  close.onclick = () => box.remove();
  const bar = document.createElement('div'); bar.style.marginTop = '8px'; bar.append(copy, ' ', close); box.append(bar);
  document.body.append(box);
  $('status').textContent = '';
  (window as unknown as { __perf: string }).__perf = text;
}

// ─── each frame ───
let frames = 0, fpsT = performance.now(), fps = 0, last = performance.now();
const theme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? [0.07, 0.075, 0.08] : [0.11, 0.115, 0.12]) as [number, number, number];
function frame() {
  const t = performance.now(), raw = t - last, dt = Math.min(0.1, raw / 1000); last = t;
  if (perf.rec) { perf.rec.push(raw); perf.sorts.push(sortMs); }
  if (perf.spin) cam.yaw += dt * 0.35;
  if (orbitFrom !== null) {
    const u = (t - orbitFrom) / 1000 / ORBIT_S;
    cam.yaw = VIEWS.hero.yaw + Math.min(1, u) * Math.PI * 2;
    if (u >= 1) { orbitFrom = null; syncStone(); }
  } else if (!stone && !brushes && !bench && !penS && sceneName !== 'field' && (preview || t - touched > 8000)) cam.yaw += dt * 0.15;
  else if ((stone || brushes) && preview) cam.yaw += dt * 0.25;
  // (the canvas at the resolution asked, never past the screen's)
  const dpr = Math.min(res, devicePixelRatio || 1), w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  if (bench && benchDirty && benchSel >= 0) { benchDirty = false; benchRegen(benchSel); }
  if (bench) placeHandles();
  const { view, fwd, pos } = eye();
  // (sorted again once the view's turned more than a little, and the last sort's in)
  if (scene && !sorter.busy && (!lastDir || dot(lastDir, fwd) < 0.9995)) { lastDir = fwd; sorter.ask(fwd); }
  const near = Math.max(0.01, cam.dist * 0.01), proj = perspective(cam.fov, w / h, near, cam.dist * 100);
  // (the subject lifted clear of the drawer: the projection's centre moved up by `viewShift` of the screen's height)
  viewShift += (viewShiftGoal - viewShift) * Math.min(1, dt * 8); proj[9] = -viewShift;
  const fy = h / (2 * Math.tan(cam.fov / 2));
  const share = shareAt(detail), gv0 = updateGates(dt);
  // (a taught drawing decides its washes itself: the scene's own view gates (its lit alternatives, its cap on lesser
  // objects' tone) all open, so the teacher's decisions alone say what shows)
  let gv = gv0;
  if (gv0 && composed && (policyMode === 'taught' || policyOverride)) { gv = Float32Array.from(gv0); for (const g of (brushes as ComposedScene).gates) gv[g.index] = 1; }
  drawNow = () => R.draw(view, proj, [fy, fy], { size, mode, bg: mist ? [0.13, 0.145, 0.165] : stone || brushes || bench || penS || sceneName === 'field' || (captured && inkOn) ? [0.937, 0.906, 0.847] : theme(), detail, thin, share, features: gv ?? features, eye: pos, occlude, only, light: mist ? Math.max(0, LIGHTS.indexOf(light) - 1) : 0, sun: sunDir(sunAz, sunEl), diff: mist ? diff : false, halo: composed && compose && haloOn ? haloPx * dpr : 0, nf: [near, cam.dist * 100] });
  applyPolicy(dt, pos, fwd);
  drawNow();
  judgeStep();
  frames++;
  if (t - fpsT > 500) {
    fps = (frames * 1000) / (t - fpsT); frames = 0; fpsT = t; syncPanel();
    $('stats').textContent = (stone || brushes || bench) && scene ? `${composed && policyMode !== 'ranks' ? policyNote : `${Math.round(shareAt(detail) * scene.n)} of ${scene.n} marks`}${features.some((v) => v > 0) ? ' + brushed' : ''} · ${fps.toFixed(0)} fps` : scene ? `${(scene.n / 1000).toFixed(0)}k splats · ${fps.toFixed(0)} fps · sort ${sortMs.toFixed(0)} ms${sorter.worker ? '' : ' (here)'} · ${w}×${h} · loaded in ${(loadMs / 1000).toFixed(1)} s` : '';
  }
  requestAnimationFrame(frame);
}

(window as unknown as { __splats: unknown }).__splats = {
  get scene() { return scene ? { name: sceneName, n: scene.n } : null; }, cam, get fps() { return fps; }, get sortMs() { return sortMs; }, get drawn() { return R.drawn; },
  setMode: (m: number) => { mode = m; syncModes(); }, open, openUrl,
  ink: { get stats() { return inkStats; }, get on() { return inkOn; } },
  /** set the whole camera (an orbit: yaw, pitch, distance, target, field of view) */
  camera: (c: { yaw: number; pitch: number; dist: number; target: [number, number, number]; fov?: number }) => { Object.assign(cam, { yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: [...c.target] as [number, number, number] }); if (c.fov) cam.fov = c.fov; orbitFrom = null; },
  /** this frame drawn now and read back: its lightness (green channel, 0…1) and the camera that drew it */
  grab: () => {
    drawNow(); const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d')!; g.drawImage(canvas, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data, L: number[] = [];
    for (let i = 0; i < c.width * c.height; i++) L.push(+(d[i * 4 + 1] / 255).toFixed(3));
    return { w: c.width, h: c.height, L, eye: eye().pos, target: [...cam.target], fov: cam.fov, up };
  },
  pen: { frame: (n: string) => penFrame(n), reference: (on: boolean) => showReference(on), get bank() { return penS?.bank ?? null; }, get rock() { return penS?.rock ?? null; } },
  bench: {
    get state() { return bench ? { selected: benchSel, items: bench.items.map((it, i) => ({ name: it.name, id: it.stroke.id, ctrl: it.handles(), material: it.stroke.material, pressure: it.pressure, weight: bench!.editor.weight(i), wash: bench!.editor.washScale(i), marks: bench!.editor.deps(it.stroke.id).length })), total: bench.editor.total, density: bench.editor.density, undo: undoStack.length, msg: benchMsg, lastEdit } : null; },
    select: (i: number) => benchSelect(i), pick: (x: number, y: number) => benchPick(x, y), screen: (p: number[]) => toScreen(p),
    drag: (k: number, p: BV) => benchEdit(() => bench!.editor.setHandle(benchSel, k, p)), material: (m: Material) => benchEdit(() => bench!.editor.setMaterial(benchSel, m)), pressure: (p: string) => benchEdit(() => bench!.editor.setPressure(benchSel, p)), weight: (w: number) => benchEdit(() => bench!.editor.setWeight(benchSel, w)), wash: (k: number) => benchEdit(() => bench!.editor.setWash(benchSel, k)),
    undo: () => $('b-undo').click(), density: (d: number) => { if (bench) { bench.editor.density = d; benchRegen('all'); } },
  },
  mist: { setDiff: (d: boolean) => { diff = d; relight(); }, setLight: (l: string) => { light = l; relight(); syncMist(); }, setSun: (az: number, el: number) => { sunAz = az; sunEl = el; relight(); }, setBank: (b: number) => { bank = b; openMist(); }, get ready() { return refReady; } },
  perf: () => runPerf(), get perfResult() { return (window as unknown as { __perf?: string }).__perf ?? null; },
  composed: { camRef: () => camRef(),
    /** each group's match to a teacher's entries, and a treatment set from outside (null: the policy's own again) */
    taughtMap: () => { const G = infosNow(); return G ? taughtMap(G, TAUGHT) : null; },
    setTreatment: (t: { e: number[]; s: number[]; w?: number[]; inner?: number[] } | null) => { policyOverride = t ? { e: Float32Array.from(t.e), s: Float32Array.from(t.s), w: t.w ? Float32Array.from(t.w) : undefined, inner: t.inner ? Float32Array.from(t.inner) : undefined } : null; policyPrev = null; policyTarget = null; }, get gates() { return gateNow; }, setPolicy: (m: string) => { policyMode = m; policyPrev = null; policyTarget = null; syncStone(); }, get policy() { return { mode: policyMode, note: policyNote, model: !!POLICY }; }, judge: { next: () => { judge.on = true; judgeNext(); }, choose: judgeChoose, get stage() { return judge.stage; }, get pair() { return judge.pair; }, get count() { return judged().length; }, exportJson: () => judged() }, setCompose: (c: boolean) => { compose = c; reopen(); }, setHalo: (h: boolean, px?: number) => { haloOn = h; if (px) haloPx = px; }, get importance() { return composed ? (brushes as ReturnType<typeof composedScene>).importance : null; } },
  stone: { setView, setDetail: (d: number) => { detail = d; syncDetail(); syncStone(); }, setThin: (k: number) => { thin = k; }, setLook: (l: Look) => { look = l; reopen(); }, frame: (s: string | null) => { frameSubject(s); setView('hero'); }, paint, clear: () => { features.fill(0); lastPaint = null; }, features,
    /** a touch at a point of the stone (world), as the brush would make it from the eye; and the stone's own lines */
    touch: (p: [number, number, number]) => { if (!stone) return 0; const { pos } = eye(), d = norm([p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]]), h = stone.ray(pos, d); if (!h) return 0; const f = stone.featureAt(h.p, h.region); if (f) features[f] = Math.min(1, features[f] + 0.07); return f; },
    lines: () => (stone ? { seam: stone.seam, lip: stone.lip, crown: stone.crown } : null), setBrush: (b: boolean) => { brush = b; }, setOccluder: (b: boolean) => { occlude = b; }, setOnly: (k: number) => { only = k; }, orbit: () => { setView('hero'); orbitFrom = performance.now(); }, at: (yaw: number, pitch: number) => { cam.yaw = yaw; cam.pitch = pitch; orbitFrom = null; } },
};
if (qs.has('url')) void openUrl(qs.get('url')!); else void open(qs.get('scene') ?? 'garden');
if (qs.has('orbit')) setTimeout(() => { setView('hero'); orbitFrom = performance.now(); }, 300);
// (&perf: measure once the scene is up and the first sort is in)
if (qs.has('perf')) { const go = () => (scene && R.drawn > 0 ? setTimeout(() => void runPerf(), 1500) : setTimeout(go, 300)); go(); }
requestAnimationFrame(frame);
