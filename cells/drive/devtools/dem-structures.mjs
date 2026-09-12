/**
 * ── DOES THE ELEVATION DATA CARRY THE BRIDGE? ──
 *
 * Found at the Pont de Normandie: the primary DEM publisher serves the deck
 * and its pylons as TERRAIN — a narrow ridge standing over an estuary the
 * land cover calls water — and everything downstream reads it as ground: the
 * origin's elevation (62.1 m mid-river), the terrain mesh, the water's bed and
 * so the river's resting level (37.6 m at one station), and the road solve,
 * which put the carriageway 63 m UNDER the ridge it belongs to and drowned the
 * rig. The fallback publisher at the same point reads 2.4 m and has no ridge
 * at all.
 *
 * Before fixing that by letting the ROADS tell the terrain — where an OSM way
 * tagged `bridge` crosses cover-water, treat the DEM under its span as
 * structure and interpolate the bed from the banks — this asks how general the
 * problem is, on sixteen major estuary spans, and whether that rule's two
 * inputs are actually present at each. Per span:
 *
 *   ridge    the highest ground in a ~900 m box over the water either side
 *            (the water is the box's tenth percentile, which over an estuary
 *            IS the water and cannot be the structure)
 *   width    the narrowest run THROUGH that peak, over eight bearings, of
 *            ground more than 10 m above the water — a deck is narrow in at
 *            least one bearing, a headland in none
 *   reach    the same run at 3 m above the water: how far apart the banks the
 *            interpolation would have to span are
 *   over     the share of the box standing over the water
 *   cover    the land cover class at the span, and the share of the box it
 *            calls water — the gate any "over water" rule fires on
 *   osm      ways carrying `bridge` in the cell's own z16 tile, and their
 *            layers — the trigger
 *
 * THE TWO PUBLISHERS ARE READ THROUGH ONE SAMPLER, on the same world grid, in
 * the same browser, so the comparison is of the DATA and not of two decoders.
 * That matters: the first cut of this tool decoded the primary tile without
 * RAW_BITMAP and Chromium colour-managed the WebP, which moves a terrarium R
 * channel by a unit or two — 256 to 512 m of "elevation" — and every reading
 * was of the decode. Ask for no colour conversion, as main.ts does.
 *
 * And the SPOT is not the measurement: a hand-typed coordinate lands anywhere
 * along a three-kilometre bridge, so the first cut read 1.9 m at the Pont de
 * Normandie — 640 m north of the pylon the game had measured at 146 m — and
 * would have reported the fault as absent where it is worst. The box's peak is
 * publisher-symmetric and does not depend on hitting the deck.
 */
import { openDrive } from './harness.mjs';

const ONLY = process.env.ONLY ? process.env.ONLY.toLowerCase() : '';

const SPANS = [
  ['Pont de Normandie', 'Seine estuary, FR', 49.4300, 0.2745],
  ['Oresund', 'Oresund, DK/SE', 55.5747, 12.8261],
  ['Golden Gate', 'San Francisco Bay, US', 37.8199, -122.4783],
  ['Bay Bridge west', 'San Francisco Bay, US', 37.7983, -122.3778],
  ['Humber', 'Humber estuary, UK', 53.7079, -0.4497],
  ['Queensferry Crossing', 'Firth of Forth, UK', 56.0021, -3.4042],
  ['Vasco da Gama', 'Tagus estuary, PT', 38.7550, -9.0350],
  ['Storebaelt East', 'Great Belt, DK', 55.3419, 10.9736],
  ['Akashi Kaikyo', 'Akashi Strait, JP', 34.6167, 135.0217],
  ['Hangzhou Bay', 'Hangzhou Bay, CN', 30.3840, 121.1300],
  ['Sydney Harbour', 'Port Jackson, AU', -33.8523, 151.2108],
  ['Chesapeake Bay', 'Chesapeake Bay, US', 38.9930, -76.3800],
  ['Rio-Niteroi', 'Guanabara Bay, BR', -22.8700, -43.1600],
  ['Prince of Wales', 'Severn estuary, UK', 51.5750, -2.6980],
  ['Tsing Ma', 'Ma Wan Channel, HK', 22.3517, 114.0742],
  ['Confederation', 'Northumberland Strait, CA', 46.2000, -63.7700],
  // ── CONTROLS: inland water with no major structure over it ──
  // The rule the spans suggest — a cover-water texel standing more than ten
  // metres above its own neighbourhood's water is not ground — has to be shown
  // NOT to fire where the water is steep, narrow or high, or it would quietly
  // carve holes in every gorge on earth. A smaller box, because a mountain
  // river falls: over 200 m a 2% channel drops four metres and over 800 m it
  // drops sixteen, so the neighbourhood the median is taken over IS the
  // threshold's other half.
  ['(control) Senqu gorge', 'Lesotho', -30.75509, 27.68403, 200],
  ['(control) Rhone at Obergoms', 'Valais, CH', 46.5200, 8.3200, 200],
  ['(control) Merced, Yosemite', 'California, US', 37.7167, -119.6470, 200],
  ['(control) Breede river', 'Western Cape, ZA', -34.1050, 20.8400, 200],
  ['(control) Loch Ness', 'Highland, UK', 57.3000, -4.4500, 200],
];

const d = await openDrive({ pagePath: '/lab', tag: 'dem-structures', settle: 0, bootTimeout: 180000, dpr: 1 });

await d.page.evaluate(() => {
  // ── ONE SAMPLER, TWO PUBLISHERS ──
  // Tiles are cached per source; a box is prefetched whole and then sampled
  // synchronously, so a grid of a few thousand points costs its tiles and no
  // more. RAW_BITMAP is the whole reason the numbers mean anything.
  const RAW = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const cache = new Map();
  const W = globalThis;
  W.__tileUrl = (src, z, x, y) => src === 'cell'
    ? `/~/dem/v1/${z}/${x}/${y}`
    : `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  W.__tileOf = (lat, lon, z) => {
    const n = 2 ** z, lr = lat * Math.PI / 180;
    return [Math.floor((lon + 180) / 360 * n),
      Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n)];
  };
  W.__latOf = (yy, z) => {
    const t = Math.PI - 2 * Math.PI * yy / 2 ** z;
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
  };
  W.__grab = async (src, z, x, y) => {
    const key = `${src}/${z}/${x}/${y}`;
    if (cache.has(key)) return cache.get(key);
    let out = null;
    try {
      const r = await fetch(W.__tileUrl(src, z, x, y));
      if (r.ok) {
        // SNIFF THE BYTES, NOT THE CONTENT TYPE. An absent tile on the cell's
        // route is a text/plain sentinel naming the ancestor to climb to, so
        // something has to tell a raster from a word — and the harness relays
        // every https request through curl and fulfils it as
        // application/octet-stream, so the header cannot: the first cut of
        // this tool gated on `image/` and reported the fallback publisher as
        // "no tile" at every span on earth. PNG and WebP both announce
        // themselves in their first twelve bytes.
        const buf = new Uint8Array(await r.arrayBuffer());
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isWebp = buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
          && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
        if (isPng || isWebp) {
          const bmp = await createImageBitmap(new Blob([buf]), RAW);
          const cv = new OffscreenCanvas(bmp.width, bmp.height);
          const g = cv.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
          g.drawImage(bmp, 0, 0);
          out = { w: bmp.width, h: bmp.height, px: g.getImageData(0, 0, bmp.width, bmp.height).data };
          bmp.close();
        }
      }
    } catch { out = null; }
    cache.set(key, out);
    return out;
  };
  // ── THE LEVEL THE GAME WOULD ACTUALLY READ ──
  // Mapterhorn publishes a LAND model, so most of an estuary's z14 tiles are
  // absent and the client climbs the pyramid to an ancestor. Reading z14 and
  // calling an absence "no data" would measure the publisher's coverage and
  // not what the terrain is built from, so this climbs as fetchHeights does
  // and reports the level it landed on.
  W.__levelFor = async (src, lat, lon) => {
    for (let z = 14; z >= 4; z--) {
      const [tx, ty] = W.__tileOf(lat, lon, z);
      if (await W.__grab(src, z, tx, ty)) return z;
    }
    return null;
  };
  W.__demAt = (src, z, lat, lon) => {
    const n = 2 ** z, [tx, ty] = W.__tileOf(lat, lon, z);
    const t = cache.get(`${src}/${z}/${tx}/${ty}`);
    if (!t) return null;
    const lonW = tx / n * 360 - 180, lonE = (tx + 1) / n * 360 - 180;
    const latN = W.__latOf(ty, z), latS = W.__latOf(ty + 1, z);
    const px = Math.min(t.w - 1, Math.max(0, Math.round((lon - lonW) / (lonE - lonW) * (t.w - 1))));
    const py = Math.min(t.h - 1, Math.max(0, Math.round((latN - lat) / (latN - latS) * (t.h - 1))));
    const i = (py * t.w + px) * 4;
    return (t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256) - 32768;
  };
  W.__prefetch = async (src, z, latMin, latMax, lonMin, lonMax) => {
    const [x0, y0] = W.__tileOf(latMax, lonMin, z), [x1, y1] = W.__tileOf(latMin, lonMax, z);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(W.__grab(src, z, x, y));
    await Promise.all(jobs);
    return jobs.length;
  };
});

const RAD_M = 450;          // half the box, metres
const STEP_M = 15;          // the grid's step
const CUT_HI = 10;          // metres over the sea: a deck, not a sandbank
const CUT_LO = 30;          // metres over the sea: unarguably a structure

/**
 * ── THE MEASURE IS TAKEN OVER THE WATER THE COVER NAMES, AGAINST THE SEA ──
 *
 * The first cut took the box's tenth percentile as the water and measured
 * everything from it, which is right over an estuary and wrong the moment a
 * publisher carries bathymetry or the box catches a headland: at the Golden
 * Gate the tenth percentile was the 100 m channel bed, so the "narrowest run
 * above the water" marched over the whole box without ever falling below it
 * and reported a 1,575 m deck. Both faults go away by asking the question
 * option 1 would actually ask — over the texels the LAND COVER calls water,
 * how far does the elevation stand above the SEA — because these sixteen spans
 * are tidal and the sea is 0 m at every one of them. The water median is
 * reported beside it as the check on that datum.
 */
const rows = [];
for (const [name, where, lat, lon, rad] of SPANS) {
  if (ONLY && !name.toLowerCase().includes(ONLY)) continue;
  const r = await d.page.evaluate(async ([lat, lon, RAD_M, STEP_M, CUT_HI, CUT_LO]) => {
    const W = globalThis;
    const mPerDegLat = 110574, mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180);
    const dLat = RAD_M / mPerDegLat, dLon = RAD_M / mPerDegLon;
    const n = Math.round(RAD_M / STEP_M);
    const out = { publishers: {} };

    // ── THE GATE: WorldCover at z12, sampled on the same grid ──
    const lr = lat * Math.PI / 180, cn = 4096;
    const cxT = Math.floor((lon + 180) / 360 * cn);
    const cyT = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * cn);
    let coverAt = () => null;
    {
      const r2 = await fetch(`/~/cover/v1/12/${cxT}/${cyT}`);
      const buf = r2.ok ? new Uint8Array(await r2.arrayBuffer()) : null;
      if (buf && buf[0] === 0x89 && buf[1] === 0x50) {
        const bmp = await createImageBitmap(new Blob([buf]),
          { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        const g = cv.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
        const lonW = cxT / cn * 360 - 180, lonE = (cxT + 1) / cn * 360 - 180;
        const latN = W.__latOf(cyT, 12), latS = W.__latOf(cyT + 1, 12);
        const cw = bmp.width, ch = bmp.height;
        coverAt = (la, lo) => {
          const x = Math.round((lo - lonW) / (lonE - lonW) * (cw - 1));
          const y = Math.round((latN - la) / (latN - latS) * (ch - 1));
          if (x < 0 || y < 0 || x >= cw || y >= ch) return null;
          return px[(y * cw + x) * 4];
        };
        bmp.close();
      }
    }
    const laOf = (iy) => lat + iy * STEP_M / mPerDegLat;
    const loOf = (ix) => lon + ix * STEP_M / mPerDegLon;
    let water = 0, tot = 0;
    for (let iy = -n; iy <= n; iy++) for (let ix = -n; ix <= n; ix++) {
      tot++; if (coverAt(laOf(iy), loOf(ix)) === 80) water++;
    }
    out.cover = { cls: coverAt(lat, lon), waterPct: +(100 * water / tot).toFixed(1) };

    for (const src of ['cell', 'aws']) {
      const z = await W.__levelFor(src, lat, lon);
      if (z === null) { out.publishers[src] = { err: 'no tile at any level' }; continue; }
      await W.__prefetch(src, z, lat - dLat, lat + dLat, lon - dLon, lon + dLon);
      const wet = [], all = [];
      let peak = -Infinity, pLat = lat, pLon = lon, miss = 0;
      for (let iy = -n; iy <= n; iy++) for (let ix = -n; ix <= n; ix++) {
        const la = laOf(iy), lo = loOf(ix);
        const e = W.__demAt(src, z, la, lo);
        if (e === null) { miss++; continue; }
        all.push(e);
        if (coverAt(la, lo) !== 80) continue;
        wet.push(e);
        if (e > peak) { peak = e; pLat = la; pLon = lo; }
      }
      if (!all.length) { out.publishers[src] = { err: 'no tile' }; continue; }
      if (!wet.length) { out.publishers[src] = { err: 'no cover-water in the box' }; continue; }
      const sw = wet.slice().sort((a, b) => a - b);
      const sa = all.slice().sort((a, b) => a - b);
      // The narrowest run of DECK through the peak: a structure is narrow in
      // at least one bearing, a headland or a spoil bank in none. Marched at
      // the grid's own step, against the sea rather than the box's floor.
      const runAt = (cut) => {
        let narrow = Infinity, bearing = 0;
        for (let b = 0; b < 8; b++) {
          const a = b * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
          let run = STEP_M;
          for (const s of [1, -1]) {
            for (let k = 1; k <= 80; k++) {
              const e = W.__demAt(src, z, pLat + s * uy * k * STEP_M / mPerDegLat,
                pLon + s * ux * k * STEP_M / mPerDegLon);
              if (e === null || e <= cut) break;
              run += STEP_M;
            }
          }
          if (run < narrow) { narrow = run; bearing = Math.round(a * 180 / Math.PI); }
        }
        return { run: narrow, bearing };
      };
      const hi = runAt(CUT_HI);
      // How far the bed would have to be interpolated: from the peak, along
      // the deck's own narrow bearing turned square to it, to the nearest
      // texel the cover does NOT call water — the banks the rule would read.
      const a = (hi.bearing + 90) * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
      let span = 0;
      for (const s of [1, -1]) {
        let k = 1;
        for (; k <= 120; k++) {
          const c = coverAt(pLat + s * uy * k * STEP_M / mPerDegLat,
            pLon + s * ux * k * STEP_M / mPerDegLon);
          if (c === null || c !== 80) break;
        }
        span += k * STEP_M;
      }
      out.publishers[src] = {
        z, wet: wet.length, dry: all.length - wet.length, miss,
        waterMedian: +sw[Math.floor(sw.length / 2)].toFixed(1),
        waterP99: +sw[Math.floor(sw.length * 0.99)].toFixed(1),
        peak: +peak.toFixed(1),
        boxMax: +sa[sa.length - 1].toFixed(1), boxMedian: +sa[Math.floor(sa.length / 2)].toFixed(1),
        over10: +(100 * wet.filter((v) => v > CUT_HI).length / wet.length).toFixed(1),
        over30: +(100 * wet.filter((v) => v > CUT_LO).length / wet.length).toFixed(1),
        // …and the same two against the LOCAL water rather than the sea, which
        // is the form a rule could take inland as well as on a tidal estuary.
        overMed10: +(100 * wet.filter((v) => v > sw[Math.floor(sw.length / 2)] + CUT_HI).length / wet.length).toFixed(2),
        overMed30: +(100 * wet.filter((v) => v > sw[Math.floor(sw.length / 2)] + CUT_LO).length / wet.length).toFixed(2),
        waterSpread: +(sw[Math.floor(sw.length * 0.95)] - sw[Math.floor(sw.length * 0.05)]).toFixed(1),
        deckM: hi.run, deckBearing: hi.bearing, waterSpanM: span,
        coverAtPeak: coverAt(pLat, pLon),
        peakLat: +pLat.toFixed(5), peakLon: +pLon.toFixed(5),
      };
    }

    // ── THE TRIGGER: what OSM says here, through the cell's own z16 tile ──
    try {
      const zz = 16, nn = 2 ** zz;
      const ox = Math.floor((lon + 180) / 360 * nn);
      const oy = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * nn);
      const r3 = await fetch(`/~/osm/v4/${zz}/${ox}/${oy}`);
      if (r3.ok) {
        const j = await r3.json();
        const ways = j.ways ?? j.elements ?? [];
        let roads = 0, bridges = 0; const named = [], layers = new Set();
        for (const w of ways) {
          const t = w.tags ?? {};
          if (!t.highway) continue;
          roads++;
          if (t.bridge) { bridges++; if (t.layer) layers.add(t.layer); if (t.name) named.push(t.name); }
        }
        out.osm = { roads, bridges, layers: [...layers].join(','), name: [...new Set(named)][0] ?? '' };
      } else out.osm = { err: `http ${r3.status}` };
    } catch (e) { out.osm = { err: String(e).slice(0, 40) }; }
    return out;
  }, [lat, lon, rad ?? RAD_M, STEP_M, CUT_HI, CUT_LO]);

  rows.push({ name, where, lat, lon, ...r });
  const fmt = (p) => p.err ? p.err
    : `z${p.z} · over water: median ${p.waterMedian}m peak ${p.peak}m · ${p.over10}% over 10m · ${p.over30}% over 30m`
      + ` · deck ${p.deckM}m wide · water span ${p.waterSpanM}m · peak cover ${p.coverAtPeak}`
      + ` · over its own water: ${p.overMed10}% by 10m, ${p.overMed30}% by 30m, p5-p95 spread ${p.waterSpread}m`;
  console.log(`${name}  (${where})`);
  console.log(`  mapterhorn  ${fmt(r.publishers.cell)}`);
  console.log(`  terrarium   ${fmt(r.publishers.aws)}`);
  console.log(`  cover ${r.cover.cls} · water ${r.cover.waterPct}% of the box · osm ${r.osm?.err ?? `${r.osm.bridges} bridge of ${r.osm.roads} roads${r.osm.layers ? ` layer ${r.osm.layers}` : ''}${r.osm.name ? ` (${r.osm.name})` : ''}`}`);
}
console.log('\nJSON ' + JSON.stringify(rows));
console.log('errors', d.errors.length, JSON.stringify(d.errors.slice(0, 3)).slice(0, 300));
await d.close();
