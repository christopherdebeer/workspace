/**
 * Re-Rolling and Locking Mechanic (Phase 2)
 *
 * Yahtzee-style dice mechanics: roll, keep some dice, re-roll others.
 * Players can lock (keep) dice they want to preserve and re-roll the rest.
 *
 * BGG Reference: Re-rolling and Locking (2010)
 * https://boardgamegeek.com/boardgamemechanic/2850/re-rolling-and-locking
 *
 * Config options:
 * - rerolling.max_rerolls: Maximum re-rolls per turn (default: 2)
 * - rerolling.dice_count: Number of dice to roll
 * - rerolling.dice_sides: Sides per die (default: 6)
 * - rerolling.auto_lock_on_max: Auto-lock all dice when max re-rolls reached
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { RollAction
} from '../types/game';
import { rollDice } from './core/dice';

export const rerollingAndLockingMechanic: MechanicHooks = {
  slug: 're-rolling-and-locking',
  name: 'Re-Rolling and Locking',
  requires: ['dice'],

  /**
   * Reset re-roll count at turn start
   */
  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 're-rolling-and-locking')) {
      return null;
    }

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          rerollsUsed: 0,
          lastRollResults: undefined,
          lastRollTotal: undefined
        }
      },
      sharedStateChanges: {
        lockedDice: undefined,
        currentRollResults: undefined
      }
    };
  },

  /**
   * Provide roll and reroll actions
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 're-rolling-and-locking')) {
      return [];
    }

    const rerollConfig = ctx.config.engine_mechanics?.rerolling;
    if (!rerollConfig) return [];

    const actions: AvailableAction[] = [];
    const diceCount = rerollConfig.dice_count ?? 5;
    const diceSides = rerollConfig.dice_sides ?? 6;
    const maxRerolls = rerollConfig.max_rerolls ?? 2;
    const rerollsUsed = ctx.player.rerollsUsed ?? 0;

    // Get current roll state
    const currentResults = ctx.state.shared.currentRollResults as number[] | undefined;
    const lockedDice = ctx.state.shared.lockedDice as number[] | undefined;

    // If no roll yet, offer initial roll
    if (!currentResults) {
      actions.push({
        action: {
          type: 'roll',
          diceCount,
          diceSides,
          purpose: 'initial'
        },
        priority: 100,
        category: 'dice'
      });
      return actions;
    }

    // If can still re-roll, offer re-roll action with keep options
    if (rerollsUsed < maxRerolls) {
      // Offer re-roll with various keep combinations
      // Basic: re-roll all unlocked dice
      const unlockedIndices = currentResults
        .map((_, i) => i)
        .filter(i => !lockedDice?.includes(i));

      if (unlockedIndices.length > 0) {
        // Keep all currently locked dice
        actions.push({
          action: {
            type: 'roll',
            diceCount,
            diceSides,
            purpose: 'reroll',
            keepIndices: lockedDice ?? []
          },
          priority: 90,
          category: 'dice'
        });
      }

      // Offer lock action for each unlocked die
      for (const idx of unlockedIndices) {
        actions.push({
          action: {
            type: 'lock_dice' as any,
            diceIndex: idx,
            value: currentResults[idx]
          },
          priority: 80,
          category: 'dice'
        });
      }

      // Offer unlock action for each locked die
      if (lockedDice) {
        for (const idx of lockedDice) {
          actions.push({
            action: {
              type: 'unlock_dice' as any,
              diceIndex: idx,
              value: currentResults[idx]
            },
            priority: 70,
            category: 'dice'
          });
        }
      }
    }

    // Always offer bank/score action after rolling
    actions.push({
      action: {
        type: 'bank',
        reasoning: 'Keep current dice and end rolling'
      },
      priority: 60,
      category: 'dice'
    });

    return actions;
  },

  /**
   * Handle roll, lock, unlock, and bank actions
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (!isMechanicEnabled(ctx.config, 're-rolling-and-locking')) {
      return null;
    }

    const { action, playerId, state } = ctx;
    const rerollConfig = ctx.config.engine_mechanics?.rerolling;
    if (!rerollConfig) return null;

    // Handle lock_dice action
    if (action.type === 'lock_dice') {
      const lockAction = action as any;
      const lockedDice = (state.shared.lockedDice as number[] | undefined) ?? [];

      if (!lockedDice.includes(lockAction.diceIndex)) {
        lockedDice.push(lockAction.diceIndex);
        state.shared.lockedDice = lockedDice;
      }

      return {
        handled: true,
        advanceTurn: false,
        logMessage: `${playerId} locked die ${lockAction.diceIndex + 1} (${lockAction.value})`,
        logData: { diceIndex: lockAction.diceIndex, value: lockAction.value }
      };
    }

    // Handle unlock_dice action
    if (action.type === 'unlock_dice') {
      const unlockAction = action as any;
      const lockedDice = (state.shared.lockedDice as number[] | undefined) ?? [];

      const idx = lockedDice.indexOf(unlockAction.diceIndex);
      if (idx >= 0) {
        lockedDice.splice(idx, 1);
        state.shared.lockedDice = lockedDice;
      }

      return {
        handled: true,
        advanceTurn: false,
        logMessage: `${playerId} unlocked die ${unlockAction.diceIndex + 1}`,
        logData: { diceIndex: unlockAction.diceIndex }
      };
    }

    // Handle roll action
    if (action.type === 'roll') {
      const rollAction = action as RollAction;
      const diceCount = rerollConfig.dice_count ?? 5;
      const diceSides = rerollConfig.dice_sides ?? 6;
      const maxRerolls = rerollConfig.max_rerolls ?? 2;
      const player = state.players[playerId];
      const rerollsUsed = player?.rerollsUsed ?? 0;

      const currentResults = state.shared.currentRollResults as number[] | undefined;
      const isReroll = currentResults !== undefined;

      // Check re-roll limit
      if (isReroll && rerollsUsed >= maxRerolls) {
        return {
          handled: true,
          logMessage: `Cannot re-roll: max re-rolls (${maxRerolls}) reached`,
          logData: { error: 'max_rerolls_reached' }
        };
      }

      // Get locked dice
      const lockedDice = (state.shared.lockedDice as number[] | undefined) ?? [];
      const keepIndices = rollAction.keepIndices ?? lockedDice;

      // Perform roll
      let results: number[];
      if (isReroll && keepIndices.length > 0) {
        // Keep specified dice, re-roll the rest
        results = [...currentResults!];
        for (let i = 0; i < diceCount; i++) {
          if (!keepIndices.includes(i)) {
            results[i] = Math.floor(Math.random() * diceSides) + 1;
          }
        }
      } else {
        // Fresh roll
        results = [];
        for (let i = 0; i < diceCount; i++) {
          results.push(Math.floor(Math.random() * diceSides) + 1);
        }
      }

      const total = results.reduce((a, b) => a + b, 0);

      // Update state
      state.shared.currentRollResults = results;
      if (player) {
        player.lastRollResults = results;
        player.lastRollTotal = total;
        if (isReroll) {
          player.rerollsUsed = rerollsUsed + 1;
        }
      }

      // Clear locked dice on fresh roll
      if (!isReroll) {
        state.shared.lockedDice = [];
      }

      const rollType = isReroll ? 're-roll' : 'initial roll';
      const rerollsRemaining = maxRerolls - (isReroll ? rerollsUsed + 1 : 0);

      return {
        handled: true,
        advanceTurn: false,
        logMessage: `${playerId} ${rollType}: [${results.join(', ')}] = ${total} (${rerollsRemaining} re-rolls remaining)`,
        logData: {
          results,
          total,
          isReroll,
          rerollsUsed: isReroll ? rerollsUsed + 1 : 0,
          rerollsRemaining,
          keptDice: keepIndices
        }
      };
    }

    // Handle bank action (end rolling phase)
    if (action.type === 'bank') {
      const currentResults = state.shared.currentRollResults as number[] | undefined;
      if (!currentResults) {
        return {
          handled: true,
          logMessage: 'No dice to bank - must roll first',
          logData: { error: 'no_roll' }
        };
      }

      const total = currentResults.reduce((a, b) => a + b, 0);

      // Clear roll state
      state.shared.currentRollResults = undefined;
      state.shared.lockedDice = undefined;

      return {
        handled: true,
        advanceTurn: true,
        checkWin: true,
        logMessage: `${playerId} banked dice: [${currentResults.join(', ')}] = ${total}`,
        logData: {
          results: currentResults,
          total,
          banked: true
        }
      };
    }

    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Yahtzee-style dice: roll, keep some, re-roll others.',
    properties: {
      dice_count: {
        type: 'number',
        description: 'Number of dice to roll',
        default: 5
      },
      dice_sides: {
        type: 'number',
        description: 'Number of sides per die',
        default: 6
      },
      max_rerolls: {
        type: 'number',
        description: 'Maximum re-rolls per turn',
        default: 2
      },
      auto_lock_on_max: {
        type: 'boolean',
        description: 'Automatically lock all dice when max re-rolls reached',
        default: false
      }
    }
  }
};
