// Piste's athletes, timed (node cells/lab/devtools/piste-athlete-ms.mjs): two stand-ins fence; each frame, as the
// renderer does, each fencer is posed (its joints' skinning matrices, and its secondary motion: the springs that swing
// the hem and the sleeves) and both weapons are built on the CPU. The figures themselves are built once and skinned on
// the GPU, so nothing else of them costs the CPU a frame. Prints mean and 95th percentile ms a frame for each part.
import { build } from 'esbuild';
const lab = new URL('../client/piste/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './bout'; export * from './weapons'; export * from './ai'; export * from './look/figure'; export * from './look/mesh'; export * from './look/athlete';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const t0 = performance.now(), athlete = M.buildAthlete(), buildMs = performance.now() - t0;
const b = new M.Bout({ weapon: M.EPEE, to: 5 }), ai = [new M.Opponent(b, 0, M.SPARRING, 3), new M.Opponent(b, 1, M.SPARRING, 4)];
const sec = b.fencers.map(() => new M.Secondary()), bones = [new Float32Array(M.BONES * 16), new Float32Array(M.BONES * 16)], m = new M.Mesh();
const joints = [], springs = [], weapons = [];
for (let i = 0; i < 60 * 30; i++) {
  for (const k of [0, 1]) b.fencers[k].intent = { ...ai[k].intent(1 / 60) };
  b.advance(1 / 60); b.drain();
  const a = performance.now();
  b.fencers.forEach((f, k) => M.skinMatrices(M.boneFrames(f), athlete.bind, bones[k]));
  const c = performance.now();
  b.fencers.forEach((f, k) => sec[k].update(f, b.t));
  const d = performance.now();
  m.reset(); b.fencers.forEach((f, k) => M.weapon(m, f, k));
  const e = performance.now();
  if (i > 120) { joints.push(c - a); springs.push(d - c); weapons.push(e - d); }
}
const stat = (xs) => { const s = [...xs].sort((p, q) => p - q); return `mean ${(s.reduce((x, y) => x + y, 0) / s.length).toFixed(3)} ms, 95th ${s[Math.floor(s.length * 0.95)].toFixed(3)} ms`; };
console.log(`athlete built once in ${buildMs.toFixed(1)} ms: ${athlete.verts.length / M.SKIN_STRIDE} vertices, ${athlete.count / 3} triangles (indexed, on the GPU)`);
console.log(`both fencers, a frame — joints (skinning matrices): ${stat(joints)}`);
console.log(`both fencers, a frame — secondary motion (hem and sleeve springs, the cloth's replacement): ${stat(springs)}`);
console.log(`both fencers, a frame — weapons built on the CPU: ${stat(weapons)}; ${m.n / 3} triangles`);
