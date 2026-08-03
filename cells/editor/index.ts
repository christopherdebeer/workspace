import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

/**
 * `@c15r/editor` — the shared text editor module (CodeMirror 6).
 *
 * The authoring twin of `@c15r/viewers`: one validated implementation that
 * every surface imports, rather than an editor per cell. Read-only HTTP; the
 * module carries no substrate access of its own — a host passes in what it
 * wants completed (`completeFact`) and what to do on save, so the editor never
 * needs a session and can be served to anyone.
 *
 * `git truth: cells/editor/client/main.ts`.
 *
 * FIRST DEPLOY. `cell-sync push` writes files into a cell that already exists;
 * it does not provision one. So this cell is created once, then pushed like
 * any other. It must be PUBLIC for the same reason `@c15r/viewers` is: home is
 * guest-exposed at the apex and imports the module cross-origin with no
 * session, so anonymous GETs have to be allowed.
 *
 *   act cells.create { name: "editor", public: true, code: "export const handler = async () => ({ statusCode: 200, body: '' });" }
 *   node scripts/cell-sync.mjs push editor --deploy
 *
 * (The `code` above is a placeholder the push immediately overwrites —
 * `cells.create` requires one.) Until the cell is live, every host degrades to
 * its textarea floor, so nothing is blocked on the deploy.
 */
export const handler = async (event: { rawPath?: string; requestContext?: { http?: { method?: string } } }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') {
      // ACAO:* so host-isolated cells (home on the apex, lit on its own
      // subdomain, canvas) can import this shared module cross-origin.
      return respond(200, 'application/javascript; charset=utf-8', readFileSync(join(__dirname, 'app.js'), 'utf8'), {
        'cache-control': 'public, max-age=60',
        'access-control-allow-origin': '*',
      });
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(
    200,
    'text/html; charset=utf-8',
    '<!doctype html><meta charset="utf-8"><title>editor</title><pre>@c15r/editor — the shared text editor (CodeMirror 6)\n\nimport { mount } from "https://parc.land/@c15r/editor/app.js"\n\nmount(hostEl, { doc, lang: "markdown" | "json" | "text", onSave, onCancel, completeFact })\n\ngit truth: cells/editor/client/main.ts</pre>',
  );
};
