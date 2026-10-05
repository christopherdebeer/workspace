/**
 * Empty Hand Win Condition
 *
 * Win by emptying your hand (like UNO).
 *
 * Config (engine_mechanics.win_empty_hand):
 * ```yaml
 * engine_mechanics:
 *   win_empty_hand: true
 * ```
 *
 * Can be composed with other win conditions.
 *
 * Hooks used:
 * - onCheckWin: Check if player has no cards in hand
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

export const emptyHandWinMechanic: MechanicHooks = {
  slug: 'win-empty-hand',
  name: 'Empty Hand Win Condition',

  configSchema: {
    type: 'boolean',
    description: 'Win by emptying your hand'
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const winConfig = ctx.config.engine_mechanics?.win_empty_hand;

    // Only handle if this mechanic is enabled
    if (!winConfig) return null;

    // Check if player has emptied their hand
    if ((ctx.player.hand ?? []).length === 0) {
      return {
        won: true,
        reason: `${ctx.playerId} emptied their hand`
      };
    }

    return null;
  }
};
