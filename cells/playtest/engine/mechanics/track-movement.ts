/**
 * Track Movement Mechanic
 *
 * Movement along fixed linear or branching tracks. Players advance along
 * predefined paths.
 *
 * Hooks used:
 * - initSharedState: Create track
 * - getAvailableActions: 'advance_track'
 * - onExecuteAction: Move along track
 * - getPlayerView: Show track position
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

interface TrackConfig {
  track_length?: number;
  points_per_space?: number;
  loop?: boolean;
}

interface TrackState {
  trackLength: number;
  positions: Record<string, number>; // playerId -> position
  loop: boolean;
}

function getConfig(config: GameConfig): TrackConfig | undefined {
  return config.engine_mechanics?.track_movement as TrackConfig | undefined;
}

function getTrackState(shared: Record<string, unknown>): TrackState | undefined {
  return shared.trackMovement as TrackState | undefined;
}

export const trackMovementMechanic: MechanicHooks = {
  slug: 'track-movement',
  name: 'Track Movement',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Movement along fixed linear tracks',
    properties: {
      track_length: { type: 'number', default: 20 },
      points_per_space: { type: 'number', default: 0 },
      loop: { type: 'boolean', default: false }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const positions: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      positions[pid] = 0;
    }

    return {
      trackMovement: {
        trackLength: config.track_length ?? 20,
        positions,
        loop: config.loop ?? false
      } as TrackState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'track-movement')) return [];

    const tState = getTrackState(ctx.state.shared);
    if (!tState) return [];

    const pos = tState.positions[ctx.playerId] ?? 0;
    if (!tState.loop && pos >= tState.trackLength - 1) return [];

    return [{
      action: {
        type: 'advance_track',
        spaces: 1
      } as unknown as GameAction,
      priority: 55,
      category: 'movement'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'advance_track') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const tState = getTrackState(ctx.state.shared);
    if (!tState) return null;

    const advAction = ctx.action as unknown as { type: 'advance_track'; spaces: number };
    const spaces = advAction.spaces ?? 1;
    const currentPos = tState.positions[ctx.playerId] ?? 0;
    let newPos = currentPos + spaces;

    if (tState.loop) {
      newPos = newPos % tState.trackLength;
    } else {
      newPos = Math.min(newPos, tState.trackLength - 1);
    }

    const pointsPerSpace = config.points_per_space ?? 0;
    const pointsGained = pointsPerSpace * spaces;
    const reachedEnd = !tState.loop && newPos >= tState.trackLength - 1;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          trackMovement: {
            ...tState,
            positions: { ...tState.positions, [ctx.playerId]: newPos }
          }
        },
        ...(pointsGained !== 0 ? {
          playerStateChanges: {
            [ctx.playerId]: { score: (ctx.player.score ?? 0) + pointsGained }
          }
        } : {})
      },
      advanceTurn: false,
      checkWin: reachedEnd,
      logMessage: `${ctx.playerId} advanced to position ${newPos}${reachedEnd ? ' (end of track!)' : ''}.`,
      logData: { player: ctx.playerId, from: currentPos, to: newPos, reachedEnd }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'track-movement')) return null;

    const tState = getTrackState(ctx.state.shared);
    if (!tState) return null;

    return {
      trackPosition: tState.positions[ctx.playerId] ?? 0,
      trackLength: tState.trackLength,
      allTrackPositions: tState.positions
    };
  }
};
