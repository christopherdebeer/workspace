/**
 * Timeout Winner Mechanic
 *
 * Determines winner when game times out (max_rounds reached).
 * This mechanic responds to the 'timeout' trigger.
 *
 * Config (engine_mechanics.win_timeout):
 * ```yaml
 * engine_mechanics:
 *   win_timeout:
 *     type: highest_score  # Default
 * ```
 *
 * Or with role-based winner:
 * ```yaml
 * engine_mechanics:
 *   win_timeout:
 *     type: role
 *     role: "traitor"           # Match by objective.type
 *     role_name: "The Enemy"    # Or match by objective.name
 *     reveal_role: true
 * ```
 *
 * Or with specific player condition:
 * ```yaml
 * engine_mechanics:
 *   win_timeout:
 *     type: specific_player
 *     player_condition: "has_objective:The Enemy"
 * ```
 *
 * Or no winner on timeout:
 * ```yaml
 * engine_mechanics:
 *   win_timeout:
 *     type: no_winner
 *     reason: "Game ended in a draw."
 * ```
 *
 * Hooks used:
 * - onCheckWin: Determine winner on timeout trigger
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';
import { PlayerState } from '../../types/game';

interface TimeoutWinnerConfig {
  type?: 'highest_score' | 'role' | 'specific_player' | 'no_winner';
  role?: string;
  role_name?: string;
  reveal_role?: boolean;
  player_condition?: string;
  reason?: string;
  /** role type: the role wins at the limit only if it was never revealed (e.g. denounced) */
  unless_revealed?: boolean;
  /** highest_score type: a tie for the top score goes to a player of this team (e.g. "enemy") */
  ties_to_role?: string;
}

function findHighestScorePlayer(
  players: Record<string, PlayerState>,
  maxRounds: number | undefined,
  tiesToRole?: string
): WinCheckResult & { winnerId?: string } {
  let highestScore = -Infinity;
  let winnerId: string | null = null;

  for (const [playerId, player] of Object.entries(players)) {
    const score = player.score ?? 0;
    const role = (player as unknown as { team?: string; objective?: { type?: string } });
    const preferred = !!tiesToRole && (role.team === tiesToRole || role.objective?.type === tiesToRole);
    if (score > highestScore || (score === highestScore && preferred)) {
      highestScore = score;
      winnerId = playerId;
    }
  }

  if (!winnerId) {
    return { won: false };
  }

  return {
    won: true,
    reason: `Max rounds (${maxRounds}) reached. ${winnerId} wins with ${highestScore} points.`,
    winnerId
  };
}

function findRolePlayer(
  players: Record<string, PlayerState>,
  targetRole: string | undefined,
  targetRoleName: string | undefined,
  revealRole: boolean
): WinCheckResult & { winnerId?: string } | null {
  for (const [playerId, player] of Object.entries(players)) {
    const objective = player.objective as { name?: string; type?: string } | undefined;

    if (objective) {
      const matchesRole = targetRole && objective.type === targetRole;
      const matchesName = targetRoleName && objective.name === targetRoleName;

      if (matchesRole || matchesName) {
        const roleName = objective.name || targetRole || 'The Enemy';
        return {
          won: true,
          reason: `Time limit reached. ${revealRole ? roleName : 'A player'} wins by default.`,
          winnerId: playerId
        };
      }
    }
  }

  return null;
}

function findConditionPlayer(
  players: Record<string, PlayerState>,
  condition: string
): WinCheckResult & { winnerId?: string } | null {
  if (condition.startsWith('has_objective:')) {
    const objName = condition.replace('has_objective:', '');
    for (const [playerId, player] of Object.entries(players)) {
      const objective = player.objective as { name?: string } | undefined;
      if (objective?.name === objName) {
        return {
          won: true,
          reason: `Time limit reached. Player with "${objName}" wins by condition.`,
          winnerId: playerId
        };
      }
    }
  }

  return null;
}

export const timeoutWinnerMechanic: MechanicHooks = {
  slug: 'win-timeout',
  name: 'Timeout Winner Mechanic',

  configSchema: {
    type: 'object',
    description: 'Determine winner when max_rounds is reached',
    properties: {
      type: {
        type: 'string',
        description: 'How to determine winner',
        enum: ['highest_score', 'role', 'specific_player', 'no_winner'],
        default: 'highest_score'
      },
      role: {
        type: 'string',
        description: 'For "role" type: objective type that wins'
      },
      role_name: {
        type: 'string',
        description: 'For "role" type: objective name that wins'
      },
      reveal_role: {
        type: 'boolean',
        description: 'Whether to reveal winner\'s hidden role'
      },
      player_condition: {
        type: 'string',
        description: 'For "specific_player" type: condition to evaluate'
      },
      reason: {
        type: 'string',
        description: 'For "no_winner" type: custom reason message'
      }
    }
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    // Only respond to timeout trigger
    if (ctx.trigger !== 'timeout') return null;

    const config = ctx.config.engine_mechanics?.win_timeout as TimeoutWinnerConfig | undefined;
    const maxRounds = ctx.config.max_rounds;

    // If not configured, don't handle (let other mechanics or default handle it)
    if (!config) return null;

    const configType = config.type || 'highest_score';

    switch (configType) {
      case 'highest_score': {
        const result = findHighestScorePlayer(ctx.state.players, maxRounds, config.ties_to_role);
        if (result.won && result.winnerId === ctx.playerId) {
          return { won: true, reason: result.reason };
        }
        return null;
      }

      case 'role': {
        if (config.unless_revealed) {
          // An exposed role forfeits its time-limit win: nobody wins at the limit.
          const exposed = Object.values(ctx.state.players).some((p) => {
            const pl = p as unknown as { objective?: { type?: string }; team?: string; revealedAs?: string };
            return !!pl.revealedAs && (pl.objective?.type === config.role || pl.team === config.role);
          });
          if (exposed) return null;
        }
        const result = findRolePlayer(
          ctx.state.players,
          config.role,
          config.role_name,
          config.reveal_role ?? true
        );
        if (result?.won && result.winnerId === ctx.playerId) {
          return { won: true, reason: result.reason };
        }
        // Fall back to highest score if no role match
        if (!result) {
          const fallback = findHighestScorePlayer(ctx.state.players, maxRounds);
          if (fallback.won && fallback.winnerId === ctx.playerId) {
            return { won: true, reason: fallback.reason };
          }
        }
        return null;
      }

      case 'specific_player': {
        if (config.player_condition) {
          const result = findConditionPlayer(ctx.state.players, config.player_condition);
          if (result?.won && result.winnerId === ctx.playerId) {
            return { won: true, reason: result.reason };
          }
        }
        // Fall back to highest score
        const fallback = findHighestScorePlayer(ctx.state.players, maxRounds);
        if (fallback.won && fallback.winnerId === ctx.playerId) {
          return { won: true, reason: fallback.reason };
        }
        return null;
      }

      case 'no_winner':
        return null;

      default:
        return null;
    }
  }
};
