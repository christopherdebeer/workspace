/**
 * ── DOES A TREE ACQUIRE DETAIL, OR EXISTENCE? ──
 *
 *   node cells/drive/devtools/tree-impostor.mjs
 *   FIX=at-campsbay TRIS=600000 node .../tree-impostor.mjs
 *
 * The impostor tier draws the candidates admission turned down. This measures
 * what it stands up and what it changes on screen.
 *
 * ONE BOOT, INTERLEAVED. `__impostor(on)` re-runs the refresh synchronously, so
 * off / on / off happen on the SAME settled world — the repeat is the noise
 * floor at the same separation as the cross pair, and without it a two-boot
 * comparison carries the wildlife, the sward's phase and the arrival order
 * before it carries the tier. Every other tree switch is read once at boot and
 * forces exactly that; this one does not.
 *
 * `TRIS` is RAW TRIANGLES, which is what `?treetris=` takes — the first two
 * runs of this tool passed 0.35 and 1.2 meaning megatriangles, set the budget
 * to ONE triangle, and admitted no skeletons at all. An A/B between nothing
 * and impostors cannot show a handoff: there is nothing to hand off from.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-yosemite';
const TRIS = Number(process.env.TRIS ?? 900000);
const SECS = Number(process.env.SECS ?? 240);
const OUT = process.env.DRIVE_WORK ?? '/tmp/drive-tools';
mkdirSync(OUT, { recursive: true });

// A pinned control, because the ink witness below has to be shown to FAIL on
// the fault it names or it is decoration. `REV=<sha>` rebuilds the revision's
// whole client/ — not just main.ts — which matters here for the obvious reason:
// the fault lives in tree-impostor.ts, a sibling.
const REV = process.env.REV;
const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&treetris=${TRIS}`,
  tag: 'impostor', settle: 0, bootTimeout: 300000, ...(REV ? { rev: REV } : {}),
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

let quiet = 0, pp = '';
for (let i = 0; i < SECS / 3; i++) {
  await d.page.waitForTimeout(3000);
  const e = await q(() => window.__ez());
  const n = `${e.tris ?? 0}/${e.impostor?.drawn ?? 0}`;
  quiet = (n === pp && n !== '0/0') ? quiet + 1 : 0; pp = n;
  if (quiet >= 3) break;
}
const settled = quiet >= 3;
await q(() => window.__hud?.(false));

const legs = [];
for (const [tag, on] of [['a1', false], ['b1', true], ['a2', false]]) {
  await q((v) => window.__impostor(v), on);
  await d.page.waitForTimeout(1200);
  await d.page.screenshot({ path: `${OUT}/imp-${tag}.png` });
  legs.push(await q(() => ({ imp: window.__impostor(), ez: window.__ez() })));
}
// Back on, and read the census for an INDEPENDENT witness: `__ez` reports what
// the refresh WROTE, which a staged instance satisfies as well as a drawn one.
// `byTris` is the top twelve by triangle count, so a small tier is absent
// rather than zero — which is a different statement and must be printed as one.
await q(() => window.__impostor(true));
const census = await q(() => window.__census());
const errs = d.errors.slice(0, 4);
await d.close();

// ── CROP TO WHERE THE TIER DRAWS ──
// A frame-wide diff of a chase view is mostly sward and sky, and this tier
// draws in a band at the treeline: read whole, a real change came out at 2.5x
// its floor, and read over the band at eleven times it. A mean over pixels the
// term cannot reach is not a weaker measurement, it is a different one.
// AND THE BAND STOPS ABOVE THE SWARD. Taken 110 rows deep it reached the grass,
// whose own clock moves it between legs: floor 3.203/255, signal 10.4, a ratio
// of three. Seventy rows — the canopy alone — reads floor 0.325 and signal
// 10.673, which is THIRTY-THREE times it. The signal never moved; what changed
// is how much of the measurement was of something else.
const BAND = process.env.BAND ?? '200,300,190,70';

/**
 * ── AND WHAT COLOUR IT DREW, WHICH A DIFF CANNOT SEE ──
 *
 * The band signal above measures how many pixels MOVED and by how much. A tier
 * drawing solid black holes in a green hillside moves a very great many pixels
 * by a very great deal, so it scores exactly as a working tier does — and did:
 * this tool reported a canopy-band signal of 10.4/255 against a 0.325 floor,
 * thirty-three times it, on a build whose impostors were rendering pure black
 * because their geometry carried no `color` attribute. The seat found that from
 * a photograph, which is the wrong instrument to need.
 *
 * So the witness is the INK: over the pixels the tier changed, the mean luma in
 * the ON frame beside the mean luma the OFF frame had there. A tier that stands
 * trees up where there was hillside darkens that band somewhat; one that draws
 * holes takes it toward zero, and the ratio says which. It is a statement about
 * the colour rather than about the change, and nothing else here can make one.
 *
 * THE BAR IS IN PALETTE STEPS AND ITS PROVENANCE IS A PINNED CONTROL. One step
 * of this fourteen-level palette is about 18/255. Measured at at-yosemite, the
 * same fixture and crop, the broken build (REV=42448df) against the fix:
 *
 *   ink ON        18.3/255  (one step — black lifted only by the fade's own
 *                            mix toward the ground)   against   44.1  (two and
 *                            a half steps: a lit crown)
 *   under 9/255   27.3% of the changed pixels         against    2.2%
 *   band SIGNAL   10.524/255                          against    7.83
 *
 * Read that last row twice. The DIFF SCORED THE BROKEN BUILD HIGHER, because a
 * hole moves more luma than a tree does — so the metric this tool was built on
 * was actively rewarding the fault. Two steps and a tenth of the pixels are the
 * bar: both sides of it by a wide margin, and stated in the unit the renderer
 * has rather than chosen to separate two numbers.
 */
async function inkOfChanged(aP, bP, cropStr) {
  const { chromium } = await import('playwright');
  const cr = cropStr.split(',').map(Number);
  const b64 = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const br = await chromium.launch({
    executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
    args: ['--no-sandbox'],
  });
  const pg = await br.newPage();
  const r = await pg.evaluate(async (o) => {
    const load = (src) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src;
    });
    const [A, B] = await Promise.all([load(o.a), load(o.b)]);
    const [cx0, cy0, w, h] = o.cr;
    const px = (img) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingEnabled = false;
      x.drawImage(img, cx0, cy0, w, h, 0, 0, w, h);
      return x.getImageData(0, 0, w, h).data;
    };
    const da = px(A), db = px(B);
    const L = (d, j) => d[j] * 0.299 + d[j + 1] * 0.587 + d[j + 2] * 0.114;
    let n = 0, onSum = 0, offSum = 0, dark = 0;
    for (let i = 0; i < w * h; i++) {
      const j = i * 4, la = L(da, j), lb = L(db, j);
      if (Math.abs(la - lb) <= 3) continue;
      n++; offSum += la; onSum += lb;
      // Under a fourteen-level palette one step is about 18/255, so a pixel
      // below half a step of black is ink nothing in this world paints.
      if (lb < 9) dark++;
    }
    return n === 0 ? { n: 0 } : {
      n, on: +(onSum / n).toFixed(1), off: +(offSum / n).toFixed(1),
      darkShare: +(dark / n * 100).toFixed(1),
    };
  }, { a: b64(aP), b: b64(bP), cr });
  await br.close();
  return r;
}
const diff = (a, b, out, crop) => {
  const t = execFileSync('node', [new URL('./imgdiff.mjs', import.meta.url).pathname,
    `${OUT}/imp-${a}.png`, `${OUT}/imp-${b}.png`, `${OUT}/${out}`,
    ...(crop ? [`--crop=${BAND}`, '--zoom=4'] : [])], { encoding: 'utf8' });
  // The last line is the output PATH. The numbers are the line before it, and
  // taking the last one printed a filename where a measurement should be.
  const lines = t.trim().split('\n');
  return lines.find((l) => l.includes('mean luma delta')) ?? lines.pop();
};

console.log(`\n── ${FIX}${REV ? ` · REV ${REV}` : ''} · budget ${TRIS} tris · ${settled ? 'settled' : 'NOT SETTLED — provisional'}`);
if (errs.length) {
  console.log(`  !! PAGE ERRORS: ${errs.join(' | ')}`);
  console.log('  !! A GLSL link failure logs and throws nothing: the tier would be ABSENT');
  console.log('     while every count below still read correct. Read no further.');
}
const [a1, b1] = legs;
console.log(`  skeletons placed ${b1.ez.placed?.length ?? '—'} logged · ${(b1.ez.tris / 1e6).toFixed(2)}M tris`);
console.log(`  impostors drawn  ${b1.imp.drawn} of ${b1.imp.offered} offered`
  + ` · ${(b1.imp.tris / 1000).toFixed(1)}k tris`
  + ` · ${(b1.imp.tris / (b1.ez.tris + b1.imp.tris) * 100).toFixed(2)}% of the vegetation bill`);
console.log(`  off leg drew ${a1.imp.drawn} (must be 0)`);
console.log(`  edges ${JSON.stringify(b1.ez.edge)}`);
const inScene = census.byTris?.['veg-impostor'];
console.log(`  census: ${inScene === undefined
  ? 'veg-impostor outside the top twelve by triangles — absent from this list is not zero'
  : `veg-impostor ${inScene} tris in the scene`}`);
console.log(`\n  whole frame`);
console.log(`    FLOOR  (off against off) ${diff('a1', 'a2', 'imp-floor.png')}`);
console.log(`    SIGNAL (off against on)  ${diff('a1', 'b1', 'imp-signal.png')}`);
console.log(`  the band the tier draws in (${BAND})`);
console.log(`    FLOOR  (off against off) ${diff('a1', 'a2', 'imp-band-floor.png', true)}`);
console.log(`    SIGNAL (off against on)  ${diff('a1', 'b1', 'imp-band.png', true)}`);
const ink = await inkOfChanged(`${OUT}/imp-a1.png`, `${OUT}/imp-b1.png`, BAND);
if (!ink.n) {
  console.log('  !! the tier changed no pixel in the band — it is not drawing here');
} else {
  console.log(`\n  the ink the tier laid down, over the ${ink.n} band pixels it changed`);
  console.log(`    mean luma  ON ${ink.on}/255  ·  the hillside it replaced ${ink.off}/255`
    + `  ·  ${ink.darkShare}% under half a palette step of black`);
  if (ink.on < 36 || ink.darkShare > 10) {
    console.log('  !! THE TIER IS DRAWING BLACK, and the diff above cannot tell you so:');
    console.log('     a hole moves as many pixels as a tree. Check the geometry carries a');
    console.log("     `color` attribute — vertexColors defines USE_COLOR, three's color_vertex");
    console.log('     multiplies vColor by it, and an undeclared attribute reads as zero.');
  }
}
console.log(`\n  Frames in ${OUT}: imp-a1/b1/a2.png, imp-floor.png, imp-signal.png`);
