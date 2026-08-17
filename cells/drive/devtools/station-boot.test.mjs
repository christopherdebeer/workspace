/**
 * A STATION, WOKEN — the whole loop, through a real boot.
 *
 *   node cells/drive/devtools/station-boot.test.mjs
 *
 * The campaign's dev station (ct-01, Silvermine admin buildings) sits beside
 * the Chapman's Run spawn precisely so this test exists: spawn, find the
 * structure built on streamed terrain, walk into terminal range, open the
 * terminal, wake the station, and prove the mark SURVIVES A RELOAD — the
 * whole reason marks exist is that a woken station that quietly went back to
 * sleep would be the campaign's worst bug.
 *
 * The campaign is served by the cell's own handler through a route relay —
 * the harness's local server 404s every ~/ route.
 */
import { openDrive, report } from './harness.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'stn-'));
const out = join(dir, 'index.cjs');
execFileSync('npx', ['esbuild', 'cells/drive/index.ts', '--bundle', '--platform=node', '--format=cjs',
  '--external:@aws-sdk/*', `--outfile=${out}`], { stdio: 'pipe' });
const { handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const serveCampaign = async (page) => {
  await page.route(/\/~\/campaign\//, async (route) => {
    const v = new URL(route.request().url()).pathname.split('/').pop();
    const r = await handler({ rawPath: `/~/campaign/${v}`, requestContext: { http: { method: 'GET' } } });
    if (r.statusCode !== 200) return route.fulfill({ status: r.statusCode, body: '{}', contentType: 'application/json' });
    return route.fulfill({ status: 200, body: gunzipSync(Buffer.from(r.body, 'base64')).toString(), contentType: 'application/json' });
  });
};

// The Chapman's Run giver spawn — ct-01 stands ~40m away by construction.
const d = await openDrive({
  spot: 'lat=-34.08716&lon=18.42083&h=290&cam=chase&wx=clear',
  tag: 'station', settle: 12000, route: serveCampaign,
});

// ── the structure ──
const st0 = await d.page.evaluate(() => window.__stations());
const ct = st0.find((s) => s.id === 'ct-01');
check('the campaign delivered the stations', st0.length >= 3, st0);
check('the dev station is beside the spawn', !!ct && ct.d < 120, ct);
check('…and its structure was built on streamed terrain', !!ct?.built, ct);
check('…dormant, like every station a ranger has not reached', !ct?.woken, ct);
check('the far stations exist but did not build',
  st0.filter((s) => s.id !== 'ct-01').every((s) => !s.built && s.d > 100000), st0);

// ── the walk-up ──
// Sub-respawn hops toward the station. The probe gives distance, not
// direction, so each hop is chosen by finite difference — crude, and exactly
// as much navigation as a test deserves.
for (let i = 0; i < 30; i++) {
  const at = await d.page.evaluate(() => window.__stations().find((x) => x.id === 'ct-01'));
  if (at.near) break;
  await d.page.evaluate(() => {
    const s = window.__drive;
    const before = window.__stations().find((x) => x.id === 'ct-01').d;
    const step = Math.max(4, Math.min(before - 6, 22));
    let best = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      s.x += dx * step; s.z += dz * step;
      const moved = window.__stations().find((x) => x.id === 'ct-01').d;
      s.x -= dx * step; s.z -= dz * step;
      if (!best || moved < best.d) best = { dx, dz, d: moved };
    }
    s.x += best.dx * step; s.z += best.dz * step;
  });
  await d.page.waitForTimeout(280);
}
const nearNow = await d.page.evaluate(() => window.__stations().find((x) => x.id === 'ct-01'));
check('walking up puts the station in terminal range', !!nearNow?.near, nearNow);
await d.page.waitForTimeout(600);
check('…and the TERMINAL prompt is on screen', await d.page.evaluate(() =>
  document.querySelector('#ov-term-go')?.style.display !== 'none'
  && /CT-01/.test(document.querySelector('#ov-term-go')?.textContent ?? '')), null);

// ── the terminal ──
await d.page.evaluate(() => document.querySelector('#ov-term-go').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await d.page.waitForTimeout(600);
const term = await d.page.evaluate(() => ({
  shown: document.querySelector('#ov-term')?.style.display !== 'none',
  status: document.querySelector('#ov-term .t-status')?.textContent,
  rows: document.querySelector('#ov-term .t-rows')?.textContent,
  wake: document.querySelector('#ov-term .t-wake')?.style.display,
  label: document.querySelector('#ov-term .t-wake')?.textContent,
}));
check('the terminal opens', term.shown, term);
check('…reading DORMANT, with real readings on it',
  /DORMANT/.test(term.status ?? '') && /GRID/.test(term.rows ?? '') && /M ASL/.test(term.rows ?? ''), term);
check('…and offers exactly one action, and it says ACTIVATE',
  term.wake === 'block' && /ACTIVATE STATION/.test(term.label ?? ''), term);

// ── the wake ──
await d.page.evaluate(() => document.querySelector('#ov-term .t-wake').dispatchEvent(new MouseEvent('click', { bubbles: true })));
await d.page.waitForTimeout(2500);   // past the marks debounce
const after = await d.page.evaluate(() => ({
  st: window.__stations().find((x) => x.id === 'ct-01'),
  status: document.querySelector('#ov-term .t-status')?.textContent,
  wake: document.querySelector('#ov-term .t-wake')?.style.display,
  marks: window.__marks(),
  stored: localStorage.getItem('drive.marks.v1'),
}));
check('the wake latches', !!after.st?.woken, after.st);
check('…the terminal flips to ONLINE with the action gone',
  /ONLINE/.test(after.status ?? '') && after.wake === 'none', after);
check('…and the mark is on disk', /ct-01/.test(after.stored ?? ''), after.stored);

// ── the reload ──
await d.page.reload({ waitUntil: 'load' });
await d.page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 200000 });
await d.page.waitForTimeout(8000);
const back = await d.page.evaluate(() => window.__stations().find((x) => x.id === 'ct-01'));
check('a reload finds the station still awake — woken means woken', !!back?.woken, back);

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
report(d.errors);
await d.close();
process.exitCode = bad ? 1 : 0;
