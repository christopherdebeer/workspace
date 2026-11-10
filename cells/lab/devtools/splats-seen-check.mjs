// A limb whose band is as it's seen (node cells/lab/devtools/splats-seen-check.mjs): a level limb looked at from
// either side, from above and from below; for each, how much of its ink lies in the lower half of the limb as seen.
import { build } from 'esbuild';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const M = await load('../client/splats/marks.ts');
const m = M.strokeMark(5, [[-2, 2, 0], [0, 2, 0], [2, 2, 0]], 'tube', 0.4, 480, 24); m.band = 'seen';
const deps = M.layout(m).filter((d) => Math.abs(d.p[0]) < 0.5);
for (const [name, eye] of [['from +z, level', [0, 2, 6]], ['from -z, level', [0, 2, -6]], ['from +z, 40° above', [0, 2 + 4.6, 5.5]], ['from +z, 40° below', [0, 2 - 4.6, 5.5]]]) {
  const d = [eye[0], eye[1] - 2, eye[2]], l = Math.hypot(...d), dir = d.map((v) => v / l), upS = [0 - dir[1] * dir[0], 1 - dir[1] * dir[1], 0 - dir[1] * dir[2]], ul = Math.hypot(...upS), us = upS.map((v) => v / ul);
  let low = 0, all = 0, n = 0; for (const q of deps) { const facing = q.n[0] * dir[0] + q.n[1] * dir[1] + q.n[2] * dir[2]; if (facing < 0.05) continue; const a = M.inkOf(q, eye), v = q.n[0] * us[0] + q.n[1] * us[1] + q.n[2] * us[2]; all += a; if (v < 0) low += a; n++; }
  console.log(`${name.padEnd(22)} ${n} deposits facing the eye; ${(100 * low / all).toFixed(0)}% of their ink in the lower half as seen; mean ink ${(all / n).toFixed(2)}`);
}
