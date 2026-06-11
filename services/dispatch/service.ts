/**
 * dispatch — userland routing (tier-2 HTTP ingress).
 *
 * Owns a single CloudFront behaviour, `/d/*`, so every dynamic cell is reachable
 * by path without each one needing its own (build-time) behaviour. For
 * `/d/<cellId>/<rest>` it resolves the cell and proxies the call to `forge`
 * (Mode 1 command), which holds the invoke permission and the registry — so
 * dispatch never reads another cell's data directly. See `docs/dynamic-cells.md`.
 */
import {
  defineService,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
} from '../../platform/runtime';

const JSON_HEADERS = { 'content-type': 'application/json' };

interface CallCellResult {
  statusCode: number;
  body: unknown;
  /** The cell's own response headers (content-type etc.). */
  headers?: Record<string, string>;
  isBase64Encoded?: boolean;
}

/** Split `/@<owner>/<name>/<rest>` into owner, name, and the cell-relative path. */
function parsePath(rawPath: string): { owner: string; name: string; subPath: string } | null {
  const m = rawPath.match(/^\/@([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return {
    owner: decodeURIComponent(m[1]),
    name: decodeURIComponent(m[2]),
    subPath: m[3] && m[3].length > 0 ? m[3] : '/',
  };
}

async function route(req: ServiceHttpRequest, ctx: ServiceContext): Promise<ServiceHttpResponse> {
  // Anonymous GET/HEAD flow through so *public* cells can serve pages and
  // assets to a plain browser; `cells.call` is the gate — it only honours
  // anonymous reads for cells marked public, and everything else still
  // requires an authenticated owner-or-granted caller.
  const anonymousRead = req.method === 'GET' || req.method === 'HEAD';
  if (!ctx.identity.user && !anonymousRead) {
    return { statusCode: 401, headers: JSON_HEADERS, body: { error: 'Authentication required' } };
  }
  let parsed = parsePath(req.path);
  if (!parsed) {
    // Userland root (the home demotion): when DISPATCH_DEFAULT_CELL is set
    // ("owner/name"), unmatched paths route to that cell — the platform's
    // face becomes a tier-2 surface. Unset = current behavior.
    const [defOwner, defName] = (process.env.DISPATCH_DEFAULT_CELL ?? '').split('/');
    if (defOwner && defName) {
      parsed = { owner: defOwner, name: defName, subPath: req.path || '/' };
    } else {
      return { statusCode: 404, headers: JSON_HEADERS, body: { error: 'Expected /@<owner>/<cell> path' } };
    }
  }

  let body: unknown;
  if (req.rawBody) {
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      body = req.rawBody;
    }
  }

  try {
    // forge holds the registry + invoke permission; we proxy rather than read its
    // table or invoke the cell ourselves (preserving the cell boundary).
    const result = await ctx.serviceClient('cells').command<CallCellResult>('call', {
      owner: parsed.owner,
      name: parsed.name,
      method: req.method,
      path: parsed.subPath,
      query: new URLSearchParams(req.query).toString(),
      body,
    });
    // Pass the cell's response through faithfully: its headers (content-type
    // for HTML/JS/CSS), its body encoding, its status.
    return {
      statusCode: result.statusCode ?? 200,
      headers: result.headers ?? JSON_HEADERS,
      body: result.body,
      isBase64Encoded: result.isBase64Encoded,
    };
  } catch (err) {
    ctx.logger.warn('dispatch failed', {
      owner: parsed.owner,
      name: parsed.name,
      error: (err as Error).message,
    });
    return { statusCode: 502, headers: JSON_HEADERS, body: { error: (err as Error).message } };
  }
}

export const handler = defineService({
  name: 'dispatch',
  commands: {},
  http: [
    { method: 'GET', path: '/@*', handler: route },
    { method: 'HEAD', path: '/@*', handler: route },
    { method: 'POST', path: '/@*', handler: route },
    { method: 'PUT', path: '/@*', handler: route },
    { method: 'DELETE', path: '/@*', handler: route },
  ],
});

export default handler;
