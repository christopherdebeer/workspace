/**
 * THE JOINS AT SIMON'S TOWN — the four reports from the seat at
 * -34.19511,18.44192 heading 246, measured on the capture before anything is
 * changed:
 *
 *   1. the batter stops short of the join and leaves a gap;
 *   2. the arms do not meet on one closed plane;
 *   3. the batter is a picture the truck drives into, not ground it stands on;
 *   4. a mis-joined arm can put a guard rail across the carriageway.
 *
 * Numbers first, frames second. `__nodes` clusters every built fragment end
 * into junctions and reports each one's deck spread, the parapets lying
 * across its arms and the kerb ledger beside it; `__batterLine` walks a
 * transect and reads the drawn strip, the mesh the wheels read, the corridor
 * kernel's wedge and the tyre height along it. Transects run ACROSS the arms
 * (report 3) and OUT ALONG THE BISECTOR of each pair of adjacent arms (report
 * 1: the corner quadrant outside both kerbs, where the mesh either carries a
 * wedge or steps). Then the truck is stood on the worst of each and
 * photographed — chase, cab, and the chart at 0.35 — so a number has a
 * picture beside it.
 *
 *   node devtools/simonstown-junctions.mjs
 *   SIMONS_OUT=… FIX=at-campsbay REV=<sha> REFINE=0 FRAMES=0 node …
   NODES=309.5,70.2 node …                      # one junction, for a before/after
   SPOTS=302,84,210 REV=<sha> node …            # the control, stood where the run above stood
 *
 * `REFINE=0` runs the plain lattice with the carve and the strip — the path a
 * tile takes beyond REFINE_R and before the road stream is quiet — which is
 * the only path where report 3 can live: on a refined tile the strip draws
 * nothing and the wedge IS the mesh.
 */
import { openDrive, WORK } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const OUT = process.env.SIMONS_OUT ?? join(WORK, 'simonstown');
mkdirSync(OUT, { recursive: true });
const FIX = process.env.FIX ?? 'at-simonstown';
const REV = process.env.REV || '';
const REFINE = process.env.REFINE ?? '';
const POLLS = +(process.env.SETTLE_POLLS ?? 240);
const FRAMES = process.env.FRAMES !== '0';
const R = +(process.env.R ?? 700);
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
const spot = `fixture=${FIX}&cam=chase&time=NOON&cprobe=1&nodraw=1${REFINE ? `&refine=${REFINE}` : ''}`;
const d = await openDrive({ spot, tag: `junc-${FIX}${REFINE ? `-r${REFINE}` : ''}`, settle: 0, bootTimeout: 240000, dpr: 2, rev: REV });
const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
const shot = (f) => d.page.screenshot({ timeout: 120000 }).then((b) => writeFileSync(f, b));

// The three-signal gate plus the build count: dirty at zero, the way and road
// cell counts still, and no tile built, for five polls running.
let quiet = 0, pw = -1, pc = -1, pb = -1, settled = false, last = null;
for (let i = 0; i < POLLS; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb) ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds; last = t;
  if (quiet >= 5) {
    settled = true;
    console.log(`[${el()}] settled t+${(i + 1) * 3}s roadCells=${t.roadCells} seenWays=${t.seenWays} builds=${t.builds} corridor=${t.corridorMeshes}/${t.meshes}`);
    break;
  }
}
if (!settled) console.log(`[${el()}] NOT SETTLED after ${POLLS * 3}s: ${JSON.stringify(last)} — every number below is of a partial world`);

const numbers = await q((R) => ({
  tstats: window.__tstats(), junc: window.__junc(), refine: window.__refine(),
  edges: window.__edges(R), overlap: window.__overlap(R), steep: window.__steep(R, 8),
  nodes: window.__nodes(R, 0, 0, 16), buildLog: window.__buildLog(),
}), R);
const n = numbers.nodes;
console.log(`[${el()}] junctions ${n.nodes} boxed ${n.boxed} unpinned ${n.unpinned}; spread >10cm ${n.spreadOver10cm} >30cm ${n.spreadOver30cm} worst ${n.worstSpread}m; box twist >30cm ${n.twistOver30cm} worst ${n.worstTwist}m; rails across an arm at ${n.railsAcross}; joins where a kerb drew nothing ${n.joinsDrewNothing}, bare ${n.joinsBare}`);
// Which tiles carry their corridor, and why the last builds happened — a
// plain tile under the truck at settle is the whole of report 3.
const t = numbers.tstats;
console.log(`[${el()}] stream at settle: inFlight ${t.inFlight} queued ${t.queued} unbuilt ${t.unbuilt} osmDone ${t.osmDone}; corridor meshes ${t.corridorMeshes}/${t.meshes}`);
const byTile = new Map();
for (const b of numbers.buildLog) byTile.set(b.key, b);
console.log(`[${el()}] last build per tile: ${[...byTile.values()].map((b) => `${b.key}:${b.why}${b.corridor ? ':corridor' : ''}${b.refined ? ':refined' : ''}`).join(' ')}`);
console.log(`[${el()}] edges: ${JSON.stringify(numbers.edges)}`);
console.log(`[${el()}] junc: ${JSON.stringify(numbers.junc)}`);
console.log(`[${el()}] refine: ${JSON.stringify(numbers.refine)}`);
console.log(`[${el()}] overlap: ${JSON.stringify({ ...numbers.overlap, worst: (numbers.overlap.worst ?? []).slice(0, 4) })}`);
console.log(`[${el()}] steep: over20 ${numbers.steep.over20pct} over50 ${numbers.steep.over50pct} worst ${JSON.stringify(numbers.steep.worst.slice(0, 3))}`);
for (const row of n.worst.slice(0, 8)) console.log(`  spread ${row.spread}m at (${row.x},${row.z}) arms ${row.arms} ways ${row.ways} boxed ${row.boxed} roadY ${row.roadY}: ${row.decks.map((k) => `${k.nm}#${k.fd}@${k.y}`).join(' | ')}`);
for (const row of n.rails.slice(0, 8)) console.log(`  rail across at (${row.x},${row.z}) spread ${row.spread} pinned ${row.pinned} boxed ${row.boxed}: ${JSON.stringify(row.rails)}`);
for (const row of (n.twisted ?? []).slice(0, 6)) console.log(`  box twist ${row.twist}m at (${row.x},${row.z}) spread ${row.spread}: ${JSON.stringify(row.twistAt)}`);
for (const row of n.gaps.slice(0, 8)) console.log(`  kerb ledger at (${row.x},${row.z}): kerbs ${row.kerbs} met ${row.met} drewNothing ${row.clipNone} bare ${row.bare}`);

// ── transects ──
// Across each arm of a node, just outside the box (report 3), and out along
// the bisector of each pair of adjacent arms (report 1). The bisector walk
// reports the largest step in the mesh between consecutive half-metre samples
// and how far out the corridor kernel stops answering — a corner the wedge
// never reaches shows as kind 0 within a shoulder's width of the kerb line.
const transects = [];
const line = (name, x0, z0, x1, z1, n) => q(([x0, z0, x1, z1, n]) => window.__batterLine(x0, z0, x1, z1, n), [x0, z0, x1, z1, n])
  .then((rows) => { transects.push({ name, rows }); return rows; });
const summarise = (name, rows) => {
  const drawn = rows.filter((r) => r.batter !== null);
  let worst = null;
  for (const r of drawn) if (!worst || Math.abs(r.sink) > Math.abs(worst.sink)) worst = r;
  let step = 0, stepAt = 0;
  for (let i = 1; i < rows.length; i++) {
    const s = Math.abs(rows[i].ground - rows[i - 1].ground);
    if (s > step) { step = s; stepAt = rows[i].d; }
  }
  const firstNatural = rows.find((r) => r.kind === 0 && r.out !== null && r.out > 0.6);
  return { name, pts: rows.length, strip: drawn.length, worstSink: worst ? worst.sink : null, sinkAt: worst ? worst.d : null,
    sinkKind: worst ? worst.kind : null, meshStep: +step.toFixed(2), stepAt, kernelEndsAt: firstNatural ? firstNatural.d : null };
};
const across = async (name, x, z, ux, uz) => {
  const nx = -uz, nz = ux, out = [];
  for (const sgn of [1, -1]) {
    const rows = await line(`${name}:${sgn > 0 ? 'L' : 'R'}`, x, z, x + nx * sgn * 14, z + nz * sgn * 14, 28);
    out.push(summarise(`${name}:${sgn > 0 ? 'L' : 'R'}`, rows));
  }
  return out;
};
const bisectors = async (name, node) => {
  // Arms sorted by bearing; each adjacent pair's bisector, out to 20m.
  const arms = node.decks.map((k) => ({ ...k, ang: Math.atan2(k.dir[1], k.dir[0]) })).sort((a, b) => a.ang - b.ang);
  const out = [];
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i], b = arms[(i + 1) % arms.length];
    let bx = a.dir[0] + b.dir[0], bz = a.dir[1] + b.dir[1];
    const l = Math.hypot(bx, bz);
    if (l < 1e-3) continue;                 // a straight-through pair has no corner
    bx /= l; bz /= l;
    // Skip a bisector that is inside a third arm's carriageway.
    if (arms.some((c) => c !== a && c !== b && (c.dir[0] * bx + c.dir[1] * bz) > 0.94)) continue;
    const rows = await line(`${name}:corner${i}`, node.x, node.z, node.x + bx * 20, node.z + bz * 20, 40);
    out.push({ ...summarise(`${name}:corner${i}`, rows), between: [a.nm, b.nm] });
  }
  return out;
};
const summary = [];
// The report spot itself: across the road the truck stood on, heading 246.
{
  const h = (246 * Math.PI) / 180;
  const rows = await across('origin', 0, 0, Math.sin(h), -Math.cos(h));
  summary.push(...rows);
}
const targets = [];
const seenAt = [];
const take = (list, tag, k) => {
  for (const row of list) {
    if (targets.length >= 24) break;
    if (seenAt.some(([x, z]) => Math.hypot(x - row.x, z - row.z) < 3)) continue;
    seenAt.push([row.x, row.z]);
    targets.push({ tag: `${tag}${targets.filter((t) => t.tag.startsWith(tag)).length + 1}`, row });
    if (targets.filter((t) => t.tag.startsWith(tag)).length >= k) break;
  }
};
if (process.env.NODES) {
  // Named nodes, for a before/after of one junction: the row nearest each x,z.
  const all = [...n.worst, ...n.rails, ...n.gaps, ...(n.twisted ?? [])];
  for (const [i, pair] of process.env.NODES.split(';').entries()) {
    const [x, z] = pair.split(',').map(Number);
    const row = all.slice().sort((p, q) => Math.hypot(p.x - x, p.z - z) - Math.hypot(q.x - x, q.z - z))[0];
    if (row) targets.push({ tag: `node${i + 1}`, row });
  }
} else {
  take(n.worst, 'spread', 4);
  take(n.rails, 'rail', 4);
  take(n.gaps, 'gap', 4);
}
for (const { tag, row } of targets) {
  const maxHw = Math.max(...row.decks.map((k) => k.hw));
  for (const k of row.decks) {
    const s = maxHw + 4;
    summary.push(...(await across(`${tag}:${k.nm}#${k.fd}`, row.x + k.dir[0] * s, row.z + k.dir[1] * s, k.dir[0], k.dir[1])));
  }
  summary.push(...(await bisectors(tag, row)));
}
writeFileSync(join(OUT, 'numbers.json'), JSON.stringify({ ...numbers, transects: summary }, null, 1));
writeFileSync(join(OUT, 'transects.json'), JSON.stringify(transects));
const sinks = summary.filter((s) => s.worstSink !== null);
const into = sinks.filter((s) => s.worstSink > 0.3), through = sinks.filter((s) => s.worstSink < -0.3);
console.log(`[${el()}] transects ${summary.length}: strip drawn on ${sinks.length}; strip above the wheels by >0.3m on ${into.length}, below by >0.3m on ${through.length}`);
for (const s of sinks.sort((a, b) => Math.abs(b.worstSink) - Math.abs(a.worstSink)).slice(0, 8)) console.log(`  ${s.name}: sink ${s.worstSink}m at ${s.sinkAt}m (kind ${s.sinkKind})`);
const corners = summary.filter((s) => s.between);
console.log(`[${el()}] corners ${corners.length}: mesh step >0.5m over 0.5m on ${corners.filter((c) => c.meshStep > 0.5).length}; kernel answers no wedge within 3m of the node on ${corners.filter((c) => c.kernelEndsAt !== null && c.kernelEndsAt < 3).length}`);
for (const c of corners.sort((a, b) => b.meshStep - a.meshStep).slice(0, 8)) console.log(`  ${c.name} ${c.between.join('/')}: step ${c.meshStep}m at ${c.stepAt}m, kernel ends ${c.kernelEndsAt}m`);

// ── frames ──
if (FRAMES) {
  await q(() => window.__draw(true));
  await d.page.waitForTimeout(4000);
  const spots = [['origin', 0, 0, 246, 'the report spot, as the seat saw it']];
  // SPOTS=x,z,h;x,z,h photographs raw placements — the way to stand a control
  // revision exactly where the working tree stood, whatever its probes rank.
  const raw = process.env.SPOTS ? process.env.SPOTS.split(';').map((s) => s.split(',').map(Number)) : [];
  for (const [i, [x, z, h]] of raw.entries()) spots.push([`spot${i + 1}`, x, z, h, `raw placement (${x},${z}) heading ${h}`]);
  for (const { tag, row } of raw.length ? [] : targets.slice(0, 9)) {
    // Stand on the narrowest arm (the joiner), 22m out, facing the node. The
    // truck's forward is (sin h, -cos h); facing back along an arm's
    // direction u means h = atan2(-ux, uz).
    const arm = row.decks.slice().sort((a, b) => a.hw - b.hw || Math.abs(b.y - (row.roadY ?? b.y)) - Math.abs(a.y - (row.roadY ?? a.y)))[0];
    const px = row.x + arm.dir[0] * 22, pz = row.z + arm.dir[1] * 22;
    const h = (Math.atan2(-arm.dir[0], arm.dir[1]) * 180) / Math.PI;
    spots.push([tag, px, pz, h, `${tag} at (${row.x},${row.z}) spread ${row.spread} rails ${row.rails.length} drewNothing ${row.clipNone} bare ${row.bare} — stood at (${px.toFixed(1)},${pz.toFixed(1)}) heading ${h.toFixed(0)}`]);
  }
  for (const [name, x, z, h, why] of spots) {
    console.log(`[${el()}] ${name}: ${why}`);
    await q(([x, z, h]) => { window.__place(x, z, (h * Math.PI) / 180); window.__drive.speed = 0; }, [x, z, h]);
    await q(() => window.__cam('chase'));
    await d.page.waitForTimeout(4000);
    await shot(`${OUT}/${name}-chase.png`);
    await q(() => window.__cam('cab'));
    await d.page.waitForTimeout(3000);
    await shot(`${OUT}/${name}-cab.png`);
    await q(() => window.__cam('top'));
    await q(() => window.__zoom(0.35));
    await d.page.waitForTimeout(5000);
    await shot(`${OUT}/${name}-top.png`);
  }
}
console.log(`[${el()}] errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 3))}`);
await d.close();
console.log(`total ${el()} → ${OUT}`);
