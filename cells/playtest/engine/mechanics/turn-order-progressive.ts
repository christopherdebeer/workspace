/**
 * Turn Order: Progressive (Snake Draft) Mechanic (Phase 3)
 *
 * Implements snake draft order where turn order reverses each round.
 * Round 1: A, B, C, D
 * Round 2: D, C, B, A
 * Round 3: A, B, C, D
 * etc.
 *
 * This ensures fair distribution of turn advantage.
 *
 * BGG Reference: Turn Order: Progressive
 * https://boardgamegeek.com/boardgamemechanic/2832/turn-order-progressive
 *
 * Config options:
 * - turn_order_progressive.reverse_each_round: Whether to reverse order each round (default: true)
 * - turn_order_progressive.reverse_on_tie: Reverse when scores are tied
 */

import {
  MechanicHooks,
  TurnOrderContext,
  TurnOrderResult,
  isMechanicEnabled
} from './types';

export const turnOrderProgressiveMechanic: MechanicHooks = {
  slug: 'turn-order-progressive',
  name: 'Turn Order: Progressive',

  /**
   * Determine turn order using snake draft pattern
   */
  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    if (!isMechanicEnabled(ctx.config, 'turn-order-progressive')) {
      return null;
    }

    const progressiveConfig = ctx.config.engine_mechanics?.turn_order_progressive;
    const reverseEachRound = progressiveConfig?.reverse_each_round ?? true;

    // Only apply at round start
    if (ctx.reason !== 'round_start') {
      return null;
    }

    // Determine if this is an "odd" or "even" round
    // Odd rounds (1, 3, 5...): normal order
    // Even rounds (2, 4, 6...): reversed order
    const isEvenRound = ctx.state.round % 2 === 0;

    if (reverseEachRound && isEvenRound) {
      // Reverse the order for even rounds
      return {
        order: [...ctx.currentOrder].reverse()
      };
    }

    // For odd rounds, keep normal order (first round uses initial order)
    // We only return if we're actually changing from previous round
    if (reverseEachRound && ctx.state.round > 1) {
      // If coming from even round, need to reverse back
      // But currentOrder already has the previous round's order
      // So just return normal order based on initial setup
      // Actually, we need to restore to original order
      return {
        order: [...ctx.currentOrder].reverse()
      };
    }

    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Snake draft order that reverses each round.',
    properties: {
      reverse_each_round: {
        type: 'boolean',
        description: 'Whether to reverse turn order each round',
        default: true
      },
      reverse_on_tie: {
        type: 'boolean',
        description: 'Reverse when scores are tied',
        default: false
      }
    }
  }
};
