/**
 * Card Matching Mechanic
 *
 * Handles UNO-style card matching where players must play cards that match
 * by color, value, or use wild cards with declared colors.
 *
 * Requires: cards (core mechanic)
 *
 * Hooks used:
 * - initSharedState: Initialize currentColor from top card
 * - preValidateAction: Validate card matches current color/top card
 * - onCardPlayed: Update currentColor after card play (cards-defined hook)
 * - onCardDrawn: Track draws for forced-draw rule (cards-defined hook)
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  TurnEndContext,
  isMechanicEnabled
} from './types';
import { GameAction, Card } from '../types/game';
import type { CardsHooks, CardDrawnPayload, CardPlayedPayload, FilterPlayableCardsPayload } from './core/cards';

interface CardMatchingConfig {
  /** Colors available in the game */
  colors?: string[];
  /** Whether number/value matching is enabled */
  value_matching?: boolean;
  /** Whether action type matching is enabled */
  action_matching?: boolean;
  /** Whether to allow any card when no color is set */
  allow_any_when_no_color?: boolean;
  /** Whether to force draw when no playable cards (default: true for UNO rules) */
  force_draw_when_blocked?: boolean;
}

const DEFAULT_COLORS = ['Red', 'Blue', 'Green', 'Yellow'];

/**
 * Check if a card is playable given the current game state
 */
export function isCardPlayable(
  card: Card,
  currentColor: string | null,
  topCard: Card | null,
  config: CardMatchingConfig
): boolean {
  const valueMatching = config?.value_matching ?? true;
  const actionMatching = config?.action_matching ?? true;
  const allowAnyWhenNoColor = config?.allow_any_when_no_color ?? true;

  // Wild cards are always playable
  if (card.type === 'wild') return true;

  // If no color constraint, any card is playable
  if (!currentColor && allowAnyWhenNoColor) return true;

  // Check color match
  const cardColor = card.effect?.color;
  if (cardColor === currentColor) return true;

  // Check value match
  if (valueMatching && topCard) {
    const cardValue = card.value ?? card.effect?.value;
    const topValue = topCard.value ?? topCard.effect?.value;
    if (cardValue !== undefined && cardValue === topValue) return true;
  }

  // Check action type match
  if (actionMatching && topCard) {
    const cardActionType = card.effect?.type;
    const topActionType = topCard.effect?.type;
    if (card.type === 'action' && topCard.type === 'action' &&
        cardActionType !== undefined && cardActionType === topActionType) {
      return true;
    }
  }

  return false;
}

/**
 * Check if player has any playable cards
 */
function hasPlayableCard(
  hand: Card[],
  currentColor: string | null,
  topCard: Card | null,
  config: CardMatchingConfig
): boolean {
  return hand.some(card => isCardPlayable(card, currentColor, topCard, config));
}

export const cardMatchingMechanic: MechanicHooks & CardsHooks = {
  slug: 'card-matching',
  name: 'Card Matching (UNO-style)',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'UNO-style card matching with color and value rules',
    properties: {
      colors: {
        type: 'array',
        description: 'Available colors (default: Red, Blue, Green, Yellow)'
      },
      value_matching: {
        type: 'boolean',
        description: 'Allow matching by card value/number (default: true)'
      },
      action_matching: {
        type: 'boolean',
        description: 'Allow matching by action type (default: true)'
      },
      allow_any_when_no_color: {
        type: 'boolean',
        description: 'Allow any card when no currentColor is set (default: true)'
      }
    }
  },

  /**
   * Initialize shared state with currentColor and draw tracking.
   * Reads topCard from shared context to set initial color (e.g., flipped discard pile card).
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;

    // Set currentColor from the flipped top card if available
    const topCard = ctx.shared.topCard as Card | undefined;
    const initialColor = topCard?.effect?.color ?? null;

    // Initialize draw tracking for forced draw rule
    const drawTracking: Record<string, boolean> = {};
    for (const playerId of ctx.playerIds) {
      drawTracking[playerId] = false;
    }

    return {
      currentColor: initialColor,
      cardMatchingDraws: drawTracking
    };
  },

  /**
   * Filter playable cards to only those matching current color/top card.
   * Cards-domain hook: called when building the play_card action's card list.
   */
  filterPlayableCards(ctx: HookContext, { cards }: FilterPlayableCardsPayload): Card[] | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;

    const mechanics = ctx.config.engine_mechanics as Record<string, unknown> | undefined;
    const matchConfig = mechanics?.card_matching as CardMatchingConfig | undefined;
    const currentColor = ctx.state.shared.currentColor as string | null;
    const topCard = ctx.state.shared.topCard as Card | null;

    return cards.filter(card => isCardPlayable(card, currentColor, topCard, matchConfig || {}));
  },

  /**
   * Validate that played card matches current color/top card.
   * Also enforce forced draw rule: if player has no playable cards and hasn't drawn,
   * they must draw instead of passing.
   */
  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;

    const mechanics = ctx.config.engine_mechanics as Record<string, unknown> | undefined;
    const matchConfig = mechanics?.card_matching as CardMatchingConfig | undefined;
    const currentColor = ctx.state.shared.currentColor as string | null;
    const topCard = ctx.state.shared.topCard as Card | null;

    // Handle pass action - enforce forced draw rule
    if (action.type === 'pass') {
      const forceDrawWhenBlocked = matchConfig?.force_draw_when_blocked ?? true;
      if (!forceDrawWhenBlocked) return null;

      const hand = ctx.player.hand || [];
      const hasPlayable = hasPlayableCard(hand, currentColor, topCard, matchConfig || {});

      // Check if player has drawn this turn (stored in shared state)
      const drawTracking = ctx.state.shared.cardMatchingDraws as Record<string, boolean> | undefined;
      const hasDrawnThisTurn = drawTracking?.[ctx.playerId] ?? false;

      if (!hasPlayable && !hasDrawnThisTurn) {
        return {
          valid: false,
          error: 'You have no playable cards. You must draw a card before passing. Use: draw count:1'
        };
      }

      // Allow pass if player has drawn and still can't play, OR if player has playable cards but chooses to pass
      return { valid: true };
    }

    if (action.type !== 'play_card') return null;

    const playAction = action as { type: 'play_card'; card: string; declaredColor?: string };
    if (!playAction.card) return null;

    const validColors = matchConfig?.colors ?? DEFAULT_COLORS;
    const valueMatching = matchConfig?.value_matching ?? true;
    const actionMatching = matchConfig?.action_matching ?? true;
    const allowAnyWhenNoColor = matchConfig?.allow_any_when_no_color ?? true;

    // Find the card in player's hand
    const card = ctx.player.hand?.find((c: Card) =>
      c.name === playAction.card || c.name.toLowerCase() === playAction.card.toLowerCase()
    );

    if (!card) {
      // Let game.ts handle "card not in hand" error
      return null;
    }

    // Wild card handling
    if (card.type === 'wild') {
      if (!playAction.declaredColor) {
        return {
          valid: false,
          error: `Wild cards require "declaredColor" field. Specify: ${validColors.join(', ')}`
        };
      }
      if (!validColors.includes(playAction.declaredColor)) {
        return {
          valid: false,
          error: `Invalid color "${playAction.declaredColor}". Valid colors: ${validColors.join(', ')}`
        };
      }
      // Wild cards are always playable with valid declared color
      return { valid: true };
    }

    // If no color constraint, allow any card
    if (!currentColor && allowAnyWhenNoColor) {
      return { valid: true };
    }

    // Check color match
    const cardColor = card.effect?.color;
    const colorMatch = cardColor === currentColor;

    // Check value/number match
    let valueMatch = false;
    if (valueMatching && topCard) {
      const cardValue = card.value ?? card.effect?.value;
      const topValue = topCard.value ?? topCard.effect?.value;
      valueMatch = cardValue !== undefined && cardValue === topValue;
    }

    // Check action type match
    let actionMatch = false;
    if (actionMatching && topCard) {
      const cardActionType = card.effect?.type;
      const topActionType = topCard.effect?.type;
      actionMatch = card.type === 'action' && topCard.type === 'action' &&
                   cardActionType !== undefined && cardActionType === topActionType;
    }

    if (!colorMatch && !valueMatch && !actionMatch) {
      const matchOptions = ['matching color'];
      if (valueMatching) matchOptions.push('value');
      if (actionMatching) matchOptions.push('action type');

      return {
        valid: false,
        error: `Card "${playAction.card}" doesn't match current color (${currentColor || 'none'})` +
               (topCard ? ` or top card (${topCard.name})` : '') +
               `. Play a card with ${matchOptions.join('/')}, or use a wild card.`
      };
    }

    return { valid: true };
  },

  /**
   * Cards-defined hook: Update currentColor after card play.
   * Owns the currentColor semantics for UNO-style matching.
   * Fired by card-piles.ts via mechanicRegistry.fire('cards', 'onCardPlayed', ...).
   */
  onCardPlayed(ctx: HookContext, { card, playContext }: CardPlayedPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;

    // Wild card with declared color takes priority
    if (card.type === 'wild' && playContext?.declaredColor) {
      return {
        sharedStateChanges: {
          currentColor: playContext.declaredColor
        }
      };
    }

    // For non-wild cards, update currentColor from card's color
    const cardColor = card.effect?.color;
    if (cardColor) {
      return {
        sharedStateChanges: {
          currentColor: cardColor
        }
      };
    }

    return null;
  },

  /**
   * Cards-defined hook: Track draws for forced-draw rule.
   * This is the preferred path (replaces draw tracking in postExecuteAction).
   * Fired by card-piles.ts via mechanicRegistry.fire('cards', 'onCardDrawn', ...).
   */
  onCardDrawn(ctx: HookContext, { cards }: CardDrawnPayload): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;
    if (!cards || cards.length === 0) return null;

    const currentDraws = (ctx.state.shared.cardMatchingDraws as Record<string, boolean>) || {};
    return {
      sharedStateChanges: {
        cardMatchingDraws: {
          ...currentDraws,
          [ctx.playerId]: true
        }
      }
    };
  },

  /**
   * Reset draw tracking at turn end for forced draw rule
   */
  onTurnEnd(ctx: TurnEndContext): StateChanges | null {
    if (!isMechanicEnabled(ctx.config, 'card-matching')) return null;

    // Reset draw tracking for the player whose turn just ended
    const currentDraws = (ctx.state.shared.cardMatchingDraws as Record<string, boolean>) || {};
    return {
      sharedStateChanges: {
        cardMatchingDraws: {
          ...currentDraws,
          [ctx.playerId]: false
        }
      }
    };
  }
};
