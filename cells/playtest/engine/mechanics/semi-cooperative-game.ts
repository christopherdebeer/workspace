/**
 * Semi-Cooperative Game Mechanic
 *
 * Players share a collective goal but also have individual victory conditions.
 * If the collective goal fails, everyone loses. If it succeeds, individual scoring determines the winner.
 *
 * Hooks used:
 * - initSharedState: Track collective progress
 * - getAvailableActions: 'contribute' action to advance collective goal
 * - onExecuteAction: Handle contributions
 * - getPlayerView: Show collective progress
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  WinCheckContext,
  WinCheckResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface SemiCoopConfig {
  collective_goal?: number;       // target value for collective success
  failure_threshold?: number;     // if collective drops below this, all lose
  contribution_cost?: number;     // cost per contribution
}

interface SemiCoopState {
  collectiveProgress: number;
  contributions: Record<string, number>;  // playerId -> total contributed
  collectiveFailed: boolean;
}

function getConfig(config: GameConfig): SemiCoopConfig | undefined {
  return config.engine_mechanics?.semi_cooperative_game as SemiCoopConfig | undefined;
}

function getCoopState(shared: Record<string, unknown>): SemiCoopState | undefined {
  return shared.semiCooperative as SemiCoopState | undefined;
}

export const semiCooperativeGameMechanic: MechanicHooks = {
  slug: 'semi-cooperative-game',
  name: 'Semi-Cooperative Game',
  requires: ['social'],

  configSchema: {
    type: 'object',
    description: 'Players share collective goal but compete individually',
    properties: {
      collective_goal: {
        type: 'number',
        description: 'Target for collective success',
        default: 20
      },
      failure_threshold: {
        type: 'number',
        description: 'Below this value, all players lose',
        default: 0
      },
      contribution_cost: {
        type: 'number',
        description: 'Score cost per contribution',
        default: 1
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const contributions: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      contributions[pid] = 0;
    }

    // Initialize treasury with starting amount from config, default 20
    const initialProgress = (config as Record<string, unknown>).initial_progress as number
      ?? (config as Record<string, unknown>).starting_amount as number
      ?? 20;

    return {
      semiCooperative: {
        collectiveProgress: initialProgress,
        contributions,
        collectiveFailed: false
      } as SemiCoopState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'semi-cooperative-game')) return [];

    const coopState = getCoopState(ctx.state.shared);
    if (!coopState || coopState.collectiveFailed) return [];

    const config = getConfig(ctx.config);
    const goal = config?.collective_goal ?? 20;
    if (coopState.collectiveProgress >= goal) return [];

    return [{
      action: {
        type: 'contribute',
        amount: 1
      } as unknown as GameAction,
      priority: 40,
      category: 'cooperative'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'contribute') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const coopState = getCoopState(ctx.state.shared);
    if (!coopState) return null;

    const contributeAction = ctx.action as unknown as { type: 'contribute'; amount: number };
    const amount = contributeAction.amount ?? 1;
    const cost = (config.contribution_cost ?? 1) * amount;

    const newProgress = coopState.collectiveProgress + amount;
    const updatedContributions = {
      ...coopState.contributions,
      [ctx.playerId]: (coopState.contributions[ctx.playerId] ?? 0) + amount
    };

    const goal = config.collective_goal ?? 20;
    const goalReached = newProgress >= goal;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          semiCooperative: {
            ...coopState,
            collectiveProgress: newProgress,
            contributions: updatedContributions
          }
        },
        playerStateChanges: {
          [ctx.playerId]: {
            score: (ctx.player.score ?? 0) - cost
          }
        }
      },
      advanceTurn: false,
      checkWin: goalReached,
      logMessage: goalReached
        ? `Collective goal reached! (${newProgress}/${goal})`
        : `${ctx.playerId} contributed ${amount} to collective goal (${newProgress}/${goal}).`,
      logData: { player: ctx.playerId, amount, progress: newProgress, goal }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'semi-cooperative-game')) return null;

    const coopState = getCoopState(ctx.state.shared);
    if (!coopState) return null;

    const config = getConfig(ctx.config);
    return {
      collectiveProgress: coopState.collectiveProgress,
      collectiveGoal: config?.collective_goal ?? 20,
      myContributions: coopState.contributions[ctx.playerId] ?? 0,
      collectiveFailed: coopState.collectiveFailed
    };
  }
};
