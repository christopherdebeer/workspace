/**
 * Map Addition Mechanic
 *
 * Expand the play area with new tiles/sections during gameplay.
 * Players can place new map tiles that extend the board.
 *
 * Hooks used:
 * - initSharedState: Create expandable map
 * - getAvailableActions: 'add_map_tile'
 * - onExecuteAction: Place new tile
 * - getPlayerView: Show map
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

interface MapTile {
  id: string;
  type: string;
  position: string;  // "r,c"
  placedBy: string | null;
}

interface MapAdditionConfig {
  tile_types?: string[];
  tiles_per_player?: number;
  points_per_tile?: number;
}

interface MapAdditionState {
  placedTiles: MapTile[];
  availableTileTypes: string[];
  tilesRemaining: Record<string, number>; // playerId -> tiles left
}

function getConfig(config: GameConfig): MapAdditionConfig | undefined {
  return config.engine_mechanics?.map_addition as MapAdditionConfig | undefined;
}

function getMapState(shared: Record<string, unknown>): MapAdditionState | undefined {
  return shared.mapAddition as MapAdditionState | undefined;
}

export const mapAdditionMechanic: MechanicHooks = {
  slug: 'map-addition',
  name: 'Map Addition',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Expand play area with new tiles',
    properties: {
      tile_types: { type: 'array', default: ['forest', 'mountain', 'plains', 'water'] },
      tiles_per_player: { type: 'number', default: 5 },
      points_per_tile: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const tileTypes = config.tile_types ?? ['forest', 'mountain', 'plains', 'water'];
    const tilesPerPlayer = config.tiles_per_player ?? 5;
    const tilesRemaining: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      tilesRemaining[pid] = tilesPerPlayer;
    }

    return {
      mapAddition: {
        placedTiles: [],
        availableTileTypes: tileTypes,
        tilesRemaining
      } as MapAdditionState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'map-addition')) return [];

    const mapState = getMapState(ctx.state.shared);
    if (!mapState) return [];

    const remaining = mapState.tilesRemaining[ctx.playerId] ?? 0;
    if (remaining <= 0) return [];

    return [{
      action: {
        type: 'add_map_tile',
        tileType: '',
        position: ''
      } as unknown as GameAction,
      priority: 50,
      category: 'map-addition'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'add_map_tile') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const mapState = getMapState(ctx.state.shared);
    if (!mapState) return null;

    const addAction = ctx.action as unknown as { type: 'add_map_tile'; tileType: string; position: string };
    const remaining = mapState.tilesRemaining[ctx.playerId] ?? 0;

    if (remaining <= 0) {
      return { handled: true, logMessage: 'No tiles remaining.', advanceTurn: false, checkWin: false };
    }

    // Check if position is already occupied
    if (mapState.placedTiles.some(t => t.position === addAction.position)) {
      return { handled: true, logMessage: 'Position already has a tile.', advanceTurn: false, checkWin: false };
    }

    const newTile: MapTile = {
      id: `tile-${mapState.placedTiles.length + 1}`,
      type: addAction.tileType || mapState.availableTileTypes[0] || 'plains',
      position: addAction.position,
      placedBy: ctx.playerId
    };

    const points = config.points_per_tile ?? 1;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          mapAddition: {
            ...mapState,
            placedTiles: [...mapState.placedTiles, newTile],
            tilesRemaining: {
              ...mapState.tilesRemaining,
              [ctx.playerId]: remaining - 1
            }
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + points }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} added a ${newTile.type} tile at ${addAction.position}.`,
      logData: { player: ctx.playerId, tileType: newTile.type, position: addAction.position }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'map-addition')) return null;

    const mapState = getMapState(ctx.state.shared);
    if (!mapState) return null;

    return {
      mapTiles: mapState.placedTiles,
      tilesRemaining: mapState.tilesRemaining[ctx.playerId] ?? 0,
      availableTileTypes: mapState.availableTileTypes
    };
  }
};
