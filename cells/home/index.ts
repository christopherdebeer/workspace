/* ---------------------------------------------------------------------------
 * home — the platform face as a tier-2 cell (server half).
 *
 * Non-privileged: serves the shell + the client bundle. The full home is the
 * SPA in client/main.tsx (ported verbatim from the old service, now on the
 * kernel) — landing, dashboard, identity/grants, the workspace window, pinned
 * views by hint, cells console, the field computer. Painted assets are vended as
 * public cell-data blobs (cells.putData under public/), served by forge at
 * /@c15r/home/_data/… — not data-URIs in the bundle. Becomes the platform root
 * via DISPATCH_DEFAULT_CELL=<owner>/home (deferred — test at /@<owner>/home).
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*' });
    if (path === '/' || path === '') return respond(200, 'text/html; charset=utf-8', read('static/index.html'));
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
