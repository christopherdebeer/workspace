import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

/**
 * @c15r/kernel — serves the shared client kernel module. Surfaces import
 * https://parc.land/@c15r/kernel/app.js (an ESM module with exports).
 */
export const handler = async (event: any) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') {
      // Short cache: kernel updates propagate within a minute, without paying
      // a Lambda hop per import on every page load.
      return respond(200, 'application/javascript; charset=utf-8', read('app.js'), {
        'cache-control': 'public, max-age=60',
      });
    }
    if (path === '/' || path === '') {
      return respond(
        200,
        'text/html; charset=utf-8',
        '<!doctype html><meta charset="utf-8"><title>kernel</title><pre>the parc.land client kernel\n\nimport { ensureAuth, read, act, titleOf, hrefOf } from "https://parc.land/@c15r/kernel/app.js"\n\ngit truth: cells/kernel/client/main.ts</pre>',
      );
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
