/**
 * Bamboo's views: the frames its README is written around, and the ones it's judged by against the board
 * (devtools/bamboo/board.jpg). Made with `node cells/lab/views.mjs bamboo`; each is `static/bamboo/v-<name>.jpg`.
 * All on seed 1, time held (`still`).
 */
export const ready = '__bamboo';
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'a', group: 'Against the board', title: 'The near frame', caption: 'up the stone stair toward the turn at its top: culms crowding the bank, their nodes ticked in ink, the treads outlined, the litter warm on every step (target A)', query: 'seed=1&ref=a&t=8&still', size: PHONE },
  { name: 'b', group: 'Against the board', title: 'How it thins', caption: 'along the lower track: the near culms drawn whole, the colour held to the path, the far side going to a few verticals and then the page (target B)', query: 'seed=1&ref=b&t=8&still', size: PHONE },
  { name: 'c', group: 'Against the board', title: 'The walk', caption: 'along the contour, the grove dense up the bank, the valley opening on the other side (target C)', query: 'seed=1&ref=c&t=8&still', size: PHONE },
  { name: 'up', group: 'Looks', title: 'Looking up', caption: 'the culms converging, the sprays against the sky', query: 'seed=1&ref=up&t=8&still', size: PHONE },
  { name: 'gust', group: 'Looks', title: 'A gust', caption: 'a gust coming down through the grove: the tops bent over, the sprays streaming', query: 'seed=1&ref=gust&t=8&still', size: PHONE },
  { name: 'wide', group: 'Looks', title: 'On a bigger screen', caption: 'the lower track, the valley open to the left', query: 'seed=1&ref=c&t=8&still', size: { width: 1280, height: 720 } },
];
