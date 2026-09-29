/**
 * Action Queue Mechanic
 *
 * Players queue multiple actions that execute in sequence.
 * Different from action-programming: actions resolve immediately in FIFO order.
 *
 * Hooks used:
 * - initSharedState: Create action queues per player
 * - getAvailableActions: 'queue_action' and 'process_queue'
 * - onExecuteAction: Queue or process actions
 * - getPlayerView: Show queue contents
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

interface ActionQueueConfig {
  max_queue_size?: number;     // max actions in queue
  auto_process?: boolean;      // process queue automatically at turn end
}

interface QueuedAction {
  actionType: string;
  data: Record<string, unknown>;
  queuedAt: number;
}

interface ActionQueueState {
  queues: Record<string, QueuedAction[]>;  // playerId -> queued actions
}

function getConfig(config: GameConfig): ActionQueueConfig | undefined {
  return config.engine_mechanics?.action_queue as ActionQueueConfig | undefined;
}

function getQueueState(shared: Record<string, unknown>): ActionQueueState | undefined {
  return shared.actionQueues as ActionQueueState | undefined;
}

export const actionQueueMechanic: MechanicHooks = {
  slug: 'action-queue',
  name: 'Action Queue',

  configSchema: {
    type: 'object',
    description: 'Players queue actions for sequential execution',
    properties: {
      max_queue_size: {
        type: 'number',
        description: 'Maximum actions in queue',
        default: 5
      },
      auto_process: {
        type: 'boolean',
        description: 'Auto-process queue at turn end',
        default: false
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const queues: Record<string, QueuedAction[]> = {};
    for (const pid of ctx.playerIds) {
      queues[pid] = [];
    }

    return { actionQueues: { queues } as ActionQueueState };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'action-queue')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const queueState = getQueueState(ctx.state.shared);
    if (!queueState) return [];

    const myQueue = queueState.queues[ctx.playerId] ?? [];
    const maxSize = config.max_queue_size ?? 5;
    const actions: AvailableAction[] = [];

    if (myQueue.length < maxSize) {
      actions.push({
        action: {
          type: 'queue_action',
          actionType: '',
          data: {}
        } as unknown as GameAction,
        priority: 35,
        category: 'action-queue'
      });
    }

    if (myQueue.length > 0) {
      actions.push({
        action: {
          type: 'process_queue'
        } as unknown as GameAction,
        priority: 30,
        category: 'action-queue'
      });
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'queue_action' && ctx.action.type !== 'process_queue') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const queueState = getQueueState(ctx.state.shared);
    if (!queueState) return null;

    if (ctx.action.type === 'queue_action') {
      const queueAction = ctx.action as unknown as { type: 'queue_action'; actionType: string; data: Record<string, unknown> };
      const myQueue = [...(queueState.queues[ctx.playerId] ?? [])];
      const maxSize = config.max_queue_size ?? 5;

      if (myQueue.length >= maxSize) {
        return {
          handled: true,
          logMessage: `Queue is full (${maxSize} max).`,
          advanceTurn: false,
          checkWin: false
        };
      }

      myQueue.push({
        actionType: queueAction.actionType,
        data: queueAction.data ?? {},
        queuedAt: ctx.state.turnNumber
      });

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            actionQueues: {
              queues: { ...queueState.queues, [ctx.playerId]: myQueue }
            }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} queued action: ${queueAction.actionType}`,
        logData: { player: ctx.playerId, actionType: queueAction.actionType, queueSize: myQueue.length }
      };
    }

    // process_queue - execute first action in queue
    const myQueue = [...(queueState.queues[ctx.playerId] ?? [])];
    if (myQueue.length === 0) {
      return {
        handled: true,
        logMessage: 'Queue is empty.',
        advanceTurn: false,
        checkWin: false
      };
    }

    const nextAction = myQueue.shift()!;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          actionQueues: {
            queues: { ...queueState.queues, [ctx.playerId]: myQueue }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} processed queued action: ${nextAction.actionType}`,
      logData: { player: ctx.playerId, processedAction: nextAction.actionType, remaining: myQueue.length }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'action-queue')) return null;

    const queueState = getQueueState(ctx.state.shared);
    if (!queueState) return null;

    return {
      myActionQueue: queueState.queues[ctx.playerId] ?? [],
      queueSize: (queueState.queues[ctx.playerId] ?? []).length
    };
  }
};
