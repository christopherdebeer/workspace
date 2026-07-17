/**
 * The parc.land conversation widget (ADR-0034/0035/0036) — the browser bundle behind
 * `ui://parc/card`, esbuilt to `app.js` and inlined by the gateway.
 *
 * Built on the OFFICIAL @modelcontextprotocol/ext-apps `App` SDK rather than a
 * hand-rolled postMessage protocol — the SDK owns the lifecycle (ui/initialize →
 * initialized), `autoResize` (the correct `ui/notifications/size-changed` mechanism the
 * host honours — what we were getting wrong by hand), and the host-proxied
 * `callServerTool`/`readServerResource` bridge (under our gateway's enforceScope).
 *
 * Rendering reuses the SHARED render vocabulary (`platform/ui/render-hints` + `marked`);
 * the `viewers` cell renderers (json/csv/mermaid) arrive over the SAME ui:// federation
 * hop as any cell-authored renderer (ADR-0044 Inc 4 — the build-time cross-cell import
 * this bundle used to carry was the dead rung; reference, not copy, at runtime too).
 */
import { App } from '@modelcontextprotocol/ext-apps';
import { marked } from 'marked';
import { hintToHtml, bodyText, resolvePath, escapeHtml } from '../../../platform/ui/render-hints';
import { wikiLinkExtension } from '../../../platform/ui/wiki-link';
import { fetchAndRunRenderer } from '../../../platform/ui/federated-renderer';

marked.setOptions({ gfm: true, breaks: false });
// [[wiki-links]] (ADR-0038 Inc 3, consolidated per ADR-0044 Inc 4) — the ONE
// resolver lives in platform/ui/wiki-link; this surface only chooses the anchor:
// the resolved KEY rides data-key so the card intercepts the click into a
// host-proxied peek (in-card navigation) rather than a dead browser nav.
marked.use({
  extensions: [wikiLinkExtension(({ key, label }) => `<a class="wikilink" data-key="${escapeHtml(key)}" href="#">${escapeHtml(label)}</a>`)],
} as unknown as Parameters<typeof marked.use>[0]);
const esc = escapeHtml;
const md = (s: string): string => marked.parse(s.replace(/\r\n/g, '\n'), { async: false }) as string;
const hint = (h: string, v: unknown): string => hintToHtml(h, v, { md, esc });

// The pure viewers (json/csv/mermaid) resolve through this ui:// address — the
// gateway's resolveCellRenderer federation hop — like every other cell renderer.
const VIEWERS_URI = 'ui://@c15r/viewers/renderers.js';

type Entry = { value?: unknown; _meta?: { type?: string | null; score?: number }; key?: string; score?: number };
type Types = Record<string, { icon?: string; label?: string; render?: { viewer?: string }; handlers?: { render?: Array<{ hint?: string; renderer?: string }> } }>;


function header(back: boolean): string {
  const b = back ? '<button class="mini back" data-back="1" title="back">←</button>' : '';
  return `<div class="hdr">${b}<span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div>`;
}
function chips(arr: string[]): string {
  return '<div class="chips">' + arr.map((s) => `<span class="chip">${esc(s)}</span>`).join('') + '</div>';
}
function rowList(pairs: Array<[string, unknown]>): string {
  return '<div class="rows">' + pairs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('') + '</div>';
}
/** Unique element ids for the local expand/collapse toggles. */
let uid = 0;
const nextId = (): string => 'x' + uid++;
/** A "+N more" button that reveals a hidden block (local, no server round-trip). */
function toggleBtn(id: string, moreLabel: string): string {
  return `<button class="more-btn" data-toggle="${id}" data-more="${esc(moreLabel)}" data-less="show less">${esc(moreLabel)}</button>`;
}
/** A `.rows` grid, capped to `cap` visible rows + a "+N more" toggle for the rest. */
function rowsBlock(rows: string[], cap = 6): string {
  const head = `<div class="rows">${rows.slice(0, cap).join('')}</div>`;
  if (rows.length <= cap) return head;
  const id = nextId();
  return head + `<div id="${id}" hidden><div class="rows">${rows.slice(cap).join('')}</div></div>` + toggleBtn(id, `+${rows.length - cap} more`);
}
/** Rows that drill: clicking issues a host-proxied read (query by type/prefix) + re-renders. */
function drillRows(pairs: Array<[string, unknown]>, input: (k: string) => unknown, cap = 6): string {
  return rowsBlock(pairs.map(([k, v]) =>
    `<div class="k drill" data-call="read" data-target="workspace.query" data-input="${esc(JSON.stringify(input(String(k))))}">${esc(k)}</div><div class="v">${esc(v)}</div>`), cap);
}
type Edge = { from: string; rel: string; to: string; strength?: number | null; derived?: boolean };
/** A neighbor key's short label — the resolved entry's type-affordance label/title, else the key. */
function neighborLabel(key: string, entries: Record<string, Entry>, types: Types): string {
  const ent = entries[key];
  const v = ent && (ent.value as Record<string, unknown> | undefined);
  if (ent && v) {
    const t = ent._meta && ent._meta.type;
    const aff = (t && types[t]) || {};
    const lbl = (aff.label && resolvePath(ent, aff.label)) || v.title || v.name;
    if (lbl) return String(lbl).slice(0, 60);
  }
  return key;
}
/** One edge section (outbound/inbound) — each neighbor drillable: a host-proxied peek. */
function neighborSection(edges: Edge[], entries: Record<string, Entry>, types: Types, incoming: boolean): string {
  return rowsBlock(edges.map((e) => {
    const nk = incoming ? e.from : e.to;
    const der = e.derived ? ' <span class="hint">· derived</span>' : '';
    const aff = entries[nk] && entries[nk]._meta && entries[nk]._meta.type && types[(entries[nk]._meta as { type?: string }).type as string];
    const ic = (aff && aff.icon) ? esc(aff.icon) + ' ' : '';
    return `<div class="k drill" data-call="read" data-target="workspace.peek" data-input="${esc(JSON.stringify({ key: nk }))}"><span class="ty">${esc(e.rel)}</span> ${ic}${esc(neighborLabel(nk, entries, types))}${der}</div><div class="v">${esc(e.strength != null ? Number(e.strength).toFixed(2) : '')}</div>`;
  }));
}
/** The neighbours shape `{outbound, inbound, entries}` → drillable edge sections (graph
 *  traversal, one hop). Renders the EDGES even when no neighbor `entries` resolved — so an
 *  el:/opaque-keyed or derived-only fact no longer falls through to a raw-JSON dump. */
function renderNeighbors(d: Record<string, unknown>, types: Types): string {
  const out = (Array.isArray(d.outbound) ? d.outbound : []) as Edge[];
  const inb = (Array.isArray(d.inbound) ? d.inbound : []) as Edge[];
  const entries = (d.entries as Record<string, Entry>) || {};
  let h = '';
  if (out.length) h += `<h2>Outbound (${out.length})</h2>` + neighborSection(out, entries, types, false);
  if (inb.length) h += `<h2>Inbound (${inb.length})</h2>` + neighborSection(inb, entries, types, true);
  if (!h) h = '<div class="hint">No links yet — this fact has no edges.</div>';
  return h;
}

/** One fact rendered by its TYPE affordance: a viewer (json/csv/mermaid), a machine-run
 *  trace diagram, a cell-declared ui:// renderer, or the present.render hint. */
function typedCard(key: string, entry: Entry, types: Types, slot: string, clamp = false): string {
  const t = (entry && entry._meta && entry._meta.type) || null;
  const aff = (t && types && types[t]) || {};
  const label = (aff.label && resolvePath(entry, aff.label)) || (entry.value as Record<string, unknown>)?.title || (entry.value as Record<string, unknown>)?.name || key;
  const rh = aff.handlers && aff.handlers.render && aff.handlers.render[0];
  const viewer = aff.render && aff.render.viewer;
  let body = '';
  if (viewer) {
    // A declared pure viewer is just a renderer at the viewers cell's ui://
    // face — one dispatch namespace, no local registry (ADR-0044 Inc 4). The
    // hint render below stays up if the hop can't serve it.
    body = hint('fields', entry.value);
    fetchRenderer(VIEWERS_URI, slot, viewer, entry.value, key);
  } else if (rh && typeof rh.renderer === 'string' && rh.renderer.indexOf('ui://') === 0) {
    // ADR-0039: a cell-authored renderer. Show the hint render immediately, then
    // swap in the cell's renderer once it loads over the host proxy (degrades to
    // the hint if the cell, the provider hop, or the host CSP can't serve it). The
    // machine-run trace diagram, formerly hardcoded HERE, now lives in the machine
    // cell and arrives this way — render federated, not centralised.
    body = hint('fields', entry.value);
    fetchRenderer(rh.renderer, slot, t as string, entry.value, key);
  } else {
    body = rh && rh.hint ? hint(rh.hint, entry.value) : '';
    if (!body) body = hint('fields', entry.value) || `<pre>${esc(JSON.stringify(entry.value, null, 2)).slice(0, 800)}</pre>`;
  }
  // Score: top-level (search cosine) or _meta.score (salience). Render a small bar so
  // ranked results read as a ranking, not a column of bare numbers (ADR-0038 Inc 6).
  const scoreNum = typeof entry.score === 'number' ? entry.score : (entry._meta && typeof entry._meta.score === 'number' ? entry._meta.score : null);
  const sc = scoreNum != null ? `<span class="sim" title="${scoreNum.toFixed(3)}"><i style="width:${Math.max(4, Math.min(100, Math.round(scoreNum * 100)))}%"></i></span><span class="sc">${scoreNum.toFixed(2)}</span>` : '';
  const nav = key ? `<button class="mini" title="neighbors" data-call="read" data-target="workspace.neighbors" data-input="${esc(JSON.stringify({ key }))}">↹</button>` : '';
  // Clamp only TEXT bodies (md/code/fields/pre) in list contexts — viewer/machine-run
  // mounts fill the slot later (body === '') and must not be height-capped.
  const showClamp = clamp && !!body;
  const clampBtn = showClamp ? `<button class="more-btn clamp-btn" data-clamp="${slot}" hidden>show more</button>` : '';
  return `<div class="fc"><div class="fc-h"><span class="ic">${esc(aff.icon || '•')}</span><span class="lb">${esc(String(label).slice(0, 100))}</span><span class="sp"></span>${t ? `<span class="ty">${esc(t)}</span>` : ''}${sc}${nav}</div><div id="${slot}"${showClamp ? ' class="clamp"' : ''}>${body}</div>${clampBtn}</div>`;
}
/** Normalize entries (a `{key:Entry}` map OR a ranked `Entry[]` array, e.g. search) to a
 *  list that preserves the real fact key — so drills/neighbours/graph use the key, not an
 *  array index (the latent search-mis-key bug, ADR-0038 Inc 6). */
function toEntryList(e: unknown): Array<{ key: string; entry: Entry }> {
  if (Array.isArray(e)) return e.map((it, i) => ({ key: (it && (it as Entry).key) || String(i), entry: it as Entry }));
  if (e && typeof e === 'object') return Object.keys(e).map((k) => ({ key: k, entry: (e as Record<string, Entry>)[k] }));
  return [];
}
let lastEntryKeys: string[] = []; // keys of the most recent fact list — for graph mode (Inc 2)
/** A fact list, rendered GLANCEABLE: clamped cards, capped to a head + "+N more". */
function entriesBlock(e: unknown, types: Types, cap = 5): string {
  const list = toEntryList(e);
  lastEntryKeys = list.map((x) => x.key).filter((k) => k && !/^\d+$/.test(k));
  const cards = list.map((x, i) => typedCard(x.key, x.entry, types, 'slot-' + i, true));
  if (cards.length <= cap) return cards.join('');
  const id = nextId();
  return cards.slice(0, cap).join('') + `<div id="${id}" hidden>${cards.slice(cap).join('')}</div>` + toggleBtn(id, `+${cards.length - cap} more`);
}
function renderSuggestions(d: Record<string, unknown>): string {
  const vocab = (Array.isArray(d.vocab) ? d.vocab : ['relatesTo']) as string[];
  const cards = (d.suggestions as Array<Record<string, unknown>> || []).map((c) => {
    const chips2 = vocab.map((rel) => `<button class="chip act" data-call="act" data-target="workspace.ratify" data-input="${esc(JSON.stringify({ from: c.from, to: c.to, rel }))}">${esc(rel)}</button>`).join('');
    const score = c.score != null ? Number(c.score).toFixed(2) : '';
    // Peek both facts inline BEFORE ratifying — you can't truthfully assert refines/
    // duplicates/… for opaque keys sight-unseen (audit: blind-ratification).
    const pid = nextId();
    const peek = `<button class="mini" data-peek="${esc(JSON.stringify([c.from, c.to]))}" data-into="${pid}" title="peek both facts">👁 peek</button>`;
    return `<div class="fc"><div class="fc-h"><span class="lb">${esc(c.fromLabel || c.from)} ↔ ${esc(c.toLabel || c.to)}</span><span class="sp"></span><span class="sc">${score}</span>${peek}</div><div id="${pid}"></div><div class="chips"><span class="hint">ratify as</span> ${chips2}</div></div>`;
  });
  let items: string;
  if (!cards.length) items = '<div class="hint">none</div>';
  else if (cards.length <= 5) items = cards.join('');
  else { const id = nextId(); items = cards.slice(0, 5).join('') + `<div id="${id}" hidden>${cards.slice(5).join('')}</div>` + toggleBtn(id, `+${cards.length - 5} more`); }
  return `<h2>Suggestions (${esc(d.total ?? 0)})</h2>${items}`;
}
function overview(o: Record<string, unknown>): string {
  let h = '';
  const bands = o.bands as Record<string, number> | undefined;
  if (bands) h += '<h2>Salience</h2><div class="bands">' + (['focus', 'peripheral', 'elided'] as const).map((b) => `<div class="band"><b>${esc(bands[b])}</b><span>${b}</span></div>`).join('') + '</div>';
  if (typeof o.total === 'number') h += `<div class="hint">${esc(o.total)} facts${o.granted ? ' · ' + esc(o.granted) + ' granted' : ''} · tap a type or prefix to drill</div>`;
  if (Array.isArray(o.byType)) h += '<h2>By type</h2>' + drillRows((o.byType as Array<{ type: string; count: number }>).map((t) => [t.type || '(untyped)', t.count]), (k) => ({ type: k, limit: 25 }));
  if (Array.isArray(o.byPrefix)) h += '<h2>By prefix</h2>' + drillRows((o.byPrefix as Array<{ prefix: string; count: number }>).map((p) => [p.prefix, p.count]), (k) => ({ prefix: k, limit: 25 }));
  return h;
}
function whoami(d: Record<string, unknown>): string {
  let h = `<h2>Identity</h2><div class="who">${esc(d.user || 'anonymous')}</div>`;
  if (Array.isArray(d.scopes)) h += '<h2>Active scope</h2>' + chips(d.scopes as string[]);
  if (Array.isArray(d.grant) && JSON.stringify(d.grant) !== JSON.stringify(d.scopes)) h += '<h2>Grant ceiling</h2>' + chips(d.grant as string[]);
  return h;
}
// ── ADR-0038 Inc 1: coverage — structured renderers so no read dumps raw JSON ──
/** Best label for an arbitrary list item (registry/grant/group/share shapes). */
function labelOf(it: unknown): string {
  if (it == null) return '';
  if (typeof it !== 'object') return String(it);
  const o = it as Record<string, unknown>;
  return String(o.id ?? o.name ?? o.label ?? o.key ?? o.title ?? o.rel ?? o.resource ?? JSON.stringify(o).slice(0, 80));
}
/** A muted secondary line for a list item — the decision-relevant scalar fields. */
function subOf(it: unknown): string {
  if (!it || typeof it !== 'object') return '';
  const o = it as Record<string, unknown>;
  const keys = ['resource', 'mode', 'status', 'description', 'note', 'to', 'keyPrefix', 'membership', 'order', 'op', 'count', 'requester', 'grantee', 'by', 'invoke', 'deliver'];
  const parts: string[] = [];
  for (const k of keys) if (o[k] != null && typeof o[k] !== 'object') parts.push(`${k}: ${String(o[k]).slice(0, 60)}`);
  return parts.slice(0, 3).join(' · ');
}
function listRows(arr: unknown[], drill?: (it: unknown) => { target: string; input: unknown } | null): string {
  return rowsBlock(arr.map((it) => {
    const sub = subOf(it);
    const d = drill && drill(it);
    const cls = d ? ' drill" data-call="read" data-target="' + esc(d.target) + '" data-input="' + esc(JSON.stringify(d.input)) : '';
    return `<div class="k${cls}">${esc(labelOf(it))}${sub ? ` <span class="hint">${esc(sub)}</span>` : ''}</div><div class="v"></div>`;
  }));
}
/** Generic structured fallback: render each array property as a capped list section and
 *  scalar/object props as fields — instead of dumping JSON. Covers actions/views/
 *  subscriptions/groups/shared and any other array-bearing shape. */
function genericStructured(d: Record<string, unknown>): string {
  let h = '';
  const scalars: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(d)) {
    if (k === 'types' || k === 'hints') continue;
    if (Array.isArray(v)) h += `<h2>${esc(k)} (${v.length})</h2>` + (v.length ? listRows(v) : '<div class="hint">none</div>');
    else if (v != null && typeof v === 'object') h += `<h2>${esc(k)}</h2>` + (hint('fields', v) || `<pre>${esc(JSON.stringify(v, null, 2)).slice(0, 600)}</pre>`);
    else if (v != null) scalars.push([k, v]);
  }
  if (scalars.length) h = rowList(scalars) + h;
  return h || `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
}
// A node-link graph as a D3 **force-directed** SVG (ADR-0038 Inc 2, rich follow-up).
// d3 is lazy-loaded from the CDN the resource already allows (mermaid uses the same), so
// it never bloats the inlined bundle. Node size = degree (centrality); seed nodes (the
// result set) filled, one-hop neighbours outlined; authored edges solid, derived dashed;
// zoom / pan / drag; tap a node → in-card peek (host-proxied traversal).
/* eslint-disable @typescript-eslint/no-explicit-any */
let d3Mod: Promise<any> | null = null;
function loadD3(): Promise<any> {
  // @ts-ignore — a URL module specifier has no local types; intentional (matches viewers).
  if (!d3Mod) d3Mod = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/d3@7/+esm').catch(() => null);
  return d3Mod;
}
function shortKey(k: string): string { return k.length > 30 ? k.slice(0, 28) + '…' : k; }
function graphView(slot: string, edges: Edge[], seed: Set<string>): void {
  const host = document.getElementById(slot);
  if (!host) return;
  const deg = new Map<string, number>();
  for (const e of edges) { deg.set(e.from, (deg.get(e.from) || 0) + 1); deg.set(e.to, (deg.get(e.to) || 0) + 1); }
  const hasSeed = seed.size > 0;
  const nodes = [...deg.keys()].map((id) => ({ id, deg: deg.get(id) || 1, seed: !hasSeed || seed.has(id) }));
  const links = edges.map((e) => ({ source: e.from, target: e.to, derived: !!e.derived }));
  loadD3().then((d3: any) => {
    if (!d3) { host.innerHTML = '<div class="hint">graph renderer unavailable (offline)</div>'; return; }
    const W = host.clientWidth || 360, H = 460;
    host.innerHTML = '';
    const svg = d3.select(host).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).style('touch-action', 'none');
    const g = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.2, 4]).on('zoom', (ev: any) => g.attr('transform', ev.transform)));
    const link = g.append('g').attr('stroke', 'currentColor').attr('stroke-opacity', 0.3).selectAll('line').data(links).join('line')
      .attr('stroke-width', 1).attr('stroke-dasharray', (d: any) => (d.derived ? '3,3' : null));
    const node = g.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
      .on('click', (_e: any, d: any) => { void navigate('workspace.peek', { key: d.id }); });
    node.append('circle').attr('r', (d: any) => 4 + Math.min(13, Math.sqrt(d.deg) * 3))
      .attr('fill', (d: any) => (d.seed ? '#6d5ef0' : 'transparent')).attr('stroke', '#6d5ef0').attr('stroke-width', 1.5);
    node.append('title').text((d: any) => `${d.id} · ${d.deg}`);
    const label = g.append('g').attr('font-size', 9).attr('fill', 'currentColor').attr('opacity', 0.7).selectAll('text')
      .data(nodes.filter((d) => d.seed || d.deg > 2)).join('text').text((d: any) => shortKey(d.id)).attr('dx', 9).attr('dy', 3);
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(64).strength(0.5))
      .force('charge', d3.forceManyBody().strength(-170))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide().radius(18));
    sim.on('tick', () => {
      link.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y).attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      label.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
    node.call(d3.drag()
      .on('start', (ev: any, d: any) => { if (!ev.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (ev: any, d: any) => { d.fx = ev.x; d.fy = ev.y; })
      .on('end', (ev: any, d: any) => { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    setTimeout(() => sim.stop(), 5000); // settle then freeze
  });
}
function renderGraph(d: Record<string, unknown>): string {
  const edges = (Array.isArray(d.edges) ? d.edges : []) as Edge[];
  if (!edges.length) return '<h2>Graph</h2><div class="hint">No edges here.</div>';
  const cap = 120;
  const shown = edges.slice(0, cap);
  const seed = new Set((Array.isArray((d as { _seed?: unknown })._seed) ? (d as { _seed?: string[] })._seed : []) as string[]);
  const slot = 'g' + nextId();
  const note = edges.length > cap ? ` · showing ${cap} of ${edges.length}` : '';
  // Built after innerHTML is live (the slot must exist) — a 0ms task runs post-render.
  setTimeout(() => graphView(slot, shown, seed), 0);
  return `<h2>Graph (${edges.length} edges)</h2><div class="hint">tap a node to open · drag to pan · scroll / pinch to zoom${note}</div><div id="${slot}" class="graph"></div>`;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
function renderAttention(d: Record<string, unknown>): string {
  const stale = (d.stale as Array<{ key: string; updatedAt?: string; type?: string }>) || [];
  const unlinked = (d.unlinked as string[]) || [];
  const dangling = (d.dangling as Array<{ from: string; rel: string; to: string; reason?: string }>) || [];
  // The arrays are capped samples; `*Total` are the real counts. Show the
  // totals in the headers (so a small sample never under-reports), and mark a
  // section "N of Total" when it's truncated.
  const num = (k: string, fallback: number): number => (typeof d[k] === 'number' ? (d[k] as number) : fallback);
  const staleTotal = num('staleTotal', stale.length);
  const unlinkedTotal = num('unlinkedTotal', unlinked.length);
  const danglingTotal = num('danglingTotal', dangling.length);
  const cap = (shown: number, total: number): string => (total > shown ? ` (${shown} of ${total})` : ` (${total})`);
  let h = `<h2>Attention</h2><div class="hint">${staleTotal} stale · ${unlinkedTotal} unlinked · ${danglingTotal} dangling</div>`;
  if (stale.length) h += `<h2>Stale${cap(stale.length, staleTotal)}</h2>` + rowsBlock(stale.map((s) => `<div class="k drill" data-call="read" data-target="workspace.peek" data-input="${esc(JSON.stringify({ key: s.key }))}">${esc(s.key)}${s.type ? ` <span class="ty">${esc(s.type)}</span>` : ''}</div><div class="v">${esc((s.updatedAt || '').slice(0, 10))}</div>`));
  if (unlinked.length) h += `<h2>Unlinked${cap(unlinked.length, unlinkedTotal)}</h2>` + rowsBlock(unlinked.map((k) => `<div class="k drill" data-call="read" data-target="workspace.neighbors" data-input="${esc(JSON.stringify({ key: k }))}">${esc(k)}</div><div class="v"></div>`));
  if (dangling.length) h += `<h2>Dangling${cap(dangling.length, danglingTotal)}</h2>` + rowsBlock(dangling.map((g) => `<div class="k"><span class="ty">${esc(g.rel)}</span> ${esc(g.from)} → ${esc(g.to)}</div><div class="v"><span class="hint">${esc(g.reason || '')}</span></div>`));
  return h;
}
function renderGrantRequests(d: Record<string, unknown>): string {
  const incoming = (d.incoming as Array<{ key: string; requester: string; resource: string; note?: string }>) || [];
  const answers = (d.answers as Array<{ resource: string; status: string; by?: string }>) || [];
  let h = `<h2>Incoming (${incoming.length})</h2>`;
  h += incoming.length ? incoming.map((r) => `<div class="fc"><div class="fc-h"><span class="lb">${esc(r.requester)} → ${esc(r.resource)}</span></div>${r.note ? `<div class="md">${esc(r.note)}</div>` : ''}<div class="chips"><button class="chip act" data-call="act" data-target="workspace.approveGrant" data-input="${esc(JSON.stringify({ key: r.key }))}">approve</button><button class="chip act" data-call="act" data-target="workspace.denyGrant" data-input="${esc(JSON.stringify({ key: r.key }))}">deny</button></div></div>`).join('') : '<div class="hint">none pending</div>';
  h += `<h2>Answers (${answers.length})</h2>`;
  h += answers.length ? rowsBlock(answers.map((a) => `<div class="k">${esc(a.resource)} <span class="ty">${esc(a.status)}</span></div><div class="v"><span class="hint">${esc(a.by || '')}</span></div>`)) : '<div class="hint">none</div>';
  return h;
}
const OP_ICON: Record<string, string> = { write: '✏️', read: '👁', supersede: '🗑', link: '🔗', unlink: '✂️' };
function renderChanges(d: Record<string, unknown>): string {
  const ev = (d.events as Array<{ op: string; key?: string; seq: number; at?: string }>) || [];
  let h = `<h2>Changes</h2><div class="hint">head seq ${esc(d.seq ?? '')}${ev.length ? '' : ' · you are at the head — no newer events'}</div>`;
  if (ev.length) h += rowsBlock(ev.map((e) => `<div class="k${e.key ? ' drill" data-call="read" data-target="workspace.peek" data-input="' + esc(JSON.stringify({ key: e.key })) : ''}">${esc(OP_ICON[e.op] || '•')} <span class="ty">${esc(e.op)}</span> ${esc(e.key || '')}</div><div class="v">${esc((e.at || '').slice(11, 16) || e.seq)}</div>`));
  return h;
}
function renderGrants(d: Record<string, unknown>): string {
  let h = `<h2>Authority</h2><div class="who">${esc(d.principal || '')}</div>`;
  const scope = d.scope as { active?: string[]; ceiling?: string[] } | undefined;
  if (Array.isArray(scope?.active)) h += '<h2>Active scope</h2>' + chips(scope!.active as string[]);
  if (Array.isArray(scope?.ceiling) && JSON.stringify(scope!.ceiling) !== JSON.stringify(scope!.active)) h += '<h2>Ceiling</h2>' + chips(scope!.ceiling as string[]);
  const g = d.grant as { shared?: unknown[]; receiving?: unknown[]; groups?: unknown[] } | undefined;
  if (d.slice) h += `<div class="hint">slice: ${esc(d.slice)}</div>`;
  if (g) h += `<div class="hint">grants — shared ${g.shared?.length || 0} · receiving ${g.receiving?.length || 0} · groups ${g.groups?.length || 0}</div>`;
  return h;
}
function renderView(d: Record<string, unknown>, types: Types): string {
  let h = `<h2>${esc(d.id || 'view')}</h2>`;
  if (d.description) h += `<div class="hint">${esc(d.description)}</div>`;
  if (typeof d.count === 'number') h += `<div class="hint">${esc(d.count)} items</div>`;
  const rh = d.render as { viewer?: string; hint?: string } | null;
  if (rh && rh.viewer) {
    const slot = 'v' + nextId();
    h += `<div id="${slot}"></div>`;
    fetchRenderer(VIEWERS_URI, slot, rh.viewer, d.value);
  } else {
    const name = (rh && rh.hint) || '';
    h += (name && hint(name, d.value)) || hint('fields', d.value) || `<pre>${esc(JSON.stringify(d.value, null, 2)).slice(0, 800)}</pre>`;
  }
  return h;
}
/** $catalog summary `{cells:[{cell,count,capabilities:[{target,kind,summary}]}]}` → a grouped,
 *  skimmable menu; read-kind targets drill (audit: was truncated single-line JSON). */
function renderCatalog(d: Record<string, unknown>): string {
  const cells = (d.cells as Array<{ cell: string; count: number; capabilities: Array<{ target: string; kind: string; summary?: string }> }>) || [];
  let h = `<h2>Capabilities (${cells.reduce((n, c) => n + (c.count || 0), 0)})</h2>`;
  for (const c of cells) {
    h += `<h2>${esc(c.cell)} (${esc(c.count)})</h2>` + rowsBlock(c.capabilities.map((cap) => {
      const drill = cap.kind === 'read' ? ` drill" data-call="read" data-target="${esc(cap.target)}" data-input="{}` : '';
      return `<div class="k${drill}">${esc(cap.target)}${cap.summary ? ` <span class="hint">${esc(cap.summary)}</span>` : ''}</div><div class="v"><span class="ty">${esc(cap.kind)}</span></div>`;
    }), 8);
  }
  return h;
}
/** $types `{types:{<name>:{icon,label,present,…}}}` → the type vocabulary as a list (audit:
 *  rendered as an empty card because the generic fallback skipped the `types` key). */
function renderTypes(d: Record<string, unknown>): string {
  const types = (d.types as Types) || {};
  const names = Object.keys(types);
  return `<h2>Types (${names.length})</h2>` + rowsBlock(names.map((n) => {
    const t = types[n] as { icon?: string; label?: string; render?: { viewer?: string } };
    const sub = t.render && t.render.viewer ? `viewer: ${t.render.viewer}` : (t.label || '');
    return `<div class="k drill" data-call="read" data-target="workspace.query" data-input="${esc(JSON.stringify({ type: n, limit: 25 }))}">${t.icon ? esc(t.icon) + ' ' : ''}${esc(n)}${sub ? ` <span class="hint">${esc(sub)}</span>` : ''}</div><div class="v"></div>`;
  }), 12);
}
/** A "view as graph" affordance shown under a fact list (ADR-0038 Inc 2). */
function graphToggle(): string {
  return lastEntryKeys.length ? `<button class="more-btn" data-graph="1">⊹ view as graph</button>` : '';
}
/** A single fact (peek) + lit-doc assembly + backlinks, both lazily fetched (Inc 3/4).
 *  `peek` omits a top-level `key`, so fall back to the key we requested (currentRead) —
 *  without it the ↹/doc-assembly/backlinks affordances can't fire (audit 2026-06-27). */
function renderSingleFact(d: Record<string, unknown>, types: Types): string {
  const key = (d.key as string) || (currentRead && (currentRead.input as { key?: string })?.key) || '';
  let b = typedCard(key, d as Entry, types, 'slot-one');
  const t = d._meta && (d._meta as { type?: string }).type;
  if (key.indexOf('doc:') === 0 || t === 'doc') { const slot = 'doc' + nextId(); b += `<div id="${slot}"></div>`; lazyDoc(key, slot, types); }
  if (key) { const slot = 'bl' + nextId(); b += `<div id="${slot}"></div>`; lazyBacklinks(key, slot, types); }
  return b;
}
/** Assemble a lit doc from its ordered `members` (host-proxied), rendered in place. */
function lazyDoc(key: string, slot: string, types: Types): void {
  callServer('read', 'workspace.members', { key }).then((r) => {
    const m = r as { members?: Entry[]; types?: Types } | null;
    const el = document.getElementById(slot);
    if (!el || !m || !Array.isArray(m.members) || !m.members.length) return;
    const saved = lastEntryKeys;
    el.innerHTML = `<h2>Document (${m.members.length} blocks)</h2>` + entriesBlock(m.members, m.types || types);
    lastEntryKeys = saved;
    measureClamps();
  }).catch(() => { /* not a collection / degrade */ });
}
/** "Linked from" — inbound references for a fact (host-proxied neighbors, dir:in). */
function lazyBacklinks(key: string, slot: string, types: Types): void {
  callServer('read', 'workspace.neighbors', { key, dir: 'in' }).then((r) => {
    const n = r as { inbound?: Edge[]; entries?: Record<string, Entry>; types?: Types } | null;
    const el = document.getElementById(slot);
    if (!el || !n || !Array.isArray(n.inbound) || !n.inbound.length) return;
    el.innerHTML = `<h2>Linked from (${n.inbound.length})</h2>` + neighborSection(n.inbound, n.entries || {}, n.types || types, true);
    measureClamps();
  }).catch(() => { /* degrade */ });
}
/** Reveal a "show more" only on bodies that actually overflow the clamp; un-clamp the rest.
 *  Runs after innerHTML is live (post-render and after async inline injections). */
function measureClamps(): void {
  for (const node of Array.from(document.querySelectorAll('.clamp'))) {
    const slot = node as HTMLElement;
    const btn = slot.nextElementSibling as HTMLElement | null;
    if (!btn || !btn.classList.contains('clamp-btn')) continue;
    if (slot.scrollHeight - slot.clientHeight > 8) btn.removeAttribute('hidden');
    else slot.classList.remove('clamp');
  }
}
function render(data: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;
  // ADR-0039 Inc 2: a tool RESULT may carry a cell-authored renderer directive
  // (`_render`, stamped by the gateway from the tool's declared `ui`). Run it the
  // same way as a type renderer — same __parcRender consumer — handed the whole
  // result; the generic structured view is the placeholder/degraded fallback.
  const rd = data && typeof data === 'object' ? (data as { _render?: { renderer?: string; as?: string } })._render : null;
  if (rd && typeof rd.renderer === 'string' && rd.renderer.indexOf('ui://') === 0) {
    currentData = data;
    const slot = nextId();
    root.innerHTML = header(viewStack.length > 0) + `<div id="${slot}">${genericStructured(data as Record<string, unknown>)}</div>` + hostBridges();
    fetchRenderer(rd.renderer, slot, rd.as || rd.renderer, data);
    measureClamps();
    return;
  }
  let b = '';
  let rich = false;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const types = (d.types as Types) || {};
    const isNeighbors = Array.isArray(d.outbound) || Array.isArray(d.inbound);
    if (d.overview) b += overview(d.overview as Record<string, unknown>);
    else if (d.user && Array.isArray(d.scopes)) b += whoami(d);
    else if (Array.isArray(d.suggestions) && Array.isArray(d.vocab)) { b += renderSuggestions(d); currentRead = { target: 'workspace.suggestions', input: {} }; }
    else if (isNeighbors) b += renderNeighbors(d, types);
    else if (Array.isArray(d.edges)) b += renderGraph(d);                                  // graph / links
    else if ('stale' in d || 'unlinked' in d || 'dangling' in d) b += renderAttention(d);  // attention
    else if ('incoming' in d || 'answers' in d) { b += renderGrantRequests(d); currentRead = { target: 'workspace.grantRequests', input: {} }; }
    else if ('events' in d && 'seq' in d) b += renderChanges(d);                            // changes
    else if ('principal' in d && 'scope' in d) b += renderGrants(d);                        // grants ($grants)
    else if ('value' in d && 'id' in d && 'count' in d) b += renderView(d, types);          // view
    else if (Array.isArray(d.cells)) b += renderCatalog(d);                                 // $catalog summary
    else if (d.types && Object.keys(d).every((k) => k === 'types' || k === 'hint')) b += renderTypes(d); // $types
    else if (Array.isArray(d.members)) {                                                    // members
      const map: Record<string, Entry> = {};
      for (const m of d.members as Array<Entry & { key?: string }>) map[m.key || nextId()] = m;
      b += `<h2>Members (${(d.members as unknown[]).length})</h2>` + entriesBlock(map, types);
    }
    lastEntryKeys = [];
    if (d.focus) b += '<h2>Focus</h2>' + entriesBlock(d.focus, types) + graphToggle();
    else if (d.entries && !isNeighbors) b += entriesBlock(d.entries, types) + graphToggle();
    else if (d.value && d._meta) b += renderSingleFact(d, types);
    // A "rich" surface = one of the known shapes above fired (or a typed-fact list/
    // single fact, whose own renderers/hints carry the weight). A plain result — a
    // scalar, {ok}, a write confirmation, an opaque object — leaves b empty and
    // collapses to the thin affordance (ADR-0039: the shell stays minimal until a
    // substrate type/tool actually provides a richer surface; the `_render` tool
    // path is handled in the early-return above).
    rich = b.length > 0;
    if (rich) {
      // Short hints (e.g. degraded-search note) help the human; the long model-facing
      // guidance hints ($catalog/$types/$grants) just leak chrome — suppress those (audit).
      if (typeof d.hint === 'string' && d.hint && d.hint.length < 140) b += `<div class="hint">${esc(d.hint)}</div>`;
      if (Array.isArray(d.hints)) b += '<div class="hint">' + (d.hints as string[]).map(esc).join('<br>') + '</div>';
    }
  }
  currentData = data;
  if (rich) {
    root.innerHTML = header(viewStack.length > 0) + b + hostBridges();
  } else {
    root.innerHTML = thinAffordance(data);
  }
  measureClamps();
}
/** The thin default (ADR-0039): a single low-weight line — a dot + a terse summary +
 *  an expand toggle that reveals the raw structured view on demand. Shown when no rich
 *  surface applies, so trivial results (a scalar, {ok}, an act write-confirmation) don't
 *  inflate into a full card. Tap to expand → the generic structured view in place. */
function thinAffordance(data: unknown): string {
  const back = viewStack.length ? '<button class="mini back" data-back="1" title="back">←</button>' : '';
  const id = nextId();
  const raw = data && typeof data === 'object'
    ? genericStructured(data as Record<string, unknown>)
    : `<pre>${esc(String(data))}</pre>`;
  return `<div class="thin">${back}<span class="tdot"></span><span class="tsum">${esc(summarize(data))}</span>`
    + `<button class="texp" data-toggle="${id}" data-more="⌄" data-less="⌃">⌄</button></div>`
    + `<div id="${id}" hidden class="thin-raw">${raw}</div>`;
}
/** A terse one-liner for the thin affordance: the decision-relevant scalar fields, else
 *  the field names. Never the whole payload — that lives behind the expand. */
function summarize(data: unknown): string {
  if (data == null) return 'ok';
  if (typeof data !== 'object') return String(data).slice(0, 100);
  const o = data as Record<string, unknown>;
  const pick = ['ok', 'status', 'op', 'key', 'id', 'target', 'run', 'machine', 'triggered', 'bootstrapped', 'written', 'deleted', 'revoked', 'count', 'total'];
  const parts: string[] = [];
  for (const k of pick) if (k in o && o[k] != null && typeof o[k] !== 'object') parts.push(`${k} ${String(o[k]).slice(0, 40)}`);
  if (parts.length) return parts.slice(0, 3).join(' · ');
  const keys = Object.keys(o).filter((k) => k !== '_render' && k !== 'hint');
  return keys.length ? keys.slice(0, 5).join(', ') : 'result';
}

// ── host channel via the official SDK ────────────────────────────────────────
const app = new App({ name: 'parc.land card', version: '1.0.0' }, {}, { autoResize: true });
let currentRead: { target: string; input: unknown } | null = null;
// Drill history: each forward drill pushes the view it leaves; the header ← pops it.
// Snapshots of rendered data (not re-reads) so back is instant and works for the
// host-pushed top-level view too (audit: no-back-navigation).
let currentData: unknown = null;
const viewStack: unknown[] = [];
// Host capabilities discovered at the ui/initialize handshake (ADR-0037). Tells us which
// view→model bridges this host honours; null until connect() resolves.
let hostCaps: ReturnType<App['getHostCapabilities']> = undefined;

async function callServer(kind: 'read' | 'act', target: string, input: unknown): Promise<unknown> {
  const r = await app.callServerTool({ name: kind, arguments: { target, input } });
  return (r as { structuredContent?: unknown }).structuredContent ?? null;
}
// ── ADR-0037: close the loop — make widget interactions visible to the agent ──
/** Bridge a widget event into the model's context for its NEXT turn (no turn now,
 *  last-write-wins). Silent + best-effort: gated on the host advertising the capability,
 *  swallows rejection. A note TO the model — not a substrate write (that already happened
 *  via the host-proxied act under enforceScope). */
function notifyModel(text: string, structured?: Record<string, unknown>): void {
  if (!hostCaps || !(hostCaps as { updateModelContext?: unknown }).updateModelContext) return;
  app.updateModelContext({ content: [{ type: 'text', text }], ...(structured ? { structuredContent: structured } : {}) }).catch(() => { /* host declined */ });
}
/** A one-line readout of which view→model bridges this host honours — answers, empirically,
 *  what claude.ai supports (ADR-0037 (a)). Subtle footer; '' until connected. */
function hostBridges(): string {
  if (!hostCaps) return '';
  const c = hostCaps as { updateModelContext?: unknown; message?: unknown; sampling?: unknown };
  const f = (ok: unknown): string => (ok ? '✓' : '✗');
  return `<div class="hint">host bridges · ctx ${f(c.updateModelContext)} · msg ${f(c.message)} · sampling ${f(c.sampling)}</div>`;
}
// ── ADR-0039: the FEDERATION consumer — run a cell-authored renderer ──────────
// A cell serves a renderer SCRIPT that self-registers under its type on the shared
// `window.__parcRender` map; the card fetches it once over the host `resources/read`
// proxy (gateway provider hop → owning cell) and injects it as an inline <script>.
// Safe here specifically because the WHOLE CARD already runs inside claude.ai's
// sandboxed, opaque-origin iframe with no ambient parc.land session (ADR-0034) —
// the card injecting into "its own" document still lands inside that sandbox. A
// first-party, session-bearing surface (e.g. home) must NOT do this directly; it
// builds its own child sandbox instead (`platform/ui/federated-renderer`'s
// `mountSandboxedRenderer`, used by the field computer, ADR-0041).
const baseRendererApi = { call: callServer, esc: (s: unknown) => esc(String(s ?? '')), md };
/** Fetch + execute a cell-declared `ui://` renderer for a typed fact; degrade to the
 *  hint render already in the slot on any failure (offline, CSP, cell down). */
function fetchRenderer(uri: string, slot: string, type: string, value: unknown, key?: string): void {
  app.readServerResource({ uri }).then((r) => {
    const src = (r as { contents?: Array<{ text?: string }> }).contents?.[0]?.text;
    const el = document.getElementById(slot);
    if (!el) return;
    void fetchAndRunRenderer(uri, type, el, value, { ...baseRendererApi, key }, async () => (typeof src === 'string' ? src : null));
  }).catch(() => { /* degrade to the hint render already shown */ });
}
// Delegated interactivity: drill (read) / ratify (act) re-render the card IN PLACE —
// progressive disclosure, no new model turn, all under the gateway's enforceScope.
/** Local expand/collapse — reveal an already-rendered hidden block; no server round-trip. */
function toggleHidden(btn: HTMLElement): void {
  const el = document.getElementById(btn.getAttribute('data-toggle') || '');
  if (!el) return;
  if (el.hasAttribute('hidden')) { el.removeAttribute('hidden'); btn.textContent = btn.getAttribute('data-less') || 'show less'; }
  else { el.setAttribute('hidden', ''); btn.textContent = btn.getAttribute('data-more') || 'show more'; }
}
/** Local clamp toggle — expand/collapse a single clamped fact body in place. */
function toggleClamp(btn: HTMLElement): void {
  const el = document.getElementById(btn.getAttribute('data-clamp') || '');
  if (!el) return;
  btn.textContent = el.classList.toggle('open') ? 'show less' : 'show more';
}
/** Peek both facts of a suggestion inline (host-proxied) so a ratification is informed. */
async function peekPair(keys: [string, string], into: HTMLElement, btn: HTMLElement): Promise<void> {
  btn.classList.add('busy');
  try {
    const reads = await Promise.all(keys.map((k) => callServer('read', 'workspace.peek', { key: k })));
    into.innerHTML = keys.map((k, i) => {
      const v = (reads[i] as { value?: unknown } | null)?.value;
      const t = bodyText(v) || (v != null ? JSON.stringify(v) : '(not readable)');
      const sid = 'p' + uid++;
      return `<div class="fc"><div class="fc-h"><span class="lb">${esc(k)}</span></div><div id="${sid}" class="md clamp">${md(String(t).slice(0, 1500))}</div><button class="more-btn clamp-btn" data-clamp="${sid}" hidden>show more</button></div>`;
    }).join('');
    measureClamps();
  } catch { into.innerHTML = '<div class="hint">peek failed</div>'; }
  btn.classList.remove('busy');
}
// ── ADR-0038 Inc 5: grant escalation — surface a teaching denial as an action ──
type Call = { kind: 'read' | 'act'; target: string; input: unknown };
let pendingRetry: Call | null = null;
function errorText(r: unknown): string {
  const c = (r as { content?: Array<{ text?: string }> }).content;
  return (Array.isArray(c) ? c.map((x) => x?.text || '').join(' ') : '') || 'The request failed.';
}
/** Parse enforceScope's teaching denial into an actionable escalation (ADR-0023). */
function parseEscalation(text: string): { mode: 'offer' | 'denied'; scope?: string; url?: string } | null {
  if (text.indexOf('scope_offer:') >= 0) return { mode: 'offer', scope: /needs "([^"]+)"/.exec(text)?.[1] };
  if (text.indexOf('scope_denied:') >= 0) return { mode: 'denied', scope: /requires scope "([^"]+)"/.exec(text)?.[1], url: /(https?:\/\/\S*\/oauth\/authorize\S*)/.exec(text)?.[1] };
  return null;
}
function renderErrorPanel(text: string, escal: ReturnType<typeof parseEscalation>): void {
  const root = document.getElementById('root'); if (!root) return;
  let chips = '';
  if (escal?.mode === 'offer' && escal.scope) chips += `<button class="chip act" data-widen="${esc(escal.scope)}">widen session</button>`;
  if (escal?.mode === 'denied' && escal.url) chips += `<button class="chip act" data-elevate="${esc(escal.url)}">escalate (passkey)</button>`;
  if (pendingRetry) chips += '<button class="chip" data-retry="1">retry</button>';
  const title = escal ? 'Access needed' : 'That didn’t work';
  currentData = null;
  root.innerHTML = header(viewStack.length > 0) + `<div class="fc"><div class="fc-h"><span class="ic">${escal ? '🔒' : '⚠️'}</span><span class="lb">${title}</span></div><div class="md">${md(text.slice(0, 600))}</div>${chips ? `<div class="chips">${chips}</div>` : ''}</div>` + hostBridges();
}
function handleError(r: unknown, orig: Call): void {
  const text = errorText(r);
  const escal = parseEscalation(text);
  if (escal) { pendingRetry = orig; if (escal.mode === 'offer') notifyModel(`A "${orig.target}" call needs scope "${escal.scope}" (within grant); the user was offered a one-tap widen.`, { event: 'scope_offer', ...orig }); else notifyModel(`A "${orig.target}" call was denied (scope "${escal.scope}" exceeds the token ceiling); the user was offered grant elevation.`, { event: 'scope_denied', ...orig }); }
  viewStack.push(currentData);
  renderErrorPanel(text, escal);
}
/** Host-proxied read that re-renders + records the navigation; routes errors to escalation. */
async function navigate(target: string, input: unknown): Promise<void> {
  const r = await app.callServerTool({ name: 'read', arguments: { target, input } });
  if ((r as { isError?: boolean }).isError) { handleError(r, { kind: 'read', target, input }); return; }
  const sc = (r as { structuredContent?: unknown }).structuredContent ?? null;
  // NB: no ambient "viewing" context push here — updateModelContext is last-write-wins, so
  // a per-drill note would clobber a meaningful act (e.g. ratify) before the next user
  // message delivers it (audit 2026-06-27). Only acts (decisions) bridge to the model.
  if (sc) { viewStack.push(currentData); currentRead = { target, input }; render(sc); }
}
/** Host-proxied act → notify the agent → refresh the current view; errors → escalation. */
async function perform(target: string, input: unknown): Promise<void> {
  const r = await app.callServerTool({ name: 'act', arguments: { target, input } });
  if ((r as { isError?: boolean }).isError) { handleError(r, { kind: 'act', target, input }); return; }
  notifyModel(`The user performed ${target} with ${JSON.stringify(input)} in the parc.land card (the substrate write has been applied).`, { event: 'act', target, input });
  const rr = currentRead || { target: 'workspace.suggestions', input: {} };
  const sc = await callServer('read', rr.target, rr.input);
  if (sc) render(sc);
}
async function retryPending(): Promise<void> {
  if (!pendingRetry) return;
  const p = pendingRetry; pendingRetry = null;
  if (p.kind === 'read') await navigate(p.target, p.input); else await perform(p.target, p.input);
}
/** Graph mode (Inc 2): the current result set as a node-link graph — its authored edges
 *  plus next neighbours (one hop). Reads all slice edges once and filters to the set. */
async function showGraphOf(keys: string[]): Promise<void> {
  const set = new Set(keys);
  const r = await callServer('read', 'workspace.links', {}) as { edges?: Edge[] } | null;
  const edges = (r && Array.isArray(r.edges) ? r.edges : []).filter((e) => set.has(e.from) || set.has(e.to));
  viewStack.push(currentData);
  render({ edges, _seed: keys }); // seed = the result set; one-hop neighbours render outlined
}
document.addEventListener('click', async (ev) => {
  const tgt = ev.target as HTMLElement;
  const tog = tgt?.closest?.('[data-toggle]') as HTMLElement | null;
  if (tog) { ev.preventDefault(); toggleHidden(tog); return; }
  const clmp = tgt?.closest?.('[data-clamp]') as HTMLElement | null;
  if (clmp) { ev.preventDefault(); toggleClamp(clmp); return; }
  const back = tgt?.closest?.('[data-back]') as HTMLElement | null;
  if (back) { ev.preventDefault(); if (viewStack.length) render(viewStack.pop()); return; }
  const pk = tgt?.closest?.('[data-peek]') as HTMLElement | null;
  if (pk) {
    ev.preventDefault();
    const into = document.getElementById(pk.getAttribute('data-into') || '');
    if (into && !into.innerHTML) { try { await peekPair(JSON.parse(pk.getAttribute('data-peek') || '[]'), into, pk); } catch { /* ignore */ } }
    else if (into) into.innerHTML = ''; // toggle off
    return;
  }
  // Escalation actions (Inc 5)
  const widen = tgt?.closest?.('[data-widen]') as HTMLElement | null;
  if (widen) { ev.preventDefault(); widen.classList.add('busy'); const s = widen.getAttribute('data-widen') || ''; try { const r = await app.callServerTool({ name: 'act', arguments: { target: 'auth.requestScope', input: { scopes: [s] } } }); if (!(r as { isError?: boolean }).isError) { notifyModel(`The user widened the session scope to include "${s}".`, { event: 'widen', scope: s }); await retryPending(); } else widen.classList.remove('busy'); } catch { widen.classList.remove('busy'); } return; }
  const elev = tgt?.closest?.('[data-elevate]') as HTMLElement | null;
  if (elev) { ev.preventDefault(); const u = elev.getAttribute('data-elevate') || ''; app.openLink({ url: u }).catch(() => { /* host declined */ }); notifyModel(`The user was sent to ${u} to elevate their grant (passkey approval); they can retry after approving.`, { event: 'elevate' }); return; }
  const retry = tgt?.closest?.('[data-retry]') as HTMLElement | null;
  if (retry) { ev.preventDefault(); retry.classList.add('busy'); await retryPending(); return; }
  // Graph mode (Inc 2)
  const graph = tgt?.closest?.('[data-graph]') as HTMLElement | null;
  if (graph) { ev.preventDefault(); graph.classList.add('busy'); await showGraphOf(lastEntryKeys.slice()); return; }
  // In-card link navigation (Inc 3): wiki/substrate links peek in place; external → openLink.
  const wl = tgt?.closest?.('a[data-key]') as HTMLElement | null;
  if (wl) { ev.preventDefault(); await navigate('workspace.peek', { key: wl.getAttribute('data-key') }); return; }
  const ext = tgt?.closest?.('a[href^="http"]') as HTMLAnchorElement | null;
  if (ext) { ev.preventDefault(); app.openLink({ url: ext.href }).catch(() => { /* host declined */ }); return; }
  // Drill (read) / act
  const el = tgt?.closest?.('[data-call]') as HTMLElement | null;
  if (!el) return;
  ev.preventDefault();
  const kind = (el.getAttribute('data-call') === 'act' ? 'act' : 'read') as 'read' | 'act';
  const target = el.getAttribute('data-target') || '';
  let input: unknown = {};
  try { input = JSON.parse(el.getAttribute('data-input') || '{}'); } catch { /* default {} */ }
  el.classList.add('busy');
  try { if (kind === 'read') await navigate(target, input); else await perform(target, input); }
  finally { el.classList.remove('busy'); }
});

// A fresh top-level result from the host resets the drill history.
app.addEventListener('toolresult', (params) => { viewStack.length = 0; render((params as { structuredContent?: unknown }).structuredContent); });
app.connect().then(() => {
  // ADR-0037 (a): probe + record which view→model bridges the host honours.
  hostCaps = app.getHostCapabilities();
  const c = (hostCaps || {}) as { updateModelContext?: unknown; message?: unknown; sampling?: unknown };
  app.sendLog({ level: 'info', logger: 'parc.card', data: `host bridges: updateModelContext=${!!c.updateModelContext} message=${!!c.message} sampling=${!!c.sampling}` }).catch(() => { /* logging not supported */ });
  if (currentData != null) render(currentData); // repaint footer now that caps are known
}).catch(() => { /* not in a host */ });
