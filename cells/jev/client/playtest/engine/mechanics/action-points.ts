/**
 * Action Points Mechanic
 *
 * First mechanic extracted from game.ts as proof of concept.
 * Provides action economy: points per turn, costs per action type.
 *
 * Hooks used:
 * - initPlayerState: Set initial action points
 * - preValidateAction: Block if insufficient AP
 * - postExecuteAction: Deduct AP cost
 * - onTurnStart: Reset AP for new turn
 * - shouldAutoEndTurn: Force end when AP depleted
 * - getPlayerView: Expose actionPoints and actionPointsUsed to player view
 */

import { MechanicHooks, HookContext, TurnStartContext, ValidationResult, StateChanges, PlayerInitResult, PlayerInitContext, isMechanicEnabled } from './types';
import { GameAction, DrawAction } from '../types/game';

export const actionPointsMechanic: MechanicHooks = {
  slug: 'action-points',
  name: 'Action Points',

  configSchema: {
    type: 'object',
    description: 'Action economy: points per turn, costs per action type',
    properties: {
      points_per_turn: {
        type: 'number',
        description: 'Action points granted at start of each turn',
        required: true
      },
      action_costs: {
        type: 'object',
        description: 'Cost per action type (e.g., { draw: 1, play_card: 1 })'
      },
      rollover: {
        type: 'boolean',
        description: 'Whether unused AP carries over to next turn',
        default: false
      }
    },
    required: ['points_per_turn']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const apConfig = ctx.config.engine_mechanics?.action_points;
    if (!apConfig) return null;

    return {
      actionPoints: apConfig.points_per_turn,
      actionPointsUsed: 0
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    const apConfig = ctx.config.engine_mechanics?.action_points;
    if (!apConfig) return null;

    // Pass actions should always be allowed (let engine handle)
    if (action.type === 'pass') return null;

    const remainingAP = ctx.player.actionPoints ?? 0;
    const usedAP = ctx.player.actionPointsUsed ?? 0;
    const pointsPerTurn = apConfig.points_per_turn;

    // Check if player has exhausted their AP for this turn
    if (remainingAP <= 0) {
      return {
        valid: false,
        error: `No action points remaining (${usedAP}/${pointsPerTurn} used this turn)`
      };
    }

    // Determine the cost of this specific action
    const baseCost = apConfig.action_costs?.[action.type] ?? 1;
    let actionCost = baseCost;

    // For draw actions, cost is per card drawn
    if (action.type === 'draw') {
      const drawAction = action as DrawAction;
      const count = drawAction.count ?? 1;
      actionCost = baseCost * count;
    }

    // Check if the action costs more AP than the player has remaining
    if (actionCost > remainingAP) {
      const costExplanation = action.type === 'draw' && (action as DrawAction).count && (action as DrawAction).count! > 1
        ? ` (${(action as DrawAction).count} cards × ${baseCost} AP each)`
        : '';
      return {
        valid: false,
        error: `Insufficient action points: need ${actionCost}${costExplanation}, have ${remainingAP}`
      };
    }

    return { valid: true };
  },

  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    const apConfig = ctx.config.engine_mechanics?.action_points;
    if (!apConfig) return null;
    if (ctx.player.actionPoints === undefined) return null;

    // Skip for pass (end turn)
    if (action.type === 'pass') return null;

    const baseCost = apConfig.action_costs?.[action.type] ?? 1;
    let cost = baseCost;

    // For draw actions, cost is per card drawn
    if (action.type === 'draw') {
      const drawAction = action as DrawAction;
      const count = drawAction.count ?? 1;
      cost = baseCost * count;
    }

    const newAP = ctx.player.actionPoints - cost;
    const newUsed = (ctx.player.actionPointsUsed ?? 0) + cost;

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          actionPoints: newAP,
          actionPointsUsed: newUsed
        }
      }
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const apConfig = ctx.config.engine_mechanics?.action_points;
    if (!apConfig) return null;

    const rollover = apConfig.rollover ? (ctx.player.actionPoints || 0) : 0;
    const newAP = apConfig.points_per_turn + rollover;

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          actionPoints: newAP,
          actionPointsUsed: 0
        }
      }
    };
  },

  shouldAutoEndTurn(ctx: HookContext): boolean {
    const apConfig = ctx.config.engine_mechanics?.action_points;
    if (!apConfig) return false;
    if (ctx.player.actionPoints === undefined) return false;

    // Auto-end turn when AP is 0 (and no rollover configured)
    // Don't auto-end if rollover is enabled - player may want to save AP
    if (!apConfig.rollover && ctx.player.actionPoints <= 0) {
      return true;
    }

    return false;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'action-points')) return null;

    const apConfig = ctx.config.engine_mechanics?.action_points;
    const pointsPerTurn = apConfig?.points_per_turn ?? 0;

    return {
      actionPoints: ctx.player.actionPoints ?? 0,
      actionPointsUsed: ctx.player.actionPointsUsed ?? 0,
      actionPointsPerTurn: pointsPerTurn
    };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const ppt = cfg.points_per_turn;
    if (typeof ppt !== 'number') return null;
    return [{ label: 'AP/turn', value: String(ppt) }];
  }
};
