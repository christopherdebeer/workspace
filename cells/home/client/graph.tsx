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
  // torch (the scene LIGHTING — owner re-grade 2026-07-12: coneIn/depthIn at 0
  // means the full-brightness plateau starts AT the focal point itself — no
  // graded falloff onset, angle/depth attenuation begin immediately. Floor
  // lowered to 0.09 (was 0.2): the periphery goes darker before the torch
  // picks it up, sharpening the beam's contrast against the rest.)
  coneIn: 0, coneOut: 1.2, depthIn: 0, depthOut: 4, torchFloor: 0.09,
  // label admission (the SELECTOR) — decoupled from the lighting: labels need
  // a sharp instrument even when the light is flat, so admission ranks by its
  // own narrow cone. Owner re-grade 2026-07-12: labelConeOut widened to 1.2
  // (was 0.42) — admission now spans nearly the whole torch cone, not just
  // its dead-centre.
  labelConeIn: 0.02, labelConeOut: 1.2,
  beamOn: 0.85, beamOff: 0.2, beamCapFocus: 5, labelCap: 0, // labelCap 0 = viewport default (12/22)
  beamOpacity: 0.57, beamSizeMult: 0.3,
  // focus labels (owner re-grade 2026-07-12): hits headline (1.17), and
  // neighbours now hold FULL opacity near and far (1/1, was 0.41/0.81) —
  // size still grades the role, opacity no longer does.
  selSizeMult: 0.8, hitSizeMult: 1.17, nbrSizeMult: 0.6, nbrOpFar: 1, nbrOpNear: 1,
  labelFade: 4, // lerp rate: higher = snappier (owner re-grade 2026-07-12: was 1/SLOW, now snappy)
  // nodes — neighbours barely lift (0.2): selection lights the ANCHOR, the
  // neighbourhood whispers; the fan edges carry the structure.
  nodeDim: 1.5, nbrBoost: 0.2, boostSizeGain: 1,
  // edges (owner re-grade 2026-07-12: brought back up from "all but erased" —
  // the resting lattice now reads at rest, authored edges especially (0.24,
  // was 0.035), with focus edges dialled back off full-alpha (0.76, was 1.0)
  // since the resting mat itself now carries more of the structure).
  edgeSimilar: 0.035, edgeMember: 0.06, edgeDerived: 0.06, edgeAuthored: 0.24,
  focusEdgeAlpha: 0.76, atmosphereDim: 0.49,
  // flow (2026-07-12): a travelling pulse along FOCUS edges only (the ones
  // already fanning from a selection/hit) — direction is source→target, so
  // the animation reads as energy moving the way the edge actually points.
  // Resting edges stay static on purpose (the file's own standing rule:
  // "lines earn ink only under focus" — movement is the same kind of ink).
  // Dusk only: paper's printed-map metaphor has no motion to carry.
  edgeFlowSpeed: 0.5, edgeFlowWidth: 0.35, edgeFlowGain: 1.4, edgeFlowCycles: 3,
  // bloom — threshold ~0: EVERYTHING blooms. Each point wears a soft halo:
  // the cloud reads as a star field, not instrument dots (with the edges
  // stripped, this is what carries the atmosphere now).
  bloomStrength: 1.06, bloomRadius: 0.43, bloomThreshold: 0.05, exposure: 0.7,
  bloomMode: 'on' as 'auto' | 'on' | 'off',
  // star render: 0 = soft disc, 1 = bright core + strong diffraction spikes.
  starSpike: 0.55,
  // scene mode: 'dusk' = the luminous dark field; 'paper' = a cartographic
  // star ATLAS — ink stars and fine linework on warm paper, bloom off.
  sceneMode: 'dusk' as 'dusk' | 'paper',
  // places (cartography): constellation captions — COMPUTED from salience
  // hubs + dominant types, with registered VIEWS as the authored layer — and
  // resting orientation anchors (top-salience node per screen region).
  // constNear/Far: approach-fade band as multiples of a cluster's radius —
  // captions read from afar and hand off to fact labels as you arrive.
  // places (owner grade #4): captions many and STRONG (a star atlas names
  // its constellations), tight approach band; anchors as micro-print star
  // names — many, tiny, full-opacity (celestial-chart typography).
  constCap: 32, constOpacity: 1, constNear: 0.5, constFar: 1.2,
  anchorCap: 32, anchorOpacity: 1, anchorSizeMult: 0.1,
  // in-scene label furniture. The dial is a real continuum: below ~0.95 the
  // pill is a translucent VEIL rendered over the cloud (genuine gradient —
  // dims what's behind); at ~1 it flips to the depth-writing OCCLUDER. Owner
  // re-grade 2026-07-12: pillAlpha up to 0.61 (was 0.39) and pillFeather to
  // the max 1 (was 0.65) — a heavier, more diffuse veil.
  pillAlpha: 0.61, pillFeather: 1, labelOutline: 0.35,
  // NEAR-FIELD ceiling (screen px). Depth-true sizing is the rule — but a
  // label that flies close now carries an OPAQUE pill, and unbounded it
  // becomes a viewport-eating billboard (the mis-step). Far labels still
  // shrink honestly; only the near extreme compresses toward this cap.
  // 0 = uncapped (the old behaviour). Owner re-grade 2026-07-12: tightened
  // to 8px (was 24) — near labels compress much harder now.
  labelMaxPx: 8,
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
// zoom. The type→letterform mapping is DATA, not code — the type vocabulary
// evolves at runtime, so a hardcoded set is stale the day it ships. It lives
// in the `_config/typography` fact ({ groups: { <type>: 'act'|'doc'|'kb' } },
// the `_config/suggestions` precedent), loaded with the graph model and
// editable like any fact; unmapped types stay instrument mono.
const TYPE_SERIF = 'Georgia,"Iowan Old Style","Palatino Linotype",serif';
let TYPE_GROUP: Record<string, string> = {};
const typeGroup = (t: string | null): string => (t && TYPE_GROUP[t]) || 'mono';
// SDF font files for the in-scene labels (troika needs real font URLs —
// .woff, not woff2). One face per group; weight/emphasis is carried by
// size, colour, and opacity (the role grade), not by extra font files.
const FONT_BY_GROUP: Record<string, string> = {
  act: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-600-normal.woff',
  doc: 'https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.1.0/files/source-serif-4-latin-400-italic.woff',
  kb: 'https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.1.0/files/source-serif-4-latin-400-normal.woff',
  mono: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.1.0/files/ibm-plex-mono-latin-500-normal.woff',
};
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

// Generous cap — SDF labels WRAP now (maxWidth), so a longer title becomes
// two or three centred lines instead of an ellipsis at 26 chars.
const shortLabel = (s: string): string => (s.length > 44 ? s.slice(0, 43) + '…' : s);

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

// The slice has grown past what one unbounded workspace.query can return
// inside the Lambda's own execution window (2026-07-11: an unbounded call
// started 502ing once the corpus crossed a few thousand facts — the query
// itself is fine, the single round trip just no longer fits). `workspace.
// query` already supports cursor paging (docs-sync.mjs's own liveShas() uses
// it the same way) — page through instead of one all-at-once request. The
// page size is arbitrary; large enough to keep round trips few, small enough
// to stay well under the timeout that bit the unbounded form.
//
// Every paged read's FIRST page already reports `total` — once known, every
// remaining page's offset is knowable up front (both `workspace.query` and
// `workspace.graph` use a plain numeric-offset cursor), so the rest fetch
// CONCURRENTLY (bounded) instead of one round trip at a time (2026-07-11
// follow-up: this is what "more parallelism" meant for the fetch side).
// `fastOnly` stops after page 1 — enough for an immediate first paint
// (rankBy:'salience' means page 1 IS the most important facts already).
const PAGE_CONCURRENCY = 4;
async function pagedFetch<T>(
  page: (cursor?: string) => Promise<{ ok: boolean; value: unknown }>,
  pick: (v: unknown) => { items: T[]; total?: number; nextCursor?: string },
  opts?: { fastOnly?: boolean },
): Promise<T[]> {
  const res = await page();
  if (!res.ok) return []; // best-effort: render whatever pages already landed rather than fail the whole graph
  const first = pick(res.value);
  const out = [...first.items];
  if (opts?.fastOnly || !first.nextCursor || !first.total || !first.items.length) return out;
  const pageSize = first.items.length;
  const offsets: number[] = [];
  for (let o = pageSize; o < first.total; o += pageSize) offsets.push(o);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < offsets.length) {
      const cursor = String(offsets[idx++]);
      const r = await page(cursor);
      if (r.ok) out.push(...pick(r.value).items);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
  return out;
}

const QUERY_PAGE_SIZE = 300;
async function fetchAllEntries(opts?: { fastOnly?: boolean }): Promise<ListEntry[]> {
  return pagedFetch<ListEntry>(
    (cursor) => mcpCall('read', 'workspace.query', { rankBy: 'salience', shape: 'card', limit: QUERY_PAGE_SIZE, ...(cursor ? { cursor } : {}) }),
    (v) => {
      const p = v as { entries?: ListEntry[]; total?: number; nextCursor?: string } | null;
      return { items: p?.entries ?? [], total: p?.total, nextCursor: p?.nextCursor };
    },
    opts,
  );
}

// workspace.graph/edges has the same shape of problem as the query above, one
// step worse: it isn't just slow at full-slice size, its response can exceed
// the Lambda platform's hard 6MB payload ceiling outright (confirmed live,
// 2026-07-11 — a 502 with no retry-shaped error, distinct from a timeout).
// scopeEdges (services/workspace/shape.ts) now supports the same offset
// cursor as query — CloudFront's ~30s default origin timeout means a bigger
// per-call `limit` isn't free either, so this stays a real page size, not a
// token gesture. `edgeShape:'thin'` (2026-07-11) drops the fields this
// renderer never reads (`scope`/`strength`/`createdAt`/`writer`/`score`/
// `source`) — GEdge only ever used `{from,rel,to,derived}`, so every edge was
// carrying ~2-3x the bytes it needed to.
const EDGES_PAGE_SIZE = 2000;
async function fetchAllEdges(opts?: { fastOnly?: boolean }): Promise<GEdge[]> {
  return pagedFetch<GEdge>(
    (cursor) => mcpCall('read', 'workspace.graph', { limit: EDGES_PAGE_SIZE, edgeShape: 'thin', ...(cursor ? { cursor } : {}) }),
    (v) => {
      const p = v as { edges?: GEdge[]; total?: number; nextCursor?: string } | null;
      return { items: p?.edges ?? [], total: p?.total, nextCursor: p?.nextCursor };
    },
    opts,
  );
}

/** Load the whole slice + projection into a render-ready model: nodes, edges,
 *  the focus band, and the semantic coordinates. `fastOnly` (2026-07-11)
 *  returns after just page 1 of entries/edges — a fast, mostly-correct first
 *  paint the caller mounts immediately, while a second, un-fastOnly call
 *  fetches the complete model in the background for a follow-up mount. */
async function fetchGraphModel(opts?: { fastOnly?: boolean }): Promise<GraphModel> {
  const [allEntries, rawEdges, cfgRes, layoutRes, typoRes] = await Promise.all([
    fetchAllEntries(opts),
    fetchAllEdges(opts),
    mcpCall('read', 'workspace.peek', { key: '_config/salience' }).catch(() => null),
    // The precomputed SEMANTIC layout (workspace.project → `_home/embed2d`, [x,y,z]).
    mcpCall('read', 'workspace.peek', { key: '_home/embed2d' }).catch(() => null),
    // The type→letterform mapping (see TYPE_GROUP) — config, not code.
    mcpCall('read', 'workspace.peek', { key: '_config/typography' }).catch(() => null),
  ]);
  const typoVal = (typoRes && typoRes.ok ? (typoRes.value as { value?: { groups?: Record<string, string> } } | null)?.value : null) ?? null;
  if (typoVal?.groups && typeof typoVal.groups === 'object') TYPE_GROUP = typoVal.groups;
  const cfgVal = (cfgRes && cfgRes.ok ? (cfgRes.value as { value?: { focusThreshold?: unknown } } | null)?.value : null) ?? null;
  const ftRaw = Number(cfgVal?.focusThreshold);
  const focusThreshold = Number.isFinite(ftRaw) && ftRaw > 0 && ftRaw <= 1 ? ftRaw : 0.5;
  const entries = allEntries.filter((e) => !isPlumbing(e));
  const byKey = new Map(entries.map((e) => [e.key, e]));
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
    // SDF text (troika): node labels live IN the scene — they take the
    // camera's perspective (depth honesty for free), the tone mapping, and
    // the bloom, instead of floating on a DOM overlay. `deps` pins its
    // three to our version so the module graphs align.
    import(/* @vite-ignore */ esmURL(`troika-three-text@0.49.1?deps=three@${THREE_VER}`)),
  ])
    .then(([cc, comp, rp, bloom, css, troika]) => ({
      CameraControls: cc.default ?? cc,
      EffectComposer: comp.EffectComposer,
      RenderPass: rp.RenderPass,
      UnrealBloomPass: bloom.UnrealBloomPass,
      CSS2DRenderer: css.CSS2DRenderer,
      CSS2DObject: css.CSS2DObject,
      TroikaText: troika.Text,
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
/** The point sprite: a STAR — tight bright core, steep falloff, and four
 *  diffraction spikes whose strength rides `spike` (0 = the old soft disc).
 *  Bloom (threshold ~0 in the owner's grade) supplies the halo. */
function makeStarTexture(THREE: any, spike: number): any {
  const s = 96;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const c = s / 2;
  // Core: hotter and tighter than the old disc — a star, not a blob.
  const core = g.createRadialGradient(c, c, 0, c, c, c);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.18, 'rgba(255,255,255,0.9)');
  core.addColorStop(0.42, `rgba(255,255,255,${0.35 - 0.15 * spike})`);
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, s, s);
  if (spike > 0.01) {
    // Four diffraction spikes: thin gradients along the axes.
    const a = 0.85 * spike;
    for (const rot of [0, Math.PI / 2]) {
      g.save();
      g.translate(c, c);
      g.rotate(rot);
      const lg = g.createLinearGradient(-c, 0, c, 0);
      lg.addColorStop(0, 'rgba(255,255,255,0)');
      lg.addColorStop(0.5, `rgba(255,255,255,${a})`);
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = lg;
      const th = 1.6 + 1.4 * spike; // spike thickness
      g.fillRect(-c, -th / 2, s, th);
      g.restore();
    }
  }
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
  // The upgrade from the fast partial mount to the full one rebuilds the
  // scene (a fresh api.current, fresh internal selection/visibility state) —
  // read the LATEST selectedKey/visible here (not the mount effect's stale
  // closure over its initial props) so a selection or dial change made
  // during the loading window survives the rebuild instead of resetting.
  const selectedKeyRef = useRef(selectedKey);
  selectedKeyRef.current = selectedKey;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Loading UX (2026-07-11): 'fast' = fetching the first-page model for the
  // initial paint, 'full' = that's mounted, now paging in the rest of the
  // slice in the background, 'done' = the complete model is mounted (or
  // load failed — either way there's nothing left to wait for).
  const [loadState, setLoadState] = useState<'fast' | 'full' | 'done'>('fast');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let onResult: ((ev: Event) => void) | null = null;
    let cleanup: (() => void) | null = null;

    // Progressive mount (2026-07-11 follow-up to the query/edges pagination
    // fix): called TWICE — once with a "fast" model (page 1 of entries+edges,
    // already the most salient facts since the query ranks by salience) for
    // an immediate first paint, then again with the complete model once the
    // rest of the slice has paged in. Each call tears down whatever's
    // currently mounted first, so the second call is a clean rebuild, not an
    // append — the render pipeline below is untouched either way.
    async function mountScene(model: GraphModel, THREE: any, addons: any): Promise<void> {
      if (disposed) return;
      cleanup?.();
      cleanup = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      ro?.disconnect();
      ro = null;
      if (onResult) { window.removeEventListener(CONSOLE_RESULT_EVENT, onResult); onResult = null; }
      if (!THREE || !addons) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">3D renderer unavailable (offline?)</div>';
        return;
      }
      const { CameraControls, EffectComposer, RenderPass, UnrealBloomPass, CSS2DRenderer, CSS2DObject, TroikaText } = addons;
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

      // ── scene-mode palette (dusk = luminous dark field; paper = ink on a
      // warm chart). Everything colour-like routes through PAL so the mode
      // toggle can restyle the live scene without a rebuild. ──
      const paletteFor = (m: string): Record<string, any> =>
        m === 'paper'
          // outline == bg: the halo's job is to BE the ground (knock out
          // linework behind glyphs), not to add a milky edge around them.
          ? { bg: '#ece2cb', text: '#2b2318', accent: '#8a6410', dim: '#6c614e', outline: '#ece2cb', pill: [0.925, 0.886, 0.796], capAuth: '#7a5c1a', capComp: '#5b5344', rel: '#6c614e' }
          : { bg: ink.sceneBg, text: ink.text, accent: ink.accent, dim: ink.dim, outline: '#0a0805', pill: [0, 0, 0], capAuth: '#e3c987', capComp: '#b7ad99', rel: '#a89e8a' };
      let PAL = paletteFor(TUNE.sceneMode);
      const isPaper = (): boolean => TUNE.sceneMode === 'paper';

      // ── node colour / size / alpha buffers ──
      const colBuf = new Float32Array(N * 3);
      const sizeBuf = new Float32Array(N);
      const alphaBuf = new Float32Array(N);
      const applyNodeColors = (): void => {
        for (let i = 0; i < N; i++) {
          const n = nodes[i];
          // Dusk: luminous pastels (additive). Paper: the same hue coding as
          // dark chart INK (normal blending over the warm ground).
          const [r, g, b] = isPaper()
            ? (n.type ? hslToRgb(hueOf(n.type), 0.55, 0.3) : [0.27, 0.24, 0.19])
            : (n.type ? hslToRgb(hueOf(n.type), 0.5, 0.62) : [0.62, 0.6, 0.55]);
          colBuf[i * 3] = r; colBuf[i * 3 + 1] = g; colBuf[i * 3 + 2] = b;
        }
      };
      applyNodeColors();
      for (let i = 0; i < N; i++) sizeBuf[i] = rad(nodes[i]) * 2.4;
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
      scene.background = new THREE.Color(PAL.bg);
      const camera = new THREE.PerspectiveCamera(55, W / H, 1, 8000);
      camera.position.set(0, 0, SPREAD * 2.15);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      // ACES Filmic is calibrated for dusk's HDR-ish additive glow — applied to
      // paper's flat, normal-blended ink/cream palette it desaturates toward
      // grey (2026-07-12 owner report: labels/pills read as "grey, not paper").
      // Paper wants its hex colours literal, so it gets no tone-mapping curve
      // at all. Kept in sync with isPaper() in applyMode() for live toggling.
      renderer.toneMapping = isPaper() ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = isPaper() ? 1 : TUNE.exposure;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
      el.innerHTML = '';
      el.appendChild(renderer.domElement);

      const labelRenderer = new CSS2DRenderer();
      labelRenderer.setSize(W, H);
      labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none';
      el.appendChild(labelRenderer.domElement);

      // ── the point cloud (one draw call, additive glow, per-point size) ──
      let disc = makeStarTexture(THREE, TUNE.starSpike);
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
        uniforms: { uTex: { value: disc }, uScale: { value: H / 2 }, uPaper: { value: isPaper() ? 1 : 0 }, ...torchUniforms },
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
          'uniform sampler2D uTex; uniform float uPaper; varying float vAlpha; varying vec3 vColor;' +
          'void main(){ float m = texture2D(uTex, gl_PointCoord).a;' +
          // paper: ink stars, normal blending (colour + real alpha); dusk:
          // premultiplied additive glow (the original path, byte-identical).
          ' if (uPaper > 0.5) { gl_FragColor = vec4(vColor, min(vAlpha * m, 1.0)); }' +
          ' else { gl_FragColor = vec4(vColor * vAlpha * m, 1.0); } }',
        transparent: true,
        depthWrite: false,
        blending: isPaper() ? THREE.NormalBlending : THREE.CustomBlending,
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
      // Direction, source(0)→target(1) — the flow pulse (below) travels along
      // increasing t, so a fan edge visibly moves the way it actually points.
      const eflowBuf = new Float32Array(E * 2);
      const edgeRGB: Array<[number, number, number]> = links.map((l: any) => hexToRgb(edgeStyle(l).stroke));
      for (let i = 0; i < E; i++) {
        const l = links[i];
        const ai = idx.get(idOf(l.source)) ?? 0, bi = idx.get(idOf(l.target)) ?? 0;
        eposBuf[i * 6] = posBuf[ai * 3]; eposBuf[i * 6 + 1] = posBuf[ai * 3 + 1]; eposBuf[i * 6 + 2] = posBuf[ai * 3 + 2];
        eposBuf[i * 6 + 3] = posBuf[bi * 3]; eposBuf[i * 6 + 4] = posBuf[bi * 3 + 1]; eposBuf[i * 6 + 5] = posBuf[bi * 3 + 2];
        eflowBuf[i * 2] = 0; eflowBuf[i * 2 + 1] = 1;
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
        const paper = isPaper();
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
          if (paper) {
            // The buffer carries ALPHA for the paper shader (grayscale);
            // colour is the fixed edge ink there.
            r = al; g = al; b = al;
            al = 1;
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
      egeo.setAttribute('flow', new THREE.BufferAttribute(eflowBuf, 1));
      // A shader (not LineBasicMaterial) so edges get the SAME depth-fade as the
      // point cloud — otherwise they stay full-bright at every depth and flatten
      // the atmosphere. Per-vertex colour already carries the focus/selection
      // alpha (premultiplied); the shader multiplies in the distance falloff.
      const eMat = new THREE.ShaderMaterial({
        uniforms: {
          ...torchUniforms,
          uPaper: { value: isPaper() ? 1 : 0 },
          uInk: { value: new THREE.Vector3(0.353, 0.31, 0.228) },
          uTime: { value: 0 },
          uFlowSpeed: { value: TUNE.edgeFlowSpeed },
          uFlowWidth: { value: TUNE.edgeFlowWidth },
          uFlowGain: { value: TUNE.edgeFlowGain },
          uFlowCycles: { value: TUNE.edgeFlowCycles },
        },
        vertexShader:
          'attribute vec3 color; attribute float boost; attribute float flow; varying vec3 vColor; varying float vBoost; varying float vFlow;' +
          TORCH_GLSL +
          'void main(){ vColor = color * max(torch(position), boost); vBoost = boost; vFlow = flow; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; }',
        fragmentShader:
          'uniform float uPaper; uniform vec3 uInk; uniform float uTime; uniform float uFlowSpeed; uniform float uFlowWidth; uniform float uFlowGain; uniform float uFlowCycles;' +
          'varying vec3 vColor; varying float vBoost; varying float vFlow;' +
          // Flow: a soft travelling pulse along FOCUS edges only (vBoost>0 —
          // the ones already fanning from a selection/hit), source(flow=0)→
          // target(flow=1), so the animation reads as energy moving the way
          // the edge actually points. Dusk only — paper's printed-map
          // metaphor has no motion to carry (matches applyMode's own dusk/
          // paper split for everything else in this shader).
          'void main(){' +
          ' vec3 col = vColor;' +
          ' if (uPaper < 0.5 && vBoost > 0.5) {' +
          '   float p = fract(vFlow * uFlowCycles - uTime * uFlowSpeed);' +
          '   float pulse = smoothstep(0.0, uFlowWidth, p) * smoothstep(1.0, 1.0 - uFlowWidth, p);' +
          '   col += vColor * pulse * uFlowGain;' +
          ' }' +
          ' if (uPaper > 0.5) gl_FragColor = vec4(uInk, min(vColor.r * 2.5, 1.0));' +
          // paper: fixed ink colour, the buffer carries ALPHA (applyEdgeColor
          // writes grayscale there in paper mode), gained ×2.5 so hairlines
          // survive on the ground; dusk: premultiplied additive (original),
          // plus the flow pulse added above.
          ' else gl_FragColor = vec4(col, 1.0); }',
        transparent: true,
        depthWrite: false,
        blending: isPaper() ? THREE.NormalBlending : THREE.CustomBlending,
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
      // ── SDF labels (troika) — text lives IN the scene now: perspective does
      // the depth-honest sizing the CSS layer had to fake per frame, and the
      // glyphs pass through the same tone mapping + bloom as the geometry (a
      // selected label GLOWS with its node). Each label = a billboarded group:
      //   grp (node position, faces camera)
      //   ├─ leader (hairline back to the node when displaced)
      //   └─ inner (collision displacement, screen-px → world)
      //      ├─ pill (rounded dark quad — legibility over the additive cloud)
      //      └─ text (troika SDF, font by type group, outline halo)
      interface LabelState {
        grp: any; inner: any; text: any; pill: any; leader: any;
        cur: number; role: LabelRole; dying: boolean;
        /** Consecutive syncs this label has LOST its slot — stickiness: it
         *  only starts dying past a grace threshold, so admission churn at
         *  the beam edge / collision boundaries stops popping labels. */
        miss: number;
        /** Smoothed near-field compression (1 = depth-true). */
        scl: number;
        ox: number; oy: number; cox: number; coy: number; mult: number;
        fit: () => void;
      }
      const labelObjs = new Map<string, LabelState>();
      const roleMult = (role: LabelRole): number =>
        role === 'sel' ? TUNE.selSizeMult
        : role === 'hit' ? TUNE.hitSizeMult
        : role === 'nbr' ? TUNE.nbrSizeMult
        : role === 'anchor' ? TUNE.anchorSizeMult
        : TUNE.beamSizeMult;
      // World-unit font size ≙ the old screen-px formula (px = world·(H/2)/camD),
      // so the owner's size mults keep their meaning exactly.
      const fontWorld = (n: any, mult: number): number => rad(n) * 2.4 * 0.85 * mult;
      const pillGeo = new THREE.PlaneGeometry(1, 1);
      // Rounded-rect SDF pill — pure black (owner direction; pillAlpha is the
      // dial). Pills are REAL OCCLUDERS: they render FIRST (renderOrder −1)
      // and WRITE DEPTH, so the additive cloud's points and edges behind a
      // pill are culled by the depth test instead of shining through — while
      // anything NEARER than the pill still passes in front, and overlapping
      // labels resolve by true depth. Fully transparent fragments (rounded
      // corners, faded-out labels) discard, so an invisible pill never blocks.
      const mkPillMat = (): any =>
        new THREE.ShaderMaterial({
          uniforms: {
            uAlpha: { value: 0 },
            uSize: { value: new THREE.Vector2(1, 1) },
            // The TEXT box as a fraction of the (feather-padded) quad.
            uInner: { value: new THREE.Vector2(1, 1) },
            uFeather: { value: 0 },
            // Veil colour: black over the dusk field, paper over the chart.
            uCol: { value: new THREE.Vector3(PAL.pill[0], PAL.pill[1], PAL.pill[2]) },
          },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader:
            'uniform float uAlpha; uniform vec2 uSize; uniform vec2 uInner; uniform float uFeather; uniform vec3 uCol; varying vec2 vUv;' +
            'void main(){ vec2 p = (vUv - 0.5) * uSize;' +
            ' vec2 ib = uSize * 0.5 * uInner; float r = ib.y * 0.6;' +
            ' vec2 b = max(ib - vec2(r), vec2(0.0));' +
            ' float d = length(max(abs(p) - b, 0.0)) - r;' +
            // feather 0: crisp chip edge; feather 1: the darkening exhales
            // ~1.6 text-heights past the glyphs with no perceptible boundary.
            ' float soft = ib.y * (0.12 + 3.2 * uFeather);' +
            ' float a = uAlpha * (1.0 - smoothstep(-ib.y * 0.1, soft, d));' +
            ' if (a < 0.03) discard;' +
            ' gl_FragColor = vec4(uCol, a); }',
          transparent: true,
          depthWrite: true,
        });
      /** Size a pill quad around its text's layout bounds, leaving room for
       *  the feather to breathe (shared by labels and captions). */
      const fitPillTo = (text: any, pill: any, centerY: number): void => {
        const b = text.textRenderInfo?.blockBounds;
        if (!b) return;
        const h = b[3] - b[1];
        const tw = (b[2] - b[0]) + h;   // ~0.5em side padding
        const th = h * 1.55;            // vertical padding
        const grow = 1 + 2.4 * TUNE.pillFeather; // feather headroom
        const qw = tw * ((tw < th * 2 ? grow : 1 + (grow - 1) * 0.6)); // long strips grow less in x
        const qh = th * grow;
        pill.scale.set(qw, qh, 1);
        pill.material.uniforms.uSize.value.set(qw, qh);
        pill.material.uniforms.uInner.value.set(tw / qw, th / qh);
        pill.material.uniforms.uFeather.value = TUNE.pillFeather;
        pill.position.set((b[0] + b[2]) / 2, centerY + (b[1] + b[3]) / 2, -1.5);
        pill.visible = true;
      };
      const makeLabel = (n: any, role: LabelRole): LabelState => {
        const grp = new THREE.Group();
        grp.position.set(n.x, n.y, n.z);
        const inner = new THREE.Group();
        grp.add(inner);
        const text = new TroikaText();
        text.text = n.label;
        text.font = FONT_BY_GROUP[typeGroup(n.type)] ?? FONT_BY_GROUP.mono;
        text.fontSize = fontWorld(n, roleMult(role));
        text.anchorX = 'center';
        text.anchorY = 'top';
        // Long titles WRAP into centred lines (~18 chars/line) instead of
        // running off as one strip — maxWidth tracks fontSize (applyFont).
        text.maxWidth = text.fontSize * 10;
        text.lineHeight = 1.15;
        text.textAlign = 'center';
        text.position.y = -rad(n) * 1.15; // hang below the dot
        text.color = PAL.text;
        text.outlineColor = PAL.outline;
        text.outlineWidth = `${Math.round(TUNE.labelOutline * 100)}%`;
        text.fillOpacity = 0;
        text.outlineOpacity = 0;
        text.renderOrder = 9;
        const pill = new THREE.Mesh(pillGeo, mkPillMat());
        pill.visible = false;
        pill.renderOrder = -1; // depth-writing occluder — draws before the cloud
        inner.add(pill);
        inner.add(text);
        const leader = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineBasicMaterial({ color: 0x59503f, transparent: true, opacity: 0 }),
        );
        leader.renderOrder = 7;
        leader.visible = false;
        grp.add(leader);
        const st: LabelState = {
          grp, inner, text, pill, leader,
          cur: 0, role, dying: false, miss: 0, scl: 1, ox: 0, oy: 0, cox: 0, coy: 0, mult: roleMult(role),
          fit: () => fitPillTo(text, pill, text.position.y),
        };
        text.sync(st.fit);
        scene.add(grp);
        return st;
      };
      /** Reconcile membership: departures FADE (dying → removed at ~0), not
       *  pop — and only after a GRACE of consecutive losses (stickiness): a
       *  label that loses one sync's collision contest or slips just past the
       *  beam edge keeps its place instead of flickering. */
      const LABEL_GRACE = 8; // syncs ≈ 0.7s at the 5-frame sync cadence
      const reconcileLabels = (want: Map<string, LabelWant>): void => {
        for (const [id, st] of labelObjs) {
          const w = want.get(id);
          if (w) {
            st.role = w.role;
            st.ox = w.ox ?? 0;
            st.oy = w.oy ?? 0;
            st.dying = false;
            st.miss = 0;
            // A role change can change the SIZE tier — troika relayouts async,
            // so only touch fontSize when it actually moved (sync is not free).
            const m = roleMult(w.role);
            if (m !== st.mult) {
              st.mult = m;
              const n = nodeById.get(id);
              if (n) {
                st.text.fontSize = fontWorld(n, m);
                st.text.maxWidth = st.text.fontSize * 10;
                st.text.sync(st.fit);
              }
            }
          } else if (++st.miss > LABEL_GRACE) st.dying = true;
        }
        for (const [id, w] of want) {
          if (labelObjs.has(id)) continue;
          const n = nodeById.get(id);
          if (!n) continue;
          const st = makeLabel(n, w.role);
          st.ox = w.ox ?? 0;
          st.oy = w.oy ?? 0;
          labelObjs.set(id, st);
        }
      };

      // ── bloom (desktop only — fill-rate heavy on phones) ──
      const bigScreen = Math.min(W, H) >= 620 && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      let composer: any = null;
      let bloomPass: any = null;
      // Bloom is a TOGGLE now (tuner: auto/on/off — 'on' lets a phone try it),
      // so the composer builds lazily the first frame it's wanted and the tick
      // simply routes around it when it isn't.
      // Paper mode never blooms — ink doesn't glow.
      const useBloom = (): boolean => !isPaper() && (TUNE.bloomMode === 'on' || (TUNE.bloomMode === 'auto' && bigScreen));
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
      // A tap over a label's projected rect selects that node — SDF labels are
      // scene objects, so the rect is reconstructed from troika's OWN layout
      // bounds (blockBounds), padded a little for fingers (host is fixed
      // inset:0, so client px == canvas px).
      const labelAt = (cx: number, cy: number): string | null => {
        for (const [id, st] of labelObjs) {
          if (st.cur < 0.25) continue; // a barely-there label shouldn't catch taps
          const n = nodeById.get(id);
          if (!n) continue;
          const camD = camPos.distanceTo(st.grp.position) || 1;
          // Screen px per world unit at this depth × the near-field compression.
          const pxPer = ((H / 2) / camD) * (st.scl || 1);
          const b = st.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          const fs = st.text.fontSize * pxPer;
          const [sx, sy] = screenXY(n);
          const cxc = sx + st.cox; // label centre column (with displacement)
          if (b) {
            // Block bounds are text-local (anchor top-centre at y=0), hung at
            // text.position.y below the node; world +y is screen −y. Pad the
            // rect to a finger-sized minimum (44×28) — small deep labels are
            // legitimate tap targets too.
            let top = sy + st.coy - (st.text.position.y + b[3]) * pxPer;
            let bot = sy + st.coy - (st.text.position.y + b[1]) * pxPer;
            const vPad = Math.max(4, (28 - (bot - top)) / 2);
            top -= vPad; bot += vPad;
            const w = Math.max(44, (b[2] - b[0]) * pxPer + 10);
            if (cx >= cxc - w / 2 && cx <= cxc + w / 2 && cy >= top && cy <= bot) return id;
          } else {
            const w = Math.max(44, String(n.label).length * fs * 0.62);
            const ly = sy + st.coy + rad(n) * 1.15 * pxPer;
            if (cx >= cxc - w / 2 && cx <= cxc + w / 2 && cy >= ly - 3 && cy <= ly + fs * 1.6) return id;
          }
        }
        return null;
      };
      // A finger tap wobbles 8–12px on a phone — the old 6px "it's a drag"
      // threshold was eating most label taps on touch (they registered as
      // micro-orbits, so nothing ever selected).
      let dragThreshold = 6;
      const onDown = (e: PointerEvent): void => {
        downX = e.clientX; downY = e.clientY; moved = false;
        dragThreshold = e.pointerType === 'touch' ? 14 : 6;
      };
      const onMove = (e: PointerEvent): void => { if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > dragThreshold) moved = true; };
      const onUp = (e: PointerEvent): void => {
        if (moved) return;
        const lid = labelAt(e.clientX, e.clientY);
        if (lid) { api.current?.select(lid, true); return; }
        const n = pickAt(e.clientX, e.clientY);
        if (n) { api.current?.select(n.id); return; }
        // A caption is a DOOR: an AUTHORED place selects its container fact
        // (context panel: members as neighbours, open ↗ to the board/doc);
        // a computed place just flies to frame its region.
        const c = constellationAt(e.clientX, e.clientY);
        if (c) {
          if (c.key && nodeById.has(c.key)) api.current?.select(c.key, true);
          else frame(c.x, c.y, c.z, c.r * 1.5);
          return;
        }
        api.current?.select(null);
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
          div.style.cssText = `font:500 8.5px ui-monospace,monospace;color:${PAL.rel};white-space:nowrap;pointer-events:none;user-select:none;opacity:0.85`;
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
      interface Constellation { name: string; x: number; y: number; z: number; r: number; authored: boolean; key?: string; grp: any; text: any; pill: any; fs: number; cur: number }
      const constellations: Constellation[] = [];
      const addConstellation = (name: string, cx: number, cy: number, cz: number, cr: number, authored: boolean, key?: string): void => {
        // One caption per name — a view and its placement container (inView
        // edges) are the same place arriving by two routes.
        if (constellations.some((c) => c.name === name)) return;
        // Captions live IN the scene too (owner: pills + occlusion for these
        // as well): billboarded troika text over the same depth-writing pill
        // the labels use. World font size is REGION-proportional — perspective
        // then makes big places read big.
        const grp = new THREE.Group();
        grp.position.set(cx, cy, cz);
        const text = new TroikaText();
        text.text = name.toUpperCase();
        text.font = FONT_BY_GROUP.kb; // the serif face
        text.fontSize = cr * 0.055;
        text.letterSpacing = 0.18;
        text.anchorX = 'center';
        text.anchorY = 'middle';
        // Authored places carry a whisper of the accent — a view is intent.
        text.color = authored ? PAL.capAuth : PAL.capComp;
        text.outlineColor = PAL.outline;
        text.outlineWidth = '4%';
        text.fillOpacity = 0;
        text.outlineOpacity = 0;
        text.renderOrder = 9;
        const pill = new THREE.Mesh(pillGeo, mkPillMat());
        pill.visible = false;
        pill.renderOrder = -1;
        grp.add(pill);
        grp.add(text);
        const st: Constellation = { name, x: cx, y: cy, z: cz, r: cr, authored, key, grp, text, pill, fs: cr * 0.055, cur: 0 };
        text.sync(() => fitPillTo(text, pill, 0));
        scene.add(grp);
        constellations.push(st);
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
      // Authored pass, part 1 — MEMBERSHIP CONTAINERS. Boards, docs, and
      // spatial views already name their members through placement edges
      // (onBoard/inDoc/inView — ADR-0046/0054), and ADR-0057 frames all of
      // these plus views as ONE collections family. So every container fact
      // that enough slice members point at IS an authored place — no new
      // grouping machinery, just the read side of the family.
      {
        const memberOf = new Map<string, any[]>();
        for (const l of links) {
          if (!MEMBER_RELS.has(l.rel)) continue;
          const m = nodeById.get(idOf(l.source));
          const c = nodeById.get(idOf(l.target));
          if (!m || !c) continue;
          const arr = memberOf.get(c.id) ?? [];
          arr.push(m);
          memberOf.set(c.id, arr);
        }
        for (const [cid, members] of memberOf) {
          if (members.length < 4) continue; // a place needs a population
          const c = nodeById.get(cid);
          const rawName = String(c?.label ?? cid);
          if (!placeworthy(rawName)) continue;
          const cx = members.reduce((s: number, m: any) => s + m.x, 0) / members.length;
          const cy = members.reduce((s: number, m: any) => s + m.y, 0) / members.length;
          const cz = members.reduce((s: number, m: any) => s + m.z, 0) / members.length;
          const dists = members.map((m: any) => Math.hypot(m.x - cx, m.y - cy, m.z - cz)).sort((a: number, b: number) => a - b);
          const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
          // Containers carry their fact key: the caption becomes a live door
          // to the place itself (tap = SELECT the board/doc, not just fly).
          addConstellation(rawName.length > 24 ? rawName.slice(0, 23) + '…' : rawName, cx, cy, cz, cr, true, cid);
        }
      }
      // Authored pass, part 2 (async garnish — the scene never waits on it):
      // evaluate registered views, centroid their members present in this
      // slice. A view evaluation costs SECONDS on the gateway, so results are
      // cached (localStorage, 6h) — the sequential version kept the network
      // busy for ~25s per load — and the live pass runs the evals in parallel.
      void (async () => {
        const VC_KEY = 'parc.home.viewplaces';
        try {
          const cached = JSON.parse(localStorage.getItem(VC_KEY) ?? 'null') as { at: number; places: Array<{ name: string; x: number; y: number; z: number; r: number }> } | null;
          if (cached && Date.now() - cached.at < 6 * 3600_000) {
            for (const p of cached.places) addConstellation(p.name, p.x, p.y, p.z, p.r, true);
            return;
          }
        } catch { /* recompute */ }
        try {
          const decl = await mcpCall('read', 'workspace.declarations', { kind: 'view' }).catch(() => null);
          const dv = (decl && decl.ok ? decl.value : null) as any;
          const defs: any[] = Array.isArray(dv) ? dv : (dv?.declarations ?? dv?.views ?? dv?.entries ?? []);
          const ids = defs.map((d: any) => (typeof d === 'string' ? d : (d?.id ?? d?.name))).filter(Boolean).slice(0, 6);
          const places: Array<{ name: string; x: number; y: number; z: number; r: number }> = [];
          await Promise.all(ids.map(async (id) => {
            const r = await mcpCall('read', 'workspace.view', { id }).catch(() => null);
            if (disposed || !r || !r.ok) return;
            const keys = keysOfResult(r.value).filter((k) => nodeById.has(k));
            if (keys.length < 3) return;
            const pts = keys.map((k) => nodeById.get(k));
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
            const dists = pts.map((p) => Math.hypot(p.x - cx, p.y - cy, p.z - cz)).sort((a, b) => a - b);
            const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
            const vname = String(id);
            places.push({ name: vname.length > 24 ? vname.slice(0, 23) + '…' : vname, x: cx, y: cy, z: cz, r: cr });
          }));
          if (disposed) return;
          for (const p of places) addConstellation(p.name, p.x, p.y, p.z, p.r, true);
          try { localStorage.setItem(VC_KEY, JSON.stringify({ at: Date.now(), places })); } catch { /* */ }
        } catch { /* views are optional */ }
      })();
      const constV = new THREE.Vector3();
      // Tap target: a visible caption's projected rect (troika's real layout
      // bounds, finger-padded).
      const constellationAt = (cx: number, cy: number): Constellation | null => {
        for (const c of constellations) {
          if (c.cur < 0.15) continue;
          const camD = camPos.distanceTo(constV.set(c.x, c.y, c.z)) || 1;
          constV.set(c.x, c.y, c.z).project(camera);
          if (constV.z > 1) continue;
          const sx = ((constV.x + 1) / 2) * W, sy = ((1 - constV.y) / 2) * H;
          const pxPer = ((H / 2) / camD) * (c.grp.scale?.x || 1);
          const b = c.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          const w = Math.max(44, (b ? (b[2] - b[0]) * pxPer : c.name.length * c.fs * 0.85 * pxPer) + 10);
          const h = Math.max(28, (b ? (b[3] - b[1]) * pxPer : c.fs * 1.4 * pxPer) + 10);
          if (Math.abs(cx - sx) < w / 2 && Math.abs(cy - sy) < h / 2) return c;
        }
        return null;
      };
      // Display order: authored places (views, boards, docs) OUTRANK computed
      // ones for the caption budget — a human named those.
      const constOrdered = (): Constellation[] =>
        [...constellations].sort((a, b) => (b.authored ? 1 : 0) - (a.authored ? 1 : 0));
      const updateConstellations = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade * 0.5); // captions ease slower than labels
        const focusActive = !!(selKey || hiSet);
        // ONE budget for all captions, tighter on a phone (the container pass
        // pushed mobile past ten captions — a pile, not a map).
        const capTotal = Math.min(W, H) < 700 ? Math.min(TUNE.constCap, 5) : TUNE.constCap;
        let shown = 0;
        // Captions declutter against EACH OTHER in screen space (authored
        // first) — the first render piled three names on the dense core. A
        // losing caption fades, it doesn't pop.
        const placedCaps: Array<[number, number, number]> = [];
        for (const c of constOrdered()) {
          let target = 0;
          if (shown < capTotal) {
            const camD = camPos.distanceTo(constV.set(c.x, c.y, c.z));
            // Approach fade: a caption reads from OUTSIDE its region and
            // yields to fact labels once the camera is inside it.
            target = TUNE.constOpacity * smoothstep(c.r * TUNE.constNear, c.r * TUNE.constFar, camD);
            if (focusActive) target *= 0.3; // atmosphere under focus
            if (target > 0.02) {
              // World-proportional caption (fs = f(region radius)) — the
              // declutter box uses its actual projected size.
              const fontPx = c.fs * (H / 2) / Math.max(camD, 1);
              constV.set(c.x, c.y, c.z).project(camera);
              if (constV.z > 1) target = 0;
              else {
                const sx = ((constV.x + 1) / 2) * W, sy = ((1 - constV.y) / 2) * H;
                const w = c.name.length * fontPx * 0.85; // caps + tracking
                if (placedCaps.some(([px2, py2, pw2]) => Math.abs(px2 - sx) < (pw2 + w) / 2 && Math.abs(py2 - sy) < fontPx * 2.2)) target = 0;
                else {
                  placedCaps.push([sx, sy, w]);
                  shown++;
                }
              }
            }
          }
          c.cur += (target - c.cur) * k;
          c.grp.quaternion.copy(camera.quaternion); // billboard
          // Captions take the same near-field ceiling (a bit more headroom).
          if (TUNE.labelMaxPx > 0) {
            const camD2 = camPos.distanceTo(constV.set(c.x, c.y, c.z)) || 1;
            const px = c.fs * (H / 2) / camD2;
            const capPx = TUNE.labelMaxPx * 1.2;
            c.grp.scale.setScalar(px > capPx ? capPx / px : 1);
          } else c.grp.scale.setScalar(1);
          c.text.fillOpacity = c.cur;
          c.text.outlineOpacity = c.cur;
          c.pill.material.uniforms.uAlpha.value = TUNE.pillAlpha * c.cur;
          const cOccl = TUNE.pillAlpha > 0.95;
          c.pill.renderOrder = cOccl ? -1 : 8;
          c.pill.material.depthWrite = cOccl;
        }
      };
      // Breadcrumb — "where am I": selecting a fact names its neighbourhood in
      // a transient caption at the top of the scene, then gets out of the way.
      const crumb = document.createElement('div');
      crumb.style.cssText = `position:absolute;top:calc(env(safe-area-inset-top, 0px) + 10px);left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;font-family:${TYPE_SERIF};font-size:11px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:${PAL.capComp};opacity:0;transition:opacity 0.7s;${LABEL_HALO}`;
      el.appendChild(crumb);

      // ── scene-mode switch: restyle the LIVE scene (no rebuild). Dusk is
      // the luminous field; paper is the same map printed as a star atlas —
      // ink on warm ground, normal blending, no bloom. ──
      const applyMode = (): void => {
        PAL = paletteFor(TUNE.sceneMode);
        const paper = isPaper();
        // See the construction-time comment above: paper's flat colours want
        // no filmic curve, or they desaturate toward grey.
        renderer.toneMapping = paper ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = paper ? 1 : TUNE.exposure;
        scene.background = new THREE.Color(PAL.bg);
        ptMat.uniforms.uPaper.value = paper ? 1 : 0;
        ptMat.blending = paper ? THREE.NormalBlending : THREE.CustomBlending;
        eMat.uniforms.uPaper.value = paper ? 1 : 0;
        eMat.blending = paper ? THREE.NormalBlending : THREE.CustomBlending;
        applyNodeColors();
        (geo.attributes.color as any).needsUpdate = true;
        applyEdgeColor();
        ringMat.color = new THREE.Color(PAL.accent);
        for (const [, st] of labelObjs) {
          st.text.outlineColor = PAL.outline;
          st.pill.material.uniforms.uCol.value.set(PAL.pill[0], PAL.pill[1], PAL.pill[2]);
        }
        for (const c of constellations) {
          c.text.color = c.authored ? PAL.capAuth : PAL.capComp;
          c.text.outlineColor = PAL.outline;
          c.pill.material.uniforms.uCol.value.set(PAL.pill[0], PAL.pill[1], PAL.pill[2]);
        }
        for (const [, o] of edgeLabelObjs) (o.element as HTMLElement).style.color = PAL.rel;
        crumb.style.color = PAL.capComp;
        // The DOM crumb's baked-in dusk halo is a black smudge on paper.
        crumb.style.textShadow = paper ? 'none' : '0 1px 3px #000,0 -1px 3px #000,1px 0 3px #000,-1px 0 3px #000,0 0 2px #000';
      };
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
        const placed: Array<[number, number, number, number]> = [];
        const pxOf = (n: any): number => {
          const camD = camPos.distanceTo(distV.set(n.x, n.y, n.z)) || 1;
          return rad(n) * 2.4 * (H / 2) / camD;
        };
        const boxOf = (n: any): number => Math.max(36, pxOf(n) * 7);
        // Wrapped labels are TALL — collision clearance is a box, not a row.
        const hOf = (n: any): number => {
          const fs = pxOf(n) * 0.85;
          const lines = Math.max(1, Math.ceil(String(n.label).length / 18));
          return Math.max(14, fs * 1.25 * lines);
        };
        const collides = (sx: number, sy: number, w: number, h: number): boolean =>
          placed.some(([px, py, pw, ph]) => Math.abs(px - sx) < (pw + w) / 2 && Math.abs(py - sy) < (ph + h) / 2);
        const focusActive = !!(selKey || hiSet);

        // FOCUS DECLARES: the anchor and every search hit label unconditionally
        // (they are the question being asked); neighbours pass legibility gates
        // (salience-first, readable, decluttered, capped).
        if (selKey) {
          const n = nodeById.get(selKey);
          if (n && isVis(n)) {
            want.set(selKey, { role: 'sel' });
            const [sx, sy] = screenXY(n);
            placed.push([sx, sy, boxOf(n), hOf(n)]);
          }
        }
        if (hiSet) {
          for (const id of hiSet) {
            if (want.has(id)) continue;
            const n = nodeById.get(id);
            if (n && isVis(n)) {
              want.set(id, { role: 'hit' });
              const [sx, sy] = screenXY(n);
              placed.push([sx, sy, boxOf(n), hOf(n)]);
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
            const h = hOf(n);
            // Offset STICKINESS: a label that already found a displaced home
            // tries its current offset first, so it doesn't wander between
            // free slots as the contest order shifts frame to frame.
            const prev = labelObjs.get(n.id);
            const tries: Array<[number, number]> = [[0, 0], [0, h + 4], [0, -(h + 10)], [w / 2 + 14, 0], [-(w / 2 + 14), 0]];
            if (prev && (prev.ox || prev.oy)) tries.unshift([prev.ox, prev.oy]);
            for (const [ox, oy] of tries) {
              if (collides(sx + ox, sy + oy, w, h)) continue;
              placed.push([sx + ox, sy + oy, w, h]);
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
          const tryAnchor = (n: any): void => {
            if (added >= TUNE.anchorCap || !n || !isVis(n) || want.has(n.id)) return;
            // Anchors are wayfinding text — a salient machine-run KEY is
            // honest data but useless as a resting place-hold; words only.
            if (!placeworthy(n.label)) return;
            const [sx, sy, sz] = screenXY(n);
            if (sz > 1 || sx < 0 || sx > W || sy < 0 || sy > H) return; // offscreen/behind
            const cell = Math.min(2, Math.floor((sy / H) * 3)) * 3 + Math.min(2, Math.floor((sx / W) * 3));
            if (takenCell.has(cell)) return;
            const w = boxOf(n);
            const h = hOf(n);
            if (collides(sx, sy, w, h)) return;
            takenCell.add(cell);
            placed.push([sx, sy, w, h]);
            want.set(n.id, { role: 'anchor' });
            added++;
          };
          // INCUMBENCY: a standing anchor keeps its post while it stays on
          // screen — the resting layer shouldn't reshuffle with every drift
          // of the camera. New posts fill whatever cells remain.
          for (const [id, st] of labelObjs) {
            if (st.role === 'anchor' && !st.dying) tryAnchor(nodeById.get(id));
          }
          for (const n of byRank) {
            if (added >= TUNE.anchorCap) break;
            tryAnchor(n);
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
          // Standing labels get an INCUMBENCY bonus in the contest for the cap,
          // so the set doesn't reshuffle when two candidates trade rank.
          if (t > TUNE.beamOn || (labelObjs.has(n.id) && t > TUNE.beamOff)) {
            lit.push([n.id, t + (labelObjs.get(n.id)?.role === 'beam' ? 0.2 : 0)]);
          }
        }
        lit.sort((a, b) => b[1] - a[1]);
        const inBeam = new Set<string>();
        let added = 0;
        for (const [id] of lit) {
          if (added >= beamCap) break;
          const n = nodeById.get(id);
          const [sx, sy] = screenXY(n);
          const w = boxOf(n);
          const h = hOf(n);
          if (collides(sx, sy, w, h)) continue;
          inBeam.add(id);
          const streak = (beamStreak.get(id) ?? 0) + 1;
          beamStreak.set(id, streak);
          if (streak < 2 && !labelObjs.has(id)) continue; // entry debounce
          placed.push([sx, sy, w, h]);
          want.set(id, { role: 'beam' });
          added++;
        }
        for (const id of [...beamStreak.keys()]) if (!inBeam.has(id)) beamStreak.delete(id);
        reconcileLabels(want);
      };
      // Label size is a WORLD quantity now (fontWorld) — perspective produces
      // the exact px = world·(H/2)/camD relation the CSS layer used to compute
      // per frame, so depth honesty is structural, not simulated. Roles keep
      // differentiating by multiplier, colour, and opacity.
      const updateLabels = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade); // ~150ms to settle — a fade, not a pop
        for (const [id, st] of labelObjs) {
          const n = nodeById.get(id);
          st.grp.quaternion.copy(camera.quaternion); // billboard
          const camD = camPos.distanceTo(st.grp.position) || 1;
          const nodePx = rad(n) * 2.4 * (H / 2) / camD; // node's on-screen diameter
          const torch = labelTorchAt(st.grp.position);
          let target: number;
          let color = PAL.text;
          const t = Math.max(0, Math.min(1, (nodePx - 6) / 22)); // 0 = far, 1 = near
          if (st.role === 'sel') {
            target = 1;
            color = PAL.accent;
          } else if (st.role === 'hit') {
            target = 1;
          } else if (st.role === 'nbr') {
            target = TUNE.nbrOpFar + (TUNE.nbrOpNear - TUNE.nbrOpFar) * t; // far neighbours recede
          } else if (st.role === 'anchor') {
            // Orientation anchors: quieter than a beam catch in colour but
            // steadier in presence — the resting wayfinding layer.
            target = TUNE.anchorOpacity;
            color = PAL.dim;
          } else {
            // The beam's GENTLE slope: opacity rises smoothly from ~0 at the
            // admission boundary to its ceiling as the beam centres a node —
            // no cliff where labels used to pop.
            target = TUNE.beamOpacity * smoothstep(TUNE.beamOff, 0.95, torch);
          }
          // Paper mode has no additive glow to carry a fractional alpha — the
          // SAME 0.57 ceiling that reads as a soft dusk glow reads as flat gray
          // ink on paper (2026-07-12 owner report: "muddy grey" labels, edges
          // already had this exact compensation via eMat's `min(x*2.5,1)` gain,
          // labels never did). Gains toward full ink as admission approaches
          // its own ceiling, instead of capping at a fraction of it.
          if (isPaper()) target = Math.min(target * 2.5, 1);
          if (st.dying) target = 0;
          st.cur += (target - st.cur) * k;
          if (st.dying && st.cur < 0.03) {
            scene.remove(st.grp);
            st.text.dispose?.();
            st.pill.material.dispose?.();
            labelObjs.delete(id);
            continue;
          }
          // Collision displacement (screen px → world at this depth) eases to
          // its target; the hairline leader spans node → displaced label.
          st.cox += (st.ox - st.cox) * k;
          st.coy += (st.oy - st.coy) * k;
          const pxW = camD / (H / 2); // world units per screen px at this depth
          const displaced = Math.abs(st.cox) + Math.abs(st.coy) > 1.5;
          st.inner.position.set(st.cox * pxW, -st.coy * pxW, 0);
          if (displaced) {
            st.leader.visible = true;
            const lp = st.leader.geometry.attributes.position;
            lp.setXYZ(0, 0, 0, 0);
            lp.setXYZ(1, st.cox * pxW, -st.coy * pxW - rad(n) * 0.6, 0);
            lp.needsUpdate = true;
            st.leader.material.opacity = 0.55 * st.cur;
          } else st.leader.visible = false;
          st.text.color = color;
          st.text.fillOpacity = st.cur;
          st.text.outlineOpacity = st.cur;
          // The pill rides the label's own opacity. Mode by strength:
          // translucent veil (drawn over the cloud, real gradient) below
          // ~0.95; hard depth-writing occluder at the top of the dial.
          st.pill.material.uniforms.uAlpha.value = TUNE.pillAlpha * st.cur;
          const occl = TUNE.pillAlpha > 0.95;
          st.pill.renderOrder = occl ? -1 : 8;
          st.pill.material.depthWrite = occl;
          // Near-field ceiling: compress (smoothly) once the projected size
          // exceeds the cap — sel/hit earn a third more headroom. Far labels
          // are untouched; depth-truth is only bounded at the near extreme.
          const fsPx = st.text.fontSize * (H / 2) / camD;
          const capPx = TUNE.labelMaxPx * (st.role === 'sel' || st.role === 'hit' ? 1.35 : 1);
          const sTarget = TUNE.labelMaxPx > 0 && fsPx > capPx ? capPx / fsPx : 1;
          st.scl += (sTarget - st.scl) * k;
          st.inner.scale.setScalar(st.scl);
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
        eMat.uniforms.uTime.value = clock.elapsedTime;
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
          let lastSpike = TUNE.starSpike;
          const refresh = (): void => {
            if (TUNE.starSpike !== lastSpike) {
              lastSpike = TUNE.starSpike;
              const t = makeStarTexture(THREE, TUNE.starSpike);
              disc.dispose?.();
              disc = t;
              ptMat.uniforms.uTex.value = t;
            }
            torchUniforms.uConeIn.value = TUNE.coneIn;
            torchUniforms.uConeOut.value = TUNE.coneOut;
            torchUniforms.uDepthIn.value = SPREAD * TUNE.depthIn;
            torchUniforms.uDepthOut.value = SPREAD * TUNE.depthOut;
            torchUniforms.uFloor.value = TUNE.torchFloor;
            torchUniforms.uSizeBoost.value = TUNE.boostSizeGain;
            eMat.uniforms.uFlowSpeed.value = TUNE.edgeFlowSpeed;
            eMat.uniforms.uFlowWidth.value = TUNE.edgeFlowWidth;
            eMat.uniforms.uFlowGain.value = TUNE.edgeFlowGain;
            eMat.uniforms.uFlowCycles.value = TUNE.edgeFlowCycles;
            if (useBloom()) ensureComposer();
            if (bloomPass) {
              bloomPass.strength = TUNE.bloomStrength;
              bloomPass.radius = TUNE.bloomRadius;
              bloomPass.threshold = TUNE.bloomThreshold;
            }
            // Paper stays untone-mapped regardless of the exposure knob — see
            // applyMode()'s comment. Every OTHER slider change routes through
            // this same refresh(), so it has to hold that line too, not just
            // the sceneMode toggle.
            renderer.toneMappingExposure = isPaper() ? 1 : TUNE.exposure;
            applyNodeAlpha();
            applyEdgeColor();
            // Re-grade the live SDF labels (size mults / outline are layout
            // properties, applied at assignment — a tuner change re-syncs).
            for (const [id, st] of labelObjs) {
              const n = nodeById.get(id);
              if (!n) continue;
              st.mult = roleMult(st.role);
              st.text.fontSize = fontWorld(n, st.mult);
              st.text.maxWidth = st.text.fontSize * 10;
              st.text.outlineWidth = `${Math.round(TUNE.labelOutline * 100)}%`;
              st.text.sync(st.fit);
            }
            // Captions refit too (pillFeather changes their quad padding).
            for (const c of constellations) c.text.sync(() => fitPillTo(c.text, c.pill, 0));
            persist();
          };
          const add = (folder: any, key: keyof typeof TUNE, min: number, max: number, step = 0.01): void => {
            folder.add(TUNE, key, min, max, step).onChange(refresh);
          };
          gui.add(TUNE, 'sceneMode', ['dusk', 'paper']).name('scene').onChange(() => { applyMode(); refresh(); });
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
          add(labelsF, 'pillAlpha', 0, 1, 0.01);
          add(labelsF, 'pillFeather', 0, 1, 0.01); // 0 = chip, 1 = soft knockout
          add(labelsF, 'labelOutline', 0, 0.35, 0.005);
          add(labelsF, 'labelMaxPx', 0, 80, 1); // 0 = uncapped (depth-true everywhere)
          const nodesF = gui.addFolder('nodes');
          add(nodesF, 'nodeDim', 0.2, 1.5);
          add(nodesF, 'nbrBoost', 0, 1);
          add(nodesF, 'boostSizeGain', 0, 1.5);
          add(nodesF, 'starSpike', 0, 1, 0.01); // 0 = soft disc, 1 = full diffraction star
          const edgesF = gui.addFolder('edges');
          add(edgesF, 'edgeSimilar', 0, 0.3, 0.005);
          add(edgesF, 'edgeMember', 0, 0.5, 0.005);
          add(edgesF, 'edgeDerived', 0, 0.5, 0.005);
          add(edgesF, 'edgeAuthored', 0, 1, 0.005);
          add(edgesF, 'focusEdgeAlpha', 0, 1);
          add(edgesF, 'atmosphereDim', 0, 1);
          add(edgesF, 'edgeFlowSpeed', 0, 2, 0.05); // cycles/sec along the edge
          add(edgesF, 'edgeFlowWidth', 0.05, 0.5, 0.01); // pulse width (0..1 of the edge)
          add(edgesF, 'edgeFlowGain', 0, 3, 0.05); // brightness added at the pulse's peak
          add(edgesF, 'edgeFlowCycles', 1, 8, 1); // pulses per edge, source→target
          // Ranges widened where the owner's grade railed the old stops
          // (constCap/anchorCap max, anchorSizeMult min, labelOutline max).
          const placesF = gui.addFolder('places');
          add(placesF, 'constCap', 0, 32, 1);
          add(placesF, 'constOpacity', 0, 1);
          add(placesF, 'constNear', 0.2, 2.5);
          add(placesF, 'constFar', 0.6, 5);
          add(placesF, 'anchorCap', 0, 32, 1);
          add(placesF, 'anchorOpacity', 0, 1);
          add(placesF, 'anchorSizeMult', 0.1, 1.5);
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
              if (k === 'sceneMode' && !['dusk', 'paper'].includes(v as string)) continue;
              (TUNE as any)[k] = v;
            }
            applyMode();
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
              applyMode();
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
        for (const [, st] of labelObjs) { st.text.dispose?.(); st.pill.material.dispose?.(); }
        pillGeo.dispose();
        for (const [, o] of edgeLabelObjs) o.element.remove?.();
        for (const c of constellations) { c.text.dispose?.(); c.pill.material.dispose?.(); }
        if (crumbTimer) clearTimeout(crumbTimer);
        crumb.remove();
        controls.dispose?.(); geo.dispose(); egeo.dispose(); ptMat.dispose(); eMat.dispose();
        disc.dispose?.(); ringTex.dispose?.(); ringMat.dispose(); composer?.dispose?.(); renderer.dispose();
      };
    }

    (async () => {
      const [THREE, addons] = await Promise.all([loadThree(), loadThreeAddons()]);
      if (disposed) return;
      // Fast first paint: mount with just page 1 of entries+edges (the fetch
      // functions already page-ahead in parallel for the REST, but the first
      // page alone is enough to put a usable, mostly-correct scene up fast —
      // rankBy:'salience' means it's already the most important facts).
      setLoadState('fast');
      const fastModel = await fetchGraphModel({ fastOnly: true });
      if (disposed) return;
      await mountScene(fastModel, THREE, addons);
      if (disposed) return;
      // Background: keep paging until the whole slice has landed, then
      // upgrade to the complete model — THREE/addons are already cached
      // module promises, so this second mount is cheap relative to the fetch.
      setLoadState('full');
      const fullModel = await fetchGraphModel();
      if (disposed) return;
      await mountScene(fullModel, THREE, addons);
      if (disposed) return;
      // The rebuild started a fresh api.current with fresh internal selection/
      // visibility state — reapply whatever the user set during the fast
      // phase's loading window instead of silently resetting it.
      if (selectedKeyRef.current) api.current?.select(selectedKeyRef.current, false);
      api.current?.setVisible(visibleRef.current);
      setLoadState('done');
    })().catch((err) => {
      (window.reportError ?? console.error)(err);
      // A rejected fetch/setup left the scene host empty — a blank page reads as
      // "broken", not "recoverable". Match the loadThree()/loadThreeAddons()
      // failure fallback above (line ~471) so any init failure degrades to a
      // legible message instead of silence.
      setLoadState('done');
      if (!disposed && el) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace;text-align:center;padding:2rem">graph failed to load — check the console, or reload</div>';
      }
    });

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

  return (
    <>
      {/* `host` is imperative-only territory below (innerHTML/appendChild
          straight to the DOM node for the three.js canvas + CSS2D labels) —
          React must never render children into it, or the two reconcilers
          fight over the same subtree. The loading pill lives in a SIBLING
          node instead, fully React-owned. */}
      <div ref={host} style={{ position: 'fixed', inset: 0, background: ink.sceneBg, overflow: 'hidden' }} />
      {loadState !== 'done' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed', left: 12, top: 'max(10px, env(safe-area-inset-top))', zIndex: 20,
            fontFamily: ink.mono, fontSize: '0.72rem', color: ink.text,
            background: 'rgba(24,21,17,0.78)', border: `1px solid ${ink.line}`,
            borderRadius: 999, backdropFilter: 'blur(4px)', minHeight: 40,
            display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.35rem 0.8rem',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%', background: ink.accent,
              animation: 'parc-pulse 1.1s ease-in-out infinite',
            }}
          />
          <span>{loadState === 'fast' ? 'loading graph…' : 'loading the rest of the slice…'}</span>
          <style>{'@keyframes parc-pulse{0%,100%{opacity:.3}50%{opacity:1}}'}</style>
        </div>
      )}
    </>
  );
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
