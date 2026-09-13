// THE CHART'S LEVEL RULE AND ITS RING, AS NUMBERS, ACROSS A ZOOM-OUT.
//
//   node cells/drive/devtools/ov-sweep.mjs
//   REV=<sha> node cells/drive/devtools/ov-sweep.mjs   (a control)
//   Z=30,300,3000,30000,300000 SPOT=lat=..&lon=.. node …
//
// Reported from the seat: "zooming out provides inconsistent and laggy
// (sometimes empty) chart". Three different faults share that one symptom and
// no instrument could tell them apart:
//
//   the RULE under-reaches — the level picked cannot be covered by the ring
//     the pass asks for, so the frame's own corners have no data at any time;
//   the WIRE is slow — the rule is right and the tiles have not landed yet;
//   the PICTURE is dropped — a level swap throws away what was drawn before
//     the new level has anything, so the chart goes blank mid-gesture.
//
// So this walks the ladder and prints, per rung: the level the rule picked,
// the sight line it picked it for, the ground the ring reaches (`covers` is
// the rule's verdict on itself), how many tiles were asked and how many are
// home, and how long the ring took. Then it sweeps the whole range in one
// continuous zoom-out, sampling four times a second, and counts the samples
// where the chart had NOTHING drawn — the empty frame, as a number.
import { openDrive, report } from './harness.mjs';

const REV = process.env.REV || '';
const SPOT = process.env.SPOT || 'lat=37.8199&lon=-122.4783';   // the Golden Gate
const ZOOMS = (process.env.Z ?? '4,30,120,500,2000,8000,30000,110000').split(',').map(Number);
const RING_S = Number(process.env.RING_S ?? 90);        // how long to wait for a ring
const SWEEP_MS = Number(process.env.SWEEP_MS ?? 60000);

const { page, close, errors } = await openDrive({
  spot: `${SPOT}&h=0&cam=top&z=${ZOOMS[0]}&nodraw=1&wx=clear&time=NOON`,
  tag: REV ? `ovsweep-${REV.slice(0, 7)}` : 'ovsweep-fix', menu: true, settle: 0, rev: REV,
});

// THE COVERAGE TEST IS THE TOOL'S, NOT THE BUILD'S — or a control cannot be
// compared with anything. `__ov().covers` is part of the change under test and
// simply does not exist on an older revision, so a run against one reports the
// rule as failing everywhere and says nothing. Both halves are derived here
// instead, from numbers every build has carried since the scale bar shipped:
// the frame's own half-diagonal in ground metres (the corner is what a map has
// to reach), and the ground a 5×5 ring of the chosen level reaches. Generous to
// the control, which asks for a ring of at most that size too.
const LAT = Number((SPOT.match(/lat=(-?[\d.]+)/) ?? [0, 0])[1]);
const tileM = (z) => (40075016.686 * Math.cos((LAT * Math.PI) / 180)) / 2 ** z;
const ov = () => page.evaluate(() => {
  const o = window.__ov(), c = window.__cam(), s = window.__scale();
  return { z: o.level, want: o.want, have: o.have, built: o.built, empty: o.empty,
    retired: o.retired, inFlight: o.inFlight, queued: o.queued, failing: o.failing,
    missing: o.missing.length, zoom: Math.round(c.zoom), mpp: Math.round(c.mpp ?? 0),
    // The frame's corner, in ground metres from its centre.
    frameM: s.mppCss * Math.hypot(innerWidth, innerHeight) / 2 };
}).then((o) => ({ ...o, reachM: tileM(o.z) * 2, covers: tileM(o.z) * 2 >= o.frameM }));
const zoomTo = async (z) => {
  await page.evaluate((zz) => { if (window.__cam().mode !== 'top') window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 90; i++) {
    const got = await page.evaluate(() => window.__cam().zoom);
    if (Math.abs(got - z) < Math.max(0.5, z * 0.02)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

console.log(`\n── the ladder, rung by rung (${REV ? `control ${REV.slice(0, 7)}` : 'working tree'}) ──`);
console.log('zoom     m/px    lvl  frame km  reach km  covers  asked  home   s   holes  fail  wire');
const rungs = [];
for (const z of ZOOMS) {
  await zoomTo(z);
  const t0 = Date.now();
  let o = await ov(), homeAt = null;
  for (let i = 0; i < RING_S * 2; i++) {
    o = await ov();
    if (o.want > 0 && o.have >= o.want) { homeAt = (Date.now() - t0) / 1000; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  rungs.push({ z, ...o, homeAt });
  console.log(`${String(z).padStart(7)} ${String(o.mpp).padStart(7)}  ${String(o.z).padStart(3)}`
    + `  ${(o.frameM / 1000).toFixed(1).padStart(8)}  ${(o.reachM / 1000).toFixed(1).padStart(8)}`
    + `  ${(o.covers ? 'yes' : 'NO').padStart(6)}  ${String(o.want).padStart(5)}  ${String(o.have).padStart(4)}`
    + `  ${(homeAt === null ? '—' : homeAt.toFixed(0)).padStart(3)}  ${String(o.missing).padStart(5)}`
    + `  ${String(o.failing).padStart(4)}  ${String(o.inFlight + o.queued).padStart(4)}`);
}

// ── the sweep: one continuous zoom-out, sampled, counting empty frames ──
// A chart is EMPTY when nothing of this layer is in the scene at all — no
// mesh at the current level and none held from the previous one. That is the
// seat's "sometimes empty", and it is a different number from `have < want`,
// which is an incomplete map rather than no map.
// …AND IT STARTS FROM A CHART THAT HAS A MAP ON IT. The gesture the seat
// reported is a pinch out FROM a drawn chart; sweeping from a cold one
// measures the first load instead, and reads 100% empty whatever the
// retirement does.
await zoomTo(ZOOMS[0]);
for (let i = 0; i < 120; i++) {
  const o = await ov();
  if (o.want > 0 && o.have >= o.want) break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.evaluate((zz) => window.__zoom(zz), ZOOMS[ZOOMS.length - 1]);
const t0 = Date.now();
const samples = [];
while (Date.now() - t0 < SWEEP_MS) {
  samples.push(await ov());
  await new Promise((r) => setTimeout(r, 250));
}
const drawn = (s) => s.built + s.empty + s.retired;
const blank = samples.filter((s) => drawn(s) === 0);
const uncovered = samples.filter((s) => s.want > 0 && !s.covers);
let worstBlank = 0, run = 0;
for (const s of samples) { if (drawn(s) === 0) { run++; worstBlank = Math.max(worstBlank, run); } else run = 0; }
const levels = [...new Set(samples.map((s) => s.z))];
console.log(`\n── the sweep: ${ZOOMS[0]} → ${ZOOMS[ZOOMS.length - 1]} over ${(SWEEP_MS / 1000) | 0}s ──`);
console.log(`samples ${samples.length} · levels crossed ${levels.join(' ')}`);
console.log(`EMPTY (nothing drawn) ${blank.length} samples (${((blank.length / samples.length) * 100).toFixed(0)}%),`
  + ` longest run ${(worstBlank * 0.25).toFixed(1)}s`);
console.log(`RULE UNDER-REACHES ${uncovered.length} samples (${((uncovered.length / samples.length) * 100).toFixed(0)}%)`);
report(errors);
await close();
