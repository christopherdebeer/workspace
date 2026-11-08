// Motion and timing for the composed scene (node cells/lab/devtools/splats-motion.mjs). Static boards can't show
// contour handovers, gates opening, halo flicker or disappearing supports, so:
// - an orbit stepped 10° at a time (36 steps), a few frames rendered at each so the eased gates move as they would,
//   in four configurations (sparse and resolved, with the halo on and off); each step's frame saved, and the change
//   from the previous frame measured (mean absolute difference of the grey image, 0..255). A pop is a step whose change
//   is far above the median; the ratio of the largest to the median says how even the motion is;
// - edit latency: the seam dragged ten times, deposit and assemble-and-upload times each (headless Chrome renders in
//   software, so these are upper bounds for the CPU side, not phone timings).
// Writes devtools/out/motion/*.png and devtools/out/motion.json, and prints a summary.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const out = new URL('./out/motion/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const results = {};
await withWood(async (wood) => {
  const page = await wood.open('scene=composed&res=1&clean&look=wash');
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const C = (f, ...a) => page.evaluate(([f, a]) => window.__splats.composed[f](...a), [f, a]);
  const B = (f, ...a) => page.evaluate(([f, a]) => window.__splats.bench[f](...a), [f, a]);
  await S('frame', null);
  for (const [nm, d, halo] of [['sparse', 0.25, true], ['resolved', 1, true], ['resolved-nohalo', 1, false], ['sparse-nohalo', 0.25, false]]) {
    await S('setDetail', d); await C('setHalo', halo);
    const gates = [];
    for (let k = 0; k <= 36; k++) {
      await S('at', 0.6 + (k / 36) * Math.PI * 2, 0.3);
      // (a few frames, so the sort and the gates catch up as they would in motion)
      await page.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 3 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      const buf = await page.screenshot({ type: 'png' });
      writeFileSync(`${out}${nm}-${String(k).padStart(3, '0')}.png`, buf);
      gates.push(await page.evaluate(() => window.__splats.composed.gates));
    }
    results[nm] = { gates };
  }
  // ─── edit latency ───
  await S('setDetail', 1); await S('frame', 'stone'); await S('at', 0.6, 0.3);
  const seam = (await page.evaluate(() => window.__splats.bench.state.items.findIndex((i) => i.name === 'seam')));
  await B('select', seam);
  const times = [];
  for (let k = 0; k < 10; k++) {
    const h = await page.evaluate((s) => window.__splats.bench.state.items[s].ctrl[2], seam);
    await B('drag', 2, [h[0] + 0.01 * (k % 2 ? -1 : 1), h[1] + 0.01, h[2]]);
    times.push(await page.evaluate(() => window.__splats.bench.state.lastEdit));
  }
  results.edits = times;
}, { width: 390, height: 520 });
// (the frame-to-frame change, worked out in Python with Pillow)
const py = `
import json,sys
from PIL import Image, ImageChops, ImageStat
names=sys.argv[2:]; out={}
for nm in names:
  prev=None; d=[]
  for k in range(37):
    im=Image.open(f"{sys.argv[1]}{nm}-{k:03d}.png").convert('L')
    if prev is not None: d.append(ImageStat.Stat(ImageChops.difference(im,prev)).mean[0])
    prev=im
  s=sorted(d); med=s[len(s)//2]
  out[nm]={'median':round(med,3),'max':round(max(d),3),'ratio':round(max(d)/med,2),'worst_step':d.index(max(d))+1,'steps':[round(x,3) for x in d]}
print(json.dumps(out))`;
const diffs = JSON.parse(execFileSync('python3', ['-c', py, out, 'sparse', 'resolved', 'resolved-nohalo', 'sparse-nohalo']).toString());
for (const k of Object.keys(diffs)) results[k].diff = diffs[k];
writeFileSync(new URL('./out/motion.json', import.meta.url).pathname, JSON.stringify(results, null, 1));
for (const k of Object.keys(diffs)) console.log(`${k.padEnd(16)} change per 10° step: median ${diffs[k].median}, max ${diffs[k].max} (step ${diffs[k].worst_step}, ${diffs[k].worst_step * 10}°), max/median ${diffs[k].ratio}`);
const e = results.edits, avg = (f) => (e.reduce((s, x) => s + f(x), 0) / e.length).toFixed(1);
console.log(`seam edit (10 drags): deposit ${avg((x) => x.deposit)} ms, assemble + upload ${avg((x) => x.upload)} ms, ${e[0].elements} elements, ~${e[0].marks} marks`);
