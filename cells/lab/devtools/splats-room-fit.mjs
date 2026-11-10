// The room taught from drawn views (node cells/lab/devtools/splats-room-fit.mjs [--scale=1]).
//
// The teachers: an image model's sparse sumi-e restyles of six underdrawings round the route (splats-room-targets.py).
// Three are taught from (the root tunnel, the open pool, the canopy); the three between them are reserved: never fitted
// to, only scored on. The room's marks stay where the scene put them (their spines aren't moved); what is taught is how
// they are drawn, at four levels of freedom, each through the renderer's forward model (render.ts, kind 12, with its
// hand-over, its letting go at the eye, and the room's solids hiding what's behind them: conservatory.ts `occluder`,
// tested a pixel at a time as the renderer's depth test does; the limbs' tubes follow the widths being taught):
// - **roles**: an offset to the parameters of every mark of one role (conservatory.ts `roleOf`: every arch, every plank,
//   every strand…): a style a role, a few hundred numbers for the whole room;
// - **+ each mark's weight**: three numbers a mark (a stroke's ink, width, dryness; a wash's tone and size);
// - **+ its deposits**: every deposit's own small residuals, within the bounds a mark keeps them to;
// - **deposits set free** (in place of the last): the same residuals with the bounds taken off (ink, sizes, turn, place
//   within a few spacings): as near to a fitted field as the room's deposits can get.
// The question is which of these carries along the route: each is scored on the views it was taught from and on the
// reserved ones. A mark not seen from a teaching view has only its role's style to go by; a deposit not seen has
// nothing.
//
// Writes devtools/out/room/fit.json (the scores), fit-<view>-<level>.png (the pictures, as darkness), taught-<level>.json,
// and static/splats/room-taught.json (roles and weights, for ?scene=room).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const SCALE = Number(arg('scale', 1));
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), { layout, axes, SP, KN, RESID, paramRange } = M;
const dir = new URL('./out/room/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const TEACH = JSON.parse(readFileSync(`${dir}teach.json`));
const W = 384, H = 256, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2));
const PAPER = [0.937, 0.906, 0.847], INK = [36, 31, 27], kappa = (c) => Math.max(...[0, 1, 2].map((k) => (PAPER[k] - c[k] / 255) / (PAPER[k] - 0.12)));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// ─── the room as the scene lays it, plain; its views ───
// (its limbs as the pool taught them, if that's been done: in parts by their width on the screen (splats-root2.mjs);
// they keep that style here: what's taught below is everything else)
const ROOT = (() => { try { return JSON.parse(readFileSync(new URL('../static/splats/root-parts.json', import.meta.url))).parts; } catch { return undefined; } })();
const room = C.conservatory({}, 'both', undefined, undefined, process.argv.includes('--tubes') ? undefined : ROOT), marks = room.marks, base = marks.map((m) => m.params.slice()), roles = marks.map((m) => m.role);
const start = []; { let o = 0; for (const m of marks) { start.push(o); o += m.count; } } const N = start[start.length - 1] + marks[marks.length - 1].count;
const views = Object.entries(room.views).map(([name, v]) => {
  const key = name.replace(/ /g, '-'), p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  return { name, key, teach: TEACH[key].teach, T: Float32Array.from(TEACH[key].D), cam: { E, f, r, u } };
});
console.log(`${marks.length} marks, ${N} deposits, ${new Set(roles).size} roles; taught from ${views.filter((v) => v.teach).map((v) => v.name).join(', ')}; reserved: ${views.filter((v) => !v.teach).map((v) => v.name).join(', ')}`);

// ─── what is taught: the roles' offsets, the marks' weights (their residuals are the marks' own) ───
const T = { roles: Object.fromEntries([...new Set(roles)].map((r) => [r, new Array(marks.find((m, i) => roles[i] === r).params.length).fill(0)])), gains: Object.fromEntries(marks.map((m) => [m.key, [0, 0, 0]])) };
if (new Set(marks.map((m) => m.key)).size !== marks.length || new Set(marks.map((m) => m.id)).size !== marks.length) throw new Error('two marks share a key or an id');
const apply = () => { marks.forEach((m, i) => (m.params = base[i].slice())); C.applyTaught(marks, T); };
const lay = () => { const occ = C.occluder(room); for (const v of views) v.zb = depthOf(occ, v.cam); return marks.map((m) => { const k = kappa(m.colour ?? INK); return layout(m).map((d) => ({ ...d, k, lod: m.lod ?? null })); }); };

// ─── the forward model, and the loss's slope in each deposit's own numbers ───
function footprint(d, cam, ax = axes(d)) {
  const q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.02) return null;
  const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z;
  const img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(ax[0], d.s1), e2 = img(ax[1], d.s2), e3 = img(ax[2], d.thin);
  const A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
  // (and, for a deposit that lies on a surface, its plane in the camera's frame: its depth under each pixel)
  const nx = dot(d.n, cam.r), ny = dot(d.n, cam.u), nz = dot(d.n, cam.f);
  return [sx, sy, Cc / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, Cc)), Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)), z, nx, ny, nz, nx * q[0] + ny * q[1] + nz * q[2]];
}
/** the solids' depth from a view, a pixel at a time */
function depthOf(tris, cam) {
  const zb = new Float32Array(W * H).fill(Infinity), toCam = (i) => { const d = [tris[i] - cam.E[0], tris[i + 1] - cam.E[1], tris[i + 2] - cam.E[2]]; return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)]; };
  for (let t = 0; t < tris.length; t += 9) {
    const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q[0][2] < 0.05 || q[1][2] < 0.05 || q[2][2] < 0.05) continue;
    const s = q.map((c) => [W / 2 + (fy * c[0]) / c[2], H / 2 - (fy * c[1]) / c[2]]);
    const x0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), y0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    // (1/z is what's linear across the screen)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * W + x]) zb[y * W + x] = z; }
  }
  return zb;
}
function nudge(d, j, eps) {
  if (j === 0) return { ...d, s1: d.s1 * Math.exp(eps) };
  if (j === 1) return { ...d, s2: d.s2 * Math.exp(eps), thin: d.thin > 0.002 ? d.thin * Math.exp(eps) : d.thin };
  if (j === 2) return { ...d, turn: d.turn + eps };
  const a = axes(d)[j - 3]; return { ...d, p: [d.p[0] + a[0] * eps, d.p[1] + a[1] * eps, d.p[2] + a[2] * eps] };
}
function differ(d, e) {
  const [x, y, n] = axes(d), x2 = axes(e)[0], dp = [e.p[0] - d.p[0], e.p[1] - d.p[1], e.p[2] - d.p[2]], c = cross(x, x2);
  return [e.logit - d.logit, Math.log(e.s1 / d.s1), Math.log(e.s2 / d.s2), Math.atan2(dot(c, n), dot(x, x2)), dot(dp, x), dot(dp, y)];
}
function blur(a, r) {
  const n = Math.ceil(r * 2.5), k = new Float32Array(2 * n + 1); let ks = 0; for (let i = -n; i <= n; i++) { k[i + n] = Math.exp(-0.5 * (i / r) ** 2); ks += k[i + n]; } for (let i = 0; i <= 2 * n; i++) k[i] /= ks;
  const o = new Float32Array(W * H), t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { let s = 0; for (let i = -n; i <= n; i++) { const xx = x + i; s += a[row + (xx < 0 ? 0 : xx >= W ? W - 1 : xx)] * k[i + n]; } t[row + x] = s; } }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -n; i <= n; i++) { const yy = y + i; s += t[(yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W + x] * k[i + n]; } o[y * W + x] = s; }
  return o;
}
/** a view of the room: darkness a pixel; with `g`, the loss's slope added into it (six numbers a deposit) */
function draw(v, D, g) {
  const cam = v.cam, logT = new Float32Array(W * H), fps = [], zb = v.zb;
  // (a deposit's depth under a pixel: its plane's where it lies on a surface, as the renderer gives it; else its own)
  const hidden = (e, surf, x, y, p) => { const z = e[7]; if (zb[p] === Infinity) return false; if (!surf) return z > zb[p]; const dn = e[8] * ((x + 0.5 - W / 2) / fy) - e[9] * ((y + 0.5 - H / 2) / fy) + e[10]; return (Math.abs(dn) > 0.05 ? Math.max(z - 0.5, Math.min(z + 0.5, e[11] / dn)) : z) > zb[p]; };
  D.forEach((ds, mi) => ds.forEach((d, i) => {
    // (what's under the water isn't drawn, as the renderer leaves it out)
    if (d.p[1] < C.WATER - 0.02) return;
    const e = footprint(d, cam); if (!e) return; const z = e[7];
    // (its hand-over by how large things look where it is, and its letting go at the eye, as the renderer's)
    let fac = d.lod ? Math.max(0, Math.min(1, (Math.log2(fy / (z * H)) - d.lod[0]) / (d.lod[1] - d.lod[0]))) : 1; if (fac <= 0) return; const t = Math.max(0, Math.min(1, (z - 0.25) / 0.45)); fac *= t * t * (3 - 2 * t);
    // (its ink from here: a deposit's own view terms and cap, if it has them)
    const a = M.inkOf(d, cam.E), sig = a / (d.cap ?? 1); if (a * fac < 0.004) return;
    const [sx, sy, ia, ib, ic, R, comp] = e; if (sx + R < 0 || sx - R > W || sy + R < 0 || sy - R > H) return;
    const al = a * fac * comp * d.k; if (al < 1 / 255) return;
    const box = [Math.max(0, Math.floor(sx - R)), Math.min(W - 1, Math.ceil(sx + R)), Math.max(0, Math.floor(sy - R)), Math.min(H - 1, Math.ceil(sy + R))];
    const surf = d.thin < 0.002;
    for (let y = box[2]; y <= box[3]; y++) for (let x = box[0]; x <= box[1]; x++) { const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255 || hidden(e, surf, x, y, y * W + x)) continue; logT[y * W + x] += Math.log(1 - Math.min(0.99, al * G)); }
    if (g) fps.push({ d, e, a, sig, fac, box, surf, at: (start[mi] + i) * 6 });
  }));
  const P = new Float32Array(W * H); for (let p = 0; p < W * H; p++) P[p] = 1 - Math.exp(logT[p]);
  if (!g) return { D: P };
  const e = new Float32Array(W * H); let loss = 0;
  for (let p = 0; p < W * H; p++) { const x = P[p] - v.T[p]; e[p] = x * (v.T[p] < 0.02 && x > 0 ? 2 : 1); loss += e[p] * x; }
  const b1 = blur(blur(e, 3), 3), b2 = blur(blur(e, 8), 8); for (let p = 0; p < W * H; p++) e[p] += 2 * b1[p] + 2 * b2[p];
  for (const f of fps) {
    const [sx, sy, ia, ib, ic, , comp] = f.e, [x0, x1, y0, y1] = f.box, al = f.a * f.fac * comp * f.d.k;
    let ga = 0, gsx = 0, gsy = 0, gia = 0, gib = 0, gic = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x, dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255 || hidden(f.e, f.surf, x, y, p)) continue;
      const k = (2 * e[p] * Math.exp(logT[p])) / (1 - Math.min(0.99, al * G)), gG = k * al * G;
      ga += k * G; gsx += gG * (ia * dx + ib * dy); gsy += gG * (ib * dx + ic * dy); gia += gG * -0.5 * dx * dx; gib += gG * -dx * dy; gic += gG * -0.5 * dy * dy;
    }
    g[f.at] += ga * comp * f.d.k * f.fac * f.a * (1 - f.sig);
    // (and in the log of its cap, for a deposit whose ink has one: the most it lays whatever the view)
    if (g.cap) g.cap[f.at / 6] += ga * comp * f.d.k * f.fac * f.a;
    const gcomp = ga * f.a * f.fac * f.d.k;
    for (let j = 0; j < 5; j++) { const eps = j < 3 ? 1e-3 : 1e-4, e1 = footprint(nudge(f.d, j, eps), cam); if (e1) g[f.at + 1 + j] += ((e1[0] - sx) * gsx + (e1[1] - sy) * gsy + (e1[2] - ia) * gia + (e1[3] - ib) * gib + (e1[4] - ic) * gic + (e1[6] - comp) * gcomp) / eps; }
  }
  return { D: P, loss: loss / (W * H) };
}
const adam = (n) => ({ m: new Float64Array(n), v: new Float64Array(n), t: 0 });
function step(A, p, g, lr, lo, hi) { A.t++; for (let j = 0; j < p.length; j++) { if (!g[j]) continue; A.m[j] = 0.9 * A.m[j] + 0.1 * g[j]; A.v[j] = 0.999 * A.v[j] + 0.001 * g[j] * g[j]; p[j] -= (lr * (A.m[j] / (1 - 0.9 ** A.t))) / (Math.sqrt(A.v[j] / (1 - 0.999 ** A.t)) + 1e-8); if (lo) p[j] = Math.max(lo(j), Math.min(hi(j), p[j])); } }

// ─── teaching ───
const train = views.filter((v) => v.teach);
const FREE = (m) => (m.band ? [...Array(SP.width).keys()] : m.kind !== 'stroke' ? [...Array(10).keys()] : [...Array(SP.u0).keys(), SP.along, SP.dry, SP.dry + 1, SP.dry + 2, SP.dry + 3, SP.drySide, SP.spread, ...(m.name?.startsWith('canopy/dabs') ? [SP.splay, SP.step] : [])]);
const roleList = Object.keys(T.roles), roleMarks = Object.fromEntries(roleList.map((r) => [r, marks.map((_, i) => i).filter((i) => roles[i] === r)])), roleFree = Object.fromEntries(roleList.map((r) => [r, FREE(marks[roleMarks[r][0]])]));
const A = { roles: Object.fromEntries(roleList.map((r) => [r, adam(roleFree[r].length)])), gains: adam(marks.length * 3), resid: adam(N * RESID) };
/** how the loss changes with a change made to one mark (`mut`, undone by `undo`): through its layout's own slope */
const slope = (mi, D, g, mut, undo, eps) => { const m = marks[mi]; mut(m); const d2 = layout(m); undo(m); let s = 0; const o = start[mi] * 6; for (let i = 0; i < m.count; i++) { if (!g[o + i * 6] && !g[o + i * 6 + 4] && !(g.cap && g.cap[start[mi] + i])) continue; const df = differ(D[mi][i], d2[i]); for (let k = 0; k < 6; k++) s += g[o + i * 6 + k] * df[k]; if (g.cap && D[mi][i].cap !== undefined) s += g.cap[start[mi] + i] * Math.log((d2[i].cap + 1e-6) / (D[mi][i].cap + 1e-6)); } return s / eps; };
function teach(stage, iters, bounds) {
  const g = new Float32Array(N * 6), t0 = Date.now(); g.cap = new Float32Array(N);
  for (let it = 0; it < iters; it++) {
    apply(); const D = lay(); g.fill(0); g.cap.fill(0); let L = 0; for (const v of train) L += draw(v, D, g).loss;
    const seen = marks.map((m, mi) => { const o = start[mi] * 6; for (let i = 0; i < m.count * 6; i++) if (g[o + i]) return true; return false; }), pace = 1 - 0.6 * (it / iters);
    if (stage === 'roles' || stage === 'weights') for (const r of roleList) {
      const F = roleFree[r], gr = F.map((j) => roleMarks[r].reduce((s, mi) => s + (seen[mi] ? slope(mi, D, g, (m) => (m.params[j] += 1e-3), (m) => (m.params[j] -= 1e-3), 1e-3) : 0), 0));
      const p = F.map((j) => T.roles[r][j]); step(A.roles[r], p, gr, 0.04 * pace, () => -6, () => 6); F.forEach((j, k) => (T.roles[r][j] = p[k]));
    }
    if (stage === 'weights') {
      const gg = new Float64Array(marks.length * 3), p = new Float64Array(marks.length * 3);
      marks.forEach((m, mi) => {
        if (!seen[mi]) return; const st = m.kind === 'stroke', groups = m.band ? [[0, SP.width]] : st ? [[0, SP.width], [SP.width, SP.u0], [SP.dry, SP.drySide]] : [[0, 9], [9, 10]];
        groups.forEach(([a, b], k) => { gg[mi * 3 + k] = slope(mi, D, g, (q) => { for (let j = a; j < b; j++) q.params[j] += 1e-3; }, (q) => { for (let j = a; j < b; j++) q.params[j] -= 1e-3; }, 1e-3) + 0.002 * T.gains[m.key][k]; });
        for (let k = 0; k < 3; k++) p[mi * 3 + k] = T.gains[m.key][k];
      });
      step(A.gains, p, gg, 0.04 * pace, () => -3, () => 3); marks.forEach((m, mi) => { for (let k = 0; k < 3; k++) T.gains[m.key][k] = p[mi * 3 + k]; });
    }
    if (stage === 'deposits' || stage === 'free') {
      const gr = new Float64Array(N * RESID);
      marks.forEach((m, mi) => {
        if (!seen[mi]) return; const o = start[mi];
        for (let k = 0; k < RESID; k++) { for (let i = 0; i < m.count; i++) m.resid[i * RESID + k] += 1e-3; const d2 = layout(m); for (let i = 0; i < m.count; i++) m.resid[i * RESID + k] -= 1e-3; for (let i = 0; i < m.count; i++) { if (!g[(o + i) * 6] && !g[(o + i) * 6 + 4]) continue; const df = differ(D[mi][i], d2[i]); let s = 0; for (let q = 0; q < 6; q++) s += g[(o + i) * 6 + q] * df[q]; gr[(o + i) * RESID + k] = s / 1e-3 + 2e-4 * m.resid[i * RESID + k]; } }
      });
      const p = new Float64Array(N * RESID); marks.forEach((m, mi) => p.set(m.resid, start[mi] * RESID));
      step(A.resid, p, gr, 0.03 * pace, (j) => -bounds[j % RESID], (j) => bounds[j % RESID]);
      marks.forEach((m, mi) => { for (let i = 0; i < m.count * RESID; i++) m.resid[i] = p[start[mi] * RESID + i]; });
    }
    if (it % 10 === 0 || it === iters - 1) console.log(`  ${stage} ${it}: loss ${((L / train.length) * 1000).toFixed(2)}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}

// ─── scoring: every view, taught from or reserved ───
function measure(v, D) {
  const n = W * H; let tone = 0; for (const r of [1, 2.5, 5]) { const a = blur(D, r), b = blur(v.T, r); let s = 0; for (let p = 0; p < n; p++) s += (a[p] - b[p]) ** 2; tone += s / n / 3; }
  const tb = blur(v.T, 1.5); let bare = 0, nb = 0; for (let p = 0; p < n; p++) if (tb[p] < 0.02) { bare += D[p]; nb++; }
  return { tone: +(tone * 1000).toFixed(2), bare: +((bare / Math.max(1, nb)) * 1000).toFixed(1), ink: +(D.reduce((a, x) => a + x, 0) / v.T.reduce((a, x) => a + x, 1e-9)).toFixed(2) };
}
function png(D, name) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const d = Math.max(0, Math.min(1, D[y * W + x])); for (let k = 0; k < 3; k++) raw[y * (W * 3 + 1) + 1 + x * 3 + k] = Math.round(255 * (PAPER[k] - (PAPER[k] - 0.12) * d)); } }
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); let c = ~0; for (let i = 4; i < 8 + d.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } b.writeUInt32BE(~c >>> 0, 8 + d.length); return b; };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(W, 0); hd.writeUInt32BE(H, 4); hd[8] = 8; hd[9] = 2;
  writeFileSync(`${dir}${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const report = { views: views.map((v) => ({ name: v.name, teach: v.teach })), levels: {} };
function score(level, D = (apply(), lay())) {
  const per = {}; for (const v of views) { const P = draw(v, D).D; per[v.name] = measure(v, P); png(P, `fit-${v.key}-${level}`); }
  const mean = (teach, k) => { const vs = views.filter((v) => v.teach === teach); return +(vs.reduce((s, v) => s + per[v.name][k], 0) / vs.length).toFixed(2); };
  report.levels[level] = { per, taught: { tone: mean(true, 'tone'), bare: mean(true, 'bare'), ink: mean(true, 'ink') }, reserved: { tone: mean(false, 'tone'), bare: mean(false, 'bare'), ink: mean(false, 'ink') } };
  console.log(`${level.padEnd(22)} taught from: tone ${String(mean(true, 'tone')).padStart(6)}  bare ${String(mean(true, 'bare')).padStart(6)}  ink ×${mean(true, 'ink')}   reserved: tone ${String(mean(false, 'tone')).padStart(6)}  bare ${String(mean(false, 'bare')).padStart(6)}  ink ×${mean(false, 'ink')}`);
  writeFileSync(`${dir}fit.json`, JSON.stringify(report, null, 1));
}
const r3 = (v) => +v.toFixed(3);
// (kept by role and by each mark's key; a mark with no weight of its own left out)
const kept = () => ({ roles: Object.fromEntries(Object.entries(T.roles).map(([k, a]) => [k, a.map(r3)])), gains: Object.fromEntries(Object.entries(T.gains).filter(([, g]) => g.some((x) => Math.abs(x) > 5e-4)).map(([k, g]) => [k, g.map(r3)])) });
const save = (level, resid) => writeFileSync(`${dir}taught-${level.replace(/[^a-z]+/g, '-')}.json`, JSON.stringify({ ...kept(), ...(resid ? { resid: Object.fromEntries(marks.filter((m) => m.resid.some((x) => x)).map((m) => [m.key, m.resid.map((x) => +x.toFixed(2))])) } : {}) }));

for (const v of views) png(v.T, `fit-${v.key}-teacher`);
// (nothing drawn at all, for scale; then the room as the scene lays it)
{ const blank = new Float32Array(W * H), per = {}; for (const v of views) per[v.name] = measure(v, blank); const mean = (t) => { const vs = views.filter((v) => v.teach === t); return +(vs.reduce((s, v) => s + per[v.name].tone, 0) / vs.length).toFixed(2); }; report.blank = { taught: mean(true), reserved: mean(false) }; console.log(`blank paper             taught from: tone ${mean(true)}   reserved: tone ${mean(false)}`); }
score('untaught');
teach('roles', Math.round(60 * SCALE)); score('roles'); save('roles');
teach('weights', Math.round(50 * SCALE)); score('roles + weights'); save('roles + weights');
writeFileSync(new URL('../static/splats/room-taught.json', import.meta.url), JSON.stringify({ note: 'The room taught from three drawn views (the root tunnel, the open pool, the canopy): a style a role, and each mark\'s own weight, by its key (devtools/splats-room-fit.mjs).', ...kept() }));
if (!process.argv.includes('--all')) process.exit(0);
teach('deposits', Math.round(50 * SCALE), [2.5, 0.5, 0.5, 0.5, 0.6, 0.45]); score('+ deposits'); save('deposits', true);
// (set free instead: from the weights again, the bounds off)
marks.forEach((m) => m.resid.fill(0)); A.resid = adam(N * RESID);
teach('free', Math.round(60 * SCALE), [8, 1.5, 1.5, 1.5, 3, 3]); score('deposits set free'); save('free', true);
