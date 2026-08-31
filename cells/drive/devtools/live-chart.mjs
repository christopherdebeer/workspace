// The live chart, wide: boot the DEPLOYED cell in the top camera at chart
// zooms and confirm the overview shell + labels land. Also proves cam/zoom
// URL state: the boot URL itself carries cam=top&z=60.
import { chromium } from 'playwright';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = '/tmp/drive-tools/relay-cache';
mkdirSync(CACHE, { recursive: true });
const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--disable-features=UseMLKEM,PostQuantumKeyAgreement,PostQuantumKyber,EncryptedClientHello'],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ignoreHTTPSErrors: true });
await ctx.route(/^https:\/\//, async (route) => {
  const req = route.request();
  const u = new URL(req.url());
  const cacheable = u.host !== 'c15r-drive.on.parc.land' || u.pathname.startsWith('/~/');
  const ct = u.pathname.endsWith('.js') || u.pathname.endsWith('.mjs') || u.host === 'esm.sh'
    ? 'application/javascript'
    : u.host === 'c15r-drive.on.parc.land' && u.pathname === '/' ? 'text/html' : 'application/octet-stream';
  const key = join(CACHE, createHash('sha1').update(req.url() + '|' + (req.postData() ?? '')).digest('hex'));
  if (cacheable && existsSync(key)) return route.fulfill({ status: 200, body: readFileSync(key), contentType: ct });
  const args = ['-s', '-f', '--compressed', '--max-time', '60', '--cacert', '/root/.ccr/ca-bundle.crt'];
  if (req.postData()) args.push('--data-binary', req.postData(), '-H', 'Content-Type: application/x-www-form-urlencoded');
  args.push(req.url());
  const body = await new Promise((res) => execFile('curl', args, { encoding: 'buffer', maxBuffer: 64e6 }, (e, o) => res(e ? null : o)));
  if (!body) return route.fulfill({ status: 502, body: '' });
  if (cacheable) { try { writeFileSync(key, body); } catch { /* best effort */ } }
  return route.fulfill({ status: 200, body, contentType: ct });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
await page.goto('https://c15r-drive.on.parc.land/?lat=62.4498&lon=7.6684&h=27&cam=top&z=60&time=NOON&sunalt=40',
  { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 200000 });
await page.evaluate(() => window.__menutab(null));
console.log('boot cam/zoom from URL:', JSON.stringify(await page.evaluate(() => window.__cam())));
for (const z of [60, 400]) {
  await page.evaluate((zz) => window.__zoom(zz), z);
  await page.waitForTimeout(45000);
  console.log(`z${z} overview:`, JSON.stringify(await page.evaluate(() => window.__overview())));
  await page.screenshot({ path: `/tmp/drive-tools/live-chart-z${z}.png` });
}
console.log('url now:', await page.evaluate(() => location.search));
console.log('pageerrors:', errors.length, errors.slice(0, 3));
await browser.close();
process.exitCode = errors.length ? 1 : 0;
