/**
 * Enclosure Mechanic
 *
 * Surround areas to claim them. Enclosed regions score based on size.
 * Think Go, Cathedral.
 *
 * Hooks used:
 * - initSharedState: Track claimed areas
 * - getAvailableActions: 'enclose_area'
 * - onExecuteAction: Claim enclosed area
 * - getPlayerView: Show territories
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

interface EnclosureConfig {
  points_per_cell?: number;
  board_size?: number;
}

interface EnclosureState {
  territories: Record<string, string | null>;  // "r,c" -> playerId or null
  enclosedAreas: Array<{ playerId: string; cells: string[]; points: number }>;
}

function getConfig(config: GameConfig): EnclosureConfig | undefined {
  return config.engine_mechanics?.enclosure as EnclosureConfig | undefined;
}

function getEnclosureState(shared: Record<string, unknown>): EnclosureState | undefined {
  return shared.enclosure as EnclosureState | undefined;
}

export const enclosureMechanic: MechanicHooks = {
  slug: 'enclosure',
  name: 'Enclosure',
  requires: ['building'],

  configSchema: {
    type: 'object',
    description: 'Surround areas to claim them',
    properties: {
      points_per_cell: { type: 'number', default: 2 },
      board_size: { type: 'number', default: 9 }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const size = config.board_size ?? 9;
    const territories: Record<string, string | null> = {};
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        territories[`${r},${c}`] = null;
      }
    }

    return {
      enclosure: { territories, enclosedAreas: [] } as EnclosureState
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'enclosure')) return [];

    const eState = getEnclosureState(ctx.state.shared);
    if (!eState) return [];

    // Find empty cells
    const emptyCells = Object.entries(eState.territories)
      .filter(([, owner]) => owner === null)
      .slice(0, 3); // limit options

    return emptyCells.map(([cell]) => ({
      action: {
        type: 'place_stone',
        position: cell
      } as unknown as GameAction,
      priority: 65,
      category: 'enclosure'
    }));
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'place_stone') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const eState = getEnclosureState(ctx.state.shared);
    if (!eState) return null;

    const placeAction = ctx.action as unknown as { type: 'place_stone'; position: string };
    const pos = placeAction.position;

    if (eState.territories[pos] !== null && eState.territories[pos] !== undefined) {
      return { handled: true, logMessage: 'Position already occupied.', advanceTurn: false, checkWin: false };
    }

    const updatedTerritories = { ...eState.territories, [pos]: ctx.playerId };
    const pointsPerCell = config.points_per_cell ?? 2;

    // Simple scoring: 1 point per placement
    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          enclosure: { ...eState, territories: updatedTerritories }
        },
        playerStateChanges: {
          [ctx.playerId]: { score: (ctx.player.score ?? 0) + 1 }
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: `${ctx.playerId} placed at ${pos}.`,
      logData: { player: ctx.playerId, position: pos }
    };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'enclosure')) return null;

    const eState = getEnclosureState(ctx.state.shared);
    if (!eState) return null;

    const myTerritories = Object.entries(eState.territories)
      .filter(([, owner]) => owner === ctx.playerId)
      .map(([cell]) => cell);

    return {
      myTerritories,
      totalClaimed: myTerritories.length,
      enclosedAreas: eState.enclosedAreas.filter(a => a.playerId === ctx.playerId)
    };
  }
};
