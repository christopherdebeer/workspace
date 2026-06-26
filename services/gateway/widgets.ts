/**
 * MCP-Apps widgets (ADR-0034) — the tier-0 platform card: a single generic, self-
 * contained HTML resource served at `ui://parc/card` and bound to the gateway's
 * `read`/`whoami` tools via `_meta.ui.resourceUri`. Because the gateway exposes only
 * 3 MCP tools (whoami/read/act) and all substrate capability is nested in the `target`
 * argument, this ONE card is the renderer for every observation — so it resolves
 * per-type rendering at runtime from the result's inline `types` affordances (ADR-0029:
 * each type's icon/label/`present.render` hint + managing cell), mirroring the home
 * cell's hint vocabulary (markdown/code/metric/fields/image). New types render with NO
 * gateway deploy — pure type-vocabulary extensibility.
 *
 * (2) Bespoke cell renderers: a type may declare `handlers.render[].renderer` as a
 * `ui://…` resource; the card fetches it over the host `resources/read` proxy and
 * injects it, falling back to the hint render if it's unavailable. The widget is itself
 * an MCP client to the HOST (spec 2026-01-26): it never touches parc.land directly; the
 * host proxies `resources/read`/`tools/call` with the connection's auth.
 *
 * The card does the required handshake (ui/initialize → initialized → tool-result);
 * verified rendering in claude.ai 2026-06-26.
 */

export const UI_MIME = 'text/html;profile=mcp-app';
export const CARD_URI = 'ui://parc/card';

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
  .fc { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 10px; padding: 10px; margin: 8px 0; }
  .fc-h { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; }
  .fc-h .ic { font-size: 15px; } .fc-h .lb { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fc-h .ty { font: 11px ui-monospace, monospace; opacity: .5; } .fc-h .sp { flex: 1; } .fc-h .sc { font-size: 11px; opacity: .5; font-variant-numeric: tabular-nums; }
  .md { font-size: 13px; overflow-wrap: anywhere; } .md h1,.md h2,.md h3 { font-size: 14px; margin: 6px 0 3px; } .md code { font-family: ui-monospace, monospace; background: color-mix(in srgb, currentColor 8%, transparent); padding: 0 3px; border-radius: 3px; }
  .metric { font-size: 22px; font-weight: 650; }
  dl.f { margin: 0; display: grid; gap: 2px; font-size: 12.5px; } dl.f div { display: flex; gap: 8px; } dl.f dt { opacity: .55; font-family: ui-monospace, monospace; font-size: 11px; flex-shrink: 0; } dl.f dd { margin: 0; overflow-wrap: anywhere; }
  pre { background: color-mix(in srgb, currentColor 6%, transparent); padding: 10px; border-radius: 8px; overflow: auto; font-size: 12px; max-height: 280px; }
  img { max-width: 100%; border-radius: 8px; display: block; }
  .hint { font-size: 11px; opacity: .55; margin-top: 12px; }
</style>
</head>
<body>
<!-- The header renders immediately on load — so if you see "parc.land", this IS our
     MCP-Apps iframe (not the client's default JSON view), even before data arrives. -->
<div id="root"><div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div><div class="hint">Loading…</div></div>
<script>
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function header(){ return '<div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div>'; }
  function chips(arr){ return '<div class="chips">' + arr.map(function(s){ return '<span class="chip">'+esc(s)+'</span>'; }).join('') + '</div>'; }
  function rows(pairs){ return '<div class="rows">' + pairs.map(function(p){ return '<div class="k">'+esc(p[0])+'</div><div class="v">'+esc(p[1])+'</div>'; }).join('') + '</div>'; }
  function path(root, p){ return String(p).split('.').reduce(function(o,k){ return (o==null)?undefined:o[k]; }, root); }
  function bodyText(v){ if (typeof v === 'string') return v; if (v && typeof v === 'object'){ var fs=['content','body','text','description','note','md','markdown']; for (var i=0;i<fs.length;i++) if (typeof v[fs[i]]==='string') return v[fs[i]]; } return ''; }
  // Minimal markdown (headings, fenced code, inline code, bold/italic, links, breaks).
  function md(src){
    var out = [], lines = String(src).replace(/\\r\\n/g,'\\n').split('\\n'), inCode = false, buf = [];
    function inline(t){ return esc(t).replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>').replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href="$2">$1</a>'); }
    for (var i=0;i<lines.length;i++){ var l=lines[i];
      if (/^\`\`\`/.test(l)){ if(inCode){ out.push('<pre>'+esc(buf.join('\\n'))+'</pre>'); buf=[]; inCode=false; } else inCode=true; continue; }
      if (inCode){ buf.push(l); continue; }
      var h=l.match(/^(#{1,3})\\s+(.*)/); if(h){ out.push('<h'+h[1].length+'>'+inline(h[2])+'</h'+h[1].length+'>'); continue; }
      if (l.trim()==='') continue;
      out.push('<div>'+inline(l)+'</div>');
    }
    if (buf.length) out.push('<pre>'+esc(buf.join('\\n'))+'</pre>');
    return out.join('');
  }
  function fields(v){
    if (!v || typeof v !== 'object') return '';
    var skip = {content:1,title:1,name:1,id:1,src:1};
    var rs = Object.keys(v).filter(function(k){ return v[k]!=null && typeof v[k]!=='object' && !skip[k]; }).slice(0,6);
    if (!rs.length) return '';
    return '<dl class="f">' + rs.map(function(k){ return '<div><dt>'+esc(k)+'</dt><dd>'+esc(String(v[k]).slice(0,160))+'</dd></div>'; }).join('') + '</dl>';
  }
  function hintBody(hint, v){
    switch (hint){
      case 'md': case 'markdown': { var t=bodyText(v); return t? '<div class="md">'+md(t)+'</div>':''; }
      case 'code': { var c=bodyText(v); return c? '<pre>'+esc(c.slice(0,2000))+'</pre>':''; }
      case 'metric': { var n=(typeof v==='number')?v:((v&&(v.value!=null?v.value:v.count!=null?v.count:v.total))||bodyText(v)); return (n!=null&&n!=='')? '<div class="metric">'+esc(n)+'</div>':''; }
      case 'fields': return fields(v);
      case 'image': { var s=v&&(v.src||v.url||v.href||v.image); return s? '<img src="'+esc(s)+'" loading="lazy">':''; }
      default: return '';
    }
  }
  // A single fact, rendered by its TYPE affordance (icon + label + present.render hint).
  function typedCard(key, entry, types, slot){
    var t = (entry && entry._meta && entry._meta.type) || null;
    var aff = (t && types && types[t]) || {};
    var label = (aff.label && path(entry, aff.label)) || (entry.value && (entry.value.title || entry.value.name)) || key;
    var rh = aff.handlers && aff.handlers.render && aff.handlers.render[0];
    var body = (rh && rh.hint) ? hintBody(rh.hint, entry.value) : '';
    if (!body) body = fields(entry.value) || ('<pre>'+esc(JSON.stringify(entry.value,null,2)).slice(0,800)+'</pre>');
    var sc = entry && entry._meta && typeof entry._meta.score==='number' ? entry._meta.score.toFixed(2) : '';
    // (2) bespoke cell renderer: if the type declares a ui:// renderer, fetch + inject it.
    if (rh && typeof rh.renderer === 'string' && rh.renderer.indexOf('ui://')===0){ fetchRenderer(rh.renderer, entry, slot); }
    return '<div class="fc"><div class="fc-h"><span class="ic">'+esc(aff.icon||'•')+'</span><span class="lb">'+esc(String(label).slice(0,100))+'</span><span class="sp"></span>'+(t?'<span class="ty">'+esc(t)+'</span>':'')+(sc?'<span class="sc">'+sc+'</span>':'')+'</div><div id="'+slot+'">'+body+'</div></div>';
  }
  function entriesBlock(map, types){
    var keys = Object.keys(map);
    return keys.map(function(k,i){ return typedCard(k, map[k], types, 'slot-'+i); }).join('');
  }
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
    var b = '';
    if (!data || typeof data !== 'object') b = '<pre>' + esc(String(data)) + '</pre>';
    else {
      var types = data.types || {};
      if (data.overview) b += renderOverview(data.overview);                          // recall overview
      else if (data.user && Array.isArray(data.scopes)) b += renderWhoami(data);       // whoami
      if (data.focus) b += '<h2>Focus</h2>' + entriesBlock(data.focus, types);         // overview focus facts
      else if (data.entries) b += entriesBlock(data.entries, types);                   // query / recall full
      else if (data.value && data._meta) b += typedCard(data.key||'', data, types, 'slot-one'); // single fact (peek)
      if (!b) b = '<pre>' + esc(JSON.stringify(data, null, 2)) + '</pre>';             // generic fallback (under header)
      if (Array.isArray(data.hints)) b += '<div class="hint">' + data.hints.map(esc).join('<br>') + '</div>';
    }
    root.innerHTML = header() + b;
  }

  // ── MCP-Apps host channel (spec 2026-01-26) ──────────────────────────────────
  // The widget is an MCP client to the HOST. We must handshake before the host sends
  // anything: ui/initialize → (response) ui/notifications/initialized → tool-result.
  // We also issue host-proxied requests (resources/read) for cell-declared renderers.
  var INIT_ID = 1, inited = false, rid = 100, pending = {};
  function send(msg){ try { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); } catch (e) {} }
  function request(method, params){
    return new Promise(function(resolve){ var id = ++rid; pending[id] = resolve; send({ id: id, method: method, params: params });
      setTimeout(function(){ if (pending[id]){ delete pending[id]; resolve(null); } }, 4000); });
  }
  // (2) Fetch a cell-declared ui:// renderer via the host and inject it into a fact's slot.
  function fetchRenderer(uri, entry, slot){
    request('resources/read', { uri: uri }).then(function(r){
      var c = r && r.contents && r.contents[0]; if (!c || !c.text) return;       // degrade to the hint render already shown
      var el = document.getElementById(slot); if (el) el.innerHTML = c.text;     // cell renderer markup (no scripts execute via innerHTML)
    });
  }
  window.addEventListener('message', function(ev){
    var m = ev.data; if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && pending[m.id]){ var cb = pending[m.id]; delete pending[m.id]; cb(m.result || null); return; }
    if (!inited && m.id === INIT_ID && m.result){ inited = true; send({ method: 'ui/notifications/initialized' }); return; }
    if (m.method === 'ui/notifications/tool-result' && m.params){ render(m.params.structuredContent); }
  });
  send({ id: INIT_ID, method: 'ui/initialize', params: { capabilities: {}, clientInfo: { name: 'parc.land card', version: '1.0.0' }, protocolVersion: '2026-01-26' } });
</script>
</body>
</html>`;

const WIDGETS: Record<string, string> = {
  [CARD_URI]: CARD_HTML,
};

// Bespoke cell renderers (ADR-0034 Inc 2): a type declares `handlers.render[].renderer`
// as a `ui://…` URI; the card fetches it via the host `resources/read` proxy. Serving a
// *cell-authored* renderer (gateway fetching the cell's HTML server-side) is the next
// hop — not yet wired (no cell declares one). The card-side consumer + the built-in
// resolver below are in place, so a `ui://parc/<id>` renderer would already resolve.

/** Resolve a `ui://` widget/renderer URI to its HTML contents, or null if unknown. */
export function resolveUiResource(uri: string): { uri: string; mimeType: string; text: string } | null {
  if (WIDGETS[uri]) return { uri, mimeType: UI_MIME, text: WIDGETS[uri] };
  return null;
}

/** Descriptors for `resources/list`. */
export function listUiResources(): Array<{ uri: string; name: string; mimeType: string; description: string }> {
  return [
    {
      uri: CARD_URI,
      name: 'parc.land card',
      mimeType: UI_MIME,
      description: 'Generic substrate result card — renders a read result (salience bands, type/prefix breakdowns, typed fact cards via each type’s render hint, or whoami identity).',
    },
  ];
}
