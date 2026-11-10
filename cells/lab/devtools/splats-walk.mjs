// Walking into one wash (node cells/lab/devtools/splats-walk.mjs).
//
// One canopy patch (client/splats/canopy.ts), a straight approach from 12 m to inside it, drawn through the renderer's
// forward model (render.ts, kind 12, with its hand-over by apparent size) every 20 cm, four ways:
// - **fronds**: every strand and dab, all the way. A fitted mark keeps its ink however small it's drawn, so this is the
//   reference for tone: what the patch's darkness should be at each distance;
// - **wash**: the far organisation alone, all the way (what goes wrong when it's walked into);
// - **hand-over**: the wash far off, the fronds close to, complementary in between;
// - **switch**: the same two, swapped all at once at 5 m (what a pop measures as).
// First the wash is fitted to the fronds as they look from far off (12 m and 9 m): its nine tones and its deposits'
// size, by drawing it again with each moved a little.
//
// Measured, per step: the patch's tone (mean darkness of the frame); how much the frame changed from the last one
// (blurred, mean absolute change), against the fronds' own change over the same step (the change that's just the walk);
// how many deposits were drawn. Writes devtools/out/walk/walk.json, strips of frames, and static/splats/walk.json (the
// fitted wash, for ?scene=walk).
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/canopy.ts'), M = await load('../client/splats/marks.ts');
const dir = new URL('./out/walk/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = 384, H = 256, { WALK, HANDOVER } = C, fy = H / (2 * Math.tan(WALK.fov / 2));
const PAPER = [0.937, 0.906, 0.847], INK = [36, 31, 27], kappa = (c) => Math.max(...[0, 1, 2].map((k) => (PAPER[k] - c[k] / 255) / (PAPER[k] - 0.12)));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const camAt = (d) => { const f = norm(WALK.look), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return { E: [0, WALK.eyeY, d], f, r, u }; };
const deps = (marks) => marks.flatMap((m) => M.layout(m).map((d) => ({ ...d, ax: M.axes(d), k: kappa(m.colour ?? INK), lod: m.lod ?? null })));
/** a frame: darkness a pixel, and how many deposits were drawn */
function draw(D, cam, lodOf = (d) => d.lod) {
  const logT = new Float32Array(W * H); let drawn = 0;
  for (const d of D) {
    const q0 = [d.p[0] - cam.E[0], d.p[1] - cam.E[1], d.p[2] - cam.E[2]], q = [dot(q0, cam.r), dot(q0, cam.u), dot(q0, cam.f)], z = q[2]; if (z < 0.02) continue;
    let a = 1 / (1 + Math.exp(-d.logit)); const lod = lodOf(d);
    if (lod) a *= Math.max(0, Math.min(1, (Math.log2(fy / (z * H)) - lod[0]) / (lod[1] - lod[0])));
    a *= Math.max(0, Math.min(1, (z - 0.25) / 0.45)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, (z - 0.25) / 0.45)));
    if (a < 0.004) continue;
    const sx = W / 2 + (fy * q[0]) / z, sy = H / 2 - (fy * q[1]) / z;
    const img = (ax, s) => { const ar = dot(ax, cam.r), au = dot(ax, cam.u), af = dot(ax, cam.f); return [s * (fy / z) * (ar - (q[0] * af) / z), s * (-fy / z) * (au - (q[1] * af) / z)]; };
    const e1 = img(d.ax[0], d.s1), e2 = img(d.ax[1], d.s2), e3 = img(d.ax[2], d.thin);
    const A = e1[0] * e1[0] + e2[0] * e2[0] + e3[0] * e3[0] + 0.3, B = e1[0] * e1[1] + e2[0] * e2[1] + e3[0] * e3[1], Cc = e1[1] * e1[1] + e2[1] * e2[1] + e3[1] * e3[1] + 0.3, det = A * Cc - B * B;
    const R = 3 * Math.sqrt(Math.max(A, Cc)); if (sx + R < 0 || sx - R > W || sy + R < 0 || sy - R > H) continue;
    const ia = Cc / det, ib = -B / det, ic = A / det, al = a * Math.sqrt(Math.max(0, ((A - 0.3) * (Cc - 0.3) - B * B) / det)) * d.k;
    if (al < 1 / 255) continue; drawn++;
    const x0 = Math.max(0, Math.floor(sx - R)), x1 = Math.min(W - 1, Math.ceil(sx + R)), y0 = Math.max(0, Math.floor(sy - R)), y1 = Math.min(H - 1, Math.ceil(sy + R));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x + 0.5 - sx, dy = y + 0.5 - sy, G = Math.exp(-0.5 * (ia * dx * dx + 2 * ib * dx * dy + ic * dy * dy)); if (G < 0.011 || al * G < 1 / 255) continue; logT[y * W + x] += Math.log(1 - Math.min(0.99, al * G)); }
  }
  const out = new Float32Array(W * H); for (let p = 0; p < W * H; p++) out[p] = 1 - Math.exp(logT[p]);
  return { D: out, drawn };
}
function blur(a, r) {
  // (a Gaussian, one axis then the other; the edges repeated)
  const n = Math.ceil(r * 2.5), k = new Float32Array(2 * n + 1); let ks = 0; for (let i = -n; i <= n; i++) { k[i + n] = Math.exp(-0.5 * (i / r) ** 2); ks += k[i + n]; } for (let i = 0; i <= 2 * n; i++) k[i] /= ks;
  const o = new Float32Array(W * H), t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { let s = 0; for (let i = -n; i <= n; i++) { const xx = x + i; s += a[row + (xx < 0 ? 0 : xx >= W ? W - 1 : xx)] * k[i + n]; } t[row + x] = s; } }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let i = -n; i <= n; i++) { const yy = y + i; s += t[(yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W + x] * k[i + n]; } o[y * W + x] = s; }
  return o;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// ─── the wash fitted to the fronds from far off ───
// (the fronds' leaves formed, in the style read off the teacher's, where there is one: the wash is fitted to those)
const LEAF = existsSync(new URL('../static/splats/leaf-style.json', import.meta.url)) ? JSON.parse(readFileSync(new URL('../static/splats/leaf-style.json', import.meta.url), 'utf8')).leaf : undefined;
const fronds = C.canopyPatch(1000, WALK.patch, 'fronds', undefined, undefined, undefined, LEAF), washOnly = C.canopyPatch(1000, WALK.patch, 'wash'), wash = washOnly[0]; wash.params = [-1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, -1.5, 0];
const FD = deps(fronds), far = [12, 9].map((d) => { const cam = camAt(d), T = draw(FD, cam).D; return { cam, T: [2, 5].map((r) => blur(T, r)), mean: mean(T) }; });
const washLoss = () => { const D = deps([wash]); let s = 0; for (const v of far) { const P = draw(D, v.cam).D; [2, 5].forEach((r, k) => { const b = blur(P, r); let q = 0; for (let p = 0; p < W * H; p++) q += (b[p] - v.T[k][p]) ** 2; s += q / (W * H); }); } return s; };
{
  const m1 = new Float64Array(10), m2 = new Float64Array(10); const first = washLoss();
  for (let it = 1; it <= 60; it++) {
    const f0 = washLoss(), g = wash.params.map((_, j) => { wash.params[j] += 0.05; const f1 = washLoss(); wash.params[j] -= 0.05; return (f1 - f0) / 0.05; });
    wash.params.forEach((_, j) => { m1[j] = 0.9 * m1[j] + 0.1 * g[j]; m2[j] = 0.999 * m2[j] + 0.001 * g[j] * g[j]; wash.params[j] -= (0.08 * (m1[j] / (1 - 0.9 ** it))) / (Math.sqrt(m2[j] / (1 - 0.999 ** it)) + 1e-9); wash.params[j] = Math.max(j < 9 ? -7 : -0.6, Math.min(j < 9 ? 2 : 0.9, wash.params[j])); });
  }
  console.log(`the wash fitted to the fronds from 12 m and 9 m: tone error ${(first * 1000).toFixed(3)} → ${(washLoss() * 1000).toFixed(3)}; its tones ${wash.params.slice(0, 9).map((v) => v.toFixed(2)).join(' ')}, size ${wash.params[9].toFixed(2)}`);
}

// ─── the walk ───
const both = C.canopyPatch(1000, WALK.patch, 'both', undefined, wash.params.slice(), undefined, LEAF);
const BD = deps(both), WD = deps([wash]);
const ways = {
  fronds: (cam) => draw(FD, cam),
  wash: (cam) => draw(WD, cam),
  'hand-over': (cam) => draw(BD, cam),
  // (the same two, swapped all at once at 5 m)
  switch: (cam) => (cam.E[2] > 5 ? draw(WD, cam) : draw(FD, cam)),
};
const steps = []; for (let d = WALK.from; d >= WALK.to - 1e-6; d -= 0.2) steps.push(+d.toFixed(2));
const res = { steps, ways: {} }, shots = [12, 9, 7, 5.6, 4.4, 3.2, 2, 0.8];
function png(frames, name) {
  const n = frames.length, w = (W + 6) * n - 6, raw = Buffer.alloc((w * 3 + 1) * H, 255);
  frames.forEach((D, i) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.max(0, Math.min(1, D[y * W + x])), o = y * (w * 3 + 1) + 1 + (i * (W + 6) + x) * 3; for (let k = 0; k < 3; k++) raw[o + k] = Math.round(255 * (PAPER[k] - (PAPER[k] - 0.12) * d)); } });
  for (let y = 0; y < H; y++) raw[y * (w * 3 + 1)] = 0;
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8); let c = ~0; for (let i = 4; i < 8 + d.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } b.writeUInt32BE(~c >>> 0, 8 + d.length); return b; };
  const hd = Buffer.alloc(13); hd.writeUInt32BE(w, 0); hd.writeUInt32BE(H, 4); hd[8] = 8; hd[9] = 2;
  writeFileSync(`${dir}${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', hd), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
for (const [name, fn] of Object.entries(ways)) {
  const tone = [], change = [], drawn = [], strip = []; let last = null;
  for (const d of steps) { const f = fn(camAt(d)), b = blur(f.D, 3); tone.push(+mean(f.D).toFixed(5)); drawn.push(f.drawn); if (last) { let s = 0; for (let p = 0; p < W * H; p++) s += Math.abs(b[p] - last[p]); change.push(+(s / (W * H)).toFixed(5)); } else change.push(0); last = b; if (shots.includes(d)) strip.push(f.D); }
  res.ways[name] = { tone, change, drawn }; png(strip, `strip-${name}`);
}
// (against the fronds: the tone's gap, and the change that isn't the walk's own)
const ref = res.ways.fronds;
for (const [name, w] of Object.entries(res.ways)) {
  const gap = w.tone.map((t, i) => Math.abs(t - ref.tone[i]) / Math.max(1e-4, ref.tone[i])), extra = w.change.map((c, i) => c - ref.change[i]);
  const far2 = steps.map((d, i) => (d >= 3.4 ? gap[i] : 0)), worst = extra.indexOf(Math.max(...extra));
  w.summary = { toneGapFar: +Math.max(...far2).toFixed(3), toneGapMean: +mean(gap.filter((_, i) => steps[i] >= 3.4)).toFixed(3), pop: +Math.max(...extra).toFixed(5), popAt: steps[worst], ownChange: +ref.change[worst].toFixed(5), drawnFar: w.drawn[0], drawnMax: Math.max(...w.drawn) };
  console.log(`${name.padEnd(10)} tone gap to the fronds beyond 3.4 m: worst ${(w.summary.toneGapFar * 100).toFixed(0)}%, mean ${(w.summary.toneGapMean * 100).toFixed(0)}%; largest change beyond the walk's own ${(w.summary.pop * 1000).toFixed(2)} at ${w.summary.popAt} m (the walk's own there: ${(w.summary.ownChange * 1000).toFixed(2)}); deposits drawn at 12 m ${w.summary.drawnFar}, at most ${w.summary.drawnMax}`);
}
res.deposits = { fronds: FD.length, wash: WD.length }; res.handover = HANDOVER;
writeFileSync(`${dir}walk.json`, JSON.stringify(res));
writeFileSync(new URL('../static/splats/walk.json', import.meta.url), JSON.stringify({ about: 'The canopy wash fitted to its own fronds as they look from 12 m and 9 m (devtools/splats-walk.mjs).', wash: wash.params.map((v) => +v.toFixed(4)) }));
