// One Jev-played game with every Jev call captured verbatim (state, questions, answers):
//   node walkthrough.mjs <RULES.md> [players] [seed] [out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { play, judge, classify } from '../lib/runner';
import { jevClient } from '../lib/jev';
declare const process: { argv: string[]; env: Record<string, string | undefined> };
const [file, players = '4', seed = '2', out = 'walkthrough.json'] = process.argv.slice(2);
const md = readFileSync(file, 'utf8');
const { decide } = jevClient(process.env.PARC_TOKEN ?? JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token);
const log: unknown[] = [];
const rec: typeof decide = async (state, questions, label) => {
  const r = await decide(state, questions, label);
  log.push({ label, state, questions, answers: r.answers, tokens: r.tokens });
  return r;
};
const c = await classify(md, rec);
const s = await play(md, rec, { players: Number(players), seed: Number(seed), maxSteps: 300, persona: Number(seed) % 2 ? 'trusting' : 'suspicious' });
const j = await judge(c, s, rec);
writeFileSync(out, JSON.stringify({ stopped: s.stopped, winner: s.winner, endReason: s.endReason, turns: s.turns, judgement: j.judgement, log }, null, 1));
console.log(`${s.stopped} winner ${s.winner} ${s.endReason} · ${log.length} Jev calls → ${out}`);
