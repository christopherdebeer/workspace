import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// The web surface is READ FROM DISK, from `static/` beside index.js in
// /var/task. It used to travel inside the bundle as a generated 230KB module of
// base64 string literals, because a cell could not ship bytes: source files
// were carried through the cells tools as JSON strings and stored as UTF-8, so
// a PNG came back larger and wrong (19,203 bytes in, 34,465 out) and the icons
// and manifest were dead on the live cell from the day they landed. That is
// fixed at the platform now — `cells.writeFile` takes `encoding: 'base64'`,
// `static/` deploys as bytes — so the generated module and its build script are
// gone and `static/` is the one source of truth, copied verbatim by the native
// shells too.
import { join } from 'node:path';
import { gzipSync, deflateSync, inflateSync } from 'node:zlib';

/**
 * `@c15r/drive` — a standalone side-project cell: a top-down car game over the
 * real world. Spawn at a (near-)random point on Earth; the client streams
 * OpenStreetMap vectors and real elevation (AWS terrarium tiles) around the
 * car, renders them in three.js, and hides everything you haven't driven past
 * behind fog of war.
 *
 * The OSM vectors come through this cell's PUBLIC NAMESPACE (ADR-0095): the
 * client asks the edge for `~/osm/v2/<z>/<x>/<y>`, which is an object in S3
 * served by CloudFront with no compute in the path. Only a MISS reaches this
 * handler, which asks Overpass once, trims the answer to what the renderer
 * reads, writes the object, and returns it. `git truth: cells/drive/client/main.ts`.
 */

const respond = (statusCode: number, contentType: string, body: string, extra: Record<string, string> = {}) => ({
  statusCode,
  headers: { 'content-type': contentType, ...extra },
  body,
});

// Exported so a test can serve the page under the POLICY THE PHONE GETS. The
// harness sends no CSP of its own, which means anything the real page forbids
// — eval, a script from an unlisted host — works perfectly in every test and
// fails only where it cannot be inspected. A test that cares opts in by
// passing this to openDrive; nothing else changes behaviour.
export const CSP = [
  "default-src 'none'",
  // The game module (served here) + three.js from esm.sh.
  "script-src 'self' https://esm.sh",
  "style-src 'unsafe-inline'",
  // World data. OSM vectors now come from THIS origin (the public namespace —
  // `'self'`), but the Overpass hosts stay in the list: the client falls back
  // to them directly if the cell's own tile route fails, so a bad deploy here
  // degrades to the old behaviour instead of an empty world.
  // …plus api.open-meteo.com, which is the live sky: cloud cover, rain and the
  // wind that pushes the deck across it. No key, CORS open, and if it is
  // unreachable the synthetic weather chain simply keeps running.
  // …and tiles.mapterhorn.com, the ELEVATION. It was added to the client and
  // not to this line, so every DEM request from a real browser was blocked by
  // `default-src 'none'` while the headless harness — which relays through
  // curl and never sees a CSP — measured it working perfectly. The client
  // treats a thrown fetch as "this tile does not exist", so the whole source
  // quietly disabled itself and fell back to AWS terrarium: the corrupt data
  // Mapterhorn was brought in to replace, including the -13,029m hole at
  // Chapman's Peak. Nothing reported it, because a silent fallback was the
  // designed behaviour for a genuinely missing tile.
  // …and the apex, for the OAuth endpoints ALONE. `/state` is same-origin on
  // this cell's own host, so signing in is the only thing that reaches off it
  // (docs/cell-origin-isolation.md §4.5).
  "connect-src 'self' https://parc.land https://esm.sh https://overpass-api.de https://overpass.kumi.systems https://overpass.osm.jp https://overpass.private.coffee https://s3.amazonaws.com https://nominatim.openstreetmap.org https://api.open-meteo.com https://tiles.mapterhorn.com",
  "img-src 'self' data: blob:",
  // The menu's pixel face (Silkscreen) ships inside the bundle as data: URIs —
  // no font host, so the page stays self-contained.
  'font-src data:',
  // blob: is the road profile solver; 'self' is /sw.js. A document may only
  // register a service worker its OWN policy admits, and this directive is
  // where that is decided — the registration fails silently otherwise, which
  // is the same shape of invisible failure the mapterhorn host had above.
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const SHELL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#071215">
<meta name="color-scheme" content="dark">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Drive">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/drive-32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/drive-180.png">
<title>drive — the real world, top down</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #05070c; color: #efe9dc;
    /* Silkscreen lands when the game module injects its @font-face; until
       then the monospace stack holds the line. */
    font-family: Silkscreen, ui-monospace, SFMono-Regular, Menlo, monospace;
    /* NOTHING HERE IS TEXT TO BE HAD. This is a game held in one thumb, and
       every one of these four exists because a phone browser assumes it is
       looking at a document.
         user-select   a thumb resting on the stick is a long press, and a long
                       press over a word starts a selection with a magnifier on
                       top of the road. The menu and the overlays each carried
                       this rule already; the canvas, the boot card and the
                       document itself never did, which is most of the screen.
         touch-callout the same press, on iOS, also raises the share/copy sheet.
         tap-highlight a grey flash behind every chip you press, on a palette
                       chosen to the pixel.
         overscroll    drag past the end of the settings list and the whole page
                       rubber-bands off its own background. */
    -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    overscroll-behavior: none; }
  /* …except where text is genuinely the point. Nothing takes typing today —
     the only input in the build is a colour swatch — but a rule that silently
     breaks the first text field somebody adds is a trap, not a policy. */
  input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }
  #scene { position: fixed; inset: 0; width: 100%; height: 100%; touch-action: none; }
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
  <script type="module" src="/app.js"></script>
</body>
</html>`;

const WEB_ASSETS: Record<string, { file: string; type: string }> = {
  '/manifest.webmanifest': {
    file: 'manifest.webmanifest',
    type: 'application/manifest+json; charset=utf-8',
  },
  '/icons/drive-32.png': { file: 'icons/drive-32.png', type: 'image/png' },
  '/icons/drive-180.png': { file: 'icons/drive-180.png', type: 'image/png' },
  '/icons/drive-192.png': { file: 'icons/drive-192.png', type: 'image/png' },
  '/icons/drive-512.png': { file: 'icons/drive-512.png', type: 'image/png' },
  '/icons/drive-maskable-512.png': { file: 'icons/drive-maskable-512.png', type: 'image/png' },
};

/**
 * THE SERVICE WORKER, STAMPED WITH THE BUNDLE IT BELONGS TO.
 *
 * The worker names its cache after this hash, so a deploy is a new cache filled
 * from scratch and the page can never be served against an `app.js` it was not
 * built with. Hashing the bundle rather than taking a version from anywhere
 * else means the stamp cannot drift from what is actually being served: the two
 * come off the same bytes on the same disk.
 *
 * Computed once per container and held, because it is 1.4MB of SHA1 and the
 * answer cannot change under a running Lambda. Lazily, not at import: a deploy
 * that somehow lacked `app.js` would otherwise take the whole cell down instead
 * of one route.
 */
let bundleStamp: string | null = null;
/** The bundle's own fingerprint, computed once. Named here rather than inside
 *  the service worker's handler because the CLIENT wants it too now — the
 *  ABOUT page has to be able to say which build the reader is looking at, and
 *  the first question of any report is which version it was. Hashing app.js
 *  BEFORE the placeholder is filled keeps it stable: the placeholder is a
 *  constant, so the stamp does not depend on itself. */
function stampOf(): string {
  if (bundleStamp === null) {
    try {
      bundleStamp = createHash('sha1')
        .update(readFileSync(join(__dirname, 'app.js'))).digest('hex').slice(0, 12);
    } catch { bundleStamp = 'unstamped'; }
  }
  return bundleStamp;
}
function serveServiceWorker() {
  const body = webText('sw.js').replace('__DRIVE_SW_BUILD__', stampOf());
  return respond(200, 'application/javascript; charset=utf-8', body, {
    // The one file that must never come from a stale cache: it is the only
    // thing that can replace a stale cache. Browsers already refuse to reuse a
    // worker script older than a day; this says so for the rest.
    'cache-control': 'no-cache',
  });
}

/**
 * A file from `static/`, read once and kept.
 *
 * READ WITHOUT AN ENCODING, so it is a Buffer and stays one. The whole class of
 * bug this replaces was a UTF-8 decode applied to bytes that are not text —
 * every invalid sequence becomes U+FFFD, which does not merely corrupt the file
 * but INFLATES it, silently, behind a 200 and a correct content-type. So the
 * icons never become strings anywhere in this path: disk to Buffer to base64 to
 * the wire.
 *
 * Cached because a warm Lambda serves the same five icons for its whole life
 * and /var/task is read-only — there is nothing to invalidate.
 */
const webCache = new Map<string, Buffer>();
function webBytes(file: string): Buffer {
  const hit = webCache.get(file);
  if (hit) return hit;
  const buf = readFileSync(join(__dirname, 'static', file));
  webCache.set(file, buf);
  return buf;
}
/** The text ones — the worker and the manifest — decoded at the last moment. */
const webText = (file: string): string => webBytes(file).toString('utf8');

/**
 * ── A CAPTURED FIXTURE, OVER THE WIRE ──
 *
 * These used to be `import world-bixby.json` in the client, which esbuild
 * inlines: six captures came to 2.37MB against a 1.51MB bundle, so they would
 * have been sixty per cent of app.js on a game whose first tenet is mobile
 * first. They live in `static/fixtures/` now and are fetched only when a URL
 * actually names one.
 *
 * The name is matched against a strict pattern rather than joined straight onto
 * a path: `readFileSync(join(dir, req))` with an unchecked name is how a static
 * route becomes a file-read primitive, and `..` survives a lot of naive
 * checking. Only `world-<lowercase, digits, dashes>.json` can address anything
 * here, and a name that does not match never reaches the filesystem.
 *
 * Immutable, because a capture never changes in place: a new capture of the
 * same place is still the same file, but its content only moves when someone
 * re-runs the tool and deploys, and the bundle stamp changes with it.
 */
const FIXTURE_NAME = /^world-[a-z0-9-]+\.json$/;

function serveFixture(path: string) {
  const name = path.slice('/fixtures/'.length);
  if (!FIXTURE_NAME.test(name)) return null;
  let body: Buffer;
  try {
    body = webBytes(join('fixtures', name));
  } catch {
    return null;                       // absent is a 404, as for any other asset
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
    body: body.toString('base64'),
    isBase64Encoded: true,
  };
}

function serveWebAsset(path: string) {
  const asset = WEB_ASSETS[path];
  if (!asset) return null;
  // ONE EXIT, base64, for text and bytes alike: the manifest could go out as a
  // string but then this function would have two shapes and the icons would be
  // the special case, which is how the last version of it got this wrong.
  let body: string;
  try {
    body = webBytes(asset.file).toString('base64');
  } catch {
    // A missing static file is a DEPLOY fault, not a request fault. 404 rather
    // than 500 so it reads the same as it did when these were served from a
    // module that could not fail — and so the appshell test's fetch of every
    // declared asset still names which one is absent.
    return null;
  }
  return {
    statusCode: 200,
    headers: {
      'content-type': asset.type,
      'cache-control': path === '/manifest.webmanifest'
        ? 'public, max-age=3600'
        : 'public, max-age=86400',
    },
    body,
    isBase64Encoded: true,
  };
}

// ── the OSM tile miss handler (ADR-0095) ────────────────────────────
// Everything below runs ONLY on a cache miss: CloudFront looks in S3 first and
// falls through here on 403/404. What this writes is what the edge serves from
// then on, so the two rules that matter are (1) an empty tile must still be
// written — otherwise every ocean tile is a permanent miss and therefore a
// permanent invocation — and (2) a failure must never be written, or one bad
// minute upstream becomes our bad week.
const TILE_RE = /^\/~\/osm\/v[2-4]\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;   // v4: water relations
const COVER_RE = /^\/~\/cover\/v1\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
// THREE upstreams, not one. Measured on a 12km corridor through Death Valley:
// 7 of 25 cold tiles came back 503 at 9–12.5s because the single upstream was
// rate-limiting (HTTP 429) or timing out (504). A failure is deliberately never
// stored, so those tiles fail again on every reload — which reads to a player
// as "roads don't load here, permanently", though nothing is cached at all.
// Rotating mirrors turns the commonest failure (a 429, which comes back
// instantly) into a sub-second detour instead of a dead tile.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// Two ceilings sit above this and it must clear BOTH: CloudFront's 60s origin
// read timeout, and — the one that actually bit — the cell's own Lambda
// timeout. Measured on the first live run with the 10s default: three of four
// tiles came back `502 Error from cloudfront` at ~10.7s, because the function
// was killed mid-fetch and never got to return its own 503. A 502 from a dead
// Lambda is strictly worse than a 503 from a live one: no `retry-after`, no
// `no-store`, and nothing in the logs saying which upstream failed.
//
// THE CEILING WAS ~15.5s, AND IT WAS OURS TO MOVE. Measured live on
// 2026-08-15 by walking five tiles of rising cost: one answered at 15.74s and
// every slower one came back 502 at 15.5-16.3s, wherever its own budget sat.
// That retired a long-standing mystery — the overview layer's "cold fill
// sometimes 503s" was never mirror contention, it was OV_UPSTREAM_MS sitting
// above a ceiling nobody had measured — and then it was treated as a fact of
// nature for a fortnight. It was not. It was this cell's own Lambda timeout,
// and `cells.configureCell` takes 10-300 seconds.
//
// It is 50s now. The next ceiling up is CloudFront's 60s origin read, which
// is NOT ours, so 50 leaves the margin on the right side of the line.
//
// What that buys is the tiles that could never answer at all. A dense z12 box
// wants 11-18s of Overpass and had a 10s window; legs 2 to 5 of the line each
// had between four and twenty tiles that were not unlucky but simply too big
// for the budget, and three re-runs moved leg 5 from four cold tiles to four.
// The alternative — asking for LESS on the retry, dropping tertiary and then
// secondary — was drafted and thrown away: it degrades the tile everywhere to
// work around a number we control.
// …but SPEND LESS OF IT FAILING. Rotating mirrors made the failure path longer
// (three attempts where there had been one), and a slow failure is worse than a
// fast one: the client holds a fetch slot for the whole of it, and six held
// slots stall the ring. The point of mirrors is to SUCCEED more often, not to
// spend longer losing — and the commonest failure, a 429, returns instantly, so
// a short budget still fits all three. A tile that cannot be got in twelve
// seconds is better retried later, when it may well be warm.
const UPSTREAM_MS = 12000;   // the whole budget, across every mirror
const ATTEMPT_MS = 5000;     // …and no single mirror may spend all of it

// ── land cover: what is actually growing here ──────────────────────
//
// The renderer used to pick a biome from LATITUDE — one palette for a whole
// world, so the Sahara and the Nile delta came out identical — and scatter
// vegetation from whichever OSM landuse polygons happened to be tagged. ESA
// WorldCover answers the question properly: eleven classes, ten metres, the
// whole planet, CC-BY-4.0 and free.
//
// It cannot be fetched by the browser — the bucket serves no CORS headers and
// its preflight 403s — so it comes through this namespace like the vectors do.
// Which is the better shape anyway: the source is a 36000×36000 GeoTIFF per 3°
// cell, and what the client wants is a small mercator tile.
//
// NO GEOTIFF LIBRARY. The files are 8-bit, single band, DEFLATE, predictor 1,
// tiled 1024×1024, with a seven-level overview pyramid (36000→562) — which
// means `node:zlib` and about eighty lines of IFD walking is the whole reader,
// and the pyramid lets us pull the level whose resolution already matches the
// zoom asked for. Measured: ONE 40KB range request, inflated in 5ms, covers
// 38km square at 37m/px.
const WORLDCOVER = 'https://esa-worldcover.s3.amazonaws.com/v200/2021/map';
const WC_SPAN = 3;        // degrees per source file
const WC_FULL = 36000;    // pixels across at full resolution
const WC_TILE = 1024;     // internal tile size, every level

/** The source file covering a point, named from its south-west corner. */
function wcFile(lat: number, lon: number): { url: string; lat0: number; lon0: number } {
  const lat0 = Math.floor(lat / WC_SPAN) * WC_SPAN;
  const lon0 = Math.floor(lon / WC_SPAN) * WC_SPAN;
  const ns = lat0 < 0 ? `S${String(-lat0).padStart(2, '0')}` : `N${String(lat0).padStart(2, '0')}`;
  const ew = lon0 < 0 ? `W${String(-lon0).padStart(3, '0')}` : `E${String(lon0).padStart(3, '0')}`;
  return { url: `${WORLDCOVER}/ESA_WorldCover_10m_2021_v200_${ns}${ew}_Map.tif`, lat0, lon0 };
}

interface WcLevel { w: number; h: number; off: number[]; cnt: number[] }
const wcRange = async (url: string, a: number, b: number): Promise<Buffer> => {
  const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` } });
  if (!r.ok && r.status !== 206 && r.status !== 200) throw new Error(`cover HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

/** Walk the IFD chain far enough to know where every tile of every overview
 *  lives. The header and all the offset arrays sit in the first 64KB. */
export function wcLevels(head: Buffer): WcLevel[] {
  if (head.toString('ascii', 0, 2) !== 'II' || head.readUInt16LE(2) !== 42) {
    throw new Error('cover: not a little-endian classic TIFF');
  }
  const u16 = (o: number): number => head.readUInt16LE(o);
  const u32 = (o: number): number => head.readUInt32LE(o);
  const out: WcLevel[] = [];
  let off = u32(4);
  while (off && off + 2 < head.length && out.length < 12) {
    const n = u16(off);
    const d: Record<number, number | number[]> = {};
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      const tag = u16(e), type = u16(e + 2), num = u32(e + 4), vo = e + 8;
      if (type === 3 && num === 1) d[tag] = u16(vo);
      else if (type === 4 && num === 1) d[tag] = u32(vo);
      else if (type === 4) {
        const p = num * 4 <= 4 ? vo : u32(vo);
        const arr: number[] = [];
        for (let k = 0; k < num; k++) arr.push(u32(p + k * 4));
        d[tag] = arr;
      }
    }
    const w = d[256] as number, h = d[257] as number;
    const offs = d[324], cnts = d[325];
    if (w && h && offs !== undefined && cnts !== undefined) {
      out.push({
        w, h,
        off: Array.isArray(offs) ? offs : [offs],
        cnt: Array.isArray(cnts) ? cnts : [cnts],
      });
    }
    off = u32(off + 2 + n * 12);
  }
  if (!out.length) throw new Error('cover: no tiled IFD found');
  return out;
}

/** The coarsest overview still finer than what the request asks for. Sampling
 *  a 10m grid to draw a 40m pixel is thirty-two times the bytes for a number
 *  that rounds to the same class. */
export function wcLevelFor(z: number): number {
  const outDeg = 360 / (2 ** z * 256);
  let best = 0;
  for (let L = 0; L < 7; L++) if ((WC_SPAN * 2 ** L) / WC_FULL <= outDeg) best = L;
  return best;
}

// ── PNG, by hand ───────────────────────────────────────────────────
// 8-bit greyscale, because the PIXEL VALUE IS THE CLASS: 10 tree, 20 shrub, 30
// grass, 40 crop, 50 built, 60 bare, 70 snow, 80 water, 90 wetland, 95
// mangrove, 100 moss, 0 nothing known. The client reads the red channel of an
// ImageBitmap exactly as it already does for terrarium elevation, so this adds
// a data source without adding a decoder.
const CRC_TAB = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TAB[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function pngChunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function greyPng(px: Uint8Array, size: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit grey
  // One filter byte per scanline, filter 0 (none) — the data is class indices,
  // and delta-filtering indices only makes them harder to compress.
  const raw = Buffer.alloc((size + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * size, size).copy(raw, y * (size + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const COVER_PX = 256;
/** Build one web-mercator cover tile out of whatever source cells it lands on. */
export async function coverTile(z: number, x: number, y: number): Promise<Buffer> {
  const L = wcLevelFor(z);
  const n = 2 ** z;
  const out = new Uint8Array(COVER_PX * COVER_PX);   // 0 = nothing known
  // Everything this tile needs, gathered before a byte is fetched: the source
  // files it overlaps, and within each the 1024-pixel blocks it touches. A
  // mercator tile is small enough that this is usually one file and one block.
  const heads = new Map<string, Promise<WcLevel[] | null>>();
  const blocks = new Map<string, Promise<Buffer | null>>();
  const lonOf = (px: number): number => ((x + px / COVER_PX) / n) * 360 - 180;
  const latOf = (py: number): number => {
    const t = Math.PI * (1 - (2 * (y + py / COVER_PX)) / n);
    return (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  };
  const headFor = (url: string): Promise<WcLevel[] | null> => {
    let p = heads.get(url);
    if (!p) {
      p = wcRange(url, 0, 65535).then(wcLevels).catch(() => null);
      heads.set(url, p);
    }
    return p;
  };
  // Pass one: resolve headers. Pass two: pull blocks. Pass three: fill.
  const want: Array<{ i: number; url: string; sx: number; sy: number }> = [];
  for (let j = 0; j < COVER_PX; j++) {
    const lat = latOf(j + 0.5);
    for (let i = 0; i < COVER_PX; i++) {
      const lon = lonOf(i + 0.5);
      const f = wcFile(lat, lon);
      want.push({ i: j * COVER_PX + i, url: f.url, sx: (lon - f.lon0) / WC_SPAN, sy: (f.lat0 + WC_SPAN - lat) / WC_SPAN });
    }
  }
  await Promise.all([...new Set(want.map((w) => w.url))].map(headFor));
  for (const w of want) {
    const lv = await heads.get(w.url);
    if (!lv) continue;
    const f = lv[Math.min(L, lv.length - 1)];
    const px = Math.min(f.w - 1, Math.max(0, Math.floor(w.sx * f.w)));
    const py = Math.min(f.h - 1, Math.max(0, Math.floor(w.sy * f.h)));
    const across = Math.ceil(f.w / WC_TILE);
    const bi = Math.floor(py / WC_TILE) * across + Math.floor(px / WC_TILE);
    const key = `${w.url}#${L}#${bi}`;
    if (!blocks.has(key) && f.off[bi] !== undefined) {
      blocks.set(key, wcRange(w.url, f.off[bi], f.off[bi] + f.cnt[bi] - 1)
        .then((b) => inflateSync(b) as Buffer).catch(() => null));
    }
  }
  await Promise.all(blocks.values());
  for (const w of want) {
    const lv = await heads.get(w.url);
    if (!lv) continue;
    const f = lv[Math.min(L, lv.length - 1)];
    const px = Math.min(f.w - 1, Math.max(0, Math.floor(w.sx * f.w)));
    const py = Math.min(f.h - 1, Math.max(0, Math.floor(w.sy * f.h)));
    const across = Math.ceil(f.w / WC_TILE);
    const blk = await blocks.get(`${w.url}#${L}#${Math.floor(py / WC_TILE) * across + Math.floor(px / WC_TILE)}`);
    if (!blk) continue;
    out[w.i] = blk[(py % WC_TILE) * WC_TILE + (px % WC_TILE)] ?? 0;
  }
  return greyPng(out, COVER_PX);
}

async function serveCover(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z < 1 || z > 16 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'tile out of range' }));
  }
  let png: Buffer;
  try {
    png = await coverTile(z, x, y);
  } catch (err) {
    // Same rule as the vectors: a failure is retried, never stored.
    return respond(503, 'application/json', JSON.stringify({ error: String((err as Error).message ?? err) }), {
      'retry-after': '5', 'cache-control': 'no-store',
    });
  }
  // An all-zero tile is a REAL answer — WorldCover is a land product, so open
  // ocean legitimately has no class — and storing it is what stops every sea
  // tile being a permanent invocation.
  try { await putTile(path, png, 'image/png', null); } catch { /* best effort */ }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=604800, immutable',
      'access-control-allow-origin': '*',
    },
    body: png.toString('base64'),
    isBase64Encoded: true,
  };
}

// ── the overview tiles: the chart's coarse vector source ───────────
// The fine tiles stop at OSM_RING_MAX because covering a 47km chart at z16 is
// 8649 Overpass queries — "anything more honest needs a coarser road source",
// and this is that source. One tile at z10–13 carries only what a chart at
// that scale can draw: the major road classes, rail, the big waterways, the
// coastline, and the PLACES — city, town, village — that turn a landform into
// a map. No buildings, no landuse, no barriers: those are world, not chart.
const OV_RE = /^\/~\/osm\/ov1\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
// The element budget, and it is a TRIPWIRE, not a target. `out geom N` stops
// SILENTLY at N — a dense tile would come back looking complete, get written
// to S3 `immutable`, and serve a map with the middle of a city missing for a
// week. At the cap the tile is refused (503, no-store) rather than stored.
// Per zoom, because the ladder below admits more classes as tiles shrink:
// measured, central London at z12 lands at 5174 elements with rail in — the
// worst real tile should pass, and a truncated one must not.
// The TRUNCATION TRIPWIRE, per level — `out geom N`, and a response AT N is a
// truncation rather than an answer. It rises with zoom because the class ladder
// does (z13 carries tertiaries, z<=10 carries motorways and little else), and
// the two coarse rungs get more headroom than z10 for the opposite reason: the
// same narrow class set over 4x and 16x the ground. Measured on the first z9
// tiles served: 19-24KB gzipped, nowhere near the cap.
// z7 is a 313km box carrying motorways and trunks alone — the rung the chart
// reaches past the z8 ring once its sight line was doubled to 600km. Given
// the most headroom of all, for the same reason z8 has more than z10.
//
// THE CAPS USED TO RUN THE WRONG WAY AGAINST THEIR OWN REASON. z8 was given
// 8000 and z10 3000 on the stated grounds of "the same narrow class set over 4x
// and 16x the ground" — but the class set at z8 was not narrower than z10's, it
// was IDENTICAL, so sixteen times the area was given 2.7 times the headroom and
// the tripwire fired on the rung it was least likely to be wrong about. With
// z7-z9 served from the bake and z10 narrowed to motorways and trunks, each
// rung's cap is now sized to the ask it actually makes: the coarse three are
// fall-through values only, and z10's headroom rises because its query no
// longer carries the class that was filling it.
const OV_CAP: Record<number, number> = { 5: 12000, 6: 12000, 7: 12000, 8: 8000, 9: 6000, 10: 6000, 11: 4500, 12: 6000, 13: 6000 };
// These tiles are rare and cached forever, so they may spend upstream time a
// fine tile cannot. Measured: a z10 coastal tile needs 11-18s of Overpass, and
// the densest z12 boxes on the line want more — the fine budget's 5s-per-mirror
// would have refused every overview tile that matters.
//
// Sized under the 50s Lambda (see the note by OVERPASS_MIRRORS), leaving six
// seconds for the trim, the gzip and the S3 write. A tile that cannot be got
// inside this is better refused with a `retry-after` than killed mid-flight.
const OV_UPSTREAM_MS = 44000;
// PATIENCE FOR THE SLOW CASE, MIRRORS FOR THE FAST ONE — which is what this
// number has to buy at once, and why it is most of the budget rather than a
// third of it.
//
// A dense z12 tile near a metropolis needs 11-18s of Overpass. Halving the
// window to 5000 to guarantee three attempts was tried on 2026-08-25 and was
// strictly worse: every one of those tiles began failing with "operation was
// aborted", the Paris aperture's own included. The tiles worth the most are
// exactly the ones a hurried window cannot get.
//
// Two full attempts do not fit in the upstream budget, and they do not need
// to. The commonest failure — a 429, a mirror at its per-IP limit — returns
// INSTANTLY, so a first mirror that is merely busy still leaves room for the
// other two. What this window protects is the other case: a mirror that is
// genuinely working on a big query, which used to be aborted at ten seconds
// and is now allowed to finish. The Overpass-side `timeout:25` gives up just
// before we do, so a box that is truly too big returns a clean error rather
// than a blind abort.
//
// AND AT 26000 THE THIRD MIRROR WAS UNREACHABLE BY CONSTRUCTION. `askOverpass`
// gives mirror one `min(attempt, left)` = 26s; on failure `left` is 18s, so
// mirror two gets 18s; then `left` is under the 1500ms floor and the loop
// breaks. Three mirrors were configured and two were ever tried — which matters
// far more than it looks, because mirror health is not uniform: measured on
// 2026-09-09, a ONE-BLOCK query returning 23 ways took 39.6s on kumi and 36.4s
// on private.coffee against 1.6s on overpass-api.de. Two of the three were
// saturated, and a rotation with no memory of health starts two thirds of tiles
// on one of them.
//
// 18000 makes the sequence 18 + 18 + 8 and reaches all three. It is chosen
// against the measurement that set the old number rather than away from it: the
// case this window exists to protect is "a dense z12 tile near a metropolis
// needs 11-18s of Overpass", and 18s still covers all of it. What it gives up
// is the 18-26s tail on the FIRST mirror, in exchange for ever trying the
// third — and with z7-z9 now served from the bake, the boxes still coming
// through here are 39km and smaller.
const OV_ATTEMPT_MS = 18000;
function overviewQuery(z: number, x: number, y: number): string {
  const b = tileBounds(z, x, y);
  const bbox = `${b.latS},${b.lonW},${b.latN},${b.lonE}`;
  // THE CLASS LADDER IS THE BUDGET. A z10 box is ~40km on a side, and asking
  // it for secondaries and rail is what timed out: the classes climb as the
  // tiles shrink, and each level carries only what its scale can draw —
  // motorways at the scale of a region, tertiaries only at the tightest band.
  // z7 IS THE WIDEST RUNG AND THE NARROWEST ASK, and the ask was measured
  // before the rung was offered. A z7 box is 313km on a side; the Paris tile
  // asked for motorways and trunks alone came back as 6,645 ways of 58k
  // points, 7.6MB raw, in 65s from a loaded mirror — past the 44s this
  // handler can wait — and the same box's coastline on its own did not return
  // in 100s. Motorways alone are about half of that count. So z7 carries the
  // motorways and the cities and nothing else: the shell's own cover raster
  // paints the sea at that scale, and rivers, summits and coast stay on z8
  // and finer, where the trim's tolerance (611m at z7) could draw them
  // anyway. A dense European z7 tile may still take several stream passes to
  // land; once it does the bank serves it for ever.
  //
  // ── AND z7-z9 NO LONGER COME THROUGH HERE AT ALL ──
  //
  // They are served from the Natural Earth bake (`ne-wide.ts`), so this
  // function's real range is z10 to z13 and the ladder below is written for
  // that. The z7 branch is kept because `serveOverview` falls through to
  // Overpass if the baked asset is missing from a deploy, and a fall-through
  // that asks a query nobody has thought about is not a fallback.
  //
  // THE MIDDLE OF THE LADDER WAS NEVER A LADDER. z8, z9 and z10 all asked for
  // `motorway|trunk|primary` over boxes of 156, 78 and 39km — sixteen, four and
  // one times the area for an identical ask. Only z7 was ever narrowed, and it
  // was narrowed because somebody measured it. z10 is the rung that remains
  // here and it now drops to motorways and trunks: at 39km across and 150m a
  // chart pixel, a primary through a town is a scribble, and primaries are also
  // where the count explodes, because OSM splits them at every junction and
  // name change.
  const hw = z <= 7 ? 'motorway'
    : z <= 9 ? 'motorway|trunk'
    : z === 10 ? 'motorway|trunk'
    : z === 11 ? 'motorway|trunk|primary|secondary'
    : 'motorway|trunk|primary|secondary|tertiary';
  const rail = z >= 11 ? `way["railway"="rail"](${bbox});` : '';
  const canal = z >= 11 ? '|canal' : '';
  const river = z >= 10 ? `way["waterway"~"^(river${canal})$"](${bbox});` : '';
  // THE COASTLINE IS OFF BELOW z11, AND `out geom` IS WHY. It returns a matched
  // way's WHOLE geometry, not the part inside the box, and a coastline way is
  // not bounded by anything: one of them clipping the corner of a 39km tile can
  // carry a continent's worth of vertices into it, invisibly, because the way
  // COUNT stays at one. z7 already carried no coast for a measured reason ("the
  // same box's coastline on its own did not return in 100s"); the reason does
  // not stop applying at z8. The shell's own land cover paints the sea at every
  // one of these scales, which is what made z7 safe to narrow.
  const coast = z >= 11 ? `way["natural"="coastline"](${bbox});` : '';
  const peak = z >= 10 ? `node["natural"="peak"]["name"](${bbox});` : '';
  const place = z <= 7 ? 'city' : z <= 10 ? 'city|town' : z === 11 ? 'city|town|village' : 'city|town|village|hamlet';
  return `[out:json][timeout:25];(
      way["highway"~"^(${hw})$"](${bbox});
      ${rail}
      ${river}
      ${coast}
      node["place"~"^(${place})$"](${bbox});
      ${peak}
    );out geom ${OV_CAP[z] ?? 6000};`;
}
/**
 * Ramer–Douglas–Peucker, in metres. OSM survey geometry carries a vertex
 * every few metres; a chart pixel at these zooms is twenty. Simplification is
 * where the real byte savings live — the class filter decides what is in the
 * tile, this decides what it weighs.
 */
export function simplifyLine(pts: Array<[number, number]>, tolM: number): Array<[number, number]> {
  if (pts.length <= 2) return pts;
  const lat0 = (pts[0][0] * Math.PI) / 180;
  const mLon = 111320 * Math.cos(lat0);
  const px = (p: [number, number]): [number, number] => [p[1] * mLon, p[0] * 111320];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = px(pts[a]), [bx, by] = px(pts[b]);
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let worst = -1, wd = tolM;
    for (let i = a + 1; i < b; i++) {
      const [cx, cy] = px(pts[i]);
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
      const d = Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t));
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const OV_TAGS = ['highway', 'railway', 'waterway', 'natural', 'place', 'name', 'ele'];
/** What the chart reads and nothing else, simplified to what it can draw. */
export function trimOverview(elements: RawWay[], z: number): Array<Record<string, unknown>> {
  // Half a chart pixel at this zoom: 256px across a tile, in metres of ground.
  const tol = (40075016.7 / 2 ** z) / 512;
  const out: Array<Record<string, unknown>> = [];
  for (const el of elements) {
    const tags: Record<string, string> = {};
    for (const k of OV_TAGS) if (el.tags?.[k] !== undefined) tags[k] = el.tags[k];
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      out.push({ id: el.id, tags, geometry: [[+el.lat.toFixed(5), +el.lon.toFixed(5)]] });
      continue;
    }
    if (!el.geometry?.length) continue;
    const pts = el.geometry.map((g) => [g.lat, g.lon] as [number, number]);
    out.push({ id: el.id, tags, geometry: simplifyLine(pts, tol).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]) });
  }
  return out;
}
async function serveOverview(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // The floor is the bake's: every rung below z10 is Natural Earth's, and the
  // widest it serves is one number in ne-wide.ts. The globe lowers it.
  if (z < NE_MIN_Z || z > 13 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'overview tile out of range' }));
  }
  // ── THE WIDE RUNGS DO NOT ASK ANYONE ───────────────────────────────
  //
  // z7, z8 and z9 come from the Natural Earth bake in `ne-wide.ts`. They used
  // to ask Overpass and could not be got: measured against this cell, a pure
  // ocean tile — a box with nothing in it — 502'd at the edge exactly like a
  // Cape Town city tile, and the same z9 tile asked at 0s, 70s and 140s came
  // back 502 every time, so it was not filling in the background either.
  //
  // A tile from here is arithmetic over an already-loaded array: no upstream,
  // no budget, no mirror, and the same answer every time. It still banks, so
  // the edge serves it from S3 ever after and the Lambda is not asked twice.
  //
  // The fall-through is deliberate and is the whole safety of the swap: if the
  // asset is missing from a deploy, `neWideTile` returns null and these rungs
  // go back to Overpass exactly as before, degraded rather than broken.
  const baked = z <= NE_MAX_Z ? neWideTile(z, x, y) : null;
  if (baked) {
    const payload = JSON.stringify({ v: 1, z, x, y, ways: trimOverview(baked, z) });
    const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
    try { await putTile(path, gz); } catch { /* best effort */ }
    return {
      statusCode: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'gzip',
        'cache-control': 'public, max-age=604800, immutable',
        'access-control-allow-origin': '*',
        // Which source answered, so "is the bake live?" is a curl and not a
        // deploy archaeology exercise. The old failures were one bare 503 for
        // four different causes and that is most of why this took two sessions
        // to diagnose wrongly twice.
        'x-ov-src': 'ne',
      },
      body: gz.toString('base64'),
      isBase64Encoded: true,
    };
  }
  let elements: RawWay[];
  try {
    // …AND THE ROTATION CARRIES A CLOCK, exactly as serveTile's does. Keyed to
    // the tile alone, a tile is bound to the same first mirror for ever: if
    // that mirror is down the tile is a permanent 503, and no amount of
    // retrying moves it. With the minute in the key, the next attempt starts
    // somewhere else and the tile fills on its own.
    const rot = (x + y + z + Math.floor(Date.now() / 60000)) % OVERPASS_MIRRORS.length;
    elements = await askOverpass(overviewQuery(z, x, y), OV_UPSTREAM_MS, OV_ATTEMPT_MS, rot);
  } catch (err) {
    // THE 503 SAYS WHICH FAILURE THIS IS. It used to be one bare string for
    // four different endings — mirror refused instantly, query timed out,
    // budget exhausted, cap tripped — and nobody outside could tell them apart,
    // which is most of why the wide chart was diagnosed wrongly twice. `why`
    // and `src` are the difference between a curl and an afternoon.
    return respond(503, 'application/json', JSON.stringify({
      error: String((err as Error).message ?? err),
      why: 'upstream', src: 'overpass', z,
      // If this is a coarse rung it should never have got here: say so, because
      // a silent fall-through to the path that does not work is the failure
      // mode the bake was added to end.
      ...(z <= NE_MAX_Z ? { bakeMissing: neWideError() ?? 'asset absent' } : {}),
    }), { 'retry-after': '5', 'cache-control': 'no-store', 'x-ov-src': 'overpass' });
  }
  // The tripwire: a response AT the cap is a truncation, not an answer.
  if (elements.length >= (OV_CAP[z] ?? 6000)) {
    return respond(503, 'application/json', JSON.stringify({
      error: 'tile too dense for the overview cap', why: 'cap', src: 'overpass', z, cap: OV_CAP[z] ?? 6000,
    }), { 'retry-after': '60', 'cache-control': 'no-store', 'x-ov-src': 'overpass' });
  }
  const payload = JSON.stringify({ v: 1, z, x, y, ways: trimOverview(elements, z) });
  const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
  try { await putTile(path, gz); } catch { /* best effort */ }
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

// ── the campaign: authored destinations, served not compiled ───────
/**
 * The curated drives and their missions used to be a literal inside
 * `client/main.ts`. That file reached a megabyte and crossed the single-write
 * ceiling this week (see `scripts/cell-sync.mjs`), and authored content had no
 * business being in it anyway: a destination list is data someone edits, not
 * code someone runs.
 *
 * It is served from the cell's own public namespace — the same CDN-fronted
 * prefix as the tiles — so a player's boot costs a cache hit, not a Lambda.
 * The path carries the VERSION because those objects are immutable: bump
 * `CAMPAIGN_V` here and in the client together with any edit to the JSON, or
 * the old object shadows the new one forever. (The client also keeps its last
 * good copy, so a cold namespace or a lost connection costs the list for that
 * session and nothing else.)
 *
 * A MODULE, NOT JSON: the cell's own bundler has no JSON loader and parsed the
 * file as JavaScript on the first deploy attempt. The shape is checked at build
 * time now, which is the better answer anyway.
 *
 * Deliberately NOT substrate facts: the game is isolated and reads no slice.
 * See `docs/drive-persistence.md`.
 */
import { CAMPAIGN } from './campaigns/dakar';
import { assembleRelationRings } from './osm-rings';
import { neWideTile, neWideError, NE_MAX_Z, NE_MIN_Z } from './ne-wide';

const CAMPAIGN_V = CAMPAIGN.v;
const CAMPAIGN_RE = /^\/~\/campaign\/(\d{1,4})$/;
function serveCampaign(path: string, m: RegExpMatchArray) {
  if (Number(m[1]) !== CAMPAIGN_V) {
    return respond(404, 'application/json', JSON.stringify({ error: 'no such campaign version' }), {
      'cache-control': 'no-store',
    });
  }
  const gz = gzipSync(Buffer.from(JSON.stringify(CAMPAIGN), 'utf8'), { level: 9 });
  void putTile(path, gz).catch(() => { /* serve now, store best-effort */ });
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=2592000, immutable',
      'access-control-allow-origin': '*',
    },
    body: gz.toString('base64'),
    isBase64Encoded: true,
  };
}

// ── the peak tiles: named summits, for the far landmarks ───────────
/**
 * SUMMITS, AT THE SCALE YOU CAN SEE THEM FROM.
 *
 * A mountain is the one map feature that is legible from hundreds of
 * kilometres, so it has its own layer at its own zoom: z7, ~250km of ground
 * per tile, which is also — not by coincidence — about the distance from
 * which the tallest peak on Earth clears the horizon (√(2Rh): Everest 336km,
 * Mont Blanc 248km, a 1000m hill 113km).
 *
 * The trap in this data is DENSITY, not size. Big Sur's whole z7 tile holds
 * 151 named peaks with an elevation; the Mont Blanc massif's holds 7268 and
 * takes Overpass ~18-27s. So the answer is capped at the HIGHEST few and the
 * budget matches the overview layer's, which was tuned against the same
 * upstream. What is stored is small either way: 150 summits is a few KB.
 *
 * Keeping the tallest — rather than a floor in metres — is what makes this
 * work everywhere. A floor tuned for the Alps erases the Netherlands, whose
 * highest ground is a 322m hill and is nonetheless the landmark there.
 */
const PEAK_CAP = 120;             // per tile, tallest first
// MEASURED, AND THE FIRST ANSWER WAS WRONG. This began at z7 — 250km tiles,
// one query per quarter-million km² — and the two tiles that mattered most
// both came back 502: the Lambda is capped at 30s and the Mont Blanc massif
// costs Overpass 18-27s of that, leaving nothing for the gzip and the S3
// write. A 502 from a dead function is strictly worse than a 503 from a live
// one, and it is exactly the mountainous ground this layer exists for.
// z8 quarters the area: the same Alpine ground measures 7.6s and 1858
// summits, which fits inside the budget with room to say why if it fails.
// ONE HONEST ATTEMPT, not two half ones — the same rule as the overview's,
// for the same reason. An Alpine z8 tile needs ~7.6s of upstream and a budget
// split into two short tries spent the first on whichever mirror was unhealthy
// and died before the second could finish. A window wide enough for the work,
// and a mirror that fails FAST (a 429 returns instantly) still leaves room for
// the next one — which is exactly the failure worth retrying inline.
//
// Widened with the rest when the Lambda ceiling went to 50s: z8 tiles over
// dense ranges are the ones this layer exists for, and they were the ones the
// old window could not get.
const PEAK_UPSTREAM_MS = 44000;
const PEAK_ATTEMPT_MS = 26000;
/**
 * ══════════════════════════════════════════════════════════════════
 * ECOREGIONS — the one thing climate cannot derive
 * ══════════════════════════════════════════════════════════════════
 *
 * The site model under `climate.ts` computes heat, water, seasonality and the
 * rest from physics, and it can reach most of the world that way. It cannot
 * reach FYNBOS. The Cape is an ordinary Mediterranean climate — mild, wet
 * winter, bone-dry summer, maritime — that grows something structurally unlike
 * any other Mediterranean climate on earth. No refinement of a temperature and
 * a rainfall gets there, because the difference is not climatic: it is who
 * happened to evolve there. Chaparral, matorral, maquis and kwongan are the
 * same argument on four other coasts.
 *
 * So this is the one place the model reads a MAP instead of computing. RESOLVE
 * Ecoregions 2017 — 846 terrestrial ecoregions inside 14 biomes, the standard
 * carve-up — served through the same read-through cache as everything else:
 * asked once for a tile, banked in the public namespace, served from the edge
 * afterwards. Verified against the fixture set before the route was written:
 * the Cape returns "Fynbos shrubland", Yosemite "Sierra Nevada forests",
 * Zermatt "Alps conifer and mixed forests", Tamanrasset "West Saharan montane
 * xeric woodlands".
 *
 * ── ONE ZOOM, AND IT IS A COARSE ONE ──
 *
 * Ecoregions are enormous and their boundaries are fuzzy in nature as well as
 * in the data, so there is no pyramid: z5 tiles, about 1250km across at the
 * equator, and the server simplifies to 0.05 degrees on the way out. Measured
 * over the Cape: six features, 52KB gzipped — an overview tile's weight for a
 * region's worth of answer, where the alternative was a point query per plant.
 *
 * ── AN EMPTY TILE IS AN ANSWER ──
 *
 * Most of the planet is ocean and has no terrestrial ecoregion. That must be
 * stored like any other tile or the commonest tile on earth is a permanent
 * cache miss — the same rule serveTile records for open country.
 */
const ECO_RE = /^\/~\/eco\/v1\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
/** RESOLVE Ecoregions 2017, as published on ArcGIS Living Atlas. */
const ECO_URL = 'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services'
  + '/Resolve_Ecoregions/FeatureServer/0/query';
/** Degrees of boundary simplification asked of the server. 0.05 is about 5km,
 *  which is coarser than the 2km climate lattice and finer than any ecoregion
 *  boundary is real to. 0.02 doubled the payload and moved nothing. */
const ECO_OFFSET = 0.05;
const ECO_MS = 20000;

async function serveEco(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // ONE ZOOM. A pyramid over data this coarse would multiply the upstream
  // traffic and the storage to say the same thing at every level.
  if (z !== 5 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'eco tiles are z5 only' }));
  }
  const b = tileBounds(z, x, y);
  const env = JSON.stringify({
    xmin: b.lonW, ymin: b.latS, xmax: b.lonE, ymax: b.latN,
    spatialReference: { wkid: 4326 },
  });
  const q = new URLSearchParams({
    geometry: env,
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'ECO_ID,ECO_NAME,BIOME_NUM,BIOME_NAME,REALM',
    returnGeometry: 'true',
    maxAllowableOffset: String(ECO_OFFSET),
    geometryPrecision: '3',
    outSR: '4326',
    f: 'geojson',
  });
  let raw: { features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> };
  try {
    const ctl = new AbortController();
    const bail = setTimeout(() => ctl.abort(), ECO_MS);
    try {
      const res = await fetch(`${ECO_URL}?${q}`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`eco HTTP ${res.status}`);
      raw = (await res.json()) as typeof raw;
    } finally { clearTimeout(bail); }
  } catch (err) {
    // WRITE NOTHING. A 503 is retried; a stored failure is not.
    return respond(503, 'application/json', JSON.stringify({ error: String((err as Error).message ?? err) }), {
      'retry-after': '5', 'cache-control': 'no-store',
    });
  }
  // Trimmed to what a guild rule can use: the id to key a prior on, the biome
  // for the coarse fallback, and the name so a probe can be read by a human.
  // Everything else the service carries — colours, areas, NNH status — is the
  // conservation dataset's business and not this game's.
  const regions = (raw.features ?? []).map((f) => ({
    id: Number(f.properties?.ECO_ID ?? -1),
    biome: Number(f.properties?.BIOME_NUM ?? -1),
    name: String(f.properties?.ECO_NAME ?? ''),
    realm: String(f.properties?.REALM ?? ''),
    g: f.geometry ?? null,
  })).filter((r) => r.g && r.id >= 0);
  const payload = JSON.stringify({ v: 1, z, x, y, regions });
  const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
  try { await putTile(path, gz); } catch { /* best effort */ }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      'cache-control': 'public, max-age=604800, immutable',
    },
    body: gz.toString('base64'),
    isBase64Encoded: true,
  };
}
const PEAK_RE = /^\/~\/osm\/peak1\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
/** OSM `ele` is free text: "1234", "1234.5", "1234 m", "4,808", and junk.
 *  Metres only — a value in feet is not marked as such often enough to guess,
 *  so anything above the roof of the world is discarded rather than assumed. */
export function parseEle(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(/,/g, '').match(/^\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v > -450 && v <= 8850 ? v : null;
}
export function trimPeaks(elements: RawWay[]): Array<{ n: string; la: number; lo: number; e: number }> {
  const out: Array<{ n: string; la: number; lo: number; e: number }> = [];
  for (const el of elements) {
    if (el.lat === undefined || el.lon === undefined) continue;
    const name = el.tags?.name;
    const ele = parseEle(el.tags?.ele);
    if (!name || ele === null) continue;
    out.push({ n: name, la: +el.lat.toFixed(5), lo: +el.lon.toFixed(5), e: Math.round(ele) });
  }
  out.sort((a, b) => b.e - a.e);
  return out.slice(0, PEAK_CAP);
}
async function servePeaks(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (z !== 8 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'peak tile out of range' }));
  }
  const b = tileBounds(z, x, y);
  const bbox = `${b.latS},${b.lonW},${b.latN},${b.lonE}`;
  const q = `[out:json][timeout:25];node["natural"="peak"]["name"]["ele"](${bbox});out body 20000;`;
  let elements: RawWay[];
  try {
    // The mirror rotates with the CLOCK as well as the tile: a tile whose
    // first mirror is unhealthy would otherwise ask the same broken host on
    // every retry forever. A minute apart is a different mirror.
    const rot = (x + y + Math.floor(Date.now() / 60000)) % OVERPASS_MIRRORS.length;
    elements = await askOverpass(q, PEAK_UPSTREAM_MS, PEAK_ATTEMPT_MS, rot);
  } catch (err) {
    return respond(503, 'application/json', JSON.stringify({ error: String((err as Error).message ?? err) }), {
      'retry-after': '5', 'cache-control': 'no-store',
    });
  }
  const payload = JSON.stringify({ v: 1, z, x, y, peaks: trimPeaks(elements) });
  const gz = gzipSync(Buffer.from(payload, 'utf8'), { level: 9 });
  try { await putTile(path, gz); } catch { /* best effort */ }
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-encoding': 'gzip',
      // Mountains do not move. A month, and the object is immutable anyway.
      'cache-control': 'public, max-age=2592000, immutable',
      'access-control-allow-origin': '*',
    },
    body: gz.toString('base64'),
    isBase64Encoded: true,
  };
}

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
  // A FUEL STATION IS A NODE. So is a viewpoint, a summit, and most garages —
  // and this query asked only for ways, which is why the rig had nowhere to be
  // serviced and the map had nothing worth driving to. `nwr` fixes that class
  // of thing outright. Rivers were the same shape of miss: only `riverbank`
  // POLYGONS were fetched, and the overwhelming majority of rivers in OSM are
  // a LINE with no polygon at all, so anything short of a major river simply
  // did not exist.
  //
  // Deliberately NOT here: barriers (walls, fences, hedges). They are the most
  // numerous objects in a city by a distance, the sim already grows its own
  // guard rails, and we have just spent real effort making tiles arrive in
  // time. Measured at Bormio, the v2 additions cost +20% bytes and +39%
  // elements, which is a fair price; barriers were several times that on their
  // own. The v3 additions (R55) are the SINGULAR things instead — a town has
  // one water tower, not four thousand fence segments: named man_made
  // verticals, aeroways, historic sites, wind turbines, dams. Historic and
  // dam/weir are fetched AHEAD of a renderer for them, because a fetch is a
  // week of cache and a tile version, and a renderer is an evening.
  return `[out:json][timeout:15];(
      way["highway"](${bbox});
      way["building"](${bbox});
      way["natural"~"water|coastline|cliff|scrub|wetland|bare_rock|sand"](${bbox});
      way["waterway"~"riverbank|river|stream|canal"](${bbox});
      relation["natural"="water"](${bbox});
      relation["waterway"="riverbank"](${bbox});
      way["landuse"~"forest|meadow|grass|recreation_ground|farmland|orchard|vineyard|quarry"](${bbox});
      way["leisure"~"park|pitch|garden|nature_reserve"](${bbox});
      way["railway"~"rail|light_rail|tram|narrow_gauge"](${bbox});
      nwr["amenity"~"^(fuel|charging_station|car_wash)$"](${bbox});
      nwr["shop"~"^(car_repair|car|car_parts|tyres)$"](${bbox});
      node["tourism"~"^(viewpoint|camp_site|picnic_site)$"](${bbox});
      node["natural"="peak"](${bbox});
      nwr["man_made"~"^(water_tower|silo|chimney|storage_tank|lighthouse|windmill|tower|communications_tower|obelisk|pier|breakwater)$"](${bbox});
      way["aeroway"~"^(runway|taxiway|apron)$"](${bbox});
      nwr["historic"~"^(castle|fort|monument|memorial|ruins|archaeological_site|city_gate|citywalls|aqueduct)$"](${bbox});
      nwr["power"="generator"]["generator:source"="wind"](${bbox});
      way["waterway"~"^(dam|weir)$"](${bbox});
    );out geom 2000;`;
}

interface RawWay {
  type?: string; id: number; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  /** A relation's member ways, each with its geometry under `out geom`. */
  members?: Array<{ type?: string; ref?: number; role?: string; geometry?: Array<{ lat: number; lon: number }> }>;
  /** Nodes carry their position directly rather than as a geometry array. */
  lat?: number; lon?: number;
}

/** One mirror, once. Throws with the reason so the caller can try the next. */
async function askMirror(url: string, query: string, ms: number): Promise<RawWay[]> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      // Overpass answers a default Node fetch with 406. The browser always
      // sent its own UA so this never bit the client; server-side it is the
      // difference between data and nothing.
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': 'parc.land-drive/1.0 (+https://parc.land/@c15r/drive)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctl.signal,
    });
  } finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: RawWay[]; remark?: string };
  // A TIMED-OUT Overpass query answers HTTP 200 with an empty element list and
  // puts the reason in `remark`. Nothing downstream can tell that apart from
  // open desert, so without this check one slow minute upstream is written to
  // S3 as a legitimately-empty tile — `immutable`, for a week, for everyone —
  // and cached in every browser that fetched it. Never seen in the wild here
  // (a 25-tile corridor audit found zero disagreements with Overpass), which
  // is precisely why it is worth closing before it is.
  if (json.remark && /timed out|out of memory|runtime error/i.test(json.remark)) {
    throw new Error(`remark: ${json.remark.slice(0, 120)}`);
  }
  return json.elements ?? [];
}

/**
 * The query, against each mirror in turn until one answers or the budget runs
 * out. The commonest failure is a 429 that returns immediately, so the rotation
 * usually costs milliseconds rather than a whole attempt window.
 */
export async function askOverpass(query: string, budgetMs = UPSTREAM_MS, attemptMs = ATTEMPT_MS, rotate = 0): Promise<RawWay[]> {
  const deadline = Date.now() + budgetMs;
  const tried: string[] = [];
  // `rotate` spreads which mirror is asked FIRST. The overview fill hits in
  // bursts of a whole ring, and a burst aimed at one mirror queues behind its
  // per-IP slots; rotated by tile, the burst lands a third on each.
  const mirrors = OVERPASS_MIRRORS.map((_, i, a) => a[(i + rotate) % a.length]);
  for (const url of mirrors) {
    const left = deadline - Date.now();
    if (left < 1500) break;   // not enough room to be worth the round trip
    try {
      return await askMirror(url, query, Math.min(attemptMs, left));
    } catch (err) {
      tried.push(`${new URL(url).host} ${(err as Error).message ?? err}`);
    }
  }
  throw new Error(tried.length ? tried.join(' | ') : 'no upstream tried');
}

/**
 * Everything `renderWays` reads and nothing else, at 6dp (~11cm — an order of
 * magnitude finer than the heightfield it is draped on). Measured on the tiles
 * that motivated this: Manhattan 214 KB raw → 82 KB trimmed → 12 KB brotli.
 */
export function trimWays(elements: RawWay[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const el of elements) {
    if (el.type === 'relation') {
      // v4: water multipolygons, joined into rings here (see osm-rings.ts).
      // A NEGATIVE id: ways and relations share a number space in OSM and
      // the client dedupes by id, so a relation is -id, unmistakably. Its
      // `geometry` is the first outer ring, which is what every consumer
      // that only knows a way expects to find there.
      if (!el.members?.length) continue;
      const rings = assembleRelationRings(el.members);
      if (!rings?.length) continue;
      out.push({ id: -el.id, tags: el.tags ?? {}, geometry: rings[0].outer, rings });
      continue;
    }
    // A NODE IS A ONE-POINT GEOMETRY. Dropping everything that was not a `way`
    // is what silently threw away every fuel station, viewpoint and summit the
    // query now asks for — they are nodes, and a node keeps its position in
    // `lat`/`lon` rather than in a geometry array. Normalising here means the
    // renderer sees one shape for everything and needs no second code path.
    const geom = el.geometry?.length
      ? el.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)])
      : el.type === 'node' && el.lat !== undefined && el.lon !== undefined
        ? [[+el.lat.toFixed(6), +el.lon.toFixed(6)]]
        : null;
    if (!geom) continue;
    out.push({ id: el.id, tags: el.tags ?? {}, geometry: geom });
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

async function putTile(
  path: string,
  body: Buffer,
  contentType = 'application/json; charset=utf-8',
  contentEncoding: string | null = 'gzip',
): Promise<void> {
  const bucket = process.env.CELL_PUBLIC_BUCKET;
  if (!bucket) return; // no namespace configured — serve, don't store
  const key = tileKey(path);
  // Required lazily: the SDK is not in the Node 20 Lambda image by default and
  // a cell without a public namespace should never pay to load it. It is also
  // not in this repo's node_modules — it exists only in the Lambda runtime —
  // so the type checker is told to expect the miss rather than fail on it.
  // @ts-expect-error resolved at runtime by the Lambda image, not at build
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  await new S3Client({}).send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // A PNG is already compressed; declaring gzip on it would make the edge
    // hand the browser a file it cannot decode.
    ...(contentEncoding ? { ContentEncoding: contentEncoding } : {}),
    // The object carries its own policy: the edge honours this, and the path
    // is versioned (`osm/v1/…`) so `immutable` is a promise we can keep.
    CacheControl: 'public, max-age=604800, immutable',
  }));
}

async function serveTile(path: string, m: RegExpMatchArray) {
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // z14 is the floor now, not z1: the client has only ever asked at z16, and
  // the FULL query over a z10 bbox would truncate at `out geom 2000` and store
  // the damage for a week. Wide views ask the overview route, whose query is
  // sized for its own zooms and which refuses to store a truncation.
  if (z < 14 || z > 19 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'tile out of range' }));
  }
  let ways: Array<Record<string, unknown>>;
  try {
    ways = trimWays(await askOverpass(overpassQuery(z, x, y)));
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

// ── the Google Maps link resolver ──────────────────────────────────
/**
 * A link shared out of the Google Maps app is a SHORTENER —
 * maps.app.goo.gl/NnqHXgwN6T4PJnyL7 — and the coordinates live only in what it
 * redirects to. The browser cannot follow it: the shortener answers with no
 * CORS header, so the fetch fails before the redirect is ever visible. So the
 * hop happens here.
 *
 * This is a URL-fetching endpoint, which is the shape of an SSRF, so it is
 * fenced on all four sides: https only, EVERY hop's host re-checked against the
 * allowlist (not just the first — a redirect is an attacker-controlled jump),
 * a hop cap, a timeout, and — the containment that matters most — it returns
 * the final URL and NEVER the body. There is no way to read a response through
 * this, only to learn where a Google link points.
 */
const gmapHost = (h: string): boolean =>
  h === 'maps.app.goo.gl' || h === 'goo.gl' || h === 'g.co'
  || /^(www\.|maps\.)?google(\.[a-z]{2,3}){1,2}$/.test(h);

async function resolveGmap(raw: string): Promise<{ url?: string; error?: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { return { error: 'not a link' }; }
  for (let hop = 0; hop < 6; hop++) {
    if (u.protocol !== 'https:') return { error: 'https links only' };
    if (!gmapHost(u.hostname)) return { error: `not a google maps link (${u.hostname})` };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        redirect: 'manual',
        // Google hands a bare Node fetch a consent interstitial; a browser UA
        // gets the ordinary 302 the phone would have followed.
        headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
        signal: ctl.signal,
      });
    } catch (e) {
      return { error: `could not reach google (${(e as Error).name})` };
    } finally { clearTimeout(timer); }
    const loc = res.headers.get('location');
    if (!loc) return { url: u.toString() };     // end of the chain — this is the real link
    try { u = new URL(loc, u); } catch { return { error: 'bad redirect' }; }
  }
  return { error: 'too many redirects' };
}

// ── a player's own progress ──────────────────────────────────────────
/**
 * THE DURABLE COPY.
 *
 * `/state` is the only route here that is about a person rather than about the
 * world, and it is deliberately the smallest thing that could work.
 *
 * WHO IS ASKING comes from `x-cell-caller` — a dispatch-validated identity
 * string, set in `services/cells/service.ts` from a bearer this cell never
 * sees. There is no token here to store, rotate or leak; an anonymous visitor
 * arrives as the literal string `anonymous` and is turned away, which is the
 * whole of the authentication logic.
 *
 * WHAT IS KEPT is counts and claims, one row per road, under `PLAYER#<caller>`
 * in the cell's own table (`services/cells/cell-template.ts` provisions it,
 * with IAM scoped to that table's ARN alone). No crumbs — they regenerate by
 * driving, and 20,000 of them would not fit in an item anyway.
 *
 * MERGING IS A UNION AND A MAX because progress is monotonic. Last-writer-wins
 * would silently delete a second device's work; this cannot, and it needs no
 * clock, no vector and no conflict UI. It also self-heals: if two devices push
 * across each other, the one whose value was overwritten still holds it locally
 * and restores it on its next sync.
 *
 * WHO MAY WRITE is not decided here. A POST reaches this cell only if the
 * platform already authorised it (`cells.call` → `authorizeAccess`: the owner,
 * or a principal the cell is shared with). Any other signed-in player gets a
 * 403 from the tier above and keeps playing locally — the same graceful path as
 * anonymous. That is the platform's sharing model doing the work, rather than
 * this game inventing an access rule of its own.
 */
const TABLE = process.env.TABLE_NAME ?? '';
const PROFILE = 'PROFILE';
const ROAD = 'ROAD#';
// The reserved prefixes from docs/drive-persistence.md §5, now in use. On the
// wire and in the client's marks store these are the kinds 'm' and 's'.
const MARK_SK: Record<'m' | 's', string> = { m: 'MISSION#', s: 'STATION#' };
const STATE_CAP = 20000;       // roads mirrored, per player
const PUSH_CAP = 4000;         // roads accepted in one push
const MARKS_CAP = 2000;        // marks accepted in one push, per kind
interface StateRow { g: number; t: number; c?: number }
interface MarkRows { m: Record<string, number>; s: Record<string, number> }
interface PlayerState { roads: Record<string, StateRow>; marks: MarkRows; odo: number;
  tapes: TapeMeta[] }
/** A banked tape's INDEX row — the blob itself lives in the public namespace
 *  (~/tape/v1/<user>/<id>), edge-served like any tile. Tens of bytes, which is
 *  the state table's whole design. */
export interface TapeMeta { id: string; at: number; secs: number; steps: number; lat: number; lon: number }
const TAPE_SK = 'TAPE#';
/** The corner of DynamoDB this needs, so a test can hand it a Map. */
export interface StateTable {
  /** The whole partition in one read: roads, marks and the profile together. */
  all(pk: string): Promise<PlayerState>;
  putRoads(pk: string, rows: Record<string, StateRow>): Promise<void>;
  putMarks(pk: string, kind: 'm' | 's', rows: Record<string, number>): Promise<void>;
  /** Remove rows by sort key — the campaign reset's half of the contract.
   *  Roads and the profile are never passed here: distance and survey are a
   *  career, not a campaign. */
  delRows(pk: string, sks: string[]): Promise<void>;
  setProfile(pk: string, p: { odo: number }): Promise<void>;
  putTape(pk: string, meta: TapeMeta): Promise<void>;
}
const num = (v: unknown, cap = Number.MAX_SAFE_INTEGER): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, cap) : 0;
};
/** DynamoDB, hand-marshalled. Every value here is a string or a number, so the
 *  document client is a dependency this would pay for and not use. */
function liveTable(): StateTable {
  // Lazily, like the S3 client: a request that never touches a player's state
  // should not pay to load an SDK. (Unlike S3, this one IS in the repo's
  // node_modules, so it type-checks here as well as resolving in the image.)
  const client = async () => {
    const m = await import('@aws-sdk/client-dynamodb');
    return { m, db: new m.DynamoDBClient({}) };
  };
  const S = (v: string) => ({ S: v });
  const N = (v: number) => ({ N: String(Math.round(v)) });
  // Items are built from S()/N() alone, which satisfies the SDK's
  // AttributeValue union without pulling in the document client.
  type Attr = { S: string } | { N: string };
  const batchPut = async (items: Array<Record<string, Attr>>): Promise<void> => {
    if (!items.length) return;
    const { m, db } = await client();
    for (let i = 0; i < items.length; i += 25) {
      await db.send(new m.BatchWriteItemCommand({
        RequestItems: { [TABLE]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) },
      }));
    }
  };
  return {
    async all(pk) {
      const { m, db } = await client();
      const out: PlayerState = { roads: {}, marks: { m: {}, s: {} }, odo: 0, tapes: [] };
      // ONE query for the whole partition — roads, marks and profile arrive
      // together, split by sk prefix here. A page is 1MB and a row is tens of
      // bytes, so this is one call for any real player; the loop is here so a
      // very long career does not silently return a prefix of itself.
      // The SDK's own AttributeValue union, opaque to us — a paging cursor is
      // handed straight back, never read.
      let startKey: Record<string, never> | undefined;
      do {
        const res = await db.send(new m.QueryCommand({
          TableName: TABLE,
          KeyConditionExpression: 'pk = :p',
          ExpressionAttributeValues: { ':p': S(pk) },
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        })) as { Items?: Array<Record<string, { S?: string; N?: string }>>;
          LastEvaluatedKey?: Record<string, never> };
        for (const it of res.Items ?? []) {
          const sk = it.sk?.S ?? '';
          if (sk === PROFILE) { out.odo = num(it.odo?.N); continue; }
          if (sk.startsWith(ROAD)) {
            const id = sk.slice(ROAD.length);
            if (!id || Object.keys(out.roads).length >= STATE_CAP) continue;
            const c = num(it.c?.N);
            out.roads[id] = c ? { g: num(it.g?.N), t: num(it.t?.N), c } : { g: num(it.g?.N), t: num(it.t?.N) };
            continue;
          }
          if (sk.startsWith(TAPE_SK)) {
            const id = sk.slice(TAPE_SK.length);
            if (id && out.tapes.length < 64) out.tapes.push({ id, at: num(it.c?.N),
              secs: num(it.g?.N), steps: num(it.t?.N),
              lat: Number(it.la?.N ?? 0), lon: Number(it.lo?.N ?? 0) });
            continue;
          }
          for (const kind of ['m', 's'] as const) {
            if (!sk.startsWith(MARK_SK[kind])) continue;
            const id = sk.slice(MARK_SK[kind].length);
            const c = num(it.c?.N);
            if (id && c) out.marks[kind][id] = c;
          }
        }
        startKey = res.LastEvaluatedKey;
      } while (startKey);
      return out;
    },
    putRoads: (pk, rows) => batchPut(Object.entries(rows).map(([id, r]) => ({
      pk: S(pk), sk: S(ROAD + id), g: N(r.g), t: N(r.t), ...(r.c ? { c: N(r.c) } : {}),
    }))),
    putMarks: (pk, kind, rows) => batchPut(Object.entries(rows).map(([id, at]) => ({
      pk: S(pk), sk: S(MARK_SK[kind] + id), c: N(at),
    }))),
    async delRows(pk, sks) {
      if (!sks.length) return;
      const { m, db } = await client();
      for (let i = 0; i < sks.length; i += 25) {
        await db.send(new m.BatchWriteItemCommand({
          RequestItems: { [TABLE]: sks.slice(i, i + 25).map((sk) => ({
            DeleteRequest: { Key: { pk: S(pk), sk: S(sk) } } })) },
        }));
      }
    },
    async putTape(pk, meta) {
      // Reuses the batch writer's item shape: g/t/c are the table's own three
      // numeric columns (secs/steps/banked-at here), lat/lon ride as extras.
      await batchPut([{ pk: S(pk), sk: S(TAPE_SK + meta.id),
        g: N(meta.secs), t: N(meta.steps), c: N(meta.at),
        la: { N: String(meta.lat) }, lo: { N: String(meta.lon) } }]);
    },
    async setProfile(pk, p) {
      const { m, db } = await client();
      await db.send(new m.PutItemCommand({
        TableName: TABLE,
        Item: { pk: S(pk), sk: S(PROFILE), odo: N(p.odo), seenAt: N(Date.now()) },
      }));
    },
  };
}

/**
 * ── THE PROBE CHANNEL ──────────────────────────────────────────────
 *
 * A way to ask a QUESTION OF A RUNNING TAB, and the reason it exists is four
 * hours of a fault that could not be reproduced anywhere it could be
 * inspected. The test rig is headless Chromium on Linux; the player is Safari
 * on a phone. Every bug that lives in the gap between those two — a shader
 * that will not compile, a decoder that colour-manages, a GPU that rounds
 * differently — is invisible to every test in this repo and obvious in one
 * screenshot. Screenshots are a slow way to ask a precise question.
 *
 * So: the tab polls for expressions, evaluates them, and posts the answers
 * back. Four routes, one partition, no sockets.
 *
 *   POST /probe/KEY/ask     {js}      → {id}
 *   GET  /probe/KEY/next              → {id, js} | {}      (the tab polls)
 *   POST /probe/KEY/answer  {id, v}   → {ok}               (the tab replies)
 *   GET  /probe/KEY/get/ID            → {v} | {pending}
 *
 * THE KEY IS IN THE PATH, NOT A QUERY STRING, and that is not a style choice.
 * Everything under `~/` is a CACHED surface keyed by path alone — the note
 * above /gmaps says so, and it is why that route lives outside the namespace
 * too. A probe keyed on `?k=` would have its key ignored by the cache and
 * dropped before it arrived, which is exactly what the first cut did.
 *
 * IT IS AN EVAL ENDPOINT, so it is off unless asked for twice: the tab only
 * polls when the URL carries `?probe=KEY`, and every route demands the same
 * KEY. No key, no channel — and the key is chosen by whoever opens the tab,
 * not baked in here. A stale queue expires on its own so a forgotten tab
 * cannot be woken by yesterday's question.
 */
const PROBE_PK = 'PROBE#';
const PROBE_TTL = 10 * 60 * 1000;
async function serveProbe(path: string, method: string, q: URLSearchParams, body: string | undefined) {
  const j = (code: number, o: unknown) => respond(code, 'application/json', JSON.stringify(o),
    { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  if (!TABLE) return j(503, { error: 'no table configured' });
  // /probe/<key>/<action>[/<id>]
  const bits = path.split('/').filter(Boolean);          // ['probe', key, action, id?]
  const key = bits[1] ?? '';
  const action = bits[2] ?? '';
  const pathId = bits[3] ?? '';
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(key)) {
    return j(400, { error: 'probe key must be 6-64 of [A-Za-z0-9_-]' });
  }
  const pk = PROBE_PK + key;
  const m = await import('@aws-sdk/client-dynamodb');
  const db = new m.DynamoDBClient({});
  const S = (v: string) => ({ S: v });
  const N = (v: number) => ({ N: String(Math.round(v)) });
  const rows = async () => {
    const res = await db.send(new m.QueryCommand({
      TableName: TABLE, KeyConditionExpression: 'pk = :p',
      ExpressionAttributeValues: { ':p': S(pk) },
    })) as { Items?: Array<Record<string, { S?: string; N?: string }>> };
    return (res.Items ?? []).filter((it) => Number(it.at?.N ?? 0) > Date.now() - PROBE_TTL);
  };
  if (action === 'ask' && method === 'POST') {
    let js = '';
    try { js = String((JSON.parse(body ?? '{}') as { js?: unknown }).js ?? ''); } catch { /* below */ }
    if (!js || js.length > 8000) return j(400, { error: 'js required, under 8000 chars' });
    const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    await db.send(new m.PutItemCommand({ TableName: TABLE,
      Item: { pk: S(pk), sk: S(`q#${id}`), js: S(js), at: N(Date.now()) } }));
    return j(200, { id });
  }
  // ── A NEW PROBE WITHOUT A DEPLOY ──
  //
  // Every question so far had to already exist in the bundle, so learning
  // anything the bundle did not anticipate cost a deploy and a reload — and on
  // a phone that means losing the session that was showing the fault. During a
  // frame-rate hunt that is the whole game: the interesting state is exactly
  // the state you are trying not to disturb.
  //
  // The page forbids eval (`script-src 'self' https://esm.sh`, no
  // unsafe-eval), so a probe cannot be a string of code the tab runs. But
  // 'self' permits a MODULE, and these routes are same-origin and outside `~/`
  // — uncached, query strings intact. So: POST the source here, and the tab
  // imports it. No eval, no CSP hole, no redeploy, no reload.
  //
  // Kept out of the TTL sweep that `rows()` applies: a module is the tooling,
  // not a question, and it has to outlive the ten minutes a question gets.
  if (action === 'mod' && method === 'POST') {
    let js = '';
    try { js = String((JSON.parse(body ?? '{}') as { js?: unknown }).js ?? ''); } catch { /* below */ }
    if (!js) return j(400, { error: 'js required' });
    if (js.length > 360000) return j(400, { error: 'module too large (360k)' });
    const v = Date.now();
    await db.send(new m.PutItemCommand({ TableName: TABLE,
      Item: { pk: S(pk), sk: S('mod'), js: S(js), at: N(v) } }));
    return j(200, { v, bytes: js.length });
  }
  if (action === 'mod.js') {
    const got = await db.send(new m.GetItemCommand({ TableName: TABLE,
      Key: { pk: S(pk), sk: S('mod') } })) as { Item?: Record<string, { S?: string }> };
    const js = got.Item?.js?.S;
    if (!js) {
      return respond(404, 'application/javascript', '// no module posted for this key\n',
        { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    }
    // no-store AND a caller-supplied ?v= — belt and braces, because a stale
    // module is indistinguishable from a probe that did not work.
    return respond(200, 'application/javascript', js,
      { 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  }
  if (action === 'next') {
    const qs = (await rows()).filter((it) => (it.sk?.S ?? '').startsWith('q#'))
      .sort((a, b) => Number(a.at?.N ?? 0) - Number(b.at?.N ?? 0));
    const first = qs[0];
    if (!first) return j(200, {});
    const sk = first.sk?.S ?? '';
    // Taken, so a second tab cannot answer the same question twice.
    await db.send(new m.DeleteItemCommand({ TableName: TABLE, Key: { pk: S(pk), sk: S(sk) } }));
    return j(200, { id: sk.slice(2), js: first.js?.S ?? '' });
  }
  // ── THE REPLY IS A GET, AND THAT IS NOT LAZINESS ──
  //
  // The platform gates every non-GET on a cell, so the tab could poll happily
  // and then fail to answer — measured, and invisible, because the failure is
  // a 401 inside a catch that just tries again in 1.5 seconds. The queue
  // drained and nothing ever came back.
  //
  // Rather than require the tab to be signed in to answer a question about
  // itself, the reply rides a GET: `/probe/KEY/say/ID/PART/OF?v=<encoded>`.
  // Query strings survive outside `~/` (they do not survive inside it — see
  // the note above /gmaps), which is why the whole channel lives out here.
  //
  // CHUNKED, because a URL is not a body. A probe that returns a tile's worth
  // of numbers arrives in parts and is stitched on read, so the size limit is
  // the number of round trips rather than a cliff the answer falls off.
  if (action === 'say') {
    const id = pathId.slice(0, 64);
    const part = Number(bits[4] ?? '0') || 0;
    const of = Number(bits[5] ?? '1') || 1;
    const v = q.get('v') ?? '';
    // WHICH TAB. Two tabs on one key both poll and whichever reaches /next
    // first takes the question, so a reading can come from a different device
    // than the one before it. That is not hypothetical: a phone and a desktop
    // browser shared a key through most of a performance hunt, and the
    // apparent uptime resets read as a crashing tab when it was the two of
    // them taking turns.
    const tab = (q.get('tab') ?? '').slice(0, 32);
    if (!id) return j(400, { error: 'id required' });
    await db.send(new m.PutItemCommand({ TableName: TABLE,
      Item: { pk: S(pk), sk: S(`a#${id}#${String(part).padStart(3, '0')}`),
        v: S(v.slice(0, 350000)), of: N(of), at: N(Date.now()),
        ...(tab ? { tab: S(tab) } : {}) } }));
    return j(200, { ok: true, part, of });
  }
  if (action === 'answer' && method === 'POST') {
    let id = '', v = '';
    try {
      const o = JSON.parse(body ?? '{}') as { id?: unknown; v?: unknown };
      id = String(o.id ?? ''); v = typeof o.v === 'string' ? o.v : JSON.stringify(o.v ?? null);
    } catch { /* below */ }
    if (!id) return j(400, { error: 'id required' });
    await db.send(new m.PutItemCommand({ TableName: TABLE,
      Item: { pk: S(pk), sk: S(`a#${id}#000`), v: S(v.slice(0, 380000)), of: N(1), at: N(Date.now()) } }));
    return j(200, { ok: true });
  }
  if (action === 'get') {
    const id = pathId.slice(0, 64);
    const parts = (await rows()).filter((it) => (it.sk?.S ?? '').startsWith(`a#${id}#`))
      .sort((a, b) => (a.sk?.S ?? '').localeCompare(b.sk?.S ?? ''));
    if (!parts.length) return j(200, { pending: true });
    const of = Number(parts[0].of?.N ?? '1') || 1;
    if (parts.length < of) return j(200, { pending: true, have: parts.length, of });
    // The tab that answered rides back with the answer, so a reading always
    // names its source — see the note in `say`.
    const tab = parts[0].tab?.S;
    return j(200, { v: parts.map((it) => it.v?.S ?? '').join(''), ...(tab ? { tab } : {}) });
  }
  return j(404, { error: 'no such probe route' });
}

export async function serveState(
  method: string,
  caller: string,
  body: string | undefined,
  table: StateTable = liveTable(),
) {
  const no = (code: number, error: string) =>
    respond(code, 'application/json', JSON.stringify({ error }), { 'cache-control': 'no-store' });
  if (!TABLE) return no(503, 'no table configured');
  if (!caller || caller === 'anonymous') return no(401, 'sign in to keep progress');
  const pk = `PLAYER#${caller}`;
  const mine = await table.all(pk);

  // THE CAMPAIGN RESET. A latched mark cannot be un-latched by the merge —
  // that is the whole design — so restarting the line takes an explicit,
  // destructive verb: DELETE removes every mission and station row for THIS
  // caller and nothing else. Roads, claims and the odometer stay: the survey
  // is a career, the line is a docket, and handing the docket back does not
  // un-drive the roads. (Note the honest limit: a second device that still
  // holds the marks locally will push them back on its next sync — the reset
  // is of the durable copy and the device that asked, not of every device.)
  let reset = 0;
  if (method === 'DELETE') {
    const sks: string[] = [];
    for (const kind of ['m', 's'] as const) {
      for (const id of Object.keys(mine.marks[kind])) sks.push(MARK_SK[kind] + id);
    }
    await table.delRows(pk, sks);
    reset = sks.length;
    mine.marks = { m: {}, s: {} };
  }

  let wrote = 0;
  if (method === 'POST') {
    let sent: {
      roads?: Record<string, StateRow>;
      missions?: Record<string, unknown>;
      stations?: Record<string, unknown>;
      odo?: unknown;
    } = {};
    try { sent = JSON.parse(body ?? '{}') as typeof sent; } catch { return no(400, 'unreadable'); }

    const rows = sent.roads && typeof sent.roads === 'object' ? sent.roads : {};
    const write: Record<string, StateRow> = {};
    let n = 0;
    for (const [id, row] of Object.entries(rows)) {
      if (typeof id !== 'string' || !id || id.length > 300 || !row || typeof row !== 'object') continue;
      if (++n > PUSH_CAP) break;
      const g = num(row.g), t = num(row.t), c = num(row.c);
      const had = mine.roads[id];
      const merged: StateRow = {
        g: Math.max(g, had?.g ?? 0),
        t: Math.max(t, had?.t ?? 0),
        // Latched, and the truth about a claim is the first time it happened.
        ...((c || had?.c) ? { c: Math.min(c || Infinity, had?.c || Infinity) } : {}),
      };
      if (had && had.g === merged.g && had.t === merged.t && had.c === merged.c) continue;
      write[id] = merged;
      mine.roads[id] = merged;
    }
    await table.putRoads(pk, write);
    wrote += Object.keys(write).length;

    // Marks — a mission completed, a station woken. Same monotonic story as a
    // road's claim, stated even more simply: the row IS the moment, and the
    // earliest moment wins. Union-and-min converges from any order.
    for (const [kind, field] of [['m', 'missions'], ['s', 'stations']] as const) {
      const sentRows = sent[field] && typeof sent[field] === 'object' ? sent[field]! : {};
      const put: Record<string, number> = {};
      let k = 0;
      for (const [id, at] of Object.entries(sentRows)) {
        if (typeof id !== 'string' || !id || id.length > 200) continue;
        if (++k > MARKS_CAP) break;
        const t = num(at);
        if (!t) continue;
        const had = mine.marks[kind][id];
        if (had && had <= t) continue;
        put[id] = t;
        mine.marks[kind][id] = t;
      }
      await table.putMarks(pk, kind, put);
      wrote += Object.keys(put).length;
    }

    const odo = Math.max(num(sent.odo), mine.odo);
    if (odo > mine.odo) { await table.setProfile(pk, { odo }); mine.odo = odo; }
  }

  return respond(200, 'application/json', JSON.stringify({
    user: caller,
    roads: mine.roads,
    missions: mine.marks.m,
    stations: mine.marks.s,
    odo: mine.odo,
    tapes: (mine.tapes ?? []).sort((a, b) => b.at - a.at),
    ...(method === 'POST' ? { wrote } : {}),
    ...(method === 'DELETE' ? { reset } : {}),
  }), { 'cache-control': 'no-store' });
}

/**
 * ── THE TAPE BANK (R59) ──
 *
 * A kept recording, made durable and SHAREABLE: the blob goes to the public
 * namespace (edge-served, immutable — a drive is not a secret and a URL to
 * one is a postcard), the index goes to the caller's own state partition.
 * Pruned oldest-first past the shelf cap, so a device that banks freely
 * cannot grow a bill. The blob of a pruned tape is left in the namespace —
 * an orphan object is cheaper than a delete path, and a shared URL keeps
 * working, which is what sharing means.
 */
const TAPE_SHELF = 24;
const TAPE_BODY_CAP = 200_000;
const TAPE_BLOB_RE = /^\/~\/tape\/v1\/([a-z0-9_.-]{1,40})\/(\d{10,16})$/;
export async function serveTape(
  caller: string,
  body: string | undefined,
  table: StateTable = liveTable(),
  put: typeof putTile = putTile,
) {
  const no = (code: number, error: string) =>
    respond(code, 'application/json', JSON.stringify({ error }), { 'cache-control': 'no-store' });
  if (!TABLE) return no(503, 'no table configured');
  if (!caller || caller === 'anonymous') return no(401, 'sign in to bank a tape');
  if (!body || body.length > TAPE_BODY_CAP) return no(400, body ? 'tape too large' : 'no tape');
  let tape: { head?: { v?: number; at?: number; secs?: number; steps?: number; lat?: number; lon?: number };
    steps?: string; keys?: string } = {};
  try { tape = JSON.parse(body) as typeof tape; } catch { return no(400, 'unreadable'); }
  const h = tape.head;
  if (!h || typeof tape.steps !== 'string' || typeof tape.keys !== 'string'
    || !Number.isFinite(h.at) || !Number.isFinite(h.secs) || (h.secs as number) <= 0
    || (h.secs as number) > 300) return no(400, 'not a tape');
  const user = caller.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 40);
  if (!user) return no(400, 'unusable caller');
  const id = String(Math.round(h.at as number));
  const path = `/~/tape/v1/${user}/${id}`;
  await put(path, gzipSync(Buffer.from(body, 'utf8'), { level: 9 }));
  const pk = `PLAYER#${caller}`;
  await table.putTape(pk, { id, at: Math.round(h.at as number),
    secs: Math.round(h.secs as number), steps: Math.round(h.steps ?? 0),
    lat: +(h.lat ?? 0).toFixed(5), lon: +(h.lon ?? 0).toFixed(5) });
  // The shelf holds TAPE_SHELF; beyond it the OLDEST index rows go. Read after
  // write so the row just banked counts itself.
  const shelf = ((await table.all(pk)).tapes ?? []).sort((a, b) => b.at - a.at);
  if (shelf.length > TAPE_SHELF) {
    await table.delRows(pk, shelf.slice(TAPE_SHELF).map((t) => TAPE_SK + t.id));
  }
  return respond(200, 'application/json', JSON.stringify({ ok: true, id, url: path, kept: Math.min(shelf.length, TAPE_SHELF) }),
    { 'cache-control': 'no-store' });
}

export const handler = async (event: {
  rawPath?: string; rawQueryString?: string; body?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string } };
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  // THE PROBE CHANNEL, first, because two of its four routes write and it must
  // answer before any read-only gate below. See serveProbe: off unless the URL
  // carries a key, and the tab only polls when it was opened with the same one.
  if (path.startsWith('/probe/')) {
    return serveProbe(path, method, new URLSearchParams(event.rawQueryString ?? ''), event.body);
  }
  // Same-origin on the cell's own host, so `'self'` covers it and no CORS is
  // involved. Before the read-only gate below, because this one writes.
  if (path === '/state') {
    if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
      return respond(405, 'application/json', JSON.stringify({ error: 'GET, POST or DELETE' }));
    }
    return serveState(method, event.headers?.['x-cell-caller'] ?? 'anonymous', event.body);
  }
  if (path === '/tape') {
    if (method !== 'POST') return respond(405, 'application/json', JSON.stringify({ error: 'POST' }));
    return serveTape(event.headers?.['x-cell-caller'] ?? 'anonymous', event.body);
  }
  // Deliberately OUTSIDE the `~/` namespace: that surface is cached by path,
  // and a resolver keyed on a query string has no business in a cache whose
  // key would ignore it.
  if (path === '/gmaps') {
    const u = new URLSearchParams(event.rawQueryString ?? '').get('u') ?? '';
    const out = u ? await resolveGmap(u) : { error: 'no link given' };
    return respond(out.error ? 400 : 200, 'application/json', JSON.stringify(out), {
      'cache-control': 'no-store',
    });
  }
  if (method !== 'GET') return respond(405, 'application/json', JSON.stringify({ error: 'read-only' }));
  // The public namespace is a CACHED surface, so anything under `~/` that this
  // cell does not serve must say so plainly. Falling through to the SPA shell
  // put a day-long copy of the whole page in the CDN under a tile-shaped key —
  // observed on the first live probe, before any tile existed.
  if (path.startsWith('/~/')) {
    if (TAPE_BLOB_RE.test(path)) {
      return respond(404, 'application/json', JSON.stringify({ error: 'no such tape' }), {
        'cache-control': 'no-store',
      });
    }
    const tile = path.match(TILE_RE);
    if (tile) return serveTile(path, tile);
    const cover = path.match(COVER_RE);
    if (cover) return serveCover(path, cover);
    const ov = path.match(OV_RE);
    if (ov) return serveOverview(path, ov);
    const pk = path.match(PEAK_RE);
    if (pk) return servePeaks(path, pk);
    const eco = path.match(ECO_RE);
    if (eco) return serveEco(path, eco);
    const cp = path.match(CAMPAIGN_RE);
    if (cp) return serveCampaign(path, cp);
    return respond(404, 'application/json', JSON.stringify({ error: 'no such object' }), {
      'cache-control': 'no-store',
    });
  }
  try {
    if (path === '/sw.js') return serveServiceWorker();
    const asset = serveWebAsset(path);
    if (asset) return asset;
    if (path.startsWith('/fixtures/')) {
      const fx = serveFixture(path);
      if (fx) return fx;
    }
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
