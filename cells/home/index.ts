/* ---------------------------------------------------------------------------
 * home — the platform face as a tier-2 cell (server half).
 *
 * Non-privileged: no DB, no commands — just an isomorphic surface. The workspace
 * view is salience-shaped, which the substrate computes, so it loads on the
 * client via the kernel (workspace.query with lenses); the server renders the
 * platform/ui chrome + sets `authed` from the dispatch-validated `x-cell-caller`
 * so a signed-in owner's first paint is already the workspace shell (no flash),
 * an anon visitor's is the landing. Becomes the platform root by setting
 * DISPATCH_DEFAULT_CELL=<owner>/home (deferred — test at /@<owner>/home first).
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Surface, type ViewModel } from './shared';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const OWNER = process.env.CELL_OWNER || 'c15r';
const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

export const handler = async (event: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET' && method !== 'HEAD') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') return respond(200, 'application/javascript; charset=utf-8', read('app.js'), { 'access-control-allow-origin': '*' });
    if (path === '/' || path === '') {
      const caller = event.headers?.['x-cell-caller'];
      const vm: ViewModel = { authed: !!caller && caller === OWNER };
      const inner = renderToString(createElement(Surface, { vm }));
      const state = JSON.stringify(vm).replace(/</g, '\\u003c');
      const html = read('static/index.html')
        .replace('<div id="app"><p class="boot">loading…</p></div>', `<div id="app" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="home-state" type="application/json">${state}</script>\n  <script type="module"`);
      return respond(200, 'text/html; charset=utf-8', html);
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
