/**
 * ── A DECK IS A RIDGE, AND THE SHAPE ARGUMENT MEASURES THE WRONG SHAPE ──
 *
 * `repairDem` refuses a blob that is far too narrow for its height, and it was
 * validated against twenty-eight of the hardest real landforms on earth with
 * zero pixels touched. It leaves the Pont de Normandie's deck — 137 m of
 * "ground" over an estuary — exactly where it is, and this tool says why in
 * the repair's own terms.
 *
 * It decodes the real tile EXACTLY as the game does (the cell's own ~/dem/v1
 * route, RAW_BITMAP, drawn into a 256 canvas — see decodeTerrarium) and hands
 * the raster to the SHIPPED module in node, so nothing here is a second
 * opinion about the arithmetic. Per tile it reports the repair's inputs
 * (ground, relief, metres per pixel), every connected component over DEM_RISE
 * with the two tests applied to it, and — the number the repair does not
 * have — the component's WIDTH, measured by eroding it until nothing is left.
 *
 *   node cells/drive/devtools/dem-ridges.mjs [--only=name]
 *
 * The list is in two halves and both matter. The bridges are what the rule
 * must catch; the landforms are what it must not touch, and they are the
 * hardest ones on the planet on purpose — an arête is a real ridge a few
 * metres wide, a sea stack is a real tower, and a rule that cannot tell those
 * from a carriageway has no business near the terrain.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openDrive } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'demridge-'));
const built = join(tmp, 'demrepair.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/demrepair.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const R = await import(pathToFileURL(built).href);

/** [name, kind, lat, lon] — `kind` is what the rule is expected to do here. */
const PLACES = [
  // ── what the rule must catch ──
  ['Pont de Normandie', 'bridge', 49.42834, 0.27453],   // the seat's own spawn
  ['Sydney Harbour', 'bridge', -33.8523, 151.2108],
  // ── what it must not touch: the hardest real landforms ──
  ['El Capitan', 'land', 37.7340, -119.6376],
  ['Half Dome', 'land', 37.7460, -119.5330],
  ['Devils Tower', 'land', 44.5902, -104.7146],
  ['Uluru', 'land', -25.3444, 131.0369],
  ['Matterhorn', 'land', 45.9763, 7.6586],
  ['Cerro Torre', 'land', -49.2925, -73.0997],
  ['Meteora', 'land', 39.7217, 21.6306],
  ['Preikestolen', 'land', 58.9864, 6.1904],
  ['Gibraltar', 'land', 36.1408, -5.3536],
  ['Monument Valley', 'land', 36.9980, -110.0985],
  ['Grand Canyon', 'land', 36.0570, -112.1400],
  ['Cliffs of Moher', 'land', 52.9715, -9.4309],
  ['Death Valley', 'land', 36.2500, -116.8250],
  ['Old Man of Hoy', 'land', 58.8871, -3.4290],
  ['Trollveggen', 'land', 62.4600, 7.7400],
  ['Aiguille du Midi', 'land', 45.8786, 6.8873],
  ['Torres del Paine', 'land', -50.9423, -73.0700],
  ['Zion Angels Landing', 'land', 37.2690, -112.9470],
  ['Hoover Dam', 'land', 36.0160, -114.7377],
];

const RESID = Number((process.argv.find((a) => a.startsWith('--resid=')) ?? '').slice(8)) || 20;
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).toLowerCase();
const d = await openDrive({ pagePath: '/lab', tag: 'dem-ridges', settle: 0, bootTimeout: 180000, dpr: 1 });

/**
 * The raster the game would build from: the cell's route, the pyramid climb
 * (an absent tile is a text sentinel, so the climb is what a land model over
 * water actually reads), and the game's own 256-wide decode.
 */
const fetchTile = async (lat, lon) => d.page.evaluate(async ([lat, lon]) => {
  const RAW = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  const lr = lat * Math.PI / 180;
  for (let z = 14; z >= 4; z--) {
    const n = 2 ** z;
    const tx = Math.floor((lon + 180) / 360 * n);
    const ty = Math.floor((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2 * n);
    const r = await fetch(`/~/dem/v1/${z}/${tx}/${ty}`);
    if (!r.ok) continue;
    const buf = new Uint8Array(await r.arrayBuffer());
    const png = buf[0] === 0x89 && buf[1] === 0x50;
    const webp = buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57;
    if (!png && !webp) continue;                       // the absence sentinel
    const bmp = await createImageBitmap(new Blob([buf]), RAW);
    const cv = new OffscreenCanvas(256, 256);
    const g = cv.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    g.drawImage(bmp, 0, 0, 256, 256);                  // decodeTerrarium's own draw
    const px = g.getImageData(0, 0, 256, 256).data;
    bmp.close();
    const out = new Array(256 * 256);
    for (let i = 0; i < out.length; i++) {
      out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    }
    const tlat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + 0.5)) / n))) * 180 / Math.PI;
    return { z, tx, ty, data: out,
      mpp: 40075016.686 * Math.cos(tlat * Math.PI / 180) / (n * 256) };
  }
  return null;
}, [lat, lon]);

/**
 * The repair's own component walk, re-run so each blob's numbers can be read
 * instead of only its verdict — plus the width the repair never measures.
 * WIDTH IS AN EROSION, NOT AN AREA: a 2 km deck five pixels across has the
 * equivalent-disc radius of a 250 m hill, which is the whole fault.
 */
function components(e, mpp, rise = R.DEM_RISE) {
  const W = 256;
  const s = Float32Array.from(e).sort();
  const at = (f) => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  const ground = at(0.2);
  const relief = Math.max(30, at(0.95) - ground);
  const seen = new Uint8Array(e.length);
  const out = [];
  for (let st = 0; st < e.length; st++) {
    if (seen[st] || e[st] - ground <= rise) continue;
    const cells = [];
    const stack = [st]; seen[st] = 1;
    let peak = 0;
    while (stack.length) {
      const i = stack.pop();
      cells.push(i);
      const h = e[i] - ground;
      if (h > peak) peak = h;
      const x = i % W, y = (i / W) | 0;
      const push = (j) => { if (!seen[j] && e[j] - ground > rise) { seen[j] = 1; stack.push(j); } };
      if (x > 0) push(i - 1);
      if (x < W - 1) push(i + 1);
      if (y > 0) push(i - W);
      if (y < W - 1) push(i + W);
    }
    // Erode the component with a plus-shaped element until it is empty; the
    // number of passes is its half-width in pixels.
    const inSet = new Uint8Array(e.length);
    for (const i of cells) inSet[i] = 1;
    let live = inSet, n = cells.length, erosions = 0;
    while (n) {
      const next = new Uint8Array(e.length);
      let m = 0;
      for (const i of cells) {
        if (!live[i]) continue;
        const x = i % W, y = (i / W) | 0;
        if (x > 0 && !live[i - 1]) continue;
        if (x < W - 1 && !live[i + 1]) continue;
        if (y > 0 && !live[i - W]) continue;
        if (y < W - 1 && !live[i + W]) continue;
        next[i] = 1; m++;
      }
      live = next; n = m; erosions++;
    }
    const need = peak / (R.DEM_SLOPE * mpp);           // the radius the slope demands, px
    out.push({
      n: cells.length, peak, ground, relief,
      eqR: Math.sqrt(cells.length / Math.PI), need,
      eqRatio: Math.sqrt(cells.length / Math.PI) / need,
      halfWidthPx: erosions, widthM: 2 * erosions * mpp,
      widthRatio: erosions / need,
      touchesEdge: cells.some((i) => i % W === 0 || i % W === W - 1 || i < W || i >= e.length - W),
      dwarfed: peak > R.DEM_DWARF * relief,
    });
  }
  return out.sort((a, b) => b.peak - a.peak);
}

for (const [name, kind, lat, lon] of PLACES) {
  if (only && !name.toLowerCase().includes(only)) continue;
  const t = await fetchTile(lat, lon);
  // The texel the game would read for baseElev at this very point, which is
  // the one number the seat's evidence is expressed in.
  if (!t) { console.log(`${name.padEnd(22)} no tile`); continue; }
  const e = Float32Array.from(t.data);
  const floor = R.demFloor(t.z, 14);
  const bad = R.demBad(e, floor);
  const spikes = R.demSpikes(e, t.mpp);
  const before = Float32Array.from(e);
  if (bad) R.demPatch(e, floor);
  const after = R.repairDem(e, t.mpp);
  let moved = 0;
  for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) > 0.5) moved++;
  const comps = components(e, t.mpp);
  const rest = components(after, t.mpp, RESID);
  const top = comps[0];
  console.log(`${name.padEnd(22)} ${kind.padEnd(6)} z${t.z} ${t.mpp.toFixed(1)}m/px`
    + ` · bad ${bad} spikes ${spikes} · repairDem moved ${moved}px`);
  if (top) {
    console.log(`  tallest of ${comps.length}: peak ${top.peak.toFixed(1)}m over ground ${top.ground.toFixed(1)}m`
      + ` · relief ${top.relief.toFixed(1)}m · dwarfs it ${top.dwarfed}`);
    console.log(`  area ${top.n}px → eq radius ${top.eqR.toFixed(1)}px against ${top.need.toFixed(1)}px demanded`
      + ` = ${top.eqRatio.toFixed(2)} (a lie under ${R.DEM_RATIO})`);
    console.log(`  WIDTH by erosion ${top.widthM.toFixed(0)}m (${top.halfWidthPx}px half)`
      + ` = ${top.widthRatio.toFixed(2)} of demanded · touches the edge ${top.touchesEdge}`);
  }
  // WHAT THE REPAIR LEAVES STANDING is the measurement that matters: a rule
  // that takes the pylons and leaves the deck has not fixed the terrain.
  console.log(`  after the repair: ${rest.length} blobs over ${RESID}m, `
    + rest.slice(0, 3).map((c) => `${c.peak.toFixed(0)}m/${c.n}px/${c.widthM.toFixed(0)}m wide`
      + `/eq ${c.eqRatio.toFixed(2)}/w ${c.widthRatio.toFixed(2)}${c.dwarfed ? '' : ' NOT-DWARFED'}`).join(' · ')
    || '  (none)');
  // …and the tile's own top, which is what baseElev and the mesh would read.
  let mx = -Infinity, mn = Infinity;
  for (const v of after) { if (v > mx) mx = v; if (v < mn) mn = v; }
  console.log(`  tile after: ${mn.toFixed(1)}m … ${mx.toFixed(1)}m`);
  {
    const n = 2 ** t.z;
    const lonW = t.tx / n * 360 - 180, lonE = (t.tx + 1) / n * 360 - 180;
    const latOf = (yy) => { const q = Math.PI - 2 * Math.PI * yy / n; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(q) - Math.exp(-q))); };
    const latN = latOf(t.ty), latS = latOf(t.ty + 1);
    const u = Math.max(0, Math.min(255, Math.round((lon - lonW) / (lonE - lonW) * 255)));
    const v = Math.max(0, Math.min(255, Math.round((latN - lat) / (latN - latS) * 255)));
    // ── WHAT AN ANCHOR RULE WOULD SEE ──
    // baseElev is ONE texel of this raster, read at boot before any way or
    // cover exists, and every metre in the world is relative to it. These are
    // the numbers a robust statistic would be chosen from — and the cliff-rim
    // places in the list are the ones that say which statistic is safe.
    const box = (radM) => {
      const r = Math.max(1, Math.round(radM / t.mpp));
      const vals = [];
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = u + dx, y = v + dy;
          if (x < 0 || y < 0 || x > 255 || y > 255) continue;
          vals.push(after[y * 256 + x]);
        }
      }
      vals.sort((a, b) => a - b);
      return { r, med: vals[vals.length >> 1], p25: vals[Math.floor(vals.length * 0.25)],
        p10: vals[Math.floor(vals.length * 0.1)] };
    };
    const c = after[v * 256 + u];
    // The narrowest run of ground through the anchor standing over the 100m
    // box's own low ground, over eight bearings: the survey's own measure, at
    // one point. A deck is narrow in some bearing; a cliff rim never is.
    const b100 = box(100);
    const cut = b100.p10 + 10;
    let narrow = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
      let run = 1;
      for (const sgn of [1, -1]) {
        for (let step = 1; step <= 60; step++) {
          const x = Math.round(u + sgn * ux * step), y = Math.round(v + sgn * uy * step);
          if (x < 0 || y < 0 || x > 255 || y > 255) break;
          if (after[y * 256 + x] <= cut) break;
          run++;
        }
      }
      narrow = Math.min(narrow, run);
    }
    const f = (n) => n.toFixed(1);
    console.log(`  ANCHOR raw ${f(before[v * 256 + u])}m → repaired ${f(c)}m`
      + ` · box50 med ${f(box(50).med)} p10 ${f(box(50).p10)}`
      + ` · box100 med ${f(b100.med)} p10 ${f(b100.p10)}`
      + ` · box200 med ${f(box(200).med)} p10 ${f(box(200).p10)}`);
    console.log(`  ANCHOR stands ${f(c - b100.p10)}m over its 100m low ground,`
      + ` on a run ${(narrow * t.mpp).toFixed(0)}m wide`);
  }
}
console.log('\nerrors', d.errors.length, JSON.stringify(d.errors.slice(0, 2)).slice(0, 200));
await d.close();
