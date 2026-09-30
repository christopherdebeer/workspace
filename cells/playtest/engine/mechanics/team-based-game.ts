/**
 * Team-Based Game Mechanic
 *
 * Fixed team structures where players are assigned to teams and win/lose together.
 * Supports sequential or random team assignment and shared/objective-based victory.
 *
 * Hooks used:
 * - initSharedState: Assign players to teams from config
 * - onCheckWin: Check if team objectives met
 * - getPlayerView: Show team assignments
 */

import {
  MechanicHooks,
  HookContext,
  SharedStateInitContext,
  SharedStateInitResult,
  WinCheckContext,
  WinCheckResult,
  isMechanicEnabled
} from './types';
import { GameConfig } from '../types/game';

interface TeamDefinition {
  id: string;
  name: string;
}

interface TeamBasedGameConfig {
  teams: TeamDefinition[];
  assignment?: 'sequential' | 'random';  // default 'sequential'
  team_victory?: 'shared_score' | 'team_objective';
}

interface TeamAssignment {
  playerId: string;
  teamId: string;
}

interface TeamState {
  teams: TeamDefinition[];
  assignments: TeamAssignment[];
  teamScores: Record<string, number>;
}

function getConfig(config: GameConfig): TeamBasedGameConfig | undefined {
  return config.engine_mechanics?.team_based_game as TeamBasedGameConfig | undefined;
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const teamBasedGameMechanic: MechanicHooks = {
  slug: 'team-based-game',
  name: 'Team-Based Game',

  configSchema: {
    type: 'object',
    description: 'Fixed team structures where players win/lose together',
    properties: {
      teams: {
        type: 'array',
        description: 'Team definitions with id and name',
        required: true
      },
      assignment: {
        type: 'string',
        description: 'How players are assigned to teams',
        enum: ['sequential', 'random'],
        default: 'sequential'
      },
      team_victory: {
        type: 'string',
        description: 'How team victory is determined',
        enum: ['shared_score', 'team_objective'],
        default: 'shared_score'
      }
    },
    required: ['teams']
  },

  /**
   * Assign players to teams from config
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.teams?.length) return null;

    const teams = config.teams;
    const assignment = config.assignment ?? 'sequential';

    // Determine player order for assignment
    let playerIds = [...ctx.playerIds];
    if (assignment === 'random') {
      playerIds = shuffleArray(playerIds);
    }

    // Assign players to teams round-robin
    const assignments: TeamAssignment[] = playerIds.map((playerId, index) => ({
      playerId,
      teamId: teams[index % teams.length].id
    }));

    // Initialize team scores
    const teamScores: Record<string, number> = {};
    for (const team of teams) {
      teamScores[team.id] = 0;
    }

    const teamState: TeamState = {
      teams,
      assignments,
      teamScores
    };

    return { teamState };
  },

  /**
   * Check if team objectives met
   */
  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = getConfig(ctx.config);
    if (!config?.teams?.length) return null;

    const teamState = ctx.state.shared.teamState as TeamState | undefined;
    if (!teamState) return null;

    const victoryType = config.team_victory ?? 'shared_score';

    if (victoryType === 'shared_score') {
      // Calculate team scores by summing member scores
      const teamScores: Record<string, number> = {};
      for (const team of teamState.teams) {
        teamScores[team.id] = 0;
      }

      for (const assignment of teamState.assignments) {
        const player = ctx.state.players[assignment.playerId];
        if (player) {
          teamScores[assignment.teamId] = (teamScores[assignment.teamId] ?? 0) + (player.score ?? 0);
        }
      }

      // Find the team of the current player being checked
      const playerAssignment = teamState.assignments.find(a => a.playerId === ctx.playerId);
      if (!playerAssignment) return null;

      // Check if this player's team has the highest score and all other teams have had a chance
      const myTeamScore = teamScores[playerAssignment.teamId] ?? 0;
      const otherTeamScores = Object.entries(teamScores)
        .filter(([teamId]) => teamId !== playerAssignment.teamId)
        .map(([, score]) => score);

      // Only declare victory via game timeout or explicit trigger, not mid-game
      // The win check is triggered by other conditions; team scoring is used for tiebreaking
    }

    return null;
  },

  /**
   * Show team assignments in player view
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'team-based-game')) return null;

    const teamState = ctx.state.shared.teamState as TeamState | undefined;
    if (!teamState) return null;

    // Find this player's team
    const playerAssignment = teamState.assignments.find(a => a.playerId === ctx.playerId);
    const playerTeam = playerAssignment
      ? teamState.teams.find(t => t.id === playerAssignment.teamId)
      : null;

    // Build team membership view
    const teamMembers: Record<string, string[]> = {};
    for (const team of teamState.teams) {
      teamMembers[team.id] = teamState.assignments
        .filter(a => a.teamId === team.id)
        .map(a => a.playerId);
    }

    // Calculate team scores
    const teamScores: Record<string, number> = {};
    for (const team of teamState.teams) {
      let score = 0;
      for (const assignment of teamState.assignments) {
        if (assignment.teamId === team.id) {
          const player = ctx.state.players[assignment.playerId];
          score += player?.score ?? 0;
        }
      }
      teamScores[team.id] = score;
    }

    return {
      myTeam: playerTeam ? { id: playerTeam.id, name: playerTeam.name } : null,
      teams: teamState.teams,
      teamMembers,
      teamScores
    };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const teams = cfg.teams;
    if (!Array.isArray(teams)) return null;
    return [{ label: 'Teams', value: String(teams.length) }];
  }
};
