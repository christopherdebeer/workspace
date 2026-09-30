/* ---------------------------------------------------------------------------
 * score/v2 — the objective a hill climb optimises. Mostly computed from the
 * played record; two terms are Jev's own judgement. Versioned: changing a weight
 * is a new SCORE_VERSION, and evals only compare within one version.
 *
 * A run (one seed × player count):
 *   0 if the engine errored or a player had no legal move — nothing to judge.
 *   ended    .25  finished by its own win condition (a turn/round limit .3, never 0)
 *   critique .20  Jev's qualitative critique: mean of 16 dimensions (fun, engagement,
 *                 dynamism, tension, decisions, depth, diversity, interaction, pace,
 *                 balance, theme, coherence, goals, comeback, replay, elegance) / 4
 *   judged   .15  Jev: P("plays as designed") over the session record
 *   variety  .10  no single move type over half of all moves (linear to 0 at 100%)
 *   agency   .10  real choice per turn: min(mean legal moves / 4, 1) × share of unforced turns
 *   length   .10  lasted ≥ 3 rounds (a first-round win is a broken game, not a quick one)
 *   clean    .10  no error-level findings from the session (engine faults surfaced by play)
 * A suite: 0.85 × mean(run scores) + 0.15 × definition health,
 *   definition health = 1 / (1 + 0.25 × error-level classification findings)
 *   (card effects nothing handles, declared mechanics nothing reads, schema errors).
 * v1 (ended .30, variety .15, agency .15, judged .20, no critique) evals stay stored
 * but never compare with v2.
 * ------------------------------------------------------------------------- */
import type { Classification, Finding, Judgement, Session } from './runner';
import { metrics } from './runner';

/** v2 (2026-09-30): adds Jev's qualitative critique (16 dimensions, 0–1 index) at .20,
 *  taken from ended (.30→.25), variety (.15→.10), agency (.15→.10) and judged (.20→.15). */
export const SCORE_VERSION = 'score/v2';
export const WEIGHTS = { ended: 0.25, critique: 0.2, judged: 0.15, variety: 0.1, agency: 0.1, length: 0.1, clean: 0.1 } as const;

export interface RunScore {
  score: number;
  parts: { ended: number; variety: number; agency: number; length: number; clean: number; judged: number; critique: number };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const LIMIT_END = /max[_ ]?(turns|rounds)|turn limit|round limit|timeout|time limit/i;

export function scoreRun(s: Session, findings: Finding[], j: Judgement | null): RunScore {
  const m = metrics(s);
  if (s.stopped === 'error' || s.stopped === 'stuck') {
    return { score: 0, parts: { ended: 0, variety: 0, agency: 0, length: 0, clean: 0, judged: 0, critique: 0 } };
  }
  const ended = m.finished ? (LIMIT_END.test(m.endReason ?? '') ? 0.3 : 1) : 0;
  const dom = m.dominantAction?.[1] ?? 0;
  const variety = clamp(1 - Math.max(0, dom - 0.5) / 0.5);
  const agency = clamp(m.meanValid / 4) * (1 - m.forcedShare);
  const length = m.finished ? clamp(m.rounds / 3) : 0.5;
  const clean = findings.some((f) => f.severity === 'error') ? 0 : 1;
  const judged = j?.health.probabilities['plays as designed'] ?? 0;
  const critique = j?.critique?.index ?? 0;
  const parts = { ended, variety, agency, length, clean, judged, critique };
  const score = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((a, k) => a + WEIGHTS[k] * parts[k], 0);
  return { score: +score.toFixed(4), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)])) as RunScore['parts'] };
}

export function definitionHealth(c: Classification): number {
  const errors = c.findings.filter((f) => f.severity === 'error').length;
  return +(1 / (1 + 0.25 * errors)).toFixed(4);
}

export function scoreSuite(runScores: number[], c: Classification): number {
  const mean = runScores.length ? runScores.reduce((a, b) => a + b, 0) / runScores.length : 0;
  return +(0.85 * mean + 0.15 * definitionHealth(c)).toFixed(4);
}
