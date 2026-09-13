// THE CHART'S LAYER TABLE AND ITS PALETTES, IN PURE NODE.
//
//   node cells/drive/devtools/chart-layers.test.mjs
//
// `client/chart-layers.ts` is pure so this can drive the SHIPPING functions —
// the same colours that reach the sheet's texture and the swatch on the key,
// which is the whole reason the table is a module rather than a record literal
// in main.ts. What is held here is what the doctrine claims about it: the
// classes are far enough apart to survive the post chain's fourteen levels,
// the legend names only what is on screen, and the table's own invariants
// (one default thematic layer at most, every id unique) cannot rot.
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/chart-layers');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'chart-layers.mjs');
execSync(`npx esbuild ${join(CELL, 'client/chart-layers.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'pipe', cwd: ROOT });
const M = await import(`${BUNDLE}?t=${Date.now()}`);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

console.log('the table:');
{
  const ids = M.CHART_LAYERS.map((l) => l.id);
  check(new Set(ids).size === ids.length, `ids are unique (${ids.join(', ')})`);
  check(M.CHART_LAYERS.every((l) => l.name.length <= 8),
    'every name fits the HUD — the chart is about 148 art pixels wide');
  check(M.CHART_LAYERS.every((l) => l.note.length > 20), 'every layer says what it is');
  const themDefault = M.CHART_LAYERS.filter((l) => l.kind === 'thematic' && l.on);
  check(themDefault.length === 0,
    `no thematic sheet is on by default (${themDefault.length}) — each is a claim over the whole frame`);
  check(M.CHART_LAYERS.filter((l) => l.kind === 'vector').every((l) => l.on),
    'the base map is on by default');
  check(M.chartLayer('cover')?.kind === 'thematic' && M.chartLayer('nope') === undefined,
    'chartLayer answers by id and refuses an unknown one');
}

// ── THE PALETTE HAS TO SURVIVE THE POST CHAIN ──
// The composite quantises to fourteen levels, so one level is about 18/255 and
// two classes three levels apart are two classes. The bar is the MAX-channel
// distance, because that is what the quantiser works on per channel, and it is
// set at 40 — a little over two levels — so a pair that lands on the same
// level in two channels is still told apart by the third.
console.log('\nthe palettes are far enough apart to survive fourteen levels:');
for (const [layer, table] of [['cover', M.COVER_INK], ['eco', M.ECO_INK]]) {
  const rows = Object.entries(table);
  let worst = 1e9, worstPair = '';
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i][1].rgb, b = rows[j][1].rgb;
    const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    if (d < worst) { worst = d; worstPair = `${rows[i][1].name}/${rows[j][1].name}`; }
  }
  console.log(`  ${layer}: ${rows.length} classes, closest pair ${worstPair} at ${worst}/255`);
  check(worst >= 40, `${layer}'s closest pair is over two palette steps apart (${worst})`);
  check(rows.every(([, v]) => v.name.length <= 14), `${layer}'s names fit the key`);
}

console.log('\nink lookup and hex:');
{
  check(M.inkFor('cover', 80)?.name === 'WATER', 'a cover class answers by its raster BYTE, not an index');
  check(M.inkFor('eco', 12)?.name === 'MEDITERRANEAN', 'a biome answers by its RESOLVE number');
  check(M.inkFor('cover', 7) === null && M.inkFor('roads', 10) === null,
    'an unknown class and a vector layer both answer null — 0 is not a class');
  check(M.inkHex({ name: 'x', rgb: [46, 108, 196] }) === '#2e6cc4', 'hex is the texture\'s own bytes');
  check(M.inkHex({ name: 'x', rgb: [-3, 300, 7.6] }) === '#00ff08', 'hex clamps and rounds');
}

console.log('\nthe legend names what is on the screen:');
{
  const counts = new Map([[10, 5000], [80, 3000], [30, 1000], [50, 20], [40, 900]]);
  const leg = M.legendFor('cover', counts);
  console.log(`  ${leg.map((r) => `${r.name} ${(r.share * 100).toFixed(0)}%`).join(' · ')}`);
  check(leg[0].name === 'FOREST' && leg[1].name === 'WATER', 'commonest first');
  check(!leg.some((r) => r.name === 'BUILT'),
    'a class holding a fifth of a percent is not something anyone is looking up');
  check(leg.every((r) => r.share > 0 && r.share <= 1), 'shares are shares');
  check(M.legendFor('cover', new Map()).length === 0, 'an empty tally is an empty legend, not a crash');
  check(M.legendFor('cover', new Map([[10, 1]])).length === 1, 'one class is one row');
  const many = new Map();
  for (const c of [10, 20, 30, 40, 50, 60, 70, 80, 90]) many.set(c, 100);
  check(M.legendFor('cover', many).length === 6, 'the legend is capped — the HUD has room for six');
  check(M.legendFor('cover', new Map([[10, 100], [999, 100]])).length === 1,
    'a class with no ink is not in the legend and does not count against the cap');
}

rmSync(OUT, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAILURES` : '\nchart-layers: all ok');
process.exit(fails ? 1 : 0);
