/**
 * Cooperative Actions Mechanic
 *
 * Enables cooperative play where players work together toward shared goals.
 * Provides shared resource pool, threat tracking, and cooperative victory/loss.
 *
 * Config:
 *   cooperative:
 *     shared_pool: Record<string, number>  # Initial shared resources
 *     threat_level: number                 # Starting threat
 *     threat_per_round: number             # Threat increase per round
 *     max_threat: number                   # Threat level that causes loss
 *     cooperative_actions: string[]         # Action types that help the group
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, SharedStateInitContext, SharedStateInitResult, TurnStartContext, WinCheckContext, WinCheckResult } from './types';
import { GameAction, GameConfig } from '../types/game';

interface CooperativeConfig {
  shared_pool?: Record<string, number>;
  threat_level?: number;
  threat_per_round?: number;
  max_threat?: number;
  cooperative_actions?: string[];
  loss_message?: string;
}

interface CooperativeState {
  sharedPool: Record<string, number>;
  threatLevel: number;
  cooperativeActions: number;
  roundsCompleted: number;
}

function getConfig(config: GameConfig): CooperativeConfig | undefined {
  return config.engine_mechanics?.cooperative_actions as CooperativeConfig | undefined;
}

export const cooperativeActionsMechanic: MechanicHooks = {
  slug: 'cooperative-actions',
  name: 'Cooperative Actions',

  configSchema: {
    type: 'object',
    description: 'Cooperative play with shared resources and threat tracking',
    properties: {
      shared_pool: {
        type: 'object',
        description: 'Initial shared resource pool'
      },
      threat_level: {
        type: 'number',
        description: 'Starting threat level',
        default: 0
      },
      threat_per_round: {
        type: 'number',
        description: 'Threat increase per round',
        default: 1
      },
      max_threat: {
        type: 'number',
        description: 'Threat level causing group loss',
        default: 10
      },
      cooperative_actions: {
        type: 'array',
        description: 'Action types that reduce threat'
      },
      loss_message: {
        type: 'string',
        description: 'Message when cooperative game is lost'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const coopState: CooperativeState = {
      sharedPool: config.shared_pool ? { ...config.shared_pool } : {},
      threatLevel: config.threat_level ?? 0,
      cooperativeActions: 0,
      roundsCompleted: 0
    };

    return { cooperative: coopState };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    if (!ctx.isNewRound) return null;

    const coopState = { ...(ctx.state.shared.cooperative as CooperativeState) };
    const threatPerRound = config.threat_per_round ?? 1;

    // Increase threat at round start
    coopState.threatLevel += threatPerRound;
    coopState.roundsCompleted++;

    return {
      sharedStateChanges: { cooperative: coopState }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'contribute' && action.type !== 'use_shared') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Cooperative actions not enabled.' };

    const coopState = ctx.state.shared.cooperative as CooperativeState | undefined;
    if (!coopState) return { valid: false, error: 'Cooperative state not initialized.' };

    if (action.type === 'contribute') {
      const contributeAction = action as unknown as { type: 'contribute'; resource: string; amount: number };
      if (!contributeAction.resource || !contributeAction.amount) {
        return { valid: false, error: 'Must specify resource and amount.' };
      }

      const resources = (ctx.player.resources as Record<string, number>) ?? {};
      const available = resources[contributeAction.resource] ?? 0;
      if (available < contributeAction.amount) {
        return { valid: false, error: `Not enough ${contributeAction.resource}. Have ${available}, need ${contributeAction.amount}.` };
      }
    }

    if (action.type === 'use_shared') {
      const useAction = action as unknown as { type: 'use_shared'; resource: string; amount: number };
      if (!useAction.resource || !useAction.amount) {
        return { valid: false, error: 'Must specify resource and amount.' };
      }

      const available = coopState.sharedPool[useAction.resource] ?? 0;
      if (available < useAction.amount) {
        return { valid: false, error: `Not enough ${useAction.resource} in shared pool. Pool has ${available}, need ${useAction.amount}.` };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'contribute' && ctx.action.type !== 'use_shared') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const coopState = { ...(ctx.state.shared.cooperative as CooperativeState) };
    const pool = { ...coopState.sharedPool };

    if (ctx.action.type === 'contribute') {
      const contributeAction = ctx.action as unknown as { type: 'contribute'; resource: string; amount: number };
      const resources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) ?? {}) };

      // Transfer from player to shared pool
      resources[contributeAction.resource] = (resources[contributeAction.resource] ?? 0) - contributeAction.amount;
      pool[contributeAction.resource] = (pool[contributeAction.resource] ?? 0) + contributeAction.amount;
      coopState.sharedPool = pool;
      coopState.cooperativeActions++;

      // Contributing reduces threat slightly
      const threatReduction = contributeAction.amount / 2;
      coopState.threatLevel = Math.max(0, coopState.threatLevel - threatReduction);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { cooperative: coopState },
          playerStateChanges: {
            [ctx.playerId]: { resources }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} contributed ${contributeAction.amount} ${contributeAction.resource} to shared pool.`
      };
    }

    if (ctx.action.type === 'use_shared') {
      const useAction = ctx.action as unknown as { type: 'use_shared'; resource: string; amount: number };
      const resources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) ?? {}) };

      // Transfer from shared pool to player
      pool[useAction.resource] = (pool[useAction.resource] ?? 0) - useAction.amount;
      resources[useAction.resource] = (resources[useAction.resource] ?? 0) + useAction.amount;
      coopState.sharedPool = pool;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { cooperative: coopState },
          playerStateChanges: {
            [ctx.playerId]: { resources }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: `${ctx.playerId} took ${useAction.amount} ${useAction.resource} from shared pool.`
      };
    }

    return null;
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const coopState = ctx.state.shared.cooperative as CooperativeState | undefined;
    if (!coopState) return null;

    const maxThreat = config.max_threat ?? 10;

    // Cooperative loss - all players lose when threat is too high
    if (coopState.threatLevel >= maxThreat) {
      return {
        won: false,
        reason: config.loss_message ?? `Threat level reached ${maxThreat}. The team has lost!`
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const coopState = ctx.state.shared.cooperative as CooperativeState | undefined;
    if (!coopState) return [];

    const actions: AvailableAction[] = [];
    const resources = (ctx.player.resources as Record<string, number>) ?? {};

    // Contribute action (if player has resources)
    const hasResources = Object.values(resources).some(v => v > 0);
    if (hasResources) {
      actions.push({
        action: {
          type: 'contribute',
          resource: '',
          amount: 0
        } as unknown as GameAction,
        priority: 70,
        category: 'cooperative'
      });
    }

    // Use shared pool (if pool has resources)
    const poolHasResources = Object.values(coopState.sharedPool).some(v => v > 0);
    if (poolHasResources) {
      actions.push({
        action: {
          type: 'use_shared',
          resource: '',
          amount: 0
        } as unknown as GameAction,
        priority: 65,
        category: 'cooperative'
      });
    }

    return actions;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const coopState = ctx.state.shared.cooperative as CooperativeState | undefined;
    if (!coopState) return null;

    return {
      sharedPool: coopState.sharedPool,
      threatLevel: coopState.threatLevel,
      maxThreat: config.max_threat ?? 10,
      cooperativeActions: coopState.cooperativeActions
    };
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'contribute') {
      return {
        type: 'contribute',
        label: 'Contribute to Shared Pool',
        description: 'Donate resources from your personal supply to the team pool.',
        examples: ['contribute resource:"gold" amount:3']
      };
    }
    if (action.type === 'use_shared') {
      return {
        type: 'use_shared',
        label: 'Use Shared Resource',
        description: 'Take resources from the shared pool for personal use.',
        examples: ['use_shared resource:"gold" amount:2']
      };
    }
    return null;
  }
};
