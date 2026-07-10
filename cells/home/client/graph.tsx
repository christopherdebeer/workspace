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
const hueOf = (t: string): number => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
};
const nodeColor = (t: string | null): string => (t ? `hsl(${hueOf(t)} 42% 55%)` : '#9a917f');

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
        // 0.75: a global dimmer — the additive core of a dense slice summed to
        // white; the torch supplies the contrast, points don't need to.
        return 0.75 * nodeDOI(n, selKey, nbr, hiSet, N);
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
      renderer.toneMappingExposure = 1.15;
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
        if (nbr?.has(n.id)) return 0.85; // lit, with a whisper of depth left
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
      const CONE_IN = 0.14, CONE_OUT = 0.42; // tan(half-angle): full inside → dark outside the beam
      const DEPTH_IN = SPREAD * 0.45, DEPTH_OUT = SPREAD * 1.7; // in-focus depth band around the focal point
      const FLOOR = 0.04;
      // A FOCUSED spotlight: brightest where the beam axis meets the focal depth
      // (the focal point), dropping off both off-axis (the beam) AND off the focal
      // depth — so the focal point is the single brightest spot, not the near rim.
      const TORCH_GLSL =
        'uniform vec3 uFocus; uniform vec3 uCam;' +
        'float torch(vec3 p){ vec3 d = uFocus - uCam; float td = length(d); vec3 axis = d / max(td, 1e-3);' +
        ' vec3 toP = p - uCam; float along = dot(toP, axis); if (along <= 0.0) return ' + FLOOR.toFixed(2) + ';' +
        ' float radial = length(toP - axis*along);' +
        ` float ang = 1.0 - smoothstep(${CONE_IN.toFixed(3)}, ${CONE_OUT.toFixed(3)}, radial / along);` +
        ` float dep = 1.0 - smoothstep(${DEPTH_IN.toFixed(1)}, ${DEPTH_OUT.toFixed(1)}, abs(along - td));` +
        ` return max(${FLOOR.toFixed(2)}, ang * dep); }`;
      const ptMat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: disc }, uScale: { value: H / 2 }, uFocus: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } },
        vertexShader:
          'attribute float size; attribute float alpha; attribute vec3 color; attribute float boost;' +
          'varying float vAlpha; varying vec3 vColor; uniform float uScale;' +
          TORCH_GLSL +
          'void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float vd = -mv.z;' +
          // Focus points also grow a little — brightness alone undersold a
          // small match dot; size makes the hit read as an OBJECT.
          'vAlpha = alpha * max(torch(position), boost); gl_PointSize = size * (1.0 + 0.45 * boost) * (uScale / max(vd, 1.0));' +
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
      const edgeBaseAlpha = (l: any): number => (MEMBER_RELS.has(l.rel) ? 0.16 : l.derived ? 0.12 : 0.3);
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
            al = 0.75;
          } else {
            [r, g, b] = edgeRGB[i];
            al = edgeAlphaOf(links[i]) * (focusActive ? 0.45 : 1);
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
        uniforms: { uFocus: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } },
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

      // ── labels (CSS2D — focus band + selection, faded by camera distance) ──
      const labelObjs = new Map<string, any>();
      const makeLabel = (n: any): any => {
        const div = document.createElement('div');
        div.textContent = n.label;
        // Fully inert to the browser: pointer-events:none so drags pass through
        // to the canvas (orbit/pan keep working when a gesture starts on a
        // label), and no text selection / iOS callout. Label TAPS are hit-tested
        // against the div rects in the canvas pointerup handler below.
        div.style.cssText = 'font:600 11px ui-monospace,monospace;color:#efe9dc;text-shadow:0 1px 3px #000,0 0 2px #000;white-space:nowrap;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;-webkit-text-size-adjust:100%;text-size-adjust:100%';
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
      // Labels are driven by the BEAM (torchAt, below) — sweeping the focal point
      // over the constellation lights whatever is near the line of sight so you can
      // explore low-salience neighbours. Salience no longer gates label existence;
      // it stays an affordance via node SIZE (rad ∝ score) and a whisper of label
      // opacity. PINNED nodes (selection / its neighbours / a highlight set) are
      // always labelled regardless of the beam.
      const labelPinned = (n: any): boolean => isVis(n) && (n.id === selKey || !!nbr?.has(n.id) || !!hiSet?.has(n.id));
      const pinnedSet = (): Set<string> => { const s = new Set<string>(); for (const n of nodes) if (labelPinned(n)) s.add(n.id); return s; };
      const reconcileLabels = (keep: Set<string>): void => {
        for (const n of nodes) {
          const want = keep.has(n.id), has = labelObjs.has(n.id);
          if (want && !has) { const o = makeLabel(n); labelObjs.set(n.id, o); scene.add(o); }
          else if (!want && has) { const o = labelObjs.get(n.id); scene.remove(o); o.element.remove?.(); labelObjs.delete(n.id); }
        }
      };
      // Safe before the beam exists (setup / selection): pinned labels only. The
      // tick's syncBeamLabels adds the beam-lit set once the camera is running.
      const syncLabels = (): void => reconcileLabels(pinnedSet());
      syncLabels();

      // ── bloom (desktop only — fill-rate heavy on phones) ──
      const bigScreen = Math.min(W, H) >= 620 && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      let composer: any = null;
      if (bigScreen) {
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        // Threshold above the resting wash so only genuinely bright points
        // bloom — at 0.12 the dense core's additive sum ALL bloomed and clipped
        // to a white blob that swallowed its labels.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.45, 0.5, 0.35)); // strength, radius, threshold
        composer.setSize(W, H);
      }

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
        for (const [id, obj] of labelObjs) {
          const r = obj.element.getBoundingClientRect();
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
      // The same torch, in JS, for the CSS2D labels (so text is lit by the beam
      // exactly like the points). axis = camera → focal point.
      const axisV = new THREE.Vector3(), toPV = new THREE.Vector3();
      const smoothstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const torchAt = (pos: any): number => {
        const td = axisV.copy(focusVec).sub(camPos).length();
        axisV.multiplyScalar(1 / Math.max(td, 1e-3));
        toPV.copy(pos).sub(camPos);
        const along = toPV.dot(axisV);
        if (along <= 0) return FLOOR;
        const radial = toPV.addScaledVector(axisV, -along).length(); // toP - axis*along
        const ang = 1 - smoothstep(CONE_IN, CONE_OUT, radial / along);
        const dep = 1 - smoothstep(DEPTH_IN, DEPTH_OUT, Math.abs(along - td));
        return Math.max(FLOOR, ang * dep);
      };
      // Beam-driven label set: label the nodes the torch is currently lighting
      // (brightest first, capped) plus the pinned set, with hysteresis so labels
      // don't flicker at the beam's edge. This is what lets a sweep of the focal
      // point surface nearby low-salience items.
      const scratchP = new THREE.Vector3();
      const torchNode = (n: any): number => torchAt(scratchP.set(n.x, n.y, n.z));
      // Fewer beam-lit labels on a phone — 28 at once piled up in the core.
      const BEAM_ON = 0.62, BEAM_OFF = 0.38, LABEL_CAP = Math.min(W, H) < 700 ? 12 : 22;
      // Legibility gates (the dense core turned its beam labels into a white
      // pile of 7px mush): a candidate must render big enough to READ, and must
      // not land on top of an already-placed label — greedy, brightest first.
      const projV = new THREE.Vector3();
      const distV = new THREE.Vector3();
      const MIN_LABEL_PX = 7;
      const screenXY = (n: any): [number, number] => {
        projV.set(n.x, n.y, n.z).project(camera);
        return [((projV.x + 1) / 2) * W, ((1 - projV.y) / 2) * H];
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

      const syncBeamLabels = (): void => {
        syncEdgeLabels();
        const placed: Array<[number, number]> = [];
        const collides = (sx: number, sy: number): boolean => placed.some(([px, py]) => Math.abs(px - sx) < 90 && Math.abs(py - sy) < 16);
        const readable = (n: any): boolean => {
          const camD = camPos.distanceTo(distV.set(n.x, n.y, n.z)) || 1;
          return rad(n) * 2.4 * (H / 2) / camD >= MIN_LABEL_PX;
        };
        // FOCUS MODE: with a selection (or a highlight set) the NEIGHBOURHOOD
        // owns the scene — no beam-lit bystanders. But a hub's neighbourhood is
        // itself a crowd (the tending protocol touches every run and audit), so
        // neighbours pass the SAME legibility gates as beam labels: most
        // salient first, readable size, no pile-ups, capped. Every neighbour
        // POINT stays bright (DOI 0.8) — connectedness shows even where a
        // label doesn't fit.
        if (selKey || hiSet) {
          const keep = new Set<string>();
          const anchor = selKey ? [selKey] : [];
          for (const id of [...anchor, ...(hiSet ?? [])]) {
            const n = nodeById.get(id);
            if (!n || !isVis(n)) continue;
            keep.add(id);
            placed.push(screenXY(n));
          }
          const cands = [...(nbr ?? [])]
            .map((id) => nodeById.get(id))
            .filter((n) => n && isVis(n) && !keep.has(n.id))
            .sort((a, b) => (a.rank ?? N) - (b.rank ?? N)); // most salient neighbours first
          let added = 0;
          for (const n of cands) {
            if (added >= LABEL_CAP) break;
            if (!readable(n)) continue;
            const [sx, sy] = screenXY(n);
            if (collides(sx, sy)) continue;
            placed.push([sx, sy]);
            keep.add(n.id);
            added++;
          }
          reconcileLabels(keep);
          return;
        }
        const keep = pinnedSet();
        for (const id of keep) { const n = nodeById.get(id); if (n) placed.push(screenXY(n)); }
        const lit: Array<[string, number]> = [];
        for (const n of nodes) {
          if (!isVis(n) || keep.has(n.id)) continue;
          const t = torchNode(n);
          // Enter at BEAM_ON, stay until BEAM_OFF — hysteresis against edge flicker.
          if (t > BEAM_ON || (labelObjs.has(n.id) && t > BEAM_OFF)) lit.push([n.id, t]);
        }
        lit.sort((a, b) => b[1] - a[1]);
        let added = 0;
        for (const [id] of lit) {
          if (added >= LABEL_CAP) break;
          const n = nodeById.get(id);
          if (!readable(n)) continue; // sub-readable
          const [sx, sy] = screenXY(n);
          if (collides(sx, sy)) continue;
          placed.push([sx, sy]);
          keep.add(id);
          added++;
        }
        reconcileLabels(keep);
      };
      // Label SIZE tracks the node's on-screen size (the same projection the point
      // shader uses: pxDiameter = size·(H/2)/viewDepth), so a label reads as
      // attached to its node — small nodes get small labels, and everything grows
      // and recedes with the camera instead of snapping to a fixed pixel band
      // (which flattened the depth and broke the atmosphere).
      const updateLabels = (): void => {
        for (const [id, obj] of labelObjs) {
          const n = nodeById.get(id);
          const camD = camPos.distanceTo(obj.position) || 1;
          const nodePx = rad(n) * 2.4 * (H / 2) / camD; // node's on-screen diameter
          // ROLE-styled, DEPTH-blended. Hard uniform floors made every label
          // the same size at every distance — legible but flat (owner: "breaks
          // 3d exploration and immersion"). Focus labels keep a readable floor
          // but SCALE and FADE with depth inside their band; atmosphere labels
          // are fully proportional, receding into the wash as before.
          const isSel = id === selKey;
          const isNbr = !isSel && (!!nbr?.has(id) || !!hiSet?.has(id));
          const t = Math.max(0, Math.min(1, (nodePx - 6) / 22)); // 0 = far, 1 = near
          const torch = torchAt(obj.position);
          let size: number;
          let op: number;
          if (isSel) {
            size = 11 + 3 * t;
            op = 1;
          } else if (isNbr) {
            size = 8.5 + 3.5 * t;
            op = 0.7 + 0.3 * t; // near neighbours read solid, far ones recede
          } else {
            size = Math.min(11, nodePx * 0.85); // proportional — the atmosphere
            const salN = 1 - (n?.rank ?? N) / Math.max(1, N);
            op = torch * (0.9 + 0.1 * salN);
          }
          obj.element.style.fontSize = size.toFixed(1) + 'px';
          obj.element.style.paddingTop = (nodePx * 0.4 + 1).toFixed(1) + 'px'; // clear the dot
          obj.element.style.color = isSel ? ink.accent : ink.text;
          obj.element.style.fontWeight = isSel ? '700' : '600';
          obj.element.style.opacity = op.toFixed(3);
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
        ptMat.uniforms.uFocus.value.copy(focusVec); ptMat.uniforms.uCam.value.copy(camPos);
        eMat.uniforms.uFocus.value.copy(focusVec); eMat.uniforms.uCam.value.copy(camPos);
        // Re-pick the beam-lit label set a few times a second (DOM churn is the
        // cost; the beam moves slowly), then size/opacity every frame.
        if ((beamFrame = (beamFrame + 1) % 5) === 0) syncBeamLabels();
        updateLabels();
        if (composer) composer.render(); else renderer.render(scene, camera);
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

      cleanup = () => {
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerup', onUp);
        for (const [, o] of labelObjs) o.element.remove?.();
        for (const [, o] of edgeLabelObjs) o.element.remove?.();
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
