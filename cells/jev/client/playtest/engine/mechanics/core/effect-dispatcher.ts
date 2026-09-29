/**
 * Effect Dispatcher Core Mechanic
 *
 * Central dispatcher for card effects that aren't handled by specialized mechanics.
 * When a card with an effect is played, this mechanic routes the effect to the
 * appropriate handler via mechanicRegistry.applyEffect(), or handles common effects
 * directly (draw, score, reverse).
 *
 * This closes the gap where card effects are defined in RULES.md but never executed
 * because no onCardPlayed responder handles them.
 *
 * Hooks used:
 * - onCardPlayed: Dispatch card effects to handlers or apply directly
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges
} from '../types';
import type { CardsHooks, CardPlayedPayload } from './cards';
import { drawFromDeck } from './card-piles';
import { addToHand } from './hand';
import { addEffect } from './effects';
import { mechanicRegistry } from '../registry';

/**
 * Effect types handled directly by this dispatcher.
 * Other effect types are routed to mechanicRegistry.applyEffect().
 */
const DIRECT_EFFECT_TYPES = ['draw', 'score', 'reverse', 'bonus_worker'];

/**
 * Effect types that target opponents by default
 */
const OPPONENT_TARGETING_EFFECTS = ['draw', 'block_turn', 'skip', 'lose_turn'];

export const effectDispatcherMechanic: MechanicHooks & CardsHooks = {
  slug: 'effect-dispatcher',
  name: 'Effect Dispatcher',
  requires: ['cards'],

  /**
   * When a card is played, check if it has an effect and dispatch it.
   * This runs after more specific onCardPlayed handlers (take-that, placed-card-effects, etc.)
   * due to the registry ordering. If no other handler has applied the effect,
   * this dispatcher picks it up.
   */
  onCardPlayed(ctx: HookContext, { card, playContext }: CardPlayedPayload): StateChanges | null {
    if (!card.effect?.type) return null;

    const effectType = card.effect.type.toLowerCase();

    // Determine target player
    const actionTarget = playContext?.actionTarget as string | undefined;
    const targetMode = card.targetMode || (OPPONENT_TARGETING_EFFECTS.includes(effectType) ? 'opponents' : 'owner');

    let targetId: string;
    if (actionTarget && ctx.state.players[actionTarget]) {
      targetId = actionTarget;
    } else if (targetMode === 'opponents') {
      // Default to next player in turn order for opponent-targeting effects
      const currentIdx = ctx.state.turnOrder.indexOf(ctx.playerId);
      const nextIdx = (currentIdx + 1) % ctx.state.turnOrder.length;
      targetId = ctx.state.turnOrder[nextIdx];
    } else {
      targetId = ctx.playerId;
    }

    // Handle direct effect types
    switch (effectType) {
      case 'draw': {
        // Force target to draw cards (e.g., UNO Draw Two)
        const count = card.effect.value ?? 2;
        const drawn = drawFromDeck(ctx.state, count, targetId);
        if (drawn.cards.length > 0) {
          addToHand(ctx.state, targetId, drawn.cards);
        }
        return null; // Direct mutation via core services
      }

      case 'score': {
        // Add/subtract score for target
        const value = card.effect.value ?? 1;
        const target = ctx.state.players[targetId];
        if (target) {
          target.score = (target.score ?? 0) + value;
        }
        return null;
      }

      case 'reverse': {
        // Reverse turn order
        ctx.state.turnOrder.reverse();
        return null;
      }

      case 'bonus_worker': {
        // Add a bonus worker to the player
        const target = ctx.state.players[targetId];
        if (target) {
          const workers = (target as unknown as Record<string, unknown>).workers;
          if (typeof workers === 'number') {
            (target as unknown as Record<string, unknown>).workers = workers + (card.effect.value ?? 1);
          }
        }
        return null;
      }

      default:
        break;
    }

    // For effect types not handled directly, try the applyEffect dispatch
    const result = mechanicRegistry.applyEffect(ctx.state, targetId, {
      type: effectType,
      value: card.effect.value,
      duration: card.effect.duration ?? 1,
      source: ctx.playerId
    }, ctx.playerId);

    if (result?.handled) {
      return result.stateChanges ?? null;
    }

    // If no applyEffect handler found, add as a status effect on the target
    // This covers generic effects like block_turn, skip, lose_turn
    // that might not have been caught by take-that (e.g., non-interference cards)
    if (card.effect.duration && card.effect.duration > 0) {
      addEffect(ctx.state, targetId, {
        type: effectType,
        value: card.effect.value,
        duration: card.effect.duration,
        source: ctx.playerId
      });
    }

    return null;
  }
};
