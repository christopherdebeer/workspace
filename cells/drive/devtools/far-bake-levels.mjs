// DOES THE SHELL WEAR TWO COVER LEVELS ON ONE FRAME?
//
//   node cells/drive/devtools/far-bake-levels.mjs            # both paths
//   PATH=pinned|ladder node ... far-bake-levels.mjs          # one of them
//
// Reported from the seat at -29.9872, 24.7765 on the wide chart: uniform in
// the splash, then quadrants with hard seams once driving — one quadrant
// noisy, one flat, tones apart. The mechanism suspected: a URL PINNED wide
// bakes the shell once under one wide-cover level; a player who zooms OUT
// through the ladder bakes tiles under each level in turn, and the ring-home
// rebuild skips any tile at hit > 0.98 — so tiles baked from the previous
// level's raster are never re-baked and stand beside tiles baked from the
// next one. Same ground, rasters four times apart in resolution.
//
// Two runs, same spot, same final zoom, and the ONLY difference is how the
// zoom got there: arrived pinned, or walked out from a driving zoom. The
// per-tile bake level on `__far().perTile` is the witness; the tint spread
// is the consequence. A screenshot of each for the eye.
import { openDrive, WORK } from './harness.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SPOT = 'lat=-29.9872&lon=24.7765&h=0';
const WIDE = 1900;                          // ~250km view radius: the seat's frame
const which = process.env.PATH_KIND ?? 'both';

async function settleFar(page, label, maxS = 420) {
  // Wait for the far ring AND the wide cover ring to be home, then hold 12s so
  // the ring-home rebuild (if any) has run. Polls, never a fixed timeout: the
  // relay fetches 25 DEM tiles four at a time and takes minutes.
  const t0 = Date.now();
  let last = '';
  let homeAt = 0;
  while (Date.now() - t0 < maxS * 1000) {
    const s = await page.evaluate(() => {
      const f = window.__far(), c = window.__cover();
      return { level: f.level, tiles: f.tiles, asked: f.asked, retired: f.retired, inFlight: f.inFlight,
        coverZ: f.coverZ, wide: c.wide ?? null, blind: f.cover?.blind ?? null, spread: f.tint?.spread ?? null,
        levels: [...new Set(f.perTile.filter((t) => t.key.startsWith(`${f.level}/`)).map((t) => t.coverZ))].sort(),
        seams: f.seams ? { n: f.seams.n, worst: f.seams.worst?.d ?? null, over05: f.seams.over05 } : null };
    });
    const line = JSON.stringify(s);
    if (line !== last) { console.log(`  [${label} +${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); last = line; }
    // "Home" is everything ASKED having landed — the ring is 5x5 at the fine
    // rungs and 3x3 at z7, and a gate written as "25" sat out its whole budget
    // at the one rung this bench exists for.
    const home = s.asked > 0 && s.tiles >= s.asked && s.retired === 0 && s.inFlight === 0
      && (s.wide === null || s.wide.asked === 0 || s.wide.tiles >= s.wide.asked);
    if (home) { if (!homeAt) homeAt = Date.now(); else if (Date.now() - homeAt > 12000) break; }
    else homeAt = 0;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return page.evaluate(() => window.__far());
}

async function run(kind) {
  const spot = kind === 'pinned' ? `${SPOT}&cam=top&z=${WIDE}&nodraw=1` : `${SPOT}&cam=top&z=2&nodraw=1`;
  const { page, close } = await openDrive({ spot, tag: `farbake-${kind}`, menu: true, settle: 0 });
  console.log(`\n=== ${kind}: ${kind === 'pinned' ? 'arrived wide' : 'walks out z2 -> ' + WIDE} ===`);
  if (kind === 'ladder') {
    // Let the driving-zoom world stand up first, then walk the zoom out in
    // steps the way a thumb does, so each far/cover level gets its turn.
    await settleFar(page, 'z2', 240);
    for (const z of [12, 60, 300, 700, WIDE]) {
      await page.evaluate((zz) => window.__zoom(zz), z);
      // `__zoom` sets a TARGET that `zoomCur` eases toward at 8/s in the top
      // camera's frame step — the same trap chart-dist.mjs records. Settling
      // the shell before the ease has arrived measures the previous level.
      for (let i = 0; i < 80; i++) {
        const got = await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.5, zz * 0.02), z);
        if (got) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const zc = await page.evaluate(() => window.__cam().zoom);
      console.log(`  zoom asked ${z} -> ${zc}`);
      await settleFar(page, `z${z}`, 300);
    }
  }
  const far = await settleFar(page, 'final', 420);
  const live = far.perTile.filter((t) => t.key.startsWith(`${far.level}/`));
  const levels = new Map();
  for (const t of live) levels.set(t.coverZ, (levels.get(t.coverZ) ?? 0) + 1);
  console.log(`  far level z${far.level}, tiles ${far.tiles}, wide cover level now z${far.coverZ}`);
  console.log(`  tiles by bake level: ${[...levels.entries()].map(([z, n]) => `z${z}:${n}`).join('  ')}`);
  console.log(`  cover: ${JSON.stringify(far.cover)}   tint spread: ${far.tint?.spread}`);
  console.log(`  seams: ${JSON.stringify(far.seams)}`);
  const byLevel = {};
  for (const t of live) (byLevel[t.coverZ] ??= []).push(t.tint);
  for (const [z, tints] of Object.entries(byLevel)) {
    const mean = [0, 1, 2].map((c) => Math.round(tints.reduce((a, t) => a + t[c], 0) / tints.length));
    console.log(`    bake level z${z}: ${tints.length} tiles, mean tint rgb(${mean.join(',')})`);
  }
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => (window.__clock?.() ?? {}).frames ?? null);
  for (let i = 0; i < 120; i++) {
    const f = await page.evaluate(() => (window.__clock?.() ?? {}).frames ?? null);
    if (f0 === null || (f !== null && f - f0 >= 4)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const shot = join(WORK, `farbake-${kind}.png`);
  await page.screenshot({ path: shot, timeout: 240000 });
  console.log(`  frame: ${shot}`);
  const errs = await page.evaluate(() => window.__pageErrors ?? []);
  console.log(`  pageerrors: ${errs.length} ${JSON.stringify(errs.slice(0, 2))}`);
  writeFileSync(join(WORK, `farbake-${kind}.json`), JSON.stringify(far, null, 1));
  await close();
  return { kind, spread: far.tint?.spread, levels: [...levels.entries()] };
}

const out = [];
if (which === 'both' || which === 'pinned') out.push(await run('pinned'));
if (which === 'both' || which === 'ladder') out.push(await run('ladder'));
console.log('\nSUMMARY');
for (const o of out) console.log(`  ${o.kind.padEnd(8)} spread ${o.spread}  bake levels ${o.levels.map(([z, n]) => `z${z}:${n}`).join(' ')}`);
