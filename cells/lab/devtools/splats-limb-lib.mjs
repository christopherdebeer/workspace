// Reading a stroke along itself: shared by splats-limb.mjs (the teacher's strokes, and limbs drawn through the fitter's
// forward model) and splats-limb-read.mjs (limbs drawn by the real renderer). See splats-limb.mjs for what each
// reading is.
import { readFileSync } from 'node:fs';
export const VN = 61, VR = 2.5, TEACH = ['tunnel', 'pool', 'canopy'];
/** the pool of the teacher's strokes (devtools/out/pool): each stroke's record, and its strip at a scale */
export function pool(dir) {
  const bin = new Float32Array(readFileSync(`${dir}pool.bin`).buffer.slice(0)), meta = JSON.parse(readFileSync(`${dir}pool.json`));
  function strip(m, S) {
    const n0 = m.length, o = m.at, st = Math.round(1 / S), n = Math.floor(n0 / st), g = (row, k) => bin[o + row * n0 + k], x = new Float32Array(n), y = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), hw = new Float32Array(n), T = new Float32Array(n * VN);
    for (let k = 0; k < n; k++) { const a = k * st + Math.floor(st / 2); x[k] = g(0, a) * S; y[k] = g(1, a) * S; nx[k] = g(2, a); ny[k] = g(3, a); hw[k] = g(4, a) * S; for (let v = 0; v < VN; v++) { let s = 0; for (let j = 0; j < st; j++) s += bin[o + 5 * n0 + (k * st + j) * VN + v]; T[k * VN + v] = s / st; } }
    return { ...m, n, x, y, nx, ny, hw, T, flip: g(0, n0 - 1) > g(0, 0), teach: TEACH.includes(m.view), S };
  }
  return { meta, strip };
}
// ─── a stroke patch read along itself ───
export const med = (a) => { if (!a.length) return NaN; const b = Float64Array.from(a).sort(); return b[b.length >> 1]; };
const spread = (a) => { if (a.length < 8) return NaN; const b = Float64Array.from(a).sort(); return (b[Math.floor(b.length * 0.75)] - b[Math.floor(b.length * 0.25)]) / Math.max(1e-6, b[b.length >> 1]); };
export function read(st, A) {
  const n = st.n, dv = (2 * VR) / (VN - 1), at = (k, v) => A[k * VN + (st.flip ? VN - 1 - v : v)], sm = new Float32Array(VN), stepPx = Math.max(1, Math.round(4 * st.S)), R = Math.max(1, Math.round(3 * st.S));
  let hwm = 0; for (let k = 0; k < n; k++) hwm += st.hw[k] / n; const px = (dv * hwm) / st.S;
  // (where the band falls to a level, walking out from its peak: between samples)
  const out2 = (i, dir, level) => { let v = i; while (v + dir >= 0 && v + dir < VN && sm[v + dir] > level) v += dir; const w = v + dir; return w < 0 || w >= VN ? v : v + (dir * (sm[v] - level)) / Math.max(1e-6, sm[v] - sm[w]); };
  const T = [], D = [], LO = [], HI = [], FI = [], FE = [], OT = [], SK = [], has = []; let last = -1;
  const in0 = Math.ceil((VR - 1.25) / dv), in1 = Math.floor((VR + 1.25) / dv);
  for (let k = R; k < n - R; k += stepPx) {
    for (let v = 0; v < VN; v++) { let s = 0; for (let j = -R; j <= R; j++) s += at(k + j, v); sm[v] = s / (2 * R + 1); }
    let i = -1; const lo0 = last < 0 ? 6 : Math.max(2, last - 10), hi0 = last < 0 ? VN - 7 : Math.min(VN - 3, last + 10); for (let v = lo0; v <= hi0; v++) if (i < 0 || sm[v] > sm[i]) i = v;
    const peak = sm[i]; if (peak < 0.2) { has.push(0); continue; }
    const a = out2(i, -1, 0.5 * peak), b = out2(i, 1, 0.5 * peak);
    let body = 0, c = 0; for (let v = Math.ceil(a); v <= Math.floor(b); v++) { body += sm[v]; c++; } if (!c) { has.push(0); continue; }
    // (its two edges: how far each takes to fall from three quarters of the peak to a quarter; the firmer, the softer)
    const e0 = Math.abs(out2(i, -1, 0.25 * peak) - out2(i, -1, 0.75 * peak)) * px, e1 = Math.abs(out2(i, 1, 0.25 * peak) - out2(i, 1, 0.75 * peak)) * px;
    // (another line across the limb here, apart from the band: a peak beyond it, within the limb, with paper between)
    { let o = -1; for (let v = in0; v <= in1; v++) if ((v < a - 3 || v > b + 3) && (o < 0 || sm[v] > sm[o])) o = v;
      let there = 0; if (o >= 0 && sm[o] >= 0.2) { let lowest = 1; for (let v = Math.min(o, i); v <= Math.max(o, i); v++) lowest = Math.min(lowest, sm[v]); there = lowest < 0.5 * sm[o] ? 1 : 0; } OT.push(there); }
    // (streaks: how uneven the band is across itself, sample to sample, against its darkness: bristle lines with paper
    // between them, as against an even or a graded band)
    { let u = 0, m = 0; for (let v = Math.ceil(a) + 1; v <= Math.floor(b) - 1; v++) { u += Math.abs(sm[v] - (sm[v - 1] + sm[v + 1]) / 2); m++; } if (m >= 3) SK.push(u / m / Math.max(0.05, body / c)); }
    last = Math.round((a + b) / 2); has.push(1); T.push((b - a) * dv); D.push(body / c); LO.push(a * px); HI.push(b * px); FI.push(Math.min(e0, e1)); FE.push(Math.max(e0, e1));
  }
  const out = { cover: has.reduce((s, v) => s + v, 0) / Math.max(1, has.length) };
  // (its breaks: runs of steps with no band, in px of the restyle)
  { const runs = []; let r = 0; for (const h of has) { if (!h) r++; else if (r) { runs.push(r); r = 0; } } if (r) runs.push(r); out.gap = runs.length ? (runs.reduce((s, v) => s + v, 0) / runs.length) * (stepPx / st.S) : 0; }
  out.thick = med(T); out.body = med(D); out.swell = spread(T); out.press = spread(D); out.firm = med(FI); out.feather = med(FE); out.streak = SK.length >= 6 ? 10 * (SK.reduce((s, v) => s + v, 0) / SK.length) : NaN; out.other = OT.length ? OT.reduce((s, v) => s + v, 0) / OT.length : NaN;
  // (thickness and darkness together)
  if (T.length >= 12) { const mt = T.reduce((s, v) => s + v, 0) / T.length, md = D.reduce((s, v) => s + v, 0) / D.length; let stt = 0, sdd = 0, std = 0; for (let i = 0; i < T.length; i++) { stt += (T[i] - mt) ** 2; sdd += (D[i] - md) ** 2; std += (T[i] - mt) * (D[i] - md); } out.together = std / Math.sqrt(stt * sdd + 1e-12); } else out.together = NaN;
  // (over what length its thickness changes: the lag at which the thickness stops agreeing with itself (its
  // autocorrelation under a half), in the limb's half-widths: long for a stroke that swells and thins, short for lumps)
  if (T.length >= 24) { const mt = T.reduce((s, v) => s + v, 0) / T.length; let v0 = 0; for (const t of T) v0 += (t - mt) ** 2; let lag = 1; for (; lag < T.length / 2; lag++) { let c = 0; for (let i = 0; i + lag < T.length; i++) c += (T[i] - mt) * (T[i + lag] - mt); if (c / Math.max(1e-9, v0) < 0.5) break; } out.run = (lag * (stepPx / st.S)) / (hwm / st.S); } else out.run = NaN;
  // (how ragged its edges: each edge about its own drift)
  const rag = (E) => { if (E.length < 12) return NaN; const d = []; for (let i = 0; i < E.length; i++) d.push(Math.abs(E[i] - med(E.slice(Math.max(0, i - 7), i + 8)))); return 1.48 * (d.reduce((s, v) => s + v, 0) / d.length); };
  out.rim = (rag(LO) + rag(HI)) / 2;
  // (its release: over the last eighth of the limb, if the strip reaches the limb's end)
  if (st.u1 > 0.94 && T.length >= 16) { const k = Math.max(2, Math.round(T.length * (0.125 / Math.max(0.2, st.u1 - st.u0)))); out.release = med(T.slice(-k)) / Math.max(1e-6, out.thick); } else out.release = NaN;
  return out;
}
// (over strokes: the mean of the middle three fifths: steadier than a median, and a crossing mark or two don't move it)
const trim = (a) => { if (!a.length) return NaN; const b = Float64Array.from(a).sort(), k = Math.floor(b.length * 0.2); let s = 0; for (let i = k; i < b.length - k; i++) s += b[i]; return s / (b.length - 2 * k); };
export const WHAT = ['cover', 'gap', 'thick', 'body', 'swell', 'press', 'together', 'firm', 'feather', 'rim', 'release', 'other', 'run', 'streak'], UNIT = { cover: 0.05, gap: 8, thick: 0.2, body: 0.1, swell: 0.15, press: 0.08, together: 0.2, firm: 1, feather: 2, rim: 0.7, release: 0.25, other: 0.15, run: 0.4, streak: 0.15 };
export const pooled = (rs) => Object.fromEntries(WHAT.map((k) => [k, trim(rs.map((r) => r[k]).filter(Number.isFinite))]));
export const apart = (a, b, what = WHAT) => what.reduce((s, k) => s + (Number.isFinite(a[k]) && Number.isFinite(b[k]) ? ((a[k] - b[k]) / UNIT[k]) ** 2 : 0), 0);
export const fmt = (o) => WHAT.map((k) => `${k} ${Number.isFinite(o[k]) ? o[k].toFixed(k === 'gap' || k === 'rim' || k === 'firm' || k === 'feather' ? 1 : 2) : '–'}`).join('  ');
/** a picture (a byte a pixel, w wide) straightened along a stroke's stations, as its strip is */
export function sampled(img, w, h, st) {
  const out = new Float32Array(st.n * VN), at = (i, j) => (i >= 0 && i < w && j >= 0 && j < h ? img[j * w + i] / 255 : 0);
  for (let k = 0; k < st.n; k++) for (let v = 0; v < VN; v++) { const t = (v / (VN - 1)) * 2 * VR - VR, X = st.x[k] + st.nx[k] * t * st.hw[k] - 0.5, Y = st.y[k] + st.ny[k] * t * st.hw[k] - 0.5, i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j; out[k * VN + v] = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy; }
  return out;
}
