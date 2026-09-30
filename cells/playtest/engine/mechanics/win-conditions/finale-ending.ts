/**
 * Finale Ending Win Condition
 *
 * End-game scoring phase. When game ends (trigger 'timeout'/'game_end'),
 * tallies final scores from multiple configured scoring categories.
 *
 * Config (engine_mechanics.win_finale_ending):
 * ```yaml
 * engine_mechanics:
 *   win_finale_ending:
 *     scoring_categories:
 *       - name: "Base Score"
 *         source: score
 *       - name: "Gold Bonus"
 *         source: resources
 *         resource: gold
 *         multiplier: 0.5
 *       - name: "Hand Size Bonus"
 *         source: hand_size
 *         multiplier: 2
 *       - name: "Effects Bonus"
 *         source: effects
 *         multiplier: 3
 * ```
 *
 * Hooks used:
 * - onCheckWin: On timeout/game_end, tally final scores and determine winner
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';
import { PlayerState } from '../../types/game';

interface FinaleEndingConfig {
  scoring_categories?: Array<{
    name: string;
    source: 'score' | 'resources' | 'hand_size' | 'effects';
    resource?: string;
    multiplier?: number;
  }>;
}

function calculateFinalScore(player: PlayerState, config: FinaleEndingConfig): number {
  const categories = config.scoring_categories;

  // If no categories configured, use base score
  if (!categories || categories.length === 0) {
    return player.score ?? 0;
  }

  let total = 0;

  for (const category of categories) {
    const multiplier = category.multiplier ?? 1;
    let value = 0;

    switch (category.source) {
      case 'score':
        value = player.score ?? 0;
        break;

      case 'resources':
        if (category.resource) {
          value = player.resources?.[category.resource] ?? 0;
        } else {
          // Sum all resources if no specific resource specified
          if (player.resources) {
            for (const amount of Object.values(player.resources)) {
              value += amount;
            }
          }
        }
        break;

      case 'hand_size':
        value = (player.hand || []).length;
        break;

      case 'effects':
        value = player.effects?.length ?? 0;
        break;
    }

    total += value * multiplier;
  }

  return total;
}

export const finaleEndingMechanic: MechanicHooks = {
  slug: 'win-finale-ending',
  name: 'Finale Ending',

  configSchema: {
    type: 'object',
    description: 'End-game scoring phase with multiple scoring categories',
    properties: {
      scoring_categories: {
        type: 'array',
        description: 'List of scoring categories to tally at game end'
      }
    }
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    // Only respond to timeout or game_end triggers
    if (ctx.trigger !== 'timeout' && ctx.trigger !== 'game_end') return null;

    const config = ctx.config.engine_mechanics?.win_finale_ending as FinaleEndingConfig | undefined;
    if (!config) return null;

    // Calculate final score for the current player
    const myScore = calculateFinalScore(ctx.player, config);

    // Calculate final scores for all other players
    let isHighest = true;
    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      if (playerId === ctx.playerId) continue;
      const otherScore = calculateFinalScore(player, config);
      if (otherScore >= myScore) {
        isHighest = false;
        break;
      }
    }

    if (isHighest) {
      return {
        won: true,
        reason: `Game ended. ${ctx.playerId} wins with final score of ${myScore} points.`
      };
    }

    return null;
  }
};
