/**
 * FullGraph (ADR-0047) — home's primary surface: the salience-shaped slice as a
 * full-viewport force graph. The substrate thesis made literal: the graph IS the
 * workspace, and every other affordance floats over it.
 *
 * Data: `workspace.query {rankBy:'salience', limit:140}` picks the nodes (the
 * focus band + top peripheral — progressive disclosure, not the whole slice),
 * `workspace.graph` supplies the full Reference projection (authored + derived),
 * filtered to edges among visible nodes. Node radius = salience (score) with a
 * degree assist; node hue = type (stable hash); the edge grammar mirrors the
 * canvas board renderer: authored solid, `similarTo` the faint constellation,
 * membership (onBoard/inDoc/inView — the ADR-0046 structure) a light dash,
 * other derived edges dashed.
 *
 * Client-only: d3 lazy-loads from the CDN (the card's loader pattern, ADR-0038);
 * SSR renders the empty stage and the sim mounts into it — hydration-safe by
 * construction. Tap selects (the palette shows context), double-tap peeks
 * (`openFact` modal), background tap clears.
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
const nodeColor = (t: string | null): string => (t ? `hsl(${hueOf(t)} 42% 52%)` : '#9a917f');

const MEMBER_RELS = new Set(['onBoard', 'inDoc', 'inView']);
function edgeStyle(e: GEdge): { dash?: string; opacity: number; width: number } {
  if (e.rel === 'similarTo') return { opacity: 0.08, width: 1 };
  if (MEMBER_RELS.has(e.rel)) return { dash: '2,3', opacity: 0.22, width: 1 };
  if (e.derived) return { dash: '3,3', opacity: 0.16, width: 1 };
  return { opacity: 0.4, width: 1.4 };
}

const shortLabel = (s: string): string => (s.length > 26 ? s.slice(0, 25) + '…' : s);

export function FullGraph({ onSelect }: { onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let sim: any = null;
    let ro: ResizeObserver | null = null;

    (async () => {
      const [nodesRes, edgesRes, d3] = await Promise.all([
        mcpCall('read', 'workspace.query', { rankBy: 'salience', limit: 140 }),
        mcpCall('read', 'workspace.graph', {}),
        loadD3(),
      ]);
      if (disposed) return;
      if (!d3) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">graph renderer unavailable (offline?)</div>';
        return;
      }
      const entries = (nodesRes.ok ? ((nodesRes.value as { entries?: ListEntry[] })?.entries ?? []) : []) as ListEntry[];
      const rawEdges = (edgesRes.ok ? ((edgesRes.value as { edges?: GEdge[] })?.edges ?? []) : []) as GEdge[];
      const byKey = new Map(entries.map((e) => [e.key, e]));
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
        deg: deg.get(e.key) ?? 0,
      }));
      const links = edges.map((e) => ({ source: e.from, target: e.to, rel: e.rel, derived: e.derived }));

      let W = el.clientWidth || window.innerWidth;
      let H = el.clientHeight || window.innerHeight;
      el.innerHTML = '';
      const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', '100%').style('display', 'block').style('touch-action', 'none');
      const g = svg.append('g');
      svg.call(
        d3.zoom().scaleExtent([0.15, 4]).on('zoom', (ev: any) => g.attr('transform', ev.transform)),
      );
      // Background tap clears the selection (the palette collapses its context row).
      svg.on('click', () => selectRef.current(null));

      const link = g
        .append('g')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke', '#5a5142')
        .attr('stroke-opacity', (d: any) => edgeStyle(d).opacity)
        .attr('stroke-width', (d: any) => edgeStyle(d).width)
        .attr('stroke-dasharray', (d: any) => edgeStyle(d).dash ?? null);

      const r = (d: any): number => 4 + d.score * 13 + Math.min(6, Math.sqrt(d.deg) * 1.4);
      const node = g
        .append('g')
        .selectAll('circle')
        .data(nodes)
        .join('circle')
        .attr('r', r)
        .attr('fill', (d: any) => nodeColor(d.type))
        .attr('fill-opacity', 0.85)
        .attr('stroke', '#2e2a22')
        .attr('stroke-width', 1)
        .style('cursor', 'pointer');
      node.append('title').text((d: any) => `${d.id}${d.type ? ` · ${d.type}` : ''}`);

      const label = g
        .append('g')
        .selectAll('text')
        .data(nodes.filter((n: any) => n.score > 0.45 || n.deg > 5))
        .join('text')
        .text((d: any) => d.label)
        .attr('font-size', 10)
        .attr('font-family', 'ui-monospace, monospace')
        .attr('fill', '#efe9dc')
        .attr('fill-opacity', 0.75)
        .attr('pointer-events', 'none');

      const select = (d: any | null): void => {
        node.attr('stroke', (n: any) => (d && n.id === d.id ? '#f5c453' : '#2e2a22')).attr('stroke-width', (n: any) => (d && n.id === d.id ? 2.5 : 1));
        selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : null);
      };
      node.on('click', (ev: any, d: any) => {
        ev.stopPropagation();
        select(d);
      });
      node.on('dblclick', (ev: any, d: any) => {
        ev.stopPropagation();
        openFact({ key: d.id } as ListEntry);
      });

      sim = d3
        .forceSimulation(nodes)
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(70).strength(0.4))
        .force('charge', d3.forceManyBody().strength(-190))
        .force('center', d3.forceCenter(W / 2, H / 2))
        .force('collide', d3.forceCollide((d: any) => r(d) + 6))
        .on('tick', () => {
          link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
          node.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
          label.attr('x', (d: any) => d.x + r(d) + 3).attr('y', (d: any) => d.y + 3);
        });
      // Settle then freeze (drag re-warms) — a big graph gets a longer runway
      // than the card's 5s, then stops burning CPU.
      setTimeout(() => sim?.stop(), 9000);

      node.call(
        d3
          .drag()
          .on('start', (ev: any, d: any) => {
            sim.alphaTarget(0.25).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (ev: any, d: any) => {
            d.fx = ev.x;
            d.fy = ev.y;
          })
          .on('end', (ev: any, d: any) => {
            sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

      ro = new ResizeObserver(() => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h || (w === W && h === H)) return;
        W = w;
        H = h;
        sim?.force('center', d3.forceCenter(W / 2, H / 2)).alpha(0.2).restart();
        setTimeout(() => sim?.stop(), 3000);
      });
      ro.observe(el);
    })();

    return () => {
      disposed = true;
      sim?.stop();
      ro?.disconnect();
      el.innerHTML = '';
    };
  }, []);

  return (
    <div
      ref={host}
      style={{ position: 'fixed', inset: 0, background: 'radial-gradient(ellipse at 50% 30%, #3a3428 0%, #241f18 70%)', overflow: 'hidden' }}
    />
  );
}
