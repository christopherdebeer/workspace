/**
 * THE WIDE CHART, BAKED — so z7, z8 and z9 never ask Overpass again.
 *
 *   node cells/drive/devtools/bake-ne-roads.mjs
 *
 * The coarse overview rungs cannot be got from a live public Overpass. Two
 * sessions were spent diagnosing that as a density problem and it is not one —
 * a PURE OCEAN z8 tile 502s exactly like a Cape Town city tile (CLAUDE.md, "The
 * wide chart does not load"). Whatever the upstream's mood, a chart backdrop
 * that depends on a third party answering a 156km bounding-box query inside
 * fifteen seconds is not a design, it is a hope.
 *
 * At 600m per chart pixel — which is what a z8 tile is when it renders into 256
 * art pixels — the chart does not want OSM's surveyed geometry anyway. It wants
 * the trunk network that makes a landform legible, and that is a generalised
 * cartographic product, which is what Natural Earth IS. Same source and same
 * shape as `bake-coast.mjs`, which already bakes the land mask for the site
 * model, and for the same reason: the answer is needed at a scale nothing the
 * game streams can reach.
 *
 * ── COVERAGE WAS THE ONE THING THAT COULD HAVE KILLED IT ──
 *
 * NE's road layer has a reputation for being North America and Europe heavy,
 * and a wide chart that works in France and is blank in the Karoo would be the
 * same failure with a new cause and no error message. Measured first
 * (`ne-roads-coverage.mjs`), in km of road per million km² of land: W Europe
 * 42,911 and the eastern US 41,593 against Southern Africa 17,115, Central Asia
 * 16,068, the Andes 12,733, the Sahel 8,186, SE Asia 7,584 and Australia 5,726.
 * The spread is REAL ROAD DENSITY, not a data gap — Australia genuinely has
 * fewer roads than Belgium — and nowhere is empty. 882 features and 43,425km in
 * Southern Africa is a network, not a scattering.
 *
 * ── SCALERANK IS THE LADDER, AND IT WAS ALREADY BUILT ──
 *
 * 46% of the features carry `type: "Unknown"`, so a class ladder written in NE's
 * type vocabulary would be mostly guesswork. But every feature carries
 * `scalerank` 3-10 — Natural Earth's own judgement of the zoom at which a road
 * starts to matter, made by cartographers for exactly this purpose. The rungs
 * are cumulative scalerank cuts, so the ladder is somebody else's expertise
 * rather than my arithmetic, which is the whole reason to use this dataset.
 *
 * ── AND IT EMITS OSM'S SHAPE, SO THE CLIENT DOES NOT CHANGE ──
 *
 * The overview reader wants `{v, z, x, y, ways: [{id, tags, geometry}]}` with
 * `highway` and `place` tags. NE's types map onto that vocabulary cleanly, so
 * the bake speaks OSM and `client/main.ts` cannot tell where a coarse tile came
 * from. A layer swap that needs no client change can be reverted by one line in
 * the handler, which is the property worth having while it is new.
 *
 * Output: `cells/drive/static/ne-wide.bin` — read by the handler off /var/task,
 * NOT bundled into a module. `static/` is shipped verbatim and is binary-safe
 * (see CLAUDE.md); a megabyte of baked geometry has no business in the JS the
 * bundler has to parse, and the client never downloads it at all.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// BASE64 TEXT, NOT A BINARY FILE, AND THE REASON IS THE TRANSPORT.
// `cell-sync push` sends a binary asset in ONE signed request — chunking it is
// unsafe, because two independently-decoded base64 chunks only concatenate when
// the first is a multiple of four characters — so a binary caps at about 750KB,
// the same signing cliff that once made a grown main.ts undeployable. A TEXT
// file has no such cap: it is chunked with `appendToFile` and decoded once, as
// a whole, at the far end, so the alignment trap cannot fire.
//
// Measured before choosing: this set is ~41,000 lines and does not fit under
// 750KB by any means available. At a 1200m simplify — twice the coarsest rung's
// own tolerance, so visibly degraded — with delta packing it is still 1.19MB.
// Names are 26KB and not the problem. Sharding was the alternative and it buys
// bookkeeping in the handler for nothing this file needs.
const OUT = join(HERE, '..', 'static', 'ne-wide.b64');
const GH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

// THE SIMPLIFY TOLERANCE IS THE FINEST RUNG'S OWN, EXACTLY. The handler
// simplifies again per tile — `trimOverview` at half a chart pixel for that
// zoom — so this pass must not throw away detail the FINEST baked rung would
// have kept, and has no reason to keep any more than that. z9's tolerance is
// (40075016.7 / 2^9) / 512 = 153m, so 150m here is matched rather than chosen:
// nothing is lost at any rung the bake serves, and nothing is carried that
// every rung would immediately discard. (NE is already generalised at about
// this scale — 150m drops only 6% of its points — so the tolerance is a
// guarantee, not a compression strategy. The compression is the delta packing.)
const BAKE_TOL_M = 150;

// ── the rungs ──────────────────────────────────────────────────────────
// Cumulative: a rung carries every road at or below its scalerank. The cuts are
// NE's own ranks, and the counts they imply globally are printed by the bake so
// the ladder can be argued with rather than trusted.
//
// THE BAKE KEEPS EVERYTHING UP TO THE FINEST RUNG AND THE HANDLER APPLIES THE
// CUT. These numbers are printed here and are otherwise documentation: the
// binary carries every road at scalerank <= 8, so moving a rung is an edit to
// `NE_SCALERANK` in index.ts and a deploy, not a re-bake and a 4MB asset
// through the cells tools. A ladder that costs a bake to tune will not be
// tuned.
const NE_RUNGS = { 7: 4, 8: 6, 9: 8 };
// Places, by the same logic: `scalerank` on populated places is the zoom at
// which a settlement earns its name. A z7 tile is 313km across and wants
// capitals and million-cities; z9 at 78km can carry a market town.
const NE_PLACE_RUNGS = { 7: 3, 8: 5, 9: 7 };

/** NE's road vocabulary onto OSM's, so the client cannot tell the difference. */
function highwayOf(type, scalerank) {
  switch (type) {
    case 'Major Highway': return 'motorway';
    case 'Beltway': return 'motorway';
    case 'Bypass': return 'trunk';
    case 'Secondary Highway': return 'trunk';
    case 'Road': return 'primary';
    // 46% OF THE SET, AND SCALERANK IS THE ONLY HONEST ANSWER FOR IT. A road NE
    // shows at the widest zooms is a trunk road whatever its type field says;
    // one it holds back to z9 is a primary. Guessing a finer class than that
    // from a null would be inventing evidence.
    case 'Unknown': return scalerank <= 5 ? 'trunk' : 'primary';
    default: return null;                 // ferries, tracks: not a chart's roads
  }
}

const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/**
 * Ramer-Douglas-Peucker in metres, on [lon, lat] pairs — the same algorithm as
 * the handler's `simplifyLine`, deliberately, so a baked tile and an Overpass
 * tile are generalised by the same rule and a rung boundary is not a change of
 * cartographic style.
 */
function simplify(pts, tolM) {
  if (pts.length <= 2) return pts;
  const lat0 = rad(pts[0][1]);
  const mLon = 111320 * Math.cos(lat0);
  const px = (p) => [p[0] * mLon, p[1] * 111320];
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
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

console.log(`fetching ${GH}/ne_10m_roads.geojson`);
const roads = await (await fetch(`${GH}/ne_10m_roads.geojson`)).json();
console.log(`fetching ${GH}/ne_10m_populated_places_simple.geojson`);
const places = await (await fetch(`${GH}/ne_10m_populated_places_simple.geojson`)).json();

// ── roads ──────────────────────────────────────────────────────────────
const lines = [];
let rawPts = 0, keptPts = 0, dropped = 0;
for (const f of roads.features) {
  const p = f.properties ?? {}, g = f.geometry;
  if (!g) continue;
  const sr = Number(p.scalerank ?? 10);
  if (sr > NE_RUNGS[9]) { dropped++; continue; }   // finer than any baked rung
  const hw = highwayOf(p.type, sr);
  if (!hw) { dropped++; continue; }
  const parts = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const part of parts) {
    if (part.length < 2) continue;
    rawPts += part.length;
    const s = simplify(part, BAKE_TOL_M);
    keptPts += s.length;
    lines.push({ sr, hw, name: p.name || p.label || '', pts: s });
  }
}
console.log(`roads: ${lines.length} lines, ${rawPts} -> ${keptPts} points (${(100 - (keptPts / rawPts) * 100).toFixed(0)}% dropped), ${dropped} features skipped`);
const bySr = new Map();
for (const l of lines) bySr.set(l.sr, (bySr.get(l.sr) ?? 0) + 1);
for (const z of [7, 8, 9]) {
  const n = lines.filter((l) => l.sr <= NE_RUNGS[z]).length;
  const pts = lines.filter((l) => l.sr <= NE_RUNGS[z]).reduce((a, l) => a + l.pts.length, 0);
  console.log(`  z${z}: scalerank <= ${NE_RUNGS[z]}  ${n} lines, ${pts} points  (world total)`);
}

// ── places ─────────────────────────────────────────────────────────────
const pts = [];
for (const f of places.features) {
  const p = f.properties ?? {}, g = f.geometry;
  if (!g || g.type !== 'Point') continue;
  const sr = Number(p.scalerank ?? 10);
  if (sr > NE_PLACE_RUNGS[9]) continue;
  const name = p.name || p.nameascii || '';
  if (!name) continue;
  // The client draws `city` larger than `town`; NE's own rank is the ordering
  // and pop_max the tiebreak it already agrees with.
  const kind = sr <= 2 || (p.pop_max ?? 0) >= 1e6 ? 'city' : 'town';
  pts.push({ sr, kind, name, lon: g.coordinates[0], lat: g.coordinates[1] });
}
console.log(`places: ${pts.length} kept`);
for (const z of [7, 8, 9]) {
  console.log(`  z${z}: scalerank <= ${NE_PLACE_RUNGS[z]}  ${pts.filter((p) => p.sr <= NE_PLACE_RUNGS[z]).length} places`);
}

// ── pack ───────────────────────────────────────────────────────────────
// A COMPACT BINARY, NOT JSON, because this is read on a Lambda cold start and a
// JSON.parse of four megabytes is the one cost that would be paid on every cold
// invocation. Every field is fixed width, so the reader is a loop.
//
// A LINE'S FIRST POINT IS ABSOLUTE AND THE REST ARE DELTAS. Absolute Int32 at
// 1e-6 degrees is 8 bytes a point and 3.7MB; deltas at 1e-4 degrees (about 11m,
// a thirtieth of a chart pixel at the finest rung this serves) fit Int16 with
// a span of +-3.27 degrees — some 360km — so no real road segment can overflow
// one, and the escape hatch an Int16-at-1e-5 scheme would have needed does not
// have to exist.
//
// AND THE ENCODER ROUNDS THE WAY THE DECODER WILL. Writing each delta against
// the TRUE previous point lets the rounding error random-walk along a line —
// about 55m after a hundred points. Writing it against the previous point AS
// THE DECODER WILL RECONSTRUCT IT bounds the error at one step's rounding, 5.5m,
// however long the line. Same bytes, and the only version that is correct.
//
// layout:
//   magic "NEW2" | u32 nLines | u32 nPlaces | u32 nameBytes
//   lines:  u8 scalerank | u8 hwClass | u16 nameLen | u16 nPts
//           | i32 lon0 | i32 lat0 | (i16 dLon, i16 dLat) x (nPts-1)
//   places: u8 scalerank | u8 kind | u16 nameLen | i32 lon | i32 lat
//   names:  utf-8, concatenated in the order written above
const HW = ['motorway', 'trunk', 'primary'];
const ABS = 1e6, DEL = 1e4;
const names = [];
let nameBytes = 0;
const enc = new TextEncoder();
const nameOf = (s) => { const b = enc.encode(s); names.push(b); nameBytes += b.length; return b.length; };
const lineNameLens = lines.map((l) => nameOf(l.name));
const placeNameLens = pts.map((p) => nameOf(p.name));

let size = 16 + nameBytes;
for (const l of lines) size += 6 + 8 + (l.pts.length - 1) * 4;
for (const _ of pts) size += 12;

const buf = Buffer.alloc(size);
let o = 0, worstM = 0;
buf.write('NEW2', o, 'ascii'); o += 4;
buf.writeUInt32LE(lines.length, o); o += 4;
buf.writeUInt32LE(pts.length, o); o += 4;
buf.writeUInt32LE(nameBytes, o); o += 4;
lines.forEach((l, i) => {
  buf.writeUInt8(l.sr, o); o += 1;
  buf.writeUInt8(HW.indexOf(l.hw), o); o += 1;
  buf.writeUInt16LE(lineNameLens[i], o); o += 2;
  buf.writeUInt16LE(l.pts.length, o); o += 2;
  // The first point, absolute — and it is also the decoder's starting state, so
  // it is rounded here and carried forward exactly as read back.
  let cx = Math.round(l.pts[0][0] * ABS) / ABS, cy = Math.round(l.pts[0][1] * ABS) / ABS;
  buf.writeInt32LE(Math.round(cx * ABS), o); o += 4;
  buf.writeInt32LE(Math.round(cy * ABS), o); o += 4;
  for (let k = 1; k < l.pts.length; k++) {
    const [lon, lat] = l.pts[k];
    let dx = Math.round((lon - cx) * DEL), dy = Math.round((lat - cy) * DEL);
    // Nothing in this dataset should reach the clamp; if the world ever
    // produces a 360km straight the line is bent by it rather than corrupted,
    // and `worstM` reports it so a silent truncation cannot pass unnoticed.
    dx = Math.max(-32768, Math.min(32767, dx));
    dy = Math.max(-32768, Math.min(32767, dy));
    buf.writeInt16LE(dx, o); o += 2;
    buf.writeInt16LE(dy, o); o += 2;
    cx += dx / DEL; cy += dy / DEL;
    const errM = Math.hypot((lon - cx) * 111320 * Math.cos((lat * Math.PI) / 180), (lat - cy) * 111320);
    if (errM > worstM) worstM = errM;
  }
});
pts.forEach((p, i) => {
  buf.writeUInt8(p.sr, o); o += 1;
  buf.writeUInt8(p.kind === 'city' ? 0 : 1, o); o += 1;
  buf.writeUInt16LE(placeNameLens[i], o); o += 2;
  buf.writeInt32LE(Math.round(p.lon * ABS), o); o += 4;
  buf.writeInt32LE(Math.round(p.lat * ABS), o); o += 4;
});
for (const b of names) { buf.set(b, o); o += b.length; }
if (o !== size) throw new Error(`pack size mismatch: wrote ${o} of ${size}`);

mkdirSync(dirname(OUT), { recursive: true });
const b64 = buf.toString('base64');
writeFileSync(OUT, b64, 'utf8');
console.log(`\nworst point error after delta packing: ${worstM.toFixed(1)}m ` +
  `(a chart pixel at the finest rung this serves, z9, is 305m)`);
console.log(`wrote ${OUT}`);
console.log(`  packed ${(buf.length / 1048576).toFixed(2)}MB -> base64 ${(b64.length / 1048576).toFixed(2)}MB text`);
console.log('the handler reads and decodes this off /var/task; the client never downloads it.');
