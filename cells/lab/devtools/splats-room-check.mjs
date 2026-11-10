// The room built in node (node cells/lab/devtools/splats-room-check.mjs): how many marks and deposits, by region, and
// that every deposit is a finite splat.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts');
const t0 = Date.now(), room = C.conservatory({}), s = M.marksToSplats(room.marks);
let bad = 0; for (let i = 0; i < s.n * 3; i++) if (!Number.isFinite(s.pos[i]) || !Number.isFinite(s.scale[i])) bad++;
console.log(`${room.marks.length} marks, ${s.n} deposits drawn of ${room.marks.reduce((a, m) => a + m.count, 0)} laid (${JSON.stringify(room.regions)}), ${bad} not finite; built in ${Date.now() - t0} ms`);
if (bad) process.exit(1);
