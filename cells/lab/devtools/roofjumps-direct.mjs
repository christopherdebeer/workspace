// Roof Jumps' director as an eval (client/roofjumps/direct.ts): each seed oriented, simulated and directed (waypoints for
// the most interesting way), then run and measured; with --pictures, the run filmed on the page from its waypoints (a strip
// of the whole run from the chase eye, and one about its most interesting moment). Writes devtools/out/direct/:
// <seed>.json (waypoints, measures, timeline), <seed>-run.png, <seed>-moment.png, and report.md (a table, seeds by score).
//
//   node cells/lab/devtools/roofjumps-direct.mjs                  the baseline seeds
//   node cells/lab/devtools/roofjumps-direct.mjs 4 9 --pictures   these, filmed
//   node cells/lab/devtools/roofjumps-direct.mjs --set k=v,k=v    with dials turned (to compare)
//   node cells/lab/devtools/roofjumps-direct.mjs --compare a.json b.json   two reports' scores, seed by seed
import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const here = new URL('.', import.meta.url).pathname, OUT = join(here, 'out', 'direct');
const args = process.argv.slice(2), opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
if (args.includes('--compare')) {
  const [a, b] = args.filter((x) => x.endsWith('.json')).map((p) => JSON.parse(readFileSync(p, 'utf8')));
  for (const s of Object.keys(a)) console.log(`seed ${s}: ${a[s].score.toFixed(1)} → ${b[s]?.score.toFixed(1)} (${((b[s]?.score ?? 0) - a[s].score).toFixed(1)})`);
  const mean = (o) => Object.values(o).reduce((t, m) => t + m.score, 0) / Object.keys(o).length;
  console.log(`mean ${mean(a).toFixed(2)} → ${mean(b).toFixed(2)}`); process.exit(0);
}
const seeds = args.filter((x) => /^\d+$/.test(x)).map(Number), SEEDS = seeds.length ? seeds : [1, 2, 3, 5, 7, 11];
const out = await build({ stdin: { contents: `export * from './direct'; export * from './tune';`, resolveDir: join(here, '../client/roofjumps'), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { direct, measure, TUNE, DIRECTOR } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const set = opt('set'); if (set) for (const kv of set.split(',')) { const [k, v] = kv.split('='); if (k in DIRECTOR) DIRECTOR[k] = Number(v); else TUNE[k] = Number(v); }
mkdirSync(OUT, { recursive: true });
const all = {}, seconds = Number(opt('seconds') ?? 40);
for (const seed of SEEDS) {
  const d = direct(seed, seconds), m = measure(d); all[seed] = { ...m, timeline: undefined };
  writeFileSync(join(OUT, `${seed}.json`), JSON.stringify({ directed: d, measure: m }, null, 1));
  console.log(`seed ${String(seed).padStart(3)}  score ${m.score.toFixed(1).padStart(5)}  interest/min ${m.perMinute.toFixed(1).padStart(5)}  entropy ${m.entropy.toFixed(2)}  events ${m.events}  distinct ${m.distinct}  repeats ${m.repeats}  dead air ${m.deadAir.toFixed(1)}s  misses ${m.misses}  saves ${m.saves}  stall ${m.stall.toFixed(1)}s  inside ${(m.inside * 100).toFixed(1)}%  pace ${m.pace.toFixed(1)}`);
}
const name = opt('name') ?? 'latest';
writeFileSync(join(OUT, `report-${name}.json`), JSON.stringify(all, null, 1));
const rows = Object.values(all).sort((a, b) => b.score - a.score);
const mean = rows.reduce((t, m) => t + m.score, 0) / rows.length, sd = Math.sqrt(rows.reduce((t, m) => t + (m.score - mean) ** 2, 0) / Math.max(1, rows.length - 1));
const avg = (k) => rows.reduce((t, m) => t + m[k], 0) / rows.length;
console.log(`summary: mean ${mean.toFixed(2)} ± ${(sd / Math.sqrt(rows.length)).toFixed(2)} (s.e.); interest/min ${avg('perMinute').toFixed(1)}, entropy ${avg('entropy').toFixed(2)}, repeats ${avg('repeats').toFixed(1)}, saves ${avg('saves').toFixed(1)} (${(100 * avg('saveRate')).toFixed(0)}% of landings), misses ${avg('misses').toFixed(1)}, stall ${avg('stall').toFixed(2)}s, dead air ${avg('deadAir').toFixed(1)}s, pace ${avg('pace').toFixed(1)}, events ${avg('events').toFixed(0)}`);
writeFileSync(join(OUT, `report-${name}.md`), `# Directed seeds (${name})\n\nmean score ${mean.toFixed(2)}${set ? ` · dials ${set}` : ''}\n\n| seed | score | interest/min | entropy | events | distinct | repeats | dead air | misses | saves | stall | inside | pace |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
  rows.map((m) => `| ${m.seed} | ${m.score.toFixed(1)} | ${m.perMinute.toFixed(1)} | ${m.entropy.toFixed(2)} | ${m.events} | ${m.distinct} | ${m.repeats} | ${m.deadAir.toFixed(1)} s | ${m.misses} | ${m.saves} | ${m.stall.toFixed(1)} s | ${(m.inside * 100).toFixed(1)}% | ${m.pace.toFixed(1)} |`).join('\n') + '\n');
console.log(`mean score ${mean.toFixed(2)} → ${join(OUT, `report-${name}.md`)}`);
if (args.includes('--pictures')) {
  process.env.EXPERIMENT = 'roofjumps'; process.env.READY = '__roofjumps';
  const { withWood } = await import('./harness.mjs');
  await withWood(async (lab) => {
    for (const seed of SEEDS) {
      const { directed: d, measure: m } = JSON.parse(readFileSync(join(OUT, `${seed}.json`), 'utf8'));
      const wp = d.waypoints.map((w) => [w[0], w[1], w[2].toFixed(4), w[3]].join(',')).join(';'), best = m.timeline.reduce((b, e) => (!b || e.worth > b.worth ? e : b), null);
      const shots = [[`run`, `seed=${seed}&direct=${wp}&strip=0.5&frames=30&every=${((d.seconds - 1) / 30).toFixed(2)}&cols=10&holds=0`], [`moment`, `seed=${seed}&direct=${wp}&strip=${Math.max(0, (best?.t ?? 1) - 0.6).toFixed(2)}&frames=20&every=0.07&cols=10&holds=0`]];
      for (const [tag, q] of shots) {
        const p = await lab.open(q, { width: 1800, height: tag === 'run' ? 660 : 440, dpr: 1 });
        for (let n = 0; n < 80 && (await p.evaluate(() => window.__roofjumps.probe().pending)) > 0; n++) await p.waitForTimeout(250);
        await p.waitForTimeout(1200); await p.screenshot({ path: join(OUT, `${seed}-${tag}.png`) }); await p.close();
      }
      console.log(`seed ${seed}: pictures (most interesting: ${best?.move} at ${best?.t.toFixed(1)}s)`);
    }
  });
}
