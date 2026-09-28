import { createHash } from 'node:crypto';
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

/**
 * The page names its bundle by content hash (`/app.js?v=<hash>`), so every
 * deploy is a new URL. With a fixed `/app.js`, an iPhone kept running an old
 * bundle from its own cache after deploys — the page was fresh, the script
 * was not. Computed once per cold start; the bundle never changes under a
 * running Lambda.
 */
let page: string | null = null;
function shell(): string {
  if (page) return page;
  const v = createHash('sha256').update(read('app.js')).digest('hex').slice(0, 12);
  page = read('static/index.html').replace('src="/app.js"', `src="/app.js?v=${v}"`);
  return page;
}

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
    // versioned URLs are immutable; a bare /app.js (old cached pages) stays short-lived
    if (path === '/app.js') {
      const versioned = /(^|&)v=/.test(event.rawQueryString ?? '');
      return respond(200, 'application/javascript; charset=utf-8', read('app.js'), versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    if (path === '/' || path === '/index.html') return respond(200, 'text/html; charset=utf-8', shell(), 'no-cache, no-store');
  } catch (err) {
    return respond(500, 'text/plain; charset=utf-8', `stillwater: ${(err as Error).message}`);
  }
  return respond(404, 'text/plain; charset=utf-8', 'not here — the river is at /');
};
