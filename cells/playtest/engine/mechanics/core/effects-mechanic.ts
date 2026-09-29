/**
 * Effects Core Mechanic
 *
 * Defines the foundational effects domain hooks that effect-related leaf mechanics implement.
 * Any mechanic that works with player effects (buffs, debuffs, status) should declare
 * `requires: ['effects']` and implement the hooks defined here.
 *
 * This mechanic is always enabled. Core effects services fire these hooks
 * and only mechanics that declare `requires: ['effects']` receive them.
 *
 * Defined hooks:
 * - onEffectAdded: After an effect is added to a player (merge)
 * - onEffectRemoved: After an effect expires or is removed (merge)
 * - onBeforeEffectAdd: Before adding an effect, can block/modify (blocking)
 * - onBeforeEffectRemove: Before removing an effect, can block (blocking)
 */

import { MechanicHooks, HookContext, StateChanges, TurnEndContext } from '../types';
import { Effect } from '../../types/game';
import { decrementEffectDurations } from './effects';

// ============ Payload types for effects-defined hooks ============

export interface EffectAddedPayload {
  /** The effect that was added */
  effect: Effect;
  /** Whether it replaced an existing effect of the same type */
  replaced: boolean;
}

export interface EffectRemovedPayload {
  /** The effect that was removed */
  effect: Effect;
  /** Whether it expired naturally (duration reached 0) */
  expired: boolean;
}

export interface BeforeEffectAddPayload {
  /** The effect about to be added */
  effect: Effect;
}

export interface BeforeEffectRemovePayload {
  /** The effect about to be removed */
  effect: Effect;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the effects core mechanic.
 * Mechanics that declare `requires: ['effects']` can implement these.
 */
export interface EffectsHooks {
  onEffectAdded?(ctx: HookContext, payload: EffectAddedPayload): StateChanges | null;
  onEffectRemoved?(ctx: HookContext, payload: EffectRemovedPayload): StateChanges | null;
  onBeforeEffectAdd?(ctx: HookContext, payload: BeforeEffectAddPayload): { blocked?: boolean; blockReason?: string; effect?: Effect } | null;
  onBeforeEffectRemove?(ctx: HookContext, payload: BeforeEffectRemovePayload): { blocked?: boolean; blockReason?: string } | null;
}

// ============ The mechanic itself ============

export const effectsMechanic: MechanicHooks = {
  slug: 'effects',
  name: 'Effects Core',

  /**
   * Decrement effect durations for the player whose turn just ended.
   * Uses the effects API which properly fires onEffectRemoved hooks.
   */
  onTurnEnd(ctx: TurnEndContext): StateChanges | null {
    decrementEffectDurations(ctx.state, ctx.playerId);
    return null; // State already mutated by decrementEffectDurations
  },

  defines: {
    onBeforeEffectAdd: {
      description: 'Before adding an effect. Can modify or block.',
      resolution: 'blocking',
    },
    onEffectAdded: {
      description: 'After an effect is added to a player.',
      resolution: 'merge',
    },
    onEffectRemoved: {
      description: 'After an effect expires or is removed.',
      resolution: 'merge',
    },
    onBeforeEffectRemove: {
      description: 'Before removing an effect. Can block removal.',
      resolution: 'blocking',
    },
  },
};
