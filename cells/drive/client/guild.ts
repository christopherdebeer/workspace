/**
 * ══════════════════════════════════════════════════════════════════
 * GUILDS: WHAT ACTUALLY GROWS, FROM THE SITE AND THE ECOREGION
 * ══════════════════════════════════════════════════════════════════
 *
 * The layer above this one (`coverKind` in flora.ts) chooses a plant from a
 * WorldCover class and a blend of five biome archetypes. That is as far as
 * five classes can go, and the Cape is the case that shows where it stops: a
 * satellite says the slope above Hout Bay is shrub and grass, the climate says
 * mild-wet-winter-dry-summer maritime, and both are right — and between them
 * they cannot distinguish fynbos from chaparral from macchia from mallee, which
 * are four structurally different landscapes on four continents built by four
 * unrelated floras out of one climate.
 *
 * So the structural class is LOOKED UP, from RESOLVE's fourteen biomes, and
 * the site's own physics varies it. Two inputs, two jobs:
 *
 *   - the ECOREGION says what KIND of vegetation this is. A number a
 *     climate model cannot derive, because the answer is evolutionary history.
 *   - the SITE says how much of it, how tall, and which way this particular
 *     slope leans — the ravine that holds forest in shrubland country, the
 *     pole-facing face that holds conifer in a broadleaf valley, the salt
 *     sliver where nothing but mangrove lives.
 *
 * THE REALM IS THE OTHER THING ONLY THE DATASET KNOWS. A cactus is a New World
 * plant: the Cactaceae are Nearctic and Neotropic and everything cactus-shaped
 * in the Sahara or the Karoo is a euphorbia that converged on the same
 * silhouette. The old rule put saguaros in the Sahara because `arid` is one
 * archetype for the whole planet. RESOLVE carries `REALM` per region, so the
 * gate is a string compare.
 *
 * PURE, and mapped onto the ARCHETYPES THAT ALREADY EXIST. Nothing here draws
 * anything or needs new art: it returns weights over the same twelve VegKinds
 * the game has always had, plus a height and a density multiplier. A guild is
 * a proportion, not a species.
 */
import type { SiteClimate } from './climate';
import type { EcoHit } from './eco';
import type { VegKind } from './flora';

export type GuildMix = Array<[VegKind, number]>;

export interface Guild {
  /** RESOLVE's biome number, or 0 where the guild came from somewhere else. */
  biome: number;
  /** Short name, for the probe and the place card. */
  name: string;
  /** Weights over the archetypes, after every veto and shift. */
  mix: GuildMix;
  /** The tree subset, for ground the cover raster calls canopy. */
  trees: GuildMix;
  /** Multiplier on plant height. Fynbos is knee-to-waist; a redwood is not. */
  scale: number;
  /** Multiplier on how much stands here. A desert is mostly ground. */
  density: number;
  /** What moved it off the base row, for the probe — the interesting half. */
  why: string[];
}

/**
 * THE FOURTEEN, AS PROPORTIONS OF THE ARCHETYPES WE HAVE.
 *
 * Read these as "what does a photograph of this biome contain", not as a
 * species list. `bush` is the workhorse: it is every sclerophyll shrub, every
 * heath, every thicket, and it is what makes a Mediterranean scrub read as
 * scrub rather than as a thin forest. `rock` and `spire` are not vegetation at
 * all and belong in the dry and high rows because at these scales bare ground
 * with a boulder on it IS the landscape.
 *
 * The numbers are relative within a row and nothing else; they were set by
 * asking, per biome, roughly what fraction of the standing things in view
 * would be each shape.
 */
interface BaseGuild {
  name: string; mix: GuildMix; scale: number; density: number;
  /** DOES THIS BIOME THIN OUT ON ITS OWN DRY EDGE? A forest at 400mm is an
   *  open woodland and should stand further apart. A Mediterranean scrub at
   *  400mm is a Mediterranean scrub — summer drought is its DEFINITION, not a
   *  degradation of it, and a rainfall penalty on top of the row's own density
   *  halved the Cape's fynbos to savanna spacing. Same for a desert, a savanna
   *  and a tundra, whose rows already say how bare they are. */
  dry?: boolean;
}
const BASE: Record<number, BaseGuild> = {
  1: { name: 'tropical moist forest',
    mix: [['broadleaf', 6], ['palm', 4], ['fern', 4], ['bush', 3], ['log', 1]],
    scale: 1.15, density: 1.15, dry: true },
  2: { name: 'tropical dry forest',
    mix: [['broadleaf', 4], ['acacia', 3], ['bush', 4], ['palm', 1], ['snag', 1], ['log', 1]],
    scale: 0.95, density: 0.75, dry: true },
  3: { name: 'tropical conifer forest',
    mix: [['conifer', 6], ['broadleaf', 2], ['bush', 3], ['snag', 1]],
    scale: 1.05, density: 0.9, dry: true },
  4: { name: 'temperate broadleaf forest',
    mix: [['broadleaf', 6], ['conifer', 2], ['bush', 3], ['fern', 2], ['log', 1], ['snag', 1]],
    scale: 1.0, density: 1.0, dry: true },
  5: { name: 'temperate conifer forest',
    mix: [['conifer', 7], ['broadleaf', 2], ['bush', 2], ['snag', 2], ['log', 2]],
    scale: 1.15, density: 1.0, dry: true },
  6: { name: 'boreal taiga',
    mix: [['conifer', 8], ['bush', 3], ['snag', 3], ['log', 2], ['rock', 1], ['fern', 1]],
    scale: 0.85, density: 0.85, dry: true },
  7: { name: 'tropical savanna',
    mix: [['acacia', 4], ['bush', 5], ['rock', 1], ['snag', 1]],
    scale: 0.95, density: 0.4 },
  8: { name: 'temperate grassland',
    mix: [['bush', 5], ['rock', 2], ['snag', 1], ['broadleaf', 1]],
    scale: 0.8, density: 0.3 },
  9: { name: 'flooded grassland',
    mix: [['fern', 5], ['bush', 4], ['palm', 2], ['log', 1]],
    scale: 0.8, density: 0.7 },
  10: { name: 'montane shrubland',
    mix: [['bush', 5], ['rock', 4], ['spire', 2], ['conifer', 1], ['snag', 1]],
    scale: 0.6, density: 0.5 },
  11: { name: 'tundra',
    mix: [['rock', 5], ['bush', 3], ['spire', 2]],
    scale: 0.4, density: 0.35 },
  // THE ROW THIS WHOLE FILE EXISTS FOR. Mediterranean scrub is DENSE and LOW:
  // a continuous waist-high canopy of hard small-leaved shrubs with the odd
  // tree standing out of it. The five-biome model called the Cape `temperate`
  // and grew a broadleaf wood on it.
  //
  // THE TREES LEAN BROADLEAF, HARD. This row's trees are the ones that stand
  // out of the scrub — oak, olive, wild almond, milkwood — and its conifers
  // are a minority everywhere and an introduction at the Cape. At 2 against 1
  // the first A/B put conifer at 35% of the Cape's standing plants, which is
  // worse than what it replaced: WorldCover calls much of that slope tree
  // cover, and a canopy pixel picks from the tree list alone.
  12: { name: 'mediterranean scrub',
    mix: [['bush', 8], ['broadleaf', 3], ['conifer', 0.5], ['rock', 1], ['snag', 1]],
    scale: 0.6, density: 0.95 },
  13: { name: 'desert and xeric scrub',
    mix: [['rock', 5], ['bush', 3], ['cactus', 3], ['acacia', 2], ['spire', 2], ['snag', 1]],
    scale: 0.7, density: 0.25 },
  14: { name: 'mangrove',
    mix: [['palm', 4], ['broadleaf', 4], ['fern', 3]],
    scale: 0.9, density: 1.0 },
};

const TREE_KINDS: VegKind[] = ['broadleaf', 'conifer', 'palm', 'acacia'];
const isTree = (k: VegKind): boolean => TREE_KINDS.includes(k);

/** THE NEW WORLD, and only it. Everything cactus-shaped elsewhere is a
 *  euphorbia or a stapeliad that arrived at the same answer independently —
 *  which is a lovely fact and not one this silhouette can express. */
const CACTUS_REALMS = new Set(['Nearctic', 'Neotropic']);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const scaleWeight = (mix: GuildMix, pred: (k: VegKind) => boolean, f: number): GuildMix =>
  mix.map(([k, w]) => [k, pred(k) ? w * f : w] as [VegKind, number]);
const drop = (mix: GuildMix, k: VegKind): GuildMix => mix.filter(([j]) => j !== k);
const bump = (mix: GuildMix, k: VegKind, add: number): GuildMix => {
  const at = mix.findIndex(([j]) => j === k);
  if (at < 0) return [...mix, [k, add]];
  const out = mix.slice() as GuildMix;
  out[at] = [k, out[at][1] + add];
  return out;
};

/**
 * The guild for one site.
 *
 * Returns null where there is no ecoregion — over the sea, on a fixture, or
 * while the tile is still in flight. NULL IS THE CONTRACT: the caller keeps
 * the shipping climate path, unchanged, rather than being handed a guess that
 * would change under the player a second later. Most of the planet is ocean
 * and has no terrestrial ecoregion at all, so this is a common answer and not
 * a failure.
 */
export function guildAt(site: SiteClimate, eco: EcoHit | null): Guild | null {
  const base = eco ? BASE[eco.biome] : undefined;
  if (!eco || !base) return null;
  let mix = base.mix.slice() as GuildMix;
  let scale = base.scale;
  let density = base.density;
  const why: string[] = [];

  // ── VETOES: things that simply cannot live here ──
  if (!CACTUS_REALMS.has(eco.realm) && mix.some(([k]) => k === 'cactus')) {
    // The weight does not vanish — an Old World desert has the same amount of
    // standing scrub, it is a different plant. Handing it to `bush` keeps the
    // Karoo as full as the Sonoran and stops it becoming bare rock.
    const w = mix.find(([k]) => k === 'cactus')?.[1] ?? 0;
    mix = bump(drop(mix, 'cactus'), 'bush', w);
    why.push(`no cactus outside the New World (${eco.realm})`);
  }
  if (site.frostDays > 8) {
    if (mix.some(([k]) => k === 'palm')) { mix = drop(mix, 'palm'); why.push('too much frost for palm'); }
  }
  if (site.frostDays > 30 && mix.some(([k]) => k === 'cactus')) {
    mix = drop(mix, 'cactus');
    why.push('too much frost for cactus');
  }

  // ── THE LOCAL HALF: one climate cell, two places ──
  //
  // This is the whole argument for `siteAt` having a local term at all. A
  // ravine floor in fynbos country holds forest; the ridge fifty metres above
  // it holds shrubs; the climate is identical and no refinement of it reaches
  // the difference. Applied as a SHIFT rather than a different guild, because
  // the ravine is still fynbos country — it is a forest patch in it.
  if (site.wetness > 0.6) {
    mix = scaleWeight(mix, isTree, 1 + (site.wetness - 0.6) * 4);
    mix = bump(mix, 'fern', 2);
    scale *= 1 + (site.wetness - 0.6) * 0.5;
    why.push('a sheltered hollow holds more, and taller');
  } else if (site.wetness < 0.25 && site.insolation > 0.6) {
    // A shedding ridge in full sun: the harshest ground in any landscape.
    mix = scaleWeight(mix, isTree, 0.5);
    density *= 0.7;
    scale *= 0.85;
    why.push('an exposed sunny ridge sheds its water');
  }
  // A pole-facing slope is colder, wetter and holds snow, which is why it
  // grows conifer where the sunny side of the same valley grows broadleaf.
  //
  // ONLY WHERE THERE ARE CONIFERS TO FAVOUR. A relative boost applied to a
  // token weight promotes it to co-dominance: at the Cape, whose row carries
  // half a point of conifer against three of broadleaf, an unconditional ×1.8
  // is the difference between "a few pines on the shaded side" and "a pine
  // forest". The gate is the conifer's own share of the mix, so this shifts a
  // mixed wood and cannot invent a stand.
  if (site.insolation < 0.3 && site.heatC < 22) {
    const tot = mix.reduce((a2, [, w]) => a2 + w, 0);
    const cShare = (mix.find(([k]) => k === 'conifer')?.[1] ?? 0) / Math.max(1e-6, tot);
    if (cShare > 0.08) {
      mix = scaleWeight(mix, (k) => k === 'conifer', 1.8);
      why.push('the shaded face favours conifer');
    }
    mix = scaleWeight(mix, (k) => k === 'fern', 1.5);
  }

  // ── SALT: a sliver, and nothing else lives in it ──
  // A few hundred metres inland and a few metres up, and only where it is warm
  // enough. The site's `salt` term already carries both halves.
  if (site.salt > 0.35 && site.winterC > 12) {
    mix = [['palm', 4], ['broadleaf', 3], ['fern', 3], ['bush', 2]];
    scale = 0.85;
    density = 0.9 + site.salt * 0.2;
    why.push('salt: the tide reaches this ground');
  }

  // ── ARIDITY, where the biome row has not already said it ──
  // A FOREST at 400mm is an open woodland and should stand further apart. A
  // Mediterranean scrub at 400mm is a Mediterranean scrub, a savanna is a
  // savanna and a desert is a desert — their rows already carry their spacing,
  // and applying a rainfall penalty on top of it halved the Cape's fynbos to
  // savanna density in the first A/B. `dry` marks the rows that thin.
  //
  // AND IT IS SUB-LINEAR, BECAUSE THE RAINFALL IS A GUESS. `waterMm` is three
  // gaussians on the general circulation and its own fixtures only claim a
  // factor of 1.5 in the tropics and 2.2 elsewhere — so a term that reads it
  // linearly is trusting it far past what it is worth. Measured at Yosemite:
  // the model says 372mm against a real ~900, the linear form cut the density
  // to 0.62 and thinned a Sierra Nevada conifer forest from 511 standing
  // plants to 322. A rainfall estimate good to a factor of two must not be
  // allowed to remove a third of a forest. The floor is 0.55 and the response
  // starts there, so a true desert still reads as one and a wet forest the
  // model happens to under-rain stays a forest.
  if (base.dry && site.waterMm < 600) {
    const f = 0.55 + 0.45 * clamp01(site.waterMm / 600);
    density *= f;
    why.push(`only ${Math.round(site.waterMm)}mm of rain`);
  }

  const trees = mix.filter(([k]) => isTree(k));
  return {
    biome: eco.biome,
    name: base.name,
    mix: mix.filter(([, w]) => w > 0),
    trees: trees.length ? trees : [['bush', 1]],
    scale, density, why,
  };
}

/** Weighted pick from a mix. */
export function pickMix(mix: GuildMix, r: () => number): VegKind | null {
  let total = 0;
  for (const [, w] of mix) total += w;
  if (total <= 0) return null;
  let t = r() * total;
  for (const [k, w] of mix) { t -= w; if (t <= 0) return k; }
  return mix[mix.length - 1]?.[0] ?? null;
}

/**
 * WHAT STANDS ON THIS PIXEL, given the guild and what the satellite saw.
 *
 * The same shape as flora's `coverKind` and for the same reasons — the cover
 * raster is a fact about THIS 38m pixel and the guild is a fact about the
 * country, so the pixel narrows the guild rather than replacing it. A tree
 * class picks from the guild's trees; a shrub class suppresses them without
 * forbidding them (a savanna's shrub pixels still have the odd acacia on
 * them, which is what a savanna looks like); bare and frozen ground is
 * geology whatever the region says.
 */
export function guildKind(g: Guild, cover: number | null, r: () => number): VegKind {
  const any = (): VegKind => pickMix(g.mix, r) ?? 'bush';
  if (cover === 95) return r() < 0.7 ? 'palm' : 'broadleaf';            // mangrove
  if (cover === 10) return pickMix(g.trees, r) ?? any();                // canopy
  if (cover === 20 || cover === 30 || cover === 40) {
    // A PIXEL THAT SAYS VEGETATION SHOULD GROW VEGETATION. Trees are damped
    // because the pixel is not canopy — and STONE is damped for the same
    // reason, which the first cut forgot: a guild carries `rock` for the bare
    // ground in its country, and applying that weight unchanged to a shrub
    // pixel put boulders at 13% of the standing plants on the Cape hillside
    // against 1% before, which is a visible change nobody asked for. The
    // measurement that caught it is `__stand`, not the frame.
    return pickMix(scaleWeight(scaleWeight(g.mix, isTree, 0.18),
      (k) => k === 'rock' || k === 'spire', 0.3), r) ?? 'bush';
  }
  if (cover === 90) return r() < 0.5 ? 'fern' : r() < 0.8 ? 'bush' : any();
  if (cover === 60 || cover === 70) return r() < 0.62 ? 'rock' : 'spire';
  return any();
}

/** Every biome number this file has a row for — the probe prints it, and the
 *  test asserts the set is complete, because a missing row is a silent fall
 *  back to the climate path over a whole continent. */
export const GUILD_BIOMES = Object.keys(BASE).map(Number);
