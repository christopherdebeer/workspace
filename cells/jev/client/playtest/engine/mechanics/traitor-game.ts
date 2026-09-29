/**
 * Traitor Game Mechanic
 *
 * Specialized hidden role mechanic for traitor/social deduction games.
 * Handles the asymmetric win conditions between loyal players and traitors.
 *
 * Games supported: Battlestar Galactica, Dead of Winter, Shadows over Camelot,
 * Resistance, Secret Hitler, An Agent of the Enemy
 *
 * Hooks used:
 * - onCheckWin: Check traitor/loyalist win conditions
 * - getVisibleState: Hide traitor info from loyalists
 * - canSeeInfo: Traitors know each other (configurable)
 * - initPlayerState: Assign traitor status
 *
 * Config options:
 * - traitorCount: Number of traitors
 * - traitorRole: Role ID for traitor
 * - loyalistRole: Role ID for loyalists
 * - traitorWinCondition: How traitors win
 * - loyalistWinCondition: How loyalists win
 * - traitorsKnowEachOther: Whether traitors know identities
 */

import {
  MechanicHooks,
  VisibilityContext,
  VisibleState,
  WinCheckContext,
  WinCheckResult,
  PlayerInitContext,
  PlayerInitResult,
  StateChanges
} from './types';
import { PlayerState } from '../types/game';

/**
 * Configuration for traitor game mechanic
 */
export interface TraitorGameConfig {
  /** Number of traitors (default: 1) */
  traitorCount?: number;
  /** Traitor count by player count (e.g., { 5: 1, 7: 2, 9: 3 }) */
  traitorsByPlayerCount?: Record<number, number>;
  /** Role ID for traitor */
  traitorRole?: string;
  /** Role ID for loyalists */
  loyalistRole?: string;
  /** Whether traitors know each other */
  traitorsKnowEachOther?: boolean;
  /** Traitor win condition */
  traitorWinCondition?: {
    type: 'majority_eliminated' | 'all_eliminated' | 'objective_failed' |
          'reach_state' | 'timeout' | 'custom';
    targetState?: string;
    eliminationThreshold?: number;
    customCondition?: string;
  };
  /** Loyalist win condition */
  loyalistWinCondition?: {
    type: 'objective_complete' | 'traitors_exposed' | 'reach_state' |
          'survive_rounds' | 'custom';
    targetState?: string;
    roundsToSurvive?: number;
    customCondition?: string;
  };
  /** Whether the traitor can be discovered/voted out */
  enableAccusation?: boolean;
  /** Voting threshold to expose traitor */
  exposureThreshold?: number;
}

/**
 * Shuffle array in place using Fisher-Yates
 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Calculate number of traitors based on player count
 */
function getTraitorCount(config: TraitorGameConfig, playerCount: number): number {
  // Check player-count-specific configuration
  if (config.traitorsByPlayerCount) {
    // Find the closest player count that doesn't exceed actual count
    const counts = Object.entries(config.traitorsByPlayerCount)
      .map(([k, v]) => [parseInt(k), v] as [number, number])
      .sort((a, b) => b[0] - a[0]); // Sort descending

    for (const [minPlayers, traitorCount] of counts) {
      if (playerCount >= minPlayers) {
        return traitorCount;
      }
    }
  }

  // Default to configured count or 1
  return config.traitorCount ?? 1;
}

export const traitorGameMechanic: MechanicHooks = {
  slug: 'traitor-game',
  name: 'Traitor Game',

  requires: ['hidden-roles', 'visibility'],

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const traitorConfig = ctx.config.engine_mechanics?.traitor_game as TraitorGameConfig | undefined;
    if (!traitorConfig) return null;

    // Get total player count
    const playersConfig = ctx.config.players;
    const playerCount = typeof playersConfig === 'number'
      ? playersConfig
      : (playersConfig as { min: number; max: number })?.max ?? 4;

    // Calculate traitor count
    const traitorCount = getTraitorCount(traitorConfig, playerCount);
    const traitorRole = traitorConfig.traitorRole || 'traitor';
    const loyalistRole = traitorConfig.loyalistRole || 'loyalist';

    // Build role assignments
    const roles: string[] = [];
    for (let i = 0; i < traitorCount; i++) {
      roles.push(traitorRole);
    }
    while (roles.length < playerCount) {
      roles.push(loyalistRole);
    }

    // Shuffle consistently based on player count and game ID
    const shuffled = shuffleArray(roles);
    const assignedRole = shuffled[ctx.playerIndex];
    const isTraitor = assignedRole === traitorRole;

    // Initialize knowledge
    const knowledge = {
      knownRoles: {} as Record<string, string>,
      knownPositions: {} as Record<string, string>,
      revealed: {} as Record<string, unknown>
    };

    // Player always knows their own role
    knowledge.knownRoles[ctx.playerId] = assignedRole;

    // If traitors know each other, add existing traitors
    if (isTraitor && traitorConfig.traitorsKnowEachOther !== false) {
      for (const [existingPlayerId, existingPlayer] of Object.entries(ctx.existingPlayers)) {
        if (existingPlayer.hiddenRole === traitorRole) {
          knowledge.knownRoles[existingPlayerId] = traitorRole;
        }
      }
    }

    return {
      hiddenRole: assignedRole,
      team: isTraitor ? 'traitor' : 'loyalist',
      knowledge
    };
  },

  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    const traitorConfig = ctx.config.engine_mechanics?.traitor_game as TraitorGameConfig | undefined;
    if (!traitorConfig) return null;

    const viewer = ctx.state.players[ctx.viewerPlayerId];
    if (!viewer) return null;

    const traitorRole = traitorConfig.traitorRole || 'traitor';
    const isViewerTraitor = viewer.hiddenRole === traitorRole;
    const traitorsKnowEachOther = traitorConfig.traitorsKnowEachOther !== false;

    const filteredPlayers: Record<string, Partial<PlayerState>> = {};
    const hiddenPlayers: string[] = [];

    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      // Always see own info
      if (playerId === ctx.viewerPlayerId) continue;

      const isTargetTraitor = player.hiddenRole === traitorRole;

      // Traitors see each other if configured
      if (isViewerTraitor && isTargetTraitor && traitorsKnowEachOther) {
        continue; // Don't hide
      }

      // Check if viewer knows this player's role through knowledge
      if (viewer.knowledge?.knownRoles[playerId]) {
        continue; // Already known
      }

      // Hide traitor status from loyalists
      filteredPlayers[playerId] = {
        hiddenRole: undefined,
        team: undefined
      };
      hiddenPlayers.push(playerId);
    }

    return {
      players: filteredPlayers,
      visibilityMeta: {
        hiddenPlayers,
        hiddenInfo: ['role', 'team']
      }
    };
  },

  canSeeInfo(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined {
    const traitorConfig = ctx.config.engine_mechanics?.traitor_game as TraitorGameConfig | undefined;
    if (!traitorConfig) return undefined;

    // Only handle role/team info
    if (!['role', 'team', 'alignment'].includes(infoType)) return undefined;
    if (!targetPlayerId) return undefined;

    const viewer = ctx.state.players[ctx.viewerPlayerId];
    const target = ctx.state.players[targetPlayerId];
    if (!viewer || !target) return false;

    // Player sees own info
    if (targetPlayerId === ctx.viewerPlayerId) return true;

    // Check if viewer already knows
    if (viewer.knowledge?.knownRoles[targetPlayerId]) return true;

    const traitorRole = traitorConfig.traitorRole || 'traitor';
    const isViewerTraitor = viewer.hiddenRole === traitorRole;
    const isTargetTraitor = target.hiddenRole === traitorRole;
    const traitorsKnowEachOther = traitorConfig.traitorsKnowEachOther !== false;

    // Traitors see each other
    if (isViewerTraitor && isTargetTraitor && traitorsKnowEachOther) {
      return true;
    }

    return false;
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const traitorConfig = ctx.config.engine_mechanics?.traitor_game as TraitorGameConfig | undefined;
    if (!traitorConfig) return null;

    const traitorRole = traitorConfig.traitorRole || 'traitor';
    const loyalistRole = traitorConfig.loyalistRole || 'loyalist';

    const activePlayers = Object.entries(ctx.state.players)
      .filter(([_, p]) => p.state !== 'eliminated');

    const activeTraitors = activePlayers.filter(([_, p]) => p.hiddenRole === traitorRole);
    const activeLoyalists = activePlayers.filter(([_, p]) => p.hiddenRole === loyalistRole);

    // Check traitor win conditions
    if (traitorConfig.traitorWinCondition) {
      const winCondition = traitorConfig.traitorWinCondition;

      switch (winCondition.type) {
        case 'all_eliminated':
          // Traitors win if all loyalists are eliminated
          if (activeLoyalists.length === 0 && activeTraitors.length > 0) {
            // Check if current player is a traitor
            if (ctx.player.hiddenRole === traitorRole) {
              return {
                won: true,
                reason: 'All loyalists have been eliminated! The traitor wins!'
              };
            }
          }
          break;

        case 'majority_eliminated':
          // Traitors win if they achieve majority
          const threshold = winCondition.eliminationThreshold ?? 0.5;
          if (activeTraitors.length > 0) {
            const traitorRatio = activeTraitors.length / activePlayers.length;
            if (traitorRatio >= threshold) {
              if (ctx.player.hiddenRole === traitorRole) {
                return {
                  won: true,
                  reason: 'Traitors have achieved majority! The traitors win!'
                };
              }
            }
          }
          break;

        case 'reach_state':
          // Traitors win if they reach a specific state
          if (winCondition.targetState && ctx.player.state === winCondition.targetState) {
            if (ctx.player.hiddenRole === traitorRole) {
              return {
                won: true,
                reason: `Traitor reached ${winCondition.targetState}! The traitor wins!`
              };
            }
          }
          break;

        case 'timeout':
          // Traitors win on timeout (handled by timeout-winner mechanic)
          break;
      }
    }

    // Check loyalist win conditions
    if (traitorConfig.loyalistWinCondition) {
      const winCondition = traitorConfig.loyalistWinCondition;

      switch (winCondition.type) {
        case 'traitors_exposed':
          // Loyalists win if all traitors are eliminated/exposed
          if (activeTraitors.length === 0 && activeLoyalists.length > 0) {
            if (ctx.player.hiddenRole === loyalistRole) {
              return {
                won: true,
                reason: 'All traitors have been exposed! The loyalists win!'
              };
            }
          }
          break;

        case 'reach_state':
          // Loyalists win by reaching objective state
          if (winCondition.targetState && ctx.player.state === winCondition.targetState) {
            if (ctx.player.hiddenRole === loyalistRole) {
              return {
                won: true,
                reason: `Loyalists completed the objective! Victory!`
              };
            }
          }
          break;

        case 'survive_rounds':
          // Loyalists win by surviving N rounds
          if (winCondition.roundsToSurvive && ctx.state.round >= winCondition.roundsToSurvive) {
            if (ctx.player.hiddenRole === loyalistRole && activeLoyalists.length > 0) {
              return {
                won: true,
                reason: `Loyalists survived ${winCondition.roundsToSurvive} rounds! Victory!`
              };
            }
          }
          break;
      }
    }

    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Adds traitor vs loyalist hidden roles with asymmetric win conditions.',
    properties: {
      traitorCount: {
        type: 'number',
        description: 'Number of traitors',
        default: 1
      },
      traitorsByPlayerCount: {
        type: 'object',
        description: 'Traitor count by player count (e.g., { "5": 1, "7": 2 })'
      },
      traitorRole: {
        type: 'string',
        description: 'Role ID for traitor',
        default: 'traitor'
      },
      loyalistRole: {
        type: 'string',
        description: 'Role ID for loyalists',
        default: 'loyalist'
      },
      traitorsKnowEachOther: {
        type: 'boolean',
        description: 'Whether traitors know each other\'s identity',
        default: true
      },
      traitorWinCondition: {
        type: 'object',
        description: 'How traitors win the game'
      },
      loyalistWinCondition: {
        type: 'object',
        description: 'How loyalists win the game'
      },
      enableAccusation: {
        type: 'boolean',
        description: 'Allow voting to expose traitors',
        default: false
      }
    }
  }
};
