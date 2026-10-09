/* ---------------------------------------------------------------------------
 * Screen — a free, Jev-less look at a candidate design before paying for an eval.
 * A greedy stand-in player takes the option whose consequence label is worth most to it
 * (optionValue: a win, then its own King's forecast less the others', then route progress),
 * and otherwise a random non-pass option. It is not Jev
 * (it trades and accepts indiscriminately), so read it for structure, not for scores:
 * does the game end, how, how long, who wins as what, which move dominates, errors.
 * ------------------------------------------------------------------------- */
import { play, metrics, measuresOf, type Decide } from './runner';
import { outcomeBalance, targetsOf, targetsScore, measureMeans } from './score';

function mulberry(seed: number) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** What an option's consequence label is worth to a greedy player (h17): a win is everything;
 *  "your King ♥: 20% within 4 rolls, 35% within 12" counts the near figure in full and the far
 *  one by half, less the other Kings' near figure; "route to your King: 2 more cards" costs a
 *  little per card; any other mark of progress is worth a hair. Unmarked options are 0. */
export function optionValue(label: string): number {
  if (/\[YOU WIN/.test(label)) return 1e6;
  const m = /\[(.*)\]\s*$/.exec(label);
  if (!m) return 0;
  const c = m[1];
  let v = /→|then|\+\d|learn/.test(c) ? 0.001 : 0;
  const mine = /your King[^:]*:\s*(\d+)%[^,]*,\s*(\d+)%/.exec(c);
  if (mine) v += Number(mine[1]) / 100 + Number(mine[2]) / 200;
  const theirs = /other Kings[^:]*:\s*(\d+)%/.exec(c);
  if (theirs) v -= Number(theirs[1]) / 100;
  const route = /route to your King[^:]*:\s*(\d+) more card/.exec(c);
  if (route) v -= 0.02 * Number(route[1]);
  if (/route to your King[^:]*:\s*cards all the way/.test(c)) v += 0.05;
  return v;
}

export function greedyDecider(seed: number): Decide {
  const rng = mulberry(seed ^ 0x9e3779b9);
  return async (_state, questions) => {
    const opts = Object.keys((questions.move as { criteria?: Record<string, unknown> } | undefined)?.criteria ?? {});
    // free information first (h21): a reveal costs nothing and is never previewed, so a greedy player takes one, at random
    const reveals = opts.filter((o) => /^reveal\b/.test(o));
    if (reveals.length) return { answers: { move: { choice: reveals[Math.floor(rng() * reveals.length)], confidence: 1, probabilities: {} } } as never, tokens: 0, ms: 0 };
    const scored = opts.map((o) => [o, optionValue(o)] as const);
    const best = Math.max(...scored.map(([, v]) => v));
    // the best-valued options; with nothing marked, any non-pass option
    const top = best > 0 ? scored.filter(([, v]) => v >= best - 1e-9).map(([o]) => o) : opts.filter((o) => !/^pass/.test(o));
    const from = top.length ? top : opts;
    const choice = from[Math.floor(rng() * from.length)];
    return { answers: { move: { choice, confidence: 1, probabilities: {} } } as never, tokens: 0, ms: 0 };
  };
}

export async function screen(rules: string, o: { seeds: number[]; players: number[]; maxSteps: number; deadlineAt: number; policy?: string }) {
  const games: Array<Record<string, unknown>> = [];
  const runs: Array<{ winnerKey: string | null; positions: string[]; measures: Record<string, number> }> = [];
  const mix = new Map<string, number>();
  let steps = 0;
  for (const seed of o.seeds) {
    for (const players of o.players) {
      if (Date.now() > o.deadlineAt) break;
      const s = await play(rules, o.policy === 'random' ? null : greedyDecider(seed * 31 + players), { players, seed, maxSteps: o.maxSteps });
      const m = metrics(s);
      steps += m.steps;
      for (const [k, v] of Object.entries(m.actionMix)) mix.set(k, (mix.get(k) ?? 0) + v);
      const role = s.winner ? (s.roles?.[s.winner] ?? null) : null;
      runs.push({ measures: measuresOf(s), winnerKey: s.winner ? (role ?? `seat ${String(s.winner).replace(/\D/g, '')}`) : null, positions: s.roles && Object.keys(s.roles).length ? [...new Set(Object.values(s.roles))] : Array.from({ length: players }, (_, i) => `seat ${i + 1}`) });
      games.push({ seed, players, stopped: s.stopped, rounds: m.rounds, steps: m.steps, winner: role ?? s.winner, winnerSeat: s.winner, audit: (s as any).chainAudit ?? null, trace: [...s.turns.slice(0, 8), ...s.turns.slice(-4)].map(t => ({turn:t.turn, player:t.player, action:t.action})), end: m.endReason ?? s.error ?? null });
    }
  }
  const outcomes: Record<string, number> = {};
  for (const g of games) {
    const k = `${g.winner ?? 'no winner'} · ${g.stopped === 'finished' ? (/limit|timeout|max|draw/i.test(String(g.end ?? '')) ? 'time limit' : /denounc|accus/i.test(String(g.end ?? '')) ? 'denounce' : 'objective') : g.stopped}`;
    outcomes[k] = (outcomes[k] ?? 0) + 1;
  }
  const total = [...mix.values()].reduce((a, b) => a + b, 0) || 1;
  // the measures: mean ± standard error over the games, and the designer's targets if declared
  const means = measureMeans(runs);
  const measures: Record<string, { mean: number; se: number }> = {};
  for (const k of Object.keys(means)) {
    const xs = runs.map((r) => r.measures[k]).filter((v): v is number => typeof v === 'number');
    const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
    measures[k] = { mean: +mean.toFixed(3), se: +(sd / Math.sqrt(xs.length || 1)).toFixed(3) };
  }
  const targets = targetsOf(rules);
  const targetsOut = targets ? targetsScore(means, targets) : null;
  return {
    note: `${o.policy === 'random' ? 'seeded random' : 'greedy stand-in'} player, not Jev: structural evidence, not a measure of enjoyment`,
    requestedGames: o.seeds.length * o.players.length,
    complete: games.length === o.seeds.length * o.players.length,
    skipped: o.seeds.flatMap(seed => o.players.map(players => ({seed, players}))).filter(w => !games.some(g => g.seed === w.seed && g.players === w.players)),
    games: games.length,
    outcomes,
    balance: outcomeBalance(runs),
    measures,
    targets: targetsOut,
    meanRounds: +(games.reduce((a, g) => a + Number(g.rounds ?? 0), 0) / (games.length || 1)).toFixed(1),
    firstRoundEnds: games.filter((g) => Number(g.rounds) <= 1 && g.stopped === 'finished').length,
    errors: games.filter((g) => g.stopped === 'error' || g.stopped === 'stuck').map((g) => `${g.seed}×${g.players}: ${g.end}`),
    moveMix: Object.fromEntries([...mix].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${Math.round((v / total) * 100)}%`])),
    meanSteps: Math.round(steps / (games.length || 1)),
    sample: games,
  };
}

