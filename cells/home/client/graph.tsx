/**
 * FullGraph (ADR-0047, v5) — home's primary surface: the WHOLE substrate slice
 * as a full-viewport 3D constellation. The graph IS the workspace; everything
 * else floats over it.
 *
 * v5 (owner direction, 2026-07-10): the 2D canvas map is GONE — the three.js
 * explore mode is the graph, not a mode. One renderer to refine instead of two
 * to keep visually consistent; the semantic [x,y,z] projection was always the
 * fuller signal (the map flattened its third axis away). d3 (the 2D force sim)
 * is no longer loaded at all.
 *
 * Data: `workspace.query {rankBy:'salience'}` (no limit) loads the entire slice,
 * `workspace.graph` supplies the full Reference projection (authored + derived),
 * filtered to edges among visible nodes. Node radius = salience score (degree
 * assist); node hue = type (stable hash). Edge grammar: authored solid,
 * `similarTo` the faint constellation, membership (onBoard/inDoc/inView —
 * ADR-0046) a light dash, other derived dashed.
 *
 * Focus band: the graph loads everything but lifts the *focus band* — the most
 * salient facts (the salience focus tier, widened to ~top 12% so a flat slice
 * still reads as a band, not a handful) — out of it. The band renders bright and
 * labelled; the periphery is loaded but recedes to a dim wash. Selection and
 * console highlights override this resting state.
 *
 * Layout is SEMANTIC: `workspace.project` writes `_home/embed2d` — each fact's
 * [x,y,z] place in embedding meaning-space (PCA over its Titan vector) — and
 * nodes sit at that coordinate scaled into the scene (a scattered ring when a
 * fact has none). A fact's position is its *meaning*, not a force equilibrium.
 *
 * The scene: a luminous additive point cloud (one draw call) with additive
 * backbone edges (`similarTo` dropped — proximity already says it), UnrealBloom
 * (desktop), ACES tone mapping, a camera-aimed TORCH falloff for atmosphere,
 * a star-map camera (camera-controls: dolly-to-cursor, fly-through, fitToSphere
 * framing on select) with idle auto-rotate, and CSS2D labels lit by the beam
 * (plus the selection/highlight set, always).
 */
import * as React from 'react';
import { mcpCall } from './lib';
import { factTitle, type ListEntry } from './facts';
import { ink } from './ink';

const { useEffect, useRef, useState } = React;

export interface GraphNode {
  key: string;
  type: string | null;
  score: number;
  label: string;
}

/** Console → graph seam (dispatched by Console.invoke; the openFact pattern). */
export const CONSOLE_RESULT_EVENT = 'home:console-result';

interface GEdge {
  from: string;
  rel: string;
  to: string;
  derived?: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── scene tunables (?tune=1 mounts a live panel; ?tune=0 clears) ──────────
// Every hand-tuned constant of the torch/beam/label/edge/bloom system, in one
// mutable object. The tuner (lil-gui, esm.sh) writes here, persists overrides
// to localStorage, and pokes the refresh hooks — so feel can be dialled on a
// PHONE against live data, then the winning values sent back to be hard-coded.
const TUNE_DEFAULTS = {
  // torch (the scene LIGHTING — owner re-grade 2026-07-10 #2: a graded VIGNETTE,
  // not a flood. coneIn/depthIn at ~0 mean there is no full-brightness plateau
  // at all — light falls continuously from the focal point outward in angle AND
  // depth, down to the 0.2 floor. Shape over flatness; brightness is bought
  // back with exposure, not with a wider hot zone.)
  coneIn: 0.02, coneOut: 1.2, depthIn: 0.05, depthOut: 4, torchFloor: 0.2,
  // label admission (the SELECTOR) — decoupled from the lighting: labels need
  // a sharp instrument even when the light is flat, so admission ranks by its
  // own narrow cone. beamOn 0.85 / beamOff 0.2 = admit dead-centre, linger.
  labelConeIn: 0.14, labelConeOut: 0.42,
  beamOn: 0.85, beamOff: 0.2, beamCapFocus: 5, labelCap: 0, // labelCap 0 = viewport default (12/22)
  beamOpacity: 0.57, beamSizeMult: 0.39,
  // focus labels — annotation, not headline: the geometry (amber fan, boosted
  // points, bloom) carries structure; text names things.
  selSizeMult: 0.8, hitSizeMult: 0.8, nbrSizeMult: 0.74, nbrOpFar: 0.38, nbrOpNear: 1.0,
  labelFade: 4, // lerp rate: higher = snappier
  // nodes — hot going in, compressed by tone mapping (film grading).
  // boostSizeGain > 1: a focused node more than doubles — selection reads as
  // an OBJECT in the scene, not a brighter dot.
  nodeDim: 1.5, nbrBoost: 1.0, boostSizeGain: 1.12,
  // edges — membership-forward at rest: the container lattice (member 0.35)
  // is the visible structure, similar kinship a quiet field (0.14), authored
  // statements pulled back to parity (0.17) — they get their moment as the
  // full-alpha amber fan when a node is selected, not as resting clutter.
  edgeSimilar: 0.14, edgeMember: 0.35, edgeDerived: 0.135, edgeAuthored: 0.17,
  focusEdgeAlpha: 1.0, atmosphereDim: 0.45,
  // bloom / exposure — selective accent, not wash: higher threshold (0.6) so
  // only genuinely hot pixels bloom (boosted focus, cluster cores), tight
  // radius, over a brighter ACES base (exposure 0.74). Forced ON everywhere —
  // mobile is correct since the composer pixel-ratio fix, and the owner graded
  // with it on.
  bloomStrength: 0.78, bloomRadius: 0.43, bloomThreshold: 0.6, exposure: 0.74,
  bloomMode: 'on' as 'auto' | 'on' | 'off',
  // places (cartography): constellation captions — COMPUTED from salience
  // hubs + dominant types, with registered VIEWS as the authored layer — and
  // resting orientation anchors (top-salience node per screen region).
  // constNear/Far: approach-fade band as multiples of a cluster's radius —
  // captions read from afar and hand off to fact labels as you arrive.
  constCap: 8, constOpacity: 0.6, constNear: 1.15, constFar: 2.4,
  anchorCap: 8, anchorOpacity: 0.5, anchorSizeMult: 0.62,
};
const TUNE: typeof TUNE_DEFAULTS = { ...TUNE_DEFAULTS };
const TUNE_LS = 'parc.home.tune';
try {
  const saved = JSON.parse(localStorage.getItem(TUNE_LS) ?? 'null');
  if (saved && typeof saved === 'object') Object.assign(TUNE, saved);
} catch { /* defaults */ }
const tuneEnabled = (): boolean => {
  try {
    const q = new URLSearchParams(location.search).get('tune');
    if (q === '0') localStorage.removeItem(TUNE_LS + '.on');
    else if (q === '1' || location.hash.includes('tune')) localStorage.setItem(TUNE_LS + '.on', '1');
    return q === '1' || location.hash.includes('tune') || localStorage.getItem(TUNE_LS + '.on') === '1';
  } catch { return false; }
};
const hueOf = (t: string): number => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
};
const nodeColor = (t: string | null): string => (t ? `hsl(${hueOf(t)} 42% 55%)` : '#9a917f');

// Typography carries ONTOLOGY (the map-reading trick: a river and a road are
// distinguishable by letterform alone). Hue already codes type on the dots;
// letterform repeats it on the labels, so the coding survives at label-only
// zoom. Groups, not an exhaustive registry — unknown types stay instrument mono.
const TYPE_SERIF = 'Georgia,"Iowan Old Style","Palatino Linotype",serif';
const TYPE_SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';
const ACTIONABLE_TYPES = new Set(['project', 'goal', 'task', 'todo', 'machine', 'cell', 'view']);
const DOCUMENT_TYPES = new Set(['source', 'doc', 'document', 'capture', 'log', 'file', 'trajectory', 'article']);
const KB_TYPES = new Set(['knowledge', 'decision', 'question', 'mental-model', 'idea', 'insight']);
function labelFont(t: string | null): { family: string; style: string; variant: string } {
  if (t && ACTIONABLE_TYPES.has(t)) return { family: TYPE_SANS, style: 'normal', variant: 'small-caps' };
  if (t && DOCUMENT_TYPES.has(t)) return { family: TYPE_SERIF, style: 'italic', variant: 'normal' };
  if (t && KB_TYPES.has(t)) return { family: TYPE_SERIF, style: 'normal', variant: 'normal' };
  return { family: 'ui-monospace,monospace', style: 'normal', variant: 'normal' };
}
// Knockout halo: thin text must survive sitting over a bloom core.
const LABEL_HALO = 'text-shadow:0 1px 3px #000,0 -1px 3px #000,1px 0 3px #000,-1px 0 3px #000,0 0 2px #000';

// A name fit to stand for a PLACE (or hold an orientation anchor): human
// words, not machine keys. "Design Models world time" qualifies; a run key
// like "machine/weave/run/2026-07-01T21…" is data, not a toponym — first
// screenshots put exactly those in 24px caps across the map.
const placeworthy = (s: string | null | undefined): boolean =>
  !!s && s.length >= 3 && !s.includes('/') && !/\d{4}-\d{2}/.test(s);

const MEMBER_RELS = new Set(['onBoard', 'inDoc', 'inView']);
// Warm-light strokes — a dark #5a5142 vanished into the dusk background. Base
// opacities are the CEILING an edge reaches at full interest; at rest the DOI
// scaling below keeps the mat far quieter (the ~9k-edge slice was drowning the
// nodes in a beige wash — figure/ground collapse).
interface EdgeStyle { stroke: string; dash: number[] | null; opacity: number; width: number }
function edgeStyle(e: GEdge): EdgeStyle {
  if (e.rel === 'similarTo') return { stroke: ink.edge, dash: null, opacity: 0.06, width: 1 };
  if (MEMBER_RELS.has(e.rel)) return { stroke: ink.edge, dash: [2, 3], opacity: 0.22, width: 1 };
  if (e.derived) return { stroke: ink.edge, dash: [3, 3], opacity: 0.18, width: 1 };
  return { stroke: ink.edgeAuthored, dash: null, opacity: 0.45, width: 1.5 };
}

/**
 * Degree-of-Interest (Furnas) — ONE continuous [0,1] emphasis per node, the
 * unified "focus+context" signal that drives opacity, size, labels, and edge
 * brightness alike (so they can't disagree). It blends intrinsic salience with
 * graph-focus (the current selection/highlight neighbourhood). The renderer
 * layers its SPATIAL focal falloff (the torch) on top. Selection lifts a
 * node's DOI above any spatial penalty, so a selected node's neighbour reads as
 * focused even when it's far from the camera (the disagreement the old stacked
 * dimmers had).
 */
function nodeDOI(n: any, selKey: string | null, nbr: Set<string> | null, hiSet: Set<string> | null, N: number): number {
  if (selKey) return n.id === selKey ? 1 : nbr?.has(n.id) ? 0.8 : 0.1;
  if (hiSet) return hiSet.has(n.id) ? 1 : 0.12;
  const salN = 1 - (n.rank ?? N) / Math.max(1, N); // 1 = most salient
  return 0.12 + 0.88 * salN * salN; // salience-graded resting emphasis (steep, so the top pops)
}

const shortLabel = (s: string): string => (s.length > 26 ? s.slice(0, 25) + '…' : s);

/** Extract fact keys from an arbitrary console result (search/query/recall/
 *  neighbors/single-fact shapes) — best-effort, empty = no graph reaction. */
function keysOfResult(value: unknown): string[] {
  const v = value as Record<string, any> | null;
  if (!v || typeof v !== 'object') return [];
  const out = new Set<string>();
  const entries = v.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) if (e?.key) out.add(String(e.key));
  } else if (entries && typeof entries === 'object') {
    for (const k of Object.keys(entries)) out.add(k);
  }
  if (v.focus && typeof v.focus === 'object') for (const k of Object.keys(v.focus)) out.add(k);
  if (Array.isArray(v.members)) for (const m of v.members) if (m?.key) out.add(String(m.key));
  if (typeof v.key === 'string' && v.value !== undefined) out.add(v.key);
  return [...out];
}

/** Substrate plumbing stays out of the node band: reserved-namespace keys
 *  (`_canvas/…` placements, `_home/layout`, `_types/…`) are projections'
 *  raw material, not knowledge — a placement's geometry already surfaces as
 *  the el's `onBoard` edge (ADR-0046); showing the decoration fact too would
 *  scatter edgeless satellites across the graph. */
const isPlumbing = (e: ListEntry): boolean => e.key.startsWith('_') || (e._meta?.type ?? '') === 'canvas-placement';

/** Errors thrown inside externally-dispatched handlers (event listeners fed by
 *  cross-origin CDN code) surface as a masked "Script error." on Safari.
 *  Re-reporting from this same-origin module keeps the message + stack. */
function guard<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    try {
      fn(...a);
    } catch (err) {
      (window.reportError ?? console.error)(err);
    }
  };
}

interface GraphModel {
  nodes: any[];
  links: any[];
  nodeById: Map<string, any>;
  /** key → [x, y, z] semantic coords in ~[-1.3, 1.3], or null when unprojected. */
  coordMap: Record<string, number[]> | null;
  focusKeys: Set<string>;
}

/** Load the whole slice + projection into a render-ready model: nodes, edges,
 *  the focus band, and the semantic coordinates. */
async function fetchGraphModel(): Promise<GraphModel> {
  const [nodesRes, cfgRes, layoutRes] = await Promise.all([
    mcpCall('read', 'workspace.query', { rankBy: 'salience', shape: 'card' }),
    mcpCall('read', 'workspace.peek', { key: '_config/salience' }).catch(() => null),
    // The precomputed SEMANTIC layout (workspace.project → `_home/embed2d`, [x,y,z]).
    mcpCall('read', 'workspace.peek', { key: '_home/embed2d' }).catch(() => null),
  ]);
  const cfgVal = (cfgRes && cfgRes.ok ? (cfgRes.value as { value?: { focusThreshold?: unknown } } | null)?.value : null) ?? null;
  const ftRaw = Number(cfgVal?.focusThreshold);
  const focusThreshold = Number.isFinite(ftRaw) && ftRaw > 0 && ftRaw <= 1 ? ftRaw : 0.5;
  const allEntries = (nodesRes.ok ? ((nodesRes.value as { entries?: ListEntry[] })?.entries ?? []) : []) as ListEntry[];
  const entries = allEntries.filter((e) => !isPlumbing(e));
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const edgesRes = await mcpCall('read', 'workspace.graph', {});
  const rawEdges = (edgesRes.ok ? ((edgesRes.value as { edges?: GEdge[] })?.edges ?? []) : []) as GEdge[];
  const edges = rawEdges.filter((e) => byKey.has(e.from) && byKey.has(e.to));
  const deg = new Map<string, number>();
  for (const e of edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  const nodes: any[] = entries.map((e) => ({
    id: e.key,
    type: e._meta?.type ?? null,
    score: Number(e._meta?.score) || 0,
    label: shortLabel(factTitle(e)),
    deg: deg.get(e.key) ?? 0,
  }));
  const layoutV = (layoutRes && layoutRes.ok ? (layoutRes.value as { value?: { coords?: Record<string, number[]> } } | null)?.value : null) ?? null;
  const coordMap = layoutV?.coords && typeof layoutV.coords === 'object' ? (layoutV.coords as Record<string, number[]>) : null;
  // The focus band: the salience focus tier (score ≥ threshold), WIDENED to at
  // least the top ~12% (and ≥12) by score so a flat slice still reads as a band.
  const byScore = [...nodes].sort((a, b) => b.score - a.score);
  byScore.forEach((n, i) => { n.rank = i; }); // salience rank (0 = most salient) — drives the visibility slider
  const tierCount = nodes.filter((n) => n.score >= focusThreshold).length;
  const bandN = Math.min(nodes.length, Math.max(tierCount, Math.ceil(nodes.length * 0.12), 12));
  const focusKeys = new Set<string>(byScore.slice(0, bandN).map((n) => n.id));
  const links: any[] = edges.map((e) => ({ id: `${e.from}|${e.rel}|${e.to}`, source: e.from, target: e.to, rel: e.rel, derived: e.derived }));
  const nodeById = new Map<string, any>(nodes.map((n) => [n.id, n]));
  return { nodes, links, nodeById, coordMap, focusKeys };
}

/* ── 3D explore mode (raw three.js) ──────────────────────────────────────────
 * The same slice + semantic projection as the 2D map, rendered as a luminous
 * point-cloud constellation you orbit. Positions are precomputed, so there is no
 * force engine — a thin three.js scene we own end to end, which is what lets us
 * do the "make it glow / make it breathe" treatment: additive-blended point
 * nodes (ONE draw call) and additive edges, UnrealBloom (desktop), ACES tone
 * mapping, focal depth-fade for atmosphere, and a star-map camera (camera-
 * controls) — dolly-to-cursor, fly-through, and fitToSphere framing on select. Edges are the authored + derived BACKBONE only — `similarTo` is
 * already expressed by proximity, so it's dropped. Labels are CSS2D (focus band
 * + selection), faded by camera distance. The 2D canvas stays the legible default. */

// three + its addons from a SINGLE pinned version so they share one module
// instance (bloom/controls break across mismatched three copies). esm.sh
// externalizes each addon's `three` to this same URL. Computed specifiers keep
// the whole three tree out of the SSR bundle (bundling it OOMs the deployer).
const THREE_VER = '0.160.0';
const esmURL = (path: string): string => `https://esm.sh/${path}`;
let threeMod: Promise<any> | null = null;
const loadThree = (): Promise<any> =>
  (threeMod ??= import(/* @vite-ignore */ esmURL(`three@${THREE_VER}`)).catch(() => null));
let addonsMod: Promise<any> | null = null;
const loadThreeAddons = (): Promise<any> =>
  (addonsMod ??= Promise.all([
    // camera-controls (yomotsu): the star-map camera — damped orbit, dolly-to-
    // cursor, fly-through, and smooth fitToSphere/moveTo framing. Uses an
    // injected THREE subset (no bundled three), so it shares our instance.
    import(/* @vite-ignore */ esmURL(`camera-controls@2.9.0`)),
    import(/* @vite-ignore */ esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/EffectComposer.js`)),
    import(/* @vite-ignore */ esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/RenderPass.js`)),
    import(/* @vite-ignore */ esmURL(`three@${THREE_VER}/examples/jsm/postprocessing/UnrealBloomPass.js`)),
    import(/* @vite-ignore */ esmURL(`three@${THREE_VER}/examples/jsm/renderers/CSS2DRenderer.js`)),
  ])
    .then(([cc, comp, rp, bloom, css]) => ({
      CameraControls: cc.default ?? cc,
      EffectComposer: comp.EffectComposer,
      RenderPass: rp.RenderPass,
      UnrealBloomPass: bloom.UnrealBloomPass,
      CSS2DRenderer: css.CSS2DRenderer,
      CSS2DObject: css.CSS2DObject,
    }))
    .catch(() => null));
let ccInstalled = false;

/** HSL (h∈[0,360], s,l∈[0,1]) → [r,g,b] in [0,1], for colour buffers. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return s === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
/** '#rrggbb' → [r,g,b] in [0,1]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
/** A soft round sprite (radial alpha falloff) for the additive point cloud. */
function makeDiscTexture(THREE: any): any {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.82)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}
/** A hollow ring sprite — the selection highlight around the chosen node. */
function makeRingTexture(THREE: any): any {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 10, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

function ThreeGraph({ selectedKey, onSelect, visible }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void; visible: number }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const api = useRef<{ select: (key: string | null, fly?: boolean) => void; setVisible: (f: number) => void } | null>(null);
  const lastExternal = useRef<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let onResult: ((ev: Event) => void) | null = null;
    let cleanup: (() => void) | null = null;

    (async () => {
      const [model, THREE, addons] = await Promise.all([fetchGraphModel(), loadThree(), loadThreeAddons()]);
      if (disposed) return;
      if (!THREE || !addons) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">3D renderer unavailable (offline?)</div>';
        return;
      }
      const { CameraControls, EffectComposer, RenderPass, UnrealBloomPass, CSS2DRenderer, CSS2DObject } = addons;
      if (!ccInstalled) { CameraControls.install({ THREE }); ccInstalled = true; }
      const { nodes, nodeById, coordMap, focusKeys } = model;
      // Drop `similarTo`: kinship is already expressed by proximity in this
      // layout, so only the authored edges + the derived backbone add info.
      const links = model.links.filter((l: any) => l.rel !== 'similarTo');
      const idOf = (x: any): string => (x && typeof x === 'object' ? x.id : x);
      const inFocus = (n: any): boolean => !!n && focusKeys.has(n.id);
      const rad = (n: any): number => 2 + n.score * 7 + Math.min(4, Math.sqrt(n.deg) * 1.1);
      const idx = new Map<string, number>(nodes.map((n: any, i: number) => [n.id, i]));

      // ── fixed positions from the semantic [x,y,z] (scattered ring if missing) ──
      const SPREAD = 420;
      const N = nodes.length;
      const posBuf = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const c = coordMap?.[n.id];
        let x: number, y: number, z: number;
        if (c) { x = c[0] * SPREAD; y = c[1] * SPREAD; z = (c[2] ?? 0) * SPREAD; }
        else { const a = i * 2.3999; x = Math.cos(a) * SPREAD * 0.6; y = Math.sin(a) * SPREAD * 0.6; z = ((i % 13) - 6) * 14; }
        n.x = x; n.y = y; n.z = z;
        posBuf[i * 3] = x; posBuf[i * 3 + 1] = y; posBuf[i * 3 + 2] = z;
      }

      // ── selection / highlight state ──
      let selKey: string | null = null;
      let nbr: Set<string> | null = null;
      let hiSet: Set<string> | null = null;
      // Salience visibility (slider): show the top `visCount` by rank; hidden
      // nodes/edges/labels get alpha 0. Never below the focus band.
      const minVis = focusKeys.size;
      let visCount = N;
      const isVis = (n: any): boolean => !!n && (n.rank === undefined || n.rank < visCount);
      const neighborsOf = (k: string): Set<string> => {
        const s = new Set<string>();
        for (const l of links) { const a = idOf(l.source), b = idOf(l.target); if (a === k) s.add(b); else if (b === k) s.add(a); }
        return s;
      };

      // ── node colour / size / alpha buffers ──
      const colBuf = new Float32Array(N * 3);
      const sizeBuf = new Float32Array(N);
      const alphaBuf = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const n = nodes[i];
        const [r, g, b] = n.type ? hslToRgb(hueOf(n.type), 0.5, 0.62) : [0.62, 0.6, 0.55];
        colBuf[i * 3] = r; colBuf[i * 3 + 1] = g; colBuf[i * 3 + 2] = b;
        sizeBuf[i] = rad(n) * 2.4;
      }
      // Stable DOI (salience + graph-focus) baked into the buffer; the shader
      // multiplies the SPATIAL focal falloff on top each frame.
      const nodeAlphaOf = (i: number): number => {
        const n = nodes[i];
        if (!isVis(n)) return 0; // culled by the salience slider
        // Global dimmer — the additive core of a dense slice summed to white;
        // the torch supplies the contrast, points don't need to.
        return TUNE.nodeDim * nodeDOI(n, selKey, nbr, hiSet, N);
      };

      // ── renderer / scene / camera ──
      let W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(ink.sceneBg);
      const camera = new THREE.PerspectiveCamera(55, W / H, 1, 8000);
      camera.position.set(0, 0, SPREAD * 2.15);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = TUNE.exposure;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
      el.innerHTML = '';
      el.appendChild(renderer.domElement);

      const labelRenderer = new CSS2DRenderer();
      labelRenderer.setSize(W, H);
      labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none';
      el.appendChild(labelRenderer.domElement);

      // ── the point cloud (one draw call, additive glow, per-point size) ──
      const disc = makeDiscTexture(THREE);
      const geo = new THREE.BufferGeometry();
      // `boost` lets a FOCUS point (selection / neighbour / search hit) bypass
      // the torch: without it, a match off the beam axis multiplied down to the
      // 0.04 floor and "highlighting" survived only as a floating label over an
      // unlit scene (owner feedback: labels lit, nodes and edges not).
      const boostBuf = new Float32Array(N);
      geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizeBuf, 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(alphaBuf, 1));
      geo.setAttribute('boost', new THREE.BufferAttribute(boostBuf, 1));
      const nodeBoostOf = (i: number): number => {
        const n = nodes[i];
        if (!isVis(n)) return 0;
        if (n.id === selKey || hiSet?.has(n.id)) return 1;
        if (nbr?.has(n.id)) return TUNE.nbrBoost; // lit, with a whisper of depth left
        return 0;
      };
      const applyNodeAlpha = (): void => {
        for (let i = 0; i < N; i++) {
          alphaBuf[i] = nodeAlphaOf(i);
          boostBuf[i] = nodeBoostOf(i);
        }
        (geo.attributes.alpha as any).needsUpdate = true;
        (geo.attributes.boost as any).needsUpdate = true;
      };
      applyNodeAlpha();
      // TORCH falloff: a spotlight cone from the camera aimed at the focal point
      // (orbit target = screen centre). Brightness drops by ANGLE off the beam
      // axis (quick smoothstep between an inner and outer cone), plus a gentle
      // distance attenuation along the beam. Sweeps with the camera, unlike a
      // fixed sphere. `torch()` is shared GLSL, injected into both materials.
      // Torch parameters are UNIFORMS (shared object, both materials) so the
      // tuner can dial them live; depthIn/Out are SPREAD-relative factors.
      const torchUniforms = {
        uFocus: { value: new THREE.Vector3() },
        uCam: { value: new THREE.Vector3() },
        uConeIn: { value: TUNE.coneIn },
        uConeOut: { value: TUNE.coneOut },
        uDepthIn: { value: SPREAD * TUNE.depthIn },
        uDepthOut: { value: SPREAD * TUNE.depthOut },
        uFloor: { value: TUNE.torchFloor },
        uSizeBoost: { value: TUNE.boostSizeGain },
      };
      const TORCH_GLSL =
        'uniform vec3 uFocus; uniform vec3 uCam; uniform float uConeIn; uniform float uConeOut; uniform float uDepthIn; uniform float uDepthOut; uniform float uFloor;' +
        'float torch(vec3 p){ vec3 d = uFocus - uCam; float td = length(d); vec3 axis = d / max(td, 1e-3);' +
        ' vec3 toP = p - uCam; float along = dot(toP, axis); if (along <= 0.0) return uFloor;' +
        ' float radial = length(toP - axis*along);' +
        ' float ang = 1.0 - smoothstep(uConeIn, uConeOut, radial / along);' +
        ' float dep = 1.0 - smoothstep(uDepthIn, uDepthOut, abs(along - td));' +
        ' return max(uFloor, ang * dep); }';
      const ptMat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: disc }, uScale: { value: H / 2 }, ...torchUniforms },
        vertexShader:
          'attribute float size; attribute float alpha; attribute vec3 color; attribute float boost;' +
          'varying float vAlpha; varying vec3 vColor; uniform float uScale; uniform float uSizeBoost;' +
          TORCH_GLSL +
          'void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float vd = -mv.z;' +
          // Focus points also grow a little — brightness alone undersold a
          // small match dot; size makes the hit read as an OBJECT.
          'vAlpha = alpha * max(torch(position), boost); gl_PointSize = size * (1.0 + uSizeBoost * boost) * (uScale / max(vd, 1.0));' +
          'gl_Position = projectionMatrix * mv; }',
        fragmentShader:
          'uniform sampler2D uTex; varying float vAlpha; varying vec3 vColor;' +
          'void main(){ float m = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vColor * vAlpha * m, 1.0); }',
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const points = new THREE.Points(geo, ptMat);
      points.frustumCulled = false;
      scene.add(points);

      // Selection highlight: a glowing accent ring parked on the selected node
      // (opacity alone washed out under the focal fade).
      const ringTex = makeRingTexture(THREE);
      const ringMat = new THREE.SpriteMaterial({ map: ringTex, color: ink.accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const ring = new THREE.Sprite(ringMat);
      ring.visible = false;
      scene.add(ring);
      const showRing = (n: any): void => {
        if (!n) { ring.visible = false; return; }
        ring.position.set(n.x, n.y, n.z);
        // A snug halo ~1.5× the node's on-screen dot (the sprite is world-scaled
        // and the dot is perspective-scaled, so the ratio holds through dolly).
        // No additive constant — that inflated the ring on small nodes.
        ring.scale.setScalar(rad(n) * 2.1);
        ring.visible = true;
      };

      // ── edges: additive LineSegments (alpha premultiplied into the colours) ──
      const E = links.length;
      const eposBuf = new Float32Array(E * 6);
      const ecolBuf = new Float32Array(E * 6);
      const edgeRGB: Array<[number, number, number]> = links.map((l: any) => hexToRgb(edgeStyle(l).stroke));
      for (let i = 0; i < E; i++) {
        const l = links[i];
        const ai = idx.get(idOf(l.source)) ?? 0, bi = idx.get(idOf(l.target)) ?? 0;
        eposBuf[i * 6] = posBuf[ai * 3]; eposBuf[i * 6 + 1] = posBuf[ai * 3 + 1]; eposBuf[i * 6 + 2] = posBuf[ai * 3 + 2];
        eposBuf[i * 6 + 3] = posBuf[bi * 3]; eposBuf[i * 6 + 4] = posBuf[bi * 3 + 1]; eposBuf[i * 6 + 5] = posBuf[bi * 3 + 2];
      }
      // Lower than the 2D strokes: additive One/One means overlapping edges SUM,
      // so hubs would otherwise clip to a white hairball. Depth-fade (in the
      // shader below) does the rest of the atmosphere.
      // Quieter than the old 2D strokes AND the previous 3D bases: additive
      // One/One SUMS overlapping edges, and the dense semantic core has enough
      // of them to clip to a white mass under bloom (figure/ground again).
      const edgeBaseAlpha = (l: any): number => (l.rel === 'similarTo' ? TUNE.edgeSimilar : MEMBER_RELS.has(l.rel) ? TUNE.edgeMember : l.derived ? TUNE.edgeDerived : TUNE.edgeAuthored);
      const edgeAlphaOf = (l: any): number => {
        const sN = nodeById.get(idOf(l.source)), tN = nodeById.get(idOf(l.target));
        if (!isVis(sN) || !isVis(tN)) return 0; // salience slider
        // As interesting as its most-interesting endpoint (DOI); shader adds focal fade.
        const d = Math.max(nodeDOI(sN, selKey, nbr, hiSet, N), nodeDOI(tN, selKey, nbr, hiSet, N));
        return edgeBaseAlpha(l) * (0.1 + 0.9 * d);
      };
      // An edge CARRIES the focus (and bypasses the torch) when it fans out of
      // the selected node, or joins two search hits — the structure the user
      // asked the graph about, visible even off the beam axis. A hit's whole
      // degree does NOT boost (that would re-paint the hairball).
      const eboostBuf = new Float32Array(E * 2);
      const edgeBoostOf = (l: any): number => {
        const a = idOf(l.source), b = idOf(l.target);
        if (selKey && (a === selKey || b === selKey)) return 1;
        if (hiSet && hiSet.has(a) && hiSet.has(b)) return 1;
        return 0;
      };
      // Focus edges take the ACCENT — the same hue as the selection ring and
      // anchor label, so "this is the structure you asked about" is one visual
      // statement — at an alpha far above the resting bases (which exist to
      // keep 9k edges from summing to a wash; a dozen fan edges have no such
      // problem). Meanwhile the atmosphere dims further: contrast is relative.
      const ACCENT_RGB = hexToRgb(ink.accent);
      const applyEdgeColor = (): void => {
        const focusActive = !!(selKey || hiSet);
        for (let i = 0; i < E; i++) {
          const bo = edgeBoostOf(links[i]);
          let r: number, g: number, b: number, al: number;
          if (bo > 0) {
            [r, g, b] = ACCENT_RGB;
            al = TUNE.focusEdgeAlpha;
          } else {
            [r, g, b] = edgeRGB[i];
            al = edgeAlphaOf(links[i]) * (focusActive ? TUNE.atmosphereDim : 1);
          }
          ecolBuf[i * 6] = r * al; ecolBuf[i * 6 + 1] = g * al; ecolBuf[i * 6 + 2] = b * al;
          ecolBuf[i * 6 + 3] = r * al; ecolBuf[i * 6 + 4] = g * al; ecolBuf[i * 6 + 5] = b * al;
          eboostBuf[i * 2] = bo; eboostBuf[i * 2 + 1] = bo;
        }
        (egeo.attributes.color as any).needsUpdate = true;
        (egeo.attributes.boost as any).needsUpdate = true;
      };
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.BufferAttribute(eposBuf, 3));
      egeo.setAttribute('color', new THREE.BufferAttribute(ecolBuf, 3));
      egeo.setAttribute('boost', new THREE.BufferAttribute(eboostBuf, 1));
      // A shader (not LineBasicMaterial) so edges get the SAME depth-fade as the
      // point cloud — otherwise they stay full-bright at every depth and flatten
      // the atmosphere. Per-vertex colour already carries the focus/selection
      // alpha (premultiplied); the shader multiplies in the distance falloff.
      const eMat = new THREE.ShaderMaterial({
        uniforms: torchUniforms,
        vertexShader:
          'attribute vec3 color; attribute float boost; varying vec3 vColor;' +
          TORCH_GLSL +
          'void main(){ vColor = color * max(torch(position), boost); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec3 vColor; void main(){ gl_FragColor = vec4(vColor, 1.0); }',
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const lineSegs = new THREE.LineSegments(egeo, eMat);
      lineSegs.frustumCulled = false;
      scene.add(lineSegs);
      applyEdgeColor();

      // ── labels (CSS2D) — a role-typed pool with a FADE lifecycle. Roles:
      // 'sel' (the anchor), 'hit' (a search result), 'nbr' (a selection
      // neighbour), 'beam' (the torch's SUGGESTION — the sweep-to-reveal
      // affordance). The beam had two sins (owner feedback): binary DOM
      // add/remove made labels POP, and beam catches wore the same styling as
      // search hits, so unrelated items read as results. Now every label fades
      // in/out (lerped per frame), and the beam is a visibly SECONDARY voice —
      // smaller, dimmer, lighter weight — that yields collision priority to
      // focus and needs consecutive in-beam syncs before it appears.
      type LabelRole = 'sel' | 'hit' | 'nbr' | 'beam' | 'anchor';
      /** What a sync wants a label to be: its role, plus an optional screen-px
       *  DISPLACEMENT (dense-core collision resolved by nudging the label aside
       *  and drawing a hairline leader back to its node — classic map labeling
       *  keeps the name; dropping it was losing neighbours). */
      interface LabelWant { role: LabelRole; ox?: number; oy?: number }
      interface LabelState { obj: any; cur: number; role: LabelRole; dying: boolean; ox: number; oy: number; cox: number; coy: number }
      const labelObjs = new Map<string, LabelState>();
      const makeLabel = (n: any): any => {
        const div = document.createElement('div');
        const text = document.createElement('span');
        text.textContent = n.label;
        // Hairline leader back to the node anchor, shown only when the label
        // was displaced by collision (updateLabels drives its geometry).
        const leader = document.createElement('div');
        leader.style.cssText = 'position:absolute;left:50%;top:0;height:1px;background:#59503f;transform-origin:0 0;display:none;opacity:0.7';
        div.append(leader, text);
        (div as any)._leader = leader;
        // Fully inert to the browser: pointer-events:none so drags pass through
        // to the canvas (orbit/pan keep working when a gesture starts on a
        // label), and no text selection / iOS callout. Label TAPS are hit-tested
        // against the div rects in the canvas pointerup handler below.
        div.style.cssText = `position:relative;font-weight:600;font-size:11px;color:#efe9dc;${LABEL_HALO};white-space:nowrap;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-text-size-adjust:100%;text-size-adjust:100%`;
        // Letterform = type (labelFont): actionable small-caps sans, documents
        // italic serif, knowledge serif, else mono — set once, role styling
        // (size/weight/colour/opacity) stays per-frame in updateLabels.
        const f = labelFont(n.type);
        div.style.fontFamily = f.family;
        div.style.fontStyle = f.style;
        div.style.fontVariant = f.variant;
        const obj = new CSS2DObject(div);
        // Anchor the label's TOP edge at the node's projected point (center.y = 0)
        // so it hangs BELOW the node, horizontally centered — in SCREEN space,
        // regardless of camera orientation. The world position is the node centre;
        // the small gap that clears the dot is a padding-top applied per frame in
        // updateLabels (scaled to the node's on-screen size).
        obj.center.set(0.5, 0);
        obj.position.set(n.x, n.y, n.z);
        return obj;
      };
      /** Reconcile membership: departures FADE (dying → removed at ~0), not pop. */
      const reconcileLabels = (want: Map<string, LabelWant>): void => {
        for (const [id, st] of labelObjs) {
          const w = want.get(id);
          if (w) {
            st.role = w.role;
            st.ox = w.ox ?? 0;
            st.oy = w.oy ?? 0;
            st.dying = false;
          } else st.dying = true;
        }
        for (const [id, w] of want) {
          if (labelObjs.has(id)) continue;
          const n = nodeById.get(id);
          if (!n) continue;
          const obj = makeLabel(n);
          obj.element.style.opacity = '0'; // arrivals fade IN from nothing
          scene.add(obj);
          labelObjs.set(id, { obj, cur: 0, role: w.role, dying: false, ox: w.ox ?? 0, oy: w.oy ?? 0, cox: w.ox ?? 0, coy: w.oy ?? 0 });
        }
      };

      // ── bloom (desktop only — fill-rate heavy on phones) ──
      const bigScreen = Math.min(W, H) >= 620 && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      let composer: any = null;
      let bloomPass: any = null;
      // Bloom is a TOGGLE now (tuner: auto/on/off — 'on' lets a phone try it),
      // so the composer builds lazily the first frame it's wanted and the tick
      // simply routes around it when it isn't.
      const useBloom = (): boolean => TUNE.bloomMode === 'on' || (TUNE.bloomMode === 'auto' && bigScreen);
      const ensureComposer = (): void => {
        if (composer) return;
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        // Threshold above the resting wash so only genuinely bright points
        // bloom — at 0.12 the dense core's additive sum ALL bloomed and clipped
        // to a white blob that swallowed its labels.
        bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), TUNE.bloomStrength, TUNE.bloomRadius, TUNE.bloomThreshold);
        composer.addPass(bloomPass);
        // The composer must MATCH the renderer's pixel ratio — on a 2x phone
        // its targets otherwise mismatch the drawing buffer and the scene
        // renders black (why bloom 'on' looked dead on mobile).
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(W, H);
      };
      if (useBloom()) ensureComposer();

      // ── controls: damped orbit + idle auto-rotate (stops on touch, resumes) ──
      // ── star-map camera (camera-controls) ──
      const controls = new CameraControls(camera, renderer.domElement);
      controls.dollyToCursor = true; // zoom toward the finger, so the target drifts to where you work
      controls.infinityDolly = true; // fly THROUGH the cloud, don't bounce off a min distance
      controls.minDistance = SPREAD * 0.04;
      controls.maxDistance = SPREAD * 6;
      // One finger orbits. TWO fingers do both, disambiguated by the gesture: a
      // symmetric PINCH is a pure dolly (moves the camera origin in/out — FOV is
      // fixed, this is not a zoom-lens), while a two-finger DRAG trucks (pans).
      // camera-controls' DOLLY_TRUCK splits them by pinch-distance vs centroid-
      // motion, so they read as separate gestures on the same two fingers.
      controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
      controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK;
      controls.touches.three = CameraControls.ACTION.TOUCH_TRUCK;
      controls.dampingFactor = 0.05;
      controls.draggingDampingFactor = 0.25;
      controls.setLookAt(0, 0, SPREAD * 2.15, 0, 0, 0, false);
      // Open FRAMING the cloud's BODY, not a fixed dolly and not its extremes:
      // centre = per-axis MEDIAN (a mean drifts toward outlier tendrils),
      // radius = the 80th-percentile distance — the far strays hang offscreen
      // and the mass the eye reads as "the graph" fills the frame.
      {
        const med = (vals: number[]): number => { const s = [...vals].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; };
        const xs: number[] = [], ys: number[] = [], zs: number[] = [];
        for (let i = 0; i < N; i++) { xs.push(posBuf[i * 3]); ys.push(posBuf[i * 3 + 1]); zs.push(posBuf[i * 3 + 2]); }
        const c = new THREE.Vector3(med(xs), med(ys), med(zs));
        const dists: number[] = [];
        for (let i = 0; i < N; i++) dists.push(c.distanceTo(new THREE.Vector3(posBuf[i * 3], posBuf[i * 3 + 1], posBuf[i * 3 + 2])));
        dists.sort((a, b) => a - b);
        const r = (dists[Math.floor(dists.length * 0.8)] ?? SPREAD) * 1.1;
        controls.fitToSphere(new THREE.Sphere(c, Math.max(r, SPREAD * 0.3)), false);
      }
      // Hold SPACE: left-drag TRUCKS (pans) instead of orbiting — the design-
      // tool convention, matching mobile's two-finger drag. Temporary while
      // held; skipped when the palette (or any field) has keyboard focus.
      let spaceHeld = false;
      const onSpaceDown = (e: KeyboardEvent): void => {
        if (e.code !== 'Space' || spaceHeld) return;
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
        e.preventDefault(); // keep Space from scrolling/activating
        spaceHeld = true;
        controls.mouseButtons.left = CameraControls.ACTION.TRUCK;
        renderer.domElement.style.cursor = 'grab';
      };
      const onSpaceUp = (e: KeyboardEvent): void => {
        if (e.code !== 'Space' || !spaceHeld) return;
        spaceHeld = false;
        controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
        renderer.domElement.style.cursor = '';
      };
      window.addEventListener('keydown', onSpaceDown);
      window.addEventListener('keyup', onSpaceUp);

      // Idle auto-rotate: resume a slow orbit ~5s after the last user gesture.
      let interacting = false;
      let lastInput = performance.now();
      controls.addEventListener('controlstart', () => { interacting = true; lastInput = performance.now(); });
      controls.addEventListener('controlend', () => { interacting = false; lastInput = performance.now(); });
      const focusVec = new THREE.Vector3();

      // ── picking: a tap (not a drag) raycasts the point cloud ──
      const raycaster = new THREE.Raycaster();
      (raycaster.params as any).Points = { threshold: 9 };
      const ndc = new THREE.Vector2();
      let downX = 0, downY = 0, moved = false;
      const pickAt = (cx: number, cy: number): any => {
        const rect = renderer.domElement.getBoundingClientRect();
        ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObject(points);
        if (!hits.length) return null;
        let best = hits[0];
        for (const h of hits) if ((h.distanceToRay ?? 1e9) < (best.distanceToRay ?? 1e9)) best = h;
        return best.index != null ? nodes[best.index] : null;
      };
      // A tap over a label's rect selects that node — labels are pointer-events:
      // none, so their taps arrive here on the canvas rather than via a DOM click.
      const labelAt = (cx: number, cy: number): string | null => {
        for (const [id, st] of labelObjs) {
          if (st.cur < 0.3) continue; // a barely-there label shouldn't catch taps
          const r = st.obj.element.getBoundingClientRect();
          if (r.width && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return id;
        }
        return null;
      };
      const onDown = (e: PointerEvent): void => { downX = e.clientX; downY = e.clientY; moved = false; };
      const onMove = (e: PointerEvent): void => { if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 6) moved = true; };
      const onUp = (e: PointerEvent): void => {
        if (moved) return;
        const lid = labelAt(e.clientX, e.clientY);
        if (lid) { api.current?.select(lid, true); return; }
        const n = pickAt(e.clientX, e.clientY);
        api.current?.select(n ? n.id : null);
      };
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerup', onUp);

      // Frame a point and re-anchor the orbit to it — camera-controls eases the
      // whole transition (position + target) and rotation then pivots around it.
      // A radius (~the local neighbourhood) sets how close it dollies in.
      const frame = (x: number, y: number, z: number, radius: number): void => {
        // fitToSphere eases position + target to frame the sphere; the target
        // becomes the node, so orbit/dolly then pivot around it.
        controls.fitToSphere(new THREE.Sphere(new THREE.Vector3(x, y, z), radius), true);
        lastInput = performance.now();
      };

      api.current = {
        select: (key: string | null, doFly = false) => {
          lastExternal.current = key;
          selKey = key; nbr = key ? neighborsOf(key) : null;
          if (key) hiSet = null;
          applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
          const d = key ? nodeById.get(key) : null;
          showRing(d);
          showCrumb(key);
          if (d && doFly) frame(d.x, d.y, d.z, SPREAD * 0.42); // frame the node + its local neighbourhood
          selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : key ? { key, type: null, score: 0, label: key } : null);
        },
        setVisible: (f: number) => {
          visCount = f >= 0.999 ? N : Math.max(minVis, Math.round(N * f));
          applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
        },
      };

      onResult = guard((ev: Event): void => {
        const detail = (ev as CustomEvent<{ ok: boolean; value: unknown }>).detail;
        if (!detail?.ok) return;
        const keys = keysOfResult(detail.value).filter((k) => nodeById.has(k));
        if (!keys.length) return;
        hiSet = new Set(keys); selKey = null; nbr = null;
        showRing(null);
        applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
        const pts = keys.map((k) => nodeById.get(k));
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        // Frame the whole match set — radius covers the spread of the hits.
        const rad = Math.max(SPREAD * 0.3, ...pts.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz))) + SPREAD * 0.1;
        frame(cx, cy, cz, rad);
      });
      window.addEventListener(CONSOLE_RESULT_EVENT, onResult);

      const camPos = new THREE.Vector3();
      // The label SELECTOR's cone, in JS (decoupled from the lighting torch —
      // the light can be a floodlight while admission stays a sharp beam).
      // axis = camera → focal point.
      const axisV = new THREE.Vector3(), toPV = new THREE.Vector3();
      const smoothstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const labelTorchAt = (pos: any): number => {
        const td = axisV.copy(focusVec).sub(camPos).length();
        axisV.multiplyScalar(1 / Math.max(td, 1e-3));
        toPV.copy(pos).sub(camPos);
        const along = toPV.dot(axisV);
        if (along <= 0) return TUNE.torchFloor;
        const radial = toPV.addScaledVector(axisV, -along).length(); // toP - axis*along
        const ang = 1 - smoothstep(TUNE.labelConeIn, TUNE.labelConeOut, radial / along);
        const dep = 1 - smoothstep(SPREAD * TUNE.depthIn, SPREAD * TUNE.depthOut, Math.abs(along - td));
        return Math.max(TUNE.torchFloor, ang * dep);
      };
      // Beam-driven label set: label the nodes the torch is currently lighting
      // (brightest first, capped) plus the pinned set, with hysteresis so labels
      // don't flicker at the beam's edge. This is what lets a sweep of the focal
      // point surface nearby low-salience items.
      const scratchP = new THREE.Vector3();
      const labelTorchNode = (n: any): number => labelTorchAt(scratchP.set(n.x, n.y, n.z));
      // Fewer beam-lit labels on a phone — 28 at once piled up in the core.
      const LABEL_CAP_DEFAULT = Math.min(W, H) < 700 ? 12 : 22;
      const labelCap = (): number => TUNE.labelCap > 0 ? TUNE.labelCap : LABEL_CAP_DEFAULT;
      // Legibility gates (the dense core turned its beam labels into a white
      // pile of 7px mush): a candidate must render big enough to READ, and must
      // not land on top of an already-placed label — greedy, brightest first.
      const projV = new THREE.Vector3();
      const distV = new THREE.Vector3();
      // Third element = NDC z (> 1 means behind the camera — anchor admission
      // must skip those; a behind-camera point still projects to plausible xy).
      const screenXY = (n: any): [number, number, number] => {
        projV.set(n.x, n.y, n.z).project(camera);
        return [((projV.x + 1) / 2) * W, ((1 - projV.y) / 2) * H, projV.z];
      };
      // TERTIARY layer: the selection fan's REL labels, at edge midpoints —
      // what each connection IS, not just that it exists. Selection-only
      // (search-hit pairs stay unlabelled), capped, and an edge must be long
      // enough on screen for a word to sit on it. Fixed small size and dim
      // colour: these support the neighbourhood, they never compete with it.
      const edgeLabelObjs = new Map<number, any>();
      const syncEdgeLabels = (): void => {
        const want = new Set<number>();
        if (selKey) {
          const cands: Array<[number, number]> = [];
          for (let i = 0; i < E; i++) {
            const l = links[i];
            const a = idOf(l.source), b = idOf(l.target);
            if (a !== selKey && b !== selKey) continue;
            const farN = nodeById.get(a === selKey ? b : a);
            if (!farN || !isVis(farN)) continue;
            cands.push([i, farN.rank ?? N]);
          }
          cands.sort((x, y) => x[1] - y[1]); // label the salient connections first
          const placedMid: Array<[number, number]> = [];
          let added = 0;
          for (const [i] of cands) {
            if (added >= 12) break;
            const l = links[i];
            const aN = nodeById.get(idOf(l.source)), bN = nodeById.get(idOf(l.target));
            const [ax, ay] = screenXY(aN);
            const [bx, by] = screenXY(bN);
            if (Math.hypot(bx - ax, by - ay) < 80) continue; // no room for a word
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            if (placedMid.some(([px, py]) => Math.abs(px - mx) < 70 && Math.abs(py - my) < 14)) continue;
            placedMid.push([mx, my]);
            want.add(i);
            added++;
          }
        }
        for (const [i, obj] of edgeLabelObjs) {
          if (!want.has(i)) {
            scene.remove(obj);
            obj.element.remove?.();
            edgeLabelObjs.delete(i);
          }
        }
        for (const i of want) {
          if (edgeLabelObjs.has(i)) continue;
          const l = links[i];
          const div = document.createElement('div');
          div.textContent = l.rel;
          div.style.cssText = 'font:500 8.5px ui-monospace,monospace;color:#a89e8a;text-shadow:0 1px 3px #000;white-space:nowrap;pointer-events:none;user-select:none;opacity:0.85';
          const obj = new CSS2DObject(div);
          const aN = nodeById.get(idOf(l.source)), bN = nodeById.get(idOf(l.target));
          obj.position.set((aN.x + bN.x) / 2, (aN.y + bN.y) / 2, (aN.z + bN.z) / 2);
          scene.add(obj);
          edgeLabelObjs.set(i, obj);
        }
      };

      const beamStreak = new Map<string, number>();
      // Salience order, computed once — anchors and beam both admit best-first.
      const byRank = [...nodes].sort((a: any, b: any) => (a.rank ?? N) - (b.rank ?? N));

      // ── constellations: the map's PLACE NAMES ──────────────────────────
      // COMPUTED from the data (salience hubs + dominant member types) — the
      // generic layer. Registered VIEWS are the AUTHORED layer: a view is
      // already a human-named grouping, so it takes the role hand-authored
      // constellation names would otherwise need new machinery for (organ-
      // authored region naming deliberately deferred). Captions are
      // cartographic: faint, tracked-out, uppercase serif at the region's
      // centroid — legible from afar, handing off to fact labels as the
      // camera arrives. The approach fade IS the semantic zoom: continuous,
      // per-region, no tier boundaries to flicker across.
      interface Constellation { name: string; x: number; y: number; z: number; r: number; authored: boolean; obj: any; cur: number }
      const constellations: Constellation[] = [];
      const addConstellation = (name: string, cx: number, cy: number, cz: number, cr: number, authored: boolean): void => {
        const div = document.createElement('div');
        div.textContent = name;
        // Authored places carry a whisper of the accent — a view is intent.
        div.style.cssText = `font-family:${TYPE_SERIF};font-weight:400;letter-spacing:0.22em;text-transform:uppercase;white-space:nowrap;pointer-events:none;user-select:none;-webkit-user-select:none;opacity:0;${LABEL_HALO};color:${authored ? '#e3c987' : '#b7ad99'}`;
        const obj = new CSS2DObject(div);
        obj.position.set(cx, cy, cz);
        scene.add(obj);
        constellations.push({ name, x: cx, y: cy, z: cz, r: cr, authored, obj, cur: 0 });
      };
      {
        // Computed pass: greedy salience hubs with an exclusion radius, then a
        // membership ball around each. The dominant type names the region when
        // one truly dominates (a "notes quarter"); otherwise the hub fact
        // itself stands for the neighbourhood.
        const R_EX = SPREAD * 0.55, R_MEM = SPREAD * 0.45;
        const d2 = (a: any, b: any): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
        const hubs: any[] = [];
        for (const n of byRank) {
          if (hubs.length >= 16) break; // generous pool; TUNE.constCap gates at render
          if (hubs.some((h) => d2(h, n) < R_EX * R_EX)) continue;
          hubs.push(n);
        }
        for (const h of hubs) {
          const members = nodes.filter((n: any) => d2(n, h) < R_MEM * R_MEM);
          if (members.length < 6) continue; // a place needs a population
          const counts = new Map<string, number>();
          for (const m of members) if (m.type) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
          let topType: string | null = null, topN = 0;
          for (const [t, c] of counts) if (c > topN) { topType = t; topN = c; }
          // Name the region: a truly dominant type ("notes"), else the most
          // salient member whose title reads as WORDS — a region with only
          // key-shaped names (machine runs, dated logs) gets no caption at
          // all rather than a plumbing key in display caps.
          let name: string | null = null;
          if (topType && topN / members.length >= 0.5) {
            name = topType.endsWith('s') || topType === 'knowledge' ? topType : `${topType}s`;
          } else {
            const speaker = members
              .filter((m: any) => placeworthy(m.label))
              .sort((a: any, b: any) => (a.rank ?? N) - (b.rank ?? N))[0];
            if (speaker) name = String(speaker.label);
          }
          if (!name) continue;
          name = name.length > 24 ? name.slice(0, 23) + '…' : name;
          const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
          const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
          const cz = members.reduce((s: number, m: any) => s + m.z, 0) / members.length;
          const dists = members.map((m: any) => Math.hypot(m.x - cx, m.y - cy, m.z - cz)).sort((a: number, b: number) => a - b);
          const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
          addConstellation(name, cx, cy, cz, cr, false);
        }
      }
      // Authored pass (async garnish — the scene never waits on it): evaluate
      // a handful of registered views, centroid their members present in this
      // slice. Defensive about result shapes; silent when views are absent.
      void (async () => {
        try {
          const decl = await mcpCall('read', 'workspace.declarations', { kind: 'view' }).catch(() => null);
          const dv = (decl && decl.ok ? decl.value : null) as any;
          const defs: any[] = Array.isArray(dv) ? dv : (dv?.declarations ?? dv?.views ?? dv?.entries ?? []);
          const ids = defs.map((d: any) => (typeof d === 'string' ? d : (d?.id ?? d?.name))).filter(Boolean).slice(0, 6);
          for (const id of ids) {
            if (disposed) return;
            const r = await mcpCall('read', 'workspace.view', { id }).catch(() => null);
            if (!r || !r.ok) continue;
            const keys = keysOfResult(r.value).filter((k) => nodeById.has(k));
            if (keys.length < 3) continue;
            const pts = keys.map((k) => nodeById.get(k));
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
            const dists = pts.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)).sort((a, b) => a - b);
            const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
            const vname = String(id);
            addConstellation(vname.length > 24 ? vname.slice(0, 23) + '…' : vname, cx, cy, cz, cr, true);
          }
        } catch { /* views are optional */ }
      })();
      const constV = new THREE.Vector3();
      const updateConstellations = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade * 0.5); // captions ease slower than labels
        const focusActive = !!(selKey || hiSet);
        let computedShown = 0;
        // Captions declutter against EACH OTHER in screen space (authored
        // first, then salience order) — the first render piled three names
        // on the dense core. A losing caption fades, it doesn't pop.
        const placedCaps: Array<[number, number, number]> = [];
        for (const c of constellations) {
          let target = 0;
          let fontPx = 0;
          const overCap = !c.authored && ++computedShown > TUNE.constCap;
          if (!overCap) {
            const camD = camPos.distanceTo(constV.set(c.x, c.y, c.z));
            // Approach fade: a caption reads from OUTSIDE its region and
            // yields to fact labels once the camera is inside it.
            target = TUNE.constOpacity * smoothstep(c.r * TUNE.constNear, c.r * TUNE.constFar, camD);
            if (focusActive) target *= 0.3; // atmosphere under focus
            if (target > 0.02) {
              // Caption size tracks the REGION's on-screen size, not the
              // camera depth of a point — big places read big, from anywhere.
              const px = (c.r * (H / 2)) / Math.max(camD, 1);
              fontPx = Math.max(9, Math.min(22, px * 0.13));
              constV.set(c.x, c.y, c.z).project(camera);
              if (constV.z > 1) target = 0;
              else {
                const sx = ((constV.x + 1) / 2) * W, sy = ((1 - constV.y) / 2) * H;
                const w = c.name.length * fontPx * 0.95; // caps + 0.22em tracking
                if (placedCaps.some(([px2, py2, pw2]) => Math.abs(px2 - sx) < (pw2 + w) / 2 && Math.abs(py2 - sy) < fontPx * 1.6)) target = 0;
                else placedCaps.push([sx, sy, w]);
              }
            }
          }
          c.cur += (target - c.cur) * k;
          const div = c.obj.element as HTMLElement;
          if (c.cur < 0.01) { div.style.opacity = '0'; continue; }
          if (fontPx > 0) div.style.fontSize = fontPx.toFixed(1) + 'px';
          div.style.opacity = c.cur.toFixed(3);
        }
      };
      // Breadcrumb — "where am I": selecting a fact names its neighbourhood in
      // a transient caption at the top of the scene, then gets out of the way.
      const crumb = document.createElement('div');
      crumb.style.cssText = `position:absolute;top:calc(env(safe-area-inset-top, 0px) + 10px);left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;font-family:${TYPE_SERIF};font-size:11px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:#b7ad99;opacity:0;transition:opacity 0.7s;${LABEL_HALO}`;
      el.appendChild(crumb);
      let crumbTimer: ReturnType<typeof setTimeout> | null = null;
      const showCrumb = (key: string | null): void => {
        const n = key ? nodeById.get(key) : null;
        let best: Constellation | null = null;
        let bestD = Infinity;
        if (n) {
          for (const c of constellations) {
            const d = Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z);
            if (d < c.r * 1.6 && d < bestD) { best = c; bestD = d; }
          }
        }
        if (crumbTimer) { clearTimeout(crumbTimer); crumbTimer = null; }
        if (!best) { crumb.style.opacity = '0'; return; }
        crumb.textContent = best.name;
        crumb.style.opacity = '0.85';
        crumbTimer = setTimeout(() => { crumb.style.opacity = '0'; }, 3500);
      };

      const syncBeamLabels = (): void => {
        syncEdgeLabels();
        const want = new Map<string, LabelWant>();
        // Size-aware declutter: a small (far) label needs little clearance, so
        // depth-proportional labels pack naturally instead of fighting a fixed
        // 90px box sized for the biggest.
        const placed: Array<[number, number, number]> = [];
        const pxOf = (n: any): number => {
          const camD = camPos.distanceTo(distV.set(n.x, n.y, n.z)) || 1;
          return rad(n) * 2.4 * (H / 2) / camD;
        };
        const boxOf = (n: any): number => Math.max(36, pxOf(n) * 7);
        const collides = (sx: number, sy: number, w: number): boolean =>
          placed.some(([px, py, pw]) => Math.abs(px - sx) < (pw + w) / 2 && Math.abs(py - sy) < 14);
        const focusActive = !!(selKey || hiSet);

        // FOCUS DECLARES: the anchor and every search hit label unconditionally
        // (they are the question being asked); neighbours pass legibility gates
        // (salience-first, readable, decluttered, capped).
        if (selKey) {
          const n = nodeById.get(selKey);
          if (n && isVis(n)) {
            want.set(selKey, { role: 'sel' });
            const [sx, sy] = screenXY(n);
            placed.push([sx, sy, boxOf(n)]);
          }
        }
        if (hiSet) {
          for (const id of hiSet) {
            if (want.has(id)) continue;
            const n = nodeById.get(id);
            if (n && isVis(n)) {
              want.set(id, { role: 'hit' });
              const [sx, sy] = screenXY(n);
              placed.push([sx, sy, boxOf(n)]);
            }
          }
        }
        if (selKey && nbr) {
          // EVERY neighbour that wins a collision slot gets a label — at its
          // depth-proportional size. No readable() admission gate: a far
          // neighbour is a tiny label, not a missing one. A colliding
          // neighbour is NUDGED to a free spot (down / up / aside, leader
          // line back to the node) before it is ever dropped — the dense
          // core kept eating exactly the labels a selection was asking for.
          const cands = [...nbr]
            .map((id) => nodeById.get(id))
            .filter((n) => n && isVis(n) && !want.has(n.id))
            .sort((a, b) => (a.rank ?? N) - (b.rank ?? N));
          let added = 0;
          for (const n of cands) {
            if (added >= labelCap()) break;
            const [sx, sy] = screenXY(n);
            const w = boxOf(n);
            const tries: Array<[number, number]> = [[0, 0], [0, 18], [0, -26], [w / 2 + 14, 0], [-(w / 2 + 14), 0]];
            for (const [ox, oy] of tries) {
              if (collides(sx + ox, sy + oy, w)) continue;
              placed.push([sx + ox, sy + oy, w]);
              want.set(n.id, { role: 'nbr', ox, oy });
              added++;
              break;
            }
          }
        }

        // ORIENTATION ANCHORS — the map's resting place-holds: at rest (no
        // selection, no search) the most salient visible node per screen
        // region keeps a dim, persistent name up, so there is always something
        // to navigate by before the beam or a selection speaks. A 3×3 grid
        // spreads them; salience-first keeps them stable as the camera moves.
        if (!focusActive && TUNE.anchorCap > 0) {
          const takenCell = new Set<number>();
          let added = 0;
          for (const n of byRank) {
            if (added >= TUNE.anchorCap) break;
            if (!isVis(n) || want.has(n.id)) continue;
            // Anchors are wayfinding text — a salient machine-run KEY is
            // honest data but useless as a resting place-hold; words only.
            if (!placeworthy(n.label)) continue;
            const [sx, sy, sz] = screenXY(n);
            if (sz > 1 || sx < 0 || sx > W || sy < 0 || sy > H) continue; // offscreen/behind
            const cell = Math.min(2, Math.floor((sy / H) * 3)) * 3 + Math.min(2, Math.floor((sx / W) * 3));
            if (takenCell.has(cell)) continue;
            const w = boxOf(n);
            if (collides(sx, sy, w)) continue;
            takenCell.add(cell);
            placed.push([sx, sy, w]);
            want.set(n.id, { role: 'anchor' });
            added++;
          }
        }

        // THE BEAM SUGGESTS — in both modes, but as the secondary voice: a
        // smaller allowance under focus, collision priority already ceded to
        // the focus labels above, and a candidate must hold the beam across
        // consecutive syncs before it fades in (the camera drifting past
        // something no longer pops a label).
        const beamCap = focusActive ? TUNE.beamCapFocus : labelCap();
        const lit: Array<[string, number]> = [];
        for (const n of nodes) {
          if (!isVis(n) || want.has(n.id)) continue;
          const t = labelTorchNode(n);
          // Enter at BEAM_ON, stay until BEAM_OFF — hysteresis against edge flicker.
          if (t > TUNE.beamOn || (labelObjs.has(n.id) && t > TUNE.beamOff)) lit.push([n.id, t]);
        }
        lit.sort((a, b) => b[1] - a[1]);
        const inBeam = new Set<string>();
        let added = 0;
        for (const [id] of lit) {
          if (added >= beamCap) break;
          const n = nodeById.get(id);
          const [sx, sy] = screenXY(n);
          const w = boxOf(n);
          if (collides(sx, sy, w)) continue;
          inBeam.add(id);
          const streak = (beamStreak.get(id) ?? 0) + 1;
          beamStreak.set(id, streak);
          if (streak < 2 && !labelObjs.has(id)) continue; // entry debounce
          placed.push([sx, sy, w]);
          want.set(id, { role: 'beam' });
          added++;
        }
        for (const id of [...beamStreak.keys()]) if (!inBeam.has(id)) beamStreak.delete(id);
        reconcileLabels(want);
      };
      // Label SIZE tracks the node's on-screen size (the same projection the point
      // shader uses: pxDiameter = size·(H/2)/viewDepth), so a label reads as
      // attached to its node — small nodes get small labels, and everything grows
      // and recedes with the camera instead of snapping to a fixed pixel band
      // (which flattened the depth and broke the atmosphere).
      const updateLabels = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade); // ~150ms to settle — a fade, not a pop
        for (const [id, st] of labelObjs) {
          const n = nodeById.get(id);
          const obj = st.obj;
          const camD = camPos.distanceTo(obj.position) || 1;
          const nodePx = rad(n) * 2.4 * (H / 2) / camD; // node's on-screen diameter
          const torch = labelTorchAt(obj.position);
          // ROLE-styled, size UNCLAMPED (owner direction): every label scales
          // purely with its node's on-screen size — depth stays honest, a far
          // neighbour is a tiny label rather than a uniform or missing one.
          // Roles differentiate by MULTIPLIER, weight, colour, and opacity.
          const base = nodePx * 0.85;
          let size: number;
          let target: number;
          let color = ink.text;
          let weight = '600';
          const t = Math.max(0, Math.min(1, (nodePx - 6) / 22)); // 0 = far, 1 = near
          if (st.role === 'sel') {
            size = base * TUNE.selSizeMult;
            target = 1;
            color = ink.accent;
            weight = '700';
          } else if (st.role === 'hit') {
            size = base * TUNE.hitSizeMult;
            target = 1;
          } else if (st.role === 'nbr') {
            size = base * TUNE.nbrSizeMult;
            target = TUNE.nbrOpFar + (TUNE.nbrOpNear - TUNE.nbrOpFar) * t; // far neighbours recede
          } else if (st.role === 'anchor') {
            // Orientation anchors: quieter than a beam catch in colour but
            // steadier in presence — the resting wayfinding layer.
            size = base * TUNE.anchorSizeMult;
            target = TUNE.anchorOpacity;
            color = ink.dim;
          } else {
            // The beam's GENTLE slope: opacity rises smoothly from ~0 at the
            // admission boundary to its ceiling as the beam centres a node —
            // no cliff where labels used to pop.
            size = base * TUNE.beamSizeMult;
            target = TUNE.beamOpacity * smoothstep(TUNE.beamOff, 0.95, torch);
            weight = '500';
          }
          if (st.dying) target = 0;
          st.cur += (target - st.cur) * k;
          if (st.dying && st.cur < 0.03) {
            scene.remove(obj);
            obj.element.remove?.();
            labelObjs.delete(id);
            continue;
          }
          // Collision displacement eases to its target; the hairline leader
          // spans from the (shifted) label's anchor corner back to the node.
          st.cox += (st.ox - st.cox) * k;
          st.coy += (st.oy - st.coy) * k;
          const displaced = Math.abs(st.cox) + Math.abs(st.coy) > 1.5;
          obj.element.style.marginLeft = displaced ? st.cox.toFixed(1) + 'px' : '';
          obj.element.style.marginTop = displaced ? st.coy.toFixed(1) + 'px' : '';
          const leader = (obj.element as any)._leader;
          if (leader) {
            if (displaced) {
              leader.style.display = 'block';
              leader.style.width = Math.hypot(st.cox, st.coy).toFixed(1) + 'px';
              leader.style.transform = `rotate(${Math.atan2(-st.coy, -st.cox).toFixed(4)}rad)`;
            } else leader.style.display = 'none';
          }
          obj.element.style.fontSize = size.toFixed(1) + 'px';
          obj.element.style.paddingTop = (nodePx * 0.4 + 1).toFixed(1) + 'px'; // clear the dot
          obj.element.style.color = color;
          obj.element.style.fontWeight = weight;
          obj.element.style.opacity = st.cur.toFixed(3);
        }
      };

      const clock = new THREE.Clock();
      const AUTOROT = 0.12; // rad/sec idle orbit
      let beamFrame = 0;
      const tick = (): void => {
        if (disposed) return;
        raf = requestAnimationFrame(tick);
        const delta = clock.getDelta();
        if (!interacting && performance.now() - lastInput > 5000) controls.rotate(AUTOROT * delta, 0, false);
        controls.update(delta);
        // Feed the beam (camera + focal point) to the torch shaders + labels.
        controls.getTarget(focusVec);
        camera.getWorldPosition(camPos);
        torchUniforms.uFocus.value.copy(focusVec);
        torchUniforms.uCam.value.copy(camPos);
        // Re-pick the beam-lit label set a few times a second (DOM churn is the
        // cost; the beam moves slowly), then size/opacity every frame.
        if ((beamFrame = (beamFrame + 1) % 5) === 0) syncBeamLabels();
        updateLabels(delta);
        updateConstellations(delta);
        if (useBloom()) {
          ensureComposer();
          composer.render();
        } else renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
      };
      tick();

      const resize = (): void => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        W = w; H = h;
        camera.aspect = W / H; camera.updateProjectionMatrix();
        renderer.setSize(W, H); labelRenderer.setSize(W, H); composer?.setSize(W, H);
        ptMat.uniforms.uScale.value = H / 2;
      };
      ro = new ResizeObserver(resize);
      ro.observe(el);

      // ── the tuner (?tune=1, sticky; ?tune=0 clears): lil-gui over TUNE.
      // Touch-friendly, loads from esm.sh like the rest of the 3D stack, and
      // only ever mounts behind the flag — a field instrument for dialling the
      // torch/beam/label/edge/bloom feel on live data. `copy values` puts the
      // current JSON on the clipboard to send back for hard-coding.
      let gui: any = null;
      if (tuneEnabled()) {
        void import(/* @vite-ignore */ esmURL('lil-gui@0.19.2')).then((m: any) => {
          if (disposed) return;
          const GUI = m.default ?? m.GUI;
          gui = new GUI({ title: 'graph tune' });
          gui.domElement.style.cssText = 'position:fixed;top:64px;right:8px;z-index:60;max-height:70dvh;overflow-y:auto';
          const persist = (): void => { try { localStorage.setItem(TUNE_LS, JSON.stringify(TUNE)); } catch { /* */ } };
          const refresh = (): void => {
            torchUniforms.uConeIn.value = TUNE.coneIn;
            torchUniforms.uConeOut.value = TUNE.coneOut;
            torchUniforms.uDepthIn.value = SPREAD * TUNE.depthIn;
            torchUniforms.uDepthOut.value = SPREAD * TUNE.depthOut;
            torchUniforms.uFloor.value = TUNE.torchFloor;
            torchUniforms.uSizeBoost.value = TUNE.boostSizeGain;
            if (useBloom()) ensureComposer();
            if (bloomPass) {
              bloomPass.strength = TUNE.bloomStrength;
              bloomPass.radius = TUNE.bloomRadius;
              bloomPass.threshold = TUNE.bloomThreshold;
            }
            renderer.toneMappingExposure = TUNE.exposure;
            applyNodeAlpha();
            applyEdgeColor();
            persist();
          };
          const add = (folder: any, key: keyof typeof TUNE, min: number, max: number, step = 0.01): void => {
            folder.add(TUNE, key, min, max, step).onChange(refresh);
          };
          const torchF = gui.addFolder('torch');
          // Mins go to TRUE zero — the owner's grade railed the old bottom stops
          // (coneIn 0.02, depthIn 0.05), so the instrument was clipping intent.
          add(torchF, 'coneIn', 0, 0.5);
          add(torchF, 'coneOut', 0.1, 1.2);
          add(torchF, 'depthIn', 0, 1.5);
          add(torchF, 'depthOut', 0.3, 4);
          add(torchF, 'torchFloor', 0, 0.2, 0.005);
          const beamF = gui.addFolder('beam');
          add(beamF, 'labelConeIn', 0.02, 0.5);
          add(beamF, 'labelConeOut', 0.1, 1.2);
          add(beamF, 'beamOn', 0.05, 0.9);
          add(beamF, 'beamOff', 0.02, 0.8);
          add(beamF, 'beamOpacity', 0, 1);
          add(beamF, 'beamSizeMult', 0.3, 1.5);
          add(beamF, 'beamCapFocus', 0, 20, 1);
          add(beamF, 'labelCap', 0, 40, 1);
          const labelsF = gui.addFolder('labels');
          add(labelsF, 'selSizeMult', 0.8, 2.5);
          add(labelsF, 'hitSizeMult', 0.8, 2.5);
          add(labelsF, 'nbrSizeMult', 0.6, 2);
          add(labelsF, 'nbrOpFar', 0.1, 1);
          add(labelsF, 'nbrOpNear', 0.3, 1);
          add(labelsF, 'labelFade', 1, 20, 0.5);
          const nodesF = gui.addFolder('nodes');
          add(nodesF, 'nodeDim', 0.2, 1.5);
          add(nodesF, 'nbrBoost', 0, 1);
          add(nodesF, 'boostSizeGain', 0, 1.5);
          const edgesF = gui.addFolder('edges');
          add(edgesF, 'edgeSimilar', 0, 0.3, 0.005);
          add(edgesF, 'edgeMember', 0, 0.5, 0.005);
          add(edgesF, 'edgeDerived', 0, 0.5, 0.005);
          add(edgesF, 'edgeAuthored', 0, 1, 0.005);
          add(edgesF, 'focusEdgeAlpha', 0, 1);
          add(edgesF, 'atmosphereDim', 0, 1);
          const placesF = gui.addFolder('places');
          add(placesF, 'constCap', 0, 16, 1);
          add(placesF, 'constOpacity', 0, 1);
          add(placesF, 'constNear', 0.5, 2.5);
          add(placesF, 'constFar', 1.2, 5);
          add(placesF, 'anchorCap', 0, 16, 1);
          add(placesF, 'anchorOpacity', 0, 1);
          add(placesF, 'anchorSizeMult', 0.3, 1.5);
          const postF = gui.addFolder('bloom');
          postF.add(TUNE, 'bloomMode', ['auto', 'on', 'off']).onChange(refresh);
          add(postF, 'bloomStrength', 0, 2);
          add(postF, 'bloomRadius', 0, 1.5);
          add(postF, 'bloomThreshold', 0, 1);
          add(postF, 'exposure', 0.4, 2.5);
          gui.add({ copy: () => { void navigator.clipboard?.writeText(JSON.stringify(TUNE, null, 2)); } }, 'copy').name('copy values');
          // `paste values` closes the loop `copy values` opened: a grade JSON
          // from another device/session (or hard-coded defaults under trial)
          // drops straight back into the live instrument. Unknown keys are
          // ignored; types are checked against the defaults' shapes.
          const applyTune = (text: string | null | undefined): void => {
            let obj: Record<string, unknown>;
            try { obj = JSON.parse(text ?? ''); } catch { return; }
            if (!obj || typeof obj !== 'object') return;
            for (const k of Object.keys(TUNE_DEFAULTS) as Array<keyof typeof TUNE>) {
              const v = obj[k];
              if (v === undefined || typeof v !== typeof TUNE_DEFAULTS[k]) continue;
              if (k === 'bloomMode' && !['auto', 'on', 'off'].includes(v as string)) continue;
              (TUNE as any)[k] = v;
            }
            refresh(); // also persists
            gui.controllersRecursive().forEach((c: any) => c.updateDisplay());
          };
          gui.add({
            paste: () => {
              // Clipboard read needs a permission grant some browsers refuse
              // (iOS Safari prompts, Firefox denies) — fall back to a prompt box.
              if (navigator.clipboard?.readText) {
                navigator.clipboard.readText().then(applyTune, () => applyTune(window.prompt('paste tune JSON')));
              } else {
                applyTune(window.prompt('paste tune JSON'));
              }
            },
          }, 'paste').name('paste values');
          gui.add({
            reset: () => {
              Object.assign(TUNE, TUNE_DEFAULTS);
              try { localStorage.removeItem(TUNE_LS); } catch { /* */ }
              refresh();
              gui.controllersRecursive().forEach((c: any) => c.updateDisplay());
            },
          }, 'reset').name('reset defaults');
        }).catch(() => null);
      }

      cleanup = () => {
        gui?.destroy?.();
        window.removeEventListener('keydown', onSpaceDown);
        window.removeEventListener('keyup', onSpaceUp);
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerup', onUp);
        for (const [, st] of labelObjs) st.obj.element.remove?.();
        for (const [, o] of edgeLabelObjs) o.element.remove?.();
        for (const c of constellations) c.obj.element.remove?.();
        if (crumbTimer) clearTimeout(crumbTimer);
        crumb.remove();
        controls.dispose?.(); geo.dispose(); egeo.dispose(); ptMat.dispose(); eMat.dispose();
        disc.dispose?.(); ringTex.dispose?.(); ringMat.dispose(); composer?.dispose?.(); renderer.dispose();
      };
    })().catch((err) => (window.reportError ?? console.error)(err));

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (onResult) window.removeEventListener(CONSOLE_RESULT_EVENT, onResult);
      cleanup?.();
      api.current = null;
      if (el) el.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    if (selectedKey === lastExternal.current) return;
    lastExternal.current = selectedKey;
    api.current?.select(selectedKey, true);
  }, [selectedKey]);

  useEffect(() => { api.current?.setVisible(visible); }, [visible]);

  return <div ref={host} style={{ position: 'fixed', inset: 0, background: ink.sceneBg, overflow: 'hidden' }} />;
}

export function FullGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  // Salience visibility: 0 → only the focus band, 1 → the whole slice. The
  // renderer culls nodes/edges above the corresponding salience rank.
  const [visible, setVisible] = useState(1);
  // Ink surface, sized so the control is a real touch target over the canvas.
  const pill: React.CSSProperties = {
    fontFamily: ink.mono, fontSize: '0.75rem', color: ink.text,
    background: 'rgba(24,21,17,0.78)', border: `1px solid ${ink.line}`,
    borderRadius: 999, backdropFilter: 'blur(4px)', minHeight: 40,
    display: 'flex', alignItems: 'center', gap: '0.45rem', padding: '0.35rem 0.8rem',
  };
  return (
    <>
      <ThreeGraph selectedKey={selectedKey} onSelect={onSelect} visible={visible} />
      {/* Salience dial — from just the focus band to the whole slice. */}
      <label
        title="Show more or fewer facts, by salience"
        style={{ ...pill, position: 'fixed', right: 12, top: 'max(10px, env(safe-area-inset-top))', zIndex: 20, cursor: 'default' }}
      >
        <span style={{ color: ink.dim }}>focus</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={visible}
          onChange={(e) => setVisible(Number(e.target.value))}
          aria-label="Salience visibility"
          style={{ width: 96, accentColor: ink.accent, cursor: 'pointer', margin: 0 }}
        />
        <span style={{ width: 26, textAlign: 'right', color: ink.dim, fontVariantNumeric: 'tabular-nums' }}>
          {visible >= 0.999 ? 'all' : `${Math.round(visible * 100)}%`}
        </span>
      </label>
    </>
  );
}
