/**
 * King of the Hill Win Condition
 *
 * Win by controlling a specific location/area. Check if player occupies
 * the target position. Optionally requires holding the position for
 * multiple consecutive turns.
 *
 * Config (engine_mechanics.win_king_of_the_hill):
 * ```yaml
 * engine_mechanics:
 *   win_king_of_the_hill:
 *     target_state: "Throne"
 *     turns_required: 3
 * ```
 *
 * Hooks used:
 * - onCheckWin: Check if player is at target state/position for required turns
 */

import {
  MechanicHooks,
  WinCheckContext,
  WinCheckResult
} from '../types';

interface KingOfTheHillConfig {
  target_state?: string;
  target_position?: string;
  turns_required?: number;
}

function isKingOfTheHillConfig(config: unknown): config is KingOfTheHillConfig {
  return (
    typeof config === 'object' &&
    config !== null
  );
}

export const kingOfTheHillMechanic: MechanicHooks = {
  slug: 'win-king-of-the-hill',
  name: 'King of the Hill Win Condition',

  configSchema: {
    type: 'object',
    description: 'Win by controlling a specific location/area',
    properties: {
      target_state: {
        type: 'string',
        description: 'Board state/location to control'
      },
      target_position: {
        type: 'string',
        description: 'Position to hold'
      },
      turns_required: {
        type: 'number',
        description: 'Consecutive turns you must hold the position',
        default: 1
      }
    }
  },

  onCheckWin(ctx: WinCheckContext): WinCheckResult | null {
    const config = ctx.config.engine_mechanics?.win_king_of_the_hill;

    // Only handle if this mechanic is configured
    if (!isKingOfTheHillConfig(config)) return null;

    const target = config.target_state || config.target_position;
    if (!target) return null;

    const currentState = ctx.player.state;
    const isAtTarget = currentState === target;

    if (!isAtTarget) {
      return null;
    }

    const turnsRequired = config.turns_required ?? 1;

    if (turnsRequired <= 1) {
      // Just being at the target is enough
      return {
        won: true,
        reason: `${ctx.playerId} controls ${target}`
      };
    }

    // Check consecutive turns held from shared state
    const hillControl = ctx.state.shared?.hillControl as
      Record<string, { player: string; turns: number }> | undefined;
    const targetControl = hillControl?.[target];

    if (targetControl && targetControl.player === ctx.playerId && targetControl.turns >= turnsRequired) {
      return {
        won: true,
        reason: `${ctx.playerId} held ${target} for ${targetControl.turns} consecutive turns`
      };
    }

    return null;
  }
};
