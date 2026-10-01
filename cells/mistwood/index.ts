import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@c15r/mistwood` — a walk through a seeded wood in fog.
 *
 * The server only serves the shell (`static/index.html`), the client bundle
 * the platform builds from `client/main.ts` into `app.js` beside this file,
 * and the near ground's textures (`static/ground/`, CC0 from Poly Haven).
 * Everything else happens in the browser (WebGL2), from the seed in the address.
 *
 * git truth: cells/mistwood/ (README.md).
 */

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const respond = (statusCode: number, contentType: string, body: string, cache = 'no-cache') => ({
  statusCode,
  headers: { 'content-type': contentType, 'cache-control': cache },
  body,
});

/** The page names its bundle by content hash, so a deploy is never hidden behind a cached script. */
let page: string | null = null;
function shell(): string {
  if (page) return page;
  const v = createHash('sha256').update(read('app.js')).digest('hex').slice(0, 12);
  page = read('static/index.html').replace('src="/app.js"', `src="/app.js?v=${v}"`);
  return page;
}

/** Ground textures (static/ground/: CC0, Poly Haven), as bytes. Names are checked: only these. */
const GROUND = /^\/ground\/([a-z_]+\.webp)$/;
const bytes = new Map<string, string>();
function ground(name: string) {
  let b64 = bytes.get(name);
  if (!b64) {
    b64 = readFileSync(join(__dirname, 'static', 'ground', name)).toString('base64');
    bytes.set(name, b64);
  }
  return { statusCode: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=604800' }, body: b64, isBase64Encoded: true };
}

export const handler = async (event: { rawPath?: string; rawQueryString?: string }) => {
  const path = (event.rawPath ?? '/').replace(/^\/@[^/]+\/mistwood/, '') || '/';
  try {
    if (path === '/app.js') {
      const versioned = /(^|&)v=/.test(event.rawQueryString ?? '');
      return respond(200, 'application/javascript; charset=utf-8', read('app.js'), versioned ? 'public, max-age=31536000, immutable' : 'no-cache');
    }
    if (path === '/' || path === '/index.html') return respond(200, 'text/html; charset=utf-8', shell(), 'no-cache, no-store');
    const g = GROUND.exec(path);
    if (g) {
      try {
        return ground(g[1]);
      } catch {
        return respond(404, 'text/plain; charset=utf-8', 'no such ground');
      }
    }
  } catch (err) {
    return respond(500, 'text/plain; charset=utf-8', `mistwood: ${(err as Error).message}`);
  }
  return respond(404, 'text/plain; charset=utf-8', 'not here — the wood is at /');
};
