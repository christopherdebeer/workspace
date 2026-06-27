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
 * Rendering reuses the SHARED render vocabulary (`platform/ui/render-hints` + `marked`)
 * and the `viewers` cell renderers (json/csv/mermaid) — the same modules home/canvas/lit
 * use — so a typed fact renders identically on every surface (ADR-0036).
 */
import { App } from '@modelcontextprotocol/ext-apps';
import { marked } from 'marked';
import { hintToHtml, bodyText, resolvePath, escapeHtml } from '../../../platform/ui/render-hints';
import { json as vwJson, csv as vwCsv, mermaid as vwMermaid } from '../../../cells/viewers/client/main';

marked.setOptions({ gfm: true, breaks: false });
const esc = escapeHtml;
const md = (s: string): string => marked.parse(s.replace(/\r\n/g, '\n'), { async: false }) as string;
const hint = (h: string, v: unknown): string => hintToHtml(h, v, { md, esc });

type ElView = { mount(el: { id: string; content: string }): HTMLElement };
const VIEWERS: Record<string, ElView> = { json: vwJson as ElView, csv: vwCsv as ElView, mermaid: vwMermaid as ElView };

type Entry = { value?: unknown; _meta?: { type?: string | null; score?: number } };
type Types = Record<string, { icon?: string; label?: string; render?: { viewer?: string }; handlers?: { render?: Array<{ hint?: string; renderer?: string }> } }>;

/** Viewer mounts queued during string render, applied after innerHTML is set. */
let mounts: Array<{ slot: string; view: ElView; content: string }> = [];

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
function viewerContent(name: string, value: unknown): string {
  if (name === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return bodyText(value) || (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
function mmEsc(s: unknown): string {
  return String(s).replace(/["\n|]/g, ' ');
}
/** A machine-run's trace → a mermaid flowchart with the current node highlighted. */
function machineRunMermaid(v: Record<string, unknown>): string {
  let trace = Array.isArray(v.trace) ? (v.trace as Array<{ node?: string; via?: string }>) : [];
  if (!trace.length && v.node) trace = [{ node: v.node as string }];
  const lines = ['flowchart TD'];
  for (let i = 0; i < trace.length; i++) {
    const lbl = mmEsc(trace[i].node || '?');
    if (i > 0) {
      const via = trace[i].via ? `|${mmEsc(trace[i].via)}|` : '';
      lines.push(`  n${i - 1} -->${via} n${i}["${lbl}"]`);
    } else lines.push(`  n0["${lbl}"]`);
  }
  let cur = -1;
  for (let j = trace.length - 1; j >= 0; j--) if (trace[j].node === v.node) { cur = j; break; }
  if (cur < 0) cur = trace.length - 1;
  if (cur >= 0) { lines.push('  classDef cur fill:#6d5ef0,color:#fff,stroke:#6d5ef0;'); lines.push(`  class n${cur} cur;`); }
  return lines.join('\n');
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
  if (viewer && VIEWERS[viewer]) {
    mounts.push({ slot, view: VIEWERS[viewer], content: viewerContent(viewer, entry.value) });
  } else if (t === 'machine-run' && entry.value && typeof entry.value === 'object') {
    mounts.push({ slot, view: vwMermaid as ElView, content: machineRunMermaid(entry.value as Record<string, unknown>) });
  } else if (rh && typeof rh.renderer === 'string' && rh.renderer.indexOf('ui://') === 0) {
    fetchRenderer(rh.renderer, slot);
    body = hint('fields', entry.value);
  } else {
    body = rh && rh.hint ? hint(rh.hint, entry.value) : '';
    if (!body) body = hint('fields', entry.value) || `<pre>${esc(JSON.stringify(entry.value, null, 2)).slice(0, 800)}</pre>`;
  }
  const sc = entry && entry._meta && typeof entry._meta.score === 'number' ? entry._meta.score.toFixed(2) : '';
  const nav = key ? `<button class="mini" title="neighbors" data-call="read" data-target="workspace.neighbors" data-input="${esc(JSON.stringify({ key }))}">↹</button>` : '';
  // Clamp only TEXT bodies (md/code/fields/pre) in list contexts — viewer/machine-run
  // mounts fill the slot later (body === '') and must not be height-capped.
  const showClamp = clamp && !!body;
  const clampBtn = showClamp ? `<button class="more-btn clamp-btn" data-clamp="${slot}" hidden>show more</button>` : '';
  return `<div class="fc"><div class="fc-h"><span class="ic">${esc(aff.icon || '•')}</span><span class="lb">${esc(String(label).slice(0, 100))}</span><span class="sp"></span>${t ? `<span class="ty">${esc(t)}</span>` : ''}${sc ? `<span class="sc">${sc}</span>` : ''}${nav}</div><div id="${slot}"${showClamp ? ' class="clamp"' : ''}>${body}</div>${clampBtn}</div>`;
}
/** A fact list, rendered GLANCEABLE: clamped cards, capped to a head + "+N more". */
function entriesBlock(map: Record<string, Entry>, types: Types, cap = 5): string {
  const cards = Object.keys(map).map((k, i) => typedCard(k, map[k], types, 'slot-' + i, true));
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
/** A node-link graph (graph/links `{edges}`) as a mermaid diagram — authored edges solid,
 *  derived dashed. Capped for legibility (ADR-0038 Inc 2 cheap cut; D3 follow-up later). */
function graphMermaid(edges: Edge[]): string {
  const ids = new Map<string, string>();
  const nid = (k: string): string => { if (!ids.has(k)) ids.set(k, 'n' + ids.size); return ids.get(k) as string; };
  const short = (k: string): string => (k.length > 24 ? k.slice(0, 22) + '…' : k);
  const lines = ['flowchart LR'];
  for (const e of edges) {
    const arrow = e.derived ? '-.->' : '-->';
    const lbl = e.rel ? `|${mmEsc(e.rel)}|` : '';
    lines.push(`  ${nid(e.from)}["${mmEsc(short(e.from))}"] ${arrow}${lbl} ${nid(e.to)}["${mmEsc(short(e.to))}"]`);
  }
  return lines.join('\n');
}
function renderGraph(d: Record<string, unknown>): string {
  const edges = (Array.isArray(d.edges) ? d.edges : []) as Edge[];
  if (!edges.length) return '<h2>Graph</h2><div class="hint">No edges in this slice.</div>';
  const cap = 50;
  const shown = edges.slice(0, cap);
  const slot = 'g' + nextId();
  mounts.push({ slot, view: vwMermaid as ElView, content: graphMermaid(shown) });
  const note = edges.length > cap ? `<div class="hint">showing ${cap} of ${edges.length} edges</div>` : '';
  return `<h2>Graph (${edges.length} edges)</h2>${note}<div id="${slot}"></div>`;
}
function renderAttention(d: Record<string, unknown>): string {
  const stale = (d.stale as Array<{ key: string; updatedAt?: string; type?: string }>) || [];
  const unlinked = (d.unlinked as string[]) || [];
  const dangling = (d.dangling as Array<{ from: string; rel: string; to: string; reason?: string }>) || [];
  let h = `<h2>Attention</h2><div class="hint">${stale.length} stale · ${unlinked.length} unlinked · ${dangling.length} dangling</div>`;
  if (stale.length) h += `<h2>Stale (${stale.length})</h2>` + rowsBlock(stale.map((s) => `<div class="k drill" data-call="read" data-target="workspace.peek" data-input="${esc(JSON.stringify({ key: s.key }))}">${esc(s.key)}${s.type ? ` <span class="ty">${esc(s.type)}</span>` : ''}</div><div class="v">${esc((s.updatedAt || '').slice(0, 10))}</div>`));
  if (unlinked.length) h += `<h2>Unlinked (${unlinked.length})</h2>` + rowsBlock(unlinked.map((k) => `<div class="k drill" data-call="read" data-target="workspace.neighbors" data-input="${esc(JSON.stringify({ key: k }))}">${esc(k)}</div><div class="v"></div>`));
  if (dangling.length) h += `<h2>Dangling (${dangling.length})</h2>` + rowsBlock(dangling.map((g) => `<div class="k"><span class="ty">${esc(g.rel)}</span> ${esc(g.from)} → ${esc(g.to)}</div><div class="v"><span class="hint">${esc(g.reason || '')}</span></div>`));
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
function renderChanges(d: Record<string, unknown>): string {
  const ev = (d.events as Array<{ op: string; key?: string; seq: number }>) || [];
  let h = `<h2>Changes</h2><div class="hint">head seq ${esc(d.seq ?? '')}</div>`;
  h += ev.length ? rowsBlock(ev.map((e) => `<div class="k${e.key ? ' drill" data-call="read" data-target="workspace.peek" data-input="' + esc(JSON.stringify({ key: e.key })) : ''}"><span class="ty">${esc(e.op)}</span> ${esc(e.key || '')}</div><div class="v">${esc(e.seq)}</div>`)) : '<div class="hint">no events</div>';
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
  if (rh && rh.viewer && VIEWERS[rh.viewer]) {
    const slot = 'v' + nextId();
    mounts.push({ slot, view: VIEWERS[rh.viewer], content: viewerContent(rh.viewer, d.value) });
    h += `<div id="${slot}"></div>`;
  } else {
    const name = (rh && rh.hint) || '';
    h += (name && hint(name, d.value)) || hint('fields', d.value) || `<pre>${esc(JSON.stringify(d.value, null, 2)).slice(0, 800)}</pre>`;
  }
  return h;
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
  mounts = [];
  let b = '';
  if (!data || typeof data !== 'object') b = `<pre>${esc(String(data))}</pre>`;
  else {
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
    else if (Array.isArray(d.members)) {                                                    // members
      const map: Record<string, Entry> = {};
      for (const m of d.members as Array<Entry & { key?: string }>) map[m.key || nextId()] = m;
      b += `<h2>Members (${(d.members as unknown[]).length})</h2>` + entriesBlock(map, types);
    }
    if (d.focus) b += '<h2>Focus</h2>' + entriesBlock(d.focus as Record<string, Entry>, types);
    else if (d.entries && !isNeighbors) b += entriesBlock(d.entries as Record<string, Entry>, types);
    else if (d.value && d._meta) b += typedCard((d.key as string) || '', d as Entry, types, 'slot-one');
    if (!b) b = genericStructured(d);
    if (Array.isArray(d.hints)) b += '<div class="hint">' + (d.hints as string[]).map(esc).join('<br>') + '</div>';
  }
  b += hostBridges();
  currentData = data;
  root.innerHTML = header(viewStack.length > 0) + b;
  for (const m of mounts) {
    const el = document.getElementById(m.slot);
    if (el) { el.innerHTML = ''; try { el.appendChild(m.view.mount({ id: m.slot, content: m.content })); } catch { /* viewer self-reports errors */ } }
  }
  measureClamps();
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
/** (ADR-0034 Inc 2′) fetch a cell-declared ui:// renderer over the host proxy + inject it. */
function fetchRenderer(uri: string, slot: string): void {
  app.readServerResource({ uri }).then((r) => {
    const c = (r as { contents?: Array<{ text?: string }> }).contents?.[0];
    if (!c || typeof c.text !== 'string') return; // degrade to the hint render already shown
    const el = document.getElementById(slot);
    if (el) el.innerHTML = c.text;
  }).catch(() => { /* degrade */ });
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
  const el = tgt?.closest?.('[data-call]') as HTMLElement | null;
  if (!el) return;
  ev.preventDefault();
  const kind = (el.getAttribute('data-call') === 'act' ? 'act' : 'read') as 'read' | 'act';
  const target = el.getAttribute('data-target') || '';
  let input: unknown = {};
  try { input = JSON.parse(el.getAttribute('data-input') || '{}'); } catch { /* default {} */ }
  el.classList.add('busy');
  try {
    if (kind === 'read') {
      const sc = await callServer('read', target, input);
      if (sc) {
        viewStack.push(currentData); currentRead = { target, input }; render(sc);
        // Ambient awareness: tell the agent what the human is now looking at (ADR-0037).
        notifyModel(`The user is viewing ${target}${input && Object.keys(input as object).length ? ' ' + JSON.stringify(input) : ''} in the parc.land card.`, { event: 'view', target, input });
      } else el.classList.remove('busy');
    } else {
      await callServer('act', target, input);
      // Decision made in the UI → make the agent aware without a substrate re-scan (ADR-0037).
      notifyModel(`The user performed ${target} with ${JSON.stringify(input)} in the parc.land card (the substrate write has been applied).`, { event: 'act', target, input });
      const rr = currentRead || { target: 'workspace.suggestions', input: {} };
      const sc = await callServer('read', rr.target, rr.input);
      if (sc) render(sc); else el.classList.remove('busy');
    }
  } catch { el.classList.remove('busy'); }
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
