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
    blurb: 'A macro timelapse of a terrarium of dung fungi over three weeks, from a seed: hat-throwers and pin moulds first, then jelly cups, eyelash cups and flask fungi, inkcaps last. Each spreads through the dung and eats it out from under the others. Nematodes ride the thrown sporangia, and mites and springtails graze. The camera goes where something is about to happen.',
    page: 'static/fungi.html',
    preview: 'preview&seed=2&t=250',
    readme: 'static/fungi.md',
    presets: [
      { label: 'a terrarium', query: '' },
      { label: 'no. 2, day 15', query: 'seed=2&t=330' },
      { label: 'throwers alone', query: 'one&seed=2&t=9' },
      { label: 'a pin mould', query: 'one&seed=4&t=8' },
      { label: 'inkcaps', query: 'one&seed=10&t=9' },
      { label: 'jelly cups', query: 'one&seed=9&t=8' },
      { label: 'eyelash cups', query: 'one&form=eyelash&seed=5&t=16' },
      { label: 'flask fungi', query: 'one&form=flask&seed=3&t=15' },
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
