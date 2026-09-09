/**
 * THE WIDE CHART, SERVED FROM A BAKE INSTEAD OF FROM OVERPASS.
 *
 * The overview's three coarse rungs — z7, z8 and z9, boxes of 313, 156 and
 * 78km — could not be got from a live public Overpass, and the reason is not
 * the one this repo believed for two sessions. It is not density: measured
 * against the live cell, a PURE SOUTH ATLANTIC OCEAN TILE, a box containing
 * essentially nothing, returned 502 at z8, z9 and z10 exactly like the Cape
 * Town city tile beside it. (CLAUDE.md, "The wide chart does not load".)
 *
 * What is actually wrong is architectural, and it survives whatever mood the
 * mirrors are in: a chart backdrop cannot depend on a third party answering a
 * 156km bounding-box query inside the fifteen and a half seconds CloudFront
 * will wait. So these rungs stop asking.
 *
 * ── AND OSM WAS THE WRONG SOURCE FOR THEM ANYWAY ──
 *
 * A z8 tile rendering into 256 art pixels is 600 metres a pixel. At that scale
 * the chart does not want a survey, it wants the trunk network that makes a
 * landform legible — which is a generalised cartographic product, and Natural
 * Earth IS one. The same source and the same shape as `bake-coast.mjs`, which
 * already bakes the land mask for the site model, and for the same reason: the
 * answer is needed at a scale nothing this game streams can reach.
 *
 * Coverage was the one thing that could have killed it — NE's road layer has a
 * reputation for being North America and Europe heavy, and a wide chart that
 * works in France and is blank in the Karoo would be the same failure wearing a
 * new cause. Measured before any of this was written, in km of road per million
 * km² (`devtools/ne-roads-coverage.mjs`): W Europe 42,911 and the eastern US
 * 41,593 against Southern Africa 17,115, Central Asia 16,068, the Andes 12,733,
 * the Sahel 8,186, SE Asia 7,584, Australia 5,726. That spread is real road
 * density — Australia genuinely has fewer roads than Belgium — and nowhere is
 * empty.
 *
 * ── IT SPEAKS OSM, SO THE CLIENT DOES NOT KNOW ──
 *
 * `neWideTile` returns the same `RawWay[]` an Overpass answer does, with
 * `highway` and `place` tags, so `trimOverview`, the client's `loadOvTile`, the
 * ribbons AND the coarse tier of the route solver all carry on unchanged. A
 * layer swap that needs no client change can be undone by one condition in
 * `serveOverview`, which is the property worth having while it is new.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface RawWay {
  type?: string; id: number; tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
  lat?: number; lon?: number;
}

/**
 * THE LADDER LIVES HERE, NOT IN THE BAKE. The asset carries every road Natural
 * Earth ranks at scalerank <= 8; these cuts are applied per request, so moving
 * a rung is an edit and a deploy rather than a re-bake and three megabytes back
 * through the cells tools. A ladder that costs a bake to tune does not get
 * tuned — which is precisely how z8, z9 and z10 ended up sharing one class set
 * over sixteen, four and one times the area.
 *
 * `scalerank` is Natural Earth's own judgement of the zoom at which a road
 * starts to matter, made by cartographers for this exact purpose. Using it
 * means the ladder is somebody else's expertise instead of my arithmetic, and
 * it is why this dataset is worth having: 46% of its features carry
 * `type: "Unknown"`, so a ladder written in NE's type vocabulary would have
 * been mostly guesswork.
 */
export const NE_SCALERANK: Record<number, number> = { 7: 4, 8: 6, 9: 8 };
/** The same idea for settlements: which places have earned a name at this box. */
export const NE_PLACE_RANK: Record<number, number> = { 7: 3, 8: 5, 9: 7 };
/** The rungs this module answers at all. Finer than z9 is still OSM's job. */
export const NE_MAX_Z = 9;

const HW = ['motorway', 'trunk', 'primary'];
const ABS = 1e6, DEL = 1e4;

interface NeLine { sr: number; hw: string; name: string; lon: Float64Array; lat: Float64Array;
  w: number; s: number; e: number; n: number; }
interface NePlace { sr: number; kind: string; name: string; lon: number; lat: number; }
interface NeSet { lines: NeLine[]; places: NePlace[]; ms: number; bytes: number; }

let loaded: NeSet | null = null;
let loadErr: string | null = null;

/**
 * Decoded once per Lambda, not once per request — /var/task is read-only and a
 * warm container serves many tiles, so there is nothing to invalidate. The
 * failure is LATCHED as well as the success: if the asset is missing from the
 * deploy, every subsequent tile should fall through to Overpass immediately
 * rather than re-reading a file that is not there once per request.
 */
export function neWide(): NeSet | null {
  if (loaded || loadErr) return loaded;
  const t0 = Date.now();
  try {
    // Base64 TEXT, because `cell-sync push` sends a BINARY asset in one signed
    // request and that request 403s somewhere past a megabyte — the same
    // signing cliff that once made a grown main.ts undeployable. Text is
    // chunked with `appendToFile` and decoded as a whole at the far end, so the
    // "two independently-decoded base64 chunks only concatenate when the first
    // is a multiple of four" trap cannot fire. 2.26MB packed does not fit under
    // the binary cap by any means: measured, even a 1200m simplify — twice the
    // coarsest rung's own tolerance — is 1.19MB.
    const raw = readFileSync(join(__dirname, 'static', 'ne-wide.b64'), 'utf8');
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < 16 || buf.toString('ascii', 0, 4) !== 'NEW2') throw new Error('bad magic');
    let o = 4;
    const nLines = buf.readUInt32LE(o); o += 4;
    const nPlaces = buf.readUInt32LE(o); o += 4;
    const nameBytes = buf.readUInt32LE(o); o += 4;
    // Names are one blob at the end, read in the order the records were
    // written; a cursor over it is cheaper than an offset per record and the
    // order is fixed by the format.
    const namesAt = buf.length - nameBytes;
    let nameCur = namesAt;
    const lines: NeLine[] = [];
    for (let i = 0; i < nLines; i++) {
      const sr = buf.readUInt8(o); o += 1;
      const hw = HW[buf.readUInt8(o)] ?? 'primary'; o += 1;
      const nameLen = buf.readUInt16LE(o); o += 2;
      const nPts = buf.readUInt16LE(o); o += 2;
      const lon = new Float64Array(nPts), lat = new Float64Array(nPts);
      let cx = buf.readInt32LE(o) / ABS; o += 4;
      let cy = buf.readInt32LE(o) / ABS; o += 4;
      lon[0] = cx; lat[0] = cy;
      let w = cx, e = cx, s = cy, n = cy;
      for (let k = 1; k < nPts; k++) {
        cx += buf.readInt16LE(o) / DEL; o += 2;
        cy += buf.readInt16LE(o) / DEL; o += 2;
        lon[k] = cx; lat[k] = cy;
        if (cx < w) w = cx; else if (cx > e) e = cx;
        if (cy < s) s = cy; else if (cy > n) n = cy;
      }
      const name = nameLen ? buf.toString('utf8', nameCur, nameCur + nameLen) : '';
      nameCur += nameLen;
      lines.push({ sr, hw, name, lon, lat, w, s, e, n });
    }
    const places: NePlace[] = [];
    for (let i = 0; i < nPlaces; i++) {
      const sr = buf.readUInt8(o); o += 1;
      const kind = buf.readUInt8(o) === 0 ? 'city' : 'town'; o += 1;
      const nameLen = buf.readUInt16LE(o); o += 2;
      const lon = buf.readInt32LE(o) / ABS; o += 4;
      const lat = buf.readInt32LE(o) / ABS; o += 4;
      const name = nameLen ? buf.toString('utf8', nameCur, nameCur + nameLen) : '';
      nameCur += nameLen;
      places.push({ sr, kind, name, lon, lat });
    }
    loaded = { lines, places, ms: Date.now() - t0, bytes: buf.length };
    return loaded;
  } catch (err) {
    loadErr = String((err as Error).message ?? err);
    return null;
  }
}

/** Why the bake is not answering, for the diagnostic the 503 now carries. */
export const neWideError = (): string | null => loadErr;

/**
 * Every line and place inside the tile, as an Overpass answer would have
 * shaped it.
 *
 * A LINE IS CLIPPED TO THE BOX BUT KEPT AS RUNS, not truncated to its first
 * crossing and not returned whole. Returning it whole is what plain `out geom`
 * does upstream and it is why one coastline way can drag a continent into a
 * 156km tile; truncating it at the first exit would break every road that
 * leaves and comes back. Each run that lies inside the box becomes its own way,
 * with one point carried on either side so a ribbon reaches the tile edge
 * rather than stopping short of it — the same reason `client/clip.ts` exists on
 * the fine layer.
 *
 * Ids are synthesised NEGATIVE and unique per run. The client's tile cache and
 * the coarse route tier key on id, and OSM ways and relations already share a
 * number space with relations negative (see `trimWays`), so a third source
 * needs its own room: the id is the line's index and the run's ordinal, offset
 * far below anything either of those produce.
 */
export function neWideTile(z: number, x: number, y: number): RawWay[] | null {
  const set = neWide();
  if (!set) return null;
  const n = 2 ** z;
  const lonW = (x / n) * 360 - 180, lonE = ((x + 1) / n) * 360 - 180;
  const latOf = (i: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * i) / n))) * 180) / Math.PI;
  const latN = latOf(y), latS = latOf(y + 1);
  const srMax = NE_SCALERANK[z] ?? NE_SCALERANK[NE_MAX_Z];
  const prMax = NE_PLACE_RANK[z] ?? NE_PLACE_RANK[NE_MAX_Z];
  const out: RawWay[] = [];
  const inside = (lo: number, la: number) => lo >= lonW && lo <= lonE && la >= latS && la <= latN;

  for (let i = 0; i < set.lines.length; i++) {
    const L = set.lines[i];
    if (L.sr > srMax) continue;
    // The per-line bounding box, computed at decode, is what makes this a scan
    // worth doing at all: 41,000 lines tested by four comparisons each, and
    // only the handful that survive have their points walked.
    if (L.e < lonW || L.w > lonE || L.n < latS || L.s > latN) continue;
    let run: Array<{ lat: number; lon: number }> = [];
    let ord = 0;
    const flush = () => {
      if (run.length >= 2) {
        out.push({ type: 'way', id: -1000000000 - i * 64 - (ord++ % 64),
          tags: { highway: L.hw, ...(L.name ? { name: L.name } : {}) },
          geometry: run });
      }
      run = [];
    };
    for (let k = 0; k < L.lon.length; k++) {
      const here = inside(L.lon[k], L.lat[k]);
      if (here) {
        // One point of lead-in, so a run that starts mid-line still reaches
        // back toward the edge it came through.
        if (!run.length && k > 0) run.push({ lat: L.lat[k - 1], lon: L.lon[k - 1] });
        run.push({ lat: L.lat[k], lon: L.lon[k] });
      } else if (run.length) {
        run.push({ lat: L.lat[k], lon: L.lon[k] });     // one point of lead-out
        flush();
      }
    }
    flush();
  }
  for (const p of set.places) {
    if (p.sr > prMax) continue;
    if (!inside(p.lon, p.lat)) continue;
    out.push({ type: 'node', id: -2000000000 - Math.round((p.lat + 90) * 1e4),
      tags: { place: p.kind, name: p.name }, lat: p.lat, lon: p.lon });
  }
  return out;
}
