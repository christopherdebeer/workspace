/**
 * THE BANK, AS THE KERNEL READS IT.
 *
 *   node cells/drive/devtools/bank-pass.test.mjs
 *
 * The packet is read three ways and must not be written three times.
 * `bankSolve` is STATION-DRIVEN through a grid, because a shoreline at half a
 * field texel is hundreds of stations and a refined tile is tens of thousands
 * of vertices, so the naive product is tens of millions of box tests for a
 * build that used to cost a hundred milliseconds all in. `bankTargetAtPacked`
 * is a plain walk over every station, which is what the diagnostic asks and
 * the build never needs. `bankBreakLines` walks it a third time for the
 * creases. One `bankProfileY` between the first two, so they cannot disagree
 * about the PROFILE — and this is what says they do not disagree about which
 * stations they reach.
 *
 * What is claimed, and every one of them is a fault that has been measured:
 *
 *   - EVERY VERTEX ENDS AT THE LOWER OF ITS OWN HEIGHT AND THE POINT QUERY'S,
 *     over a dense lattice with stations laid so their boxes straddle cell
 *     boundaries — which is the only arrangement that can catch a bucket that
 *     registers a station too narrowly.
 *   - `owned` IS SET WHEREVER A STATION SPOKE, refusal included: that is the
 *     flag the channel carve AND the interior floor stand down on.
 *   - A REFUSAL BINDS AN OVERLAPPING RESOLVED STATION. The first cut let a
 *     refused station mark the vertex and carry on, so any other station could
 *     still cut through it — the refusal costing exactly nothing, which is the
 *     thing it exists not to do.
 *   - THE FOUR CROSSING KINDS ARE FOUR DIFFERENT ANSWERS, and `crossingAt` is
 *     ASKED. Owning all four the same way deleted the distinction the carve's
 *     own rule turns on: a causeway or a road at grade is protected from both
 *     rules, while a bridge, a culvert or a ford is left UNOWNED so the
 *     crossing-aware channel path still runs under it.
 *   - THE SOLVE IS A PURE FUNCTION OF THE PACKET AND THE POINT. Two tiles
 *     sharing an edge agree to the bit along it, and building them in either
 *     order gives byte-identical results — so a seam cannot come from the
 *     kernel's own state, and arrival order cannot either.
 *   - THE CREASES COVER THE CHAIN. Consecutive stations of one chain join into
 *     a polyline whose segments abut; a refusal ends a run rather than being
 *     bridged; a ring closes; and when the budget binds the TOLERANCE rises
 *     instead of a stretch of shore being dropped.
 *
 * The negative control is the whole point: the bundle is re-imported with the
 * station's own reach removed from its insertion box, so a station registers in
 * one cell only. The agreement claims must then FAIL — a check that cannot fail
 * on the fault it names is decoration, which this repo has recorded four times.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/bank-pass');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const BROKEN = join(OUT, 'terrain-kernel-narrow.mjs');
{
  const src = readFileSync(BUNDLE, 'utf8');
  const needle = 'const m = reach + Math.max(packed[o + 8], packed[o + 12]);';
  if (!src.includes(needle)) { console.log('FAIL the negative control could not find the insertion box'); process.exit(1); }
  writeFileSync(BROKEN, src.replace(needle, 'const m = 0;'));
}
// AND A SECOND CONTROL FOR THE CREASES: the simplification switched off, which
// is the budget with nothing to spend but coverage. It is the fault the stride
// was — a shoreline described for as far as the cap reaches and not at all
// after that — arrived at from the other side.
const FLAT = join(OUT, 'terrain-kernel-nosimplify.mjs');
{
  const src = readFileSync(BUNDLE, 'utf8');
  const needle = '    if (n < 3) return pts;';
  if (!src.includes(needle)) { console.log('FAIL the crease control could not find the simplification'); process.exit(1); }
  writeFileSync(FLAT, src.replace(needle, '    if (n >= 0) return pts;'));
}
const mk = async (path) => (await import(path)).createTerrainKernel(
  () => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);
const K = await mk(BUNDLE);
const KN = await mk(BROKEN);
const KF = await mk(FLAT);

// The packet's layout is the resolver's; built by hand here rather than taken
// from bank-profile.ts, so what is under test is the KERNEL's reading of it and
// nothing else. [x, z, outX, outZ, waterline(absolute, already submerged),
// innerBed, innerReach, outerReach, alongFwdM, k, protectReach, flags,
// alongBackM, chainId, levelSlopeAlong]
const STRIDE = 15;
const station = (o) => [
  o.x, o.z, o.nx, o.nz, o.wl, o.bed, o.inR, o.outR, o.fwd ?? o.alongM, o.k,
  o.protect ?? 0, o.flags ?? 0, o.back ?? o.alongM, o.chain ?? 0, o.slope ?? 0,
];
const pack = (rows) => {
  const out = new Float32Array(rows.length * STRIDE);
  rows.forEach((r, i) => out.set(r, i * STRIDE));
  return out;
};

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

// A tile 240 m square on a 5 m lattice, with the river running east-west
// through the middle. The stations sit at 6 m along the shore — finer than the
// 24 m grid cell, so a station's own box spans several cells and several
// stations share each one, which is the arrangement the index has to survive.
const TILE = { tx: 0, ty: 0, xs: 0, zs: 0, w: 240, h: 240 };
const STEP = 5, NAT = 20;
const mkPos = (tile = TILE) => {
  const cols = tile.w / STEP + 1, rows = tile.h / STEP + 1;
  const pos = new Float32Array(cols * rows * 3);
  const ox = tile.xs + tile.w / 2, oz = tile.zs + tile.h / 2;
  let i = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    pos[i * 3] = tile.xs + c * STEP - ox;
    pos[i * 3 + 1] = NAT;
    pos[i * 3 + 2] = tile.zs + r * STEP - oz;
    i++;
  }
  return pos;
};
const packed = (() => {
  const rows = [];
  for (let x = 12; x <= 228; x += 6) {
    // Both banks of a channel at z = 120, outward normals pointing away from
    // it — two chains, which is what a river's two shores are.
    rows.push(station({ x, z: 112, nx: 0, nz: -1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 3, k: 0.25, chain: 0 }));
    rows.push(station({ x, z: 128, nx: 0, nz: 1, wl: 18, bed: 16.5, inR: 8, outR: 14, alongM: 3, k: 0.25, chain: 1 }));
  }
  // One refused station away from the channel: it must own its land side and
  // move nothing, which is a different fact from "no station reached here".
  rows.push(station({ x: 60, z: 40, nx: 0, nz: 1, wl: 19, bed: 18, inR: 6, outR: 10, alongM: 6, k: 0.3, protect: 9, flags: 1, chain: 2 }));
  return pack(rows);
})();

const storeOf = (over = {}) => ({
  grid: 24, baseElev: 0,
  onRoad: () => false,
  crossingAt: () => null,
  hydroBank: () => packed,
  ...over,
});

/** Run a kernel's solve+apply and compare every vertex against the point query. */
const run = (kernel, over = {}, pk = packed) => {
  const pos = mkPos();
  const n = pos.length / 3;
  const owned = new Uint8Array(n), target = new Float32Array(n);
  const store = storeOf({ hydroBank: () => pk, ...over });
  kernel.bankSolve(store, TILE, pos, owned, target);
  const moved = kernel.bankApply(pos, target);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  const onRoad = store.onRoad;
  let wrong = 0, ownedWrong = 0, lowered = 0, ownedN = 0, worst = 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    // The point query is the reference: it walks every station and knows
    // nothing of the grid, so a disagreement is the index's.
    const q = K.bankTargetAtPacked(pk, x, z);
    const road = onRoad(x, z);
    const want = q && q.y !== null && !road ? Math.min(NAT, q.y) : NAT;
    const got = pos[v * 3 + 1];
    if (Math.abs(got - want) > 1e-6) { wrong++; worst = Math.max(worst, Math.abs(got - want)); }
    if ((owned[v] === 1) !== !!(q && q.owned)) ownedWrong++;
    if (got < NAT - 1e-9) lowered++;
    if (owned[v]) ownedN++;
  }
  return { wrong, ownedWrong, lowered, ownedN, moved, worst, n, pos, owned, target };
};

console.log('the indexed solve agrees with the point query:');
{
  const r = run(K);
  check(r.wrong === 0, `every vertex ends at the lower of its own height and the query's (wrong ${r.wrong}, worst ${r.worst.toFixed(6)} m)`);
  check(r.ownedWrong === 0, `owned matches the query's own flag at every vertex (mismatched ${r.ownedWrong})`);
  // Without these the run above is vacuous: a pass that touched nothing agrees
  // with a query that answers nothing everywhere.
  check(r.lowered > 200, `and it actually lowered ground (${r.lowered} of ${r.n} vertices, moved ${r.moved})`);
  check(r.ownedN > r.lowered, `owning more than it lowered — the refusal and the underwater flat own without moving (${r.ownedN} owned)`);
}

console.log('the solve reads no height, so it may run before the floor:');
{
  // The whole of review item 3 rests on this: ownership is decided in the
  // heights pass, BEFORE anything has written a height. A solve that read
  // pos[y] would answer differently there and the floor's stand-down would be
  // keyed on the wrong region.
  const a = run(K);
  const pos = mkPos();
  for (let v = 0; v < pos.length / 3; v++) pos[v * 3 + 1] = 0;   // no heights yet
  const owned = new Uint8Array(pos.length / 3), target = new Float32Array(pos.length / 3);
  K.bankSolve(storeOf(), TILE, pos, owned, target);
  let same = true;
  for (let v = 0; v < target.length && same; v++) {
    if (owned[v] !== a.owned[v]) same = false;
    const x = target[v], y = a.target[v];
    if (!(x === y || (Number.isNaN(x) && Number.isNaN(y)))) same = false;
  }
  check(same, 'the same owned set and the same targets over a lattice with no heights written');
}

console.log('a refusal binds an overlapping resolved station:');
{
  // The reproduction of review finding 2: a resolved station whose reach
  // covers ground a refusal is protecting must not cut it.
  const overlap = pack([
    station({ x: 120, z: 120, nx: 0, nz: 1, wl: 19, bed: 17, inR: 6, outR: 20, alongM: 30, k: 0.25, chain: 0 }),
    station({ x: 120, z: 124, nx: 0, nz: 1, wl: 19, bed: 17, inR: 6, outR: 10, alongM: 20, k: 0.3, protect: 12, flags: 1, chain: 1 }),
  ]);
  const pos = mkPos(), n = pos.length / 3;
  const owned = new Uint8Array(n), target = new Float32Array(n);
  K.bankSolve(storeOf({ hydroBank: () => overlap }), TILE, pos, owned, target);
  K.bankApply(pos, target);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let inBoth = 0, cut = 0, ownedN = 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    if (Math.abs(x - 120) > 15 || z < 126 || z > 134) continue;   // inside the refusal's box
    inBoth++;
    if (owned[v]) ownedN++;
    if (pos[v * 3 + 1] < NAT - 1e-9) cut++;
  }
  check(inBoth > 0, `the arrangement reaches ground both stations claim (${inBoth} vertices)`);
  check(ownedN === inBoth, `every one of them is owned (${ownedN})`);
  check(cut === 0, `and the resolved station cut none of them (${cut})`);
  // …and the same ground away from the refusal IS cut, or the claim above is
  // satisfied by a station that reaches nothing. The band has to be inside the
  // profile's own reach as well as outside the refusal's: at wl 19 and k 0.25
  // the land side rises back above natural ground four metres out, so a
  // control taken further than that would pass for the wrong reason.
  let far = 0, farCut = 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    if (Math.abs(x - 120) > 15 || z < 120 || z > 122) continue;   // outward, short of the refusal at 124
    far++;
    if (pos[v * 3 + 1] < NAT - 1e-9) farCut++;
  }
  check(far > 0 && farCut === far, `the same station cuts where nothing protects (${farCut} of ${far})`);
}

console.log('the four crossing kinds are four different answers:');
{
  const onRoad = (x, z) => Math.abs(z - 120) < 30 && x >= 90 && x <= 150;
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  const kinds = [null, 'causeway', 'bridge', 'culvert', 'ford'];
  const seen = {};
  for (const kind of kinds) {
    let asked = 0;
    const pos = mkPos(), n = pos.length / 3;
    const owned = new Uint8Array(n), target = new Float32Array(n);
    K.bankSolve(storeOf({ onRoad, crossingAt: () => { asked++; return kind; } }), TILE, pos, owned, target);
    K.bankApply(pos, target);
    let reached = 0, ownedN = 0, moved = 0;
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
      if (!onRoad(x, z)) continue;
      if (!K.bankTargetAtPacked(packed, x, z)) continue;
      reached++;
      if (owned[v]) ownedN++;
      if (pos[v * 3 + 1] < NAT - 1e-9) moved++;
    }
    seen[String(kind)] = { asked, reached, ownedN, moved };
  }
  const at = (k) => seen[String(k)];
  check(kinds.every((k) => at(k).asked > 0), `crossingAt was asked for every kind (${kinds.map((k) => at(k).asked).join('/')})`);
  check(kinds.every((k) => at(k).reached > 0), `and a station reached the carriageway in every run (${at(null).reached} vertices)`);
  check(kinds.every((k) => at(k).moved === 0), `the bank lowered no carriageway under any kind (${kinds.map((k) => at(k).moved).join('/')})`);
  check(at(null).ownedN === at(null).reached && at('causeway').ownedN === at('causeway').reached,
    `a road at grade and a causeway are OWNED, so neither rule touches them (${at(null).ownedN}, ${at('causeway').ownedN})`);
  check(at('bridge').ownedN === 0 && at('culvert').ownedN === 0 && at('ford').ownedN === 0,
    `a bridge, a culvert and a ford are left UNOWNED so the carve's crossing path runs (${at('bridge').ownedN}/${at('culvert').ownedN}/${at('ford').ownedN})`);
}

console.log('the refused station owns its land side and nothing else:');
{
  const pos = mkPos(), n = pos.length / 3;
  const owned = new Uint8Array(n), target = new Float32Array(n);
  K.bankSolve(storeOf(), TILE, pos, owned, target);
  K.bankApply(pos, target);
  const ox = TILE.xs + TILE.w / 2, oz = TILE.zs + TILE.h / 2;
  let owns = 0, moves = 0;
  for (let v = 0; v < n; v++) {
    const x = pos[v * 3] + ox, z = pos[v * 3 + 2] + oz;
    if (Math.abs(x - 60) > 6 || z < 40 || z > 49) continue;      // inside its protect box only
    if (owned[v]) owns++;
    if (pos[v * 3 + 1] < NAT - 1e-9) moves++;
  }
  check(owns > 0 && moves === 0, `owned ${owns} vertices beside the refusal and moved ${moves}`);
}

console.log('a shoreline across a tile edge, and either arrival order:');
{
  // TWO TILES SHARING AN EDGE, both handed the same packet — which is what a
  // gutter'd field gives them. The seam claim is about the kernel: a station
  // outside a tile's own box must still be inserted into its grid, or the row
  // just inside the border is shaped by one side and not the other, and the
  // border pins cannot reach it.
  const A = { tx: 0, ty: 0, xs: 0, zs: 0, w: 240, h: 240 };
  const B = { tx: 1, ty: 0, xs: 240, zs: 0, w: 240, h: 240 };
  // A river running NORTH-SOUTH along x = 240: the shared edge itself.
  const seam = pack(Array.from({ length: 60 }, (_, i) => i).flatMap((i) => [
    station({ x: 232, z: 4 + i * 4, nx: -1, nz: 0, wl: 18, bed: 16.5, inR: 8, outR: 16, alongM: 2, k: 0.25, chain: 0 }),
    station({ x: 248, z: 4 + i * 4, nx: 1, nz: 0, wl: 18, bed: 16.5, inR: 8, outR: 16, alongM: 2, k: 0.25, chain: 1 }),
  ]));
  const solve = (tile) => {
    const pos = mkPos(tile), n = pos.length / 3;
    const owned = new Uint8Array(n), target = new Float32Array(n);
    K.bankSolve(storeOf({ hydroBank: () => seam }), tile, pos, owned, target);
    K.bankApply(pos, target);
    const ox = tile.xs + tile.w / 2, oz = tile.zs + tile.h / 2;
    const out = new Map();
    for (let v = 0; v < n; v++) {
      out.set(`${(pos[v * 3] + ox).toFixed(3)}/${(pos[v * 3 + 2] + oz).toFixed(3)}`,
        { y: pos[v * 3 + 1], owned: owned[v] });
    }
    return out;
  };
  const a = solve(A), b = solve(B);
  let shared = 0, disagree = 0, worst = 0, cut = 0;
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;
    shared++;
    if (va.owned !== vb.owned) disagree++;
    const d = Math.abs(va.y - vb.y);
    if (d > 1e-9) { disagree++; worst = Math.max(worst, d); }
    if (va.y < NAT - 1e-9) cut++;
  }
  check(shared > 0 && cut > 0, `the two tiles share their border row and the bank cut it (${shared} shared, ${cut} cut)`);
  check(disagree === 0, `and both sides answer identically along it (worst ${worst.toExponential(1)} m)`);
  // ARRIVAL ORDER. The solve holds no state between calls, so B-then-A must be
  // byte-identical to A-then-B. This is the check that fails the day anyone
  // memoises a grid across tiles.
  const b2 = solve(B), a2 = solve(A);
  let drift = 0;
  for (const [k, v] of a) { const w = a2.get(k); if (!w || w.y !== v.y || w.owned !== v.owned) drift++; }
  for (const [k, v] of b) { const w = b2.get(k); if (!w || w.y !== v.y || w.owned !== v.owned) drift++; }
  check(drift === 0, `and building them in the other order changes nothing (${drift} vertices differ)`);
}

console.log('the creases follow the chain rather than an array stride:');
{
  const lines = K.bankBreakLines(storeOf(), TILE);
  check(lines.length > 0, `the packet produced creases (${lines.length})`);
  // Every crease lies on one of the two offsets, at ±14 m (join) or ∓8 m (toe)
  // from its own bank. Nothing may sit on the waterline, which hydroBreakLines
  // already splits along.
  let offBank = 0;
  for (const l of lines) {
    for (const [zz] of [[l.az], [l.bz]]) {
      const d = Math.min(
        Math.abs(zz - (112 - 14)), Math.abs(zz - (112 + 8)),
        Math.abs(zz - (128 + 14)), Math.abs(zz - (128 - 8)));
      if (d > 1e-3) offBank++;
    }
  }
  check(offBank === 0, `every crease endpoint is on a toe or a join (${offBank} astray)`);
  // AND THE RUN IS COVERED END TO END. The stations span x 12..228; the union
  // of the creases on each of the four offsets must too, with no gap wider
  // than one station interval.
  const byOffset = new Map();
  for (const l of lines) {
    const key = l.az.toFixed(2);
    const arr = byOffset.get(key) ?? [];
    arr.push([Math.min(l.ax, l.bx), Math.max(l.ax, l.bx)]);
    byOffset.set(key, arr);
  }
  let worstGap = 0, covered = 0;
  for (const arr of byOffset.values()) {
    arr.sort((p, q) => p[0] - q[0]);
    let end = arr[0][0];
    for (const [a, b] of arr) {
      if (a > end + 1e-6) worstGap = Math.max(worstGap, a - end);
      end = Math.max(end, b);
      covered += 1;
    }
  }
  // THREE, not four: the channel is 16 m wide and each face reaches 8 m in, so
  // the two toes meet on the centreline. That is a fact about the fixture and
  // is checked as one — a fourth offset here would mean a toe had landed
  // somewhere its own reach does not put it.
  check(byOffset.size === 3, `a join on each bank and the two toes meeting in the middle (${byOffset.size} offsets)`);
  check(worstGap < 1e-6, `and no gap anywhere along them (worst ${worstGap.toFixed(3)} m)`);
  // A STRAIGHT REACH COSTS TWO POINTS. The old stride emitted two segments a
  // station; the simplification must collapse a straight bank to one segment
  // an offset, which is what buys the budget back.
  check(lines.length <= 8, `a straight bank is a handful of segments, not two a station (${lines.length})`);
}

console.log('a refusal ends a run, and a ring closes:');
{
  // A chain of five stations with the middle one refused: the creases must be
  // two runs, not one chord across the refusal.
  const gapped = pack([0, 1, 2, 3, 4].map((i) => station({
    x: 60 + i * 8, z: 100, nx: 0, nz: 1, wl: 18, bed: 16.5, inR: 8, outR: 14,
    alongM: 4, k: 0.25, chain: 0, ...(i === 2 ? { protect: 9, flags: 1 } : {}),
  })));
  const lines = K.bankBreakLines(storeOf({ hydroBank: () => gapped }), TILE);
  const joins = lines.filter((l) => Math.abs(l.az - 114) < 1e-3);
  const spansRefusal = joins.some((l) => Math.min(l.ax, l.bx) < 76 - 1e-6 && Math.max(l.ax, l.bx) > 76 + 1e-6);
  check(joins.length === 2, `two runs of joins either side of the refusal (${joins.length})`);
  check(!spansRefusal, 'and none of them bridges it');

  // A RING. Eight stations round a circle, the last adjacent to the first: the
  // polyline must close, or exactly one cell of the ring is left uncreased.
  const R = 40, N = 16, h = (2 * Math.PI * R) / N;
  const ring = pack(Array.from({ length: N }, (_, i) => {
    const a = (i * 2 * Math.PI) / N;
    return station({
      x: 120 + Math.cos(a) * R, z: 120 + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a),
      wl: 18, bed: 16.5, inR: 6, outR: 10, alongM: h / 2, k: 0.25, chain: 0,
    });
  }));
  const rl = K.bankBreakLines(storeOf({ hydroBank: () => ring }), TILE);
  // Every endpoint must be shared by exactly two segments on its own offset,
  // which is what a closed polyline means and an open one cannot manage.
  const deg = new Map();
  for (const l of rl) {
    for (const p of [[l.ax, l.az], [l.bx, l.bz]]) {
      const k = `${p[0].toFixed(3)}/${p[1].toFixed(3)}`;
      deg.set(k, (deg.get(k) ?? 0) + 1);
    }
  }
  const ends = [...deg.values()].filter((d) => d === 1).length;
  check(rl.length > 4, `the ring produced creases (${rl.length})`);
  check(ends === 0, `and every endpoint is shared, so both rings are closed (${ends} loose ends)`);
}

let vChains = null;
console.log('a curved shore is ONE polyline, covered end to end and cheaply:');
{
  // Stations walked by ARC LENGTH along a gentle arc, which is how the
  // resolver places them: consecutive centres are one interval apart by
  // construction, so the adjacency test sees one run. A fixture that stepped
  // in x instead would put the centres further apart than their own intervals
  // and break the run at every step — which is a statement about the fixture,
  // not about the kernel.
  const N = 400, h = 0.5, R = 2000;
  let ang = 0, x = 6, z = 100;
  const rows = [];
  for (let i = 0; i < N; i++) {
    rows.push(station({
      x, z, nx: -Math.sin(ang), nz: Math.cos(ang),
      wl: 18, bed: 16.5, inR: 6, outR: 12, alongM: h / 2, k: 0.25, chain: 0,
    }));
    x += Math.cos(ang) * h; z += Math.sin(ang) * h; ang += h / R;
  }
  const lines = K.bankBreakLines(storeOf({ hydroBank: () => pack(rows) }), TILE);
  check(lines.length > 0, `the arc produced creases (${lines.length} for ${N} stations)`);
  check(lines.length < N / 4, `and a smooth curve costs a fraction of two-a-station (${lines.length} << ${N * 2})`);
  // Endpoint degrees: an open polyline has exactly two loose ends, so two
  // offsets have four between them. Anything more is a run that broke.
  const deg = new Map();
  for (const l of lines) for (const p of [[l.ax, l.az], [l.bx, l.bz]]) {
    const k = `${p[0].toFixed(3)}/${p[1].toFixed(3)}`;
    deg.set(k, (deg.get(k) ?? 0) + 1);
  }
  const ends = [...deg.values()].filter((d) => d === 1).length;
  check(ends === 4, `two unbroken polylines, a toe and a join (${ends} loose ends)`);
}

console.log('the budget raises the tolerance, it does not drop a stretch:');
{
  // THREE HUNDRED SHORT CHAINS, each a shallow V whose middle station stands
  // 0.4 m off its own chord. At the default 0.25 m that middle point is kept
  // and each chain costs two segments an offset; at 0.5 m it is redundant and
  // each costs one. So the cap BINDS, and what gives is the tolerance —
  // 300 x 2 x 2 = 1200 creases becoming 600, with every chain still creased.
  const C = 300;
  const rows = [];
  for (let c = 0; c < C; c++) {
    const x0 = 6 + (c % 30) * 7.5, z0 = 8 + Math.floor(c / 30) * 22;
    for (let i = 0; i < 3; i++) {
      rows.push(station({
        x: x0 + i * 2, z: z0 + (i === 1 ? 0.4 : 0), nx: 0, nz: 1,
        wl: 18, bed: 16.5, inR: 4, outR: 6, alongM: 1.1, k: 0.25, chain: c,
      }));
    }
  }
  vChains = pack(rows);
  const before = { ...K.refineCost };
  const lines = K.bankBreakLines(storeOf({ hydroBank: () => vChains }), TILE);
  const tol = K.refineCost.bankLineTolMax;
  const capped = K.refineCost.bankLineCapped - before.bankLineCapped;
  check(lines.length <= 1024, `inside the cap (${lines.length} creases for ${rows.length} stations in ${C} chains)`);
  check(tol > 0.25, `and it paid in tolerance rather than coverage (worst ${tol.toFixed(2)} m)`);
  check(capped === 0, `nothing was truncated (${capped} truncations)`);
  // COVERAGE IS THE CLAIM. Every chain must still carry a crease on BOTH
  // offsets — a stride would have served the first chains and left the rest
  // bare, which is the fault this replaced.
  const perChain = new Map();
  for (const l of lines) {
    // The fixture's own grid, read back: column from where the crease starts,
    // ROW from the offset measured against the row's origin — `az / 22` would
    // put a chain's toe and its join in different rows in the last row, which
    // is a bug in the key rather than in the creases.
    const col = Math.round((Math.min(l.ax, l.bx) - 6) / 7.5);
    const row = Math.round((l.az - 8) / 22);
    const key = `${col}/${row}`;
    const set = perChain.get(key) ?? new Set();
    set.add(l.az.toFixed(2));
    perChain.set(key, set);
  }
  const bare = [...perChain.values()].filter((v) => v.size < 2).length;
  check(perChain.size === C, `every chain still carries creases (${perChain.size} of ${C})`);
  check(bare === 0, `and each of them on both its offsets (${bare} with only one)`);
}

console.log('THE CONTROL — the simplification switched off:');
{
  const before = { ...KF.refineCost };
  const lines = KF.bankBreakLines(storeOf({ hydroBank: () => vChains }), TILE);
  const capped = KF.refineCost.bankLineCapped - before.bankLineCapped;
  const perChain = new Map();
  for (const l of lines) {
    const col = Math.round((Math.min(l.ax, l.bx) - 6) / 7.5);
    const row = Math.round((l.az - 8) / 22);
    const set = perChain.get(`${col}/${row}`) ?? new Set();
    set.add(l.az.toFixed(2));
    perChain.set(`${col}/${row}`, set);
  }
  const bare = 300 - [...perChain.values()].filter((v) => v.size >= 2).length;
  check(capped > 0, `with nothing to simplify the budget truncates instead (${capped} truncations)`);
  check(bare > 0, `and chains lose their creases outright (${bare} of 300 bare)`);
}

console.log('THE CONTROL — a station registered in one cell only:');
{
  const r = run(KN);
  check(r.wrong > 0, `the narrow index misses stations the query finds (wrong ${r.wrong}, worst ${r.worst.toFixed(2)} m)`);
  check(r.ownedWrong > 0, `and gets the owned flag wrong too (mismatched ${r.ownedWrong})`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
