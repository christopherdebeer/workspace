// The traditions, judged against each other (node cells/lab/devtools/labyrinth-traditions.mjs [--only=same|across]
// [--tradition=timber]): what's built held fixed and its finish let go (regions.ts).
// - **same**: one build (the study, story 16) in each tradition, close and wide: what's built must be the same in each
//   (the checks hold it: labyrinth.test.mjs), its silhouettes, walls, roofs and openings each tradition's own;
//   static/labyrinth/traditions-same.jpg, a column to a tradition.
// - **across**: one tradition over several builds (stories 8, 9, 13, 16): various, and still one place;
//   static/labyrinth/traditions-across-NAME.jpg.
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const { withWood } = await import('./harness.mjs');
const { mkdirSync } = await import('node:fs');
const { execFileSync } = await import('node:child_process');

const TRADITIONS = ['mediterranean', 'persian', 'timber', 'eaves'];
const dir = new URL('./out/traditions/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const shots = [];
await withWood(async (lab) => {
  const draw = async (name, query) => {
    const p = await lab.open(`instant&cats=0&${query}`);
    await p.waitForTimeout(6000);
    await p.evaluate(() => { const keep = new Set(); for (const c of document.querySelectorAll('canvas')) for (let e = c; e; e = e.parentElement) keep.add(e); for (const e of document.querySelectorAll('body *')) if (!keep.has(e) && !e.querySelector('canvas')) e.style.visibility = 'hidden'; for (const c of document.querySelectorAll('canvas')) if (c.id !== 'stone') c.style.visibility = 'hidden'; });
    const file = `${dir}${name}.png`;
    await p.screenshot({ path: file, timeout: 300000 });
    console.log(`drawn: ${file}`);
    await p.close();
    return file;
  };
  if (!opt.only || opt.only === 'same') for (const t of TRADITIONS) for (const [v, q] of [['close', 'zoom=0.24'], ['wide', 'zoom=0.5']]) shots.push(['same', `${t} ${v}`, await draw(`same-${t}-${v}`, `story=16&region=${t}&${q}`)]);
  const t = opt.tradition ?? 'timber';
  if (!opt.only || opt.only === 'across') for (const s of [8, 9, 13, 16]) shots.push([`across-${t}`, `${t}: story ${s}`, await draw(`across-${t}-${s}`, `story=${s}&region=${t}&zoom=0.4`)]);
}, { width: 700, height: 700 });
// (each set on a sheet: the same build a column to a tradition (close over wide); one tradition's builds two across)
for (const set of [...new Set(shots.map((s) => s[0]))]) {
  const fs = shots.filter((s) => s[0] === set), cols = set === 'same' ? TRADITIONS.length : 2;
  const sheet = new URL(`../static/labyrinth/traditions-${set}.jpg`, import.meta.url).pathname;
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
cols = int(sys.argv[2]); fs = [a.split('=', 1) for a in sys.argv[3:]]
ims = [(n, Image.open(f).convert('RGB').resize((450, 450))) for n, f in fs]
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (450 * cols, 450 * rows), 'white')
for q, (n, im) in enumerate(ims):
    # (the same build: a tradition to a column, close over wide)
    c, r = (q // rows, q % rows) if cols == 4 else (q % cols, q // cols)
    s.paste(im, (c * 450, r * 450)); ImageDraw.Draw(s).text((c * 450 + 8, r * 450 + 8), n, fill='black')
s.save(sys.argv[1], quality=85)
`, sheet, String(cols), ...fs.map(([, n, f]) => `${n}=${f}`)]);
  console.log(`sheet: ${sheet}`);
}
