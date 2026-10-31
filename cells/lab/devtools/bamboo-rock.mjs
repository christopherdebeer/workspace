// Bamboo's rock (node cells/lab/devtools/bamboo-rock.mjs [seed] [chunks]): the formations over a stretch of the mountain,
// checked for what every system must agree on:
//   variety      blocks' shapes their own (corner nudges, tapers: no two the same)
//   anchors      the escarpment's anchors the same whichever chunk asks (no crowding or gaps at a chunk's edge)
//   cut          wherever the ground's cut below the land, rock stands there or a cleft's floor is (nothing cut and bare)
//   clefts       each with its floor and a block at its back
//   pads         the rock's tops offered as footholds, with their block, slope and room
//   sight        a line through a block is blocked by its faces; one over it isn't
//   ink          the rock's edges drawn from the blocks (crest, lip, joint, contact)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/rock.ts'; export * from './client/bamboo/runner.ts'; export * from './client/bamboo/strokes.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const seed = Number(process.argv[2] ?? 1), R = Number(process.argv[3] ?? 5);
const w = new B.World(seed);
let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(10)} ${detail}`); };

const blocks = [], floors = [];
for (let ci = -R; ci < R; ci++) for (let cj = -R; cj < R; cj++) { blocks.push(...w.rocks(ci, cj)); floors.push(...w.escarp(ci, cj).floors); }
const kinds = {}; for (const b of blocks) kinds[b.role] = (kinds[b.role] ?? 0) + 1;
console.log(`     ${blocks.length} blocks ${JSON.stringify(kinds)}, ${floors.length} clefts`);

// (variety: each block's corners in its own frame, as fractions of its size)
const sig = new Set();
for (const b of blocks) sig.add(b.K.map((p) => [0, 1, 2].map((a) => ((p[0] - b.c[0]) * b.ax[a][0] + (p[1] - b.c[1]) * b.ax[a][1] + (p[2] - b.c[2]) * b.ax[a][2]) / b.h[a]).map((v) => v.toFixed(3)).join(',')).join(';'));
check('variety', sig.size >= blocks.length * 0.97, `${sig.size} distinct shapes of ${blocks.length}`);

// (anchors: the whole stretch at once, and chunk by chunk, the same)
const whole = B.anchors(w, -R * 32, -R * 32, R * 32, R * 32), byChunk = [];
for (let ci = -R; ci < R; ci++) for (let cj = -R; cj < R; cj++) byChunk.push(...B.anchors(w, ci * 32, cj * 32, ci * 32 + 32, cj * 32 + 32));
const key = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`, A = new Set(whole.map(key)), Bk = new Set(byChunk.map(key));
let same = A.size === Bk.size; for (const k of A) if (!Bk.has(k)) same = false;
let closest = 99; for (const p of whole) for (const q of whole) if (p !== q) closest = Math.min(closest, Math.hypot(p.x - q.x, p.z - q.z));
check('anchors', same && closest >= 2.59, `${whole.length} anchors, the same chunk by chunk: ${same}; closest pair ${closest.toFixed(2)} m`);

// (cut: points over the band; where the ground's below the land, a block covers it or a cleft's floor is there)
let cutN = 0, bare = 0, probe = 0;
for (let x = -R * 32 + 12; x < R * 32 - 12; x += 0.7) for (let z = -R * 32 + 12; z < R * 32 - 12; z += 0.7) { // (inside the stretch: its edge is covered by rock anchored beyond)
  const n = w.cliffN(x, z);
  if (n < B.BAND_LO || n > B.BAND_HI) continue;
  probe++;
  if (w.ground(x, z) > w.base(x, z) - 0.4 || w.trailNear(x, z).d < 6) continue; // (a trail's bench is its own cut)
  cutN++;
  const ok = blocks.some((b) => Math.abs(x - b.c[0]) < b.r && Math.abs(z - b.c[2]) < b.r && B.covers(b, x, z, 0)) || floors.some((f) => !Number.isNaN(B.floorAt(f, w, x, z)));
  if (!ok) bare++;
}
check('cut', bare === 0 && cutN > 0, `${probe} points in the band, ${cutN} cut, ${bare} cut with nothing over them`);
check('clefts', floors.length > 0 && blocks.filter((b) => b.role === 'back').length === floors.length, `${floors.length} floors, ${blocks.filter((b) => b.role === 'back').length} backing blocks`);

// (pads: footholds with their block)
const withPads = blocks.filter((b) => b.kind !== 'fragment' && b.pads.length).length, tops = blocks.filter((b) => b.kind !== 'fragment').length;
const me = new B.Runner(w, 60), col = blocks.find((b) => b.role === 'crest');
me.stream(col.c[0], col.c[2], 30);
const near = me.feet.padsNear(col.c[0], col.c[2], 6);
check('pads', withPads >= tops * 0.8 && near.length > 0 && near.every((p) => p.b && p.room >= 2 && p.ny >= 0.72), `${withPads} of ${tops} tops offer pads; ${near.length} near a crest, each with its block`);

// (sight: through a block's middle, blocked; over its top, clear)
let through = 0, over = 0, n = 0;
for (const b of blocks.filter((b) => b.kind === 'column').slice(0, 60)) {
  n++;
  const a = [b.c[0] - b.ax[2][0] * (b.h[2] + 2), b.c[1], b.c[2] - b.ax[2][2] * (b.h[2] + 2)], e = [b.c[0] + b.ax[2][0] * (b.h[2] + 2), b.c[1], b.c[2] + b.ax[2][2] * (b.h[2] + 2)];
  if (B.blocksSegment(b, a, e)) through++;
  if (!B.blocksSegment(b, [a[0], b.top + 1, a[2]], [e[0], b.top + 1, e[2]])) over++;
}
check('sight', through === n && over === n, `${through}/${n} lines through a column stopped, ${over}/${n} over its top clear`);

// (ink: the chunk with the most rock, its marks: rock families present)
let best = null, most = 0;
for (let ci = -R; ci < R; ci++) for (let cj = -R; cj < R; cj++) { const k = w.rocks(ci, cj).length; if (k > most) { most = k; best = [ci, cj]; } }
const c = w.chunk(best[0], best[1]), marks = B.strokes(w, c), fam = {};
for (let i = 0; i < marks.length; i += B.STROKE_STRIDE * 6) { const f = Math.floor(marks[i + 10]); fam[f] = (fam[f] ?? 0) + 1; }
check('ink', (fam[B.FAM.rim] ?? 0) > 20 && (fam[B.FAM.face] ?? 0) > 5 && (fam[B.FAM.contact] ?? 0) > 5, `chunk ${best} (${most} blocks): ${JSON.stringify(fam)}`);
console.log(fails ? `FAIL ${fails}` : 'ok');
process.exit(fails ? 1 : 0);
