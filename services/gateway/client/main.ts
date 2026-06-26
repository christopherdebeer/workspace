/**
 * The parc.land conversation widget (ADR-0034/0035) — the browser bundle behind the
 * `ui://parc/card` MCP-Apps resource. esbuilt to `app.js` (HttpServiceCell clientEntry)
 * and inlined by the gateway into the widget HTML. Uses the SHARED render vocabulary
 * (`platform/ui/render-hints`) — the same rules the home cell uses — with real markdown
 * via `marked`, so the card is no longer a "too basic" vanilla re-implementation.
 *
 * The widget is an MCP client to the HOST (spec 2026-01-26): handshake first
 * (ui/initialize → initialized), then render the structuredContent the host pushes via
 * ui/notifications/tool-result. Cell-declared `ui://` renderers are fetched over the
 * host resources/read proxy (ADR-0034 Inc 2′) with a fallback to the hint render.
 */
import { marked } from 'marked';
import { hintToHtml, bodyText, resolvePath, escapeHtml } from '../../../platform/ui/render-hints';

marked.setOptions({ gfm: true, breaks: false });
const esc = escapeHtml;
const md = (s: string): string => marked.parse(s.replace(/\r\n/g, '\n'), { async: false }) as string;
const hint = (h: string, v: unknown): string => hintToHtml(h, v, { md, esc });

type Entry = { value?: unknown; _meta?: { type?: string | null; score?: number } };
type Types = Record<string, { icon?: string; label?: string; handlers?: { render?: Array<{ hint?: string; renderer?: string }> } }>;

function header(): string {
  return '<div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div>';
}
function chips(arr: string[]): string {
  return '<div class="chips">' + arr.map((s) => `<span class="chip">${esc(s)}</span>`).join('') + '</div>';
}
function rowList(pairs: Array<[string, unknown]>): string {
  return '<div class="rows">' + pairs.map(([k, v]) => `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>`).join('') + '</div>';
}

/** One fact rendered by its TYPE affordance: icon + label + present.render hint body. */
function typedCard(key: string, entry: Entry, types: Types, slot: string): string {
  const t = (entry && entry._meta && entry._meta.type) || null;
  const aff = (t && types && types[t]) || {};
  const label = (aff.label && resolvePath(entry, aff.label)) || (entry.value as Record<string, unknown>)?.title || (entry.value as Record<string, unknown>)?.name || key;
  const rh = aff.handlers && aff.handlers.render && aff.handlers.render[0];
  let body = rh && rh.hint ? hint(rh.hint, entry.value) : '';
  if (!body) body = hint('fields', entry.value) || `<pre>${esc(JSON.stringify(entry.value, null, 2)).slice(0, 800)}</pre>`;
  const sc = entry && entry._meta && typeof entry._meta.score === 'number' ? entry._meta.score.toFixed(2) : '';
  // (2) bespoke cell renderer: a type may declare a ui:// renderer — fetch + inject it.
  if (rh && typeof rh.renderer === 'string' && rh.renderer.indexOf('ui://') === 0) fetchRenderer(rh.renderer, slot);
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
}

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
    if (el) el.innerHTML = c.text; // cell renderer markup (innerHTML won't execute scripts)
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
