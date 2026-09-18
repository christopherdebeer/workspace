/**
 * THE PLANET'S LAND COVER, BAKED ONCE — the wide ladder's floor.
 *
 *   node cells/drive/devtools/bake-cover-wide.mjs
 *
 * `~/cover/v1/` builds a mercator tile by range-reading ESA WorldCover's
 * 3-degree COGs, and that is cheap only while a tile lands on one or two of
 * them. It does not stay cheap: measured by `devtools/cover-reach.mjs`, one
 * tile touches 6 source files at z6, 20 at z5, 64 at z4, 210 at z3 and 690 at
 * z2. That is why COVER_WIDE_LEVELS ends at z4, and why the wide shell has
 * been painted from a 9.8km texel or from nothing at all.
 *
 * There is no global overview product to escape to. The bucket holds the
 * 3-degree COGs under `map/` and, under `macrotiles/`, multi-gigabyte ZIPS of
 * the same 10m data. The ESA web viewer is Terrascope's own pre-rendered
 * WMTS — a third party with no cache of ours, which is exactly what
 * `ne-wide.ts` refused for the roads and for the same reason:
 *
 *   "a chart backdrop cannot depend on a third party answering a bounding-box
 *    query inside the fifteen and a half seconds CloudFront will wait…
 *    the answer is needed at a scale nothing this game streams can reach."
 *
 * So it is baked, like the roads. And it is the INPUT that is baked, not a
 * picture: what comes out is a class-index raster, so the client still runs
 * `climCompute` over it and the wide ground is coloured by the same rules as
 * the hillside under the wheels. A baked IMAGE would freeze the palette, the
 * weather and the biome rules into pixels; a baked class raster is the cover
 * layer arriving by a different road.
 *
 * ── WHAT IT READS ──
 *
 * Every COG carries its own overview pyramid, and the coarsest level is 562 x
 * 562 for a 3-degree cell (0.59km a pixel) in a SINGLE 59KB block. So one
 * header read and one block read per cell is the whole cost — 2,651 cells,
 * about 320MB once, against 690 range-reads per tile forever.
 *
 * ── AND IT TAKES THE MAJORITY, NOT THE POINT ──
 *
 * `coverTile` samples the class AT a point because at 38m that is what the
 * ground is. At 9.8km it is not: one texel covers forest, river, town and
 * field, and the nearest-neighbour answer is whichever of them the sample
 * happened to land on — which makes the wide picture a dither of unrelated
 * biomes rather than a map. Each output texel is the commonest class of the
 * ~272 source pixels inside it.
 *
 * Output: `static/cover-wide.b64`, base64(deflate(raw class bytes)), 4080 x 2040
 * equirect (34 texels per 3-degree cell, so the grid divides exactly and no
 * texel straddles two source cells). Read by `index.ts` to answer the coarse
 * cover route. Class 0 means "no data" — ocean, and the poles past 84S/84N,
 * which is what the client already reads as "ask someone else".
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync, deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
const CACHE = join(CELL, 'node_modules', '.cache', 'cover-wide');
mkdirSync(CACHE, { recursive: true });

const SPAN = 3;                       // degrees per source cell
const PER = Number(process.env.PER ?? 34);   // output texels per source cell
const W = (360 / SPAN) * PER, H = (180 / SPAN) * PER;
const WC_TILE = 1024;
const BUCKET = 'https://esa-worldcover.s3.amazonaws.com';
const PREFIX = 'v200/2021/map/';
const CONC = Number(process.env.CONC ?? 24);

const get = async (url, a, b) => {
  const key = join(CACHE, createHash('sha1').update(`${url}|${a}-${b}`).digest('hex'));
  if (existsSync(key)) return readFileSync(key);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}` }, signal: AbortSignal.timeout(60000) });
      if (!r.ok && r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(key, buf);
      return buf;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
};

/** The COG's level table, walked exactly as the cell's own route walks it. */
function levels(head) {
  if (head.toString('ascii', 0, 2) !== 'II' || head.readUInt16LE(2) !== 42) throw new Error('not a classic TIFF');
  const u16 = (o) => head.readUInt16LE(o), u32 = (o) => head.readUInt32LE(o);
  const out = [];
  let off = u32(4);
  while (off && off + 2 < head.length) {
    const n = u16(off);
    let w = 0, h = 0, offs = null, cnts = null;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), val = u32(e + 8);
      const many = cnt > 1 || (type === 3 && cnt > 2);
      const read = () => {
        const a = [];
        if (!many) { a.push(type === 3 ? u16(e + 8) : val); return a; }
        for (let k = 0; k < cnt; k++) a.push(type === 3 ? u16(val + k * 2) : u32(val + k * 4));
        return a;
      };
      if (tag === 256) w = type === 3 ? u16(e + 8) : val;
      else if (tag === 257) h = type === 3 ? u16(e + 8) : val;
      else if (tag === 324) offs = read();
      else if (tag === 325) cnts = read();
    }
    if (w && h && offs && cnts) out.push({ w, h, off: offs, cnt: cnts });
    off = u32(off + 2 + n * 12);
  }
  return out;
}

// ── the cells that exist ──
async function listCells() {
  const cacheFile = join(CACHE, 'cells.json');
  if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
  let token = '', keys = [];
  do {
    const u = `${BUCKET}/?list-type=2&prefix=${PREFIX}&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
    const d = await (await fetch(u)).text();
    for (const m of d.matchAll(/<Key>(.*?)<\/Key>/g)) keys.push(m[1]);
    const t = d.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
    token = t ? t[1] : '';
  } while (token);
  const cells = keys.map((k) => {
    const m = k.match(/_([NS])(\d{2})([EW])(\d{3})_Map\.tif$/);
    if (!m) return null;
    return { key: k, lat0: (m[1] === 'S' ? -1 : 1) * Number(m[2]), lon0: (m[3] === 'W' ? -1 : 1) * Number(m[4]) };
  }).filter(Boolean);
  writeFileSync(cacheFile, JSON.stringify(cells));
  return cells;
}

const cells = await listCells();
console.log(`${cells.length} source cells → ${W} x ${H} (${(360 / W).toFixed(4)}° a texel, ~${(40075 / W).toFixed(1)} km at the equator)`);

const out = new Uint8Array(W * H);   // 0 = no data
let done = 0, failed = 0;

async function bakeCell(c) {
  const url = `${BUCKET}/${c.key}`;
  const head = await get(url, 0, 65535);
  const lv = levels(head);
  const L = lv[lv.length - 1];                 // the coarsest overview
  const blk = inflateSync(await get(url, L.off[0], L.off[0] + L.cnt[0] - 1));
  // The cell's north-west corner in output texels. Rows run from +90 DOWN,
  // which is the convention every raster here already uses.
  const tx0 = Math.round(((c.lon0 + 180) / 360) * W);
  const ty0 = Math.round(((90 - (c.lat0 + SPAN)) / 180) * H);
  const hist = new Uint16Array(PER * PER * 256);
  for (let py = 0; py < L.h; py++) {
    const ty = Math.min(PER - 1, Math.floor((py / L.h) * PER));
    const row = py * WC_TILE;
    for (let px = 0; px < L.w; px++) {
      const v = blk[row + px];
      if (!v) continue;
      const tx = Math.min(PER - 1, Math.floor((px / L.w) * PER));
      hist[(ty * PER + tx) * 256 + v]++;
    }
  }
  for (let ty = 0; ty < PER; ty++) for (let tx = 0; tx < PER; tx++) {
    const base = (ty * PER + tx) * 256;
    let best = 0, bestN = 0;
    for (let v = 1; v < 256; v++) if (hist[base + v] > bestN) { bestN = hist[base + v]; best = v; }
    if (best) out[(ty0 + ty) * W + (tx0 + tx)] = best;
  }
}

const queue = cells.slice();
await Promise.all(Array.from({ length: CONC }, async () => {
  for (;;) {
    const c = queue.pop();
    if (!c) return;
    try { await bakeCell(c); } catch (e) { failed++; if (failed < 6) console.log(`  ${c.key}: ${String(e).slice(0, 70)}`); }
    if (++done % 250 === 0) console.log(`  ${done}/${cells.length}`);
  }
}));

const land = out.reduce((a, v) => a + (v ? 1 : 0), 0);
const gz = deflateSync(Buffer.from(out), { level: 9 });
// BASE64 TEXT, for the reason ne-wide.b64 is: `cell-sync push` sends a binary
// asset in ONE signed request and that request 403s somewhere past a megabyte,
// while text is chunked with appendToFile and decoded whole at the far end.
// 318KB would probably squeak under the binary cap; "probably" is not a thing
// to find out on a deploy.
const b64 = gz.toString('base64');
const dest = join(CELL, 'static', 'cover-wide.b64');
writeFileSync(dest, b64);
console.log(`\n${done} cells baked, ${failed} failed`);
console.log(`${land} of ${W * H} texels carry a class (${((land / (W * H)) * 100).toFixed(1)}% — the rest is ocean)`);
console.log(`${dest}  ${(b64.length / 1024).toFixed(0)} KB of base64 over ${(gz.length / 1024).toFixed(0)} KB deflated, from ${(out.length / 1048576).toFixed(1)} MB raw`);
console.log(`for scale: static/globe-base.png is ${(324528 / 1024).toFixed(0)} KB and says less`);
