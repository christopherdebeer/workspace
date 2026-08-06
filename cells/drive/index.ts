import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * `@c15r/drive` — a standalone side-project cell: a top-down car game over the
 * real world. Spawn at a (near-)random point on Earth; the client streams
 * OpenStreetMap vectors and real elevation (AWS terrarium tiles) around the
 * car, renders them in three.js, and hides everything you haven't driven past
 * behind fog of war.
 *
 * The OSM vectors come through this cell's PUBLIC NAMESPACE (ADR-0095): the
 * client asks the edge for `~/osm/v1/<z>/<x>/<y>`, which is an object in S3
 * served by CloudFront with no compute in the path. Only a MISS reaches this
 * handler, which asks Overpass once, trims the answer to what the renderer
 * reads, writes the object, and returns it. `git truth: cells/drive/client/main.ts`.
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
  // World data. OSM vectors now come from THIS origin (the public namespace —
  // `'self'`), but the Overpass hosts stay in the list: the client falls back
  // to them directly if the cell's own tile route fails, so a bad deploy here
  // degrades to the old behaviour instead of an empty world.
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
  #boot .t { font-size: 1.05rem; color: #f5c453; letter-spacing: 0.3em; }
  #boot .s { font-size: 0.72rem; opacity: 0.65; max-width: 34ch; line-height: 1.5; }
  /* The world is up. There is no tap to wait for any more — the menu behind
     this overlay IS the start screen — so 'ready' is a state marker rather
     than a prompt, and 'done' lifts the overlay off it. NO BACKTICKS IN HERE:
     this whole shell is a template literal, and one closes it. */
  #boot.ready .s { color: #6fe0c0; letter-spacing: 0.22em; text-transform: uppercase; }
</style>
</head>
<body>
  <canvas id="scene"></canvas>
  <div id="boot"><div class="card">
    <div class="t">drive</div>
    <div class="s" id="boot-msg">warming up…</div>
  </div></div>
  <div class="hud" id="place"><b id="place-name">…</b><br><span class="dim" id="place-coords"></span></div>
  <button id="reroll" title="Start over somewhere else on Earth">elsewhere ↻</button>
  <div class="hud" id="speed">0<small> km/h</small></div>
  <div class="hud" id="hint">WASD/arrows · space=brake · C=camera · touch: stick + 2nd finger brake</div>
  <script type="module" src="/app.js"></script>
</body>
</html>`;

// ── the OSM tile miss handler (ADR-0095) ────────────────────────────
// Everything below runs ONLY on a cache miss: CloudFront looks in S3 first and
// falls through here on 403/404. What this writes is what the edge serves from
// then on, so the two rules that matter are (1) an empty tile must still be
// written — otherwise every ocean tile is a permanent miss and therefore a
// permanent invocation — and (2) a failure must never be written, or one bad
// minute upstream becomes our bad week.
const TILE_RE = /^\/~\/osm\/v1\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Two ceilings sit above this and it must clear BOTH: CloudFront's 60s origin
// read timeout, and — the one that actually bit — the cell's own Lambda
// timeout. Measured on the first live run with the 10s default: three of four
// tiles came back `502 Error from cloudfront` at ~10.7s, because the function
// was killed mid-fetch and never got to return its own 503. A 502 from a dead
// Lambda is strictly worse than a 503 from a live one: no `retry-after`, no
// `no-store`, and nothing in the logs saying which upstream failed. The cell is
// configured at 30s (`cells.configureCell timeoutSeconds`), and this stays
// under it so the handler always outlives its own request and can say why.
const UPSTREAM_MS = 22000;

/** Tile bounds on the standard web-mercator grid (the client's `tileBounds`). */
function tileBounds(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { latN, latS, lonW, lonE };
}

/** The query the client used to issue itself — unchanged, so the data is too. */
function overpassQuery(z: number, x: number, y: number): string {
  const b = tileBounds(z, x, y);
  const bbox = `${b.latS},${b.lonW},${b.latN},${b.lonE}`;
  return `[out:json][timeout:15];(
      way["highway"](${bbox});
      way["building"](${bbox});
      way["natural"="water"](${bbox});
      way["waterway"="riverbank"](${bbox});
      way["landuse"~"forest|meadow|grass|recreation_ground"](${bbox});
      way["leisure"~"park|pitch|garden"](${bbox});
    );out geom 2000;`;
}

interface RawWay { type?: string; id: number; tags?: Record<string, string>; geometry?: Array<{ lat: number; lon: number }> }

/**
 * Everything `renderWays` reads and nothing else, at 6dp (~11cm — an order of
 * magnitude finer than the heightfield it is draped on). Measured on the tiles
 * that motivated this: Manhattan 214 KB raw → 82 KB trimmed → 12 KB brotli.
 */
export function trimWays(elements: RawWay[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue;
    out.push({
      id: el.id,
      tags: el.tags ?? {},
      geometry: el.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)]),
    });
  }
  return out;
}

/**
 * The object key IS the request path. The template hands us
 * `CELL_PUBLIC_PREFIX = public/@<owner>/<slug>/~`, and the request arrives as
 * `/~/osm/v1/…`, so the key is the prefix plus everything after the `/~` — which
 * is exactly what CloudFront asks S3 for on the next request (`originPath` is
 * `/public`). Nothing derives, rewrites, or looks anything up.
 */
export function tileKey(path: string, prefix = process.env.CELL_PUBLIC_PREFIX ?? ''): string {
  return `${prefix}${path.slice(2)}`;
}

async function putTile(path: string, body: Buffer): Promise<void> {
  const bucket = process.env.CELL_PUBLIC_BUCKET;
  if (!bucket) return; // no namespace configured — serve, don't store
  const key = tileKey(path);
  // Required lazily: the SDK is not in the Node 20 Lambda image by default and
  // a cell without a public namespace should never pay to load it.
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  await new S3Client({}).send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: 'application/json; charset=utf-8',
    ContentEncoding: 'gzip',
    // The object carries its own policy: the edge honours this, and the path
    // is versioned (`osm/v1/…`) so `immutable` is a promise we can keep.
    CacheControl: 'public, max-age=604800, immutable',
  }));
}

async function serveTile(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z < 1 || z > 19 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'tile out of range' }));
  }
  let ways: Array<Record<string, unknown>>;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), UPSTREAM_MS);
    let res: Response;
    try {
      res = await fetch(OVERPASS, {
        method: 'POST',
        // Overpass answers a default Node fetch with 406. The browser always
        // sent its own UA so this never bit the client; server-side it is the
        // difference between data and nothing.
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'parc.land-drive/1.0 (+https://parc.land/@c15r/drive)',
        },
        body: `data=${encodeURIComponent(overpassQuery(z, x, y))}`,
        signal: ctl.signal,
      });
    } finally { clearTimeout(timer); }
    if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
    const json = (await res.json()) as { elements?: RawWay[] };
    ways = trimWays(json.elements ?? []);
  } catch (err) {
    // WRITE NOTHING. A 503 is retried; a stored failure is not.
    return respond(503, 'application/json', JSON.stringify({ error: String((err as Error).message ?? err) }), {
      'retry-after': '5',
      'cache-control': 'no-store',
    });
  }
  // An EMPTY tile is a real answer and must be stored like any other — ocean,
  // desert and open country are most of the planet, and leaving them unwritten
  // would make the commonest tile on Earth a permanent cache miss.
  const payload = JSON.stringify({ v: 1, z, x, y, ways });
  const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
  try {
    await putTile(path, gz);
  } catch { /* the fill is best-effort; the caller still gets its tile */ }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=604800, immutable',
      'access-control-allow-origin': '*',
    },
    body: gz.toString('base64'),
    isBase64Encoded: true,
  };
}

export const handler = async (event: { rawPath?: string; requestContext?: { http?: { method?: string } } }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  // The public namespace is a CACHED surface, so anything under `~/` that this
  // cell does not serve must say so plainly. Falling through to the SPA shell
  // put a day-long copy of the whole page in the CDN under a tile-shaped key —
  // observed on the first live probe, before any tile existed.
  if (path.startsWith('/~/')) {
    const tile = path.match(TILE_RE);
    if (tile) return serveTile(path, tile);
    return respond(404, 'application/json', JSON.stringify({ error: 'no such object' }), {
      'cache-control': 'no-store',
    });
  }
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
