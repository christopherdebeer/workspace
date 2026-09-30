/**
 * Effects Core Service
 *
 * Manages player effects (status effects, buffs, debuffs).
 * This is a "trunk" mechanic that other mechanics depend on.
 *
 * Fires effects-defined hooks:
 * - onBeforeEffectAdd: Can modify effect or block (blocking)
 * - onBeforeEffectRemove: Can block effect removal (blocking)
 * - onEffectAdded: Notified after effect added (merge)
 * - onEffectRemoved: Notified when effect removed/expired (merge)
 */

import { GameState, Effect } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Result from effect operation
 */
export interface EffectOperationResult {
  /** True if the operation was applied */
  success: boolean;
  /** The effect that was operated on */
  effect?: Effect;
  /** True if operation was blocked by a hook */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
}

/**
 * Add an effect to a player.
 * Calls onBeforeAddEffect and onAfterAddEffect hooks.
 *
 * @returns Result indicating success
 */
export function addEffect(
  state: GameState,
  playerId: string,
  effect: Effect
): EffectOperationResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Fire effects-defined onBeforeEffectAdd hook (blocking)
  let effectToAdd = effect;
  const beforeResult = mechanicRegistry.fire('effects', 'onBeforeEffectAdd', state, playerId, {
    effect: effectToAdd
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { success: false, blocked: true, blockReason };
  }
  if (beforeResult && (beforeResult as Record<string, unknown>).effect) {
    effectToAdd = (beforeResult as Record<string, unknown>).effect as Effect;
  }

  // Check if an effect of the same type already exists
  const existingIndex = player.effects.findIndex(e => e.type === effectToAdd.type);
  const replaced = existingIndex !== -1;
  if (replaced) {
    // Replace existing effect (refresh duration)
    player.effects[existingIndex] = effectToAdd;
  } else {
    // Add new effect
    player.effects.push(effectToAdd);
  }

  // Fire effects-defined onEffectAdded hook (merge)
  const afterChanges = mechanicRegistry.fire('effects', 'onEffectAdded', state, playerId, {
    effect: effectToAdd, replaced
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    success: true,
    effect: effectToAdd
  };
}

/**
 * Remove an effect from a player by type.
 * Fires effects-defined onBeforeEffectRemove (blocking) and onEffectRemoved (merge).
 *
 * @returns Result indicating success and the removed effect
 */
export function removeEffect(
  state: GameState,
  playerId: string,
  effectType: string
): EffectOperationResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const effectIndex = player.effects.findIndex(e => e.type === effectType);
  if (effectIndex === -1) {
    return {
      success: false,
      blockReason: `Effect "${effectType}" not found on player`
    };
  }

  const effect = player.effects[effectIndex];

  // Fire effects-defined onBeforeEffectRemove hook (blocking)
  const beforeResult = mechanicRegistry.fire('effects', 'onBeforeEffectRemove', state, playerId, {
    effect
  });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { success: false, blocked: true, blockReason };
  }

  // Remove the effect
  player.effects.splice(effectIndex, 1);

  // Fire effects-defined onEffectRemoved hook (merge)
  const afterChanges = mechanicRegistry.fire('effects', 'onEffectRemoved', state, playerId, {
    effect, expired: false
  });
  if (afterChanges) applyStateChanges(state, afterChanges);

  return {
    success: true,
    effect
  };
}

/**
 * Remove all effects from a player.
 *
 * @returns Array of removed effects
 */
export function clearEffects(state: GameState, playerId: string): Effect[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const removed = [...player.effects];
  player.effects = [];
  return removed;
}

/**
 * Decrement duration of all effects for a player.
 * Removes effects that reach 0 duration.
 * Calls onEffectExpired for each expired effect.
 *
 * @returns Array of expired effects that were removed
 */
export function decrementEffectDurations(state: GameState, playerId: string): Effect[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const expiredEffects: Effect[] = [];
  const remainingEffects: Effect[] = [];

  for (const effect of player.effects) {
    const newDuration = effect.duration - 1;
    if (newDuration <= 0) {
      expiredEffects.push(effect);
    } else {
      remainingEffects.push({ ...effect, duration: newDuration });
    }
  }

  // Update player's effects
  player.effects = remainingEffects;

  // Fire effects-defined onEffectRemoved hook for each expired effect
  for (const effect of expiredEffects) {
    const changes = mechanicRegistry.fire('effects', 'onEffectRemoved', state, playerId, {
      effect, expired: true
    });
    if (changes) applyStateChanges(state, changes);
  }

  return expiredEffects;
}

/**
 * Check if a player has a specific effect type.
 */
export function hasEffect(state: GameState, playerId: string, effectType: string): boolean {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.effects.some(e => e.type === effectType);
}

/**
 * Get a specific effect from a player.
 * Returns undefined if not found.
 */
export function getEffect(state: GameState, playerId: string, effectType: string): Effect | undefined {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.effects.find(e => e.type === effectType);
}

/**
 * Get all effects for a player.
 */
export function getEffects(state: GameState, playerId: string): Effect[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return [...player.effects];
}

/**
 * Get effects of a specific type from a player.
 */
export function getEffectsByType(state: GameState, playerId: string, effectType: string): Effect[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.effects.filter(e => e.type === effectType);
}

/**
 * Get the total value of effects of a specific type.
 * Useful for stacking effects like "probability_boost".
 */
export function getEffectValue(state: GameState, playerId: string, effectType: string): number {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  return player.effects
    .filter(e => e.type === effectType)
    .reduce((sum, e) => sum + (e.value ?? 0), 0);
}

/**
 * Check if a player is blocked by any blocking effect.
 * Common blocking effects: block_turn, skip, lose_turn
 */
export function isBlocked(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const blockingEffectTypes = ['block_turn', 'skip', 'lose_turn', 'stunned', 'frozen'];
  return player.effects.some(e => blockingEffectTypes.includes(e.type));
}

/**
 * Extend the duration of an existing effect.
 * If effect doesn't exist, does nothing.
 *
 * @returns True if effect was found and extended
 */
export function extendEffectDuration(
  state: GameState,
  playerId: string,
  effectType: string,
  additionalDuration: number
): boolean {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const effect = player.effects.find(e => e.type === effectType);
  if (!effect) {
    return false;
  }

  effect.duration += additionalDuration;
  return true;
}
