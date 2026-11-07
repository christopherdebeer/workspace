/**
 * Builds to start from, or to watch (the lab's preview builds one by itself, a block at a time): each a list of
 * cells in the order a hand would set them, so watching one is watching every block answer the ones that come after.
 */
export type Cell = [number, number, number];

/** a courtyard house: a hall at the back, three high, a porch in the middle of it (an empty bay two deep, covered);
 * over it a terrace; wings two high either side of a court; a front wall with a gate. Nothing else is said: the water,
 * beds, trees, doors and windows are what the stone round them makes of the empty cells */
function courtyard(): Cell[] {
  const out: Cell[] = [];
  for (let x = 0; x <= 10; x++) for (let z = 6; z <= 8; z++) for (let y = 0; y <= 2; y++) if (!(x >= 4 && x <= 6 && z <= 7 && y <= 1)) out.push([x, y, z]);
  for (let x = 3; x <= 7; x++) for (let z = 6; z <= 8; z++) out.push([x, 3, z]);
  for (const x0 of [0, 9]) for (let x = x0; x <= x0 + 1; x++) for (let z = 0; z <= 5; z++) for (let y = 0; y <= 1; y++) out.push([x, y, z]);
  for (let x = 2; x <= 8; x++) for (let y = 0; y <= 1; y++) if (!(x === 5 && y === 0)) out.push([x, y, 0]);
  return dedupe(out);
}

/** a ring of wall round a court, towers at its corners, a gate in its front: windows, battlements, an arch */
function castle(): Cell[] {
  const out: Cell[] = [], N = 7;
  const tower = (x: number, z: number) => { for (let y = 0; y < 5; y++) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) out.push([x + a, y, z + b]); };
  for (let y = 0; y < 3; y++) for (let i = 0; i <= N; i++) {
    for (const [x, z] of [[i, 0], [i, N], [0, i], [N, i]] as Array<[number, number]>) {
      // (the gate: two cells left open in the front wall, carried over at the top)
      if (z === 0 && (x === 3 || x === 4) && y < 2) continue;
      out.push([x, y, z]);
    }
  }
  tower(-1, -1); tower(N, -1); tower(-1, N); tower(N, N);
  return dedupe(out);
}

/** columns three apart and arches over them, twice over, and a terrace on top */
function arcade(): Cell[] {
  const out: Cell[] = [];
  for (let z = 0; z < 2; z++) {
    for (let x = 0; x <= 12; x += 4) for (let y = 0; y < 2; y++) out.push([x, y, z * 4]);
    for (let x = 0; x <= 12; x++) out.push([x, 2, z * 4]);
  }
  for (let z = 1; z < 4; z++) for (let x = 0; x <= 12; x += 4) out.push([x, 2, z]);
  return dedupe(out);
}

/** a pier in the water, held out both ways; a stair up to it; stones about */
function harbour(): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < 3; y++) out.push([0, y, 0], [1, y, 0]);
  for (let x = -2; x <= 3; x++) out.push([x, 3, 0]);
  for (let s = 0; s < 3; s++) for (let y = 0; y <= s; y++) out.push([4 + 2 - s, y, 0]);
  out.push([-4, 0, 2], [-3, 0, 3], [3, 0, 3], [5, 1, 3], [5, 0, 3], [-1, 0, -3]);
  for (let y = 0; y < 4; y++) out.push([-4, y, -2]);
  return dedupe(out);
}

/** a house: walls three high with windows, a floor carried over a doorway, a parapet */
function house(): Cell[] {
  const out: Cell[] = [], W = 5, D = 4;
  for (let y = 0; y < 4; y++) for (let x = 0; x <= W; x++) for (let z = 0; z <= D; z++) {
    const edge = x === 0 || x === W || z === 0 || z === D;
    if (!edge && y < 3) continue;
    if (z === 0 && x === 2 && y < 2) continue;
    out.push([x, y, z]);
  }
  return dedupe(out);
}

/** two tiers of piers three apart, an arch between each two: the lower tier's end piers pushed outward */
function aqueduct(): Cell[] {
  const out: Cell[] = [];
  for (const [y0, y1] of [[0, 2], [3, 5]]) {
    for (let x = 0; x <= 12; x += 3) for (let y = y0; y < y1; y++) out.push([x, y, 0]);
    for (let x = 0; x <= 12; x++) out.push([x, y1, 0]);
  }
  return dedupe(out);
}

/** stones of one to four blocks high in a ring, and in the middle two pairs with a block across them */
function stones(): Cell[] {
  const out: Cell[] = [];
  [[4, 0], [3, 3], [0, 4], [-3, 3], [-4, 0], [-3, -3], [0, -4], [3, -3]].forEach(([x, z], i) => { for (let y = 0; y <= (i * 5) % 4; y++) out.push([x, y, z]); });
  for (let y = 0; y < 2; y++) out.push([-1, y, 0], [1, y, 0]);
  for (let x = -1; x <= 1; x++) out.push([x, 2, 0]);
  return dedupe(out);
}

/** a village on a cliff over a harbour: two quay arms and a quay along the back round a basin of water; behind it rock
 * in three terraces, each four deep and higher than the last; on each, small masses two or three across, one to
 * three high, with gaps between. Nothing else is said: the rock, the houses' washes and roofs, their shutters and
 * balconies, the washing across the gaps, the water and the boats in it are what the stone round them makes of it */
function cliff(): Cell[] {
  const out: Cell[] = [];
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) out.push([x, y, z]); };
  // (the quays: two arms and the back)
  box(0, 1, 0, 0, 0, 8); box(12, 13, 0, 0, 0, 8); box(0, 13, 0, 0, 7, 8);
  // (the rock, in three terraces, and a crag at the right rising over the harbour)
  box(0, 13, 0, 2, 9, 12); box(0, 13, 0, 4, 13, 16); box(3, 13, 0, 6, 17, 20); box(10, 13, 0, 6, 9, 12);
  // (on each terrace, at its back, the masses: [x0, x1, high])
  const row = (z0: number, y0: number, masses: Array<[number, number, number]>) => { for (const [x0, x1, h] of masses) box(x0, x1, y0, y0 + h - 1, z0, z0 + 1); };
  row(11, 3, [[0, 1, 2], [3, 5, 3], [7, 8, 2]]);
  row(11, 7, [[11, 12, 2]]);
  row(15, 5, [[1, 2, 2], [4, 6, 3], [8, 9, 2]]);
  row(19, 7, [[4, 5, 2], [8, 10, 3], [12, 13, 2]]);
  return dedupe(out);
}

function dedupe(cells: Cell[]): Cell[] {
  const seen = new Set<string>(), out: Cell[] = [];
  for (const c of cells) { const k = c.join(); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  // (in the order a hand builds: from the ground up)
  return out.sort((a, b) => a[1] - b[1]);
}

export const DEMOS: Record<string, () => Cell[]> = { courtyard, castle, arcade, aqueduct, stones, house, harbour, cliff };
