/**
 * MCP-Apps widgets (ADR-0034/0035) — the `ui://parc/card` resource. The card's RENDER
 * LOGIC lives in `services/gateway/client/main.ts` (the shared `platform/ui` render
 * vocabulary + `marked`), esbuilt to `app.js` beside the handler (HttpServiceCell
 * clientEntry) and inlined here into a self-contained HTML shell — so the conversation
 * card uses the same rendering rules as the home cell, not a divergent vanilla copy.
 *
 * The card is an MCP client to the HOST: it does the spec handshake and renders the
 * structuredContent the host pushes (ADR-0034 security model). Verified rendering in
 * claude.ai 2026-06-26.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const UI_MIME = 'text/html;profile=mcp-app';
export const CARD_URI = 'ui://parc/card';

const SHELL_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>parc.land</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 12px; }
  .hdr { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13px; letter-spacing: .02em; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 2px solid #6d5ef0; }
  .hdr .dot { width: 10px; height: 10px; border-radius: 50%; background: #6d5ef0; box-shadow: 0 0 0 3px color-mix(in srgb, #6d5ef0 25%, transparent); }
  .hdr .sp { flex: 1; } .hdr .tag { font-weight: 500; font-size: 11px; opacity: .55; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, #6d5ef0 14%, transparent); border: 1px solid color-mix(in srgb, #6d5ef0 35%, transparent); }
  .who { font-size: 18px; font-weight: 650; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin: 14px 0 6px; }
  .bands { display: flex; gap: 8px; flex-wrap: wrap; }
  .band { flex: 1 1 80px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 10px; padding: 8px 10px; }
  .band b { display: block; font-size: 20px; font-weight: 650; } .band span { font-size: 11px; opacity: .65; }
  .rows { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
  .rows .k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .rows .v { opacity: .65; font-variant-numeric: tabular-nums; }
  .fc { border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 10px; padding: 10px; margin: 8px 0; }
  .fc-h { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; }
  .fc-h .ic { font-size: 15px; } .fc-h .lb { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fc-h .ty { font: 11px ui-monospace, monospace; opacity: .5; } .fc-h .sp { flex: 1; } .fc-h .sc { font-size: 11px; opacity: .5; font-variant-numeric: tabular-nums; }
  .md { font-size: 13px; overflow-wrap: anywhere; } .md h1,.md h2,.md h3 { font-size: 14px; margin: 6px 0 3px; } .md code { font-family: ui-monospace, monospace; background: color-mix(in srgb, currentColor 8%, transparent); padding: 0 3px; border-radius: 3px; } .md pre { white-space: pre-wrap; }
  .metric { font-size: 22px; font-weight: 650; }
  dl.f { margin: 0; display: grid; gap: 2px; font-size: 12.5px; } dl.f div { display: flex; gap: 8px; } dl.f dt { opacity: .55; font-family: ui-monospace, monospace; font-size: 11px; flex-shrink: 0; } dl.f dd { margin: 0; overflow-wrap: anywhere; }
  pre { background: color-mix(in srgb, currentColor 6%, transparent); padding: 10px; border-radius: 8px; overflow: auto; font-size: 12px; max-height: 280px; }
  img { max-width: 100%; border-radius: 8px; display: block; }
  .hint { font-size: 11px; opacity: .55; margin-top: 12px; }
</style>
</head>
<body>
<!-- The header renders immediately — so "parc.land" proves this IS our iframe even
     before data arrives. The render logic + handshake come from the inlined app.js. -->
<div id="root"><div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div><div class="hint">Loading…</div></div>
<script>`;

const SHELL_TAIL = `</script>
</body>
</html>`;

/**
 * Minimal fallback when the esbuilt `app.js` isn't present (tests / local) — still does
 * the MCP-Apps handshake + a basic render, so the resource is valid and tests see the
 * handshake. Production inlines the rich `app.js` (shared renderers + marked) instead.
 */
const FALLBACK_JS = `
  var INIT_ID=1,inited=false;
  function send(m){try{window.parent.postMessage(Object.assign({jsonrpc:'2.0'},m),'*');}catch(e){}}
  function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
  function render(d){var r=document.getElementById('root');if(r)r.innerHTML='<div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div><pre>'+esc(JSON.stringify(d,null,2))+'</pre>';}
  window.addEventListener('message',function(ev){var m=ev.data;if(!m||m.jsonrpc!=='2.0')return;
    if(!inited&&m.id===INIT_ID&&m.result){inited=true;send({method:'ui/notifications/initialized'});return;}
    if(m.method==='ui/notifications/tool-result'&&m.params){render(m.params.structuredContent);}});
  send({id:INIT_ID,method:'ui/initialize',params:{capabilities:{},clientInfo:{name:'parc.land card',version:'1.0.0'},protocolVersion:'2026-01-26'}});
`;

let cachedAppJs: string | null | undefined;
/** The esbuilt widget bundle (rich, shared renderers), or the inline fallback. */
function appJs(): string {
  if (cachedAppJs === undefined) {
    try {
      cachedAppJs = readFileSync(join(__dirname, 'app.js'), 'utf8');
    } catch {
      cachedAppJs = null;
    }
  }
  return cachedAppJs || FALLBACK_JS;
}

/** Build the self-contained card HTML (shell + inlined widget JS). */
function cardHtml(): string {
  return SHELL_HEAD + appJs() + SHELL_TAIL;
}

/** Resolve a `ui://` widget URI to its HTML contents, or null if unknown. */
export function resolveUiResource(uri: string): { uri: string; mimeType: string; text: string } | null {
  if (uri === CARD_URI) return { uri, mimeType: UI_MIME, text: cardHtml() };
  return null;
}

/** Descriptors for `resources/list`. */
export function listUiResources(): Array<{ uri: string; name: string; mimeType: string; description: string }> {
  return [
    {
      uri: CARD_URI,
      name: 'parc.land card',
      mimeType: UI_MIME,
      description: 'Generic substrate result card — renders a read result (salience bands, type/prefix breakdowns, typed fact cards via each type’s render hint + markdown, or whoami identity).',
    },
  ];
}
