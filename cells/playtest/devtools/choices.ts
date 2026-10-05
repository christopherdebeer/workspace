// One Jev-played game, then how often the chosen option was one with a visible consequence,
// given how many such options existed:  node choices.mjs <RULES.md> [players] [seed]
import { readFileSync } from 'node:fs';
import { play } from '../lib/runner';
import { jevClient } from '../lib/jev';
declare const process: { argv: string[]; env: Record<string, string | undefined> };
const [file, players = '4', seed = '1'] = process.argv.slice(2);
const { decide } = jevClient(process.env.PARC_TOKEN ?? JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token);
const s = await play(readFileSync(file, 'utf8'), decide, { players: Number(players), seed: Number(seed), maxSteps: 300, persona: Number(seed) % 2 ? 'trusting' : 'suspicious' });
const decided = s.turns.filter((t) => !t.forced && !t.label.endsWith('(planned)'));
const withMarked = decided.filter((t) => (t.marked ?? 0) > 0);
const tookMarked = withMarked.filter((t) => /\[(→|then|\+\d|learn|YOU WIN)|^plan:/.test(t.label));
console.log(`${s.stopped} r${s.turns.at(-1)?.round} winner ${s.winner} ${s.endReason}`);
console.log(`decisions ${decided.length} · with a marked option ${withMarked.length} · took a marked one ${tookMarked.length}`);
const byType: Record<string, number> = {};
for (const t of withMarked.filter((t) => !tookMarked.includes(t))) byType[t.label.split(' ·')[0]] = (byType[t.label.split(' ·')[0]] ?? 0) + 1;
console.log('instead chose:', JSON.stringify(byType));
for (const t of withMarked.filter((t) => !tookMarked.includes(t)).slice(0, 10)) console.log(`  r${t.round} ${t.player} chose "${t.label.slice(0, 70)}" (${t.confidence}) over ${t.marked} marked; top: ${JSON.stringify(t.top.map(([l, p]) => [l.slice(0, 60), p]))}`);
