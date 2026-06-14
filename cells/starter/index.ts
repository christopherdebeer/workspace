/* ---------------------------------------------------------------------------
 * starter — the happy-path cell template (server half).
 *
 * Plain TS (no JSX) so it stays the `index.ts` entry forge resolves; all JSX
 * lives in the .tsx modules it imports. It fetches nothing — a real cell would
 * read the substrate here (see cells/lit/index.ts) — and renderToString's the
 * shared tree into the shell for a server first paint the client hydrates.
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Starter } from './shared';

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
    // ACAO:* so a host-isolated sibling cell could import this module if it wanted.
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*' });
    if (path === '/' || path === '') {
      const inner = renderToString(createElement(Starter));
      const html = read('static/index.html').replace('<div id="app"></div>', `<div id="app" data-ssr="1">${inner}</div>`);
      return respond(200, 'text/html; charset=utf-8', html);
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
