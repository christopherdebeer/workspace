// The bank's server half against fakes: shape gate, blob write, index row,
// shelf prune, and the /state shelf listing.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
process.env.TABLE_NAME = process.env.TABLE_NAME || 'test-table';
const dir = mkdtempSync(join(tmpdir(), 'bank-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe' });
const { serveTape, serveState } = await import(out);
let bad = 0;
const check = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };
const rows = new Map();          // pk -> Map(sk -> meta)
const table = {
  async all(pk) {
    const m = rows.get(pk) ?? new Map();
    return { roads: {}, marks: { m: {}, s: {} }, odo: 0,
      tapes: [...m.entries()].filter(([sk]) => sk.startsWith('TAPE#'))
        .map(([sk, v]) => ({ id: sk.slice(5), ...v })) };
  },
  async putRoads() {}, async putMarks() {}, async setProfile() {},
  async putTape(pk, meta) {
    const m = rows.get(pk) ?? new Map();
    m.set('TAPE#' + meta.id, meta);
    rows.set(pk, m);
  },
  async delRows(pk, sks) { const m = rows.get(pk); for (const sk of sks) m?.delete(sk); },
};
const puts = [];
const put = async (path, body) => { puts.push({ path, body }); };
const tape = (at) => JSON.stringify({
  head: { v: 2, at, secs: 21.3, steps: 425, lat: -34.0971, lon: 18.37582, dials: { trac: 1, tseg: 2 } },
  steps: 'AAAA', keys: 'BBBB' });

const r1 = await serveTape('c15r', tape(1787560000000), table, put);
const j1 = JSON.parse(r1.body);
check('a signed-in bank lands', r1.statusCode === 200 && j1.ok === true, j1);
check('the blob went to the public namespace under the caller', puts[0]?.path === '/~/tape/v1/c15r/1787560000000', puts[0]?.path);
check('…gzipped and intact', JSON.parse(gunzipSync(puts[0].body).toString()).head.dials.trac === 1, null);
check('…and the index row exists', (await table.all('PLAYER#c15r')).tapes.length === 1, null);
check('anonymous is refused', (await serveTape('anonymous', tape(1), table, put)).statusCode === 401, null);
check('a non-tape is refused', (await serveTape('c15r', '{"head":{}}', table, put)).statusCode === 400, null);
check('an oversized body is refused', (await serveTape('c15r', 'x'.repeat(300000), table, put)).statusCode === 413 || (await serveTape('c15r', 'x'.repeat(300000), table, put)).statusCode === 400, null);
for (let i = 0; i < 30; i++) await serveTape('c15r', tape(1787560001000 + i * 1000), table, put);
const shelf = (await table.all('PLAYER#c15r')).tapes;
check('the shelf prunes oldest past 24', shelf.length === 24 && !shelf.some((t) => t.id === '1787560000000'), shelf.length);
const st = await serveState('GET', 'c15r', undefined, table);
const sj = JSON.parse(st.body);
check('/state lists the shelf newest-first', Array.isArray(sj.tapes) && sj.tapes.length === 24
  && sj.tapes[0].at >= sj.tapes[23].at, sj.tapes?.length);
console.log(bad ? `${bad} FAILED` : 'all good');
process.exit(bad ? 1 : 0);
