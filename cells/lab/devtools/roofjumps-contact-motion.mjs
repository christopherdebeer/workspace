// A motion contact sheet a character, for art direction: real runs (so what hangs loose moves: a skirt's cloth, a coat's, a
// ponytail, a bag), each scene eight frames through it, seen from behind, the side and the front, in a look (stroke-gouache by
// default). One PNG a character, into devtools/out/contact/motion-<name>.png.
//   node cells/lab/devtools/roofjumps-contact-motion.mjs [look] [character,character…]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { withWood } = await import('./harness.mjs');
const look = process.argv[2] ?? 'stroke-gouache', only = process.argv[3]?.split(',');
const CHARS = only ?? ['runner', 'teen', 'child', 'broad', 'slight', 'older', 'schoolgirl'];
// (scene, from s, every s: eight frames)
const SCENES = [['drop-rebound', 0.5, 0.42], ['long-drop', 1.0, 0.3], ['sharp-turns', 0.5, 0.55], ['vault-angles', 0.6, 0.62], ['hang-intents', 0.6, 0.72]];
const VIEWS = [['behind', 0], ['side', 90], ['front', 180]], COLS = 8, CW = 200, CH = 260;
const OUT = new URL('./out/contact/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
await withWood(async (lab) => {
  for (const c of CHARS) {
    const rows = [];
    for (const [scene, from, every] of SCENES) for (const [view, side] of VIEWS) {
      const path = `${OUT}m-${c}-${scene}-${view}.png`;
      const p = await lab.open(`scene=${scene}&strip=${from}&frames=${COLS}&every=${every}&cols=${COLS}&holds=0&marks=0&look=${look}&character=${c}&side=${side}&zoom=1.7`, { width: CW * COLS, height: CH, dpr: 1 });
      for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
      await p.waitForTimeout(800); await p.screenshot({ path }); await p.close();
      rows.push([path, `${scene} - ${view}`]);
    }
    execFileSync('python3', ['-I', '-c', `
import sys, json
from PIL import Image, ImageDraw
rows = json.loads(sys.argv[1]); out = sys.argv[2]; title = sys.argv[3]
ims = [Image.open(p).convert('RGB') for p, _ in rows]; W = ims[0].width; H = ims[0].height; lab = 22; head = 40
sheet = Image.new('RGB', (W, head + len(ims) * (H + lab)), (236, 231, 223)); d = ImageDraw.Draw(sheet)
d.text((12, 14), title, fill=(30, 30, 34))
for i, (im, (_, label)) in enumerate(zip(ims, rows)):
    y = head + i * (H + lab); d.text((10, y + 5), label, fill=(70, 60, 50)); sheet.paste(im, (0, y + lab))
sheet.save(out)
`, JSON.stringify(rows), `${OUT}motion-${c}.png`, `${c} - ${look} - in motion: five scenes, each from behind, the side and the front`]);
    console.log(`motion sheet: ${c}`);
  }
});
