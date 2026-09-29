/**
 * Turn Order Time Track Mechanic
 *
 * Players on a time track - player furthest back goes next.
 * Actions cost time, moving player forward on track.
 *
 * Config:
 *   turn_order_time_track:
 *     starting_position: number     # Starting time position
 *     max_position: number          # End of time track (game end trigger)
 *     default_time_cost: number     # Default time cost per action
 *
 * Hooks used:
 * - initPlayerState: Initialize time position
 * - onDetermineTurnOrder: Return player furthest back
 * - postExecuteAction: Advance time after action
 */

import { MechanicHooks, PlayerInitContext, PlayerInitResult, TurnOrderContext, TurnOrderResult, HookContext, StateChanges, AvailableAction } from './types';
import { GameAction, TurnOrderTimeTrackConfig } from '../types/game';

export const turnOrderTimeTrackMechanic: MechanicHooks = {
  slug: 'turn-order-time-track',
  name: 'Turn Order: Time Track',

  configSchema: {
    type: 'object',
    description: 'Time track based turn order (furthest back goes next)',
    properties: {
      starting_position: {
        type: 'number',
        description: 'Starting position on time track',
        default: 0
      },
      max_position: {
        type: 'number',
        description: 'Maximum position (triggers game end)',
        default: 100
      },
      default_time_cost: {
        type: 'number',
        description: 'Default time cost per action',
        default: 1
      }
    }
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = ctx.config.engine_mechanics?.turn_order_time_track;
    if (!config) return null;

    return {
      timePosition: config.starting_position ?? 0
    };
  },

  onDetermineTurnOrder(ctx: TurnOrderContext): TurnOrderResult | null {
    const config = ctx.config.engine_mechanics?.turn_order_time_track;
    if (!config) return null;

    // Time track determines order dynamically - furthest back goes next
    const activePlayers = ctx.currentOrder.filter(
      pid => ctx.state.players[pid].state !== 'eliminated'
    );

    // Sort by time position (ascending - lowest/furthest back first)
    const sorted = [...activePlayers].sort((a, b) => {
      const posA = ctx.state.players[a].timePosition ?? 0;
      const posB = ctx.state.players[b].timePosition ?? 0;

      if (posA !== posB) return posA - posB;

      // Tie breaker: original turn order
      return ctx.currentOrder.indexOf(a) - ctx.currentOrder.indexOf(b);
    });

    return { order: sorted };
  },

  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    const config = ctx.config.engine_mechanics?.turn_order_time_track;
    if (!config) return null;

    // Skip certain action types that shouldn't cost time
    if (action.type === 'pass') {
      return null;
    }

    // Get time cost from action or use default
    const timeCost = (action as { timeCost?: number }).timeCost ?? config.default_time_cost ?? 1;

    if (timeCost <= 0) return null;

    const currentPosition = ctx.player.timePosition ?? 0;
    const newPosition = currentPosition + timeCost;
    const maxPosition = config.max_position ?? 100;

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          timePosition: Math.min(newPosition, maxPosition)
        }
      },
      sharedStateChanges: {
        timeTrackUpdated: true
      }
    };
  },

  getAvailableActions(): AvailableAction[] {
    // This mechanic doesn't provide actions, it modifies turn order
    return [];
  }
};
