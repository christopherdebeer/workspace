/**
 * Income Mechanic
 *
 * Automatic resource generation each turn or round.
 * Supports resource caps from engine_mechanics.resources config.
 * Uses addResource() service so resource hooks fire (e.g., catch-the-leader
 * income reduction applies to income gains).
 *
 * Hooks used:
 * - onTurnStart: Generate per_turn and per_round income via addResource()
 */

import { MechanicHooks, TurnStartContext, StateChanges } from './types';
import { addResource, getResource } from './core/resources';

interface ResourceConfig {
  name: string;
  max?: number;
}

/**
 * Add income for a set of resources, respecting caps.
 * Uses addResource() service which fires resource hooks.
 */
function applyIncome(
  state: TurnStartContext['state'],
  playerId: string,
  incomeEntries: Record<string, number>,
  resourcesConfig: ResourceConfig[]
): void {
  for (const [resource, amount] of Object.entries(incomeEntries)) {
    const currentAmount = getResource(state, playerId, resource);

    // Pre-calculate effective gain respecting cap
    let effectiveGain = amount;
    const resourceConfig = resourcesConfig.find(r => r.name === resource);
    if (resourceConfig?.max !== undefined) {
      const maxGain = Math.max(0, resourceConfig.max - currentAmount);
      effectiveGain = Math.min(effectiveGain, maxGain);
    }

    if (effectiveGain > 0) {
      addResource(state, playerId, resource, effectiveGain);
    }
  }
}

export const incomeMechanic: MechanicHooks = {
  slug: 'income',
  name: 'Income',
  requires: ['resources'],

  configSchema: {
    type: 'object',
    description: 'Automatic resource generation each turn or round',
    properties: {
      per_turn: {
        type: 'object',
        description: 'Resources to add at the start of each turn'
      },
      per_round: {
        type: 'object',
        description: 'Resources to add at the start of each round'
      }
    }
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const incomeConfig = ctx.config.engine_mechanics?.income as {
      per_turn?: Record<string, number>;
      per_round?: Record<string, number>;
    } | undefined;

    if (!incomeConfig) return null;

    const resourcesConfig = (ctx.config.engine_mechanics?.resources || []) as ResourceConfig[];

    // Apply per-turn income (uses addResource → fires resource hooks)
    if (incomeConfig.per_turn) {
      applyIncome(ctx.state, ctx.playerId, incomeConfig.per_turn, resourcesConfig);
    }

    // Apply per-round income (only at start of new round)
    if (ctx.isNewRound && incomeConfig.per_round) {
      applyIncome(ctx.state, ctx.playerId, incomeConfig.per_round, resourcesConfig);
    }

    // State already mutated by addResource(); no StateChanges needed
    return null;
  }
};
