/**
 * Taohua's views: the pictures its README (static/taohua.md) is written around, each made by opening the page where
 * the README says to look. Made with `node cells/lab/views.mjs taohua` (see views.mjs there); each is
 * `static/taohua/v-<name>.jpg`.
 *
 * Almost all are `review`: the walker, the camera and the falling petals held still, at full resolution, so the same
 * view comes out the same each time it's made. Places on the hill are seed 1's (and one on still-ford-7), as the
 * README names them; the benches are their own scenes.
 */
export const ready = '__taohua';

/** a place on seed 1's hill, held still */
const AT = (at, seed = 1) => `seed=${seed}&at=${at}&review`;

export const helpers = (page) => ({
  /** the page's own state */
  state: () => page.evaluate(() => window.__taohua),
});

export const views = [
  // ─── the river, and setting out ───
  { name: 'title', group: 'The river', title: 'The start', caption: 'out on the broad water, nothing of the hill yet: the boat, the walker low in it, and the title in ink on the water', query: 'splash', settle: 5000 },
  { name: 'arrive', group: 'The river', title: 'Arriving', caption: 'the boat through the narrows, the banks coming in: rocks first, then the blossom', query: 'bench=river&scene=arrive&review', settle: 5000 },
  { name: 'jetty', group: 'The river', title: 'The jetty', caption: 'the pier of stone, its lantern, the boat moored across it; the gate up to the first way', query: 'bench=river&scene=jetty&review', settle: 5000 },
  { name: 'far-bank', group: 'The river', title: 'From the far bank', caption: 'back across the river to the hill: its banks held by black rocks, reeds between', query: 'bench=river&scene=far&review', settle: 5000 },
  { name: 'near-bank', group: 'The river', title: 'Along the near bank', caption: 'the current drawn as the prints draw it: trails of small crests, few where it\'s slack', query: 'bench=river&scene=bank&review', settle: 5000 },
  { name: 'open-water', group: 'The river', title: 'Out on the water', caption: 'the broad water upstream, its far bank lost to the eye', query: 'bench=river&scene=open&review', settle: 5000 },

  // ─── the hill and its ways, seed 1 ───
  { name: 'climb', group: 'The hill', title: 'On the way up', caption: 'seed 1, a way among the blossom: stone steps where it\'s steep, a trail where it\'s gentle', query: AT('w3:40') },
  { name: 'fork', group: 'The hill', title: 'A fork', caption: 'a way parting in two, each heading off across the hill', query: AT('w3:36') },
  { name: 'pavilion', group: 'The hill', title: 'A pavilion', caption: 'teal tiles and red columns, at the end of a spur', query: AT('w10:15') },
  { name: 'pagoda', group: 'The hill', title: 'A pagoda', caption: 'storeys of teal eaves over the crowns', query: AT('w11:22') },
  { name: 'gate', group: 'The hill', title: 'A gate', caption: 'two red columns and a roof over the way, and the way going on through it', query: AT('w13:61') },
  { name: 'hall', group: 'The hill', title: 'A hall', caption: 'where a branch ends at a building', query: AT('w64:9') },
  { name: 'cast', group: 'Changes along the way', title: 'A cast where a branch ends', caption: 'six lines in the paper kept open, the moving lines vermilion, its name in a column beside them', query: AT('w19:44') },
  { name: 'cast-page', group: 'Changes along the way', title: 'Its page', caption: 'tapped: the figure, its names, Legge\'s Judgment and Image, its changing lines, a question to sit with', query: AT('w19:44'), run: async (v) => { await v.eval(() => window.__taohua.read()); await v.wait(1500); } },
  { name: 'notes', group: 'Changes along the way', title: 'Travel notes', caption: 'the seal 記: the temples, casts and landings nearby, nearest first; the journal; settings and the benches', query: AT('w3:40'), run: async (v) => { await v.eval(() => window.__taohua.sheet('side')); await v.wait(1500); } },
  { name: 'cast-own', group: 'Changes along the way', title: 'Casting a reading', caption: 'the drawer: a question, then three coins thrown six times, the figure built from the bottom', query: AT('w3:40'), run: async (v) => { await v.eval(() => window.__taohua.sheet('drawer')); await v.wait(1500); } },

  // ─── the water ───
  { name: 'waterfall', group: 'The water', title: 'A waterfall\'s pool', caption: 'seed 1: the fall, its pool, stepping stones below', query: AT('w8:8') },
  { name: 'arch', group: 'The water', title: 'A stone arch', caption: 'a way over a stream', query: AT('w29:36') },
  { name: 'stepping', group: 'The water', title: 'Stepping stones', caption: 'still-ford-7: over a winding stream, a waterfall above', query: AT('w41:19', 'still-ford-7') },
  ...['pond', 'bend', 'rapid', 'fall'].map((s) => ({ name: `water-${s}`, group: 'The water', title: { pond: 'Still water', bend: 'A bend', rapid: 'Running fast', fall: 'A fall' }[s], caption: `the water bench: ${s}`, query: `bench=water&scene=${s}&review`, settle: 4000 })),

  // ─── the ways, close to ───
  ...[['flight', 'a flight of steps'], ['rock', 'cut into the rock'], ['timber', 'timber treads'], ['cut', 'cut into the bank'], ['bend', 'a bend'], ['steep', 'steep']].map(([s, w]) => ({ name: `ways-${s}`, group: 'The ways, close to', title: w[0].toUpperCase() + w.slice(1), caption: `the ways bench: ${w}`, query: `bench=ways&scene=${s}&review`, settle: 4000 })),

  // ─── the trees ───
  ...[['lone', 'a tree alone'], ['pair', 'a pair'], ['grove', 'a grove'], ['rocks', 'among rocks'], ['water', 'by water'], ['lineup', 'the kinds, side by side']].map(([s, w]) => ({ name: `tree-${s}`, group: 'The trees', title: w[0].toUpperCase() + w.slice(1), caption: `the tree bench: ${w}`, query: `bench=tree&scene=${s}&review`, settle: 4000 })),

  // ─── the composition view ───
  { name: 'ink', group: 'The composition view', title: 'The composition view', caption: '墨: only the arrangement, in a few inks: blossom a grey wash, rock black, buildings vermilion, every way a stroke', query: `${AT('w3:40')}&ink`, settle: 5000 },
  { name: 'ink-fork', group: 'The composition view', title: 'A fork, in masses', caption: 'the forks and meetings at a glance', query: `${AT('w3:36')}&ink`, settle: 5000 },
];
