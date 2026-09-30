// Browser smoke: the vendored engine + runner in a real page, random play (no Jev).
import { classify, play, metrics, sessionFindings } from '../client/playtest/runner';
import { PRESETS } from '../client/playtest/engine/presets';
(globalThis as any).smoke = async (game: string) => {
  const c = await classify(PRESETS[game], null);
  const s = await play(PRESETS[game], null, { players: 2, seed: 3, maxSteps: 150 });
  return { game, declared: c.declared.length, effects: c.effects.length, stopped: s.stopped, steps: s.turns.length, log: s.log.length, error: s.error ?? null, findings: sessionFindings(s, metrics(s), c).map((f) => f.subject) };
};
