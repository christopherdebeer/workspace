/**
 * ARE THE FLAT ROOFS BLACK, AND IF SO WHY?
 *
 *   node devtools/roof-light.mjs
 *
 * The building survey's plan frame at Suresnes shows the stock as near-black
 * slabs at noon, which cannot be right by construction: a flat roof is the one
 * building surface that goes SQUARE-ON to a high sun, so it should be the
 * brightest thing in the frame, not the darkest. Three candidates, and the
 * point of this tool is that they are separable:
 *
 *   · the PAINT — a roof is `roofCol x 0.78` and then multiplied by `roofTex`,
 *     whose base is white with speckle, seams, cracks and moss drawn over it.
 *     That is exactly the fault CLAUDE.md records for the batter strip: colour
 *     x map renders at the map's MEAN, and the surface it is judged against
 *     carries no map at all. So the mean is measured here off the texture's
 *     own canvas rather than guessed.
 *   · the SHADOW MAP — an up-facing surface a few metres above the terrain is
 *     the classic self-shadowing case, and shadow acne on a roof would read as
 *     exactly this. `?shadows=0` is the A/B.
 *   · the LIGHT — a roof material never enters `bldSkylit`, so it gets no
 *     stand-in for the missing bounce that the walls get.
 *
 * A roof is framed by putting the camera DIRECTLY OVER one: the top view is
 * centred on the truck, so standing the truck on a footprint's centroid puts
 * that roof under the middle of the screen and a small centre box is a clean
 * sample of it. Nothing else in this repo can sample a named surface.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.RL_OUT ?? '/tmp/drive-tools/roof-light';
mkdirSync(OUT, { recursive: true });
const FIX = process.env.RL_FIX ?? 'at-paris-west';

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

/** Decode the screenshot in Chromium and sample boxes — see facade-light.mjs
 *  for why the live canvas cannot be read back. */
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

/** The mean of every building texture's own canvas, which is what the colour
 *  gets multiplied by, and which way the caps are facing. Both read from the
 *  source rather than from a frame. */
const TEXMEANS = () => ({
  tex: window.__texmean ? window.__texmean() : null,
  wind: window.__bldwind ? window.__bldwind() : null,
});

for (const shadows of ['1', '0']) {
  const d = await openDrive({
    spot: `fixture=${FIX}&cam=chase&time=NOON&sunalt=60&shadows=${shadows}&cprobe=1&nodraw=1`,
    tag: `rl-${shadows}`, settle: 0, bootTimeout: 150000, dpr: 1,
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

  // STAND ON THE BIGGEST NEARBY FOOTPRINT, so the centre box lands on roof and
  // not on the street beside it. Biggest rather than nearest for the same
  // reason: a 40m² garage roof is a couple of chart pixels.
  const on = await q(() => {
    const plots = window.__plots().filter((p) => Math.hypot(p.x, p.z) < 400);
    plots.sort((a, b) => b.n - a.n);
    const p = plots[0];
    if (!p) return null;
    window.__place(p.x, p.z);
    window.__drive.speed = 0;
    return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), n: p.n };
  });
  if (!on) { console.log(`[${el()}] shadows=${shadows}: no footprint`); await d.close(); continue; }

  await q(() => window.__draw(true));
  await q(() => window.__cam('top'));
  await q(() => window.__zoom(0.7));
  await d.page.waitForTimeout(5000);

  const buf = await d.page.screenshot({ timeout: 120000 });
  writeFileSync(`${OUT}/${FIX}-shadows${shadows}.png`, buf);
  const px = await q(SAMPLE, {
    b64: buf.toString('base64'),
    // The centre is the roof the truck stands on. Two rings out from it for
    // context: the ground a little further, and the frame's own corners.
    boxes: [
      ['roof', 0.45, 0.46, 0.10, 0.06],
      ['near', 0.30, 0.30, 0.08, 0.05],
      ['corner', 0.02, 0.02, 0.10, 0.06],
    ],
  });
  const tex = await q(TEXMEANS);
  const sky = await q(() => (window.__sky ? window.__sky() : null));
  console.log(`[${el()}] shadows=${shadows} standing on footprint (${on.n} pts) at ${on.x},${on.z}`);
  console.log(`   roof   ${JSON.stringify(px.roof)}`);
  console.log(`   near   ${JSON.stringify(px.near)}`);
  console.log(`   corner ${JSON.stringify(px.corner)}`);
  console.log(`   texmeans ${JSON.stringify(tex)}`);
  console.log(`   sun ${sky && sky.sunAltDeg}deg dayF ${sky && sky.dayF} cloud ${sky && sky.cloud}`);
  console.log(`   errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
  await d.close();
}
console.log(`total ${el()}`);
