/**
 * Dice Rolling Mechanic
 *
 * Core dice rolling with modifiers, bonuses, and effects.
 * Enables dice-based games and actions.
 *
 * Hooks used:
 * - getAvailableActions: Expose roll action
 * - onExecuteAction: Handle roll action
 * - onBeforeDiceRoll: Apply modifiers from effects (dice-defined hook)
 * - onDiceRolled: Apply roll results to player state (dice-defined hook)
 *
 * Config options:
 * - dice_count: Default number of dice
 * - dice_sides: Default number of sides (default: 6)
 * - roll_action: Whether to expose a 'roll' action
 * - roll_purposes: What rolls can be used for
 * - modifiers: Static modifiers to apply
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  StateChanges
} from './types';
import type { DiceHooks, BeforeDiceRollPayload, DiceRolledPayload } from './core/dice-mechanic';
import { rollDice } from './core/dice';
import { RollAction, DiceRollingConfig } from '../types/game';

export const diceRollingMechanic: MechanicHooks & DiceHooks = {
  slug: 'dice-rolling',
  name: 'Dice Rolling',
  requires: ['dice'],

  getAvailableActions(ctx): AvailableAction[] {
    const diceConfig = ctx.config.engine_mechanics?.dice_rolling as DiceRollingConfig | undefined;
    if (!diceConfig?.roll_action) return [];

    const actions: AvailableAction[] = [];
    const diceCount = diceConfig.dice_count ?? 1;
    const diceSides = diceConfig.dice_sides ?? 6;

    // Basic roll action
    actions.push({
      action: {
        type: 'roll',
        diceCount,
        diceSides
      },
      priority: 50,
      category: 'dice'
    });

    // Purpose-specific rolls
    if (diceConfig.roll_purposes) {
      for (const purpose of diceConfig.roll_purposes) {
        actions.push({
          action: {
            type: 'roll',
            diceCount,
            diceSides,
            purpose
          },
          priority: 40,
          category: 'dice'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    if (action.type !== 'roll') return null;

    const rollAction = action as RollAction;
    const diceConfig = ctx.config.engine_mechanics?.dice_rolling as DiceRollingConfig | undefined;

    const diceCount = rollAction.diceCount ?? diceConfig?.dice_count ?? 1;
    const diceSides = rollAction.diceSides ?? diceConfig?.dice_sides ?? 6;

    // Perform the roll
    const result = rollDice(state, playerId, {
      diceCount,
      diceSides,
      purpose: rollAction.purpose,
      keepIndices: rollAction.keepIndices
    });

    if (result.blocked) {
      return {
        handled: true,
        logData: {
          blocked: true,
          reason: result.blockReason
        }
      };
    }

    // Track last roll if configured
    if (diceConfig?.track_last_roll) {
      const player = state.players[playerId];
      if (player) {
        player.lastRoll = result;
      }
    }

    return {
      handled: true,
      advanceTurn: false, // Rolling doesn't end turn by default
      checkWin: false,
      logData: {
        diceCount,
        diceSides,
        results: result.results,
        total: result.total,
        finalTotal: result.finalTotal,
        modifier: result.modifier,
        purpose: rollAction.purpose
      }
    };
  },

  onBeforeDiceRoll(ctx: HookContext, payload: BeforeDiceRollPayload): { blocked?: boolean; blockReason?: string; diceCount?: number; diceSides?: number; modifier?: number } | null {
    const diceConfig = ctx.config.engine_mechanics?.dice_rolling as DiceRollingConfig | undefined;
    if (!diceConfig?.modifiers) return null;

    const modifiers = diceConfig.modifiers;
    let totalModifier = 0;

    // Apply flat bonus
    if (modifiers.flat_bonus) {
      totalModifier += modifiers.flat_bonus;
    }

    // Apply per-die bonus
    if (modifiers.per_die_bonus) {
      totalModifier += modifiers.per_die_bonus * payload.diceCount;
    }

    // Apply effect-based modifiers
    if (modifiers.effect_modifiers) {
      if (ctx.player?.effects) {
        for (const effect of ctx.player.effects) {
          const effectMod = modifiers.effect_modifiers[effect.type];
          if (effectMod) {
            totalModifier += effectMod * (effect.value ?? 1);
          }
        }
      }
    }

    if (totalModifier === 0) return null;

    return { modifier: totalModifier };
  },

  onDiceRolled(ctx: HookContext, payload: DiceRolledPayload): StateChanges | null {
    const diceConfig = ctx.config.engine_mechanics?.dice_rolling as DiceRollingConfig | undefined;
    if (!diceConfig) return null;

    // Store roll result in player state for other mechanics to use
    return {
      playerStateChanges: {
        [ctx.playerId]: {
          lastRollResults: payload.results,
          lastRollTotal: payload.total
        }
      }
    };
  },

  describeAction(action) {
    if (action.type !== 'roll') return null;

    const rollAction = action as RollAction;
    const count = rollAction.diceCount ?? 1;
    const sides = rollAction.diceSides ?? 6;
    const notation = `${count}d${sides}`;

    let description = `Roll ${notation}`;
    if (rollAction.purpose) {
      description += ` for ${rollAction.purpose}`;
    }

    return {
      type: 'roll',
      label: `Roll ${notation}`,
      description,
      examples: [`{ "type": "roll" }`, `{ "type": "roll", "diceCount": 2, "diceSides": 6 }`]
    };
  },

  configSchema: {
    type: 'object',
    description: 'Core dice rolling with modifiers and effects.',
    properties: {
      dice_count: {
        type: 'number',
        description: 'Default number of dice to roll',
        default: 1
      },
      dice_sides: {
        type: 'number',
        description: 'Default number of sides per die',
        default: 6
      },
      roll_action: {
        type: 'boolean',
        description: 'Whether to expose a roll action',
        default: true
      },
      roll_purposes: {
        type: 'array',
        description: 'What purposes rolls can be used for'
      },
      modifiers: {
        type: 'object',
        description: 'Static modifiers to apply to rolls'
      },
      track_last_roll: {
        type: 'boolean',
        description: 'Track last roll result in player state',
        default: true
      }
    }
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const count = cfg.dice_count ?? 1;
    const sides = cfg.dice_sides ?? 6;
    return [{ label: 'Dice', value: `${count}d${sides}` }];
  }
};
