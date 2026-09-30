/**
 * Combat Core Mechanic
 *
 * Defines the foundational combat domain hooks that combat-related leaf mechanics implement.
 * Any mechanic that works with combat should declare `requires: ['combat']` and implement
 * the hooks defined here.
 *
 * The combat API (combat.ts) provides functions for starting combat, adding modifiers,
 * resolving results, and applying casualties. This mechanic wires those into the hook system.
 *
 * Defined hooks:
 * - onBeforeCombat: Before combat starts, can modify setup or block (blocking)
 * - onCombatStarted: After combat is initiated (merge)
 * - onAttackModifier: Gather attack modifiers from all combat mechanics (merge)
 * - onDefenseModifier: Gather defense modifiers from all combat mechanics (merge)
 * - onCombatResolved: After combat result is determined (merge)
 * - onCasualtiesApplied: After casualties are distributed (merge)
 */

import { MechanicHooks, HookContext, StateChanges, CombatHookContext } from '../types';

// ============ Payload types for combat-defined hooks ============

export interface BeforeCombatPayload {
  attackerId: string;
  defenderId: string;
  attackerUnits?: string[];
  defenderUnits?: string[];
  territory?: string;
  combatType?: string;
}

export interface CombatStartedPayload {
  sessionId: string;
  attackerId: string;
  defenderId: string;
  territory?: string;
}

export interface AttackModifierPayload {
  attackerId: string;
  defenderId: string;
  baseAttack: number;
  territory?: string;
  combatType?: string;
}

export interface DefenseModifierPayload {
  attackerId: string;
  defenderId: string;
  baseDefense: number;
  territory?: string;
  combatType?: string;
}

export interface CombatResolvedPayload {
  winner: 'attacker' | 'defender' | 'draw';
  attackerLosses: number;
  defenderLosses: number;
  territoryChange: boolean;
  criticalHit?: boolean;
  criticalFailure?: boolean;
}

export interface CasualtiesAppliedPayload {
  attackerId: string;
  defenderId: string;
  attackerLosses: number;
  defenderLosses: number;
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the combat core mechanic.
 * Mechanics that declare `requires: ['combat']` can implement these.
 */
export interface CombatDefinedHooks {
  onBeforeCombat?(ctx: HookContext, payload: BeforeCombatPayload): { blocked?: boolean; blockReason?: string } | null;
  onCombatStarted?(ctx: HookContext, payload: CombatStartedPayload): StateChanges | null;
  onAttackModifier?(ctx: HookContext, payload: AttackModifierPayload): { modifier: number; reason: string } | null;
  onDefenseModifier?(ctx: HookContext, payload: DefenseModifierPayload): { modifier: number; reason: string } | null;
  onCombatResolved?(ctx: HookContext, payload: CombatResolvedPayload): StateChanges | null;
  onCasualtiesApplied?(ctx: HookContext, payload: CasualtiesAppliedPayload): StateChanges | null;
}

// ============ The mechanic itself ============

export const combatMechanic: MechanicHooks = {
  slug: 'combat',
  name: 'Combat Core',

  defines: {
    onBeforeCombat: {
      description: 'Before combat starts. Can block or modify combat setup.',
      resolution: 'blocking',
    },
    onCombatStarted: {
      description: 'After combat is initiated.',
      resolution: 'merge',
    },
    onAttackModifier: {
      description: 'Gather attack modifiers. Each mechanic can contribute bonuses/penalties.',
      resolution: 'merge',
    },
    onDefenseModifier: {
      description: 'Gather defense modifiers. Each mechanic can contribute bonuses/penalties.',
      resolution: 'merge',
    },
    onCombatResolved: {
      description: 'After combat result is determined. Can trigger post-combat effects.',
      resolution: 'merge',
    },
    onCasualtiesApplied: {
      description: 'After casualties are distributed. Can modify casualty effects.',
      resolution: 'merge',
    },
  },
};
