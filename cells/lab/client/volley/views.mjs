/**
 * Volley's views: the pictures its README is written around. Made with `node cells/lab/views.mjs volley`; each is
 * `static/volley/v-<name>.jpg`. All are the stand-in's game run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__volley';
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'ready', group: 'Sheets', title: 'Before the first ball', caption: 'the first sheet, a way off: a broken-off piece of a fractured wall, a hole through the middle of it, the next ones behind', query: 'seed=1&still', size: PHONE, settle: 1500 },
  { name: 'struck', group: 'Sheets', title: 'A sheet being broken', caption: 'at arm’s length: pieces in the air, the holes’ shadows on the sheet behind, the ball and its own shadow', query: 'seed=1&auto&t=40&still', size: PHONE, settle: 1500 },
  { name: 'glazed', group: 'Sheets', title: 'Glazed shards', caption: 'the blue ones take two blows, and always turn the ball; seen on the way to it', query: 'seed=1&auto&t=77&still', size: PHONE, settle: 1500 },
  { name: 'wide', group: 'Sheets', title: 'On a wider screen', caption: 'the way is the screen’s shape: a wider sheet, of many more shards', query: 'seed=1&auto&t=41&still', size: { width: 1100, height: 620 }, settle: 1500 },
];
