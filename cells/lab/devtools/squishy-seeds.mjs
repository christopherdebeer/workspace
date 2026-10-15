/**
 * Squishy's levels, tried many ways: for each level (and each seed of it, another layout of the same level),
 * how it was laid, whether every hop's arc lands (the fast, ballistic check the generator makes), whether the
 * autopilot gets home in the real simulation (a witness), and, for each hop, how much room there is for error:
 * from where it settles on the top before, the autopilot's own flick and flicks a little stronger, weaker, and to
 * either side, each played out in the real simulation to where it comes to rest. What it reports for a hop:
 *
 *   made     the share of those flicks that end stood on the next top
 *   tol      how much stronger or weaker than the autopilot's flick still makes it, straight on (power, 0-1)
 *   outcomes how the rest end: on the top it left (stayed), on one further back (back), further on (past),
 *            fallen (fall), or not settled anywhere a top is (stuck: clinging to a side, on a sill)
 *
 * A hop whose own flick doesn't make it is unwitnessed; one where under half do is fragile. The simulation's
 * deterministic, so a run's the same each time.
 *
 *   node cells/lab/devtools/squishy-seeds.mjs [--levels 1-16] [--seeds 0-0] [--kinds jelly,dough] [--samples 15] [--jobs 4]
 *
 * Writes devtools/out/seeds.json (everything) and devtools/out/seeds.md (a table), and prints the table.
 */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { cpus } from 'node:os';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']] : a), []));
const range = (s) => s.split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i); });
const SAMPLES = +(args.samples ?? 15);
const out = new URL('./out/', import.meta.url).pathname;

if (!args.only) {
  // ─── the whole batch: shared out among workers, gathered, written up ──────────────────────────
  const jobs = [];
  for (const n of range(args.levels ?? '1-16')) for (const seed of range(args.seeds ?? '0')) for (const kind of (args.kinds ?? 'jelly').split(',')) jobs.push(`${n}:${seed}:${kind}`);
  const J = Math.min(jobs.length, +(args.jobs ?? Math.max(1, cpus().length - 1)));
  const results = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: J }, (_, w) => new Promise((done) => {
    const mine = jobs.filter((_, i) => i % J === w);
    const ch = spawn(process.execPath, [new URL(import.meta.url).pathname, '--only', mine.join(','), '--samples', String(SAMPLES)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    ch.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.startsWith('R ')) { const r = JSON.parse(line.slice(2)); results.push(r); process.stderr.write(`  ${r.n}:${r.seed}:${r.kind} ${r.witness.home >= 0 ? 'home' : 'NOT HOME'} (${results.length}/${jobs.length})\n`); } } });
    ch.on('close', done);
  })));
  results.sort((a, b) => a.n - b.n || a.seed - b.seed || a.kind.localeCompare(b.kind));
  mkdirSync(out, { recursive: true });
  writeFileSync(out + 'seeds.json', JSON.stringify(results, null, 1));
  const pct = (x) => `${Math.round(x * 100)}%`;
  const rows = results.map((r) => {
    const hs = r.hops.filter((h) => h.probe);
    const min = hs.length ? Math.min(...hs.map((h) => h.probe.made)) : 1;
    const weak = hs.filter((h) => h.probe.made < 0.5).map((h) => `${h.from}→${h.to} ${h.toTop} ${pct(h.probe.made)}`);
    const unw = hs.filter((h) => !h.probe.own).map((h) => `${h.from}→${h.to}`);
    return `| ${r.n} | ${r.seed} | ${r.kind} | ${r.made ? (r.made.plain ? 'plain' : `#${r.made.attempts}`) : 'FAILED'} | ${r.tops.length} | ${r.hops.every((h) => h.ballistic) ? 'all' : r.hops.filter((h) => !h.ballistic).map((h) => `${h.from}→${h.to}`).join(' ')} | ${r.witness.home >= 0 ? `${r.witness.home.toFixed(1)} s, ${r.witness.falls} fall${r.witness.falls === 1 ? '' : 's'}` : `NOT HOME (${r.witness.reached}/${r.tops.length - 1})`} | ${pct(min)} | ${pct(hs.reduce((a, h) => a + h.probe.made, 0) / Math.max(1, hs.length))} | ${unw.join(' ') || '–'} | ${weak.join('; ') || '–'} |`;
  });
  const all = results.flatMap((r) => r.hops.filter((h) => h.probe));
  const md = [
    `# Squishy: ${results.length} runs, ${SAMPLES} flicks a hop (${((Date.now() - t0) / 1000).toFixed(0)} s)`, '',
    `Home: ${results.filter((r) => r.witness.home >= 0).length}/${results.length}. Hops: ${all.length}, unwitnessed ${all.filter((h) => !h.probe.own).length}, fragile (under half made) ${all.filter((h) => h.probe.made < 0.5).length}, mean made ${pct(all.reduce((a, h) => a + h.probe.made, 0) / Math.max(1, all.length))}.`, '',
    '| level | seed | kind | laid | tops | arcs land | autopilot | worst hop | mean hop | unwitnessed | fragile |',
    '|---|---|---|---|---|---|---|---|---|---|---|', ...rows, '',
    '## By top reached', '',
    '| top | hops | mean made | mean tol | falls | stayed | back | past | stuck |', '|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(all.reduce((m, h) => { (m[h.toTop] ??= []).push(h); return m; }, {})).sort((a, b) => a[0].localeCompare(b[0])).map(([top, hs]) => {
      const sum = (k) => hs.reduce((a, h) => a + (h.probe.outcomes[k] ?? 0), 0), n = hs.reduce((a, h) => a + h.probe.n, 0);
      return `| ${top} | ${hs.length} | ${pct(hs.reduce((a, h) => a + h.probe.made, 0) / hs.length)} | ${(hs.reduce((a, h) => a + h.probe.tol, 0) / hs.length).toFixed(3)} | ${pct(sum('fall') / n)} | ${pct(sum('stayed') / n)} | ${pct(sum('back') / n)} | ${pct(sum('past') / n)} | ${pct(sum('stuck') / n)} |`;
    }),
  ].join('\n');
  writeFileSync(out + 'seeds.md', md + '\n');
  console.log(md);
} else {
  // ─── a worker: its share, a line of JSON for each ─────────────────────────────────────────────
  const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
  const L = await load('../client/squishy/level.ts');
  const B = await load('../client/squishy/body.ts');
  const C = await load('../client/squishy/course.ts');
  const DT = 1 / 60;
  // (each jelly as it was laid: still, nothing in it)
  const calm = (lv) => { for (const s of lv.jellies ?? []) { const j = s.jel; j.z.fill(0); j.w.fill(0); j.t = 0; j.held = 0; j.ride = undefined; j.vin = undefined; } };
  // (on a top: stood on it; hanging from it, a rail; stuck to it, a honey jar's side, which holds but isn't somewhere to start again from)
  const settledOn = (lv, d, jars = false) => { const k = L.towerAt(lv, d.com, 1); return k >= 0 && (lv.towers[k].rail ? !!d.onRail : lv.towers[k].jar ? jars : d.onFeet) && d.contacts > 0 && d.moving < 30 ? k : -1; };
  const stillness = (lv, d, still) => (Math.hypot(...d.drift.map((v, i) => v - L.carried(lv, d.com)[i])) < 6 && d.sinceContact < 0.12 ? still + DT : 0);

  /** the autopilot, from the start, home: as the test plays it (two falls allowed there; here, counted) */
  const autopilot = (lv, kind) => {
    calm(lv);
    const s = lv.towers[0].at, d = new B.Dumpling([s[0], s[1] + L.REST_H + 2, s[2]], kind);
    let home = -1, still = 0, check = 0, falls = 0, flicks = 0;
    for (let t = 0; t < 150 && home < 0; t += DT) {
      d.step(lv, DT, t);
      if (d.com[1] < lv.kill) { falls++; if (falls > 8) break; d.place(L.respawnAt(lv, check)); still = 0; continue; }
      const k = L.towerAt(lv, d.com, 1);
      if (settledOn(lv, d) >= 0) check = Math.max(check, settledOn(lv, d));
      still = stillness(lv, d, still);
      if (k === lv.towers.length - 1 && d.onFeet && still > 0.4) { home = t; break; }
      const near = k >= 0 ? k : L.towerAt(lv, d.com, 4), on = near >= 0 ? near : check, at = on === lv.towers.length - 1 && k !== on ? on - 1 : on;
      if (still > 0.35 && d.canFlick && at >= 0 && at < lv.towers.length - 1) {
        const a = L.autoFlick(lv, d.com, at, t, d.coated[L.DUST.butter], d.clinging ? d.wallN : null);
        if (a?.shimmy) { d.shimmy(a.shimmy); still = 0; } else if (a) { d.flick(a.climb ? L.climbLaunch(a.power) : L.launch(a.yaw, a.power), 0, a.climb ?? null); still = 0; flicks++; }
      }
    }
    return { home, falls, reached: check, flicks };
  };

  /**
   * From top j, settled as a respawn leaves it, to the next: the autopilot's flick when it's ready, then that
   * flick changed by (dp, dy), played out to rest. Climbs (from a wall, up) are let finish.
   */
  const probeOne = (lv, kind, j, target, dp, dy) => {
    calm(lv);
    const s0 = lv.towers[0].at, d = new B.Dumpling([s0[0], s0[1] + L.REST_H + 2, s0[2]], kind);
    // (the way to its preferred next, as the autopilot goes; another way, aimed at that top itself)
    const own = target === L.nextTop(lv, j);
    // (put there as a fall puts it back: on a rail, holding it)
    d.place(L.respawnAt(lv, j));
    let t = 0, still = 0, base = null;
    // (settle, shuffle along a rail if it's on one, wait for a lid: until the autopilot would flick)
    for (; t < 12 && !base; t += DT) {
      d.step(lv, DT, t);
      if (d.com[1] < lv.kill) return { outcome: 'start-fall' };
      still = stillness(lv, d, still);
      if (still > 0.35 && d.canFlick) {
        const a = own ? L.autoFlick(lv, d.com, j, t, d.coated[L.DUST.butter], d.clinging ? d.wallN : null) : L.aim(lv, d.com, target, t);
        if (a?.shimmy) { d.shimmy(a.shimmy); still = 0; } else if (a) base = a;
      }
    }
    if (!base) return { outcome: 'no-flick' };
    if (base.climb) d.flick(L.climbLaunch(Math.min(1, Math.max(0, base.power + dp))), 0, base.climb);
    else d.flick(L.launch(base.yaw + dy, Math.min(1, Math.max(0, base.power + dp))), 0, null);
    still = 0;
    const t1 = t;
    for (; t < t1 + 6; t += DT) {
      d.step(lv, DT, t);
      if (d.com[1] < lv.kill) return { outcome: 'fall', base };
      still = stillness(lv, d, still);
      const k = settledOn(lv, d, true);
      // (made: on it; onto a springboard, on it or bounced off it onto the one after)
      if (k >= 0 && still > 0.5 && t - t1 > 0.3) return { outcome: k === target || (lv.towers[target].spring && k === L.nextTop(lv, target)) ? 'made' : k === j ? 'stayed' : k > target ? 'past' : 'back', base };
      // (against the next's wall, clinging: up it, as the autopilot would)
      if (lv.towers[target].wall && d.clinging && still > 0.35 && d.canFlick) {
        const a = L.autoFlick(lv, d.com, j, t, d.coated[L.DUST.butter], d.wallN);
        if (a?.climb) { d.flick(L.climbLaunch(a.power), 0, a.climb); still = 0; }
      }
    }
    // (where it's got to: near which top, on its feet or clinging or on its edge)
    return { outcome: 'stuck', base, where: { near: L.towerAt(lv, d.com, 4), feet: d.onFeet, cling: d.clinging, edge: !!d.onEdge, moving: Math.round(d.moving), com: d.com.map((v) => Math.round(v)) } };
  };
  const PS = [-0.06, -0.03, 0, 0.03, 0.06], YS = SAMPLES >= 15 ? [-0.05, 0, 0.05] : [0];
  const probe = (n, seed, kind, j, k) => {
    const lv = C.buildLevel(n, seed);
    const res = [];
    for (const dy of YS) for (const dp of PS) res.push({ dp, dy, ...probeOne(lv, kind, j, k, dp, dy) });
    const outcomes = {};
    for (const r of res) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    const own = res.find((r) => r.dp === 0 && r.dy === 0);
    // (how far either way straight on it still makes it, while it does all the way out)
    const straight = res.filter((r) => r.dy === 0).sort((a, b) => a.dp - b.dp);
    let lo = 0, hi = 0;
    for (const r of straight) if (r.dp < 0 && r.outcome === 'made' && straight.filter((q) => q.dp > r.dp && q.dp < 0).every((q) => q.outcome === 'made')) lo = Math.min(lo, r.dp);
    for (const r of straight) if (r.dp > 0 && r.outcome === 'made' && straight.filter((q) => q.dp < r.dp && q.dp > 0).every((q) => q.outcome === 'made')) hi = Math.max(hi, r.dp);
    return { n: res.length, made: (outcomes.made ?? 0) / res.length, own: own?.outcome === 'made', tol: own?.outcome === 'made' ? hi - lo : 0, outcomes, base: own?.base ?? null, grid: res.map((r) => [r.dp, r.dy, r.outcome, r.where ?? null]) };
  };

  for (const job of args.only.split(',')) {
    const [n, seed, kind] = job.split(':');
    let lv;
    try { lv = C.buildLevel(+n, +seed); } catch (e) { console.log('R ' + JSON.stringify({ n: +n, seed: +seed, kind, made: null, error: String(e), tops: [], hops: [], witness: { home: -1, falls: 0, reached: 0 } })); continue; }
    const r = { n: +n, seed: +seed, kind, chapter: lv.chapter, made: lv.made, tops: lv.towers.map((t) => t.top), hops: [] };
    for (const [j, k] of L.waysOf(lv)) r.hops.push({ from: j, to: k, toTop: lv.towers[k].top, ballistic: !!L.hop(lv, j, k) });
    r.witness = autopilot(lv, kind);
    for (const h of r.hops) h.probe = probe(+n, +seed, kind, h.from, h.to);
    console.log('R ' + JSON.stringify(r));
  }
}
