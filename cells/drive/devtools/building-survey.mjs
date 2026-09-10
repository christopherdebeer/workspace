/**
 * THE BUILDING SURVEY — pictures of walls, and the triangle bill beside them.
 *
 *   node devtools/building-survey.mjs        # frames to /tmp/drive-tools/bldg
 *
 * The visual survey (devtools/survey.mjs) frames JUNCTIONS: its spots are node
 * coordinates and its cab frames look down a carriageway, so a wall is
 * whatever happened to be off to one side. Nothing here has ever framed a
 * FAÇADE deliberately, which is why the façade shader's own gaps — one bay
 * width for the planet, dark glass at midnight — have never been photographed.
 *
 * So the spots are chosen from `__plots()` (the footprints the world actually
 * built) rather than typed: stand back from a building's centroid on a bearing
 * and look AT it. Four buildings a fixture, spread so they are not the same
 * street twice.
 *
 * Three suns per spot, because the façade's whole detail budget is diffuse
 * colour and a flat light hides all of it: high sun, low sun (which is when a
 * lintel or a sill has to earn its place) and NIGHT, which is the frame that
 * answers whether a town has any lit windows at all.
 *
 * Settles blind under ?nodraw=1 like the visual survey — the world build is
 * paced by the frame loop and drawing frames nobody keeps costs minutes.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.BLDG_OUT ?? '/tmp/drive-tools/bldg';
mkdirSync(OUT, { recursive: true });
const REV = process.env.REV || '';
const FIXTURES = (process.env.BLDG_FIX ?? 'at-paris-west,at-campsbay').split(',');
// Stand-off in metres, and the suns. 26m is about how far a driver is from the
// building line across a suburban street, which is the distance the façade is
// actually judged at — not the ten metres a lab uses.
const BACK = 26;
// THE SUN'S HEIGHT AND THE TIME OF DAY ARE DIFFERENT LEVERS, and this tool got
// it wrong first time round: `__sunalt(-9)` puts the sun below the horizon and
// leaves dayF, the sky and uNight computed from the CLOCK, so the "night" frames
// it wrote were midday with the light raked through the floor. Night needs
// ?time=, which is a boot — so the clock is the outer loop and the sun's height
// varies only within a daylit one.
const CLOCK = process.env.BLDG_TIME ?? 'NOON';
const SUNS = CLOCK === 'NIGHT' ? [['night', null]] : [['high', 52], ['low', 9]];

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

for (const fix of FIXTURES) {
  const d = await openDrive({
    spot: `fixture=${fix}&cam=chase&time=${CLOCK}&cprobe=1&nodraw=1`,
    tag: `bldg-${fix}`, settle: 0, bootTimeout: 150000, dpr: 2, rev: REV,
  });
  const q = (fn, ...a) => d.page.evaluate(fn, ...a);
  const shot = (f) => d.page.screenshot({ timeout: 120000 }).then((b) => writeFileSync(f, b));

  // THE GATE IS THE BUILDING COUNT, not the road one. A tile's buildings flush
  // with the tile, so `dirty === 0` and a still `seenWays` do imply the stock
  // has landed — but the count is what this survey is about, so it is the
  // signal that is read, and an unsettled world is named as such.
  let quiet = 0, pw = -1, pc = -1, pb = -1, settled = false, stats = null;
  for (let i = 0; i < 240; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => ({ ...window.__tstats(), b: window.__built() }));
    const nb = (t.b.intact ?? 0) + (t.b.ruin ?? 0);
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && nb === pb) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells; pb = nb; stats = t;
    if (quiet >= 5) {
      settled = true;
      console.log(`[${el()}] ${fix}: settled t+${(i + 1) * 3}s buildings=${nb} roadCells=${t.roadCells}`);
      break;
    }
  }
  if (!settled) console.log(`[${el()}] ${fix}: NOT SETTLED after 720s — every picture below is of a partial world`);

  const census = await q(() => window.__census());
  const built = await q(() => window.__built());
  const culture = await q(() => (window.__culture ? window.__culture(400) : null));
  console.log(`[${el()}] ${fix}: built ${JSON.stringify(built)}`);
  console.log(`[${el()}] ${fix}: culture ${JSON.stringify(culture)}`);
  console.log(`[${el()}] ${fix}: census ${JSON.stringify(census)}`);

  // FOUR BUILDINGS, SPREAD. Nearest first so the frames are of the part of the
  // fixture that streamed most completely, but no two within 70m of each other
  // — two views of one terrace says nothing about diversity, which is half of
  // what this survey is for.
  const spots = await q((back) => {
    const plots = window.__plots();
    const pick = [];
    plots.sort((a, b) => (a.x * a.x + a.z * a.z) - (b.x * b.x + b.z * b.z));
    for (const p of plots) {
      if (p.n < 4) continue;
      if (pick.some((k) => Math.hypot(k.x - p.x, k.z - p.z) < 70)) continue;
      pick.push(p);
      if (pick.length >= 4) break;
    }
    // Stand off along the bearing from the world origin outward, which for a
    // capture is roughly across the street rather than through the block.
    return pick.map((p, i) => {
      const a = Math.atan2(p.x, -p.z) + (i % 2 ? 0.9 : -0.9);
      return {
        n: p.n,
        cx: +p.x.toFixed(1), cz: +p.z.toFixed(1),
        x: +(p.x + Math.sin(a) * back).toFixed(1),
        z: +(p.z - Math.cos(a) * back).toFixed(1),
        // Look back at the centroid.
        h: +(Math.atan2(p.x - (p.x + Math.sin(a) * back), (p.z - Math.cos(a) * back) - p.z)).toFixed(3),
      };
    });
  }, BACK);
  console.log(`[${el()}] ${fix}: spots ${JSON.stringify(spots)}`);

  await q(() => window.__draw(true));
  await d.page.waitForTimeout(4000);

  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    await q((s) => { window.__place(s.x, s.z, s.h); window.__drive.speed = 0; }, s);
    for (const [tag, alt] of SUNS) {
      if (alt !== null) await q((a) => window.__sunalt(a), alt);
      await q(() => window.__cam('cab'));
      await d.page.waitForTimeout(3500);
      await shot(`${OUT}/${fix}-b${i}-${tag}-cab.png`);
    }
    // One chase frame per building — the silhouette and the roofline, which is
    // what a cab frame filled with one wall cannot show.
    if (CLOCK !== 'NIGHT') await q(() => window.__sunalt(9));
    await q(() => window.__cam('chase'));
    await d.page.waitForTimeout(3500);
    await shot(`${OUT}/${fix}-b${i}-${CLOCK === 'NIGHT' ? 'night' : 'low'}-chase.png`);
    console.log(`[${el()}] ${fix}: b${i} at ${s.x},${s.z} (footprint ${s.n} pts) done`);
  }

  // The planform, once: how much of the block is built, and how the stock is
  // massed. At 0.35 the frame is a couple of streets.
  await q(() => { window.__place(0, 0); window.__drive.speed = 0; });
  if (CLOCK !== 'NIGHT') await q(() => window.__sunalt(52));
  await q(() => window.__cam('top'));
  await q(() => window.__zoom(0.35));
  await d.page.waitForTimeout(5000);
  await shot(`${OUT}/${fix}-plan-${CLOCK}.png`);

  console.log(`[${el()}] ${fix}: errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
  await d.close();
}
console.log(`total ${el()}`);
