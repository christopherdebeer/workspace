/**
 * Turn Order: Stat-Based Mechanic (Phase 3)
 *
 * Determines turn order based on player statistics.
 * Higher or lower values can go first based on configuration.
 *
 * BGG Reference: Turn Order: Stat-Based
 * https://boardgamegeek.com/boardgamemechanic/2830/turn-order-stat-based
 *
 * Config options:
 * - turn_order_stat_based.stat: The stat to sort by ('score', 'resources.gold', etc.)
 * - turn_order_stat_based.descending: Whether higher values go first (default: true)
 * - turn_order_stat_based.trigger: When to reorder ('round_start', 'game_start')
 */

import {
  MechanicHooks,
  TurnOrderContext,
  TurnOrderResult,
  isMechanicEnabled
} from './types';
import { sortTurnOrderByProperty } from './core/turns';

export const turnOrderStatBasedMechanic: MechanicHooks = {
  slug: 'turn-order-stat-based',
  name: 'Turn Order: Stat-Based',

  /**
   * Determine turn order based on player stat
   */
  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    if (!isMechanicEnabled(ctx.config, 'turn-order-stat-based')) {
      return null;
    }

    const statConfig = ctx.config.engine_mechanics?.turn_order_stat_based;
    if (!statConfig) return null;

    const stat = statConfig.stat ?? 'score';
    const descending = statConfig.descending ?? true;
    const trigger = statConfig.trigger ?? 'round_start';

    // Only trigger at configured times
    if (ctx.reason === 'round_start' && trigger !== 'round_start' && trigger !== 'both') {
      // Allow game_start (round 1)
      if (!(trigger === 'game_start' && ctx.state.round === 1)) {
        return null;
      }
    }

    // Sort the current turn order by the stat
    const sortedOrder = [...ctx.currentOrder].sort((a, b) => {
      const playerA = ctx.state.players[a];
      const playerB = ctx.state.players[b];

      let valueA = 0;
      let valueB = 0;

      // Handle various stat types
      if (stat === 'score') {
        valueA = playerA?.score ?? 0;
        valueB = playerB?.score ?? 0;
      } else if (stat === 'actionPoints') {
        valueA = playerA?.actionPoints ?? 0;
        valueB = playerB?.actionPoints ?? 0;
      } else if (stat === 'movementPoints') {
        valueA = playerA?.movementPoints ?? 0;
        valueB = playerB?.movementPoints ?? 0;
      } else if (stat === 'tricksWon') {
        valueA = playerA?.tricksWon ?? 0;
        valueB = playerB?.tricksWon ?? 0;
      } else if (stat === 'handSize') {
        valueA = playerA?.hand?.length ?? 0;
        valueB = playerB?.hand?.length ?? 0;
      } else if (stat.startsWith('resources.')) {
        const resourceName = stat.substring(10);
        valueA = playerA?.resources?.[resourceName] ?? 0;
        valueB = playerB?.resources?.[resourceName] ?? 0;
      }

      return descending ? valueB - valueA : valueA - valueB;
    });

    return {
      order: sortedOrder
    };
  },

  configSchema: {
    type: 'object',
    description: 'Determines turn order based on player statistics.',
    properties: {
      stat: {
        type: 'string',
        description: 'The stat to sort by (score, resources.gold, handSize, etc.)',
        default: 'score'
      },
      descending: {
        type: 'boolean',
        description: 'Whether higher values go first',
        default: true
      },
      trigger: {
        type: 'string',
        enum: ['game_start', 'round_start', 'both'],
        description: 'When to reorder',
        default: 'round_start'
      }
    }
  }
};
