// Switchback's ride test (node cells/lab/devtools/switchback-run.mjs [seconds] [seed…]): the auto rider down a seeded
// course, no page: does it keep to the line, clear the kickers, hold its pace. Prints a line per seed and ok / FAIL.
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), `switchback-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './client/switchback/sim'; export * from './client/switchback/course'; export { ground } from './client/switchback/ground';`, resolveDir: join(here, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { Rider, Course, autoSteer, ground } = await import(outfile);
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
    const r = new Rider(new Course(1)); let maxW = 0, slipLand = 0, wasAir = false, t = 0, onGap = false;
    while (t < 9) {
      const f = r.course.at(r.s).feature; if (f === 'gap') onGap = true;
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
// (the drive: up the throttle, down the brake, as far as you drag; in the air, the nose. A pull held over a kicker turns
// the bike over backward, and let go in time it lands a backflip; held on into the landing it loops out, a crash)
{
  const go = (mode) => {
    const r = new Rider(new Course(1)); let t = 0, onGap = false, landed = false, p0 = null, flips = 0, seen = null, vSum = 0, n = 0;
    while (t < (mode === 'gas' || mode === 'cruise' ? 30 : 10)) {
      const f = r.course.at(r.s).feature; if (f === 'gap' && !landed) onGap = true;
      if (r.air && p0 === null) p0 = r.pitch; if (!r.air) { if (p0 !== null && onGap) { landed = true; onGap = false; } p0 = null; }
      const rot = p0 === null ? 0 : r.pitch - p0;
      const drive = mode === 'gas' ? 1 : mode === 'cruise' ? 0 : r.air && onGap ? (mode === 'hold' || rot + r.spin / 4 < Math.PI * 2 ? -1 : 0) : 0;
      r.step(1 / 120, { steer: autoSteer(r), brake: false, drive });
      // (the list keeps its last 64: read on from the last one seen)
      for (const e of r.events.slice(r.events.indexOf(seen) + 1)) if (e.kind === 'flip') flips += e.k; seen = r.events[r.events.length - 1];
      vSum += r.v; n++; t += 1 / 120;
    }
    return { crashes: r.crashes, flips, mean: vSum / n };
  };
  const flip = go('flip'), hold = go('hold'), gas = go('gas'), cruise = go('cruise');
  const ok = flip.flips === 1 && flip.crashes === 0 && hold.crashes > 0 && gas.mean > cruise.mean * 1.03; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  drive: a pull over the gap let go in time lands ${flip.flips} backflip (${flip.crashes} crashes); held on into the landing, ${hold.crashes ? 'a crash' : 'no crash'}; throttle open ${(gas.mean * 3.6).toFixed(0)} km/h against ${(cruise.mean * 3.6).toFixed(0)} left alone`);
}
process.exit(bad ? 1 : 0);
