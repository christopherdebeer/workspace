/**
 * Reach State Win Condition
 *
 * Win by reaching a specific board state.
 *
 * Config (engine_mechanics.win_reach_state):
 * ```yaml
 * engine_mechanics:
 *   win_reach_state:
 *     target_state: "Victory"
 * ```
 *
 * Hooks used:
 * - onCheckWin: Check if player has reached the target state
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

interface ReachStateConfig {
  target_state: string;
}

function isReachStateConfig(config: unknown): config is ReachStateConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof (config as ReachStateConfig).target_state === 'string'
  );
}

export const reachStateWinMechanic: MechanicHooks = {
  slug: 'win-reach-state',
  name: 'Reach State Win Condition',

  configSchema: {
    type: 'object',
    description: 'Win by reaching a specific board state',
    properties: {
      target_state: {
        type: 'string',
        description: 'The board state to reach to win',
        required: true
      }
    },
    required: ['target_state']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const winConfig = ctx.config.engine_mechanics?.win_reach_state;

    // Only handle if this mechanic is configured
    if (!isReachStateConfig(winConfig)) return null;

    // Check if player has reached the target state
    if (ctx.player.state?.toLowerCase() === winConfig.target_state.toLowerCase()) {
      return {
        won: true,
        reason: `${ctx.playerId} reached ${ctx.player.state} state`
      };
    }

    return null;
  }
};
