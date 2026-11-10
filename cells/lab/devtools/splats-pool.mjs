// The pool of teacher strokes, part one (node cells/lab/devtools/splats-pool.mjs): where each of the room's limbs
// (its tubes: trunk, crown, roots, arches) falls in each of the six restyled views, at the restyles' own size. For
// every limb and view: its spine projected (x, y in pixels), its half-width there in pixels, its depth, and whether a
// nearer limb or a solid hides it there. Written to devtools/out/pool/spines.json; splats-pool.py cuts the teacher's
// strokes out along them.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts');
const dir = new URL('./out/pool/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = 1536, H = 1024, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2)), ZW = 384, ZH = 256, zfy = ZH / (2 * Math.tan(FOV / 2));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const room = C.conservatory({}), tubes = room.marks.filter((m) => m.normal === 'tube'), out = [];
/** the depth of some solids from a view, at a quarter size */
function depthOf(tris, cam) {
  const zb = new Float32Array(ZW * ZH).fill(Infinity), toCam = (i) => { const d = [tris[i] - cam.E[0], tris[i + 1] - cam.E[1], tris[i + 2] - cam.E[2]]; return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)]; };
  for (let t = 0; t < tris.length; t += 9) {
    const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q[0][2] < 0.05 || q[1][2] < 0.05 || q[2][2] < 0.05) continue;
    const s = q.map((c) => [ZW / 2 + (zfy * c[0]) / c[2], ZH / 2 - (zfy * c[1]) / c[2]]);
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(ZW - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(ZH - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * ZW + x]) zb[y * ZW + x] = z; }
  }
  return zb;
}
for (const [name, v] of Object.entries(room.views)) {
  const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), cam = { E, f, r, u };
  for (const m of tubes) {
    // (what could hide it: every solid but its own tube)
    const others = C.occluder({ ...room, marks: room.marks.filter((o) => o !== m) }), zb = depthOf(others, cam), S = M.spine(m), w0 = m.width, N = 240, pts = [];
    for (let k = 0; k < N; k++) {
      const s = ((k + 0.5) / N) * S.L; let i = 0; while (i < S.pts.length - 2 && S.cum[i + 1] < s) i++;
      const t = (s - S.cum[i]) / Math.max(1e-9, S.cum[i + 1] - S.cum[i]), P = [0, 1, 2].map((a) => S.pts[i][a] + (S.pts[i + 1][a] - S.pts[i][a]) * t), q0 = [P[0] - E[0], P[1] - E[1], P[2] - E[2]], q = [dot(q0, r), dot(q0, u), dot(q0, f)];
      if (q[2] < 0.3) { pts.push(null); continue; }
      const x = W / 2 + (fy * q[0]) / q[2], y = H / 2 - (fy * q[1]) / q[2], hw = (0.5 * w0 * Math.exp(M.knots(m.params, M.SP.width, M.KN.width, s / S.L)) * fy) / q[2];
      const zx = Math.floor((x / W) * ZW), zy = Math.floor((y / H) * ZH), hid = zx >= 0 && zx < ZW && zy >= 0 && zy < ZH ? q[2] > zb[zy * ZW + zx] + 0.05 : false;
      pts.push([+x.toFixed(1), +y.toFixed(1), +hw.toFixed(2), +q[2].toFixed(2), hid ? 1 : 0]);
    }
    out.push({ view: name.replace(/ /g, '-'), key: m.key, role: m.role, pts });
  }
}
writeFileSync(`${dir}spines.json`, JSON.stringify(out));
console.log(`${tubes.length} limbs in ${Object.keys(room.views).length} views: ${out.length} projections`);
