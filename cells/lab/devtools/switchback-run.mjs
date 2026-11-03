// Switchback's ride test (node cells/lab/devtools/switchback-run.mjs [seconds] [seed…]): the auto rider down a seeded
// course, no page: does it keep to the line, clear the kickers, hold its pace. Prints a line per seed and ok / FAIL.
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), `switchback-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './client/switchback/sim'; export * from './client/switchback/course'; export { ground } from './client/switchback/ground'; export { Trickster } from './client/switchback/tricks';`, resolveDir: join(here, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { Rider, Course, autoSteer, ground, Trickster } = await import(outfile);
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
// (the whip: steering in the air throws the bike out beneath you. Thrown over a kicker's gap and let go, it swings back
// and lands; held out into the landing, it's a crash)
{
  const go = (hold) => {
    const r = new Rider(new Course(1)); let maxW = 0, slipLand = 0, wasAir = false, t = 0, onGap = false, big = false;
    while (t < 18) {
      const st = r.course.at(r.s), f = st.feature; if (f === 'ramp') big = (st.size ?? 2) >= 3; if (f === 'gap' && big) onGap = true;
      r.step(1 / 120, { steer: autoSteer(r), brake: false, whip: r.air && onGap && (hold || f === 'gap') ? 1 : 0 });
      maxW = Math.max(maxW, Math.abs(r.whip));
      if (wasAir && !r.air && r.crashT <= 0 && onGap && !slipLand) slipLand = Math.abs(r.slip) || 1e-9;
      wasAir = r.air; t += 1 / 120;
    }
    return { crashes: r.crashes, maxW, slipLand };
  };
  const a = go(false), b = go(true), ok = a.crashes === 0 && a.maxW > 0.4 && b.crashes > 0; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  whip: thrown over the gap to ${(a.maxW * 57.3).toFixed(0)}° and let go, landed (${a.crashes} crashes, ${(a.slipLand * 57.3).toFixed(0)}° of slide); held out into the landing, ${b.crashes ? 'a crash' : 'no crash'}`);
}
// (the drive: up the throttle, down the brake, as far as you drag; in the air, the nose. A pull held on through a booter's
// whole flight loops it out, a crash; and the throttle held open pulls harder than the engine left alone)
{
  const go = (mode) => {
    const r = new Rider(new Course(1)); let t = 0, onGap = false;
    while (t < (mode === 'hold' ? 12 : 6)) {
      if (r.course.at(r.s).feature === 'gap') onGap = true;
      r.step(1 / 120, { steer: autoSteer(r), brake: false, drive: mode === 'gas' ? 1 : mode === 'hold' && r.air && onGap ? -1 : 0 });
      t += 1 / 120; if (mode === 'hold' && r.crashes) break;
    }
    return r;
  };
  const hold = go('hold'), gas = go('gas'), cruise = go('cruise');
  const ok = hold.crashes > 0 && gas.v > cruise.v * 1.04; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  drive: a pull held through a booter's flight, ${hold.crashes ? 'a crash' : 'no crash'}; six seconds in, ${(gas.v * 3.6).toFixed(0)} km/h with the throttle open against ${(cruise.v * 3.6).toFixed(0)} left alone`);
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
  const ok = flips >= 6 && fl / (f || 1) >= 0.85 && rate('whip') >= 0.85 && (tried.slide ?? 0) > 5 && crashes <= 4; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  tricks: ${fl}/${f} flips landed (${flips} turns counted), ${landed.whip ?? 0}/${tried.whip ?? 0} whips, ${tried.slide ?? 0} slides; ${crashes} crashes in nine minutes`);
}
process.exit(bad ? 1 : 0);
