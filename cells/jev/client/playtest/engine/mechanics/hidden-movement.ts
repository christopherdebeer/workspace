/**
 * Hidden Movement Mechanic
 *
 * Player positions are hidden from other players.
 * The hiding player tracks their true position privately.
 * Examples: Scotland Yard, Fury of Dracula, Letters from Whitechapel
 */

import {
  MechanicHooks,
  HookContext,
  VisibilityContext,
  VisibleState,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameState, PlayerState } from '../types/game';
import type { BoardHooks, PlayerMovedPayload } from './core/board-mechanic';
import type { VisibilityHooks, InfoRevealedPayload } from './core/visibility-mechanic';

export interface HiddenMovementConfig {
  hidden_players?: string[];
  hidden_roles?: string[];
  reveal_frequency?: number;
  reveal_radius?: number;
  clue_system?: ClueSystemConfig;
  fog_of_war?: boolean;
  visibility_range?: number;
}

export interface ClueSystemConfig {
  enabled: boolean;
  clue_type: 'proximity' | 'direction' | 'region';
  proximity_ranges?: { near: number; medium: number; far: number };
}

function getPlayerExtras(player: PlayerState): Record<string, unknown> {
  return player as unknown as Record<string, unknown>;
}

function isPlayerHidden(playerId: string, state: GameState, config: HiddenMovementConfig): boolean {
  if (config.hidden_players?.includes(playerId)) {
    return true;
  }

  if (config.hidden_roles) {
    const player = state.players[playerId];
    if (player) {
      const extras = getPlayerExtras(player);
      const role = extras.hiddenRole as string | undefined;
      if (role && config.hidden_roles.includes(role)) {
        return true;
      }
    }
  }

  return false;
}

function getProximityClue(
  distance: number,
  config: HiddenMovementConfig
): string {
  const ranges = config.clue_system?.proximity_ranges ?? { near: 2, medium: 5, far: 10 };

  if (distance <= ranges.near) return 'nearby';
  if (distance <= ranges.medium) return 'in the area';
  if (distance <= ranges.far) return 'somewhere in the region';
  return 'far away';
}

export const hiddenMovementMechanic: MechanicHooks & BoardHooks & VisibilityHooks = {
  slug: 'hidden-movement',
  name: 'Hidden Movement',
  requires: ['board', 'visibility'],

  getVisibleState(ctx: VisibilityContext): VisibleState | null {
    if (!isMechanicEnabled(ctx.config, 'hidden-movement')) return null;

    const config = ctx.config.engine_mechanics?.hidden_movement as HiddenMovementConfig | undefined;
    if (!config) return null;

    const filteredPlayers: Record<string, Partial<PlayerState>> = {};
    const hiddenInfo: Record<string, unknown> = {};

    for (const [playerId, player] of Object.entries(ctx.state.players)) {
      const isHidden = isPlayerHidden(playerId, ctx.state, config);

      if (isHidden && playerId !== ctx.viewerPlayerId) {
        const visiblePlayer = { ...player };
        const extras = getPlayerExtras(player);

        const lastKnown = extras.lastKnownPosition as string | undefined;
        visiblePlayer.state = lastKnown ?? 'unknown';

        delete (visiblePlayer as Record<string, unknown>).currentArea;
        delete (visiblePlayer as Record<string, unknown>).currentNode;

        if (config.clue_system?.enabled) {
          const viewerPlayer = ctx.state.players[ctx.viewerPlayerId];
          if (viewerPlayer) {
            const truePosition = extras.truePosition as string | undefined ?? player.state;
            const viewerPosition = viewerPlayer.state;
            const distance = truePosition === viewerPosition ? 0 : 5;
            hiddenInfo[`${playerId}_proximity`] = getProximityClue(distance, config);
          }
        }

        filteredPlayers[playerId] = visiblePlayer;
      } else {
        filteredPlayers[playerId] = player;
      }
    }

    return {
      players: filteredPlayers
    };
  },

  canSeeInfo(ctx: VisibilityContext, infoType: string, targetPlayerId?: string): boolean | undefined {
    if (!isMechanicEnabled(ctx.config, 'hidden-movement')) return undefined;

    const config = ctx.config.engine_mechanics?.hidden_movement as HiddenMovementConfig | undefined;
    if (!config) return undefined;

    if (infoType === 'position' || infoType === 'location' || infoType === 'state') {
      if (!targetPlayerId) return undefined;

      if (targetPlayerId === ctx.viewerPlayerId) return true;

      if (isPlayerHidden(targetPlayerId, ctx.state, config)) {
        if (config.reveal_radius !== undefined) {
          const viewer = ctx.state.players[ctx.viewerPlayerId];
          const target = ctx.state.players[targetPlayerId];

          if (viewer && target) {
            if (viewer.state === target.state) {
              return true;
            }
          }
        }

        return false;
      }
    }

    return undefined;
  },

  onInfoRevealed(ctx: HookContext, payload: InfoRevealedPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'hidden-movement')) return null;

    if (payload.infoType === 'position') {
      const player = ctx.state.players[ctx.playerId];
      if (!player) return null;

      const extras = getPlayerExtras(player);
      const truePosition = extras.truePosition as string | undefined ?? player.state;

      extras.lastKnownPosition = truePosition;
    }

    return null;
  },

  onPlayerMoved(ctx: HookContext, payload: PlayerMovedPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'hidden-movement')) return null;

    const config = ctx.config.engine_mechanics?.hidden_movement as HiddenMovementConfig | undefined;
    if (!config) return null;

    if (isPlayerHidden(ctx.playerId, ctx.state, config)) {
      const player = ctx.state.players[ctx.playerId];
      if (player) {
        const extras = getPlayerExtras(player);
        extras.truePosition = payload.toState;
      }
    }

    return null;
  },

  describeAction() {
    return null;
  },

  configSchema: {
    type: 'object',
    description: 'Player positions hidden from other players.'
  }
};
