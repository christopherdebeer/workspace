// The ladder, seen (node cells/lab/devtools/labyrinth-ladder-look.mjs [--stories=16,17,17:persian] [--region=mediterranean]
// [--zoom=0.3]): each story drawn as the ladder would have it at each rung (realise.ts: `?ladder=1&rung=n`), and as
// it's built (`?ladder=0`), a row a story, on one sheet: static/labyrinth/look-ladder.jpg.
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const { withWood } = await import('./harness.mjs');
const { mkdirSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');
const stories = String(opt.stories ?? '16,17,17:persian').split(','), region = opt.region ?? 'mediterranean', zoom = opt.zoom ?? '0.3';
const cols = [['rung 0', 'ladder=1&rung=0'], ['rung 1', 'ladder=1&rung=1'], ['rung 2', 'ladder=1&rung=2'], ['rung 3', 'ladder=1&rung=3'], ['as built', 'ladder=0']];
const dir = new URL('./out/look/', import.meta.url).pathname, tag = opt.tag ?? 'ladder';
mkdirSync(dir, { recursive: true });
const files = [];
await withWood(async (lab) => {
  for (const sr of stories) for (const [name, q] of cols) {
    const [s, r = region] = sr.split(':');
    const p = await lab.open(`instant&cats=0&story=${s}&zoom=${zoom}&region=${r}&${q}${opt.q ? `&${opt.q}` : ''}`);
    await p.waitForTimeout(6000);
    await p.evaluate(() => { const keep = new Set(); for (const c of document.querySelectorAll('canvas')) for (let e = c; e; e = e.parentElement) keep.add(e); for (const e of document.querySelectorAll('body *')) if (!keep.has(e) && !e.querySelector('canvas')) e.style.visibility = 'hidden'; for (const c of document.querySelectorAll('canvas')) if (c.id !== 'stone') c.style.visibility = 'hidden'; });
    const file = `${dir}${tag}-${s}-${r}-${name.replace(' ', '')}.png`;
    await p.screenshot({ path: file, timeout: 300000 });
    files.push([`story ${s} (${r}), ${name}`, file]);
    console.log(`drawn: ${file}`);
    await p.close();
  }
}, { width: 700, height: 700 });
const sheet = new URL(`../static/labyrinth/look-${tag}.jpg`, import.meta.url).pathname;
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
n = int(sys.argv[2]); fs = [a.split('=', 1) for a in sys.argv[3:]]
ims = [(t, Image.open(f).convert('RGB').resize((420, 420))) for t, f in fs]
rows = (len(ims) + n - 1) // n
s = Image.new('RGB', (420 * n, 420 * rows), 'white')
for q, (t, im) in enumerate(ims):
    x, y = (q % n) * 420, (q // n) * 420
    s.paste(im, (x, y)); ImageDraw.Draw(s).text((x + 8, y + 8), t, fill='black')
s.save(sys.argv[1], quality=85)
`, sheet, String(cols.length), ...files.map(([n, f]) => `${n}=${f}`)]);
console.log(`sheet: ${sheet}`);
