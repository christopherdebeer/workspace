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
import { openDrive, report, walkTo } from './harness.mjs';

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
(window as unknown as { __shells?: object }).__shells = (): object => {
  let meshes = 0, tris = 0, boundary = 0, boundaryLen = 0, worst = 0;
  worldGroup.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !o.userData.tunnel) return;
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

const d = await openDrive({ spot, tag: `shells${rev ? '-old' : ''}`, rev, shim: rev ? SHIM : '' });
if (to) {
  const [tlat, tlon] = to.split(',').map(Number);
  await d.page.waitForTimeout(8000);
  await walkTo(d.page, tlat, tlon);
}
await d.page.waitForTimeout(settle);
const out = await d.page.evaluate(() => window.__shells());
console.log(rev ? `rev ${rev}` : 'working tree', JSON.stringify(out));
report(d.errors);
await d.close();
