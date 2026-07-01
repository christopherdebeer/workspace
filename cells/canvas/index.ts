import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBoard, type BoardElement, type Placement, type Content } from './shared/render';
import { regionBBox, fitRegion, renderFramesSvg, type Region, type Placed, type BBox, type FrameLike } from './shared/frame';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType },
  body,
});

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

/**
 * ADR-0043 — the canvas cell's FEDERATED `ui://` renderer for a `canvas` view
 * (surface C: a host — home, lit — embedding a board INSIDE itself). This is
 * the fix for "canvas on home just shows a sign-in": the old path iframed a
 * host page to canvas's OWN session-less origin (`?embed=1`), which severed the
 * viewer's session, so a PRIVATE board fell to the anon shell. Here the HOST
 * holds the session and resolves the data; this renderer only PAINTS, fetching
 * the board's facts over the host-proxied `api.call('read', …)` (so per-fact
 * grants are enforced under the viewer's identity) and running inside the host's
 * opaque-origin sandbox (no ambient session — it may be another tenant's cell).
 *
 * A self-registering classic script (no module/eval — the sandbox forbids both)
 * that adds itself to `window.__parcRender['canvas']`, matching the machine
 * cell's `machine-run`/`machine` renderers. It ports canvas's OWN pure render
 * primitives (from `shared/render.ts`) inline, since a sandbox script can't
 * import the monorepo — canvas keeps ownership of how a board draws. Backtick-
 * free so it nests in this template literal.
 *
 * Data path (ADR-0043 Inc 1): canvas's split model keeps geometry in placement
 * facts (`_canvas/<board>/el:<id>`) and content in separate `el:<id>` facts, so
 * this fetches BOTH by prefix and joins — two host-proxied reads (mirrors how
 * machine's renderer fetches its decomposed `<key>/node/` children). A single-
 * call board read is the Inc 4 fidelity/perf follow-up.
 */
const BOARD_RENDERER_SRC = `
(function(){
  var BUILD = 'v2';
  var reg = (window.__parcRender = window.__parcRender || {});
  var STYLE_ID = 'parc-canvas-board-css';
  function ensureCss(){
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = [
      '.pc-board{position:relative;width:100%;height:240px;overflow:hidden;background:#fff;border-radius:8px}',
      '.pc-cam{position:absolute;top:0;left:0;transform-origin:0 0;overflow:visible}',
      '.pc-el{position:absolute;box-sizing:content-box;padding:2px;font:13px/1.25 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}',
      '.pc-el .content{width:100%;height:100%;overflow:hidden}',
      '.pc-el[data-t="text"] .content,.pc-el[data-t="markdown"] .content{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.2;white-space:normal}',
      '.pc-el img.content{object-fit:cover;max-width:100%}',
      '.pc-el h1,.pc-el h2,.pc-el h3{margin:.1em 0;font-size:1.05em}',
      '.pc-el p{margin:.15em 0}',
      '.pc-badge{font:11px ui-monospace,Menlo,monospace;opacity:.6;padding:4px 2px 0}'
    ].join('');
    document.head.appendChild(s);
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function escAttr(s){ return esc(s).replace(/\\n/g,'&#10;'); }
  // A compact markdown subset ported from shared/render.ts (headings, bold,
  // italic, code, links, images, lists, hr, blockquote, paragraphs).
  function mdInline(s){
    var t = esc(s);
    t = t.replace(/\`([^\`]+)\`/g, function(_m,c){ return '<code>'+c+'</code>'; });
    t = t.replace(/!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)/g, function(_m,a,u){ return '<img alt="'+a+'" src="'+u+'">'; });
    t = t.replace(/\\[([^\\]]+)\\]\\(([^)\\s]+)\\)/g, function(_m,a,u){ return '<a href="'+u+'" target="_blank" rel="noopener">'+a+'</a>'; });
    t = t.replace(/\\*\\*([^*]+)\\*\\*/g, function(_m,c){ return '<strong>'+c+'</strong>'; });
    t = t.replace(/(^|[^*])\\*([^*]+)\\*/g, function(_m,p,c){ return p+'<em>'+c+'</em>'; });
    return t;
  }
  function renderMd(src){
    var lines = String(src==null?'':src).replace(/\\r\\n/g,'\\n').split('\\n');
    var out=[], para=[], list=null;
    function flush(){ if(para.length){ out.push('<p>'+mdInline(para.join(' '))+'</p>'); para=[]; } }
    function closeList(){ if(list){ out.push('</'+list+'>'); list=null; } }
    for (var i=0;i<lines.length;i++){
      var line = lines[i].replace(/\\s+$/,'');
      if(!line.trim()){ flush(); closeList(); continue; }
      var h = line.match(/^(#{1,6})\\s+(.*)$/);
      if(h){ flush(); closeList(); var n=h[1].length; out.push('<h'+n+'>'+mdInline(h[2])+'</h'+n+'>'); continue; }
      if(/^(---|\\*\\*\\*|___)\\s*$/.test(line)){ flush(); closeList(); out.push('<hr>'); continue; }
      if(/^>\\s?/.test(line)){ flush(); closeList(); out.push('<blockquote>'+mdInline(line.replace(/^>\\s?/,''))+'</blockquote>'); continue; }
      var ul = line.match(/^[-*+]\\s+(.*)$/), ol = line.match(/^\\d+\\.\\s+(.*)$/);
      if(ul||ol){ flush(); var ty=ul?'ul':'ol'; if(list!==ty){ closeList(); list=ty; out.push('<'+ty+'>'); } out.push('<li>'+mdInline((ul?ul[1]:ol[1]))+'</li>'); continue; }
      closeList(); para.push(line);
    }
    flush(); closeList(); return out.join('');
  }
  function contentHtml(c, w, h){
    var color = c.color ? 'color:'+escAttr(c.color) : '';
    var text = c.content==null?'':c.content;
    if (c.type==='text') return '<p class="content" style="'+color+'">'+esc(text)+'</p>';
    if (c.type==='markdown') return '<div class="content" style="'+color+'">'+renderMd(text)+'</div>';
    if (c.type==='html') return '<div class="content">'+text+'</div>';
    if (c.type==='img'){ var src = c.src || ('https://placehold.co/'+Math.round(w)+'x'+Math.round(h)+'?text='+encodeURIComponent(text)); return '<img class="content" src="'+escAttr(src)+'">'; }
    return '<div class="content" style="opacity:.5">'+esc(c.type)+'</div>';
  }
  function elHtml(p, c){
    var scale = p.scale||1;
    var w = p.width*scale, hh = p.height*scale;
    var left = (p.x - w/2), top = (p.y - hh/2);
    var style = 'left:'+left.toFixed(1)+'px;top:'+top.toFixed(1)+'px;width:'+w.toFixed(1)+'px;height:'+hh.toFixed(1)+'px;z-index:'+(Math.floor(p.zIndex||0)||1);
    return '<div class="pc-el" data-t="'+escAttr(c.type)+'" style="'+style+'">'+contentHtml(c,w,hh)+'</div>';
  }
  function fitCam(els, W, H){
    var xs=[], ys=[];
    for (var i=0;i<els.length;i++){ var e=els[i], p=e.placement; if(p.static) continue; var s=p.scale||1; xs.push(p.x-(p.width*s)/2, p.x+(p.width*s)/2); ys.push(p.y-(p.height*s)/2, p.y+(p.height*s)/2); }
    if(!xs.length) return {scale:1,tx:0,ty:0};
    var minX=Math.min.apply(null,xs), minY=Math.min.apply(null,ys);
    var bw=Math.max.apply(null,xs)-minX, bh=Math.max.apply(null,ys)-minY, pad=16;
    var scale=Math.min(1,(W-pad*2)/Math.max(bw,1),(H-pad*2)/Math.max(bh,1));
    return {scale:scale, tx:(W-scale*bw)/2-scale*minX, ty:(H-scale*bh)/2-scale*minY};
  }
  function resolveViewId(value, key){
    var vid = (value && (value.viewId || value.id)) || key || '';
    return String(vid);
  }
  function entriesOf(r){ return (r && (r.entries || r.items)) || []; }
  reg['canvas'] = function(host, value, api){
    ensureCss();
    host.innerHTML = '<div class="pc-badge">loading board…</div>';
    if (!api || typeof api.call !== 'function'){ host.innerHTML = '<div class="pc-badge">no host channel</div>'; return; }
    var vid = resolveViewId(value, api.key);
    var viewKey = vid.indexOf('_views/')===0 ? vid : ('_views/'+vid);
    function deriveBoard(){ var k = vid.indexOf('_views/')===0 ? vid.slice(7) : vid; return k.indexOf('canvas:')===0 ? k.slice(7) : k; }
    // 1) resolve the board (the view fact declares render.board) — fall back to
    //    deriving it from the id if the view fact is absent.
    api.call('read','workspace.peek',{ key: viewKey }).then(function(rec){
      var v = rec && (rec.value!==undefined ? rec.value : rec);
      var board = (v && v.render && v.render.board) || (value && (value.board || (value.render && value.render.board))) || deriveBoard();
      if (!board){ host.innerHTML='<div class="pc-badge">no board</div>'; return; }
      // 2) placements (geometry) + 3) content + 4) links (element→element edges),
      // each a scoped read; joined here — the same three sources the live board
      // assembles from (placements/content facts + workspace.links projection).
      return Promise.all([
        api.call('read','workspace.query',{ prefix:'_canvas/'+board+'/el:', limit:400, rankBy:'recency' }),
        api.call('read','workspace.query',{ prefix:'el:', limit:1200, rankBy:'recency' }),
        api.call('read','workspace.links',{ prefix:'el:' }).catch(function(){ return { edges:[] }; })
      ]).then(function(res){ paint(board, entriesOf(res[0]), entriesOf(res[1]), (res[2] && res[2].edges) || []); });
    }).catch(function(err){ host.innerHTML = '<div class="pc-badge">board unavailable: '+esc((err&&err.message)||err)+'</div>'; });

    function paint(board, places, contents, links){
      var cmap = {};
      for (var i=0;i<contents.length;i++){ var ce=contents[i]; if(ce&&ce.key) cmap[ce.key]=ce.value; }
      var els=[], center={}, pre='_canvas/'+board+'/';
      for (var j=0;j<places.length;j++){
        var pe=places[j]; if(!pe||!pe.key) continue;
        var elKey = pe.key.slice(pre.length); // el:<id>
        var c = cmap[elKey], p = pe.value;
        if(!c || !c.type || !p || typeof p.x!=='number' || p.static) continue;
        els.push({ placement:p, content:c });
        center[elKey] = { x:p.x, y:p.y }; // placement (x,y) is the element CENTER
      }
      if(!els.length){ host.innerHTML = '<div class="pc-badge">empty board</div>'; return; }
      var root = host; var W = (root.clientWidth||600), H = 240;
      var cam = fitCam(els, W, H);
      // Edges: project workspace.links whose BOTH endpoints (el:<id> keys) are
      // present elements on this board — the same rule the live board uses. Drawn
      // as an SVG UNDER the elements, in the SAME canvas coord space (inside the
      // cam transform), so a non-scaling stroke keeps hairlines crisp at any zoom.
      // Style by relation, mirroring the live board's hierarchy: authored links
      // (relates/informs/...) read as real connections; inferred similarTo edges
      // are the faint semantic constellation, not foreground -- so a thumbnail
      // shows structure, not a similarity haze. Authored drawn last (on top).
      var faint='', strong='';
      for (var m=0;m<(links?links.length:0);m++){
        var l=links[m]; if(!l) continue;
        var a=center[l.from], b=center[l.to];
        if(!a||!b) continue;
        var seg = '<line x1="'+a.x.toFixed(1)+'" y1="'+a.y.toFixed(1)+'" x2="'+b.x.toFixed(1)+'" y2="'+b.y.toFixed(1)+'" vector-effect="non-scaling-stroke" ';
        if (l.rel === 'similarTo') faint += seg + 'stroke="rgba(150,140,120,.16)" stroke-width="1" />';
        else strong += seg + 'stroke="#8a8172" stroke-width="1.5" />';
      }
      var lines = faint + strong;
      var edgesSvg = lines ? '<svg class="pc-edges" style="position:absolute;left:0;top:0;overflow:visible;pointer-events:none">'+lines+'</svg>' : '';
      var inner = '';
      for (var k=0;k<els.length;k++) inner += elHtml(els[k].placement, els[k].content);
      host.innerHTML = '<div class="pc-board"><div class="pc-cam" style="transform:translate('+cam.tx.toFixed(1)+'px,'+cam.ty.toFixed(1)+'px) scale('+cam.scale.toFixed(4)+')">'+edgesSvg+inner+'</div></div>'
        + '<div class="pc-badge">🌲 rendered by @c15r/canvas · federated ui:// · '+BUILD+'</div>';
    }
  };
})();
`;

// The AWS SDK v3 ships in the node20 Lambda runtime, but load it LAZILY: a
// missing module then degrades SSR to the static fallback (caught below)
// instead of crashing the cell's import — the bare app + app.js must never 500.
interface Ddb {
  send(cmd: unknown): Promise<{
    Items?: unknown[];
    Item?: Record<string, unknown>;
    LastEvaluatedKey?: unknown;
    Responses?: Record<string, unknown[]>;
  }>;
}
let doc: Ddb | undefined;
let Query: any;
let Batch: any;
let Get: any;
function ddb(): Ddb {
  if (!doc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const lib = require('@aws-sdk/lib-dynamodb');
    Query = lib.QueryCommand;
    Batch = lib.BatchGetCommand;
    Get = lib.GetCommand;
    doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({})) as Ddb;
  }
  return doc;
}

type Viewport = { x: number; y: number; scale: number } | 'fit';

/**
 * Resolve a `?view=<id>` to its board + declared camera. The view fact
 * (`_views/<id>`) declares `render.board` (which board's placements) and
 * `render.viewport` (the pinned, shareable "look here") — the appropriate
 * window for an embed, instead of fit-to-everything.
 */
async function readView(viewId: string): Promise<{ board: string; viewport: Viewport }> {
  const r = await ddb().send(new Get({ TableName: TABLE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#_views/${viewId}` } }));
  const def = (r.Item?.value ?? {}) as { render?: { board?: string; viewport?: Viewport } };
  const board = def.render?.board ?? (viewId.startsWith('canvas:') ? viewId.slice('canvas:'.length) : viewId);
  return { board, viewport: def.render?.viewport ?? 'fit' };
}

/** Read a frame fact (`frame:<id>`) → its region (ADR-0015), server-side. */
async function readFrame(frameId: string): Promise<Region | null> {
  const r = await ddb().send(new Get({ TableName: TABLE, Key: { pk: `STATE#${OWNER}`, sk: `KEY#frame:${frameId}` } }));
  const region = (r.Item?.value as { region?: Region } | undefined)?.region;
  return region ?? null;
}

/** The board's DEFAULT viewpoint region, if it declares one — so SSR can paint
 *  the first frame straight away instead of fit-all, which the client otherwise
 *  corrects only AFTER a post-load frame query (the visible "jump"). Frame keys
 *  are `frame:<board>/<name>`, so the board's frames share that prefix. */
async function readDefaultFrame(board: string): Promise<Region | null> {
  if (!TABLE) return null;
  try {
    const r = await ddb().send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': `KEY#frame:${board}/` },
      }),
    );
    for (const it of (r.Items ?? []) as FactItem[]) {
      if (it.superseded) continue;
      const v = it.value as { default?: boolean; region?: Region } | undefined;
      if (v?.default && v.region) return v.region;
    }
  } catch (e) {
    console.warn('[canvas ssr] default-frame lookup failed', (e as Error).message);
  }
  return null;
}

/** All of a board's frames (`frame:<board>/…`) for the server-painted overlay. */
async function readFrames(board: string): Promise<FrameLike[]> {
  if (!TABLE) return [];
  const out: FrameLike[] = [];
  try {
    const r = await ddb().send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': `KEY#frame:${board}/` },
      }),
    );
    for (const it of (r.Items ?? []) as FactItem[]) {
      if (it.superseded) continue;
      out.push({ key: it.key, value: it.value as FrameLike['value'] });
    }
  } catch (e) {
    console.warn('[canvas ssr] frames lookup failed', (e as Error).message);
  }
  return out;
}

/** Reduce SSR board elements to the `Placed` shape the frame resolver needs.
 *  (SSR carries the value type, not `_meta.type`/tags — so query-by-type regions
 *  are best resolved client-side; member/bbox regions resolve fully here.) */
function placedOfBoard(els: BoardElement[]): Placed[] {
  return els.map((e) => ({
    key: `el:${e.id}`,
    type: (e.content as { type?: string }).type,
    x: e.placement.x,
    y: e.placement.y,
    width: e.placement.width,
    height: e.placement.height,
    scale: e.placement.scale,
  }));
}

interface FactItem {
  key: string;
  value: unknown;
  superseded?: boolean;
}

/** Does a `_public/<pattern>` cover this key? (`*` = whole slice, trailing `*` =
 *  prefix, else exact.) Mirrors the lit cell's coverage check. */
export function covers(pattern: string, key: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1));
  return pattern === key;
}
export const covers0 = (patterns: string[], key: string): boolean => patterns.some((p) => covers(p, key));

/** The SSR authority decision for a board: the owner always; anyone else only
 *  when a `_public/` pattern covers `canvas:<board>`. (Exported for tests.) */
export const mayRenderBoard = (board: string, isOwner: boolean, patterns: string[]): boolean =>
  isOwner || covers0(patterns, `canvas:${board}`);

/** The public patterns the owner has shared — `_public/<pattern>` facts. A
 *  token-less (non-owner) SSR may only render a board these cover. */
async function publicPatterns(): Promise<string[]> {
  if (!TABLE) return [];
  const out: string[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const client = ddb();
  do {
    const r = await client.send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': 'KEY#_public/' },
        ExclusiveStartKey,
      }),
    );
    for (const it of (r.Items ?? []) as FactItem[]) {
      if (it.superseded) continue;
      const pat = (it.value as { pattern?: string } | undefined)?.pattern ?? it.key.slice('_public/'.length);
      out.push(pat);
    }
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/**
 * Read a board's elements from the owner's substrate slice, server-side. The
 * cell's IAM role grants `STATE#<owner>` reads only (LeadingKeys), so the
 * database itself is the authority boundary — no token needed. Placement facts
 * (`_canvas/<board>/el:<id>`) carry geometry; the referenced `el:<id>` facts
 * carry type + content.
 */
async function readBoard(board: string): Promise<BoardElement[]> {
  if (!TABLE) return [];
  const pk = `STATE#${OWNER}`;
  const placePrefix = `_canvas/${board}/el:`;
  const placements: FactItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const client = ddb();
  do {
    const r = await client.send(
      new Query({
        TableName: TABLE,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
        ExpressionAttributeValues: { ':pk': pk, ':p': `KEY#${placePrefix}` },
        ExclusiveStartKey,
      }),
    );
    for (const it of (r.Items ?? []) as FactItem[]) if (!it.superseded) placements.push(it);
    ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  if (!placements.length) return [];

  // Content facts for the placed elements (BatchGet, 100 keys per request).
  const contentKeys = placements.map((p) => p.key.slice(`_canvas/${board}/`.length)); // el:<id>
  const content = new Map<string, Content>();
  for (let i = 0; i < contentKeys.length; i += 100) {
    const batch = contentKeys.slice(i, i + 100);
    const r = await client.send(
      new Batch({ RequestItems: { [TABLE]: { Keys: batch.map((k) => ({ pk, sk: `KEY#${k}` })) } } }),
    );
    for (const it of (r.Responses?.[TABLE] ?? []) as FactItem[]) {
      if (!it.superseded && it.value && typeof it.value === 'object') content.set(it.key, it.value as Content);
    }
  }

  const out: BoardElement[] = [];
  for (const p of placements) {
    const elKey = p.key.slice(`_canvas/${board}/`.length); // el:<id>
    const c = content.get(elKey);
    const place = p.value as Placement | undefined;
    if (!c || !c.type || !place || typeof place.x !== 'number') continue;
    out.push({ id: c.id || elKey.replace(/^el:/, ''), placement: place, content: c });
  }
  return out;
}

/** A camera that frames the board's bounding box within a viewport (w×h). */
function fitCamera(els: BoardElement[], w = 1200, h = 800): { scale: number; tx: number; ty: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const e of els) {
    if (e.placement.static) continue;
    const s = e.placement.scale || 1;
    xs.push(e.placement.x - (e.placement.width * s) / 2, e.placement.x + (e.placement.width * s) / 2);
    ys.push(e.placement.y - (e.placement.height * s) / 2, e.placement.y + (e.placement.height * s) / 2);
  }
  if (!xs.length) return { scale: 1, tx: 0, ty: 0 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bw = Math.max(...xs) - minX;
  const bh = Math.max(...ys) - minY;
  const pad = 24;
  const scale = Math.min(1, (w - pad * 2) / Math.max(bw, 1), (h - pad * 2) / Math.max(bh, 1));
  // Center the framed board in the viewport.
  const tx = (w - scale * bw) / 2 - scale * minX;
  const ty = (h - scale * bh) / 2 - scale * minY;
  return { scale, tx, ty };
}

/** Critical CSS so the SSR board paints correctly before app.js loads. */
const CRITICAL_CSS = `
#boot-splash{display:none}
#canvas{position:relative;width:100%;height:100%;background:#fff;overflow:hidden}
#canvas-container{position:absolute;transform-origin:0 0;overflow:visible;--zoom:1}
.canvas-element{--scale:1;--zoom:1;--blend-mode:normal;--width:10px;--height:10px;--padding:calc(.5rem / var(--zoom));padding:var(--padding);font-size:calc(var(--scale) * 1em);position:absolute;box-sizing:content-box;background:transparent;overflow:visible;mix-blend-mode:var(--blend-mode)}
.canvas-element>.content{width:var(--width);border:1px solid transparent;box-sizing:border-box}
.canvas-element[type="img"]>.content,.canvas-element[type="html"]>.content{height:var(--height);overflow:hidden}
.canvas-element[type="img"]>.content{object-fit:cover}
.canvas-element[type="text"]>.content,.canvas-element[type="markdown"]>.content{line-height:1.2;font-family:monospace;margin:0;height:auto;overflow:visible}
.canvas-element>.content>*:first-child{margin-top:0}.canvas-element>.content>*:last-child{margin-bottom:0}
img.content{max-width:100%}
`;

// A static embed (?embed=1) is a zero-JS thumbnail: hide the editor chrome and
// make the whole document inert to touch, so it never captures scroll inside a
// host page. `touch-action:auto` overrides the app's first-paint
// `touch-action:none`; `pointer-events:none` means no element swallows a touch.
const EMBED_CSS = `
html,body{margin:0;height:100%;overflow:hidden;touch-action:auto!important}
body.embed{pointer-events:none}
body.embed #mode,body.embed #drillUp,body.embed #context-menu,body.embed #edit-modal,body.embed #err-banner{display:none!important}
`;

/** The camera for a board: the view's declared viewport if any, else fit. */
function cameraFor(viewport: Viewport, els: BoardElement[], w = 1200, h = 800): { scale: number; tx: number; ty: number } {
  if (viewport && viewport !== 'fit' && typeof viewport.x === 'number') {
    const scale = viewport.scale ?? 1;
    return { scale, tx: w / 2 - scale * viewport.x, ty: h / 2 - scale * viewport.y };
  }
  return fitCamera(els, w, h);
}

interface ShellOpts {
  board?: string;
  view?: string;
  embed?: boolean;
  w?: number;
  h?: number;
  /** The dispatch-validated viewer is the slice owner — full SSR. */
  isOwner?: boolean;
  /** `_public/` patterns; a non-owner may only SSR a board these cover. */
  patterns?: string[];
  /** Embed the board state as JSON so the client hydrates instantly (?hydrate=1)
   *  instead of re-fetching through the API. The server already read it. */
  hydrate?: boolean;
  /** Focus a named viewpoint (`frame:<id>`) instead of fitting the whole board. */
  frame?: string;
}

/**
 * Server-render a board into the shell: read the elements, render them through
 * the same isomorphic module the client uses, inject into the containers with a
 * fit camera + critical CSS. `data-ssr` tells the interactive client to
 * adopt/replace rather than append.
 *
 * With `embed`, it becomes a **zero-JS static thumbnail**: app.js and the
 * editor CDN scripts are stripped, the chrome hidden — a faithful still image
 * that costs nothing, so many can sit on one page. Any failure falls back to
 * the plain static shell — SSR never breaks the page.
 */
async function renderShell(opts: ShellOpts = {}): Promise<string> {
  const shell = read('static/index.html');
  try {
    // A view resolves to its board + the declared camera; a bare board fits.
    let board = opts.board;
    let viewport: Viewport = 'fit';
    if (opts.view) {
      const v = await readView(opts.view);
      board = v.board;
      viewport = v.viewport;
    }
    if (!board) return shell;
    // Authority boundary for SSR: the owner (dispatch-validated `x-cell-caller`)
    // gets a server-painted board; everyone else only when the owner has shared
    // it publicly (`_public/canvas:<board>`). Otherwise serve the interactive
    // shell — the client hydrates with the viewer's own session and the API
    // enforces grants per-fact. (Mirrors the lit cell; closes the SSR path that
    // would otherwise render a private board to an anonymous viewer.)
    if (!mayRenderBoard(board, !!opts.isOwner, opts.patterns ?? [])) return shell;
    const els = await readBoard(board);
    if (!els.length) return shell;
    // A named viewpoint (?frame=) frames a region; else the board's DEFAULT
    // viewpoint (so the first paint already sits where the client would jump to);
    // else the view's viewport / fit.
    const w = opts.w ?? 1200, h = opts.h ?? 800;
    let cam = cameraFor(viewport, els, opts.w, opts.h);
    // The framed region's bbox, in canvas coords — carried into the hydrate
    // payload so the client re-fits it to the REAL device viewport. The SSR
    // camera is fit to a fixed 1200×800, so it's only an approximation on a
    // phone; the client correction at hydrate (~50ms) is what makes it exact.
    let framedBBox: BBox | null = null;
    if (opts.frame) {
      const region = await readFrame(opts.frame);
      framedBBox = region ? regionBBox(region, placedOfBoard(els)) : null;
      if (framedBBox) cam = fitRegion(framedBBox, w, h);
    } else if (board && !opts.view) {
      const region = await readDefaultFrame(board);
      framedBBox = region ? regionBBox(region, placedOfBoard(els)) : null;
      if (framedBBox) cam = fitRegion(framedBBox, w, h);
    }
    const { dynamic, static: stat } = renderBoard(els, cam);
    const camTransform = `translate(${cam.tx.toFixed(1)}px,${cam.ty.toFixed(1)}px) scale(${cam.scale.toFixed(4)})`;
    const transform = `transform:${camTransform};--zoom:${cam.scale.toFixed(4)}`;
    // Frames overlay, server-painted (ADR-0015): the board's frame regions + label
    // pills, so they appear on the FIRST paint instead of after the client's lazy
    // frame query. Same shared renderer + transform model as the live overlay, so
    // the two agree; the client redraws #frames-layer in place on load.
    let framesSvg = '';
    if (board && !opts.embed) {
      const frames = await readFrames(board);
      if (frames.length) framesSvg = renderFramesSvg(frames, placedOfBoard(els));
    }
    const framesLayer = `<svg id="frames-layer" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:4;transform-origin:0 0;transform:${camTransform}">${framesSvg}</svg>`;
    let html = shell
      .replace('</head>', `<style id="ssr-critical">${CRITICAL_CSS}${opts.embed ? EMBED_CSS : ''}</style></head>`)
      .replace('<svg id="edges-layer"></svg>', `${framesLayer}<svg id="edges-layer"></svg>`)
      .replace(
        '<div id="canvas-container"></div>',
        `<div id="canvas-container" data-ssr="1" style="${transform}">${dynamic}</div>`,
      )
      .replace('<div id="static-container"></div>', `<div id="static-container" data-ssr="1">${stat}</div>`);
    // Hydration payload (?hydrate=1): the same board the server just read, in the
    // client's element shape, so the client constructs the live board from this
    // instead of the multi-second API re-fetch. `<` escaped so the JSON can't
    // break the <script>. Never for embeds (zero-JS), never the default path.
    if (opts.hydrate && !opts.embed) {
      const elements = els.map((e) => ({
        ...(e.content as Record<string, unknown>),
        ...(e.placement as Record<string, unknown>),
        id: e.id,
        _factKey: `el:${e.id}`,
      }));
      const payload = JSON.stringify({
        canvasId: board,
        cam: { scale: cam.scale, translateX: cam.tx, translateY: cam.ty },
        ...(framedBBox ? { frame: framedBBox } : {}),
        elements,
      }).replace(/</g, '\\u003c');
      html = html.replace(
        '<script type="module" src="/@c15r/canvas/app.js"></script>',
        `<script id="canvas-hydrate" type="application/json">${payload}</script>\n  <script type="module" src="/@c15r/canvas/app.js"></script>`,
      );
    }
    if (opts.embed) {
      // Zero-JS: the board is fully rendered server-side, so strip *every*
      // script — app.js, the editor libraries, AND the inline iOS touch-guard
      // (a non-passive touchend preventDefault) that was capturing touch and
      // blocking the host page's scroll.
      html = html
        .replace('<body>', '<body class="embed">')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<script\b[^>]*\/>/gi, '');
    }
    return html;
  } catch (err) {
    // Substrate read failed (cold IAM, throttle, schema drift) — serve the
    // interactive shell; the client hydrates from the substrate as before.
    console.warn('[canvas ssr] fell back to static shell', (err as Error).message);
    return shell;
  }
}

/** The cell's mount prefix on the apex — board path URLs are built against this. */
const MOUNT = `/@${OWNER}/canvas`;

export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'));
    if (path === '/style.css') return respond(200, 'text/css; charset=utf-8', read('static/style.css'));
    // ADR-0043 — the federated `ui://` board renderer (surface C). Non-sensitive
    // static code (ACAO:* + cacheable); the gateway provider hop fetches it for a
    // host, which runs it sandboxed and proxies its data reads. Board data never
    // travels here — only through the host-proxied `api.call`.
    if (path === '/renderers/board.js') {
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
        body: BOARD_RENDERER_SRC,
      };
    }

    const qs = new URLSearchParams((event.rawQueryString as string) || '');
    // The board now lives in the PATH (`/@owner/canvas/<board>`); the gateway
    // strips the mount, so rawPath is `/<board>`. The bare path is the landing
    // shell. (Frame/view/embed stay query modifiers.)
    const segs = path.split('/').filter(Boolean);
    const pathBoard = segs.length ? decodeURIComponent(segs[0]) : undefined;
    // Frame ids are board-prefixed (`<board>/<name>`), so the whole path is the
    // frame id once there's a segment past the board: `/parcland/forest`.
    const pathFrame = segs.length >= 2 ? segs.map(decodeURIComponent).join('/') : undefined;

    // Legacy `?canvas=<board>` (and `?frame=`) → canonical path form (301).
    // Frame ids are board-prefixed, so a frame folds into the whole path; the
    // rest of the query is preserved so old shared links keep working.
    const legacyCanvas = qs.get('canvas') ?? undefined;
    if (!pathBoard && legacyCanvas) {
      const rest = new URLSearchParams(qs);
      rest.delete('canvas');
      rest.delete('frame');
      const target = (qs.get('frame') || legacyCanvas).split('/').map(encodeURIComponent).join('/');
      const q = rest.toString();
      const location = `${MOUNT}/${target}${q ? `?${q}` : ''}`;
      return { statusCode: 301, headers: { location, 'cache-control': 'no-store' }, body: '' };
    }

    const board = pathBoard;
    const view = qs.get('view') ?? undefined;
    const embed = qs.get('embed') === '1';
    const w = Number(qs.get('w')) || undefined;
    const h = Number(qs.get('h')) || undefined;
    // `x-cell-caller` is the dispatch-validated identity (from the session
    // cookie on a top-level navigation, or a bearer); the cell is reachable
    // only via cells.call, so it can't be forged. The owner gets full SSR;
    // anyone else only sees boards the owner shared (`_public/`).
    const caller = event.headers?.['x-cell-caller'] as string | undefined;
    const isOwner = !!caller && caller === OWNER;
    // SSR a board (path) or a view (?view=, with its declared camera); the bare
    // app (no target) keeps the static shell.
    const patterns = (board || view) && !isOwner ? await publicPatterns() : [];
    // Hydration payload is emitted by default (escape with ?hydrate=0); never for
    // embeds (renderShell gates that). It only adds the JSON when SSR actually
    // paints a board, so a fallback-to-shell load carries no extra weight.
    const hydrate = qs.get('hydrate') !== '0';
    const frame = pathFrame ?? qs.get('frame') ?? undefined;
    const html = board || view ? await renderShell({ board, view, embed, w, h, isOwner, patterns, hydrate, frame }) : read('static/index.html');
    // Static embeds are safe to cache briefly at the edge — many thumbnails
    // on one page then cost one render, and refresh within a minute.
    const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
    if (embed && (board || view)) headers['cache-control'] = 'public, max-age=60, stale-while-revalidate=300';
    return { statusCode: 200, headers, body: html };
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
};
