// The feet's one account, measured: over the authored scenes and over random-stick trials on a flat roof (the stick's
// heading and push re-seeded every 100–350 ms for 12 s), how often the runner says a foot is down while the figure has
// given it up (disagreements); the longest time on the ground walking with no foot down (gaps), and jogging, the longest
// moment in the air; and how far planted
// feet slide (cm a second of planted time, the drawn ball of the foot: what stays put as the heel comes up or it pivots).
//   node cells/lab/devtools/roofjumps-footing.mjs [--trials N] [scene keys…]
import { build } from 'esbuild';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './scenes'; export * from './city'; export * from './runner'; export * from './rig'; export * from './m4';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const args = process.argv.slice(2), ti = args.indexOf('--trials'), TRIALS = ti >= 0 ? +args.splice(ti, 2)[1] : 8, keys = args.length ? args : M.SCENES.map((s) => s.key), DT = 1 / 120;
const flat = { heightAt: () => 10, topAt: () => null, gripAt: () => null, holdsNear: () => [], boxesNear: () => [], regionsNear: () => [], regionAt: () => null, start: () => ({ x: 0, y: 10, z: 0 }) };
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
/** one run measured */
function run(world, input, seconds) {
  const r = new M.Runner(world), rig = new M.Rig(); rig.update(1, r); const mem = {};
  let dis = 0, gap = 0, worstGap = 0, gapAt = 0, fly = 0, worstFly = 0, plantedT = 0, slid = 0; const prev = { L: null, R: null };
  for (let i = 0; i < seconds / DT; i++) {
    const t = i * DT; r.step(DT, input(t, r, mem));
    // (the runner still claiming a foot the figure gave up last step: told, it should have let go)
    const ground = r.state === 'ground' && r.move !== 'roll';
    for (const [k, key] of [['L', 'fl'], ['R', 'fr']]) if (ground && r.reach[key] && rig.soles[k].lost) dis++;
    rig.update(DT, r);
    // (walking (under 2.2 m/s) there's always a foot down: any time with none is a gap; jogging, a moment in the air each step
    // is the gait's own, so only its longest is kept)
    const none = ground && r.speed > 0.3 && !r.reach.fl && !r.reach.fr;
    gap = none && r.speed < 2.2 ? gap + DT : 0; if (gap > worstGap) { worstGap = gap; gapAt = t; }
    fly = none && r.speed >= 2.2 && r.speed < 4 ? fly + DT : 0; worstFly = Math.max(worstFly, fly);
    const b = rig.bones(r);
    for (const [k, key] of [['L', 'fl'], ['R', 'fr']]) {
      const m = b.find((o) => o.name === 'foot' + k).m, ball = M.point(m, 0, -rig.body.sole, rig.body.ball), planted = ground && !!r.reach[key] && rig.soles[k].w > 0.9;
      // (the ball's travel: what stays put when the heel comes up or the foot pivots)
      if (planted && prev[k]) { plantedT += DT; slid += Math.hypot(ball[0] - prev[k][0], ball[2] - prev[k][1]); }
      prev[k] = planted ? [ball[0], ball[2]] : null;
    }
  }
  return { dis, gap: worstGap, gapAt, fly: worstFly, slide: plantedT ? (slid / plantedT) * 100 : 0 };
}
const rows = [];
for (const key of keys) { const sc = M.SCENES.find((s) => s.key === key); rows.push({ name: key, ...run(new M.City(1, false, sc.course), sc.input, sc.seconds) }); }
for (let n = 0; n < TRIALS; n++) {
  const R = rng(1000 + n); let next = 0, hd = 0, mag = 0;
  const input = (t) => { if (t >= next) { next = t + 0.1 + 0.25 * R(); hd += (R() - 0.5) * 3.2; mag = R() < 0.15 ? 0 : 0.2 + 0.8 * R(); } return { x: Math.sin(hd) * mag, z: Math.cos(hd) * mag }; };
  rows.push({ name: `random stick ${n + 1}`, ...run(flat, input, 12) });
}
for (const r of rows) console.log(`${r.name.padEnd(22)} disagreements ${String(r.dis).padStart(4)}  walking gap ${(r.gap * 1000).toFixed(0).padStart(4)} ms${r.gap > 0.03 ? ` (at ${r.gapAt.toFixed(2)} s)` : '            '}  jog flight ${(r.fly * 1000).toFixed(0).padStart(4)} ms  slide ${r.slide.toFixed(1)} cm/s`);
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
console.log(`total disagreements ${sum((r) => r.dis)}; runs with a walking gap ${rows.filter((r) => r.gap > 0.03).length}/${rows.length}, worst ${(Math.max(...rows.map((r) => r.gap)) * 1000).toFixed(0)} ms; worst jog flight ${(Math.max(...rows.map((r) => r.fly)) * 1000).toFixed(0)} ms; runs sliding over 3 cm/s ${rows.filter((r) => r.slide > 3).length}`);
