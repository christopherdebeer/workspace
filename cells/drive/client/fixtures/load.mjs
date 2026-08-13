/**
 * FIXTURE FORMAT — read and write in one place.
 *
 * A capture is the world as a real session had it: the origin, the terrain
 * tiles' extents, the decks the session actually settled on, and every
 * renderWays call in the order the tiles really arrived. That last part is the
 * point — the defects being chased live in the ordering, so a tidy
 * reconstruction would test a world nobody plays.
 *
 * Arrival order is also why the raw tape is so repetitive: each call carries the
 * ways it must build AND its neighbours' cached copies, so a road that spans
 * ten tiles is written out ten times over. Measured on the Chapman's arrival:
 * 1706 way copies, 562 distinct. So the file stores each way ONCE and the calls
 * reference it, which is a third of the bytes for exactly the same replay.
 *
 * The key is NOT the way id. The same OSM way reaches the solver clipped to a
 * tile and whole from a neighbour's halo, and which one a call gets is the
 * difference between chaining a road and chaining a fragment of it — collapsing
 * them by id would quietly delete the thing under test. Nor is `id:pointcount`
 * enough: two different clips of one way can have the same number of points,
 * and when they did, five stations vanished from the replay. The endpoints go
 * in the key too, and the fidelity assertion in the test — replayed stations
 * must equal the live count — is what caught it and what will catch the next
 * one.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const keyOf = (e) => {
  const g = e.geometry ?? [];
  const a = g[0], b = g[g.length - 1];
  return `${e.id}:${g.length}:${a ? `${a.lat},${a.lon}` : ''}:${b ? `${b.lat},${b.lon}` : ''}`;
};

/** Raw tape → the stored form. */
export function packFixture(fix) {
  const ways = {};
  const pack = (list) => (list ?? []).map((e) => {
    const k = keyOf(e);
    if (!ways[k]) ways[k] = { id: e.id, tags: e.tags, geometry: e.geometry };
    return k;
  });
  return {
    ...fix,
    ways,
    calls: fix.calls.map((c) => ({ els: pack(c.els), halo: pack(c.halo) })),
  };
}

/** The stored form → what a solver replay wants. Accepts an already-unpacked
 *  capture too, so a fixture taken before this format still replays. */
export function loadFixture(name) {
  const fix = JSON.parse(readFileSync(join(HERE, `${name}.json`), 'utf8'));
  fix.hints ??= [];
  if (!fix.ways) return fix;
  const deref = (ks) => ks.map((k) => fix.ways[k]);
  fix.calls = fix.calls.map((c) => ({ els: deref(c.els), halo: deref(c.halo ?? []) }));
  return fix;
}
