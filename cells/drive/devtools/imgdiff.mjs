/**
 * WHAT ACTUALLY CHANGED BETWEEN TWO SHOTS.
 *
 *   node cells/drive/devtools/imgdiff.mjs A.png B.png OUT [--gain=6] [--label=a,b]
 *                                          [--crop=x,y,w,h] [--zoom=4]
 *
 * `--crop` and `--zoom` are how the interesting part gets looked at. This
 * world renders at 320 lines and is magnified, so the thing under judgement is
 * often a dozen texels; a full-frame comparison of a phone screenshot shows
 * that something changed and nothing about what.
 *
 * Writes OUT.png — A, B, and their difference amplified — and prints the mean
 * and worst per-pixel change. An eye comparing two screenshots of a world this
 * dense will find a difference wherever it expects one; a number will not.
 *
 * The difference panel is amplified because the honest one is nearly black:
 * an eight-pixel streak on a quantised palette moves a handful of texels by a
 * step or two, which is invisible next to the picture it came from and is
 * exactly the thing being judged.
 *
 * Chromium decodes and composites — there is no image library in this repo and
 * the browser the rest of these tools already drive is a perfectly good one.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { chromium } from 'playwright';
import { WORK } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const pos = args.filter((a) => !a.startsWith('--'));
if (pos.length < 3) { console.error('usage: imgdiff.mjs A.png B.png OUT [--gain=6]'); process.exit(2); }
const fix = (p) => (isAbsolute(p) ? p : existsSync(p) ? p : join(WORK, p.endsWith('.png') ? p : `${p}.png`));
const [aP, bP] = [fix(pos[0]), fix(pos[1])];
const outP = isAbsolute(pos[2]) ? pos[2] : join(WORK, `${pos[2].replace(/\.png$/, '')}.png`);
const gain = Number(arg('gain', 6));
const zoom = Math.max(1, Number(arg('zoom', 1)));
const crop = arg('crop', '').split(',').filter((v) => v !== '').map(Number);
const [la, lb] = arg('label', `${pos[0]},${pos[1]}`).split(',');

const b64 = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage();
const out = await page.evaluate(async (o) => {
  const load = (src) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
  });
  const [A, B] = await Promise.all([load(o.a), load(o.b)]);
  const full = { w: Math.min(A.width, B.width), h: Math.min(A.height, B.height) };
  const cr = o.crop.length === 4 ? o.crop : [0, 0, full.w, full.h];
  const w = cr[2], h = cr[3];
  const px = (img) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(img, cr[0], cr[1], w, h, 0, 0, w, h);
    return x.getImageData(0, 0, w, h).data;
  };
  // Keep the cropped panels as canvases so the magnifier below is NEAREST —
  // a smoothed enlargement of a pixel-art frame is a picture of the smoothing.
  const panel = (img) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    x.drawImage(img, cr[0], cr[1], w, h, 0, 0, w, h);
    return c;
  };
  const pA = panel(A), pB = panel(B);
  const da = px(A), db = px(B);
  // Mean and worst over the LUMA difference: a palette step is a colour move,
  // and summing three channels triple-counts one change.
  let sum = 0, worst = 0, moved = 0;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const cx = c.getContext('2d');
  const img = cx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    const l1 = da[j] * 0.299 + da[j + 1] * 0.587 + da[j + 2] * 0.114;
    const l2 = db[j] * 0.299 + db[j + 1] * 0.587 + db[j + 2] * 0.114;
    const d = Math.abs(l1 - l2);
    sum += d; if (d > worst) worst = d; if (d > 3) moved++;
    const v = Math.min(255, d * o.gain);
    img.data[j] = v; img.data[j + 1] = v; img.data[j + 2] = v; img.data[j + 3] = 255;
  }
  cx.putImageData(img, 0, 0);

  const z = o.zoom, zw = w * z, zh = h * z;
  const pad = 26, W = zw * 3 + 8, H = zh + pad;
  const s = document.createElement('canvas'); s.width = W; s.height = H;
  const g = s.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#0a1417'; g.fillRect(0, 0, W, H);
  g.drawImage(pA, 0, pad, zw, zh);
  g.drawImage(pB, zw + 4, pad, zw, zh);
  g.drawImage(c, zw * 2 + 8, pad, zw, zh);
  g.fillStyle = '#d6efe7'; g.font = '14px monospace';
  g.fillText(o.la, 4, 17);
  g.fillText(o.lb, zw + 8, 17);
  g.fillText(`diff x${o.gain}`, zw * 2 + 12, 17);
  return {
    png: s.toDataURL('image/png'),
    mean: +(sum / (w * h)).toFixed(3),
    worst: +worst.toFixed(1),
    movedPct: +((moved / (w * h)) * 100).toFixed(2),
    w, h,
  };
}, { a: b64(aP), b: b64(bP), gain, la, lb, zoom, crop });

writeFileSync(outP, Buffer.from(out.png.split(',')[1], 'base64'));
console.log(`${la} vs ${lb}  ${out.w}x${out.h}`);
console.log(`  mean luma delta ${out.mean}/255   worst ${out.worst}   pixels moved >3: ${out.movedPct}%`);
console.log(`-> ${outP}`);
await browser.close();
