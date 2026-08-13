/**
 * ROAD SOLVER TESTS — no browser, no renderer, no truck.
 *
 * Replays a captured session's renderWays calls against the extracted solver.
 * The fixture is REAL: the world's origin, the terrain tiles' extents, and every
 * call in the order the tiles actually arrived, taped from a live session at
 * Chapman's Peak. Nothing here is a reconstruction of what streaming might do.
 *
 *   node cells/drive/devtools/roadsolve.test.mjs
 *
 * Why this exists: the junction-height question took five rounds of driving a
 * headless browser at two frames a second, minutes per question, and answered
 * four wrong hypotheses on the way. The stage under suspicion turned out to have
 * one reference to THREE in a hundred and forty lines. These run in
 * milliseconds.
 *
 * TWO KINDS OF ASSERTION LIVE HERE, and they are worth keeping apart.
 *
 * The REPLAY sections drive the extracted solver with an injected solveChain,
 * because elevation samples are not captured. They are exact about which ways
 * reach the solver, how they chain, and where junctions are found, and say
 * nothing about the heights the DP settles on. A test that pretended otherwise,
 * on a smooth synthetic surface, would assert on a problem the solver never
 * has.
 *
 * The DECK sections read `fix.hints` — the profiles the real session really
 * settled on, taped out of the live hint store. No stub is involved, so these
 * can ask the question the replay cannot: do two roads that share an OSM node
 * end up at the same height there. That the replay reproduces the live hint
 * COUNT exactly is what licenses reading the two together.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFixture } from './fixtures/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');

// TypeScript, compiled on the spot. No build config to keep in step, and the
// module under test is the one the game ships rather than a copy of it.
const tmp = mkdtempSync(join(tmpdir(), 'roadsolve-'));
const built = join(tmp, 'roadsolve.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/roadsolve.ts'), '--bundle', '--format=esm', `--outfile=${built}`],
  { cwd: ROOT, stdio: 'pipe' });
const { RoadSolver } = await import(pathToFileURL(built).href);

// The captures, and why each exists. `chapmans-spawn` boots AT the reported
// junction — the case the user reports as CORRECT. `chapmans-drivein` boots
// 3.6km south and walks the rig in, which is the case reported as broken:
// "if I reload the page at that location it magically isn't an issue".
// `chapmans-approach` boots 700m short and streams without moving, which is the
// middle case: more road than a spawn, none of the arrival.
const FIXTURE = process.env.FIXTURE ?? 'chapmans-drivein';
const fix = loadFixture(FIXTURE);

/**
 * The world, as the fixture recorded it. Every geometric term is the real one;
 * only the DP is stubbed, and only because heights are not captured.
 */
function makeEnv(opts = {}) {
  const { lat: oLat, lon: oLon, mLon, mLat } = fix.origin;
  return {
    toLocal: (lat, lon) => [(lon - oLon) * mLon, -(lat - oLat) * mLat],
    hasHeight: (x, z) => fix.tiles.some((t) => x >= t.xs && z >= t.zs && x < t.xs + t.w && z < t.zs + t.h),
    deckAnchorAt: () => null,
    // A FLAT DECK. Junction detection turns on where hints LAND, not what they
    // say, so a constant is exact for these questions and honest about the rest.
    solveChain: (dense) => dense.map(() => 0),
    gkey: (x, z) => `${Math.floor(x / fix.grid)},${Math.floor(z / fix.grid)}`,
    gradeMax: fix.gradeMax,
    roadLift: fix.roadLift,
    juncR: opts.juncR ?? fix.juncR,
    juncPins: opts.juncPins ?? true,
  };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const show = (name, v) => console.log(`  ..   ${name} = ${JSON.stringify(v)}`);

console.log(`\nfixture: ${FIXTURE}`);
show('renderWays calls', fix.calls.length);
show('ways total', fix.calls.reduce((n, c) => n + c.els.length, 0));
show('terrain tiles', fix.tiles.length);

// ── 1. THE SPAWN CASE: every tile arrives to a solver that knows nothing ──
console.log('\nspawn — replay the taped calls into one fresh solver');
const spawn = new RoadSolver(makeEnv());
for (const c of fix.calls) spawn.plan(c.els, c.halo);
show('considered', spawn.stats.considered);
show('notDrivable', spawn.stats.notDrivable);
show('noHeight', spawn.stats.noHeight);
show('chains', spawn.stats.chains);
show('junction points', spawn.stats.pinned);
eq('every way that arrived was either chained or explained',
  spawn.stats.considered - spawn.stats.noHeight >= spawn.stats.chained, true);

// ── 2. THE DRIVE-IN CASE ──
// Arriving from a neighbouring tile means that tile's ways were already solved
// in ITS halo, so they reach this solver already hinted. That is the one line
// the whole investigation came down to:
//     if (!chain.some((m) => m.fresh)) continue;
// Mark the last call's ways as already solved and see whether its junctions
// survive.
console.log('\ndrive-in — the arriving tile\'s ways were already solved elsewhere');
const driveIn = new RoadSolver(makeEnv());
const last = fix.calls[fix.calls.length - 1];
for (const c of fix.calls.slice(0, -1)) driveIn.plan(c.els, c.halo);
const beforeLast = driveIn.stats.pinned;
for (const e of last.els) driveIn.hinted.add(String(e.id));
driveIn.plan(last.els, last.halo);
show('junction points before the last tile', beforeLast);
show('junction points after it arrived pre-hinted', driveIn.stats.pinned);

const spawnFinal = spawn.stats.pinned;
console.log('\nverdict');
show('spawn (all fresh)', spawnFinal);
show('drive-in (last tile pre-hinted)', driveIn.stats.pinned);
if (driveIn.stats.pinned < spawnFinal) {
  console.log('  >> the freshness skip LOSES junctions on the drive-in path');
} else {
  console.log('  >> the freshness skip does not lose junctions in this fixture');
}

// ── 3. THE PIN RADIUS ──
// Stations are 12m apart, so a shared node can sit 6m from the nearest one —
// twice the 3m radius. If widening finds more junctions, that arithmetic bites.
console.log('\npin radius — stations are 12m apart, so a node can be 6m from one');
for (const r of [3, 5, 7, 9]) {
  const s = new RoadSolver(makeEnv({ juncR: r }));
  for (const c of fix.calls) s.plan(c.els, c.halo);
  console.log(`  ..   juncR ${String(r).padStart(2)}m -> ${s.stats.pinned} junction points`);
}

// ── 4. PINS OFF, as a control ──
console.log('\ncontrol — pins disabled');
const noPins = new RoadSolver(makeEnv({ juncPins: false }));
for (const c of fix.calls) noPins.plan(c.els, c.halo);
eq('no pins means no junctions', noPins.stats.pinned, 0);
eq('but the chains still solve', noPins.stats.chains > 0, true);

// ── 5. THE REPLAY IS FAITHFUL ──
// Everything below reads decks the LIVE session settled on, and everything
// above reads a stub. The one thing that licenses reading them together is
// that the replay lands the same number of stations as the session did.
console.log('\nfidelity — the replay must land where the session landed');
eq('replayed hint stations match the live capture',
  [...spawn.hints.values()].reduce((n, a) => n + a.length, 0), fix.hints.length);

// ── 6. SHARED NODES MUST BE WELDED ──
// In OSM a junction is a SHARED NODE: both ways carry the identical vertex. So
// the question "do these roads meet at the same height" needs no tolerance and
// no guessing — find vertices two different ways hold in common, and read what
// the session settled on there. This is the reported bug, stated as an
// invariant rather than as a screenshot.
console.log('\nwelding — vertices two ways share must carry one deck');
const { lat: oLat, lon: oLon, mLon, mLat } = fix.origin;
const geoms = new Map();                       // way id -> longest geometry seen
for (const c of fix.calls) for (const e of [...c.els, ...(c.halo ?? [])]) {
  if (!e.geometry || !(e.tags ?? {}).highway) continue;
  const k = String(e.id);
  if (!geoms.has(k) || e.geometry.length > geoms.get(k).length) geoms.set(k, e.geometry);
}
// Index every vertex by its exact lat/lon; a key held by two ids is a join.
const atNode = new Map();
for (const [id, g] of geoms) {
  for (const p of g) {
    const k = `${p.lat},${p.lon}`;
    const s = atNode.get(k) ?? atNode.set(k, new Set()).get(k);
    s.add(id);
  }
}
const shared = [...atNode].filter(([, ids]) => ids.size > 1)
  .map(([k]) => k.split(',').map(Number));
show('shared nodes in the capture', shared.length);

// The ribbon reads its own profile with a 2.5m lookup, so that radius is the
// one that decides what a station draws at. Two decks inside it that disagree
// ARE the step in the carriageway.
const LOOKUP = 2.5, WELD_TOL = 0.25;
let solved = 0, worstNode = { spread: 0 };
for (const [nlat, nlon] of shared) {
  const nx = (nlon - oLon) * mLon, nz = -(nlat - oLat) * mLat;
  const ys = fix.hints.filter(([x, z]) => Math.hypot(x - nx, z - nz) <= LOOKUP).map((h) => h[2]);
  if (ys.length < 2) continue;                 // not chain-solved here, or solved once
  solved++;
  const spread = Math.max(...ys) - Math.min(...ys);
  if (spread > worstNode.spread) worstNode = { spread, nlat, nlon, n: ys.length };
}
show('shared nodes with two or more decks', solved);
show('worst disagreement at a shared node', `${worstNode.spread.toFixed(2)}m`);
if (worstNode.spread > 0) show('  at', `${worstNode.nlat},${worstNode.nlon}`);
eq(`no shared node disagrees by more than ${WELD_TOL}m`, worstNode.spread <= WELD_TOL, true);

// ── 7. WHICH HINT THE RIBBON ACTUALLY GETS ──
// hintAt keeps the nearest hint on a STRICT better-than, and the store appends.
// Two hints at the identical station are therefore both at distance zero, and
// the FIRST one inserted wins forever — a chain that re-solves publishes a
// corrected deck the ribbon can never read. Co-located pairs are common (127 of
// 135 in the Chapman's arrival are two roads meeting), so this only bites when
// such a pair disagrees; assert that it does not.
console.log('\nstale hints — a co-located pair means the older deck wins');
const byStation = new Map();
for (const [x, z, y] of fix.hints) {
  const k = `${x.toFixed(1)},${z.toFixed(1)}`;
  (byStation.get(k) ?? byStation.set(k, []).get(k)).push(y);
}
let pairs = 0, stale = 0, worstStale = 0;
for (const ys of byStation.values()) {
  if (ys.length < 2) continue;
  pairs++;
  const spread = Math.max(...ys) - Math.min(...ys);
  if (spread > 0.05) { stale++; worstStale = Math.max(worstStale, spread); }
}
show('stations carrying more than one deck', pairs);
show('of those, disagreeing', stale);
show('worst', `${worstStale.toFixed(2)}m`);
eq('no station carries two decks the ribbon would see differently',
  worstStale <= WELD_TOL, true);

// ── 8. WHAT WE BUILT MUST BE DRIVABLE ──
// The guard on holding pins through the limiter. A pinned station is exempt
// from ruleGrade, so in principle two pins close together could leave a wall
// the limiter would otherwise have ruled away — and that is a statement about
// CONSECUTIVE stations, which the spatially-hashed hint store cannot express.
// `profiles` keeps each chain in station order for exactly this.
//
// The threshold is the ruling grade the solver itself imposes (gCap * 1.2) at
// the steepest class it will chain, plus a little: this asks whether the
// exemption left a wall, not whether the DP picked a nice line.
console.log('\ndrivability — consecutive stations, along the road');
const WALL = 0.30;
if (!fix.profiles?.length) {
  show('profiles', 'not in this capture — recapture to check drivability');
} else {
  show('chains recorded', fix.profiles.length);
  let worst = 0, at = null, walls = 0, stations = 0;
  for (const prof of fix.profiles) {
    for (let i = 1; i < prof.length; i++) {
      const d = Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]);
      if (d < 0.5) continue;
      stations++;
      const g = Math.abs(prof[i][2] - prof[i - 1][2]) / d;
      if (g > WALL) walls++;
      if (g > worst) { worst = g; at = prof[i]; }
    }
  }
  show('station pairs', stations);
  show('steepest', `${(worst * 100).toFixed(1)}%`);
  if (at) show('  at', `${at[0]}, ${at[1]}`);
  show(`pairs over ${WALL * 100}%`, walls);
  eq(`no consecutive pair is steeper than ${WALL * 100}%`, walls, 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
