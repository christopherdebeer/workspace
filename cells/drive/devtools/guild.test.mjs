/**
 * THE GUILD RULES, IN NODE, IN A SECOND.
 *
 *   node cells/drive/devtools/guild.test.mjs
 *
 * `guild.ts` is the file that decides what a landscape is made of, and it is
 * pure for exactly this reason: every rule in it can be argued with here,
 * against named real places, without booting a world or waiting for a tile.
 *
 * The cases are chosen to be ones the SHIPPING five-biome model gets wrong —
 * the Cape called temperate and grown a broadleaf wood, a saguaro in the
 * Sahara, a savanna as dense as a forest. A test that only asserted the rules
 * agree with themselves would prove nothing about that.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'guild-'));
const built = join(tmp, 'guild.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/guild.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`, '--log-level=error'], { cwd: join(HERE, '../../..'), stdio: 'inherit' });
const { guildAt, guildKind, pickMix, GUILD_BIOMES } = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
/** A site with sensible middles, overridden per case. Every field `siteAt`
 *  produces, so a rule that starts reading a new one fails loudly here. */
const site = (o = {}) => ({
  heatC: 15, summerC: 22, winterC: 8, rangeC: 14, frostDays: 0, waterMm: 800,
  summerDry: 0, winterDry: 0, contin: 0.4, rainShadow: 0, treelineDelta: -1500,
  insolation: 0.5, wetness: 0.4, salt: 0, exposure: 0.4, elevAbs: 300, hadCoast: true,
  ...o,
});
const eco = (biome, realm = 'Palearctic', name = 'test') => ({ id: 1, biome, name, realm });
/** Weight of one kind as a fraction of the whole mix — the number that decides
 *  what a landscape looks like, rather than mere presence. */
const share = (g, k) => {
  const tot = g.mix.reduce((a, [, w]) => a + w, 0);
  return (g.mix.find(([j]) => j === k)?.[1] ?? 0) / tot;
};
const top = (g) => [...g.mix].sort((a, b) => b[1] - a[1])[0][0];
const has = (g, k) => g.mix.some(([j]) => j === k);

// ── every biome has a row, or a continent silently falls back ────────────
ok('all fourteen RESOLVE biomes have a guild',
  [...Array(14)].every((_, i) => GUILD_BIOMES.includes(i + 1)), GUILD_BIOMES);
ok('and no row for a number RESOLVE does not use',
  GUILD_BIOMES.every((n) => n >= 1 && n <= 14), GUILD_BIOMES);
ok('no ecoregion means no guild — the climate path stays', guildAt(site(), null) === null);
ok('nor does an unknown biome number', guildAt(site(), eco(99)) === null);

// ── THE CAPE: the case this file exists for ──────────────────────────────
const fynbos = guildAt(site({ heatC: 17, summerDry: 0.95, waterMm: 500, rangeC: 7 }),
  eco(12, 'Afrotropic', 'Fynbos shrubland'));
console.log(`\nfynbos: ${fynbos.name} · ${JSON.stringify(Object.fromEntries(fynbos.mix))}`
  + ` · x${fynbos.scale} at ${(fynbos.density * 100).toFixed(0)}%`);
ok('the Cape is shrubland, not woodland', top(fynbos) === 'bush', top(fynbos));
ok('…overwhelmingly so', share(fynbos, 'bush') > 0.55, share(fynbos, 'bush'));
ok('…low', fynbos.scale <= 0.7, fynbos.scale);
ok('…and DENSE, which is what separates it from a savanna',
  fynbos.density > 0.6, fynbos.density);
ok('with the odd tree standing out of it', share(fynbos, 'broadleaf') > 0.05, share(fynbos, 'broadleaf'));

// ── THE REALM GATE: a saguaro is a New World plant ───────────────────────
const sonoran = guildAt(site({ heatC: 24, waterMm: 200, frostDays: 2 }),
  eco(13, 'Nearctic', 'Sonoran desert'));
const sahara = guildAt(site({ heatC: 24, waterMm: 60, frostDays: 0 }),
  eco(13, 'Palearctic', 'Sahara desert'));
const karoo = guildAt(site({ heatC: 18, waterMm: 200, frostDays: 4 }),
  eco(13, 'Afrotropic', 'Succulent Karoo'));
ok('the Sonoran has cactus', has(sonoran, 'cactus'));
ok('the Sahara does not', !has(sahara, 'cactus'), sahara.mix);
ok('nor does the Karoo, whose look-alikes are euphorbias', !has(karoo, 'cactus'), karoo.mix);
ok('…and the weight went to scrub rather than to nothing',
  share(sahara, 'bush') > share(sonoran, 'bush'), [share(sahara, 'bush'), share(sonoran, 'bush')]);
ok('a desert is mostly bare ground', sahara.density < 0.35, sahara.density);

// ── FROST: what excludes a palm ──────────────────────────────────────────
const jungle = guildAt(site({ heatC: 27, waterMm: 2300, frostDays: 0 }), eco(1, 'Neotropic'));
const coldMoist = guildAt(site({ heatC: 8, waterMm: 2300, frostDays: 60 }), eco(1, 'Neotropic'));
ok('a tropical forest has palms', has(jungle, 'palm'));
ok('…and a frosty one does not', !has(coldMoist, 'palm'), coldMoist.why);
const coldDesert = guildAt(site({ heatC: 4, waterMm: 150, frostDays: 120 }), eco(13, 'Nearctic'));
ok('the Great Basin is too cold for cactus too', !has(coldDesert, 'cactus'), coldDesert.why);

// ── THE LOCAL HALF: one climate cell, two places ─────────────────────────
// The argument for siteAt having local terms at all. Same ecoregion, same
// climate, different ground.
const ridge = guildAt(site({ heatC: 17, summerDry: 0.95, waterMm: 500, wetness: 0.1, insolation: 0.9 }),
  eco(12, 'Afrotropic', 'Fynbos shrubland'));
const ravine = guildAt(site({ heatC: 17, summerDry: 0.95, waterMm: 500, wetness: 0.85, insolation: 0.2 }),
  eco(12, 'Afrotropic', 'Fynbos shrubland'));
const treeShare = (g) => g.mix.filter(([k]) => ['broadleaf', 'conifer', 'palm', 'acacia'].includes(k))
  .reduce((a, [, w]) => a + w, 0) / g.mix.reduce((a, [, w]) => a + w, 0);
console.log(`\nsame ecoregion, different ground: ridge trees ${(treeShare(ridge) * 100).toFixed(0)}%`
  + ` at ${(ridge.density * 100).toFixed(0)}% cover · ravine trees ${(treeShare(ravine) * 100).toFixed(0)}%`
  + ` at ${(ravine.density * 100).toFixed(0)}%`);
ok('a ravine in shrubland country holds trees', treeShare(ravine) > treeShare(ridge) * 2,
  [treeShare(ravine), treeShare(ridge)]);
ok('…and the ridge above it stays open', ridge.density < ravine.density, [ridge.density, ravine.density]);
ok('the shaded face favours conifer',
  share(ravine, 'conifer') > share(ridge, 'conifer'), [share(ravine, 'conifer'), share(ridge, 'conifer')]);

// ── SALT: the sliver where nothing else lives ────────────────────────────
const shore = guildAt(site({ heatC: 25, winterC: 20, salt: 0.8, waterMm: 1400 }), eco(1, 'Indomalayan'));
const inland = guildAt(site({ heatC: 25, winterC: 20, salt: 0, waterMm: 1400 }), eco(1, 'Indomalayan'));
ok('the tide line goes to mangrove', share(shore, 'palm') > share(inland, 'palm'),
  [share(shore, 'palm'), share(inland, 'palm')]);
// A cold shore is a shore, not a mangrove: the override is gated on the winter
// as well as on the salt, and mangroves stop dead at about 20C of winter sea.
const coldShore = guildAt(site({ heatC: 8, winterC: 2, salt: 0.8, waterMm: 900 }), eco(4));
ok('…and a cold shore stays a temperate wood',
  !coldShore.why.some((w) => /salt/.test(w)) && top(coldShore) === 'broadleaf',
  { why: coldShore.why, top: top(coldShore) });
ok('the warm one says why it changed',
  shore.why.some((w) => /salt/.test(w)), shore.why);

// ── ARIDITY MUST NOT TRUST A GUESS TOO FAR ───────────────────────────────
// `waterMm` is three gaussians whose own fixtures claim a factor of 1.5 to 2.2.
// Measured at Yosemite: the model reads 372mm against a real ~900, and a linear
// density response thinned a Sierra Nevada conifer forest from 511 standing
// plants to 322. A desert must still read as a desert; a forest the model
// happens to under-rain must still read as a forest.
const yosemite = guildAt(site({ heatC: 11, waterMm: 372, frostDays: 60 }), eco(5, 'Nearctic'));
const trueDesertForest = guildAt(site({ heatC: 11, waterMm: 40, frostDays: 60 }), eco(5, 'Nearctic'));
const wetForest = guildAt(site({ heatC: 11, waterMm: 1200, frostDays: 60 }), eco(5, 'Nearctic'));
console.log(`\nconifer forest density by rainfall: 40mm ${trueDesertForest.density.toFixed(2)}`
  + ` · 372mm ${yosemite.density.toFixed(2)} · 1200mm ${wetForest.density.toFixed(2)}`);
ok('an under-rained forest is still a forest', yosemite.density > 0.8, yosemite.density);
ok('…but a genuinely dry one does thin', trueDesertForest.density < yosemite.density,
  [trueDesertForest.density, yosemite.density]);
ok('…and never below the floor', trueDesertForest.density > 0.5, trueDesertForest.density);
ok('a wet forest is not thinned at all', wetForest.density === 1, wetForest.density);
ok('and a scrub is never thinned by its own definition',
  !fynbos.why.some((w) => /mm of rain/.test(w)), fynbos.why);

// ── THE COARSE BIOMES, sanity ────────────────────────────────────────────
ok('taiga is conifer', top(guildAt(site({ heatC: -2, frostDays: 180 }), eco(6))) === 'conifer');
ok('savanna has acacia', has(guildAt(site({ heatC: 25, winterDry: 0.8 }), eco(7, 'Afrotropic')), 'acacia'));
ok('…and is open ground', guildAt(site({ heatC: 25, winterDry: 0.8 }), eco(7, 'Afrotropic')).density < 0.5);
ok('tundra is stone and scrub', top(guildAt(site({ heatC: -8, frostDays: 260 }), eco(11))) === 'rock');
ok('…and is low', guildAt(site({ heatC: -8, frostDays: 260 }), eco(11)).scale < 0.5);

// ── THE FORM PREFERENCE ──────────────────────────────────────────────────
// A columnar broadleaf is the first silhouette that discriminates: a Lombardy
// poplar belongs on a French roadside and a cypress in Tuscany, and neither
// belongs in a rainforest or a savanna. Before the bake carried two forms in
// one family this filter could only return everything or nothing.
const formsOf = (biome, realm = 'Palearctic') => guildAt(site(), eco(biome, realm)).forms;
console.log(`\nform preferences: temperate ${JSON.stringify(formsOf(4))}`
  + ` · tropical ${JSON.stringify(formsOf(1))} · savanna ${JSON.stringify(formsOf(7))}`);
ok('a temperate wood may grow columnar trees', formsOf(4).includes('columnar'), formsOf(4));
ok('a Mediterranean one too — the cypress', formsOf(12).includes('columnar'), formsOf(12));
ok('…and so may a shelterbelt on grassland', formsOf(8).includes('columnar'), formsOf(8));
ok('a rainforest may NOT', !formsOf(1).includes('columnar'), formsOf(1));
ok('nor a savanna', !formsOf(7).includes('columnar'), formsOf(7));
ok('nor a desert', !formsOf(13).includes('columnar'), formsOf(13));
ok('a savanna asks for the umbrella', formsOf(7).includes('umbrella'), formsOf(7));
ok('a mangrove asks for the palm', formsOf(14).includes('palm'), formsOf(14));
ok('every row states a preference',
  [...Array(14)].every((_, i) => (formsOf(i + 1) ?? []).length > 0),
  [...Array(14)].map((_, i) => formsOf(i + 1).length));
// THE VOCABULARY IS DUPLICATED, so it has to be checked. guild.ts names forms
// as a string union rather than importing 186KB of generated geometry; if the
// bake ever renames one, this is what says so.
const BAKE_FORMS = ['round', 'columnar', 'conic', 'umbrella', 'palm', 'bare'];
const named = new Set([...Array(14)].flatMap((_, i) => formsOf(i + 1)));
ok('every form a guild asks for exists in the bake',
  [...named].every((f) => BAKE_FORMS.includes(f)), [...named]);

// ── guildKind: the cover raster narrows the guild, it does not replace it ─
const r = (seq) => { let i = 0; return () => seq[i++ % seq.length]; };
const many = (g, cover, n = 400) => {
  const out = {};
  let seed = 12345;
  const rr = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) { const k = guildKind(g, cover, rr); out[k] = (out[k] ?? 0) + 1; }
  return out;
};
const canopy = many(fynbos, 10);
console.log(`\nfynbos on a CANOPY pixel: ${JSON.stringify(canopy)}`);
ok('a canopy pixel grows the guild\'s trees and nothing else',
  Object.keys(canopy).every((k) => ['broadleaf', 'conifer', 'palm', 'acacia'].includes(k)), canopy);
const scrub = many(fynbos, 20);
console.log(`fynbos on a SHRUB pixel:  ${JSON.stringify(scrub)}`);
ok('a shrub pixel is mostly shrub', (scrub.bush ?? 0) / 400 > 0.7, scrub);
ok('…but not exclusively — a wood has edges', Object.keys(scrub).length > 1, scrub);
// A pixel the satellite calls vegetation should not come back as a boulder
// field. The guild carries `rock` for its country's bare ground, and applying
// that weight unchanged here put stone at 13% of the Cape's standing plants
// against 1% before the guild — a change nobody asked for, found by __stand.
ok('…and is not a boulder field',
  ((scrub.rock ?? 0) + (scrub.spire ?? 0)) / 400 < 0.06, scrub);
const bare = many(fynbos, 60);
ok('bare ground is geology whatever the region says',
  Object.keys(bare).every((k) => k === 'rock' || k === 'spire'), bare);
ok('a mangrove pixel is a mangrove anywhere',
  Object.keys(many(guildAt(site({ heatC: 27 }), eco(6)), 95))
    .every((k) => k === 'palm' || k === 'broadleaf'));
ok('pickMix on an empty mix is null, not a crash', pickMix([], r([0.5])) === null);

// ── THE HEADLAND: the Twelve Apostles clifftop, and a sheltered wood inland ──
// The same temperate-forest row, once on an exposed clifftop a hundred metres
// from the sea and once in a sheltered valley thirty kilometres inland.
const valley = guildAt(site({ exposure: 0.3, seaM: 30000 }), eco(4, 'Australasia', 'SE Australia temperate forests'));
const headland = guildAt(site({ exposure: 0.69, seaM: 100 }), eco(4, 'Australasia', 'SE Australia temperate forests'));
console.log(`
headland: x${headland.scale.toFixed(2)} bush ${share(headland, 'bush').toFixed(2)} · valley: x${valley.scale.toFixed(2)} bush ${share(valley, 'bush').toFixed(2)}`);
ok('an exposed headland grows at under two thirds of the inland height', headland.scale < valley.scale * 0.66, [headland.scale, valley.scale]);
ok('…and is scrub where the valley is wood', share(headland, 'bush') > share(valley, 'bush') * 2 && top(headland) === 'bush', [share(headland, 'bush'), share(valley, 'bush')]);
ok('…and denser, not thinner', headland.density > valley.density, [headland.density, valley.density]);
ok('the inland valley is untouched by the rule', !valley.why.some((w) => /coast|ridge/.test(w)), valley.why);
const cove = guildAt(site({ exposure: 0.3, seaM: 100 }), eco(4, 'Australasia', 'SE Australia temperate forests'));
ok('a sheltered cove by the same sea keeps its trees', cove.scale === valley.scale, [cove.scale, valley.scale]);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
