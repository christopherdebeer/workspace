/**
 * Action Timer Mechanic
 *
 * Actions are limited by real-time or turn-based time constraints.
 * Players have a time budget that decreases; exceeding it forces a pass.
 *
 * Hooks used:
 * - initSharedState: Create timers per player
 * - preValidateAction: Check time remaining
 * - onTurnStart: Update timers
 * - getPlayerView: Show time remaining
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ValidationResult,
  SharedStateInitContext,
  SharedStateInitResult,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';

interface ActionTimerConfig {
  time_per_player?: number;    // total time budget per player (in turns)
  time_per_turn?: number;      // time budget per turn
  overtime_penalty?: number;   // score penalty for running out
}

interface TimerState {
  timeBudgets: Record<string, number>;   // playerId -> remaining time
  turnTimers: Record<string, number>;    // playerId -> turns used this round
}

function getConfig(config: GameConfig): ActionTimerConfig | undefined {
  return config.engine_mechanics?.action_timer as ActionTimerConfig | undefined;
}

function getTimerState(shared: Record<string, unknown>): TimerState | undefined {
  return shared.actionTimers as TimerState | undefined;
}

export const actionTimerMechanic: MechanicHooks = {
  slug: 'action-timer',
  name: 'Action Timer',

  configSchema: {
    type: 'object',
    description: 'Time-limited actions with budgets per player',
    properties: {
      time_per_player: {
        type: 'number',
        description: 'Total time budget per player (in turns)',
        default: 30
      },
      time_per_turn: {
        type: 'number',
        description: 'Max actions per turn',
        default: 3
      },
      overtime_penalty: {
        type: 'number',
        description: 'Score penalty for exceeding time',
        default: 5
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const timeBudgets: Record<string, number> = {};
    const turnTimers: Record<string, number> = {};
    const budget = config.time_per_player ?? 30;

    for (const pid of ctx.playerIds) {
      timeBudgets[pid] = budget;
      turnTimers[pid] = 0;
    }

    return { actionTimers: { timeBudgets, turnTimers } as TimerState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'action-timer')) return null;

    const timerState = getTimerState(ctx.state.shared);
    if (!timerState) return null;

    // Reset turn timer for current player
    const updatedTurnTimers = { ...timerState.turnTimers, [ctx.playerId]: 0 };

    return {
      sharedStateChanges: {
        actionTimers: { ...timerState, turnTimers: updatedTurnTimers }
      }
    };
  },

  preValidateAction(ctx: ActionExecutionContext): ValidationResult | null {
    if (!isMechanicEnabled(ctx.config, 'action-timer')) return null;
    if (ctx.action.type === 'pass') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const timerState = getTimerState(ctx.state.shared);
    if (!timerState) return null;

    const budget = timerState.timeBudgets[ctx.playerId] ?? 0;
    if (budget <= 0) {
      return { valid: false, error: 'Time budget exhausted. You must pass.' };
    }

    const turnUsed = timerState.turnTimers[ctx.playerId] ?? 0;
    const turnLimit = config.time_per_turn ?? 3;
    if (turnUsed >= turnLimit) {
      return { valid: false, error: `Turn time limit reached (${turnLimit} actions).` };
    }

    return { valid: true };
  },

  postExecuteAction(ctx: ActionExecutionContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'action-timer')) return null;
    if (ctx.action.type === 'pass') return null;

    const timerState = getTimerState(ctx.state.shared);
    if (!timerState) return null;

    const updatedBudgets = {
      ...timerState.timeBudgets,
      [ctx.playerId]: (timerState.timeBudgets[ctx.playerId] ?? 0) - 1
    };
    const updatedTurnTimers = {
      ...timerState.turnTimers,
      [ctx.playerId]: (timerState.turnTimers[ctx.playerId] ?? 0) + 1
    };

    return {
      sharedStateChanges: {
        actionTimers: { timeBudgets: updatedBudgets, turnTimers: updatedTurnTimers }
      }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'action-timer')) return null;

    const timerState = getTimerState(ctx.state.shared);
    if (!timerState) return null;

    const config = getConfig(ctx.config);
    return {
      timeBudget: timerState.timeBudgets[ctx.playerId] ?? 0,
      turnActionsUsed: timerState.turnTimers[ctx.playerId] ?? 0,
      turnActionLimit: config?.time_per_turn ?? 3
    };
  }
};
