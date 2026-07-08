/**
 * FullGraph (ADR-0047, v4) — home's primary surface: the WHOLE substrate slice
 * as a full-viewport force graph. The graph IS the workspace; everything else
 * floats over it.
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
 * v4 (perf): the renderer is CANVAS, not SVG. At ~1.2k nodes / ~9k edges an SVG
 * DOM (a node per <circle>, a label per <g>, an edge per <line>) is the mobile
 * bottleneck — thousands of elements restyled every simulation tick. Canvas
 * draws the whole scene in one pass per animation frame, with viewport CULLING
 * (off-screen nodes/edges skipped) and zoom LEVEL-OF-DETAIL (the `similarTo`
 * constellation and edge `rel` labels only past a zoom threshold; off-band
 * labels only when zoomed in). Hit-testing is `sim.find` over a quadtree. No
 * fidelity is dropped — the same nodes and edges are drawn, just cheaply and
 * with detail on demand.
 *
 * Layout is SEMANTIC when a projection exists (ADR-0047 stage 2): `workspace.project`
 * writes `_home/embed2d` — each fact's 2D place in embedding meaning-space (PCA
 * over its Titan vector) — and the client places nodes there, the sim only
 * pulling each toward its coordinate (forceX/Y) while collide unstacks labels.
 * A fact's position is then its *meaning*, not an edge-force equilibrium, and the
 * sim barely runs. Absent (or if a projection covers <half the slice), it falls
 * back to the edge-driven force layout (charge/link/center).
 *
 * 3D explore mode: a toggle (top-right) swaps the 2D canvas for a raw three.js
 * scene where nodes sit at their full [x,y,z] semantic coordinate — the 3rd
 * principal axis, flattened away in the map, becomes depth you orbit. Rendered
 * as a luminous additive point cloud (one draw call) with additive backbone
 * edges (`similarTo` dropped — proximity already says it), UnrealBloom (desktop),
 * ACES tone mapping, focal depth-fade for atmosphere, a star-map camera
 * (camera-controls: dolly-to-cursor, fly-through, fitToSphere framing) with idle
 * auto-rotate, and CSS2D labels (focus band + selection, distance-faded).
 * The 2D map stays the default.
 *
 * Labels: EVERY node is labelled, centered BELOW the node over up to two wrapped
 * lines; the label block participates in the sim (a node's collide radius covers
 * the text below it, so labels don't stack). Selection PINS the node at viewport
 * center and pans the camera onto it, so the neighbours a selection pulls in
 * (one-hop expand) arrange around it and it stays centered.
 */
import * as React from 'react';
import { mcpCall } from './lib';
import { openFact, factTitle, type ListEntry } from './facts';

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
let d3Mod: Promise<any> | null = null;
const loadD3 = (): Promise<any> => (d3Mod ??= import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/d3@7/+esm').catch(() => null));

const hueOf = (t: string): number => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
};
const nodeColor = (t: string | null): string => (t ? `hsl(${hueOf(t)} 42% 55%)` : '#9a917f');

const MEMBER_RELS = new Set(['onBoard', 'inDoc', 'inView']);
// Warm-light strokes — a dark #5a5142 vanished into the dusk background.
interface EdgeStyle { stroke: string; dash: number[] | null; opacity: number; width: number }
function edgeStyle(e: GEdge): EdgeStyle {
  if (e.rel === 'similarTo') return { stroke: '#cfc4aa', dash: null, opacity: 0.12, width: 1 };
  if (MEMBER_RELS.has(e.rel)) return { stroke: '#cfc4aa', dash: [2, 3], opacity: 0.32, width: 1 };
  if (e.derived) return { stroke: '#cfc4aa', dash: [3, 3], opacity: 0.26, width: 1 };
  return { stroke: '#e8ddc2', dash: null, opacity: 0.55, width: 1.5 };
}

/**
 * Degree-of-Interest (Furnas) — ONE continuous [0,1] emphasis per node, the
 * unified "focus+context" signal that drives opacity, size, labels, and edge
 * brightness alike (so they can't disagree). It blends intrinsic salience with
 * graph-focus (the current selection/highlight neighbourhood). The renderers
 * layer their own SPATIAL focal falloff on top — the 3D shader by world distance
 * to the camera target; 2D is a flat map, so it has none. Selection lifts a
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

/** Wrap a title into up to two centered lines (~16 chars each) for the
 *  below-node label — breaking on a word boundary where possible, ellipsising
 *  the overflow. Labels always show now, so long titles must not run off. */
function wrapLabel(s: string): string[] {
  const MAX = 16;
  const t = s.trim();
  if (t.length <= MAX) return [t];
  let cut = t.lastIndexOf(' ', MAX);
  if (cut <= 0) cut = MAX; // no space to break on — hard-wrap
  const line1 = t.slice(0, cut).trim();
  let line2 = t.slice(cut).trim();
  if (line2.length > MAX) line2 = line2.slice(0, MAX - 1) + '…';
  return [line1, line2];
}

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

/** Errors thrown inside d3-dispatched handlers surface as a masked
 *  "Script error." on Safari (the dispatch frames are cross-origin CDN code).
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

/** Load the whole slice + projection into a render-ready model — shared by the
 *  2D canvas and 3D WebGL renderers so they agree on nodes, edges, the focus
 *  band, and the semantic coordinates. */
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
    lines: wrapLabel(factTitle(e)),
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

function Canvas2DGraph({ selectedKey, onSelect, visible }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void; visible: number }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // The imperative surface the effects below share (built once the sim mounts).
  const api = useRef<{ select: (key: string | null, pan?: boolean) => void; setVisible: (f: number) => void } | null>(null);
  const lastExternal = useRef<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let sim: any = null;
    let ro: ResizeObserver | null = null;
    let onResult: ((ev: Event) => void) | null = null;

    (async () => {
      // Load the WHOLE slice (card-shaped — titles + salience, not bodies) and
      // the whole Reference projection. `query` with no limit returns every
      // ranked fact; `graph {}` (no keys) returns every edge — the focus band is
      // lifted out of the full graph client-side. The viewer's `_config/salience`
      // gives the real focus threshold (default 0.5) so the band means *their*
      // focus tier.
      const [model, d3] = await Promise.all([fetchGraphModel(), loadD3()]);
      if (disposed) return;
      if (!d3) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">graph renderer unavailable (offline?)</div>';
        return;
      }
      // nodes/links are MUTABLE — selection pulls a node's off-band neighbourhood
      // into the live sim (ADR-0047's one-hop expand).
      const { nodes, links, nodeById, coordMap, focusKeys } = model;
      const linkIds = new Set<string>(links.map((l) => l.id));
      const expanded = new Set<string>();

      let W = el.clientWidth || window.innerWidth;
      let H = el.clientHeight || window.innerHeight;
      let dpr = window.devicePixelRatio || 1;

      // ── the canvas ──
      el.innerHTML = '';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
      el.appendChild(canvas);
      const ctx = canvas.getContext('2d')!;
      const sizeCanvas = (): void => {
        dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.round(W * dpr));
        canvas.height = Math.max(1, Math.round(H * dpr));
      };
      sizeCanvas();

      const canvasSel = d3.select(canvas);
      let curT: any = d3.zoomIdentity;

      const r = (d: any): number => 4 + d.score * 13 + Math.min(6, Math.sqrt(d.deg) * 1.4);
      const inFocus = (d: any): boolean => !!d && focusKeys.has(d.id);
      // Salience visibility: show the top `visCount` by rank (never fewer than the
      // focus band). Ghost/expand satellites always show. Set by the slider.
      const minVis = focusKeys.size;
      let visCount = nodes.length;
      const isVis = (d: any): boolean => !!d && (d.ghost || d.rank === undefined || d.rank < visCount);
      // Labels: centered below the node over up to two lines; the collision
      // footprint covers the text block below (height) and out to its half-width,
      // so the always-on labels don't stack.
      const labelW = (d: any): number => Math.max(...d.lines.map((l: string) => l.length)) * 6;
      const labelH = (d: any): number => d.lines.length * 11 + 4;
      const collideR = (d: any): number => Math.max(r(d) + labelH(d), labelW(d) / 2 + 2, r(d) + 6);
      const idOf = (x: any): string => (x && typeof x === 'object' ? x.id : x);

      // ── selection + highlight state ──
      let selKey: string | null = null;
      let nbrSet: Set<string> | null = null;
      let hiSet: Set<string> | null = null;
      // The node currently pinned at viewport center (the live selection). Only
      // one at a time; released when selection changes/clears or it's dragged.
      let pinned: any = null;
      const touchesSel = (l: any): boolean => !!selKey && (idOf(l.source) === selKey || idOf(l.target) === selKey);
      const neighborsOf = (key: string): Set<string> => {
        const out = new Set<string>();
        for (const l of links) {
          if (idOf(l.source) === key) out.add(idOf(l.target));
          else if (idOf(l.target) === key) out.add(idOf(l.source));
        }
        return out;
      };

      // ── per-element emphasis, all derived from ONE degree-of-interest ──
      // (2D is a flat map, so DOI is the whole story — no spatial focal term.)
      const doi = (n: any): number => nodeDOI(n, selKey, nbrSet, hiSet, nodes.length);
      const nodeAlpha = (n: any): number => 0.08 + 0.9 * doi(n); // faint floor keeps context visible
      const nodeRing = (n: any): { stroke: string; width: number } =>
        n.id === selKey ? { stroke: '#f5c453', width: 3 }
        : selKey && nbrSet?.has(n.id) ? { stroke: '#e8ddc2', width: 1.6 }
        : hiSet?.has(n.id) ? { stroke: '#f5c453', width: 2 }
        : { stroke: '#2e2a22', width: 1 };
      const edgeAlpha = (l: any): number => {
        // An edge is as interesting as its most-interesting endpoint.
        const d = Math.max(doi(l.source), doi(l.target));
        return Math.min(0.98, edgeStyle(l).opacity * (0.12 + 0.88 * d) + (touchesSel(l) ? 0.25 : 0));
      };
      const labelAlpha = (n: any): number => 0.12 + 0.88 * doi(n);
      // A label is worth drawing when it's in the focus band, when the camera is
      // zoomed in enough to read the periphery, or when it's part of the current
      // selection/highlight — LOD: at low zoom the off-band labels are illegible
      // mush anyway, so skipping them is cheaper AND clearer.
      const labelShown = (n: any): boolean =>
        inFocus(n) || curT.k >= 1.1 || n.id === selKey || !!nbrSet?.has(n.id) || !!hiSet?.has(n.id);

      // ── the draw loop (one pass per animation frame) ──
      let drawScheduled = false;
      function requestDraw(): void {
        if (drawScheduled || disposed) return;
        drawScheduled = true;
        requestAnimationFrame(() => {
          drawScheduled = false;
          draw();
        });
      }

      function draw(): void {
        if (disposed) return;
        // Base transform = DPR; world transform (pan/zoom) layered on top, so
        // everything below is authored in world coordinates.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.translate(curT.x, curT.y);
        ctx.scale(curT.k, curT.k);

        // Visible world rect (+margin for radius/label overflow) — the cull test.
        const M = 80 / curT.k;
        const [vx0, vy0] = curT.invert([0, 0]);
        const [vx1, vy1] = curT.invert([W, H]);
        const minX = vx0 - M, maxX = vx1 + M, minY = vy0 - M, maxY = vy1 + M;
        const visible = (n: any): boolean => n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY;

        const k = curT.k;
        const showConstellation = k >= 0.6; // the faint similarTo web is LOD-gated
        const showEdgeLabels = k >= 1.3;

        // ── edges ──
        ctx.lineCap = 'round';
        for (const l of links) {
          if (l.rel === 'similarTo' && !showConstellation) continue;
          const s = l.source, t = l.target;
          if (!s || !t || typeof s !== 'object') continue;
          if (!isVis(s) || !isVis(t)) continue; // salience slider
          // Segment-bbox vs viewport cull.
          if (Math.max(s.x, t.x) < minX || Math.min(s.x, t.x) > maxX || Math.max(s.y, t.y) < minY || Math.min(s.y, t.y) > maxY) continue;
          const st = edgeStyle(l);
          ctx.globalAlpha = edgeAlpha(l);
          ctx.strokeStyle = st.stroke;
          ctx.lineWidth = st.width + (touchesSel(l) ? 0.8 : 0);
          ctx.setLineDash(st.dash ?? []);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        // ── edge rel labels (LOD: zoomed in, or the selection's own edges) ──
        if (showEdgeLabels || selKey) {
          ctx.font = '7.5px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          for (const l of links) {
            if (l.rel === 'similarTo') continue;
            if (selKey ? !touchesSel(l) : !showEdgeLabels) continue;
            const s = l.source, t = l.target;
            if (!s || !t || typeof s !== 'object') continue;
            if (!isVis(s) || !isVis(t)) continue;
            const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2 - 2;
            if (mx < minX || mx > maxX || my < minY || my > maxY) continue;
            ctx.globalAlpha = selKey && touchesSel(l) ? 0.95 : 0.8;
            ctx.strokeStyle = '#241f18';
            ctx.lineWidth = 2.5 / k;
            ctx.strokeText(l.rel, mx, my);
            ctx.fillStyle = '#bfb49a';
            ctx.fillText(l.rel, mx, my);
          }
        }

        // ── nodes ──
        for (const n of nodes) {
          if (!visible(n) || !isVis(n)) continue;
          const rad = r(n);
          ctx.globalAlpha = nodeAlpha(n);
          ctx.fillStyle = nodeColor(n.type);
          ctx.beginPath();
          ctx.arc(n.x, n.y, rad, 0, Math.PI * 2);
          ctx.fill();
          const ring = nodeRing(n);
          ctx.lineWidth = ring.width;
          ctx.strokeStyle = ring.stroke;
          ctx.stroke();
        }

        // ── labels (centered below the node, up to two lines) ──
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        for (const n of nodes) {
          if (!visible(n) || !isVis(n) || !labelShown(n)) continue;
          const top = n.y + r(n) + 4;
          ctx.globalAlpha = labelAlpha(n);
          ctx.strokeStyle = '#241f18';
          ctx.lineWidth = 3;
          ctx.fillStyle = '#efe9dc';
          for (let i = 0; i < n.lines.length; i++) {
            const ly = top + i * 11;
            ctx.strokeText(n.lines[i], n.x, ly);
            ctx.fillText(n.lines[i], n.x, ly);
          }
        }
        ctx.globalAlpha = 1;
      }

      // ── hit-testing (screen → world → nearest node) ──
      const pickAt = (sx: number, sy: number): any => {
        const [wx, wy] = curT.invert([sx, sy]);
        return sim ? sim.find(wx, wy, 28 / curT.k) : undefined;
      };
      const pickEvent = (ev: any): any => {
        const [sx, sy] = d3.pointer(ev, canvas);
        return pickAt(sx, sy);
      };

      // ── zoom / pan (pan only on empty space; a node grabs the drag instead) ──
      const zoom = d3
        .zoom()
        .scaleExtent([0.15, 4])
        .filter((ev: any) => {
          if (ev.type === 'wheel') return true;
          if (ev.touches && ev.touches.length > 1) return true; // pinch always zooms
          if (ev.button) return false;
          return !pickEvent(ev); // empty space → pan; on a node → let drag win
        })
        .on('zoom', guard((ev: any) => {
          curT = ev.transform;
          requestDraw();
        }));
      canvasSel.call(zoom).on('dblclick.zoom', null); // double-tap opens a fact, not zoom

      // ── node drag ──
      // Subject = the node under the pointer. Position is taken from the RAW
      // pointer mapped through the current transform each move (not d3-drag's
      // event.x — that mixes the subject's world coords with screen deltas and
      // drifts under zoom).
      let dragMoved = false;
      const drag = d3
        .drag()
        .container(canvas)
        .subject((ev: any) => pickEvent(ev.sourceEvent ?? ev) ?? null)
        .on('start', guard((ev: any) => {
          dragMoved = false;
          sim.alphaTarget(0.25).restart();
          ev.subject.fx = ev.subject.x;
          ev.subject.fy = ev.subject.y;
        }))
        .on('drag', guard((ev: any) => {
          dragMoved = true;
          const [sx, sy] = d3.pointer(ev.sourceEvent, canvas);
          const [wx, wy] = curT.invert([sx, sy]);
          ev.subject.fx = wx;
          ev.subject.fy = wy;
          requestDraw();
        }))
        .on('end', guard((ev: any) => {
          sim.alphaTarget(0);
          if (dragMoved) {
            // A real reposition — release so it rejoins the layout.
            ev.subject.fx = null;
            ev.subject.fy = null;
          } else {
            // A tap, not a drag — select it (which re-pins + centers).
            api.current?.select(ev.subject.id);
          }
        }));
      canvasSel.call(drag);

      canvasSel.on('pointerdown', () => { dragMoved = false; });
      canvasSel.on('click', guard((ev: any) => {
        if (dragMoved) return; // the drag already handled a node tap
        if (!pickEvent(ev)) api.current?.select(null); // empty tap clears
      }));
      canvasSel.on('dblclick.open', guard((ev: any) => {
        const n = pickEvent(ev);
        if (n) openFact({ key: n.id } as ListEntry);
      }));
      // Native tooltip on hover (canvas can't carry per-node <title>).
      canvasSel.on('mousemove', guard((ev: any) => {
        const n = pickEvent(ev);
        canvas.title = n ? `${n.id}${n.type ? ` · ${n.type}` : ''}` : '';
      }));

      /** One-hop expand: pull the selected fact's off-band neighbours into the
       *  live sim as small "ghost" satellites, then stitch EVERY projection edge
       *  whose two ends are now both visible. Once per key; plumbing filtered. */
      async function expand(key: string): Promise<void> {
        if (expanded.has(key) || !nodeById.has(key)) return;
        expanded.add(key);
        const res = await mcpCall('read', 'workspace.neighbors', { key, shape: 'card' });
        if (disposed || !res.ok) return;
        const v = res.value as { outbound?: Array<{ to?: string; rel: string; derived?: boolean }>; inbound?: Array<{ from?: string; rel: string; derived?: boolean }>; entries?: Record<string, ListEntry> } | null;
        const anchor = nodeById.get(key);
        const far: string[] = [];
        for (const e of v?.outbound ?? []) if (e.to) far.push(e.to);
        for (const e of v?.inbound ?? []) if (e.from) far.push(e.from);
        const newKeys: string[] = [];
        let added = 0;
        for (const [i, k] of far.entries()) {
          if (added >= 8) break;
          if (nodeById.has(k)) continue;
          const entry = { ...(v?.entries?.[k] ?? {}), key: k } as ListEntry;
          if (isPlumbing(entry)) continue;
          const gx = (anchor?.x ?? W / 2) + Math.cos(i * 2.399) * 90;
          const gy = (anchor?.y ?? H / 2) + Math.sin(i * 2.399) * 90;
          const n = {
            id: k,
            type: entry._meta?.type ?? null,
            score: Number(entry._meta?.score) || 0.05,
            label: shortLabel(factTitle(entry)),
            lines: wrapLabel(factTitle(entry)),
            deg: 1,
            ghost: true,
            x: gx,
            y: gy,
            // A pulled-in neighbour has no semantic coord — anchor it (weakly) near
            // where it spawned so it doesn't yank to origin under the x/y forces.
            sx: gx - W / 2,
            sy: gy - H / 2,
            hasSem: false,
          };
          nodes.push(n as any);
          nodeById.set(k, n);
          newKeys.push(k);
          added++;
        }
        const stitch = (from: string | undefined, to: string | undefined, rel: string, derived?: boolean): void => {
          if (!from || !to || !nodeById.has(from) || !nodeById.has(to)) return;
          const id = `${from}|${rel}|${to}`;
          if (linkIds.has(id)) return;
          linkIds.add(id);
          links.push({ id, source: from, target: to, rel, derived });
        };
        for (const e of v?.outbound ?? []) stitch(key, e.to, e.rel, e.derived);
        for (const e of v?.inbound ?? []) stitch(e.from, key, e.rel, e.derived);
        if (newKeys.length) {
          const around = await mcpCall('read', 'workspace.graph', { keys: newKeys });
          if (disposed) return;
          if (around.ok) {
            for (const e of ((around.value as { edges?: GEdge[] })?.edges ?? []) as GEdge[]) stitch(e.from, e.to, e.rel, e.derived);
          }
        }
        sim.nodes(nodes);
        sim.force('link')?.links(links); // absent in semantic layout (no edge force)
        if (selKey) nbrSet = neighborsOf(selKey);
        sim.alpha(0.3).restart();
        setTimeout(() => sim?.stop(), 4000);
      }

      const panTo = (d: any): void => {
        canvasSel.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - curT.k * d.x, H / 2 - curT.k * d.y).scale(curT.k));
      };
      const fitTo = (keys: Set<string>): void => {
        const pts = nodes.filter((n: any) => keys.has(n.id));
        if (!pts.length) return;
        const xs = pts.map((p: any) => p.x), ys = pts.map((p: any) => p.y);
        const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
        const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
        const k = Math.min(3, 0.9 / Math.max((maxX - minX) / W, (maxY - minY) / H));
        canvasSel.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * (minX + maxX) / 2, H / 2 - k * (minY + maxY) / 2).scale(k));
      };
      api.current = {
        select: (key: string | null, _pan = false) => {
          lastExternal.current = key; // a tap-select's prop echo must not re-fire
          // Release the previous pin — only one node is held at center at a time.
          if (pinned && pinned.id !== key) {
            pinned.fx = null;
            pinned.fy = null;
            pinned = null;
          }
          selKey = key;
          nbrSet = key ? neighborsOf(key) : null;
          if (key) hiSet = null; // an explicit selection clears a result highlight
          const d = key ? nodes.find((n: any) => n.id === key) : null;
          if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) {
            // Keep the selection centered: pin it where it is and pan the camera
            // onto it, so the neighbours expand() pulls in arrange AROUND it and
            // it stays put instead of drifting with the layout.
            pinned = d;
            d.fx = d.x;
            d.fy = d.y;
            panTo(d);
          }
          requestDraw();
          if (key) void expand(key).catch((err) => (window.reportError ?? console.error)(err));
          selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : key ? { key, type: null, score: 0, label: key } : null);
        },
        setVisible: (f: number) => {
          visCount = f >= 0.999 ? nodes.length : Math.max(minVis, Math.round(nodes.length * f));
          requestDraw();
        },
      };

      // Console results (search / query / recall / neighbors) light up the graph
      // and the camera fits to them — the palette drives the territory.
      onResult = guard((ev: Event): void => {
        const detail = (ev as CustomEvent<{ ok: boolean; value: unknown }>).detail;
        if (!detail?.ok) return;
        const keys = keysOfResult(detail.value).filter((k) => nodeById.has(k));
        if (!keys.length) return;
        hiSet = new Set(keys);
        selKey = null;
        nbrSet = null;
        requestDraw();
        fitTo(hiSet);
      });
      window.addEventListener(CONSOLE_RESULT_EVENT, onResult);

      // Seed positions. In SEMANTIC mode each node carries `sx,sy` — a world
      // offset from center derived from its meaning-space coordinate — and starts
      // there; the sim then only pulls it back toward that anchor while collide
      // declutters overlapping labels. Nodes without a coordinate (or when there's
      // no layout) scatter and, in force mode, settle by the edge forces.
      const SPREAD = Math.min(W, H) * 0.42;
      let semCount = 0;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const c = coordMap?.[n.id];
        if (c) {
          n.sx = c[0] * SPREAD;
          n.sy = c[1] * SPREAD;
          n.hasSem = true;
          semCount++;
        } else {
          n.sx = Math.cos(i * 2.3999) * 40;
          n.sy = Math.sin(i * 2.3999) * 40;
          n.hasSem = false;
        }
        n.x = W / 2 + n.sx + ((i * 37) % 11) - 5;
        n.y = H / 2 + n.sy + ((i * 53) % 11) - 5;
      }
      // Use the semantic layout only when it actually covers the slice — a stale
      // or partial projection shouldn't strand half the graph at the origin.
      const semantic = semCount >= Math.max(3, nodes.length * 0.5);

      sim = semantic
        ? d3
            .forceSimulation(nodes)
            // strength-0 link force: it never pulls (semantic positions rule),
            // but its initialize() resolves each link's source/target from key
            // strings into node objects — without it the draw loop sees strings
            // and skips every edge.
            .force('link', d3.forceLink(links).id((d: any) => d.id).strength(0))
            .force('x', d3.forceX((d: any) => W / 2 + d.sx).strength((d: any) => (d.hasSem ? 0.7 : 0.08)))
            .force('y', d3.forceY((d: any) => H / 2 + d.sy).strength((d: any) => (d.hasSem ? 0.7 : 0.08)))
            .force('collide', d3.forceCollide(collideR))
            .force('charge', d3.forceManyBody().strength(-24)) // gentle — just unstacks, doesn't relayout
            .on('tick', requestDraw)
        : d3
            .forceSimulation(nodes)
            .force('link', d3.forceLink(links).id((d: any) => d.id).distance(74).strength(0.4))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(W / 2, H / 2))
            .force('collide', d3.forceCollide(collideR))
            .on('tick', requestDraw);
      requestDraw();
      setTimeout(() => sim?.stop(), 9000);

      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h || (w === W && h === H)) return;
        W = w;
        H = h;
        sizeCanvas();
        // Force layout re-centers explicitly; the semantic layout's forceX/Y
        // accessors already read the live W/H, so they re-center on their own.
        if (!semantic) sim?.force('center', d3.forceCenter(W / 2, H / 2));
        sim?.alpha(0.2).restart();
        requestDraw();
        setTimeout(() => sim?.stop(), 3000);
      });
      ro.observe(el);
    })().catch((err) => (window.reportError ?? console.error)(err));

    return () => {
      disposed = true;
      sim?.stop();
      ro?.disconnect();
      if (onResult) window.removeEventListener(CONSOLE_RESULT_EVENT, onResult);
      api.current = null;
      el.innerHTML = '';
    };
  }, []);

  // External selection (context-row neighbor chips, etc.): pan the camera there.
  useEffect(() => {
    if (selectedKey === lastExternal.current) return;
    lastExternal.current = selectedKey;
    api.current?.select(selectedKey, true);
  }, [selectedKey]);

  // Salience slider → cull below the corresponding rank.
  useEffect(() => { api.current?.setVisible(visible); }, [visible]);

  return (
    <div
      ref={host}
      style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, #3a3428 0%, #241f18 70%)', overflow: 'hidden' }}
    />
  );
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
        return nodeDOI(n, selKey, nbr, hiSet, N);
      };

      // ── renderer / scene / camera ──
      let W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#1b1710');
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
      geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizeBuf, 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(alphaBuf, 1));
      const applyNodeAlpha = (): void => {
        for (let i = 0; i < N; i++) alphaBuf[i] = nodeAlphaOf(i);
        (geo.attributes.alpha as any).needsUpdate = true;
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
          'attribute float size; attribute float alpha; attribute vec3 color;' +
          'varying float vAlpha; varying vec3 vColor; uniform float uScale;' +
          TORCH_GLSL +
          'void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float vd = -mv.z;' +
          'vAlpha = alpha * torch(position); gl_PointSize = size * (uScale / max(vd, 1.0));' +
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
      const ringMat = new THREE.SpriteMaterial({ map: ringTex, color: 0xf5c453, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
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
      const edgeBaseAlpha = (l: any): number => (MEMBER_RELS.has(l.rel) ? 0.3 : l.derived ? 0.26 : 0.5);
      const edgeAlphaOf = (l: any): number => {
        const sN = nodeById.get(idOf(l.source)), tN = nodeById.get(idOf(l.target));
        if (!isVis(sN) || !isVis(tN)) return 0; // salience slider
        // As interesting as its most-interesting endpoint (DOI); shader adds focal fade.
        const d = Math.max(nodeDOI(sN, selKey, nbr, hiSet, N), nodeDOI(tN, selKey, nbr, hiSet, N));
        return edgeBaseAlpha(l) * (0.1 + 0.9 * d);
      };
      const applyEdgeColor = (): void => {
        for (let i = 0; i < E; i++) {
          const [r, g, b] = edgeRGB[i], al = edgeAlphaOf(links[i]);
          ecolBuf[i * 6] = r * al; ecolBuf[i * 6 + 1] = g * al; ecolBuf[i * 6 + 2] = b * al;
          ecolBuf[i * 6 + 3] = r * al; ecolBuf[i * 6 + 4] = g * al; ecolBuf[i * 6 + 5] = b * al;
        }
        (egeo.attributes.color as any).needsUpdate = true;
      };
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.BufferAttribute(eposBuf, 3));
      egeo.setAttribute('color', new THREE.BufferAttribute(ecolBuf, 3));
      // A shader (not LineBasicMaterial) so edges get the SAME depth-fade as the
      // point cloud — otherwise they stay full-bright at every depth and flatten
      // the atmosphere. Per-vertex colour already carries the focus/selection
      // alpha (premultiplied); the shader multiplies in the distance falloff.
      const eMat = new THREE.ShaderMaterial({
        uniforms: { uFocus: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() } },
        vertexShader:
          'attribute vec3 color; varying vec3 vColor;' +
          TORCH_GLSL +
          'void main(){ vColor = color * torch(position); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; }',
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
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(W, H), 0.85, 0.6, 0.12)); // strength, radius, threshold
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
      const BEAM_ON = 0.62, BEAM_OFF = 0.38, LABEL_CAP = 28;
      const syncBeamLabels = (): void => {
        const keep = pinnedSet();
        const lit: Array<[string, number]> = [];
        for (const n of nodes) {
          if (!isVis(n) || keep.has(n.id)) continue;
          const t = torchNode(n);
          // Enter at BEAM_ON, stay until BEAM_OFF — hysteresis against edge flicker.
          if (t > BEAM_ON || (labelObjs.has(n.id) && t > BEAM_OFF)) lit.push([n.id, t]);
        }
        lit.sort((a, b) => b[1] - a[1]);
        let added = 0;
        for (const [id] of lit) { if (added >= LABEL_CAP) break; keep.add(id); added++; }
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
          obj.element.style.fontSize = Math.max(4.5, Math.min(10, nodePx * 0.85)).toFixed(1) + 'px';
          obj.element.style.paddingTop = (nodePx * 0.4 + 1).toFixed(1) + 'px'; // clear the dot
          // OPACITY is BEAM-primary: the torch decides how lit a label is, so a
          // sweep reveals whatever is near the line of sight — salient or not.
          // Selection/neighbours lift; salience adds only a whisper.
          const torch = torchAt(obj.position);
          let op = torch;
          if (id === selKey) op = 1;
          else if (nbr?.has(id)) op = Math.max(0.75, torch);
          else { const salN = 1 - (n?.rank ?? N) / Math.max(1, N); op = torch * (0.9 + 0.1 * salN); }
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

  return <div ref={host} style={{ position: 'fixed', inset: 0, background: '#1b1710', overflow: 'hidden' }} />;
}

export function FullGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  // Salience visibility: 0 → only the focus band, 1 → the whole slice. The
  // renderers cull nodes/edges above the corresponding salience rank.
  const [visible, setVisible] = useState(1);
  const pillBtn: React.CSSProperties = {
    padding: '0.3rem 0.6rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.72rem',
    color: '#efe9dc', background: 'rgba(36,31,24,0.72)', border: '1px solid #5a5142',
    borderRadius: 999, cursor: 'pointer', backdropFilter: 'blur(4px)',
  };
  return (
    <>
      {mode === '2d' ? (
        <Canvas2DGraph selectedKey={selectedKey} onSelect={onSelect} visible={visible} />
      ) : (
        <ThreeGraph selectedKey={selectedKey} onSelect={onSelect} visible={visible} />
      )}
      <button
        onClick={() => setMode((m) => (m === '2d' ? '3d' : '2d'))}
        title={mode === '2d' ? 'Explore in 3D' : 'Back to the 2D map'}
        style={{ position: 'fixed', right: 12, top: 48, zIndex: 20, ...pillBtn }}
      >
        {mode === '2d' ? '3D ◎' : '2D ▦'}
      </button>
      {/* Salience slider — dial from just the focus band to the whole slice. */}
      <div
        title="Show more or fewer facts, by salience"
        style={{
          position: 'fixed', right: 12, top: 84, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: '0.4rem',
          padding: '0.25rem 0.55rem', ...pillBtn, cursor: 'default',
        }}
      >
        <span aria-hidden style={{ opacity: 0.8 }}>◐</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={visible}
          onChange={(e) => setVisible(Number(e.target.value))}
          aria-label="Salience visibility"
          style={{ width: 96, accentColor: '#f5c453', cursor: 'pointer' }}
        />
        <span style={{ width: 30, textAlign: 'right', opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
          {visible >= 0.999 ? 'all' : `${Math.round(visible * 100)}%`}
        </span>
      </div>
    </>
  );
}
