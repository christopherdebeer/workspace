/**
 * Card Type Rules Mechanic
 *
 * Controls which card types can be played and how.
 * Supports playable restrictions (e.g., items can't be played, only held).
 *
 * Hooks used:
 * - preValidateAction: Block play_card if card type is not playable
 */

import { MechanicHooks, HookContext, ValidationResult } from './types';
import { GameAction, PlayCardAction, Card } from '../types/game';

interface CardTypeRule {
  playable?: boolean;
}

export const cardTypeRulesMechanic: MechanicHooks = {
  slug: 'card-type-rules',
  name: 'Card Type Rules',
  requires: ['cards'],

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // Only validate play_card actions
    if (action.type !== 'play_card') return null;

    const cardTypeRules = ctx.config.engine_mechanics?.card_type_rules as Record<string, CardTypeRule> | undefined;
    if (!cardTypeRules) return null;

    const playAction = action as PlayCardAction;
    const card = (ctx.player.hand ?? []).find(c => c.name === playAction.card);

    // Card not found - let core validation handle this
    if (!card) return null;

    const rules = cardTypeRules[card.type];
    if (!rules) return null;

    if (rules.playable === false) {
      const hint = card.type === 'item' ? ' Items are held in hand until used or traded.' :
                   card.type === 'location' ? ' Use a place_location or move action instead.' : '';
      return {
        valid: false,
        error: `Cannot play "${card.name}". Cards of type "${card.type}" cannot be played.${hint}`
      };
    }

    return { valid: true };
  }
};
