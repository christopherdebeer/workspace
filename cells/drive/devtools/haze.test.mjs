/**
 * ONE HILLSIDE IS ONE MATERIAL — written against the live cell, because the
 * biome (and so the haze colours) is chosen from land cover, and the local
 * harness had no cover route: run locally the same fault measured 3.5 instead
 * of 17. THE HARNESS SERVES ~/cover/v1 NOW, out of the cell's own handler, so
 * that reason has expired — this could move local. Left live until someone
 * takes both readings on the same day, because the figures above were taken
 * with the biome guessed from latitude and are not a control for anything.
 *
 *   node cells/drive/devtools/haze.test.mjs
 *
 * Reported as cab-only and "it moves and shifts with camera movement, not much
 * distance" — which is what finally placed it, because nothing in WORLD space
 * behaves like that. The composite warms its haze toward the sun, and hazeSun
 * is about twice the brightness of hazeBase AND the other side of neutral in
 * hue (a temperate biome runs base [0.20,0.24,0.20] green-grey against sun
 * [0.42,0.40,0.22] warm yellow). Ground a kilometre or two out takes up to 30%
 * of that and near ground takes none, so the far slope came out BROWN and the
 * near one OLIVE: one hillside reading as two materials.
 *
 * Cab-only because the haze saturates on a 1400m e-fold — from a low camera
 * the whole ramp is squeezed into the few rows under the horizon, while from
 * the chase or the chart it is spread over the frame and reads as depth.
 *
 * MEASURED AS R−G, NOT AS BRIGHTNESS. Distant ground SHOULD be paler; that is
 * aerial perspective doing its job, and a test that forbade it would be
 * demanding a flat world. Changing HUE with distance is the part that reads as
 * a different substance. So the ground now takes 0.4 of the sunward lobe and
 * the SKY still takes all of it — that warm side is the sunset, built on
 * purpose in R39 and not to be traded away for this.
 *
 * The second assertion pins the instrument: with the lobe turned back up the
 * split must REAPPEAR. A hue test that cannot see the fault it was written for
 * is worth nothing, and this one has no offline build to be checked against.
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
// The ridge to Edge Hill from the cab, in the light it was reported in.
await page.goto('https://c15r-drive.on.parc.land/?lat=-30.6884&lon=27.7679&h=20&cam=cab&wx=clear&t=AFTERNOON',
  { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => document.querySelector('#boot')?.classList.contains('ready'), null, { timeout: 300000 });
await page.evaluate(() => window.__menutab(null));
await page.waitForTimeout(70000);
// Scrub is its own colour and would drown the reading.
await page.evaluate(() => window.__hide('veg'));
await page.waitForTimeout(2600);

/**
 * THE DOMINANT QUANTISED COLOUR OF A ROW, not the row's mean.
 *
 * The mean averages a dithered weave back into a smooth number and reports 8
 * where the eye reads 17 — and it also swallows any sky that creeps into the
 * far band. What a viewer actually sees in a fourteen-level image is the flat
 * colour most of the row landed on, so that is what is compared.
 */
async function split() {
  const rows = async (ys) => {
    const shot = (await page.screenshot({ clip: { x: 0, y: ys[0], width: 300, height: ys[ys.length - 1] - ys[0] + 1 } })).toString('base64');
    return page.evaluate(async ({ b64, ys }) => {
      const img = new Image();
      await new Promise((go, no) => { img.onload = go; img.onerror = no; img.src = `data:image/png;base64,${b64}`; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let acc = 0;
      for (const y of ys) {
        const row = y - ys[0];
        const hist = new Map();
        for (let px = 0; px < c.width; px += 2) {
          const i = (row * c.width + px) * 4;
          const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
          hist.set(k, (hist.get(k) ?? 0) + 1);
        }
        let top = null, n = 0;
        for (const [k, v] of hist) if (v > n) { n = v; top = k; }
        const [r, g] = top.split(',').map(Number);
        acc += r - g;
      }
      return acc / ys.length;
    }, { b64: shot, ys });
  };
  const f = await rows([255, 270, 285, 295]), n = await rows([400, 430, 460, 480]);
  return { far: +f.toFixed(1), near: +n.toFixed(1), split: +(f - n).toFixed(1) };
}

const shipped = await split();
check(`one hillside is one material, near and far (R-G split ${shipped.split})`,
  Math.abs(shipped.split) < 8, shipped);

await page.evaluate(() => window.__hazewarm(1));
await page.waitForTimeout(2600);
const loud = await split();
await page.evaluate(() => window.__hazewarm(0.4));
// A floor, not a target. The split reads 13-17 depending on where the sun has
// got to; what must not happen is this coming back near zero, which would mean
// the measurement had stopped being able to see the thing it exists for.
check(`…and the measurement can see it when the lobe is turned back up (${loud.split})`,
  Math.abs(loud.split) > 9, loud);

console.log(bad ? `\n${bad} FAILED` : '\nall good — the far slope is the same hill as the near one');
if (errs.length) console.log('pageerrors', errs.length, errs.slice(0, 3));
await browser.close();
if (bad) process.exitCode = 1;
