/**
 * HOW MUCH DAYLIGHT DO THE TUNNEL AND GALLERY SHELLS LEAK?
 *
 *   node cells/drive/devtools/shells.mjs [--rev=HEAD] [--to=lat,lon]
 *
 * Reads `__shells`, which counts boundary edges: in a continuous strip every
 * interior edge is shared by two triangles, and every gap opens a pair shared
 * by one. A shell has legitimate boundary — the rim at each portal, the open
 * side of a gallery — so the figure is never zero and means nothing on its own.
 * Run it against `--rev` and read the two together; that is the whole point.
 *
 *   node cells/drive/devtools/shells.mjs --rev=HEAD~1   # before
 *   node cells/drive/devtools/shells.mjs                # after
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDrive, report, walkTo, CELL } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const rev = arg('rev', '');
const spot = arg('spot', 'lat=-34.07764&lon=18.36420&h=0&cam=chase');
const to = arg('to', '');
const settle = Number(arg('settle', 40000));

// An older build has no __shells — it is the probe that made the question
// askable. It reads nothing but worldGroup and THREE, so it grafts on cleanly.
const SHIM = `
(window as unknown as { __shells?: object }).__shells = (which = 'tunnel'): object => {
  let meshes = 0, tris = 0, boundary = 0, boundaryLen = 0, worst = 0;
  worldGroup.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !o.userData[which]) return;
    meshes++;
    const p = m.geometry.attributes.position as THREE.BufferAttribute;
    const key = (i: number): string =>
      \`\${Math.round(p.getX(i) * 100)},\${Math.round(p.getY(i) * 100)},\${Math.round(p.getZ(i) * 100)}\`;
    const edges = new Map<string, number>();
    for (let t = 0; t + 2 < p.count; t += 3) {
      tris++;
      const k = [key(t), key(t + 1), key(t + 2)];
      for (let e = 0; e < 3; e++) {
        const a = k[e], b = k[(e + 1) % 3];
        if (a === b) continue;
        const id = a < b ? \`\${a}|\${b}\` : \`\${b}|\${a}\`;
        edges.set(id, (edges.get(id) ?? 0) + 1);
      }
    }
    for (const [id, n] of edges) {
      if (n !== 1) continue;
      boundary++;
      const [a, b] = id.split('|').map((s) => s.split(',').map(Number));
      const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 100;
      boundaryLen += len;
      worst = Math.max(worst, len);
    }
  });
  return { meshes, tris, boundary, boundaryLenM: +boundaryLen.toFixed(1), worstEdgeM: +worst.toFixed(2) };
};
`;

// The kerb-seam probe is EXTRACTED from the current main.ts rather than copied
// here, so the older build is measured with the very same code and the shim
// cannot drift from the probe it is standing in for. It reads only roadGrid,
// GRID, GRADE_SEP and state, all of which long predate any of this.
function probeSource(name) {
  const src = readFileSync(join(CELL, 'client/main.ts'), 'utf8');
  const head = src.indexOf(`(window as unknown as { ${name}?: object }).${name}`);
  if (head < 0) throw new Error(`no ${name} in main.ts`);
  const end = src.indexOf('\n};\n', head);
  return src.slice(head, end + 4);
}
const d = await openDrive({
  spot, tag: `shells${rev ? '-old' : ''}`, rev,
  shim: rev ? SHIM + probeSource('__kerbseams') : '',
});
if (to) {
  const [tlat, tlon] = to.split(',').map(Number);
  await d.page.waitForTimeout(8000);
  await walkTo(d.page, tlat, tlon);
}
await d.page.waitForTimeout(settle);
const which = arg('which', 'tunnel');
const out = await d.page.evaluate((w) => window.__shells(w), which);
console.log(rev ? `rev ${rev}` : 'working tree', JSON.stringify(out));
// The carriageway question also wants the mitre stretch, which is the price of
// building on the station instead of the bay.
if (which === 'ribbon') {
  // __span() exists on both builds, and on the old one it counts GORES — the
  // filler facets this change exists to remove. That is the before/after pair
  // here, because the ribbon tag itself is new and cannot be grafted onto an
  // older build after the fact.
  // The mitre stretch is the price of building on the station instead of the
  // bay: how far the drawn kerb runs outside the nominal half-width at the
  // sharpest corner in the world.
  const st = await d.page.evaluate(() => window.__span());
  const pct = st.mitreN ? ((100 * st.mitreWide) / st.mitreN).toFixed(1) : '?';
  console.log(`  mitre: worst ${(st.mitreMax ?? 1).toFixed(2)}x nominal half-width,`
    + ` ${st.mitreWide ?? '?'} of ${st.mitreN ?? '?'} stations past 1.2x (${pct}%)`);
  console.log(`  gores ${st.gores ?? '(gone)'}`);
  // A continuous strip of Q quads has exactly 2Q+2 boundary edges; a run of
  // separate pieces has more. Stating it here means the number is checked
  // rather than admired.
  if (out.meshes) {
    const quads = out.tris / 2, want = out.tris + 2 * out.meshes;
    console.log(`  strips: ${quads} quads in ${out.meshes} meshes -> boundary should be ${want}, is ${out.boundary}`
      + `${want === out.boundary ? '  (continuous)' : '  (GAPS)'}`);
  }
  // Continuity WITHIN a way says nothing about the join between two of them,
  // and a mountain road is mostly joins.
  const seams = await d.page.evaluate(() => window.__kerbseams());
  console.log(`  kerb seams at shared nodes: ${seams.joins} joins, median ${seams.medianM}m,`
    + ` p95 ${seams.p95M}m, over 10cm ${seams.over10cm}, worst ${seams.worstM}m`
    + ` at ${seams.worstAt} ${JSON.stringify(seams.worstWays)}`);
  // …and the CENTRELINE view of the same joins, which attributes each step to a
  // pair of ways and to the solver branch that produced each side.
  const cl = await d.page.evaluate(() => window.__seams());
  console.log(`  centreline seams: ${JSON.stringify(cl).slice(0, 900)}`);
}
report(d.errors);
await d.close();
