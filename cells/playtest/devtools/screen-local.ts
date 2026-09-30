// Screen RULES.md files locally (same greedy stand-in as the cell's screen tool):
//   node screen-local.mjs <file.md>... [--seeds=1-12] [--players=3,4]
import { readFileSync } from 'node:fs';
import { screen } from '../lib/screen';
declare const process: { argv: string[] };
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const range = (v: string) => (v.includes('-') ? Array.from({ length: Number(v.split('-')[1]) - Number(v.split('-')[0]) + 1 }, (_, i) => Number(v.split('-')[0]) + i) : v.split(',').map(Number));
for (const f of args.filter((a) => !a.startsWith('--'))) {
  const r = await screen(readFileSync(f, 'utf8'), { seeds: range(opt('seeds', '1-12')), players: range(opt('players', '3,4')), maxSteps: 300, deadlineAt: Date.now() + 600_000 });
  console.log(`${f.split('/').pop()}: balance ${r.balance} · rounds ${r.meanRounds} · 1st-round ends ${r.firstRoundEnds} · errors ${r.errors.length}`);
  console.log(`   ${JSON.stringify(r.outcomes)}`);
  console.log(`   ${JSON.stringify(r.moveMix)}`);
}
