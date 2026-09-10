/**
 * DOES THE WIND REACH THE TREES?
 *
 *   node cells/drive/devtools/tree-wind.test.mjs [spot]
 *
 * The complaint was that a stiff breeze lays the sward over between a hundred
 * perfectly rigid lampposts, and the reason it survived so long is that no
 * probe could see it: a material that had silently never been patched looked
 * exactly like one that had.
 *
 * Two instruments, because neither alone is enough:
 *
 *   1. __fxchain() says which materials CARRY the wind. This is the cheap
 *      structural check, and it is the one that catches the failure this file's
 *      neighbours have been bitten by twice — onBeforeCompile is one slot and
 *      three helpers want it, so an effect can be present in the source,
 *      correct, and assigned straight over the top of another.
 *   2. PIXELS. Carrying a uniform proves nothing about motion: a shader that
 *      fails to link logs to the console and throws nothing, and the geometry
 *      simply stops moving. So the frame is photographed twice a beat apart in
 *      a gale, and again with ?treewind=0, and the two change fractions are
 *      compared. The sward moves in BOTH runs, which is exactly why the
 *      comparison is against the other run rather than against zero.
 *
 * Decoded inside the page, like banding.test.mjs — node has no PNG reader and
 * does not need one.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = process.argv[2] || 'lat=48.7000&lon=2.0500&h=0&cam=chase&wx=clear&time=NOON';
const GALE = 70;

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const decode = async (page, b64, slot) => page.evaluate(async ([b, k]) => {
  const img = new Image();
  await new Promise((go, no) => { img.onload = go; img.onerror = no; img.src = `data:image/png;base64,${b}`; });
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  (window.__shots ??= {})[k] = x.getImageData(0, 0, c.width, c.height).data;
  return { w: c.width, h: c.height };
}, [b64, slot]);

async function run(tag, treewind) {
  const d = await openDrive({ spot: `${SPOT}&wind=${GALE}&winddir=250&treewind=${treewind}`, tag, settle: 20000 });
  // Stand still: a moving truck changes every pixel and would drown the signal.
  await d.page.evaluate(() => { window.__hold(0, 0, 1); });
  const chain = await d.page.evaluate(() => window.__fxchain());
  const wind = await d.page.evaluate(() => window.__wind(20));
  await decode(d.page, (await d.page.screenshot()).toString('base64'), 'a');
  // A beat, in SIM seconds — the sway's period at 20m is about 2.3s, so a
  // second and a half is most of a swing and not a whole one.
  await d.page.evaluate(() => new Promise((r) => {
    const t0 = window.__clock().simS; let f = 0;
    const w = () => (window.__clock().simS - t0 > 1.5 || ++f > 250 ? r() : requestAnimationFrame(w));
    requestAnimationFrame(w);
  }));
  await decode(d.page, (await d.page.screenshot()).toString('base64'), 'b');
  // Fraction of pixels that moved by more than a palette step. The world is
  // quantised to 14 levels, so 8 is comfortably above dithering.
  const moved = await d.page.evaluate(() => {
    const A = window.__shots.a, B = window.__shots.b;
    let n = 0, tot = 0;
    for (let i = 0; i < A.length; i += 4) {
      tot++;
      if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 8) n++;
    }
    return tot ? n / tot : 0;
  });
  await d.shot(`${tag}-frame`);
  await d.page.evaluate(() => { window.__hold(null); });
  const errs = d.errors.slice();
  await d.close();
  return { chain, wind, moved, errs };
}

const on = await run('treewind-on', 0.085);
console.log('fxchain:', JSON.stringify(on.chain));
console.log('wind:   ', JSON.stringify(on.wind));
check('the leaf material carries the wind', (on.chain.leaf ?? []).includes('wind'), on.chain.leaf);
check('the skeletons carry the wind', (on.chain.ez ?? []).includes('wind'), on.chain.ez);
check('the sward still carries it', (on.chain.grass ?? []).includes('wind'), on.chain.grass);
check('the skeletons stand in the same weather as everything else',
  (on.chain.ez ?? []).includes('terrainFx'), on.chain.ez);
// PRESENT AND WRONG LOOKED EXACTLY LIKE PRESENT AND RIGHT. Every one of these
// is an InstancedMesh, and vWorldP fed the cloud shadow and the sun march from
// the vertex's position in the GEOMETRY — the same two metres from the origin
// for a tree here and a tree forty kilometres away.
for (const m of ['leaf', 'ez', 'grass', 'stone']) {
  check(`${m}'s world position knows where its instance is`,
    (on.chain[m] ?? []).includes('worldInst'), on.chain[m]);
}
check('wood and stone stay rigid',
  !(on.chain.wood ?? []).includes('wind') && !(on.chain.stone ?? []).includes('wind'),
  { wood: on.chain.wood, stone: on.chain.stone });
check('the gale reached the model', on.wind.kmh >= GALE - 1, on.wind);
// 250 FROM is 70 TOWARD, and the gust vector is in the toward convention.
check('…blowing the way it was asked to', on.wind.toward === 70, on.wind);
check('no page errors with the trees moving', on.errs.length === 0, on.errs);

const off = await run('treewind-off', 0);
console.log(`\nchanged pixels over 1.5 sim seconds in a ${GALE}km/h wind:`);
console.log(`  trees swaying : ${(on.moved * 100).toFixed(2)}%`);
console.log(`  trees rigid   : ${(off.moved * 100).toFixed(2)}%   (the sward, in both)`);
console.log(`  the trees     : ${((on.moved - off.moved) * 100).toFixed(2)} points`);
check('the frame moves more with the trees in the wind than without',
  on.moved > off.moved * 1.15 && on.moved - off.moved > 0.004, { on: on.moved, off: off.moved });

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(on.errs.concat(off.errs));
