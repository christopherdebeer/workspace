/**
 * Tug of War Mechanic
 *
 * Bidirectional marker on a track. Players push in opposite directions.
 * Win by reaching your end.
 *
 * Hooks used:
 * - initSharedState: Create tug-of-war track
 * - getAvailableActions: 'push' action
 * - onExecuteAction: Move marker
 * - getPlayerView: Show marker position
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface TugConfig {
  track_length?: number;
  push_strength?: number;
}

interface TugState {
  markerPosition: number;  // 0 = center, negative = player1 side, positive = player2 side
  trackLength: number;
}

function getConfig(config: GameConfig): TugConfig | undefined {
  return config.engine_mechanics?.tug_of_war as TugConfig | undefined;
}

function getTugState(shared: Record<string, unknown>): TugState | undefined {
  return shared.tugOfWar as TugState | undefined;
}

export const tugOfWarMechanic: MechanicHooks = {
  slug: 'tug-of-war',
  name: 'Tug of War',

  configSchema: {
    type: 'object',
    description: 'Bidirectional marker pushed by opposing forces',
    properties: {
      track_length: { type: 'number', default: 10 },
      push_strength: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      tugOfWar: {
        markerPosition: 0,
        trackLength: config.track_length ?? 10
      } as TugState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'tug-of-war')) return [];

    const tugState = getTugState(ctx.state.shared);
    if (!tugState) return [];

    return [{
      action: {
        type: 'tug_push',
        strength: 1
      } as unknown as GameAction,
      priority: 60,
      category: 'tug-of-war'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'tug_push') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const tugState = getTugState(ctx.state.shared);
    if (!tugState) return null;

    const pushAction = ctx.action as unknown as { type: 'tug_push'; strength: number };
    const strength = pushAction.strength ?? (config.push_strength ?? 1);

    // First player pushes positive, second pushes negative
    const playerIndex = ctx.state.turnOrder.indexOf(ctx.playerId);
    const direction = playerIndex % 2 === 0 ? 1 : -1;
    const newPosition = tugState.markerPosition + (strength * direction);
    const halfTrack = Math.floor(tugState.trackLength / 2);
    const clampedPosition = Math.max(-halfTrack, Math.min(halfTrack, newPosition));
    const reachedEnd = Math.abs(clampedPosition) >= halfTrack;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          tugOfWar: { ...tugState, markerPosition: clampedPosition }
        },
        ...(reachedEnd ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + 10 }
          }
        } : {})
      },
      advanceTurn: false,
      checkWin: reachedEnd,
      logMessage: `${ctx.playerId} pushed! Marker at ${clampedPosition}.${reachedEnd ? ' End reached!' : ''}`,
      logData: { player: ctx.playerId, position: clampedPosition, direction, reachedEnd }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'tug-of-war')) return null;

    const tugState = getTugState(ctx.state.shared);
    if (!tugState) return null;

    const playerIndex = ctx.state.turnOrder.indexOf(ctx.playerId);
    return {
      tugPosition: tugState.markerPosition,
      tugTrackLength: tugState.trackLength,
      pushDirection: playerIndex % 2 === 0 ? 'positive' : 'negative'
    };
  }
};
