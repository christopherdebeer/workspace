/**
 * The picture's tones against a reference photograph's, region by region.
 *
 *   node cells/mistwood/devtools/palette.mjs reference/misty-woodland-edge.jpg 'seed=moss-ford-7&find=glade&fixed&hour=11&time=5'
 *
 * Renders the query at the reference's shape, then for each region (upper fog, mid fog, the
 * ground band, the near ground) prints the mean colour of both and the difference, and the
 * luma at the 2nd, 50th and 98th percentiles (how deep the darks go, how bright the fog). The
 * regions are the same fractions of either picture; content differs, so read the fog rows as
 * the grade and the ground rows as the undergrowth's tone.
 * A query may also be an image path (to compare two images without rendering).
 */
import { withWood } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [ref, query] = process.argv.slice(2);
if (!ref || !query) {
  console.log('usage: palette.mjs <reference image> <query | image>');
  process.exit(1);
}
const path = (p) => (isAbsolute(p) ? p : existsSync(join(here, p)) ? join(here, p) : p);
export const REGIONS = {
  'upper fog': [0.4, 0.05, 0.6, 0.3],
  'mid fog': [0.4, 0.4, 0.6, 0.6],
  'ground band': [0.3, 0.7, 0.7, 0.8],
  'near ground': [0.3, 0.88, 0.7, 0.98],
};
const size = (buf) => {
  if (buf[0] === 0x89) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  for (let i = 2; i < buf.length; ) {
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('size?');
};
const [rw, rh] = size(readFileSync(path(ref)));
const width = 1000;
const height = Math.round((width * rh) / rw);

await withWood(
  async (wood) => {
    let shot = path(query);
    if (!existsSync(shot)) {
      const page = await wood.open(query);
      const settled = await wood.settle(page);
      shot = await wood.shot(page, 'palette');
      if (!settled) console.log('(not settled)');
      await page.close();
    }
    const page = await wood.browser.newPage();
    const url = (p) => `data:image/${p.endsWith('png') ? 'png' : 'jpeg'};base64,${readFileSync(p).toString('base64')}`;
    const stats = await page.evaluate(
      async ({ srcs, regions }) => {
        const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        const out = [];
        for (const src of srcs) {
          const img = await load(src);
          const W = 500, H = Math.round((500 * img.height) / img.width);
          const cv = new OffscreenCanvas(W, H);
          const g = cv.getContext('2d');
          g.drawImage(img, 0, 0, W, H);
          const d = g.getImageData(0, 0, W, H).data;
          const res = {};
          for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
            const s = [0, 0, 0];
            let n = 0;
            for (let y = Math.floor(y0 * H); y < y1 * H; y++)
              for (let x = Math.floor(x0 * W); x < x1 * W; x++) {
                const i = (y * W + x) * 4;
                s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; n++;
              }
            res[name] = s.map((v) => Math.round(v / n));
          }
          const l = [];
          for (let i = 0; i < d.length; i += 4) l.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
          l.sort((a, b) => a - b);
          res['luma p2 / p50 / p98'] = [l[Math.floor(l.length * 0.02)], l[Math.floor(l.length * 0.5)], l[Math.floor(l.length * 0.98)]].map(Math.round);
          out.push(res);
        }
        return out;
      },
      { srcs: [url(path(ref)), url(shot)], regions: REGIONS },
    );
    const [a, b] = stats;
    console.log(`${'region'.padEnd(22)}${'reference'.padEnd(18)}${'render'.padEnd(18)}difference`);
    for (const k of Object.keys(a)) console.log(`${k.padEnd(22)}${a[k].join(', ').padEnd(18)}${b[k].join(', ').padEnd(18)}${b[k].map((v, i) => (v - a[k][i] >= 0 ? '+' : '') + (v - a[k][i])).join(', ')}`);
  },
  { width, height },
);
