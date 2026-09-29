/**
 * Placed Card Effects Mechanic
 *
 * Handles effects from cards placed on board states (traps, buffs, etc.).
 * This removes hardcoded placed card effect handling from game.ts.
 *
 * Hooks used:
 * - applyEffect: Handle placed card effect types (probability_boost, force_discard, etc.)
 *   from non-card sources (locations, events, abilities)
 * - onCardPlayed: Handle card effect types when a card is played
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges,
  EffectApplicationContext,
  EffectApplicationResult
} from './types';
import type { CardsHooks, CardPlayedPayload } from './core/cards';
import { getCardsState } from './core/index';

/**
 * Effect types handled by this mechanic (placed card effects)
 */
const PLACED_CARD_EFFECT_TYPES = [
  'probability_boost',
  'probability_penalty',
  'force_discard'
];

export const placedCardEffectsMechanic: MechanicHooks & CardsHooks = {
  slug: 'placed-card-effects',
  name: 'Placed Card Effects',
  requires: ['cards'],

  /**
   * React to card plays that carry placed-card effect types.
   * Handles probability modifiers and force_discard when triggered by playing a card.
   */
  onCardPlayed(ctx: HookContext, { card, playContext }: CardPlayedPayload): StateChanges | null {
    if (!card.effect?.type) return null;

    const effectType = card.effect.type.toLowerCase();
    if (!PLACED_CARD_EFFECT_TYPES.includes(effectType)) return null;

    const targetId = (playContext?.actionTarget as string) || ctx.playerId;
    const target = ctx.state.players[targetId];
    if (!target) return null;

    switch (effectType) {
      case 'probability_boost': {
        const boostValue = card.effect.value ?? 0.1;
        const targetAny = target as unknown as Record<string, unknown>;
        const currentMod = (targetAny.probabilityModifier as number) ?? 0;
        targetAny.probabilityModifier = currentMod + boostValue;
        return null; // Direct mutation, no stateChanges needed
      }

      case 'probability_penalty': {
        const penaltyValue = card.effect.value ?? -0.1;
        const targetAny = target as unknown as Record<string, unknown>;
        const currentMod = (targetAny.probabilityModifier as number) ?? 0;
        targetAny.probabilityModifier = currentMod + penaltyValue;
        return null;
      }

      case 'force_discard': {
        const targetHand = target.hand ?? [];
        if (targetHand.length === 0) return null;
        const discardIndex = Math.floor(Math.random() * targetHand.length);
        const [discardedCard] = targetHand.splice(discardIndex, 1);
        getCardsState(ctx.state).discardPile.push(discardedCard);
        return null;
      }

      default:
        return null;
    }
  },

  /**
   * Apply placed card effects from non-card sources (locations, events).
   * This handler remains for the applyEffect dispatch.
   */
  applyEffect(ctx: EffectApplicationContext): EffectApplicationResult | null {
    const { state, playerId, effect } = ctx;
    const effectType = effect.type.toLowerCase();

    // Only handle placed card effect types
    if (!PLACED_CARD_EFFECT_TYPES.includes(effectType)) {
      return null;
    }

    const player = state.players[playerId];

    switch (effectType) {
      case 'probability_boost': {
        // Positive probability modifier - adds to movement success chance
        // Uses dynamic property since probabilityModifier is not in base PlayerState type
        const boostValue = effect.value ?? 0.1;
        const playerAny = player as unknown as Record<string, unknown>;
        const currentMod = (playerAny.probabilityModifier as number) ?? 0;
        playerAny.probabilityModifier = currentMod + boostValue;

        return {
          handled: true,
          logMessage: 'probability_boost_applied',
          logData: {
            boost: boostValue,
            newModifier: currentMod + boostValue
          }
        };
      }

      case 'probability_penalty': {
        // Negative probability modifier - reduces movement success chance
        const penaltyValue = effect.value ?? -0.1;
        const playerAny = player as unknown as Record<string, unknown>;
        const currentMod = (playerAny.probabilityModifier as number) ?? 0;
        playerAny.probabilityModifier = currentMod + penaltyValue;

        return {
          handled: true,
          logMessage: 'probability_penalty_applied',
          logData: {
            penalty: penaltyValue,
            newModifier: currentMod + penaltyValue
          }
        };
      }

      case 'force_discard': {
        // Force player to discard a card
        const playerHand = player.hand ?? [];
        if (playerHand.length === 0) {
          return {
            handled: true,
            logMessage: 'force_discard_no_cards',
            logData: { reason: 'empty_hand' }
          };
        }

        // Discard random card (or oldest if specified)
        const discardIndex = Math.floor(Math.random() * playerHand.length);
        const [discardedCard] = playerHand.splice(discardIndex, 1);
        getCardsState(state).discardPile.push(discardedCard);

        return {
          handled: true,
          logMessage: 'force_discard',
          logData: {
            discardedCard: discardedCard.name,
            remainingHandSize: playerHand.length
          }
        };
      }

      default:
        return null;
    }
  }
};
