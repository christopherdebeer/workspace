/**
 * Square Grid Mechanic
 *
 * Cartesian grid with 4-directional (orthogonal) or 8-directional (diagonal) movement.
 *
 * Hooks used:
 * - initSharedState: Create square grid
 * - getAvailableActions: 'grid_move' actions
 * - onExecuteAction: Move on grid
 * - getPlayerView: Show grid positions
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

interface SquareGridConfig {
  width?: number;
  height?: number;
  allow_diagonal?: boolean;
}

interface SquareGridState {
  width: number;
  height: number;
  positions: Record<string, { x: number; y: number }>;
  obstacles: string[]; // "x,y" format
}

const ORTHOGONAL_DIRS = [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 }];
const DIAGONAL_DIRS = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }];

function getConfig(config: GameConfig): SquareGridConfig | undefined {
  return config.engine_mechanics?.square_grid as SquareGridConfig | undefined;
}

function getSquareState(shared: Record<string, unknown>): SquareGridState | undefined {
  return shared.squareGrid as SquareGridState | undefined;
}

export const squareGridMechanic: MechanicHooks = {
  slug: 'square-grid',
  name: 'Square Grid',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Cartesian grid movement (4 or 8 directions)',
    properties: {
      width: { type: 'number', default: 8 },
      height: { type: 'number', default: 8 },
      allow_diagonal: { type: 'boolean', default: false }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const w = config.width ?? 8;
    const h = config.height ?? 8;
    const positions: Record<string, { x: number; y: number }> = {};

    for (let i = 0; i < ctx.playerIds.length; i++) {
      positions[ctx.playerIds[i]] = { x: i % w, y: i < w ? 0 : h - 1 };
    }

    return {
      squareGrid: { width: w, height: h, positions, obstacles: [] } as SquareGridState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'square-grid')) return [];

    const config = getConfig(ctx.config);
    if (!config) return [];

    const sgState = getSquareState(ctx.state.shared);
    if (!sgState) return [];

    const pos = sgState.positions[ctx.playerId];
    if (!pos) return [];

    const dirs = [...ORTHOGONAL_DIRS];
    if (config.allow_diagonal) dirs.push(...DIAGONAL_DIRS);

    const occupiedPositions = new Set(
      Object.entries(sgState.positions)
        .filter(([pid]) => pid !== ctx.playerId)
        .map(([, p]) => `${p.x},${p.y}`)
    );

    const actions: AvailableAction[] = [];
    for (const dir of dirs) {
      const nx = pos.x + dir.x;
      const ny = pos.y + dir.y;
      if (nx >= 0 && nx < sgState.width && ny >= 0 && ny < sgState.height) {
        const key = `${nx},${ny}`;
        if (!occupiedPositions.has(key) && !sgState.obstacles.includes(key)) {
          actions.push({
            action: {
              type: 'grid_square_move',
              toX: nx,
              toY: ny
            } as unknown as GameAction,
            priority: 60,
            category: 'movement'
          });
        }
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'grid_square_move') return null;

    const sgState = getSquareState(ctx.state.shared);
    if (!sgState) return null;

    const moveAction = ctx.action as unknown as { type: 'grid_square_move'; toX: number; toY: number };
    const { toX, toY } = moveAction;

    if (toX < 0 || toX >= sgState.width || toY < 0 || toY >= sgState.height) {
      return { handled: true, logMessage: 'Out of bounds.', advanceTurn: false, checkWin: false };
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          squareGrid: {
            ...sgState,
            positions: { ...sgState.positions, [ctx.playerId]: { x: toX, y: toY } }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} moved to (${toX}, ${toY}).`,
      logData: { player: ctx.playerId, x: toX, y: toY }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'square-grid')) return null;

    const sgState = getSquareState(ctx.state.shared);
    if (!sgState) return null;

    return {
      gridPosition: sgState.positions[ctx.playerId],
      gridSize: { width: sgState.width, height: sgState.height },
      allGridPositions: sgState.positions
    };
  }
};
