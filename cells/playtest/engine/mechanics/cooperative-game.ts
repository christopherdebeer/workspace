/**
 * Cooperative Game Mechanic
 *
 * All players work together against the game system. Win/lose as a team.
 * Supports threat escalation, shared objectives, and game-controlled opposition.
 * Examples: Pandemic, Spirit Island, Forbidden Island
 *
 * Hooks used:
 * - initSharedState: Set up threat level, shared objectives, game timer
 * - onTurnStart: Escalate threat, trigger game events
 * - onCheckWin: Check team win (all objectives met) or team loss (threat maxed)
 * - getPlayerView: Show team status
 */

import {
  MechanicHooks,
  HookContext,
  TurnStartContext,
  StateChanges,
  WinCheckContext,
  WinCheckResult,
  SharedStateInitContext,
  SharedStateInitResult,
} from './types';

interface SharedObjective {
  id: string;
  name: string;
  description?: string;
  target: number;
  progress_resource?: string;  // Track progress via this shared resource
}

interface CooperativeGameConfig {
  threat_name?: string;         // Name of threat tracker (default 'threat')
  max_threat?: number;          // Game over threshold (default 10)
  threat_per_round?: number;    // Threat increase per round (default 1)
  objectives?: SharedObjective[];
  objectives_required?: number; // How many objectives needed to win (default: all)
  team_loss_message?: string;
}

interface CoopState {
  threatLevel: number;
  objectiveProgress: Record<string, number>;
  completedObjectives: string[];
  roundsElapsed: number;
}

export const cooperativeGameMechanic: MechanicHooks = {
  slug: 'cooperative-game',
  name: 'Cooperative Game',

  configSchema: {
    type: 'object',
    description: 'All players cooperate against the game system',
    properties: {
      threat_name: { type: 'string', default: 'threat' },
      max_threat: { type: 'number', default: 10 },
      threat_per_round: { type: 'number', default: 1 },
      objectives: { type: 'array', description: 'Shared objectives to complete' },
      objectives_required: { type: 'number', description: 'How many needed to win' },
    },
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = ctx.config.engine_mechanics?.cooperative_game as CooperativeGameConfig | undefined;
    if (!config) return {};

    const objectiveProgress: Record<string, number> = {};
    if (config.objectives) {
      for (const obj of config.objectives) {
        objectiveProgress[obj.id] = 0;
      }
    }

    return {
      coopState: {
        threatLevel: 0,
        objectiveProgress,
        completedObjectives: [],
        roundsElapsed: 0,
      } as CoopState,
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const config = ctx.config.engine_mechanics?.cooperative_game as CooperativeGameConfig | undefined;
    if (!config) return null;

    // Only escalate at round start
    if (!ctx.isNewRound) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const coopState = { ...(shared.coopState as CoopState) };
    const threatIncrease = config.threat_per_round ?? 1;

    coopState.threatLevel += threatIncrease;
    coopState.roundsElapsed += 1;

    // Check objective progress from shared resources
    if (config.objectives) {
      const objectiveProgress = { ...coopState.objectiveProgress };
      const completed = [...coopState.completedObjectives];

      for (const obj of config.objectives) {
        if (completed.includes(obj.id)) continue;
        if (obj.progress_resource) {
          const sharedResources = (shared.resources as Record<string, number>) || {};
          objectiveProgress[obj.id] = sharedResources[obj.progress_resource] || 0;
        }
        if (objectiveProgress[obj.id] >= obj.target && !completed.includes(obj.id)) {
          completed.push(obj.id);
        }
      }

      coopState.objectiveProgress = objectiveProgress;
      coopState.completedObjectives = completed;
    }

    return { sharedStateChanges: { coopState } };
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = ctx.config.engine_mechanics?.cooperative_game as CooperativeGameConfig | undefined;
    if (!config) return null;

    const shared = ctx.state.shared as Record<string, unknown>;
    const coopState = shared.coopState as CoopState | undefined;
    if (!coopState) return null;

    // Check team loss - threat maxed out
    const maxThreat = config.max_threat ?? 10;
    if (coopState.threatLevel >= maxThreat) {
      // In cooperative games, everyone loses together
      return {
        won: false,
        reason: config.team_loss_message || `${config.threat_name || 'Threat'} reached ${maxThreat} - team loses!`,
      };
    }

    // Check team win - objectives completed
    if (config.objectives && config.objectives.length > 0) {
      const required = config.objectives_required ?? config.objectives.length;
      if (coopState.completedObjectives.length >= required) {
        return {
          won: true,
          reason: `Team completed ${coopState.completedObjectives.length} objectives - team wins!`,
        };
      }
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> {
    const config = ctx.config.engine_mechanics?.cooperative_game as CooperativeGameConfig | undefined;
    if (!config) return {};

    const shared = ctx.state.shared as Record<string, unknown>;
    const coopState = shared.coopState as CoopState | undefined;
    if (!coopState) return {};

    return {
      threatLevel: coopState.threatLevel,
      maxThreat: config.max_threat ?? 10,
      objectiveProgress: coopState.objectiveProgress,
      completedObjectives: coopState.completedObjectives,
      roundsElapsed: coopState.roundsElapsed,
    };
  },

  getHighlight(_config: unknown): { label: string; value: string }[] | null {
    return [{ label: 'Mode', value: 'Co-op' }];
  },
};
