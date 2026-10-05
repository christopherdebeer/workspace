/**
 * Hidden Victory Points Mechanic (Phase 4)
 *
 * Keeps player scores hidden until end game or specific reveal conditions.
 * Adds tension and uncertainty to scoring games.
 *
 * BGG Reference: Hidden Victory Points
 * https://boardgamegeek.com/boardgamemechanic/2919/hidden-victory-points
 *
 * Config options:
 * - hidden_victory_points.reveal_at_end: Reveal all scores at game end (default: true)
 * - hidden_victory_points.reveal_threshold: Reveal when any player reaches this score
 * - hidden_victory_points.show_relative: Show relative position without exact scores
 * - hidden_victory_points.reveal_own: Players can see their own score (default: true)
 */

import {
  MechanicHooks,
  VisibilityContext,
  VisibleState,
  isMechanicEnabled
} from './types';
import { PlayerState } from '../types/game';

export const hiddenVictoryPointsMechanic: MechanicHooks = {
  slug: 'hidden-victory-points',
  name: 'Hidden Victory Points',
  requires: ['visibility'],

  /**
   * Filter visible state to hide opponent scores
   */
  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    if (!isMechanicEnabled(ctx.config, 'hidden-victory-points')) {
      return null;
    }

    const hvpConfig = ctx.config.engine_mechanics?.hidden_victory_points;
    const revealOwn = hvpConfig?.reveal_own ?? true;
    const showRelative = hvpConfig?.show_relative ?? false;
    const revealThreshold = hvpConfig?.reveal_threshold;
    const revealAtEnd = hvpConfig?.reveal_at_end ?? true;

    // Check if scores should be revealed due to threshold
    let scoresRevealed = false;
    if (revealThreshold) {
      for (const player of Object.values(ctx.state.players)) {
        if ((player.score ?? 0) >= revealThreshold) {
          scoresRevealed = true;
          break;
        }
      }
    }

    // Check if game is ending
    if (revealAtEnd && ctx.state.status === 'completed') {
      scoresRevealed = true;
    }

    // If scores are revealed, don't filter
    if (scoresRevealed) {
      return null;
    }

    // Build filtered player states
    const filteredPlayers: Record<string, Partial<PlayerState>> = {};

    for (const [playerId, playerState] of Object.entries(ctx.state.players)) {
      if (playerId === ctx.viewerPlayerId && revealOwn) {
        // Viewer can see their own score
        filteredPlayers[playerId] = { ...playerState };
      } else {
        // Hide score from other players
        const filtered: Partial<PlayerState> = { ...playerState };

        if (showRelative) {
          // Show relative position instead of exact score
          const viewerScore = ctx.state.players[ctx.viewerPlayerId]?.score ?? 0;
          const theirScore = playerState.score ?? 0;

          // Use a placeholder that indicates relative position
          if (theirScore > viewerScore) {
            (filtered as any).scoreHint = 'ahead';
          } else if (theirScore < viewerScore) {
            (filtered as any).scoreHint = 'behind';
          } else {
            (filtered as any).scoreHint = 'tied';
          }
        }

        // Remove exact score
        delete filtered.score;
        filteredPlayers[playerId] = filtered;
      }
    }

    return {
      players: filteredPlayers
    };
  },

  /**
   * Control who can see score information
   */
  canSeeInfo(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined {
    if (!isMechanicEnabled(ctx.config, 'hidden-victory-points')) {
      return undefined;
    }

    // Only filter score visibility
    if (infoType !== 'score' && infoType !== 'victory_points') {
      return undefined;
    }

    const hvpConfig = ctx.config.engine_mechanics?.hidden_victory_points;
    const revealOwn = hvpConfig?.reveal_own ?? true;
    const revealThreshold = hvpConfig?.reveal_threshold;
    const revealAtEnd = hvpConfig?.reveal_at_end ?? true;

    // Check reveal conditions
    if (revealAtEnd && ctx.state.status === 'completed') {
      return true;
    }

    if (revealThreshold) {
      for (const player of Object.values(ctx.state.players)) {
        if ((player.score ?? 0) >= revealThreshold) {
          return true;
        }
      }
    }

    // Can always see own score if configured
    if (revealOwn && (!targetPlayerId || targetPlayerId === ctx.viewerPlayerId)) {
      return true;
    }

    // Hide opponent scores
    return false;
  },

  configSchema: {
    type: 'object',
    description: 'Keeps player scores hidden until end game or specific conditions.',
    properties: {
      reveal_at_end: {
        type: 'boolean',
        description: 'Reveal all scores at game end',
        default: true
      },
      reveal_threshold: {
        type: 'number',
        description: 'Reveal when any player reaches this score'
      },
      show_relative: {
        type: 'boolean',
        description: 'Show relative position (ahead/behind/tied) instead of exact scores',
        default: false
      },
      reveal_own: {
        type: 'boolean',
        description: 'Players can see their own score',
        default: true
      }
    }
  }
};
