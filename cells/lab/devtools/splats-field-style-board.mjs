// A style's fitted field against its teachers (node cells/lab/devtools/splats-field-style-board.mjs <style> [style…]):
// the field fitted to an image model's restyle of the six wireframe views (?scene=field&field=composed-<style>), drawn
// by the real renderer from each of those views beside the drawing it learned from, then from three views no drawing
// covered: halfway between the reference and the right, from behind, and from low down
// (devtools/out/field-style-<style>.png).
import { withWood } from './harness.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const styles = process.argv.slice(2), dir = new URL('./out/field/', import.meta.url).pathname;
const wires = JSON.parse(readFileSync(`${dir}wires.json`)), ref = wires.find((w) => w.name === 'ref');
const novel = [['between ref and right', ref.yaw + 0.22, 0.24, ref.dist], ['behind', ref.yaw + Math.PI, 0.3, ref.dist * 1.1], ['low', ref.yaw - 0.2, 0.06, ref.dist]];
await withWood(async (wood) => {
  for (const style of styles) {
    const page = await wood.open(`scene=field&field=composed-${style}&res=1&clean`);
    page.on('pageerror', (e) => console.log('page error', e.message));
    await page.waitForFunction(() => window.__splats.scene?.name === 'field' && window.__splats.drawn > 0, null, { timeout: 180000 });
    const rows = [];
    for (const w of wires) {
      await page.evaluate((c) => window.__splats.camera(c), { yaw: w.yaw, pitch: w.pitch, dist: w.dist, target: w.target, fov: w.fov }); await page.waitForTimeout(1800);
      // (a pooled field's drawings: its first execution's, for comparison)
      const t = new URL(`./field-teachers/${style.replace(/-(shape|fixed)$/, '').replace(/-pooled$/, '')}/${w.name}.jpg`, import.meta.url).pathname;
      rows.push([w.name, existsSync(t) ? t : '', await wood.shot(page, `field-style-${style}-${w.name}`)]);
    }
    for (const [nm, yaw, pitch, dist] of novel) {
      await page.evaluate((c) => window.__splats.camera(c), { yaw, pitch, dist, target: ref.target, fov: ref.fov }); await page.waitForTimeout(1800);
      rows.push([`${nm} (no drawing)`, '', await wood.shot(page, `field-style-${style}-${nm.replace(/ /g, '-')}`)]);
    }
    await page.close();
    execFileSync('python3', ['-c', `
import json, sys
from PIL import Image, ImageDraw
rows = json.loads(sys.argv[1]); W, H = 384, 256
sheet = Image.new('RGB', (W * 2 + 6, (H + 22) * len(rows)), (40, 40, 40)); d = ImageDraw.Draw(sheet)
for i, (nm, t, f) in enumerate(rows):
  y = i * (H + 22)
  if t: sheet.paste(Image.open(t).convert('RGB').resize((W, H)), (0, y))
  sheet.paste(Image.open(f).convert('RGB').resize((W, H)), (W + 6, y))
  d.text((6, y + H + 5), ('drawn · ' + nm) if t else '', fill=(220, 220, 220)); d.text((W + 12, y + H + 5), 'field · ' + nm, fill=(220, 220, 220))
sheet.save(sys.argv[2])`, JSON.stringify(rows), new URL(`./out/field-style-${style}.png`, import.meta.url).pathname]);
    console.log(`devtools/out/field-style-${style}.png`);
  }
}, { width: 384, height: 256 });
