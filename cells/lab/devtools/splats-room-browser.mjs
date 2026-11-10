// The taught room drawn by the real renderer (node cells/lab/devtools/splats-room-browser.mjs): each of the six route
// views, as taught (static/splats/room-taught.json: roles and weights), without the water's mirror, at the size the
// fitter worked at; read back as darkness into devtools/out/room/browser.json, and compared with the fitter's own
// picture of the same level (fit-<view>-roles + weights.png): mean ink, and tone apart.
import { withWood } from './harness.mjs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/room/', import.meta.url).pathname, out = {};
await withWood(async (wood) => {
  const page = await wood.open('scene=room&res=1&clean&mirror=0&style=taught');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'room' && window.__splats.drawn > 0, null, { timeout: 240000 });
  const st = await page.evaluate(() => window.__splats.room.state); console.log('the room as', st.mode, st.n, 'deposits');
  for (const v of Object.keys(st.views)) { await page.evaluate((v) => window.__splats.room.view(v), v); await page.waitForTimeout(2500); const g = await page.evaluate(() => { const g = window.__splats.grab(); return { w: g.w, h: g.h, D: g.D }; }); out[v.replace(/ /g, '-')] = g; }
}, { width: 384, height: 256 });
writeFileSync(`${dir}browser.json`, JSON.stringify(out));
console.log(execFileSync('python3', ['-c', `
import json, numpy as np
from PIL import Image, ImageFilter
B = json.load(open('${dir}browser.json'))
blur = lambda a, r: np.asarray(Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255
for v, g in B.items():
  b = np.array(g['D'], np.float32).reshape(g['h'], g['w'])
  f = np.asarray(Image.open('${dir}fit-' + v + '-roles + weights.png').convert('RGB'), np.float32)[..., 1] / 255; f = np.clip((0.906 - f) / (0.906 - 0.12), 0, 1)
  tone = np.mean([((blur(b, r) - blur(f, r)) ** 2).mean() for r in (1, 2.5, 5)]) * 1000
  print(f'{v:28s} the browser lays x{b.mean() / max(1e-9, f.mean()):.3f} of the fitter\\'s ink; tone apart {tone:.3f}')
`]).toString());
