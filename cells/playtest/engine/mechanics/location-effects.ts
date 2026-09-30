/**
 * Location Effects Mechanic
 *
 * Handles effects triggered by entering locations on the grid.
 * This removes hardcoded location effect handling from game.ts.
 *
 * Hooks used:
 * - applyEffect: Handle location-specific effect types (draw_on_enter, etc.)
 */

import {
  MechanicHooks,
  EffectApplicationContext,
  EffectApplicationResult
} from './types';
import { drawFromDeck } from './core/card-piles';
import { addToHand } from './core/hand';
import { getCardsState } from './core/index';

/**
 * Effect types handled by this mechanic
 */
const LOCATION_EFFECT_TYPES = ['draw_on_enter', 'heal_on_enter', 'damage_on_enter'];

export const locationEffectsMechanic: MechanicHooks = {
  slug: 'location-effects',
  name: 'Location Effects',

  /**
   * Apply location-specific effects.
   * Handles draw_on_enter and other location-triggered effects.
   */
  applyEffect(ctx: EffectApplicationContext): EffectApplicationResult | null {
    const { state, playerId, effect, config } = ctx;
    const effectType = effect.type.toLowerCase();

    // Only handle location effect types
    if (!LOCATION_EFFECT_TYPES.includes(effectType)) {
      return null;
    }

    const player = state.players[playerId];

    switch (effectType) {
      case 'draw_on_enter': {
        // Draw cards when entering a location
        const drawCount = effect.value ?? 1;
        const handLimit = config.engine_mechanics?.hand_limit ?? Infinity;

        // Check if player can draw (hand limit)
        const playerHand = player.hand ?? [];
        if (playerHand.length >= handLimit) {
          return {
            handled: true,
            logMessage: 'draw_on_enter_blocked',
            logData: { reason: 'hand_limit_reached' }
          };
        }

        const actualDrawCount = Math.min(drawCount, handLimit - playerHand.length);
        const cardsState = getCardsState(state);
        if (actualDrawCount > 0 && cardsState.deck.length > 0) {
          const { cards: drawnCards } = drawFromDeck(state, actualDrawCount, playerId);
          addToHand(state, playerId, drawnCards);

          return {
            handled: true,
            logMessage: 'draw_on_enter',
            logData: {
              drawnCount: drawnCards.length,
              cards: drawnCards.map(c => c.name)
            }
          };
        }

        return {
          handled: true,
          logMessage: 'draw_on_enter_empty_deck',
          logData: { reason: 'no_cards_available' }
        };
      }

      case 'heal_on_enter': {
        // Heal player when entering a location (for games with health)
        const healAmount = effect.value ?? 1;
        const resources = player.resources ?? {};
        const currentHealth = (resources.health as number) ?? 100;
        const maxHealth = 100; // Could be config-driven
        const newHealth = Math.min(currentHealth + healAmount, maxHealth);

        // Directly update player resources
        if (!player.resources) {
          player.resources = {};
        }
        player.resources.health = newHealth;

        return {
          handled: true,
          logMessage: 'heal_on_enter',
          logData: { healAmount, newHealth }
        };
      }

      case 'damage_on_enter': {
        // Damage player when entering a location
        const damageAmount = effect.value ?? 1;
        const resources = player.resources ?? {};
        const currentHealth = (resources.health as number) ?? 100;
        const newHealth = Math.max(currentHealth - damageAmount, 0);

        // Directly update player resources
        if (!player.resources) {
          player.resources = {};
        }
        player.resources.health = newHealth;

        return {
          handled: true,
          logMessage: 'damage_on_enter',
          logData: { damageAmount, newHealth }
        };
      }

      default:
        return null;
    }
  }
};
