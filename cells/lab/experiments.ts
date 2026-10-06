/**
 * The lab's experiments, as the index shows them: grouped, each live in its card (the experiment
 * itself, in a frame, opened with its `preview` query), a blurb, its README, and its presets (the
 * same experiment opened a particular way: a query string on its page).
 *
 * `page` is the experiment's page under static/ (its script is `{{app}}`, filled with the bundle's
 * hashed path); `readme` is its README (markdown), rendered as a page of its own.
 */
export interface Preset {
  label: string;
  /** the query string it opens with (no `?`) */
  query: string;
}
export interface Experiment {
  id: string;
  title: string;
  group: string;
  blurb: string;
  page: string;
  /** the query its live preview in the index opens with: small and quiet */
  preview: string;
  readme: string;
  presets: Preset[];
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'changes', title: 'Changes', group: 'Contemplation',
    blurb: 'Six blue lines, a moment of attention. Cast an I Ching hexagram, follow its changing lines, and keep a reflection. A quiet experiment in chance and interpretation, inspired by a minimal iOS app.',
    page: 'static/changes.html', preview: 'preview', readme: 'static/changes.md',
    presets: [{ label: 'cast', query: '' }, { label: 'beginning', query: 'hex=3' }, { label: 'changing lines', query: 'cast=688879' }],
  },
  {
    id: 'markovs', title: 'Markovs Chains', group: 'Play',
    blurb: 'A game of finite probabilities on a standard poker deck: build a table of junction cards, then race one counter to your secret King with a d6. Two to four at one phone, or against bots; print the deck and play it on a table.',
    page: 'static/markovs.html', preview: 'preview&seed=1941', readme: 'static/markovs.md',
    presets: [{ label: 'you v three bots', query: 'seed=1941&players=4&bots=0111' }, { label: 'two at the table', query: 'seed=1941&players=2&bots=00' }, { label: 'four at the table', query: 'seed=1941&players=4&bots=0000' }, { label: 'the grid prototype', query: 'mode=physical' }, { label: 'the four-state chain', query: 'mode=challenge' }],
  },
  {
    id: 'seals', title: 'Seals', group: 'Play',
    blurb: 'The junction cards of Markovs Chains, engraved as seals: one family per suit, a seed for each card, every line from hyperparameters you can turn. Ornament packs evenly into any shape (seals, frames, corners) and keeps clear of the labels. Pure drawing functions, to be ported to the game.',
    page: 'static/seals.html', preview: 'preview&seed=1', readme: 'static/seals.md',
    presets: [{ label: 'the spade turn', query: 'suit=3&rank=3' }, { label: 'all four suits', query: 'view=suits&rank=5' }, { label: 'the bases, faces hidden', query: 'view=suit&suit=0&faces=hidden' }, { label: 'safe zones', query: 'suit=3&rank=6&faces=zones&overlay' }, { label: 'shapes: borders, corners', query: 'view=shapes&suit=2&label=The%20Thicket' }, { label: 'six seeds', query: 'suit=2&rank=9&view=seeds' }],
  },
  {
    id: 'crystals', title: 'Crystals', group: 'Drawings',
    blurb: 'A mineral specimen from a seed, ray-traced: a cluster of crystals grows out of its matrix, and the key light goes through them — refracted, dispersed into colour at the edges, reflected inside, and thrown onto the slate as caustics. Drag to turn it; pinch to come close.',
    page: 'static/crystals.html', preview: 'preview&seed=1947&still', readme: 'static/crystals.md',
    presets: [{ label: 'a specimen', query: '' }, { label: 'amethyst', query: 'mineral=amethyst&seed=12' }, { label: 'fluorite', query: 'mineral=fluorite&seed=5' }, { label: 'zircon', query: 'mineral=zircon&seed=8' }, { label: 'emerald', query: 'mineral=emerald&seed=3' }, { label: 'rhodochrosite', query: 'mineral=rhodochrosite&seed=4' }],
  },
  {
    id: 'mistwood',
    title: 'Mistwood',
    group: 'Woods',
    blurb: 'A walk through a seeded wood in fog: trees grown branch by branch, deer, ponds, a creek, ruins. Touch the ground to walk, the sky to look.',
    page: 'static/mistwood.html',
    preview: 'preview&hour=11',
    readme: 'static/mistwood.md',
    presets: [
      { label: 'walk', query: '' },
      { label: 'pencil', query: 'style=sketch' },
      { label: 'the creek', query: 'find=ford' },
      { label: 'a ruin', query: 'find=tower' },
      { label: 'tune', query: 'tune' },
    ],
  },
  {
    id: 'plate',
    title: 'Botanical plate',
    group: 'Drawings',
    blurb: 'One plant from a seed, grown before your eyes and drawn as an engraving you can turn in your hand and hand-coloured in watercolour: roots, stem, leaves hatched as they turn from the light, flowers opening.',
    page: 'static/plate.html',
    preview: 'preview&seed=412',
    readme: 'static/plate.md',
    presets: [
      { label: 'a specimen', query: '' },
      { label: 'pl. 412', query: 'seed=412' },
      { label: 'pl. 77', query: 'seed=77' },
      { label: 'pl. 2051', query: 'seed=2051' },
      { label: 'ink only', query: 'wash=0' },
    ],
  },
  {
    id: 'bricks',
    title: 'Bricks',
    group: 'Play',
    blurb: 'Lego, Tetris-fashion: bricks are offered one at a time — tap for another, drag it out to use it — and any placed brick can be picked up, moved, turned or recoloured. Nothing falls, nothing clears; you build.',
    page: 'static/bricks.html',
    preview: 'preview&seed=21',
    readme: 'static/bricks.md',
    presets: [
      { label: 'build', query: '' },
      { label: 'watch a town', query: 'town&seed=21' },
    ],
  },
  {
    id: 'fungi',
    title: 'Hat-throwers',
    group: 'Drawings',
    blurb: 'A macro timelapse of dung fungi in a pasture, on the real clock: pats of every age in the grass, each its own succession over three weeks: hat-throwers and pin moulds first, then jelly cups, eyelash cups and flask fungi, inkcaps last. Each spreads through the dung and eats it out from under the others. Nematodes ride the thrown sporangia or are caught in the snares of a trapping fungus; mites and springtails graze; dung flies wait on fresh pats and beetles bore them; mosses, clover and plantain grow among the grass. The camera goes where something is about to happen.',
    page: 'static/fungi.html',
    preview: 'preview&seed=2&t=250',
    readme: 'static/fungi.md',
    presets: [
      { label: 'the field, now', query: '' },
      { label: 'the field at dawn', query: 'hour=6.5' },
      { label: 'an old pat', query: 'age=40' },
      { label: 'a terrarium', query: 'terrarium' },
      { label: 'no. 2, day 15', query: 'terrarium&seed=2&t=330' },
      { label: 'throwers alone', query: 'one&seed=2&t=9' },
      { label: 'a pin mould', query: 'one&seed=4&t=8' },
      { label: 'inkcaps', query: 'one&seed=10&t=9' },
      { label: 'jelly cups', query: 'one&seed=9&t=8' },
      { label: 'eyelash cups', query: 'one&form=eyelash&seed=5&t=16' },
      { label: 'mottlegills', query: 'one&form=mottlegill&seed=3&t=12' },
      { label: 'yellow fieldcaps', query: 'one&form=fieldcap&seed=5&t=12' },
      { label: 'flask fungi', query: 'one&form=flask&seed=3&t=15' },
      { label: 'a mite', query: 'one&seed=4&t=10&critter=macro' },
      { label: 'a springtail', query: 'one&seed=4&t=10&critter=hypo' },
      { label: 'a nematode, caught', query: 'one&seed=4&t=9.6&critter=trap' },
    ],
  },
];

/** The groups, in the order they first appear. */
export function groups(): Array<{ name: string; experiments: Experiment[] }> {
  const out: Array<{ name: string; experiments: Experiment[] }> = [];
  for (const e of EXPERIMENTS) {
    let g = out.find((x) => x.name === e.group);
    if (!g) out.push((g = { name: e.group, experiments: [] }));
    g.experiments.push(e);
  }
  return out;
}
