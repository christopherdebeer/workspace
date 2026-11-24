/**
 * Roof Jumps' views: the pictures its README is written around. Made with `node cells/lab/views.mjs roofjumps`; each
 * is `static/roofjumps/v-<name>.jpg`.
 *
 * All of them are the page itself, opened a particular way, so each is also a link: the study sheets are its own
 * `sheet=` and `strip=` modes; a move caught mid-way is its own run, run on until it's in that move (`seek`) and held;
 * the plan and the dials are it with those on.
 */
export const ready = '__roofjumps';
const WIDE = { width: 880, height: 495 }, PHONE = { width: 390, height: 844 };
const CELL = 220, sheet = (moves, extra = 'side=90') => ({ query: `sheet=${moves.join(',')}&${extra}&zoom=2.1&far=1`, size: { width: CELL * 5, height: CELL * moves.length } });
/** its own run, run on until it's in `move`, `mu` through it, and held there */
const caught = (move, mu = 0.5, query = 'auto&preview') => ({ query, size: WIDE, settle: 1500, run: async (v) => { if (!(await v.seek(move, mu))) throw new Error(`it never came to a ${move}`); await v.built(); } });
export const helpers = (page, v) => ({
  seek: (move, mu) => page.evaluate(([m, u]) => window.__roofjumps.seek(m, u), [move, mu]),
  /** wait until every chunk in view is made, and a moment more */
  async built() { for (let n = 0; n < 120 && (await page.evaluate(() => window.__roofjumps.probe().pending)) > 0; n++) await page.waitForTimeout(250); await page.waitForTimeout(900); },
});
const built = { run: async (v) => { await v.built(); } };
export const views = [
  { name: 'run', group: 'The run', title: 'Over the roofs', caption: 'the eye close behind and a little above; one grey, one light, the lattice drawn faintly', query: 'auto&t=5&still&preview', size: WIDE, ...built },
  { name: 'phone', group: 'The run', title: 'On a phone', caption: '', query: 'auto&t=5&still&preview', size: PHONE, ...built },
  { name: 'glide', group: 'The run', title: 'A glide', caption: 'the slow one: arms out, sinking gently, steerable', ...caught('glide', 0.6) },
  { name: 'wallrun', group: 'The run', title: 'Along a wall', caption: 'tipped off it, the feet on it, the far arm out', ...caught('wallrun', 0.5) },
  { name: 'wallrun-feet', group: 'The holds', title: 'Feet on the wall', caption: 'along a wall with the tags shown: the wall itself is the hold (the ticks), a black ring where a foot is down on it, a red one where the near hand steadies', ...caught('wallrun', 0.6, 'auto&preview&holds&eyeDist=3.4&eyePitch=12&side=-55') },
  { name: 'footfall', group: 'The holds', title: 'A footfall', caption: 'running: the foot that is down stays where it was put while the body goes over it', ...caught('dash', 1, 'auto&preview&holds&eyeDist=3.2&eyePitch=14&side=75') },
  { name: 'dive', group: 'The run', title: 'A dive', caption: 'a storey down, headfirst; rolled out of', ...caught('dive', 0.5) },
  { name: 'spring', group: 'The run', title: 'A spring', caption: 'a storey up, the arms thrown up', ...caught('spring', 0.25) },
  { name: 'flip', group: 'The run', title: 'A flip', caption: 'over something tall, or every other long bound', ...caught('flip', 0.5) },
  { name: 'dash', group: 'The run', title: 'A dash', caption: 'out of a roll, or off a clean landing with room ahead', ...caught('dash') },

  { name: 'poses-ground', group: 'The moves, held', title: 'On the ground', caption: 'run, dash, ledge, a landing, a roll: each at five points through it, from the side', ...sheet(['run', 'dash', 'ledge', 'land', 'roll']) },
  { name: 'poses-air', group: 'The moves, held', title: 'In the air', caption: 'hop, bound, flip, spring, dive, glide', ...sheet(['hop', 'bound', 'flip', 'spring', 'dive', 'glide']) },
  { name: 'poses-rear', group: 'The moves, held', title: 'From behind', caption: 'what the chase eye sees of them: bound, spring, glide, ledge, a climb, a wall run', ...sheet(['bound', 'spring', 'glide', 'ledge', 'climb', 'wallrun'], 'side=28') },

  { name: 'holds', group: 'The holds', title: 'What the city offers', caption: 'tags, not things: every top edge (blue), a sill at each storey on most faces (green), a pipe on some (orange), the middle of anything narrow (white), and each wall itself, for the feet (violet ticks); shown within ten metres of the figure', query: 'auto&t=5&still&holds&holdsNear=22&eyeDist=11&eyePitch=30', size: WIDE, ...built },
  { name: 'vault', group: 'The holds', title: 'A vault', caption: 'a hand planted on the edge of what it goes over', ...caught('vault', 0.3, 'auto&holds&eyeDist=4&eyePitch=30&side=70') },
  { name: 'poses-holds', group: 'The holds', title: 'Reaching, held', caption: 'a vault on one hand and on two, a climb, a landing with a hand down, a wall run with a hand on the wall: the pose, and the arm taken to the hold', query: 'sheet=vault,vault2,climb,land,wallrun&side=60&zoom=2.1&far=1', size: { width: CELL * 5, height: CELL * 5 } },

  { name: 'strip', group: 'In motion', title: 'Three seconds, frame by frame', caption: 'its own run from 5 s, a frame every tenth of a second, the move named on each', query: 'strip=5&frames=30&every=0.1&cols=6', size: { width: 1320, height: 5 * 190 }, ...built },
  { name: 'strip-side', group: 'In motion', title: 'The same, from the side', caption: '', query: 'strip=5&frames=30&every=0.1&cols=6&side=80&zoom=1.25', size: { width: 1320, height: 5 * 190 }, ...built },

  { name: 'plan', group: 'The plan', title: 'The plan, from behind', caption: 'the way asked broad, the best to the left and to the right narrower, the rest of the fan hairlines; coloured by move, a ring where each begins; said in words above', query: 'auto&t=13&still&plan&readout', size: WIDE, ...built },
  { name: 'plan-above', group: 'The plan', title: 'From above', caption: 'three seconds of route down each of nine headings', query: 'auto&t=13&still&plan&readout&eyeDist=38&eyePitch=62', size: WIDE, ...built },
  { name: 'plan-slow', group: 'The plan', title: 'Mid-leap', caption: 'the plan is thought again eight times a second, from wherever the figure is', ...caught('bound', 0.5, 'auto&plan&readout') },

  { name: 'dials', group: 'The dials', title: 'The palette', caption: 'the plan’s dials open: a mark on each slider where the house keeps it, a dot on a group with something moved', query: 'auto&t=6&still&plan&readout', size: PHONE, run: async (v) => { await v.built(); await v.page.click('#dialsbtn'); await v.wait(300); } },
  { name: 'dials-leap', group: 'The dials', title: 'The leap', caption: 'gravity, reach, where dives begin, how often it flips', query: 'auto&t=6&still&gravity=14', size: PHONE, run: async (v) => { await v.built(); await v.page.click('#dialsbtn'); await v.page.click('#dials .row button:nth-child(3)'); await v.wait(300); } },

  { name: 'above', group: 'The city', title: 'The city, from above', caption: 'chunks of boxes on a one-metre lattice: lots, alleys, walls across them, rims, huts, units', query: 'auto&t=5&still&preview&eyeDist=70&eyePitch=68&far=5', size: WIDE, ...built },
  ...[['clay', 'Clay', 'no lattice'], ['wire', 'Wire', 'every triangle’s edges'], ['tags', 'Tags', 'what each face is'], ['normals', 'Normals', 'which way each face faces']].map(([look, title, caption]) => ({ name: `look-${look}`, group: 'The looks', title, caption, query: `auto&t=5&still&preview&look=${look}`, size: { width: 660, height: 372 }, ...built })),
];
