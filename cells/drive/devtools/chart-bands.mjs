/**
 * ── WHICH LAYER OWNS THAT BAND OF THE CHART, AND WHY IS IT LIGHTER? ──
 *
 *   node cells/drive/devtools/chart-bands.mjs
 *   SPOT=28.5108,87.0714 Z=13.3 node cells/drive/devtools/chart-bands.mjs
 *   CLIP=0 …   the far clip lifted, which is the control for the clip itself
 *
 * Reported from the seat over Zagor Town, Xizang: the outer part of the chart
 * is far lighter and flatter than the middle, and an outer strip looks as
 * though it only PARTLY paints. Three layers can be under any pixel out there
 * — the fine terrain, the coarse shell, the globe — and from a still frame
 * they are a matter of opinion about a grey shape.
 *
 * So it is a HIDE-DIFF, the route chart-ink.mjs takes: one settled world,
 * three frames (everything · `__hide('far')` · `__hide('terrain')`), and the
 * pixels that CHANGE when a layer goes are that layer's. It then prints an
 * ownership profile across the frame, the mean luma of each population, and —
 * the number the two questions turn on — the far probe's own `fineBox` and
 * `seam`: the rectangle the shell is clipped out of, and how far the shell
 * stands above or below the fine ground where both exist.
 *
 * THE BOX IS THE THING TO READ FIRST. It is measured from COMPLETE rings, so
 * one missing tile in ring 1 collapses it to the truck's own tile and the
 * shell is free to paint everything else — which is a hole in the clip, not a
 * palette fault, and no amount of looking at colour will say so.
 */
import { openDrive, WORK } from './harness.mjs';
import { readPng } from './png-lite.mjs';
import { join } from 'node:path';

const [LAT, LON] = (process.env.SPOT ?? '28.5108,87.0714').split(',').map(Number);
const ZOOM = Number(process.env.Z ?? 13.3);        // the seat's own slippy zoom
const CLIP = process.env.CLIP ?? '1';
const TIME = process.env.TIME ?? 'MORNING';
const WX = process.env.WX ?? 'clear';

const d = await openDrive({
  spot: `lat=${LAT}&lon=${LON}&h=0&cam=top&z=400&time=${TIME}&wx=${WX}`,
  tag: 'chart-bands', settle: 0, bootTimeout: 420000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
const wait = (ms) => d.page.waitForTimeout(ms);
// The clip is a PROBE, not a query-string switch — `__farclip(true)` lifts it,
// which is the control for the clip itself rather than for the palette.
if (CLIP === '0') await q(() => window.__farclip(true));

// ── THE ZOOM IS SOLVED, NOT TYPED ── `__zoom` sets a TARGET the frame loop
// eases toward, and the seat's number is a SLIPPY zoom (latitude-corrected),
// so the only honest way to stand where the seat stood is to drive the dial
// until `__scale()` reports the same z. Secant on log(zoom), which is linear
// in the slippy scale.
let dial = 400;
for (let i = 0; i < 24; i++) {
  await q((z) => window.__zoom(z), dial);
  let sc = null;
  for (let k = 0; k < 40; k++) {
    await wait(250);
    sc = await q((z) => (Math.abs(window.__cam().zoom - z) < Math.max(0.5, z * 0.02) ? window.__scale() : null), dial);
    if (sc) break;
  }
  if (!sc) sc = await q(() => window.__scale());
  if (Math.abs(sc.zoom - ZOOM) < 0.05) { console.log(`zoom ${dial.toFixed(1)} → ${sc.label}`); break; }
  // A slippy zoom step of +1 halves the ground per pixel, which halves the
  // camera's own dial: one multiply, no search.
  dial = Math.max(0.125, Math.min(110000, dial * 2 ** (sc.zoom - ZOOM)));
}

// ── SETTLE ── the three-signal gate, and the shell's ring beside it.
let quiet = 0, pb = -1, pw = -1, pc = -1, pf = -1;
for (let i = 0; i < 90; i++) {
  await wait(3000);
  const t = await q(() => ({ ...window.__tstats(), far: window.__far().tiles ?? window.__far().meshes ?? 0 }));
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.far === pf) ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; pc = t.roadCells; pf = t.far;
  if (i % 5 === 0) console.log(`  t+${i * 3}s dirty ${t.dirty} builds ${t.builds} far ${t.far}`);
  if (quiet >= 3) break;
}
console.log(`settled: ${quiet >= 3}`);

const probe = await q(() => {
  const f = window.__far();
  return {
    scale: window.__scale(), cam: window.__cam(),
    far: { level: f.level, tiles: f.tiles ?? f.meshes, cover: f.cover, tint: f.tint, seam: f.seam,
      fineR: f.fineR, tileM: f.tileM, fineBox: f.fineBox, perTile: f.perTile },
    cover: (() => { const c = window.__cover(1500, 200); return { tiles: c.tiles, asked: c.asked, wide: c.wide, here: c.here, snapped: c.snapped }; })(),
    tstats: window.__tstats(),
    truck: { x: window.__drive.x, z: window.__drive.z },
  };
});

// ── THE THREE FRAMES ── one settled world, one render each.
const shoot = async (name) => {
  await q(() => window.__draw(true));
  const f0 = await q(() => window.__clock().frames);
  for (let i = 0; i < 160; i++) { if ((await q(() => window.__clock().frames)) - f0 >= 4) break; await wait(500); }
  const p = join(WORK, `bands-${name}.png`);
  await d.page.screenshot({ path: p, timeout: 300000 });
  await q(() => window.__draw(false));
  return p;
};
const all = await shoot('all');
// THE FLOOR, FIRST. The same frame again with nothing changed: every pixel
// that moves between these two is the renderer's own weather — the dither
// re-weaving, the sward, an animal — and no attribution below is worth more
// than it. (Measured here: zero over the whole middle of the frame, which is
// what makes the rest of this readable.)
const all2 = await shoot('all2');
await q(() => window.__hide('far', true));
const nofar = await shoot('nofar');
await q(() => { window.__hide('far', false); window.__hide('terrain', true); });
const nofine = await shoot('nofine');
await q(() => window.__hide('terrain', false));
// …and the shell lit by the SCENE rather than by the planet, which is the one
// term that can make the same albedo read as a different material.
const mixWas = await q(() => window.__planetmix());
await q(() => window.__planetmix(0));
const mix0 = await shoot('mix0');
await q(() => window.__planetmix(null));

// ── OWNERSHIP, AT ART RESOLUTION ── a pixel the shell owns is one that CHANGES
// when the shell goes; likewise the fine terrain. A pixel that changes for
// neither is HUD, sky or globe.
const A = readPng(all), B = readPng(nofar), C = readPng(nofine), A2 = readPng(all2), M = readPng(mix0);
const AW = 148, S = A.w / AW, AH = Math.round(A.h / S);
const lum = (p, x, y) => { const i = (y * p.w + x) * p.bpp; return p.data[i] * 0.2126 + p.data[i + 1] * 0.7152 + p.data[i + 2] * 0.0722; };
// The terrain pane: clear of the HUD's own furniture top and bottom.
const ay0 = 30, ay1 = Math.min(AH - 40, 250), ax0 = 18, ax1 = AW - 18;
let shellN = 0, fineN = 0, shellL = 0, fineL = 0, n = 0;
let floorN = 0, shellUnder = 0, shellMix0 = 0;
for (let ay = ay0; ay < ay1; ay++) {
  for (let ax = ax0; ax < ax1; ax++) {
    const x = Math.min(A.w - 1, Math.round(ax * S + S / 2)), y = Math.min(A.h - 1, Math.round(ay * S + S / 2));
    const la = lum(A, x, y), lb = lum(B, x, y), lc = lum(C, x, y);
    const isShell = Math.abs(la - lb) > 6;
    const isFine = !isShell && Math.abs(la - lc) > 6;
    n++;
    if (Math.abs(la - lum(A2, x, y)) > 6) floorN++;
    // The shell's own pixels, three ways: as drawn, what the fine world had
    // there underneath it, and what the shell would be under the scene's sun.
    if (isShell) { shellN++; shellL += la; shellUnder += lb; shellMix0 += lum(M, x, y); }
    else if (isFine) { fineN++; fineL += la; }
  }
}
console.log(`\n${JSON.stringify(probe.scale)}`);
console.log(`far z${probe.far.level} · ${probe.far.tiles} tiles · cover ${JSON.stringify(probe.far.cover)}`);
console.log(`fine ring ${probe.far.fineR} m (tile ${probe.far.tileM} m) · fineBox ${JSON.stringify(probe.far.fineBox)}`);
console.log(`shell-over-fine seam ${JSON.stringify(probe.far.seam)}`);
console.log(`cover ${JSON.stringify(probe.cover)}`);
console.log(`tiles: ${JSON.stringify(probe.tstats)}`);
console.log(`\nnoise floor (the same frame twice): ${(100 * floorN / n).toFixed(2)}% of the pane moved by more than 6 luma`);
console.log(`of ${n} art pixels in the pane: shell ${(100 * shellN / n).toFixed(1)}% (mean luma ${(shellL / Math.max(1, shellN)).toFixed(1)})`
  + ` · fine ${(100 * fineN / n).toFixed(1)}% (mean luma ${(fineL / Math.max(1, fineN)).toFixed(1)})`);
console.log(`over the SHELL's own pixels — drawn ${(shellL / Math.max(1, shellN)).toFixed(1)}`
  + ` · the fine world under it ${(shellUnder / Math.max(1, shellN)).toFixed(1)}`
  + ` · the shell under the SCENE's sun ${(shellMix0 / Math.max(1, shellN)).toFixed(1)}`
  + `  (planet mix was ${mixWas.toFixed(2)})`);
// ── A PICTURE OF THE OWNERSHIP, because a column profile cannot show a BAND ──
// The first cut printed one character per art column and came back all 'f':
// the shell owned the top fifth of the frame and nothing else, which averages
// away entirely along a column. S = mostly shell, s = a fifth of it, · = a
// trace, f = fine, blank = neither (HUD, sky through the clip's own hole).
{
  const CO = 18, RO = 32;
  let map = '';
  for (let r = 0; r < RO; r++) {
    let line = String(Math.round(r * AH / RO)).padStart(4) + ' ';
    for (let c = 0; c < CO; c++) {
      let sh = 0, fi = 0, m = 0;
      for (let ay = Math.round(r * AH / RO); ay < Math.round((r + 1) * AH / RO); ay++) {
        for (let ax = Math.round(c * AW / CO); ax < Math.round((c + 1) * AW / CO); ax++) {
          const x = Math.min(A.w - 1, Math.round(ax * S + S / 2)), y = Math.min(A.h - 1, Math.round(ay * S + S / 2));
          const la = lum(A, x, y); m++;
          if (Math.abs(la - lum(B, x, y)) > 6) sh++; else if (Math.abs(la - lum(C, x, y)) > 6) fi++;
        }
      }
      line += sh / m > 0.6 ? 'S' : sh / m > 0.2 ? 's' : sh / m > 0.05 ? '·' : fi / m > 0.5 ? 'f' : ' ';
    }
    map += line + '\n';
  }
  console.log(`\nownership over the whole frame (S shell · f fine · blank neither):\n${map}`);
}
// ── WHERE THE PLANET'S SUN FADES IN ── the term that replaces the shell's own
// slope shading with the planet's radial cosine, printed against the scale it
// is keyed on, so "is the shell lit as ground or as a planet here" is a row in
// the log rather than an argument about a grey shape.
{
  const rows = [];
  for (const z of [63, 200, 700, 2000, 6000, 20000]) {
    await q((zz) => window.__zoom(zz), z);
    for (let k = 0; k < 40; k++) {
      await wait(250);
      if (await q((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.5, zz * 0.02), z)) break;
    }
    rows.push(await q(() => ({ zoom: Math.round(window.__cam().zoom), mpp: Math.round(window.__scale().mppArt),
      label: window.__scale().label, mix: +window.__planetmix().toFixed(3) })));
  }
  console.log(`\nplanet-sun ramp:`);
  for (const r of rows) console.log(`  zoom ${String(r.zoom).padStart(6)} · ${String(r.mpp).padStart(6)} m/art px · mix ${r.mix.toFixed(3)}  (${r.label})`);
}
console.log(`\nper-tile shell cover/tint:`);
for (const t of (probe.far.perTile ?? []).slice(0, 12)) console.log(`  ${t.key} hit ${t.hit} coverZ ${t.coverZ} tint ${JSON.stringify(t.tint)}`);
console.log(`\nframes: ${all} ${nofar} ${nofine}`);
console.log(`pageerrors: ${JSON.stringify((await q(() => window.__pageErrors ?? [])).slice(0, 3))}`);
await d.close();
