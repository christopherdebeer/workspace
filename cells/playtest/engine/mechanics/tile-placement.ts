/**
 * Tile Placement Mechanic
 *
 * Place tiles on a board to build the game map. Tiles must match adjacency constraints.
 * Requires building core mechanic for build hooks.
 *
 * Hooks used:
 * - initSharedState: Create tile supply, initialize board grid
 * - getAvailableActions: 'place_tile' with valid positions
 * - onExecuteAction: Place tile, check adjacency, score
 * - getPlayerView: Show available tiles and board
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  SharedStateInitContext,
  SharedStateInitResult,
  StateChanges,
  PlayerInitContext,
  PlayerInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface TileDefinition {
  id: string;
  edges?: string[];   // Edge labels for matching (e.g., ['road', 'field', 'road', 'city'])
  points?: number;    // Points awarded when placed
}

interface TilePlacementConfig {
  tiles: TileDefinition[];
  supply_count?: number;         // Total tiles in supply
  hand_size?: number;            // Tiles in hand to choose from
  adjacency_required?: boolean;  // Must place adjacent to existing (default true)
  edge_matching?: boolean;       // Edges must match neighbors (default false)
  grid_type?: 'square' | 'hex';
}

interface PlacedTile {
  tileId: string;
  position: string;      // "x,y" coordinate string
  placedBy: string;      // playerId
  edges?: string[];
}

interface TilePlacementState {
  grid: Record<string, PlacedTile>;   // position -> placed tile
  tileSupply: TileDefinition[];       // Remaining tiles to draw
  gridType: 'square' | 'hex';
}

function getConfig(config: GameConfig): TilePlacementConfig | undefined {
  return config.engine_mechanics?.tile_placement as TilePlacementConfig | undefined;
}

function getTileState(shared: Record<string, unknown>): TilePlacementState | undefined {
  return shared.tilePlacement as TilePlacementState | undefined;
}

function parsePosition(pos: string): { x: number; y: number } {
  const [xStr, yStr] = pos.split(',');
  return { x: parseInt(xStr, 10), y: parseInt(yStr, 10) };
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Get adjacent positions for square or hex grids
 */
function getAdjacentPositions(pos: string, gridType: 'square' | 'hex'): string[] {
  const { x, y } = parsePosition(pos);

  if (gridType === 'hex') {
    // Hex grid: 6 neighbors (offset coordinates)
    const isEvenRow = y % 2 === 0;
    if (isEvenRow) {
      return [
        positionKey(x - 1, y), positionKey(x + 1, y),     // left, right
        positionKey(x - 1, y - 1), positionKey(x, y - 1), // upper-left, upper-right
        positionKey(x - 1, y + 1), positionKey(x, y + 1)  // lower-left, lower-right
      ];
    } else {
      return [
        positionKey(x - 1, y), positionKey(x + 1, y),     // left, right
        positionKey(x, y - 1), positionKey(x + 1, y - 1), // upper-left, upper-right
        positionKey(x, y + 1), positionKey(x + 1, y + 1)  // lower-left, lower-right
      ];
    }
  }

  // Square grid: 4 neighbors
  return [
    positionKey(x, y - 1),  // up
    positionKey(x + 1, y),  // right
    positionKey(x, y + 1),  // down
    positionKey(x - 1, y)   // left
  ];
}

/**
 * Check if edges match between a tile and its neighbor at a given direction index
 */
function edgesMatch(
  tileEdges: string[] | undefined,
  neighborEdges: string[] | undefined,
  tileDirection: number,
  neighborDirection: number
): boolean {
  if (!tileEdges || !neighborEdges) return true; // No edges = always match
  if (tileDirection >= tileEdges.length || neighborDirection >= neighborEdges.length) return true;
  return tileEdges[tileDirection] === neighborEdges[neighborDirection];
}

/**
 * Get valid placement positions
 */
function getValidPositions(
  tileState: TilePlacementState,
  config: TilePlacementConfig,
  tile: TileDefinition
): string[] {
  const adjacencyRequired = config.adjacency_required !== false;
  const edgeMatching = config.edge_matching === true;
  const occupied = new Set(Object.keys(tileState.grid));

  // If grid is empty, allow placing at origin
  if (occupied.size === 0) {
    return ['0,0'];
  }

  // Find all positions adjacent to existing tiles
  const candidates = new Set<string>();
  for (const pos of occupied) {
    const adjacent = getAdjacentPositions(pos, tileState.gridType);
    for (const adj of adjacent) {
      if (!occupied.has(adj)) {
        candidates.add(adj);
      }
    }
  }

  if (!adjacencyRequired) {
    // Add some extra positions around the bounding box
    const positions = Array.from(occupied).map(parsePosition);
    const minX = Math.min(...positions.map(p => p.x)) - 1;
    const maxX = Math.max(...positions.map(p => p.x)) + 1;
    const minY = Math.min(...positions.map(p => p.y)) - 1;
    const maxY = Math.max(...positions.map(p => p.y)) + 1;

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = positionKey(x, y);
        if (!occupied.has(key)) {
          candidates.add(key);
        }
      }
    }
  }

  // Filter by edge matching if required
  if (edgeMatching && tile.edges) {
    const validPositions: string[] = [];
    for (const pos of candidates) {
      const adjacentPositions = getAdjacentPositions(pos, tileState.gridType);
      let allMatch = true;

      for (let dir = 0; dir < adjacentPositions.length; dir++) {
        const neighbor = tileState.grid[adjacentPositions[dir]];
        if (!neighbor) continue;

        // Opposite direction index
        const oppositeDir = (dir + adjacentPositions.length / 2) % adjacentPositions.length;
        if (!edgesMatch(tile.edges, neighbor.edges, dir, Math.floor(oppositeDir))) {
          allMatch = false;
          break;
        }
      }

      if (allMatch) {
        validPositions.push(pos);
      }
    }
    return validPositions;
  }

  return Array.from(candidates);
}

function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const tilePlacementMechanic: MechanicHooks = {
  slug: 'tile-placement',
  name: 'Tile Placement',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Place tiles on a board to build the game map',
    properties: {
      tiles: {
        type: 'array',
        description: 'Tile definitions with id, edges, and points',
        required: true
      },
      supply_count: {
        type: 'number',
        description: 'Total tiles in the supply'
      },
      hand_size: {
        type: 'number',
        description: 'Tiles in hand to choose from',
        default: 1
      },
      adjacency_required: {
        type: 'boolean',
        description: 'Must place adjacent to existing tiles',
        default: true
      },
      edge_matching: {
        type: 'boolean',
        description: 'Edges must match neighboring tiles',
        default: false
      },
      grid_type: {
        type: 'string',
        description: 'Grid type for the board',
        enum: ['square', 'hex'],
        default: 'square'
      }
    },
    required: ['tiles']
  },

  /**
   * Create tile supply and initialize board grid
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.tiles?.length) return null;

    // Build tile supply
    let tileSupply: TileDefinition[] = [];
    const supplyCount = config.supply_count ?? config.tiles.length;

    // Repeat tiles to fill supply count
    while (tileSupply.length < supplyCount) {
      for (const tile of config.tiles) {
        if (tileSupply.length >= supplyCount) break;
        tileSupply.push({ ...tile });
      }
    }

    // Shuffle the supply
    tileSupply = shuffleArray(tileSupply);

    const tileState: TilePlacementState = {
      grid: {},
      tileSupply,
      gridType: config.grid_type ?? 'square'
    };

    return { tilePlacement: tileState };
  },

  /**
   * Give each player starting tiles from supply
   */
  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config?.tiles?.length) return null;

    const handSize = config.hand_size ?? 1;

    // Draw tiles from supply for this player's hand
    // Note: actual tiles are tracked in shared state; player just has tile IDs
    const tileHand: string[] = [];
    for (let i = 0; i < handSize; i++) {
      const tileIndex = ctx.playerIndex * handSize + i;
      if (tileIndex < (config.supply_count ?? config.tiles.length)) {
        tileHand.push(config.tiles[tileIndex % config.tiles.length].id);
      }
    }

    return { tileHand };
  },

  /**
   * Provide 'place_tile' actions with valid positions
   */
  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'tile-placement')) return [];

    const config = getConfig(ctx.config);
    if (!config?.tiles?.length) return [];

    const tileState = getTileState(ctx.state.shared);
    if (!tileState) return [];

    const actions: AvailableAction[] = [];

    // Get player's tile hand
    const tileHand = (ctx.player as unknown as { tileHand?: string[] }).tileHand ?? [];
    if (tileHand.length === 0 && tileState.tileSupply.length === 0) return [];

    // For each tile in hand, find valid positions
    const tilesToPlace = tileHand.length > 0
      ? tileHand
      : [tileState.tileSupply[0]?.id].filter(Boolean);

    for (const tileId of tilesToPlace) {
      const tileDef = config.tiles.find(t => t.id === tileId);
      if (!tileDef) continue;

      const validPositions = getValidPositions(tileState, config, tileDef);

      // Add an action for each valid position (limit to first few to avoid explosion)
      const positionsToShow = validPositions.slice(0, 10);
      for (const position of positionsToShow) {
        actions.push({
          action: {
            type: 'place_tile',
            tileId,
            position
          } as unknown as GameAction,
          priority: 55,
          category: 'tile-placement'
        });
      }
    }

    return actions;
  },

  /**
   * Handle tile placement, check adjacency, score
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'place_tile') return null;

    const config = getConfig(ctx.config);
    if (!config?.tiles?.length) return null;

    const placeAction = ctx.action as unknown as { type: 'place_tile'; tileId: string; position: string };
    const tileState = getTileState(ctx.state.shared);
    if (!tileState) return null;

    // Find tile definition
    const tileDef = config.tiles.find(t => t.id === placeAction.tileId);
    if (!tileDef) {
      return {
        handled: true,
        logMessage: `Unknown tile: ${placeAction.tileId}`,
        advanceTurn: false,
        checkWin: false
      };
    }

    // Check position is valid
    const validPositions = getValidPositions(tileState, config, tileDef);
    if (!validPositions.includes(placeAction.position)) {
      return {
        handled: true,
        logMessage: `Invalid position: ${placeAction.position}. Valid: ${validPositions.slice(0, 5).join(', ')}`,
        advanceTurn: false,
        checkWin: false
      };
    }

    // Place the tile
    const placedTile: PlacedTile = {
      tileId: placeAction.tileId,
      position: placeAction.position,
      placedBy: ctx.playerId,
      edges: tileDef.edges
    };

    const updatedGrid = { ...tileState.grid, [placeAction.position]: placedTile };

    // Remove tile from player's hand
    const tileHand = [...((ctx.player as unknown as { tileHand?: string[] }).tileHand ?? [])];
    const tileIndex = tileHand.indexOf(placeAction.tileId);
    if (tileIndex !== -1) {
      tileHand.splice(tileIndex, 1);
    }

    // Draw a new tile from supply if available
    const updatedSupply = [...tileState.tileSupply];
    if (updatedSupply.length > 0) {
      const drawnTile = updatedSupply.shift()!;
      tileHand.push(drawnTile.id);
    }

    // Score points for placement
    const points = tileDef.points ?? 0;
    const currentScore = ctx.player.score ?? 0;

    const stateChanges: StateChanges = {
      sharedStateChanges: {
        tilePlacement: {
          grid: updatedGrid,
          tileSupply: updatedSupply,
          gridType: tileState.gridType
        }
      },
      playerStateChanges: {
        [ctx.playerId]: {
          ...(points > 0 ? { score: currentScore + points } : {}),
          tileHand
        } as Record<string, unknown>
      }
    };

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: true,
      logMessage: 'tile_placed',
      logData: {
        player: ctx.playerId,
        tile: placeAction.tileId,
        position: placeAction.position,
        points,
        tilesRemaining: updatedSupply.length
      }
    };
  },

  /**
   * Show available tiles and board state
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'tile-placement')) return null;

    const tileState = getTileState(ctx.state.shared);
    if (!tileState) return null;

    const tileHand = (ctx.player as unknown as { tileHand?: string[] }).tileHand ?? [];

    // Build a summary of the grid
    const placedTiles = Object.entries(tileState.grid).map(([position, tile]) => ({
      position,
      tileId: tile.tileId,
      placedBy: tile.placedBy
    }));

    return {
      tileHand,
      gridType: tileState.gridType,
      placedTileCount: placedTiles.length,
      placedTiles,
      tilesRemainingInSupply: tileState.tileSupply.length
    };
  }
};
