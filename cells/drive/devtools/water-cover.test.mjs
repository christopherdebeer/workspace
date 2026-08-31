/**
 * WHERE THE COVER RASTER AND THE TERRAIN DISAGREE ABOUT WATER — against the
 * live cell, because the land-cover route only exists there.
 *
 *   node cells/drive/devtools/water-cover.test.mjs
 *
 * Two faults, both reported from the seat, both now laws.
 *
 * THE SILENT LAKE. At Le Lac de Belle-Isle in Chateauroux the truck read
 * WATER on the conditions column while the screen showed a field: WorldCover
 * knew there was a lake, OSM's polygon never reached the client, and only OSM
 * was ever allowed to declare one. Three subsystems have to agree about the
 * same square metre — the physics that wets the wheels, the renderer that
 * draws a surface, and the chart that marks it — and this checks all three at
 * the point the fault was reported from.
 *
 * THE WET HILLSIDE. A 38m pixel misregistered onto a bank made the truck wade
 * uphill, because a raster class was the whole argument. Water lies flat: no
 * point may resolve to water THROUGH THE RASTER while the ground under it
 * falls away faster than the tilt limit. Checked over a grid rather than at a
 * point, because the failure was never where you were looking.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
// Bare specifier, as the harness imports it — an absolute path here was the
// authoring box's filesystem, and the suite died with MODULE_NOT_FOUND on
// any other machine.
import { chromium } from 'playwright';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
await ctx.route(/^https:\/\//, async (route) => {
  const req = route.request();
  const args = ['-s', '--max-time', '90', '--cacert', '/root/.ccr/ca-bundle.crt', '-L', '--compressed'];
  if (req.postData()) args.push('--data-binary', req.postData(), '-H', 'Content-Type: application/x-www-form-urlencoded');
  args.push('-D', '-', req.url());
  const raw = await new Promise((res) => execFile('curl', args, { encoding: 'buffer', maxBuffer: 64e6 }, (e, o) => res(e ? null : o)));
  if (!raw) return route.fulfill({ status: 502, body: '' });
  let at = -1, from = 0;
  for (;;) {
    const i = raw.indexOf('\r\n\r\n', from);
    if (i < 0) break;
    const head = raw.slice(from, i).toString('latin1');
    if (!/^HTTP\//.test(head)) break;
    at = i; from = i + 4;
    if (!/HTTP\/[\d.]+ 3\d\d/.test(head) && raw.indexOf('HTTP/', from) !== from) break;
  }
  const headers = raw.slice(0, at).toString('latin1').split('\r\n\r\n').pop() ?? '';
  const status = Number(/HTTP\/[\d.]+ (\d{3})/.exec(headers.split('\r\n')[0])?.[1] ?? 200);
  const ct = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? 'application/octet-stream';
  return route.fulfill({ status, body: raw.slice(at + 4), contentType: ct });
});


const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
// Belle-Isle: the lake WorldCover sees and OSM's polygon never delivered.
await page.goto('https://c15r-drive.on.parc.land/?lat=46.82732&lon=1.69331&h=140&cam=top&z=3.2&t=12',
  { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 300000 });
await page.evaluate(() => window.__menutab(null));
// The synth pass runs on its own slow clock behind terrain and cover both, so
// wait on the BODY rather than on a stopwatch — a timeout here is the finding.
await page.waitForFunction(() => window.__synth().bodies > 0, null, { timeout: 180000 }).catch(() => null);

const at = await page.evaluate(() => ({ why: window.__why(), synth: window.__synth() }));
check('the raster built the lake OSM never delivered', at.synth.bodies > 0, at.synth);
check('the physics is standing in it', at.why.verdict === 'water', at.why);
check('and it is the raster body, not a mapped one', at.why.synth === true,
  { synth: at.why.synth, why: at.why.why, cover: at.why.cover });
check('the renderer drew a surface here, triangles kept',
  at.why.water.length > 0 && at.why.water.every((w) => w.kept > 0), at.why.water);
check('the drawn surface is at the wheels, not buried under the bank',
  at.why.water.some((w) => Math.abs(w.y - at.why.groundY) < 1.5),
  { water: at.why.water, ground: at.why.groundY });

// The veto, over ground rather than at a point: a raster verdict on a slope is
// the misregistration this exists to refuse.
const grid = await page.evaluate(() => {
  let wet = 0;
  const steep = [];
  for (let z = -600; z <= 600; z += 40) {
    for (let x = -600; x <= 600; x += 40) {
      const w = window.__why(x, z);
      if (!w.coverIsWater) continue;
      wet++;
      if (w.coverWaterHolds && w.terrainTilt >= w.tiltLimit) steep.push({ x, z, tilt: w.terrainTilt });
    }
  }
  return { wet, steep };
});
check('the scan found raster water to argue about', grid.wet > 0, grid);
check('no raster water stands on a slope', grid.steep.length === 0, grid.steep.slice(0, 4));
check('no page errors', errors.length === 0, errors);

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — cover and terrain agree about water');
process.exitCode = bad ? 1 : 0;
