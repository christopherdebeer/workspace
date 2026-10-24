/**
 * Builds to start from, or to watch (the lab's preview builds one by itself, a block at a time): each a list of
 * cells in the order a hand would set them, so watching one is watching every block answer the ones that come after.
 */
export type Cell = [number, number, number];

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

function dedupe(cells: Cell[]): Cell[] {
  const seen = new Set<string>(), out: Cell[] = [];
  for (const c of cells) { const k = c.join(); if (!seen.has(k)) { seen.add(k); out.push(c); } }
  // (in the order a hand builds: from the ground up)
  return out.sort((a, b) => a[1] - b[1]);
}

export const DEMOS: Record<string, () => Cell[]> = { castle, arcade, harbour, house };
