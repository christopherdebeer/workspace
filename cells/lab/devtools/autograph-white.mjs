// Autograph's white (session 17): the hand's spacing, measured the way a type designer spaces a typeface. Each letter is
// written between n's (nnXnn, as Walter Tracy spaced type), with nothing varied, and at three heights through the
// x-height (a quarter, a half, three quarters; the slant taken out) the strokes the pen makes through that height are
// its walls: crossings close together (a stem and the joining stroke that rises beside it, a stroke and its retrace)
// are one wall. The white either side of the letter, from the n before to its first wall and from its last to the n
// after, averaged over the three heights, is set against the same white between two n's. A letter that crowds or gapes
// against that is where the white is uneven; and its own white (first wall to last) against an n's.
//
//   node cells/lab/devtools/autograph-white.mjs [--hand=v10]
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const hand = opt.hand ?? 'v10', HEIGHTS = [0.3, 0.5, 0.7];
const outfile = join(tmpdir(), `autograph-white-${process.pid}.mjs`);
await build({ stdin: { contents: `export { write, STYLE } from './client/autograph/hands/${hand}';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { write, STYLE } = await import(outfile);
const st = { ...STYLE, vary: 0 };

/** the walls at height `y` (x-heights), along the line, the slant taken out: crossings within 0.1 are one wall */
export function walls(text, y) {
  const xs = [];
  for (const s of write(text, 1, st)) {
    const P = [];
    for (let i = 0; i < s.length; i += 3) {
      let py = (700 - s[i + 1]) / st.size, px = (s[i] - 120) / st.size - st.slant * py;
      py -= st.drift * px; px = (s[i] - 120) / st.size - st.slant * py;
      P.push([px, py]);
    }
    for (let i = 0; i + 1 < P.length; i++) { const [x0, y0] = P[i], [x1, y1] = P[i + 1]; if ((y0 - y) * (y1 - y) < 0) xs.push(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0)); }
  }
  xs.sort((a, b) => a - b);
  const w = [];
  for (const x of xs) { if (w.length && x - w[w.length - 1][1] < 0.1) w[w.length - 1][1] = x; else w.push([x, x]); }
  return w;
}
/** a letter between n's: the white before it, its own, and after it, at height y (the n's each make two walls) */
function around(ch, y) {
  const w = walls(`nn${ch}nn`, y), mid = w.slice(4, w.length - 4);
  if (!mid.length) return null;
  return { before: mid[0][0] - w[3][1], own: mid[mid.length - 1][1] - mid[0][0], after: w[w.length - 4][0] - mid[mid.length - 1][1] };
}
const mean = (f) => (ch) => { const v = HEIGHTS.map((y) => around(ch, y)).filter(Boolean); return v.length ? v.reduce((a, r) => a + f(r), 0) / v.length : NaN; };
const before = mean((r) => r.before), after = mean((r) => r.after), own = mean((r) => r.own);
const nBetween = (before('n') + after('n')) / 2, nOwn = own('n');
console.log(`${hand}: the white between two n's ${nBetween.toFixed(2)} x-heights, an n's own ${nOwn.toFixed(2)} (averaged at ${HEIGHTS.join(', ')} of the x-height)`);
const flag = (v) => (v < 0.7 ? ' tight' : v > 1.4 ? ' loose' : '');
const rows = [...'abcdefghijklmnopqrstuvwxyz'].map((ch) => ({ ch, b: before(ch) / nBetween, a: after(ch) / nBetween, o: own(ch) / nOwn }));
for (const r of rows) console.log(`${r.ch}  before it ${(r.b * 100).toFixed(0).padStart(4)}%${flag(r.b).padEnd(6)}  after it ${(r.a * 100).toFixed(0).padStart(4)}%${flag(r.a).padEnd(6)}  its own ${(r.o * 100).toFixed(0).padStart(4)}% of an n's`);
const off = rows.filter((r) => flag(r.b) || flag(r.a));
console.log(`\n${off.length} of 26 letters crowd or gape beside an n (under 70% or over 140% of the white between two n's): ${off.map((r) => r.ch + (flag(r.b) ? `(before${flag(r.b)})` : '') + (flag(r.a) ? `(after${flag(r.a)})` : '')).join(' ') || 'none'}`);
