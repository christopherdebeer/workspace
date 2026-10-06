// Seals: pure, deterministic, and saying what the card says.
// (node cells/lab/devtools/seals.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const O = await load('seals/ornament.ts'), St = await load('seals/structure.ts'), S = await load('seals/seal.ts'), T = await load('seals/styles.ts'), D = await load('markovs/deck.ts'), F = await load('seals/field.ts'), P = await load('seals/pack.ts'), H = await load('seals/shapes.ts');

// every junction of every suit, a few seeds: no NaN, the same twice
for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 10; rank++) for (const seed of [1, 4096]) {
  const faces = D.facesOf({ suit, rank });
  const a = S.sealCard({ style: T.SUIT_STYLES[suit], seed, faces, title: 't', id: 'x' });
  assert.ok(!/NaN|undefined|Infinity/.test(a), `clean svg ${suit}/${rank}/${seed}`);
  assert.equal(a, S.sealCard({ style: T.SUIT_STYLES[suit], seed, faces, title: 't', id: 'x' }), 'deterministic');
  // the junction: one shaft per distinct exit, a roundel per face numbered 1–6, a loop iff stays
  const p = S.sample(T.SUIT_STYLES[suit], seed);
  const j = S.junction(p, faces).marks;
  const expand = (t) => t.split(',').flatMap((x) => { const [a, b] = x.split('–').map(Number); return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a]; });
  const nums = j.filter((m) => m.k === 'text').flatMap((m) => expand(m.text)).sort((a, b) => a - b);
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6], 'all six faces labelled, once');
  const groups = new Set(faces).size;
  assert.equal(j.filter((m) => m.k === 'text').length, groups, 'one label per direction');
  const jUngrouped = S.junction({ ...p, faceGroups: false }, faces).marks;
  assert.equal(jUngrouped.filter((m) => m.k === 'text').length, 6, 'ungrouped: a roundel per face');
  const heads = jUngrouped.filter((m) => m.k === 'path' && m.fill === 'ink').length;
  const exits = new Set(faces.filter((d) => d >= 0)).size, stays = faces.includes(-1) ? 1 : 0;
  assert.equal(heads, exits + stays, 'a head per exit, one for the loop');
  // roundels stay inside the rim, and none overlaps another
  const rs = jUngrouped.filter((m) => m.k === 'circle' && m.fill === 'paper' && m.r > 2);
  for (const r of rs) assert.ok(Math.hypot(r.x, r.y) + r.r < S.R, `roundel inside the rim ${suit}/${rank}`);
  const faceRs = rs.filter((r) => Math.hypot(r.x, r.y) > 1);
  for (let i = 0; i < faceRs.length; i++) for (let k = i + 1; k < faceRs.length; k++) {
    const a1 = faceRs[i], b1 = faceRs[k];
    assert.ok(Math.hypot(a1.x - b1.x, a1.y - b1.y) >= a1.r + b1.r - 0.6, `roundels apart ${suit}/${rank}: ${JSON.stringify([a1, b1])}`);
  }
}
// the fill keeps clear of the faces: no disc reaches into a zone (margin included)
for (let suit = 0; suit < 4; suit++) for (const rank of [3, 5, 6]) {
  const p = S.sample(T.SUIT_STYLES[suit], 3), seal = S.draw(p, D.facesOf({ suit, rank }), 3);
  for (const d of seal.discs) assert.ok(F.sdfAll(seal.zones, d.c) >= d.r - 1e-6, `disc clear of the zones ${suit}/${rank}`);
  for (const d of seal.discs) assert.ok(F.sdf(seal.region, d.c) <= -d.r + 1e-6, 'disc inside its region');
  for (const d of seal.discs.filter((x) => x.pass === 0)) assert.ok(F.sdfAll(seal.avoid, d.c) >= d.r - 1e-6, 'disc off the lines');
  // the card: its border keeps clear of the seal and of the words
  const c = S.card({ style: T.SUIT_STYLES[suit], seed: 3, faces: D.facesOf({ suit, rank }), title: 'VIII · BACKTURN', id: 'z' });
  if (c.border) {
    assert.ok(c.svg.includes('clip-path="url(#zb)"'), 'the border is constructed');
    // no border ornament on the title or the words
    const zs = [S.textZone(31.5, 10.2, 'VIII · BACKTURN', 3.4, 0.55)];
    for (const d of c.border.discs) assert.ok(F.sdfAll(zs, d.c) >= d.r - 1e-6, 'border clear of the title');
  }
}
// with no zones the fill is symmetric: every disc has its mirror image
{
  const p = { ...S.sample(T.SUIT_STYLES[0], 8), stipple: 0 }, seal = S.draw(p, null, 8);
  const key = (x, y) => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const at = new Set(seal.discs.map((d) => key(d.c[0], d.c[1])));
  for (const d of seal.discs) assert.ok(at.has(key(-d.c[0], d.c[1])), 'mirrored');
}
// the shapes: every kind fills, keeps its label clear
for (const kind of H.SHAPE_KINDS) {
  const t = H.shapeTile({ kind, style: T.SUIT_STYLES[1], seed: 2, label: 'Markovs' });
  assert.ok(t.fill.discs.length > 4 && !/NaN/.test(t.svg), `${kind} fills (${t.fill.discs.length})`);
  assert.ok(/clip-path/.test(t.svg) && t.svg.length > 20000, `${kind} is constructed`);
}
// the evenness dial: largest-first fills more evenly than random sequential addition
{
  const region = { k: 'circle', c: [0, 0], r: 50 };
  const o = { region, avoid: [], zones: [], sym: { kind: 'none' }, rMax: 6, rMin: 0.8, gap: 0.5, jitter: 0, snapTol: 0, refill: false, stipple: 0 };
  let even = 0, rand = 0;
  for (const seed of [1, 2, 3]) { even += P.evenness(region, [], P.fillPasses({ ...o, tries: 40, seed })).p95Gap; rand += P.evenness(region, [], P.fillPasses({ ...o, tries: 1, seed })).p95Gap; }
  assert.ok(even <= rand, `largest-first leaves smaller gaps (${even} vs ${rand})`);
}
// contours: a circle's isolines are circles at the right radius
{
  const lines = St.isolines(St.sampleGridFor({ k: 'circle', c: [0, 0], r: 10 }, 0.25), -3);
  assert.equal(lines.length, 1, 'one closed line');
  for (const p of lines[0]) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 7) < 0.05, 'at radius 7');
}
// the fade: a corner fill is denser toward the card's corner than toward its centre
{
  const region = { k: 'box', c: [0, 0], hw: 50, hh: 50 };
  const o = { region, avoid: [], zones: [], sym: { kind: 'd2', c: [0, 0] }, centre: [0, 0], k: 1, seed: 4, stats: false };
  const st = { ...T.SUIT_STYLES[2], stipple: 0, links: 0 };
  const count = (r, inner) => r.discs.filter((d) => (Math.max(Math.abs(d.c[0]), Math.abs(d.c[1])) < 25) === inner).length;
  const even = O.fill({ ...o, style: { ...st, fade: 0 } }), faded = O.fill({ ...o, style: { ...st, fade: 1, fadeFrom: 'outer' } });
  assert.ok(count(faded, true) / count(faded, false) < count(even, true) / count(even, false), 'thinner toward the centre');
}
// sdf: a frame is inside between its boxes, outside in the middle
{
  const frame = { k: 'diff', a: { k: 'box', c: [0, 0], hw: 10, hh: 10 }, minus: [{ k: 'box', c: [0, 0], hw: 6, hh: 6 }] };
  assert.ok(F.sdf(frame, [8, 0]) < 0 && F.sdf(frame, [0, 0]) > 0 && F.sdf(frame, [12, 0]) > 0);
  assert.equal(F.copies({ kind: 'rot', c: [0, 0], fold: 4 }, [0, -5], 0).length, 4, 'a point on a mirror is kept once per turn');
}
// seeds vary the seal; a variance of 0 pins the numbers
const st = T.SUIT_STYLES[2];
assert.notEqual(S.sealCard({ style: st, seed: 1, faces: null, title: '', id: 'a' }), S.sealCard({ style: st, seed: 2, faces: null, title: '', id: 'a' }));
assert.deepEqual(S.sample({ ...st, variance: 0 }, 9), { ...st, variance: 0 });
// sampled numbers stay in range
for (const c of T.SCHEMA.filter((c) => c.kind === 'num')) for (const seed of [1, 2, 3, 99]) { const v = S.sample({ ...st, variance: 1 }, seed)[c.key]; assert.ok(v >= c.min - 1e-9 && v <= c.max + 1e-9, `${c.key} in range`); }
// layers draw from their own streams: the band moving leaves the lattice where it was
const lat = (s) => S.draw(s, null, 5).marks.filter((m) => m.clip).map((m) => JSON.stringify(m)).join();
assert.equal(lat({ ...st, variance: 0 }), lat({ ...st, variance: 0, bandRough: 0.1 }));
// the words
assert.equal(S.faceLine([0, 0, 1, -1, -1, -1]), '1–2 ↑   3 →   4–6 stay');
assert.equal(S.summary([0, 0, 1, -1, -1, -1]), 'Six outcomes · one state · two exits');
// every control names a key of every style
for (const c of T.SCHEMA) for (const s of T.SUIT_STYLES) assert.ok(c.key in s, `${s.name} has ${c.key}`);
console.log('seals ok');
