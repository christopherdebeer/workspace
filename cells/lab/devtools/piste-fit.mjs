// How the collision body (fencer.ts capsules) sits inside the dressed figure (look/athlete.ts), measured: the athlete is
// posed and skinned on the CPU exactly as the shader does it, and for each capsule the dressed surface's distance from
// the capsule's axis is taken over the vertices that belong to it (by their main bone, along the capsule's length). It
// prints, per capsule, the capsule's radius against the surface (10th, 50th, 90th percentile), and for the trunk its
// section (half-depth and half-width, and which way is wide). (node cells/lab/devtools/piste-fit.mjs [lunge])
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './look/athlete'; export * from './v3'; export * from './intent';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { Bout, EPEE, buildAthlete, boneFrames, skinMatrices, BONES, SKIN_STRIDE, idle } = M;
const lunge = process.argv.includes('lunge');
const b = new Bout({ weapon: EPEE, to: 5, referee: false }); b.place(2);
const f = b.fencers[0];
for (let i = 0; i < 90; i++) { f.intent = { ...idle(), extend: lunge ? 1 : 0.45, lunge }; b.fencers[1].intent = idle(); b.advance(1 / 60); }
const A = buildAthlete(), mats = new Float32Array(BONES * 16);
skinMatrices(boneFrames(f), A.bind, mats);
const n = A.verts.length / SKIN_STRIDE, P = [], bone = [];
for (let v = 0; v < n; v++) {
  const o = v * SKIN_STRIDE, p = [A.verts[o], A.verts[o + 1], A.verts[o + 2]], q = [0, 0, 0];
  let best = 0, bw = -1;
  for (let k = 0; k < 4; k++) { const bi = A.verts[o + 12 + k], w = A.verts[o + 16 + k]; if (w > bw) { bw = w; best = bi; } const m = bi * 16; for (let r = 0; r < 3; r++) q[r] += w * (mats[m + r] * p[0] + mats[m + 4 + r] * p[1] + mats[m + 8 + r] * p[2] + mats[m + 12 + r]); }
  P.push(q); bone.push(best);
}
// which bones dress which capsule (fencer.capsules order)
const OWN = { 15: [0, 1], 16: [0, 1], 0: [0, 1], 1: [1], 2: [2], 3: [1], 4: [3], 5: [4], 6: [5], 7: [6], 8: [7], 9: [9], 10: [10], 11: [12], 12: [13], 13: [11], 14: [14] };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
console.log(lunge ? 'pose: lunge' : 'pose: en garde, arm at carriage');
f.capsules.forEach((c, i) => {
  const ab = c.b.map((x, k) => x - c.a[k]), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, d = [];
  P.forEach((p, v) => { if (!OWN[i].includes(bone[v])) return; const t = ((p[0] - c.a[0]) * ab[0] + (p[1] - c.a[1]) * ab[1] + (p[2] - c.a[2]) * ab[2]) / L2; if (t < 0.1 || t > 0.9) return; const q = c.a.map((x, k) => x + ab[k] * t); d.push({ r: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), rc: c.ra + (c.rb - c.ra) * t, off: p.map((x, k) => x - q[k]) }); });
  if (!d.length) return console.log(String(i).padStart(2), c.part.padEnd(6), 'no vertices');
  const diff = d.map((x) => x.r - x.rc);
  console.log(String(i).padStart(2), c.part.padEnd(6), `r ${c.ra.toFixed(3)}→${c.rb.toFixed(3)}`, `surface − capsule: p10 ${pct(diff, 0.1).toFixed(3)} p50 ${pct(diff, 0.5).toFixed(3)} p90 ${pct(diff, 0.9).toFixed(3)}  (n ${d.length})`);
  if (i === 0) {
    // the trunk's section: extent along the fencer's forward (f) and right (r) axes
    const F = f.frame, along = (x, ax) => x.off[0] * ax[0] + x.off[1] * ax[1] + x.off[2] * ax[2];
    const fs = d.map((x) => along(x, F.f)), rs = d.map((x) => along(x, F.r));
    console.log('    trunk section: along forward', pct(fs, 0.05).toFixed(3), '..', pct(fs, 0.95).toFixed(3), '| along right', pct(rs, 0.05).toFixed(3), '..', pct(rs, 0.95).toFixed(3));
  }
});

// Measure clearance from all contact volumes. A shoulder vertex may already be covered by the adjoining upper arm.
const shoulder = [];
for (let v = 0; v < n; v++) {
  const k = v * SKIN_STRIDE, height = A.verts[k + 1] - A.bind[0].o[1];
  if (height < 0.34 || height > 0.51 || A.verts[k+9] !== 15 || ![1,3,6].includes(bone[v])) continue;
  const p = P[v];
  const clearance = Math.min(...f.capsules.map(c => {
    const axis = M.sub(c.b,c.a);
    const t = Math.max(0,Math.min(1,M.dot(M.sub(p,c.a),axis)/Math.max(1e-9,M.dot(axis,axis))));
    return M.len(M.sub(p,M.madd(c.a,axis,t))) - (c.ra+(c.rb-c.ra)*t);
  }));
  shoulder.push({p,clearance});
}
const clearances = shoulder.map(v=>v.clearance);
console.log('Shoulder clearance from the full body, cm:', [0.5,0.9,0.99].map(q=>(100*pct(clearances,q)).toFixed(2)));
const mapPath = process.argv.find(a=>a.startsWith('--map='))?.slice(6);
if (mapPath) {
  const { writeFileSync } = await import('node:fs');
  const cx = f.capsules[1].a;
  const marks = shoulder.slice().sort((a,b)=>a.p[0]-b.p[0]).map(({p,clearance})=>{
    const x=220+850*(p[2]-cx[2]), y=150-850*(p[1]-cx[1]);
    const color=clearance<=0?'#526b69':clearance<0.02?'#dda649':'#ca4e45';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="${color}"/>`;
  });
  writeFileSync(mapPath,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 270"><rect width="440" height="270" fill="white"/>${marks.join('')}<text x="12" y="252" font-size="13">Green: covered · Amber: 0–2 cm outside · Red: over 2 cm</text></svg>`);
}
