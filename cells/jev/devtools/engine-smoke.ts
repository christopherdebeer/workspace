// Node smoke test for the vendored playtest engine: bundle with the cell's
// resolution rules (see devtools/README), then play random legal actions.
import { writeFileSync as wf, resetGames } from '../client/playtest/engine/shims/fs';
import { initGame, startGame, loadState, getAvailableActions, validateAction, executeAction } from '../client/playtest/engine/core/game';

declare const process: { argv: string[] };
const [game, rules, players = '2', maxSteps = '400'] = process.argv.slice(2);
resetGames();
wf(`/pt/games/${game}/RULES.md`, rules);
let s = initGame(game, Number(players));
startGame(s.gameId);
s = loadState(s.gameId);
let steps = 0, invalid = 0;
const types: Record<string, number> = {};
while (s.status === 'in_progress' && steps < Number(maxSteps)) {
  const pid = s.currentPlayer!;
  const av = getAvailableActions(s, pid);
  const enabled = av.actions.filter((a) => a.enabled && a.type !== 'resign');
  const cands = enabled.flatMap((a) => (a.examples?.length ? a.examples : [{ type: a.type }]));
  const pick = cands[Math.floor(Math.random() * cands.length)] ?? { type: 'pass' };
  const v = validateAction(s, pid, pick as never);
  if (!v.valid) { invalid++; executeAction(s, pid, { type: 'pass' } as never); }
  else executeAction(s, pid, pick as never);
  types[(pick as { type: string }).type] = (types[(pick as { type: string }).type] ?? 0) + 1;
  s = loadState(s.gameId);
  steps++;
}
console.log(JSON.stringify({ game, status: s.status, winner: s.winner, round: s.round, turn: s.turnNumber, steps, invalid, types }));
