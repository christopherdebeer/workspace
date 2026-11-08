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
  const culms = [['culm-front', 3], ['culm-back', 4], ['culm-far', 5]].map(([k, o]) => [SU.PLACES[k].p[0], SU.PLACES[k].p[2], SU.PLACES[k].r, o]);
  const ground = (sc) => { const d = sc.drawing, out = []; for (let i = 0; i < d.n; i++) if (d.pos[i * 3 + 1] < 0.004 && d.mark[i] !== 5) out.push([d.pos[i * 3], d.pos[i * 3 + 2], d.object[i]]); return out; };
  // (inside another object's footprint: a culm's circle, or well inside the stone's)
  const under = (g) => g.filter(([x, z, o]) => culms.some(([cx, cz, r, co]) => co !== o && Math.hypot(x - cx, z - cz) < r * 0.8) || (o !== 1 && Math.hypot(x - 0.15, z) < 0.45)).length;
  const doubled = (g) => { const cell = new Map(); for (const [x, z, o] of g) { const k = `${Math.floor(x / 0.05)},${Math.floor(z / 0.05)}`; (cell.get(k) ?? cell.set(k, new Set()).get(k)).add(o); } return [...cell.values()].filter((v) => v.size > 1).length; };
  const gOn = ground(on), gOff = ground(off);
  ok(`composed: no shadow drawn under another object (${under(gOn)} marks; ${under(gOff)} with each alone)`, under(gOn) === 0);
  // (one ground, whatever the order: the shadows are one wash, and every element's marks are the same when the objects are
  // made in reverse)
  const rev = SU.composedScene('wash', true, [...SU.LAYOUT].reverse());
  const byKey = (sc) => new Map(sc.elements.map((e) => [e.key, sc.editor.deps(e.id)]));
  const ka = byKey(on), kb = byKey(rev);
  const same = [...ka].every(([k, d]) => { const e = kb.get(k); return e && e.length === d.length && d.every((m, i) => m.p.every((v, j) => Math.abs(v - e[i].p[j]) < 1e-9)); });
  ok(`composed: one ground shadow, and the same drawing whichever order the objects are made in (${ka.size} elements compared)`, same && ka.size === kb.size && on.elements.filter((e) => e.key.endsWith('shadow')).length === 1);
  ok('composed: every authored element has a semantic key (none numbered by its place in its scope)', on.elements.every((e) => !/\/(s|w)\d+$/.test(e.key)), on.elements.filter((e) => /\/(s|w)\d+$/.test(e.key)).map((e) => e.key).slice(0, 5));
  // (structure: every object's minimum survives the sparse state, at its heart; a group's minimum goes together)
  const sparse = 0.75;
  const objs = new Set(on.elements.map((e) => e.object));
  const minOk = [...objs].every((o) => { const st = on.elements.filter((e) => e.object === o && e.structural); return st.length > 0 && st.every((e) => on.editor.deps(e.id).some((m) => m.rank >= sparse)); });
  ok(`composed: every object's minimum description survives the sparse state (${objs.size} objects)`, minOk);
  const together = on.groups.every((g) => { const m = g.minimum; if (m.length < 2) return true; const tops = m.map((e) => Math.max(...on.editor.deps(e.id).map((d) => d.rank))); return Math.max(...tops) - Math.min(...tops) < 0.04; });
  ok('composed: each group\'s minimum goes together (its structural members\' last marks within the fade band, 0.04)', together);
  // (the three culms are made alike: the same element on each goes earlier the less it's emphasised; and all material
  // detail ranks below all structure)
  const rk = (scope, key) => on.elements.find((e) => e.key === `${scope}/${key}`)?.rank ?? NaN;
  const bodies = ['culm-front', 'culm-back', 'culm-far'].map((c) => rk(c, 'body/1'));
  const maxDetail = Math.max(...on.elements.filter((e) => !e.structural && !e.alt).map((e) => e.rank)), minStruct = Math.min(...on.elements.filter((e) => e.structural).map((e) => e.rank));
  ok(`composed: material detail goes first on lesser objects (the culms' body: ${bodies.map((v) => v.toFixed(3)).join(' > ')}), and all of it below structure (${maxDetail.toFixed(2)} < ${minStruct.toFixed(2)})`, bodies[0] > bodies[1] && bodies[1] > bodies[2] && maxDetail < minStruct);
  ok(`composed: view gates for the stone's lit side (${on.gates.filter((g) => g.kind === 'lit').length}) and the others' tone (${on.gates.filter((g) => g.kind === 'cap').length})`, on.gates.some((g) => g.kind === 'lit') && on.gates.some((g) => g.kind === 'cap'));
  // (editing in the composed scene: bend the seam, its wedge follows; re-pressure; undo restores it exactly)
  {
    const ed = on.editor, si = ed.items.findIndex((x) => x.name === 'seam'), seam = ed.items[si], before = ed.drawing(-1), s0 = ed.snapshot(si);
    const h = seam.handles()[2], moved = seam.setHandle(2, [h[0] + 0.05, h[1] + 0.05, h[2]]), r = ed.regenerate(si);
    ed.setPressure(si, 'swell'); ed.regenerate(si);
    const changed = ed.drawing(-1).pos.some((v, i) => v !== before.pos[i]);
    ed.restore(s0); ed.regenerate(si);
    const after = ed.drawing(-1);
    ok(`edit: in the composed scene, the seam bent (its wedge follows: ${r.elements} elements of ${ed.order.length} deposited again), then undone exactly`, moved && r.elements === 2 && changed && after.n === before.n && after.pos.every((v, i) => v === before.pos[i]));
  }
}
// (the drawing policy: every policy held to the same mark budget; controls for every group; a treatment's extent 0 keeps
// nothing of a group, 1 all of it)
{
  const SU = await load('../client/splats/subjects.ts'), P = await load('../client/splats/policy.ts');
  const sc = SU.composedScene('wash', true), G = sc.infos();
  const v = { eye: [4, 2.5, 4], fwd: (() => { const f = [0.3 - 4, 0.75 - 2.5, -0.45 - 4], l = Math.hypot(...f); return f.map((x) => x / l); })(), focalPx: 560, detail: 0.25 };
  const comp = P.competitionOf(G, v), F = G.map((g, i) => P.features(g, v, sc.proxies, comp[i], 0)), budget = P.marksAtDetail(G, v.detail);
  const ru = P.matchBudget(G, P.rules(G, F, v.detail), budget);
  let r = 5; const rnd = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  const H = 12, IN = P.N_FEATURES + 4, net = { inputs: IN, hidden: H, w1: Array.from({ length: H * IN }, () => rnd() - 0.5), b1: Array(H).fill(0), w2: Array.from({ length: H * H }, () => rnd() - 0.5), b2: Array(H).fill(0), w3: Array.from({ length: H }, () => rnd() - 0.5), b3: 0 };
  const le = P.learned(net, G, F, budget), mr = P.marksOf(G, ru), ml = P.marksOf(G, le);
  ok(`policy: rules and a model held to the budget (${budget} marks: rules ${mr}, model ${ml})`, Math.abs(mr / budget - 1) < 0.01 && ml <= budget && ml > budget * 0.9);
  ok(`policy: every one of the scene's ${G.length} groups has a control, numbered on its marks`, G.every((g) => g.index > 0) && [...sc.drawing.group].every((x) => x > 0));
  const g0 = G.find((g) => g.ranks.length > 20);
  ok('policy: extent 0 keeps none of a group, 1 all of it, between some of it from its heart', P.keptAt(g0, P.thresholdOf(g0, 0)) === 0 && P.keptAt(g0, P.thresholdOf(g0, 1)) === g0.ranks.length && P.keptAt(g0, P.thresholdOf(g0, 0.3)) < g0.ranks.length);
}
// (the pen (pen.ts, after Autograph): a broad nib thick across its edge and fine along it, its tone held whatever the
// direction, a stroke's crossing no darker than its line, ink that runs out and is dipped again, and the same nib on a
// cylinder)
{
  const PN = await load('../client/splats/pen.ts');
  const k = 0.001, spec = (o = {}) => ({ pen: 30, k, voice: 1, dip: false, union: true, colour: [36, 31, 27], element: 1, ...o });
  // (a straight stroke at an angle, at an even pace: page units, time in hundredths)
  const line = (deg, L = 300, x0 = 0, y0 = 0, t0 = 0) => { const a = (deg * Math.PI) / 180, s = []; for (let i = 0; i <= 60; i++) s.push(x0 + Math.cos(a) * L * i / 60, y0 - Math.sin(a) * L * i / 60, t0 + i * 1.5); return s; };
  const plane = PN.planeMap([0, 0, 0], [1, 0, 0], [0, 0, -1], k);
  // (the deposits rasterised on the plane y = 0 (or, for the cylinder, unrolled), N pixels over a span)
  const raster = (deps, span = 0.5, N = 400, c = [0.15, 0.15], unroll = null) => {
    const T = new Float64Array(N * N).fill(1), px = span / N, X0 = c[0] - span / 2, Z0 = c[1] - span / 2;
    for (const d of deps) {
      const P = unroll ? unroll(d.p) : [d.p[0], d.p[2]], A = unroll ? [unroll.dir(d.ax[0]), unroll.dir(d.ax[1])] : [[d.ax[0][0], d.ax[0][2]], [d.ax[1][0], d.ax[1][2]]];
      const s0 = d.s[0], s1 = d.s[1], R = 3 * Math.max(s0, s1);
      for (let j = Math.max(0, Math.floor((P[1] - R - Z0) / px)); j <= Math.min(N - 1, Math.ceil((P[1] + R - Z0) / px)); j++) for (let i = Math.max(0, Math.floor((P[0] - R - X0) / px)); i <= Math.min(N - 1, Math.ceil((P[0] + R - X0) / px)); i++) {
        const x = X0 + (i + 0.5) * px - P[0], z = Z0 + (j + 0.5) * px - P[1], u = x * A[0][0] + z * A[0][1], v = x * A[1][0] + z * A[1][1], e = (u / s0) ** 2 + (v / s1) ** 2;
        if (e < 9) T[j * N + i] *= 1 - Math.min(0.99, d.a * Math.exp(-0.5 * e));
      }
    }
    return { T, N, px, X0, Z0, at: (x, z) => 1 - T[Math.round((z - Z0) / px - 0.5) * N + Math.round((x - X0) / px - 0.5)] };
  };
  // (a line's width: across it at its middle, the run darker than half its peak)
  const width = (R, mid, dir) => { const nx = -dir[1], nz = dir[0]; let peak = 0; const v = []; for (let s = -0.06; s <= 0.06; s += R.px * 0.5) { const d = R.at(mid[0] + nx * s, mid[1] + nz * s); v.push(d); peak = Math.max(peak, d); } return { w: v.filter((d) => d > peak / 2).length * R.px * 0.5, peak }; };
  const across = 40 + 90, alongA = 40;
  const wide = PN.penDeposit([line(across)], plane, spec()).deps, thin = PN.penDeposit([line(alongA)], plane, spec()).deps;
  // (the page's y runs down and lies along +z, so a line at an angle on the page runs at minus that angle in x, z)
  const dirOf = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a), -Math.sin(a)]; };
  const midOf = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a) * 0.15, -Math.sin(a) * 0.15]; };
  const Wd = width(raster(wide, 0.5, 400, [0, 0]), midOf(across), dirOf(across)), Th = width(raster(thin, 0.5, 400, [0, 0]), midOf(alongA), dirOf(alongA));
  ok(`pen: the broad nib is thick moving across its edge (${(Wd.w * 1000).toFixed(1)} mm) and fine along it (${(Th.w * 1000).toFixed(1)} mm): ${(Wd.w / Th.w).toFixed(1)}×`, Wd.w / Th.w > 4);
  ok(`pen: its tone the same whichever way it moves (peaks ${Wd.peak.toFixed(2)} and ${Th.peak.toFixed(2)})`, Math.abs(Wd.peak / Th.peak - 1) < 0.2);
  // (a stroke that crosses itself: a loop; its darkness at the crossing against along its line)
  const loop = []; for (let i = 0; i <= 120; i++) { const t = (i / 120) * Math.PI * 2 * 1.15, r = 80; loop.push(150 + Math.sin(t) * r * 1.4, 150 - Math.sin(2 * t) * r * 0.6, i * 1.2); }
  const lp = (u) => PN.penDeposit([loop], plane, spec({ voice: 0, union: u })).deps;
  const cross = (deps) => { const R = raster(deps, 0.4, 400, [0.15, 0.15]); return { x: R.at(0.15, 0.15), line: R.at(0.262, 0.15) }; };
  const cu = cross(lp(true)), cn = cross(lp(false));
  ok(`pen: where a stroke crosses itself it's no darker than its line (crossing ${cu.x.toFixed(2)} against ${cu.line.toFixed(2)}; without the union ${cn.x.toFixed(2)})`, cu.x <= Math.max(cu.line, 0.3) * 1.15 && cn.x > cu.x + 0.03);
  // (ink: a long stroke pales as the pen runs dry; after a pause it's dipped)
  // (long enough to run the pen low: Autograph dips at a pause only once it's below INK.low)
  const long = [line(0, 45000, 0, 0, 0), line(0, 600, 0, 200, 4000)];
  const dp = PN.penDeposit(long, plane, spec({ voice: 0, dip: true })).deps;
  // (the drawn darkness on the line, where it's drawn: early, late, and the next stroke after the pause)
  const darkAt = (x, z) => { const R = raster(dp.filter((d) => Math.abs(d.p[0] - x) < 0.08 && Math.abs(d.p[2] - z) < 0.08), 0.1, 200, [x, z]); let m = 0; for (let dz = -0.03; dz <= 0.03; dz += 0.0005) m = Math.max(m, R.at(x, z + dz)); return m; };
  const early = darkAt(0.6, 0), late = darkAt(43.5, 0), dipped = darkAt(0.4, 0.2);
  ok(`pen: ink runs out along a long stroke (darkness ${early.toFixed(2)} → ${late.toFixed(2)}) and is dipped at a pause (${dipped.toFixed(2)})`, late < early * 0.85 && dipped > late * 1.1);
  // (the same broad strokes wrapped round a cylinder: widths measured unrolled)
  const r = 0.12, cyl = PN.cylinderMap([0, 0.3, 0], r, 0, k);
  // (unrolled: round the circumference as x, down from the top as z, as the page was laid)
  const unroll = Object.assign((p) => [Math.atan2(p[0], p[2]) * r, 0.3 - p[1]], { dir: (d) => [Math.hypot(d[0], d[2]) * Math.sign(d[0] + d[2] * 0 || d[0]), -d[1]] });
  const cw = PN.penDeposit([line(across)], cyl, spec()).deps, ct = PN.penDeposit([line(alongA)], cyl, spec()).deps;
  const Cw = width(raster(cw, 0.5, 400, [0, 0], unroll), midOf(across), dirOf(across)), Ct = width(raster(ct, 0.5, 400, [0, 0], unroll), midOf(alongA), dirOf(alongA));
  ok(`pen: on a cylinder the nib keeps its character (${(Cw.w * 1000).toFixed(1)} mm across, ${(Ct.w * 1000).toFixed(1)} mm along: ${(Cw.w / Ct.w).toFixed(1)}×, on the plane ${(Wd.w / Th.w).toFixed(1)}×)`, Cw.w / Ct.w > 4 && Math.abs(Cw.w / Wd.w - 1) < 0.2);
}
// (the pen as a brush material: on a flat surface its nib keeps one orientation however the path turns, where an inked
// stroke's marks follow the path; the same instructions give the same marks)
{
  const B = await load('../client/splats/brush.ts');
  const pts = Array.from({ length: 80 }, (_, i) => { const t = (i / 79) * Math.PI * 1.5; return [Math.cos(t) * 0.2, 0, Math.sin(t) * 0.2]; });
  const mk = (material) => B.stroke({ pts, normals: pts.map(() => [0, 1, 0]) }, { width: 0.012 }, { key: `pen-test-${material}`, material, ...(material === 'pen' ? {} : {}) });
  const pe = mk('pen'); pe.pen = { voice: 1, pace: 10 };
  const dp = B.deposit(pe), di = B.deposit(mk('ink'));
  const spread = (ds) => { let m = 0; for (const d of ds) m = Math.max(m, 1 - Math.abs(B.dot(d.ax[0], ds[0].ax[0]))); return m; };
  const again = B.deposit(pe);
  ok(`pen material: its nib keeps one orientation on a flat surface (spread ${spread(dp).toFixed(4)}), an inked stroke's marks follow the path (${spread(di).toFixed(2)}); deterministic`, spread(dp) < 1e-6 && spread(di) > 0.5 && dp.length > 20 && again.length === dp.length && again.every((d, i) => d.p.every((v, j) => v === dp[i].p[j])));
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
