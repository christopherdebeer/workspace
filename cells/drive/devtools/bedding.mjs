/**
 * ── IS THE BEDDING GEOLOGY OR CORDUROY? ──
 *
 *   node cells/drive/devtools/bedding.mjs
 *   REV=a9774a6 node .../bedding.mjs        (the control, as deployed)
 *
 * Reported from the seat at the Stelvio: long parallel ribs running across the
 * whole hillside in one direction. The question is not whether lines are there
 * — they are meant to be, an outcrop trace IS a line — it is whether they are
 * PERIODIC, because a perfectly regular comb is the one thing no rock face is.
 *
 * So the measurement is the AUTOCORRELATION of the substrate's own
 * contribution, which is the difference between sub=1 and sub=0 on one settled
 * boot — isolating the term from the landform under it. A comb shows a strong
 * off-centre peak at its period; a field whose spacing wanders does not.
 *
 * TWO BOOTS ARE FINE FOR THIS and would not be for a pixel diff: a period is a
 * property of the structure, not of which tiles happened to arrive.
 */
import { openDrive } from './harness.mjs';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const SPOT = process.env.SPOT ?? 'lat=46.5302&lon=10.4547';
const REV = process.env.REV ?? '';
const OUT = process.env.OUT ?? '/tmp/drive-tools/bedding';
/**
 * THE SCALE IS SOLVED FOR, NOT GUESSED, and the first cut guessed.
 *
 * It set `__zoom` to a number and measured whatever frame that gave. Two boots
 * then land at two scales, and — worse — the strongest periodicity it found sat
 * at a lag of six pixels, which at that zoom is not a four-metre bed at all. It
 * is the Bayer dither. A number that names the wrong period is not a weaker
 * measurement, it is a different one.
 *
 * So the target is METRES PER CSS PIXEL — the seat's own frame read
 * `20 M · 1:910`, which is 0.241 — and the tool solves the zoom for it, so two
 * runs are comparable by construction and the lag window can be stated in
 * metres. At 0.241 a 4.5 m bed is 19 px and a 1.2 m bed is 5; the window is
 * 12–40 px, which can only be the coarse bedding and cannot be the dither.
 */
const MPP = Number(process.env.MPP ?? 0.241);
mkdirSync(OUT, { recursive: true });
const tag = REV || 'tree';

const ANALYSE = process.env.ANALYSE === '1';
if (!ANALYSE) {
const d = await openDrive({
  spot: `${SPOT}&cam=top&time=NOON&wx=clear&nodraw=1`,
  tag: `bedding-${tag}`, settle: 0, bootTimeout: 300000, dpr: 1,
  ...(REV ? { rev: REV } : {}),
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pb = -1;
for (let i = 0; i < 80; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.builds > 0) ? quiet + 1 : 0;
  pb = t.builds;
  if (quiet >= 4) break;
}
await q(() => { window.__draw(true); window.__hud(false); window.__hide('rig'); });
// Solve the zoom for the target scale. The chart's metres-per-pixel is very
// nearly linear in the zoom, so three proportional steps land inside a per
// cent; each one has to WAIT, because __zoom sets a target the frame loop eases
// toward and the harness runs at three frames a second.
let z = 1.0, sc = null;
for (let i = 0; i < 6; i++) {
  await q((v) => window.__zoom(v), z);
  for (let k = 0; k < 30; k++) {
    await d.page.waitForTimeout(1000);
    const c = await q(() => window.__cam());
    if (Math.abs(c.zoom - z) / z < 0.02) break;
  }
  sc = await q(() => window.__scale());
  const err = sc.mppCss / MPP;
  if (Math.abs(err - 1) < 0.02) break;
  z = Math.max(0.125, Math.min(4000, z / err));
}
await d.page.waitForTimeout(6000);
for (const [name, sub] of [['off', 0], ['on', 1]]) {
  await q((v) => window.__tdetail({ sub: v }), sub);
  await d.page.waitForTimeout(1200);
  writeFileSync(`${OUT}/${tag}-${name}.png`, await d.page.screenshot({ timeout: 240000 }));
}
await q(() => window.__tdetail({ sub: 1 }));
console.log(`[${tag}] settled builds ${pb}, zoom ${z.toFixed(3)}, scale ${sc.label},`
  + ` ${sc.mppCss.toFixed(3)} m per css px (target ${MPP})`);
console.log(`  harness errors: ${d.errors.length}`);
await d.close();
}

// ── the periodicity, in Chromium because there is no image library here ──
// The same launch imgdiff uses. A bare chromium.launch() fails in this
// container — no sandbox, and the browser is at a pinned path — and it fails
// AFTER the frames are taken, which threw away a nine-minute capture the first
// time. The analysis is therefore also re-runnable over frames already on disk
// (ANALYSE=1), so a broken reader never costs a boot again.
const b = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--no-sandbox'],
});
const pg = await b.newPage();
const stat = await pg.evaluate(async ([a, c]) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const [ia, ic] = [await load(a), await load(c)];
  const W = ia.width, H = ia.height;
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
  const px = (img) => { cx.clearRect(0, 0, W, H); cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, W, H).data; };
  const pa = px(ia), pc = px(ic);
  // The terrain pane: the middle of the frame, clear of the HUD's gauges.
  const x0 = Math.round(W * 0.18), x1 = Math.round(W * 0.82);
  const y0 = Math.round(H * 0.30), y1 = Math.round(H * 0.78);
  const w = x1 - x0, h = y1 - y0;
  const dif = new Float64Array(w * h);
  let m = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = ((y + y0) * W + (x + x0)) * 4;
    const la = 0.2126 * pa[k] + 0.7152 * pa[k + 1] + 0.0722 * pa[k + 2];
    const lc = 0.2126 * pc[k] + 0.7152 * pc[k + 1] + 0.0722 * pc[k + 2];
    dif[y * w + x] = la - lc; m += la - lc;
  }
  m /= w * h;
  let v = 0;
  for (let i = 0; i < dif.length; i++) { dif[i] -= m; v += dif[i] * dif[i]; }
  v /= dif.length;
  // The strongest off-centre autocorrelation over a square of lags. A comb has
  // one; a wandering field has none worth the name.
  // 12 to 40 px at the solved scale is 2.9 m to 9.6 m of ground: the coarse
  // bedding's own band and nothing else. Under 12 is the dither, which is what
  // the first cut of this measured and named as bedding.
  let best = 0, bl = null;
  const all = [];
  for (let ly = -40; ly <= 40; ly += 2) for (let lx = -40; lx <= 40; lx += 2) {
    if (Math.hypot(lx, ly) < 12 || Math.hypot(lx, ly) > 40) continue;
    let s = 0, n = 0;
    for (let y = Math.max(0, -ly); y < Math.min(h, h - ly); y += 2) {
      for (let x = Math.max(0, -lx); x < Math.min(w, w - lx); x += 2) {
        s += dif[y * w + x] * dif[(y + ly) * w + (x + lx)]; n++;
      }
    }
    const r = n ? (s / n) / Math.max(1e-9, v) : 0;
    all.push(r);
    if (r > best) { best = r; bl = [lx, ly]; }
  }
  // THE PEAK ALONE CANNOT SAY "COMB". A noisier frame has a bigger variance and
  // a smaller correlation everywhere, so a peak that fell might only mean the
  // term got broader. What says comb is how far the peak stands ABOVE the
  // background of its own lag window.
  all.sort((p, r) => p - r);
  const med = all[all.length >> 1] ?? 0;
  return { rms: Math.sqrt(v), peak: best, lag: bl, median: med, above: best - med };
}, [`data:image/png;base64,${readFileSync(`${OUT}/${tag}-on.png`).toString('base64')}`,
  `data:image/png;base64,${readFileSync(`${OUT}/${tag}-off.png`).toString('base64')}`]);
await b.close();
console.log(`  the substrate's own contribution: rms ${stat.rms.toFixed(2)}/255`);
console.log(`  autocorrelation over the bedding band: peak ${stat.peak.toFixed(3)}`
  + ` at lag ${JSON.stringify(stat.lag)} px, median ${stat.median.toFixed(3)},`
  + ` PEAK ABOVE BACKGROUND ${stat.above.toFixed(3)}`);
