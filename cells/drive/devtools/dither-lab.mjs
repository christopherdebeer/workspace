/**
 * EVERY DITHER PATTERN OVER ONE SCENE RENDER.
 *
 *   node devtools/dither-lab.mjs                       # all nine, at the Cape
 *   DL_SPOT='fixture=at-paris-west' DL_LEVELS=14,4,2 node devtools/dither-lab.mjs
 *
 * A dither pattern is a judgement, so this writes frames. What makes the frames
 * WORTH judging is that they are all the same scene: `__draw(false)` stands the
 * frame loop down and `__dither({pat})` re-runs the post chain over whatever is
 * already in rtScene, so two pictures differ by the threshold pattern and by
 * nothing else. That is the whole reason `composite()` lives outside the frame
 * loop — and it matters more here than it did for the shutter, because this
 * world's clouds, sward, wildlife, suspension and still-arriving tiles move far
 * more pixels between two frames than any pattern does.
 *
 * Beside each frame, the ONE number that separates a dithered ramp from a
 * rounded one: the median longest run of a single exact colour along a row.
 * That is banding.test.mjs's metric and it is the right one — "how much does
 * the far half differ from the near half" is the wrong question, because the
 * honest answer is "a little, and it should". A dithered ramp breaks every few
 * texels; a rounded one runs the width of the frame.
 *
 * Read the number to rank the patterns and the frames to choose between them.
 * The number cannot see a pattern that is DISTRACTING — a halftone rosette and
 * a blue-noise weave can score identically and look nothing alike.
 *
 * WHAT IS NOT HERE: error diffusion. Floyd–Steinberg and its family are
 * sequential — each pixel's error is pushed into neighbours not yet quantised —
 * so they are not expressible in a fragment shader at all. See DITHER_GLSL in
 * main.ts for the long version and for what it would actually take.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.DL_OUT ?? '/tmp/drive-tools/dither';
mkdirSync(OUT, { recursive: true });
const SPOT = process.env.DL_SPOT ?? 'fixture=at-campsbay';
// The sky band and a hillside band: a shallow aerial-haze ramp is the case the
// dither exists for, and the sky is the largest smooth gradient in the game.
const LEVELS = (process.env.DL_LEVELS ?? '14').split(',').map(Number);
const CHANS = (process.env.DL_CHAN ?? '0,1').split(',').map(Number);

const d = await openDrive({
  // NOT nodraw: this needs a real rendered frame sitting in rtScene to
  // re-composite, and the whole point is that it is only ONE of them.
  spot: `${SPOT}&cam=chase&time=NOON&sunalt=24&cprobe=1`,
  tag: 'dither', settle: 0, bootTimeout: 150000, dpr: 1,
});
const q = (fn, ...a) => d.page.evaluate(fn, ...a);

// Settle, so the frame being judged is of a finished world.
let quiet = 0, pw = -1, pc = -1;
for (let i = 0; i < 120; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells;
  if (quiet >= 4) { console.log(`settled t+${(i + 1) * 3}s`); break; }
}

const size = await q(() => ({ w: innerWidth, h: innerHeight }));
const pats = (await q(() => window.__dither())).pats;
console.log(`patterns: ${pats.join(' ')}`);
console.log(`frame ${size.w}x${size.h}, pixel grid ${JSON.stringify((await q(() => window.__dither())).pix)}`);

/**
 * The median longest run of one exact colour along a row, over a band — decoded
 * in Chromium, which is where every image in this repo gets decoded because
 * there is no image library here.
 */
const RUNS = async ({ b64 }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = false;
  x.drawImage(img, 0, 0);
  const dd = x.getImageData(0, 0, c.width, c.height).data;
  const runs = [];
  let tones = new Set();
  for (let y = 0; y < c.height; y++) {
    let n = 1, best = 1;
    for (let px = 1; px < c.width; px++) {
      const i = (y * c.width + px) * 4, j = i - 4;
      tones.add(`${dd[i]},${dd[i + 1]},${dd[i + 2]}`);
      if (dd[i] === dd[j] && dd[i + 1] === dd[j + 1] && dd[i + 2] === dd[j + 2]) n++;
      else { if (n > best) best = n; n = 1; }
    }
    runs.push(Math.max(best, n));
  }
  runs.sort((a, b) => a - b);
  return { median: runs[runs.length >> 1], worst: runs[runs.length - 1], tones: tones.size };
};

// The sky is the largest shallow ramp in the game; the band under it holds the
// hillside, where the aerial haze crosses a level boundary.
const BANDS = [['sky', 0.06, 0.20], ['land', 0.42, 0.58]];

const rows = [];
for (const levels of LEVELS) {
  for (const chan of CHANS) {
    for (const pat of pats) {
      // Stand the loop down FIRST, then re-composite: with drawing on, the next
      // frame would overwrite the composite this is about to photograph, and
      // the scene under it would have moved.
      await q(() => window.__draw(false));
      const st = await q((p) => window.__dither(p), { pat, levels, chan });
      await d.page.waitForTimeout(250);
      const tag = `${pat}-L${levels}-${chan ? 'rgb' : 'grey'}`;
      const buf = await d.page.screenshot({ timeout: 120000 });
      writeFileSync(`${OUT}/${tag}.png`, buf);
      const b64 = buf.toString('base64');
      const out = { pat, levels, chan };
      for (const [name, y0, y1] of BANDS) {
        const clip = { x: 0, y: Math.round(size.h * y0), width: size.w, height: Math.round(size.h * (y1 - y0)) };
        const band = (await d.page.screenshot({ clip, timeout: 120000 })).toString('base64');
        out[name] = await q(RUNS, { b64: band });
      }
      rows.push(out);
      console.log(`${tag.padEnd(24)} sky run ${String(out.sky.median).padStart(3)} (${out.sky.tones} tones)`
        + `   land run ${String(out.land.median).padStart(3)} (${out.land.tones} tones)`
        + `   [amt ${st.amt}]`);
      void b64;
    }
  }
}

// Rank on the sky band: it is the cleanest shallow ramp, so it is where a
// rounded quantiser shows up as a long run and a good dither as a short one.
const best = [...rows].filter((r) => r.levels === LEVELS[0] && r.chan === 0)
  .sort((a, b) => a.sky.median - b.sky.median);
console.log('\nshortest sky runs at the shipped palette, dither correlated:');
for (const r of best) console.log(`  ${r.pat.padEnd(10)} ${r.sky.median}`);
console.log(`\nframes in ${OUT}`);
console.log(`errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
await d.close();
