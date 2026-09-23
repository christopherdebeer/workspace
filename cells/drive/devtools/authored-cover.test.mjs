// The cover layer's overlay, end to end: a stand-in entry paints a block of
// the class raster to FOREST on the layer's own z12 tile, and the game reads
// that class back at the truck — the raster is amended before the tile is
// ever registered, so nothing downstream sees the raw byte. With
// ?authored=0 the same boot reads the raster's own class.
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const LAT = -34.0971, LON = 18.37582;          // Cape Flats, the campsbay spot's inland neighbour
const REV = 1790000000000;
const z12 = 2 ** 12;
const cx = Math.floor(((LON + 180) / 360) * z12);
const cy = Math.floor(((1 - Math.log(Math.tan((LAT * Math.PI) / 180) + 1 / Math.cos((LAT * Math.PI) / 180)) / Math.PI) / 2) * z12);
const TILE = `12/${cx}/${cy}`;
const b = (() => {
  const n = z12;
  return { lonW: (cx / n) * 360 - 180, lonE: ((cx + 1) / n) * 360 - 180,
    latN: (Math.atan(Math.sinh(Math.PI * (1 - (2 * cy) / n))) * 180) / Math.PI,
    latS: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (cy + 1)) / n))) * 180) / Math.PI };
})();
// A block around the spawn, not one cell: the raster's index runs on local
// metres and this converts through lat/lon, so a cell or two of drift must
// not decide it. A z12 cover cell is ~38 m, so 9x9 is ~340 m across.
const ix0 = Math.floor(((LON - b.lonW) / (b.lonE - b.lonW)) * 256);
const iz0 = Math.floor(((b.latN - LAT) / (b.latN - b.latS)) * 256);
const cellsOf = (klass) => {
  const out = [];
  for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    const ix = ix0 + dx, iz = iz0 + dz;
    if (ix >= 0 && ix < 256 && iz >= 0 && iz < 256) out.push([iz * 256 + ix, klass]);
  }
  return out;
};
const routeFor = (cells) => async (page) => {
  await page.route('**/authored', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ v: 2, layers: { osm: 16, cover: 12, dem: 14 }, rev: cells ? REV : 0,
      tiles: cells ? { [`cover/${TILE}`]: { rev: REV, n: cells.length, by: 'c15r' } } : {} }) }));
  await page.route('**/~/authored/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (cells && p.endsWith(`/~/authored/cover/v1/${TILE}/${REV}`)) {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ v: 2, layer: 'cover', tile: TILE, rev: REV, by: 'c15r', cells }) });
    }
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
};
const boot = async (q, tag, cells) => {
  const d = await openDrive({ spot: `lat=${LAT}&lon=${LON}&h=0&cam=top&nodraw=1&wx=clear&time=NOON${q}`, tag, bootTimeout: 120000, route: routeFor(cells) });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await d.page.evaluate(() => window.__tstats?.().dirty);
    if (i > 6 && t === 0) break;
  }
  const out = await d.page.evaluate(() => ({ authored: window.__authored?.(), here: window.__coverAt?.(0, 0) }));
  report(d.errors);
  await d.close();
  return out;
};
// THE RASTER SPEAKS FIRST. The class to paint is chosen against what the
// ground already is — a first cut painted FOREST over ground the raster
// already called forest, and every assertion passed while proving nothing.
const off = await boot('&authored=0', 'cover-off', null);
console.log('off', JSON.stringify(off));
const raw = off.here?.truth;
const KLASS = raw === 80 ? 10 : 80;            // water, unless the ground is already water
const cells = cellsOf(KLASS);
const on = await boot('', 'cover-on', cells);
console.log('on', JSON.stringify(on), 'raw', raw, 'painted', KLASS);
ok('with ?authored=0 nothing is asked and the raster speaks for itself',
  off.authored?.on === false && off.authored?.cells && Object.keys(off.authored.cells).length === 0 && raw !== null && raw !== undefined,
  { authored: off.authored, here: off.here });
ok('the class chosen to paint is one the raster does not already say', KLASS !== raw, { raw, KLASS });
ok('the cover overlay lands on its own z12 tile', on.authored?.cells?.[`cover/${TILE}`] === cells.length, on.authored);
ok('the game reads the painted class at the truck, not the raster\u2019s own', on.here?.truth === KLASS && on.here.truth !== raw, { on: on.here, raw });
console.log(bad ? `${bad} FAILED` : 'authored-cover: all ok');
process.exit(bad ? 1 : 0);
