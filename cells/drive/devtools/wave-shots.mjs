/**
 * ── PHOTOGRAPHING THE SEA ──
 *
 *   node cells/drive/devtools/wave-shots.mjs
 *   SPOT='lat=-34.17822&lon=18.34359' SUN=55,14,5 CLEAN=1 node …/wave-shots.mjs
 *
 * A wave that MEASURES right can still photograph as a flat sheet, and the
 * first attempt at this proved it: the open Atlantic off Kommetjie reads 1.70 m
 * of amplitude on a 240 m swell, which is a slope of about one in thirty-five
 * — from a low eye at midday, a grey plate. Height alone is not the picture.
 * What makes a wave read is the same thing that makes it read from a beach:
 *
 *   — a LOW EYE, near the water, so crests break the horizon line. The truck
 *     is the lowest camera this game has (chase, and cab lower still), so the
 *     rig is stationed AT the waterline and IN the shallows, where it wades.
 *   — crests seen EDGE-ON. Looking out to sea foreshortens every wave into a
 *     band; looking ALONG the shore puts the crest lines in profile against
 *     the sky, which is where a metre and a half of water announces itself.
 *   — GRAZING LIGHT. A high sun lights the tops and the troughs equally and
 *     the surface goes flat; a sun a few degrees up rakes the faces, and the
 *     glint runs along the crest instead of sitting in the middle of frame.
 *     `__sunalt` is a live dial, so one boot can sweep it.
 *   — the SURF ZONE, where the wave is tallest (the shoaling band) and where
 *     the breaker gate fires: foam is what the eye reads as "wave" at this
 *     palette, and it only exists where the water shallows.
 *   — a BURST. The sea moves; one frame lands wherever the phase happens to
 *     be. Five frames a second and a bit apart catch a crest arriving.
 *
 * Every frame is printed with the `__wave` numbers at the point it is looking
 * at, so a picture can be checked against the arithmetic that made it rather
 * than argued about.
 */
import { openDrive } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPOT = process.env.SPOT ?? 'lat=-34.17822&lon=18.34359';
const TAG = process.env.TAG ?? 'waveshot';
const SUNS = (process.env.SUN ?? '55,14,5').split(',').map(Number);
const CLEAN = process.env.CLEAN !== '0';

const { page, close, shot } = await openDrive({
  spot: `${SPOT}&cam=chase&time=NOON`, tag: TAG, menu: true, settle: 0, bootTimeout: 240000,
});
await page.evaluate(() => window.__draw?.(true));

// Let the ring stream and the hydro queue drain: a half-built sea photographs
// as a hole, and the tile under the camera is the one that must be settled.
for (let i = 0; i < 26; i++) {
  await sleep(4000);
  const s = await page.evaluate(() => {
    const h = window.__hydro?.(0, 90, 1); const t = window.__tworker?.() ?? {};
    return { tiles: h?.stats?.tiles, pend: h?.stats?.pendingBuilds, inFlight: t.inFlight };
  });
  if (i >= 7 && s.tiles > 0 && s.pend === 0 && !s.inFlight) break;
}
if (CLEAN) await page.evaluate(() => { for (const e of document.querySelectorAll('.ui')) e.style.display = 'none'; });

/** The waterline nearest the rig, the seaward unit vector there (up the
 *  shore-distance gradient, which is reliable everywhere), and the station
 *  along it where the breaker gate is strongest. */
const survey = await page.evaluate(() => {
  const [x0, z0] = window.__ground().at;
  const at = (x, z) => window.__coast(x, z);
  let edge = null;
  for (let dz = -900; dz <= 900; dz += 20) for (let dx = -900; dx <= 900; dx += 20) {
    const c = at(x0 + dx, z0 + dz);
    if (!c || c.kind !== 1 || !(c.shoreM > 2 && c.shoreM < 25)) continue;
    const d = Math.hypot(dx, dz);
    if (!edge || d < edge.d) edge = { d, x: x0 + dx, z: z0 + dz };
  }
  if (!edge) return null;
  const gx = (at(edge.x + 20, edge.z)?.shoreM ?? 0) - (at(edge.x - 20, edge.z)?.shoreM ?? 0);
  const gz = (at(edge.x, edge.z + 20)?.shoreM ?? 0) - (at(edge.x, edge.z - 20)?.shoreM ?? 0);
  const L = Math.hypot(gx, gz) || 1;
  const sx = gx / L, sz = gz / L;
  let surf = null, tallest = null;
  for (let m = 0; m <= 220; m += 5) {
    const w = window.__wave(edge.x + sx * m, edge.z + sz * m);
    if (!w) continue;
    if (!surf || w.breaker > surf.w.breaker) surf = { m, w };
    if (!tallest || w.peakM > tallest.w.peakM) tallest = { m, w };
  }
  return {
    edge: { x: edge.x, z: edge.z, d: Math.round(edge.d) }, seaward: [sx, sz],
    surfM: surf?.m ?? 40, surf: surf?.w ?? null, tallestM: tallest?.m ?? 0, tallest: tallest?.w ?? null,
  };
});
if (!survey) { console.log('no shoreline within 900 m of the rig'); await close(); process.exit(0); }
const [sx, sz] = survey.seaward;
// RADIANS, and the truck's own convention: forward is (sin h, -cos h), which
// `__place` assigns straight to `state.heading`. The `?h=` switch takes
// DEGREES and the probe does not, which is a trap worth naming: every frame
// in the first run of this tool faced a heading of (degrees mod 2pi) and
// photographed whatever happened to be there.
const headingOf = (dx, dz) => Math.atan2(dx, -dz);
console.log(`shore at ${Math.round(survey.edge.x)},${Math.round(survey.edge.z)} · seaward ${sx.toFixed(2)},${sz.toFixed(2)} (${Math.round(((Math.atan2(sx, -sz) * 180) / Math.PI + 360) % 360)}deg)`);
console.log(`breaker band ${survey.surfM} m offshore (gate ${survey.surf?.breaker}) · tallest ${survey.tallestM} m (peak ${survey.tallest?.peakM} m)`);

/** The three places worth standing, and the two ways worth looking. */
const stations = [
  ['beach', -12], ['shallows', 22], ['surf', Math.max(30, survey.surfM - 12)],
];
const views = [
  ['out', headingOf(sx, sz)],
  ['along', headingOf(-sz, sx)],
];
const rows = [];
for (const sun of SUNS) {
  await page.evaluate((deg) => window.__sunalt(deg), sun);
  for (const [name, off] of stations) {
    const px = survey.edge.x + sx * off, pz = survey.edge.z + sz * off;
    for (const [vname, heading] of views) {
      await page.evaluate(({ x, z, h }) => window.__place(x, z, h), { x: px, z: pz, h: heading });
      await sleep(2600);
      const tag = `${TAG}-sun${sun}-${name}-${vname}`;
      await shot(tag);
      const look = await page.evaluate(({ x, z, h }) => {
        const dx = Math.sin(h), dz = -Math.cos(h);
        return window.__wave(x + dx * 45, z + dz * 45);
      }, { x: px, z: pz, h: heading });
      rows.push({ tag, sun, station: name, view: vname, w: look });
      console.log(`  ${tag}: peak ${look?.peakM} m height ${look?.heightM} chop ${look?.chopM} breaker ${look?.breaker} · ${look?.wavelengthM} m wave on ${look?.mesh?.spacingM} m cells (${look?.mesh?.samplesPerWave}/wave)`);
    }
  }
}

// THE BURST, where the water is tallest and seen edge-on: the sea moves, and
// one frame lands wherever the phase happens to be.
const best = rows.filter((r) => r.view === 'along' && r.station !== 'beach')
  .sort((a, b) => (b.w?.peakM ?? 0) - (a.w?.peakM ?? 0))[0] ?? rows[0];
await page.evaluate((deg) => window.__sunalt(deg), SUNS[SUNS.length - 1]);
{
  const off = stations.find(([n]) => n === best.station)[1];
  const px = survey.edge.x + sx * off, pz = survey.edge.z + sz * off;
  const heading = views.find(([n]) => n === best.view)[1];
  await page.evaluate(({ x, z, h }) => window.__place(x, z, h), { x: px, z: pz, h: heading });
  await sleep(2500);
  for (let i = 0; i < 5; i++) { await shot(`${TAG}-burst${i}`); await sleep(1300); }
  console.log(`burst at ${best.station}/${best.view}, sun ${SUNS[SUNS.length - 1]}°`);
}
const errs = await page.evaluate(() => window.__pageErrors ?? []);
console.log(`pageerrors ${errs.length} ${JSON.stringify(errs.slice(0, 2)).slice(0, 200)}`);
await close();
