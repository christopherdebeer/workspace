// The city's dead ends (reach.ts): roofs with no way on to another roof under a set of dials (the leap's envelope), before and
// after the city bridges them (where the street is a fall), over a block of chunks for a few seeds; and how many checkpoints
// it places.
//
//   node cells/lab/devtools/roofjumps-reach.mjs [--seeds 1,2,3,4,5] [--r 2] [--dials "gravity=29.5&…"]
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './reach'; export * from './tune';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SEEDS = arg('seeds', '1,2,3,4,5').split(',').map(Number), RR = Number(arg('r', 2)), DIALS = arg('dials', '');
M.readTune(new URLSearchParams(DIALS));
const tally = (fail) => { M.TUNE.streetFail = fail; let roofs = 0, dead = 0, slabs = 0, items = 0, chunks = 0;
  for (const seed of SEEDS) { const city = new M.City(seed); for (let cx = -RR; cx <= RR; cx++) for (let cz = -RR; cz <= RR; cz++) { const c = city.chunk(cx, cz); chunks++;
    roofs += c.boxes.filter(M.isRoof).filter((b) => b.tag !== M.TAG.SLAB).length; dead += M.deadEnds(c.boxes).length; items += c.items.length; slabs += c.boxes.filter((b) => b.tag === M.TAG.SLAB).length; } }
  return { chunks, roofs, dead, slabs, items }; };
const a = tally(0), b = tally(1);
console.log(`dials: ${DIALS || 'house'}  (gap at level ${M.maxGap(0).toFixed(1)} m, 3 m up ${M.maxGap(3).toFixed(1)} m, 6 m down ${M.maxGap(-6).toFixed(1)} m; up at most ${M.upReach().toFixed(1)} m)`);
console.log(`  ${a.chunks} chunks, ${a.roofs} roofs: dead ends ${a.dead} (${(100 * a.dead / a.roofs).toFixed(1)}%) as built; ${b.dead} (${(100 * b.dead / b.roofs).toFixed(1)}%) bridged (${b.slabs - a.slabs} bridges); ${b.items} checkpoints (${(b.items / b.chunks).toFixed(1)} a chunk)`);
