/**
 * Highest/Lowest Scoring Win Condition
 *
 * Invert scoring - lowest score wins (like Golf). Or highest (standard but
 * as explicit mechanic). Only triggers on game end ('timeout' or 'game_end').
 *
 * Config (engine_mechanics.win_highest_lowest_scoring):
 * ```yaml
 * engine_mechanics:
 *   win_highest_lowest_scoring:
 *     mode: lowest   # or 'highest'
 * ```
 *
 * Hooks used:
 * - onCheckWin: On trigger 'timeout' or 'game_end', check if player has
 *   highest or lowest score among all players.
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

interface HighestLowestScoringConfig {
  mode: 'highest' | 'lowest';
}

function isHighestLowestScoringConfig(config: unknown): config is HighestLowestScoringConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    ((config as HighestLowestScoringConfig).mode === 'highest' ||
     (config as HighestLowestScoringConfig).mode === 'lowest')
  );
}

export const highestLowestScoringMechanic: MechanicHooks = {
  slug: 'win-highest-lowest-scoring',
  name: 'Highest/Lowest Scoring Win Condition',

  configSchema: {
    type: 'object',
    description: 'Win by having the highest or lowest score at game end',
    properties: {
      mode: {
        type: 'string',
        description: 'Whether highest or lowest score wins',
        enum: ['highest', 'lowest'],
        required: true
      }
    },
    required: ['mode']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = ctx.config.engine_mechanics?.win_highest_lowest_scoring;

    // Only handle if this mechanic is configured
    if (!isHighestLowestScoringConfig(config)) return null;

    // Apply on game end triggers and explicit win checks from mechanics
    if (ctx.trigger !== 'timeout' && ctx.trigger !== 'game_end' && ctx.trigger !== 'action') return null;

    const myScore = ctx.player.score ?? 0;
    let isWinner = true;

    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      if (playerId === ctx.playerId) continue;

      const otherScore = player.score ?? 0;

      if (config.mode === 'highest') {
        // Highest score wins - if someone has a higher score, we lose
        if (otherScore > myScore) {
          isWinner = false;
          break;
        }
      } else {
        // Lowest score wins - if someone has a lower score, we lose
        if (otherScore < myScore) {
          isWinner = false;
          break;
        }
      }
    }

    if (isWinner) {
      const modeLabel = config.mode === 'highest' ? 'highest' : 'lowest';
      return {
        won: true,
        reason: `${ctx.playerId} wins with the ${modeLabel} score of ${myScore}`
      };
    }

    return null;
  }
};
