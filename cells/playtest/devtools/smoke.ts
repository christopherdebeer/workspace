// Random-play smoke test (no Jev, no cost): N seeded games of a preset or RULES.md file,
// each move picked uniformly from the engine's valid moves. Catches engine errors, stuck
// states and never-ending games before a real (Jev) eval.
//   node smoke.mjs <preset|path/to/RULES.md> [players=4] [seeds=5] [maxSteps=300] [--turns]
import { readFileSync, existsSync } from 'node:fs';
import { play, classify, metrics } from '../lib/runner';
import { PRESETS } from '../engine/presets';
declare const process: { argv: string[] };
const [src, players = '4', seeds = '5', maxSteps = '300'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showTurns = process.argv.includes('--turns');
const rules = existsSync(src) ? readFileSync(src, 'utf8') : PRESETS[src];
if (!rules) throw new Error(`no preset or file ${src}`);
const cls = await classify(rules, null);
console.log(`${cls.name} · players ${cls.players.min}-${cls.players.max} · findings:`);
for (const f of cls.findings.filter((f) => f.severity !== 'info')) console.log(`  ${f.severity} ${f.kind} ${f.subject}`);
for (let seed = 1; seed <= Number(seeds); seed++) {
  const s = await play(rules, null, { players: Number(players), seed, maxSteps: Number(maxSteps) });
  const m = metrics(s);
  console.log(`seed ${seed}: ${s.stopped} · ${m.steps} steps · r${m.rounds} · winner ${s.winner ?? '—'} · ${s.endReason ?? s.error ?? ''}`);
  console.log(`   mix ${JSON.stringify(m.actionMix)} · meanValid ${m.meanValid.toFixed(1)} · unsuitable ${s.unsuitable.map((u) => `${u.type}:${u.why}×${u.times}`).join(', ') || '—'}`);
  if (showTurns) for (const t of s.turns) console.log(`   ${t.step} r${t.round} ${t.player} [${t.valid}] ${t.label}`);
}
