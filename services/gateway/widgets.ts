/**
 * MCP-Apps widgets (ADR-0034) — the tier-0 "floor": generic, self-contained HTML
 * resources the gateway serves at `ui://parc/<id>` and binds to tool results via
 * `_meta.ui.resourceUri`. A widget renders the tool result's `structuredContent`;
 * the model still gets the text channel (ADR-0033), so a non-supporting client
 * loses nothing.
 *
 * NOTE (verify before relying on live rendering): the exact host→iframe data API
 * for `io.modelcontextprotocol/ui` is recent and not yet confirmed against the
 * claude.ai client. The `card` widget below defensively reads the tool output from
 * the known candidate channels (a host global and a postMessage init), and renders
 * a readable fallback if none arrive — so it degrades visibly rather than blank.
 */

export const UI_MIME = 'text/html;profile=mcp-app';
export const CARD_URI = 'ui://parc/card';

/** The generic card widget — renders any `structuredContent`, with a tuned layout
 *  for the `recall` overview (bands + type/prefix breakdowns + focus list). */
const CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>parc.land</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 12px; }
  .hdr { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13px; letter-spacing: .02em;
         padding-bottom: 8px; margin-bottom: 8px; border-bottom: 2px solid #6d5ef0; }
  .hdr .dot { width: 10px; height: 10px; border-radius: 50%; background: #6d5ef0; box-shadow: 0 0 0 3px color-mix(in srgb, #6d5ef0 25%, transparent); }
  .hdr .sp { flex: 1; } .hdr .tag { font-weight: 500; font-size: 11px; opacity: .55; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 8px; border-radius: 999px;
          background: color-mix(in srgb, #6d5ef0 14%, transparent); border: 1px solid color-mix(in srgb, #6d5ef0 35%, transparent); }
  .who { font-size: 18px; font-weight: 650; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin: 14px 0 6px; }
  .bands { display: flex; gap: 8px; flex-wrap: wrap; }
  .band { flex: 1 1 80px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 10px; padding: 8px 10px; }
  .band b { display: block; font-size: 20px; font-weight: 650; }
  .band span { font-size: 11px; opacity: .65; }
  .rows { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
  .rows .k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows .v { opacity: .65; font-variant-numeric: tabular-nums; }
  ul.focus { list-style: none; margin: 0; padding: 0; }
  ul.focus li { padding: 6px 0; border-top: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
  ul.focus .key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  ul.focus .meta { font-size: 11px; opacity: .6; }
  pre { background: color-mix(in srgb, currentColor 6%, transparent); padding: 10px; border-radius: 8px; overflow: auto; font-size: 12px; }
  .hint { font-size: 11px; opacity: .55; margin-top: 12px; }
</style>
</head>
<body>
<!-- The header renders immediately on load — so if you see "parc.land", this IS our
     MCP-Apps iframe (not the client's default JSON view), even before data arrives. -->
<div id="root"><div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div><div class="hint">Loading…</div></div>
<script>
  function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  function header(){ return '<div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div>'; }
  function chips(arr){ return '<div class="chips">' + arr.map(function(s){ return '<span class="chip">'+esc(s)+'</span>'; }).join('') + '</div>'; }
  function rows(pairs){ return '<div class="rows">' + pairs.map(([k,v]) => '<div class="k">'+esc(k)+'</div><div class="v">'+esc(v)+'</div>').join('') + '</div>'; }
  function renderOverview(o){
    var h = '';
    if (o.bands) h += '<h2>Salience</h2><div class="bands">' +
      [['focus',o.bands.focus],['peripheral',o.bands.peripheral],['elided',o.bands.elided]]
        .map(function(b){ return '<div class="band"><b>'+esc(b[1])+'</b><span>'+b[0]+'</span></div>'; }).join('') + '</div>';
    if (typeof o.total === 'number') h += '<div class="hint">'+esc(o.total)+' facts'+(o.granted? ' · '+esc(o.granted)+' granted':'')+'</div>';
    if (o.byType) h += '<h2>By type</h2>' + rows(o.byType.map(function(t){ return [t.type||'(untyped)', t.count]; }));
    if (o.byPrefix) h += '<h2>By prefix</h2>' + rows(o.byPrefix.map(function(p){ return [p.prefix, p.count]; }));
    return h;
  }
  function renderWhoami(d){
    var h = '<h2>Identity</h2><div class="who">' + esc(d.user || 'anonymous') + '</div>';
    if (Array.isArray(d.scopes)) h += '<h2>Active scope</h2>' + chips(d.scopes);
    if (Array.isArray(d.grant) && JSON.stringify(d.grant) !== JSON.stringify(d.scopes)) h += '<h2>Grant ceiling</h2>' + chips(d.grant);
    return h;
  }
  function render(data){
    var root = document.getElementById('root');
    var body = '';
    if (!data || typeof data !== 'object') body = '<pre>' + esc(String(data)) + '</pre>';
    else {
      if (data.overview) body += renderOverview(data.overview);              // recall overview
      else if (data.user && Array.isArray(data.scopes)) body += renderWhoami(data); // whoami
      if (data.focus) { body += '<h2>Focus</h2><ul class="focus">' + Object.keys(data.focus).map(function(k){
        var e = data.focus[k], m = (e && e._meta) || {};
        return '<li><div class="key">'+esc(k)+'</div><div class="meta">'+esc(m.type||'')+(typeof m.score==='number'? ' · '+m.score.toFixed(2):'')+'</div></li>';
      }).join('') + '</ul>'; }
      if (!body) body = '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>'; // generic fallback (under the header)
      if (Array.isArray(data.hints)) body += '<div class="hint">' + data.hints.map(esc).join('<br>') + '</div>';
    }
    root.innerHTML = header() + body;
  }
  // MCP-Apps host handshake (io.modelcontextprotocol/ui, spec 2026-01-26): the host
  // sends NOTHING until it receives our initialized notification, so we must: send
  // ui/initialize, then on its response send ui/notifications/initialized, then
  // passively receive ui/notifications/tool-result and render its structuredContent.
  var INIT_ID = 1, inited = false;
  function send(msg){ try { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); } catch (e) {} }
  window.addEventListener('message', function(ev){
    var m = ev.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (!inited && m.id === INIT_ID && m.result) {
      inited = true;
      send({ method: 'ui/notifications/initialized' });
      return;
    }
    if (m.method === 'ui/notifications/tool-result' && m.params) { render(m.params.structuredContent); }
  });
  send({ id: INIT_ID, method: 'ui/initialize', params: { capabilities: {}, clientInfo: { name: 'parc.land card', version: '1.0.0' }, protocolVersion: '2026-01-26' } });
</script>
</body>
</html>`;

const WIDGETS: Record<string, string> = {
  [CARD_URI]: CARD_HTML,
};

/** Tier-1 (ADR-0034): a cell serves its own widget. `ui://cell/<owner>/<name>/<path>`
 *  resolves to a thin iframe shim onto the cell's EXISTING surface (`?embed=1`) —
 *  reusing the proven cell-render + origin-isolation, so a type's `embed` handler
 *  becomes its conversation widget with no new rendering code. */
const CELL_PREFIX = 'ui://cell/';

/** Build a tier-1 cell-widget URI from an owner/name and optional cell-relative path. */
export function cellWidgetUri(owner: string, name: string, path = ''): string {
  const tail = path ? `/${path.replace(/^\//, '')}` : '';
  return `${CELL_PREFIX}${owner}/${name}${tail}`;
}

function cellShimHtml(surfaceUrl: string): string {
  const safe = surfaceUrl.replace(/"/g, '%22');
  return `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>html,body{margin:0;height:100%}iframe{display:block;width:100%;height:100vh;min-height:420px;border:0}</style></head>
<body><iframe src="${safe}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe></body></html>`;
}

/** Resolve a `ui://` widget URI to its HTML contents, or null if unknown.
 *  `ui://parc/<id>` → a built-in tier-0 widget; `ui://cell/<owner>/<name>/<path>`
 *  → a shim onto the cell surface (absolute URL from PUBLIC_BASE_URL). */
export function resolveUiResource(uri: string): { uri: string; mimeType: string; text: string } | null {
  if (WIDGETS[uri]) return { uri, mimeType: UI_MIME, text: WIDGETS[uri] };
  if (uri.startsWith(CELL_PREFIX)) {
    const rest = uri.slice(CELL_PREFIX.length); // <owner>/<name>/<path...>
    const parts = rest.split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    const [owner, name, ...pathParts] = parts;
    const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
    const path = pathParts.join('/');
    const sep = path.includes('?') ? '&' : '?';
    const surface = `${base}/@${owner}/${name}${path ? `/${path}` : ''}${sep}embed=1`;
    return { uri, mimeType: UI_MIME, text: cellShimHtml(surface) };
  }
  return null;
}

/** Descriptors for `resources/list`. */
export function listUiResources(): Array<{ uri: string; name: string; mimeType: string; description: string }> {
  return [
    {
      uri: CARD_URI,
      name: 'parc.land card',
      mimeType: UI_MIME,
      description: 'Generic substrate result card — renders a read result (salience bands, type/prefix breakdowns, focus list, or JSON).',
    },
  ];
}
