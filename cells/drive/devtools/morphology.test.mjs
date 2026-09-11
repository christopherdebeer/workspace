/**
 * THE FOOTPRINT CENSUS, ON AUTHORED RINGS.
 *
 *   node cells/drive/devtools/morphology.test.mjs
 *
 * Every case is one the first cut got wrong or could get wrong: a closed ring
 * must not attach to itself (it did — every building in every capture read as
 * a terrace), a corner touch is not a party wall, a terrace is one run, and a
 * grid reads as a grid.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const cache = join(ROOT, 'node_modules/.cache');
mkdirSync(cache, { recursive: true });
const built = join(cache, 'drive-morphology.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/morphology.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const { morphology, plan } = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const box = (x, z, w, d, closed = false) => {
  const p = [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
  return closed ? [...p, [x, z]] : p;
};

// ── A CLOSED RING IS A RUN OF ONE ──
{
  const m = morphology([{ id: 1, pts: box(0, 0, 10, 8, true) }, { id: 2, pts: box(40, 0, 10, 8, true) }]);
  ok('two closed rings apart are two detached buildings',
    m.summary.attached === 0 && m.summary.runs === 0 && m.rows.every((r) => r.runN === 1), m.summary);
  ok('area is the shoelace and not inflated by the closing point',
    Math.abs(m.rows[0].area - 80) < 1e-9, m.rows[0].area);
}
// ── A CORNER TOUCH IS NOT A PARTY WALL ──
{
  const m = morphology([{ id: 'a', pts: box(0, 0, 10, 10) }, { id: 'b', pts: box(10, 10, 10, 10) }]);
  ok('one shared vertex does not attach', m.summary.attached === 0, m.rows.map((r) => r.nbrs));
}
// ── A TERRACE IS ONE RUN ──
{
  const fps = [];
  for (let i = 0; i < 6; i++) fps.push({ id: i, pts: box(i * 6, 0, 6, 9, i % 2 === 0) });
  fps.push({ id: 'shed', pts: box(60, 30, 4, 4) });
  const m = morphology(fps);
  ok('six party-walled houses are one run of six', m.summary.runs === 1 && m.summary.runMax === 6, m.summary);
  ok('the end houses have one neighbour and the middle ones two',
    m.rows[0].nbrs.length === 1 && m.rows[2].nbrs.length === 2 && m.rows[5].nbrs.length === 1,
    m.rows.map((r) => r.nbrs.length));
  ok('the shed stands alone', m.rows[6].runN === 1 && m.summary.attachedShare === 6 / 7, m.summary);
}
// ── SNAP TOLERANCE: 0.15m APART IS THE SAME WALL, 0.5m IS AN ALLEY ──
{
  const near = morphology([{ id: 1, pts: box(0, 0, 10, 10) }, { id: 2, pts: box(10.15, 0, 10, 10) }]);
  const alley = morphology([{ id: 1, pts: box(0, 0, 10, 10) }, { id: 2, pts: box(10.5, 0, 10, 10) }]);
  ok('a mapper\'s 15cm gap is a party wall', near.summary.attached === 2, near.summary);
  ok('a half-metre gap is not', alley.summary.attached === 0, alley.summary);
}
// ── A GRID READS AS A GRID, A SCATTER DOES NOT ──
{
  const grid = [], scatter = [];
  for (let i = 0; i < 40; i++) {
    grid.push({ id: i, pts: box((i % 8) * 20, Math.floor(i / 8) * 20, 12, 8 + (i % 3)) });
    // Random bearings: rotate a box by a hash of i.
    const a = ((i * 137.508) % 180) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const rot = ([x, z]) => [x * c - z * s + i * 30, x * s + z * c];
    scatter.push({ id: i, pts: box(0, 0, 12, 8).map(rot) });
  }
  const g = morphology(grid).summary, sc = morphology(scatter).summary;
  ok('an aligned street is fully coherent', g.gridCoherence === 1 && Math.abs(g.modalAng - 2.5) < 1e-9, g);
  ok('a scatter of bearings is not', sc.gridCoherence < 0.6, sc);
}
// ── THE PLAN BOX MATCHES footprintSize's CONVENTION ──
{
  const p = plan([[0, 0], [20, 0], [20, 6], [0, 6]]);
  ok('long and short sides of a 20x6', Math.abs(p.long - 20) < 1e-9 && Math.abs(p.short - 6) < 1e-9, p);
  const r = plan([[0, 0], [0, 20], [-6, 20], [-6, 0]]);
  ok('…and the bearing is modulo 90, so a north-south box reads the same as an east-west one',
    Math.abs(r.ang % 90) < 1e-9 || Math.abs(r.ang - 90) < 1e-9, r);
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
