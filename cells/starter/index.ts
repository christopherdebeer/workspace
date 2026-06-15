/* ---------------------------------------------------------------------------
 * starter — the canonical cell template (server half).
 *
 * Plain TS (no JSX) so it stays the `index.ts` entry forge resolves; JSX lives
 * in the .tsx modules it imports. renderToString's the shared `platform/ui`
 * tree into the shell for a server first paint (proving platform/ui is
 * isomorphic — it renders server-side), with a serialized ViewModel the client
 * hydrates against. The notes themselves load on the client via the kernel
 * (auth-gated, the viewer's owner slice), so this template needs no DB wiring;
 * see cells/lit/index.ts for the server-reads-the-substrate-for-SSR pattern.
 * ------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Surface, type ViewModel } from './shared';

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
      // Anonymous first paint: the shell + chrome render server-side from
      // platform/ui (the isomorphic proof); the client signs in and fills notes.
      const vm: ViewModel = { authed: false, notes: [] };
      const inner = renderToString(createElement(Surface, { vm }));
      const state = JSON.stringify(vm).replace(/</g, '\\u003c');
      const html = read('static/index.html')
        .replace('<div id="app"><p class="boot">loading…</p></div>', `<div id="app" data-ssr="1">${inner}</div>`)
        .replace('<script type="module"', `<script id="starter-state" type="application/json">${state}</script>\n  <script type="module"`);
      return respond(200, 'text/html; charset=utf-8', html);
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(404, 'application/json', JSON.stringify({ error: `no route for ${path}` }));
};
