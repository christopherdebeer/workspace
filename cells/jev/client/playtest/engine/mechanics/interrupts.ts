/**
 * Interrupts Mechanic
 *
 * Players can interrupt other players' turns with reactive actions.
 * Think MtG instant speed, Cosmic Encounter flares.
 *
 * Hooks used:
 * - canPlayerActNow: Allow interrupts out of turn
 * - getAvailableActions: 'interrupt' action when window open
 * - onExecuteAction: Handle interrupt
 * - getPlayerView: Show interrupt opportunity
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface InterruptConfig {
  interrupt_cost?: number;
  max_interrupts_per_turn?: number;
}

interface InterruptState {
  interruptWindow: boolean;
  interruptsThisTurn: Record<string, number>; // playerId -> count this turn
  lastAction: { playerId: string; type: string } | null;
}

function getConfig(config: GameConfig): InterruptConfig | undefined {
  return config.engine_mechanics?.interrupts as InterruptConfig | undefined;
}

function getInterruptState(shared: Record<string, unknown>): InterruptState | undefined {
  return shared.interrupts as InterruptState | undefined;
}

export const interruptsMechanic: MechanicHooks = {
  slug: 'interrupts',
  name: 'Interrupts',

  configSchema: {
    type: 'object',
    description: 'Out-of-turn reactive actions',
    properties: {
      interrupt_cost: { type: 'number', default: 0 },
      max_interrupts_per_turn: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const interruptsThisTurn: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      interruptsThisTurn[pid] = 0;
    }

    return {
      interrupts: {
        interruptWindow: false,
        interruptsThisTurn,
        lastAction: null
      } as InterruptState
    };
  },

  canPlayerActNow(ctx: HookContext): boolean | null {
    if (!isMechanicEnabled(ctx.config, 'interrupts')) return null;

    const intState = getInterruptState(ctx.state.shared);
    if (!intState?.interruptWindow) return null;

    const config = getConfig(ctx.config);
    const maxInt = config?.max_interrupts_per_turn ?? 1;
    const used = intState.interruptsThisTurn[ctx.playerId] ?? 0;

    if (used < maxInt && ctx.playerId !== ctx.state.currentPlayer) return true;
    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'interrupts')) return [];

    const intState = getInterruptState(ctx.state.shared);
    if (!intState?.interruptWindow) return [];

    if (ctx.playerId === ctx.state.currentPlayer) return [];

    const config = getConfig(ctx.config);
    const maxInt = config?.max_interrupts_per_turn ?? 1;
    const used = intState.interruptsThisTurn[ctx.playerId] ?? 0;
    if (used >= maxInt) return [];

    return [{
      action: {
        type: 'interrupt',
        response: ''
      } as unknown as GameAction,
      priority: 95,
      category: 'interrupt'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'interrupt') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const intState = getInterruptState(ctx.state.shared);
    if (!intState) return null;

    const cost = config.interrupt_cost ?? 0;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          interrupts: {
            ...intState,
            interruptWindow: false,
            interruptsThisTurn: {
              ...intState.interruptsThisTurn,
              [ctx.playerId]: (intState.interruptsThisTurn[ctx.playerId] ?? 0) + 1
            }
          }
        },
        ...(cost > 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) - cost }
          }
        } : {})
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} interrupted!`,
      logData: { player: ctx.playerId, cost }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'interrupts')) return null;

    const intState = getInterruptState(ctx.state.shared);
    if (!intState) return null;

    const config = getConfig(ctx.config);
    return {
      interruptWindowOpen: intState.interruptWindow,
      interruptsUsed: intState.interruptsThisTurn[ctx.playerId] ?? 0,
      maxInterrupts: config?.max_interrupts_per_turn ?? 1
    };
  }
};
