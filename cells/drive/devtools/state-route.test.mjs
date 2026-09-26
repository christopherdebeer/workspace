/**
 * THE DURABLE COPY — the route, with a table it can't lose anything in.
 *
 *   node cells/drive/devtools/state-route.test.mjs
 *
 * `/state` is the only route in this cell that is about a PERSON, which makes
 * it the only one where a bug costs someone something they cannot get back by
 * driving again. Three things have to hold:
 *
 *   WHO. Identity is `x-cell-caller`, set by dispatch from a validated bearer
 *   this cell never sees. Anonymous is turned away, and one player must never
 *   be able to read or write another's rows — the key is derived from the
 *   caller, so the test proves the derivation rather than trusting it.
 *
 *   MERGE. Union and max, in both directions, because progress is monotonic.
 *   Last-writer-wins would silently delete a second device's work; that is the
 *   failure this route exists to make impossible, so it is tested from both
 *   sides — a device that is behind must not be able to push the world back.
 *
 *   SHAPE. Counts and claims only. A push carrying crumbs, junk, or thousands
 *   of roads must not be able to put any of it in the table.
 *
 * The table is a Map. DynamoDB is not what is under test here; the arithmetic
 * is, and it runs in milliseconds against a store whose contents are visible.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'state-'));
const out = join(dir, 'index.cjs');
// TABLE_NAME is what the route checks to decide it has anywhere to write; the
// real one is provisioned per cell (services/cells/cell-template.ts).
process.env.TABLE_NAME = 'drive-test';
execSync(`npx esbuild cells/drive/index.ts --bundle --platform=node --format=cjs --external:@aws-sdk/* --outfile=${out}`,
  { stdio: 'pipe', cwd: process.cwd() });
const { serveState, handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** The cell's own table, as Maps keyed exactly as DynamoDB would be. */
function fakeTable(seed = {}) {
  const rows = new Map(Object.entries(seed));      // "<pk>|<roadId>" → {g,t,c}
  const marks = new Map();                          // "<pk>|<kind>|<id>" → at
  const prof = new Map();
  return {
    rows, marks, prof, writes: 0,
    async all(pk) {
      const out = { roads: {}, marks: { m: {}, s: {} }, odo: prof.get(pk)?.odo ?? 0, spots: {} };
      for (const [k, v] of this.spots) if (k.startsWith(pk + '|')) out.spots[k.slice(pk.length + 1)] = v;
      for (const [k, v] of rows) if (k.startsWith(pk + '|')) out.roads[k.slice(pk.length + 1)] = v;
      for (const [k, v] of marks) {
        if (!k.startsWith(pk + '|')) continue;
        const [, kind, id] = k.split('|');
        out.marks[kind][id] = v;
      }
      return out;
    },
    async putRoads(pk, r) {
      this.writes += Object.keys(r).length;
      for (const [id, v] of Object.entries(r)) rows.set(`${pk}|${id}`, v);
    },
    async putMarks(pk, kind, r) {
      this.writes += Object.keys(r).length;
      for (const [id, at] of Object.entries(r)) marks.set(`${pk}|${kind}|${id}`, at);
    },
    async delRows(pk, sks) {
      this.writes += sks.length;
      for (const sk of sks) {
        if (sk.startsWith('MISSION#')) marks.delete(`${pk}|m|${sk.slice('MISSION#'.length)}`);
        else if (sk.startsWith('STATION#')) marks.delete(`${pk}|s|${sk.slice('STATION#'.length)}`);
      }
    },
    async setProfile(pk, p) { prof.set(pk, p); },
    spots: new Map(),
    async putSpots(pk, r) {
      this.writes += Object.keys(r).length;
      for (const [id, v] of Object.entries(r)) this.spots.set(`${pk}|${id}`, v);
    },
  };
}
const call = async (method, caller, body, table) => {
  const res = await serveState(method, caller, body === undefined ? undefined : JSON.stringify(body), table);
  return { status: res.statusCode, headers: res.headers, body: JSON.parse(res.body) };
};

// ── who ────────────────────────────────────────────────────────────────
{
  const t = fakeTable();
  const anon = await call('GET', 'anonymous', undefined, t);
  check('anonymous is turned away', anon.status === 401, anon);
  check('…and told what to do about it', /sign in/i.test(anon.body.error ?? ''), anon.body);
  const none = await call('POST', '', { roads: { 'X@0,0': { g: 1, t: 1 } } }, t);
  check('so is a caller with no name at all', none.status === 401, none.status);
  check('…and neither wrote anything', t.rows.size === 0, [...t.rows.keys()]);

  const mine = await call('POST', 'c15r', { roads: { 'Main Street@-34,18': { g: 3, t: 6 } } }, t);
  check('a named caller is served', mine.status === 200 && mine.body.user === 'c15r', mine.body);
  const theirs = await call('GET', 'someone-else', undefined, t);
  check('…and another player sees none of it', Object.keys(theirs.body.roads).length === 0, theirs.body);
  check('the rows are keyed by the CALLER, not by anything they sent',
    [...t.rows.keys()].every((k) => k.startsWith('PLAYER#c15r|')), [...t.rows.keys()]);
  // Nothing about a player's progress belongs in a cache.
  check('never cached', mine.headers['cache-control'] === 'no-store', mine.headers);
}

// ── merge ──────────────────────────────────────────────────────────────
{
  const t = fakeTable({
    'PLAYER#c15r|Ou Kaapse Weg@-34,18': { g: 40, t: 40, c: 1700000000000 },
    'PLAYER#c15r|Rhodes Drive@-34,18': { g: 9, t: 20 },
  });
  // A device that has been offline for a week and knows LESS. It must not be
  // able to undo anything — this is the case last-writer-wins gets wrong.
  const behind = await call('POST', 'c15r', { roads: {
    'Ou Kaapse Weg@-34,18': { g: 2, t: 40 },
    'Rhodes Drive@-34,18': { g: 3, t: 20 },
  } }, t);
  check('a device that is behind cannot push the world back',
    behind.body.roads['Ou Kaapse Weg@-34,18'].g === 40
    && behind.body.roads['Rhodes Drive@-34,18'].g === 9, behind.body.roads);
  check('…and a claim it never saw survives',
    behind.body.roads['Ou Kaapse Weg@-34,18'].c === 1700000000000, behind.body.roads);
  check('…and nothing was written for a push that changed nothing', t.writes === 0, t.writes);

  // …and the same device, now ahead.
  const ahead = await call('POST', 'c15r', { roads: {
    'Rhodes Drive@-34,18': { g: 14, t: 26, c: 1800000000000 },
  } }, t);
  check('progress goes up', ahead.body.roads['Rhodes Drive@-34,18'].g === 14, ahead.body.roads);
  check('…and so does the length of a road that turned out longer',
    ahead.body.roads['Rhodes Drive@-34,18'].t === 26, ahead.body.roads);
  check('…and a new claim lands', ahead.body.roads['Rhodes Drive@-34,18'].c === 1800000000000, ahead.body.roads);

  // A claim is latched; the interesting question is WHEN, and the truth is the
  // first time it happened — which may arrive second.
  const earlier = await call('POST', 'c15r', { roads: {
    'Rhodes Drive@-34,18': { g: 14, t: 26, c: 1750000000000 },
  } }, t);
  check('an earlier claim time wins — that is when it actually happened',
    earlier.body.roads['Rhodes Drive@-34,18'].c === 1750000000000, earlier.body.roads);

  // One round trip does both halves: the push goes up, the whole comes back.
  check('a push answers with everything, not just what it sent',
    Object.keys(earlier.body.roads).length === 2, Object.keys(earlier.body.roads));

  // The odometer is the other monotonic number.
  await call('POST', 'c15r', { roads: {}, odo: 1551000 }, t);
  const back = await call('POST', 'c15r', { roads: {}, odo: 12 }, t);
  check('the odometer never goes backwards', back.body.odo === 1551000, back.body.odo);
}

// ── shape ──────────────────────────────────────────────────────────────
{
  const t = fakeTable();
  await call('POST', 'c15r', { roads: {
    'Good Road@-34,18': { g: 2, t: 4, c: 1700000000000, k: ['a', 'b'], junk: 'x' },
  } }, t);
  const row = t.rows.get('PLAYER#c15r|Good Road@-34,18');
  check('crumbs sent by a client are not stored — this mirrors claims, not crumbs',
    row && row.k === undefined && row.junk === undefined, row);
  check('…and what IS stored is the count and the claim',
    row.g === 2 && row.t === 4 && row.c === 1700000000000, row);

  const junk = await call('POST', 'c15r', { roads: {
    '': { g: 5, t: 5 },
    ['x'.repeat(400)]: { g: 5, t: 5 },
    'Neg@-34,18': { g: -3, t: 'nonsense', c: 'soon' },
  } }, t);
  check('an empty id is refused', !junk.body.roads[''], Object.keys(junk.body.roads));
  check('…so is an absurdly long one',
    !Object.keys(junk.body.roads).some((k) => k.length > 300), Object.keys(junk.body.roads).map((k) => k.length));
  check('…and nonsense numbers land as zero rather than as NaN',
    junk.body.roads['Neg@-34,18'].g === 0 && junk.body.roads['Neg@-34,18'].t === 0,
    junk.body.roads['Neg@-34,18']);

  const broken = await serveState('POST', 'c15r', '{not json', t);
  check('an unreadable body is a 400, not a crash', broken.statusCode === 400, broken);
  // …while an EMPTY one is a pure pull, which is how a fresh device asks for
  // everything it has never seen.
  const pull = await call('POST', 'c15r', undefined, t);
  check('an empty push is just a pull', pull.status === 200 && !!pull.body.roads, pull.status);
}

// ── marks: a mission completed, a station woken ────────────────────────
// The row IS the moment, latched, and the EARLIEST moment wins — a second
// device reporting the same completion later must not move it.
{
  const t = fakeTable();
  const first = await call('POST', 'c15r', {
    missions: { 'chapmans-run': 1700000000000 },
    stations: { 'ST-01': 1700000100000, 'ST-02': 1700000200000 },
  }, t);
  check('missions and stations land as marks',
    first.body.missions['chapmans-run'] === 1700000000000
    && Object.keys(first.body.stations).length === 2, first.body);
  check('…in their reserved rows', t.marks.has('PLAYER#c15r|m|chapmans-run')
    && t.marks.has('PLAYER#c15r|s|ST-01'), [...t.marks.keys()]);

  const later = await call('POST', 'c15r', { missions: { 'chapmans-run': 1900000000000 } }, t);
  check('a later report of the same completion changes nothing',
    later.body.missions['chapmans-run'] === 1700000000000 && later.body.wrote === 0, later.body);
  const earlier = await call('POST', 'c15r', { missions: { 'chapmans-run': 1600000000000 } }, t);
  check('…and an earlier one wins — that is when it first happened',
    earlier.body.missions['chapmans-run'] === 1600000000000, earlier.body.missions);

  const junk = await call('POST', 'c15r', {
    stations: { '': 5, ['x'.repeat(300)]: 5, 'ST-03': 'soon', 'ST-04': -2 },
  }, t);
  check('junk marks cannot latch',
    Object.keys(junk.body.stations).length === 2, junk.body.stations);

  const theirs = await call('GET', 'someone-else', undefined, t);
  check('another player sees no marks either',
    Object.keys(theirs.body.missions).length === 0 && Object.keys(theirs.body.stations).length === 0,
    theirs.body);
  // …and a pull carries them, which is how a second device learns a leg is done.
  const pull = await call('GET', 'c15r', undefined, t);
  check('a plain GET returns the marks with the roads',
    pull.body.missions['chapmans-run'] === 1600000000000 && !!pull.body.stations['ST-01'], pull.body);
}

// ── the campaign reset ─────────────────────────────────────────────────
// A latched mark cannot be un-latched by the merge — that is the design — so
// handing the docket back is an explicit DELETE. It takes the marks, all of
// them, for THIS caller only, and it must not touch the career: roads,
// claims and the odometer are not the campaign's to take.
{
  const t = fakeTable();
  await call('POST', 'c15r', {
    roads: { 'D 920@48,2': { g: 9, t: 12, c: 1600000000000 } },
    missions: { 'line-01': 1600000000001 },
    stations: { 'pd-01': 1600000000002, 'pd-02': 1600000000003 },
    odo: 4200,
  }, t);
  await call('POST', 'someone-else', { stations: { 'pd-01': 1600000000009 } }, t);

  const wiped = await call('DELETE', 'c15r', undefined, t);
  check('DELETE wipes the caller\'s marks and says how many', wiped.status === 200 && wiped.body.reset === 3, wiped.body);
  check('…the response already shows a clean docket',
    Object.keys(wiped.body.missions).length === 0 && Object.keys(wiped.body.stations).length === 0, wiped.body);
  check('…while the career survives: roads, claim and odometer',
    wiped.body.roads['D 920@48,2']?.c === 1600000000000 && wiped.body.odo === 4200, wiped.body);

  const after = await call('GET', 'c15r', undefined, t);
  check('the wipe is real — a fresh GET finds no marks',
    Object.keys(after.body.missions).length === 0 && Object.keys(after.body.stations).length === 0, after.body);
  const theirs = await call('GET', 'someone-else', undefined, t);
  check('…and another player\'s marks were not the caller\'s to take',
    theirs.body.stations['pd-01'] === 1600000000009, theirs.body);

  const anon = await call('DELETE', 'anonymous', undefined, t);
  check('anonymous cannot reset anyone', anon.status === 401, anon.status);
}

// ── saved spots: a union keyed by place, saved-at vs deleted-at ─────────
{
  const t = fakeTable();
  const senqu = { at: 1000, gone: 0, name: 'SENQU', sub: 'LESOTHO', lat: -30.70679, lon: 27.751, h: 339 };
  const fife = { at: 1100, gone: 0, name: 'FIFE', sub: 'SCOTLAND', lat: 56.2, lon: -3.1, h: 0 };
  await call('POST', 'c15r', { spots: { '-30.7068,27.7510': senqu, '56.2000,-3.1000': fife } }, t);
  // A wiped device sends nothing and gets both back.
  const back = await call('POST', 'c15r', {}, t);
  check('spots come back to a wiped device', back.body.spots['-30.7068,27.7510']?.name === 'SENQU'
    && back.body.spots['56.2000,-3.1000']?.at === 1100, back.body.spots);
  // Deleted on one device…
  await call('POST', 'c15r', { spots: { '56.2000,-3.1000': { ...fife, gone: 1200 } } }, t);
  // …and another device that still has it (saved at 1100) cannot resurrect it.
  const stale = await call('POST', 'c15r', { spots: { '56.2000,-3.1000': fife } }, t);
  const f = stale.body.spots['56.2000,-3.1000'];
  check('a delete survives a device that still holds the spot', f.gone === 1200 && f.at === 1100, f);
  // Saving it again later brings it back.
  const again = await call('POST', 'c15r', { spots: { '56.2000,-3.1000': { ...fife, at: 1300 } } }, t);
  const g = again.body.spots['56.2000,-3.1000'];
  check('…and saving it again later revives it', g.at === 1300 && g.gone === 1200, g);
  const theirs = await call('GET', 'someone-else', undefined, t);
  check('another player sees none of them', Object.keys(theirs.body.spots).length === 0, theirs.body.spots);
  const junk = await call('POST', 'c15r', { spots: { 'x': { lat: 999, lon: 0, at: 5 }, ['y'.repeat(99)]: senqu } }, t);
  check('junk spots are refused', !junk.body.spots.x && !junk.body.spots['y'.repeat(99)], Object.keys(junk.body.spots));
}

// ── through the handler, the way dispatch calls it ─────────────────────
{
  const res = await handler({
    rawPath: '/state', requestContext: { http: { method: 'GET' } },
    headers: { 'x-cell-caller': 'anonymous' },
  });
  check('the route is wired, and reads the caller header', res.statusCode === 401, res.statusCode);
  const put = await handler({
    rawPath: '/state', requestContext: { http: { method: 'PUT' } }, headers: { 'x-cell-caller': 'c15r' },
  });
  check('PUT is not a thing here', put.statusCode === 405, put.statusCode);
  // The read-only gate for every OTHER route still holds — /state is the one
  // surface in this cell that takes a write, and it must not have opened others.
  const post = await handler({
    rawPath: '/~/campaign/1', requestContext: { http: { method: 'POST' } }, headers: {},
  });
  check('…and the rest of the cell is still read-only', post.statusCode === 405, post.statusCode);
}

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;
