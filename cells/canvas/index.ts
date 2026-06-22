import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBoard, type BoardElement, type Placement, type Content } from './shared/render';
import { regionBBox, fitRegion, type Region, type Placed } from './shared/frame';

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
    // A named viewpoint (?frame=) frames a region; else the view's viewport / fit.
    const w = opts.w ?? 1200, h = opts.h ?? 800;
    let cam = cameraFor(viewport, els, opts.w, opts.h);
    if (opts.frame) {
      const region = await readFrame(opts.frame);
      const bbox = region ? regionBBox(region, placedOfBoard(els)) : null;
      if (bbox) cam = fitRegion(bbox, w, h);
    }
    const { dynamic, static: stat } = renderBoard(els, cam);
    const transform = `transform:translate(${cam.tx.toFixed(1)}px,${cam.ty.toFixed(1)}px) scale(${cam.scale.toFixed(4)});--zoom:${cam.scale.toFixed(4)}`;
    let html = shell
      .replace('</head>', `<style id="ssr-critical">${CRITICAL_CSS}${opts.embed ? EMBED_CSS : ''}</style></head>`)
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

export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'));
    if (path === '/style.css') return respond(200, 'text/css; charset=utf-8', read('static/style.css'));
    if (path === '/' || path === '') {
      const qs = new URLSearchParams((event.rawQueryString as string) || '');
      const board = qs.get('canvas') ?? undefined;
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
      // SSR a board (?canvas=) or a view (?view=, with its declared camera);
      // the bare app (no target) keeps the static shell.
      const patterns = (board || view) && !isOwner ? await publicPatterns() : [];
      const hydrate = qs.get('hydrate') === '1';
      const frame = qs.get('frame') ?? undefined;
      const html = board || view ? await renderShell({ board, view, embed, w, h, isOwner, patterns, hydrate, frame }) : read('static/index.html');
      // Static embeds are safe to cache briefly at the edge — many thumbnails
      // on one page then cost one render, and refresh within a minute.
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' };
      if (embed && (board || view)) headers['cache-control'] = 'public, max-age=60, stale-while-revalidate=300';
      return { statusCode: 200, headers, body: html };
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
