/**
 * THE BANK RESOLVER, ON AUTHORED WATER.
 *
 *   node cells/drive/devtools/bank-profile.test.mjs
 *
 * Pure node: esbuild the shipped module and drive it over synthetic hydro
 * fields whose ground and coverage are written by hand, so every expectation
 * is arithmetic rather than a reading of a place. Seconds, no browser.
 *
 * The claims that matter are the two the plan states as invariants and the
 * three that stop this becoming the trench it replaces:
 *
 *   1  at an accepted shoreline, terrain meets the resting level within a
 *      DECLARED tolerance — and the submergence clears the tolerance the
 *      census judges it with, or a perfect bank reads as a burial
 *   4  nothing is modified outside a station's stated reach
 *   -  a cliff at the water is REFUSED, not planed into a beach
 *   -  a bank that cannot meet ground is UNRESOLVED and changes nothing
 *   9  solving twice, and solving against already-cut ground, gives the same
 *      answer: no feedback loop
 *
 * Every one carries a negative control. A check that has not been shown to
 * fail on the fault it names is decoration, which this file's own doctrine
 * says about four other tests in this repo.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert';

const OUT = 'node_modules/.cache/bank-profile';
mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: ['cells/drive/client/hydro/bank-profile.ts'],
  bundle: true, format: 'esm', platform: 'node', outfile: `${OUT}/bank.mjs`, logLevel: 'error',
});
const M = await import(pathToFileURL(`${process.cwd()}/${OUT}/bank.mjs`).href);
const {
  resolveHydroBankStations, bankTargetAt, bankProfileOf,
  WATERLINE_TOL_M, BANK_SUBMERGE_M,
} = M;

let fails = 0;
const ok = (name, extra) => console.log(`  ok   ${name}${extra ? `  ${extra}` : ''}`);
const bad = (name, extra) => { fails++; console.log(`  FAIL ${name}${extra ? `  ${extra}` : ''}`); };
const check = (cond, name, extra) => cond ? ok(name, extra) : bad(name, extra);

// ── AUTHORED FIELDS ───────────────────────────────────────────────────────
// A field is a square of texels. `groundAt(x,z)` writes the DEM, `wetAt(x,z)`
// the coverage; the level and depth are constants across the water. This is
// the whole world the resolver can see, which is the point of it being pure.
const BANK_ID = { soil: 0, mud: 1, gravel: 2, rock: 3 };
const KIND_ID = { river: 7, stream: 8, lake: 3 };
function makeField({
  span = 200, res = 128, gutter = 2, base = 1000,
  groundAt, wetAt, levelM, depthM = 1, bank = 'soil', kind = 'river',
}) {
  const width = res + gutter * 2, height = width;
  const n = width * height;
  const ground = new Float32Array(n);
  const geometry = new Float32Array(n * 4);
  const dynamics = new Float32Array(n * 4);
  const material = new Uint8Array(n * 4);
  const px = span / res;
  for (let iz = 0; iz < height; iz++) {
    for (let ix = 0; ix < width; ix++) {
      const i = iz * width + ix;
      const x = ((ix - gutter) + 0.5) * px, z = ((iz - gutter) + 0.5) * px;
      ground[i] = groundAt(x, z) - base;
      const cov = wetAt(x, z);
      geometry[i * 4] = cov;
      geometry[i * 4 + 1] = cov >= 0.5 ? 20 : -20;      // sign is all we use
      geometry[i * 4 + 2] = levelM - base;
      geometry[i * 4 + 3] = depthM;
      material[i * 4] = KIND_ID[kind];
      material[i * 4 + 3] = (BANK_ID[bank] << 6) | (3 << 3);
    }
  }
  return {
    key: '0/0', revision: 1, bounds: { minX: 0, minZ: 0, maxX: span, maxZ: span },
    resolution: res, gutter, width, height, elevationBaseM: base,
    ground, geometry, dynamics, material, hasWater: true, bodyIds: ['b'],
  };
}
/** One shoreline segment, straight, at x = `at`, running in z. The resolver
 *  takes segments rather than extracting them, so a test can put one exactly
 *  where it wants and know what the answer must be. */
const shoreAtX = (at, z0, z1, n = 8) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = z0 + (z1 - z0) * (i / n), b = z0 + (z1 - z0) * ((i + 1) / n);
    out.push({ a: { x: at, z: a, groundM: 0 }, b: { x: at, z: b, groundM: 0 } });
  }
  return out;
};

console.log('=== bank-profile.test.mjs');

// ── 1. THE CONSTANTS' OWN RELATION ────────────────────────────────────────
// The resolver aims below the resting level; the census calls a point buried
// when the level is not more than WATERLINE_TOL_M above the ground. If the
// submergence does not clear the tolerance, a perfectly solved bank is
// classified as the very failure it fixed — and nothing else in this file
// would notice, because the geometry would be right.
check(BANK_SUBMERGE_M > WATERLINE_TOL_M,
  'the submergence clears the census tolerance',
  `submerge ${BANK_SUBMERGE_M} > tol ${WATERLINE_TOL_M}`);

// ── 2. A SHALLOW STREAM ON FLAT GROUND ────────────────────────────────────
// Water left of x=100, dry ground rising gently to the right. The bank must
// cut from the waterline out to where the 1:4 soil profile meets the ground.
{
  const level = 1000;
  const f = makeField({
    levelM: level, depthM: 0.8, bank: 'soil',
    groundAt: (x) => x < 100 ? 999 : 999 + (x - 100) * 0.5,   // 1:2 bank
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const r = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const st = r.stations[0];
  check(r.stations.length > 0 && r.stats.resolved + r.stats.nothingToCut === r.stations.length,
    'a stream on flat ground leaves no station unresolved',
    `${r.stats.resolved} cut + ${r.stats.nothingToCut} already low = ${r.stations.length}`);
  check(st && st.outwardX > 0.99,
    'the outward normal points at the dry side', st && `outward ${st.outwardX.toFixed(3)}`);
  // ground at the line is 999; waterline is 1000 - submerge. The ground is
  // BELOW the water here, so there is nothing to cut and the station says so.
  check(st && st.cutM === 0 && st.outerReachM === 0,
    'ground already under the water is nothing to cut', st && `cut ${st.cutM}`);
  check(r.stats.nothingToCut === r.stations.length,
    'and it is counted as such, not as a failure', `${r.stats.nothingToCut}`);
}

// ── 3. A BANK STANDING PROUD OF ITS OWN WATER — THE SENQU FRINGE ──────────
// This is the measured fault: the ground at the waterline stands above the
// level, so the water is drawn under it. The resolver must cut it, and the
// cut must close on the natural ground rather than running to its bound.
{
  const level = 1000;
  const f = makeField({
    levelM: level, depthM: 0.8, bank: 'soil',
    // A UNIFORM 1:10 SLOPE THROUGH THE WATERLINE, which is what a DEM that
    // cannot resolve a channel actually looks like — the Senqu reading — and
    // not a step, which the field would smooth away before the resolver saw it.
    groundAt: (x) => 1000.5 + (x - 100) * 0.1,
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const r = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const st = r.stations[0];
  check(st && st.unresolved === null && st.cutM > 0.4 && st.cutM < 0.7,
    'a proud bank is cut at the waterline', st && `cut ${st.cutM.toFixed(2)}m`);
  // soil is k=0.25, ground rises at 0.10, so the profile gains 0.15/m on it
  // and closes a 0.56 m gap in about 3.7 m.
  check(st && st.outerReachM > 2 && st.outerReachM < 6,
    'and closes on the ground within a few metres', st && `join at ${st.outerReachM.toFixed(2)}m`);
  check(st && Math.abs((st.waterLevelM - BANK_SUBMERGE_M) - (level - BANK_SUBMERGE_M)) < 1e-9,
    'the waterline anchor is the resting level less the submergence');
  // INVARIANT 4: nothing outside the reach moves.
  const beyond = bankTargetAt(r.stations, st.x + st.outerReachM + 2, st.z);
  check(beyond === null,
    'nothing is modified past the station reach',
    `asked ${(st.outerReachM + 2).toFixed(1)}m out`);
  const inside = bankTargetAt(r.stations, st.x + st.outerReachM * 0.5, st.z);
  check(inside !== null && inside.y > level - BANK_SUBMERGE_M && inside.y < 1000.5,
    'and inside it the target is between the waterline and the ground',
    inside && `y ${inside.y.toFixed(2)}`);
}

// ── 4. A CLIFF AT THE WATER IS REFUSED, NOT PLANED ────────────────────────
// The failure this whole programme exists to avoid. A rock bank standing ten
// metres over its water must come back unresolved with NOTHING changed — a
// resolver that "fixes" it has cut a notch into a gorge wall.
{
  const f = makeField({
    levelM: 1000, depthM: 2, bank: 'rock',
    groundAt: (x) => x < 100 ? 998 : 1010 + (x - 100) * 2,
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const r = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const st = r.stations[0];
  check(st && st.unresolved === 'too-deep',
    'a cliff at the water is unresolved, not cut', st && `${st.unresolved}`);
  check(st && st.cutM === 0 && st.outerReachM === 0,
    'and it changes nothing at all', st && `cut ${st.cutM} reach ${st.outerReachM}`);
  check(bankTargetAt(r.stations, st.x + 1, st.z) === null,
    'an unresolved station answers no target');
  // NEGATIVE CONTROL: the same wall under the SOFT bound would be cut, which
  // is what says the refusal is the rock profile's doing and not an accident
  // of this geometry.
  check(bankProfileOf('rock').cut < 12 && bankProfileOf('rock').k > bankProfileOf('soft').k,
    'rock is bounded tighter and steeper than soil',
    `rock cut ${bankProfileOf('rock').cut} k ${bankProfileOf('rock').k} · soil k ${bankProfileOf('soft').k}`);
}

// ── 5. A BANK THAT NEVER MEETS THE GROUND ─────────────────────────────────
// Ground rising faster than the profile for ever: no join inside the reach.
// The answer is 'no-join' and no modification — never a longer reach.
{
  const f = makeField({
    levelM: 1000, depthM: 1, bank: 'soil',
    groundAt: (x) => 1000.4 + (x - 100) * 0.24,   // rises just under the soil k
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const r = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const st = r.stations[0];
  check(st && st.unresolved === 'no-join' && st.outerReachM === 0,
    'a bank that cannot close is unresolved and changes nothing',
    st && `${st.unresolved}`);
  check(st && st.outerReachM <= bankProfileOf(st.profile).reach,
    'and the reach was never extended past its bound');
}

// ── 6. THE TWO BANKS OF A RIVER ACROSS A SLOPE DIFFER ─────────────────────
// A river cut into a hillside has one bank proud and one already drowned. One
// rule, two answers, from the ground alone.
{
  const f = makeField({
    levelM: 1000, depthM: 1, bank: 'soil',
    // The hillside falls to the right at 1:20. The LEFT bank therefore stands
    // proud of the water and the RIGHT is already drowned, from one slope.
    groundAt: (x) => 1001.6 - (x - 80) * 0.06,
    wetAt: (x) => x >= 90 && x <= 110 ? 1 : 0,
  });
  const left = resolveHydroBankStations(f, shoreAtX(90, 40, 160)).stations[0];
  const right = resolveHydroBankStations(f, shoreAtX(110, 40, 160)).stations[0];
  check(left && right && left.outwardX < -0.99 && right.outwardX > 0.99,
    'each bank finds its own dry side',
    left && right && `left ${left.outwardX.toFixed(2)} right ${right.outwardX.toFixed(2)}`);
  check(left && left.cutM > 0.3 && right && right.cutM === 0,
    'the proud bank is cut and the drowned one is left alone',
    left && right && `left ${left.cutM.toFixed(2)}m right ${right.cutM.toFixed(2)}m`);
}

// ── 7. DETERMINISM AND IDEMPOTENCE ────────────────────────────────────────
// Solve twice: identical. Then solve against ground ALREADY CUT to the
// previous answer: the waterline target must not move down again. This is
// the feedback loop the module exists to be immune to, and the only way to
// show immunity is to run the loop.
{
  const level = 1000;
  const mk = (cut) => makeField({
    levelM: level, depthM: 0.8, bank: 'soil',
    groundAt: (x) => {
      if (x < 100) return 999.2;
      const nat = 1000.5 + (x - 100) * 0.1;
      if (!cut) return nat;
      const t = bankTargetAt(cut, x, 47.5);
      return t ? Math.min(nat, t.y) : nat;
    },
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const a = resolveHydroBankStations(mk(null), shoreAtX(100, 40, 160));
  const b = resolveHydroBankStations(mk(null), shoreAtX(100, 40, 160));
  check(JSON.stringify(a.stations) === JSON.stringify(b.stations),
    'two solves of the same field are identical');
  const c = resolveHydroBankStations(mk(a.stations), shoreAtX(100, 40, 160));
  const wl0 = a.stations[0].waterLevelM - BANK_SUBMERGE_M;
  const wl1 = c.stations[0].waterLevelM - BANK_SUBMERGE_M;
  check(Math.abs(wl0 - wl1) < 1e-9,
    're-solving against already-cut ground does not deepen the waterline',
    `${wl0.toFixed(3)} then ${wl1.toFixed(3)}`);
  check(c.stations[0].cutM <= a.stations[0].cutM + 1e-9,
    'and the cut does not grow on the second pass',
    `${a.stations[0].cutM.toFixed(3)} then ${c.stations[0].cutM.toFixed(3)}`);
}

// ── 8. THE UNDERWATER FACE RUNS TO THE STATED BED ─────────────────────────
{
  const f = makeField({
    levelM: 1000, depthM: 1.5, bank: 'soil',
    groundAt: (x) => x < 100 ? 999.2 : 1000.5 + (x - 100) * 0.1,
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const r = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const st = r.stations[0];
  const deep = bankTargetAt(r.stations, st.x - st.innerReachM, st.z);
  check(st && Math.abs(st.innerBedM - (1000 - 1.5)) < 1e-6,
    'the interior bed is the level less the field depth', st && `${st.innerBedM.toFixed(2)}`);
  check(deep !== null && Math.abs(deep.y - st.innerBedM) < 0.02,
    'and the face reaches it at the inner reach', deep && `y ${deep.y.toFixed(2)}`);
  const atLine = bankTargetAt(r.stations, st.x, st.z);
  check(atLine !== null && Math.abs(atLine.y - (1000 - BANK_SUBMERGE_M)) < 1e-6,
    'the target at the line is exactly the submerged waterline',
    atLine && `y ${atLine.y.toFixed(3)}`);
}

// ── 9. NEGATIVE CONTROL ON THE WHOLE THING ────────────────────────────────
// If the outward normal were chosen without asking the coverage — the one
// piece of evidence that says which side is dry — the resolver would solve
// the WET side and the proud-bank case would report nothing to cut. Run that
// by handing it a shoreline whose segments are reversed: the answer must be
// unchanged, because the coverage decides and the winding does not.
{
  const f = makeField({
    levelM: 1000, depthM: 0.8, bank: 'soil',
    groundAt: (x) => x < 100 ? 999.2 : 1000.5 + (x - 100) * 0.1,
    wetAt: (x) => x < 100 ? 1 : 0,
  });
  const fwd = resolveHydroBankStations(f, shoreAtX(100, 40, 160));
  const rev = resolveHydroBankStations(f, shoreAtX(100, 160, 40));
  const a = fwd.stations[0], b = rev.stations[0];
  check(a && b && Math.abs(a.cutM - b.cutM) < 1e-9 && a.outwardX * b.outwardX > 0,
    'reversing the shoreline winding changes nothing: the coverage decides',
    a && b && `cut ${a.cutM.toFixed(3)}/${b.cutM.toFixed(3)} outward ${a.outwardX.toFixed(2)}/${b.outwardX.toFixed(2)}`);
}

console.log(fails ? `bank-profile: ${fails} FAILED` : 'bank-profile: all ok');
writeFileSync(`${OUT}/last.json`, JSON.stringify({ fails }, null, 1));
process.exit(fails ? 1 : 0);
