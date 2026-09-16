/**
 * ── WHAT THE IMPOSTOR ATLAS WAS ASKED FOR, BESIDE WHAT IT HOLDS ──
 *
 *   node cells/drive/devtools/imp-demand.mjs
 *   SPOT='lat=34.40458&lon=131.04831&h=352&cam=chase' …  the seat's own dump
 *   FIX=at-campsbay …          a fixture instead of a live spot
 *   DIALS='trng=4,imprch=2,impden=5,tvar=3' …  the rack, as indices
 *   SETTLE=45000 …             how long to let the tier fill
 *   ARGS='ezstand=0' …         switches
 *
 * THE QUESTION IT WAS BUILT FOR. A device dump reported **5,108 impostors
 * waiting on a bake with the atlas at 18/18 slots** — five thousand trees that
 * cannot draw, against a store the same line calls full — and `waiting` alone
 * could not say whether the atlas was TOO SMALL (every slot carrying trees and
 * the footprint wanting more) or STALE (slots baked somewhere the truck has
 * left, serving nobody). This reports the demand BY NAME instead: refused keys
 * with their tree counts, against how many baked slots serve zero.
 *
 * THE ANSWER WAS TOO SMALL, AND THE ATLAS IS 40 SLOTS NOW — enough for the
 * whole variant space (37), so `locked` is an assertion-level bug rather than
 * a state the renderer is expected to handle. **This tool FAILS on it.**
 * `devtools/imp-atlas.test.mjs` holds the capacity invariant in pure node and
 * is the cheaper gate; this one is the live witness.
 *
 * WHAT IS LEFT IS LATENCY, AND IT NO LONGER HIDES A TREE. The bake budget is
 * two variants a refresh, so a cold district takes several seconds to
 * photograph its palette — and a tree whose variant has not landed yet borrows
 * a RESIDENT SIBLING of its own family rather than drawing nothing. `stood`
 * counts those; `waiting - stood` is the trees genuinely absent, which is a
 * family with no slot at all and lasts one sweep.
 *
 * IT MUST BE A DRIVEN WORLD, not a fixture snap. `impSlotFor` never re-uses a
 * slot and a district's palette is a 6 km cell, so the demand can only be a
 * function of HOW FAR THE TRUCK HAS TRAVELLED — a spawn measures the one case
 * that works. The tool drives a leg and reports the census at each waypoint,
 * so a ratchet shows as a SERIES rather than as one number that has to be
 * argued about.
 */
import { openDrive, walkTo, CELL, ROOT } from './harness.mjs';
import { build } from 'esbuild';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ── THE CEILING, COMPUTED OFFLINE, BEFORE ANY BROWSER ──
 *
 * The atlas's own comment sizes it at "the ten a district's palettes can ask
 * for (five families at EZ_PALETTE_N)". That counts HABITS, and `ezPalette`
 * does draw over habits — but `ezPickVariant` then reaches every PEER of the
 * habit it landed on, by the INDIVIDUAL seed, and a phenotype state can reach
 * outside the palette entirely. So the keys a single district can ask the
 * atlas for is the sum of its two largest habits per family, not two.
 *
 * This is pure — the bake is a module, EZ_PALETTE_N is a constant, and the
 * peer rule is `ezPickVariant`'s own — so it needs no world, no streaming and
 * no luck about where the truck is standing, and it answers the same every
 * run. It runs first because a structural ceiling under the supply makes the
 * live census a confirmation rather than the evidence.
 */
async function atlasCeiling() {
  const dir = mkdtempSync(join(tmpdir(), 'impdemand-'));
  const out = join(dir, 'flora.mjs');
  await build({
    entryPoints: [join(CELL, 'client/flora-ez.ts')], bundle: true, format: 'esm',
    outfile: out, absWorkingDir: ROOT, logLevel: 'error',
  });
  globalThis.location = { search: '' };
  globalThis.document = { createElementNS: () => ({ getContext: () => null }) };
  const m = await import(out);
  const rows = [];
  let worst = 0;
  for (const fam of m.EZ_FAMILIES) {
    const vs = m.ezVariants(fam);
    const byHabit = new Map(), byState = new Map();
    vs.forEach((v, i) => {
      const h = m.ezHabitOf(v);
      (byHabit.get(h) ?? byHabit.set(h, []).get(h)).push(i);
      if (v.state) (byState.get(v.state) ?? byState.set(v.state, []).get(v.state)).push(i);
    });
    const sizes = [...byHabit.values()].map((a) => a.length).sort((a, b) => b - a);
    const pal = sizes.slice(0, m.EZ_PALETTE_N).reduce((a, b) => a + b, 0);
    const st = [...byState.values()].map((a) => a.length);
    const want = pal + (st.length ? Math.max(...st) : 0);
    worst += want;
    rows.push({ fam, n: vs.length, habits: byHabit.size, sizes, pal, want,
      states: [...byState.keys()] });
  }
  return { rows, worst, paletteN: m.EZ_PALETTE_N };
}

const FIX = process.env.FIX ?? '';
// The seat's dump: Nagato, Japan, chase, hard tilt.
const SPOT = process.env.SPOT ?? 'lat=34.40458&lon=131.04831&h=352&cam=chase&tilt=hard';
const ARGS = process.env.ARGS ?? '';
const SETTLE = Number(process.env.SETTLE ?? 45000);
// The leg, in kilometres, and how often to read the census along it. A
// district cell is 6 km, so 24 km crosses at least three of them — which is
// the smallest drive that can distinguish "this place wants more than
// eighteen" from "eighteen accumulated over a drive and were never given back".
const KM = Number(process.env.KM ?? 24);
const STEP_KM = Number(process.env.STEP_KM ?? 4);
// The rack as the dump found it: draw range 2.8 km, impostor reach 1x of that,
// density ALL, every variant. Dials live in localStorage, so a harness only
// ever sees defaults unless it sets them — and the defaults are not the
// settings the fault was reported under.
const DIALS = process.env.DIALS ?? 'trng=4,imprch=2,impden=5,tvar=3';

const ceil = await atlasCeiling();
console.log(`\nTHE CEILING, from the bake (palette ${ceil.paletteN} habits a family):`);
for (const r of ceil.rows) {
  console.log(`  ${r.fam.padEnd(10)} ${String(r.n).padStart(3)} variants`
    + ` · ${String(r.habits).padStart(2)} habits [${r.sizes.join(',')}]`
    + ` · a district can want ${String(r.pal).padStart(2)} by palette`
    + (r.states.length ? `, ${r.want} with a phenotype (${r.states.join(',')})` : ''));
}
console.log(`  WORST ONE DISTRICT: ${ceil.worst} distinct keys`
  + `   — and a 2.8 km reach spans up to four 6 km district cells\n`);

const d = await openDrive({
  spot: `${FIX ? `fixture=${FIX}` : SPOT}&time=NOON&wx=clear&sunalt=42${ARGS ? `&${ARGS}` : ''}`,
  tag: 'impdemand', settle: SETTLE,
});
let inconclusive = false;
let dem = null;
try {
  const set = DIALS.split(',').filter(Boolean).map((s) => s.split('='));
  await d.page.evaluate((rows) => {
    for (const [k, i] of rows) window.__dial(k, Number(i));
  }, set);
  // A dial that changes the tier's reach only takes effect on the next
  // refresh, and the refresh is what writes the census. Give it real seconds.
  await d.page.waitForTimeout(8000);

  const census = async () => await d.page.evaluate(() => ({
    dials: window.__dial(),
    dem: window.__impdemand ? window.__impdemand() : null,
    imp: window.__impostor(),
    at: window.__drive ? [window.__drive.x, window.__drive.z] : [0, 0],
  }));
  let c = await census();
  if (!c.dem) { console.log('NO __impdemand — this revision predates the instrument'); process.exit(2); }
  const { dials } = c;

  console.log(`\nrack  trng ${dials.trng} · imprch ${dials.imprch} · impden ${dials.impden}`
    + ` · tvar ${dials.tvar} · tpop ${dials.tpop}`);
  console.log(`      palette ${c.dem.paletteN} per family · variant cap ${c.dem.variantCap}`
    + ` · bake budget ${c.dem.bakePerRefresh}/refresh · form budget ${c.dem.formBudget}/refresh`);
  console.log(`      district cell 6 km · leg ${KM} km, read every ${STEP_KM} km\n`);

  // ── THE SERIES: the census after each leg, driven not teleported ──
  // The spawn's own coordinates, off the query this tool composed — the world
  // has no probe that answers "where did I boot", and walkTo wants lat/lon.
  const home = await d.page.evaluate(() => ({
    lat: Number(new URLSearchParams(location.search).get('lat')),
    lon: Number(new URLSearchParams(location.search).get('lon')),
  }));
  // A FIXTURE CANNOT DRIVE, and that is not a fault. Its world is the capture's
  // own box and nothing streams past it, so a leg would walk off the edge of
  // the evidence — but a capture HAS ALREADY ARRIVED, every tile present in
  // the first frame, which is the one thing a relay-fed live world is bad at.
  // So a fixture measures ONE PLACE'S demand well and the ratchet not at all,
  // and KM=0 is how to ask for that.
  const canDrive = KM > 0 && Number.isFinite(home.lat) && Number.isFinite(home.lon);
  if (KM > 0 && !canDrive) {
    console.log('NO SPAWN COORDINATES — a fixture has no lat/lon to drive from; use SPOT= or KM=0');
    process.exit(2);
  }
  console.log('  km   drawn  offered  slots  need  inUse  idle  refusedN  keys  stood  verdict');
  console.log('  (stood = waiting trees that borrowed a sibling rather than vanishing)');
  const row = (km, x) => console.log(`${String(km).padStart(4)}  ${String(x.imp.drawn).padStart(6)}`
    + `  ${String(x.imp.offered).padStart(7)}  ${String(x.dem.slots).padStart(5)}`
    + `  ${String(x.dem.need).padStart(4)}  ${String(x.dem.inUse).padStart(5)}`
    + `  ${String(x.dem.idle).padStart(4)}  ${String(x.dem.refusedN).padStart(8)}`
    + `  ${String(x.dem.refusedKeys).padStart(4)}  ${String(x.dem.stood).padStart(5)}`
    + `  ${x.dem.verdict}`);
  row(0, c);
  for (let km = STEP_KM; canDrive && km <= KM; km += STEP_KM) {
    // Due north: latitude is the one axis whose metres-per-degree does not
    // depend on where you are, so the leg is the same length at any spawn.
    await walkTo(d.page, home.lat + km / 111.32, home.lon, { hop: 300, dwell: 1500, log: false });
    await d.page.waitForTimeout(6000);
    c = await census();
    row(km, c);
  }
  dem = c.dem;
  const imp = c.imp;
  console.log(`\ntier  reach ${imp.granted}m · drawn ${imp.drawn}/${imp.offered} offered`
    + ` · far ${imp.far}/${imp.farSeen} · atlas ${dem.slots}/${dem.slotCap} slots`);

  console.log(`\nDEMAND  need ${dem.need} distinct keys against ${dem.slotCap} slots`
    + ` (${dem.over > 0 ? `${dem.over} OVER` : `${-dem.over} spare`})`);
  console.log(`SUPPLY  ${dem.inUse} of ${dem.slots} baked slots are carrying trees`
    + ` · ${dem.idle} IDLE (baked, serving nobody)`);
  console.log(`REFUSED ${dem.refusedN} trees over ${dem.refusedKeys} keys`
    + ` — ${dem.waiting} WAITING on the bake budget (drains),`
    + ` ${dem.locked} LOCKED OUT by a full atlas (never draws)`);
  // THE ONE THAT SAYS WHETHER THE HOLE WAS FILLED. A pending key borrows a
  // resident sibling of its own family, so a waiting tree still stands — and
  // the gap between `waiting` and `stood` is trees genuinely absent, which is
  // a family with no slot baked at all and lasts one sweep.
  console.log(`        of the waiting, ${dem.stood} DREW ANYWAY on a sibling of`
    + ` their own family; ${dem.waiting - dem.stood} had no sibling yet and are absent`);

  if (dem.served.length) {
    console.log('\n  baked slot                        instances');
    for (const r of dem.served) {
      console.log(`  ${String(r.slot).padStart(2)} ${r.key.padEnd(30)} ${String(r.n).padStart(7)}`
        + (r.n === 0 ? '   IDLE' : ''));
    }
  }
  if (dem.refused.length) {
    console.log('\n  refused key                       trees wanting it');
    for (const r of dem.refused) {
      console.log(`     ${r.key.padEnd(30)} ${String(r.n).padStart(7)}`);
    }
  }

  // ── THE VERDICT, AND WHAT EACH ONE MEANS FOR THE NEXT UNIT ──
  const say = {
    satisfied: 'ok — every key the footprint asked for has a slot',
    filling: 'FILLING — the atlas has ROOM and only the two-bakes-a-refresh budget is'
      + ' refusing, so these trees get slots within a few sweeps. This is the benign'
      + ' reading of "waiting on a bake", and it is NOT what a dump at 18/18 means',
    stale: 'STALE — the demand FITS in eighteen slots and idle ones are holding it out.'
      + ' The fix is reclaiming a slot nobody is standing on, not a bigger atlas',
    'too-small': 'TOO SMALL — the atlas is FULL, every slot is carrying trees, and the'
      + ' footprint still wants more. Those trees never draw, this session, wherever the'
      + ' truck goes. The fix is more slots, or a demand that does not grow with the'
      + ' distance travelled',
    both: 'BOTH — the atlas is over-subscribed AND holding slots that serve nobody.'
      + ' Reclaim first: it is the cheaper half and it bounds how much enlarging is really needed',
  }[dem.verdict];
  console.log(`\n${say}`);
  console.log(`page errors: ${d.errors.length}`
    + (d.errors.length ? ` ${JSON.stringify(d.errors.slice(0, 3))}` : ''));
  // Not a pass/fail tool: it exists to READ a filed symptom, and either answer
  // is a real answer. It fails only when it could not measure at all.
  if (imp.drawn === 0 && dem.refusedN === 0) {
    console.log('INCONCLUSIVE — the tier drew nothing and refused nothing; there was no demand'
      + ' to measure. Through the harness relay a 2.8 km tree ring does not fill:'
      + ' use a FIXTURE (which has already arrived) or read a device dump.');
    inconclusive = true;
  }
} finally { await d.close(); }
// After close, or the harness's own teardown resets it.
process.exitCode = inconclusive ? 2 : 0;
