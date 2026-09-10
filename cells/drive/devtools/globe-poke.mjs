// THE GLOBE THROUGH THE SHELL, FROM A HIGH RIG OVER A LOW COUNTRY.
//
//   node cells/drive/devtools/globe-poke.mjs            # the working tree
//   REV=<sha> node cells/drive/devtools/globe-poke.mjs  # a control
//
// Reported from the seat with the rig at Mariposa (2,300m) and the chart
// turned to India: dark circles on a lattice with four-pointed stars between
// them, and US city names written over the Deccan. Both are the same fact
// seen twice — the far shell carries the rig's elevation in its radius and
// the globe did not know — so this boots exactly that, waits for the z5 ring
// over India, and measures the two things the eye reported:
//
//   lattice   the autocorrelation of the terrain pane's detrended luma at the
//             globe lattice's own period (2.25° of longitude at the focus, in
//             screen pixels via the chart's stated scale). The seat's frames
//             read 0.25 there; a shell with nothing standing through it reads
//             at the terrain's own floor.
//   globe%    the share of the pane that changes when the globe is hidden
//             (`__hide('globe')`), the shell being on. A backdrop that never
//             shows through reads 0. (The control has no such switch; it
//             reports the lattice alone.)
//   labels    the place names the HUD actually drew (`__ov().labels`), which
//             must hold no city from the far side of the planet.
import { openDrive, WORK } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

const REV = process.env.REV || '';
const Z = Number(process.env.Z ?? 11000);
// Frames are named by build AND zoom, or a second zoom's run overwrites the
// first's witness while you are still looking at it.
const TAG = `${REV ? `poke-${REV.slice(0, 7)}` : 'poke-fix'}-z${Z}`;
const RIG = { lat: 37.7351, lon: -119.637 }, FOCUS = { lat: 20, lon: 78 };
const SPOT = `lat=${RIG.lat}&lon=${RIG.lon}&h=0&cam=top&wx=clear&time=NOON&nodraw=1&z=${Z}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const { page, close } = await openDrive({ spot: SPOT, tag: TAG, menu: true, settle: 0, rev: REV });
await page.evaluate((z) => { window.__cam('top'); window.__zoom(z); }, Z);
for (let i = 0; i < 80; i++) {
  if (await page.evaluate((z) => Math.abs(window.__cam().zoom - z) < z * 0.02, Z)) break;
  await sleep(250);
}
for (let i = 0; i < 60; i++) { if (await page.evaluate(() => window.__globe().tex)) break; await sleep(500); }
// Turn the planet: an OFFSET from the focus, consumed on the next chart frame.
await page.evaluate(([dl, dn]) => window.__globespin(dl, dn), [FOCUS.lat - RIG.lat, FOCUS.lon - RIG.lon - 360]);
for (let i = 0; i < 60; i++) {
  const f = await page.evaluate(() => window.__globe().focus);
  if (f && Math.abs(f.lat - FOCUS.lat) < 0.5 && Math.abs(((f.lon - FOCUS.lon + 540) % 360) - 180) < 0.5) break;
  await sleep(250);
}
log(`focus ${JSON.stringify(await page.evaluate(() => window.__globe().focus))}`);
// The ring, and the overview ring the labels come from. A frame of one tile
// standing on the planet proves nothing about the backdrop.
let last = null;
for (let i = 0; i < 200; i++) {
  last = await page.evaluate(() => {
    const x = window.__far(), o = window.__ov();
    return { far: `${x.tiles}/${x.asked} retired ${x.retired} inFlight ${x.inFlight} queued ${x.queued}`, home: x.inFlight === 0 && x.queued === 0 && x.tiles >= x.asked && x.asked > 0,
      ov: `${o.have}/${o.want} retired ${o.retired} inFlight ${o.inFlight}`, ovHome: o.want > 0 && o.have >= o.want };
  });
  if (last.home && (last.ovHome || i > 150)) break;
  if (i % 10 === 0) log(`waiting  far ${last.far}  ov ${last.ov}`);
  await sleep(3000);
}
log(`ring  far ${last.far}  ov ${last.ov}`);
const sc = await page.evaluate(() => window.__scale());
const g = await page.evaluate(() => { const x = window.__globe(); return { free: x.free, on: x.on, mpp: x.mpp, focus: x.focus }; });
log(`scale ${sc.label}  mppCss ${sc.mppCss.toFixed(0)}  globe ${JSON.stringify(g)}`);

async function frame(name) {
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) { if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break; await sleep(500); }
  const shot = join(WORK, `${TAG}-${name}.png`);
  await page.screenshot({ path: shot, timeout: 240000 });
  await page.evaluate(() => window.__draw(false));
  log(`frame ${shot}`);
  return shot;
}
log(`origin ${JSON.stringify(await page.evaluate(() => window.__origin()))}`);
const A = await frame('globe');
const labels = await page.evaluate(() => window.__ov().labels ?? null);
// The shell hidden: what is left is the backdrop, so the share of the pane
// this changes is the share the SHELL was drawing. On a build where the globe
// stands through the shell that share is small; where the shell covers the
// frame it is nearly all of it.
await page.evaluate(() => window.__hide('far', true));
const F = await frame('nofar');
await page.evaluate(() => window.__hide('far', false));
let B = null;
if (await page.evaluate(() => window.__hide().layers.includes('globe'))) {
  await page.evaluate(() => window.__hide('globe', true));
  B = await frame('noglobe');
  await page.evaluate(() => window.__hide('globe', false));
}
const errs = await page.evaluate(() => window.__pageErrors ?? []);
// The telemetry's chart rows and the phases this view costs, as the seat's
// double tap would copy them — the dump is the instrument the phone has.
const tele = await page.evaluate(() => (typeof window.__telemetry === 'function' ? window.__telemetry() : ''));
for (const line of tele.split('\n')) {
  if (/^(chart |world pass|render |stepGlobe|farBuild|ovBuild|hud\+misc|world:stream|camera )/.test(line)) log(`telemetry  ${line}`);
}
await close();

// ── the numbers ──
function readPng(path) {
  const b = readFileSync(path); let p = 8, w = 0, h = 0, depth = 0, ctype = 0; const idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; } else if (type === 'IDAT') idat.push(d); p += 12 + len; }
  const ch = ctype === 2 ? 3 : ctype === 6 ? 4 : 1, bps = depth / 8, bpp = ch * bps, stride = w * bpp, raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 3); let prev = new Uint8Array(stride), cur = new Uint8Array(stride), q = 0;
  for (let y = 0; y < h; y++) { const f = raw[q++];
    for (let x = 0; x < stride; x++) { const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = raw[q + x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v & 255; }
    q += stride; for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = cur[x * bpp + k * bps]; [prev, cur] = [cur, prev]; }
  return { w, h, rgb: out };
}
// The terrain pane: the frame less the HUD's margins. The same crop for every
// number so the control and the fix are read over one region.
const pane = (img) => ({ x0: Math.round(img.w * 0.15), y0: Math.round(img.h * 0.22), x1: Math.round(img.w * 0.85), y1: Math.round(img.h * 0.72) });
function lattice(img, lagX, lagY) {
  const { x0, y0, x1, y1 } = pane(img), cw = x1 - x0, chh = y1 - y0, R = 90;
  const L = new Float32Array(cw * chh);
  for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) { const i = ((y + y0) * img.w + x + x0) * 3; L[y * cw + x] = 0.299 * img.rgb[i] + 0.587 * img.rgb[i + 1] + 0.114 * img.rgb[i + 2]; }
  const t = new Float32Array(L.length), T = new Float32Array(L.length);
  for (let y = 0; y < chh; y++) { let s = 0, n = 0; for (let x = -R; x < cw; x++) { if (x + R < cw) { s += L[y * cw + x + R]; n++; } if (x - R - 1 >= 0) { s -= L[y * cw + x - R - 1]; n--; } if (x >= 0) t[y * cw + x] = s / n; } }
  for (let x = 0; x < cw; x++) { let s = 0, n = 0; for (let y = -R; y < chh; y++) { if (y + R < chh) { s += t[(y + R) * cw + x]; n++; } if (y - R - 1 >= 0) { s -= t[(y - R - 1) * cw + x]; n--; } if (y >= 0) T[y * cw + x] = s / n; } }
  const D = new Float32Array(L.length); let v0 = 0; for (let i = 0; i < L.length; i++) { D[i] = L[i] - T[i]; v0 += D[i] * D[i]; } v0 /= L.length;
  const ac = (axis, lag) => { let s = 0, n = 0;
    if (axis === 'x') { for (let y = 0; y < chh; y++) for (let x = 0; x + lag < cw; x++) { s += D[y * cw + x] * D[y * cw + x + lag]; n++; } }
    else { for (let y = 0; y + lag < chh; y++) for (let x = 0; x < cw; x++) { s += D[y * cw + x] * D[(y + lag) * cw + x]; n++; } }
    return s / n / v0; };
  // the best within ±4 px of the predicted period, and the floor at half it
  const best = (axis, lag) => { let m = -1; for (let l = lag - 4; l <= lag + 4; l++) m = Math.max(m, ac(axis, l)); return m; };
  return { x: best('x', lagX), y: best('y', lagY), xHalf: ac('x', Math.round(lagX / 2)), yHalf: ac('y', Math.round(lagY / 2)), sd: Math.sqrt(v0) };
}
const imgA = readPng(A);
const lagX = Math.round(2.25 * 111320 * Math.cos((FOCUS.lat * Math.PI) / 180) / sc.mppCss);
const lagY = Math.round(2.25 * 111320 / sc.mppCss);
const la = lattice(imgA, lagX, lagY);
log(`lattice @ ${lagX}x${lagY}px: x ${la.x.toFixed(3)} y ${la.y.toFixed(3)}  (at half the period x ${la.xHalf.toFixed(3)} y ${la.yHalf.toFixed(3)}; sd ${la.sd.toFixed(1)})`);
const share = (other) => {
  const imgB = readPng(other), { x0, y0, x1, y1 } = pane(imgA); let diff = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * imgA.w + x) * 3; n++;
    if (Math.abs(imgA.rgb[i] - imgB.rgb[i]) + Math.abs(imgA.rgb[i + 1] - imgB.rgb[i + 1]) + Math.abs(imgA.rgb[i + 2] - imgB.rgb[i + 2]) > 24) diff++; }
  return (100 * diff / n).toFixed(2);
};
log(`shell% ${share(F)} of the pane changes when the far shell is hidden`);
if (B) log(`globe% ${share(B)} of the pane changes when the globe is hidden (shell on)`);
const US = ['San Francisco', 'Los Angeles', 'San Diego', 'Denver', 'Dallas', 'Houston', 'Atlanta', 'Seattle', 'Vancouver', 'Edmonton', 'Minneapolis', 'Detroit', 'St. Louis', 'New Orleans', 'Miami', 'Havana', 'Monterrey', 'Guadalajara', 'Puebla', 'Boston', 'Phoenix'];
if (labels) log(`labels (${labels.length}): ${labels.join(', ')}  far-side: ${labels.filter((n) => US.includes(n)).join(', ') || 'none'}`);
else log('labels: no probe on this build');
log(`pageerrors ${errs.length} ${JSON.stringify(errs.slice(0, 2))}`);
