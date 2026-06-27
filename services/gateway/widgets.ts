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
import type { ServiceContext } from '../../platform/runtime';

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
  /* Grow-to-content: the body flows to its natural content height and the widget posts
     that height to the host (Val.town's working pattern) — NOT a fixed-height scroll box,
     which would cap scrollHeight at the frame and defeat the resize signal. Thin sticky
     header to maximise content space. */
  body { margin: 0; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; padding: 10px 12px; }
  .hdr { position: sticky; top: 0; z-index: 2; background: Canvas; display: flex; align-items: center; gap: 6px;
         font-size: 10px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; opacity: .5;
         padding: 1px 0 3px; margin: 0 0 6px; border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
  .hdr .dot { width: 6px; height: 6px; border-radius: 50%; background: #6d5ef0; }
  .hdr .sp { flex: 1; } .hdr .tag { display: none; }
  .hdr .back { font-size: 13px; line-height: 1; padding: 1px 6px; margin-right: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 8px; border-radius: 999px; background: color-mix(in srgb, #6d5ef0 14%, transparent); border: 1px solid color-mix(in srgb, #6d5ef0 35%, transparent); }
  .who { font-size: 18px; font-weight: 650; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; opacity: .6; margin: 14px 0 6px; }
  .bands { display: flex; gap: 8px; flex-wrap: wrap; }
  .band { flex: 1 1 80px; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 10px; padding: 8px 10px; }
  .band b { display: block; font-size: 20px; font-weight: 650; } .band span { font-size: 11px; opacity: .65; }
  .rows { display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
  .rows .k { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .rows .v { opacity: .65; font-variant-numeric: tabular-nums; }
  .rows .k.drill { cursor: pointer; color: #6d5ef0; } .rows .k.drill:hover { text-decoration: underline; }
  .chip.act { cursor: pointer; } .chip.act:hover { background: color-mix(in srgb, #6d5ef0 28%, transparent); }
  .mini { cursor: pointer; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; color: inherit; border-radius: 6px; font-size: 12px; line-height: 1; padding: 2px 6px; }
  .busy { opacity: .5; pointer-events: none; }
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
  /* Similarity / salience bar on ranked cards (ADR-0038 Inc 6). */
  .sim { display: inline-block; width: 36px; height: 4px; border-radius: 2px; background: color-mix(in srgb, currentColor 14%, transparent); overflow: hidden; vertical-align: middle; }
  .sim i { display: block; height: 100%; background: #6d5ef0; }
  a.wikilink { color: #6d5ef0; text-decoration: none; border-bottom: 1px dotted color-mix(in srgb, #6d5ef0 50%, transparent); cursor: pointer; }
  a.wikilink:hover { text-decoration: underline; }
  /* D3 force graph viewport (ADR-0038 Inc 2 rich) — a fixed-height pan/zoom canvas. */
  .graph { height: 460px; margin: 6px 0; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; overflow: hidden; background: color-mix(in srgb, currentColor 3%, transparent); }
  .graph svg { display: block; width: 100%; height: 100%; }
  /* Progressive disclosure (ADR-0036): the open view is GLANCEABLE — long lists cap to
     a head + a "+N more" toggle, and long fact bodies clamp to a few lines with a fade +
     "show more". Both reveal already-present data locally (no server round-trip). */
  .more-btn { cursor: pointer; margin: 6px 0 2px; padding: 3px 10px; font: 12px/1 inherit; border-radius: 999px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); background: transparent; color: #6d5ef0; }
  .more-btn:hover { background: color-mix(in srgb, #6d5ef0 12%, transparent); }
  .clamp { max-height: 5.6em; overflow: hidden; position: relative; }
  .clamp::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2.2em; background: linear-gradient(transparent, Canvas); pointer-events: none; }
  .clamp.open { max-height: none; } .clamp.open::after { display: none; }
  [hidden] { display: none !important; }
  /* Loading skeleton — gives the card presence + a sensible initial height before the
     first tool-result arrives (it then grows-to-content). */
  .skel { display: flex; flex-direction: column; gap: 9px; padding: 4px 0; }
  .skel .ln { height: 13px; border-radius: 7px; position: relative; overflow: hidden; background: color-mix(in srgb, currentColor 9%, transparent); }
  .skel .ln.w1 { width: 45%; } .skel .ln.w2 { width: 88%; } .skel .ln.w3 { width: 70%; } .skel .ln.tall { height: 38px; }
  .skel .ln::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%); background: linear-gradient(90deg, transparent, color-mix(in srgb, currentColor 11%, transparent), transparent); animation: sh 1.3s infinite; }
  @keyframes sh { 100% { transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .skel .ln::after { animation: none; } }
</style>
</head>
<body>
<!-- The header renders immediately — so "parc.land" proves this IS our iframe even
     before data arrives. The render logic + handshake come from the inlined app.js. -->
<div id="root"><div class="hdr"><span class="dot"></span>parc.land<span class="sp"></span><span class="tag">widget</span></div><div class="skel"><div class="ln w1"></div><div class="ln tall"></div><div class="ln w2"></div><div class="ln w3"></div></div></div>
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

type UiResource = { uri: string; mimeType: string; text: string; _meta?: Record<string, unknown> };

/**
 * ADR-0039 — the FEDERATION provider hop. A cell-authored renderer is addressed
 * `ui://@<owner>/<name>/<path>`; the gateway resolves it by fetching the owning
 * cell's served asset server-side (over the same `cells.call` invoke the gateway
 * already uses for `@owner/cell.tool`), so a type's conversational renderer is
 * authored + deployed by its cell at runtime — no platform `cdk deploy`. The card
 * (the consumer) requests this over the host `resources/read` proxy under our
 * enforceScope. The serving cell decides what to return (a renderer script, HTML,
 * etc.); we pass its content-type straight through.
 *
 * Cached per-URI with a short TTL — the asset is stable between cell deploys and
 * this Lambda is ephemeral, so a coarse TTL is enough (a cell-version key is the
 * ADR-0035 follow-up).
 */
const CELL_RENDERER_RE = /^ui:\/\/@([^/]+)\/([^/]+)\/(.+)$/;
const CELL_RENDERER_TTL_MS = 60_000;
const cellRendererCache = new Map<string, { at: number; resource: UiResource }>();

async function resolveCellRenderer(uri: string, ctx: ServiceContext): Promise<UiResource | null> {
  const m = CELL_RENDERER_RE.exec(uri);
  if (!m) return null;
  const [, owner, name, path] = m;
  const cached = cellRendererCache.get(uri);
  if (cached && Date.now() - cached.at < CELL_RENDERER_TTL_MS) return cached.resource;
  try {
    const res = (await ctx
      .serviceClient('cells')
      .command('call', { owner, name, method: 'GET', path: `/${path}` })) as {
      statusCode?: number;
      headers?: Record<string, string>;
      body?: string;
      isBase64Encoded?: boolean;
    } | null;
    if (!res || typeof res.body !== 'string' || (typeof res.statusCode === 'number' && res.statusCode >= 400)) return null;
    const text = res.isBase64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body;
    const resource: UiResource = {
      uri,
      mimeType: res.headers?.['content-type'] || res.headers?.['Content-Type'] || 'application/javascript; charset=utf-8',
    text };
    cellRendererCache.set(uri, { at: Date.now(), resource });
    return resource;
  } catch {
    return null; // the card degrades to the type's render hint
  }
}

/** Resolve a `ui://` widget URI to its contents, or null if unknown. `ui://parc/card`
 *  is the platform floor (served from this bundle); `ui://@owner/name/<path>` federates
 *  to the owning cell (ADR-0039). The card reuses these over the host proxy; mermaid/d3
 *  lazy-load from the jsDelivr CDN, declared in `_meta.ui.csp.resourceDomains`. */
export function resolveUiResource(uri: string, ctx?: ServiceContext): UiResource | Promise<UiResource | null> | null {
  if (uri === CARD_URI) {
    return {
      uri,
      mimeType: UI_MIME,
      text: cardHtml(),
      // CSP allows mermaid's CDN; the preferred-frame-size hints give the host a
      // sensible initial height (claude.ai mobile does not honour runtime resize yet,
      // so a too-small fixed frame clips the body — validation 2026-06-27). Belt and
      // suspenders: spec-style + the MCP-UI vendor key.
      _meta: {
        ui: { csp: { resourceDomains: ['https://cdn.jsdelivr.net'] }, preferredFrameSize: { width: '100%', height: '560px' } },
        'mcpui.dev/ui-preferred-frame-size': ['100%', '560px'],
      },
    };
  }
  if (ctx && CELL_RENDERER_RE.test(uri)) return resolveCellRenderer(uri, ctx);
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
