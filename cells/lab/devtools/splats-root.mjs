// The root, taught from the pool (node cells/lab/devtools/splats-root.mjs [--iters=30] [--full]).
//
// The pool (splats-pool.mjs, .py) is every limb the teacher drew, straightened along the limb's own spine at the
// restyles' size: 45 strokes of 24 limbs, 12 of them seen from more than one view. Here a limb is laid as splats four
// ways, drawn through the renderer's forward model from the view each stroke was seen from (with the limb's own tube
// hiding its far side), straightened the same way, and compared with the teacher's stroke in that frame:
// - **as the room draws it now**: rows all round the tube, inked along its underside, as taught from the views
//   (static/splats/room-taught.json); nothing fitted here;
// - **round**: the same arrangement, fitted here as the others are;
// - **banded**: rows over an arc of the tube, each with a part by its place across it: a firm edge, a body, bristles
//   (marks.ts `band`);
// - **flat**: a ribbon in the upright plane through the limb, its rows finer at its edges.
// Each has the limb's own number of deposits (`--more`: banded with 2.5 times as many, too).
//
// How they're compared. Not place by place: along a limb the teacher's stroke wanders from the scene's spine by up to
// half the limb's width (a restyle keeps the composition, not each edge), so a profile matched across the limb's own
// frame rewards a pale hedge. (That was tried first: every way came out a grey band, error 88 to 110 against 125
// untaught.) What a restyle does teach is the stroke's own character, read in the stroke's own frame, which needs no
// correspondence: at each step along a strip the dark band is found (nearest the last step's), and from it:
// - **thick**: how thick the band is, in the limb's half-widths;
// - **body**: how dark it is inside;
// - **firm** and **feather**: how many pixels of the restyle its ink takes to fall at its lower edge and at its upper
//   (from four fifths of its darkness to one fifth);
// - **dry**: how much of its inside is left bare (under half its darkness);
// - **broken**: how much of the limb's length has no band at all;
// - **swell**, **wander**, **press**: how much it varies along itself: its thickness (the spread of the middle half
//   of its values over their median), its centre's wobble about its own drift (in half-widths, over about 150 px), its
//   darkness. A stroke that doesn't vary is a ribbon.
// The last three are a stroke's own pressure: in the model, each limb's own run of thick and thin, of side to side,
// and of ink along it, made from its key, with three amplitudes shared by all limbs.
// The teacher's strokes are read this way, and each way's drawing of the same limbs from the same views; a way's
// style (shared by all its limbs) is fitted so the medians of its strokes meet the medians of the teacher's, by drawing
// again with each number moved a little.
// Writes devtools/out/pool/root.json, strips of each way beside the teacher's (root-<k>.png), and
// static/splats/root-style.json (the banded style, for the room).
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const N_ITERS = Number(arg('iters', 24)), MORE = process.argv.includes('--more');
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts'), { layout, axes, SP, KN, BAND, paramRange } = M;
const dir = new URL('./out/pool/', import.meta.url).pathname;
const FOV = (55 * Math.PI) / 180, VN = 61, VR = 2.5, TEACH = ['tunnel', 'pool', 'canopy'];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// ─── the room's limbs (plain, and as taught), its views, the pool ───
const plain = C.conservatory({}), taughtRoom = C.conservatory({}, 'both', JSON.parse(readFileSync(new URL('../static/splats/room-taught.json', import.meta.url))));
const limbOf = (room, key) => room.marks.find((m) => m.key === key);
const cams = Object.fromEntries(Object.entries(plain.views).map(([name, v]) => { const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return [name.replace(/ /g, '-'), { E, f, r, u }]; }));
const bin = new Float32Array(readFileSync(`${dir}pool.bin`).buffer.slice(0)), meta = JSON.parse(readFileSync(`${dir}pool.json`));
/** a stroke of the pool at a scale (1: the restyle's size; 0.5: half): its stations and the teacher's strip */
function strip(m, S) {
  const n0 = m.length, o = m.at, st = Math.round(1 / S), n = Math.floor(n0 / st), g = (row, k) => bin[o + row * n0 + k], x = new Float32Array(n), y = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), hw = new Float32Array(n), T = new Float32Array(n * VN);
  for (let k = 0; k < n; k++) { const a = k * st + Math.floor(st / 2); x[k] = g(0, a) * S; y[k] = g(1, a) * S; nx[k] = g(2, a); ny[k] = g(3, a); hw[k] = g(4, a) * S; for (let v = 0; v < VN; v++) { let s = 0; for (let j = 0; j < st; j++) s += bin[o + 5 * n0 + (k * st + j) * VN + v]; T[k * VN + v] = s / st; } }
  // (turned so the side that's up on the screen is +v for every stroke)
  return { ...m, n, x, y, nx, ny, hw, T, flip: g(0, n0 - 1) > g(0, 0), teach: TEACH.includes(m.view), S };
}

// ─── drawing a limb from a view, into a stroke's frame ───
function footprint(d, cam, fy, W, H, ax = axes(d)) {
  const q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.05) return null;
  const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z, img = (a, s) => { const ar = dot(a, cam.r), au = dot(a, cam.u), af = dot(a, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
  const e1 = img(ax[0], d.s1), e2 = img(ax[1], d.s2), e3 = img(ax[2], d.thin), A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
  const nx = dot(d.n, cam.r), ny = dot(d.n, cam.u), nz = dot(d.n, cam.f);
  return [sx, sy, Cc / det, -B / det, A / det, 3 * Math.sqrt(Math.max(A, Cc)), Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)), z, nx, ny, nz, nx * q[0] + ny * q[1] + nz * q[2]];
}
/** a mark drawn from a stroke's view at its scale, within the stroke's box; its own tube (if it has one) hiding its
 * far side; then straightened along the stroke's stations: a strip like the teacher's */
function drawn(mark, st) {
  const cam = cams[st.view], S = st.S, W = 1536 * S, H = 1024 * S, fy = H / (2 * Math.tan(FOV / 2));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (let k = 0; k < st.n; k++) { const r = st.hw[k] * 3; x0 = Math.min(x0, st.x[k] - r); x1 = Math.max(x1, st.x[k] + r); y0 = Math.min(y0, st.y[k] - r); y1 = Math.max(y1, st.y[k] + r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1)); const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const logT = new Float32Array(cw * ch), zb = new Float32Array(cw * ch).fill(Infinity);
  if (mark.normal === 'tube') {
    const tris = C.occluder({ marks: [mark], solids: [] }), toCam = (i) => { const d = [tris[i] - cam.E[0], tris[i + 1] - cam.E[1], tris[i + 2] - cam.E[2]]; return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)]; };
    for (let t = 0; t < tris.length; t += 9) {
      const q = [toCam(t), toCam(t + 3), toCam(t + 6)]; if (q[0][2] < 0.05 || q[1][2] < 0.05 || q[2][2] < 0.05) continue;
      const s = q.map((c) => [W / 2 + (fy * c[0]) / c[2] - x0, H / 2 - (fy * c[1]) / c[2] - y0]), a0 = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0]))), a1 = Math.min(cw - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0]))), b0 = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1]))), b1 = Math.min(ch - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
      const den = (s[1][1] - s[2][1]) * (s[0][0] - s[2][0]) + (s[2][0] - s[1][0]) * (s[0][1] - s[2][1]); if (Math.abs(den) < 1e-9) continue;
      for (let y = b0; y <= b1; y++) for (let x = a0; x <= a1; x++) { const px = x + 0.5, py = y + 0.5, a = ((s[1][1] - s[2][1]) * (px - s[2][0]) + (s[2][0] - s[1][0]) * (py - s[2][1])) / den, b = ((s[2][1] - s[0][1]) * (px - s[2][0]) + (s[0][0] - s[2][0]) * (py - s[2][1])) / den, c = 1 - a - b; if (a < 0 || b < 0 || c < 0) continue; const z = 1 / (a / q[0][2] + b / q[1][2] + c / q[2][2]); if (z < zb[y * cw + x]) zb[y * cw + x] = z; }
    }
  }
  for (const d of layout(mark)) {
    const a = 1 / (1 + Math.exp(-d.logit)); if (a < 0.004) continue;
    const e = footprint(d, cam, fy, W, H); if (!e) continue; const [sx, sy, ia, ib, ic, R, comp, z] = e; if (sx + R < x0 || sx - R > x1 || sy + R < y0 || sy - R > y1) continue;
    const al = a * comp; if (al < 1 / 255) continue; const surf = d.thin < 0.002;
    for (let y = Math.max(y0, Math.floor(sy - R)); y <= Math.min(y1, Math.ceil(sy + R)); y++) for (let x = Math.max(x0, Math.floor(sx - R)); x <= Math.min(x1, Math.ceil(sx + R)); x++) {
      const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255) continue;
      const p = (y - y0) * cw + (x - x0);
      if (zb[p] !== Infinity) { const dn = e[8] * ((x + 0.5 - W / 2) / fy) - e[9] * ((y + 0.5 - H / 2) / fy) + e[10]; if ((surf && Math.abs(dn) > 0.05 ? Math.max(z - 0.5, Math.min(z + 0.5, e[11] / dn)) : z) > zb[p]) continue; }
      logT[p] += Math.log(1 - Math.min(0.99, al * G));
    }
  }
  const out = new Float32Array(st.n * VN), at = (i, j) => (i >= 0 && i < cw && j >= 0 && j < ch ? 1 - Math.exp(logT[j * cw + i]) : 0);
  for (let k = 0; k < st.n; k++) for (let v = 0; v < VN; v++) { const t = (v / (VN - 1)) * 2 * VR - VR, X = st.x[k] + st.nx[k] * t * st.hw[k] - 0.5 - x0, Y = st.y[k] + st.ny[k] * t * st.hw[k] - 0.5 - y0, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy2 = Y - j; out[k * VN + v] = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy2) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy2; }
  return out;
}

// ─── a stroke read in its own frame ───
const median = (a) => { const b = Float32Array.from(a).sort(); return b[b.length >> 1]; };
/** a strip read in its own stroke's frame: at each step the dark band nearest the last step's; medians of what it is */
function read(st, A) {
  const n = st.n, dv = (2 * VR) / (VN - 1), at = (k, v) => A[k * VN + (st.flip ? VN - 1 - v : v)], sm = new Float32Array(VN), acc = { thick: [], body: [], firm: [], feather: [], dry: [], centre: [] };
  let last = -1, none = 0, steps = 0, hwm = 0; for (let k = 0; k < n; k++) hwm += st.hw[k] / n; const px = (dv * hwm) / st.S, R = Math.max(1, Math.round(3 * st.S));
  for (let k = R; k < n - R; k += Math.max(1, Math.round(4 * st.S))) {
    steps++; for (let v = 0; v < VN; v++) { let s = 0; for (let j = -R; j <= R; j++) s += at(k + j, v); sm[v] = s / (2 * R + 1); }
    // (the band: the darkest place within reach of the last one; none if it's all pale there)
    let i = -1; const lo0 = last < 0 ? 6 : Math.max(2, last - 10), hi0 = last < 0 ? VN - 7 : Math.min(VN - 3, last + 10); for (let v = lo0; v <= hi0; v++) if (i < 0 || sm[v] > sm[i]) i = v;
    const peak = sm[i]; if (peak < 0.22) { none++; continue; }
    let a = i, b = i; while (a > 0 && sm[a] > 0.5 * peak) a--; while (b < VN - 1 && sm[b] > 0.5 * peak) b++;
    const cross = (from, dir, lvl) => { let v = from; while (v > 0 && v < VN - 1 && sm[v] > lvl * peak) v += dir; const p0 = sm[v - dir], p1 = sm[v]; return v - dir * ((lvl * peak - p1) / Math.max(1e-6, p0 - p1)); };
    last = Math.round((a + b) / 2);
    let body = 0, dry = 0, c = 0; for (let v = a + 1; v < b; v++) { body += sm[v]; c++; } if (!c) continue; body /= c;
    for (let v = a + 1; v < b; v++) if (at(k, v) < 0.5 * body) dry++;
    // (v runs up: its lower edge is the firm one of a limb inked beneath; its upper the feathered one)
    acc.thick.push((b - a) * dv); acc.body.push(body); acc.firm.push(Math.abs(cross(i, -1, 0.2) - cross(i, -1, 0.8)) * px); acc.feather.push(Math.abs(cross(i, 1, 0.2) - cross(i, 1, 0.8)) * px); acc.dry.push(dry / c); acc.centre.push(((a + b) / 2) * dv - VR);
  }
  const out = { broken: none / Math.max(1, steps) }; for (const [k, a] of Object.entries(acc)) out[k] = a.length ? median(a) : NaN;
  // (how it varies along itself)
  const spread = (a) => { if (a.length < 8) return NaN; const b = Float32Array.from(a).sort(); return (b[Math.floor(b.length * 0.75)] - b[Math.floor(b.length * 0.25)]) / Math.max(1e-6, b[b.length >> 1]); };
  out.swell = spread(acc.thick); out.press = spread(acc.body);
  { const c = acc.centre, w = Math.max(3, Math.round(18 / Math.max(1, Math.round(4 * st.S)) * st.S * 2)), d = []; for (let i = 0; i < c.length; i++) { const seg = c.slice(Math.max(0, i - w), Math.min(c.length, i + w + 1)); d.push(Math.abs(c[i] - median(seg))); } out.wander = d.length >= 8 ? 1.48 * median(d) : NaN; }
  return out;
}
const WHAT = ['thick', 'body', 'firm', 'feather', 'dry', 'broken', 'swell', 'wander', 'press'], UNIT = { thick: 0.3, body: 0.15, firm: 3, feather: 4, dry: 0.1, broken: 0.1, swell: 0.12, wander: 0.04, press: 0.08 };
/** the medians of what a set of strips is */
const pooled = (rs) => Object.fromEntries(WHAT.map((k) => { const a = rs.map((r) => r[k]).filter(Number.isFinite).sort((p, q) => p - q); return [k, a.length ? a[a.length >> 1] : NaN]; }));
const apart = (a, b) => WHAT.reduce((s, k) => s + (Number.isFinite(a[k]) ? ((a[k] - b[k]) / UNIT[k]) ** 2 : 9), 0);

// ─── the four ways ───
/** a limb laid one way, with a shared style and its own pressure */
function limb(key, way, style, press, more = 1) {
  const src = limbOf(way === 'now' ? taughtRoom : plain, key), m = { ...src, params: src.params.slice(), resid: src.resid };
  if (way === 'now') return m;
  if (more !== 1) { m.rows = Math.round(m.rows * Math.sqrt(more) / 2) * 2; m.count = m.rows * Math.round((src.count / src.rows) * Math.sqrt(more)); m.resid = new Array(m.count * M.RESID).fill(0); }
  const P = m.params, set = (j, v) => { const [lo, hi] = paramRange(m, j); P[j] = Math.max(lo, Math.min(hi, v)); };
  // (its own pressure: a run of thick and thin, of side to side and of ink along it, the same every time for the same
  // limb; how much of each is the style's)
  const xi = (k, salt) => { let h = (Math.imul(src.id | 0, 374761393) + Math.imul(k + 1, 668265263) + Math.imul(salt, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1; };
  for (let k = 0; k < KN.ink; k++) set(SP.ink + k, style.ink + (press?.ink ?? 0) + (style.vink ?? 0) * 3 * xi(k, 1)); for (let k = 0; k < KN.dry; k++) set(SP.dry + k, style.dry);
  if (way !== 'flat') { for (let k = 0; k < KN.width; k++) set(SP.width + k, src.params[SP.width + k] + (style.vwide ?? 0) * xi(k, 2)); for (let k = 0; k < KN.offset; k++) set(SP.offset + k, (style.voff ?? 0) * xi(k, 3)); }
  set(SP.along, style.along); set(SP.spread, style.spread);
  if (way === 'band') { m.band = true; m.shade = 0; set(SP.arc, style.arc + (press?.wide ?? 0)); set(SP.fine, style.fine); set(SP.feather, style.feather); set(SP.fall, style.fall); set(SP.bristle, style.bristle); }
  else if (way === 'round') { m.shade = style.shade; set(SP.drySide, style.side); }
  else {
    // (a ribbon in the upright plane through the limb, a little narrower than the limb is round; its firm side down)
    const a = src.ctrl[0], b = src.ctrl[src.ctrl.length - 1], ch = norm([b[0] - a[0], 0, b[2] - a[2]]), n = Math.hypot(b[0] - a[0], b[2] - a[2]) < 0.3 ? [1, 0, 0] : [-ch[2], 0, ch[0]];
    m.normal = n; m.shade = 0; set(SP.crisp, style.fine); set(SP.drySide, style.side); for (let k = 0; k < KN.width; k++) set(SP.width + k, src.params[SP.width + k] + style.wide + (press?.wide ?? 0)); for (let k = 0; k < KN.offset; k++) set(SP.offset + k, style.off);
  }
  return m;
}
const START = {
  round: { ink: 0.9, dry: 0.8, along: 0, spread: 0, shade: 0.8, side: 0, vink: 0.1, vwide: 0.1, voff: 0.1 },
  band: { ink: 1.6, dry: 0.5, along: 0, spread: 0, arc: BAND.arc, fine: BAND.fine, feather: BAND.feather, fall: BAND.fall, bristle: BAND.bristle, vink: 0.1, vwide: 0.1, voff: 0.1 },
  flat: { ink: 1.6, dry: 0.5, along: 0, spread: 0, fine: 1, side: 0.6, wide: -0.3, off: 0 },
};
const RANGE = { ink: [-3, 5], dry: [0, 2.5], along: [-1.5, 1], spread: [-0.8, 0.8], shade: [0, 2], side: [-1, 1], arc: [-0.9, 0.5], fine: [0, 2.2], feather: [0.1, 0.95], fall: [0, 4], bristle: [0, 4], wide: [-1.2, 0.6], off: [-1, 1], vink: [0, 1], vwide: [0, 0.8], voff: [0, 1] };
const EPS = { ink: 0.15, dry: 0.12, along: 0.1, spread: 0.08, shade: 0.12, side: 0.12, arc: 0.08, fine: 0.15, feather: 0.05, fall: 0.25, bristle: 0.25, wide: 0.08, off: 0.06, vink: 0.06, vwide: 0.06, voff: 0.06 };
const HALF = meta.map((m) => strip(m, 0.5)), keys = [...new Set(meta.map((m) => m.key))], report = { strokes: meta.length, limbs: keys.length, ways: {} };
// (the teacher's strokes, read: at the size the fitting is done at, and at the restyles' own)
const WANT = pooled(HALF.filter((s) => s.teach).map((s) => read(s, s.T)));
function fit(way, more = 1) {
  const style = { ...START[way] }, train = HALF.filter((s) => s.teach).filter((_, i) => i % 2 === 0), t0 = Date.now(), ITERS = way === 'band' && more === 1 ? N_ITERS : Math.round(N_ITERS * 0.5);
  const total = () => apart(pooled(train.map((st) => read(st, drawn(limb(st.key, way, style, null, more), st)))), WANT);
  const adam = {}; const move = (k, g, lr) => { const A = (adam[k] ??= { m: 0, v: 0, t: 0 }); A.t++; A.m = 0.8 * A.m + 0.2 * g; A.v = 0.99 * A.v + 0.01 * g * g; const [lo, hi] = RANGE[k]; style[k] = Math.max(lo, Math.min(hi, style[k] - (lr * (A.m / (1 - 0.8 ** A.t))) / (Math.sqrt(A.v / (1 - 0.99 ** A.t)) + 1e-9))); };
  let best = { f: Infinity, style: null };
  for (let it = 0; it < ITERS; it++) {
    const f0 = total(); if (f0 < best.f) best = { f: f0, style: { ...style } };
    for (const k of Object.keys(style)) { const was = style[k]; style[k] = was + EPS[k]; const f1 = total(); style[k] = was; move(k, (f1 - f0) / EPS[k], EPS[k] * 0.8 * (1 - 0.5 * (it / ITERS))); }
    if (it % 5 === 0 || it === ITERS - 1) console.log(`  ${way}${more !== 1 ? ` ×${more}` : ''} ${it}: ${f0.toFixed(2)}  (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const f = total(); if (f < best.f) best = { f, style: { ...style } };
  return { style: best.style, press: {} };
}
/** every stroke scored at the restyle's own size */
function score(name, make) {
  const rows = meta.map((m) => { const st = strip(m, 1), mk = make(st.key), A = drawn(mk, st); return { st, A, r: read(st, A) }; });
  const dep = Math.round(keys.reduce((a, k) => a + make(k).count, 0) / keys.length), part = (teach) => { const p = pooled(rows.filter((x) => x.st.teach === teach).map((x) => x.r)); return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(k === 'firm' || k === 'feather' ? 1 : 2)])); };
  report.ways[name] = { deposits: dep, taught: part(true), reserved: part(false), apart: { taught: +apart(part(true), THEIRS.taught).toFixed(2), reserved: +apart(part(false), THEIRS.reserved).toFixed(2) } };
  const say = (p) => `thick ${p.thick} body ${p.body} firm ${p.firm} px feather ${p.feather} px dry ${p.dry} broken ${p.broken} swell ${p.swell} wander ${p.wander} press ${p.press}`;
  console.log(`${name.padEnd(30)} ${String(dep).padStart(5)} a limb | taught from: ${say(part(true))} (apart ${report.ways[name].apart.taught}) | reserved: ${say(part(false))} (apart ${report.ways[name].apart.reserved})`);
  writeFileSync(`${dir}root.json`, JSON.stringify(report, null, 1));
  return rows;
}
function png(st, strips, name) {
  // (the strips one above another, each turned so up is up, the stroke lying along the page)
  const n = st.n, w = n, h = VN * strips.length + 4 * (strips.length - 1), raw = Buffer.alloc((w * 3 + 1) * h, 250);
  strips.forEach((A, i) => { for (let v = 0; v < VN; v++) for (let k = 0; k < n; k++) { const d = Math.max(0, Math.min(1, A[k * VN + (st.flip ? v : VN - 1 - v)])), o = (i * (VN + 4) + v) * (w * 3 + 1) + 1 + k * 3; raw[o] = Math.round(255 * (0.937 - 0.817 * d)); raw[o + 1] = Math.round(255 * (0.906 - 0.786 * d)); raw[o + 2] = Math.round(255 * (0.847 - 0.727 * d)); } });
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); let c = ~0; for (let i = 4; i < 8 + d.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } b.writeUInt32BE(~c >>> 0, 8 + d.length); return b; };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(h, 4); hd[8] = 8; hd[9] = 2;
  writeFileSync(`${dir}${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

console.log(`${meta.length} strokes of ${keys.length} limbs; ${HALF.filter((s) => s.teach).length} from the views taught from, ${HALF.filter((s) => !s.teach).length} from the reserved ones`);
// (the teacher's own strokes, read at the restyles' size: what every way is measured against)
const FULL = meta.map((m) => strip(m, 1)), THEIRS = { taught: pooled(FULL.filter((s) => s.teach).map((s) => read(s, s.T))), reserved: pooled(FULL.filter((s) => !s.teach).map((s) => read(s, s.T))) };
report.teacher = THEIRS; { const say = (p) => WHAT.map((k) => `${k} ${p[k].toFixed(k === 'firm' || k === 'feather' ? 1 : 2)}${k === 'firm' || k === 'feather' ? ' px' : ''}`).join(' '); console.log(`${'the teacher'.padEnd(30)}       a limb | taught from: ${say(THEIRS.taught)} | reserved: ${say(THEIRS.reserved)}`); }
const out = {}; out.now = score('as the room draws it now', (k) => limb(k, 'now'));
const fits = {};
for (const way of ['round', 'band', 'flat']) { fits[way] = fit(way); out[way] = score({ round: 'round, fitted', band: 'banded', flat: 'flat' }[way], (k) => limb(k, way, fits[way].style, fits[way].press[k])); }
if (MORE) { fits.more = fit('band', 2.5); out.more = score('banded, 2.5 times the deposits', (k) => limb(k, 'band', fits.more.style, fits.more.press[k], 2.5)); }
report.styles = Object.fromEntries(Object.entries(fits).map(([k, f]) => [k, Object.fromEntries(Object.entries(f.style).map(([a, b]) => [a, +b.toFixed(3)]))]));
writeFileSync(`${dir}root.json`, JSON.stringify(report, null, 1));
writeFileSync(new URL('../static/splats/root-style.json', import.meta.url), JSON.stringify({ note: 'A limb as a banded stroke: the style shared by every limb, fitted so its strokes read as the teacher\'s do in their own frame (devtools/splats-root.mjs).', style: report.styles.band }));
// (the pictures: the eight longest strokes, the teacher's above each way's)
[...meta.keys()].sort((a, b) => meta[b].length - meta[a].length).slice(0, 8).forEach((k, i) => png(out.now[k].st, [out.now[k].st.T, out.now[k].A, out.round[k].A, out.band[k].A, out.flat[k].A, ...(MORE ? [out.more[k].A] : [])], `root-${i}`));
