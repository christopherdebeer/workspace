/**
 * Volley's views: the pictures its README is written around. Made with `node cells/lab/views.mjs volley`; each is
 * `static/volley/v-<name>.jpg`. All are the stand-in's game run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__volley';
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'ready', group: 'The tunnel', title: 'Before the first ball', caption: 'the glass is the whole screen; the first slab ahead, a frame of bricks, and the next ones through it', query: 'seed=1&still', size: PHONE, settle: 1200 },
  { name: 'back', group: 'The tunnel', title: 'A ball in flight', caption: 'it lights the walls round it, which is most of how its depth is read', query: 'seed=1&auto&t=9&still', size: PHONE, settle: 1200 },
  { name: 'deep', group: 'The tunnel', title: 'Further down', caption: 'a later slab at arm’s length, the lamps another colour; the orange ring is where the ball will come back through the glass', query: 'seed=1&auto&t=75.5&still&hand=catch', size: PHONE, settle: 1200 },
  { name: 'wide', group: 'The tunnel', title: 'On a wider screen', caption: 'the tunnel is the screen’s shape: more columns across', query: 'seed=1&auto&t=41&still&hand=swipe', size: { width: 1100, height: 620 }, settle: 1200 },
];
