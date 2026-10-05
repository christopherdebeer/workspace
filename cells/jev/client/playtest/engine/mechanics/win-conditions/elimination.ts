/**
 * Elimination Win Condition
 *
 * Win by being the last player standing (all opponents eliminated).
 *
 * Config (engine_mechanics.win_elimination):
 * ```yaml
 * engine_mechanics:
 *   win_elimination: true
 * ```
 *
 * A player is considered eliminated if:
 * - They have an effect with type "eliminated"
 * - Their state is "eliminated"
 *
 * Can be composed with other win conditions.
 *
 * Hooks used:
 * - onCheckWin: Check if player is the last one standing
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

function isPlayerEliminated(player: { effects?: Array<{ type: string }>; state?: string }): boolean {
  const hasEliminatedEffect = player.effects?.some(e => e.type === 'eliminated') ?? false;
  const inEliminatedState = player.state === 'eliminated';
  return hasEliminatedEffect || inEliminatedState;
}

export const eliminationWinMechanic: MechanicHooks = {
  slug: 'win-elimination',
  name: 'Elimination Win Condition',

  configSchema: {
    type: 'boolean',
    description: 'Win by being the last player standing'
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const winConfig = ctx.config.engine_mechanics?.win_elimination;

    // Only handle if this mechanic is enabled
    if (!winConfig) return null;

    // Get active (non-eliminated) players
    const activePlayers = ctx.state.turnOrder.filter(pid => {
      const player = ctx.state.players[pid];
      return player && !isPlayerEliminated(player);
    });

    // Check if this player is the last one standing
    if (activePlayers.length === 1 && activePlayers[0] === ctx.playerId) {
      return {
        won: true,
        reason: `${ctx.playerId} is the last player standing`
      };
    }

    return null;
  }
};
