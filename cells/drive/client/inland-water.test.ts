/** Self-test for the inland-water tracer. Bundled and run by
 *  devtools/inland-water.test.mjs, the way hydro.test.ts is. */
import {
  chaikin, inlandComponents, inlandMask, maskSignature, mergeCollinear, ringArea, shapeRing, simplifyRing, traceRings,
} from './inland-water';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function grid(w: number, h: number, cells: Array<[number, number]>): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const [x, y] of cells) m[y * w + x] = 1;
  return m;
}

function rect(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push([x, y]);
  return out;
}

export function runInlandWaterSelfTest(): void {
  // A square: one component, one outer ring, four corners once merged.
  {
    const m = grid(16, 16, rect(2, 2, 6, 6));
    const comps = inlandComponents(m, 16, 16, 4);
    assert(comps.length === 1, `square is one component (${comps.length})`);
    assert(comps[0].pixels === 16, `square has 16 pixels (${comps[0].pixels})`);
    assert(!comps[0].onEdge, 'square is not on the edge');
    const label = new Int32Array(256).fill(-1);
    for (let i = 0; i < 256; i++) if (m[i]) label[i] = 0;
    const raw = traceRings(label, 0, 16, 16);
    assert(raw.length === 1, `square traces one ring (${raw.length})`);
    const merged = mergeCollinear(raw[0]);
    assert(merged.length === 8, `square merges to four corners (${merged.length / 2})`);
    assert(ringArea(merged) === 16, `outer ring is clockwise-positive with area 16 (${ringArea(merged)})`);
    for (let i = 0; i < comps[0].outer.length; i += 2) {
      assert(comps[0].outer[i] >= 2 && comps[0].outer[i] <= 6 && comps[0].outer[i + 1] >= 2 && comps[0].outer[i + 1] <= 6,
        'shaped ring stays inside the square');
    }
    assert(comps[0].holes.length === 0, 'square has no holes');
  }
  // A ring with an island: one hole, opposite winding.
  {
    const cells = rect(2, 2, 10, 10).filter(([x, y]) => !(x >= 5 && x < 7 && y >= 5 && y < 7));
    const m = grid(16, 16, cells);
    const comps = inlandComponents(m, 16, 16, 4);
    assert(comps.length === 1, 'lake with island is one component');
    assert(comps[0].holes.length === 1, `island is one hole (${comps[0].holes.length})`);
    const label = new Int32Array(256).fill(-1);
    for (let i = 0; i < 256; i++) if (m[i]) label[i] = 0;
    const raw = traceRings(label, 0, 16, 16).sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    assert(ringArea(mergeCollinear(raw[0])) === 64, `outer area 64 (${ringArea(mergeCollinear(raw[0]))})`);
    assert(ringArea(mergeCollinear(raw[1])) === -4, `hole is counter-clockwise, area -4 (${ringArea(mergeCollinear(raw[1]))})`);
  }
  // Checkerboard corner: two pixels touching a third diagonally stay one
  // component with one simple outer ring — the right-most turn keeps the
  // trace from crossing itself.
  {
    const m = grid(8, 8, [[1, 1], [1, 2], [2, 2], [3, 3], [3, 2]]);
    const comps = inlandComponents(m, 8, 8, 1);
    assert(comps.length === 1, `L-with-diagonal is one component (${comps.length})`);
    assert(comps[0].pixels === 5, 'five pixels');
    const label = new Int32Array(64).fill(-1);
    for (let i = 0; i < 64; i++) if (m[i]) label[i] = 0;
    const raw = traceRings(label, 0, 8, 8);
    const total = raw.reduce((a, r) => a + ringArea(mergeCollinear(r)), 0);
    assert(Math.abs(total - 5) < 1e-9, `rings enclose exactly the five pixels (${total})`);
  }
  // Ocean pixels are not inland; lone pixels are not ponds; the edge is noted.
  {
    const cover = new Uint8Array(64);
    for (const [x, y] of rect(0, 0, 3, 3)) cover[y * 8 + x] = 80;      // touches the edge
    cover[1 * 8 + 6] = 80;                                             // a lone pixel
    for (const [x, y] of rect(4, 4, 8, 8)) cover[y * 8 + x] = 80;      // the sea
    const ocean = new Uint8Array(64);
    for (const [x, y] of rect(4, 4, 8, 8)) ocean[y * 8 + x] = 1;
    const m = inlandMask(cover, ocean, 64);
    let count = 0; for (let i = 0; i < 64; i++) count += m[i];
    assert(count === 10, `inland mask is the corner and the lone pixel (${count})`);
    const comps = inlandComponents(m, 8, 8, 4);
    assert(comps.length === 1, `lone pixel dropped (${comps.length})`);
    assert(comps[0].onEdge, 'corner component is on the edge');
    const known = new Float32Array(64).fill(NaN);
    known[1 * 8 + 1] = 12;
    const withKnown = inlandComponents(m, 8, 8, 4, 200, known);
    assert(withKnown[0].known === 1, `known pixels counted (${withKnown[0].known})`);
    const m2 = inlandMask(cover, null, 64);
    assert(maskSignature(m) !== maskSignature(m2), 'signature changes with the ocean');
    assert(maskSignature(m) === maskSignature(inlandMask(cover, ocean, 64)), 'signature is stable');
  }
  // Shaping: collinear points go, Chaikin doubles, the simplifier keeps corners.
  {
    const sq = [0, 0, 1, 0, 2, 0, 2, 1, 2, 2, 1, 2, 0, 2, 0, 1];
    assert(mergeCollinear(sq).length === 8, 'collinear points merged');
    assert(chaikin(mergeCollinear(sq), 1).length === 16, 'one Chaikin pass doubles the corners');
    const simple = simplifyRing(sq, 0.1);
    assert(simple.length === 8, `simplifier keeps the four corners (${simple.length / 2})`);
    const shaped = shapeRing(sq);
    assert(shaped.length >= 8 && shaped.length <= 16, `shaped square is 4..8 points (${shaped.length / 2})`);
  }
}
