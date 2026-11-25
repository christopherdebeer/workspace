/**
 * Piste's views: the pictures its README is written around (`node cells/lab/views.mjs piste`), each
 * `static/piste/v-<name>.jpg`. All are the stand-ins' bout run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__piste';
const PHONE = { width: 390, height: 844 }, WIDE = { width: 1000, height: 560 };
const until = async (v, fn, ms = 120000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await v.page.evaluate(fn)) return true; await v.wait(300); } return false; };
export const views = [
  { name: 'menu', group: 'Learning', title: 'Learn, or fence', caption: 'seven lessons in the order a beginner learns them; four opponents, each allowing less bullet time', query: '', size: PHONE, settle: 800 },
  { name: 'brief', group: 'Learning', title: 'A lesson’s brief', caption: 'what the master says before the first repetition', query: 'lesson=quarte', size: PHONE, settle: 800 },
  { name: 'lesson', group: 'Learning', title: 'A lesson under way', caption: 'the coach about to attack on your inside line; the count of good repetitions at full speed, and the pace', query: 'lesson=quarte', size: PHONE, settle: 800,
    run: async (v) => { await v.page.click('#bGo'); await until(v, () => window.__piste.lesson.stage === 'go'); await v.wait(1200); } },
  { name: 'verdict', group: 'Learning', title: 'The verdict', caption: 'the judge reads the bout: here, no parry at all, and what to do instead', query: 'lesson=quarte', size: PHONE, settle: 800,
    run: async (v) => { await v.page.click('#bGo'); await until(v, () => window.__piste.lesson.stage === 'result', 240000); await v.wait(400); } },
  { name: 'replay', group: 'Learning', title: 'The touch again', caption: 'after each touch, the last second again, slowing into the hit, from the side, with what happened written as it happens', query: 'auto&level=2', size: WIDE, settle: 800,
    run: async (v) => { await until(v, () => window.__piste.replaying, 240000); await v.wait(2500); } },
  { name: 'mask', group: 'The bout', title: 'En garde, through the mask', caption: 'at the lines, before allez: their point toward you, your own bell low on the right', query: 't=0.5&still', size: PHONE, settle: 1200 },
  { name: 'close', group: 'The bout', title: 'In distance', caption: 'a riposte coming: their bell turned toward your blade, your blade crossing theirs', query: 'auto&t=2.6&still', size: PHONE, settle: 1200 },
  { name: 'wrist', group: 'The bout', title: 'Touched on the arm', caption: 'your bell covered your chest, so they went for what it didn\'t: your arm. Their lamp is lit', query: 'auto&t=6.43&still', size: PHONE, settle: 1200 },
  { name: 'double', group: 'The bout', title: 'A touch, from the side', caption: 'the lunge home, the blade bowed against the chest, your lamp lit; the clock under the score', query: 'auto&view=side&t=12.27&still', size: WIDE, settle: 1200 },
  { name: 'readout', group: 'The bout', title: 'What the box hears', caption: 'the readout: the gap, each tip\'s force against its 7.35 N, how far each blade is bowed, how hard each hand is working, what the opponent is doing', query: 'auto&view=side&readout&t=5.2&still', size: WIDE, settle: 1500 },
];
