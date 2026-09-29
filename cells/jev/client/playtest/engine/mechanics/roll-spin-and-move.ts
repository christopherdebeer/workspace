/**
 * Roll Spin and Move Mechanic
 *
 * Classic board game movement where dice determine exactly how far you move.
 * Examples: Monopoly, Candy Land, The Game of Life
 *
 * Hooks used:
 * - onTurnStart: Auto-roll dice for movement if configured
 * - getAvailableActions: Expose roll_and_move action
 * - onExecuteAction: Handle roll_and_move, calculate destination
 * - onDiceRolled: Store roll result for movement (dice-defined hook)
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
import type { DiceHooks, DiceRolledPayload } from './core/dice-mechanic';
import { PlayerState } from '../types/game';

export interface RollSpinMoveConfig {
  dice_count?: number;
  dice_sides?: number;
  auto_roll?: boolean;
  doubles_again?: boolean;
  doubles_jail?: boolean;
  jail_state?: string;
  linear_track?: string[];
  loop?: boolean;
}

function getPlayerExtras(player: PlayerState): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

export const rollSpinAndMoveMechanic: MechanicHooks & DiceHooks = {
  slug: 'roll-spin-and-move',
  name: 'Roll Spin and Move',
  requires: ['dice', 'board'],

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'roll-spin-and-move')) return null;

    const config = ctx.config.engine_mechanics?.roll_spin_move as RollSpinMoveConfig | undefined;
    if (!config?.auto_roll) return null;

    const player = ctx.state.players[ctx.playerId];
    if (!player) return null;

    // Clear previous roll state directly
    const extras = getPlayerExtras(player);
    extras.pendingMovement = undefined;
    extras.doublesCount = 0;

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'roll-spin-and-move')) return [];

    const config = ctx.config.engine_mechanics?.roll_spin_move as RollSpinMoveConfig | undefined;
    const player = ctx.state.players[ctx.playerId];
    if (!player) return [];

    if (config?.auto_roll) return [];

    const extras = getPlayerExtras(player);
    const pendingMovement = extras.pendingMovement as number | undefined;
    if (pendingMovement !== undefined && pendingMovement > 0) {
      return [];
    }

    const diceCount = config?.dice_count ?? 2;
    const diceSides = config?.dice_sides ?? 6;

    return [{
      action: {
        type: 'roll',
        diceCount,
        diceSides,
        purpose: 'movement'
      },
      priority: 90,
      category: 'movement'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    if (!isMechanicEnabled(ctx.config, 'roll-spin-and-move')) return null;

    if (action.type === 'roll' && (action as { purpose?: string }).purpose === 'movement') {
      const config = ctx.config.engine_mechanics?.roll_spin_move as RollSpinMoveConfig | undefined;
      const diceCount = config?.dice_count ?? 2;
      const diceSides = config?.dice_sides ?? 6;

      const result = rollDice(state, playerId, {
        diceCount,
        diceSides,
        purpose: 'movement'
      });

      if (result.blocked) {
        return {
          handled: true,
          logData: { blocked: true, reason: result.blockReason }
        };
      }

      const isDoubles = diceCount === 2 && result.results[0] === result.results[1];
      const player = state.players[playerId];

      if (player) {
        const extras = getPlayerExtras(player);
        const currentDoublesCount = (extras.doublesCount as number) ?? 0;

        extras.pendingMovement = result.total;
        player.lastRollResults = result.results;
        player.lastRollTotal = result.total;

        if (isDoubles && config?.doubles_again) {
          extras.doublesCount = currentDoublesCount + 1;

          if (config.doubles_jail && currentDoublesCount + 1 >= 3) {
            player.state = config.jail_state ?? 'Jail';
            extras.pendingMovement = 0;
            extras.doublesCount = 0;

            return {
              handled: true,
              advanceTurn: true,
              logData: {
                results: result.results,
                total: result.total,
                doubles: true,
                tripleDoubles: true,
                goToJail: true
              }
            };
          }
        }
      }

      return {
        handled: true,
        advanceTurn: false,
        logData: {
          results: result.results,
          total: result.total,
          doubles: isDoubles
        }
      };
    }

    if (action.type === 'move') {
      const config = ctx.config.engine_mechanics?.roll_spin_move as RollSpinMoveConfig | undefined;
      if (!config?.linear_track) return null;

      const player = state.players[playerId];
      if (!player) return null;

      const extras = getPlayerExtras(player);
      const pendingMovement = extras.pendingMovement as number | undefined;
      if (pendingMovement === undefined || pendingMovement <= 0) return null;

      const currentIndex = config.linear_track.indexOf(player.state);
      if (currentIndex === -1) return null;

      let newIndex = currentIndex + pendingMovement;

      if (config.loop) {
        newIndex = newIndex % config.linear_track.length;
      } else {
        newIndex = Math.min(newIndex, config.linear_track.length - 1);
      }

      const destination = config.linear_track[newIndex];
      const previousState = player.state;
      player.state = destination;

      extras.pendingMovement = 0;

      const doublesCount = (extras.doublesCount as number) ?? 0;
      const canRollAgain = config.doubles_again && doublesCount > 0;

      return {
        handled: true,
        advanceTurn: !canRollAgain,
        checkWin: true,
        logData: {
          from: previousState,
          to: destination,
          spaces: pendingMovement,
          canRollAgain
        }
      };
    }

    return null;
  },

  onDiceRolled(ctx: HookContext, payload: DiceRolledPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'roll-spin-and-move')) return null;
    if (payload.purpose !== 'movement') return null;

    const player = ctx.state.players[ctx.playerId];
    if (player) {
      const extras = getPlayerExtras(player);
      extras.pendingMovement = payload.total;
      player.lastRollResults = payload.results;
    }

    return null;
  },

  describeAction(action) {
    if (action.type !== 'roll') return null;
    if ((action as { purpose?: string }).purpose !== 'movement') return null;

    return {
      type: 'roll',
      label: 'Roll for Movement',
      description: 'Roll dice to determine how many spaces to move',
      examples: ['{ "type": "roll", "purpose": "movement" }']
    };
  },

  configSchema: {
    type: 'object',
    description: 'Classic board game movement where dice determine spaces moved.'
  }
};
