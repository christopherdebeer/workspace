/**
 * Dice Core Mechanic
 *
 * Defines the foundational dice domain hooks that dice-related leaf mechanics implement.
 * Any mechanic that works with dice should declare `requires: ['dice']` and implement
 * the hooks defined here.
 *
 * This mechanic is always enabled. Core dice services fire these hooks
 * and only mechanics that declare `requires: ['dice']` receive them.
 *
 * Defined hooks:
 * - onDiceRolled: After dice are rolled (merge)
 * - onBeforeDiceRoll: Before rolling dice, can block/modify (blocking)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for dice-defined hooks ============

export interface DiceRolledPayload {
  /** Individual die results */
  results: number[];
  /** Sum of all dice */
  total: number;
  /** Number of dice rolled */
  diceCount: number;
  /** Sides per die */
  diceSides: number;
  /** Purpose of the roll */
  purpose?: string;
  /** Dice that were kept (for re-roll mechanics) */
  keptDice?: number[];
}

export interface BeforeDiceRollPayload {
  /** Requested number of dice */
  diceCount: number;
  /** Requested sides per die */
  diceSides: number;
  /** Purpose of the roll */
  purpose?: string;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the dice core mechanic.
 * Mechanics that declare `requires: ['dice']` can implement these.
 *
 * Use intersection typing for type safety:
 * ```typescript
 * const myMechanic: MechanicHooks & DiceHooks = { ... };
 * ```
 */
export interface DiceHooks {
  onDiceRolled?(ctx: HookContext, payload: DiceRolledPayload): StateChanges | null;
  onBeforeDiceRoll?(ctx: HookContext, payload: BeforeDiceRollPayload): { blocked?: boolean; blockReason?: string; diceCount?: number; diceSides?: number; modifier?: number } | null;
}

// ============ The mechanic itself ============

export const diceMechanic: MechanicHooks = {
  slug: 'dice',
  name: 'Dice Core',

  defines: {
    onBeforeDiceRoll: {
      description: 'Before rolling dice. Can modify count/sides or block.',
      resolution: 'blocking',
    },
    onDiceRolled: {
      description: 'After dice are rolled.',
      resolution: 'merge',
    },
  },
};
