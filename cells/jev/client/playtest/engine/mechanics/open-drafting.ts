/**
 * Open Drafting Mechanic
 *
 * Draft cards from a visible display.
 *
 * Hooks used:
 * - initSharedState: Initialize the draft display from deck
 * - preValidateAction: Validate draft action (card in display)
 * - onExecuteAction: Handle draft execution
 * - getAvailableActions: Expose draft action
 * - getPlayerView: Expose draft display card names in player view
 * - describeAction: Describe draft action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  SharedStateInitContext,
  SharedStateInitResult,
  ActionSchema
} from './types';
import { GameAction, Card, DraftAction } from '../types/game';
import { addToHand } from './core/hand';
import { drawFromDeck } from './core/card-piles';
import { getCardsState } from './core/index';

interface OpenDraftingConfig {
  display_size: number;
  refill?: 'immediate' | 'round_end' | 'none';
}

export const openDraftingMechanic: MechanicHooks = {
  slug: 'open-drafting',
  name: 'Open Drafting',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Draft cards from a visible display',
    properties: {
      display_size: {
        type: 'number',
        description: 'Number of cards visible in the draft display',
        required: true
      },
      refill: {
        type: 'string',
        description: 'When to refill the display',
        enum: ['immediate', 'round_end', 'none'],
        default: 'immediate'
      }
    },
    required: ['display_size']
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'draft') return null;
    return {
      required: ['card'],
      fields: {
        card: { type: 'string' },
      },
    };
  },

  /**
   * Initialize the draft display from the deck.
   * This removes the need for game.ts to know about open_drafting config.
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const draftConfig = ctx.config.engine_mechanics?.open_drafting as OpenDraftingConfig | undefined;
    if (!draftConfig) return null;

    const displaySize = draftConfig.display_size ?? 5;

    // Only initialize if deck has cards
    if (ctx.deck.length === 0) {
      return { draftDisplay: [] };
    }

    // Take cards from the front of the deck for display
    const display = ctx.deck.splice(0, Math.min(displaySize, ctx.deck.length));

    return { draftDisplay: display };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'draft') return null;

    const draftConfig = ctx.config.engine_mechanics?.open_drafting as OpenDraftingConfig | undefined;
    if (!draftConfig) {
      return { valid: false, error: 'Open drafting is not enabled for this game.' };
    }

    const draftAction = action as DraftAction;
    const display = (ctx.state.shared.draftDisplay || []) as Card[];

    if (!display.find(c => c.name === draftAction.card)) {
      return {
        valid: false,
        error: `Card "${draftAction.card}" not in draft display. Available: ${display.map(c => c.name).join(', ')}`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'draft') return null;

    const draftConfig = ctx.config.engine_mechanics?.open_drafting as OpenDraftingConfig | undefined;
    if (!draftConfig) return null;

    const draftAction = action as DraftAction;
    const display = (state.shared.draftDisplay || []) as Card[];
    const cardIndex = display.findIndex(c => c.name === draftAction.card);

    if (cardIndex === -1) {
      return {
        handled: true,
        stateChanges: {},
        advanceTurn: false,
        checkWin: false,
        logMessage: 'draft_failed',
        logData: { card: draftAction.card, error: 'Card not in display' }
      };
    }

    // Remove card from display
    const [draftedCard] = display.splice(cardIndex, 1);

    // Add to player's hand using core service
    addToHand(state, playerId, [draftedCard]);

    // Refill display if configured
    let newDisplay = [...display];
    const cardsState = getCardsState(state);
    if (draftConfig.refill === 'immediate' && cardsState.deck.length > 0) {
      const { cards: drawn } = drawFromDeck(state, 1);
      if (drawn.length > 0) {
        newDisplay.push(drawn[0]);
      }
    }

    return {
      handled: true,
      stateChanges: {
        sharedStateChanges: {
          draftDisplay: newDisplay
        }
      },
      advanceTurn: false, // Use maybeAdvanceTurn semantics (respects action points)
      checkWin: false,
      logMessage: 'card_drafted',
      logData: {
        card: draftedCard.name,
        displayRemaining: newDisplay.length
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const draftConfig = ctx.config.engine_mechanics?.open_drafting as OpenDraftingConfig | undefined;
    if (!draftConfig) return [];

    const display = (ctx.state.shared.draftDisplay || []) as Card[];
    if (display.length === 0) return [];

    // Return one action per card in display
    return display.map(card => ({
      action: {
        type: 'draft',
        card: card.name
      } as GameAction,
      priority: 45,
      category: 'drafting'
    }));
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const draftConfig = ctx.config.engine_mechanics?.open_drafting as OpenDraftingConfig | undefined;
    if (!draftConfig) return null;

    const display = (ctx.state.shared.draftDisplay || []) as Card[];
    return { draftDisplay: display.map(c => c.name) };
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'draft') return null;

    return {
      type: 'draft',
      label: 'Draft Card',
      description: 'Draft a card from the visible display into your hand.',
      examples: ['draft card:"Fire Spell"']
    };
  }
};
