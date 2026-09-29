// Does validating every candidate mutate game state? (the runner relies on it not doing so)
import { writeFileSync as wf, resetGames } from '../client/playtest/engine/shims/fs';
import { initGame, startGame, loadState, getAvailableActions, validateAction, executeAction } from '../client/playtest/engine/core/game';
import { PRESETS } from '../client/playtest/engine/presets';
declare const process: { argv: string[] };
const out: Record<string, unknown> = {};
for (const game of Object.keys(PRESETS)) {
  try {
    resetGames();
    wf('/pt/games/g/RULES.md', PRESETS[game]);
    let s: any = initGame('g', 2);
    startGame(s.gameId);
    s = loadState(s.gameId);
    let mutations = 0, checks = 0;
    for (let step = 0; step < 40 && s.status === 'in_progress'; step++) {
      const pid = s.currentPlayer;
      const acts = (getAvailableActions(s, pid) as any).actions.filter((a: any) => a.enabled && a.type !== 'resign');
      const cands = acts.flatMap((a: any) => (a.examples?.length ? a.examples : [{ type: a.type }]));
      const before = JSON.stringify(s);
      let firstValid: any = null;
      for (const c of cands) { if ((validateAction(s, pid, c) as any).valid && !firstValid) firstValid = c; }
      checks++;
      if (JSON.stringify(s) !== before) { mutations++; const b = JSON.parse(before); const diff = Object.keys(s.shared).filter((k) => JSON.stringify(s.shared[k]) !== JSON.stringify(b.shared[k])); (out as any)[game + ':diff'] = { step, shared: diff, top: Object.keys(s).filter((k) => k !== 'shared' && JSON.stringify(s[k]) !== JSON.stringify(b[k])) }; }
      executeAction(s, pid, firstValid ?? { type: 'pass' });
      s = loadState(s.gameId);
    }
    out[game] = { checks, mutations };
  } catch (e) { out[game] = { error: (e as Error).message.slice(0, 120) }; }
}
console.log(JSON.stringify(out, null, 1));
