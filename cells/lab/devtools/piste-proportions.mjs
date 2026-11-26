// Piste's athlete measured (node cells/lab/devtools/piste-proportions.mjs): its segment lengths and joint spans (from the
// fencer's own skeleton, fencer.ts) and its dressed girths, foot, hand and mask (sliced off the athlete's mesh, athlete.ts),
// beside reference values for a 1.78 m adult man. The references are approximate (segment fractions of height after
// Drillis & Contini; girths near the middle of the adult male range, with a little added for the kit): they flag what's
// far out, not what's exactly right.
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './look/athlete'; export * from './fencer'; export * from './weapons';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { buildAthlete, SKIN_STRIDE, B, BODY, Fencer, EPEE } = M;
const A = buildAthlete(), V = A.verts, n = V.length / SKIN_STRIDE, H = 1.78;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], len = (a) => Math.hypot(...a);
const f = new Fencer(EPEE, 0, 1); f.pose();
const c = f.capsules;

// ── the skeleton ──
const rows = [];
const row = (what, ours, ref, unit = 'cm') => rows.push([what, ours, ref, unit]);
row('upper arm', BODY.upperArm * 100, 0.186 * H * 100);
row('forearm (elbow to grip)', BODY.forearm * 100, 0.146 * H * 100);
row('thigh (hip to knee)', 46, 0.245 * H * 100);
row('shank (knee to ankle)', 46, 0.246 * H * 100);
row('shoulder joints apart', len(sub(f.shoulder, c[7].a)) * 100, 36);
row('hip joints apart', len(sub(c[9].a, c[11].a)) * 100, 18);
row('pelvis to neck (trunk)', len(sub(c[1].b, c[0].a)) * 100, 0.288 * H * 100 + 5);

// ── slices of the dressed mesh ──
const P = (v) => [V[v * SKIN_STRIDE], V[v * SKIN_STRIDE + 1], V[v * SKIN_STRIDE + 2]];
const bone = (v) => V[v * SKIN_STRIDE + 12], weight = (v) => V[v * SKIN_STRIDE + 16];
function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return h.reduce((s, p, i) => s + Math.hypot(p[0] - h[(i + 1) % h.length][0], p[1] - h[(i + 1) % h.length][1]), 0);
}
// girth round a bone, a fraction t along it (from joint a to joint b), off the vertices it mostly carries
function girth(bs, a, b, t) {
  const ax = sub(b, a), L = len(ax), x = ax.map((q) => q / L), at = a.map((q, i) => q + ax[i] * t);
  const y = Math.abs(x[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], yy = sub(y, x.map((q) => q * dot(y, x))), yl = len(yy), Y = yy.map((q) => q / yl);
  const Z = [x[1] * Y[2] - x[2] * Y[1], x[2] * Y[0] - x[0] * Y[2], x[0] * Y[1] - x[1] * Y[0]];
  const pts = [];
  for (let v = 0; v < n; v++) { if (!bs.includes(bone(v)) || weight(v) < 0.4) continue; const d = sub(P(v), at); if (Math.abs(dot(d, x)) < 0.018) pts.push([dot(d, Y), dot(d, Z)]); }
  return pts.length > 6 ? hull(pts) * 100 : NaN;
}
const kneeF = c[9].b, hipF = c[9].a, ankleF = c[10].b;
row('thigh, upper (dressed)', girth([B.thighF, B.pelvis], hipF, kneeF, 0.25), 62);
row('thigh, above knee', girth([B.thighF], hipF, kneeF, 0.8), 46);
row('knee (dressed)', girth([B.thighF, B.shinF], hipF, kneeF, 0.98), 41);
row('calf, fullest (sock)', Math.max(...[0.25, 0.3, 0.35, 0.4].map((t) => girth([B.shinF], kneeF, ankleF, t))), 39);
row('ankle', girth([B.shinF], kneeF, ankleF, 0.9), 24);
row('upper arm (sleeve)', girth([B.upperR], c[7].a, c[7].b, 0.5), 35);
row('forearm, fullest (sleeve)', Math.max(...[0.2, 0.3, 0.4].map((t) => girth([B.foreR], c[8].a, c[8].b, t))), 30);
row('wrist, rear (bare)', girth([B.foreR, B.handR], c[8].a, c[8].b, 0.97), 17.5);
// extents: along a bone's direction, off the vertices it carries
function extent(bs, dir) { let lo = Infinity, hi = -Infinity; for (let v = 0; v < n; v++) { if (!bs.includes(bone(v)) || weight(v) < 0.5) continue; const s = dot(P(v), dir); lo = Math.min(lo, s); hi = Math.max(hi, s); } return (hi - lo) * 100; }
const footDir = sub(c[13].b, c[13].a), fd = footDir.map((q) => q / len(footDir));
row('shoe length', extent([B.footF], fd), 29);
const handDir = sub(c[8].b, c[8].a), hd = handDir.map((q) => q / len(handDir));
row('rear hand, wrist to fingertip', extent([B.handR], hd), 0.108 * H * 100);
row('mask height', extent([B.head], [0, 1, 0]), 30);
row('mask width (across)', extent([B.head], [0, 0, 1]), 22);
row('mask depth (front to back)', extent([B.head], [1, 0, 0]), 26);

console.log('what                                ours     ref    ours/ref');
for (const [w, o, r, u] of rows) {
  const k = o / r, flag = !isFinite(k) ? '  ?' : k > 1.15 ? '  ▲ large' : k < 0.87 ? '  ▼ small' : '';
  console.log(`${w.padEnd(34)} ${o.toFixed(1).padStart(6)} ${r.toFixed(1).padStart(6)} ${u}  ${isFinite(k) ? k.toFixed(2) : '–'}${flag}`);
}
