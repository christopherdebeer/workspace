/**
 * Victory Points as Resource Win Condition
 *
 * Victory points are tracked as a spendable resource. Players can spend VP
 * for actions but need VP to win. Checks if player's VP resource meets
 * or exceeds the configured threshold.
 *
 * Config (engine_mechanics.win_victory_points_as_resource):
 * ```yaml
 * engine_mechanics:
 *   win_victory_points_as_resource:
 *     vp_resource: "victory_points"
 *     threshold: 10
 *     spendable: true
 * ```
 *
 * Hooks used:
 * - onCheckWin: Check if player's VP resource >= threshold
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

interface VPAsResourceConfig {
  vp_resource: string;
  threshold: number;
  spendable?: boolean;
}

function isVPAsResourceConfig(config: unknown): config is VPAsResourceConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    typeof (config as VPAsResourceConfig).vp_resource === 'string' &&
    typeof (config as VPAsResourceConfig).threshold === 'number'
  );
}

export const victoryPointsAsResourceMechanic: MechanicHooks = {
  slug: 'win-victory-points-as-resource',
  name: 'Victory Points as Resource Win Condition',

  configSchema: {
    type: 'object',
    description: 'Victory points tracked as a spendable resource',
    properties: {
      vp_resource: {
        type: 'string',
        description: 'Name of the VP resource (e.g. "victory_points")',
        required: true
      },
      threshold: {
        type: 'number',
        description: 'VP needed to win',
        required: true
      },
      spendable: {
        type: 'boolean',
        description: 'Whether VP can be spent on actions',
        default: true
      }
    },
    required: ['vp_resource', 'threshold']
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = ctx.config.engine_mechanics?.win_victory_points_as_resource;

    // Only handle if this mechanic is configured
    if (!isVPAsResourceConfig(config)) return null;

    // Check if player has the VP resource
    const vpAmount = ctx.player.resources?.[config.vp_resource] ?? 0;

    if (vpAmount >= config.threshold) {
      return {
        won: true,
        reason: `${ctx.playerId} reached ${vpAmount} ${config.vp_resource} (threshold: ${config.threshold})`
      };
    }

    return null;
  }
};
