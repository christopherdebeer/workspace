// Study frames a character, for the painted look's detail and expressiveness: a few large, clean frames (no labels on them),
// each a moment chosen from a real run of the character's own (so cloth and hair are in motion), from the view that says the
// most about it. Bases for image-generation studies of how stroke-gouache should paint a figure. Into devtools/out/studies/:
// <character>/<nn>-<moment>.png (1024 x 1280), an overview with labels (for people, not a base), and index.md (what each is
// for).
//   node cells/lab/devtools/roofjumps-studies.mjs [look] [character,character…]
process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out0 = await build({ stdin: { contents: `export * from './scenes'; export * from './character';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { SCENES, runScene, CHARACTERS } = await import('data:text/javascript;base64,' + Buffer.from(out0.outputFiles[0].text).toString('base64'));
const { withWood } = await import('./harness.mjs');
const look = process.argv[2] ?? 'stroke-gouache', only = process.argv[3]?.split(',');
const chars = CHARACTERS.filter((c) => !only || only.includes(c.name));
const OUT = new URL('./out/studies/', import.meta.url).pathname, W = 1024, H = 1280;
const scene = (k) => SCENES.find((s) => s.key === k);

/** each moment: where in which scene, the view, and what it's for as a study */
function moments(c) {
  const dr = runScene(scene('drop-rebound'), 1, c), hi = runScene(scene('hang-intents'), 1, c), va = runScene(scene('vault-angles'), 1, c);
  const up = dr.ups[0], ld = dr.lands[0];
  const drive = dr.frames.find((f) => f.t > 0.7 && f.state === 'ground' && f.move === 'run' && f.fl !== f.fr && f.speed > 8) ?? dr.frames[90];
  const hang = hi.frames.find((f) => f.state === 'climb') ?? hi.frames[400], vault = va.frames.find((f) => f.move === 'vault') ?? va.frames[150];
  const m = [];
  m.push({ name: 'stand-front', study: 'stand', side: 200, zoom: 1.6, for: 'the figure at rest, facing: proportion, the face and hair as masses, clothes as planes, how few marks hold a standing figure together' });
  m.push({ name: 'stand-side', study: 'stand', side: 105, zoom: 1.6, for: 'the profile: the line of the back, the weight over the feet, what the silhouette alone says' });
  m.push({ name: 'stand-back', study: 'stand', side: 20, zoom: 1.6, for: 'from behind, as the game mostly sees it: hair, collar, the back of the clothes, how the figure reads against the city' });
  m.push({ name: 'drive', scene: 'drop-rebound', t: drive.t, side: 95, zoom: 2.0, for: 'the run from the side: one foot down, the other driving through; arm and leg opposed; cloth lagging; the stride as a single gesture' });
  if (up) m.push({ name: 'takeoff', scene: 'drop-rebound', t: up.t - 1 / 60, side: 35, zoom: 2.0, for: 'the last contact before a leap, from behind and to one side: the push leg long, the body tipped into the air, the loaded instant' });
  if (up && ld) m.push({ name: 'flight', scene: 'drop-rebound', t: (up.t + ld.t) / 2, side: 20, zoom: 2.0, for: 'in the air from behind (the references\' own view): arms out, the clothes and hair answering the air; a figure that is all motion against the city' });
  if (ld) m.push({ name: 'landing', scene: 'drop-rebound', t: ld.t + 0.08, side: 150, zoom: 2.0, for: 'the landing\'s compression from the front: knees taking the weight, arms balancing, the cloth still falling' });
  m.push({ name: 'hang', scene: 'hang-intents', t: hang.t + 0.8, side: 25, zoom: 3.4, for: 'hanging from a hold on a face: the long body, the hands closed on the hold, legs hanging; the figure against a wall' });
  m.push({ name: 'vault', scene: 'vault-angles', t: vault.t + 0.1, side: 80, zoom: 2.0, for: 'over an obstacle on a planted hand, from the side: the body folded over the hand, the legs tucked or swung, contact as the point of the picture' });
  return m;
}

await withWood(async (wd) => {
  const index = [`# Study frames (${look})`, '', 'Bases for image-generation studies of how the painted look should render a figure: one frame each, large, no labels on it, a moment chosen from a real run (cloth and hair in motion) and the view that says the most about it. Each line: the file, the moment, and what it is for.', ''];
  for (const c of chars) {
    const dir = `${OUT}${c.name}/`; mkdirSync(dir, { recursive: true });
    const ms = moments(c), made = [];
    index.push(`## ${c.name}: ${c.title}`, '');
    for (const [i, m] of ms.entries()) {
      const q = m.study ? `study=${m.study}&mu=0.5` : `scene=${m.scene}&strip=${m.t.toFixed(3)}&frames=1&every=0.1&cols=1`;
      const file = `${String(i + 1).padStart(2, '0')}-${m.name}.png`;
      const p = await wd.open(`${q}&holds=0&marks=0&look=${look}&character=${c.name}&side=${m.side}&zoom=${m.zoom}&preview`, { width: W, height: H, dpr: 1 });
      for (let k = 0; k < 120 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; k++) await p.waitForTimeout(250);
      await p.waitForTimeout(1200); await p.screenshot({ path: dir + file }); await p.close();
      made.push([dir + file, m.name]);
      index.push(`- \`${c.name}/${file}\`: ${m.name}${m.t !== undefined ? ` (${m.scene}, ${m.t.toFixed(2)} s)` : ''}, view ${m.side} deg. ${m.for}.`);
    }
    index.push('');
    execFileSync('python3', ['-I', '-c', `
import sys, json
from PIL import Image, ImageDraw
items = json.loads(sys.argv[1]); out = sys.argv[2]; title = sys.argv[3]
tw, th = 256, 320; cols = len(items); lab = 22
sheet = Image.new('RGB', (cols * tw, th + lab + 34), (236, 231, 223)); d = ImageDraw.Draw(sheet); d.text((10, 10), title, fill=(30, 30, 34))
for i, (p, name) in enumerate(items):
    sheet.paste(Image.open(p).convert('RGB').resize((tw, th)), (i * tw, 34)); d.text((i * tw + 8, 34 + th + 4), name, fill=(70, 60, 50))
sheet.save(out)
`, JSON.stringify(made), `${OUT}overview-${c.name}.png`, `${c.name} (${look}): study frames (overview; the frames themselves carry no labels)`]);
    console.log(`studies: ${c.name}`);
  }
  writeFileSync(`${OUT}index.md`, index.join('\n') + '\n');
});
