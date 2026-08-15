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
 * The DATA has to hold together on its own. It is hand-edited JSON that nobody
 * compiles: a missing `lat`, a heading in the wrong units, or a mission whose
 * id does not match the `&m=` link that carries it are all errors that appear
 * only when a player opens the menu or follows a shared link. They are cheap
 * to catch here and expensive to catch there.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
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
const res = await call('/~/campaign/1');
check('current version served', res.statusCode === 200, res.statusCode);
check('gzipped like every other object in the namespace',
  res.headers['content-encoding'] === 'gzip', res.headers);
check('immutable — the version IS the cache key',
  /immutable/.test(res.headers['cache-control'] ?? ''), res.headers);
const served = JSON.parse(gunzipSync(Buffer.from(res.body, 'base64')).toString());
check('carries the drives', Array.isArray(served.drives) && served.drives.length > 0, served.drives?.length);

const old = await call('/~/campaign/2');
check('an unknown version is refused, not substituted', old.statusCode === 404, old.statusCode);
check('…and never cached', old.headers['cache-control'] === 'no-store', old.headers);

// The served copy must be the authored file — a build that inlines a stale
// import would pass everything above and ship last week's destinations.
const authored = JSON.parse(readFileSync('cells/drive/campaigns/dakar.json', 'utf8'));
check('served copy matches the file on disk',
  JSON.stringify(served.drives) === JSON.stringify(authored.drives), null);
check('the file declares the version the route serves', authored.v === 1, authored.v);

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

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : `\nall good — ${served.drives.length} drives`);
process.exitCode = bad ? 1 : 0;
