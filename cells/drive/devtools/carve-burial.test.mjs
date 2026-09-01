/**
 * A BORE IS AN ASSERTION; AN EXEMPTION IS NOT.
 *
 *   node cells/drive/devtools/carve-burial.test.mjs        (~40s)
 *
 * The slow witness for the terrain hole lives in road-hole.test.mjs, which
 * boots the real Fish Hoek spot twice and takes twelve minutes because every
 * tile streams through the harness's curl relay. This is the same three laws
 * over the `sidehill` fixture, which answers all three world fetches from
 * authored ground and needs no network at all. Half a minute, same pipeline,
 * same carve, and identical every run — so the burial cases can be iterated on
 * rather than budgeted for.
 *
 * The fixture carries one road for each thing that can happen to a road with
 * ground over it:
 *
 *   Bore Road      crosses a ridge, tagged tunnel=yes   -> exempt, AND a tube
 *   Duck Road      crosses the same ridge, untagged     -> exempt, NO tube
 *   Traverse Road  bench solved below its mapped line   -> the unfixed case
 *
 * Why the tagged/untagged split is the law rather than "build a tube wherever
 * it is buried": burial is OUR arithmetic — the profile solver's answer minus
 * the heightfield's — and both are wrong here and there. `tunnel=*` is a
 * surveyed fact. A tube drawn on our own numbers puts a black portal into a
 * hillside the data says has no tunnel in it, and does so most enthusiastically
 * where the solver is least reliable. Declining to DIG needs no evidence,
 * because it only ever refuses to remove a hill; drawing a bore does.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const errors = [];
const d = await openDrive({
  spot: 'fixture=sidehill&cam=chase&time=NOON&cprobe=1',
  tag: 'carve-burial', settle: 9000, bootTimeout: 90000,
});
const q = async (fn, ...a) => d.page.evaluate(fn, ...a);

/**
 * WAIT FOR THE CARVE, NOT FOR A CLOCK.
 *
 * This used to be a flat six seconds. `dirtyTerrainAround` marks up to nine
 * tiles for one run of road and `flushTerrain` rebuilds ONE per 200ms, so the
 * ground lags the roads by a long way — measured on the Big Sur capture, the
 * queue took ninety seconds to drain, and every number read before it did was
 * a number about a half-built world. The batter count in particular read ZERO
 * on an unsettled world and 2281 on the same world settled, which is the
 * difference between "no batters are drawn here" and "the batters had not been
 * built yet". Reported from a screenshot: the terrain cutting had not finished.
 *
 * `terrainDirty.size` is the queue itself, and the codebase's own
 * tape-recording readiness gate gates on exactly this. Held for four
 * consecutive polls, because it dips through zero between tiles.
 */
async function settle(label) {
  let quiet = 0;
  for (let i = 0; i < 60; i++) {
    await d.page.waitForTimeout(3000);
    const dirty = await q(() => window.__tstats().dirty);
    quiet = dirty === 0 ? quiet + 1 : 0;
    if (quiet >= 4) { console.log(`  ${label}: carve settled at t+${(i + 1) * 3}s`); return; }
  }
  console.log(`  ${label}: WARNING carve never settled — numbers below are provisional`);
}
await settle('sidehill');

const buried = await q(() => window.__buried(1400));
const tunnels = await q(() => window.__tunnelBreach());
/** Segments of one named road: how many built, how many carve-exempt, and the
 *  deepest ground standing over the deck. */
async function road(nm) {
  const rows = await q((n) => window.__profile(n), nm);
  let segs = 0, tn = 0, cover = 0;
  for (const r of rows) {
    if (!Number.isFinite(r[2])) continue;
    segs++;
    if (r[4]) tn++;
    cover = Math.max(cover, r[3] - r[2]);
  }
  return { segs, tn, cover: +cover.toFixed(1) };
}
const bore = await road('Bore Road');
const duck = await road('Duck Road');
const trav = await road('Traverse Road');
errors.push(...d.errors);
await d.close();

console.log('');
for (const [nm, r] of [['Bore Road', bore], ['Duck Road', duck], ['Traverse Road', trav]]) {
  console.log(`  ${nm.padEnd(15)} segs=${String(r.segs).padStart(4)}  exempt=${String(r.tn).padStart(3)}  deepest cover=${r.cover}m`);
}
console.log(`  world: ${tunnels.meshes} tunnel mesh(es), ${tunnels.breaching} breaching`);
console.log(`  ${JSON.stringify(buried)}\n`);

check('the fixture built all three roads', bore.segs > 50 && duck.segs > 50 && trav.segs > 50,
  { bore: bore.segs, duck: duck.segs, trav: trav.segs });
check('the ridge really buries the roads that cross it',
  bore.cover > 5.6 && duck.cover > 5.6, { bore: bore.cover, duck: duck.cover });

// ── the two laws ──
check('a buried road is exempt from the carve, tagged or not',
  bore.tn > 0 && duck.tn > 0, { bore: bore.tn, duck: duck.tn });
check('…and only the TAGGED one gets a bore drawn for it',
  tunnels.meshes === 1, { meshes: tunnels.meshes });
check('the bore that was built stays under its hill',
  tunnels.breaching === 0 && (tunnels.worstAboveGround ?? -1) < 0, tunnels);

// ── the case this does NOT fix, stated so it cannot be forgotten ──
//
// Traverse Road's bench solves below its mapped line, so the centreline
// carries metres of cover while `elevMin` — the MINIMUM across the width,
// which is what ribbon's burial test actually asks — reads the low downhill
// edge and calls it clear. No exemption, and the carve digs. This is 97% of
// what the fixture leaves exposed and it was 18 of the 22 left at Fish Hoek.
//
// Not a check, because a check that passes BECAUSE a defect exists is worse
// than no check: it goes green for the wrong reason and it goes red when
// someone fixes the thing. The failing law lives in road-hole.test.mjs.
console.log(`  KNOWN GAP — the width-minimum burial test: ${buried.missedByWidthMin}`
  + ` of ${buried.deeperThanTube} exposed-and-deep segments are ones elevMin calls unburied.`);
console.log(`  Traverse Road carries ${trav.cover}m of cover on its centreline and ${trav.tn} exemptions.`);

console.log(bad ? `\n${bad} FAILED` : '\nall good — the carve stands down for burial, the bore waits for a tag');
report(errors);
if (bad) process.exitCode = 1;
