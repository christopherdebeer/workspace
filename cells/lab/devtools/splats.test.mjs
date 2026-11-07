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
// (One Stone: the cut stone's rays, faces and marks)
{
  const ST = await load('../client/splats/stone.ts');
  const S = ST.stoneShape();
  let hits = 0, onFace = 0;
  for (let k = 0; k < 400; k++) { const a = k * 2.399, z = 1 - 2 * ((k + 0.5) / 400), r = Math.sqrt(1 - z * z), d = [Math.cos(a) * r, z, Math.sin(a) * r]; const h = S.ray(S.centre, d); if (h) { hits++; if (h.p[1] >= -1e-6) onFace++; } }
  ok('stone: every ray from its middle meets its surface, at or above the ground', hits === 400 && onFace === 400, { hits, onFace });
  const eye = [3, 1.5, 3], dir = ST.polyRay ? [-3, -1.1, -3] : null, l = Math.hypot(...dir), hit = ST.polyRay(eye, dir.map((v) => v / l));
  ok('stone: a ray from an eye outside enters it', !!hit && hit.t > 0);
  ok('stone: its exact mesh has the ledge\'s recess and soffit', [...S.region].includes(ST.RECESS) && [...S.region].includes(ST.SOFFIT) && S.tris.length / 3 > 20);
  for (const look of ['dry', 'wash']) {
    const d = ST.oneStone(look, S);
    const finite = d.pos.every(Number.isFinite) && d.scale.every((v) => Number.isFinite(v) && v > 0) && d.rank.every((v) => v >= 0 && v <= 1);
    const kinds = new Set(d.mark);
    ok(`stone, ${look}: ${d.n} marks, all finite, ranked, every kind there`, finite && [1, 2, 3, 4, 5, 6].every((k) => kinds.has(k)), [...kinds]);
    // (a stroke shortens rather than crumbling: its marks' ranks fall off from its heart, so at any threshold what's
    // left of the seam is one run)
    const seam = d.stroke[[...d.mark].indexOf(1)], idx = [...d.stroke.keys()].filter((i) => d.stroke[i] === seam), thr = 0.82;
    const kept = idx.map((i) => d.rank[i] > thr), runs = kept.filter((v, k) => v && !kept[k - 1]).length;
    ok(`stone, ${look}: the seam at ${thr} is one run, not fragments`, runs === 1, runs);
  }
}
// (the brush: a stroke keeps its identity through deposit; it reduces toward its heart; it lies flat on a surface and is
// round in open space; a group ranks its principal above its supports and accents)
{
  const B = await load('../client/splats/brush.ts');
  const pts = Array.from({ length: 50 }, (_, k) => [k * 0.02, 0, 0]);
  const free = B.stroke({ pts }, { width: 0.01 }, { heart: 0 }), flat = B.stroke({ pts, normals: pts.map(() => [0, 1, 0]) }, { width: 0.01 }, { heart: 'middle' });
  const [g1] = B.group(0.9, free), df = B.deposit(free), dl = B.deposit(flat);
  ok('brush: a stroke deposits splats that all name it', df.length > 20 && df.every((d) => d.element === free.id));
  ok('brush: its rank falls away from its heart (at its start)', df[0].rank > df[df.length - 1].rank && Math.abs(df[0].rank - 0.9) < 0.05, [df[0].rank, df[df.length - 1].rank]);
  ok('brush: on a surface it lies flat; in open space it\'s round', dl.every((d) => d.s[2] < 0.002) && df.every((d) => Math.abs(d.s[2] - d.s[1]) < 1e-9));
  ok('brush: at half density, about half the splats, the same gesture', Math.abs(B.deposit(free, 0.5).length - df.length / 2) < df.length * 0.15);
  const w = B.wash(B.planeRegion([0, 1, 0], [0, 0, 0], (p) => Math.abs(p[0]) < 0.3 && Math.abs(p[2]) < 0.3, 0.5), [[-0.3, 0, -0.3], [0.3, 0, -0.3]], { reach: 0.3 });
  const acc = B.stroke({ pts }, { width: 0.01 });
  B.group(0.8, flat, [w], [acc]);
  ok('brush: a group ranks principal > support > accent', flat.rank > w.rank && w.rank > acc.rank, [flat.rank, w.rank, acc.rank]);
  const dw = B.deposit(w);
  ok('brush: a wash stays in its region and is densest near its anchor', dw.length > 20 && dw.every((d) => Math.abs(d.p[0]) <= 0.31 && Math.abs(d.p[2]) <= 0.31) && dw.filter((d) => d.p[2] < -0.15).length > dw.filter((d) => d.p[2] > 0.15).length);
  void g1;
}
// (dependable deposition: the same instructions give the same drawing, whatever was built before, however the curve is
// sampled, at any density (tone held); and every mark says where it's attached)
{
  const B = await load('../client/splats/brush.ts'), SU = await load('../client/splats/subjects.ts'), MI = await load('../client/splats/mist.ts');
  const a = SU.brushScene('wash'); MI.mistScene(1, 2000); B.stroke({ pts: [[0, 0, 0], [1, 0, 0]] }, { width: 0.01 }); const b = SU.brushScene('wash');
  ok('deposit: a subject rebuilt after other scenes is identical', a.drawing.n === b.drawing.n && a.drawing.pos.every((v, i) => v === b.drawing.pos[i]) && a.drawing.rgba.every((v, i) => v === b.drawing.rgba[i]), [a.drawing.n, b.drawing.n]);
  ok('deposit: element ids come from keys (a subject\'s scope and place)', a.elements[0].key.startsWith('stone/') && a.elements.every((e) => e.id === B.hashKey(e.key)), a.elements[0].key);
  // (a CPU rasterisation of marks on the plane y = 0: each splat's footprint, composited as the renderer does)
  const N = 96, X0 = -0.45, X1 = 0.45;
  const raster = (deps) => {
    const T = new Float64Array(N * N).fill(1), px = (X1 - X0) / N;
    for (const d of deps) {
      const [e1, e2] = d.ax, s0 = Math.max(d.s[0], 1e-4), s1 = Math.max(d.s[1], 1e-4), R = 3 * Math.max(s0, s1);
      const i0 = Math.max(0, Math.floor((d.p[0] - R - X0) / px)), i1 = Math.min(N - 1, Math.ceil((d.p[0] + R - X0) / px)), j0 = Math.max(0, Math.floor((d.p[2] - R - X0) / px)), j1 = Math.min(N - 1, Math.ceil((d.p[2] + R - X0) / px));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * px - d.p[0], z = X0 + (j + 0.5) * px - d.p[2], u = x * e1[0] + z * e1[2], v = x * e2[0] + z * e2[2];
        T[j * N + i] *= 1 - Math.min(0.99, d.a * Math.exp(-0.5 * ((u / s0) ** 2 + (v / s1) ** 2)));
      }
    }
    return T;
  };
  const dark = (T) => T.reduce((s, t) => s + (1 - t), 0) / T.length;
  const blocks = (T, k = 8) => { const M = N / k, out = new Float64Array(M * M); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out[Math.floor(j / k) * M + Math.floor(i / k)] += (1 - T[j * N + i]) / (k * k); return out; };
  const corr = (x, y) => { const n = x.length, mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxy / Math.sqrt(sxx * syy); };
  const sq = B.planeRegion([0, 1, 0], [0, 0, 0], (p) => Math.abs(p[0]) < 0.3 && Math.abs(p[2]) < 0.3, 0.5);
  const line = (n) => Array.from({ length: n }, (_, k) => [-0.3 + (0.6 * k) / (n - 1), 0, -0.3]);
  for (const material of ['wash', 'dry']) {
    const w = B.wash(sq, line(2), { reach: 0.4, material, key: `tone-${material}` });
    const t = [0.5, 1, 2].map((d) => dark(raster(B.deposit(w, d))));
    ok(`deposit: ${material} tone held across density 0.5 / 1 / 2 (${t.map((v) => v.toFixed(3)).join(' / ')})`, t.every((v) => Math.abs(v / t[1] - 1) < 0.1));
  }
  // (resampling: the same straight anchor in 2 points and 40; the same arc in 12 points and 120)
  {
    const w2 = B.wash(sq, line(2), { reach: 0.4, key: 'rs' }), w40 = B.wash(sq, line(40), { reach: 0.4, key: 'rs' });
    const A = raster(B.deposit(w2)), C = raster(B.deposit(w40));
    ok(`deposit: an anchor resampled (2 vs 40 points) gives the same wash (tone ${dark(A).toFixed(3)} vs ${dark(C).toFixed(3)}, layout r ${corr(blocks(A), blocks(C)).toFixed(3)})`, Math.abs(dark(A) / dark(C) - 1) < 0.05 && corr(blocks(A), blocks(C)) > 0.95);
    const arc = (n) => Array.from({ length: n }, (_, k) => { const t = -0.9 + (1.8 * k) / (n - 1); return [0.42 * Math.sin(t), 0, -0.42 + 0.42 * (1 - Math.cos(t))]; });
    const a12 = B.wash(sq, arc(12), { reach: 0.3, key: 'arc' }), a120 = B.wash(sq, arc(120), { reach: 0.3, key: 'arc' }), P = raster(B.deposit(a12)), Q = raster(B.deposit(a120));
    ok(`deposit: an arc resampled (12 vs 120 points) gives the same wash (tone ${dark(P).toFixed(3)} vs ${dark(Q).toFixed(3)}, layout r ${corr(blocks(P), blocks(Q)).toFixed(3)})`, Math.abs(dark(P) / dark(Q) - 1) < 0.06 && corr(blocks(P), blocks(Q)) > 0.93);
  }
  // (strokes: tone held across density too)
  {
    const s = B.stroke({ pts: line(30).map((p) => [p[0], 0, 0]), normals: line(30).map(() => [0, 1, 0]) }, { width: 0.012 }, { key: 'tone-stroke' });
    const t = [0.5, 1, 2].map((d) => dark(raster(B.deposit(s, d))));
    ok(`deposit: a stroke's tone held across density 0.5 / 1 / 2 (${t.map((v) => v.toFixed(4)).join(' / ')})`, t.every((v) => Math.abs(v / t[1] - 1) < 0.1));
  }
  // (support: on a surface, on an edge, free; a wash in a volume is free and round)
  {
    const P2 = [[0, 0, 0], [0.3, 0, 0]], onS = B.deposit(B.stroke({ pts: P2, normals: [[0, 1, 0], [0, 1, 0]] }, { width: 0.01 })), edge = B.deposit(B.stroke({ pts: P2, normals: [[0, 1, 0], [0, 1, 0]] }, { width: 0.01 }, { profile: [1, 0, 0], mark: 4 })), fr = B.deposit(B.stroke({ pts: P2 }, { width: 0.01 }));
    const vol = B.deposit(B.wash(B.volumeRegion([0, 0, 0], [0.3, 0.2, 0.3]), [[-0.2, 0, 0], [0.2, 0, 0]], { reach: 0.25 }));
    ok('deposit: support is explicit (surface, edge with its second normal, free; a volume wash free and round)', onS.every((d) => d.support === B.SUPPORT.surface) && edge.every((d) => d.support === B.SUPPORT.edge && d.n2) && fr.every((d) => d.support === B.SUPPORT.free) && vol.length > 50 && vol.every((d) => d.support === B.SUPPORT.free && d.s[0] === d.s[2]));
    const m = MI.mistScene(1, 500);
    ok('deposit: mist splats are free (no surface depth), its stems\' contours keep their own colour', [...m.drawing.support.slice(m.stems)].every((v) => v === B.SUPPORT.free) && [...Array(m.stems).keys()].some((i) => m.drawing.mark[i] === 4 && m.drawing.rgba[i * 4] === 230));
  }
  // (an edited stroke keeps its identity and its tremor: only what changed changes)
  {
    const s = B.stroke(B.pathFrom([[0, 0, 0], [0.2, 0, 0.1], [0.4, 0, 0]]), { width: 0.01, tremor: 0.5 }, { key: 'edit' }), id = s.id, d1 = B.deposit(s);
    s.gesture = { ...s.gesture, pressure: () => 0.6 }; const d2 = B.deposit(s);
    ok('edit: a re-pressured stroke keeps its id and its marks\' places', s.id === id && d1.length === d2.length && d1.every((d, i) => Math.abs(d.p[0] - d2[i].p[0]) < 1e-3));
  }
}
// (the composed scene: one ground. Cast shadows kept off other objects' footprints and off each other; every mark knows
// its object; lesser objects go first as the detail falls)
{
  const SU = await load('../client/splats/subjects.ts');
  const on = SU.composedScene('wash', true), off = SU.composedScene('wash', false);
  const culms = [[1.35, 0.95, 0.065, 3], [1.55, -0.95, 0.085, 4], [2.1, -1.3, 0.075, 5]];
  const ground = (sc) => { const d = sc.drawing, out = []; for (let i = 0; i < d.n; i++) if (d.pos[i * 3 + 1] < 0.004 && d.mark[i] !== 5) out.push([d.pos[i * 3], d.pos[i * 3 + 2], d.object[i]]); return out; };
  const under = (g) => g.filter(([x, z, o]) => culms.some(([cx, cz, r, co]) => co !== o && Math.hypot(x - cx, z - cz) < r * 0.8)).length;
  const doubled = (g) => { const cell = new Map(); for (const [x, z, o] of g) { const k = `${Math.floor(x / 0.05)},${Math.floor(z / 0.05)}`; (cell.get(k) ?? cell.set(k, new Set()).get(k)).add(o); } return [...cell.values()].filter((v) => v.size > 1).length; };
  const gOn = ground(on), gOff = ground(off);
  ok(`composed: no shadow drawn under another object (${under(gOn)} marks; ${under(gOff)} with each alone)`, under(gOn) === 0 && under(gOff) > 0);
  ok(`composed: where shadows fall together the ground is one shadow (${doubled(gOn)} cells with two objects' shadow marks; ${doubled(gOff)} with each alone)`, doubled(gOn) < doubled(gOff) * 0.2);
  ok('composed: every mark knows its object', [...on.drawing.object].every((o) => o > 0));
  // (each object's principal: the detail at which it goes, in the order of importance; drawn alone they're all alike)
  const top = (sc, obj) => { let m = 0; for (let i = 0; i < sc.drawing.n; i++) if (sc.drawing.object[i] === obj) m = Math.max(m, sc.drawing.rank[i]); return m; };
  const order = [1, 3, 2, 4, 5].map((o) => top(on, o));
  ok(`composed: as the detail falls the objects go in order of importance (last marks at ${order.map((v) => v.toFixed(2)).join(' > ')})`, order.every((v, i) => i === 0 || v < order[i - 1]));
}
// (Mist: on an unseen bank under an unseen sun, the trained network is nearer the expensive reference than the analytic
// model, and both far nearer than the baked colour; the CPU features match what was trained)
{
  const MI = await load('../client/splats/mist.ts'), NN = await load('../client/splats/mistnet.ts');
  const shape = MI.mistShape(9), grid = MI.densityGrid(shape), pts = MI.mistPoints(shape, 160, 21), sun = MI.sunDir(1.6, 0.4), bake = MI.sunDir(NN.BAKE.az, NN.BAKE.el);
  let eb = 0, ea = 0, en = 0;
  for (const pt of pts) {
    const v = [0.3, 0.5, 0.81], c = v[0] * sun[0] + v[1] * sun[1] + v[2] * sun[2], y = MI.referenceLight(MI.referenceAt(shape, pt.p, sun), c), f = MI.features(grid, pt.p, sun, v);
    eb += Math.abs(MI.referenceLight(MI.referenceAt(shape, pt.p, bake), v[0] * bake[0] + v[1] * bake[1] + v[2] * bake[2]) - y); ea += Math.abs(MI.analytic(f, NN.ANALYTIC) - y); en += Math.abs(MI.netLight(NN.NET, f) - y);
  }
  ok(`mist: unseen bank and sun, mean error baked ${(eb / pts.length).toFixed(3)} > analytic ${(ea / pts.length).toFixed(3)} > neural ${(en / pts.length).toFixed(3)}`, en < ea && ea < eb);
}
if (R) {
  ok('half floats: 1, 0.5, 65504, 2e-5 round trip', R.toHalf(1) === 0x3c00 && R.toHalf(0.5) === 0x3800 && R.toHalf(65504) === 0x7bff && R.toHalf(0) === 0);
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
