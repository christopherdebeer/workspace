/**
 * THE CHART TELLS POSITION — the projection audit, run against the live cell.
 *
 *   node cells/drive/devtools/poi-project.test.mjs
 *
 * Found the hard way: driving THE LINE toward PD-03 in top view, the pin held
 * station "900m south" across six real kilometres — the cockpit's horizon
 * clamp (a pin past 900m draws at 900m on its bearing) leaking onto a frame
 * that spans kilometres, where it reads as a map position that recedes as you
 * close. The law this file enforces is the one that failed:
 *
 *   A DRAWN WORLD POINT STANDS ITS LABELLED DISTANCE FROM THE VIEWER.
 *
 * The old clamp fails it by an order of magnitude (900m drawn, 19KM written).
 * Checked at both ranges — far (the destination must become a rim chip, ON
 * the border, never a mid-frame squatter) and near (the pin must sit at the
 * true point, in frame, unclamped) — plus: no skyline peak markers on the
 * chart, whose names belong to the ovPlaces layer.
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

// The docket's state: legs 1 done, PD-01/02 active — leg 2 auto-accepts at
// the active giver, which pins PD-02 (giver) and PD-03 (destination).
const seed = `
  localStorage.setItem('drive.sync.token', 'tok_probe');
  localStorage.setItem('drive.marks.v1', JSON.stringify({ v: 1,
    m: { 'line-01': 1755400000100 },
    s: { 'pd-01': 1755400000000, 'pd-02': 1755400000001 } }));
`;

/** Boot a page at a URL, wait for the PD-03 pin, return the pins probe. */
async function boot(url) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.addInitScript(seed);
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 300000 });
  await page.evaluate(() => window.__menutab(null));
  await page.waitForFunction(
    () => window.__pins().drawn.some((p) => /PD-03/.test(p.t)), null, { timeout: 90000 });
  const pins = await page.evaluate(() => window.__pins());
  const ov = await page.evaluate(() => window.__overview());
  const out = { pins, ov, errors };
  await page.close();
  return out;
}

const lawHolds = (pins) => pins.drawn
  .filter((p) => p.world)
  .map((p) => ({ t: p.t, d: p.d, at: Math.round(Math.hypot(p.world[0] - pins.view[0], p.world[1] - pins.view[1])) }))
  .filter((e) => Math.abs(e.at - e.d) > 30);

// ── far: the destination is a rim chip, and nothing squats at the clamp ──
{
  const { pins, ov, errors } = await boot(
    'https://c15r-drive.on.parc.land/?lat=48.19873&lon=2.01670&h=196&cam=top&z=24.4&line=1');
  // The chart's ink: at survey zoom the overview layer's ring fade is fully
  // open (negative radii = alpha 1 everywhere) — no hole around the truck.
  check('far: the overview ink is unfaded at survey zoom',
    ov.shown && ov.fade[0] < 0 && ov.fade[1] < 0, ov && { shown: ov.shown, fade: ov.fade });
  const pd3 = pins.drawn.find((p) => /PD-03/.test(p.t));
  check('far: PD-03 pinned with its true distance in the label',
    !!pd3 && pd3.d > 20000, pd3);
  check('far: a destination off the frame is a RIM CHIP, not a mid-frame pin',
    !!pd3 && pd3.rim && pd3.edge !== 0, pd3);
  check('far: the chip sits ON the border band, not floating mid-frame',
    !!pd3 && (pd3.sx < 390 * 0.12 || pd3.sx > 390 * 0.88 || pd3.sy < 844 * 0.17 || pd3.sy > 844 * 0.83),
    pd3 && { sx: pd3.sx, sy: pd3.sy });
  check('far: every drawn world point stands its labelled distance (no 900m clamp)',
    lawHolds(pins).length === 0, lawHolds(pins));
  check('far: no skyline peak markers on the chart', !pins.drawn.some((p) => p.k === 'peak'),
    pins.drawn.filter((p) => p.k === 'peak'));
  check('far: the chip carries an outward bearing for its arrow',
    !!pd3 && Number.isFinite(pd3.ux) && Number.isFinite(pd3.uy)
    && Math.abs(Math.hypot(pd3.ux, pd3.uy) - 1) < 0.01, pd3 && { ux: pd3.ux, uy: pd3.uy });
  check('far: no page errors', errors.length === 0, errors);
}

// ── near: the pin sits at the true point, in frame, unclamped ──
{
  const { pins, errors } = await boot(
    'https://c15r-drive.on.parc.land/?lat=47.95850&lon=1.90400&h=180&cam=top&z=24.4&line=1');
  const pd3 = pins.drawn.find((p) => /PD-03/.test(p.t));
  check('near: PD-03 is an in-frame pin at ~1.5KM', !!pd3 && pd3.edge === 0 && !pd3.rim
    && pd3.d > 1200 && pd3.d < 1900, pd3);
  check('near: it is drawn INSIDE the frame, not clamped to a band',
    !!pd3 && pd3.sy > 844 * 0.03 && pd3.sy < 844 * 0.97, pd3 && { sy: pd3.sy });
  check('near: every drawn world point stands its labelled distance',
    lawHolds(pins).length === 0, lawHolds(pins));
  check('near: no page errors', errors.length === 0, errors);
}

await browser.close();
console.log(bad ? `\n${bad} FAILED` : '\nall good — the chart tells position');
process.exitCode = bad ? 1 : 0;
