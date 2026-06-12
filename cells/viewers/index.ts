import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

/**
 * @c15r/viewers — the shared pure-viewer module (transformers, pure kind).
 * Deterministic, free, secretless renderers: json tree, csv table, mermaid,
 * style. Canvas `_renderers/<type>` facts re-export from here (one line —
 * reference, not copy); lit fences import the same module.
 */
export const handler = async (event: { rawPath?: string; requestContext?: { http?: { method?: string } } }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') {
      return respond(200, 'application/javascript; charset=utf-8', readFileSync(join(__dirname, 'app.js'), 'utf8'), {
        'cache-control': 'public, max-age=60',
      });
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(
    200,
    'text/html; charset=utf-8',
    '<!doctype html><meta charset="utf-8"><title>viewers</title><pre>@c15r/viewers — pure viewers: json · csv · mermaid · style\n\nimport { json, csv, mermaid, style, renderFence } from "https://parc.land/@c15r/viewers/app.js"\n\ngit truth: cells/viewers/client/main.ts</pre>',
  );
};
