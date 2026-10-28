/**
 * Bamboo's views: the frames its README is written around, and the ones it's judged by against the board
 * (devtools/bamboo/board.jpg). Made with `node cells/lab/views.mjs bamboo`; each is `static/bamboo/v-<name>.jpg`.
 * All on seed 1, time held (`still`); each frame is found on the mountain by what it needs (a stair's foot, a trail
 * with a fall beside it, a cliff's rim).
 */
export const ready = '__bamboo';
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'run', group: 'The run', title: 'Running', caption: 'loping through the grove, off the trails: the culms streaming past, the head rising and falling with the stride', query: 'seed=1&ref=run&t=8&still', size: PHONE },
  { name: 'c', group: 'The run', title: 'In the grove', caption: 'standing in the grove, off the trails, the culms close, the light coming down through them (target C)', query: 'seed=1&ref=c&t=8&still', size: PHONE },
  { name: 'a', group: 'Things you meet', title: 'A stair', caption: 'where a trail climbs a cliff band: a flight of stone steps (target A)', query: 'seed=1&ref=a&t=8&still', size: PHONE },
  { name: 'b', group: 'Things you meet', title: 'A trail along a fall', caption: 'a trail with the ground falling away beside it: the near culms drawn whole, the far side going to the page (target B)', query: 'seed=1&ref=b&t=8&still', size: PHONE },
  { name: 'cliff', group: 'Things you meet', title: 'A cliff’s rim', caption: 'too big a drop to take: the run stops at the edge, the valley beyond', query: 'seed=1&ref=cliff&t=8&still', size: PHONE },
  { name: 'drawing', group: 'How far it’s drawn', title: 'Drawing', caption: 'the colour held close (8 m), a wash of its tones in ink to 28 m, then the marks alone on the paper', query: 'seed=1&ref=run&t=8&still&reach=drawing', size: PHONE },
  { name: 'marks', group: 'How far it’s drawn', title: 'Marks only', caption: 'no colour at all: the culms as paper, their outlines and node ticks; the sprays as brush strokes; the litter as fine leaf marks', query: 'seed=1&ref=run&t=8&still&reach=marks', size: PHONE },
  { name: 'picture', group: 'How far it’s drawn', title: 'Picture', caption: 'the colour carried far, the wash and ink beyond it', query: 'seed=1&ref=run&t=8&still&reach=picture', size: PHONE },
  { name: 'frame', group: 'How far it’s drawn', title: 'The frame drawn out', caption: 'the page closing in tight from the frame’s edges (`frame=0.1`), nearer things holding on to it: the ground at your feet and the culm beside you in colour, the grove beyond them going to the paper first', query: 'seed=1&ref=run&t=8&still&frame=0.1', size: PHONE },
  { name: 'up', group: 'Looks', title: 'Looking up', caption: 'the culms converging, the sprays against the sky', query: 'seed=1&ref=up&t=8&still', size: PHONE },
  { name: 'gust', group: 'Looks', title: 'A gust', caption: 'a gust coming through the grove: the tops bent over, the sprays streaming', query: 'seed=1&ref=gust&t=8&still', size: PHONE },
  { name: 'wide', group: 'Looks', title: 'On a bigger screen', caption: 'running, in landscape', query: 'seed=1&ref=run&t=8&still', size: { width: 1280, height: 720 } },
];
