/**
 * ROAD SOLVER TESTS — no browser, no renderer, no truck.
 *
 * Replays a captured session's renderWays calls against the extracted solver.
 * The fixture is REAL: the world's origin, the terrain tiles' extents, and every
 * call in the order the tiles actually arrived, taped from a live session at
 * Chapman's Peak. Nothing here is a reconstruction of what streaming might do.
 *
 *   node cells/drive/client/roadsolve.test.mjs
 *
 * Why this exists: the junction-height question took five rounds of driving a
 * headless browser at two frames a second, minutes per question, and answered
 * four wrong hypotheses on the way. The stage under suspicion turned out to have
 * one reference to THREE in a hundred and forty lines. These run in
 * milliseconds.
 *
 * WHAT THE FIXTURE DOES NOT CARRY: elevation samples. The only consumer of real
 * heights is solveChain, which is injected — so these tests are exact about
 * WHICH ways reach the solver, how they chain, and where junctions are found,
 * and say nothing about the deck heights the DP settles on. That is the right
 * split for the questions being asked; a test that pretended otherwise, on a
 * smooth synthetic surface, would assert on a problem the solver never has.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');

// TypeScript, compiled on the spot. No build config to keep in step, and the
// module under test is the one the game ships rather than a copy of it.
const tmp = mkdtempSync(join(tmpdir(), 'roadsolve-'));
const built = join(tmp, 'roadsolve.mjs');
execFileSync('npx', ['esbuild', join(HERE, 'roadsolve.ts'), '--bundle', '--format=esm', `--outfile=${built}`],
  { cwd: ROOT, stdio: 'pipe' });
const { RoadSolver } = await import(pathToFileURL(built).href);

// Two captures. `chapmans` is a spawn AT the junction — the case reported as
// working, and it turns out to hold almost no road at all. `chapmans-approach`
// is a spawn 700m short of it, which is where the junctions actually are, and
// is therefore the one that can answer whether arriving loses them.
const FIXTURE = process.env.FIXTURE ?? 'chapmans-approach';
const fix = JSON.parse(readFileSync(join(HERE, `fixtures/${FIXTURE}.json`), 'utf8'));

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
