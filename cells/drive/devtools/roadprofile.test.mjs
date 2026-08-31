/**
 * THE BENCH DP — no browser, no renderer, no terrain service.
 *
 *   node cells/drive/devtools/roadprofile.test.mjs
 *
 * Two costs were missing from this DP, and each is tested the same way: run
 * the solve with the term OFF (which is exactly the shipped behaviour before
 * this change) and again with it ON, over the same synthetic ground, and
 * assert the fault appears in one and not the other. A weight is worth what
 * removing it costs; anything else is an assertion about a number I chose.
 *
 * LATERAL CONTINUITY. The transition cost read only the ELEVATIONS of the two
 * chosen candidates and never how far apart they sat across the road, so the
 * inferred bench could take the left shoulder at one station and the right at
 * the next — 90m sideways between stations 12m apart, for free.
 *
 * VERTICAL CURVATURE. The grade term charged only for EXCEEDING the class
 * limit, so every grade within it was free and a profile could alternate
 * between +gCap and -gCap on consecutive stations at no cost. That is the
 * rollercoaster: not illegal grades, but legal ones changing sign as fast as
 * the stations allow.
 *
 * The surfaces here are synthetic ON PURPOSE. A captured hillside cannot say
 * what the right answer was; a valley with a known flat shelf down one side
 * can.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'roadprofile-'));
const built = join(tmp, 'roadprofile.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/roadprofile.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const P = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const OFF = { ...P.WEIGHTS, lat: 0, curve: 0 };   // the shipped behaviour, before

/** A straight run of stations 12m apart along +x. */
const line = (n) => Array.from({ length: n }, (_, i) => [i * 12, 0]);
const cands = (dense, sample) => dense.map((_, i) => P.latCands(dense, i, sample));
/** Largest change of grade between consecutive spans — the rollercoaster metre. */
const worstKink = (dense, y) => {
  let w = 0;
  for (let i = 2; i < y.length; i++) {
    const d1 = Math.hypot(dense[i - 1][0] - dense[i - 2][0], dense[i - 1][1] - dense[i - 2][1]) || 1;
    const d2 = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]) || 1;
    w = Math.max(w, Math.abs((y[i] - y[i - 1]) / d2 - (y[i - 1] - y[i - 2]) / d1));
  }
  return +w.toFixed(4);
};
/** How often the chosen bench crosses the centreline. */
const flips = (offs) => {
  let f = 0;
  for (let i = 1; i < offs.length; i++) if (Math.sign(offs[i]) * Math.sign(offs[i - 1]) < 0) f++;
  return f;
};

// ── 1. THE ROLLERCOASTER ─────────────────────────────────────────
// Ground that is flat on average but noisy at exactly the wavelength the
// stations sample at: every candidate is a legal grade away from its
// neighbour, so nothing in the old cost had an opinion about which to take.
{
  const dense = line(60);
  // THE NOISE HAS TO VARY ACROSS THE ROAD TOO. A first cut made it a function
  // of x alone, so all seven lateral candidates at a station carried the SAME
  // bump — there was no smoother bench to choose and no cost term could have
  // found one. The question a hillside actually poses is "one of these seven
  // is quieter than the others"; a surface that does not pose it tests
  // nothing.
  const hash = (a, b) => {
    const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return h - Math.floor(h);
  };
  const sample = (x, z) => 100
    + (hash(Math.round(x / 12), Math.round(z / 15)) - 0.5) * 2.6   // per-candidate roughness
    + Math.abs(z) * 0.015;                                          // a gentle cross-slope
  const cand = cands(dense, sample);
  const before = P.solveChain(dense, cand, 0.12, null, null, undefined, OFF);
  const after = P.solveChain(dense, cand, 0.12, null, null, undefined, P.WEIGHTS);
  const kB = worstKink(dense, before), kA = worstKink(dense, after);
  check('the curvature term smooths the worst kink on noisy ground', kA < kB, { before: kB, after: kA });
  check('…and it is a real reduction, not a rounding one', kA < kB * 0.8, { before: kB, after: kA });
  // The other half of the trade, asserted here too so a future tune of `curve`
  // alone cannot pass by buying smoothness with sideways travel.
  const tvl = (y) => {
    const o = P.chosenOffsets(cand, y);
    let t = 0;
    for (let i = 1; i < o.length; i++) t += Math.abs(o[i] - o[i - 1]);
    return t;
  };
  check('…without paying for it in lateral wander', tvl(after) <= tvl(before),
    { beforeM: tvl(before), afterM: tvl(after) });
  console.log(`      worst grade change ${kB} -> ${kA}`);
}

// ── 2. THE BENCH THAT WANDERS ────────────────────────────────────
// On rough ground the old cost chases whichever lateral sample happens to be
// quietest at each station, because nothing charged for the sideways travel to
// reach it. The metric is TOTAL LATERAL TRAVEL, not sign changes: a bench that
// walks 45m out and back never crosses the centreline and is still wrong, and
// a first cut of this counted crossings and reported 0 before and 0 after on
// ground that was perfectly symmetric — measuring its own tie-break.
{
  const dense = line(60);
  const hash = (a, b) => {
    const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return h - Math.floor(h);
  };
  const sample = (x, z) => 100
    + (hash(Math.round(x / 12), Math.round(z / 15)) - 0.5) * 2.6
    + Math.abs(z) * 0.015;
  const cand = cands(dense, sample);
  const travel = (y) => {
    const o = P.chosenOffsets(cand, y);
    let t = 0;
    for (let i = 1; i < o.length; i++) t += Math.abs(o[i] - o[i - 1]);
    return t;
  };
  const tB = travel(P.solveChain(dense, cand, 0.12, null, null, undefined, OFF));
  const tA = travel(P.solveChain(dense, cand, 0.12, null, null, undefined, P.WEIGHTS));
  // BOTH METRICS, because they trade against each other and a weight chosen
  // by watching one of them regresses the other. See the table in
  // roadprofile.ts: 1.2/900 halved the kink and pushed lateral travel from 90m
  // to 525m, sampling the deck from 45m off the centreline, alternating.
  check('THE BENCH STOPS WANDERING ACROSS THE ROAD to chase noise', tA < tB * 0.6,
    { beforeM: tB, afterM: tA });
  console.log(`      lateral travel ${tB}m -> ${tA}m over ${dense.length} stations`);
}

// ── 3. WHAT MUST NOT CHANGE ──────────────────────────────────────
// A pin is another road's deck. If these terms can drag one, the junction
// welding this DP exists to do is broken.
{
  const dense = line(40);
  const sample = (x, z) => 100 + x * 0.03 + Math.abs(z) * 0.1;
  const cand = cands(dense, sample);
  const pins = dense.map((_, i) => (i === 20 ? 137.5 : null));
  const y = P.solveChain(dense, cand, 0.12, null, null, pins, P.WEIGHTS);
  check('a junction pin is held exactly', Math.abs(y[20] - 137.5) < 1e-9, y[20]);
  // AN ANCHOR BIASES, IT DOES NOT INVENT. The candidates are DEM samples, so
  // an anchor no sample comes near cannot be met — the snap is deliberately
  // limited to 4m, and beyond that the limiter ramps to it instead. A first
  // cut of this asked for 95 where the ground was 100 and called the correct
  // answer a failure.
  const near = cand[0][P.BENCH_C] - 2;
  const a = P.solveChain(dense, cand, 0.12, near, null, undefined, P.WEIGHTS);
  check('a chain anchor within reach is seated exactly',
    Math.abs(a[0] - near) < 1e-9, { got: a[0], want: near });
}

// ── 4. DRIVABILITY IS STILL A LAW ────────────────────────────────
// The ruling grade runs after the DP and is not negotiable. A cliff that no
// choice of bench can make legal must still come out drivable.
{
  const dense = line(50);
  const sample = (x) => 100 + (x > 240 ? (x - 240) * 0.9 : 0);
  const cand = cands(dense, sample);
  const y = P.solveChain(dense, cand, 0.10, null, null, undefined, P.WEIGHTS);
  let steepest = 0;
  for (let i = 1; i < y.length; i++) steepest = Math.max(steepest, Math.abs(y[i] - y[i - 1]) / 12);
  check('no span exceeds the ruling grade', steepest <= 0.10 * 1.2 + 1e-6, steepest);
  console.log(`      steepest span ${(steepest * 100).toFixed(1)}%`);
}

// ── 5. IT STILL FINDS THE SHELF ──────────────────────────────────
// The costs are additive, so a term that is too strong shows up as a road that
// stops following the ground at all. One-sided shelf, unambiguous answer.
{
  const dense = line(50);
  // THE SHELF MUST NOT BE THE LOWEST THING IN REACH. benchFlat excludes
  // anything within 8m of the section minimum, because on a coast road the
  // flattest candidate is the OCEAN and an unbanded search walked a road
  // seventy metres down into it. A synthetic shelf at the global minimum trips
  // that guard and tests the guard, not the solve.
  const sample = (x, z) => (z > 20 && z < 40 ? 100 : 100 - Math.abs(z - 30) * 0.6);
  const cand = cands(dense, sample);
  const y = P.solveChain(dense, cand, 0.12, null, null, undefined, P.WEIGHTS);
  const onShelf = y.filter((v) => Math.abs(v - 100) < 1.5).length;
  check('the solve still sits on an unambiguous shelf', onShelf > y.length * 0.8,
    { onShelf, of: y.length });
}

console.log(bad ? `\n${bad} FAILED` : '\nall good');
if (bad) process.exitCode = 1;
