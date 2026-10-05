/**
 * Building Core Mechanic
 *
 * Defines the foundational building domain hooks that building-related leaf mechanics implement.
 * Any mechanic that works with construction, placement, or network building should declare
 * `requires: ['building']` and implement the hooks defined here.
 *
 * Defined hooks:
 * - onBeforeBuild: Before a build action, can modify or block (blocking)
 * - onAfterBuild: After something is built/placed (merge)
 * - onConnectionFormed: When a new connection/route is completed (merge)
 * - onPatternCompleted: When a pattern/set of placements is completed (merge)
 * - getValidPlacements: Get valid placement positions (merge)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for building-defined hooks ============

export interface BeforeBuildPayload {
  buildType: string;          // 'tile' | 'route' | 'building' | 'tech' | custom
  position?: string;          // Where to build
  piece?: string;             // What to build
  cost?: Record<string, number>;  // Resource cost
}

export interface AfterBuildPayload {
  buildType: string;
  position: string;
  piece: string;
  cost?: Record<string, number>;
  adjacentPositions?: string[];
}

export interface ConnectionFormedPayload {
  from: string;
  to: string;
  connectionType?: string;
  routeId?: string;
  completed?: boolean;        // Full route completed?
}

export interface PatternCompletedPayload {
  patternId: string;
  positions: string[];
  patternType?: string;
  bonusPoints?: number;
}

export interface ValidPlacementPayload {
  buildType: string;
  piece?: string;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the building core mechanic.
 * Mechanics that declare `requires: ['building']` can implement these.
 */
export interface BuildingDefinedHooks {
  onBeforeBuild?(ctx: HookContext, payload: BeforeBuildPayload): { blocked?: boolean; blockReason?: string } | null;
  onAfterBuild?(ctx: HookContext, payload: AfterBuildPayload): StateChanges | null;
  onConnectionFormed?(ctx: HookContext, payload: ConnectionFormedPayload): StateChanges | null;
  onPatternCompleted?(ctx: HookContext, payload: PatternCompletedPayload): StateChanges | null;
  getValidPlacements?(ctx: HookContext, payload: ValidPlacementPayload): Array<{ position: string; label?: string }>;
}

// ============ The mechanic itself ============

export const buildingMechanic: MechanicHooks = {
  slug: 'building',
  name: 'Building Core',

  defines: {
    onBeforeBuild: {
      description: 'Before a build action. Can block or modify placement.',
      resolution: 'blocking',
    },
    onAfterBuild: {
      description: 'After something is built/placed. Can trigger bonuses.',
      resolution: 'merge',
    },
    onConnectionFormed: {
      description: 'When a new connection/route between points is completed.',
      resolution: 'merge',
    },
    onPatternCompleted: {
      description: 'When a pattern of placements is completed.',
      resolution: 'merge',
    },
    getValidPlacements: {
      description: 'Get valid positions for placement. Each mechanic contributes positions.',
      resolution: 'merge',
    },
  },
};
