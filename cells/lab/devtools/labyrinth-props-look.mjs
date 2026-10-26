// What the uses leave outside, seen (node cells/lab/devtools/labyrinth-props-look.mjs): close on each workshop's door
// in story 21 (a kiln, a carpenter, a mason, a glassworks), the store's hoist and the lookout's flag, a house's door,
// the north's shops, and story 17's gate; one sheet, static/labyrinth/look-props.jpg.
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const { withWood } = await import('./harness.mjs');
const { mkdirSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');
const VIEWS = [
  ['kiln', 'story=21&at=-13.-5.0&turn=0'], ['carpenter', 'story=21&at=-5.-9.0&turn=3'], ['mason', 'story=21&at=7.-13.0&turn=2'], ['glassworks', 'story=21&at=27.-7.0&turn=0'],
  ['store', 'story=21&at=-1.13.1&turn=1'], ['a house', 'story=21&at=9.4.0&turn=0'], ['shops (the north)', 'story=21&at=-5.-10.0&turn=2&region=timber&zoom=0.12'], ['a gatehouse', 'story=17&at=5.1.0&turn=2&zoom=0.16'],
];
const dir = new URL('./out/look/', import.meta.url).pathname, files = [];
mkdirSync(dir, { recursive: true });
await withWood(async (lab) => {
  for (const [name, q] of VIEWS) {
    const p = await lab.open(`instant&cats=0&zoom=0.08&${q}`);
    await p.waitForTimeout(6000);
    await p.evaluate(() => { const keep = new Set(); for (const c of document.querySelectorAll('canvas')) for (let e = c; e; e = e.parentElement) keep.add(e); for (const e of document.querySelectorAll('body *')) if (!keep.has(e) && !e.querySelector('canvas')) e.style.visibility = 'hidden'; for (const c of document.querySelectorAll('canvas')) if (c.id !== 'stone') c.style.visibility = 'hidden'; });
    const file = `${dir}props-${name.replace(/\W+/g, '-')}.png`;
    await p.screenshot({ path: file, timeout: 300000 });
    files.push([name, file]);
    await p.close();
  }
}, { width: 600, height: 600 });
const sheet = new URL('../static/labyrinth/look-props.jpg', import.meta.url).pathname;
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = [a.split('=', 1) for a in sys.argv[2:]]
s = Image.new('RGB', (500 * 4, 500 * ((len(fs) + 3) // 4)), 'white')
for q, (t, f) in enumerate(fs):
    x, y = (q % 4) * 500, (q // 4) * 500
    s.paste(Image.open(f).convert('RGB').resize((500, 500)), (x, y)); ImageDraw.Draw(s).text((x + 8, y + 8), t, fill='black')
s.save(sys.argv[1], quality=85)
`, sheet, ...files.map(([n, f]) => `${n}=${f}`)]);
console.log(`sheet: ${sheet}`);
