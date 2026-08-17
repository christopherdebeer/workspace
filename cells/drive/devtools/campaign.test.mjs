/**
 * THE CAMPAIGN: what the route serves, and whether the authored data is sane.
 *
 *   node cells/drive/devtools/campaign.test.mjs
 *
 * Two different jobs in one run, because they fail in different ways.
 *
 * The ROUTE has to serve the current version and refuse any other — those
 * objects are immutable at the edge, so a version the client asks for and the
 * server does not recognise must 404 `no-store` rather than be answered with
 * something else. A silently-wrong campaign is a menu full of the wrong
 * places.
 *
 * The DATA has to hold together on its own. The module's types catch a missing
 * field; they cannot catch a heading of 900, a coordinate at null island, two
 * drives with one name, or a mission whose `via` count no road could satisfy.
 * Those appear only when a player opens the menu or follows a shared link, and
 * they are cheap to catch here and expensive to catch there.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'campaign-'));
const out = join(dir, 'index.cjs');
execSync(`npx esbuild cells/drive/index.ts --bundle --platform=node --format=cjs --external:@aws-sdk/* --outfile=${out}`,
  { stdio: 'pipe', cwd: process.cwd() });
const { handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const call = (p) => handler({ rawPath: p, requestContext: { http: { method: 'GET' } } });

// ── the route ──
const res = await call('/~/campaign/5');
check('current version served', res.statusCode === 200, res.statusCode);
check('gzipped like every other object in the namespace',
  res.headers['content-encoding'] === 'gzip', res.headers);
check('immutable — the version IS the cache key',
  /immutable/.test(res.headers['cache-control'] ?? ''), res.headers);
const served = JSON.parse(gunzipSync(Buffer.from(res.body, 'base64')).toString());
check('carries the drives', Array.isArray(served.drives) && served.drives.length > 0, served.drives?.length);

const old = await call('/~/campaign/9');
check('an unknown version is refused, not substituted', old.statusCode === 404, old.statusCode);
check('…and never cached', old.headers['cache-control'] === 'no-store', old.headers);

// The served copy must be the AUTHORED module — a build that inlined a stale
// import would pass everything above and ship last week's destinations. Built
// separately from the handler so the two cannot share a mistake.
const campOut = join(dir, 'campaign.cjs');
execSync(`npx esbuild cells/drive/campaigns/dakar.ts --bundle --platform=node --format=cjs --outfile=${campOut}`,
  { stdio: 'pipe', cwd: process.cwd() });
const { CAMPAIGN: authored } = await import(campOut);
check('served copy matches the file on disk',
  JSON.stringify(served.drives) === JSON.stringify(authored.drives), null);
check('the file declares the version the route serves', authored.v === 5, authored.v);

// ── the authored data ──
const seen = new Set();
for (const d of served.drives) {
  const where = d.name ?? '(unnamed)';
  check(`${where}: has a name and a subtitle`,
    typeof d.name === 'string' && d.name.length > 0 && typeof d.sub === 'string' && d.sub.length > 0, d);
  check(`${where}: coordinates are on Earth`,
    Number.isFinite(d.lat) && Math.abs(d.lat) <= 90 && Number.isFinite(d.lon) && Math.abs(d.lon) <= 180
    && !(d.lat === 0 && d.lon === 0), [d.lat, d.lon]);
  check(`${where}: heading is a compass bearing`,
    Number.isFinite(d.h) && d.h >= 0 && d.h < 360, d.h);
  check(`${where}: appears once`, !seen.has(d.name), d.name);
  seen.add(d.name);
  if (!d.mission) continue;
  const m = d.mission;
  check(`${where}: mission carries the id its &m= link uses`,
    typeof m.id === 'string' && /^[a-z0-9-]+$/.test(m.id), m.id);
  for (const [what, pt] of [['giver', m.giver], ['dest', m.dest]]) {
    check(`${where}: mission ${what} is a real place`,
      !!pt && typeof pt.name === 'string' && Number.isFinite(pt.lat) && Number.isFinite(pt.lon), pt);
  }
  check(`${where}: arrival radius is sane`, Number.isFinite(m.within) && m.within > 0 && m.within < 5000, m.within);
  // The route the job insists on: a count, and it must be reachable. `atLeast`
  // higher than the checkpoints a road actually has is a job nobody can finish.
  if (m.via) {
    check(`${where}: via names a road and a reachable count`,
      typeof m.via.name === 'string' && m.via.name.length > 0
      && (m.via.atLeast === undefined || (Number.isInteger(m.via.atLeast) && m.via.atLeast > 0 && m.via.atLeast <= 100)),
      m.via);
  }
}

// ── the stations ──
// Each is a real feature renamed, so the same sanity that guards a drive
// guards a station — and ids are what the marks store and the sync key on,
// so they must be unique and url-safe forever.
const stIds = new Set();
for (const st of served.stations ?? []) {
  const where = st.id ?? '(no id)';
  check(`station ${where}: id is terse and url-safe`, /^[a-z0-9-]+$/.test(st.id ?? ''), st.id);
  check(`station ${where}: named, with a place line`,
    typeof st.name === 'string' && st.name.length > 0 && typeof st.sub === 'string' && st.sub.length > 0, st);
  check(`station ${where}: coordinates are on Earth`,
    Number.isFinite(st.lat) && Math.abs(st.lat) <= 90 && Number.isFinite(st.lon) && Math.abs(st.lon) <= 180
    && !(st.lat === 0 && st.lon === 0), [st.lat, st.lon]);
  check(`station ${where}: appears once`, !stIds.has(st.id), st.id);
  stIds.add(st.id);
  check(`station ${where}: carries its real-world provenance`,
    typeof st.osm === 'string' && st.osm.length > 10, st.osm);
}
check('the campaign carries stations at all', (served.stations ?? []).length >= 3, served.stations?.length);
// The liveries: paint is the only place the factions exist, so a station
// naming an operator that is not in the tin is a box painted with nothing.
for (const st of served.stations ?? []) {
  if (st.op === undefined) continue;
  check(`station ${st.id}: its operator is in the tin`, !!served.ops?.[st.op], st.op);
}
for (const [k, op] of Object.entries(served.ops ?? {})) {
  check(`op ${k}: has a mark, a name and a paint colour`,
    typeof op.mark === 'string' && op.mark.length >= 2 && op.mark.length <= 4
    && typeof op.name === 'string' && /^#[0-9a-f]{6}$/i.test(op.color ?? ''), op);
  if (op.ghost) {
    check(`op ${k}: its ghost is another operator's mark`,
      Object.values(served.ops).some((o) => o.mark === op.ghost), op.ghost);
  }
}

// ── the line ──
// The campaign's spine: a start, legs in order, and the covers. The legs are
// missions, so the mission sanity above applies; here is what is new.
check('the line has a start, at the aperture',
  !!served.start && Number.isFinite(served.start.lat) && Number.isFinite(served.start.h), served.start);
check('…and legs, in order, each a mission with an id the marks can latch',
  Array.isArray(served.legs) && served.legs.length >= 2
  && served.legs.every((l) => /^[a-z0-9-]+$/.test(l.id ?? '')), served.legs?.map((l) => l.id));
check('leg 1 begins at the start',
  Math.hypot((served.legs[0].giver.lat - served.start.lat), (served.legs[0].giver.lon - served.start.lon)) < 0.01,
  { giver: served.legs[0].giver, start: served.start });
check("each leg's giver is the previous leg's destination — a LINE, not a scatter",
  served.legs.slice(1).every((l, i) =>
    Math.hypot(l.giver.lat - served.legs[i].dest.lat, l.giver.lon - served.legs[i].dest.lon) < 0.01),
  served.legs.map((l) => [l.giver.name, l.dest.name]));
check('every leg destination is a station on the line',
  served.legs.every((l) => served.stations.some((st) =>
    Math.hypot(st.lat - l.dest.lat, st.lon - l.dest.lon) < 0.005)), null);
for (const c of served.covers ?? []) {
  check(`cover ${c.id}: on Earth with a sane radius`,
    Number.isFinite(c.lat) && Number.isFinite(c.lon) && c.r > 1000 && c.r < 30000, c);
}
check('the covers exist', (served.covers ?? []).length >= 2, served.covers?.length);
// The aperture must stand OUTSIDE its own Cover — spawning inside the shell
// would be spawning somewhere the game refuses to build.
{
  const paris = (served.covers ?? []).find((c) => c.id === 'paris');
  const dLat = (served.start.lat - paris.lat) * 111320;
  const dLon = (served.start.lon - paris.lon) * 111320 * Math.cos(paris.lat * Math.PI / 180);
  const d = Math.hypot(dLat, dLon);
  check('the aperture stands at the Cover\'s foot, outside the shell',
    d > paris.r && d < paris.r + 2500, { d: Math.round(d), r: paris.r });
}

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : `\nall good — ${served.drives.length} drives`);
process.exitCode = bad ? 1 : 0;
