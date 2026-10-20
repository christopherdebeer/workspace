// Buildings over voids, looked at (node cells/lab/devtools/labyrinth-voids-probe.mjs): a tower over a way, a house on a
// bridge; each column's stack, and the buildings found.
import './labyrinth-node.mjs';
const { World } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const top = (w, [i, j]) => { const t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
const stroke = (w, a, b, intent, end) => { const op = G.trace(w, top(w, a), G.connect([a, b]), end ? top(w, end) : null, () => 0, 0, [], intent); if (op.refused) throw new Error(op.refused); w.apply({ ...op, alts: undefined }); return op; };
const column = (w, [i, j], n, from = w.ground(i, j)) => w.apply({ add: Array.from({ length: n }, (_, k) => [from + k, i, j, 0]) });
const desc = (w, i, j) => { let s = ''; for (let k = 0; k < 7; k++) s += w.span(k, i, j) ? 'S' : w.archway(k, i, j) >= 0 ? 'A' : w.thin.has?.(k) ? 't' : w.block(k, i, j) ? '#' : w.stair(k, i, j) >= 0 ? 's' : '.'; return s; };
export const SCENES = {
  gatehouse(w) { stroke(w, [2, 6], [10, 6], 'way'); for (let i = 5; i <= 6; i++) for (let j = 5; j <= 7; j++) column(w, [i, j], 4); },
  bridgehouse(w) { column(w, [3, 6], 2); column(w, [9, 6], 2); stroke(w, [3, 6], [9, 6], 'mass', [9, 6]); for (let i = 5; i <= 7; i++) column(w, [i, 6], 2, 2); },
  bridgehouse2(w) { for (const j of [6, 7]) { column(w, [3, j], 2); column(w, [9, j], 2); } stroke(w, [3, 6], [9, 6], 'mass', [9, 6]); stroke(w, [3, 7], [9, 7], 'mass', [9, 7]); for (let i = 5; i <= 7; i++) column(w, [i, 7], 3, 2); },
};
if (import.meta.url.endsWith(process.argv[1])) for (const [name, f] of Object.entries(SCENES)) {
  const w = new World(1); f(w);
  console.log(`\n== ${name}`);
  for (let j = 4; j <= 8; j++) console.log(' ', Array.from({ length: 9 }, (_, q) => desc(w, q + 2, j)).join(' '));
  for (const b of BU.buildings(w).list) console.log('  building', JSON.stringify({ cols: b.cols, h: b.h, tower: b.tower, roof: b.roof, walked: b.walked, inside: b.inside, doors: b.openings.filter((o) => o.kind === 'door').map((o) => [o.k, o.i, o.j, o.d]), windows: b.openings.filter((o) => o.kind === 'window').length }));
}
