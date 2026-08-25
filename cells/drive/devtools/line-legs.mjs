/**
 * THE WHOLE LINE, ROUTED — every leg's actual course, as the campaign wants it.
 *
 *   node cells/drive/devtools/line-legs.mjs            # all legs
 *   node cells/drive/devtools/line-legs.mjs line-03    # one
 *
 * `line-route.mjs` answers one leg and prints it for a human. This answers the
 * CAMPAIGN: it runs every leg of the authored line, simplifies each course to
 * something a 2KB JSON can carry, and writes the block the client reads.
 *
 * WHY THE COURSE HAS TO BE DATA. Today a leg is two points and a distance, so
 * the only guidance the game can give is a bearing to the far end — which is
 * the instruction "drive at it", and the exact opposite of a line. With the
 * course in the campaign the co-driver can call the road you are actually
 * meant to be on, the chart can draw it, and arriving can mean having driven
 * it rather than having reached the end of it.
 *
 * The output goes to docs/line/legs.json and is pasted into campaigns/dakar.ts
 * by hand — a campaign is authored data, and a generated course still gets
 * read by a person before it becomes the line.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { routeLine, hav } from './line-route.mjs';

// The authored legs, mirrored from campaigns/dakar.ts. Kept as literals rather
// than imported: dakar.ts is TypeScript the cell compiles, and this tool must
// run on plain node with nothing built.
const LEGS = [
  ['line-01', 48.7784, 2.31318, 48.4372, 2.1725],
  ['line-02', 48.4372, 2.1725, 47.945, 1.904],
  ['line-03', 47.945, 1.904, 47.25004, 2.06019],
  ['line-04', 47.25004, 2.06019, 46.86219, 1.71594],
  ['line-05', 46.86219, 1.71594, 46.58899, 1.51902],
];

/**
 * RAMER–DOUGLAS–PEUCKER IN METRES, and the tolerance is a design choice.
 *
 * The router returns a vertex per graph node — 314 for leg 1, which at five
 * decimal places is 8KB for one leg and 40KB for the campaign, fetched by
 * every client on every boot. 25m is the width of the carriageway: below that
 * the course cannot be told from the road it describes, and above it the
 * course starts cutting corners the road does not.
 */
function simplify(pts, tolM) {
  if (pts.length <= 2) return pts;
  const mLat = 111320, mLon = 111320 * Math.cos((pts[0][0] * Math.PI) / 180);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = pts[a][1] * mLon, az = pts[a][0] * mLat;
    const bx = pts[b][1] * mLon, bz = pts[b][0] * mLat;
    const dx = bx - ax, dz = bz - az, dd = dx * dx + dz * dz;
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * mLon, pz = pts[i][0] * mLat;
      const t = dd ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / dd)) : 0;
      const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
      if (d > worst) { worst = d; wi = i; }
    }
    if (worst > tolM) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const want = process.argv.slice(2).filter((a) => a.startsWith('line-'));
const out = [];
for (const [id, aLat, aLon, bLat, bLon] of LEGS) {
  if (want.length && !want.includes(id)) continue;
  console.error(`\n══ ${id} ══ ${aLat},${aLon} → ${bLat},${bLon}`);
  let r;
  try {
    r = await routeLine(aLat, aLon, bLat, bLon, (m) => console.error('   ' + m));
  } catch (err) {
    console.error(`   FAILED: ${String(err.message ?? err)}`);
    out.push({ id, error: String(err.message ?? err) });
    continue;
  }
  // A ROUTE MUCH LONGER THAN THE CHORD IS A HOLE, NOT A SCENIC DETOUR. Leg 4
  // came back 130.6km against a 50.4km chord — the router picking its way
  // round twenty overview tiles that never filled, which reads as a course
  // and would ship as one. The old N20 corridor runs 18% long and the Sologne
  // crossing will run further; 60% is well clear of any real detour and well
  // under this failure. Refused loudly rather than written out quietly.
  const over = r.metres / r.chord - 1;
  if (over > 0.6) {
    // TWO DIFFERENT FAULTS WEAR THIS SYMPTOM, and saying so is the difference
    // between "run it again" and "go and fix the router". Cold tiles mean the
    // map has a hole and the route went round it; ZERO cold tiles mean every
    // tile is present and the graph still could not be crossed — which is a
    // CONNECTIVITY failure in how the clipped per-tile ways are rejoined, and
    // no number of re-runs will move it.
    const why = r.refused > 0
      ? `route ${(r.metres / 1000).toFixed(1)}km is ${(over * 100).toFixed(0)}% over the `
        + `${(r.chord / 1000).toFixed(1)}km chord, and ${r.refused} of ${r.served + r.refused} tiles are `
        + `cold — the map has a hole and the route went round it. Re-run when those tiles fill.`
      : `route ${(r.metres / 1000).toFixed(1)}km is ${(over * 100).toFixed(0)}% over the `
        + `${(r.chord / 1000).toFixed(1)}km chord with ALL ${r.served} tiles served — this is not a `
        + `missing tile, it is a graph that cannot be crossed. The per-tile ways are not rejoining `
        + `at the seams (see SNAP in line-route.mjs). Re-running will not fix it.`;
    console.error(`   REFUSED: ${why}`);
    out.push({ id, error: why });
    continue;
  }
  const pts = simplify(r.line, 25).map(([la, lo]) => [+la.toFixed(5), +lo.toFixed(5)]);
  // The named roads worth putting in a docket: anything carrying at least
  // 800m of the leg, in order of share. A road that carries less than that is
  // a junction the route crossed, not a road it took.
  const vias = r.roads.filter(([, m]) => m >= 800)
    .map(([name, m]) => ({ name, km: +(m / 1000).toFixed(1) }));
  const block = { id, km: +(r.metres / 1000).toFixed(1),
    chordKm: +(r.chord / 1000).toFixed(1), pts, vias };
  out.push(block);
  console.error(`   routed ${block.km} km (chord ${block.chordKm}, ${((r.metres / r.chord - 1) * 100).toFixed(0)}% longer)`);
  console.error(`   ${r.line.length} vertices → ${pts.length} after 25m simplify (${(JSON.stringify(pts).length / 1024).toFixed(1)} KB)`);
  console.error(`   carried by ${vias.length} named roads: ${vias.slice(0, 5).map((v) => `${v.name} ${v.km}km`).join(' · ')}`);
}
mkdirSync('docs/line', { recursive: true });
const file = 'docs/line/legs.json';
writeFileSync(file, JSON.stringify(out, null, 1));
console.error(`\nwrote ${file} — ${out.filter((o) => !o.error).length}/${out.length} legs routed, `
  + `${(JSON.stringify(out).length / 1024).toFixed(1)} KB total`);
