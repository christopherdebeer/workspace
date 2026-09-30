/**
 * Visibility Core Mechanic
 *
 * Defines the foundational visibility domain hooks that hidden-information mechanics implement.
 * Any mechanic that works with hidden information should declare `requires: ['visibility']`
 * and implement the hooks defined here.
 *
 * This mechanic is always enabled. Core visibility services fire these hooks
 * and only mechanics that declare `requires: ['visibility']` receive them.
 *
 * Defined hooks:
 * - onInfoRevealed: After information is revealed to players (merge)
 * - onBeforeReveal: Before revealing info, can block (blocking)
 */

import { MechanicHooks, HookContext, StateChanges } from '../types';

// ============ Payload types for visibility-defined hooks ============

export interface InfoRevealedPayload {
  /** Type of information revealed */
  infoType: string;
  /** Player whose info was revealed (if applicable) */
  targetPlayerId?: string;
  /** Players who can now see the info */
  revealedTo: string[];
  /** The revealed information */
  info: unknown;
}

export interface BeforeRevealPayload {
  /** Type of information to reveal */
  infoType: string;
  /** Player whose info would be revealed */
  targetPlayerId?: string;
  /** Players who would see the info */
  revealTo: string[];
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the visibility core mechanic.
 * Mechanics that declare `requires: ['visibility']` can implement these.
 */
export interface VisibilityHooks {
  onInfoRevealed?(ctx: HookContext, payload: InfoRevealedPayload): StateChanges | null;
  onBeforeReveal?(ctx: HookContext, payload: BeforeRevealPayload): { blocked?: boolean; blockReason?: string } | null;
}

// ============ The mechanic itself ============

export const visibilityMechanic: MechanicHooks = {
  slug: 'visibility',
  name: 'Visibility Core',

  defines: {
    onBeforeReveal: {
      description: 'Before revealing information. Can block.',
      resolution: 'blocking',
    },
    onInfoRevealed: {
      description: 'After information is revealed to players.',
      resolution: 'merge',
    },
  },
};
