/**
 * FullGraph (ADR-0047, v3) — home's primary surface: the WHOLE substrate slice
 * as a full-viewport force graph. The graph IS the workspace; everything else
 * floats over it.
 *
 * Data: `workspace.query {rankBy:'salience'}` (no limit) loads the entire slice,
 * `workspace.graph` supplies the full Reference projection (authored + derived),
 * filtered to edges among visible nodes. Node radius = salience score (degree
 * assist); node hue = type (stable hash). Edge grammar mirrors the board
 * renderer: authored solid, `similarTo` the faint constellation, membership
 * (onBoard/inDoc/inView — ADR-0046) a light dash, other derived dashed.
 *
 * v3 (this pass): the graph no longer draws only the top salience band — it
 * loads EVERYTHING and lifts the *focus band* (the salience focus tier, facts at
 * or above the viewer's `focusThreshold`; default 0.5, ADR-0033) out of it. The
 * band renders bright and labelled; the periphery is loaded but recedes to a dim
 * wash (nodes, their labels, and edges buried off-band all fade). Selection and
 * console highlights still override this baseline — they were already the
 * "dim-everything-else" states, so the focus wash is just the resting one.
 *
 * Labels: EVERY node is labelled now, drawn centered BELOW the node over up to
 * two wrapped lines; the label block participates in the sim (a node's collide
 * radius covers the text below it, so the always-on labels don't stack).
 * Selection PINS the node at viewport center and pans the camera onto it, so the
 * neighbours a selection pulls in (one-hop expand) arrange around it and it
 * stays centered rather than drifting with the layout.
 *
 * v2 (use feedback): edges lifted to warm-light strokes (they were invisible
 * against the dusk bg); non-similarTo edges carry their `rel` label (midpoint,
 * dark halo; derived/membership labels fade in past zoom 1.3×); external
 * SELECTION (`selectedKey` prop) eases the camera to the node and rings it; and
 * console results reach the graph over the `home:console-result` CustomEvent
 * (the openFact pattern) — a search/query/recall's returned keys get an accent
 * ring while everything else dims, and the camera FITS to them.
 */
import * as React from 'react';
import { mcpCall } from './lib';
import { openFact, factTitle, type ListEntry } from './facts';

const { useEffect, useRef } = React;

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
// v2: warm-light strokes — the v1 #5a5142 vanished into the dusk background.
function edgeStyle(e: GEdge): { stroke: string; dash?: string; opacity: number; width: number } {
  if (e.rel === 'similarTo') return { stroke: '#cfc4aa', opacity: 0.12, width: 1 };
  if (MEMBER_RELS.has(e.rel)) return { stroke: '#cfc4aa', dash: '2,3', opacity: 0.32, width: 1 };
  if (e.derived) return { stroke: '#cfc4aa', dash: '3,3', opacity: 0.26, width: 1 };
  return { stroke: '#e8ddc2', opacity: 0.55, width: 1.5 };
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

export function FullGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
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
      // v3: load the WHOLE slice (card-shaped — titles + salience, not bodies)
      // and the whole Reference projection. `query` with no limit returns every
      // ranked fact; `graph {}` (no keys) returns every edge — the focus band is
      // lifted out of the full graph client-side, not fetched in isolation.
      // Alongside, the viewer's `_config/salience` gives the real focus
      // threshold (default 0.5) so "the focus band" means *their* focus tier.
      const [nodesRes, cfgRes, d3] = await Promise.all([
        mcpCall('read', 'workspace.query', { rankBy: 'salience', shape: 'card' }),
        mcpCall('read', 'workspace.peek', { key: '_config/salience' }).catch(() => null),
        loadD3(),
      ]);
      if (disposed) return;
      if (!d3) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">graph renderer unavailable (offline?)</div>';
        return;
      }
      const cfgVal = (cfgRes && cfgRes.ok ? (cfgRes.value as { value?: { focusThreshold?: unknown } } | null)?.value : null) ?? null;
      const ftRaw = Number(cfgVal?.focusThreshold);
      const focusThreshold = Number.isFinite(ftRaw) && ftRaw > 0 && ftRaw <= 1 ? ftRaw : 0.5;
      const allEntries = (nodesRes.ok ? ((nodesRes.value as { entries?: ListEntry[] })?.entries ?? []) : []) as ListEntry[];
      const entries = allEntries.filter((e) => !isPlumbing(e));
      const byKey = new Map(entries.map((e) => [e.key, e]));
      const edgesRes = await mcpCall('read', 'workspace.graph', {});
      if (disposed) return;
      const rawEdges = (edgesRes.ok ? ((edgesRes.value as { edges?: GEdge[] })?.edges ?? []) : []) as GEdge[];
      const edges = rawEdges.filter((e) => byKey.has(e.from) && byKey.has(e.to));
      const deg = new Map<string, number>();
      for (const e of edges) {
        deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
        deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
      }
      const nodes = entries.map((e) => ({
        id: e.key,
        type: e._meta?.type ?? null,
        score: Number(e._meta?.score) || 0,
        label: shortLabel(factTitle(e)),
        lines: wrapLabel(factTitle(e)),
        deg: deg.get(e.key) ?? 0,
      }));
      // The focus band: the salience focus tier (score ≥ the viewer's threshold).
      // The graph loads everything, but only this band is lifted out. Guard the
      // degenerate case — a flat/low slice where nothing clears the tier — by
      // falling back to the top slice so the band is never empty (all-dim).
      const bandByTier = nodes.filter((n) => n.score >= focusThreshold);
      const focusKeys = new Set<string>(
        (bandByTier.length ? bandByTier : [...nodes].sort((a, b) => b.score - a.score).slice(0, Math.min(20, nodes.length))).map(
          (n) => n.id,
        ),
      );
      // v3: nodes/links are MUTABLE — selection pulls a node's off-band
      // neighbourhood into the live sim (ADR-0047's one-hop expand), so every
      // selection is keyed and the selections re-join instead of binding once.
      const links: any[] = edges.map((e) => ({ id: `${e.from}|${e.rel}|${e.to}`, source: e.from, target: e.to, rel: e.rel, derived: e.derived }));
      const nodeById = new Map<string, any>((nodes as any[]).map((n) => [n.id, n]));
      const linkIds = new Set<string>(links.map((l) => l.id));
      const expanded = new Set<string>();

      let W = el.clientWidth || window.innerWidth;
      let H = el.clientHeight || window.innerHeight;
      let curK = 1;
      el.innerHTML = '';
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', '100%').style('display', 'block').style('touch-action', 'none');
      const g = svg.append('g');
      const zoom = d3.zoom().scaleExtent([0.15, 4]).on('zoom', guard((ev: any) => {
        g.attr('transform', ev.transform);
        curK = ev.transform.k;
        paintEdgeLabels();
      }));
      svg.call(zoom);
      svg.on('click', guard(() => api.current?.select(null)));

      // Persistent layer groups; the selections below re-join into them.
      const linkG = g.append('g');
      const edgeLabelG = g.append('g');
      const nodeG = g.append('g');
      const labelG = g.append('g');
      let link: any, edgeLabel: any, node: any, label: any;

      const r = (d: any): number => 4 + d.score * 13 + Math.min(6, Math.sqrt(d.deg) * 1.4);
      const inFocus = (d: any): boolean => !!d && focusKeys.has(d.id);
      // Every node carries a label now, drawn centered BELOW the node over up to
      // two lines. Labels participate in the sim: the collision footprint drops
      // to cover the text block below (its height) and out to its half-width, so
      // the layout itself keeps the always-on labels from stacking.
      const labelW = (d: any): number => Math.max(...d.lines.map((l: string) => l.length)) * 6;
      const labelH = (d: any): number => d.lines.length * 11 + 4;
      const collideR = (d: any): number => Math.max(r(d) + labelH(d), labelW(d) / 2 + 2, r(d) + 6);
      const idOf = (x: any): string => (x && typeof x === 'object' ? x.id : x);

      // ── selection + highlight state (shared by paint/select/expand) ──
      let selKey: string | null = null;
      let nbrSet: Set<string> | null = null;
      let hiSet: Set<string> | null = null;
      // The node currently pinned at viewport center (the live selection). Only
      // one at a time; released when selection changes/clears or it's dragged.
      let pinned: any = null;
      const touchesSel = (d: any): boolean => !!selKey && (idOf(d.source) === selKey || idOf(d.target) === selKey);
      const neighborsOf = (key: string): Set<string> => {
        const out = new Set<string>();
        for (const l of links) {
          if (idOf(l.source) === key) out.add(idOf(l.target));
          else if (idOf(l.target) === key) out.add(idOf(l.source));
        }
        return out;
      };

      const onNodeClick = guard((ev: any, d: any) => {
        ev.stopPropagation();
        api.current?.select(d.id);
      });
      const onNodeDbl = guard((ev: any, d: any) => {
        ev.stopPropagation();
        openFact({ key: d.id } as ListEntry);
      });
      const dragBehavior = d3
        .drag()
        .on('start', guard((ev: any, d: any) => {
          sim.alphaTarget(0.25).restart();
          d.fx = d.x;
          d.fy = d.y;
        }))
        .on('drag', guard((ev: any, d: any) => {
          d.fx = ev.x;
          d.fy = ev.y;
        }))
        .on('end', guard((ev: any, d: any) => {
          sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

      /** (Re)bind data → DOM. Enter-only styling; paint() owns the dynamic bits. */
      function rejoin(): void {
        link = linkG
          .selectAll('line')
          .data(links, (d: any) => d.id)
          .join((enter: any) =>
            enter
              .append('line')
              .attr('stroke', (d: any) => edgeStyle(d).stroke)
              .attr('stroke-opacity', (d: any) => edgeStyle(d).opacity)
              .attr('stroke-width', (d: any) => edgeStyle(d).width)
              .attr('stroke-dasharray', (d: any) => edgeStyle(d).dash ?? null),
          );
        // `rel` labels on edges (similarTo excluded — the constellation stays
        // quiet). Authored labels always; derived/membership past zoom 1.3×.
        edgeLabel = edgeLabelG
          .selectAll('text')
          .data(links.filter((l: any) => l.rel !== 'similarTo'), (d: any) => d.id)
          .join((enter: any) =>
            enter
              .append('text')
              .text((d: any) => d.rel)
              .attr('font-size', 7.5)
              .attr('font-family', 'ui-monospace, monospace')
              .attr('fill', '#bfb49a')
              .attr('fill-opacity', 0.8)
              .attr('text-anchor', 'middle')
              .attr('pointer-events', 'none')
              .attr('paint-order', 'stroke')
              .attr('stroke', '#241f18')
              .attr('stroke-width', 2.5),
          );
        node = nodeG
          .selectAll('circle')
          .data(nodes, (d: any) => d.id)
          .join((enter: any) => {
            const c = enter
              .append('circle')
              .attr('r', r)
              .attr('fill', (d: any) => nodeColor(d.type))
              .attr('fill-opacity', 0.85)
              .attr('stroke', '#2e2a22')
              .attr('stroke-width', 1)
              .style('cursor', 'pointer');
            c.append('title').text((d: any) => `${d.id}${d.type ? ` · ${d.type}` : ''}`);
            c.on('click', onNodeClick).on('dblclick', onNodeDbl).call(dragBehavior);
            return c;
          });
        // Every node is labelled (centered, below the node). A <g> per label
        // holds a middle-anchored <text> whose lines are tspans — the group's
        // transform places it in tick, its opacity carries the focus dimming.
        label = labelG
          .selectAll('g')
          .data(nodes, (d: any) => d.id)
          .join((enter: any) => {
            const gl = enter.append('g').attr('pointer-events', 'none');
            gl.append('text')
              .attr('text-anchor', 'middle')
              .attr('font-size', 10)
              .attr('font-family', 'ui-monospace, monospace')
              .attr('fill', '#efe9dc')
              .attr('paint-order', 'stroke')
              .attr('stroke', '#241f18')
              .attr('stroke-width', 3)
              .each(function (this: any, d: any) {
                const t = d3.select(this);
                d.lines.forEach((ln: string, i: number) =>
                  t.append('tspan').attr('x', 0).attr('dy', i === 0 ? 0 : '1.05em').text(ln),
                );
              });
            return gl;
          });
      }

      function paintEdgeLabels(): void {
        edgeLabel
          .attr('display', (d: any) => {
            if (selKey) return touchesSel(d) ? null : 'none';
            if (d.derived && curK < 1.3) return 'none';
            // Base view: an authored edge label only shows if it reaches the
            // focus band (or you've zoomed in) — otherwise the periphery's
            // labels bury the band in text.
            const lit = inFocus(nodeById.get(idOf(d.source))) || inFocus(nodeById.get(idOf(d.target)));
            return lit || curK >= 1.3 ? null : 'none';
          })
          .attr('fill-opacity', (d: any) => (selKey && touchesSel(d) ? 0.95 : 0.8));
      }

      /** One styling pass over everything state-dependent. A selection
       *  emphasises its whole neighbourhood: the selected node rings accent,
       *  connected nodes stay bright with a light ring, touching edges thicken
       *  and brighten (and always show their rel), everything else recedes —
       *  dimmed, not hidden, so the territory stays legible. */
      function paint(): void {
        node
          .attr('stroke', (n: any) =>
            n.id === selKey ? '#f5c453' : selKey && nbrSet?.has(n.id) ? '#e8ddc2' : hiSet?.has(n.id) ? '#f5c453' : '#2e2a22')
          .attr('stroke-width', (n: any) => (n.id === selKey ? 3 : selKey && nbrSet?.has(n.id) ? 1.6 : hiSet?.has(n.id) ? 2 : 1))
          .attr('fill-opacity', (n: any) => {
            if (selKey) return n.id === selKey || nbrSet?.has(n.id) ? 0.95 : 0.2;
            if (hiSet) return hiSet.has(n.id) ? 0.85 : 0.25;
            // Base view: the whole slice is loaded, but only the focus band
            // stands out — off-band facts recede to a dim wash.
            return inFocus(n) ? 0.9 : 0.22;
          });
        link
          .attr('stroke-opacity', (d: any) => {
            const base = edgeStyle(d).opacity;
            if (selKey) return touchesSel(d) ? Math.min(0.95, base + 0.5) : base * 0.12;
            if (hiSet) return hiSet.has(idOf(d.source)) || hiSet.has(idOf(d.target)) ? base : base * 0.25;
            // Base view: an edge that reaches the focus band stays lit; edges
            // buried in the periphery fade with their nodes.
            return inFocus(nodeById.get(idOf(d.source))) || inFocus(nodeById.get(idOf(d.target))) ? base : base * 0.22;
          })
          .attr('stroke-width', (d: any) => edgeStyle(d).width + (touchesSel(d) ? 0.8 : 0));
        // Labels always show; opacity carries the focus dimming (the <g> wraps a
        // stroked text, so opacity — not fill-opacity — dims halo and fill alike).
        label.attr('opacity', (n: any) => {
          if (selKey) return n.id === selKey || nbrSet?.has(n.id) ? 0.98 : 0.28;
          if (hiSet) return hiSet.has(n.id) ? 0.9 : 0.32;
          return inFocus(n) ? 0.92 : 0.4;
        });
        paintEdgeLabels();
      }

      /** One-hop expand: pull the selected fact's off-band neighbours into the
       *  live sim as small "ghost" satellites, then stitch EVERY projection
       *  edge whose two ends are now both visible (not just edges to the
       *  selection — a pulled-in node also connects to anything else on
       *  screen). Once per key; plumbing stays filtered. */
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
          const n = {
            id: k,
            type: entry._meta?.type ?? null,
            score: Number(entry._meta?.score) || 0.05,
            label: shortLabel(factTitle(entry)),
            lines: wrapLabel(factTitle(entry)),
            deg: 1,
            ghost: true,
            x: (anchor?.x ?? W / 2) + Math.cos(i * 2.399) * 90,
            y: (anchor?.y ?? H / 2) + Math.sin(i * 2.399) * 90,
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
        // The neighbours read carries the anchor's own edges…
        for (const e of v?.outbound ?? []) stitch(key, e.to, e.rel, e.derived);
        for (const e of v?.inbound ?? []) stitch(e.from, key, e.rel, e.derived);
        // …and one keys-scoped graph read (ADR-0048) stitches the satellites to
        // EVERYTHING visible, not just the anchor.
        if (newKeys.length) {
          const around = await mcpCall('read', 'workspace.graph', { keys: newKeys });
          if (disposed) return;
          if (around.ok) {
            for (const e of ((around.value as { edges?: GEdge[] })?.edges ?? []) as GEdge[]) stitch(e.from, e.to, e.rel, e.derived);
          }
        }
        rejoin();
        sim.nodes(nodes);
        sim.force('link').links(links);
        if (selKey) nbrSet = neighborsOf(selKey);
        paint();
        sim.alpha(0.3).restart();
        setTimeout(() => sim?.stop(), 4000);
      }

      const panTo = (d: any): void => {
        const t = d3.zoomTransform(svg.node());
        svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - t.k * d.x, H / 2 - t.k * d.y).scale(t.k));
      };
      const fitTo = (keys: Set<string>): void => {
        const pts = nodes.filter((n: any) => keys.has(n.id));
        if (!pts.length) return;
        const xs = pts.map((p: any) => p.x), ys = pts.map((p: any) => p.y);
        const minX = Math.min(...xs) - 60, maxX = Math.max(...xs) + 60;
        const minY = Math.min(...ys) - 60, maxY = Math.max(...ys) + 60;
        const k = Math.min(3, 0.9 / Math.max((maxX - minX) / W, (maxY - minY) / H));
        svg.transition().duration(600).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - k * (minX + maxX) / 2, H / 2 - k * (minY + maxY) / 2).scale(k));
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
          paint();
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
          if (key) void expand(key).catch((err) => (window.reportError ?? console.error)(err));
          selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : key ? { key, type: null, score: 0, label: key } : null);
        },
      };

      // Console results (search / query / recall / neighbors) light up the graph
      // and the camera fits to them — the palette drives the territory.
      onResult = guard((ev: Event): void => {
        const detail = (ev as CustomEvent<{ ok: boolean; value: unknown }>).detail;
        if (!detail?.ok) return;
        const keys = keysOfResult(detail.value).filter((k) => nodes.some((n: any) => n.id === k));
        if (!keys.length) return;
        hiSet = new Set(keys);
        selKey = null;
        nbrSet = null;
        paint();
        fitTo(hiSet);
      });
      window.addEventListener(CONSOLE_RESULT_EVENT, onResult);

      sim = d3
        .forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(74).strength(0.4))
        .force('charge', d3.forceManyBody().strength(-200))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collide', d3.forceCollide(collideR))
        .on('tick', () => {
          link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
          edgeLabel.attr('x', (d: any) => (d.source.x + d.target.x) / 2).attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 2);
          node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
          // Centered below the node; the first line clears the node radius.
          label.attr('transform', (d: any) => `translate(${d.x},${d.y + r(d) + 11})`);
        });
      rejoin();
      paint();
      setTimeout(() => sim?.stop(), 9000);

      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h || (w === W && h === H)) return;
        W = w;
        H = h;
        sim?.force('center', d3.forceCenter(W / 2, H / 2)).alpha(0.2).restart();
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
