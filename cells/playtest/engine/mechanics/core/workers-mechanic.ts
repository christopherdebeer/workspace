/**
 * Workers Core Mechanic
 *
 * Defines the foundational worker placement domain hooks that worker-related
 * leaf mechanics implement. Any mechanic that works with workers should declare
 * `requires: ['workers']` and implement the hooks defined here.
 *
 * This mechanic is always enabled when worker_placement is configured.
 * Core worker services fire these hooks and only mechanics that declare
 * `requires: ['workers']` receive them.
 *
 * Defined hooks:
 * - onBeforeWorkerPlace: Before placing a worker, can block/modify (blocking)
 * - onWorkerPlaced: After a worker is placed on a space (merge)
 * - onBeforeWorkerRetrieve: Before retrieving workers, can block (blocking)
 * - onWorkersRetrieved: After workers are retrieved from spaces (merge)
 * - onSpaceActivated: After a worker space's action is activated (merge)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for workers-defined hooks ============

export interface WorkerPlacedPayload {
  /** Worker ID that was placed */
  workerId: string;
  /** Worker type (e.g., 'standard', 'master', 'apprentice') */
  workerType: string;
  /** Space where worker was placed */
  spaceId: string;
  /** Player who placed the worker */
  playerId: string;
}

export interface BeforeWorkerPlacePayload {
  /** Worker ID to place */
  workerId: string;
  /** Worker type */
  workerType: string;
  /** Target space */
  spaceId: string;
  /** Player placing the worker */
  playerId: string;
  /** Current occupants of the space */
  currentOccupants: string[];
}

export interface WorkersRetrievedPayload {
  /** Workers that were retrieved */
  workers: Array<{ workerId: string; fromSpace: string }>;
  /** Player retrieving workers */
  playerId: string;
}

export interface BeforeWorkerRetrievePayload {
  /** Player retrieving workers */
  playerId: string;
  /** Spaces to retrieve from (empty = all) */
  fromSpaces?: string[];
}

export interface SpaceActivatedPayload {
  /** Space that was activated */
  spaceId: string;
  /** Action produced by the space */
  action: string;
  /** Player who activated the space */
  playerId: string;
  /** Rewards/effects from the space */
  rewards?: Record<string, unknown>;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the workers core mechanic.
 * Mechanics that declare `requires: ['workers']` can implement these.
 */
export interface WorkersHooks {
  onBeforeWorkerPlace?(ctx: HookContext, payload: BeforeWorkerPlacePayload): { blocked?: boolean; blockReason?: string } | null;
  onWorkerPlaced?(ctx: HookContext, payload: WorkerPlacedPayload): StateChanges | null;
  onBeforeWorkerRetrieve?(ctx: HookContext, payload: BeforeWorkerRetrievePayload): { blocked?: boolean; blockReason?: string } | null;
  onWorkersRetrieved?(ctx: HookContext, payload: WorkersRetrievedPayload): StateChanges | null;
  onSpaceActivated?(ctx: HookContext, payload: SpaceActivatedPayload): StateChanges | null;
}

// ============ The mechanic itself ============

export const workersMechanic: MechanicHooks = {
  slug: 'workers',
  name: 'Workers Core',

  defines: {
    onBeforeWorkerPlace: {
      description: 'Before placing a worker. Can block placement.',
      resolution: 'blocking',
    },
    onWorkerPlaced: {
      description: 'After a worker is placed on a space.',
      resolution: 'merge',
    },
    onBeforeWorkerRetrieve: {
      description: 'Before retrieving workers. Can block retrieval.',
      resolution: 'blocking',
    },
    onWorkersRetrieved: {
      description: 'After workers are retrieved from spaces.',
      resolution: 'merge',
    },
    onSpaceActivated: {
      description: 'After a worker space action is activated.',
      resolution: 'merge',
    },
  },
};
