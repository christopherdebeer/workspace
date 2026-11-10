// One limb's deposits, fitted (node cells/lab/devtools/splats-limb-fit.mjs [--iters=160]).
//
// The sweep (marks.ts `sweep`) is a gesture worked out and sampled into deposits: nothing in it is the deposits' own.
// Here they're given what a splat can have and a worked-out stroke can't: each one's own ink, place and size, fitted to
// a teacher's drawing; and deposits that lay nothing moved to where the drawing has ink the gesture hasn't.
// - **What's fitted to**: the teacher's restyles of two views this limb is in, from opposite sides of it (the tunnel,
//   close; back along the tunnel), at their own size, within the limb's width of its line on the picture. Its
//   drawings of the limb from three other views are kept to check on.
// - **What can move**: a deposit's ink (in its cap), its place across the limb's surface and along it, how long and
//   how wide it is. Each is held near the gesture: a penalty on its size, and a limit.
// - **Moved deposits** (marks.ts `homes`): every 20 rounds, deposits that lay no ink in either view are put where the
//   teacher is darkest against ours, free of the gesture's band and bristles (they lay ink wherever they sit, whatever
//   the view). At most three in ten of the limb's deposits are ever moved: the rest stay on the gesture's lattice.
// Drawn through the renderer's forward model (the limb's own tube hiding its far side), with the gradient of the
// squared error worked out a deposit at a time. Writes static/splats/limb-fitted.json and devtools/out/limb/fit.json.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const ITERS = Number(arg('iters', 160)), MOVED = Number(arg('moved', 0.3));
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), LB = await load('../client/splats/limb.ts'), { layout, axes, RESID } = M;
const dir = new URL('./out/limb/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const J = (f) => JSON.parse(readFileSync(new URL(`../static/splats/${f}`, import.meta.url), 'utf8'));
const W = 1536, H = 1024, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2)), FIT = ['tunnel', 'back-along-the-tunnel'], CHECK = ['canopy', 'between-canopy-and-tunnel', 'sideways-from-the-stones'];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); }, sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const room = C.conservatory({}), cams = Object.fromEntries(Object.entries(room.views).map(([name, v]) => { const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm(sub(v.at, E)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return [name.replace(/ /g, '-'), { E, f, r, u }]; }));
const sw = LB.limbMarks('sweep', J('root-parts.json').parts, J('limb-sweep.json'))[0], N = sw.count, rows = sw.rows, cols = Math.ceil(N / rows), S = M.spine(sw), w0 = sw.width;
// (its deposits' places as the sweep lays them: along, which bristle, not free)
sw.homes = new Array(N * 3).fill(0); for (let i = 0; i < N; i++) { const col = Math.floor(i / rows), row = i % rows; sw.homes[i * 3] = Math.max(0, Math.min(1, (col + 0.5 + (((row * 0.618) % 1) - 0.5) * 0.8) / cols)); sw.homes[i * 3 + 1] = row + 0.5; }
const proj = (cam, P) => { const q0 = sub(P, cam.E), z = dot(q0, cam.f); return [W / 2 + (fy * dot(q0, cam.r)) / z, H / 2 - (fy * dot(q0, cam.u)) / z, z]; };
// ─── a view: the teacher's darkness there, where the limb is on the picture, and what hides what ───
function view(name) {
  const cam = cams[name], T8 = new Uint8Array(readFileSync(`${dir}teacher-${name}.bin`)), st = S.pts.map((p, i) => { const [x, y, z] = proj(cam, p); return { x, y, z, u: S.cum[i] / S.L, hw: z > 0.2 ? (0.5 * w0 * fy) / z : 0, p }; }).filter((s) => s.z > 0.3);
  let x0 = W, x1 = 0, y0 = H, y1 = 0; for (const s of st) { const r = s.hw * 1.6 + 4; x0 = Math.min(x0, s.x - r); x1 = Math.max(x1, s.x + r); y0 = Math.min(y0, s.y - r); y1 = Math.max(y1, s.y + r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1)); const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // (within the limb's width of its line: each pixel's nearest station)
  const mask = new Uint8Array(cw * ch), near = new Int16Array(cw * ch).fill(-1), best = new Float32Array(cw * ch).fill(1e9);
  st.forEach((s, k) => { const r = s.hw * 1.15 + 1; for (let y = Math.max(y0, Math.floor(s.y - r)); y <= Math.min(y1, Math.ceil(s.y + r)); y++) for (let x = Math.max(x0, Math.floor(s.x - r)); x <= Math.min(x1, Math.ceil(s.x + r)); x++) { const d = Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y), p = (y - y0) * cw + (x - x0); if (d <= r && d < best[p]) { best[p] = d; near[p] = k; mask[p] = 1; } } });
  const T = new Float32Array(cw * ch); let n = 0; for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const p = y * cw + x; T[p] = T8[(y + y0) * W + x + x0] / 255; n += mask[p]; }
  const zb = new Float32Array(cw * ch).fill(Infinity), tris = C.occluder({ marks: [sw], solids: [] }), toCam = (i) => { const d = [tris[i] - cam.E[0], tris[i + 1] - cam.E[1], tris[i + 2] - cam.E[2]]; return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)]; };
  for (let t = 0; t < tris.length; t += 9) {
    const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q[0][2] < 0.05 || q[1][2] < 0.05 || q[2][2] < 0.05) continue;
    const s = q.map((c) => [W / 2 + (fy * c[0]) / c[2] - x0, H / 2 - (fy * c[1]) / c[2] - y0]), a0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), a1 = Math.min(cw - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), b0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), b1 = Math.min(ch - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
    for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * cw + x]) zb[y * cw + x] = z; }
  }
  return { name, cam, x0, y0, cw, ch, mask, near, T, zb, n, st };
}
// ─── the limb drawn in a view; with `grad`, how the squared error moves with each deposit's residuals ───
function draw(V, deps, grad) {
  const { cam, x0, y0, cw, ch, zb } = V, logT = new Float32Array(cw * ch), F = new Array(deps.length), x1 = x0 + cw - 1, y1 = y0 + ch - 1;
  const span = (f, each) => {
    for (let y = Math.max(y0, Math.floor(f.sy - f.R)); y <= Math.min(y1, Math.ceil(f.sy + f.R)); y++) {
      const dy = y + 0.5 - f.sy, disc = f.ib * dy * (f.ib * dy) - f.ia * (f.ic * dy * dy - 9.02); if (disc < 0) continue;
      const sq = Math.sqrt(disc), xa = f.sx + (-f.ib * dy - sq) / f.ia, xb = f.sx + (-f.ib * dy + sq) / f.ia;
      for (let x = Math.max(x0, Math.floor(xa - 0.5)); x <= Math.min(x1, Math.ceil(xb - 0.5)); x++) {
        const dx = x + 0.5 - f.sx, G = Math.exp(-0.5 * (f.ia * dx * dx + 2 * f.ib * dx * dy + f.ic * dy * dy)); if (G < 0.011 || f.al * G < 1 / 255) continue;
        const p = (y - y0) * cw + (x - x0);
        if (zb[p] !== Infinity) { const dn = f.nx * ((x + 0.5 - W / 2) / fy) - f.ny * ((y + 0.5 - H / 2) / fy) + f.nz; if ((Math.abs(dn) > 0.05 ? Math.max(f.z - 0.5, Math.min(f.z + 0.5, f.nq / dn)) : f.z) > zb[p]) continue; }
        each(p, G, dx, dy);
      }
    }
  };
  deps.forEach((d, i) => {
    const a = M.inkOf(d, cam.E); if (a < 0.002) return;
    const q0 = sub(d.p, cam.E), q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.05) return;
    const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z, img = (v, s) => { const ar = dot(v, cam.r), au = dot(v, cam.u), af = dot(v, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
    const ax = axes(d), e1 = img(ax[0], d.s1), e2 = img(ax[1], d.s2), e3 = img(ax[2], d.thin), A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
    const comp = Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)), al = a * comp, R = 3 * Math.sqrt(Math.max(A, Cc)); if (al < 1 / 255 || sx + R < x0 || sx - R > x1 || sy + R < y0 || sy - R > y1) return;
    const nx = dot(d.n, cam.r), ny = dot(d.n, cam.u), nz = dot(d.n, cam.f);
    const f = (F[i] = { sx, sy, ia: Cc / det, ib: -B / det, ic: A / det, R, al, z, nx, ny, nz, nq: nx * q[0] + ny * q[1] + nz * q[2], e1, e2, mR: img(d.n, w0), mA: img(d.t, S.L / cols), seen: 0 });
    span(f, (p, G) => { logT[p] += Math.log(1 - Math.min(0.99, f.al * G)); f.seen = Math.max(f.seen, f.al * G); });
  });
  const D = new Float32Array(cw * ch); let err = 0; for (let p = 0; p < D.length; p++) { D[p] = 1 - Math.exp(logT[p]); if (V.mask[p]) err += (D[p] - V.T[p]) ** 2; }
  if (grad) deps.forEach((d, i) => {
    const f = F[i]; if (!f) return; let gA = 0, gx = 0, gy = 0, g1 = 0, g2 = 0;
    span(f, (p, G, dx, dy) => { if (!V.mask[p]) return; const c = (2 * (D[p] - V.T[p]) * (1 - D[p])) / (1 - Math.min(0.99, f.al * G)) / V.n, sxd = f.ia * dx + f.ib * dy, syd = f.ib * dx + f.ic * dy, k = c * f.al * G; gA += c * G; gx += k * sxd; gy += k * syd; g1 += k * (f.e1[0] * sxd + f.e1[1] * syd) ** 2; g2 += k * (f.e2[0] * sxd + f.e2[1] * syd) ** 2; });
    const r = i * RESID; grad[r] += gA * f.al * ((d.dcap ?? 0) / Math.max(1e-6, d.cap ?? 1)); grad[r + 1] += g1; grad[r + 2] += g2; grad[r + 4] += gx * f.mR[0] + gy * f.mR[1]; grad[r + 5] += gx * f.mA[0] + gy * f.mA[1];
  });
  return { D, err: (1000 * err) / V.n, F };
}
const fit = FIT.map(view), check = CHECK.map(view), all = [...fit, ...check];
const score = () => { const deps = layout(sw); return Object.fromEntries(all.map((V) => [V.name, +draw(V, deps).err.toFixed(2)])); };
// (and bare paper: the error of drawing nothing at all)
const blank = Object.fromEntries(all.map((V) => { let e = 0; for (let p = 0; p < V.T.length; p++) if (V.mask[p]) e += V.T[p] ** 2; return [V.name, +((1000 * e) / V.n).toFixed(2)]; }));
console.log(`bare paper:          ${JSON.stringify(blank)}`);
const before = score(); console.log(`${N} deposits; the teacher's ink within the limb's width, squared error ×1000 a pixel\nthe sweep as laid:   ${JSON.stringify(before)}`);
// ─── fitting ───
const LIM = [4, 0.7, 0.7, 0, 0.12, 1.5], RATE = [0.2, 0.04, 0.04, 0, 0.012, 0.12], PEN = [0.0004, 0.004, 0.004, 0, 0.3, 0.002], am = new Float64Array(N * RESID), av = new Float64Array(N * RESID); let moved = 0; const t0 = Date.now();
for (let it = 0; it < ITERS; it++) {
  const deps = layout(sw), grad = new Float64Array(N * RESID); let err = 0; const drawn = fit.map((V) => { const o = draw(V, deps, grad); err += o.err; return o; });
  for (let j = 0; j < grad.length; j++) { const k = j % RESID; if (!RATE[k]) continue; const g = grad[j] * 1000 + PEN[k] * sw.resid[j]; am[j] = 0.9 * am[j] + 0.1 * g; av[j] = 0.99 * av[j] + 0.01 * g * g; sw.resid[j] = Math.max(-LIM[k], Math.min(LIM[k], sw.resid[j] - (RATE[k] * (am[j] / (1 - 0.9 ** (it + 1)))) / (Math.sqrt(av[j] / (1 - 0.99 ** (it + 1))) + 1e-8))); }
  // (deposits laying nothing in either view, moved to where the teacher is darkest against ours)
  if (it % 20 === 10 && it < ITERS - 30 && moved < MOVED * N) {
    const idle = []; for (let i = 0; i < N; i++) if (!sw.homes[i * 3 + 2] && drawn.every((o) => !o.F[i] || o.F[i].seen < 0.004)) idle.push(i);
    const want = []; fit.forEach((V, vi) => { const D = drawn[vi].D; for (let p = 0; p < D.length; p += 3) if (V.mask[p] && V.T[p] - D[p] > 0.25) want.push([V, p, V.T[p] - D[p]]); });
    const take = Math.min(idle.length, Math.round(0.06 * N), Math.round(MOVED * N) - moved, want.length); let seed = 12345 + it; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const tot = want.reduce((a, w) => a + w[2], 0);
    for (let k = 0; k < take; k++) {
      let r = rnd() * tot, w = want[0]; for (const q of want) { r -= q[2]; if (r <= 0) { w = q; break; } }
      const [V, p] = w, x = (p % V.cw) + V.x0 + 0.5, y = Math.floor(p / V.cw) + V.y0 + 0.5, s = V.st[V.near[p]]; if (!s) continue;
      // (the place on the limb's surface that pixel shows: along by its nearest station, round by how far across the limb it is)
      const i0 = S.pts.indexOf(s.p), t = norm(sub(S.pts[Math.min(S.pts.length - 1, i0 + 1)], S.pts[Math.max(0, i0 - 1)])), d = norm(sub(V.cam.E, s.p)), across = norm(cross(t, d)), toEye = norm(sub(d, t.map((v) => v * dot(d, t)))), a2 = proj(V.cam, [s.p[0] + across[0] * 0.5 * w0, s.p[1] + across[1] * 0.5 * w0, s.p[2] + across[2] * 0.5 * w0]);
      const ex = a2[0] - s.x, ey = a2[1] - s.y, sn = Math.max(-0.97, Math.min(0.97, ((x - s.x) * ex + (y - s.y) * ey) / Math.max(1e-6, ex * ex + ey * ey))), rad = across.map((v, j) => v * sn + toEye[j] * Math.sqrt(1 - sn * sn));
      const q = Math.abs(t[1]) < 0.95 ? t[1] : t[0], N0 = norm(sub(Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], t.map((v) => v * q))), B0 = cross(t, N0), th = Math.atan2(dot(rad, B0), dot(rad, N0)) - M.hash(sw.id, 3, 3) * 6.28;
      const i = idle[k], r0 = i * RESID; sw.homes[i * 3] = s.u + (rnd() - 0.5) / cols; sw.homes[i * 3 + 1] = ((((th / (2 * Math.PI)) * rows) % rows) + rows) % rows; sw.homes[i * 3 + 2] = 1;
      for (let j = 0; j < RESID; j++) { sw.resid[r0 + j] = 0; am[r0 + j] = 0; av[r0 + j] = 0; } sw.resid[r0 + 1] = -0.6; sw.resid[r0 + 2] = 0.4; moved++;
    }
    console.log(`  round ${it}: ${idle.length} deposits laying nothing, ${take} moved to where the teacher has ink ours hasn't (${moved} so far)`);
  }
  if (it % 20 === 0 || it === ITERS - 1) console.log(`  round ${it}: ${err.toFixed(2)} over the two views fitted to  (${Math.round((Date.now() - t0) / 1000)} s)`);
}
const after = score(); console.log(`fitted:              ${JSON.stringify(after)}`);
let big = 0; for (let j = 0; j < sw.resid.length; j++) if (Math.abs(sw.resid[j]) > 0.5 * (LIM[j % RESID] || 1)) big++;
writeFileSync(`${dir}fit.json`, JSON.stringify({ deposits: N, moved, blank, before, after, fit: FIT, check: CHECK }, null, 1));
writeFileSync(new URL('../static/splats/limb-fitted.json', import.meta.url), JSON.stringify({ note: 'The sweep\'s deposits for the root tunnel\'s third arch, fitted to the teacher\'s restyles of two views of it (devtools/splats-limb-fit.mjs): where each sits, and its own residuals.', count: N, homes: sw.homes.map((v) => +v.toFixed(4)), resid: sw.resid.map((v) => +v.toFixed(3)) }));
// ─── the same two drawings painted straight onto the limb's surface: the counterpart a surface has to fitted deposits ───
// (a texel for each place along the limb and round it: the teacher's darkness where that place shows in the drawing
// that sees it most squarely; none where neither sees it)
{ const RINGS = 1023, SEGS = 96, mesh = M.sweepMesh(LB.limbMarks('sweep', J('root-parts.json').parts, J('limb-sweep.json'))[0], RINGS, SEGS), tw = RINGS + 1, th = SEGS, data = new Uint8Array(4 + tw * th * 2); data[0] = tw & 255; data[1] = tw >> 8; data[2] = th & 255; data[3] = th >> 8; let painted = 0;
  const T8 = fit.map((V) => new Uint8Array(readFileSync(`${dir}teacher-${V.name}.bin`)));
  for (let a = 0; a <= RINGS; a++) for (let b = 0; b < SEGS; b++) {
    const o = (a * (SEGS + 1) + b) * 13, P = [mesh.verts[o], mesh.verts[o + 1], mesh.verts[o + 2]], n = [mesh.verts[o + 3], mesh.verts[o + 4], mesh.verts[o + 5]]; let best = 0.2, ink = -1;
    fit.forEach((V, vi) => { const d = norm(sub(V.cam.E, P)), nd = dot(n, d); if (nd <= best) return; const [x, y, z] = proj(V.cam, P); if (z < 0.3 || x < 1 || y < 1 || x > W - 2 || y > H - 2) return; const i = Math.floor(x - 0.5), j = Math.floor(y - 0.5), fx = x - 0.5 - i, fy2 = y - 0.5 - j, at = (ii, jj) => T8[vi][jj * W + ii]; best = nd; ink = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy2) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy2; });
    const q = 4 + (b * tw + a) * 2; if (ink >= 0) { data[q] = Math.round(Math.max(0, (ink - 13) / 242) * 255); data[q + 1] = 255; painted++; }
  }
  writeFileSync(new URL('../static/splats/limb-baked.bin', import.meta.url), data); console.log(`painted on the surface: ${tw} × ${th} texels, ${((100 * painted) / (tw * th)).toFixed(0)}% of them seen by one of the two drawings`); }
console.log(`${moved} of ${N} deposits moved (${((100 * moved) / N).toFixed(0)}%); ${big} residuals past half their limit`);
