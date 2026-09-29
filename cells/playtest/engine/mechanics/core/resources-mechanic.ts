/**
 * Resources Core Mechanic
 *
 * Defines the foundational resource domain hooks that resource-related leaf mechanics implement.
 * Any mechanic that works with resources should declare `requires: ['resources']` and implement
 * the hooks defined here.
 *
 * This mechanic is always enabled. Core resource services fire these hooks
 * and only mechanics that declare `requires: ['resources']` receive them.
 *
 * Defined hooks:
 * - onResourceGained: After resources are added (merge)
 * - onResourceSpent: After resources are spent (merge)
 * - onBeforeResourceGain: Before gaining resources, can block/modify (blocking)
 * - onBeforeResourceSpend: Before spending resources, can block/modify (blocking)
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  ActionSchema,
  PlayerInitContext,
  PlayerInitResult
} from '../types';
import { SpendAction, GameAction } from '../../types/game';
import { spendResource } from './resources';

// ============ Payload types for resources-defined hooks ============

export interface ResourceGainedPayload {
  /** Resource that was gained */
  resource: string;
  /** Amount gained (always positive) */
  amount: number;
  /** Amount before the gain */
  previousAmount: number;
  /** Amount after the gain */
  newAmount: number;
}

export interface ResourceSpentPayload {
  /** Resource that was spent */
  resource: string;
  /** Amount spent (always positive) */
  amount: number;
  /** Amount before spending */
  previousAmount: number;
  /** Amount after spending */
  newAmount: number;
}

export interface BeforeResourceGainPayload {
  /** Resource being gained */
  resource: string;
  /** Amount requested to gain (always positive) */
  amount: number;
  /** Current amount before gain */
  currentAmount: number;
}

export interface BeforeResourceSpendPayload {
  /** Resource being spent */
  resource: string;
  /** Amount requested to spend (always positive) */
  amount: number;
  /** Current amount before spend */
  currentAmount: number;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the resources core mechanic.
 * Mechanics that declare `requires: ['resources']` can implement these.
 *
 * Use intersection typing for type safety:
 * ```typescript
 * const myMechanic: MechanicHooks & ResourcesHooks = { ... };
 * ```
 */
export interface ResourcesHooks {
  onResourceGained?(ctx: HookContext, payload: ResourceGainedPayload): StateChanges | null;
  onResourceSpent?(ctx: HookContext, payload: ResourceSpentPayload): StateChanges | null;
  onBeforeResourceGain?(ctx: HookContext, payload: BeforeResourceGainPayload): { blocked?: boolean; blockReason?: string; amount?: number } | null;
  onBeforeResourceSpend?(ctx: HookContext, payload: BeforeResourceSpendPayload): { blocked?: boolean; blockReason?: string; amount?: number } | null;
}

// ============ The mechanic itself ============

export const resourcesMechanic: MechanicHooks = {
  slug: 'resources',
  name: 'Resources Core',

  defines: {
    onBeforeResourceGain: {
      description: 'Before gaining resources. Can modify amount or block.',
      resolution: 'blocking',
    },
    onBeforeResourceSpend: {
      description: 'Before spending resources. Can modify amount or block.',
      resolution: 'blocking',
    },
    onResourceGained: {
      description: 'After resources are gained.',
      resolution: 'merge',
    },
    onResourceSpent: {
      description: 'After resources are spent.',
      resolution: 'merge',
    },
  },

  /**
   * Initialize player resources from config.
   * Supports both starting_state.resources (frontmatter) and engine_mechanics.resources (array).
   */
  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    // Check starting_state.resources first (from RULES frontmatter)
    const startingState = (ctx.config as { starting_state?: { resources?: Record<string, number> } }).starting_state;
    if (startingState?.resources) {
      return { resources: { ...startingState.resources } };
    }

    // Fall back to engine_mechanics.resources config (array format)
    const resourcesConfig = ctx.config.engine_mechanics?.resources;
    if (resourcesConfig && Array.isArray(resourcesConfig)) {
      const resources: Record<string, number> = {};
      for (const res of resourcesConfig) {
        resources[res.name] = res.starting_amount ?? 0;
      }
      return { resources };
    }

    return null;
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'spend') return null;
    return {
      required: ['resource', 'amount'],
      optional: ['target'],
      fields: {
        resource: { type: 'string' },
        amount: { type: 'number', minimum: 1 },
        target: { type: 'string' },
      },
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'spend') return null;

    const spendAction = action as SpendAction;
    const { resource, amount } = spendAction;
    const available = ctx.player.resources?.[resource] ?? 0;

    if (available <= 0) {
      return {
        valid: false,
        error: `Cannot spend ${resource}: you have none`
      };
    }

    if (amount > available) {
      return {
        valid: false,
        error: `Insufficient ${resource}: need ${amount}, have ${available}`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'spend') return null;

    const spendAction = ctx.action as SpendAction;
    const { resource, amount, target } = spendAction;

    const result = spendResource(ctx.state, ctx.playerId, resource, amount);

    if (!result.success) {
      return {
        handled: true,
        logMessage: `spend_failed`,
        logData: { resource, amount, reason: result.blockReason }
      };
    }

    return {
      handled: true,
      stateChanges: {},
      advanceTurn: false,
      checkWin: false,
      logMessage: 'resource_spent',
      logData: { resource, amount, target, remaining: result.newAmount }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const actions: AvailableAction[] = [];
    const resourcesConfig = ctx.config.engine_mechanics?.resources;

    if (!resourcesConfig || !Array.isArray(resourcesConfig)) return actions;

    for (const resCfg of resourcesConfig) {
      const resourceName = resCfg.name;
      const available = ctx.player.resources?.[resourceName] ?? 0;

      if (available > 0) {
        actions.push({
          action: { type: 'spend', resource: resourceName, amount: 1 } as GameAction,
          priority: 40,
          category: 'resource'
        });
      }
    }

    return actions;
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const resourcesConfig = ctx.config.engine_mechanics?.resources;
    if (!resourcesConfig || !ctx.player.resources) return null;

    return {
      resources: ctx.player.resources
    };
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'spend') return null;

    return {
      type: 'spend',
      label: 'Spend Resource',
      description: 'Spend a specified amount of a resource. Optionally specify a target for the expenditure.',
      examples: [
        'spend resource:"gold" amount:2',
        'spend resource:"mana" amount:1 target:"spell"'
      ]
    };
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!Array.isArray(config)) return null;
    const names = config.map((r: Record<string, unknown>) => r.name).filter(Boolean);
    if (names.length === 0) return null;
    return [{ label: 'Resources', value: String(names.length) }];
  },
};
