// Switchback's ride test (node cells/lab/devtools/switchback-run.mjs [seconds] [seed…]): the auto rider down a seeded
// course, no page: does it keep to the line, clear the kickers, hold its pace. Prints a line per seed and ok / FAIL.
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), `switchback-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './client/switchback/sim'; export * from './client/switchback/course'; export { ground } from './client/switchback/ground'; export { Trickster } from './client/switchback/tricks'; export { Score, keepBest, board, sign, PAR } from './client/switchback/score'; export { CLAUDE, C15R } from './client/switchback/hand';`, resolveDir: join(here, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { Rider, Course, autoSteer, ground, Trickster, Score, keepBest, board, sign, PAR, CLAUDE, C15R } = await import(outfile);
const secs = Number(process.argv[2] ?? 180), seeds = process.argv.slice(3).map(Number);
let bad = 0;
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const r = new Rider(new Course(seed)), dt = 1 / 120;
  let vSum = 0, n = 0, launches = 0, kickers = 0, cleared = 0, inKicker = false, crashAt = 0;
  for (let t = 0; t < secs; t += dt) {
    const f = r.course.at(r.s).feature, was = r.crashes;
    if (f === 'ramp' && !inKicker) { inKicker = true; kickers++; crashAt = r.crashes; }
    if (inKicker && f === 'none' && !r.air) { inKicker = false; if (r.crashes === crashAt) cleared++; }
    r.step(dt, { steer: autoSteer(r), brake: false });
    void was; vSum += r.v; n++;
  }
  launches = r.jumps;
  const mean = vSum / n, ok = r.crashes <= 1 && mean > 18 && (kickers === 0 || cleared >= kickers - 1);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  seed ${seed}: ${r.dist.toFixed(0)} m in ${secs} s, mean ${(mean * 3.6).toFixed(0)} km/h, ${r.crashes} crashes, kickers ${cleared}/${kickers}, ${launches} launches, best air ${r.bestAir.toFixed(2)} s`);
}
// (and nothing steers for you: hands off, the bike runs straight on and leaves the line at the first real bend)
{
  const r = new Rider(new Course(1)); let t = 0;
  for (; t < 60 && !r.crashes; t += 1 / 120) r.step(1 / 120, { steer: 0, brake: false });
  const ok = r.crashes > 0 && t < 30; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  hands off: off the line after ${t.toFixed(1)} s (nothing steers for you)`);
}
// (the drop side is forgiving: drifting off it you ride the shoulder and the slope for a while, never sinking into the
// ground drawn there, before going too far down is a crash)
{
  let off = 0, sink = 0;
  for (const seed of [1, 2, 3]) {
    const r = new Rider(new Course(seed)); let t = 0;
    while (t < 6) { r.step(1 / 120, { steer: autoSteer(r), brake: false }); t += 1 / 120; }
    for (let k = 0; k < 120 * 20 && !r.crashes; k++) {
      const half = r.course.at(r.s).width / 2;
      r.step(1 / 120, { steer: Math.max(-1, Math.min(1, autoSteer(r) * 0.4 + (r.u < half + 5 ? 0.5 : -0.5))), brake: false });
      if (r.u > half && r.crashT <= 0) { off += 1 / 120; if (!r.air) sink = Math.max(sink, ground(r.course, r.s, r.u) - r.y); }
    }
  }
  const ok = off > 6 && sink < 0.05; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  drop side: ${off.toFixed(1)} s ridden off the road over three seeds, never more than ${sink.toFixed(2)} m into the drawn ground`);
}
// (checkpoints: flags spaced far apart, further apart the further down, and a crash puts you back just past the last one
// passed)
{
  const c = new Course(1); c.ensure(8000);
  const fl = c.st.map((s, i) => (s.flag ? i : -1)).filter((i) => i >= 0), gaps = fl.slice(1).map((v, k) => v - fl[k]);
  const r = new Rider(new Course(1)); let t = 0;
  while (r.checkpoints < 2 && t < 120) { r.step(1 / 120, { steer: autoSteer(r), brake: false }); t += 1 / 120; }
  const cp = r.checkpoint, ahead = r.s + 40;
  while (r.s < ahead && t < 160) { r.step(1 / 120, { steer: autoSteer(r), brake: false }); t += 1 / 120; }
  for (let k = 0; k < 1200 && !r.crashes; k++) r.step(1 / 120, { steer: 1, brake: false });
  for (let k = 0; k < 300 && r.crashT > 0; k++) r.step(1 / 120, { steer: 0, brake: false });
  const first = gaps.slice(0, 3).reduce((a, b) => a + b, 0) / 3, lastG = gaps.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const ok = Math.min(...gaps) >= 250 && lastG > first * 2 && r.crashes > 0 && r.s > cp && r.s < cp + 12; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  checkpoints: ${fl.length} flags in 8 km, ${gaps.slice(0, 3).join(', ')} m apart at the top, ${gaps.slice(-3).join(', ')} m by the end; crashed past checkpoint ${r.checkpoints} (s ${cp}), back at s ${r.s.toFixed(1)}`);
}
// (the take-off model: the lip decides the flight. A whip is a flick across as you leave a big ramp: it swings out and
// comes back by itself, and lands; a body trick (hands off) held into the landing is a crash, and let go in time it lands)
{
  const go = (mode) => {
    const r = new Rider(new Course(1)); let maxW = 0, t = 0, big = false, done = false, held = 0;
    while (t < 18 && !done) {
      const st = r.course.at(r.s), f = st.feature; if (f === 'ramp') big = (st.size ?? 2) >= 3;
      const lipNear = f === 'ramp' && r.course.at(Math.floor(r.s) + 5).feature !== 'ramp';
      let steer = autoSteer(r), trick = 0;
      if (r.air && big && r.jumps > 0) { steer = 0; if (mode === 'whip' && r.airT < 0.2) trick = 1; if (mode === 'hold' && r.airT > 0.35) trick = 1; if (mode === 'brief' && r.airT > 0.35 && r.airT < 0.8) trick = 1; }
      r.step(1 / 120, { steer, brake: false, trick });
      maxW = Math.max(maxW, Math.abs(r.whip)); held = Math.max(held, r.trickHeld);
      if (big && !r.air && r.jumps > 0 && r.crashT <= 0 && maxW + held > 0 && t > 1) done = true;
      if (r.crashes) done = true;
      t += 1 / 120;
    }
    return { crashes: r.crashes, maxW, held };
  };
  const w = go('whip'), h = go('hold'), b = go('brief'), ok = w.crashes === 0 && w.maxW > 0.4 && h.crashes > 0 && b.crashes === 0 && b.held > 0.1; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  the lip: a whip flicked leaving a big ramp threw the bike to ${(w.maxW * 57.3).toFixed(0)}° and came back by itself (${w.crashes} crashes); hands off held into the landing, ${h.crashes ? 'a crash' : 'no crash'}; held ${b.held.toFixed(2)} s and let go in time, ${b.crashes ? 'a crash' : 'landed'}`);
}
// (the pull: on a ramp, down is the pull, not the brake, and how hard you're pulling as you leave is the backflip. Full
// on every ramp with no trim, the smaller jumps can't hold it: crashes; trimmed in the air with the throttle and the rear
// brake, the show-off rider brings them round (below). And the throttle held open pulls harder than left alone)
{
  const go = (mode) => {
    const r = new Rider(new Course(1)); let t = 0;
    while (t < (mode === 'pull' ? 40 : 6)) {
      const f = r.course.at(r.s).feature;
      r.step(1 / 120, { steer: r.air ? 0 : autoSteer(r), brake: false, drive: mode === 'gas' ? 1 : mode === 'pull' && f === 'ramp' && !r.air ? -1 : 0 });
      t += 1 / 120;
    }
    return r;
  };
  const pull = go('pull'), gas = go('gas'), cruise = go('cruise');
  const flips = pull.events.filter((e) => e.kind === 'flip').length;
  const ok = pull.crashes > 0 && gas.v > cruise.v * 1.04; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  the pull: full on every ramp for 40 s, untrimmed, ${pull.crashes} crashes (${flips} flips among the last events); six seconds in, ${(gas.v * 3.6).toFixed(0)} km/h with the throttle open against ${(cruise.v * 3.6).toFixed(0)} left alone`);
}
// (jumps by size, ridden at the run's own pace: a hop about a second, a kicker about two, a big kicker nearly three, a
// booter over three; the landings take whoever clears them, unless they come in too fast)
{
  const air = { 1: [], 2: [], 3: [], 4: [] }, crashed = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const seed of [1, 2, 3, 4, 5]) {
    const c = new Course(seed), r = new Rider(c); let size = 0, lastT = 0, was = false, cr0 = 0;
    for (let i = 0; i < 120 * 180; i++) {
      const st = c.at(r.s);
      if (!r.air && st.feature === 'ramp') { size = st.size ?? 2; cr0 = r.crashes; }
      r.step(1 / 120, { steer: autoSteer(r), brake: false });
      if (r.air) lastT = r.airT;
      if (size && r.crashes > cr0) { crashed[size]++; size = 0; }
      if (size && was && !r.air && r.crashT <= 0) { air[size].push(lastT); size = 0; }
      was = r.air && r.crashT <= 0;
    }
  }
  const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? 0; };
  const want = { 1: [0.6, 1.3], 2: [1.6, 2.5], 3: [2.4, 3.3], 4: [3.0, 4.2] }, crashes = Object.values(crashed).reduce((a, b) => a + b, 0);
  const ok = [1, 2, 3, 4].every((k) => air[k].length && med(air[k]) >= want[k][0] && med(air[k]) <= want[k][1]) && crashes <= 4 && med(air[2]) < 2.3 && med(air[3]) > 2.5; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  jumps: airtime by size ${[1, 2, 3, 4].map((k) => `${k}: ${med(air[k]).toFixed(2)} s (${air[k].length})`).join(', ')}; ${crashes} crashed (too fast for the landing); a flip takes ~2.5 s, so a kicker mostly won't hold one and a big one will`);
}
// (the showing-off rider: flips where there's air for them, whips, slides; it uses only the player's inputs, so what it
// lands a player can)
{
  let tried = {}, landed = {}, flips = 0, crashes = 0;
  for (const seed of [1, 2, 3]) {
    const r = new Rider(new Course(seed)), k = new Trickster(); let last = null;
    for (let i = 0; i < 120 * 180; i++) {
      r.step(1 / 120, k.input(r));
      for (const e of r.events.slice(r.events.indexOf(last) + 1)) if (e.kind === 'flip') flips += Math.abs(e.k); last = r.events[r.events.length - 1];
    }
    crashes += r.crashes;
    for (const [n, v] of Object.entries(k.tried)) tried[n] = (tried[n] ?? 0) + v;
    for (const [n, v] of Object.entries(k.landed)) landed[n] = (landed[n] ?? 0) + v;
  }
  const rate = (n) => (landed[n] ?? 0) / (tried[n] || 1), f = (tried.flip ?? 0) + (tried.front ?? 0), fl = (landed.flip ?? 0) + (landed.front ?? 0);
  const ok = flips >= 6 && fl / (f || 1) >= 0.85 && rate('whip') >= 0.85 && (tried.slide ?? 0) > 3 && crashes <= 4; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  tricks: ${fl}/${f} flips landed (${flips} turns counted), ${landed.whip ?? 0}/${tried.whip ?? 0} whips, ${tried.slide ?? 0} slides; ${crashes} crashes in nine minutes`);
}
// (the score: a 3 km run, the plain rider (pace, air, clean landings, checkpoints) against the showing-off one (flips,
// whips, body tricks, combos): tricks are worth riding for, by 1.4× at least (seed 2's first 3 km has few big jumps, so
// mostly whips); and a fall wipes what's pending)
{
  const run = (tricks, seed) => {
    const r = new Rider(new Course(seed)), k = new Trickster(), sc = new Score(); let last = null, t = 0;
    while (r.s < 3002 && t < 300) {
      r.step(1 / 120, tricks ? k.input(r) : { steer: autoSteer(r), brake: false });
      for (const e of r.events.slice(r.events.indexOf(last) + 1)) sc.event(e, r); last = r.events[r.events.length - 1];
      sc.update(r, 1 / 120); t += 1 / 120;
    }
    sc.close(); return sc;
  };
  const plain = [1, 2].map((s) => run(false, s)), shown = [1, 2].map((s) => run(true, s));
  const w = new Score(); w.event({ kind: 'flip', k: 1 }, {}); const pend = w.pending; w.event({ kind: 'crash', k: 1 }, {});
  const ok = shown.every((s, i) => s.shown > plain[i].shown * 1.4) && plain.every((s) => s.shown > 2000) && pend > 0 && w.pending === 0 && w.falls === 1; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  score: 3 km ridden plainly ${plain.map((s) => s.shown).join(', ')}; showing off ${shown.map((s) => s.shown).join(', ')} (best combos ${shown.map((s) => s.bestCombo).join(', ')}); a fall wipes a pending ${pend}`);
}
// (the board, in a stand-in for the browser's storage: the bests kept before it start it, unsigned; a new best goes up
// where it places and can be signed (and unsigned); a run that isn't a best doesn't; a time trial's go by the clock;
// ten at most. Each has its PAR run on it, signed, never kept with the player's own)
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  store.set('switchback:best:lives:1', JSON.stringify({ score: 5000, time: 90 })); store.set('switchback:best:lives:2', JSON.stringify({ score: 8000, time: 80 }));
  const mine = (m) => board(m).filter((e) => !e.par), seeded = mine('lives').map((e) => e.score).join(',');
  const pars = ['run', 'lives', 'time', 'endless'].every((m) => board(m).filter((e) => e.par).length === 1 && board(m).find((e) => e.par).sig === CLAUDE);
  const a = keepBest('lives', 1, 9000, 100), b = keepBest('lives', 1, 4000, 70);
  sign('lives', a.at, [[10, 20, 0, 30, 40, 5]]);
  const signed = board('lives').find((e) => e.at === a.at)?.sig?.length === 1;
  sign('lives', a.at, []);
  const unsigned = !board('lives').find((e) => e.at === a.at)?.sig, parKept = !store.get('switchback:board:lives').includes('"par"');
  keepBest('time', 1, 100, 200); const t = keepBest('time', 2, 50, 150), tSlow = keepBest('time', 3, 900, 300);
  for (let i = 0; i < 14; i++) keepBest('run', 10 + i, 1000 + i * 100, 60);
  // (lives PAR 10,000: the 9,000 new best goes up second, under it; time PAR 1:45 ahead of 2:30 and 3:20, behind none)
  const ok = pars && seeded === '8000,5000' && a.better && a.rank === 1 && mine('lives').length === 3 && !b.better && b.rank === -1 && signed && unsigned && parKept
    && t.rank === 1 && tSlow.rank === 3 && board('run').length === 10 && board('run')[0].par && mine('run')[0].score === 2300 && PAR.time.time === 105;
  if (!ok) bad++;
  delete globalThis.localStorage;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  board: a PAR on each, signed by Claude; started from the old bests (${seeded}); a new best went up under PAR, signed and unsigned; a lesser run left off; time trials by the clock; ten kept of 14`);
}
// (the hand's autographs: written in order, each stroke's time going on, no stroke empty, and quick enough to write out)
{
  const fine = (sig) => sig.length > 0 && sig.every((s) => s.length >= 3 && s.length % 3 === 0) && sig.flat().every(Number.isInteger)
    && sig.every((s, i) => s.every((v, j) => j % 3 !== 2 || j < 3 || v >= s[j - 3]) && (i === 0 || s[2] >= sig[i - 1][sig[i - 1].length - 1]));
  const secs = (sig) => sig[sig.length - 1][sig[sig.length - 1].length - 1] / 100;
  const ok = fine(CLAUDE) && fine(C15R) && secs(CLAUDE) < 4 && secs(C15R) < 6;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  autographs: Claude's in ${CLAUDE.length} stroke${CLAUDE.length > 1 ? 's' : ''}, ${secs(CLAUDE).toFixed(1)} s; c15r's in ${C15R.length}, ${secs(C15R).toFixed(1)} s`);
}
process.exit(bad ? 1 : 0);
