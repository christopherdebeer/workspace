// Node driver for client/playtest/runner.ts (bundle with the cell's resolution
// rules — see README). Auth as scripts/cell-sync.mjs: PARC_TOKEN or
// /tmp/parc-token.json. `--no-jev` plays random legal moves and skips Jev.
//   node run.mjs <preset|path/to/RULES.md> [players] [seed] [maxSteps] [--no-jev]
import { readFileSync, existsSync } from 'node:fs';
import { classify, play, judge, metrics, sessionFindings, type Decide } from '../client/playtest/runner';
import { PRESETS } from '../client/playtest/engine/presets';

declare const process: { argv: string[]; env: Record<string, string | undefined>; exit(n: number): never };
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const noJev = process.argv.includes('--no-jev');
const [which = 'uno', players = '2', seed = '1', maxSteps = '200'] = args;
const rules = PRESETS[which] ?? (existsSync(which) ? readFileSync(which, 'utf8') : '');
if (!rules) { console.error(`no preset or file "${which}"; presets: ${Object.keys(PRESETS).join(', ')}`); process.exit(2); }

const token = process.env.PARC_TOKEN ?? JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token;
const decide: Decide = async (state, questions, label) => {
  const t0 = Date.now();
  const res = await fetch('https://parc.land/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'act', arguments: { target: '@c15r/jev.decide', input: { state, questions } } } }),
  });
  const rpc = (await res.json()) as { result?: { content?: Array<{ text?: string }>; isError?: boolean } };
  const text = rpc.result?.content?.[0]?.text ?? '';
  const body = JSON.parse(text);
  if (rpc.result?.isError || !body.answers) throw new Error(`${label}: ${text.slice(0, 200)}`);
  return { answers: body.answers, tokens: body.usage?.input_tokens ?? 0, ms: Date.now() - t0 };
};

const c = await classify(rules, noJev ? null : decide);
console.log(JSON.stringify({ classify: { name: c.name, declared: c.declared, enabled: c.enabled.length, ruleChecks: c.ruleChecks, prose_top: c.prose.slice(0, 8).map((p) => `${p.slug}:${p.p.toFixed(2)}${p.implemented ? '' : '(missing)'}${p.configured ? '' : '(unconfigured)'}`), effects: c.effects, schema: c.schema, tokens: c.tokens } }));
const s = await play(rules, noJev ? null : decide, { players: Number(players), seed: Number(seed), maxSteps: Number(maxSteps) });
const m = metrics(s);
console.log(JSON.stringify({ session: { stopped: s.stopped, status: s.status, winner: s.winner, endReason: s.endReason, error: s.error, logEvents: s.log.length, unsuitable: s.unsuitable }, metrics: m }));
if (process.argv.includes('--turns')) for (const t of s.turns) console.log(`${t.step} r${t.round} t${t.turn} ${t.player} [${t.valid}] ${t.label}`);
console.log(JSON.stringify({ sample_turns: s.turns.slice(0, 4).map((t) => ({ p: t.player, valid: t.valid, label: t.label, conf: t.confidence, top: t.top, ahead: t.ahead, fb: t.fallback })) }));
const findings = [...c.findings, ...(noJev ? sessionFindings(s, m, c) : [])];
if (!noJev) {
  const j = await judge(c, s, decide);
  console.log(JSON.stringify({ judgement: j.judgement }));
  findings.push(...j.findings);
}
console.log(JSON.stringify({ findings }, null, 1));
