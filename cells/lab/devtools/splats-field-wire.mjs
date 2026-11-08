// Wireframes of the composed scene, to be restyled (node cells/lab/devtools/splats-field-wire.mjs): the scene's real
// geometry from several views, each with its camera, at the reference studies' size (1024 × 683), for an image model
// to redraw in ink and wash *without moving anything*. Redrawn, each is a teacher the fitted field can learn from
// directly (splats-field-redrawn.py <image> <view>). Writes devtools/out/field/wire-mesh.json (the meshes, the seam,
// the culms' nodes, the cameras), then devtools/splats-field-wire.py draws devtools/out/field/wire-<view>.png and
// wires.json.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const SU = await load('../client/splats/subjects.ts'), ST = await load('../client/splats/stone.ts');
const sc = SU.composedScene('wash', true), R = SU.REF_CAM, W = 1024, H = 683, fov = (50 * Math.PI) / 180;
// (the views: the reference camera, two steps either side of it, and one from higher)
const VIEWS = [['ref', 0, 0.24, 1], ['left', -0.45, 0.24, 1], ['right', 0.45, 0.24, 1], ['far-left', -0.9, 0.3, 1.1], ['far-right', 0.9, 0.3, 1.1], ['high', 0, 0.55, 1.1]];
const cams = VIEWS.map(([name, dy, pitch, k]) => {
  const yaw = R.yaw + dy, dist = R.dist * k, cp = Math.cos(pitch), t = R.target;
  return { name, yaw, pitch, dist, target: [...t], eye: [t[0] + Math.sin(yaw) * cp * dist, t[1] + Math.sin(pitch) * dist, t[2] + Math.cos(yaw) * cp * dist], fov, up: 1, w: W, h: H };
});
// (feature lines the meshes don't carry: the stone's seam, each culm's nodes)
const lines = [{ name: 'seam', pts: ST.stoneShape().seam }];
for (const key of ['culm-front', 'culm-back', 'culm-far']) {
  const { p, r, h } = SU.PLACES[key], nodes = [0.3, 0.62, 0.95, 1.27, 1.56, 1.85, 2.14].map((y) => (y * h) / 1.7).filter((y) => y < h - 0.08);
  for (const y of nodes) lines.push({ name: `${key} node`, pts: Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [p[0] + Math.cos(a) * r * 1.02, y, p[2] + Math.sin(a) * r * 1.02]; }) });
}
// (the corner's niche: only drawn, not meshed, so its four edges from the scene's own strokes)
for (const e of sc.elements) if (e.kind === 'stroke' && /niche\/(top|left|right|sill)$/.test(e.key)) lines.push({ name: 'niche', pts: e.path.pts });
mkdirSync(new URL('./out/field/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/field/wire-mesh.json', import.meta.url), JSON.stringify({ tris: Array.from(sc.occluder, (v) => +v.toFixed(4)), objects: Array.from(sc.objects), lines, cams }));
console.log(`${sc.occluder.length / 9} triangles, ${lines.length} feature lines, ${cams.length} views`);
execFileSync('python3', [new URL('./splats-field-wire.py', import.meta.url).pathname], { stdio: 'inherit' });
