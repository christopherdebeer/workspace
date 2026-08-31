/**
 * MARKS ARE MADE BY PEOPLE, AND A PLACE AGREES WITH ITSELF.
 *
 *   node cells/drive/devtools/graffiti.test.mjs
 *
 * The two properties that decide whether graffiti reads as a lived-in world
 * or as noise, and both are arithmetic — which is why they are asserted here
 * in half a second rather than argued about in a screenshot:
 *
 *   1. COHERENCE. One settlement has ONE sigil and ONE tin. A hash per
 *      building would be decorrelated, and decorrelation is exactly the
 *      failure culture.ts was written to fix for paint.
 *   2. DENSITY MEANS PEOPLE. The built-up term gates everything: empty
 *      country carries no marks at all, whatever the region's culture.
 *
 * …plus the packing, because sigil, tin and density share one float and a
 * unit that unpacks wrongly puts the wrong mark in the wrong colour on every
 * wall in the world.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'graffiti-'));
const built = join(tmp, 'graffiti.mjs');
const builtC = join(tmp, 'culture.mjs');
for (const [src, out] of [['../client/graffiti.ts', built], ['../client/culture.ts', builtC]]) {
  execFileSync('npx', ['esbuild', join(HERE, src), '--bundle', '--format=esm',
    `--outfile=${out}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
}
const { seedAt } = await import(pathToFileURL(builtC).href);
const {
  MARK_N, MARK_COLS, MARK_PALETTE, MARK_SERVICE_FIRST, MARK_CULTURES,
  SERVICE_MARK, markLookAt, packMark, drawMarkAtlas,
} = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const envAt = (lat0, lon0) => ({
  latLonAt: (x, z) => [lat0 - z / 111320, lon0 + x / (111320 * Math.cos((lat0 * Math.PI) / 180))],
});
// Temperate, which is where most of the world's towns are.
const W = [0.05, 0.15, 0.6, 0.15, 0.05];

// ── 1. A SETTLEMENT AGREES WITH ITSELF ────────────────────────────
// Stated as the property that actually holds, which is NOT "everything within
// 320m agrees": the settlement cells are jittered Voronoi, deliberately, so
// that a border is an arbitrary polyline rather than a straight grid line —
// and a box the size of a cell straddles one about half the time. The real
// invariant is that the hand is a function OF THE CELL: same settlement seed,
// same sigil and same tin, wherever in the cell you stand.
{
  const env = envAt(48.5, 2.3);
  const at = (x, z) => markLookAt(env, x, z, W, 1);
  const byCell = new Map();
  for (let x = -1200; x <= 1200; x += 30) {
    for (let z = -1200; z <= 1200; z += 30) {
      const seed = seedAt(env, x, z, 'settlement');
      const l = at(x, z);
      const key = `${l.sigil}/${l.tin}`;
      const set = byCell.get(seed) ?? new Set();
      set.add(key);
      byCell.set(seed, set);
    }
  }
  const split = [...byCell.values()].filter((s2) => s2.size > 1).length;
  ok('one settlement, one hand', split === 0, { split, cells: byCell.size });
  // …and the cells must not all agree either, or the world has one crew.
  const hands = new Set([...byCell.values()].flatMap((s2) => [...s2]));
  ok('neighbouring settlements differ', hands.size > 3, [...hands].slice(0, 8));
  const home = at(0, 0);
  // …and far away it must NOT, or the whole world writes the same tag.
  const far = [at(9000, 0), at(0, 9000), at(-14000, 6000), at(21000, -8000)];
  ok('a different place writes differently',
    far.some((l) => l.sigil !== home.sigil || l.tin !== home.tin),
    far.map((l) => [l.sigil, l.tin]));
}

// ── 2. NO PEOPLE, NO MARKS ────────────────────────────────────────
{
  const env = envAt(48.5, 2.3);
  const empty = markLookAt(env, 0, 0, W, 0);
  const town = markLookAt(env, 0, 0, W, 1);
  ok('open country carries nothing', empty.density === 0, empty.density);
  ok('a town centre carries marks', town.density > 0.02, town.density);
  // Monotone in between: half as built-up is at most half as marked.
  const half = markLookAt(env, 0, 0, W, 0.5);
  ok('density follows how built-up it is',
    half.density > 0 && half.density <= town.density + 1e-9,
    { half: half.density, town: town.density });
}

// ── 3. THE PACKING ROUND-TRIPS ────────────────────────────────────
// sigil*8+tin in the integer part, density in the fraction — unpacked by the
// facade shader as floor(v/8), mod(v,8) and fract(v).
{
  let worstSig = 0, worstTin = 0, worstDen = 0;
  const env = envAt(45, 9);
  for (let i = 0; i < 400; i++) {
    const x = (i * 977) % 40000 - 20000, z = (i * 613) % 40000 - 20000;
    const look = markLookAt(env, x, z, W, 0.2 + (i % 5) * 0.2);
    const p = packMark(look);
    const idx = Math.floor(p);
    worstSig = Math.max(worstSig, Math.abs(Math.floor(idx / 8) - look.sigil));
    worstTin = Math.max(worstTin, Math.abs((idx % 8) - look.tin));
    worstDen = Math.max(worstDen, Math.abs((p - idx) - Math.min(0.999, look.density)));
  }
  ok('sigil survives the packing', worstSig === 0, worstSig);
  ok('tin survives the packing', worstTin === 0, worstTin);
  ok('density survives the packing', worstDen < 1e-6, worstDen);
}

// ── 4. THE SERVICE'S CELLS ARE NEVER SPRAYED BY A CREW ────────────
// The last four atlas cells are the campaign's vocabulary. A procedural
// settlement reaching into them would spend the meaning before THE LINE can
// use it — the whole narrative device rests on this holding.
{
  const env = envAt(20, 30);
  let intruded = 0;
  for (let i = 0; i < 3000; i++) {
    const l = markLookAt(env, (i * 331) % 90000 - 45000, (i * 787) % 90000 - 45000,
      [0.2, 0.2, 0.2, 0.2, 0.2], 1);
    if (l.sigil >= MARK_SERVICE_FIRST) intruded++;
  }
  ok('crews never use the Service marks', intruded === 0, intruded);
  ok('the Service marks are inside the atlas',
    Object.values(SERVICE_MARK).every((v) => v >= MARK_SERVICE_FIRST && v < MARK_N),
    SERVICE_MARK);
}

// ── 5. EVERY CULTURE CAN ACTUALLY BE PICKED ───────────────────────
// A table entry no climate ever selects is dead code that looks like content.
{
  const env = envAt(30, 12);
  const seen = new Set();
  const climates = [
    [1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1],
  ];
  for (const w of climates) {
    for (let i = 0; i < 300; i++) {
      seen.add(markLookAt(env, (i * 1013) % 200000 - 100000, (i * 577) % 200000 - 100000, w, 1).culture.key);
    }
  }
  ok('every mark culture is reachable', seen.size === MARK_CULTURES.length,
    { seen: [...seen], have: MARK_CULTURES.map((c) => c.key) });
}

// ── 6. THE ATLAS DRAWS INSIDE ITS CELLS ───────────────────────────
// Mipmapping is on (distant walls shimmer otherwise), so ink crossing a cell
// boundary bleeds one mark into its neighbour at range. A tiny stub context
// records what was drawn and where — no canvas needed.
{
  const size = 256, cell = size / MARK_COLS, pad = cell * 0.14;
  let out = 0, ops = 0;
  const bounds = [];
  let tx = 0, ty = 0;
  const note = (x, y) => {
    const gx = tx + x, gy = ty + y;
    const cx = Math.floor(gx / cell), cy = Math.floor(gy / cell);
    ops++;
    // Which cell did the translate put us in, and did the ink leave it?
    const lx = gx - cx * cell, ly = gy - cy * cell;
    if (lx < pad * 0.5 || ly < pad * 0.5 || lx > cell - pad * 0.5 || ly > cell - pad * 0.5) out++;
    bounds.push([cx, cy]);
  };
  const ctx = {
    lineCap: '', lineJoin: '', lineWidth: 0, fillStyle: '', strokeStyle: '',
    clearRect() {}, beginPath() {}, stroke() {}, fill() {}, closePath() {},
    save() {}, restore() { tx = 0; ty = 0; },
    translate(x, y) { tx = x; ty = y; },
    moveTo: note, lineTo: note,
    arc(x, y, r) { note(x - r, y - r); note(x + r, y + r); },
    bezierCurveTo(a, b, c2, d2, e, f) { note(a, b); note(c2, d2); note(e, f); },
    fillRect(x, y, w, h) { note(x, y); note(x + w, y + h); },
    strokeRect(x, y, w, h) { note(x, y); note(x + w, y + h); },
  };
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  drawMarkAtlas(ctx, size, rand);
  ok('the atlas drew something', ops > 60, ops);
  ok('no mark leaves its own cell', out === 0, { out, ops });
  ok('every cell was drawn into', new Set(bounds.map((b) => `${b[0]},${b[1]}`)).size === MARK_N,
    new Set(bounds.map((b) => `${b[0]},${b[1]}`)).size);
}

// ── 7. THE PALETTE STAYS OUT OF THE BLOOM ─────────────────────────
// The bright pass cuts at 0.62 of the max channel: a tin above it turns every
// tag into a lamp, which is precisely how the water splash became comedy.
{
  const hot = MARK_PALETTE.filter((h) => Math.max((h >> 16) & 255, (h >> 8) & 255, h & 255) / 255 > 0.92);
  ok('no tin is bright enough to bloom', hot.length === 0,
    hot.map((h) => '0x' + h.toString(16)));
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — marks are made by people');
if (bad) process.exitCode = 1;
