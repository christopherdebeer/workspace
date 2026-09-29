/**
 * Turn Order: Random (Phase 3)
 *
 * Randomizes turn order at specified trigger points.
 *
 * BGG Reference: Turn Order: Random (1993)
 * https://boardgamegeek.com/boardgamemechanic/2828/turn-order-random
 *
 * Config options:
 * - turn_order_random.trigger: When to randomize ('round_start', 'game_start', 'both')
 * - turn_order_random.keep_current: Keep current player in position after shuffle
 */

import { MechanicHooks, TurnOrderContext, TurnOrderResult, isMechanicEnabled } from './types';

/**
 * Fisher-Yates shuffle for arrays
 */
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const turnOrderRandomMechanic: MechanicHooks = {
  slug: 'turn-order-random',
  name: 'Turn Order: Random',

  /**
   * Determine turn order at round start.
   * Shuffles turn order when triggered at round_start.
   */
  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    if (!isMechanicEnabled(ctx.config, 'turn-order-random')) {
      return null;
    }

    const turnOrderConfig = ctx.config.engine_mechanics?.turn_order_random;
    const trigger = turnOrderConfig?.trigger ?? 'round_start';
    const keepCurrent = turnOrderConfig?.keep_current ?? false;

    // Handle game_start trigger (reason will be 'round_start' for round 1)
    if (ctx.reason === 'round_start' && ctx.state.round === 1) {
      if (trigger === 'game_start' || trigger === 'both') {
        return shuffleOrder(ctx.state.turnOrder, ctx.state.currentPlayer, keepCurrent);
      }
    }

    // Handle round_start trigger (all rounds)
    if (ctx.reason === 'round_start') {
      if (trigger === 'round_start' || trigger === 'both') {
        return shuffleOrder(ctx.state.turnOrder, ctx.state.currentPlayer, keepCurrent);
      }
    }

    return null;
  }
};

/**
 * Helper to shuffle order and optionally keep current player at front
 */
function shuffleOrder(
  turnOrder: string[],
  currentPlayer: string | null,
  keepCurrent: boolean
): TurnOrderResult {
  let shuffledOrder = shuffleArray(turnOrder);

  // Keep current player at front if configured
  if (keepCurrent && currentPlayer) {
    const currentIdx = shuffledOrder.indexOf(currentPlayer);
    if (currentIdx > 0) {
      shuffledOrder.splice(currentIdx, 1);
      shuffledOrder.unshift(currentPlayer);
    }
  }

  return {
    order: shuffledOrder
  };
}
