/**
 * Resources Core Service
 *
 * Manages player resource/currency operations.
 * This is a "trunk" mechanic that other mechanics depend on.
 *
 * Fires resources-defined hooks:
 * - onBeforeResourceGain/onBeforeResourceSpend: Can modify amount or block (blocking)
 * - onResourceGained/onResourceSpent: Notified after change (merge)
 */

import { GameState } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Result from resource operation
 */
export interface ResourceChangeResult {
  /** True if the change was applied */
  success: boolean;
  /** New resource amount after change */
  newAmount: number;
  /** Amount that was actually changed (may differ from requested) */
  actualChange: number;
  /** True if change was blocked by a hook */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Spend (deduct) a resource from a player.
 * Fires resources-defined onBeforeResourceSpend and onResourceSpent hooks.
 *
 * @returns Result indicating success and new amount
 */
export function spendResource(
  state: GameState,
  playerId: string,
  resource: string,
  amount: number
): ResourceChangeResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  if (!player.resources) {
    return {
      success: false,
      newAmount: 0,
      actualChange: 0,
      blocked: true,
      blockReason: 'Resources not configured for this player'
    };
  }

  const currentAmount = player.resources[resource] ?? 0;

  if (amount > currentAmount) {
    return {
      success: false,
      newAmount: currentAmount,
      actualChange: 0,
      blocked: true,
      blockReason: `Not enough ${resource}. Have ${currentAmount}, need ${amount}`
    };
  }

  // Fire resources-defined onBeforeResourceSpend hook (blocking)
  let actualAmount = amount;
  const beforeResult = mechanicRegistry.fire('resources', 'onBeforeResourceSpend', state, playerId, {
    resource, amount: actualAmount, currentAmount
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return {
      success: false,
      newAmount: currentAmount,
      actualChange: 0,
      blocked: true,
      blockReason
    };
  }
  if (beforeResult && typeof (beforeResult as Record<string, unknown>).amount === 'number') {
    actualAmount = (beforeResult as Record<string, unknown>).amount as number;
  }

  // Apply the change
  player.resources[resource] = currentAmount - actualAmount;

  // Fire resources-defined onResourceSpent hook (merge)
  const afterChanges = mechanicRegistry.fire('resources', 'onResourceSpent', state, playerId, {
    resource, amount: actualAmount, previousAmount: currentAmount, newAmount: player.resources[resource]
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    success: true,
    newAmount: player.resources[resource],
    actualChange: actualAmount
  };
}

/**
 * Add a resource to a player.
 * Fires resources-defined onBeforeResourceGain and onResourceGained hooks.
 *
 * @returns Result indicating success and new amount
 */
export function addResource(
  state: GameState,
  playerId: string,
  resource: string,
  amount: number
): ResourceChangeResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Initialize resources if not present
  if (!player.resources) {
    player.resources = {};
  }

  const currentAmount = player.resources[resource] ?? 0;

  // Fire resources-defined onBeforeResourceGain hook (blocking)
  let actualAmount = amount;
  const beforeResult = mechanicRegistry.fire('resources', 'onBeforeResourceGain', state, playerId, {
    resource, amount: actualAmount, currentAmount
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return {
      success: false,
      newAmount: currentAmount,
      actualChange: 0,
      blocked: true,
      blockReason
    };
  }
  if (beforeResult && typeof (beforeResult as Record<string, unknown>).amount === 'number') {
    actualAmount = (beforeResult as Record<string, unknown>).amount as number;
  }

  // Apply the change
  player.resources[resource] = currentAmount + actualAmount;

  // Fire resources-defined onResourceGained hook (merge)
  const afterChanges = mechanicRegistry.fire('resources', 'onResourceGained', state, playerId, {
    resource, amount: actualAmount, previousAmount: currentAmount, newAmount: player.resources[resource]
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    success: true,
    newAmount: player.resources[resource],
    actualChange: actualAmount
  };
}

/**
 * Set a resource to a specific value.
 * Fires resources-defined before/after hooks based on delta direction.
 */
export function setResource(
  state: GameState,
  playerId: string,
  resource: string,
  amount: number
): ResourceChangeResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Initialize resources if not present
  if (!player.resources) {
    player.resources = {};
  }

  const currentAmount = player.resources[resource] ?? 0;
  const delta = amount - currentAmount;

  // Fire resources-defined before hook based on direction (blocking)
  if (delta !== 0) {
    const hookName = delta > 0 ? 'onBeforeResourceGain' : 'onBeforeResourceSpend';
    const beforeResult = mechanicRegistry.fire('resources', hookName, state, playerId, {
      resource, amount: Math.abs(delta), currentAmount
    });
    if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
      const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
      return {
        success: false,
        newAmount: currentAmount,
        actualChange: 0,
        blocked: true,
        blockReason
      };
    }
    // Note: setResource uses absolute target amount, so modified amounts from hooks are not applied
  }

  // Apply the change (use full amount, not modified delta)
  player.resources[resource] = amount;

  // Fire resources-defined after hook based on direction (merge)
  if (delta !== 0) {
    const afterHookName = delta > 0 ? 'onResourceGained' : 'onResourceSpent';
    const afterChanges = mechanicRegistry.fire('resources', afterHookName, state, playerId, {
      resource, amount: Math.abs(delta), previousAmount: currentAmount, newAmount: amount
    });
    if (afterChanges) applyStateChanges(state, afterChanges);
  }

  return {
    success: true,
    newAmount: amount,
    actualChange: delta
  };
}

/**
 * Get current amount of a resource for a player.
 */
export function getResource(state: GameState, playerId: string, resource: string): number {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.resources?.[resource] ?? 0;
}

/**
 * Check if a player has at least a certain amount of a resource.
 */
export function hasResource(
  state: GameState,
  playerId: string,
  resource: string,
  amount: number
): boolean {
  return getResource(state, playerId, resource) >= amount;
}

/**
 * Get all resources for a player.
 */
export function getAllResources(
  state: GameState,
  playerId: string
): Record<string, number> {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return { ...(player.resources ?? {}) };
}

/**
 * Get list of resource names configured for a player.
 */
export function getResourceNames(state: GameState, playerId: string): string[] {
  const player = state.players[playerId];
  if (!player || !player.resources) {
    return [];
  }

  return Object.keys(player.resources);
}
