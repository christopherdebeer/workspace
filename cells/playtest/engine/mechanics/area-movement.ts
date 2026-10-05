/**
 * Area Movement Mechanic
 *
 * The board is divided into named areas, and pieces move from one area
 * to an adjacent area. Movement is not restricted to a grid pattern.
 *
 * Supports:
 * - Named areas with explicit adjacency lists
 * - Movement costs between areas
 * - Area capacity limits
 * - Restricted areas (ownership, locked, etc.)
 *
 * Hooks used:
 * - preValidateAction: Validate move to adjacent area
 * - onExecuteAction: Execute area movement
 * - getAvailableActions: List valid area moves
 * - initPlayerState: Set starting area
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult
} from './types';
import { GameAction } from '../types/game';

interface AreaDefinition {
  /** Unique area identifier */
  id: string;
  /** Display name */
  name?: string;
  /** List of adjacent area IDs */
  adjacent: string[];
  /** Movement cost to enter this area (default: 1) */
  entry_cost?: number;
  /** Maximum pieces allowed in area */
  capacity?: number;
  /** Area is restricted (requires key, ownership, etc.) */
  restricted?: boolean;
  /** Owner player ID (for territory control) */
  owner?: string;
  /** Special properties */
  properties?: Record<string, unknown>;
}

interface AreaMovementConfig {
  /** Area definitions */
  areas: AreaDefinition[];
  /** Starting area ID */
  starting_area: string;
  /** Whether movement uses movement points */
  use_movement_points?: boolean;
  /** Default movement cost if not specified */
  default_cost?: number;
  /** Whether players can move through occupied areas */
  allow_passing?: boolean;
  /** Whether multiple pieces can occupy same area */
  allow_stacking?: boolean;
  /** Maximum pieces per area (global default) */
  default_capacity?: number;
}

function isAreaMovementConfig(config: unknown): config is AreaMovementConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    Array.isArray((config as AreaMovementConfig).areas) &&
    typeof (config as AreaMovementConfig).starting_area === 'string'
  );
}

function getAreaById(config: AreaMovementConfig, areaId: string): AreaDefinition | undefined {
  return config.areas.find(a => a.id === areaId);
}

function isAdjacent(config: AreaMovementConfig, fromArea: string, toArea: string): boolean {
  const from = getAreaById(config, fromArea);
  if (!from) return false;
  return from.adjacent.includes(toArea);
}

function getMovementCost(config: AreaMovementConfig, toArea: string): number {
  const area = getAreaById(config, toArea);
  return area?.entry_cost ?? config.default_cost ?? 1;
}

function canEnterArea(
  config: AreaMovementConfig,
  ctx: HookContext,
  areaId: string,
  playerId: string
): { allowed: boolean; reason?: string } {
  const area = getAreaById(config, areaId);
  if (!area) {
    return { allowed: false, reason: `Unknown area "${areaId}"` };
  }

  // Check restricted
  if (area.restricted) {
    // Could check for keys or other requirements
    return { allowed: false, reason: `Area "${area.name || areaId}" is restricted` };
  }

  // Check capacity
  if (!config.allow_stacking) {
    const capacity = area.capacity ?? config.default_capacity ?? Infinity;
    const occupants = Object.entries(ctx.state.players).filter(
      ([, p]) => p.currentArea === areaId || p.state === areaId
    );
    if (occupants.length >= capacity) {
      return { allowed: false, reason: `Area "${area.name || areaId}" is at capacity` };
    }
  }

  return { allowed: true };
}

export const areaMovementMechanic: MechanicHooks = {
  slug: 'area-movement',
  name: 'Area Movement',
  requires: ['board'],

  configSchema: {
    type: 'object',
    description: 'Movement between named areas with adjacency',
    properties: {
      areas: {
        type: 'array',
        description: 'Area definitions with adjacency lists',
        required: true
      },
      starting_area: {
        type: 'string',
        description: 'ID of the starting area',
        required: true
      },
      use_movement_points: {
        type: 'boolean',
        description: 'Use movement points system',
        default: false
      },
      default_cost: {
        type: 'number',
        description: 'Default movement cost',
        default: 1
      },
      allow_passing: {
        type: 'boolean',
        description: 'Allow moving through occupied areas',
        default: true
      },
      allow_stacking: {
        type: 'boolean',
        description: 'Allow multiple pieces in same area',
        default: true
      },
      default_capacity: {
        type: 'number',
        description: 'Default area capacity',
        default: null
      }
    },
    required: ['areas', 'starting_area']
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const areaConfig = ctx.config.engine_mechanics?.area_movement;
    if (!isAreaMovementConfig(areaConfig)) return null;

    return {
      currentArea: areaConfig.starting_area
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'move') return null;

    const areaConfig = ctx.config.engine_mechanics?.area_movement;
    if (!isAreaMovementConfig(areaConfig)) return null;

    const moveAction = action as { target: string };
    const currentArea = (ctx.player.currentArea as string) || ctx.player.state || areaConfig.starting_area;
    const targetArea = moveAction.target;

    // Check if target area exists
    const targetDef = getAreaById(areaConfig, targetArea);
    if (!targetDef) {
      const validAreas = areaConfig.areas.map(a => a.id).join(', ');
      return {
        valid: false,
        error: `Unknown area "${targetArea}". Valid areas: ${validAreas}`
      };
    }

    // Check adjacency
    if (!isAdjacent(areaConfig, currentArea, targetArea)) {
      const currentDef = getAreaById(areaConfig, currentArea);
      const adjacentList = currentDef?.adjacent.join(', ') || 'none';
      return {
        valid: false,
        error: `Cannot move from "${currentArea}" to "${targetArea}". Adjacent areas: ${adjacentList}`
      };
    }

    // Check entry restrictions
    const entryCheck = canEnterArea(areaConfig, ctx, targetArea, ctx.playerId);
    if (!entryCheck.allowed) {
      return { valid: false, error: entryCheck.reason || 'Cannot enter area' };
    }

    // Check movement points if enabled
    if (areaConfig.use_movement_points) {
      const cost = getMovementCost(areaConfig, targetArea);
      const available = (ctx.player.movementPoints as number) ?? 0;
      const used = (ctx.player.movementPointsUsed as number) ?? 0;
      const remaining = available - used;

      if (cost > remaining) {
        return {
          valid: false,
          error: `Not enough movement points. Need ${cost}, have ${remaining}`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, player } = ctx;

    if (action.type !== 'move') return null;

    const areaConfig = ctx.config.engine_mechanics?.area_movement;
    if (!isAreaMovementConfig(areaConfig)) return null;

    const moveAction = action as { target: string };
    const targetArea = moveAction.target;
    const previousArea = (player.currentArea as string) || player.state || areaConfig.starting_area;

    const stateChanges: { playerStateChanges: Record<string, Partial<typeof player>> } = {
      playerStateChanges: {
        [playerId]: {
          currentArea: targetArea,
          previousArea
        }
      }
    };

    // Track movement points if enabled
    if (areaConfig.use_movement_points) {
      const cost = getMovementCost(areaConfig, targetArea);
      const used = (player.movementPointsUsed as number) ?? 0;
      stateChanges.playerStateChanges[playerId].movementPointsUsed = used + cost;
    }

    const targetDef = getAreaById(areaConfig, targetArea);

    return {
      handled: true,
      stateChanges,
      advanceTurn: false, // Movement doesn't end turn by default
      logMessage: 'area_move',
      logData: {
        from: previousArea,
        to: targetArea,
        areaName: targetDef?.name || targetArea
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const areaConfig = ctx.config.engine_mechanics?.area_movement;
    if (!isAreaMovementConfig(areaConfig)) return [];

    const currentArea = (ctx.player.currentArea as string) || ctx.player.state || areaConfig.starting_area;
    const currentDef = getAreaById(areaConfig, currentArea);
    if (!currentDef) return [];

    const actions: AvailableAction[] = [];

    for (const adjacentId of currentDef.adjacent) {
      // Check if can enter
      const entryCheck = canEnterArea(areaConfig, ctx, adjacentId, ctx.playerId);
      if (!entryCheck.allowed) continue;

      // Check movement points if enabled
      if (areaConfig.use_movement_points) {
        const cost = getMovementCost(areaConfig, adjacentId);
        const available = (ctx.player.movementPoints as number) ?? 0;
        const used = (ctx.player.movementPointsUsed as number) ?? 0;
        if (cost > available - used) continue;
      }

      actions.push({
        action: { type: 'move', target: adjacentId } as unknown as GameAction,
        priority: 50,
        category: 'movement'
      });
    }

    return actions;
  }
};
