/* ---------------------------------------------------------------------------
 * Deduction report — what a hidden-role session says about its deduction loop,
 * computed from the played record (no Jev). Feeds score/v4 and the eval summary.
 *
 *   enemy                   the seat dealt the enemy/traitor role (from the end-of-game roles)
 *   accusations/correct/wrong
 *   exposed                 the game ended with the enemy correctly accused
 *   evidenceBeforeExposure  that accusation followed evidence naming the enemy: the accuser
 *                           had privately learned something about them, the enemy was revealed
 *                           to all, or everyone learned something about them (knowledge events)
 *   enemyWon                the enemy's seat won
 *   interactiveShare        share of seats that took an interactive move (cooperate, sabotage,
 *                           expose, accuse, trade, power, targeted card) at least once per two rounds
 *   leadChanges / margin    score dynamics: how often the leader changed; final top-two gap
 * ------------------------------------------------------------------------- */
import type { Session, TurnRecord } from './runner';

export interface DeductionReport {
  enemy: string | null;
  accusations: number;
  correct: number;
  wrong: number;
  exposed: boolean;
  evidenceBeforeExposure: boolean | null;
  enemyWon: boolean;
  interactiveShare: number;
  leadChanges: number;
  margin: number | null;
}

const ACCUSE = /^(denounce|accuse)$/;
const INTERACTIVE = /^(cooperate|sabotage|expose|denounce|accuse|trade_offer|use_power|steal|bribe|vote)$/;

/** Does a knowledge line (lib/runner knowledgeEvents) tell `viewer` something about `enemy`? */
export function namesEnemy(line: string, enemy: string, viewer: string): boolean {
  const priv = /^R\d+ (\S+) privately learned (.+?) \(/.exec(line);
  if (priv) return priv[1] === viewer && (priv[2].startsWith(`${enemy} `) || priv[2].endsWith(` ${enemy}`));
  const pub = /^R\d+ everyone learned: (.+?) \(/.exec(line);
  if (pub) return pub[1].startsWith(`${enemy}'s `) || pub[1].startsWith(`${enemy} `);
  const rev = /^R\d+ (\S+) revealed to all as/.exec(line);
  return !!rev && rev[1] === enemy;
}

export function deduction(s: Session): DeductionReport {
  const roles = s.roles ?? {};
  const enemy = Object.entries(roles).find(([, r]) => /enemy|traitor|agent/i.test(String(r)))?.[0] ?? null;
  const turns = s.turns as Array<TurnRecord & { learned?: string[] }>;
  const acc = turns.filter((t) => ACCUSE.test(String(t.action.type)));
  const correct = enemy ? acc.filter((t) => (t.action as { target?: string }).target === enemy) : [];
  const exposed = !!enemy && correct.length > 0 && /denounc|accus|expos/i.test(s.endReason ?? '');
  let evidenceBeforeExposure: boolean | null = null;
  if (exposed && enemy) {
    const at = correct[correct.length - 1];
    evidenceBeforeExposure = turns.some((t) => t.step < at.step && (t.learned ?? []).some((l) => namesEnemy(l, enemy, at.player)));
  }
  const seats = [...new Set(turns.map((t) => t.player))];
  const rounds = Math.max(1, turns.length ? turns[turns.length - 1].round : 1);
  const need = Math.ceil(rounds / 2);
  const interactive = seats.filter((p) => turns.filter((t) => t.player === p && (INTERACTIVE.test(String(t.action.type)) || (t.action.type === 'play_card' && (t.action as { target?: string }).target))).length >= need);
  let leader: string | null = null;
  let leadChanges = 0;
  for (const t of turns) {
    const top = Math.max(...Object.values(t.scores));
    if (!Number.isFinite(top) || top <= 0) continue;
    const leaders = Object.entries(t.scores).filter(([, v]) => v === top).map(([p]) => p);
    if (leader && leaders.includes(leader)) continue;
    if (leader) leadChanges++;
    leader = leaders[0];
  }
  const final = turns.length ? Object.values(turns[turns.length - 1].scores).sort((a, b) => b - a) : [];
  return {
    enemy,
    accusations: acc.length,
    correct: correct.length,
    wrong: acc.length - correct.length,
    exposed,
    evidenceBeforeExposure,
    enemyWon: !!enemy && s.winner === enemy,
    interactiveShare: seats.length ? +(interactive.length / seats.length).toFixed(3) : 0,
    leadChanges,
    margin: final.length >= 2 ? final[0] - final[1] : null,
  };
}
