// A contact sheet a character, in a look (stroke-gouache by default), for art direction: a turnaround (stand, run, hang, each
// from five angles) over a motion sheet (six moves through their motion). One PNG a character, into devtools/out/contact/.
//   node cells/lab/devtools/roofjumps-contact.mjs [look] [character,character…]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { withWood } = await import('./harness.mjs');
const look = process.argv[2] ?? 'stroke-gouache', only = process.argv[3]?.split(',');
const CHARS = (only ?? ['runner', 'teen', 'child', 'broad', 'slight', 'older']);
const TURN = ['stand', 'run', 'hang'], ANGLES = [20, 70, 120, 200, 290], MOTION = ['run', 'vault', 'land', 'climb', 'roll', 'flip'];
const OUT = new URL('./out/contact/', import.meta.url).pathname, CELL = 300;
mkdirSync(OUT, { recursive: true });
const shot = async (lab, q, rows, path) => {
  const p = await lab.open(q, { width: CELL * 5, height: CELL * rows, dpr: 1 });
  await p.waitForTimeout(1500); await p.screenshot({ path }); await p.close();
};
await withWood(async (lab) => {
  for (const c of CHARS) {
    const tmp = `${OUT}${c}-`;
    for (const a of ANGLES) await shot(lab, `sheet=${TURN.join(',')}&side=${a}&zoom=1.7&look=${look}&character=${c}`, TURN.length, `${tmp}turn${a}.png`);
    await shot(lab, `sheet=${MOTION.join(',')}&side=60&zoom=1.7&look=${look}&character=${c}`, MOTION.length, `${tmp}motion.png`);
    // (composed: the turnaround's middle column of each angle side by side, labelled by angle, over the motion sheet)
    execFileSync('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageDraw
c, tmp, out, cell = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
angles = [int(a) for a in sys.argv[5].split(',')]; rows = int(sys.argv[6]); title = sys.argv[7]
motion = Image.open(tmp + 'motion.png').convert('RGB')
W = motion.width; head = 44
sheet = Image.new('RGB', (W, head + rows * cell + 34 + motion.height), (236, 231, 223))
d = ImageDraw.Draw(sheet)
d.text((12, 14), title, fill=(30, 30, 34))
for i, a in enumerate(angles):
    t = Image.open(tmp + 'turn%d.png' % a).convert('RGB')
    for r in range(rows):
        sheet.paste(t.crop((2 * cell, r * cell, 3 * cell, (r + 1) * cell)), (i * cell, head + r * cell))
    d.text((i * cell + 8, head + 18), 'view %d deg' % a, fill=(90, 80, 70))
y = head + rows * cell
d.text((12, y + 10), 'motion (side 60): through each move', fill=(30, 30, 34))
sheet.paste(motion, (0, y + 34))
sheet.save(out)
`, c, tmp, `${OUT}contact-${c}.png`, String(CELL), ANGLES.join(','), String(TURN.length), `${c} - ${look} - turnaround (stand, run, hang) and motion`]);
    console.log(`contact sheet: ${c}`);
  }
});
