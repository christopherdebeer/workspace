// A camera for a reference study (node cells/lab/devtools/splats-field-refcam.mjs [resolved]): the studies were drawn to
// the composed scene's composition but from their own viewpoint (closer and lower than the scene's reference camera, the
// stone filling the frame), so no warp of the picture lines them up. Instead: landmarks marked by eye in both pictures
// (the stone's apex and left foot, the three culms' bases, the cornice's two top corners), their 3D places found by
// casting rays from the scene's reference camera into its meshes (and the ground), and the camera (yaw, pitch, distance,
// target, field of view) fitted to put those places where the study has them. Writes devtools/out/field/ref-<state>.json:
// the study's darkness with its camera, a teacher view like any other.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const state = process.argv[2] ?? 'resolved';
const SU = await load('../client/splats/subjects.ts'), sc = SU.composedScene('wash', true), O = sc.occluder;
const T = JSON.parse(readFileSync(new URL('./out/field/targets-composed-wash.json', import.meta.url))), pv = T.find((v) => v.split === 'ref'), W = pv.w, H = pv.h;
const raw = JSON.parse(readFileSync(new URL(`./out/field/ref-${state}-raw.json`, import.meta.url)));
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => a.map((v) => v * k);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
// (landmarks, in each picture's 192 × 128: the scene's drawing from its reference camera, and the study)
const LM = [
  ['stone apex', [95, 45.75], [125, 33.75]],
  ['stone left foot', [35, 80.5], [15, 95]],
  ['front culm base', [113, 112.5], [128.75, 115.5]],
  ['back culm base', [136.25, 68.75], [155.5, 94.5]],
  ['far culm base', [152.5, 70], [163, 96.25]],
  ['cornice, left top', [33.75, 37.5], [8.75, 13.75]],
  ['cornice, right top', [72.5, 37], [75, 25]],
];
const camOf = (eye, target, fov) => { const f = norm(sub(target, eye)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f); return { E: eye, f, r, u, fy: H / (2 * Math.tan(fov / 2)) }; };
// (each landmark's 3D place: the ray through it from the scene's reference camera, to the nearest mesh or the ground)
const pc = camOf(pv.eye, pv.target, pv.fov);
const P3 = LM.map(([, [x, y]]) => {
  const d = norm(add(add(mul(pc.r, (x - W / 2) / pc.fy), mul(pc.u, -(y - H / 2) / pc.fy)), pc.f));
  let best = pc.E[1] / -d[1] > 0 ? pc.E[1] / -d[1] : Infinity;
  for (let t = 0; t < O.length; t += 9) {
    const A = [O[t], O[t + 1], O[t + 2]], e1 = sub([O[t + 3], O[t + 4], O[t + 5]], A), e2 = sub([O[t + 6], O[t + 7], O[t + 8]], A), p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const s = sub(pc.E, A), u = dot(s, p) / det; if (u < 0 || u > 1) continue;
    const q = cross(s, e1), v = dot(d, q) / det; if (v < 0 || u + v > 1) continue;
    const tt = dot(e2, q) / det; if (tt > 0.01 && tt < best) best = tt;
  }
  return add(pc.E, mul(d, best));
});
// (the camera: orbit parameters as the page has them; fitted by Nelder–Mead to the study's landmarks)
const project = (x) => {
  const [yaw, pitch, dist, tx, ty, tz, fov] = x, cp = Math.cos(pitch), target = [tx, ty, tz];
  const eye = add(target, [Math.sin(yaw) * cp * dist, Math.sin(pitch) * dist, Math.cos(yaw) * cp * dist]), c = camOf(eye, target, fov);
  return { eye, target, fov, px: P3.map((P) => { const q = sub(P, c.E), z = dot(q, c.f); return [W / 2 + (c.fy * dot(q, c.r)) / z, H / 2 - (c.fy * dot(q, c.u)) / z]; }) };
};
const cost = (x) => { if (x[6] < 0.25 || x[6] > 1.4 || x[2] < 0.5) return 1e9; const { px } = project(x); return px.reduce((s, p, i) => s + (p[0] - LM[i][2][0]) ** 2 + (p[1] - LM[i][2][1]) ** 2, 0); };
const R = SU.REF_CAM, x0 = [R.yaw, R.pitch, R.dist, ...R.target, (50 * Math.PI) / 180];
function nelder(f, x0, steps, iters = 6000) {
  let S = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + steps[j] : v)))].map((x) => ({ x, f: f(x) }));
  for (let it = 0; it < iters; it++) {
    S.sort((a, b) => a.f - b.f);
    const n = x0.length, c = x0.map((_, j) => S.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n), w = S[n];
    const at = (k) => c.map((v, j) => v + k * (w.x[j] - v)), r = { x: at(-1) }; r.f = f(r.x);
    if (r.f < S[0].f) { const e = { x: at(-2) }; e.f = f(e.x); S[n] = e.f < r.f ? e : r; }
    else if (r.f < S[n - 1].f) S[n] = r;
    else { const k = { x: at(0.5) }; k.f = f(k.x); if (k.f < w.f) S[n] = k; else S = S.map((p, i) => (i === 0 ? p : { x: p.x.map((v, j) => S[0].x[j] + 0.5 * (v - S[0].x[j])), f: 0 })).map((p, i) => (i === 0 ? p : { ...p, f: f(p.x) })); }
  }
  S.sort((a, b) => a.f - b.f); return S[0];
}
let best = { f: Infinity };
for (const dd of [0.6, 0.8, 1, 1.3]) for (const dy of [-0.15, 0, 0.15]) { const r = nelder(cost, [x0[0] + dy, x0[1], x0[2] * dd, x0[3], x0[4], x0[5], x0[6]], [0.1, 0.05, 0.3, 0.2, 0.1, 0.2, 0.1]); if (r.f < best.f) best = r; }
const fit = project(best.x), rms = Math.sqrt(best.f / LM.length);
const [yaw, pitch, dist, , , , fov] = best.x;
console.log(`${state}: camera yaw ${yaw.toFixed(3)} (the scene's ${R.yaw.toFixed(3)}), pitch ${pitch.toFixed(3)} (${R.pitch}), distance ${dist.toFixed(2)} (${R.dist}), field of view ${((fov * 180) / Math.PI).toFixed(1)}° (50°); landmark error ${rms.toFixed(1)} px rms of 192`);
LM.forEach(([nm], i) => console.log(`  ${nm.padEnd(20)} study ${LM[i][2].map((v) => v.toFixed(0))}  fitted ${fit.px[i].map((v) => v.toFixed(0))}`));
writeFileSync(new URL(`./out/field/ref-${state}.json`, import.meta.url), JSON.stringify({ state, w: W, h: H, D: raw.D, camera: { eye: fit.eye, target: fit.target, fov: fit.fov, up: 1, yaw, pitch, dist }, landmarks: LM.map(([nm, , st], i) => ({ name: nm, study: st, scene: fit.px[i] })), landmarkErrorPx: +rms.toFixed(2) }));
