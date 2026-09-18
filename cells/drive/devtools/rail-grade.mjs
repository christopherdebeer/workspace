/**
 * ── IS THE RAILWAY ENGINEERED, OR IS IT DRAPED? ──
 *
 *   node devtools/rail-grade.mjs           (the fix)
 *   GRADE=0 node devtools/rail-grade.mjs   (the control, ?railgrade=0)
 *
 * ONE VARIANT PER PROCESS, deliberately: the harness fuse is twenty minutes
 * and a settled fixture is minutes, so two variants in one run is a run that
 * gets killed with its last number half-written.
 *
 * The A/B is the SWITCH, not a `rev`. `railgrade=0` drapes a railway over the
 * heightfield exactly as it was drawn before the split, so both columns come
 * from the same bundle and the only difference is the rule under test — which
 * a pinned control cannot promise once the change lives in more than one file.
 *
 * What is read, all of it from `__railgrade`: the solved DECK against the
 * NATURAL ground (a cutting is positive, an embankment negative) and against
 * the DRAWN mesh (near zero means the corridor actually reached the terrain).
 * `at-glencairn` is the fixture with the Southern Line in it and needs no
 * network at all, so the numbers are the same every run.
 */
import { openDrive } from './harness.mjs';

const GRADE = process.env.GRADE ?? '1';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: `fixture=at-glencairn&cam=top&time=NOON&wx=clear&nodraw=1&railgrade=${GRADE}`,
  tag: `railgrade-${GRADE}`, settle: 0, bootTimeout: 240000, dpr: 1,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);

// THE THREE-SIGNAL GATE. A carve that has not finished is a carve with no
// cutting in it yet, and the corridor is rebuilt on the quiet path — so the
// terrain build count has to stop moving as well as the ways.
let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 100; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb && t.seenWays > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${el()}] settled: ways ${pw}, roadCells ${pc}, terrain builds ${pb}`);

const rw = await q(() => window.__railways());
console.log(`  railways: n=${rw.n} kinds=${JSON.stringify(rw.kinds)} gauges=${JSON.stringify(rw.gauges)}`);
const g = await q(() => window.__railgrade(1200));
const { rows, profiles, ...sum } = g;
console.log(`  __railgrade: ${JSON.stringify(sum)}`);
for (const r of rows.slice(0, 10)) {
  console.log(`    ${String(r.nm || '(unnamed)').padEnd(18)} (${String(r.x).padStart(7)},${String(r.z).padStart(7)})`
    + ` deck ${String(r.deck).padStart(8)}  dem ${String(r.dem).padStart(8)}`
    + `  cut ${String(r.cut).padStart(7)}  mesh-deck ${String(r.gap).padStart(7)}`);
}
for (const f of profiles ?? []) {
  const pc = (v) => `${(v * 100).toFixed(1)}%`;
  console.log(`  fragment ${f.fd} "${f.nm || '(unnamed)'}" ${f.n} bays, ${f.lenM} m`
    + ` — deck grade p95 ${pc(f.deckG.p95)} max ${pc(f.deckG.max)}`
    + ` · ground (= the draped control) p95 ${pc(f.demG.p95)} max ${pc(f.demG.max)}`);
  console.log(`    m / deck / ground:`);
  console.log('    ' + f.prof.map(([m, d, e]) => `${m}:${d.toFixed(1)}/${e.toFixed(1)}`).join('  '));
}
// AND THE ROADS ARE THE CONTROL WITHIN THE FRAME: the M4 runs beside this
// line for its whole length, so a change that moved the roads as well would
// not be a railway change.
const rd = await q(() => window.__tstats());
console.log(`  roads (unchanged expected): roadCells ${rd.roadCells}, corridorMeshes ${rd.corridorMeshes}, terrainTris ${rd.terrainTris}`);
const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 3)) : ''}`);
await d.close();
