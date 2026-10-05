// Markovs Chains' rules, on their own: the deck, the table, a bot game that ends.
// (node cells/lab/devtools/markovs.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const load = async (f) => { const o = await build({ entryPoints: [new URL(`../client/markovs/${f}`, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const D = await load('deck.ts');
const T = await load('table.ts');

// the pack: 54, four Kings, nine designs no two alike under rotation
assert.equal(D.pack().length, 54);
assert.equal(D.pack().filter((c) => c.rank === D.KING).length, 4);
const canon = (faces) => { let best = null; for (let rot = 0; rot < 4; rot++) { const s = faces.map((d) => (d < 0 ? 'x' : (d + rot) % 4)).join(''); if (!best || s < best) best = s; } return best; };
assert.equal(new Set(D.DESIGNS.map((d) => canon(d.faces))).size, D.DESIGNS.length, 'no design is another turned');
for (const d of D.DESIGNS) assert.equal(d.faces.length, 6);
// turning: a card's exits turn with it
const t = { card: { suit: 0, rank: 6 }, rotation: 1 };
assert.deepEqual(D.exits(t), [1, 1, 1, 2, 2, 2], 'an elbow turned once: east, then south');
// the counter: an open exit stays, unless the table wraps
const b = D.setup();
b.set(D.key(2, 1), { card: { suit: 0, rank: 2 }, rotation: 0 });
assert.equal(D.destination(b, D.key(2, 2), 1, D.RULES).at, D.key(2, 1), 'the start is a cross: north on a 1');
assert.equal(D.destination(b, D.key(2, 1), 1, D.RULES).at, D.key(2, 0), 'north again: the King of hearts');
assert.equal(D.destination(b, D.key(2, 0), 3, D.RULES).reason, 'king');
b.set(D.key(0, 1), { card: { suit: 0, rank: 2 }, rotation: 1 });
assert.equal(D.destination(b, D.key(0, 1), 6, D.RULES).reason, 'open', 'west off the table: stays');
assert.equal(D.destination(b, D.key(0, 1), 6, { ...D.RULES, wrap: true }).reason, 'open', 'wrapped to an empty space: stays');
b.set(D.key(4, 1), { card: { suit: 0, rank: 2 }, rotation: 0 });
assert.equal(D.destination(b, D.key(0, 1), 6, { ...D.RULES, wrap: true }).at, D.key(4, 1), 'wrapped to a card: moves');
// laying: beside the chain, on the rim if allowed, an Ace anywhere, never on a King
const two = { suit: 1, rank: 2 };
assert.ok(D.canPlace(b, D.key(1, 1), two, D.RULES, 'build'), 'beside the chain');
assert.ok(!D.canPlace(b, D.key(4, 4), two, D.RULES, 'build'), 'not off on its own');
assert.ok(D.canPlace(b, D.key(4, 4), two, { ...D.RULES, rim: true }, 'build'), 'on the rim, when allowed');
assert.ok(D.canPlace(b, D.key(3, 3), { suit: 1, rank: D.ACE }, D.RULES, 'build'), 'an Ace anywhere');
assert.ok(!D.canPlace(b, D.key(2, 0), { suit: 1, rank: D.ACE }, D.RULES, 'race'), 'never on a King');
assert.ok(!D.canPlace(b, D.key(2, 1), two, D.RULES, 'build'), 'no covering while spaces are empty');
assert.ok(D.canPlace(b, D.key(2, 1), two, D.RULES, 'race'), 'covering in the race');
// the forecast conserves mass
const f = D.forecast(b, D.key(2, 2), D.RULES, 6);
assert.ok(Math.abs(f.wins.reduce((a, c) => a + c, 0) + [...f.mass.values()].reduce((a, c) => a + c, 0) - 1) < 1e-9);

// a table: the deal, the secret suits, the build, then the race; bots play it out
for (const [seed, n] of [[1, 2], [2, 3], [3, 4], [4, 4]]) {
  const g = T.newGame(seed, ['a', 'b', 'c', 'd'].slice(0, n), Array(n).fill(true));
  assert.equal(new Set(g.players.map((p) => p.suit)).size, n, 'suits all different');
  assert.ok(g.players.every((p) => p.hand.length === 3));
  assert.equal(g.pile.length + 3 * n + 4 + 1 + n, 54, 'every card accounted for');
  let steps = 0;
  while (g.phase !== 'over' && steps++ < 400) { const a = T.botAction(g); assert.ok(a, 'the bot always has a move'); T.act(g, a); }
  assert.ok(g.phase === 'over', `seed ${seed}: the game ends`);
  assert.ok(g.rolls <= T.ROLL_CAP);
  if (g.winner >= 0) assert.equal(g.board.get(g.token).card.suit, g.players[g.winner].suit, 'the winner is at their own King');
  assert.ok(!D.hasEmpty(g.board), 'the table was built');
}
// a decoy King sends the counter back to the start
{
  const g = T.newGame(5, ['a', 'b'], [true, true]);
  const decoy = [0, 1, 2, 3].find((s) => !g.players.some((p) => p.suit === s));
  g.phase = 'race'; g.laid = true; g.token = D.key(2, 1);
  g.board.set(D.key(2, 1), { card: { suit: 0, rank: 2 }, rotation: 0 });
  // (put the decoy King north of it)
  const was = g.board.get(D.KING_AT[0]); g.board.set(D.KING_AT[0], { card: { suit: decoy, rank: D.KING }, rotation: 0 }); g.board.set(D.KING_AT[decoy], was);
  T.act(g, { kind: 'roll', face: 1 });
  assert.equal(g.token, D.START, 'nobody\'s King: back to the start');
  assert.equal(g.phase, 'race');
}
// same seed, same game
const a = T.newGame(7, ['x', 'y'], [true, true]), c = T.newGame(7, ['x', 'y'], [true, true]);
for (let i = 0; i < 60 && a.phase !== 'over'; i++) { T.act(a, T.botAction(a)); T.act(c, T.botAction(c)); }
assert.deepEqual(a.log, c.log);
console.log('markovs ok');
