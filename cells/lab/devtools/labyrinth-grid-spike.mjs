// The grid spike (node cells/lab/devtools/labyrinth-grid-spike.mjs [--only=numbers|shots]): would a finer grid, each
// cell four in plan and its storeys as tall, make thin walls and paths the default and the in-between placeable? The
// courtyard house three ways: as it is (story 17, cells); the same house on the half grid (18, each cell made four:
// what the house costs there); the house as the half grid would have it (19: thin piers, a half setback, a recess,
// pilasters, a thin wall through the court, a half-wide path). Edge walls (walls on the lines between cells, rooms
// filled between them) are reckoned by hand in static/labyrinth-grid.md: the model has nothing to build them with yet.
// - **numbers**: for each, in the middle sea and on the plateau: cells, how long it takes to replay and to draw (the
//   median of five), what's drawn (vertices); and what it takes a hand to build, by a model of the gestures (below).
// - **shots**: each at a phone's size (390 × 844, as the app opens), the half grid seen in its own proportions
//   (`?plan=0.5`), and the pixels a cell (and a half cell) comes to on the screen; static/labyrinth/grid-spike.jpg.
//
// The gestures, modelled: a storey's stone is laid by strokes, each a straight run (the fewest runs, along i or along
// j, whichever is fewer); a stroke's length is how far the finger goes (a cell one unit; a half cell half). "Taps" is
// raising cell by cell: one a cell. "Brush 2" is the half grid with a brush two half cells wide,
// laid anywhere (it covers a line and the one beside it). An arch cut is a stroke.
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
import { build } from 'esbuild';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };

const STORIES = [[17, 'cells', 1], [18, 'half grid, as cells', 0.5], [19, 'half grid, its own', 0.5]];
if (!opt.only || opt.only === 'numbers') {
  const { story } = await load('../client/labyrinth/demo.ts');
  const ME = await load('../client/labyrinth/mesh.ts');
  const RG = await load('../client/labyrinth/regions.ts');
  const MO = await load('../client/labyrinth/model.ts');
  const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  /** the fewest straight runs that lay these cells (one storey), and the finger's travel over them */
  const runs = (cells) => {
    const along = (a, b) => {
      const lines = new Map();
      for (const c of cells) { const l = lines.get(c[b]) ?? []; l.push(c[a]); lines.set(c[b], l); }
      let n = 0;
      for (const l of lines.values()) { l.sort((x, y) => x - y); for (let q = 0; q < l.length; q++) if (q === 0 || l[q] !== l[q - 1] + 1) n++; }
      return n;
    };
    return Math.min(along(0, 1), along(1, 0));
  };
  /** the same with a brush two half cells wide, laid anywhere (not only on the cells' old lines): each stroke a run
   * along a line and the next one beside it; the fewest strokes, along i or j, and the finger's travel */
  const banded = (cells) => {
    const along = (a, b) => {
      const has = new Set(cells.map((c) => `${c[a]},${c[b]}`)), done = new Set(), lines = [...new Set(cells.map((c) => c[b]))].sort((x, y) => x - y);
      let n = 0, len = 0;
      for (const l of lines) {
        const xs = cells.filter((c) => c[b] === l && !done.has(`${c[a]},${l}`)).map((c) => c[a]).sort((x, y) => x - y);
        for (let q = 0; q < xs.length;) {
          let e = q; while (e + 1 < xs.length && xs[e + 1] === xs[e] + 1) e++;
          n++; len += xs[e] - xs[q] + 1;
          for (let x = xs[q]; x <= xs[e]; x++) { done.add(`${x},${l}`); if (has.has(`${x},${l + 1}`)) done.add(`${x},${l + 1}`); }
          q = e + 1;
        }
      }
      return [n, len];
    };
    const p = along(0, 1), q = along(1, 0);
    return p[0] <= q[0] ? p : q;
  };
  const byStorey = (w) => {
    const ks = new Map();
    for (const c of w.mass.keys()) { const [k, i, j] = MO.unkey(c); const s = ks.get(k) ?? []; s.push([i, j]); ks.set(k, s); }
    return ks;
  };
  const effort = (w, unit) => {
    let strokes = 0, travel = 0, taps = 0, b2 = 0, b2travel = 0;
    for (const cells of byStorey(w).values()) {
      strokes += runs(cells); travel += cells.length * unit; taps += cells.length;
      if (unit < 1) { const [n, l] = banded(cells); b2 += n; b2travel += l * unit; }
    }
    // (an arch cut: a stroke a run)
    const cuts = new Map();
    for (const c of w.archways.keys()) { const [k, i, j] = MO.unkey(c); const s = cuts.get(k) ?? []; s.push([i, j]); cuts.set(k, s); }
    let cut = 0; for (const cells of cuts.values()) cut += runs(cells);
    return { strokes: strokes + cut, travel: +travel.toFixed(1), taps, ...(unit < 1 ? { brush2: b2 + cut, brush2travel: +b2travel.toFixed(1) } : {}) };
  };
  const rows = [];
  for (const t of ['mediterranean', 'persian']) {
    RG.setRegions(t);
    for (const [s, name, unit] of STORIES) {
      const replay = [], draw = []; let m, w;
      for (let q = 0; q < 5; q++) {
        ME.forgetGround();
        const t0 = performance.now(); w = story(s); const t1 = performance.now(); m = ME.buildMesh(w); const t2 = performance.now();
        replay.push(t1 - t0); draw.push(t2 - t1);
      }
      rows.push({ tradition: t, story: s, name, cells: w.mass.size, replayMs: +median(replay).toFixed(1), meshMs: +median(draw).toFixed(1), vertices: m.count, ...(t === 'mediterranean' ? effort(w, unit) : {}) });
    }
  }
  console.table(rows);
}

if (!opt.only || opt.only === 'shots') {
  const { withWood } = await import('./harness.mjs');
  const { mkdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const dir = new URL('./out/grid-spike/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const shots = [];
  await withWood(async (lab) => {
    const draw = async (name, label, query, plan) => {
      const p = await lab.open(`instant&cats=0&${query}${plan === 1 ? '' : `&plan=${plan}`}`);
      await p.waitForTimeout(6000);
      // (a cell on the screen: the camera's half height is the view's zoom, in units, over the canvas's height)
      const px = await p.evaluate((plan) => { const c = document.getElementById('stone'), v = window.__labyrinth.view; return (c.clientHeight / (2 * v.zoom)) * plan; }, plan);
      await p.evaluate(() => { const keep = new Set(); for (const c of document.querySelectorAll('canvas')) for (let e = c; e; e = e.parentElement) keep.add(e); for (const e of document.querySelectorAll('body *')) if (!keep.has(e) && !e.querySelector('canvas')) e.style.visibility = 'hidden'; for (const c of document.querySelectorAll('canvas')) if (c.id !== 'stone') c.style.visibility = 'hidden'; });
      const file = `${dir}${name}.png`;
      await p.screenshot({ path: file, timeout: 300000 });
      console.log(`drawn: ${file} (a grid square ${px.toFixed(1)} px)`);
      shots.push([`${label} · a square ${px.toFixed(0)} px`, file]);
      await p.close();
    };
    for (const [s, name, plan] of STORIES) await draw(`plateau-${s}`, `${s} ${name}, the plateau`, `story=${s}&region=persian`, plan);
    for (const [s, name, plan] of STORIES) await draw(`sea-${s}`, `${s} ${name}, the middle sea`, `story=${s}&region=mediterranean`, plan);
    // (close, as a hand would zoom in to place a half cell)
    for (const [s, name, plan] of STORIES.slice(1)) await draw(`close-${s}`, `${s} ${name}, the plateau, zoomed in`, `story=${s}&region=persian&zoom=0.3&turn=1`, plan);
  });
  const sheet = new URL('../static/labyrinth/grid-spike.jpg', import.meta.url).pathname;
  execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageDraw
fs = [a.split('=', 1) for a in sys.argv[2:]]
W, H, cols = 360, 780, 3
ims = [(n, Image.open(f).convert('RGB').resize((W, H))) for n, f in fs]
rows = (len(ims) + cols - 1) // cols
s = Image.new('RGB', (W * cols, H * rows), 'white')
for q, (n, im) in enumerate(ims):
    c, r = q % cols, q // cols
    s.paste(im, (c * W, r * H)); ImageDraw.Draw(s).text((c * W + 8, r * H + 8), n, fill='black')
s.save(sys.argv[1], quality=85)
`, sheet, ...shots.map(([n, f]) => `${n}=${f}`)]);
  console.log(`sheet: ${sheet}`);
}
