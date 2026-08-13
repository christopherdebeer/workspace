import { readFileSync } from 'node:fs';
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

const CSP = [
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
  "connect-src 'self' https://esm.sh https://overpass-api.de https://overpass.kumi.systems https://overpass.osm.jp https://overpass.private.coffee https://s3.amazonaws.com https://nominatim.openstreetmap.org https://api.open-meteo.com https://tiles.mapterhorn.com",
  "img-src data: blob:",
  // The menu's pixel face (Silkscreen) ships inside the bundle as data: URIs —
  // no font host, so the page stays self-contained.
  'font-src data:',
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

// ── the OSM tile miss handler (ADR-0095) ────────────────────────────
// Everything below runs ONLY on a cache miss: CloudFront looks in S3 first and
// falls through here on 403/404. What this writes is what the edge serves from
// then on, so the two rules that matter are (1) an empty tile must still be
// written — otherwise every ocean tile is a permanent miss and therefore a
// permanent invocation — and (2) a failure must never be written, or one bad
// minute upstream becomes our bad week.
const TILE_RE = /^\/~\/osm\/v2\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/;
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
// `no-store`, and nothing in the logs saying which upstream failed. The cell is
// configured at 30s (`cells.configureCell timeoutSeconds`), and this stays
// under it so the handler always outlives its own request and can say why.
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
const OV_CAP: Record<number, number> = { 10: 3000, 11: 4500, 12: 6000, 13: 6000 };
// These tiles are rare and cached forever, so they may spend upstream time a
// fine tile cannot: the whole 30s Lambda still has to be outlived, but most
// of it can go to honest attempts instead of three hurried ones. Measured: a
// z10 coastal tile needs 11–18s of Overpass; the fine budget's 5s-per-mirror
// would have refused every overview tile that matters. 15s per attempt, not
// the whole budget in one: the commonest failure in the audit was the FIRST
// mirror queueing the request behind its per-IP slot for the full window,
// and a second mirror answering a query the first would have sat on.
const OV_UPSTREAM_MS = 24000;
const OV_ATTEMPT_MS = 15000;
function overviewQuery(z: number, x: number, y: number): string {
  const b = tileBounds(z, x, y);
  const bbox = `${b.latS},${b.lonW},${b.latN},${b.lonE}`;
  // THE CLASS LADDER IS THE BUDGET. A z10 box is ~40km on a side, and asking
  // it for secondaries and rail is what timed out: the classes climb as the
  // tiles shrink, and each level carries only what its scale can draw —
  // motorways at the scale of a region, tertiaries only at the tightest band.
  const hw = z <= 10 ? 'motorway|trunk|primary'
    : z === 11 ? 'motorway|trunk|primary|secondary'
    : 'motorway|trunk|primary|secondary|tertiary';
  const rail = z >= 11 ? `way["railway"="rail"](${bbox});` : '';
  const canal = z >= 11 ? '|canal' : '';
  const place = z <= 10 ? 'city|town' : z === 11 ? 'city|town|village' : 'city|town|village|hamlet';
  return `[out:json][timeout:20];(
      way["highway"~"^(${hw})$"](${bbox});
      ${rail}
      way["waterway"~"^(river${canal})$"](${bbox});
      way["natural"="coastline"](${bbox});
      node["place"~"^(${place})$"](${bbox});
      node["natural"="peak"]["name"](${bbox});
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
  if (z < 8 || z > 13 || x >= 2 ** z || y >= 2 ** z) {
    return respond(400, 'application/json', JSON.stringify({ error: 'overview tile out of range' }));
  }
  let elements: RawWay[];
  try {
    elements = await askOverpass(overviewQuery(z, x, y), OV_UPSTREAM_MS, OV_ATTEMPT_MS, (x + y + z) % OVERPASS_MIRRORS.length);
  } catch (err) {
    return respond(503, 'application/json', JSON.stringify({ error: String((err as Error).message ?? err) }), {
      'retry-after': '5', 'cache-control': 'no-store',
    });
  }
  // The tripwire: a response AT the cap is a truncation, not an answer.
  if (elements.length >= (OV_CAP[z] ?? 6000)) {
    return respond(503, 'application/json', JSON.stringify({ error: 'tile too dense for the overview cap' }), {
      'retry-after': '60', 'cache-control': 'no-store',
    });
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
  // Deliberately NOT here: barriers (walls, fences, hedges) and the wider
  // man_made set. They are the most numerous objects in a city by a distance,
  // the sim already grows its own guard rails, and we have just spent real
  // effort making tiles arrive in time. Measured at Bormio, the additions below
  // cost +20% bytes and +39% elements, which is a fair price; barriers were
  // several times that on their own.
  return `[out:json][timeout:15];(
      way["highway"](${bbox});
      way["building"](${bbox});
      way["natural"~"water|coastline|cliff|scrub|wetland|bare_rock|sand"](${bbox});
      way["waterway"~"riverbank|river|stream|canal"](${bbox});
      way["landuse"~"forest|meadow|grass|recreation_ground|farmland|orchard|vineyard|quarry"](${bbox});
      way["leisure"~"park|pitch|garden|nature_reserve"](${bbox});
      way["railway"~"rail|light_rail|tram|narrow_gauge"](${bbox});
      nwr["amenity"~"^(fuel|charging_station|car_wash)$"](${bbox});
      nwr["shop"~"^(car_repair|car|car_parts|tyres)$"](${bbox});
      node["tourism"~"^(viewpoint|camp_site|picnic_site)$"](${bbox});
      node["natural"="peak"](${bbox});
    );out geom 2000;`;
}

interface RawWay {
  type?: string; id: number; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
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
  // a cell without a public namespace should never pay to load it.
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
    const cover = path.match(COVER_RE);
    if (cover) return serveCover(path, cover);
    const ov = path.match(OV_RE);
    if (ov) return serveOverview(path, ov);
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
