// The authored store's server half against fakes: three layers on their own
// grids, the index read, every shape gate, the blob at an immutable revision
// path, the index row, id stability across revisions, the retraction, and
// the caller gate.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
process.env.TABLE_NAME = process.env.TABLE_NAME || 'test-table';
const dir = mkdtempSync(join(tmpdir(), 'authored-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe', cwd: join(import.meta.dirname, '..', '..', '..') });
const { serveAuthored, handler } = await import(out);
let bad = 0;
const check = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const rows = new Map();          // key -> row
const table = {
  async authored() { return [...rows.values()]; },
  async putAuthored(row) { rows.set(row.key, row); },
  async delRows(pk, sks) { for (const sk of sks) rows.delete(sk.replace(/^TILE#/, '')); },
};
const puts = [];
const put = async (path, body) => { puts.push({ path, body }); };
let clock = 1790000000000;
const now = () => clock;
const post = (body) => serveAuthored('POST', 'c15r', JSON.stringify(body), table, put, now);
const index = async () => JSON.parse((await serveAuthored('GET', 'anonymous', undefined, table, put, now)).body);
const blob = (i) => JSON.parse(gunzipSync(puts[i].body).toString());
// The Apostles' tiles, each on its own layer's grid.
const osmTile = '16/58818/40410', coverTile = '12/3676/2525', demTile = '14/14704/10102';
const n = 2 ** 16, x = 58818, y = 40410;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
const way = (dlat = 0, tags = { natural: 'cliff' }) => ({ tags, geometry: [{ lat: lat + dlat, lon }, { lat: lat + dlat + 0.0005, lon: lon + 0.0005 }] });

const g0 = await index();
check('the index reads empty for anyone', g0.rev === 0 && Object.keys(g0.tiles).length === 0, g0);
check('…and names each layer with its own zoom', g0.layers?.osm === 16 && g0.layers?.cover === 12 && g0.layers?.dem === 14, g0.layers);

// ── OSM: ways and a patch, the default layer ──
const r1 = await post({ tile: osmTile, ways: [way(), way(0.001, { building: 'ruins', name: 'Loch Ard' })] });
const j1 = JSON.parse(r1.body);
check('an osm entry lands without naming its layer', r1.statusCode === 200 && j1.ok && j1.layer === 'osm' && j1.ways === 2, j1);
check('the blob went to an immutable per-layer revision path', puts[0]?.path === `/~/authored/osm/v1/${osmTile}/${clock}`, puts[0]?.path);
const b1 = blob(0);
check('…gzipped, with the ways and the banker', b1.ways.length === 2 && b1.by === 'c15r' && b1.ways[1].tags.name === 'Loch Ard', b1);
check('ids sit above the map and are stable per slot', b1.ways[0].id > 1e12 && b1.ways[1].id === b1.ways[0].id + 1, b1.ways.map((w) => w.id));
const g1 = await index();
check('the index keys the tile by layer', g1.tiles[`osm/${osmTile}`]?.rev === clock && g1.tiles[`osm/${osmTile}`]?.n === 2, g1.tiles);

clock += 5000;
const r2 = await post({ layer: 'osm', tile: osmTile, ways: [way()], patch: { '658651384': { height: '45' } } });
const j2 = JSON.parse(r2.body);
const g2 = await index();
check('a rewrite is a new revision, the old path untouched', r2.statusCode === 200 && puts.length === 2 && puts[1].path.endsWith(String(clock)) && g2.tiles[`osm/${osmTile}`].rev === clock, g2.tiles);
check('…carrying the patch and counting both kinds', j2.ways === 1 && j2.patched === 1 && j2.n === 2 && blob(1).patch['658651384'].height === '45', j2);
check('…and the first slot keeps its id', blob(1).ways[0].id === b1.ways[0].id, null);

// ── COVER: cells on the z12 grid ──
clock += 5000;
const r3 = await post({ layer: 'cover', tile: coverTile, cells: [[1000, 40], [1001, 40], [70, 80]] });
const j3 = JSON.parse(r3.body);
check('a cover entry lands on the z12 grid', r3.statusCode === 200 && j3.ok && j3.layer === 'cover' && j3.cells === 3, j3);
check('…at its own layer path, with the cells', puts[2].path === `/~/authored/cover/v1/${coverTile}/${clock}` && blob(2).cells.length === 3 && blob(2).cells[2][1] === 80, puts[2].path);
const g3 = await index();
check('…and the index holds both layers at once', Object.keys(g3.tiles).length === 2 && g3.tiles[`cover/${coverTile}`].n === 3, g3.tiles);

// ── DEM: cells on the z14 grid, metres ──
clock += 5000;
const r4 = await post({ layer: 'dem', tile: demTile, cells: [[3000, 45.25], [3001, 45.5]] });
const j4 = JSON.parse(r4.body);
check('a dem entry lands on the z14 grid with metres', r4.statusCode === 200 && j4.cells === 2 && blob(3).cells[0][1] === 45.25, j4);
check('a dem tile at the cover zoom is refused', (await post({ layer: 'dem', tile: coverTile, cells: [[1, 2]] })).statusCode === 400, null);
check('a cover tile at the osm zoom is refused', (await post({ layer: 'cover', tile: osmTile, cells: [[1, 2]] })).statusCode === 400, null);

// ── the gates ──
check('an unknown layer is refused', (await post({ layer: 'trees', tile: osmTile, ways: [way()] })).statusCode === 400, null);
check('a cover entry carrying ways is refused', (await post({ layer: 'cover', tile: coverTile, ways: [way()] })).statusCode === 400, null);
check('an osm entry carrying cells is refused', (await post({ tile: osmTile, cells: [[1, 2]] })).statusCode === 400, null);
check('a cover class over a byte is refused', (await post({ layer: 'cover', tile: coverTile, cells: [[1, 300]] })).statusCode === 400, null);
check('a dem cell off the planet is refused', (await post({ layer: 'dem', tile: demTile, cells: [[1, 20000]] })).statusCode === 400, null);
check('a cell index off the raster is refused', (await post({ layer: 'dem', tile: demTile, cells: [[65536, 4]] })).statusCode === 400, null);
check('the same cell given twice is refused', (await post({ layer: 'dem', tile: demTile, cells: [[7, 4], [7, 5]] })).statusCode === 400, null);
check('a patch key that is not an osm id is refused', (await post({ tile: osmTile, patch: { w1: { height: '4' } } })).statusCode === 400, null);
check('a way a county away is refused', (await post({ tile: osmTile, ways: [way(1.0)] })).statusCode === 400, null);
check('a non-string tag is refused', (await post({ tile: osmTile, ways: [way(0, { height: 45 })] })).statusCode === 400, null);
check('an oversized body is refused', (await serveAuthored('POST', 'c15r', 'x'.repeat(2_100_000), table, put, now)).statusCode === 400, null);
check('anonymous is refused', (await serveAuthored('POST', 'anonymous', JSON.stringify({ tile: osmTile, ways: [way()] }), table, put, now)).statusCode === 401, null);
check('DELETE is not a verb here', (await serveAuthored('DELETE', 'c15r', undefined, table, put, now)).statusCode === 405, null);

// ── retraction, per layer ──
const banked = puts.length;
const r5 = await post({ layer: 'cover', tile: coverTile, cells: [] });
const g5 = await index();
check('an empty list retracts that layer’s tile alone', JSON.parse(r5.body).retracted === true && !g5.tiles[`cover/${coverTile}`] && g5.tiles[`osm/${osmTile}`] && puts.length === banked, g5.tiles);
check('an osm entry with neither ways nor patch retracts', JSON.parse((await post({ tile: osmTile, ways: [], patch: {} })).body).retracted === true, null);

// ── the handler's own routes ──
check('a blob the edge lacks is a no-store 404', (await handler({ rawPath: `/~/authored/dem/v1/${demTile}/1790000000000`, requestContext: { http: { method: 'GET' } } })).statusCode === 404, null);
check('…on every layer', (await handler({ rawPath: `/~/authored/cover/v1/${coverTile}/1790000000000`, requestContext: { http: { method: 'GET' } } })).statusCode === 404, null);
check('the route answers under the handler', (await handler({ rawPath: '/authored', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{}' })).statusCode === 401, null);
console.log(bad ? `${bad} FAILED` : 'authored-bank: all ok');
process.exit(bad ? 1 : 0);
