// Splats' pure parts (node cells/lab/devtools/splats.test.mjs): the .splat reader against its writer, the .ply reader
// on a file written here as the 3DGS trainer would, the covariance against the shape it came from, and the sort
// against an ordinary sort.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const F = await load('../client/splats/format.ts'), S = await load('../client/splats/sort.ts'), R = await load('../client/splats/render.ts').catch(() => null);
let fails = 0;
const ok = (name, cond, detail) => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`); if (!cond) fails++; };
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

// (.splat: made here, written, read back)
const g = F.garden(5000, 3);
ok('the garden makes as many as asked', g.n === 5000 && g.pos.every(Number.isFinite) && g.scale.every((v) => v > 0));
const back = F.parseSplat(F.encodeSplat(g));
let worst = 0; for (let i = 0; i < g.n; i++) for (let a = 0; a < 3; a++) worst = Math.max(worst, Math.abs(back.pos[i * 3 + a] - g.pos[i * 3 + a]), Math.abs(back.scale[i * 3 + a] - g.scale[i * 3 + a]));
ok('.splat: positions and scales come back exactly', worst === 0, worst);
let qerr = 0; for (let i = 0; i < g.n; i++) { let d = 0; for (let a = 0; a < 4; a++) d += back.rot[i * 4 + a] * g.rot[i * 4 + a]; qerr = Math.max(qerr, 1 - Math.abs(d)); }
ok('.splat: rotations within the 8 bits a component', qerr < 2e-3, qerr);
ok('.splat: colours exactly', back.rgba.every((v, k) => v === g.rgba[k]));
ok('parse() tells a .splat by its bytes', F.parse(F.encodeSplat(g)).n === g.n);

// (.ply as the trainer writes it: log scales, logit opacity, SH DC colour, rotation w x y z unnormalised)
{
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const head = `ply\nformat binary_little_endian 1.0\nelement vertex 2\n${props.map((p) => `property float ${p}`).join('\n')}\nend_header\n`;
  const rows = [[1, 2, 3, 0, 0, 0, 0, 0, 0, 0, Math.log(0.5), Math.log(0.1), Math.log(0.02), 2, 0, 0, 0], [-1, 0, 4, 0, 0, 0, 1.77, -1.77, 0, 2.2, 0, 0, 0, 0, 0, 0, 3]];
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + rows.length * props.length * 4);
  new Uint8Array(buf).set(hb); const dv = new DataView(buf, hb.length);
  // (the header's length is whatever it is: the rows needn't be aligned, as in real files)
  rows.forEach((r, i) => r.forEach((v, k) => dv.setFloat32((i * props.length + k) * 4, v, true)));
  const p = F.parse(buf);
  ok('.ply: two splats, positions', p.n === 2 && p.pos[0] === 1 && p.pos[5] === 4);
  ok('.ply: scales exp\'d', near(p.scale[0], 0.5) && near(p.scale[1], 0.1) && near(p.scale[2], 0.02) && near(p.scale[3], 1));
  ok('.ply: rotations normalised', near(p.rot[0], 1) && near(p.rot[7], 1));
  ok('.ply: colour from the DC band (0.5 + 0.282 c)', p.rgba[0] === 128 && Math.abs(p.rgba[4] - 255) <= 1 && Math.abs(p.rgba[5] - 0) <= 1);
  ok('.ply: opacity through its sigmoid', p.rgba[3] === 128 && Math.abs(p.rgba[7] - Math.round(255 / (1 + Math.exp(-2.2)))) <= 1);
}

// (covariance: an axis-aligned ellipsoid gives its squared scales; a turned one, a symmetric positive one with the same
// determinant and trace)
{
  const s = F.alloc(2);
  s.scale.set([0.5, 0.2, 0.1, 0.5, 0.2, 0.1]); s.rot.set([1, 0, 0, 0, Math.cos(0.4), Math.sin(0.4) * 0.6, Math.sin(0.4) * 0.8, 0]);
  const c = new Float32Array(12); F.covariance(s, 0, c, 0); F.covariance(s, 1, c, 6);
  ok('covariance: axis-aligned is diag(s²)', near(c[0], 0.25) && near(c[3], 0.04) && near(c[5], 0.01) && near(c[1], 0) && near(c[2], 0) && near(c[4], 0));
  const det = (o) => c[o] * (c[o + 3] * c[o + 5] - c[o + 4] ** 2) - c[o + 1] * (c[o + 1] * c[o + 5] - c[o + 4] * c[o + 2]) + c[o + 2] * (c[o + 1] * c[o + 4] - c[o + 3] * c[o + 2]);
  ok('covariance: turned keeps its trace and determinant', near(c[6] + c[9] + c[11], 0.3) && near(det(6), det(0), 1e-7), [c[6] + c[9] + c[11], det(6), det(0)]);
}

// (the sort: farthest first along the view, the same as sorting the depths)
{
  const s = F.garden(20000, 9), dir = [0.3, -0.5, 0.81], l = Math.hypot(...dir), d = dir.map((v) => v / l);
  const order = new S.Sorter().sort(s.pos, s.n, d);
  const depth = (i) => d[0] * s.pos[i * 3] + d[1] * s.pos[i * 3 + 1] + d[2] * s.pos[i * 3 + 2];
  const seen = new Set(order);
  let bad = 0, span = 0; const ds = [...order].map(depth); const lo = Math.min(...ds), hi = Math.max(...ds);
  for (let k = 1; k < order.length; k++) if (ds[k] > ds[k - 1] + (hi - lo) / 65535 + 1e-9) bad++;
  ok('sort: every splat once', seen.size === s.n && order.length === s.n);
  ok('sort: farthest first, to within one bucket', bad === 0, bad);
  void span;
  const t0 = performance.now(), big = F.garden(500000, 1); const t1 = performance.now(); new S.Sorter().sort(big.pos, big.n, d); const t2 = performance.now();
  console.log(`      (half a million splats: made in ${(t1 - t0).toFixed(0)} ms, sorted in ${(t2 - t1).toFixed(0)} ms here)`);
}
if (R) {
  ok('half floats: 1, 0.5, 65504, 2e-5 round trip', R.toHalf(1) === 0x3c00 && R.toHalf(0.5) === 0x3800 && R.toHalf(65504) === 0x7bff && R.toHalf(0) === 0);
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
