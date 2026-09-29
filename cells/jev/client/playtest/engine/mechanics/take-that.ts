/**
 * Take-That Mechanic
 *
 * Direct attack cards targeting opponents.
 * Handles interference card validation and effect application.
 *
 * Requires: cards (core mechanic)
 *
 * Hooks used:
 * - preValidateAction: Validate target for interference cards
 * - onCardPlayed: Apply interference effects to target player (cards-defined hook)
 */

import { MechanicHooks, HookContext, ValidationResult, StateChanges } from './types';
import { GameAction, PlayCardAction } from '../types/game';
import type { CardsHooks, CardPlayedPayload } from './core/cards';
import { addEffect } from './core/effects';

const INTERFERENCE_EFFECTS = ['block_turn', 'probability_penalty', 'force_discard', 'skip'];

export const takeThatMechanic: MechanicHooks & CardsHooks = {
  slug: 'take-that',
  name: 'Take That',
  requires: ['cards', 'effects'],

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // Only validate play_card actions
    if (action.type !== 'play_card') return null;

    const playAction = action as PlayCardAction;
    const card = (ctx.player.hand ?? []).find(c => c.name === playAction.card);

    // Card not found - let core validation handle this
    if (!card) return null;

    // Check if this is an interference card
    const isInterferenceCard = card.type === 'interference' ||
                               (card.effect?.type && INTERFERENCE_EFFECTS.includes(card.effect.type));

    if (!isInterferenceCard) return null;

    const opponents = ctx.state.turnOrder.filter(pid => pid !== ctx.playerId);

    if (opponents.length > 1 && !playAction.target) {
      // Multiple opponents - require explicit target
      return {
        valid: false,
        error: `Interference card "${card.name}" requires a "target" field. Valid targets: ${opponents.join(', ')}`
      };
    }

    if (playAction.target) {
      // Validate target is a valid opponent
      if (!opponents.includes(playAction.target)) {
        return {
          valid: false,
          error: `Invalid target "${playAction.target}". Valid targets: ${opponents.join(', ')}`
        };
      }
    }

    // If only 1 opponent, target is implicit (no need to specify)
    return { valid: true };
  },

  /**
   * Apply interference effects when an interference card is played.
   * Handles block_turn and skip by adding the effect to the target player.
   * (probability_penalty and force_discard are handled by placed-card-effects applyEffect.)
   */
  onCardPlayed(ctx: HookContext, payload: CardPlayedPayload): StateChanges | null {
    const { card, playContext } = payload;

    // Only handle interference cards
    const isInterferenceCard = card.type === 'interference' ||
      (card.effect?.type && INTERFERENCE_EFFECTS.includes(card.effect.type));
    if (!isInterferenceCard || !card.effect?.type) return null;

    const effectType = card.effect.type;

    // Only handle effect types that aren't covered by applyEffect mechanics
    if (effectType !== 'block_turn' && effectType !== 'skip') return null;

    // Determine target: explicit from action, or implicit single opponent
    const actionTarget = playContext?.actionTarget as string | undefined;
    const opponents = ctx.state.turnOrder.filter(pid => pid !== ctx.playerId);
    const target = actionTarget || (opponents.length === 1 ? opponents[0] : null);
    if (!target || !ctx.state.players[target]) return null;

    // Add the blocking effect to the target player
    addEffect(ctx.state, target, {
      type: effectType,
      value: card.effect.value,
      duration: card.effect.duration ?? 1,
      source: ctx.playerId
    });

    return null;
  }
};
