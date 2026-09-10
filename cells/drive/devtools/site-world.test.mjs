/**
 * THE SITE SAMPLER AND THE ECOREGION, IN THE WORLD.
 *
 *   node cells/drive/devtools/site-world.test.mjs
 *
 * `devtools/climate-fixtures.test.mjs` holds `siteAt` against published
 * normals and `devtools/eco.test.mjs` holds the tile decode against the live
 * route — both pure, both in node, both seconds. Neither proves the WIRING:
 * that the world hands the sampler a signed latitude and not an absolute one,
 * that the coast field is reached at all, that the local sea search can tell
 * dry ground from unjudged ground, and that the ecoregion tile the truck is
 * standing on is asked for and arrives.
 *
 * So this one boots the real thing, at a site chosen because the two layers
 * MUST disagree there: the Cape is an ordinary Mediterranean climate on every
 * number the sampler produces, and the ecoregion is fynbos — a shrubland with
 * no analogue in any other Mediterranean climate on earth. A run where the
 * climate is right and the region is missing looks fine and has learned
 * nothing, which is the failure this file exists to catch.
 */
import { openDrive } from './harness.mjs';

// Chapman's Peak, above Hout Bay: coastal fynbos on a steep seaward face, the
// Atlantic a few hundred metres west and three hundred metres below.
//
// THE COORDINATES ARE THE MEASUREMENT. The first cut of this file used a point
// four hundred metres north, and every assertion in it passed — while the truck
// floated in Hout Bay: elevation -1m, cover WATER, ground WATER, salt 1.00, and
// a "Mediterranean" temperature that was the sea-level fallback for a world
// with no DEM under it at all. Sixteen green checks describing the ocean. The
// DEM reads 318.7m here (off the terrarium mosaic, before this point was
// chosen), and the preconditions below are asserted rather than assumed
// because of it.
const SPOT = process.argv[2] || 'lat=-34.0918&lon=18.3597&h=120&cam=chase&wx=clear&time=NOON';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// NODRAW, because nothing here is a picture. The world build is paced by the
// frame loop and headless paints through SwiftShader at three frames a second,
// so a settle that skips the draws is the difference between twenty seconds
// and three minutes for identical probe readings.
const d = await openDrive({ spot: `${SPOT}&nodraw=1`, tag: 'site-world', settle: 0 });
// WAIT FOR THE GROUND, NOT FOR A CLOCK. Three things have to have happened
// before any of this can be read: the eco tile has to have answered, a cover
// tile has to cover the truck (or `seaNearAt` reports "unjudged" and salt is
// unevidenced), and the DEM has to be under the wheels (or every site number
// is the sea-level fallback — which is exactly what the first run measured:
// 20.6°C and a treeline delta of −3069m at 2m of "elevation", all of it the
// model correctly describing a world that had not arrived).
// Bounded in FRAMES as well as by state, because a sim-second gate outlives
// the test at three frames a second.
const waited = await d.page.evaluate(() => new Promise((r) => {
  let f = 0;
  const w = () => {
    const s = window.__siteclim();
    const done = (s.ecoState === 'loaded' || s.ecoState === 'failed')
      && s.seaM !== null && s.elevAbs > 200;
    if (done || ++f > 1200) return r({ f, state: s.ecoState, seaM: s.seaM, elevAbs: s.elevAbs });
    requestAnimationFrame(w);
  };
  requestAnimationFrame(w);
}));
const s = await d.page.evaluate(() => window.__siteclim());
console.log(`\neco tile ${s.ecoTile}: ${waited.state} after ${waited.f} frames`);
console.log(JSON.stringify(s, null, 1));

// ── the ecoregion: the whole reason the dataset is here ──────────────────
check('the truck\'s ecoregion tile arrived', s.ecoState === 'loaded', waited);
check('…carrying the regions that meet at the Cape', s.ecoRegions >= 4, s.ecoRegions);
check('and the ground under the wheels is fynbos', /fynbos/i.test(s.eco?.name ?? ''), s.eco);
check('…which RESOLVE files under Mediterranean scrub',
  /mediterranean/i.test(s.eco?.biomeName ?? ''), s.eco);

// The card's own reading of the ground, needed by the aspect check below as
// well as by the row assertions at the end.
const cardRows = await d.page.evaluate(() => window.__sitecard());
const labelsPre = Object.fromEntries(cardRows);

// ── THE PRECONDITION, WHICH IS NOT A FORMALITY ───────────────────────────
// Every band below is satisfied by open water at sea level, so a run that has
// not put the truck on the hillside is a run that measured nothing.
check('the DEM arrived and the truck is on the hillside', s.elevAbs > 200 && s.elevAbs < 520, s.elevAbs);

// ── the site: the physics, and the inputs the biome field never had ──────
// Cape Town's normals are 16.9°C mean, a 7-8°C annual range, ~515mm, and a
// summer so dry it is the textbook case. Asserted as bands the model earns,
// not as a claim to be a climatology — see the note in CLAUDE.md.
check('the mean temperature is Mediterranean, not polar or tropical',
  s.heatC > 8 && s.heatC < 24, s.heatC);
check('the annual range is maritime', s.rangeC > 2 && s.rangeC < 18, s.rangeC);
check('there is rain, and not a monsoon\'s worth', s.waterMm > 150 && s.waterMm < 1600, s.waterMm);
check('the dry season is SUMMER', s.summerDry > s.winterDry && s.summerDry > 0.35,
  { summerDry: s.summerDry, winterDry: s.winterDry });
check('the coast field answered', s.hadCoast === true && s.coastKm >= 0, { hadCoast: s.hadCoast, coastKm: s.coastKm });
check('…and calls this maritime', s.contin < 0.35, s.contin);

// THE SIGN OF THE LATITUDE IS THE WHOLE POINT of latAt: in the south a slope
// faces the sun when it falls NORTH, and an absolute latitude would silently
// invert every aspect term below the equator.
check('the world hands over a SIGNED latitude', s.at[0] < 0, s.at);
check('insolation is a fraction, not a NaN', s.insolation >= 0 && s.insolation <= 1, s.insolation);
// ── THE SLOPE THAT FOUND THE BUG ────────────────────────────────────────
// This is the assertion the whole file earned. The first honest run here read
// `insolation 1.00` on ground the card described as falling 32° SOUTH — at
// 34°S, which is the POLE-facing side of the ridge and the shaded one. The
// model was returning the gradient's sign where it wanted the slope's facing,
// symmetrically in both hemispheres, so `climate-fixtures.test.mjs` (whose own
// authored hillside carried the same inversion) could never see it.
//
// Read off the card's aspect rather than hard-coded, so it stays true if the
// spawn settles a few metres along the road: south of the equator, a slope
// falling anywhere southward faces away from the sun.
const aspect = (labelsPre.SLOPE ?? '').split(' ')[1] ?? '';
if (/S/.test(aspect) && !/N/.test(aspect) && s.at[0] < 0) {
  check(`a slope falling ${aspect} at ${s.at[0].toFixed(1)}° faces AWAY from the sun`,
    s.insolation < 0.4, { aspect, insolation: s.insolation, lat: s.at[0] });
} else {
  console.log(`NOTE: the ground here falls ${aspect || '(flat)'} — the hemisphere check needs a southward face.`);
}
check('wetness is a fraction', s.wetness >= 0 && s.wetness <= 1, s.wetness);
check('the treeline delta is a real number of metres',
  Number.isFinite(s.treelineDelta) && Math.abs(s.treelineDelta) < 6000, s.treelineDelta);

// ── the local sea, which is a different question from the coast field ────
// The coarse field puts the whole Cape peninsula at 0km; the local search has
// to resolve the few hundred metres `salt` actually reads. A number here means
// cover has judged the point; null would mean it has not.
check('the local sea search answered at all', s.seaM !== null, s.seaM);
check('…and found the Atlantic within its reach', s.seaM > 0 && s.seaM <= 1000, s.seaM);
// SALT IS THE SEA *AND* THE HEIGHT. Three hundred metres up a cliff is not a
// salt marsh however close the water is, and the elevation clamp is the half
// of that term a coastal test can actually exercise.
check('…without calling a cliff top a salt marsh', s.salt < 0.05, { salt: s.salt, elevAbs: s.elevAbs });

// ── and the memo, because a site is twenty ground reads ──────────────────
const memo = await d.page.evaluate(() => {
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) window.__siteclim();
  const warm = (performance.now() - t0) / 500;
  return { warm, size: window.__siteclim().memo };
});
console.log(`\nsite lookup warm: ${memo.warm.toFixed(3)}ms · memo holds ${memo.size} cells`);
check('a repeat lookup is memoised, not recomputed', memo.warm < 1.5, memo);

// ── and it reads from the seat ────────────────────────────────────────────
// The probe returns the PLACE CARD's own rows, so this is what a player sees
// on a tap and not a second opinion from the same numbers.
const labels = labelsPre;
console.log('\ncard rows:');
for (const [k, v] of cardRows) console.log(`  ${k.padEnd(8)} ${v}`);
check('…on dry ground, by the card\'s own reckoning', labels.GROUND !== 'WATER', labels.GROUND);
check('the card carries a SITE row', /°C/.test(labels.SITE ?? ''), labels.SITE);
check('…a LOCAL row with the slope and the treeline',
  /SUN /.test(labels.LOCAL ?? '') && /TREELINE/.test(labels.LOCAL ?? ''), labels.LOCAL);
check('…and an ECO row naming the region', /FYNBOS/i.test(labels.ECO ?? ''), labels.ECO);
check('…beside the five-way biome it is allowed to disagree with',
  typeof labels.BIOME === 'string' && labels.BIOME.length > 0, labels.BIOME);

console.log('\npage errors:', d.errors.length, d.errors.slice(0, 3));
check('no page errors', d.errors.length === 0, d.errors.slice(0, 3));
await d.close();
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
