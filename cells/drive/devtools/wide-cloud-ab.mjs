// THE WIDE CHART UNDER CLOUD, AGAINST THE SAME CHART UNDER A CLEAR SKY.
//
//   node cells/drive/devtools/wide-cloud-ab.mjs
//
// Reported from the seat: quadrants and a cross on the wide chart once
// driving, not in the splash. The suspect is the terrain's cloud-shadow term,
// which samples the 12km truck-centred weather lattice at world position with
// a clamp-to-edge texture — so beyond the lattice a 570km chart wears the
// lattice's EDGE texels, and the 600m cloud noise is sub-pixel speckle. The
// splash's sky read CLEAR, which shuts the gate (uCloudS = 0); a drive rolls
// the weather and opens it.
//
// Two frames, same spot, same pinned zoom, the sky the only difference. If
// the pattern is in the cloud frame and not the clear one, it is the weather
// term and not the shell; the frames are measured, not eyeballed — the tone
// step across the screen's middle and the speckle (luma sd) per half.
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

const SPOT = 'lat=-29.9872&lon=24.7765&h=0&cam=top&z=1900';
async function frame(wx) {
  const { page, close } = await openDrive({ spot: `${SPOT}&wx=${wx}&time=NOON`, tag: `widecloud-${wx}`, menu: true, settle: 0 });
  // Wait for the shell ring; then let the weather field build (it rebuilds on
  // a 1.8s clock) and the frames flow.
  for (let i = 0; i < 100; i++) {
    const f = await page.evaluate(() => window.__far());
    if (f.asked > 0 && f.tiles >= f.asked && f.inFlight === 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  await new Promise((r) => setTimeout(r, 6000));
  const st = await page.evaluate(() => ({ far: window.__far().tiles, cloudS: window.__sky?.()?.cloud ?? null, cam: window.__cam() }));
  const shot = join(WORK, `widecloud-${wx}.png`);
  await page.screenshot({ path: shot, timeout: 240000 });
  // Measure the frame in the same page: the canvas is the only thing on it.
  const m = await (async () => ({ skipped: true }))(); const _unused = async (path) => {
    const img = new Image(); img.src = path; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height;
    const luma = (i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const stats = (x0, y0, x1, y1) => { const v = []; for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { const i = (y * W + x) * 4; if (d[i + 3] === 0) continue; v.push(luma(i)); }
      const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); return { luma: +m.toFixed(1), sd: +Math.sqrt(v.reduce((a, l) => a + (l - m) ** 2, 0) / Math.max(1, v.length)).toFixed(1) }; };
    // Four quadrants around the centre (the truck), inset from the HUD.
    const cxp = Math.floor(W / 2), cyp = Math.floor(H / 2), q = Math.floor(Math.min(W, H) * 0.18);
    return { W, H,
      UL: stats(cxp - 2 * q, cyp - 2 * q, cxp - q, cyp - q), UR: stats(cxp + q, cyp - 2 * q, cxp + 2 * q, cyp - q),
      LL: stats(cxp - 2 * q, cyp + q, cxp - q, cyp + 2 * q), LR: stats(cxp + q, cyp + q, cxp + 2 * q, cyp + 2 * q) };
  }; void _unused;
  await close();
  return { wx, st, shot, m };
}
const out = [];
for (const wx of ['clear', 'haze']) out.push(await frame(wx));
console.log('\nSUMMARY');
for (const o of out) {
  console.log(`\n${o.wx}: far ${o.st.far} tiles, cloud ${o.st.cloudS}, zoom ${o.st.cam.zoom} dist ${o.st.cam.dist} mpp ${o.st.cam.mpp}  ${o.shot}`);
  if (o.m.err) { console.log('  measure failed:', o.m.err); continue; }
  for (const k of ['UL', 'UR', 'LL', 'LR']) console.log(`  ${k} luma ${o.m[k].luma} sd ${o.m[k].sd}`);
  const ls = ['UL', 'UR', 'LL', 'LR'].map((k) => o.m[k].luma), sds = ['UL', 'UR', 'LL', 'LR'].map((k) => o.m[k].sd);
  console.log(`  quadrant luma spread ${(Math.max(...ls) - Math.min(...ls)).toFixed(1)}   speckle sd max ${Math.max(...sds)}`);
}
