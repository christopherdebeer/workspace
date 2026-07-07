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
 * 3D explore mode: a toggle (top-right) swaps the 2D canvas for a WebGL scene
 * (three.js via 3d-force-graph) where nodes sit at their full [x,y,z] semantic
 * coordinate — the 3rd principal axis, flattened away in the map, becomes depth
 * you orbit. Same model, focus band, and selection; labels move to hover/tap
 * (always-on 3D text is unreadable). The 2D map stays the default.
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
  const tierCount = nodes.filter((n) => n.score >= focusThreshold).length;
  const bandN = Math.min(nodes.length, Math.max(tierCount, Math.ceil(nodes.length * 0.12), 12));
  const focusKeys = new Set<string>(byScore.slice(0, bandN).map((n) => n.id));
  const links: any[] = edges.map((e) => ({ id: `${e.from}|${e.rel}|${e.to}`, source: e.from, target: e.to, rel: e.rel, derived: e.derived }));
  const nodeById = new Map<string, any>(nodes.map((n) => [n.id, n]));
  return { nodes, links, nodeById, coordMap, focusKeys };
}

function Canvas2DGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  // The imperative surface the effects below share (built once the sim mounts).
  const api = useRef<{ select: (key: string | null, pan?: boolean) => void } | null>(null);
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

      // ── per-element style (state-dependent alpha), the old paint() as pure fns ──
      const nodeAlpha = (n: any): number => {
        if (selKey) return n.id === selKey || nbrSet?.has(n.id) ? 0.95 : 0.2;
        if (hiSet) return hiSet.has(n.id) ? 0.85 : 0.25;
        return inFocus(n) ? 0.9 : 0.22;
      };
      const nodeRing = (n: any): { stroke: string; width: number } =>
        n.id === selKey ? { stroke: '#f5c453', width: 3 }
        : selKey && nbrSet?.has(n.id) ? { stroke: '#e8ddc2', width: 1.6 }
        : hiSet?.has(n.id) ? { stroke: '#f5c453', width: 2 }
        : { stroke: '#2e2a22', width: 1 };
      const edgeAlpha = (l: any): number => {
        const base = edgeStyle(l).opacity;
        if (selKey) return touchesSel(l) ? Math.min(0.95, base + 0.5) : base * 0.12;
        if (hiSet) return hiSet.has(idOf(l.source)) || hiSet.has(idOf(l.target)) ? base : base * 0.25;
        return inFocus(l.source) || inFocus(l.target) ? base : base * 0.22;
      };
      const labelAlpha = (n: any): number => {
        if (selKey) return n.id === selKey || nbrSet?.has(n.id) ? 0.98 : 0.28;
        if (hiSet) return hiSet.has(n.id) ? 0.9 : 0.32;
        return inFocus(n) ? 0.92 : 0.4;
      };
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
          if (!visible(n)) continue;
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
          if (!visible(n) || !labelShown(n)) continue;
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

  return (
    <div
      ref={host}
      style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, #3a3428 0%, #241f18 70%)', overflow: 'hidden' }}
    />
  );
}

/* ── 3D explore mode (WebGL, three.js via 3d-force-graph) ────────────────────
 * The same slice + semantic projection, but nodes are placed at their [x,y,z]
 * meaning-space coordinate in a WebGL scene you orbit. The 3rd principal axis
 * holds variance the 2D map has to flatten, so clusters that overlap in the map
 * separate in depth. Fixed positions (no live force engine) — GPU-cheap even at
 * ~1.4k nodes. Labels are on hover/selection (always-on 3D text is mush); the
 * focus band and selection drive colour/opacity as in 2D. */
let fg3dMod: Promise<any> | null = null;
// A COMPUTED specifier (function call, not a literal) so the SSR/server bundler
// can't statically resolve it and leaves it a pure runtime import. three.js is
// browser-only — letting the server bundler fetch+bundle its whole tree OOMs the
// deploy bundler (512 MB). The browser evaluates this and fetches at runtime.
const cdnEsm = (pkg: string): string => `https://cdn.jsdelivr.net/npm/${pkg}/+esm`;
const loadFG3D = (): Promise<any> =>
  (fg3dMod ??= import(/* @vite-ignore */ cdnEsm('3d-force-graph')).then((m) => m.default ?? m).catch(() => null));

/** '#rrggbb' → 'rgba(r,g,b,a)' — the edge grammar's hex strokes need an alpha
 *  channel for focus/selection dimming in the 3D scene. */
function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

function ThreeGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const api = useRef<{ select: (key: string | null, fly?: boolean) => void } | null>(null);
  const lastExternal = useRef<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let graph: any = null;
    let ro: ResizeObserver | null = null;
    let onResult: ((ev: Event) => void) | null = null;

    (async () => {
      const [model, FG] = await Promise.all([fetchGraphModel(), loadFG3D()]);
      if (disposed) return;
      if (!FG) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">3D renderer unavailable (offline?)</div>';
        return;
      }
      const { nodes, links, nodeById, coordMap, focusKeys } = model;
      const idOf = (x: any): string => (x && typeof x === 'object' ? x.id : x);
      const inFocus = (n: any): boolean => !!n && focusKeys.has(n.id);
      const r = (n: any): number => 2 + n.score * 7 + Math.min(4, Math.sqrt(n.deg) * 1.1);

      // Fix every node at its semantic [x,y,z] (scaled to world units). Nodes
      // without a coordinate scatter on a ring so they don't pile at the origin.
      const SPREAD = 420;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const c = coordMap?.[n.id];
        if (c) {
          n.fx = c[0] * SPREAD;
          n.fy = c[1] * SPREAD;
          n.fz = (c[2] ?? 0) * SPREAD;
        } else {
          const a = i * 2.3999;
          n.fx = Math.cos(a) * SPREAD * 0.6;
          n.fy = Math.sin(a) * SPREAD * 0.6;
          n.fz = ((i % 13) - 6) * 14;
        }
        n.x = n.fx; n.y = n.fy; n.z = n.fz;
      }

      let selKey: string | null = null;
      let nbr: Set<string> | null = null;
      let hiSet: Set<string> | null = null;
      const neighborsOf = (k: string): Set<string> => {
        const s = new Set<string>();
        for (const l of links) {
          const a = idOf(l.source), b = idOf(l.target);
          if (a === k) s.add(b);
          else if (b === k) s.add(a);
        }
        return s;
      };
      const touchesSel = (l: any): boolean => !!selKey && (idOf(l.source) === selKey || idOf(l.target) === selKey);

      const nodeCol = (n: any): string => {
        const tint = n.type ? `${hueOf(n.type)},42%,55%` : '40,8%,55%';
        let a: number;
        if (selKey) a = n.id === selKey || nbr?.has(n.id) ? 1 : 0.12;
        else if (hiSet) a = hiSet.has(n.id) ? 0.95 : 0.12;
        else a = inFocus(n) ? 0.95 : 0.35;
        return `hsla(${tint},${a})`;
      };
      const linkCol = (l: any): string => {
        const st = edgeStyle(l);
        let a = st.opacity;
        if (selKey) a = touchesSel(l) ? Math.min(0.95, a + 0.4) : a * 0.08;
        else if (hiSet) a = hiSet.has(idOf(l.source)) || hiSet.has(idOf(l.target)) ? a : a * 0.12;
        else a = inFocus(l.source) || inFocus(l.target) ? a : a * 0.25;
        return hexA(st.stroke, a);
      };
      const linkW = (l: any): number => (touchesSel(l) ? 1.4 : 0.5);
      const repaint = (): void => graph.nodeColor(nodeCol).linkColor(linkCol).linkWidth(linkW);

      graph = FG()(el)
        .backgroundColor('#221d16')
        .graphData({ nodes, links })
        .nodeRelSize(2)
        .nodeVal((n: any) => r(n))
        .nodeColor(nodeCol)
        .nodeLabel((n: any) => n.label as string)
        .linkColor(linkCol)
        .linkWidth(linkW)
        .linkOpacity(0.6)
        .enableNodeDrag(false)
        .cooldownTicks(0) // positions are fixed — never run the force engine
        .warmupTicks(0)
        .onNodeClick((n: any) => api.current?.select(n.id, true))
        .onBackgroundClick(() => api.current?.select(null));
      // Belt-and-braces: strip the forces so nothing perturbs the fixed layout.
      graph.d3Force('charge', null);
      graph.d3Force('link', null);
      graph.d3Force('center', null);
      graph.width(el.clientWidth || window.innerWidth).height(el.clientHeight || window.innerHeight);
      setTimeout(() => { if (!disposed) graph.zoomToFit(600, 50); }, 350);

      const flyTo = (d: any, pad = 130): void => {
        const dist = Math.hypot(d.x, d.y, d.z) || 1;
        const k = 1 + pad / dist;
        graph.cameraPosition({ x: d.x * k, y: d.y * k, z: d.z * k }, { x: d.x, y: d.y, z: d.z }, 700);
      };

      api.current = {
        select: (key: string | null, fly = false) => {
          lastExternal.current = key;
          selKey = key;
          nbr = key ? neighborsOf(key) : null;
          if (key) hiSet = null;
          repaint();
          const d = key ? nodeById.get(key) : null;
          if (d && fly) flyTo(d);
          selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : key ? { key, type: null, score: 0, label: key } : null);
        },
      };

      // Console results light up the hits and the camera flies to their centroid.
      onResult = guard((ev: Event): void => {
        const detail = (ev as CustomEvent<{ ok: boolean; value: unknown }>).detail;
        if (!detail?.ok) return;
        const keys = keysOfResult(detail.value).filter((k) => nodeById.has(k));
        if (!keys.length) return;
        hiSet = new Set(keys);
        selKey = null;
        nbr = null;
        repaint();
        const pts = keys.map((k) => nodeById.get(k));
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
        flyTo({ x: cx, y: cy, z: cz }, 260);
      });
      window.addEventListener(CONSOLE_RESULT_EVENT, onResult);

      ro = new ResizeObserver(() => {
        if (!el.clientWidth || !el.clientHeight) return;
        graph.width(el.clientWidth).height(el.clientHeight);
      });
      ro.observe(el);
    })().catch((err) => (window.reportError ?? console.error)(err));

    return () => {
      disposed = true;
      ro?.disconnect();
      if (onResult) window.removeEventListener(CONSOLE_RESULT_EVENT, onResult);
      try { graph?._destructor?.(); } catch { /* ignore */ }
      api.current = null;
      el.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    if (selectedKey === lastExternal.current) return;
    lastExternal.current = selectedKey;
    api.current?.select(selectedKey, true);
  }, [selectedKey]);

  return <div ref={host} style={{ position: 'fixed', inset: 0, background: '#221d16', overflow: 'hidden' }} />;
}

/** Home's graph surface: the 2D canvas map (default — legible at a glance) with
 *  a toggle into the 3D WebGL explore mode (orbit the semantic cloud in depth).
 *  Both render the same model; the toggle just swaps the renderer. */
export function FullGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  return (
    <>
      {mode === '2d' ? (
        <Canvas2DGraph selectedKey={selectedKey} onSelect={onSelect} />
      ) : (
        <ThreeGraph selectedKey={selectedKey} onSelect={onSelect} />
      )}
      <button
        onClick={() => setMode((m) => (m === '2d' ? '3d' : '2d'))}
        title={mode === '2d' ? 'Explore in 3D' : 'Back to the 2D map'}
        style={{
          position: 'fixed',
          right: 12,
          top: 12,
          zIndex: 20,
          padding: '0.3rem 0.6rem',
          fontFamily: 'ui-monospace, monospace',
          fontSize: '0.72rem',
          color: '#efe9dc',
          background: 'rgba(36,31,24,0.72)',
          border: '1px solid #5a5142',
          borderRadius: 999,
          cursor: 'pointer',
          backdropFilter: 'blur(4px)',
        }}
      >
        {mode === '2d' ? '3D ◎' : '2D ▦'}
      </button>
    </>
  );
}
