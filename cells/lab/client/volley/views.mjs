/**
 * Volley's views: the pictures its README is written around. Made with `node cells/lab/views.mjs volley`; each is
 * `static/volley/v-<name>.jpg`. Most are the stand-in's game run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__volley';
const PHONE = { width: 390, height: 844 };
const AIM = () => { const s = window.__volley.sim, sh = s.sheets.find((k) => k.left > 0), d = sh.shards.find((q) => q.hp === 2 && !q.frame && Math.abs(q.cx) < s.W / 2 - 0.6 && Math.abs(q.cy) < 4); if (d) { Object.assign(s.ball, { x: d.cx, y: d.cy, z: sh.z - 1.6, vx: 0, vy: 0, vz: 15, sx: 0, sy: 0 }); s.phase = 'play'; s.flight++; } return !!d; };
export const views = [
  { name: 'ready', group: 'Firings', title: 'Before the first ball', caption: 'the first firing’s door: a great rosette, its petals open, a band of lapis round its hub; the rules to choose under it', query: 'seed=1', size: PHONE, settle: 1500 },
  { name: 'lapis', group: 'Firings', title: 'The first firing: lapis', caption: 'cream body, terracotta, a soft ochre glaze and a hard lapis one; a ringed hole, a fan, the next sheet out of focus beyond', query: 'seed=1&auto&t=28&still', size: PHONE, settle: 1500 },
  { name: 'celadon', group: 'Firings', title: 'The second: celadon', caption: 'porcelain and lilac, a celadon ring round a rosette, oxblood the glaze that takes two', query: 'seed=1&auto&t=66&still', size: PHONE, settle: 1500 },
  { name: 'tenmoku', group: 'Firings', title: 'The third: tenmoku', caption: 'terracotta and bisque, amber glaze and the black one, crazed; the hand’s ring in cream, its arc of dashes full: a bat', query: 'seed=1&auto&t=118&still', size: PHONE, settle: 1500 },
  { name: 'wide', group: 'Firings', title: 'On a wider screen', caption: 'the way is the screen’s shape: a wider sheet, more of it', query: 'seed=1&auto&t=41&still', size: { width: 1100, height: 620 }, settle: 1500 },
  { name: 'blow', group: 'Blows', title: 'A blow that doesn’t break', caption: 'a hard glazed tile struck too softly to break: the flash where it landed, chips spalling off toward you, the tiles round it jolted, the ball squashed against it', query: 'seed=1&auto&t=28&mute', size: PHONE, settle: 1200,
    run: async (v) => { await v.eval(AIM); await v.wait(75); await v.shot(); } },
  { name: 'cracked', group: 'Blows', title: 'What it leaves', caption: 'the tile knocked in a little, cracked from where it was struck down to the clay: one more and it goes', query: 'seed=1&auto&t=28&mute', size: PHONE, settle: 1200,
    run: async (v) => { await v.eval(AIM); await v.wait(1100); } },
  { name: 'course', group: 'The rules', title: 'The course, fired', caption: 'four firings against the clock: the time, the splits against the best, the misses', query: 'seed=1&rules=run&t=12&still', size: PHONE, settle: 1500,
    run: async (v) => { await v.eval(() => { const s = window.__volley.sim; s.clock = 151.6; s.splits = [34.2, 71.9, 112.4, 151.6]; s.misses = 2; s.from = 24; s.phase = 'done'; }); await v.wait(800); } },
];
