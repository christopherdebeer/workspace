/**
 * Hidden Objectives Mechanic (Proposal 012)
 *
 * Assigns secret objectives to players from the game's `objectives` config.
 * Unlike hidden-roles which uses engine_mechanics.hidden_roles config,
 * this mechanic reads from the top-level `objectives` array in RULES.md.
 *
 * Used by games like AAOTE where each player has a unique secret win condition.
 *
 * Hooks used:
 * - initPlayerState: Assign objectives at game start (shuffled)
 * - getVisibleState: Hide objectives from other players
 *
 * Config required:
 * - objectives: Array of objective definitions at top level
 * - engine_mechanics.hidden_objectives.deal_at_start: true
 */

import {
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  MechanicHooks,
  VisibilityContext,
  VisibleState,
  PlayerInitContext,
  PlayerInitResult,
  SharedStateInitContext,
  SharedStateInitResult,
  WinCheckContext,
  WinCheckResult,
  HookContext
} from './types';
import { PlayerState, GameConfig, GameAction } from '../types/game';

/**
 * Objective definition from game config
 */
export interface ObjectiveDefinition {
  /** Objective name (e.g., "The Explorer", "The Enemy") */
  name: string;
  /** Number of this objective in the deck */
  count: number;
  /** Objective type (e.g., "regular", "enemy", "traitor") */
  type: string;
  /** Win condition description */
  condition: string;
  /**
   * Machine-checkable form of the condition (optional). Checked after every action;
   * the first player whose check passes wins. One metric, or `any` / `all` of several:
   *   distinct_items: N   — N differently-named item cards in hand at once
   *   visited: N          — N distinct locations entered (the origin excluded)
   *   placed: N           — N location cards placed by this player
   *   trades: N           — N trades completed (as offerer or responder)
   *   trade_partners: N   — completed trades with N different players
   *   holds: [names]      — every named card in hand at once
   */
  check?: ObjectiveCheck;
}

export type ObjectiveCheck =
  | { distinct_items?: number; visited?: number; placed?: number; trades?: number; trade_partners?: number; holds?: string[]; any?: ObjectiveCheck[]; all?: ObjectiveCheck[] };

type P = Record<string, unknown> & { hand?: Array<{ name: string; type?: string }>; visitedLocations?: string[]; placedLocations?: number; completedTrades?: number; tradePartners?: string[] };

/** Current value of each metric for a player (for checks, and to show progress). */
export function objectiveMetrics(player: P): Record<string, number | string[]> {
  const hand = player.hand ?? [];
  return {
    distinct_items: new Set(hand.filter((c) => c.type === 'item').map((c) => c.name)).size,
    visited: new Set((player.visitedLocations ?? []).filter((l) => l !== 'origin' && l !== 'start')).size,
    placed: Number(player.placedLocations ?? 0),
    trades: Number(player.completedTrades ?? 0),
    trade_partners: (player.tradePartners ?? []).length,
    holds: [...new Set(hand.map((c) => c.name))],
  };
}

export function checkObjective(check: ObjectiveCheck | undefined, player: P): boolean {
  if (!check) return false;
  const m = objectiveMetrics(player);
  const parts: boolean[] = [];
  for (const k of ['distinct_items', 'visited', 'placed', 'trades', 'trade_partners'] as const) {
    if (typeof check[k] === 'number') parts.push((m[k] as number) >= (check[k] as number));
  }
  if (check.holds) parts.push(check.holds.every((n) => (m.holds as string[]).includes(n)));
  if (check.any) parts.push(check.any.some((c) => checkObjective(c, player)));
  if (check.all) parts.push(check.all.every((c) => checkObjective(c, player)));
  return parts.length > 0 && parts.every(Boolean);
}

/** "3/6 locations visited" style progress lines for the check's metrics. */
function progress(check: ObjectiveCheck | undefined, player: P): string[] {
  if (!check) return [];
  const m = objectiveMetrics(player);
  const out: string[] = [];
  const LABEL = { distinct_items: 'different items held', visited: 'locations visited', placed: 'locations placed', trades: 'trades completed', trade_partners: 'different trade partners' } as const;
  for (const k of ['distinct_items', 'visited', 'placed', 'trades', 'trade_partners'] as const) {
    if (typeof check[k] === 'number') out.push(`${m[k]}/${check[k]} ${LABEL[k]}`);
  }
  if (check.holds) out.push(`holding ${check.holds.filter((n) => (m.holds as string[]).includes(n)).length}/${check.holds.length} of ${check.holds.join(', ')}`);
  for (const c of [...(check.any ?? []), ...(check.all ?? [])]) out.push(...progress(c, player));
  return out;
}

/**
 * Hidden objectives config
 */
export interface HiddenObjectivesConfig {
  /** Deal objectives at game start */
  deal_at_start?: boolean;
  /** Reveal objective when completed */
  reveal_on_completion?: boolean;
  /**
   * Denounce: once per game, spend an action to name a player as the enemy/traitor.
   *   correct: 'win' (the denouncer wins) | 'reveal' (the enemy is exposed to everyone)
   *   wrong:   'reveal_self' (the denouncer's objective is exposed) | 'end_turn' | 'both' |
   *            'forfeit' (exposed, turn ends, and their objective no longer counts)
   *   from_round: N — not before round N (no blind round-1 guesses)
   */
  denounce?: { correct?: 'win' | 'reveal'; wrong?: 'reveal_self' | 'end_turn' | 'both' | 'forfeit'; from_round?: number };
}

/**
 * Fisher-Yates shuffle with deterministic seed based on player count
 */
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const hiddenObjectivesMechanic: MechanicHooks = {
  slug: 'hidden-objectives',
  name: 'Hidden Objectives',
  requires: ['visibility'],

  configSchema: {
    type: 'object',
    description: 'Hidden objectives system for secret win conditions',
    properties: {
      deal_at_start: { type: 'boolean', description: 'Deal objectives at game start' },
      reveal_on_completion: { type: 'boolean', description: 'Reveal objective when completed' }
    }
  },

  /**
   * Deal once, for everyone: no objective twice (beyond its count), and when the pool has an
   * enemy/traitor objective, exactly one player gets one — the rest are regular. (Dealing per
   * player from a fresh shuffle gave duplicates and an Enemy only ~1 game in 5.)
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const objectives = (ctx.config as { objectives?: ObjectiveDefinition[] }).objectives;
    const hiddenConfig = ctx.config.engine_mechanics?.hidden_objectives as HiddenObjectivesConfig | undefined;
    if (!objectives?.length || !hiddenConfig?.deal_at_start) return null;
    const pool: ObjectiveDefinition[] = [];
    for (const obj of objectives) for (let i = 0; i < (obj.count || 1); i++) pool.push(obj);
    const isEnemy = (o: ObjectiveDefinition) => o.type === 'enemy' || o.type === 'traitor';
    const enemies = shuffleArray(pool.filter(isEnemy));
    const regulars = shuffleArray(pool.filter((o) => !isEnemy(o)));
    const n = ctx.playerIds.length;
    const hand: ObjectiveDefinition[] = [];
    if (enemies.length) hand.push(enemies[0]);
    hand.push(...regulars.slice(0, n - hand.length));
    if (hand.length < n) hand.push(...shuffleArray([...enemies.slice(1), ...regulars.slice(n)]).slice(0, n - hand.length));
    const dealt = shuffleArray(hand);
    const deal: Record<string, ObjectiveDefinition> = {};
    ctx.playerIds.forEach((pid, i) => {
      if (dealt[i]) deal[pid] = dealt[i];
    });
    return { objectiveDeal: deal, alwaysCheckWin: objectives.some((o) => !!o.check) } as unknown as SharedStateInitResult;
  },

  /** Hand each player the objective dealt to them. */
  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const deal = ctx.shared?.objectiveDeal as Record<string, ObjectiveDefinition> | undefined;
    const assigned = deal?.[ctx.playerId];
    if (!assigned) return null;
    const isEnemy = assigned.type === 'enemy' || assigned.type === 'traitor';
    return {
      objective: assigned,
      hiddenRole: assigned.name, // objective name doubles as the hidden role
      team: isEnemy ? 'enemy' : 'regular',
      knowledge: { knownRoles: { [ctx.playerId]: assigned.name } as Record<string, string>, knownPositions: {} as Record<string, string>, revealed: {} as Record<string, unknown> },
    };
  },

  /** Denounce: name a player as the enemy (see HiddenObjectivesConfig.denounce). */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const cfg = (ctx.config.engine_mechanics?.hidden_objectives as HiddenObjectivesConfig | undefined)?.denounce;
    if (!cfg || (ctx.player as unknown as { denounced?: string }).denounced || ctx.state.round < (cfg.from_round ?? 1)) return [];
    const targets = ctx.state.turnOrder.filter((p) => p !== ctx.playerId);
    return [{
      action: { type: 'denounce', target: targets[0] } as unknown as GameAction,
      priority: 20,
      category: 'social',
      description: 'Once per game: name a player as The Enemy',
      required: { target: 'The player you accuse' },
      examples: targets.map((target) => ({ type: 'denounce', target }) as unknown as GameAction),
      targets,
    }];
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if ((action.type as string) !== 'denounce') return null;
    const cfg = (ctx.config.engine_mechanics?.hidden_objectives as HiddenObjectivesConfig | undefined)?.denounce;
    if (!cfg) return { valid: false, error: 'Denouncing is not part of this game.' };
    if ((ctx.player as unknown as { denounced?: string }).denounced) return { valid: false, error: 'You have already denounced someone this game.' };
    if (ctx.state.round < (cfg.from_round ?? 1)) return { valid: false, error: `Denouncing opens in round ${cfg.from_round}.` };
    const target = (action as unknown as { target?: string }).target;
    if (!target || target === ctx.playerId || !ctx.state.players[target]) return { valid: false, error: 'Name another player.' };
    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if ((ctx.action.type as string) !== 'denounce') return null;
    const cfg = (ctx.config.engine_mechanics?.hidden_objectives as HiddenObjectivesConfig).denounce!;
    const target = (ctx.action as unknown as { target: string }).target;
    const me = ctx.player as unknown as P & { denounced?: string; denouncedEnemy?: boolean; revealedAs?: string; objective?: ObjectiveDefinition; actionPoints?: number };
    const them = ctx.state.players[target] as unknown as { team?: string; revealedAs?: string; objective?: ObjectiveDefinition };
    me.denounced = target;
    const correct = them?.team === 'enemy';
    if (correct) {
      them.revealedAs = them.objective?.name ?? 'The Enemy';
      if ((cfg.correct ?? 'win') === 'win') me.denouncedEnemy = true;
      return { handled: true, advanceTurn: false, checkWin: true, logMessage: 'denounce_correct', logData: { target, revealed: them.revealedAs } };
    }
    const wrong = cfg.wrong ?? 'both';
    if (wrong === 'reveal_self' || wrong === 'both' || wrong === 'forfeit') me.revealedAs = me.objective?.name ?? 'unknown';
    if (wrong === 'forfeit') (me as unknown as { forfeited?: boolean }).forfeited = true;
    const endTurn = wrong === 'end_turn' || wrong === 'both' || wrong === 'forfeit';
    if (endTurn && me.actionPoints !== undefined) me.actionPoints = 0;
    return { handled: true, advanceTurn: endTurn ? true : false, checkWin: false, logMessage: 'denounce_wrong', logData: { target, denouncerRevealed: me.revealedAs ?? null } };
  },

  /** A structured `check` that passes wins the game for its holder, after any action. */
  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    if (ctx.trigger === 'timeout') return null;
    if ((ctx.player as unknown as { denouncedEnemy?: boolean }).denouncedEnemy) {
      return { won: true, reason: `${ctx.playerId} denounced The Enemy (${(ctx.player as unknown as { denounced?: string }).denounced})` };
    }
    const obj = (ctx.player as unknown as { objective?: ObjectiveDefinition }).objective;
    if (!obj?.check || (ctx.player as unknown as { forfeited?: boolean }).forfeited) return null;
    if (!checkObjective(obj.check, ctx.player as unknown as P)) return null;
    return { won: true, reason: `${ctx.playerId} completed ${obj.name}: ${obj.condition}` };
  },

  /** Your own objective and how far along it you are (others never see it). */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const player = ctx.state.players[ctx.playerId] as unknown as P & { objective?: ObjectiveDefinition; team?: string };
    const obj = player?.objective;
    if (!obj) return null;
    return {
      yourObjective: `${obj.name} (${obj.type}): ${obj.condition}`,
      yourTeam: player.team,
      objectiveProgress: progress(obj.check, player),
    };
  },

  /**
   * Filter visible state to hide other players' objectives
   */
  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    const hiddenConfig = ctx.config.engine_mechanics?.hidden_objectives as HiddenObjectivesConfig | undefined;
    if (!hiddenConfig) return null;

    const filteredPlayers: Record<string, Partial<PlayerState>> = {};
    const hiddenInfo: string[] = [];

    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      // Always show full info for self
      if (playerId === ctx.viewerPlayerId) continue;

      // Hide objective from other players
      const filtered: Partial<PlayerState> = { ...player };
      if ((filtered as { objective?: ObjectiveDefinition }).objective) {
        delete (filtered as { objective?: ObjectiveDefinition }).objective;
        hiddenInfo.push(`${playerId}'s objective is hidden`);
      }

      filteredPlayers[playerId] = filtered;
    }

    if (hiddenInfo.length === 0) return null;

    return {
      players: filteredPlayers,
      visibilityMeta: {
        hiddenInfo
      }
    };
  }
};

export default hiddenObjectivesMechanic;
