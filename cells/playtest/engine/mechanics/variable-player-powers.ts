/**
 * Variable Player Powers Mechanic
 *
 * Assigns unique powers/abilities to each player.
 * Supports random (unique per player) or fixed (by index) assignment.
 *
 * Hooks used:
 * - initPlayerState: Assign power based on config and existing assignments
 * - getPlayerView: Expose power info to player view
 */

import { MechanicHooks, PlayerInitResult, PlayerInitContext, HookContext, isMechanicEnabled, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction } from './types';
import type { GameAction, GameConfig, GameState } from '../types/game';

/**
 * A power's machine-readable effect (optional; without one a power is descriptive only):
 *   { type: 'action_cost', action: 'trade_offer', cost: 0 }  — an action costs less AP
 *   { type: 'move_range', range: 2 }                         — one move reaches tiles N links away
 *   { type: 'see_top_card' }                                 — you see the top card of the deck
 *   { type: 'peek_objective', uses: 1 }                      — use_power: see a player's objective
 *   { type: 'immune', to: ['steal_item', 'peek_hand'] }       — those events can't target you
 */
export type PowerEffect =
  | { type: 'action_cost'; action: string; cost: number }
  | { type: 'move_range'; range: number }
  | { type: 'see_top_card' }
  | { type: 'peek_objective'; uses?: number }
  | { type: 'immune'; to: string[] };

interface Power {
  id: string;
  name: string;
  description?: string;
  effect?: PowerEffect;
}

/** The power effect a player holds (if any). */
export function powerEffect(state: GameState, config: GameConfig, playerId: string): PowerEffect | undefined {
  const cfg = config.engine_mechanics?.variable_powers as VariablePowersConfig | undefined;
  const id = (state.players[playerId] as unknown as { powerId?: string })?.powerId;
  return id ? cfg?.powers.find((p) => p.id === id)?.effect : undefined;
}

interface VariablePowersConfig {
  assignment: 'random' | 'fixed';
  powers: Power[];
}

export const variablePlayerPowersMechanic: MechanicHooks = {
  slug: 'variable-player-powers',
  name: 'Variable Player Powers',

  configSchema: {
    type: 'object',
    description: 'Assign unique powers/abilities to each player',
    properties: {
      assignment: {
        type: 'string',
        description: 'How powers are assigned',
        enum: ['random', 'fixed'],
        required: true
      },
      powers: {
        type: 'array',
        description: 'Available powers with id, name, and description',
        required: true
      }
    },
    required: ['assignment', 'powers']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const powersConfig = ctx.config.engine_mechanics?.variable_powers as VariablePowersConfig | undefined;
    if (!powersConfig) return null;

    const powers = powersConfig.powers;
    let powerId: string | undefined;

    if (powersConfig.assignment === 'random') {
      // Random assignment - each player gets a different power
      // Check existing players to avoid duplicates
      const usedPowerIds = Object.values(ctx.existingPlayers)
        .map(p => p.powerId)
        .filter((id): id is string => id !== undefined);

      const availablePowers = powers.filter(p => !usedPowerIds.includes(p.id));

      if (availablePowers.length > 0) {
        powerId = availablePowers[Math.floor(Math.random() * availablePowers.length)].id;
      }
    } else if (powersConfig.assignment === 'fixed') {
      // Fixed assignment by player index
      if (ctx.playerIndex < powers.length) {
        powerId = powers[ctx.playerIndex].id;
      }
    }

    if (!powerId) return null;

    return { powerId };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'variable-player-powers')) return null;

    const powersConfig = ctx.config.engine_mechanics?.variable_powers as VariablePowersConfig | undefined;
    if (!powersConfig) return null;

    const powerId = ctx.player.powerId as string | undefined;
    if (!powerId) return null;

    const power = powersConfig.powers.find(p => p.id === powerId);

    const top = power?.effect?.type === 'see_top_card' ? ((ctx.state.shared.deck as Array<{ name: string }> | undefined) ?? [])[0]?.name : undefined;
    const uses = power?.effect?.type === 'peek_objective' ? (power.effect.uses ?? 1) - Number((ctx.player as unknown as { powerUses?: number }).powerUses ?? 0) : undefined;
    return {
      powerId,
      powerName: power?.name ?? powerId,
      power: power ? { id: power.id, name: power.name, description: power.description } : undefined,
      ...(top ? { topOfDeck: top } : {}),
      ...(uses !== undefined ? { powerUsesLeft: Math.max(0, uses) } : {}),
      // Everyone's (public) powers, so players can play around them.
      playerPowers: Object.fromEntries(ctx.state.turnOrder.map((p) => [p, powersConfig.powers.find((x) => x.id === (ctx.state.players[p] as unknown as { powerId?: string }).powerId)?.name]).filter(([, n]) => n)),
    };
  },

  /** use_power: the active power (peek_objective) at a target player. */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const e = powerEffect(ctx.state, ctx.config, ctx.playerId);
    if (e?.type !== 'peek_objective') return [];
    if (Number((ctx.player as unknown as { powerUses?: number }).powerUses ?? 0) >= (e.uses ?? 1)) return [];
    const targets = ctx.state.turnOrder.filter((p) => p !== ctx.playerId);
    return [{ action: { type: 'use_power', target: targets[0] } as unknown as GameAction, priority: 30, category: 'power', description: 'Use your power: see a player\u2019s secret objective', required: { target: 'A player' }, examples: targets.map((target) => ({ type: 'use_power', target }) as unknown as GameAction), targets }];
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if ((action.type as string) !== 'use_power') return null;
    const e = powerEffect(ctx.state, ctx.config, ctx.playerId);
    if (e?.type !== 'peek_objective') return { valid: false, error: 'Your power has no action to use.' };
    if (Number((ctx.player as unknown as { powerUses?: number }).powerUses ?? 0) >= (e.uses ?? 1)) return { valid: false, error: 'Your power is used up.' };
    const target = (action as unknown as { target?: string }).target;
    if (!target || target === ctx.playerId || !ctx.state.players[target]) return { valid: false, error: 'Choose another player.' };
    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if ((ctx.action.type as string) !== 'use_power') return null;
    const target = (ctx.action as unknown as { target: string }).target;
    const me = ctx.state.players[ctx.playerId] as unknown as { powerUses?: number; knowledge?: { revealed?: Record<string, unknown> } };
    me.powerUses = Number(me.powerUses ?? 0) + 1;
    const obj = (ctx.state.players[target] as unknown as { objective?: { name: string; condition: string } }).objective;
    const k = (me.knowledge ??= {});
    (k.revealed ??= {})[`${target} objective`] = obj ? `${obj.name}: ${obj.condition}` : 'none';
    return { handled: true, advanceTurn: false, checkWin: true, logMessage: 'power_used', logData: { target } };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const powers = cfg.powers;
    if (!Array.isArray(powers)) return null;
    return [{ label: 'Powers', value: String(powers.length) }];
  }
};
