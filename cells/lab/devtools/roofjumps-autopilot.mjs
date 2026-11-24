// The autopilot, headless (main.ts `auto=1` with its plan): the wander, the planner's fan every 0.12 s, the lean onto its
// best, at 120 Hz, for a set of dials against the house's. What a tuning does to the run as a whole: how far it gets, how
// often it comes down to the street or misses a landing, what moves it makes, how long it's in the air, how fast it goes,
// how long it's stuck, and what the planner sees ahead (how far its routes reach in its horizon).
//
//   node cells/lab/devtools/roofjumps-autopilot.mjs [--seconds 40] [--seeds 1,2,3] [--chars runner,schoolgirl,older] [--dials "gravity=29.5&run=6.5…"] [--label name]
// Writes devtools/out/autopilot/<label>.json and prints a table.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname, OUT = new URL('./out/autopilot/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './runner'; export * from './plan'; export * from './tune'; export * from './character'; export * from './checkpoint'; export * from './reach'; export { noise1 } from '../kit/rng';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = Number(arg('seconds', 40)), SEEDS = arg('seeds', '1,2,3').split(',').map(Number), CHARS = arg('chars', 'runner,schoolgirl,older').split(','), DIALS = arg('dials', ''), LABEL = arg('label', DIALS ? 'dials' : 'house');
M.readTune(new URLSearchParams(DIALS)); M.TUNE.auto = 1;
const DT = 1 / 120, T = M.TUNE;
const rows = [];
for (const ch of CHARS) for (const seed of SEEDS) {
  const city = new M.City(seed, false, null), CH = M.characterByName(ch); let r = new M.Runner(city, CH); const cp = new M.Checkpoints(r); let lives = 0, balks = 0, misses = 0, streets = 0, made = {};
  const tally = () => { balks += r.balks; misses += r.misses; streets += r.streets; for (const [k, v] of Object.entries(r.made)) made[k] = (made[k] ?? 0) + v; };
  let thinking = null, thought = -1, lean = 0, path = 0, air = 0, stuck = 0, still = 0, maxDrop = 0, top = r.y, groundV = 0, groundN = 0, reach = 0, reachN = 0, flights = [], fT = 0, wasAir = false;
  const x0 = r.x, z0 = r.z; let px = r.x, pz = r.z, st0 = r.streets; const why = [];
  for (let i = 0; i < SECONDS / DT; i++) {
    const t = i * DT, w = 7 * M.noise1(seed + 9, t * 0.06) + t * 0.04, a = w - 0.22 * Math.sin(4 * w), ask = { x: Math.sin(a), z: Math.cos(a) };
    if (thought < 0 || t - thought >= 0.12) { thinking = M.plan(r, ask.x, ask.z); thought = t; const b = thinking.best; reach += Math.hypot(b.pts[b.pts.length - 3] - b.pts[0], b.pts[b.pts.length - 1] - b.pts[2]); reachN++; }
    if (r.streets > st0) { st0 = r.streets; const fan = thinking ? thinking.all.map((x) => x.streets) : []; why.push({ t: +t.toFixed(1), moves: [...r.recent].slice(-4), anyClear: fan.some((v) => v === 0), allDown: fan.length > 0 && fan.every((v) => v > 0) }); }
    lean += ((thinking ? thinking.best.off : 0) - lean) * (1 - Math.exp(-5 * DT));
    const c = Math.cos(-lean), s = Math.sin(-lean);
    r.step(DT, { x: ask.x * c + ask.z * s, z: ask.z * c - ask.x * s, jump: false });
    // (the street a fall: a life, and back to the checkpoint)
    if (M.TUNE.streetFail > 0) { const ev = cp.update(r, city, t); if (ev.lost) { lives++; if (r.streets > st0) { const fan = thinking ? thinking.all.map((x) => x.streets) : []; why.push({ t: +t.toFixed(1), moves: [...r.recent].slice(-4), anyClear: fan.some((v) => v === 0), allDown: fan.length > 0 && fan.every((v) => v > 0) }); } tally(); r = cp.respawn(() => new M.Runner(city, CH)); st0 = 0; thinking = null; px = r.x; pz = r.z; wasAir = false; continue; } }
    path += Math.hypot(r.x - px, r.z - pz); px = r.x; pz = r.z;
    const inAir = r.state === 'air';
    if (inAir) { air += DT; fT += DT; top = Math.max(top, r.y); } else { if (wasAir) { flights.push(fT); maxDrop = Math.max(maxDrop, top - r.y); } fT = 0; top = r.y; }
    wasAir = inAir;
    if (r.state === 'ground') { groundV += r.speed; groundN++; }
    if (r.speed < 0.6) { still += DT; if (still > 1) stuck += DT; } else still = 0;
  }
  tally(); const leaps = Object.entries(made).filter(([k]) => !['run', 'dash', 'roll'].includes(k)).reduce((a, [, v]) => a + v, 0);
  rows.push({ ch, seed, path: +path.toFixed(1), net: +Math.hypot(r.x - x0, r.z - z0).toFixed(1), streets, misses, lives, balks, items: cp.collected.size, falls: made.fall ?? 0, leaps, air: +(air / SECONDS).toFixed(3), flight: +(flights.reduce((a, b) => a + b, 0) / Math.max(1, flights.length)).toFixed(2), maxDrop: +maxDrop.toFixed(1), vGround: +(groundV / Math.max(1, groundN)).toFixed(2), stuck: +stuck.toFixed(1), planReach: +(reach / Math.max(1, reachN)).toFixed(1), made, why });
  const z = rows[rows.length - 1]; console.log(`${LABEL.padEnd(8)} ${ch.padEnd(11)} s${seed}  path ${z.path}m  lives ${z.lives}  items ${z.items}  balks ${z.balks}  streets ${z.streets}  misses ${z.misses}  falls ${z.falls}  leaps ${z.leaps}  air ${(z.air * 100).toFixed(0)}%  flight ${z.flight}s  drop ${z.maxDrop}m  v ${z.vGround}  stuck ${z.stuck}s  plan reaches ${z.planReach}m`);
}
const sum = (k) => rows.reduce((a, r) => a + r[k], 0), n = rows.length, moves = {};
for (const r of rows) for (const [k, v] of Object.entries(r.made)) moves[k] = (moves[k] ?? 0) + v;
const agg = { label: LABEL, dials: DIALS, seconds: SECONDS, runs: n, path: +(sum('path') / n).toFixed(1), streetsPerMin: +((sum('streets') / n) * (60 / SECONDS)).toFixed(2), livesPerMin: +((sum('lives') / n) * (60 / SECONDS)).toFixed(2), itemsPerMin: +((sum('items') / n) * (60 / SECONDS)).toFixed(2), balksPerMin: +((sum('balks') / n) * (60 / SECONDS)).toFixed(1), missesPerMin: +((sum('misses') / n) * (60 / SECONDS)).toFixed(2), fallsPerMin: +((sum('falls') / n) * (60 / SECONDS)).toFixed(2), leapsPerMin: +((sum('leaps') / n) * (60 / SECONDS)).toFixed(1), air: +(sum('air') / n).toFixed(3), flight: +(sum('flight') / n).toFixed(2), vGround: +(sum('vGround') / n).toFixed(2), stuck: +(sum('stuck') / n).toFixed(1), planReach: +(sum('planReach') / n).toFixed(1), moves };
console.log(JSON.stringify(agg));
mkdirSync(OUT, { recursive: true }); writeFileSync(OUT + LABEL + '.json', JSON.stringify({ agg, rows }, null, 1));
