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
import { defineService, ServiceHttpResponse } from '../../platform/runtime';

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
<meta name="color-scheme" content="light">
<title>parc.land</title>
<style>html,body{margin:0;background:#f3edde}</style>
</head><body><div id="root"></div><script src="/app.js"></script></body></html>`;

function shell(): ServiceHttpResponse {
  return { statusCode: 200, headers: HTML_HEADERS, body: SHELL };
}

// (Retired: the `/_catalog` cell directory. The home SPA now reads the live
// capability palette via read("$catalog") on /mcp and invokes read/act there —
// the console subsumes the directory. See docs/home-cell.md.)

export const handler = defineService({
  name: 'home',
  commands: {},
  http: [
    { method: 'GET', path: '/', handler: shell },
    { method: 'GET', path: '/index.html', handler: shell },
    { method: 'GET', path: '/app.js', handler: () => ({ statusCode: 200, headers: JS_HEADERS, body: appJs() }) },
  ],
});

export default handler;
