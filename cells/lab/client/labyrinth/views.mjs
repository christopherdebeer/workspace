/**
 * The labyrinth's views: the pictures its README (static/labyrinth.md) is written around, each made by opening the page
 * where the README says to look (`node cells/lab/views.mjs labyrinth`; each is `static/labyrinth/v-<name>.jpg`). Each is
 * built at once from its pieces (`?p=`, as the model writes them), or is the demo.
 */
export const ready = '__labyrinth';

const tower = (i, j, h, kinds = []) => Array.from({ length: h }, (_, k) => `${kinds[k] ?? 'b'}.${k}.${i}.${j}.${kinds[k] === 'a' ? 1 : 0}.1`);
const FIRST = ['b.0.5.5.0.1', 'b.0.6.5.0.1', 'b.1.5.5.0.1', 's.0.7.5.2.1', 'cy.0.4.7.0.1'].join(',');
const BRIDGE = [...tower(3, 5, 3, ['a', 'a', 'b']), ...tower(7, 5, 3, ['b', 'a', 'b']), 'br.2.4.5.0.3', 's.0.8.5.2.1', 'cy.0.5.7.0.1', 'p.0.5.4.0.1', 'p.0.6.4.0.1'].join(',');

export const views = [
  { name: 'stone', group: 'Building', title: 'The stone', caption: 'where it starts: a flat travertine stone, on a table in the sun', query: 'p=' },
  { name: 'first', group: 'Building', title: 'The first pieces', caption: 'a block on the stone, another on it, a stair up onto its neighbour, a cypress', query: `p=${FIRST}&zoom=0.5` },
  { name: 'bridge', group: 'Building', title: 'A bridge', caption: 'two towers, and one touch between them: a bridge on one arch, as low as both towers let it spring', query: `p=${BRIDGE}&zoom=0.5` },
  { name: 'demo', group: 'A labyrinth', title: 'A labyrinth', caption: 'towers with tall arches, a bridge on a great arch between two of them, an arcade, stairs, pools, cypresses', query: 'demo' },
  { name: 'demo-turned', group: 'A labyrinth', title: 'From another corner', caption: 'turned a quarter: it settles on a corner', query: 'demo&turn=1' },
  { name: 'close', group: 'A labyrinth', title: 'Close', caption: 'the light gathered in the arches; the travertine, banded and pitted', query: 'demo&zoom=0.42' },
  { name: 'print', group: 'Print', title: 'As a print', caption: 'print: the light hatched, closer and crossed as it darkens', query: 'demo&print' },
  { name: 'print-close', group: 'Print', title: 'Close, as a print', caption: 'the arches and stairs, in lines', query: 'demo&print&zoom=0.42&turn=1' },
];
