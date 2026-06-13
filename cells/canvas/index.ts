import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBoard, type BoardElement, type Placement, type Content } from './shared/render';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string) => ({
  statusCode,
  headers: { 'content-type': contentType },
  body,
});

const OWNER = process.env.CELL_OWNER || 'c15r';
const TABLE = process.env.SUBSTRATE_TABLE || '';

// The AWS SDK v3 ships in the node20 Lambda runtime, but load it LAZILY: a
// missing module then degrades SSR to the static fallback (caught below)
// instead of crashing the cell's import — the bare app + app.js must never 500.
interface Ddb {
  send(cmd: unknown): Promise<{ Items?: unknown[]; LastEvaluatedKey?: unknown; Responses?: Record<string, unknown[]> }>;
}
let doc: Ddb | undefined;
let Query: any;
let Batch: any;
function ddb(): Ddb {
  if (!doc) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const lib = require('@aws-sdk/lib-dynamodb');
    Query = lib.QueryCommand;
    Batch = lib.BatchGetCommand;
    doc = lib.DynamoDBDocumentClient.from(new DynamoDBClient({})) as Ddb;
  }
  return doc;
}

interface FactItem {
  key: string;
  value: unknown;
  superseded?: boolean;
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

interface ShellOpts {
  embed?: boolean;
  w?: number;
  h?: number;
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
async function renderShell(board: string, opts: ShellOpts = {}): Promise<string> {
  const shell = read('static/index.html');
  try {
    const els = await readBoard(board);
    if (!els.length) return shell;
    const cam = fitCamera(els, opts.w, opts.h);
    const { dynamic, static: stat } = renderBoard(els, cam);
    const transform = `transform:translate(${cam.tx.toFixed(1)}px,${cam.ty.toFixed(1)}px) scale(${cam.scale.toFixed(4)});--zoom:${cam.scale.toFixed(4)}`;
    let html = shell
      .replace('</head>', `<style id="ssr-critical">${CRITICAL_CSS}${opts.embed ? EMBED_CSS : ''}</style></head>`)
      .replace(
        '<div id="canvas-container"></div>',
        `<div id="canvas-container" data-ssr="1" style="${transform}">${dynamic}</div>`,
      )
      .replace('<div id="static-container"></div>', `<div id="static-container" data-ssr="1">${stat}</div>`);
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

export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'));
    if (path === '/style.css') return respond(200, 'text/css; charset=utf-8', read('static/style.css'));
    if (path === '/' || path === '') {
      const qs = new URLSearchParams((event.rawQueryString as string) || '');
      const board = qs.get('canvas');
      const embed = qs.get('embed') === '1';
      const w = Number(qs.get('w')) || undefined;
      const h = Number(qs.get('h')) || undefined;
      // SSR a concrete board; the bare app (no board) keeps the static shell.
      const html = board ? await renderShell(board, { embed, w, h }) : read('static/index.html');
      // Static embeds are safe to cache briefly at the edge — many thumbnails
      // on one page then cost one render, and refresh within a minute.
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
      if (embed && board) headers['cache-control'] = 'public, max-age=60, stale-while-revalidate=300';
      return { statusCode: 200, headers, body: html };
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
