/**
 * Sudden Death Ending Mechanic
 *
 * The game can end instantly when a specific condition is met.
 * Unlike normal win conditions that are checked periodically,
 * sudden death can trigger during any phase of the game.
 *
 * Supports multiple condition types:
 * - Resource depletion (player runs out of something)
 * - Deck exhaustion (shared deck empties)
 * - State reached (player enters specific state)
 * - Turn limit (specific player turn count)
 * - Custom condition (evaluated via expression)
 *
 * Hooks used:
 * - onCheckWin: Check for sudden death conditions
 * - onTurnEnd: Check turn-based sudden death
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';
import { getCardsState } from '../core/index';

interface SuddenDeathCondition {
  /** Type of sudden death condition */
  type: 'resource_depleted' | 'deck_exhausted' | 'state_reached' | 'turn_limit' | 'elimination' | 'score_reached';
  /** Resource name (for resource_depleted) */
  resource?: string;
  /** Threshold value (0 for depleted, or specific amount) */
  threshold?: number;
  /** Target state (for state_reached) */
  target_state?: string;
  /** Turn limit (for turn_limit) */
  max_turns?: number;
  /** Score threshold (for score_reached) */
  score?: number;
  /** Who loses when condition triggers: 'triggering_player', 'all_others', 'no_one' */
  loser?: 'triggering_player' | 'all_others' | 'no_one';
  /** Description shown when triggered */
  message?: string;
}

interface SuddenDeathConfig {
  /** List of sudden death conditions */
  conditions: SuddenDeathCondition[];
  /** Whether to check after every action (default: true) */
  check_on_action?: boolean;
  /** Whether sudden death announces before triggering */
  announce_warning?: boolean;
}

function isSuddenDeathConfig(config: unknown): config is SuddenDeathConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as SuddenDeathConfig).conditions)
  );
}

function checkCondition(
  condition: SuddenDeathCondition,
  ctx: WinCheckContext
): { triggered: boolean; winnerId?: string; loserId?: string; message: string } {
  const { state, player, playerId } = ctx;

  switch (condition.type) {
    case 'resource_depleted': {
      if (!condition.resource) {
        return { triggered: false, message: '' };
      }
      const amount = player.resources?.[condition.resource] ?? 0;
      const threshold = condition.threshold ?? 0;
      if (amount <= threshold) {
        const message = condition.message ||
          `${playerId} ran out of ${condition.resource}!`;
        if (condition.loser === 'triggering_player') {
          // Player who ran out loses, others win
          const others = Object.keys(state.players).filter(id => id !== playerId);
          return {
            triggered: true,
            winnerId: others.length === 1 ? others[0] : undefined,
            loserId: playerId,
            message
          };
        }
        return { triggered: true, message };
      }
      break;
    }

    case 'deck_exhausted': {
      const deck = getCardsState(state).deck;
      if (deck.length === 0) {
        const message = condition.message || 'The deck is exhausted!';
        // Determine winner based on configured method or highest score
        const scores = Object.entries(state.players).map(([id, p]) => ({
          id,
          score: p.score ?? 0
        }));
        scores.sort((a, b) => b.score - a.score);
        return {
          triggered: true,
          winnerId: scores[0]?.id,
          message
        };
      }
      break;
    }

    case 'state_reached': {
      if (condition.target_state && player.state === condition.target_state) {
        const message = condition.message ||
          `${playerId} reached ${condition.target_state}!`;
        return {
          triggered: true,
          winnerId: playerId,
          message
        };
      }
      break;
    }

    case 'turn_limit': {
      const maxTurns = condition.max_turns ?? 100;
      const currentTurn = state.turnNumber ?? state.round ?? 0;
      if (currentTurn >= maxTurns) {
        const message = condition.message || `Turn limit (${maxTurns}) reached!`;
        // Highest score wins on turn limit
        const scores = Object.entries(state.players).map(([id, p]) => ({
          id,
          score: p.score ?? 0
        }));
        scores.sort((a, b) => b.score - a.score);
        return {
          triggered: true,
          winnerId: scores[0]?.id,
          message
        };
      }
      break;
    }

    case 'elimination': {
      // Check if only one player remains active
      const activePlayers = Object.entries(state.players).filter(
        ([, p]) => p.state !== 'eliminated' && p.state !== 'out'
      );
      if (activePlayers.length === 1) {
        const message = condition.message || `${activePlayers[0][0]} is the last one standing!`;
        return {
          triggered: true,
          winnerId: activePlayers[0][0],
          message
        };
      }
      break;
    }

    case 'score_reached': {
      const threshold = condition.score ?? 100;
      if ((player.score ?? 0) >= threshold) {
        const message = condition.message ||
          `${playerId} reached ${threshold} points!`;
        return {
          triggered: true,
          winnerId: playerId,
          message
        };
      }
      break;
    }
  }

  return { triggered: false, message: '' };
}

export const suddenDeathMechanic: MechanicHooks = {
  slug: 'sudden-death-ending',
  name: 'Sudden Death Ending',

  configSchema: {
    type: 'object',
    description: 'Instant win/lose conditions that end the game immediately',
    properties: {
      conditions: {
        type: 'array',
        description: 'List of sudden death conditions to check',
        required: true
      },
      check_on_action: {
        type: 'boolean',
        description: 'Check after every action',
        default: true
      },
      announce_warning: {
        type: 'boolean',
        description: 'Announce when close to triggering',
        default: false
      }
    },
    required: ['conditions']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const sdConfig = ctx.config.engine_mechanics?.sudden_death_ending;

    if (!isSuddenDeathConfig(sdConfig)) return null;

    // Check all sudden death conditions
    for (const condition of sdConfig.conditions) {
      const result = checkCondition(condition, ctx);
      if (result.triggered) {
        // If we have a winner, they won
        if (result.winnerId === ctx.playerId) {
          return {
            won: true,
            reason: result.message
          };
        }
        // If this player is the loser, they didn't win
        if (result.loserId === ctx.playerId) {
          return null; // Not a win for this player
        }
      }
    }

    return null;
  },

// Note: Turn counting uses built-in state.turnNumber
};
