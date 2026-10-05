/**
 * Grid Coverage Mechanic
 *
 * Place pieces to cover grid spaces. Control territory by covering more area.
 * Think Blokus, Patchwork.
 *
 * Hooks used:
 * - initSharedState: Create coverage grid
 * - getAvailableActions: 'cover_space'
 * - onExecuteAction: Place covering piece
 * - getPlayerView: Show coverage
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

interface GridCoverageConfig {
  grid_size?: number;
  points_per_cell?: number;
  pieces_per_player?: number;
}

interface CoverageState {
  grid: Record<string, string | null>; // "x,y" -> playerId or null
  gridSize: number;
  piecesUsed: Record<string, number>; // playerId -> pieces used
}

function getConfig(config: GameConfig): GridCoverageConfig | undefined {
  return config.engine_mechanics?.grid_coverage as GridCoverageConfig | undefined;
}

function getCoverageState(shared: Record<string, unknown>): CoverageState | undefined {
  return shared.gridCoverage as CoverageState | undefined;
}

export const gridCoverageMechanic: MechanicHooks = {
  slug: 'grid-coverage',
  name: 'Grid Coverage',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Cover grid spaces to control territory',
    properties: {
      grid_size: { type: 'number', default: 10 },
      points_per_cell: { type: 'number', default: 1 },
      pieces_per_player: { type: 'number', default: 15 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const size = config.grid_size ?? 10;
    const grid: Record<string, string | null> = {};
    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        grid[`${x},${y}`] = null;
      }
    }

    const piecesUsed: Record<string, number> = {};
    for (const pid of ctx.playerIds) {
      piecesUsed[pid] = 0;
    }

    return {
      gridCoverage: { grid, gridSize: size, piecesUsed } as CoverageState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'grid-coverage')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const covState = getCoverageState(ctx.state.shared);
    if (!covState) return [];

    const maxPieces = config.pieces_per_player ?? 15;
    const used = covState.piecesUsed[ctx.playerId] ?? 0;
    if (used >= maxPieces) return [];

    return [{
      action: {
        type: 'cover_space',
        x: 0,
        y: 0
      } as unknown as GameAction,
      priority: 55,
      category: 'grid-coverage'
    }];
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'cover_space') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const covState = getCoverageState(ctx.state.shared);
    if (!covState) return null;

    const coverAction = ctx.action as unknown as { type: 'cover_space'; x: number; y: number };
    const key = `${coverAction.x},${coverAction.y}`;

    if (covState.grid[key] !== null && covState.grid[key] !== undefined) {
      return { handled: true, logMessage: 'Space already covered.', advanceTurn: false, checkWin: false };
    }

    if (coverAction.x < 0 || coverAction.x >= covState.gridSize ||
        coverAction.y < 0 || coverAction.y >= covState.gridSize) {
      return { handled: true, logMessage: 'Out of grid bounds.', advanceTurn: false, checkWin: false };
    }

    const points = config.points_per_cell ?? 1;

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          gridCoverage: {
            ...covState,
            grid: { ...covState.grid, [key]: ctx.playerId },
            piecesUsed: {
              ...covState.piecesUsed,
              [ctx.playerId]: (covState.piecesUsed[ctx.playerId] ?? 0) + 1
            }
          }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + points }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} covered (${coverAction.x}, ${coverAction.y}).`,
      logData: { player: ctx.playerId, x: coverAction.x, y: coverAction.y }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'grid-coverage')) return null;

    const covState = getCoverageState(ctx.state.shared);
    if (!covState) return null;

    const myCoverage = Object.entries(covState.grid)
      .filter(([, owner]) => owner === ctx.playerId)
      .map(([cell]) => cell);

    return {
      coveredSpaces: myCoverage.length,
      piecesUsed: covState.piecesUsed[ctx.playerId] ?? 0,
      gridSize: covState.gridSize
    };
  }
};
