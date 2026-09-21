// The authored store's client half, with the store stood in for: an index
// naming the truck's own tile, a blob holding a ruin and a cliff line, and
// the world drawn with both merged into the raw tile — then the same spot
// with ?authored=0, which must show neither.
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const LAT = -38.66428, LON = 143.10395;
const n = 2 ** 16;
const tx = Math.floor(((LON + 180) / 360) * n);
const ty = Math.floor(((1 - Math.log(Math.tan((LAT * Math.PI) / 180) + 1 / Math.cos((LAT * Math.PI) / 180)) / Math.PI) / 2) * n);
const tile = `16/${tx}/${ty}`;
const REV = 1790000000000;
// A 12 m ruin 40 m north-east of the spot, and a cliff line running past it.
const d = 0.00018;
const ways = [
  { id: 2000000000001, tags: { building: 'ruins', name: 'Loch Ard Gorge store' },
    geometry: [{ lat: LAT + d, lon: LON + d }, { lat: LAT + d, lon: LON + d + 0.00014 }, { lat: LAT + d + 0.00011, lon: LON + d + 0.00014 }, { lat: LAT + d + 0.00011, lon: LON + d }, { lat: LAT + d, lon: LON + d }] },
  { id: 2000000000002, tags: { natural: 'cliff' },
    geometry: [{ lat: LAT + 2 * d, lon: LON - 3 * d }, { lat: LAT + 2 * d, lon: LON + 3 * d }] },
];
let indexAsks = 0, blobAsks = 0;
const route = async (page) => {
  await page.route('**/authored', (r) => { indexAsks++; r.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'cache-control': 'public, max-age=60' }, body: JSON.stringify({ v: 1, z: 16, rev: REV, tiles: { [tile]: { rev: REV, n: ways.length, by: 'c15r' } } }) }); });
  await page.route(`**/~/authored/v1/${tile}/${REV}`, (r) => { blobAsks++; r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ v: 1, tile, rev: REV, by: 'c15r', ways }) }); });
};
const boot = async (q, tag) => {
  const dd = await openDrive({ spot: `lat=${LAT}&lon=${LON}&h=306&cam=cab&nodraw=1&wx=clear&time=NOON${q}`, tag, bootTimeout: 120000, route });
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const t = await dd.page.evaluate(() => { const t = window.__tstats?.() ?? {}; const o = window.__osm?.() ?? {}; return { dirty: t.dirty, osm: o }; });
    if (i > 8 && t.dirty === 0) break;
  }
  const out = await dd.page.evaluate(() => ({ authored: window.__authored?.(), built: window.__built?.(), cliff: window.__tstats?.() }));
  report(dd.errors);
  await dd.close();
  return out;
};
const on = await boot('', 'authored-on');
ok('the index was asked once and the blob once', indexAsks === 1 && blobAsks === 1, { indexAsks, blobAsks });
ok('the probe shows the tile merged with both ways', on.authored?.on === true && on.authored?.merged?.[tile] === 2, on.authored);
const offA = indexAsks, offB = blobAsks;
const off = await boot('&authored=0', 'authored-off');
ok('with ?authored=0 neither the index nor a blob is asked', indexAsks === offA && blobAsks === offB && off.authored?.on === false, { indexAsks, blobAsks, a: off.authored });
const tot = (b) => (b && Number.isFinite(b.intact) ? b.intact + (b.ruin ?? 0) : null);
const bOn = tot(on.built), bOff = tot(off.built);
console.log('built on/off', JSON.stringify(on.built), JSON.stringify(off.built));
ok('the ruin stands only with the store on', bOn !== null && bOff !== null && bOn === bOff + 1, { bOn, bOff });
console.log(bad ? `${bad} FAILED` : 'authored-overlay: all ok');
process.exit(bad ? 1 : 0);
