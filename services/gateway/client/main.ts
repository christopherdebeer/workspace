/**
 * The parc.land conversation widget (ADR-0034/0035/0036) — the browser bundle behind
 * `ui://parc/card`, esbuilt to `app.js` and inlined by the gateway. Uses the SHARED
 * render vocabulary (`platform/ui/render-hints` + `marked`) AND REUSES the `viewers`
 * cell's renderers (json tree / csv table / mermaid) — the same modules canvas + lit
 * use — so a typed fact renders the same way on every surface (ADR-0036). Machines
 * render their run trace as a mermaid flowchart.
 *
 * MCP client to the HOST (spec 2026-01-26): handshake (ui/initialize → initialized) →
 * render the structuredContent the host pushes. Cell-declared `ui://` renderers are
 * fetched over the host resources/read proxy (ADR-0034 Inc 2′), falling back to the hint.
 * Sizing: the spec leaves frame size to the host, so we report ours via window.mcpApp
 * .resize(), a ResizeObserver, and ui-size-change messages — whichever the host honours.
 */
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
function typedCard(key: string, entry: Entry, types: Types, slot: string): string {
  const t = (entry && entry._meta && entry._meta.type) || null;
  const aff = (t && types && types[t]) || {};
  const label = (aff.label && resolvePath(entry, aff.label)) || (entry.value as Record<string, unknown>)?.title || (entry.value as Record<string, unknown>)?.name || key;
  const rh = aff.handlers && aff.handlers.render && aff.handlers.render[0];
  const viewer = aff.render && aff.render.viewer;
  let body = '';
  if (viewer && VIEWERS[viewer]) {
    mounts.push({ slot, view: VIEWERS[viewer], content: viewerContent(viewer, entry.value) }); // reuse the viewers cell
  } else if (t === 'machine-run' && entry.value && typeof entry.value === 'object') {
    mounts.push({ slot, view: vwMermaid as ElView, content: machineRunMermaid(entry.value as Record<string, unknown>) });
  } else if (rh && typeof rh.renderer === 'string' && rh.renderer.indexOf('ui://') === 0) {
    fetchRenderer(rh.renderer, slot); // (ADR-0034 Inc 2′) cell-declared renderer over the host proxy
    body = hint('fields', entry.value);
  } else {
    body = rh && rh.hint ? hint(rh.hint, entry.value) : '';
    if (!body) body = hint('fields', entry.value) || `<pre>${esc(JSON.stringify(entry.value, null, 2)).slice(0, 800)}</pre>`;
  }
  const sc = entry && entry._meta && typeof entry._meta.score === 'number' ? entry._meta.score.toFixed(2) : '';
  return `<div class="fc"><div class="fc-h"><span class="ic">${esc(aff.icon || '•')}</span><span class="lb">${esc(String(label).slice(0, 100))}</span><span class="sp"></span>${t ? `<span class="ty">${esc(t)}</span>` : ''}${sc ? `<span class="sc">${sc}</span>` : ''}</div><div id="${slot}">${body}</div></div>`;
}
function entriesBlock(map: Record<string, Entry>, types: Types): string {
  return Object.keys(map).map((k, i) => typedCard(k, map[k], types, 'slot-' + i)).join('');
}
function overview(o: Record<string, unknown>): string {
  let h = '';
  const bands = o.bands as Record<string, number> | undefined;
  if (bands) h += '<h2>Salience</h2><div class="bands">' + (['focus', 'peripheral', 'elided'] as const).map((b) => `<div class="band"><b>${esc(bands[b])}</b><span>${b}</span></div>`).join('') + '</div>';
  if (typeof o.total === 'number') h += `<div class="hint">${esc(o.total)} facts${o.granted ? ' · ' + esc(o.granted) + ' granted' : ''}</div>`;
  if (Array.isArray(o.byType)) h += '<h2>By type</h2>' + rowList((o.byType as Array<{ type: string; count: number }>).map((t) => [t.type || '(untyped)', t.count]));
  if (Array.isArray(o.byPrefix)) h += '<h2>By prefix</h2>' + rowList((o.byPrefix as Array<{ prefix: string; count: number }>).map((p) => [p.prefix, p.count]));
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
    if (d.focus) b += '<h2>Focus</h2>' + entriesBlock(d.focus as Record<string, Entry>, types);
    else if (d.entries) b += entriesBlock(d.entries as Record<string, Entry>, types);
    else if (d.value && d._meta) b += typedCard((d.key as string) || '', d as Entry, types, 'slot-one');
    if (!b) b = `<pre>${esc(JSON.stringify(d, null, 2))}</pre>`;
    if (Array.isArray(d.hints)) b += '<div class="hint">' + (d.hints as string[]).map(esc).join('<br>') + '</div>';
  }
  root.innerHTML = header() + b;
  // Mount reused viewers (json/csv/mermaid) into their slots after the HTML is in place.
  for (const m of mounts) {
    const el = document.getElementById(m.slot);
    if (el) { el.innerHTML = ''; try { el.appendChild(m.view.mount({ id: m.slot, content: m.content })); } catch { /* viewer self-reports errors */ } }
  }
  reportSize();
}

// ── sizing (the spec leaves frame size to the host; report ours every way) ───
function reportSize(): void {
  const h = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const w = document.documentElement.scrollWidth;
  const host = (window as unknown as { mcpApp?: { resize?: (w: number, h: number) => void } }).mcpApp;
  try { if (host && typeof host.resize === 'function') host.resize(w, h); } catch { /* host opt */ }
  try { window.parent.postMessage({ type: 'ui-size-change', height: h, width: w }, '*'); } catch { /* mcp-ui style */ }
  try { window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-change', params: { height: h, width: w } }, '*'); } catch { /* spec-ish */ }
}
try { new ResizeObserver(() => reportSize()).observe(document.body); } catch { /* no RO */ }

// ── MCP-Apps host channel (spec 2026-01-26) ──────────────────────────────────
const INIT_ID = 1;
let inited = false;
let rid = 100;
const pending: Record<number, (v: unknown) => void> = {};
function send(msg: Record<string, unknown>): void {
  try { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); } catch { /* sandbox */ }
}
function request(method: string, params: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const id = ++rid;
    pending[id] = resolve;
    send({ id, method, params });
    setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(null); } }, 4000);
  });
}
function fetchRenderer(uri: string, slot: string): void {
  request('resources/read', { uri }).then((r) => {
    const c = (r as { contents?: Array<{ text?: string }> })?.contents?.[0];
    if (!c || !c.text) return; // degrade to the hint render already shown
    const el = document.getElementById(slot);
    if (el) { el.innerHTML = c.text; reportSize(); }
  });
}
window.addEventListener('message', (ev: MessageEvent) => {
  const m = ev.data as { jsonrpc?: string; id?: number; result?: unknown; method?: string; params?: { structuredContent?: unknown } };
  if (!m || m.jsonrpc !== '2.0') return;
  if (m.id != null && pending[m.id]) { const cb = pending[m.id]; delete pending[m.id]; cb(m.result ?? null); return; }
  if (!inited && m.id === INIT_ID && m.result) { inited = true; send({ method: 'ui/notifications/initialized' }); return; }
  if (m.method === 'ui/notifications/tool-result' && m.params) render(m.params.structuredContent);
});
send({ id: INIT_ID, method: 'ui/initialize', params: { capabilities: {}, clientInfo: { name: 'parc.land card', version: '1.0.0' }, protocolVersion: '2026-01-26' } });
