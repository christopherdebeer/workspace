/**
 * THE SHORELINE IS COVERED, AND THE ANSWER DOES NOT DEPEND ON INPUT ORDER.
 *
 *   node cells/drive/devtools/bank-coverage.test.mjs
 *
 * Two claims the first cut of the resolver made in its own comments and did
 * not keep. Both were found by review, both reproduce here, and both are
 * about the same mistake: a greedy rejection at a MINIMUM separation does not
 * place stations AT that separation, and a hash that makes the proximity
 * question order-free does not make the SELECTION order-free.
 *
 *   - COVERAGE. Survivors were given an influence of half the minimum spacing
 *     either side. Greedy rejection leaves neighbours anywhere from the
 *     spacing to twice it apart, so their influences need not meet: measured
 *     on a straight shore of 6 m segments at 10 m spacing, retained stations
 *     12 m apart carrying 11 m of influence — a one-metre hole, with
 *     `dropped: 0` reporting a clean run.
 *   - ORDER. Reversing the segment array changed which stations survived and
 *     moved the holes. A tile's contour segments arrive in whatever order
 *     marching squares emitted them, so that is not a hypothetical.
 *
 * The fix is contour CHAINS: join the segments into polylines, sample each by
 * arc length, and give each station the interval to its actual neighbours. The
 * test asserts the property (no uncovered shore, same answer reversed), never
 * the mechanism, so it holds whatever the sampling becomes.
 */
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OUT = 'node_modules/.cache/bank-coverage';
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: ['cells/drive/client/hydro/bank-profile.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: `${OUT}/bank.mjs`, logLevel: 'error',
});
const M = await import(pathToFileURL(`${process.cwd()}/${OUT}/bank.mjs`).href);
const { resolveHydroBankStations, packBankStations, BANK_STRIDE } = M;

let fails = 0;
const ok = (n, e) => console.log(`  ok   ${n}${e ? `  ${e}` : ''}`);
const bad = (n, e) => { fails++; console.log(`  FAIL ${n}${e ? `  ${e}` : ''}`); };
const check = (c, n, e) => (c ? ok : bad)(n, e);

// The field builder is the resolver test's, because a hand-rolled one that
// omits a channel produces zero stations and a test of nothing — which is what
// the first cut of this file did: `stations 0` with every claim "passing".
const BANK_ID = { soil: 0, mud: 1, gravel: 2, rock: 3 };
const KIND_ID = { river: 7, stream: 8, lake: 3 };
function makeField({
  span = 400, res = 200, gutter = 2, base = 1000,
  groundAt, wetAt, levelM, depthM = 1, bank = 'soil', kind = 'river',
}) {
  const width = res + gutter * 2, height = width;
  const n = width * height;
  const ground = new Float32Array(n);
  const geometry = new Float32Array(n * 4);
  const dynamics = new Float32Array(n * 4);
  const material = new Uint8Array(n * 4);
  const px = span / res;
  for (let iz = 0; iz < height; iz++) for (let ix = 0; ix < width; ix++) {
    const i = iz * width + ix;
    const x = ((ix - gutter) + 0.5) * px, z = ((iz - gutter) + 0.5) * px;
    ground[i] = groundAt(x, z) - base;
    const cov = wetAt(x, z);
    geometry[i * 4] = cov;
    geometry[i * 4 + 1] = cov >= 0.5 ? 20 : -20;
    geometry[i * 4 + 2] = levelM - base;
    geometry[i * 4 + 3] = depthM;
    material[i * 4] = KIND_ID[kind];
    material[i * 4 + 3] = (BANK_ID[bank] << 6) | (3 << 3);
  }
  return {
    key: '0/0', revision: 1, bounds: { minX: 0, minZ: 0, maxX: span, maxZ: span },
    resolution: res, gutter, width, height, elevationBaseM: base,
    ground, geometry, dynamics, material, hasWater: true, bodyIds: ['b'],
  };
}

/** A straight shoreline at x = 200 running in z, cut into `seg`-metre pieces —
 *  the shape the contour extractor emits, at the size it emits them. */
const shoreSegments = (z0 = 40, z1 = 340, seg = 6) => {
  const out = [];
  for (let z = z0; z + seg <= z1 + 1e-9; z += seg) {
    out.push({ a: { x: 200, z, groundM: 0 }, b: { x: 200, z: z + seg, groundM: 0 } });
  }
  return out;
};

const field = makeField({
  levelM: 1000, depthM: 0.8, bank: 'soil',
  groundAt: (x) => x < 200 ? 999 : 999 + (x - 200) * 0.5,
  wetAt: (x) => x < 200 ? 1 : 0,
});
const SEGS = shoreSegments();
const SPACING = 10;
const solve = (segs) => resolveHydroBankStations(field, segs, {
  coverageCut: 0.5, minSpacingM: SPACING, maxStations: 512,
});

console.log('the stations cover the shore they were cut from:');
{
  const r = solve(SEGS);
  const st = r.stations.filter((s) => s.unresolved === null)
    .sort((a, b) => a.z - b.z);
  // Walk the shoreline and ask whether ANY station speaks for each point. The
  // along test is the one the packet carries: |offset along the tangent| must
  // fall inside the station's own interval. The shoreline here runs +x, so the
  // tangent is +x and the along offset is simply the difference in x.
  let uncovered = 0, worstGap = 0, tested = 0;
  for (let z = 44; z <= 336; z += 0.25) {
    tested++;
    let covered = false;
    for (const s of st) {
      const back = s.alongBackM ?? s.alongM, fwd = s.alongFwdM ?? s.alongM;
      // The shore runs +z here, so the along offset is the difference in z —
      // signed, because an interval to actual neighbours is not symmetric.
      const along = z - s.z;
      if (along >= -back - 1e-9 && along <= fwd + 1e-9) { covered = true; break; }
    }
    if (!covered) uncovered++;
  }
  for (let i = 1; i < st.length; i++) {
    const prev = st[i - 1], cur = st[i];
    const reach = (prev.alongFwdM ?? prev.alongM) + (cur.alongBackM ?? cur.alongM);
    worstGap = Math.max(worstGap, (cur.z - prev.z) - reach);
  }
  const spacings = st.slice(1).map((s, i) => s.z - st[i].z);
  const maxSpacing = spacings.length ? Math.max(...spacings) : 0;
  check(uncovered === 0, 'every point of the shoreline is inside some station\'s interval',
    `uncovered ${uncovered} of ${tested} · worst gap ${worstGap.toFixed(2)} m · widest station spacing ${maxSpacing.toFixed(1)} m`);
  check(r.stats.dropped === 0, 'and nothing was dropped', `dropped ${r.stats.dropped}, stations ${st.length}`);
}

console.log('the answer does not depend on the order the segments arrive in:');
{
  const a = solve(SEGS).stations.filter((s) => s.unresolved === null);
  const b = solve([...SEGS].reverse()).stations.filter((s) => s.unresolved === null);
  const key = (s) => `${s.x.toFixed(3)},${s.z.toFixed(3)}`;
  const sa = a.map(key).sort().join('|'), sb = b.map(key).sort().join('|');
  check(a.length === b.length && sa === sb,
    'reversing the segment array gives the same stations',
    `${a.length} vs ${b.length}${sa === sb ? '' : ' — different positions'}`);
  // A shuffle is the stronger form: a chain assembly that only survives a
  // reversal could still be walking the array.
  const rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const shuffled = [...SEGS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const c = solve(shuffled).stations.filter((s) => s.unresolved === null);
  const sc = c.map(key).sort().join('|');
  check(sa === sc, 'and so does shuffling it', `${a.length} vs ${c.length}`);
}

console.log('the budget is spent ACROSS the chains, not down the list:');
{
  // FIFTEEN CHAINS OF TWENTY METRES under a budget of forty. The rule this
  // replaces solved one spacing from the shoreline's own length (300/40 =
  // 7.5 m) and had each chain round `20 / 7.5` INDEPENDENTLY to three — 45
  // stations asked for against a ceiling of 40, so the last chains were cut
  // off part way down the list and the shore they stand on was left to the
  // carve. The census read that as exactly 512 at four unrelated fixtures,
  // and a unit test of ONE chain under the cap can never see it.
  const many = [];
  for (let c = 0; c < 15; c++) {
    const z0 = 20 + c * 24;
    for (let z = z0; z < z0 + 20 - 1e-9; z += 4) {
      many.push({ a: { x: 200, z, groundM: 0 }, b: { x: 200, z: z + 4, groundM: 0 } });
    }
  }
  const BUDGET = 40;
  const r = resolveHydroBankStations(field, many, {
    coverageCut: 0.5, minSpacingM: 0.5, maxStations: BUDGET,
  });
  const byChain = new Map();
  for (const st of r.stations) byChain.set(st.chainId, (byChain.get(st.chainId) ?? 0) + 1);
  check(r.stations.length === BUDGET, 'the total IS the budget, by construction',
    `${r.stations.length} of ${BUDGET} · ${r.stats.chains} chains · dropped ${r.stats.dropped}`);
  check(r.stats.dropped === 0, 'so the ceiling never fires', `dropped ${r.stats.dropped}`);
  check(byChain.size === r.stats.chains && [...byChain.values()].every((n) => n >= 1),
    'and every chain is served — none is cut off part way down the list',
    `${byChain.size} of ${r.stats.chains} chains, counts ${[...byChain.values()].join(',')}`);
  // THE COARSEST CHAIN'S SPACING, against the bound the allocation's own shape
  // gives it: a chain takes at least `floor(R·L/total)` past its free station,
  // where R is what is left after one each, so no chain can be described
  // coarser than the budget's mean spacing times budget/R. Derived from the
  // fixture rather than typed, or it is a bar moved to pass.
  const spacings = [];
  for (const [id, n] of byChain) {
    const sts = r.stations.filter((s) => s.chainId === id).sort((a, b) => a.z - b.z);
    const span = (sts[0].alongBackM ?? 0) + (sts[sts.length - 1].alongFwdM ?? 0)
      + (sts.length > 1 ? sts[sts.length - 1].z - sts[0].z : 0);
    spacings.push(span / n);
  }
  const coarsest = Math.max(...spacings);
  const bound = r.stats.shoreM / (BUDGET - r.stats.chains);
  check(coarsest <= bound + 1e-6, "no chain is described coarser than the allocation's own bound",
    `coarsest ${coarsest.toFixed(2)} m · bound ${bound.toFixed(2)} m · reported ${r.stats.spacingM}`);
  check(Math.abs(r.stats.spacingM - coarsest) < 0.02,
    'and the reported spacing is that coarsest chain, not an average over the total',
    `${r.stats.spacingM} vs ${coarsest.toFixed(2)}`);

  // THE CONTROL: the rule it replaces, on this fixture, run here rather than
  // asserted about. A check that has not been shown to fail on the fault it
  // names is decoration.
  const spacing = Math.max(0.5, Math.max(0.5, r.stats.shoreM / BUDGET));
  let asked = 0, served = 0, budgetLeft = BUDGET;
  for (let c = 0; c < r.stats.chains; c++) {
    const n = Math.max(1, Math.round(20 / spacing));
    asked += n;
    const got = Math.max(0, Math.min(n, budgetLeft));
    budgetLeft -= got;
    if (got >= n) served++;
  }
  check(asked !== BUDGET && served < r.stats.chains,
    'CONTROL: the per-chain rounding asks past the budget and truncates the tail',
    `asked ${asked} for ${BUDGET} · ${served} of ${r.stats.chains} chains served whole`);

  // AND `minSpacing` CAPS A CHAIN'S COUNT, NOT ITS SPACING. Marching squares
  // emits a segment per texel edge; a bank does not vary faster than the field
  // can see, so a chain that cannot spend its share hands it back rather than
  // being sampled finer than the evidence.
  const fine = resolveHydroBankStations(field, many, {
    coverageCut: 0.5, minSpacingM: 8, maxStations: BUDGET,
  });
  const perChain = new Map();
  for (const st of fine.stations) perChain.set(st.chainId, (perChain.get(st.chainId) ?? 0) + 1);
  const overFine = [...perChain.values()].filter((n) => n > 1 && 20 / n < 8 - 1e-9).length;
  check(overFine === 0 && fine.stations.length < BUDGET,
    'a chain capped by minSpacing hands its share back rather than oversampling',
    `${fine.stations.length} of ${BUDGET} spent · ${overFine} chains finer than 8 m`);
}

console.log('the coverage is reported, not assumed:');
{
  const r = solve(SEGS);
  check(typeof r.stats.coveredM === 'number' && typeof r.stats.uncoveredM === 'number',
    'the stats carry covered and uncovered shoreline length',
    `covered ${r.stats.coveredM} uncovered ${r.stats.uncoveredM} of ${r.stats.shoreM}`);
  check(r.stats.uncoveredM !== undefined && r.stats.uncoveredM < 1e-6,
    'and none of this shoreline is uncovered', `${r.stats.uncoveredM}`);
}

console.log('the wire form carries the chain order the creases read:');
{
  // THE KERNEL'S CREASE BUILDER GROUPS BY chainId AND THEN WALKS THE PACKET'S
  // OWN ORDER, so two entries next to each other in one chain must be next to
  // each other on the contour. An INDEX along the chain used to be carried for
  // this and was read by nothing; the contract is stated and checked instead.
  const packed = packBankStations(solve(SEGS).stations);
  const n = (packed.length / BANK_STRIDE) | 0;
  let out = 0, far = 0, worst = 0, pairs = 0;
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const o = i * BANK_STRIDE, id = packed[o + 13];
    if (i > 0 && packed[o - BANK_STRIDE + 13] !== id) {
      // A chain has ended. It may not start again: chain-major means each
      // chain's entries are contiguous.
      if (seen.has(id)) out++;
      seen.add(id);
      continue;
    }
    if (i === 0) { seen.add(id); continue; }
    pairs++;
    // …and consecutive entries of one chain are ONE INTERVAL apart, which is
    // exactly the forward reach of the first plus the backward reach of the
    // second. That is the adjacency the crease builder tests.
    const p = o - BANK_STRIDE;
    const d = Math.hypot(packed[o] - packed[p], packed[o + 1] - packed[p + 1]);
    const span = packed[p + 8] + packed[o + 12];
    worst = Math.max(worst, d / (span || 1));
    if (d > span * 1.6) far++;
  }
  check(n > 0 && pairs > 0, 'the packet has consecutive stations to check', `${n} stations, ${pairs} pairs`);
  check(out === 0, "and it is chain-major: a chain's entries are contiguous", `${out} chains restarted`);
  check(far === 0, 'consecutive entries of one chain are one interval apart',
    `${far} beyond 1.6 intervals · worst ${worst.toFixed(2)}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nbank-coverage: all ok');
process.exit(fails ? 1 : 0);
