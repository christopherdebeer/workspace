/* ---------------------------------------------------------------------------
 * Screen — a free, Jev-less look at a candidate design before paying for an eval.
 * A greedy stand-in player takes any option the runner marks with visible progress
 * ([→ …], [then …], [YOU WIN]) and otherwise a random non-pass option. It is not Jev
 * (it trades and accepts indiscriminately), so read it for structure, not for scores:
 * does the game end, how, how long, who wins as what, which move dominates, errors.
 * ------------------------------------------------------------------------- */
import { play, metrics, type Decide } from './runner';
import { outcomeBalance } from './score';

function mulberry(seed: number) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function greedyDecider(seed: number): Decide {
  const rng = mulberry(seed ^ 0x9e3779b9);
  return async (_state, questions) => {
    const opts = Object.keys((questions.move as { criteria?: Record<string, unknown> } | undefined)?.criteria ?? {});
    const marked = opts.filter((o) => /\[(→|then|YOU WIN)/.test(o));
    const pool = marked.length ? marked : opts.filter((o) => !/^pass/.test(o));
    const from = pool.length ? pool : opts;
    const choice = from[Math.floor(rng() * from.length)];
    return { answers: { move: { choice, confidence: 1, probabilities: {} } } as never, tokens: 0, ms: 0 };
  };
}

export async function screen(rules: string, o: { seeds: number[]; players: number[]; maxSteps: number; deadlineAt: number }) {
  const games: Array<Record<string, unknown>> = [];
  const runs: Array<{ winnerKey: string | null; positions: string[] }> = [];
  const mix = new Map<string, number>();
  let steps = 0;
  for (const seed of o.seeds) {
    for (const players of o.players) {
      if (Date.now() > o.deadlineAt) break;
      const s = await play(rules, greedyDecider(seed * 31 + players), { players, seed, maxSteps: o.maxSteps });
      const m = metrics(s);
      steps += m.steps;
      for (const [k, v] of Object.entries(m.actionMix)) mix.set(k, (mix.get(k) ?? 0) + v);
      const role = s.winner ? (s.roles?.[s.winner] ?? null) : null;
      runs.push({ winnerKey: s.winner ? (role ?? `seat ${String(s.winner).replace(/\D/g, '')}`) : null, positions: s.roles && Object.keys(s.roles).length ? [...new Set(Object.values(s.roles))] : Array.from({ length: players }, (_, i) => `seat ${i + 1}`) });
      games.push({ seed, players, stopped: s.stopped, rounds: m.rounds, steps: m.steps, winner: role ?? s.winner, end: m.endReason ?? s.error ?? null });
    }
  }
  const outcomes: Record<string, number> = {};
  for (const g of games) {
    const k = `${g.winner ?? 'no winner'} · ${g.stopped === 'finished' ? (/limit|timeout|max/i.test(String(g.end ?? '')) ? 'time limit' : 'objective') : g.stopped}`;
    outcomes[k] = (outcomes[k] ?? 0) + 1;
  }
  const total = [...mix.values()].reduce((a, b) => a + b, 0) || 1;
  return {
    note: 'greedy stand-in player, not Jev: structure only (ending, length, outcome spread, move mix, errors) — no scores',
    games: games.length,
    outcomes,
    balance: outcomeBalance(runs),
    meanRounds: +(games.reduce((a, g) => a + Number(g.rounds ?? 0), 0) / (games.length || 1)).toFixed(1),
    firstRoundEnds: games.filter((g) => Number(g.rounds) <= 1 && g.stopped === 'finished').length,
    errors: games.filter((g) => g.stopped === 'error' || g.stopped === 'stuck').map((g) => `${g.seed}×${g.players}: ${g.end}`),
    moveMix: Object.fromEntries([...mix].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${Math.round((v / total) * 100)}%`])),
    meanSteps: Math.round(steps / (games.length || 1)),
    sample: games.slice(0, 8),
  };
}
