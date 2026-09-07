/**
 * IS A WALL TOO DARK? — the number, not the impression.
 *
 * The building survey's cab frames at Suresnes showed a limewash façade
 * rendering as a near-black slab with its WINDOWS LIGHTER THAN ITS WALL, which
 * is backwards: dark glass is drawn at 0.05–0.17 linear on the assumption that
 * the paint around it is pale. If the wall falls under the glass the whole
 * façade reads inside out, and every detail the shader draws — lintels, ivy,
 * marks — is arguing inside one quantiser bucket.
 *
 * An eye cannot settle that through a Bayer dither, so this samples PIXELS.
 * Stand facing a wall, read a patch of it, read the ground beside it, read the
 * sky, and print them beside the material's own albedo and the frame's own
 * daylight factor. The comment at the skylight lift (main.ts, `bldSkylit`)
 * quotes 0.22 x albedo = 0.13 linear for a wall turned away from the sun
 * against 0.154 for the ground — so those two numbers are the ones to check.
 *
 *   node devtools/facade-light.mjs
 *
 * TWO CLOCKS, TWO BOOTS. `?sunalt` forces only the sun's DIRECTION — dayF,
 * sun.color, the twilight band and uNight are all still computed from the
 * clock's own altitude (main.ts stepSun) — so a forced negative altitude is
 * midday with the light raked through the floor, not night. Anything about
 * brightness needs ?time=, and that is a page load each.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.FL_OUT ?? '/tmp/drive-tools/facade-light';
mkdirSync(OUT, { recursive: true });
const FIX = process.env.FL_FIX ?? 'at-paris-west';
const CLOCKS = (process.env.FL_TIME ?? 'NOON,NIGHT').split(',');

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
/**
 * THE FRAME IS DECODED IN CHROMIUM, from the SCREENSHOT.
 *
 * The obvious route — draw the live canvas into a 2D context and read it back
 * — returns a fully black image, because the renderer runs without
 * `preserveDrawingBuffer` and the drawing buffer is gone by the time anything
 * outside the frame asks for it. Measured exactly that way: wall, ground and
 * sky all `[0,0,0]`, which reads as a black world and is a reading of nothing.
 *
 * A screenshot is composited by the browser and is what the player sees, so it
 * is decoded through an Image and sampled — the same route imgdiff.mjs takes,
 * and for the same reason: there is no image library in this repo.
 */
const SAMPLE = async ({ b64, boxes }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const out = { size: [w, h] };
  for (const [name, fx, fy, fw, fh] of boxes) {
    const d = ctx.getImageData(
      Math.round(w * fx), Math.round(h * fy),
      Math.max(1, Math.round(w * fw)), Math.max(1, Math.round(h * fh)),
    ).data;
    let r = 0, g = 0, b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= n * 255; g /= n * 255; b /= n * 255;
    out[name] = {
      srgb: [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)],
      lum: +(0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(4),
    };
  }
  return out;
};

for (const clock of CLOCKS) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=${clock}&cprobe=1&nodraw=1`,
    tag: `fl-${clock}`, settle: 0, bootTimeout: 150000, dpr: 1,
  });
  const q = (fn, ...a) => d.page.evaluate(fn, ...a);
  let quiet = 0, pw = -1, pc = -1;
  for (let i = 0; i < 200; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => window.__tstats());
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells;
    if (quiet >= 5) break;
  }

  // THE WALL IS FOUND BY RAYCAST, not by guessing a bearing: the point is to
  // know WHICH material the pixels belong to, because a ruin carries its
  // weathering in vertex colours and takes no skylight lift at all, and
  // mistaking one for the other would blame the wrong thing entirely.
  const found = await q(() => {
    const plots = window.__plots();
    plots.sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));
    for (const p of plots) {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const x = p.x + Math.sin(a) * 24, z = p.z - Math.cos(a) * 24;
        if (window.__inside(x, z)) continue;
        window.__place(x, z, Math.atan2(p.x - x, z - p.z));
        window.__drive.speed = 0;
        return { cx: +p.x.toFixed(1), cz: +p.z.toFixed(1), x: +x.toFixed(1), z: +z.toFixed(1) };
      }
    }
    return null;
  });
  if (!found) { console.log(`[${el()}] ${clock}: no footprint to stand at`); await d.close(); continue; }

  await q(() => window.__draw(true));
  await q(() => window.__cam('cab'));
  await d.page.waitForTimeout(4000);

  // What the renderer thinks it is doing, beside what it drew. `__sky()` is
  // where dayF and the sun's altitude live; `__clock()` is the FRAME clock and
  // answers fps, which is a different question and was the first thing this
  // asked by mistake.
  const state = await q(() => (window.__sky ? window.__sky() : null));
  // THE MASSING IS A DISTRIBUTION, so the probe reports one: heights in 3m
  // buckets and the roof shapes actually chosen. A world where every building is
  // 6.2m and a world with a range of heights have identical intact/ruin counts.
  const mass = await q(() => {
    const b = window.__built();
    return { intact: b.intact, ruin: b.ruin, hist: b.hist, roofs: b.roofs };
  });

  const buf = await d.page.screenshot({ timeout: 120000 });
  writeFileSync(`${OUT}/${FIX}-${clock}.png`, buf);
  // Three boxes: high on the wall (clear of the HUD's centre column and of the
  // sward at the foot), the ground a little to one side, and the sky.
  const px = await q(SAMPLE, {
    b64: buf.toString('base64'),
    boxes: [
      ['wall', 0.12, 0.34, 0.16, 0.10],
      ['ground', 0.10, 0.88, 0.20, 0.06],
      ['sky', 0.12, 0.06, 0.20, 0.05],
    ],
  });
  console.log(`[${el()}] ${clock} at ${found.x},${found.z} facing ${found.cx},${found.cz} (${px.size})`);
  console.log(`   wall   ${JSON.stringify(px.wall)}`);
  console.log(`   ground ${JSON.stringify(px.ground)}`);
  console.log(`   sky    ${JSON.stringify(px.sky)}`);
  console.log(`   wall/ground luminance ratio ${(px.wall.lum / (px.ground.lum || 1e-6)).toFixed(2)}`);
  console.log(`   mass ${JSON.stringify(mass)}`);
  console.log(`   state ${JSON.stringify(state)}`);
  console.log(`   errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
  await d.close();
}
console.log(`total ${el()}`);
