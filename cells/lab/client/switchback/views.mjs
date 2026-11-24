/**
 * Switchback's views: the pictures its README is written around. Made with `node cells/lab/views.mjs switchback`; each
 * is `static/switchback/v-<name>.jpg`.
 *
 * Most are the sim's own rider run on to a moment and held there with nothing over it (`t=…&still&preview`); those about
 * play itself (a scored run, its card, the speed, the air through a flip) are the sim's run as it goes (`auto=tricks`),
 * caught when the moment comes. All at a phone's size unless the name says otherwise.
 */
export const ready = '__switchback';
const PHONE = { width: 390, height: 844 };
const HELD = (q) => `${q}&still&preview`;
const STUDY = { width: 700, height: 560 };
export const helpers = (page, v) => ({
  /** wait (up to `ms`) until `fn` (run in the page) says so */
  async until(fn, ms = 120000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(150); } return false; },
});
export const views = [
  { name: 'ride', group: 'Riding', title: 'Down the cliff road', caption: 'the wall rising on the left, the drop on the right, a kicker’s chevrons ahead; the road carved in combs of cuts', query: HELD('paint=0&seed=1&t=9.5'), size: PHONE },
  { name: 'wide', group: 'Riding', title: 'On a bigger screen', caption: 'the far ranges, the valley and its river below', query: HELD('paint=0&seed=1&t=9.5'), size: { width: 1280, height: 720 } },
  { name: 'run', group: 'A run', title: 'A run, scored', caption: 'the score top right, the mode’s distance under it, and the combo pending: a backflip, its airtime, a clean landing, ×1; the trick called across the screen', query: 'paint=0&seed=1&auto=tricks&mode=run&t=88', size: PHONE, settle: 1000,
    run: async (v) => { await v.until(() => !!document.getElementById('combo').textContent && document.getElementById('note').classList.contains('on'), 90000); await v.shot(); } },
  { name: 'card', group: 'A run', title: 'The run’s card', caption: 'at the end of the mode (here RUN, three kilometres): the score, distance, time, tricks, best combo and falls; a run of yours that makes the board is yours to sign; the sim’s are never kept', query: 'paint=0&seed=1&auto=tricks&mode=run&t=84', size: PHONE, settle: 1000,
    run: async (v) => { await v.until(() => window.__switchback.probe().finished, 120000); await v.wait(800); await v.shot(); } },
  { name: 'painted', group: 'Painted', title: 'Painted (`paint=1`)', caption: 'the same frame with nothing but brush strokes on paper: the road and the snow by it along the way, the rock brushed down its face, the far peaks painted along their ridges, lit from the left, the sky in strokes, the rider and its shadow too', query: HELD('seed=1&t=9.5&paint=1'), size: STUDY, settle: 45000 },
  { name: 'painted-ride', group: 'Painted', title: 'Painted, riding', caption: 'at speed: each stroke stretched along its own motion on the screen, so the speed is in the ground’s own marks', query: 'seed=1&auto&t=20&preview&paint=1', size: PHONE, settle: 9000 },
  { name: 'title', group: 'A run', title: 'The title', caption: 'the sim’s rider showing off behind it; c15r’s autograph across the logo; ride, the mode, the leaderboard', query: 'paint=0&seed=1', size: PHONE, settle: 7000 },
  { name: 'board', group: 'A run', title: 'The leaderboard', caption: 'each mode’s best runs in this browser, each signed; the PAR signed by Claude', query: 'paint=0&seed=1', size: PHONE, settle: 2000,
    run: async (v) => { await v.eval(() => document.getElementById('toBoard').click()); await v.wait(4500); } },
  { name: 'side', group: 'The bike and rider', title: 'From the side', caption: 'cut colour: the orange jersey and bodywork, the legs and the machine one charcoal, cream where it touches and steers', query: HELD('paint=0&seed=1&t=9.5&look=side'), size: STUDY },
  { name: 'quarter', group: 'The bike and rider', title: 'From behind, over the shoulder', caption: '', query: HELD('paint=0&seed=1&t=9.5&look=quarter'), size: STUDY },
  { name: 'whip', group: 'The bike and rider', title: 'A whip', caption: 'steered in the air: the machine laid over and yawed under the rider', query: HELD('paint=0&seed=1&auto=tricks&t=6.9&cam=close'), size: PHONE },
  { name: 'flip', group: 'The bike and rider', title: 'Coming round from a backflip', caption: 'the eye eased out to the drop side for a long flight', query: HELD('paint=0&seed=1&auto=tricks&t=26.1'), size: PHONE },
  { name: 'ruts', group: 'The road', title: 'Carved ruts', caption: 'the road told as a linocut tells it: combs of parallel cuts going with the road, each with a violet ink wall and a white lip; short choppy cuts below a rock step', query: HELD('paint=0&seed=1&t=10'), size: PHONE },
  { name: 'ruts-bend', group: 'The road', title: 'Through a bend', caption: 'the combs longer and leaning out', query: HELD('paint=0&seed=1&t=4.8'), size: PHONE },
  { name: 'whoops', group: 'The road', title: 'Whoops', caption: 'hatching across the face of each hump, so the humps read as humps', query: HELD('paint=0&seed=3&t=4.5'), size: PHONE },
  { name: 'bolts', group: 'The road', title: 'The ruts as they were', caption: 'bolts (`ruts=bolts`): chains of thin dark wedges along the riding lines', query: HELD('paint=0&seed=1&t=10&ruts=bolts'), size: PHONE },
  { name: 'speed', group: 'Speed, drawn', title: 'Speed', caption: 'white and pale, the air: streaks hung ahead that the eye flies through; orange off the back as the engine pushes; posts smeared back', query: 'paint=0&seed=1&auto&t=4&preview', size: PHONE, settle: 3000 },
  { name: 'air', group: 'Speed, drawn', title: 'The air peeling off the rider', caption: 'leaning into a bend: streaks of air leaving the figure\u2019s flank, fine at the body and broadening toward the eye; on the ground never up off the top (from behind, that reads as hair on end)', query: HELD('paint=0&seed=1&auto=tricks&t=6.0'), size: PHONE },
];
