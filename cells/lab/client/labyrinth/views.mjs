/**
 * The labyrinth's views: the pictures its README (static/labyrinth.md) is written around, each made by opening the page
 * where the README says to look (`node cells/lab/views.mjs labyrinth`; each is `static/labyrinth/v-<name>.jpg`). Each is
 * built from a seed and its touches, at once, and seen from a corner.
 */
export const ready = '__labyrinth';

const DEMO = 'seed=7&taps=8.8,8.8,8.8,4.12,12.4,8.8,12.12,4.4,8.8';
const TOWER = 'seed=1&taps=8.8,8.8,8.8,8.8,8.8';

export const views = [
  { name: 'stone', group: 'Building', title: 'The stone', caption: 'where it starts: a flat stone, and nothing on it', query: 'seed=7&taps=' },
  { name: 'one', group: 'Building', title: 'A touch', caption: 'the walls of a maze rise round where it was touched', query: 'seed=7&taps=8.8' },
  { name: 'three', group: 'Building', title: 'Three touches, in one place', caption: 'each touch builds a level higher there, and spreads the ones below', query: 'seed=7&taps=8.8,8.8,8.8' },
  { name: 'built', group: 'Building', title: 'A labyrinth', caption: 'nine touches: a mound of levels, each a maze, each on arches over the one below', query: DEMO },
  { name: 'built-turned', group: 'Building', title: 'From another corner', caption: 'turned a quarter: it settles on a corner, looking down a diagonal', query: `${DEMO}&turn=1` },
  { name: 'arches', group: 'Arches and stairs', title: 'Arches', caption: 'the passages below run on under the level above: its walls and walkways stand on arches', query: `${TOWER}&turn=1&zoom=0.45` },
  { name: 'stairs', group: 'Arches and stairs', title: 'Stairs', caption: 'dead ends nothing\'s built over climb onto the wall at their end: the walls\' tops are walkways', query: `${DEMO}&zoom=0.4` },
  { name: 'tower', group: 'Arches and stairs', title: 'A tower', caption: 'touched five times in the same place', query: `${TOWER}&turn=2&zoom=0.55` },
  { name: 'print', group: 'Print', title: 'As a print', caption: 'print: the light hatched, closer and crossed as it darkens', query: `${DEMO}&print` },
  { name: 'print-close', group: 'Print', title: 'Close, as a print', caption: 'the arches and stairs, in lines', query: `${TOWER}&print&turn=1&zoom=0.45` },
];
