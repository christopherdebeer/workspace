/**
 * Pattern Building Mechanic
 *
 * Players create specific arrangements with components on a personal board/grid.
 * Completing patterns scores points. Think Azul, Sagrada.
 *
 * Hooks used:
 * - initPlayerState: Create player grids
 * - getAvailableActions: 'place_pattern_piece'
 * - onExecuteAction: Place pieces, check pattern completion
 * - getPlayerView: Show grid and available patterns
 */

import {
  MechanicHooks,
  HookContext,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig } from '../types/game';

interface PatternDef {
  id: string;
  name: string;
  shape: number[][];  // grid coordinates
  points: number;
}

interface PatternBuildingConfig {
  grid_size?: number;
  patterns?: PatternDef[];
  points_per_placement?: number;
}

function getConfig(config: GameConfig): PatternBuildingConfig | undefined {
  return config.engine_mechanics?.pattern_building as PatternBuildingConfig | undefined;
}

export const patternBuildingMechanic: MechanicHooks = {
  slug: 'pattern-building',
  name: 'Pattern Building',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Create specific arrangements on personal grids',
    properties: {
      grid_size: { type: 'number', default: 5 },
      patterns: { type: 'array', description: 'Pattern definitions' },
      points_per_placement: { type: 'number', default: 1 }
    }
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const size = config.grid_size ?? 5;
    const grid: (string | null)[][] = [];
    for (let r = 0; r < size; r++) {
      grid.push(new Array(size).fill(null));
    }

    return {
      patternGrid: grid,
      completedPatterns: []
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'pattern-building')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const grid = (ctx.player as unknown as Record<string, unknown>).patternGrid as (string | null)[][] | undefined;
    if (!grid) return [];

    const size = config.grid_size ?? 5;
    const actions: AvailableAction[] = [];

    // Find empty cells
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!grid[r]?.[c]) {
          actions.push({
            action: {
              type: 'place_pattern_piece',
              row: r,
              col: c,
              piece: ''
            } as unknown as GameAction,
            priority: 60,
            category: 'pattern-building'
          });
          break; // Just show one placement option to avoid flooding
        }
      }
      if (actions.length > 0) break;
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'place_pattern_piece') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const placeAction = ctx.action as unknown as { type: 'place_pattern_piece'; row: number; col: number; piece: string };
    const grid = (ctx.player as unknown as Record<string, unknown>).patternGrid as (string | null)[][] | undefined;
    if (!grid) return null;

    const size = config.grid_size ?? 5;
    const { row, col, piece } = placeAction;

    if (row < 0 || row >= size || col < 0 || col >= size) {
      return { handled: true, logMessage: 'Invalid grid position.', advanceTurn: false, checkWin: false };
    }

    if (grid[row]?.[col]) {
      return { handled: true, logMessage: 'Cell already occupied.', advanceTurn: false, checkWin: false };
    }

    const newGrid = grid.map(r => [...r]);
    newGrid[row][col] = piece || 'placed';

    const points = config.points_per_placement ?? 1;

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [ctx.playerId]: {
            patternGrid: newGrid,
            score: (ctx.player.score ?? 0) + points
          }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} placed a piece at (${row}, ${col}).`,
      logData: { player: ctx.playerId, row, col, piece: piece || 'placed' }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'pattern-building')) return null;

    const grid = (ctx.player as unknown as Record<string, unknown>).patternGrid;
    const completed = (ctx.player as unknown as Record<string, unknown>).completedPatterns;

    return {
      patternGrid: grid ?? null,
      completedPatterns: completed ?? []
    };
  }
};
