// Settle's rules, on their own: turns, the ray, where a piece goes, and a quiet player that
// keeps the bed low for a long while. (node cells/lab/devtools/settle.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/settle/game.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Bed, Bag, SHAPES, orientations, rotate, norm, raycast, placeFor, choose, N, H } = g;

// turns: four quarter turns come home; the 3D tetracubes have 24 ways, a square 3, a cube 1
for (const s of SHAPES) for (let a = 0; a < 3; a++) {
  let c = norm(s.cubes);
  for (let i = 0; i < 4; i++) c = rotate(c, a);
  assert.deepEqual(c, norm(s.cubes), `${s.name} about ${a}`);
}
assert.equal(orientations(SHAPES.find((s) => s.name === 'one').cubes).length, 1);
assert.equal(orientations(SHAPES.find((s) => s.name === 'square').cubes).length, 3);
assert.equal(orientations(SHAPES.find((s) => s.name === 'branch').cubes).length, 8);
assert.equal(orientations(SHAPES.find((s) => s.name === 'twist').cubes).length, 12);

// the ray: straight down onto an empty bed lands on the floor; onto a cube, on top of it
const bed = new Bed();
assert.deepEqual(raycast(bed, [2.5, 20, 2.5], [0, -1, 0]), { cell: [2, 0, 2], normal: [0, 1, 0] });
bed.set(2, 0, 2, 1);
assert.deepEqual(raycast(bed, [2.5, 20, 2.5], [0, -1, 0]), { cell: [2, 1, 2], normal: [0, 1, 0] });
// from the side, against the cube's face
assert.deepEqual(raycast(bed, [-3, 0.5, 2.5], [1, 0, 0]), { cell: [1, 0, 2], normal: [-1, 0, 0] });
// a piece against that face: it fits, and touches
const at = placeFor(bed, norm([[0, 0, 0], [1, 0, 0]]), { cell: [1, 0, 2], normal: [-1, 0, 0] });
assert.ok(at && bed.fits(norm([[0, 0, 0], [1, 0, 0]]), at));

// a layer filled is taken out, and what's above comes down
const b2 = new Bed();
for (let x = 0; x < N; x++) for (let z = 0; z < N; z++) b2.set(x, 0, z, 1);
b2.set(1, 1, 1, 3);
assert.deepEqual(b2.full(), [0]);
b2.remove(0);
assert.equal(b2.at(1, 0, 1), 3);
assert.equal(b2.count(), 1);

// the bag: the same seed, the same pieces; resuming partway gives the same next
const p1 = new Bag(7); for (let i = 0; i < 5; i++) p1.next();
const p2 = new Bag(7, 5);
assert.deepEqual(p1.next(), p2.next());

// the quiet player: a long, calm game
const play = new Bed();
const bag = new Bag(42);
let layers = 0;
let pieces = 0;
for (; pieces < 400; pieces++) {
  const p = bag.next();
  const c = choose(play, p.cubes);
  if (!c) break;
  play.place({ ...p, cubes: c.cubes }, c.at);
  for (const y of play.full().reverse()) { play.remove(y); layers++; }
}
console.log(`quiet player: ${pieces} pieces, ${layers} layers, height ${play.height()}`);
assert.ok(pieces === 400 && play.height() < H / 2, 'the quiet player keeps it low');
console.log('ok');
