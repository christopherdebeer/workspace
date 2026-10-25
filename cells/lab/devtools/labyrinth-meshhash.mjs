// The labyrinth's drawing, as numbers (node cells/lab/devtools/labyrinth-meshhash.mjs [--save=FILE] [--check=FILE]):
// every story built and meshed in each tradition, and a hash of what's drawn (the triangles and the marks). A change
// to how the mesh is made that shouldn't change what's drawn (moving code between files) is checked against the
// hashes saved before it: `--save` writes them, `--check` compares and says which story and tradition differ.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.includes('=') ? a.slice(a.indexOf('=') + 1) : true]));
const { story } = await load('../client/labyrinth/demo.ts');
const ME = await load('../client/labyrinth/mesh.ts');
const RG = await load('../client/labyrinth/regions.ts');
const traditions = opt.traditions ? String(opt.traditions).split(',') : ['mediterranean', 'persian'];
const out = {};
for (const t of traditions) {
  RG.setRegions(t);
  for (let s = 1; s <= 16; s++) {
    ME.forgetGround();
    const w = story(s), m = ME.buildMesh(w);
    const h = createHash('sha1');
    h.update(Buffer.from(m.data.buffer, m.data.byteOffset, m.count * ME.STRIDE * 4));
    h.update(Buffer.from(m.strokes.buffer, m.strokes.byteOffset, m.strokes.byteLength));
    if (m.ground) h.update(Buffer.from(m.ground.buffer, m.ground.byteOffset, m.ground.byteLength));
    out[`${t}:${s}`] = `${h.digest('hex').slice(0, 16)}:${m.count}`;
  }
}
if (opt.save) { writeFileSync(opt.save, JSON.stringify(out, null, 1)); console.log(`saved ${Object.keys(out).length} hashes to ${opt.save}`); }
if (opt.check) {
  const was = JSON.parse(readFileSync(opt.check, 'utf8'));
  const differ = Object.keys(out).filter((k) => was[k] !== out[k]);
  for (const k of differ) console.log(`differs  ${k}: ${was[k]} → ${out[k]}`);
  console.log(differ.length ? `${differ.length} of ${Object.keys(out).length} differ` : `all ${Object.keys(out).length} the same`);
  process.exitCode = differ.length ? 1 : 0;
}
if (!opt.save && !opt.check) console.log(out);
