// Bricks' rules, on their own: fitting, connecting, the ray, where a brick goes, the quiet
// builder's town. (node cells/lab/devtools/bricks.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/bricks/build.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { World, raycast, placeFor, town, N, H, PLATE } = g;

const w = new World();
// on the baseplate it connects; in mid-air it doesn't; on studs or under a brick it does
assert.ok(w.fits(2, 4, 3, [0, 0, 0]) && w.connects(2, 4, 3, [0, 0, 0]));
assert.ok(!w.connects(2, 4, 3, [0, 5, 0]));
const a = w.add({ w: 2, d: 4, h: 3, colour: 4, at: [3, 0, 3] });
assert.ok(w.connects(1, 1, 1, [4, 3, 6]), 'on its studs');
assert.ok(!w.connects(1, 1, 1, [5, 3, 6]), 'beside its studs, not on them');
assert.ok(!w.fits(1, 1, 3, [4, 2, 4]), 'into it');
w.add({ w: 2, d: 2, h: 3, colour: 1, at: [3, 6, 3] }); // hung on nothing — rules don't stop add()
assert.ok(w.connects(1, 1, 3, [3, 3, 3]), 'between two: under one, on the other');

// the ray: straight down onto the plate, then onto the brick's top
const r1 = raycast(w, [10.5, 50, 10.5], [0, -1, 0]);
assert.deepEqual(r1, { cell: [10, 0, 10], normal: [0, 1, 0], brick: -1 });
const r2 = raycast(w, [4.5, 50, 5.5], [0, -1, 0]);
assert.deepEqual(r2.cell, [4, 3, 5]);
assert.equal(r2.brick, a);
// from the side, against its face, a plate's height up
const r3 = raycast(w, [-5, 0.5 * PLATE, 4.5], [1, 0, 0]);
assert.deepEqual(r3, { cell: [2, 0, 4], normal: [-1, 0, 0], brick: a });

// where a brick goes: on top, centred under the finger
assert.deepEqual(placeFor(w, 2, 2, 3, r2), [4, 3, 5]);
// beside it (level with its bottom), its near edge against the face, never into it
const side = placeFor(w, 2, 2, 3, r3);
assert.ok(side && side[0] + 2 <= 3 && side[1] === 0, JSON.stringify(side));
// mid-air hits find somewhere that connects
const hi = placeFor(w, 1, 4, 1, { cell: [12, 10, 12], normal: [0, 1, 0], brick: 0 });
assert.equal(hi, null, 'nothing near to hold on to');

// remove and restore (undo)
const gone = w.remove(a);
assert.equal(w.at(3, 0, 3), 0);
w.restore(a, gone);
assert.equal(w.at(3, 0, 3), a + 1);

// the town: builds, almost all of it fits and connects
const t = new World();
let set = 0, skipped = 0;
for (const b of town(21)) {
  if (t.fits(b.w, b.d, b.h, b.at) && t.connects(b.w, b.d, b.h, b.at)) { t.add(b); set++; } else skipped++;
}
console.log(`town 21: ${set} bricks set, ${skipped} skipped, ${t.height()} plates high`);
assert.ok(set > 60 && skipped < set / 5);
console.log('ok');

// the bag: same seed, same bricks; resuming partway gives the same next; a scheme's colours only
{
  const { Bag, SCHEMES } = g;
  const a = new Bag(5); for (let i = 0; i < 7; i++) a.next();
  const b = new Bag(5, 7);
  assert.deepEqual(a.next(), b.next());
  const bag = new Bag(9);
  const cs = new Set(bag.scheme.colours);
  let plates = 0;
  for (let i = 0; i < 400; i++) { const s = bag.next(); assert.ok(cs.has(s.colour)); if (s.h === 1) plates++; }
  assert.ok(plates > 40 && plates < 140, `plates ${plates}`);
  assert.ok(SCHEMES.length >= 4);
  console.log('bag ok');
}
