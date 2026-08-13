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
];

console.log(rev ? `rev ${rev}` : 'working tree');
for (const [i, spot] of SPOTS.entries()) {
  if (only !== '' && Number(only) !== i) continue;
  const d = await openDrive({ spot: `${spot.q}&time=NOON`, tag: `cp${i}${rev ? '-old' : ''}`, rev });
  await d.page.waitForTimeout(settle);
  const m = await d.page.evaluate(() => ({
    cl: window.__seams(),
    kerb: window.__kerbseams(),
    ov: window.__overlap(),
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
  report(d.errors);
  await d.close();
}
