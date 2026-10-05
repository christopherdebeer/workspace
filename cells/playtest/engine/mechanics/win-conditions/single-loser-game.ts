/**
 * Single Loser Win Condition
 *
 * Last player standing loses, everyone else wins. Inverse of elimination.
 * On game end, determines which player is the "loser" based on configured condition,
 * and all other players win.
 *
 * Config (engine_mechanics.win_single_loser):
 * ```yaml
 * engine_mechanics:
 *   win_single_loser:
 *     loser_condition: lowest_score
 * ```
 *
 * Or bankrupt check:
 * ```yaml
 * engine_mechanics:
 *   win_single_loser:
 *     loser_condition: bankrupt
 *     resource: gold
 * ```
 *
 * Hooks used:
 * - onCheckWin: On timeout/game_end, check if this player is NOT the loser
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';
import { PlayerState } from '../../types/game';

interface SingleLoserConfig {
  loser_condition: 'lowest_score' | 'last_remaining' | 'bankrupt';
  resource?: string;
}

function findLoser(
  players: Record<string, PlayerState>,
  config: SingleLoserConfig
): string | null {
  switch (config.loser_condition) {
    case 'lowest_score': {
      let lowestScore = Infinity;
      let loserId: string | null = null;
      for (const [playerId, player] of Object.entries(players)) {
        const score = player.score ?? 0;
        if (score < lowestScore) {
          lowestScore = score;
          loserId = playerId;
        }
      }
      return loserId;
    }

    case 'last_remaining': {
      // The last remaining player (not eliminated) is the loser
      const activePlayers = Object.entries(players).filter(([, player]) => {
        const hasEliminatedEffect = player.effects?.some(e => e.type === 'eliminated') ?? false;
        const inEliminatedState = player.state === 'eliminated';
        return !hasEliminatedEffect && !inEliminatedState;
      });

      if (activePlayers.length === 1) {
        return activePlayers[0][0];
      }
      return null;
    }

    case 'bankrupt': {
      const resource = config.resource ?? 'gold';
      for (const [playerId, player] of Object.entries(players)) {
        const amount = player.resources?.[resource] ?? 0;
        if (amount <= 0) {
          return playerId;
        }
      }
      // If no one is bankrupt, find the lowest resource holder
      let lowestAmount = Infinity;
      let loserId: string | null = null;
      for (const [playerId, player] of Object.entries(players)) {
        const amount = player.resources?.[resource] ?? 0;
        if (amount < lowestAmount) {
          lowestAmount = amount;
          loserId = playerId;
        }
      }
      return loserId;
    }

    default:
      return null;
  }
}

export const singleLoserGameMechanic: MechanicHooks = {
  slug: 'win-single-loser',
  name: 'Single Loser Game',

  configSchema: {
    type: 'object',
    description: 'Last player standing loses, everyone else wins',
    properties: {
      loser_condition: {
        type: 'string',
        description: 'How to determine the loser',
        enum: ['lowest_score', 'last_remaining', 'bankrupt']
      },
      resource: {
        type: 'string',
        description: 'Resource to check for bankrupt condition'
      }
    },
    required: ['loser_condition']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    // Only respond to timeout or game_end triggers
    if (ctx.trigger !== 'timeout' && ctx.trigger !== 'game_end') return null;

    const config = ctx.config.engine_mechanics?.win_single_loser as SingleLoserConfig | undefined;
    if (!config) return null;

    const loserId = findLoser(ctx.state.players, config);

    // If this player is NOT the loser, they win
    if (loserId && loserId !== ctx.playerId) {
      return {
        won: true,
        reason: `Game ended. ${ctx.playerId} wins! ${loserId} is the loser (${config.loser_condition}).`
      };
    }

    return null;
  }
};
