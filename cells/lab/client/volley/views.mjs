/**
 * Volley's views: the pictures its README is written around. Made with `node cells/lab/views.mjs volley`; each is
 * `static/volley/v-<name>.jpg`. All are the stand-in's game run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__volley';
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'serve', group: 'The court', title: 'Waiting to serve', caption: 'the bat on the boards in front of you, the ball on it, the bricks in their tiers at the far end', query: 'seed=1&still', size: PHONE, settle: 1200 },
  { name: 'rally', group: 'The court', title: 'A ball coming back', caption: 'the ball lights the boards under it; its shadow says where it is', query: 'seed=1&auto&t=21&still', size: PHONE, settle: 1200 },
  { name: 'plan', group: 'The court', title: 'With the plan', caption: 'the same game from above, in the corner: the game as it has always been drawn, and the wedge of it the eye takes in', query: 'seed=1&auto&t=44&still&plan', size: PHONE, settle: 1200 },
  { name: 'wide', group: 'The court', title: 'On a wider screen', caption: 'late in the first court: lanes cut through to the back wall', query: 'seed=1&auto&t=52&still', size: { width: 1100, height: 620 }, settle: 1200 },
  { name: 'keep', group: 'Courts', title: 'The keep', caption: 'court four: a ring of bricks round a dark core that takes two', query: 'seed=1&level=4&still', size: PHONE, settle: 1200 },
];
