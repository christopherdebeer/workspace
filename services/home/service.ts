/**
 * Home cell — serves the self-documenting platform SPA at `/`.
 *
 * The browser bundle (`app.js`) is produced from `client/main.tsx` by esbuild
 * at deploy time (see `HttpServiceCell` `clientEntry`) and shipped alongside
 * this handler in the Lambda asset; we read it from disk and serve it verbatim.
 * This cell is the router's default, so unmatched GETs land on the SPA shell.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  defineService,
  ServiceContext,
  ServiceHttpResponse,
  getOptional,
} from '../../platform/runtime';

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' };
const JS_HEADERS = { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=300' };

/** Lazily load the esbuild-produced client bundle (absent in unit tests). */
let appJsCache: string | undefined;
function appJs(): string {
  if (appJsCache === undefined) {
    try {
      appJsCache = readFileSync(join(__dirname, 'app.js'), 'utf8');
    } catch {
      appJsCache = 'console.error("client bundle (app.js) not found");';
    }
  }
  return appJsCache;
}

const SHELL = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>workspace · platform</title>
<style>html,body{margin:0;background:#0a0a0a}</style>
</head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function shell(): ServiceHttpResponse {
  return { statusCode: 200, headers: HTML_HEADERS, body: SHELL };
}

/** A dynamic cell as surfaced in the catalog (shape mirrors forge.catalogCells). */
interface CatalogCell {
  name: string;
  owner: string;
  address: string;
  status: string;
  description: string | null;
  shared: boolean;
}

/**
 * The live platform catalog. The static tier-1 manifests are injected at deploy
 * time (PLATFORM_CATALOG); the tier-2 `cells` are merged in per request from
 * `forge.catalogCells`, scoped to the caller (own + granted) — so an
 * authenticated visitor sees their dynamic cells beside the static ones, while
 * an anonymous visitor sees only the static manifests. Merging the runtime
 * registry into `/_catalog` is the data-driven half of the platform self-model.
 */
async function catalog(_req: unknown, ctx: ServiceContext): Promise<ServiceHttpResponse> {
  const services = JSON.parse(getOptional('PLATFORM_CATALOG') ?? '[]') as unknown[];
  let cells: CatalogCell[] = [];
  if (ctx.identity.user) {
    try {
      const res = await ctx
        .serviceClient('forge')
        .command<{ cells: CatalogCell[] }>('catalogCells', {});
      cells = res?.cells ?? [];
    } catch (err) {
      // Best-effort: the catalog stays useful even if forge is unavailable; the
      // dynamic section just collapses to empty.
      ctx.logger.warn('catalog: forge.catalogCells failed', { error: (err as Error).message });
    }
  }
  return { statusCode: 200, headers: { 'cache-control': 'no-cache' }, body: { services, cells } };
}

export const handler = defineService({
  name: 'home',
  commands: {},
  http: [
    { method: 'GET', path: '/', handler: shell },
    { method: 'GET', path: '/index.html', handler: shell },
    { method: 'GET', path: '/app.js', handler: () => ({ statusCode: 200, headers: JS_HEADERS, body: appJs() }) },
    // Live platform catalog: static tier-1 manifests (injected at deploy time)
    // merged with the caller's dynamic tier-2 cells. The SPA fetches this so the
    // rendered list reflects what's actually wired plus the caller's own cells.
    { method: 'GET', path: '/_catalog', handler: catalog },
  ],
});

export default handler;
