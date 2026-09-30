/**
 * Push Your Luck Mechanic
 *
 * Risk/reward dice rolling with banking.
 *
 * Hooks used:
 * - preValidateAction: Validate roll and bank actions
 * - onExecuteAction: Handle roll and bank execution
 * - getAvailableActions: Expose roll and bank actions
 * - describeAction: Describe roll and bank actions
 * - getPlayerView: Contribute rollAccumulator and rollCount to player view
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  StateChanges,
  PlayerInitContext,
  PlayerInitResult,
  ActionSchema,
  isMechanicEnabled
} from './types';
import { GameAction } from '../types/game';
import type { CardsHooks, CardsAddedToHandPayload } from './core/cards';

interface PushYourLuckConfig {
  max_rolls?: number;
  dice_sides: number;
  bust_threshold: number;
  points_per_success: number;
}

export const pushYourLuckMechanic: MechanicHooks & CardsHooks = {
  slug: 'push-your-luck',
  name: 'Push Your Luck',
  requires: ['cards'],

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type === 'roll') {
      return {
        optional: ['diceSides', 'purpose'],
        fields: {
          diceSides: { type: 'number' },
          purpose: { type: 'string' },
        },
      };
    }
    if (action.type === 'bank') {
      return {};
    }
    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Risk/reward dice rolling with banking',
    properties: {
      dice_sides: {
        type: 'number',
        description: 'Number of sides on the dice',
        required: true
      },
      bust_threshold: {
        type: 'number',
        description: 'Roll at or below this value to bust',
        required: true
      },
      points_per_success: {
        type: 'number',
        description: 'Points awarded per successful roll',
        required: true
      },
      max_rolls: {
        type: 'number',
        description: 'Maximum rolls per turn (optional)'
      }
    },
    required: ['dice_sides', 'bust_threshold', 'points_per_success']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    if (!isMechanicEnabled(ctx.config, 'push-your-luck')) return null;
    return { rollAccumulator: 0, rollCount: 0 };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'roll' && action.type !== 'bank') return null;

    const pylConfig = ctx.config.engine_mechanics?.push_your_luck as PushYourLuckConfig | undefined;
    if (!pylConfig) {
      return { valid: false, error: 'Push your luck is not enabled for this game.' };
    }

    if (action.type === 'bank') {
      const accumulated = ctx.player.rollAccumulator ?? 0;
      if (accumulated === 0) {
        return { valid: false, error: 'No accumulated points to bank. Roll first!' };
      }
    }

    if (action.type === 'roll') {
      const rollCount = ctx.player.rollCount ?? 0;
      if (pylConfig.max_rolls && rollCount >= pylConfig.max_rolls) {
        return { valid: false, error: `Maximum rolls (${pylConfig.max_rolls}) reached. You must bank.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'roll' && action.type !== 'bank') return null;

    const pylConfig = ctx.config.engine_mechanics?.push_your_luck as PushYourLuckConfig | undefined;
    if (!pylConfig) return null;

    if (action.type === 'roll') {
      // Roll the dice
      const rollValue = Math.floor(Math.random() * pylConfig.dice_sides) + 1;
      const isBust = rollValue <= pylConfig.bust_threshold;

      const newRollCount = (player.rollCount ?? 0) + 1;

      if (isBust) {
        // Bust! Lose all accumulated points and end push-your-luck sequence
        const lostPoints = player.rollAccumulator ?? 0;

        return {
          handled: true,
          stateChanges: {
            playerStateChanges: {
              [playerId]: {
                rollAccumulator: 0,
                rollCount: 0
              }
            }
          },
          advanceTurn: true, // Bust ends the turn (AP fix ensures multi-action still works with AP)
          checkWin: false,
          logMessage: 'push_your_luck_bust',
          logData: { roll: rollValue, lostPoints }
        };
      } else {
        // Success! Add points to accumulator
        const newAccumulated = (player.rollAccumulator ?? 0) + pylConfig.points_per_success;

        return {
          handled: true,
          stateChanges: {
            playerStateChanges: {
              [playerId]: {
                rollAccumulator: newAccumulated,
                rollCount: newRollCount
              }
            }
          },
          advanceTurn: false, // Player can roll again or bank
          checkWin: false,
          logMessage: 'push_your_luck_roll',
          logData: { roll: rollValue, points: pylConfig.points_per_success, accumulated: newAccumulated }
        };
      }
    }

    if (action.type === 'bank') {
      const bankedPoints = player.rollAccumulator ?? 0;
      const newScore = (player.score ?? 0) + bankedPoints;

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [playerId]: {
              score: newScore,
              rollAccumulator: 0,
              rollCount: 0
            }
          }
        },
        advanceTurn: true, // Banking ends the turn (AP fix ensures multi-action still works with AP)
        checkWin: true, // Check win after banking
        logMessage: 'push_your_luck_bank',
        logData: { bankedPoints, totalScore: newScore }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const pylConfig = ctx.config.engine_mechanics?.push_your_luck as PushYourLuckConfig | undefined;
    if (!pylConfig) return [];

    const actions: AvailableAction[] = [];
    const accumulated = ctx.player.rollAccumulator ?? 0;
    const rollCount = ctx.player.rollCount ?? 0;
    const canRoll = !pylConfig.max_rolls || rollCount < pylConfig.max_rolls;
    const canBank = accumulated > 0;

    if (canRoll) {
      // Include bust threshold, max rolls, accumulated points info via RollAction fields
      // purpose carries the decision-relevant info for the AI agent
      const maxRollsInfo = pylConfig.max_rolls ? `, max ${pylConfig.max_rolls} rolls` : '';
      actions.push({
        action: {
          type: 'roll',
          diceSides: pylConfig.dice_sides,
          purpose: `bust on ${pylConfig.bust_threshold} or less, gain ${pylConfig.points_per_success} pts on success${maxRollsInfo}, ${accumulated} pts accumulated, roll #${(rollCount as number) + 1}`
        } as GameAction,
        priority: 50,
        category: 'push-your-luck'
      });
    }

    if (canBank) {
      actions.push({
        action: { type: 'bank' } as GameAction,
        priority: 49,
        category: 'push-your-luck'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'roll') {
      return {
        type: 'roll',
        label: 'Roll Dice',
        description: 'Roll the dice to accumulate points. Risk busting and losing accumulated points.',
        examples: ['roll']
      };
    }

    if (action.type === 'bank') {
      return {
        type: 'bank',
        label: 'Bank Points',
        description: 'Bank your accumulated points to add them to your score safely.',
        examples: ['bank']
      };
    }

    return null;
  },

  /**
   * Contribute push-your-luck state to player view.
   * This removes the need for game.ts to know about rollAccumulator/rollCount.
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'push-your-luck')) return null;

    return {
      rollAccumulator: ctx.player.rollAccumulator ?? 0,
      rollCount: ctx.player.rollCount ?? 0
    };
  },

  /**
   * Cards-defined hook: Apply point effects when cards are added to hand (e.g., drafted cards).
   * Cards with effect.type: "points" have their value added to player score.
   * Fired by hand.ts via mechanicRegistry.fire('cards', 'onAfterAddToHand', ...).
   */
  onAfterAddToHand(ctx: HookContext, payload: CardsAddedToHandPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'push-your-luck')) return null;

    let totalPoints = 0;
    for (const card of payload.cards) {
      if (card.effect?.type === 'points' && typeof card.effect.value === 'number') {
        totalPoints += card.effect.value;
      }
    }

    if (totalPoints === 0) return null;

    const currentScore = (ctx.player?.score as number) ?? 0;

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          score: currentScore + totalPoints
        }
      }
    };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const maxRolls = cfg.max_rolls;
    if (typeof maxRolls !== 'number') return null;
    return [{ label: 'Max rolls', value: String(maxRolls) }];
  }
};
