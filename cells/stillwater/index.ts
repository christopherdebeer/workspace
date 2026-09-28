import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@c15r/stillwater` — a quiet numeracy journey down an endless lily river.
 *
 * The server half only serves the shell (`static/index.html`) and the client
 * bundle the platform builds from `client/main.ts` into `app.js` beside this
 * file. Everything that moves happens in the browser (WebGL2); there is no
 * state to keep here — progress lives in the player's own localStorage.
 *
 * git truth: cells/stillwater/ (see REVIEW-2026-09-28.md for why it looks like this).
 */

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, cache = 'no-cache') => ({
  statusCode,
  headers: { 'content-type': contentType, 'cache-control': cache },
  body,
});

export const handler = async (event: {
  rawPath?: string;
  rawQueryString?: string;
}) => {
  const path = (event.rawPath ?? '/').replace(/^\/@[^/]+\/stillwater/, '') || '/';
  // field reports from the client (client/report.ts) — logged, read back with `cells.logs`
  if (path === '/report') {
    const raw = new URLSearchParams(event.rawQueryString ?? '').get('d') ?? '';
    console.log('STILLWATER_REPORT ' + raw.slice(0, 8000));
    return { statusCode: 204, headers: { 'cache-control': 'no-store' }, body: '' };
  }
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), 'public, max-age=60');
    if (path === '/' || path === '/index.html') return respond(200, 'text/html; charset=utf-8', read('static/index.html'));
  } catch (err) {
    return respond(500, 'text/plain; charset=utf-8', `stillwater: ${(err as Error).message}`);
  }
  return respond(404, 'text/plain; charset=utf-8', 'not here — the river is at /');
};
