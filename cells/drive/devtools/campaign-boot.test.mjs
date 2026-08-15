/**
 * THE CAMPAIGN, THROUGH A REAL BOOT.
 *
 *   node cells/drive/devtools/campaign-boot.test.mjs
 *
 * `campaign.test.mjs` checks what the route serves. This checks what the GAME
 * does with it, which is a different set of failures:
 *
 *   1. the menu fills from the fetched list rather than a compiled-in one;
 *   2. a shared `&m=` link still finds its job — the mission now lives in the
 *      campaign, so the fetch has to have landed before the spawn asks for it;
 *   3. and a COLD NAMESPACE does not empty the menu. The destination list is
 *      the way into the whole game; losing it to one failed request would be a
 *      worse bug than the one that moving it out of the bundle solved. The
 *      last good copy is mirrored to localStorage, so the second half of this
 *      run kills the route and expects the list to still be there.
 *
 * The campaign is served by the cell's OWN handler, bundled here — the
 * harness's local server 404s every `~/` route.
 */
import { openDrive, report } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cboot-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe' });
const { handler } = await import(out);

const LINK = 'lat=-34.08716&lon=18.42083&h=290&cam=chase&m=chapmans-run&wx=clear';
const d = await openDrive({ spot: LINK, tag: 'cboot' });
let live = true, served = 0;
await d.page.route(/\/~\/campaign\//, async (route) => {
  if (!live) return route.fulfill({ status: 503, body: '{}', contentType: 'application/json' });
  const v = new URL(route.request().url()).pathname.split('/').pop();
  const r = await handler({ rawPath: `/~/campaign/${v}`, requestContext: { http: { method: 'GET' } } });
  if (r.statusCode !== 200) return route.fulfill({ status: r.statusCode, body: '{}', contentType: 'application/json' });
  served++;
  return route.fulfill({ status: 200, body: gunzipSync(Buffer.from(r.body, 'base64')).toString(), contentType: 'application/json' });
});

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** Open the shared link the way a player would. NOT reload(): the first boot
 *  ran before the route existed, found no mission, and `writeUrl` correctly
 *  dropped `&m=` from the address — reloading would test a link that no longer
 *  carries the job. */
const base = new URL(d.page.url()).origin;
async function boot() {
  await d.page.goto(`${base}/?${LINK}`, { waitUntil: 'load' });
  await d.page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'),
    null, { timeout: 200000 });
  await d.page.waitForTimeout(2500);
  return d.page.evaluate(() => ({
    drives: window.__drives(),
    mission: window.__mission(),
  }));
}

const hot = await boot();
check('the campaign was fetched, not compiled in', served > 0, served);
check('the menu has its destinations', hot.drives.length >= 10, hot.drives.length);
check('a shared &m= link finds its job in the fetched campaign',
  hot.mission.id === 'chapmans-run' && hot.mission.phase === 'offered', hot.mission);
console.log(`        ${hot.drives.length} drives, first: ${hot.drives.slice(0, 3).map((x) => x.name).join(', ')}`);

// …and now the namespace goes cold.
live = false;
const cold = await boot();
check('a dead namespace does not empty the menu',
  cold.drives.length === hot.drives.length, { cold: cold.drives.length, hot: hot.drives.length });
check('…and the job on a shared link still arms from the copy',
  cold.mission.id === 'chapmans-run', cold.mission);

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
