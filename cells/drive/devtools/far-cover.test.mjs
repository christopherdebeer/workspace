/**
 * THE SHELL HAS TO KNOW WHAT COUNTRY IT IS PAINTING — against the live cell,
 * because the land-cover route only exists there.
 *
 *   node cells/drive/devtools/far-cover.test.mjs
 *
 * Reported four times as a two-tone hillside and chased through three other
 * causes before this one was measured. The shell asks sampleCover for its
 * palette, exactly as the fine world does — and at Senqu 24 of its 25 tiles
 * had NO cover under them at all when they baked (mean 0.09), unchanged after
 * a forced re-bake, so it was never a race. A cover tile is ~8km across and
 * the block was ONE RING of them; a shell tile at z11 is 17km across and the
 * shell sees 24km. Handing the shell the raster only ever reached the tile the
 * truck was standing in.
 *
 * So the near world wore the ramp pulled toward the land-cover tint and
 * everything past about eight kilometres wore the biome ramp alone: warm in
 * front, cool behind, with an edge that slid as the block re-centred.
 *
 * Two laws, and the second is the one that holds everywhere:
 *   THE BLOCK REACHES AS FAR AS THE SHELL CAN SEE — as far as three rings
 *   allow, which is enough at temperate latitudes and not at 62°N.
 *   AND WHERE IT STILL DOES NOT REACH, THE SHELL WEARS THE AVERAGE OF WHAT
 *   THE RASTER DOES SAY rather than nothing, so there is no edge to find.
 *
 * The numbers this replaced, measured on the build before the fix:
 *   cover.mean 0.09, blind 24 of 25, mode null.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from '/home/user/workspace/node_modules/playwright/index.mjs';

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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
// Senqu, the escarpment it was reported from, in the cab where the shell fills
// the most frame. Any open country would do; this is the one with the history.
await page.goto('https://c15r-drive.on.parc.land/?lat=-30.6884&lon=27.7679&h=20&cam=cab&wx=clear&t=AFTERNOON',
  { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 300000 });
await page.evaluate(() => window.__menutab(null));
await page.waitForTimeout(70000);
const f = await page.evaluate(() => window.__far());
console.log('   ', JSON.stringify({ cover: f.cover, tint: f.tint, tiles: f.tiles }));

check('the shell has tiles to judge', f.tiles > 8 && f.cover && f.cover.n > 8, { tiles: f.tiles, cover: f.cover });
// The block reaches. Not every tile — three rings cannot cover 24km at every
// latitude — but a real share of the shell, against 0.09 before.
check(`the cover block reaches the shell (mean ${f.cover?.mean})`,
  (f.cover?.mean ?? 0) >= 0.35, f.cover);
// AND THE LOAD-BEARING ONE. Reach is a means; this is what removes the edge,
// and it is what still holds where the raster runs out.
check('the shell has a fallback class for ground the raster never reaches',
  f.cover?.mode != null, f.cover);
// No shell tile is a stranger to its neighbours. Country genuinely varies, so
// this is a ceiling on disagreement rather than a demand for uniformity.
check(`shell tiles agree about the colour of the country (spread ${f.tint?.spread})`,
  f.tint != null && f.tint.spread < 0.2, f.tint);

console.log(bad ? `\n${bad} FAILED` : '\nall good — the shell knows what it is painting');
if (errs.length) console.log('pageerrors', errs.length, errs.slice(0, 3));
await browser.close();
if (bad) process.exitCode = 1;
