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

function header(): string {
  return '<div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div>';
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
/** Rows that drill: clicking issues a host-proxied read (query by type/prefix) + re-renders.
 *  Progressive: only the first `cap` rows show; the rest collapse behind a "+N more" toggle. */
function drillRows(pairs: Array<[string, unknown]>, input: (k: string) => unknown, cap = 6): string {
  const row = ([k, v]: [string, unknown]): string =>
    `<div class="k drill" data-call="read" data-target="workspace.query" data-input="${esc(JSON.stringify(input(String(k))))}">${esc(k)}</div><div class="v">${esc(v)}</div>`;
  const head = `<div class="rows">${pairs.slice(0, cap).map(row).join('')}</div>`;
  if (pairs.length <= cap) return head;
  const id = nextId();
  return head + `<div id="${id}" hidden><div class="rows">${pairs.slice(cap).map(row).join('')}</div></div>` + toggleBtn(id, `+${pairs.length - cap} more`);
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
    return `<div class="fc"><div class="fc-h"><span class="lb">${esc(c.fromLabel || c.from)} ↔ ${esc(c.toLabel || c.to)}</span><span class="sp"></span><span class="sc">${score}</span></div><div class="chips"><span class="hint">ratify as</span> ${chips2}</div></div>`;
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
function render(data: unknown): void {
  const root = document.getElementById('root');
  if (!root) return;
  mounts = [];
  let b = '';
  if (!data || typeof data !== 'object') b = `<pre>${esc(String(data))}</pre>`;
  else {
    const d = data as Record<string, unknown>;
    const types = (d.types as Types) || {};
    if (d.overview) b += overview(d.overview as Record<string, unknown>);
    else if (d.user && Array.isArray(d.scopes)) b += whoami(d);
    else if (Array.isArray(d.suggestions) && Array.isArray(d.vocab)) { b += renderSuggestions(d); currentRead = { target: 'workspace.suggestions', input: {} }; }
    if (d.focus) b += '<h2>Focus</h2>' + entriesBlock(d.focus as Record<string, Entry>, types);
    else if (d.entries) b += entriesBlock(d.entries as Record<string, Entry>, types);
    else if (d.value && d._meta) b += typedCard((d.key as string) || '', d as Entry, types, 'slot-one');
    if (!b) b = `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
    if (Array.isArray(d.hints)) b += '<div class="hint">' + (d.hints as string[]).map(esc).join('<br>') + '</div>';
  }
  root.innerHTML = header() + b;
  for (const m of mounts) {
    const el = document.getElementById(m.slot);
    if (el) { el.innerHTML = ''; try { el.appendChild(m.view.mount({ id: m.slot, content: m.content })); } catch { /* viewer self-reports errors */ } }
  }
  // Reveal a "show more" only on bodies that actually overflow the clamp; un-clamp the rest.
  for (const node of Array.from(document.querySelectorAll('.clamp'))) {
    const slot = node as HTMLElement;
    const btn = slot.nextElementSibling as HTMLElement | null;
    if (!btn || !btn.classList.contains('clamp-btn')) continue;
    if (slot.scrollHeight - slot.clientHeight > 8) btn.removeAttribute('hidden');
    else slot.classList.remove('clamp');
  }
}

// ── host channel via the official SDK ────────────────────────────────────────
const app = new App({ name: 'parc.land card', version: '1.0.0' }, {}, { autoResize: true });
let currentRead: { target: string; input: unknown } | null = null;

async function callServer(kind: 'read' | 'act', target: string, input: unknown): Promise<unknown> {
  const r = await app.callServerTool({ name: kind, arguments: { target, input } });
  return (r as { structuredContent?: unknown }).structuredContent ?? null;
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
document.addEventListener('click', async (ev) => {
  const tgt = ev.target as HTMLElement;
  const tog = tgt?.closest?.('[data-toggle]') as HTMLElement | null;
  if (tog) { ev.preventDefault(); toggleHidden(tog); return; }
  const clmp = tgt?.closest?.('[data-clamp]') as HTMLElement | null;
  if (clmp) { ev.preventDefault(); toggleClamp(clmp); return; }
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
      currentRead = { target, input };
      if (sc) render(sc);
    } else {
      await callServer('act', target, input);
      const rr = currentRead || { target: 'workspace.suggestions', input: {} };
      const sc = await callServer('read', rr.target, rr.input);
      if (sc) render(sc);
    }
  } catch { el.classList.remove('busy'); }
});

app.addEventListener('toolresult', (params) => render((params as { structuredContent?: unknown }).structuredContent));
app.connect().catch(() => { /* not in a host */ });
