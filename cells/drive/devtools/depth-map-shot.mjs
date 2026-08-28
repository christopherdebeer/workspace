/**
 * THE DEPTH EYE, PHOTOGRAPHED. At a spot where the verdicts look wrong,
 * dump the whole 40x88 depth grid, render it as an image with every peak's
 * projection pinned on it, and break each verdict into its terms — which
 * of {exact cell, upward column, backdrop guard, slack} said "visible".
 * Spot via argv[2] (URL query), default the user's Stelvio report.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const spot = process.argv[2] || 'lat=46.55410&lon=10.44287&h=206&cam=chase&sunalt=45&wx=clear';
const d = await openDrive({ spot, tag: 'depthmap' });
await d.page.waitForTimeout(55000);      // alpine spot: let the shell finish streaming

await d.shot('depth-scene');
console.log(`-> ${join(WORK, 'depth-scene.png')}`);

const data = await d.page.evaluate(() => {
  const dump = window.__lumadump();
  const pk = window.__peaks(20);
  const names = [...new Set([...(pk.drawn || []), ...pk.top.map((t) => t.name)])];
  const dv = {};
  for (const n of names) dv[n] = window.__dvis(n);
  return { dump, pk, dv };
});

const { dump, pk, dv } = data;
const { W, H, far, m } = dump;
const at = (gx, gy) => m[gy * W + gx];

// ── the verdict, re-derived per peak from the same grid ──
console.log(`far plane: ${far}m  primed: ${dump.primed}`);
console.log('drawn on glass:', JSON.stringify(pk.drawn));
for (const [name, v] of Object.entries(dv)) {
  if (!v) continue;
  const { gx, gy, dCam } = v;
  const exact = at(gx, gy);
  const skyAt = far * 0.9;
  const nearSky = v.far2 >= skyAt;
  const face = v.far2 + Math.max(140, dCam * 0.08) >= dCam;
  const rescue = dCam > 25000 && v.riseSky >= skyAt;
  console.log(`${name.padEnd(22)} d=${(dCam / 1000).toFixed(1)}km g=(${gx},${gy})${v.off ? ' OFF' : ''} ` +
    `exact=${exact}m near=${v.far2}m riseSky=${v.riseSky}m sky=${nearSky} face=${face} rescue=${rescue} vis=${v.vis}`);
}

// ── the map itself, upscaled, pins on top ──
const png = await d.page.evaluate(({ dumpIn, dvIn }) => {
  const { W, H, far, m } = dumpIn;
  const S = 10;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const cx2 = cv.getContext('2d');
  for (let gy = 0; gy < H; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const mm = m[gy * W + gx];
      const sy = H - 1 - gy;                       // buffer bottom-up -> screen
      if (mm >= far * 0.95) cx2.fillStyle = '#1a2a4a';           // sky
      else {
        const t = Math.log(1 + mm) / Math.log(1 + far);
        const v = Math.round(30 + t * 225);
        cx2.fillStyle = `rgb(${v},${v},${v})`;
      }
      cx2.fillRect(gx * S, sy * S, S, S);
    }
  }
  cx2.font = '12px monospace';
  for (const [name, v] of Object.entries(dvIn)) {
    if (!v) continue;
    const sx = v.gx * S + S / 2, sy = (H - 1 - v.gy) * S + S / 2;
    cx2.strokeStyle = v.vis ? '#41e88e' : '#e84f4f';
    cx2.lineWidth = 2;
    cx2.strokeRect(sx - S / 2, sy - S / 2, S, S);
    cx2.fillStyle = v.vis ? '#41e88e' : '#e84f4f';
    cx2.fillText(`${name.slice(0, 10)} ${(v.dCam / 1000).toFixed(0)}k`, sx + 7, sy - 4);
  }
  return cv.toDataURL('image/png');
}, { dumpIn: dump, dvIn: dv });
writeFileSync(join(WORK, 'depth-map.png'), Buffer.from(png.split(',')[1], 'base64'));
console.log(`-> ${join(WORK, 'depth-map.png')}`);
report(d.errors);
await d.close();
