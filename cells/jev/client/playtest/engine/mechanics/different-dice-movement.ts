/**
 * Different Dice Movement Mechanic
 *
 * Dice determine which movement options are available rather than distance.
 * Different die values unlock different move types or directions.
 * Examples: Backgammon (die value = exact distance), some racing games
 */

import {
  MechanicHooks,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  TurnStartContext,
  StateChanges,
  HookContext,
  isMechanicEnabled
} from './types';
import { rollDice } from './core/dice';
import { MoveAction, PlayerState } from '../types/game';
import type { DiceHooks, DiceRolledPayload } from './core/dice-mechanic';

export interface DifferentDiceMovementConfig {
  dice_count?: number;
  dice_sides?: number;
  movement_mapping?: Record<number, MovementOption>;
  use_individual?: boolean;
  doubles_bonus?: boolean;
  must_use_all?: boolean;
}

export interface MovementOption {
  type: 'forward' | 'backward' | 'diagonal' | 'jump' | 'any' | 'specific';
  distance?: number;
  directions?: string[];
  targets?: string[];
}

function getPlayerExtras(player: PlayerState): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

export const differentDiceMovementMechanic: MechanicHooks & DiceHooks = {
  slug: 'different-dice-movement',
  name: 'Different Dice Movement',
  requires: ['dice'],

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'different-dice-movement')) return null;

    const player = ctx.state.players[ctx.playerId];
    if (player) {
      const extras = getPlayerExtras(player);
      extras.availableMovements = [];
      extras.remainingDice = [];
      extras.hasRolledThisTurn = false;
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'different-dice-movement')) return [];

    const config = ctx.config.engine_mechanics?.different_dice_movement as DifferentDiceMovementConfig | undefined;
    const player = ctx.state.players[ctx.playerId];
    if (!player) return [];

    const actions: AvailableAction[] = [];
    const extras = getPlayerExtras(player);
    const hasRolled = extras.hasRolledThisTurn as boolean ?? false;
    const remainingDice = extras.remainingDice as number[] ?? [];

    if (!hasRolled) {
      const diceCount = config?.dice_count ?? 2;
      const diceSides = config?.dice_sides ?? 6;

      actions.push({
        action: {
          type: 'roll',
          diceCount,
          diceSides,
          purpose: 'different_movement'
        },
        priority: 90,
        category: 'dice'
      });

      return actions;
    }

    if (remainingDice.length === 0) return [];

    if (config?.use_individual) {
      for (let i = 0; i < remainingDice.length; i++) {
        actions.push({
          action: { type: 'move', target: 'forward' },
          priority: 60,
          category: 'movement'
        });
      }
    } else {
      actions.push({
        action: { type: 'move', target: 'forward' },
        priority: 60,
        category: 'movement'
      });
    }

    if (!config?.must_use_all) {
      actions.push({
        action: { type: 'pass' },
        priority: 10,
        category: 'other'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    if (!isMechanicEnabled(ctx.config, 'different-dice-movement')) return null;

    const config = ctx.config.engine_mechanics?.different_dice_movement as DifferentDiceMovementConfig | undefined;

    if (action.type === 'roll' && (action as { purpose?: string }).purpose === 'different_movement') {
      const diceCount = config?.dice_count ?? 2;
      const diceSides = config?.dice_sides ?? 6;

      const result = rollDice(state, playerId, {
        diceCount,
        diceSides,
        purpose: 'different_movement'
      });

      if (result.blocked) {
        return {
          handled: true,
          logData: { blocked: true, reason: result.blockReason }
        };
      }

      const player = state.players[playerId];
      if (player) {
        const extras = getPlayerExtras(player);
        extras.hasRolledThisTurn = true;

        let remainingDice = [...result.results];
        if (config?.doubles_bonus && diceCount === 2 && result.results[0] === result.results[1]) {
          remainingDice = [...remainingDice, ...remainingDice];
        }

        extras.remainingDice = remainingDice;
        player.lastRollResults = result.results;
        player.lastRollTotal = result.total;
      }

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          results: result.results,
          total: result.total,
          doubles: diceCount === 2 && result.results[0] === result.results[1]
        }
      };
    }

    if (action.type === 'move') {
      const moveAction = action as MoveAction & { dieIndex?: number; dieValue?: number; distance?: number };
      const player = state.players[playerId];
      if (!player) return null;

      const extras = getPlayerExtras(player);
      const remainingDice = (extras.remainingDice as number[]) ?? [];

      if (config?.use_individual && moveAction.dieIndex !== undefined) {
        if (moveAction.dieIndex >= 0 && moveAction.dieIndex < remainingDice.length) {
          remainingDice.splice(moveAction.dieIndex, 1);
          extras.remainingDice = remainingDice;
        }

        return {
          handled: true,
          advanceTurn: remainingDice.length === 0,
          logData: {
            target: moveAction.target,
            dieUsed: moveAction.dieValue,
            remainingMoves: remainingDice.length
          }
        };
      } else {
        extras.remainingDice = [];

        return {
          handled: true,
          advanceTurn: true,
          logData: { target: moveAction.target }
        };
      }
    }

    return null;
  },

  onDiceRolled(ctx: HookContext, payload: DiceRolledPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'different-dice-movement')) return null;
    if (payload.purpose !== 'different_movement') return null;

    const config = ctx.config.engine_mechanics?.different_dice_movement as DifferentDiceMovementConfig | undefined;
    const player = ctx.state.players[ctx.playerId];

    if (player) {
      const extras = getPlayerExtras(player);
      let remainingDice = [...payload.results];
      const isDoubles = payload.results.length === 2 && payload.results[0] === payload.results[1];

      if (config?.doubles_bonus && isDoubles) {
        remainingDice = [...remainingDice, ...remainingDice];
      }

      extras.remainingDice = remainingDice;
      extras.hasRolledThisTurn = true;
    }

    return null;
  },

  describeAction(action) {
    if (action.type === 'roll' && (action as { purpose?: string }).purpose === 'different_movement') {
      return {
        type: 'roll',
        label: 'Roll for Movement Options',
        description: 'Roll dice to determine available movement options',
        examples: ['{ "type": "roll", "purpose": "different_movement" }']
      };
    }
    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Dice determine movement options rather than just distance.'
  }
};
