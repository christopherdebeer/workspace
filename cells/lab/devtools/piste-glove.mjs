// Piste's own hand, close (node cells/lab/devtools/piste-glove.mjs): the first-person view at phone size (dpr 2),
// cropped to the bell, in the guard, at the reach, and through the study's wrist roll; beside the hand-construction
// clip's grip pose (if its frames have been fetched) and the targets' hands. Writes devtools/out/glove-strip.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const { withWood } = await import('./harness.mjs');
const OUT = new URL('./out/', import.meta.url).pathname;
const TARGETS = '/root/.claude/uploads/d7be4694-5f20-5a44-a137-1af6948e984d/';
const CLIP = '/home/user/workspace/cells/lab/devtools/out/refs/ychive-hands/source.mp4';
const views = [['guard', 'study&t=0.8&still'], ['reach', 'auto&t=6.43&still'], ['roll: before', 'study&t=1.9&still'], ['roll: turning', 'study&t=2.7&still'], ['roll: rolled', 'study&t=3.4&still']];
// (the bell's corner of the screen, in CSS px)
const clip = { x: 170, y: 574, width: 220, height: 270 };
await withWood(async (lab) => {
  const shots = [], labels = [];
  for (const [label, q] of views) {
    const page = await lab.open(q, { width: 390, height: 844, dpr: 2 });
    await page.waitForTimeout(1500);
    const path = join(OUT, `glove-${label.replace(/[^a-z]+/g, '-')}.png`);
    await page.screenshot({ path, clip, timeout: 300000 });
    shots.push(path); labels.push(label); await page.close();
  }
  // the references, cropped: a page draws the image's corner
  const crop = async (src, box, name) => {
    const page = await lab.open('menu', { width: 390, height: 844 });
    const [x, y, w, h] = box;
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<body style="margin:0;width:${w}px;height:${h}px;background:url(data:image/png;base64,${readFileSync(src).toString('base64')}) -${x}px -${y}px no-repeat"></body>`);
    const path = join(OUT, `glove-ref-${name}.png`); await page.screenshot({ path }); await page.close(); return path;
  };
  if (existsSync(CLIP)) {
    const f = join(OUT, 'glove-clip-grip.png');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '39.0', '-i', CLIP, '-frames:v', '1', '-vf', 'crop=420:420:480:120', f]);
    shots.push(f); labels.push('clip: the grip pose (bare hand)');
  }
  for (const [file, name, box] of [['43cfcafd-image.png', 'daylight club', [560, 1180, 381, 492]], ['5f9af2ef-image.png', 'painted', [560, 1180, 381, 492]], ['61b102a6-image.png', 'distance', [560, 1180, 381, 492]]]) {
    if (existsSync(TARGETS + file)) { shots.push(await crop(TARGETS + file, box, name.replace(' ', '-'))); labels.push('target: ' + name); }
  }
  console.log(await lab.montage(shots, 'glove-strip', { height: 400, labels }));
});
