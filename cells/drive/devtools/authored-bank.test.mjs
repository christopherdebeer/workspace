// The authored store's server half against fakes: the index read, the shape
// gate, the blob write at an immutable revision path, the index row, id
// stability across revisions, the retraction, and the caller gate.
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
// The Twelve Apostles' tile at z16.
const tile = '16/58820/39143';
const n = 2 ** 16, x = 58820, y = 39143;
const lon = ((x + 0.5) / n) * 360 - 180;
const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
const way = (dlat = 0, tags = { natural: 'cliff' }) => ({ tags, geometry: [{ lat: lat + dlat, lon }, { lat: lat + dlat + 0.0005, lon: lon + 0.0005 }] });

const g0 = await serveAuthored('GET', 'anonymous', undefined, table, put, now);
check('the index reads empty for anyone', g0.statusCode === 200 && JSON.parse(g0.body).rev === 0 && Object.keys(JSON.parse(g0.body).tiles).length === 0, g0);
check('…cached a minute, not a week', /max-age=60/.test(g0.headers['cache-control']), g0.headers);

const r1 = await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [way(), way(0.001, { building: 'ruins', name: 'Loch Ard' })] }), table, put, now);
const j1 = JSON.parse(r1.body);
check('a signed-in entry lands', r1.statusCode === 200 && j1.ok === true && j1.n === 2, j1);
check('the blob went to an immutable revision path', puts[0]?.path === `/~/authored/v1/${tile}/${clock}`, puts[0]?.path);
const blob = JSON.parse(gunzipSync(puts[0].body).toString());
check('…gzipped, with the ways and the banker', blob.ways.length === 2 && blob.by === 'c15r' && blob.ways[1].tags.name === 'Loch Ard', blob);
check('ids sit above the map and are stable per slot', blob.ways[0].id > 1e12 && blob.ways[1].id === blob.ways[0].id + 1, blob.ways.map((w) => w.id));
const g1 = JSON.parse((await serveAuthored('GET', 'anonymous', undefined, table, put, now)).body);
check('the index names the tile at that revision', g1.tiles[tile]?.rev === clock && g1.tiles[tile]?.n === 2 && g1.rev === clock, g1);

clock += 5000;
const r2 = await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [way()] }), table, put, now);
const g2 = JSON.parse((await serveAuthored('GET', 'anonymous', undefined, table, put, now)).body);
check('a rewrite is a new revision, the old path untouched', r2.statusCode === 200 && puts.length === 2 && puts[1].path.endsWith(String(clock)) && g2.tiles[tile].rev === clock && g2.tiles[tile].n === 1, g2);
check('…and the first slot keeps its id', JSON.parse(gunzipSync(puts[1].body).toString()).ways[0].id === blob.ways[0].id, null);

const r3 = await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [] }), table, put, now);
const g3 = JSON.parse((await serveAuthored('GET', 'anonymous', undefined, table, put, now)).body);
check('an empty list retracts the tile', r3.statusCode === 200 && JSON.parse(r3.body).retracted === true && !g3.tiles[tile] && puts.length === 2, g3);

check('anonymous is refused', (await serveAuthored('POST', 'anonymous', JSON.stringify({ tile, ways: [way()] }), table, put, now)).statusCode === 401, null);
check('a tile at the wrong zoom is refused', (await serveAuthored('POST', 'c15r', JSON.stringify({ tile: '14/1/1', ways: [way()] }), table, put, now)).statusCode === 400, null);
check('a way a county away is refused', (await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [way(1.0)] }), table, put, now)).statusCode === 400, null);
check('a way with no tags is refused', (await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [{ tags: {}, geometry: [{ lat, lon }] }] }), table, put, now)).statusCode === 400, null);
check('a non-string tag is refused', (await serveAuthored('POST', 'c15r', JSON.stringify({ tile, ways: [way(0, { height: 45 })] }), table, put, now)).statusCode === 400, null);
check('an oversized body is refused', (await serveAuthored('POST', 'c15r', 'x'.repeat(500000), table, put, now)).statusCode === 400, null);
check('DELETE is not a verb here', (await serveAuthored('DELETE', 'c15r', undefined, table, put, now)).statusCode === 405, null);
check('a blob the edge lacks is a no-store 404', (await handler({ rawPath: `/~/authored/v1/${tile}/1790000000000`, requestContext: { http: { method: 'GET' } } })).statusCode === 404, null);
check('the route answers under the handler', (await handler({ rawPath: '/authored', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{}' })).statusCode === 401, null);
console.log(bad ? `${bad} FAILED` : 'authored-bank: all ok');
process.exit(bad ? 1 : 0);
