/**
 * WHO DOES THIS GAME TALK TO, AND WHICH OF THEM SHOULD IT NOT BE TALKING TO?
 *
 *   node devtools/api-audit.mjs [--spot='lat=…&lon=…'] [--drive=<sim seconds>]
 *                              [--json=<path>] [--nodraw]
 *
 * The cell keeps an S3 read-through cache in front of every upstream it has a
 * `~/` route for: CloudFront looks in the public namespace first and falls
 * through to the Lambda only on a miss, which then banks what it computed
 * (`putTile` in index.ts). A client fetch that goes STRAIGHT to a third party
 * skips all of that — it is uncached, unbanked, rate-limited by somebody
 * else's volunteer infrastructure, and it is a host that has to stay in the
 * page's `connect-src` forever.
 *
 * This enumerates both kinds from a real boot. Every off-origin request goes
 * through the harness's curl relay and every same-origin one through its local
 * server, so `page.on('request')` sees all of them, whoever issued them —
 * fetch, an <img>, a texture loader, a worker, a script tag.
 *
 * WHAT IT CANNOT TELL YOU, and the harness header says why at length: whether
 * a host is REACHABLE from a phone. The relay bypasses CSP, so a host the
 * policy forbids is answered here anyway. This measures WHAT IS ASKED FOR, and
 * that is the question the cache audit needs.
 *
 * `--spot='random=1'` exercises `findSpawn`'s direct Overpass probe, and is
 * the one flaky invocation: a bad draw lands somewhere with nothing near it
 * and four 45s mirror probes outrun the boot timeout. Re-run it, or pass a
 * fixed remote lat/lon, which is reproducible.
 *
 * The `known` table below is the audit's opinion, checked against the code. A
 * host that turns up and is not in it prints as UNCLASSIFIED, which is the
 * point: a new upstream added to the client shows up here as a line nobody
 * wrote.
 */
import { openDrive, report } from './harness.mjs';
import { writeFileSync } from 'node:fs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const has = (k) => process.argv.includes(`--${k}`);

/**
 * Every third-party host the client is known to reach, and the verdict.
 *
 * `route` names the cell route that ALREADY fronts this data with the S3
 * read-through cache; `null` means there is none and a direct hit is the only
 * way the client can get it today.
 */
const KNOWN = [
  ['overpass-api.de',            { what: 'OSM vectors', route: '~/osm/v4/', verdict: 'FALLBACK' }],
  ['overpass.kumi.systems',      { what: 'OSM vectors', route: '~/osm/v4/', verdict: 'FALLBACK' }],
  ['overpass.osm.jp',            { what: 'OSM vectors', route: '~/osm/v4/', verdict: 'FALLBACK' }],
  ['overpass.private.coffee',    { what: 'OSM vectors', route: '~/osm/v4/', verdict: 'FALLBACK' }],
  ['tiles.mapterhorn.com',       { what: 'DEM (terrarium webp)', route: null, verdict: 'UNCACHED' }],
  ['s3.amazonaws.com',           { what: 'DEM (terrarium png, legacy AWS)', route: null, verdict: 'UNCACHED' }],
  ['nominatim.openstreetmap.org', { what: 'reverse geocode', route: null, verdict: 'UNCACHED' }],
  ['api.open-meteo.com',         { what: 'live weather', route: null, verdict: 'UNCACHED' }],
  ['esm.sh',                     { what: 'three.js / ez-tree modules', route: null, verdict: 'CODE' }],
  ['cdn.jsdelivr.net',           { what: 'eruda console, on demand', route: null, verdict: 'CODE' }],
  ['c15r-drive.on.parc.land',    { what: 'the cell itself (harness proxy)', route: '-', verdict: 'CELL' }],
  ['parc.land',                  { what: 'substrate apex — auth and sync', route: '-', verdict: 'CELL' }],
];
const classify = (host) => {
  for (const [h, v] of KNOWN) if (host === h || host.endsWith(`.${h}`)) return v;
  return { what: '?', route: null, verdict: 'UNCLASSIFIED' };
};
/**
 * THE SPAWN PROBE IS NOT THE TILE FALLBACK, and reporting them as one number
 * blames the cell route for traffic it was never asked to carry. `findSpawn`
 * (?random=1) asks Overpass directly, by design and with no cell route behind
 * it, for "does this random coordinate have roads near it" — `around:2500` and
 * `out ids`. Every OTHER direct Overpass POST is a `~/osm/v4/` tile the proxy
 * failed to answer, which IS the cache missing.
 */
const isSpawnProbe = (post) => !!post && /around:2500/.test(post) && /out ids/.test(post);

const spot = arg('spot', 'lat=-33.9249&lon=18.4241&h=0&cam=chase');
const drive = Number(arg('drive', 0));
const tag = 'api-audit';

const reqs = [];
const t0 = Date.now();
const d = await openDrive({
  spot: has('nodraw') ? `${spot}&nodraw=1` : spot,
  tag,
  bootTimeout: 180000,
  // BEFORE THE FIRST LOAD. Attached after openDrive returns, this would miss
  // every request the boot made, which is most of them.
  route: (page) => {
    page.on('request', (r) => reqs.push({
      url: r.url(), method: r.method(), at: Date.now() - t0,
      // The Overpass query itself, because WHICH direct Overpass call this is
      // decides whether it is a defect. See SPAWN below.
      post: r.postData()?.slice(0, 400) ?? null,
    }));
    // A REQUEST THAT NEVER GOT A RESPONSE IS NOT A REQUEST THAT DID NOTHING.
    // `proxyTile` aborts at TILE_WAIT_MS = 9s, which is what a COLD cell route
    // looks like from here — the tile is re-queued by a later pass (there is
    // deliberately no catch there), so these rows are the cache filling in the
    // background rather than the client failing over. Counted because
    // otherwise a cold region reads as a quiet run.
    page.on('requestfailed', (r) => {
      const rec = reqs.find((q) => q.url === r.url() && q.status === undefined && q.failed === undefined);
      if (rec) rec.failed = r.failure()?.errorText ?? 'failed';
    });
    // BYTES, AND NEITHER THE HEADER NOR THE BODY IS ENOUGH ON ITS OWN. The
    // harness's local server ends its responses without a content-length, so a
    // header-only reading put every cell route at 0.0k and made the cached
    // half of the audit look free. `response.body()` does not rescue it — on
    // those same chunked local responses it resolves to an EMPTY buffer, which
    // is the identical wrong number arrived at a second way (measured: a 3384
    // byte cover tile, `body()` 0). `request.sizes().responseBodySize` reports
    // it correctly; the header stays first because it is already in hand.
    page.on('response', async (r) => {
      const rec = reqs.find((q) => q.url === r.url() && q.bytes === undefined);
      if (!rec) return;
      rec.status = r.status();
      const len = Number(r.headers()['content-length'] ?? 0);
      if (len) { rec.bytes = len; return; }
      try { rec.bytes = (await r.request().sizes()).responseBodySize; } catch { rec.bytes = 0; }
    });
  },
});
console.log(`BOOTED in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${reqs.length} requests`);
if (drive > 0) {
  const before = reqs.length;
  await d.simWait(drive);
  console.log(`DROVE ${drive} sim seconds — ${reqs.length - before} further requests`);
}

// ── the roll-up ──
const rows = new Map();
for (const r of reqs) {
  let host;
  try { host = new URL(r.url).host; } catch { continue; }
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
  // The local server IS the cell in this rig, so a same-origin request is
  // reported as the cell route it would hit in production.
  const path = new URL(r.url).pathname;
  const key = local
    ? (path.startsWith('/~/') ? `cell ${path.split('/').slice(0, 4).join('/')}/` : `cell ${path}`)
    : host;
  const kind = !local && /overpass/.test(host) && isSpawnProbe(r.post) ? `${host} (spawn probe)` : key;
  const row = rows.get(kind) ?? { key: kind, host: local ? null : host, spawn: kind !== key, n: 0, bytes: 0, bad: 0, dead: 0 };
  row.n++;
  row.bytes += r.bytes ?? 0;
  if (r.status && r.status >= 400) row.bad++;
  if (r.failed) row.dead++;
  rows.set(kind, row);
}
const all = [...rows.values()].sort((a, b) => b.n - a.n);
const cell = all.filter((r) => !r.host);
const third = all.filter((r) => r.host).map((r) => ({
  ...r,
  ...classify(r.host),
  ...(r.spawn ? { what: 'random-spawn road probe', route: null, verdict: 'BY DESIGN' } : {}),
}));

const pad = (s, n) => String(s).padEnd(n);
const kb = (b) => (b / 1024).toFixed(1) + 'k';
console.log('\n── THROUGH THE CELL (S3 read-through in front of each ~/ route) ──');
for (const r of cell) {
  console.log(`  ${pad(r.key, 30)} ${pad(r.n, 5)} ${pad(kb(r.bytes), 9)}`
    + `${r.bad ? ` ${r.bad} 4xx/5xx` : ''}${r.dead ? ` ${r.dead} unanswered at 9s (cold; re-queued)` : ''}`);
}
console.log('\n── STRAIGHT TO A THIRD PARTY ──');
for (const r of third) {
  console.log(`  ${pad(r.verdict, 13)} ${pad(r.key, 32)} ${pad(r.n, 5)} ${pad(kb(r.bytes), 9)} ${r.what}`
    + (r.route ? `  → ${r.route}` : ''));
}

// ── WHAT IS THE RIG'S FAULT AND NOT THE GAME'S ──
//
// The local server does not implement every route the deployed cell serves,
// so a 4xx on one of these is an artefact of the harness. Said out loud,
// because a failed row in the cell table otherwise reads as a broken route.
const HARNESS_GAPS = [/^\/~\/campaign\//, /^\/icons\//, /^\/manifest/, /^\/sw\.js$/];
const gaps = cell.filter((r) => r.bad && HARNESS_GAPS.some((re) => re.test(r.key.slice(5))));
if (gaps.length) {
  console.log('\n  (harness gaps, not cell faults: ' + gaps.map((r) => r.key.slice(5)).join(' ') + ')');
}

const uncached = third.filter((r) => r.verdict === 'UNCACHED');
const unknown = third.filter((r) => r.verdict === 'UNCLASSIFIED');
const fellBack = third.filter((r) => r.verdict === 'FALLBACK');
console.log('\n── VERDICT ──');
if (uncached.length) {
  const n = uncached.reduce((s, r) => s + r.n, 0);
  console.log(`  ${n} request(s) to ${uncached.length} host(s) with NO cell route at all — every one of`);
  console.log(`  them is a live third-party hit from every player's device, every session:`);
  for (const r of uncached) console.log(`    ${r.host} — ${r.what} (${r.n})`);
} else console.log('  nothing uncached.');
if (fellBack.length) {
  const dead = cell.reduce((s, r) => s + r.dead, 0);
  console.log(`  ${fellBack.reduce((s, r) => s + r.n, 0)} request(s) took the Overpass MIRROR FALLBACK —`);
  console.log('  the cell route did not answer, so the cache was bypassed for those tiles.');
  if (dead) console.log(`  (${dead} cell request(s) were still cold at proxyTile's 9s bail.)`);
}
if (unknown.length) {
  console.log('  UNCLASSIFIED hosts — a new upstream nobody has audited:');
  for (const r of unknown) console.log(`    ${r.host} (${r.n})`);
}

const out = arg('json', '');
if (out) { writeFileSync(out, JSON.stringify({ spot, drive, reqs, rows: all }, null, 2)); console.log(`\nwrote ${out}`); }
report(d.errors);
await d.close();
