/**
 * A render beside a reference photograph, at the photograph's shape.
 *
 *   node cells/mistwood/devtools/compare.mjs reference/misty-woodland-edge.jpg 'seed=moss-ford-7&find=glade&fixed&hour=11' [more queries…]
 *
 * Each query is rendered at the reference's aspect (its width × height, scaled to 1000 px wide),
 * settled, and put beside it in devtools/out/compare-<reference>.png.
 */
import { withWood } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { basename, join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [ref, ...queries] = process.argv.slice(2);
if (!ref || !queries.length) {
  console.log('usage: compare.mjs <reference image> <query> [query …]');
  process.exit(1);
}
const refPath = isAbsolute(ref) ? ref : join(here, ref);
// the reference's size: from the JPEG's SOF marker, or the PNG header
const buf = readFileSync(refPath);
let w = 0;
let h = 0;
if (buf[0] === 0x89) {
  w = buf.readUInt32BE(16);
  h = buf.readUInt32BE(20);
} else
  for (let i = 2; i < buf.length; ) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      h = buf.readUInt16BE(i + 5);
      w = buf.readUInt16BE(i + 7);
      break;
    }
    i += 2 + len;
  }
const width = 1000;
const height = Math.round((width * h) / w);
await withWood(
  async (wood) => {
    const shots = [];
    for (const [i, q] of queries.entries()) {
      const page = await wood.open(q);
      const settled = await wood.settle(page);
      shots.push(await wood.shot(page, `compare-${i + 1}`));
      const s = await wood.state(page);
      console.log(`render ${i + 1}${settled ? '' : ' (not settled)'}: ${q}\n  at ${s.at} heading ${s.heading} place ${JSON.stringify(s.place)}`);
      await page.close();
    }
    const name = `compare-${basename(ref).replace(/\.\w+$/, '')}`;
    console.log('montage:', await wood.montage([refPath, ...shots], name, { height: 420, labels: ['reference', ...queries.map((q, i) => `render ${i + 1}`)] }));
  },
  { width, height },
);
