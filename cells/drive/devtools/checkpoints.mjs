/**
 * REFERENCE CHECKPOINTS — the same places, measured the same way, every time.
 *
 *   node cells/drive/devtools/checkpoints.mjs [--rev=HEAD] [--only=2]
 *
 * Each entry is somewhere a defect was reported from the cab, kept with a note
 * of what was wrong there. Reported places are the only ones that matter: a
 * synthetic corner can be made to pass, and a place someone actually drove
 * cannot be argued with. Run it against `--rev` and read the two together —
 * that is the point of keeping the list rather than the screenshots.
 *
 * Three numbers per spot, because a road can join badly in three different
 * ways and they have different causes:
 *
 *   centreline  two fragments at a shared node claiming different heights
 *   kerb        the same node, but comparing what the KERBS do — two fragments
 *               can agree on the centreline and part at the edges, because the
 *               cross-fall is solved per fragment
 *   overlap     two DIFFERENT ways running alongside each other over the same
 *               tarmac at different heights, with no node involved at all
 */
import { openDrive, report } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const rev = arg('rev', '');
const only = arg('only', '');
const settle = Number(arg('settle', 45000));

const SPOTS = [
  { name: 'chapmans junction',
    q: 'lat=-34.06719&lon=18.37021&h=27&cam=cab',
    was: 'two roads meeting at different heights; the arrival path only' },
  { name: 'chapmans gallery',
    q: 'lat=-34.07977&lon=18.35767&h=317&cam=cab',
    was: 'daylight through the gallery wall on bends; lamp slabs over the road' },
  { name: 'chapmans viewpoint',
    q: 'lat=-34.07000&lon=18.36887&h=83&cam=cab',
    was: 'a lengthwise seam — the road drawn as two strips at different levels' },
  { name: 'chapmans south bend',
    q: 'lat=-34.07256&lon=18.36695&h=228&cam=cab',
    was: 'the same lengthwise seam, seen along the carriageway' },
  { name: 'chapmans hairpin',
    q: 'lat=-34.07773&lon=18.36410&h=48&cam=cab',
    was: 'a fan of carriageway lifted out of the road ahead' },
];

console.log(rev ? `rev ${rev}` : 'working tree');
for (const [i, spot] of SPOTS.entries()) {
  if (only !== '' && Number(only) !== i) continue;
  // cprobe arms the carve log, which is the only way to ask whether the
  // corridor was actually cleared under the road rather than merely intended to
  // be. Off by default in the game because it logs every sample.
  const d = await openDrive({ spot: `${spot.q}&time=NOON&cprobe=1`, tag: `cp${i}${rev ? '-old' : ''}`, rev });
  await d.page.waitForTimeout(settle);
  const m = await d.page.evaluate(() => ({
    cl: window.__seams(),
    kerb: window.__kerbseams(),
    ov: window.__overlap(),
    fold: window.__ribbonfold(),
    carve: window.__carve(),
  }));
  console.log(`\n${i}. ${spot.name}  (${spot.was})`);
  console.log(`   centreline: ${m.cl.joins} joins, ${m.cl.disagreeing} disagreeing,`
    + ` p95 ${m.cl.p95}m, worst ${m.cl.worst?.[0]?.step ?? 0}m`);
  console.log(`   kerb:       ${m.kerb.joins} joins, over 10cm ${m.kerb.over10cm},`
    + ` p95 ${m.kerb.p95M}m, worst ${m.kerb.worstM}m ${JSON.stringify(m.kerb.worstWays)}`);
  console.log(`   overlap:    ${m.ov.pairs} parallel pairs disagreeing in height`);
  for (const w of m.ov.worst.slice(0, 3)) {
    console.log(`               ${w.dy}m apart, ${w.apart}m aside at ${w.at} — ${JSON.stringify(w.ways)}`);
  }
  // Did the shared-carriageway lookup even fire where the overlap is? "The fix
  // did not move the number" and "the fix never ran" look identical from the
  // outside, and telling them apart is the whole job.
  if (m.ov.worst[0]) {
    const [ox, oz] = m.ov.worst[0].at.split(',').map(Number);
    const q = await d.page.evaluate((c) => window.__sharedAt(c[0], c[1]), [ox, oz]);
    console.log(`               lookup there: ${JSON.stringify(q)}`);
  }
  console.log(`   spikes:     ${m.fold.wide} of ${m.fold.bays} bays over 1.3x their road's width`);
  for (const w of m.fold.worst.slice(0, 3)) {
    console.log(`               ${w.ratio}x -> ${w.widthM}m wide at ${w.at}`);
  }
  // GROUND LEFT STANDING IN THE ROAD. `bySection` is the part that matters: a
  // cut at the shoulders is a cross-slope being benched, which is what a shelf
  // road IS. A cut under the CENTRELINE or the kerbs means the deck was seated
  // below the hillside it runs on and the excavation never caught up — which
  // from the cab is a wedge of lit earth standing in the carriageway.
  const cv = m.carve;
  if (cv.error) {
    console.log(`   carve:      ${cv.error}`);
  } else {
    console.log(`   carve:      ${cv.samples} samples, needed ${cv.needed}, artefact ${cv.artefact}`);
    for (const [nm, v] of Object.entries(cv.bySection)) {
      if (v && v.cutPct > 0) {
        console.log(`               ${nm.padEnd(11)} cut ${v.cutPct}%  ground over deck`
          + ` med ${v.fieldOverTarget?.med ?? 0}m max ${v.fieldOverTarget?.max ?? 0}m`);
      }
    }
  }
  report(d.errors);
  await d.close();
}
