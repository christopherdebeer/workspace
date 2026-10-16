// Fab's patterns and cloth, on their own (node cells/lab/devtools/fab.test.mjs; `--quick` skips the slow sections):
// the edge kernel (arcs, Béziers, Coons patches, sewing by length); a design made whole from anything; every garment
// family's patterns put through their checks across its design space; every workshop garment sewn and settled on the
// figure; the skirt's own pattern sweep; the same garment drafted twice is the same.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const E = await load('../client/fab/edges.ts');
const G = await load('../client/fab/garment.ts');
const V = await load('../client/fab/evidence.ts');
const quick = process.argv.includes('--quick');
const t0 = Date.now(), ok = (what) => console.log(`ok    ${what}`);

// ─── the edge kernel ──────────────────────────────────────────────────────────────────────────
{
  // (a half circle through the chord's middle, raised half its length: π r long)
  const a = E.arc([0, 0], [10, 0], 0.5);
  assert.ok(Math.abs(a.len - Math.PI * 5) < 0.02, `half-circle arc: ${a.len}`);
  assert.ok(Math.abs(a.at(0.5)[1] - 5) < 0.05, 'the arc passes through its middle point');
  // (a Bézier's ends are its chord's; relative control points move with it)
  const c = E.curve([0, 0], [10, 0], [[0.5, 0.3]]), c2 = E.curve([0, 0], [20, 0], [[0.5, 0.3]]);
  assert.deepEqual(c.at(0), [0, 0]); assert.deepEqual(c.at(1), [10, 0]);
  assert.ok(Math.abs(c2.len / c.len - 2) < 1e-6, 'a curve scaled with its chord keeps its shape');
  // (a Coons patch over a square is the square; its spans are its named edges)
  const sq = E.patch({ name: 'sq', h: 1, start: () => [0, 0, 0], top: [E.line([0, 10], [10, 10], 'top')], foot: [E.line([0, 0], [10, 0], 'foot')], left: [E.line([0, 10], [0, 0])], right: [E.line([10, 10], [10, 0])] });
  assert.deepEqual(sq.flat(0.5, 0.5).map((x) => +x.toFixed(6)), [5, 5]);
  assert.equal(sq.spans.top.length, sq.nu + 1);
  assert.ok(E.gridHealth(sq).ok, 'a square grid is sound');
  // (sewn by length: a 30 cm edge to a 20 cm one gathers 1.5×, every point of each sewn to the other)
  const A = E.patch({ name: 'a', h: 2, start: () => [0, 0, 0], top: [E.line([0, 4], [30, 4], 'top')], foot: [E.line([0, 0], [30, 0], 'edge')], left: [E.line([0, 4], [0, 0])], right: [E.line([30, 4], [30, 0])] });
  const B = E.patch({ name: 'b', h: 2, start: () => [0, 0, 0], top: [E.line([0, 4], [20, 4], 'edge')], foot: [E.line([0, 0], [20, 0], 'foot')], left: [E.line([0, 4], [0, 0])], right: [E.line([20, 4], [20, 0])] });
  const s = E.sew([A, B], A.spans.edge.map(([i, j]) => [0, i, j]), B.spans.edge.map(([i, j]) => [1, i, j]), 'gather', { want: 1.5 });
  assert.ok(Math.abs(s.seam.ratio - 1.5) < 1e-6, `gathered 1.5×: ${s.seam.ratio}`);
  assert.equal(s.pairs.length, A.spans.edge.length + B.spans.edge.length - 2, 'every point of both edges sewn');
  for (const p of s.pairs) assert.ok(!p.t || (p.t > 0 && p.t < 1), 'a stitch lands between two points');
  ok('edges: arcs, Béziers, Coons patches, sewing by length');
}

// ─── designs, made whole ─────────────────────────────────────────────────────────────────────
{
  const d = G.sanitize({ family: 'hat', colour: 5, print: -2, neck: 42, fabric: 'cardboard', sleeveLen: 'long', tiers: 9 });
  assert.equal(d.family, 'skirt'); assert.equal(d.colour, 4); assert.equal(d.print, 0); assert.equal(d.neck, 'round'); assert.equal(d.fabric, 'lawn'); assert.equal(d.tiers, 3);
  assert.equal(G.sanitize(null).family, 'skirt');
  // (a skirt saved before there were tops: the rest from the defaults)
  const old = G.sanitize({ length: 40, fullness: 3, method: 'pleat', panels: 6, grain: 0, fabric: 'linen', print: 1, colour: 2 });
  assert.equal(old.family, 'skirt'); assert.equal(old.method, 'pleat'); assert.equal(old.sleeve, 'plain');
  ok('a design made whole from anything: old saves, junk, out-of-range colours');
}

// ─── the same twice ──────────────────────────────────────────────────────────────────────────
{
  for (const family of ['skirt', 'top', 'dress', 'trousers', 'jumpsuit']) {
    const a = G.draftGarment({ family, sleeve: 'puff', collar: 'peterpan', tiers: 2 }), b = G.draftGarment({ family, sleeve: 'puff', collar: 'peterpan', tiers: 2 });
    assert.equal(JSON.stringify(a.pairs), JSON.stringify(b.pairs), `${family}: the same stitches twice`);
    assert.deepEqual(a.pieces.map((p) => p.flat(0.37, 0.61)), b.pieces.map((p) => p.flat(0.37, 0.61)), `${family}: the same pieces twice`);
    assert.ok(a.pieces.every((p) => p.label === undefined || typeof p.label === 'string'));
    assert.ok(a.holds.length > 0, `${family}: held somewhere`);
  }
  ok('every family drafts the same twice, and is held somewhere');
}

// ─── the evidence bench's sections ───────────────────────────────────────────────────────────
const sections = [V.garmentTest(quick ? 60 : 300)];
if (!quick) sections.push(V.patternTest(), V.sewnTest());
for (const s of sections) {
  console.log(`${s.pass ? 'ok  ' : 'FAIL'}  ${s.title}: ${s.verdict}`);
  if (s.id === 'sewn') for (const r of s.rows) console.log(`        ${r.ok ? ' ' : '✗'} ${String(r.garment).padEnd(64)} seams ${r['widest seam (cm)']} cm, p99 ${r['stretch p99']}, ${r['ms a frame']} ms`);
  if (!s.pass) for (const r of s.rows.slice(0, 10)) console.log('       ', JSON.stringify(r));
}
const failed = sections.filter((s) => !s.pass);
console.log(failed.length ? `\n${failed.length} failed` : `\nall passed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failed.length ? 1 : 0);
