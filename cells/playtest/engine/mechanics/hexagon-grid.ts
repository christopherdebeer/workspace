/**
 * Hexagon Grid Mechanic
 *
 * Hexagonal tile layout with 6-directional movement. Supports cube/axial coordinates.
 *
 * Hooks used:
 * - initSharedState: Create hex grid
 * - getAvailableActions: 'hex_move' actions
 * - onExecuteAction: Move on hex grid
 * - getPlayerView: Show hex positions
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

interface HexGridConfig {
  radius?: number;
  movement_range?: number;
}

interface HexCell {
  q: number;
  r: number;
  terrain: string;
  occupant: string | null;
}

interface HexGridState {
  cells: Record<string, HexCell>; // "q,r" -> cell
  positions: Record<string, string>; // playerId -> "q,r"
}

// Hex neighbor offsets (cube coordinates, flat-top)
const HEX_DIRECTIONS = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
];

function getConfig(config: GameConfig): HexGridConfig | undefined {
  return config.engine_mechanics?.hexagon_grid as HexGridConfig | undefined;
}

function getHexState(shared: Record<string, unknown>): HexGridState | undefined {
  return shared.hexGrid as HexGridState | undefined;
}

export const hexagonGridMechanic: MechanicHooks = {
  slug: 'hexagon-grid',
  name: 'Hexagon Grid',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Hexagonal grid movement and positioning',
    properties: {
      radius: { type: 'number', default: 3 },
      movement_range: { type: 'number', default: 1 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const radius = config.radius ?? 3;
    const cells: Record<string, HexCell> = {};
    const terrains = ['plains', 'forest', 'hills', 'water'];

    // Generate hex grid with given radius
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (Math.abs(q + r) <= radius) {
          const key = `${q},${r}`;
          cells[key] = {
            q, r,
            terrain: terrains[Math.abs(q + r * 3) % terrains.length],
            occupant: null
          };
        }
      }
    }

    // Place players around the center
    const positions: Record<string, string> = {};
    const startPositions = ['0,0', '1,0', '-1,0', '0,1', '0,-1', '1,-1'];
    for (let i = 0; i < ctx.playerIds.length; i++) {
      const pos = startPositions[i % startPositions.length];
      positions[ctx.playerIds[i]] = pos;
      if (cells[pos]) cells[pos].occupant = ctx.playerIds[i];
    }

    return { hexGrid: { cells, positions } as HexGridState };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'hexagon-grid')) return [];

    const hexState = getHexState(ctx.state.shared);
    if (!hexState) return [];

    const myPos = hexState.positions[ctx.playerId];
    if (!myPos) return [];

    const [q, r] = myPos.split(',').map(Number);
    const actions: AvailableAction[] = [];

    for (const dir of HEX_DIRECTIONS) {
      const nq = q + dir.q;
      const nr = r + dir.r;
      const key = `${nq},${nr}`;
      const cell = hexState.cells[key];
      if (cell && !cell.occupant && cell.terrain !== 'water') {
        actions.push({
          action: {
            type: 'hex_move',
            toQ: nq,
            toR: nr
          } as unknown as GameAction,
          priority: 60,
          category: 'movement'
        });
      }
    }

    return actions;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'hex_move') return null;

    const hexState = getHexState(ctx.state.shared);
    if (!hexState) return null;

    const moveAction = ctx.action as unknown as { type: 'hex_move'; toQ: number; toR: number };
    const destKey = `${moveAction.toQ},${moveAction.toR}`;
    const destCell = hexState.cells[destKey];

    if (!destCell) {
      return { handled: true, logMessage: 'Invalid hex position.', advanceTurn: false, checkWin: false };
    }

    if (destCell.occupant) {
      return { handled: true, logMessage: 'Hex occupied.', advanceTurn: false, checkWin: false };
    }

    const oldPos = hexState.positions[ctx.playerId];
    const updatedCells = { ...hexState.cells };
    if (oldPos && updatedCells[oldPos]) {
      updatedCells[oldPos] = { ...updatedCells[oldPos], occupant: null };
    }
    updatedCells[destKey] = { ...destCell, occupant: ctx.playerId };

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          hexGrid: {
            cells: updatedCells,
            positions: { ...hexState.positions, [ctx.playerId]: destKey }
          }
        }
      },
      advanceTurn: false,
      checkWin: false,
      logMessage: `${ctx.playerId} moved to hex (${moveAction.toQ}, ${moveAction.toR}).`,
      logData: { player: ctx.playerId, from: oldPos, to: destKey, terrain: destCell.terrain }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'hexagon-grid')) return null;

    const hexState = getHexState(ctx.state.shared);
    if (!hexState) return null;

    return {
      hexPosition: hexState.positions[ctx.playerId],
      nearbyHexes: Object.values(hexState.cells).filter(c => {
        const pos = hexState.positions[ctx.playerId];
        if (!pos) return false;
        const [pq, pr] = pos.split(',').map(Number);
        return Math.abs(c.q - pq) <= 2 && Math.abs(c.r - pr) <= 2;
      })
    };
  }
};
