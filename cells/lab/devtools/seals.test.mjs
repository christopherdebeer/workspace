// Seals: pure, deterministic, and saying what the card says.
// (node cells/lab/devtools/seals.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const S = await load('seals/seal.ts'), T = await load('seals/styles.ts'), D = await load('markovs/deck.ts');

// every junction of every suit, a few seeds: no NaN, the same twice
for (let suit = 0; suit < 4; suit++) for (let rank = 1; rank <= 10; rank++) for (const seed of [1, 77, 4096]) {
  const faces = D.facesOf({ suit, rank });
  const a = S.sealCard({ style: T.SUIT_STYLES[suit], seed, faces, title: 't', id: 'x' });
  assert.ok(!/NaN|undefined|Infinity/.test(a), `clean svg ${suit}/${rank}/${seed}`);
  assert.equal(a, S.sealCard({ style: T.SUIT_STYLES[suit], seed, faces, title: 't', id: 'x' }), 'deterministic');
  // the junction: one shaft per distinct exit, a roundel per face numbered 1–6, a loop iff stays
  const p = S.sample(T.SUIT_STYLES[suit], seed);
  const j = S.junction(p, faces);
  const nums = j.filter((m) => m.k === 'text').map((m) => Number(m.text)).sort();
  assert.deepEqual(nums, [1, 2, 3, 4, 5, 6], 'six numbered faces');
  const heads = j.filter((m) => m.k === 'path' && m.fill === 'ink').length;
  const exits = new Set(faces.filter((d) => d >= 0)).size, stays = faces.includes(-1) ? 1 : 0;
  assert.equal(heads, exits + stays, 'a head per exit, one for the loop');
  // roundels stay inside the rim, and none overlaps another
  const rs = j.filter((m) => m.k === 'circle' && m.fill === 'paper' && m.r > 2);
  for (const r of rs) assert.ok(Math.hypot(r.x, r.y) + r.r < S.R, `roundel inside the rim ${suit}/${rank}`);
  const faceRs = rs.filter((r) => Math.hypot(r.x, r.y) > 1);
  for (let i = 0; i < faceRs.length; i++) for (let k = i + 1; k < faceRs.length; k++) {
    const a1 = faceRs[i], b1 = faceRs[k];
    assert.ok(Math.hypot(a1.x - b1.x, a1.y - b1.y) >= a1.r + b1.r - 0.6, `roundels apart ${suit}/${rank}: ${JSON.stringify([a1, b1])}`);
  }
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
