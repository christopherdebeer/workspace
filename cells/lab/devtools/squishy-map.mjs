/**
 * Squishy · Level Lab, headless: map a level's moves in drag px with the real body, and price its way home.
 *   node devtools/squishy-map.mjs --level 7 --seed 2 [--skin dough] [--sigma 4] [--span 24] [--edges 3-4,3-6] [--trials 12]
 * Any level, any seed: the lab's own engine (client/squishy-lab/engine.ts), drained here. Writes
 * devtools/out/map-<level>-<seed>.json and prints a summary.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const level = Number(arg('level', 7)), seed = Number(arg('seed', 0)), skin = arg('skin', 'dough');
const sigma = Number(arg('sigma', 4)), span = Number(arg('span', 24)), trials = Number(arg('trials', 12));
const only = arg('edges', '')?.split(',').filter(Boolean).map((s) => s.split('-').map(Number));

const o = await build({ entryPoints: [new URL('../client/squishy-lab/engine.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const E = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));

const t0 = Date.now();
const a = E.makeLevel(level, seed, skin);
console.log(`level ${level} seed ${seed} · fingerprint ${a.fingerprint} · ${a.lv.towers.length} tops · built in ${Date.now() - t0} ms`);
for (const [f, t] of E.candidatePairs(a.lv)) {
  if (only?.length && !only.some(([x, y]) => x === f && y === t)) continue;
  const e = E.discover(a.lv, f, t);
  if (e) a.edges.push(e);
}
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const pc = (n) => Math.round(n * 100) + '%';
for (const e of a.edges) {
  if (E.composite(a.lv, e)) { console.log(`${e.from}→${e.to}  composite (rail/climb/jar): not mapped`); continue; }
  e.map = E.drain(E.mapEdge(a, e, { sigma, span }));
  E.verify(a, e, trials, sigma);
  const m = e.map, v = e.validation, dest = Object.entries(m.best.dest).filter(([, p]) => p > 0.02).map(([k, p]) => `${k} ${pc(p)}`).join(', ');
  console.log(`${e.from}→${e.to}  ${e.method}  best aim P=${pc(m.best.p)} (witness ${pc(m.atWitness)}) · tolerance ${m.clipped ? '≥' : ''}${m.tolerance} px · area ${m.area} px² · [${dest}]` +
    ` · trials ${v.outcomes.target}/${v.total} [${pc(v.wilson[0])}–${pc(v.wilson[1])}] ${e.status} · timing ${v.timing.join('/')}` +
    ` · ring green ${m.ring.green}, lands ${m.ring.greenLand} · ${m.sims} sims ${(m.ms / 1000).toFixed(0)} s`);
}
const mapped = a.edges.filter((e) => e.map).map((e) => e.map);
const c = E.chain(a.lv, mapped);
console.log(`expected flicks home from the start: ${f2(c.flicks[0])} (splats ${f2(c.splats[0])}) · policy ${c.policy.map((p, i) => p >= 0 ? `${i}→${p}` : '').filter(Boolean).join(' ')}`);
for (const k of c.forks) console.log(`  at ${k.at}: ${k.options.map((x) => `→${x.to} ${f2(x.flicks)} flicks (P ${pc(x.p)})`).join(' | ')}`);
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
const out = new URL(`./out/map-${level}-${seed}.json`, import.meta.url);
writeFileSync(out, JSON.stringify({ level, seed, skin, sigma, fingerprint: a.fingerprint, made: a.lv.made, edges: a.edges.map(({ trajectory, validation, ...e }) => ({ ...e, validation: validation && { ...validation, traces: undefined } })), chain: c }, null, 1));
console.log(`→ ${out.pathname} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
