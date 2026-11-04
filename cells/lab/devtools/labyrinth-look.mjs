// The look of the drawing, judged in the same few views of the same place (node cells/lab/devtools/labyrinth-look.mjs
// --tag=NAME): the study (demo.ts story 16: three houses, a tower set into the cliff, an arcade, a stair, olives, the
// stream and its fall, a way out across it into the drawn land), drawn wide, close and far, each view a picture in devtools/out/look/NAME-VIEW.png and all of them on
// one sheet, static/labyrinth/look-NAME.jpg. Every change to the renderer is looked at in these, before and after.
//   --only=VIEW   --size=900   --frames (a time for each view's first frames, as a rough measure: not the phone's)
//   --clay (every surface one clay: the forms alone)   --q=QUERY (one view of its own)   --marks (the drawing's marks by family, the picture faded under them)   --print (all of it on the paper)   --views=wide,far (only those)   --dials=QUERY (laid on every view)
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const { withWood } = await import('./harness.mjs');
const { mkdirSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');

export const VIEWS = [
  { name: 'wide', query: 'story=16&zoom=0.55' },
  { name: 'close', query: 'story=16&zoom=0.2' },
  { name: 'turned', query: 'story=16&zoom=0.5&turn=1' },
  { name: 'far side', query: 'story=16&zoom=0.26&turn=3' },
  { name: 'far', query: 'story=16&zoom=1.2' },
];

// (--q=QUERY: a view of its own instead of the set, for looking at one place: e.g. --q='story=16&zoom=0.12&at=0.9&turn=3')
if (opt.q) VIEWS.splice(0, VIEWS.length, { name: 'q', query: opt.q });
// (--views=wide,far: only those of the set; --dials=QUERY: the dials laid on every view, e.g. --dials='terrain=0.4&shadow=1.2')
if (opt.views) { const want = new Set(String(opt.views).split(',')); VIEWS.splice(0, VIEWS.length, ...VIEWS.filter((v) => want.has(v.name))); }
if (opt.dials) for (const v of VIEWS) v.query += `&${opt.dials}`;
const tag = opt.tag ?? 'now', size = Number(opt.size ?? 900);
const dir = new URL('./out/look/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const files = [];
await withWood(async (lab) => {
  for (const v of VIEWS) {
    if (opt.only && v.name !== opt.only) continue;
    const p = await lab.open(`instant&cats=0&${v.query}${opt.marks ? '&marks' : ''}${opt.print ? '&paper' : ''}${opt.clay ? '&clay' : ''}`);
    await p.waitForTimeout(6000);
    // (only the drawing: the brushes and buttons hidden)
    await p.evaluate(() => { const keep = new Set(); for (const c of document.querySelectorAll('canvas')) for (let e = c; e; e = e.parentElement) keep.add(e); for (const e of document.querySelectorAll('body *')) if (!keep.has(e) && !e.querySelector('canvas')) e.style.visibility = 'hidden'; for (const c of document.querySelectorAll('canvas')) if (c.id !== 'stone') c.style.visibility = 'hidden'; });
    if (opt.frames) {
      const ms = await p.evaluate(async () => { const t0 = performance.now(); let n = 0; await new Promise((r) => { const f = () => (++n < 20 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }); return (performance.now() - t0) / 20; });
      console.log(`${v.name}: ${ms.toFixed(1)} ms a frame (here, in software: not the phone's)`);
    }
    const file = `${dir}${tag}-${v.name}.png`;
    await p.screenshot({ path: file, timeout: 300000 });
    files.push([v.name, file]);
    console.log(`drawn: ${file}`);
    await p.close();
  }
}, { width: size, height: size });
// (one sheet of them, three across, the view's name in the corner)
const sheet = new URL(`../static/labyrinth/look-${tag}.jpg`, import.meta.url).pathname;
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = [a.split('=', 1) for a in sys.argv[2:]]
ims = [(n, Image.open(f).convert('RGB').resize((600, 600))) for n, f in fs]
cols = min(2, len(ims)); rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (600 * cols, 600 * rows), 'white')
for q, (n, im) in enumerate(ims):
    x, y = (q % cols) * 600, (q // cols) * 600
    s.paste(im, (x, y)); ImageDraw.Draw(s).text((x + 10, y + 10), n, fill='black')
s.save(sys.argv[1], quality=85)
`, sheet, ...files.map(([n, f]) => `${n}=${f}`)]);
console.log(`sheet: ${sheet}`);
