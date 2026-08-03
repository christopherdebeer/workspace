import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `@c15r/drive` — a standalone side-project cell: a top-down car game over the
 * real world. Spawn at a (near-)random point on Earth; the client streams
 * OpenStreetMap vectors (Overpass) and real elevation (AWS terrarium tiles)
 * around the car, renders them in three.js, and hides everything you haven't
 * driven past behind fog of war.
 *
 * Read-only HTTP, no substrate access, no session — the world data comes from
 * public GIS endpoints, fetched by the browser under this page's CSP.
 * `git truth: cells/drive/client/main.ts`.
 */

const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

const CSP = [
  "default-src 'none'",
  // The game module (served here) + three.js from esm.sh.
  "script-src 'self' https://esm.sh",
  "style-src 'unsafe-inline'",
  // World data: OSM vectors (Overpass, with a mirror), elevation tiles,
  // reverse geocoding for the HUD place name.
  "connect-src 'self' https://esm.sh https://overpass-api.de https://overpass.kumi.systems https://overpass.osm.jp https://overpass.private.coffee https://s3.amazonaws.com https://nominatim.openstreetmap.org",
  "img-src data: blob:",
  'worker-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const SHELL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>drive — the real world, top down</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #05070c; color: #efe9dc;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  #scene { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; }
  .hud { position: fixed; z-index: 10; pointer-events: none; }
  #place { top: max(10px, env(safe-area-inset-top)); left: 12px; right: 92px; font-size: 0.78rem;
    text-shadow: 0 1px 6px rgba(0,0,0,0.8); line-height: 1.35; }
  #place b { font-size: 0.92rem; font-weight: 600; }
  #place .dim { opacity: 0.6; font-size: 0.68rem; }
  #speed { bottom: max(12px, env(safe-area-inset-bottom)); right: 14px; font-size: 1.3rem; font-weight: 700;
    text-shadow: 0 1px 6px rgba(0,0,0,0.9); }
  #speed small { font-size: 0.6em; opacity: 0.6; font-weight: 400; }
  #reroll { position: fixed; z-index: 11; top: max(10px, env(safe-area-inset-top)); right: 12px;
    background: rgba(8,12,20,0.55); color: #f5c453; border: 1px solid rgba(245,196,83,0.4);
    border-radius: 8px; padding: 0.35rem 0.7rem; font: inherit; font-size: 0.74rem; cursor: pointer;
    backdrop-filter: blur(6px); }
  #hint { bottom: max(12px, env(safe-area-inset-bottom)); left: 14px; font-size: 0.66rem; opacity: 0.55;
    text-shadow: 0 1px 4px rgba(0,0,0,0.8); }
  #boot { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center;
    background: #05070c; transition: opacity 0.6s ease; }
  #boot.done { opacity: 0; pointer-events: none; }
  #boot .card { text-align: center; display: grid; gap: 0.6rem; padding: 1rem; }
  #boot .t { font-size: 1.05rem; color: #f5c453; }
  #boot .s { font-size: 0.72rem; opacity: 0.65; max-width: 34ch; line-height: 1.5; }
</style>
</head>
<body>
  <canvas id="scene"></canvas>
  <div id="boot"><div class="card">
    <div class="t">drive</div>
    <div class="s" id="boot-msg">finding a road somewhere on Earth…</div>
  </div></div>
  <div class="hud" id="place"><b id="place-name">…</b><br><span class="dim" id="place-coords"></span></div>
  <button id="reroll" title="Start over somewhere else on Earth">elsewhere ↻</button>
  <div class="hud" id="speed">0<small> km/h</small></div>
  <div class="hud" id="hint">drive: WASD / arrows · touch: drag = steer + throttle</div>
  <script type="module" src="/app.js"></script>
</body>
</html>`;

export const handler = async (event: { rawPath?: string; requestContext?: { http?: { method?: string } } }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  try {
    if (path === '/app.js') {
      return respond(200, 'application/javascript; charset=utf-8', readFileSync(join(__dirname, 'app.js'), 'utf8'), {
        'cache-control': 'public, max-age=60',
        'access-control-allow-origin': '*',
      });
    }
  } catch (err) {
    return respond(404, 'application/json', JSON.stringify({ error: (err as Error).message }));
  }
  return respond(200, 'text/html; charset=utf-8', SHELL, { 'content-security-policy': CSP });
};
