/**
 * Movement Points Mechanic
 *
 * Provides movement economy separate from action points.
 * Players have a budget of movement points per turn that can be
 * spent on move actions with configurable terrain costs.
 *
 * Hooks used:
 * - initPlayerState: Set initial movement points
 * - preValidateAction: Block move if insufficient MP
 * - postExecuteAction: Deduct MP cost for moves
 * - onTurnStart: Reset MP for new turn
 * - onAfterMove: Apply terrain-based MP costs
 */

import {
  MechanicHooks,
  HookContext,
  TurnStartContext,
  ValidationResult,
  StateChanges,
  PlayerInitResult,
  PlayerInitContext,
  AfterMoveContext
} from './types';
import { GameAction, MoveAction } from '../types/game';

interface MovementPointsConfig {
  /** Movement points granted at start of each turn */
  points_per_turn: number;
  /** Whether unused MP carries over to next turn */
  rollover?: boolean;
  /** Maximum MP that can be accumulated (if rollover enabled) */
  max_points?: number;
  /** Cost per terrain/state type (e.g., { "forest": 2, "road": 1 }) */
  terrain_costs?: Record<string, number>;
  /** Default cost if terrain not specified */
  default_cost?: number;
  /** Movement actions that consume MP (default: ['move']) */
  movement_actions?: string[];
}

function getMoveCost(
  fromState: string | undefined,
  toState: string,
  config: MovementPointsConfig
): number {
  // Check terrain costs for destination
  if (config.terrain_costs && toState in config.terrain_costs) {
    return config.terrain_costs[toState];
  }
  return config.default_cost ?? 1;
}

function getTargetState(action: MoveAction): string | null {
  return action.target || null;
}

export const movementPointsMechanic: MechanicHooks = {
  slug: 'movement-points',
  name: 'Movement Points',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Movement economy: points per turn, terrain costs',
    properties: {
      points_per_turn: {
        type: 'number',
        description: 'Movement points granted at start of each turn',
        required: true
      },
      rollover: {
        type: 'boolean',
        description: 'Whether unused MP carries over to next turn',
        default: false
      },
      max_points: {
        type: 'number',
        description: 'Maximum MP that can be accumulated (if rollover enabled)'
      },
      terrain_costs: {
        type: 'object',
        description: 'Cost per terrain type (e.g., { "forest": 2, "road": 1 })'
      },
      default_cost: {
        type: 'number',
        description: 'Default movement cost if terrain not specified',
        default: 1
      },
      movement_actions: {
        type: 'array',
        description: 'Action types that consume MP',
        default: ['move']
      }
    },
    required: ['points_per_turn']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const mpConfig = ctx.config.engine_mechanics?.movement_points as MovementPointsConfig | undefined;
    if (!mpConfig) return null;

    return {
      movementPoints: mpConfig.points_per_turn,
      movementPointsUsed: 0
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    const mpConfig = ctx.config.engine_mechanics?.movement_points as MovementPointsConfig | undefined;
    if (!mpConfig) return null;

    // Check if this is a movement action
    const movementActions = mpConfig.movement_actions ?? ['move'];
    if (!movementActions.includes(action.type)) return null;

    const moveAction = action as MoveAction;
    const targetState = getTargetState(moveAction);

    if (!targetState) {
      return null; // Let other validators handle missing target
    }

    const currentState = ctx.player.state;
    const cost = getMoveCost(currentState, targetState, mpConfig);
    const remainingMP = ctx.player.movementPoints ?? 0;

    if (cost > remainingMP) {
      const terrainInfo = mpConfig.terrain_costs && targetState in mpConfig.terrain_costs
        ? ` (${targetState} terrain)`
        : '';
      return {
        valid: false,
        error: `Insufficient movement points: need ${cost}${terrainInfo}, have ${remainingMP}`
      };
    }

    return { valid: true };
  },

  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    const mpConfig = ctx.config.engine_mechanics?.movement_points as MovementPointsConfig | undefined;
    if (!mpConfig) return null;
    if (ctx.player.movementPoints === undefined) return null;

    // Check if this is a movement action
    const movementActions = mpConfig.movement_actions ?? ['move'];
    if (!movementActions.includes(action.type)) return null;

    const moveAction = action as MoveAction;
    const targetState = getTargetState(moveAction);

    if (!targetState) return null;

    const currentState = ctx.player.state;
    const cost = getMoveCost(currentState, targetState, mpConfig);
    const newMP = ctx.player.movementPoints - cost;
    const newUsed = (ctx.player.movementPointsUsed ?? 0) + cost;

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          movementPoints: newMP,
          movementPointsUsed: newUsed
        }
      }
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const mpConfig = ctx.config.engine_mechanics?.movement_points as MovementPointsConfig | undefined;
    if (!mpConfig) return null;

    let newMP = mpConfig.points_per_turn;

    // Handle rollover
    if (mpConfig.rollover) {
      const currentMP = ctx.player.movementPoints ?? 0;
      newMP += currentMP;

      // Cap at max if configured
      if (mpConfig.max_points !== undefined) {
        newMP = Math.min(newMP, mpConfig.max_points);
      }
    }

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          movementPoints: newMP,
          movementPointsUsed: 0
        }
      }
    };
  }
};
