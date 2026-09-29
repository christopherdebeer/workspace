/**
 * Race Win Condition
 *
 * First player to reach a specified location/state wins.
 * Common in racing games, exploration games.
 *
 * Hooks used:
 * - onCheckWin: Check if player reached the goal
 * - onAfterMove: Trigger win check after movement
 */

import {
  MechanicHooks,
  HookContext,
  WinCheckContext,
  WinCheckResult,
  StateChanges
} from '../types';
import type { BoardHooks, PlayerMovedPayload } from '../core/board-mechanic';

interface RaceWinConfig {
  /** Target state/location to reach */
  goal_state: string;
  /** Alternative goal states (any of these wins) */
  goal_states?: string[];
  /** Number of laps required (for circuit races) */
  laps?: number;
  /** Checkpoints that must be visited in order */
  checkpoints?: string[];
}

export const raceWinMechanic: MechanicHooks & BoardHooks = {
  slug: 'win-race',
  name: 'Race Win Condition',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'First to reach the goal wins',
    properties: {
      goal_state: {
        type: 'string',
        description: 'Target state/location to reach',
        required: true
      },
      goal_states: {
        type: 'array',
        description: 'Alternative goal states (any wins)'
      },
      laps: {
        type: 'number',
        description: 'Laps required for circuit races',
        default: 1
      },
      checkpoints: {
        type: 'array',
        description: 'Checkpoints to visit in order'
      }
    },
    required: ['goal_state']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const raceConfig = ctx.config.engine_mechanics?.win_race as RaceWinConfig | undefined;
    if (!raceConfig) return null;

    // Check both state (board mechanic) and currentNode (point-to-point movement)
    // These can diverge when point-to-point movement updates currentNode directly
    const currentState = (ctx.player as unknown as Record<string, unknown>).currentNode as string
      || ctx.player.state;
    const goalStates = raceConfig.goal_states
      ? [raceConfig.goal_state, ...raceConfig.goal_states]
      : [raceConfig.goal_state];

    // Check if at goal
    if (!goalStates.includes(currentState)) {
      return null;
    }

    // Check checkpoints if configured
    if (raceConfig.checkpoints && raceConfig.checkpoints.length > 0) {
      const visitedCheckpoints = (ctx.player.visitedCheckpoints as string[]) || [];
      const allVisited = raceConfig.checkpoints.every(cp => visitedCheckpoints.includes(cp));
      if (!allVisited) {
        return null; // Haven't visited all checkpoints
      }
    }

    // Check laps if configured
    if (raceConfig.laps && raceConfig.laps > 1) {
      const currentLaps = (ctx.player.lapsCompleted as number) || 0;
      if (currentLaps < raceConfig.laps - 1) {
        return null; // Not enough laps
      }
    }

    return {
      won: true,
      reason: `First to reach ${currentState}!`
    };
  },

  onPlayerMoved(ctx: HookContext, payload: PlayerMovedPayload): StateChanges | null {
    const raceConfig = ctx.config.engine_mechanics?.win_race as RaceWinConfig | undefined;
    if (!raceConfig) return null;

    const player = ctx.state.players[ctx.playerId];
    if (!player) return null;

    const stateChanges: StateChanges = {
      playerStateChanges: {}
    };

    // Track checkpoint visits
    if (raceConfig.checkpoints && raceConfig.checkpoints.includes(payload.toState)) {
      const visited = [...((player.visitedCheckpoints as string[]) || [])];
      if (!visited.includes(payload.toState)) {
        visited.push(payload.toState);
        stateChanges.playerStateChanges![ctx.playerId] = {
          visitedCheckpoints: visited
        };
      }
    }

    // Track lap completion (when returning to start/goal)
    if (raceConfig.laps && raceConfig.laps > 1) {
      const goalStates = raceConfig.goal_states
        ? [raceConfig.goal_state, ...raceConfig.goal_states]
        : [raceConfig.goal_state];

      if (goalStates.includes(payload.toState) && payload.fromState !== payload.toState) {
        const laps = ((player.lapsCompleted as number) || 0) + 1;
        stateChanges.playerStateChanges![ctx.playerId] = {
          ...stateChanges.playerStateChanges![ctx.playerId],
          lapsCompleted: laps
        };
      }
    }

    return Object.keys(stateChanges.playerStateChanges!).length > 0 ? stateChanges : null;
  }
};
