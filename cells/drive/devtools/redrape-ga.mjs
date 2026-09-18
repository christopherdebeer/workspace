/**
 * ── IS A REDRAPE'S WALK `groundAt`? MEASURED BY CALLING IT TWICE ──
 *
 *   node cells/drive/devtools/redrape-ga.mjs
 *   FIX=at-campsbay LEGS=6 node .../redrape-ga.mjs
 *
 * The device put `terrainApply` at 68.6 ms a build with `redrape` 45.6 of the
 * 68 ms post and the normals recompute 0.8 of that — so the walk is the cost
 * and the question left is what IN the walk. The obvious answer is `groundAt`,
 * which per in-tile vertex builds a `${tx}/${ty}` string, tests a Set and
 * reads two Maps before it looks at a triangle; the indexing experiment
 * already established that the vertices a cell index removes are the cheap
 * ones, which points here. Pointing is not measuring.
 *
 * WHY NOT A TIMER. The call is a microsecond or two, `performance.now()` is
 * coarsened on iOS, and half a million reads would cost more than the thing
 * being read. So the measurement is a SUBSTITUTION: `__gaprobe(true)` makes
 * every vertex that reaches `groundAt` call it a SECOND time and throw the
 * answer away. Same vertices walked, same ones moved, same counters — so the
 * difference between the legs IS the cost of `ground` calls, and its share of
 * the normal walk is the answer.
 *
 * INTERLEAVED, because a leg is a set of rebuilds and rebuilds are not free of
 * each other: off, on, off, on. The two off legs are the floor — whatever they
 * differ by is what this instrument cannot resolve, and a delta inside it is
 * not a result. `__redirty()` dirties every built tile so a settled world runs
 * the post-steps again on demand; the counters are reset per leg by
 * `__gaprobe` itself.
 *
 * NODRAW, and safe for the same reason hydro-phases is: these are CPU
 * milliseconds inside a synchronous function. The software renderer changes
 * how OFTEN a build is asked for, not what one costs.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-paris-west';
const SPOT = process.env.SPOT ?? '';
const LEGS = Number(process.env.LEGS ?? 8);
// THE ROLLBACK, AS THE A/B. `drapefast=0` pays the tile lookup per vertex as
// it always did; the default binds it once a call. Two boots rather than one,
// which is sound here and only here: the counters (verts walked, groundAt
// calls) come out identical on every boot of a settled fixture, so the two
// runs are measuring the same work.
const FAST = process.env.FAST ?? '1';
const AUDIT = process.env.AUDIT ?? '1';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const where = SPOT ? SPOT : `fixture=${FIX}`;
const d = await openDrive({
  spot: `${where}&cam=chase&time=NOON&wx=clear&nodraw=1&drapefast=${FAST}`,
  tag: 'redrape-ga', settle: 0, bootTimeout: 420000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// The three-signal gate: a world still streaming is a world whose redrapes are
// still first builds over a growing drape set, and the leg would measure the
// streaming rather than the walk.
let quiet = 0, pb = -1, pw = -1, pr = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  const r = await q(() => window.__tstats().roadCells);
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && r === pr && t.builds > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; pr = r;
  if (quiet >= 3) break;
  if (i % 4 === 0) console.log(`[${el()}] dirty ${t.dirty} builds ${t.builds} ways ${t.seenWays} cells ${r}`);
}
const settled = quiet >= 3;
console.log(`[${el()}] ${settled ? 'SETTLED' : 'NOT SETTLED'} · builds ${pb} ways ${pw} cells ${pr}`);

/** One leg: set the probe (which resets the ledger), dirty everything, wait
 *  for the rebuilds to run out, read the ledger back. */
async function leg(mode) {
  await q((v) => window.__gaprobe(v), mode);
  const { dirtied } = await q(() => window.__redirty());
  let still = 0, pc = -1;
  for (let i = 0; i < 80; i++) {
    await d.page.waitForTimeout(2000);
    const t = await q(() => window.__tstats());
    const c = await q(() => window.__redrape().calls);
    still = (t.dirty === 0 && c === pc && c > 0) ? still + 1 : 0;
    pc = c;
    if (still >= 2) break;
  }
  const r = await q(() => window.__redrape());
  return { ...r, dirtied, done: still >= 2 };
}

// ── THE AUDIT FIRST, BECAUSE A FAST PATH THAT IS WRONG IS NOT FAST ──
//
// Every vertex answered by BOTH samplers, compared exactly. The standard is
// the drape index's: zero disagreements, or the cut does not ship. Run before
// the timing legs and disarmed after, since running both is the whole cost of
// the thing twice over.
if (AUDIT !== '0' && FAST !== '0') {
  await q(() => window.__drapeaudit(true));
  await q(() => window.__redirty());
  let s2 = 0, pc2 = -1;
  for (let i = 0; i < 80; i++) {
    await d.page.waitForTimeout(2000);
    const t = await q(() => window.__tstats());
    const c = await q(() => window.__redrape().calls);
    s2 = (t.dirty === 0 && c === pc2 && c > 0) ? s2 + 1 : 0; pc2 = c;
    if (s2 >= 2) break;
  }
  const A = await q(() => window.__drapeaudit(false));
  console.log(`[${el()}] AUDIT · bound ${A.bound}/${A.bound + A.fell} redrapes`
    + ` · checked ${A.checked} vertices · MISMATCH ${A.mismatch}`
    + ` · worst ${A.maxDelta.toExponential(2)} m`);
  if (A.checked === 0) console.log('  NOTHING WAS CHECKED — the audit proves nothing here');
  else if (A.mismatch > 0) console.log('  THE FAST PATH DISAGREES — do not ship it');
}

// off · whole · off · locate · off · whole … — the off legs interleave BOTH
// probe modes so neither is compared against a floor taken only beside the
// other, and the two halves are priced against the same baseline.
const MODES = [0, 1, 0, 2, 0, 1, 0, 2];
const out = [];
for (let i = 0; i < LEGS; i++) {
  const mode = MODES[i % MODES.length];
  const r = await leg(mode);
  out.push({ mode, ...r });
  const name = mode === 0 ? 'off   ' : mode === 1 ? 'WHOLE ' : 'LOCATE';
  console.log(`[${el()}] leg ${i + 1}/${LEGS} probe ${name}`
    + ` · ${r.calls} calls${r.done ? '' : ' (NOT DRAINED)'}`
    + ` · walk ${r.walkMs} normals ${r.normalsMs} ms/call`
    + ` · verts ${r.vertsPerCall} groundAt ${r.groundPerCall}`);
}
await q(() => window.__gaprobe(0));
const errs = d.errors.length;
await d.close();

const of = (m) => out.filter((r) => r.mode === m);
const mean = (a, k) => a.reduce((n, r) => n + r[k], 0) / Math.max(1, a.length);
const spread = (a, k) => a.length < 2 ? 0 : Math.max(...a.map((r) => r[k])) - Math.min(...a.map((r) => r[k]));

const offs = of(0), wholes = of(1), locates = of(2);
const walkOff = mean(offs, 'walkMs');
const floor = spread(offs, 'walkMs');
const dWhole = mean(wholes, 'walkMs') - walkOff;
const dLocate = locates.length ? mean(locates, 'walkMs') - walkOff : NaN;
const g = mean(offs, 'groundPerCall');
const ns = (ms) => (ms * 1e6 / Math.max(1, g)).toFixed(0);

console.log(`\n── ${where} · drapefast=${FAST} · ${settled ? 'settled' : 'NOT SETTLED'} · page errors ${errs}`);
console.log(`  walk ms/call   off ${walkOff.toFixed(2)}`
  + `   +whole groundAt ${(walkOff + dWhole).toFixed(2)}`
  + (locates.length ? `   +locate only ${(walkOff + dLocate).toFixed(2)}` : ''));
console.log(`  FLOOR (off against off) ${floor.toFixed(2)} ms — a delta inside this says nothing`);
console.log(`  groundAt ${Math.round(g)} calls a redrape · ${mean(offs, 'vertsPerCall').toFixed(0)} vertices walked`);
if (dWhole <= floor) {
  console.log(`  DELTA ${dWhole.toFixed(2)} ms is INSIDE the floor — this instrument cannot resolve it`);
} else {
  const share = 100 * dWhole / Math.max(0.001, walkOff);
  console.log(`  a whole groundAt: ${dWhole.toFixed(2)} ms — ${ns(dWhole)} ns a call, ${share.toFixed(0)}% of the walk`);
  // ── AND WHICH HALF OF IT ──
  //
  // `locate` is everything down to cellTrisOf: the tileAt arithmetic, the
  // `${tx}/${ty}` string, the dirty Set and the two Maps. `solve` is what is
  // left — the barycentric walk over the cell's triangles, nine or more
  // BufferAttribute reads apiece. The cut everyone reaches for first (redrape
  // already HOLDS the tile, so skip the lookup) can only ever collect the
  // first of those, so which is bigger decides whether that cut is worth
  // writing at all.
  if (locates.length) {
    if (dLocate <= floor) {
      console.log(`  of which LOCATE ${dLocate.toFixed(2)} ms — inside the floor: the lookup is NOT the cost`);
      console.log(`  so essentially all of it is the triangle solve, and a tile-aware`);
      console.log(`  groundAt — the obvious cut — would collect nothing.`);
    } else {
      const solve = dWhole - dLocate;
      console.log(`  of which LOCATE ${dLocate.toFixed(2)} ms (${ns(dLocate)} ns)`
        + ` · SOLVE ${solve.toFixed(2)} ms (${ns(solve)} ns)`);
      console.log(`  a tile-aware groundAt can collect the LOCATE half and no more:`
        + ` ${(100 * dLocate / Math.max(0.001, walkOff)).toFixed(0)}% of the walk.`);
    }
  }
  const rest = walkOff - dWhole;
  if (rest < floor) {
    console.log(`  the rest of the walk is ${rest.toFixed(2)} ms — UNDER THE FLOOR (${floor.toFixed(2)}).`);
    console.log(`  Read that as: groundAt is essentially the whole walk and this`);
    console.log(`  instrument cannot resolve what is left. A share over 100% also says`);
    console.log(`  the doubled leg's marginal call is DEARER than the average one —`);
    console.log(`  most plausibly the per-call string allocation and its collection.`);
  } else {
    console.log(`  and the rest of the walk is ${rest.toFixed(2)} ms`
      + ` — the seat test, two attribute reads, the box test and the write`);
  }
}
console.log(`  normals ${mean(offs, 'normalsMs').toFixed(2)} ms/call (the recompute, for scale)`);
