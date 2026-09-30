/**
 * Worker Placement: Different Worker Types Mechanic
 *
 * Extends worker placement with typed workers that have different capabilities.
 * Some spaces may require specific worker types or grant bonuses for certain types.
 *
 * Config:
 *   different_worker_types:
 *     types: WorkerTypeDef[]            # Worker type definitions
 *     type_restrictions: Record<string, string[]>  # Space -> allowed types
 *     type_bonuses: Record<string, Record<string, bonus>>  # Space -> type -> bonus
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges, SharedStateInitContext, SharedStateInitResult } from './types';
import { GameAction, GameConfig, PlayerState, WorkerState } from '../types/game';

interface DifferentWorkerTypesConfig {
  types?: WorkerTypeDef[];
  type_restrictions?: Record<string, string[]>;
  type_bonuses?: Record<string, Record<string, { resource?: string; amount?: number }>>;
}

interface WorkerTypeDef {
  type: string;
  name: string;
  count_per_player?: number;
  strength?: number;
  abilities?: string[];
}

function getConfig(config: GameConfig): DifferentWorkerTypesConfig | undefined {
  return config.engine_mechanics?.different_worker_types as DifferentWorkerTypesConfig | undefined;
}

function getPlayerWorkers(player: PlayerState): WorkerState[] {
  return player.workers ?? [];
}

export const differentWorkerTypesMechanic: MechanicHooks = {
  slug: 'worker-placement-different-worker-types',
  name: 'Different Worker Types',
  requires: ['workers'],

  configSchema: {
    type: 'object',
    description: 'Worker placement with multiple worker types',
    properties: {
      types: {
        type: 'array',
        description: 'Worker type definitions'
      },
      type_restrictions: {
        type: 'object',
        description: 'Space ID to allowed worker types mapping'
      },
      type_bonuses: {
        type: 'object',
        description: 'Space ID to type bonus mapping'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    return {
      workerTypeDefinitions: config.types ?? [],
      workerTypeRestrictions: config.type_restrictions ?? {},
      workerTypeBonuses: config.type_bonuses ?? {}
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'place_worker') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const placeAction = action as unknown as { type: 'place_worker'; spaceId: string; workerId?: string };
    const restrictions = config.type_restrictions ?? {};
    const allowedTypes = restrictions[placeAction.spaceId];

    if (!allowedTypes || allowedTypes.length === 0) return null; // No restrictions

    // Find the worker being placed
    const workers = getPlayerWorkers(ctx.player);
    let worker: WorkerState | undefined;

    if (placeAction.workerId) {
      worker = workers.find(w => w.id === placeAction.workerId && w.placedAt === null);
    } else {
      // Find first available worker - check if any available worker matches restrictions
      worker = workers.find(w => w.placedAt === null && allowedTypes.includes(w.type));
      if (!worker) {
        // Check if there are available workers at all
        const anyAvailable = workers.find(w => w.placedAt === null);
        if (anyAvailable) {
          return {
            valid: false,
            error: `Space ${placeAction.spaceId} requires worker types: ${allowedTypes.join(', ')}. Your available workers don't match.`
          };
        }
      }
    }

    if (worker && !allowedTypes.includes(worker.type)) {
      return {
        valid: false,
        error: `Space ${placeAction.spaceId} only accepts worker types: ${allowedTypes.join(', ')}. Worker ${worker.id} is type '${worker.type}'.`
      };
    }

    return null;
  },

  postExecuteAction(ctx: HookContext, action: GameAction): StateChanges | null {
    if (action.type !== 'place_worker') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const placeAction = action as unknown as { type: 'place_worker'; spaceId: string; workerId?: string };
    const bonuses = config.type_bonuses ?? {};
    const spaceBonuses = bonuses[placeAction.spaceId];

    if (!spaceBonuses) return null;

    // Find the worker that was just placed
    const workers = getPlayerWorkers(ctx.player);
    const placedWorker = workers.find(w => w.placedAt === placeAction.spaceId);
    if (!placedWorker) return null;

    const typeBonus = spaceBonuses[placedWorker.type];
    if (!typeBonus) return null;

    // Apply bonus resources
    if (typeBonus.resource && typeBonus.amount) {
      const resources = { ...((ctx.player.resources as Record<string, number>) ?? {}) };
      resources[typeBonus.resource] = (resources[typeBonus.resource] ?? 0) + typeBonus.amount;

      return {
        playerStateChanges: {
          [ctx.playerId]: { resources }
        }
      };
    }

    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const workers = getPlayerWorkers(ctx.player);
    const workersByType: Record<string, { total: number; available: number; placed: number }> = {};

    for (const w of workers) {
      if (!workersByType[w.type]) {
        workersByType[w.type] = { total: 0, available: 0, placed: 0 };
      }
      workersByType[w.type].total++;
      if (w.placedAt === null) {
        workersByType[w.type].available++;
      } else {
        workersByType[w.type].placed++;
      }
    }

    return {
      workersByType,
      workerTypeRestrictions: config.type_restrictions ?? {}
    };
  }
};
