// The room as geometry, for restyling (node cells/lab/devtools/splats-room-wires.mjs, then splats-room-wires.py).
//
// The first underdrawings sent for restyling were the room drawn in its own marks, and the teacher kept their choices
// (which side of a limb was inked, how soft a wash was). These carry none: the room's geometry as thin even lines,
// with what's hidden left out. From each view, at 1536 x 1024:
// - the solids (each limb's tube, the deck, the boardwalk, the stones): which solid is nearest at each pixel, and how
//   far (their outlines are where that changes: both edges of a limb alike);
// - every thin thing as the line it runs along, where a solid doesn't hide it and it's above the water: planks, edges,
//   posts, rails, strands, the veil, the far bridge, the house's ribs, the gesture's thread;
// - each leaf dab as a tick where it is; each seed as a dot; each wash or mist as the outline of its volume or face.
// Written to devtools/out/wires/<n>-<view>.json (lines) and .ids (the solids' ids, a byte a pixel).
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts');
const dir = new URL('./out/wires/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = 1536, H = 1024, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const room = C.conservatory({}), tubes = room.marks.filter((m) => m.normal === 'tube');
// (the solids, each with an id: the limbs' tubes 1…; then the level ones: a stone by its middle, the deck, the boardwalk)
const parts = tubes.map((m, i) => ({ id: i + 1, tris: C.occluder({ marks: [m], solids: [] }) }));
{ const S = room.solids, ids = new Map(), by = new Map(); for (let t = 0; t < S.length; t += 9) { const y = S[t + 1], k = Math.abs(y - 0.1) < 0.005 ? `stone ${S[t].toFixed(2)} ${S[t + 2].toFixed(2)}` : Math.abs(y - 0.33) < 1e-6 && S[t] >= 1.49 && S[t] <= 9.61 && S[t + 2] >= 4.84 ? 'deck' : 'walk'; if (!ids.has(k)) ids.set(k, 60 + ids.size); (by.get(k) ?? by.set(k, []).get(k)).push(...S.slice(t, t + 9)); } for (const [k, tr] of by) parts.push({ id: ids.get(k), tris: tr }); }
// (the views: the six the room is taught from and scored on, and two more for a reserved route: back along the tunnel,
// and sideways from the stones)
const at = (s) => { const p = C.routeAt(s).p; return [p[0], p[1] + C.EYE, p[2]]; };
const views = [...Object.entries(room.views).map(([name, v]) => ({ name: name.replace(/ /g, '-'), E: at(v.s), look: v.at })), { name: 'back-along-the-tunnel', E: at(3.3 / 14), look: [-8.2, 1.9, 3.4] }, { name: 'sideways-from-the-stones', E: at(6.6 / 14), look: [0.8, 2.6, 0.2] }];
const ORDER = ['tunnel', 'between-tunnel-and-pool', 'pool', 'between-pool-and-canopy', 'canopy', 'between-canopy-and-tunnel', 'back-along-the-tunnel', 'sideways-from-the-stones'];
for (const v of views) {
  const f = norm([v.look[0] - v.E[0], v.look[1] - v.E[1], v.look[2] - v.E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), E = v.E;
  const toCam = (P) => { const d = [P[0] - E[0], P[1] - E[1], P[2] - E[2]]; return [dot(d, r), dot(d, u), dot(d, f)]; }, px = (q) => [W / 2 + (fy * q[0]) / q[2], H / 2 - (fy * q[1]) / q[2]];
  const zb = new Float32Array(W * H).fill(Infinity), ids = new Uint8Array(W * H);
  for (const part of parts) for (let t = 0; t < part.tris.length; t += 9) {
    const P = [0, 3, 6].map((o) => [part.tris[t + o], part.tris[t + o + 1], part.tris[t + o + 2]]); if (P.every((p) => p[1] < C.WATER - 0.02)) continue;
    const q = P.map(toCam); if (q.some((c) => c[2] < 0.1)) continue; const s = q.map(px);
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const X = x + 0.5, Y = y + 0.5, a = ((s[1][1] - s[2][1]) * (X - s[2][0]) + (s[2][0] - s[1][0]) * (Y - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (X - s[2][0]) + (s[0][0] - s[2][0]) * (Y - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * W + x]) { zb[y * W + x] = z; ids[y * W + x] = part.id; } }
  }
  // (a line through points of the scene, cut where it's hidden, behind the eye, under the water or off the picture)
  const lines = [];
  const line = (pts, kind) => {
    let run = [];
    const flush = () => { if (run.length > 1) lines.push({ kind, pts: run.map((p) => [+p[0].toFixed(1), +p[1].toFixed(1)]) }); run = []; };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], qa = toCam(a), qb = toCam(b); if (qa[2] < 0.15 && qb[2] < 0.15) { flush(); continue; }
      const sa = qa[2] > 0.15 ? px(qa) : null, sb = qb[2] > 0.15 ? px(qb) : null, n = sa && sb ? Math.max(1, Math.ceil(Math.hypot(sb[0] - sa[0], sb[1] - sa[1]) / 2)) : 24;
      for (let k = 0; k <= n; k++) {
        const t = k / n, P = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], q = toCam(P);
        if (q[2] < 0.15 || P[1] < C.WATER - 0.01) { flush(); continue; }
        const s = px(q), x = Math.floor(s[0]), y = Math.floor(s[1]);
        if (x < 0 || x >= W || y < 0 || y >= H || q[2] > zb[y * W + x] + 0.03 + q[2] * 0.004) { flush(); continue; }
        if (!run.length || Math.hypot(s[0] - run[run.length - 1][0], s[1] - run[run.length - 1][1]) > 0.5) run.push(s);
      }
    }
    flush();
  };
  for (const m of room.marks) {
    if (m.normal === 'tube') continue;
    const role = m.role;
    if (m.kind === 'stroke') {
      if (role === 'dabs') { for (const d of M.layout(m)) { const ax = M.axes(d)[0], l = d.s1 * 1.6; line([[d.p[0] - ax[0] * l, d.p[1] - ax[1] * l, d.p[2] - ax[2] * l], [d.p[0] + ax[0] * l, d.p[1] + ax[1] * l, d.p[2] + ax[2] * l]], 'leaf'); } continue; }
      if (role === 'stone rim' || role === 'stone far' || role === 'waterline' || role === 'leaf') continue;
      if (m.key.startsWith('pool/gesture seed')) { const p = m.ctrl[1], q = toCam(p); if (q[2] > 0.15) { const s = px(q), x = Math.floor(s[0]), y = Math.floor(s[1]); if (x >= 0 && x < W && y >= 0 && y < H && q[2] <= zb[y * W + x] + 0.05) lines.push({ kind: 'dot', pts: [[+s[0].toFixed(1), +s[1].toFixed(1)]] }); } continue; }
      if (m.key.startsWith('pool/gesture hair')) continue;
      line(M.spine(m).pts, role === 'strand' ? 'strand' : role === 'plank' || role === 'edge' ? 'plank' : role === 'post' ? 'post' : role === 'veil' ? 'veil' : 'line');
    } else if (m.blob) {
      // (a volume: its outline as seen, an ellipse round its middle)
      const q = toCam(m.blob.c); if (q[2] < 0.5) continue; const pts = []; for (let k = 0; k <= 40; k++) { const a = (k / 40) * Math.PI * 2, rr = Math.hypot(m.blob.r[0], m.blob.r[2]) / Math.SQRT2; pts.push([m.blob.c[0] + r[0] * Math.cos(a) * rr + u[0] * Math.sin(a) * m.blob.r[1], m.blob.c[1] + r[1] * Math.cos(a) * rr + u[1] * Math.sin(a) * m.blob.r[1], m.blob.c[2] + r[2] * Math.cos(a) * rr + u[2] * Math.sin(a) * m.blob.r[1]]); }
      line(pts, 'wash');
    } else if (m.face && role === 'rag') { const F = m.face, pts = F.tris.map((t) => [F.o[0] + F.u[0] * t[2] + F.v[0] * t[3], F.o[1] + F.u[1] * t[2] + F.v[1] * t[3], F.o[2] + F.u[2] * t[2] + F.v[2] * t[3]]); line([...pts, pts[0]], 'line'); }
  }
  const n = ORDER.indexOf(v.name) + 1;
  writeFileSync(`${dir}${n}-${v.name}.json`, JSON.stringify({ w: W, h: H, lines })); writeFileSync(`${dir}${n}-${v.name}.ids`, ids);
  console.log(`${n}-${v.name}: ${lines.length} lines`);
}
