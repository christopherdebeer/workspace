/* ---------------------------------------------------------------------------
 * score/v3 — the objective a hill climb optimises. Mostly computed from the
 * played record; two terms are Jev's own judgement. Versioned: changing a weight
 * is a new SCORE_VERSION, and evals only compare within one version.
 *
 * A run (one seed × player count):
 *   0 if the engine errored or a player had no legal move — nothing to judge.
 *   ended    .25  finished by its own rules (a turn/round limit .3 — unless the rules name
 *                 who wins at the limit: then it is a designed ending, 1; never finished 0)
 *   critique .20  Jev's qualitative critique: mean of 16 dimensions (fun, engagement,
 *                 dynamism, tension, decisions, depth, diversity, interaction, pace,
 *                 balance, theme, coherence, goals, comeback, replay, elegance) / 4
 *   judged   .15  Jev: P("plays as designed") over the session record
 *   variety  .10  no single move type over half of all moves (linear to 0 at 100%)
 *   agency   .10  real choice per turn: min(mean legal moves / 4, 1) × share of unforced turns
 *   length   .10  lasted ≥ 3 rounds (a first-round win is a broken game, not a quick one)
 *   clean    .10  no error-level findings from the session (engine faults surfaced by play)
 * A suite: 0.75 × mean(run scores) + 0.15 × definition health + 0.10 × outcome balance,
 *   definition health = 1 / (1 + 0.25 × error-level classification findings),
 *   outcome balance = normalised entropy of who won — by secret role, else by seat
 *   (without enough decided games: 0.85 × mean + 0.15 × health).
 * v1/v2 evals stay stored but never compare with v3. v2 → v3: a designed time-limit win
 * counts as ended; outcome balance joins the suite score (one role winning 13 of 24
 * AAOTE games was invisible to v2).
 * ------------------------------------------------------------------------- */
import type { Classification, Finding, Judgement, Session } from './runner';
import { metrics } from './runner';
import { deduction, type DeductionReport } from './deduction';

/** v2 (2026-09-30): adds Jev's qualitative critique (16 dimensions, 0–1 index) at .20,
 *  taken from ended (.30→.25), variety (.15→.10), agency (.15→.10) and judged (.20→.15). */
/** v3.1: v3 as designed — v3's first deploy never recorded who won by position, so its
 *  evals fell back to the balance-free suite formula; they don't compare with v3.1. */
/** v4 (2026-10-04): a game with a hidden enemy is scored on its deduction loop — v3.1 gave 0.85 to
 *  a three-round AAOTE game decided by the enemy exposing itself, because 65 % of its weight was
 *  mechanical (ended, variety, agency, length, clean) and every such term was at its maximum.
 *  For those games:
 *    ended .15 · critique .20 · judged .10 · clean .10 ·
 *    deduction .20  accusations were earned: 1, −0.3 per wrong accusation; an exposure without
 *                   evidence 0.3; the enemy never accused 0.6 (the band below judges how often)
 *    interaction .15  share of seats taking an interactive move at least once per two rounds
 *    tension .10   lead changes (½, full at 2) and a close finish (½: margin ≤ 3, ¼: ≤ 6)
 *  and the suite's balance term is the genre band: the enemy exposed in 40–60 % of games, the
 *  enemy winning 30–45 %, wrong accusations under 20 % of all (each 1 inside, falling to 0 at
 *  0.4 away), weighted .25 (runs .65, definition health .10).
 *  Games without a hidden enemy keep the v3.1 run formula and outcome balance (.75/.15/.10). */
/** v4.1: evidence excludes what the enemy gave away by its own move (v4's first deploy counted a
 *  self-reveal as evidence, which would have flattered v0.4 in the calibration ladder). */
export const SCORE_VERSION = 'score/v4.1';
export const WEIGHTS = { ended: 0.25, critique: 0.2, judged: 0.15, variety: 0.1, agency: 0.1, length: 0.1, clean: 0.1 } as const;
export const WEIGHTS_HIDDEN_ROLE = { ended: 0.15, critique: 0.2, judged: 0.1, clean: 0.1, deduction: 0.2, interaction: 0.15, tension: 0.1 } as const;

export interface RunScore {
  score: number;
  parts: Record<string, number>;
  deduction?: DeductionReport;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const LIMIT_END = /max[_ ]?(turns|rounds)|turn limit|round limit|timeout|time limit/i;

export function scoreRun(s: Session, findings: Finding[], j: Judgement | null): RunScore {
  const m = metrics(s);
  if (s.stopped === 'error' || s.stopped === 'stuck') {
    return { score: 0, parts: { ended: 0, variety: 0, agency: 0, length: 0, clean: 0, judged: 0, critique: 0 } };
  }
  // A time-limit end is the game's own rule when the rules name who wins then (v3).
  const ended = m.finished ? (LIMIT_END.test(m.endReason ?? '') && !s.timeoutWinnerRule ? 0.3 : 1) : 0;
  const dom = m.dominantAction?.[1] ?? 0;
  const variety = clamp(1 - Math.max(0, dom - 0.5) / 0.5);
  const agency = clamp(m.meanValid / 4) * (1 - m.forcedShare);
  const length = m.finished ? clamp(m.rounds / 3) : 0.5;
  const clean = findings.some((f) => f.severity === 'error') ? 0 : 1;
  const judged = j?.health.probabilities['plays as designed'] ?? 0;
  const critique = j?.critique?.index ?? 0;
  const d = deduction(s);
  if (d.enemy) {
    const ded = clamp(d.exposed ? (d.evidenceBeforeExposure ? 1 : 0.3) - 0.3 * d.wrong : 0.6 - 0.3 * d.wrong);
    const tension = 0.5 * clamp(d.leadChanges / 2) + (d.margin === null ? 0 : d.margin <= 3 ? 0.5 : d.margin <= 6 ? 0.25 : 0);
    const parts = { ended, critique, judged, clean, deduction: ded, interaction: d.interactiveShare, tension };
    const score = (Object.keys(WEIGHTS_HIDDEN_ROLE) as Array<keyof typeof WEIGHTS_HIDDEN_ROLE>).reduce((a, k) => a + WEIGHTS_HIDDEN_ROLE[k] * parts[k], 0);
    return { score: +score.toFixed(4), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)])), deduction: d };
  }
  const parts = { ended, variety, agency, length, clean, judged, critique };
  const score = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((a, k) => a + WEIGHTS[k] * parts[k], 0);
  return { score: +score.toFixed(4), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)])) };
}

export function definitionHealth(c: Classification): number {
  const errors = c.findings.filter((f) => f.severity === 'error').length;
  return +(1 / (1 + 0.25 * errors)).toFixed(4);
}

/**
 * Outcome balance across a suite (v3): how evenly wins spread over the winning positions
 * the game deals — secret roles where there are any, otherwise seats — as normalised
 * entropy (1 = every role/seat wins equally often, 0 = one always wins). Games without a
 * winner don't count. Null when fewer than 4 games had a winner.
 */
export function outcomeBalance(runs: Array<{ winnerKey?: string | null; positions?: string[] }>): number | null {
  const won = runs.filter((r) => r.winnerKey);
  if (won.length < 4) return null;
  const positions = new Set(runs.flatMap((r) => r.positions ?? []));
  const k = Math.max(positions.size, new Set(won.map((r) => r.winnerKey)).size);
  if (k < 2) return null;
  const counts = new Map<string, number>();
  for (const r of won) counts.set(r.winnerKey!, (counts.get(r.winnerKey!) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / won.length;
    h -= p * Math.log(p);
  }
  return +(h / Math.log(Math.min(k, won.length))).toFixed(4);
}

/** The genre band for hidden-role games (v4): null unless 4+ runs carry a deduction report. */
export function genreBalance(runs: Array<{ deduction?: DeductionReport | null }>): number | null {
  const ds = runs.map((r) => r.deduction).filter((d): d is DeductionReport => !!d && !!d.enemy);
  if (ds.length < 4) return null;
  const band = (x: number, lo: number, hi: number) => (x >= lo && x <= hi ? 1 : clamp(1 - (x < lo ? lo - x : x - hi) / 0.4));
  const exposure = ds.filter((d) => d.exposed).length / ds.length;
  const enemyWins = ds.filter((d) => d.enemyWon).length / ds.length;
  const accusations = ds.reduce((a, d) => a + d.accusations, 0);
  const wrongShare = accusations ? ds.reduce((a, d) => a + d.wrong, 0) / accusations : 0;
  return +((band(exposure, 0.4, 0.6) + band(enemyWins, 0.3, 0.45) + band(wrongShare, 0, 0.2)) / 3).toFixed(4);
}

export function scoreSuite(runScores: number[], c: Classification, balance: number | null = null, genre = false): number {
  const mean = runScores.length ? runScores.reduce((a, b) => a + b, 0) / runScores.length : 0;
  // Without a balance reading (too few decided games), its weight goes back to the runs.
  if (balance === null) return +(0.85 * mean + 0.15 * definitionHealth(c)).toFixed(4);
  if (genre) return +(0.65 * mean + 0.1 * definitionHealth(c) + 0.25 * balance).toFixed(4);
  return +(0.75 * mean + 0.15 * definitionHealth(c) + 0.1 * balance).toFixed(4);
}
