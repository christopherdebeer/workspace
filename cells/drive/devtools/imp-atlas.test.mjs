/**
 * ── THE ATLAS MUST HOLD EVERY VARIANT THAT EXISTS, AND THE PACKING MUST AGREE ──
 *
 *   node cells/drive/devtools/imp-atlas.test.mjs
 *
 * Two claims, both pure, both instant, and the first is the one that matters.
 *
 * **CAPACITY.** `impSlotFor` is append-only by design — a slot is never
 * reclaimed and `impSlotNext` never decreases — which is what lets an instance
 * carry a slot INDEX rather than a key, and is a property worth keeping. The
 * price of keeping it is that the atlas must be a PERMANENT store: every
 * (family, variant) key that can ever be asked for must fit, because a key
 * refused once when the store is full is refused for the rest of the session
 * and its trees draw nothing at all until they cross into the geometry tier,
 * where they pop into existence.
 *
 * So the bar is not a district's demand, which is what eighteen slots were
 * sized against. It is the WHOLE VARIANT SPACE:
 *
 *   IMP_ATLAS_SLOTS >= sum over families of ezVariants(fam).length
 *
 * Today that is 40 >= 37. **If someone bakes a fifth conifer habit and takes
 * the total to 41, this fails rather than silently reintroducing trees that
 * disappear** — which is the whole reason it is a test and not a comment.
 *
 * **THE PACKING.** A slot's twenty-five views are a contiguous LINEAR run of
 * tiles that wraps across rows, and two implementations write that: `viewOrigin`
 * on the CPU, for the bake, and `impTileRect` in GLSL, for the lookup. Nothing
 * here can run GLSL, so the test re-derives both from their own source text and
 * requires them to land on the same FRAMEBUFFER ROW — which catches the class
 * of fault this repo already records twice: a bake and a lookup that disagree
 * about where a tile is, drawn as trees wearing each other's faces.
 *
 * **AND THE ROW IS THE UNIT BECAUSE THE TILE INDEX WAS NOT.** This check
 * compared `[t % G, floor(t / G)]` against `viewOrigin` — the same expression
 * twice — and passed for as long as the compact packing has existed, while the
 * shipped lookup was reading row `G - 1 - ty` for every tile in the atlas: the
 * grid counts rows from the top (the bake's viewport and `__impatlas` both do)
 * and a texture's v counts them from the bottom. The contact sheet found it;
 * this could not have, and the negative control below is what says it can now.
 */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CELL, ROOT } from './harness.mjs';

const dir = mkdtempSync(join(tmpdir(), 'impatlas-'));
const bundle = async (entry, name) => {
  const out = join(dir, name);
  await build({ entryPoints: [join(CELL, entry)], bundle: true, format: 'esm',
    outfile: out, absWorkingDir: ROOT, logLevel: 'error' });
  return import(out);
};
globalThis.location = { search: '' };
globalThis.document = { createElementNS: () => ({ getContext: () => null }) };

const atlas = await bundle('client/tree-atlas.ts', 'atlas.mjs');
const flora = await bundle('client/flora-ez.ts', 'flora.mjs');
const { IMP_ATLAS, IMP_ATLAS_SLOTS, viewOrigin, sideView } = atlas;

let fail = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${msg}${extra ? `   ${extra}` : ''}`);
  if (!cond) fail++;
};

// ── CAPACITY ──
const per = flora.EZ_FAMILIES.map((f) => [f, flora.ezVariants(f).length]);
const total = per.reduce((a, [, n]) => a + n, 0);
console.log(`\nthe whole variant space: ${per.map(([f, n]) => `${f} ${n}`).join(' · ')}`);
console.log(`  total ${total} keys · atlas ${IMP_ATLAS_SLOTS} slots`
  + ` (${IMP_ATLAS.grid}x${IMP_ATLAS.grid} tiles of ${IMP_ATLAS.tile}px,`
  + ` ${IMP_ATLAS.views} views a slot)\n`);

ok(IMP_ATLAS_SLOTS >= total,
  'the atlas holds every variant that exists',
  `${IMP_ATLAS_SLOTS} >= ${total}`);
// A ceiling with no air under it is one bake away from the fault above.
ok(IMP_ATLAS_SLOTS - total >= 0 && IMP_ATLAS_SLOTS - total <= 12,
  '…with headroom, and not an absurd amount of waste',
  `${IMP_ATLAS_SLOTS - total} spare`);
// THE CONTROL: the layout it replaced could NOT have held this, which is what
// says the test is about a real change rather than restating an easy fact.
ok(3 * 6 < total,
  '…where the 3x6 rectangular layout it replaced could not',
  `18 < ${total}`);

// ── EVERY SLOT'S TILES ARE INSIDE THE ATLAS AND SHARED WITH NOBODY ──
const seen = new Map();
let overlap = 0, outside = 0;
for (let s = 0; s < IMP_ATLAS_SLOTS; s++) {
  for (let v = 0; v < IMP_ATLAS.views; v++) {
    const [tx, ty] = viewOrigin(s, v);
    if (tx < 0 || ty < 0 || tx >= IMP_ATLAS.grid || ty >= IMP_ATLAS.grid) outside++;
    const k = `${tx},${ty}`;
    if (seen.has(k)) overlap++; else seen.set(k, `${s}:${v}`);
  }
}
ok(outside === 0, 'no view falls outside the atlas', `${outside} outside`);
ok(overlap === 0, 'no two views share a tile', `${overlap} collisions`);
ok(seen.size === IMP_ATLAS_SLOTS * IMP_ATLAS.views,
  '…and every view has one', `${seen.size} tiles used of ${IMP_ATLAS.grid ** 2}`);

// ── THE SHADER'S ARITHMETIC LANDS ON THE SAME PIXELS ──
//
// THE TILE INDEX WAS THE WRONG UNIT AND THIS CHECK PASSED ON A BROKEN BUILD.
// It compared `[t % G, floor(t / G)]` against `viewOrigin`, which is the same
// expression twice and is true whichever way the atlas's y axis runs — while
// the fault that shipped was ENTIRELY in that axis: `viewOrigin` counts tile
// rows from the TOP (which is how the bake places its viewport and how
// `__impatlas` reads the atlas back) and a texture's v runs from the BOTTOM,
// so the lookup was reading row `G - 1 - ty` for every tile in the atlas.
//
// The claim is therefore made in FRAMEBUFFER ROWS, where both sides can be
// wrong independently: the row the BAKE writes a view at, and the row the
// SHADER samples it from, must be the same row.
const glsl = IMP_ATLAS_GLSLtext();
function IMP_ATLAS_GLSLtext() { return atlas.IMP_ATLAS_GLSL; }
const src = readFileSync(join(CELL, 'client/tree-atlas.ts'), 'utf8');
ok(glsl.includes('float t = slot * V + view;'),
  'the shader indexes a slot\'s run linearly');
ok(glsl.includes('vec2 o = vec2(mod(t, G), G - 1.0 - floor(t / G)) * T;'),
  '…and flips the row, because the grid is top-down and a texture is not');
ok(!glsl.includes('blockTile'),
  '…with no rectangular block origin left in it');
ok(src.includes('const vy = IMP_ATLAS.size - py - T;'),
  'the bake places its viewport from the top');

const G = IMP_ATLAS.grid, V = IMP_ATLAS.views, T = IMP_ATLAS.tile, A = IMP_ATLAS.size;
// Both sides restated from the source above: the bake's viewport y, and the
// shader's uv lower edge turned back into framebuffer rows.
const bakeRow = (ty) => A - ty * T - T;
const shaderRow = (ty) => (G - 1 - ty) * T;
const wasRow = (ty) => ty * T;              // the form that shipped
let drift = 0, control = 0;
for (let s = 0; s < IMP_ATLAS_SLOTS; s++) {
  for (let v = 0; v < V; v++) {
    const t = s * V + v;
    const [cx, cy] = viewOrigin(s, v);
    if (cx !== t % G || cy !== Math.floor(t / G)) drift++;
    else if (bakeRow(cy) !== shaderRow(cy)) drift++;
    if (bakeRow(cy) !== wasRow(cy)) control++;
  }
}
ok(drift === 0, 'the bake and the lookup agree about every tile, in pixels',
  `${drift} disagree`);
// THE NEGATIVE CONTROL, because a check that has not been shown to fail on the
// fault it names is decoration — and this one had not been.
ok(control === IMP_ATLAS_SLOTS * V,
  '…and the arithmetic it replaced disagreed about every one of them',
  `${control} of ${IMP_ATLAS_SLOTS * V}`);

// ── AND A FLOAT32 CAN STILL COUNT THE TILES ──
// `mod(t, G)` runs on a float in the fragment; t reaches slots*views.
ok(IMP_ATLAS_SLOTS * V <= 2 ** 24,
  'the tile index is exact in a float32', `${IMP_ATLAS_SLOTS * V} max`);

// ── THE SIDE VIEW'S ORDER IS THE ONE THE FRAGMENT USES ──
// The shader computes `impRow * az + impI`; the bake writes `sideView(ax, row)`.
const frag = readFileSync(join(CELL, 'client/tree-impostor.ts'), 'utf8');
ok(frag.includes("'  float impV = impRow * ' + K.az + ';'"),
  'the fragment walks elevation rows of azimuths');
ok(sideView(3, 2) === 2 * IMP_ATLAS.az + 3,
  '…and sideView writes the same order');
ok(IMP_ATLAS.planView === IMP_ATLAS.az * IMP_ATLAS.el.length,
  'the plan view is the last of the run', `${IMP_ATLAS.planView}`);

console.log(fail ? `\n${fail} FAILED` : '\nall ok');
process.exitCode = fail ? 1 : 0;
