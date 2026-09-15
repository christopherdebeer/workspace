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
const LEGS = Number(process.env.LEGS ?? 4);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const where = SPOT ? SPOT : `fixture=${FIX}`;
const d = await openDrive({
  spot: `${where}&cam=chase&time=NOON&wx=clear&nodraw=1`,
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
async function leg(on) {
  await q((v) => window.__gaprobe(v), on);
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

const out = [];
for (let i = 0; i < LEGS; i++) {
  const on = i % 2 === 1;
  const r = await leg(on);
  out.push({ on, ...r });
  console.log(`[${el()}] leg ${i + 1}/${LEGS} probe ${on ? 'ON ' : 'off'}`
    + ` · ${r.calls} calls${r.done ? '' : ' (NOT DRAINED)'}`
    + ` · walk ${r.walkMs} normals ${r.normalsMs} ms/call`
    + ` · verts ${r.vertsPerCall} groundAt ${r.groundPerCall}`);
}
await q(() => window.__gaprobe(false));
const errs = d.errors.length;
await d.close();

const offs = out.filter((r) => !r.on), ons = out.filter((r) => r.on);
const mean = (a, k) => a.reduce((n, r) => n + r[k], 0) / Math.max(1, a.length);
const spread = (a, k) => a.length < 2 ? 0 : Math.max(...a.map((r) => r[k])) - Math.min(...a.map((r) => r[k]));

const walkOff = mean(offs, 'walkMs'), walkOn = mean(ons, 'walkMs');
const floor = spread(offs, 'walkMs');
const delta = walkOn - walkOff;
const g = mean(offs, 'groundPerCall');

console.log(`\n── ${where} · ${settled ? 'settled' : 'NOT SETTLED'} · page errors ${errs}`);
console.log(`  walk ms/call   off ${walkOff.toFixed(2)}   on ${walkOn.toFixed(2)}`);
console.log(`  FLOOR (off against off) ${floor.toFixed(2)} ms — a delta inside this says nothing`);
console.log(`  groundAt ${Math.round(g)} calls a redrape · ${mean(offs, 'vertsPerCall').toFixed(0)} vertices walked`);
if (delta <= floor) {
  console.log(`  DELTA ${delta.toFixed(2)} ms is INSIDE the floor — this instrument cannot resolve it`);
} else {
  const perCall = delta * 1e6 / Math.max(1, g);
  const share = 100 * delta / Math.max(0.001, walkOff);
  console.log(`  DELTA ${delta.toFixed(2)} ms — one extra groundAt on every counted vertex`);
  console.log(`  so groundAt is ${share.toFixed(0)}% of the walk, at ${perCall.toFixed(0)} ns a call`);
  const rest = walkOff - delta;
  // A SHARE OVER 100% IS NOT A RESULT, IT IS THE EDGE OF THE INSTRUMENT — and
  // printing it flat would be a number nobody can act on. Two things put it
  // there and they are not alike. The delta carries the floor's own noise, so
  // anything within a floor of 100% is "essentially all of it" and no more can
  // be said. And the substitution's MARGINAL call need not cost what the
  // average call costs: `meshSurfaceAt` builds a `${tx}/${ty}` string per call,
  // so doubling the calls doubles the allocation rate, and allocation is the
  // one cost that gets dearer per unit as you make more of it. That the
  // measurement lands over 100% is therefore evidence FOR the string being a
  // real part of the price, which is the first thing the cut should take.
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
