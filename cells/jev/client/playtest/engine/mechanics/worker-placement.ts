/**
 * Worker Placement Mechanic
 *
 * Players place worker tokens on action spaces to perform actions.
 * Spaces are typically exclusive — once a worker is placed, other players
 * cannot use that space until workers are retrieved.
 *
 * Hooks used:
 * - initSharedState: Initialize worker spaces and state
 * - initPlayerState: Give each player their starting workers
 * - preValidateAction: Validate place_worker and retrieve_workers actions
 * - onExecuteAction: Handle worker placement and retrieval
 * - getAvailableActions: Expose available placement and retrieval actions
 * - describeAction: Describe worker placement actions
 * - onTurnStart: Auto-retrieve workers at round start if configured
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult,
  TurnStartContext,
  StateChanges,
  isMechanicEnabled
} from './types';
import { GameAction, GameConfig, GameState, PlayerState, PlaceWorkerAction, RetrieveWorkersAction, WorkerPlacementConfig, WorkerState } from '../types/game';
import { mechanicRegistry, applyStateChanges } from './registry';

interface SpaceOccupancy {
  spaceId: string;
  workers: Array<{ workerId: string; playerId: string }>;
}

// ============ Helper Functions ============

function getWorkerConfig(config: GameConfig): WorkerPlacementConfig | undefined {
  return config.engine_mechanics?.worker_placement;
}

function getPlayerWorkers(player: PlayerState): WorkerState[] {
  return player.workers ?? [];
}

function getAvailableWorkersFromPlayer(player: PlayerState): WorkerState[] {
  return getPlayerWorkers(player).filter(w => w.placedAt === null);
}

function getSpaceOccupancy(state: GameState): SpaceOccupancy[] {
  return (state.shared.workerSpaces as SpaceOccupancy[]) ?? [];
}

function isSpaceFull(occupancy: SpaceOccupancy[], spaceId: string, capacity: number): boolean {
  const space = occupancy.find(s => s.spaceId === spaceId);
  if (!space) return false;
  return space.workers.length >= capacity;
}

// ============ The Mechanic ============

export const workerPlacementMechanic: MechanicHooks = {
  slug: 'worker-placement',
  name: 'Worker Placement',
  requires: ['workers'],

  configSchema: {
    type: 'object',
    description: 'Place workers on action spaces to claim actions, blocking other players',
    properties: {
      workers_per_player: {
        type: 'number',
        description: 'Number of workers each player starts with',
        required: true
      },
      spaces: {
        type: 'array',
        description: 'Available worker placement spaces',
        required: true
      },
      retrieval: {
        type: 'string',
        description: 'When workers are retrieved: round_start, manual, or action',
        enum: ['round_start', 'manual', 'action'],
        default: 'round_start'
      },
      worker_types: {
        type: 'array',
        description: 'Worker types with counts (optional)'
      }
    },
    required: ['workers_per_player', 'spaces']
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig) return null;

    // Initialize space occupancy tracking
    const workerSpaces: SpaceOccupancy[] = wpConfig.spaces.map(space => ({
      spaceId: space.id,
      workers: []
    }));

    return {
      workerSpaces,
      allWorkersPlaced: false
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig) return null;

    const workers: WorkerState[] = [];

    if (wpConfig.worker_types) {
      // Named worker types
      for (const wt of wpConfig.worker_types) {
        for (let i = 0; i < wt.count; i++) {
          workers.push({
            id: `${ctx.playerId}-${wt.type}-${i}`,
            type: wt.type,
            placedAt: null
          });
        }
      }
    } else {
      // Standard workers
      for (let i = 0; i < wpConfig.workers_per_player; i++) {
        workers.push({
          id: `${ctx.playerId}-worker-${i}`,
          type: 'standard',
          placedAt: null
        });
      }
    }

    return { workers };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'place_worker' && action.type !== 'retrieve_workers') return null;

    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig) return { valid: false, error: 'Worker placement is not enabled.' };

    if (action.type === 'place_worker') {
      const placeAction = action as PlaceWorkerAction;

      // Validate space exists
      const spaceConfig = wpConfig.spaces.find(s => s.id === placeAction.spaceId);
      if (!spaceConfig) {
        return { valid: false, error: `Unknown worker space: "${placeAction.spaceId}". Available: ${wpConfig.spaces.map(s => s.id).join(', ')}` };
      }

      // Check space availability
      if (spaceConfig.available === false) {
        return { valid: false, error: `Space "${spaceConfig.name}" is not currently available.` };
      }

      // Check if player has available workers
      const available = getAvailableWorkersFromPlayer(ctx.player);
      if (available.length === 0) {
        return { valid: false, error: 'No available workers to place. Retrieve workers first.' };
      }

      // Check if specific worker exists
      if (placeAction.workerId) {
        const worker = available.find(w => w.id === placeAction.workerId);
        if (!worker) {
          return { valid: false, error: `Worker "${placeAction.workerId}" is not available.` };
        }
      }

      // Check space capacity
      const occupancy = getSpaceOccupancy(ctx.state);
      const capacity = spaceConfig.capacity ?? 1;
      if (isSpaceFull(occupancy, placeAction.spaceId, capacity)) {
        return { valid: false, error: `Space "${spaceConfig.name}" is full (capacity: ${capacity}).` };
      }

      // Check resource cost
      if (spaceConfig.cost) {
        for (const [resource, amount] of Object.entries(spaceConfig.cost)) {
          const available = ctx.player.resources?.[resource] ?? 0;
          if (available < amount) {
            return { valid: false, error: `Not enough ${resource} to place here. Need ${amount}, have ${available}.` };
          }
        }
      }

      return { valid: true };
    }

    if (action.type === 'retrieve_workers') {
      if (wpConfig.retrieval === 'round_start') {
        return { valid: false, error: 'Workers are automatically retrieved at the start of each round.' };
      }

      const playerWorkers = getPlayerWorkers(ctx.player);
      const placedWorkers = playerWorkers.filter(w => w.placedAt !== null);
      if (placedWorkers.length === 0) {
        return { valid: false, error: 'No workers to retrieve.' };
      }

      return { valid: true };
    }

    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig) return null;

    if (action.type === 'place_worker') {
      const placeAction = action as PlaceWorkerAction;
      const spaceConfig = wpConfig.spaces.find(s => s.id === placeAction.spaceId);
      if (!spaceConfig) return null;

      // Fire onBeforeWorkerPlace hook
      const playerWorkers = getPlayerWorkers(state.players[playerId]);
      const availableWorkers = playerWorkers.filter(w => w.placedAt === null);
      const worker = placeAction.workerId
        ? availableWorkers.find(w => w.id === placeAction.workerId)
        : availableWorkers[0];

      if (!worker) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_worker_failed',
          logData: { error: 'No available worker' }
        };
      }

      const occupancy = getSpaceOccupancy(state);

      const beforeResult = mechanicRegistry.fire('workers', 'onBeforeWorkerPlace', state, playerId, {
        workerId: worker.id,
        workerType: worker.type,
        spaceId: placeAction.spaceId,
        playerId,
        currentOccupants: occupancy.find(s => s.spaceId === placeAction.spaceId)?.workers.map(w => w.playerId) ?? []
      });
      if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_worker_blocked',
          logData: { reason: (beforeResult as Record<string, unknown>).blockReason }
        };
      }

      // Place the worker
      const updatedWorkers = playerWorkers.map(w =>
        w.id === worker.id ? { ...w, placedAt: placeAction.spaceId } : w
      );

      // Update space occupancy
      const updatedSpaces = occupancy.map(s =>
        s.spaceId === placeAction.spaceId
          ? { ...s, workers: [...s.workers, { workerId: worker.id, playerId }] }
          : s
      );

      const stateChanges: StateChanges = {
        playerStateChanges: {
          [playerId]: { workers: updatedWorkers }
        },
        sharedStateChanges: {
          workerSpaces: updatedSpaces
        }
      };

      // Apply state changes before firing hooks
      if (stateChanges.playerStateChanges) {
        for (const [pid, changes] of Object.entries(stateChanges.playerStateChanges)) {
          Object.assign(state.players[pid], changes);
        }
      }
      if (stateChanges.sharedStateChanges) {
        Object.assign(state.shared, stateChanges.sharedStateChanges);
      }

      // Fire onWorkerPlaced hook
      const placedChanges = mechanicRegistry.fire('workers', 'onWorkerPlaced', state, playerId, {
        workerId: worker.id,
        workerType: worker.type,
        spaceId: placeAction.spaceId,
        playerId
      });
      if (placedChanges) applyStateChanges(state, placedChanges);

      // Fire onSpaceActivated if space has an action
      if (spaceConfig.action || spaceConfig.reward) {
        const activatedChanges = mechanicRegistry.fire('workers', 'onSpaceActivated', state, playerId, {
          spaceId: placeAction.spaceId,
          action: spaceConfig.action ?? 'gain',
          playerId,
          rewards: spaceConfig.reward
        });
        if (activatedChanges) applyStateChanges(state, activatedChanges);

        // Apply rewards directly if specified
        if (spaceConfig.reward) {
          for (const [resource, amount] of Object.entries(spaceConfig.reward)) {
            if (!state.players[playerId].resources) {
              state.players[playerId].resources = {};
            }
            state.players[playerId].resources![resource] = (state.players[playerId].resources![resource] ?? 0) + amount;
          }
        }
      }

      // Deduct costs
      if (spaceConfig.cost) {
        for (const [resource, amount] of Object.entries(spaceConfig.cost)) {
          if (state.players[playerId].resources) {
            state.players[playerId].resources![resource] = (state.players[playerId].resources![resource] ?? 0) - amount;
          }
        }
      }

      // Check if all workers are placed
      const allPlaced = updatedWorkers.every(w => w.placedAt !== null);

      return {
        handled: true,
        stateChanges: {},
        advanceTurn: true,
        checkWin: true,
        logMessage: 'worker_placed',
        logData: {
          player: playerId,
          worker: worker.id,
          workerType: worker.type,
          space: placeAction.spaceId,
          spaceName: spaceConfig.name,
          allPlaced,
          reward: spaceConfig.reward,
          cost: spaceConfig.cost
        }
      };
    }

    if (action.type === 'retrieve_workers') {
      const retrieveAction = action as RetrieveWorkersAction;

      // Fire onBeforeWorkerRetrieve hook
      const beforeResult = mechanicRegistry.fire('workers', 'onBeforeWorkerRetrieve', state, playerId, {
        playerId,
        fromSpaces: retrieveAction.fromSpaces
      });
      if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'retrieve_workers_blocked',
          logData: { reason: (beforeResult as Record<string, unknown>).blockReason }
        };
      }

      const playerWorkers = getPlayerWorkers(state.players[playerId]);
      const retrieved: Array<{ workerId: string; fromSpace: string }> = [];

      // Retrieve all placed workers (or specific spaces)
      const updatedWorkers = playerWorkers.map(w => {
        if (w.placedAt === null) return w;
        if (retrieveAction.fromSpaces && !retrieveAction.fromSpaces.includes(w.placedAt)) return w;
        retrieved.push({ workerId: w.id, fromSpace: w.placedAt });
        return { ...w, placedAt: null };
      });

      // Update space occupancy
      const occupancy = getSpaceOccupancy(state);
      const retrievedWorkerIds = new Set(retrieved.map(r => r.workerId));
      const updatedSpaces = occupancy.map(s => ({
        ...s,
        workers: s.workers.filter(w => !retrievedWorkerIds.has(w.workerId))
      }));

      const stateChanges: StateChanges = {
        playerStateChanges: {
          [playerId]: { workers: updatedWorkers }
        },
        sharedStateChanges: {
          workerSpaces: updatedSpaces
        }
      };

      // Apply changes before firing hooks
      if (stateChanges.playerStateChanges) {
        for (const [pid, changes] of Object.entries(stateChanges.playerStateChanges)) {
          Object.assign(state.players[pid], changes);
        }
      }
      if (stateChanges.sharedStateChanges) {
        Object.assign(state.shared, stateChanges.sharedStateChanges);
      }

      // Fire onWorkersRetrieved hook
      const retrievedChanges = mechanicRegistry.fire('workers', 'onWorkersRetrieved', state, playerId, {
        workers: retrieved,
        playerId
      });
      if (retrievedChanges) applyStateChanges(state, retrievedChanges);

      return {
        handled: true,
        stateChanges: {},
        advanceTurn: true,
        checkWin: false,
        logMessage: 'workers_retrieved',
        logData: {
          player: playerId,
          count: retrieved.length,
          workers: retrieved
        }
      };
    }

    return null;
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'worker-placement')) return null;
    if (!ctx.isNewRound) return null;

    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig || wpConfig.retrieval !== 'round_start') return null;

    // Auto-retrieve ALL players' workers at round start (not just current player)
    const playerStateChanges: Record<string, { workers: WorkerState[] }> = {};
    let anyRetrieved = false;

    for (const [pid, player] of Object.entries(ctx.state.players)) {
      const playerWorkers = getPlayerWorkers(player);
      const hasPlacedWorkers = playerWorkers.some(w => w.placedAt !== null);
      if (hasPlacedWorkers) {
        playerStateChanges[pid] = {
          workers: playerWorkers.map(w => ({ ...w, placedAt: null }))
        };
        anyRetrieved = true;
      }
    }

    if (!anyRetrieved) return null;

    // Clear all workers from all spaces
    const occupancy = getSpaceOccupancy(ctx.state);
    const updatedSpaces = occupancy.map(s => ({
      ...s,
      workers: []
    }));

    return {
      playerStateChanges,
      sharedStateChanges: {
        workerSpaces: updatedSpaces
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!isMechanicEnabled(ctx.config, 'worker-placement')) return [];

    const wpConfig = getWorkerConfig(ctx.config);
    if (!wpConfig) return [];

    const actions: AvailableAction[] = [];
    const availableWorkers = getAvailableWorkersFromPlayer(ctx.player);
    const occupancy = getSpaceOccupancy(ctx.state);

    // Place worker actions (for each open space)
    if (availableWorkers.length > 0) {
      for (const space of wpConfig.spaces) {
        if (space.available === false) continue;
        const capacity = space.capacity ?? 1;
        if (isSpaceFull(occupancy, space.id, capacity)) continue;

        // Check resource cost
        let canAfford = true;
        if (space.cost) {
          for (const [resource, amount] of Object.entries(space.cost)) {
            if ((ctx.player.resources?.[resource] ?? 0) < amount) {
              canAfford = false;
              break;
            }
          }
        }
        if (!canAfford) continue;

        actions.push({
          action: { type: 'place_worker', spaceId: space.id } as GameAction,
          priority: 60,
          category: 'worker-placement'
        });
      }
    }

    // Retrieve workers action (if manual retrieval)
    if (wpConfig.retrieval !== 'round_start') {
      const placedWorkers = getPlayerWorkers(ctx.player)
        .filter(w => w.placedAt !== null);
      if (placedWorkers.length > 0) {
        actions.push({
          action: { type: 'retrieve_workers' } as GameAction,
          priority: 40,
          category: 'worker-placement'
        });
      }
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'place_worker') {
      return {
        type: 'place_worker',
        label: 'Place Worker',
        description: 'Place a worker on an available action space to claim it. The space\'s action is activated upon placement.',
        examples: ['place_worker spaceId:"forge"', 'place_worker spaceId:"market" workerId:"player-1-worker-0"']
      };
    }
    if (action.type === 'retrieve_workers') {
      return {
        type: 'retrieve_workers',
        label: 'Retrieve Workers',
        description: 'Retrieve all placed workers back to your supply.',
        examples: ['retrieve_workers']
      };
    }
    return null;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'worker-placement')) return null;

    const workers = getPlayerWorkers(ctx.player);
    const available = workers.filter(w => w.placedAt === null);
    const placed = workers.filter(w => w.placedAt !== null);

    return {
      workersAvailable: available.length,
      workersPlaced: placed.length,
      workerPlacements: placed.map(w => ({ id: w.id, type: w.type, space: w.placedAt }))
    };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const spaces = cfg.spaces;
    if (!Array.isArray(spaces)) return null;
    return [{ label: 'Locations', value: String(spaces.length) }];
  }
};
