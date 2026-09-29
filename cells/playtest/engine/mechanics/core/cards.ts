/**
 * Cards Core Mechanic
 *
 * Defines the foundational card domain hooks that card-related leaf mechanics implement.
 * Any mechanic that works with cards should declare `requires: ['cards']` and implement
 * the hooks defined here.
 *
 * This mechanic is always enabled. Core card services fire these hooks
 * and only mechanics that declare `requires: ['cards']` receive them.
 *
 * Defined hooks:
 * - onCardDrawn: After cards are drawn from deck (merge)
 * - onCardPlayed: After a card is played from hand (merge)
 * - onCardDiscarded: After cards are discarded (merge)
 * - onBeforeCardDraw: Before drawing, can block/modify (blocking)
 * - onBeforeCardPlay: Before playing a card, can block (blocking)
 */

import {
  MechanicHooks,
  HookContext,
  StateChanges,
  ActionExecutionContext,
  ActionExecutionResult,
  SharedStateInitContext,
  SharedStateInitResult,
  PlayerInitContext,
  PlayerInitResult,
  ActionSchema,
  AvailableAction,
  ValidationResult
} from '../types';
import { Card, PlayCardAction, DrawAction, GameState, DeckConfig, GameAction } from '../../types/game';
import { playCard, drawFromDeck } from './card-piles';
import { addToHand } from './hand';
import { buildDeck, shuffleDeck } from '../../core/rules';

// ============ Cards Shared State (mechanic-owned) ============

/**
 * Shared state owned by the cards mechanic.
 * Stored in state.shared and accessed via getCardsState().
 */
export interface CardsSharedState {
  deck: Card[];
  discardPile: Card[];
  topCard?: Card;
  /** Temporary storage for starting hands during init (deleted after player init) */
  _startingHands?: Record<string, Card[]>;
}

/**
 * Get typed access to cards shared state.
 * This is the ONLY way to access deck/discardPile - enforces mechanic boundaries.
 */
export function getCardsState(state: GameState): CardsSharedState {
  // Initialize if not present (for games without cards)
  if (!state.shared.deck) {
    state.shared.deck = [];
  }
  if (!state.shared.discardPile) {
    state.shared.discardPile = [];
  }
  return state.shared as unknown as CardsSharedState;
}

/**
 * Get typed hand from player state.
 * Returns empty array if player has no hand (for non-card games).
 */
export function getPlayerHand(state: GameState, playerId: string): Card[] {
  const player = state.players[playerId];
  return player?.hand ?? [];
}

// ============ Payload types for cards-defined hooks ============

export interface CardDrawnPayload {
  /** Cards that were drawn */
  cards: Card[];
  /** Number originally requested */
  requestedCount: number;
  /** Whether the deck was reshuffled from discard */
  reshuffled: boolean;
}

export interface CardPlayedPayload {
  /** The card that was played */
  card: Card;
  /** Where the card was played (e.g., discard, board, etc.) */
  target?: string;
  /** Additional play context (e.g., declaredColor for wild cards) */
  playContext?: Record<string, unknown>;
}

export interface CardDiscardedPayload {
  /** Cards that were discarded */
  cards: Card[];
}

export interface BeforeCardDrawPayload {
  /** Number of cards requested to draw */
  requestedCount: number;
}

export interface BeforeCardPlayPayload {
  /** The card about to be played */
  card: Card;
  /** Player's current hand */
  hand: Card[];
}

export interface BeforeAddToHandPayload {
  /** Cards about to be added to hand */
  cards: Card[];
}

export interface CardsAddedToHandPayload {
  /** Cards that were added to hand */
  cards: Card[];
}

export interface CardsRemovedFromHandPayload {
  /** Cards that were removed from hand */
  cards: Card[];
}

// ============ Typed interface for dependents ============

/**
 * Hook methods defined by the cards core mechanic.
 * Mechanics that declare `requires: ['cards']` can implement these.
 *
 * Use intersection typing for type safety:
 * ```typescript
 * const myMechanic: MechanicHooks & CardsHooks = { ... };
 * ```
 */
export interface FilterPlayableCardsPayload {
  /** The candidate cards to filter */
  cards: Card[];
}

export interface CardsHooks {
  onCardDrawn?(ctx: HookContext, payload: CardDrawnPayload): StateChanges | null;
  onCardPlayed?(ctx: HookContext, payload: CardPlayedPayload): StateChanges | null;
  onCardDiscarded?(ctx: HookContext, payload: CardDiscardedPayload): StateChanges | null;
  onBeforeCardDraw?(ctx: HookContext, payload: BeforeCardDrawPayload): { blocked?: boolean; blockReason?: string; count?: number } | null;
  onBeforeCardPlay?(ctx: HookContext, payload: BeforeCardPlayPayload): { blocked?: boolean; blockReason?: string } | null;
  onBeforeAddToHand?(ctx: HookContext, payload: BeforeAddToHandPayload): { blocked?: boolean; blockReason?: string; cards?: Card[] } | null;
  onAfterAddToHand?(ctx: HookContext, payload: CardsAddedToHandPayload): StateChanges | null;
  onAfterRemoveFromHand?(ctx: HookContext, payload: CardsRemovedFromHandPayload): StateChanges | null;
  /** Filter which cards from hand are playable. Return filtered subset or null to skip. */
  filterPlayableCards?(ctx: HookContext, payload: FilterPlayableCardsPayload): Card[] | null;
}

// ============ The mechanic itself ============

export const cardsMechanic: MechanicHooks = {
  slug: 'cards',
  name: 'Cards Core',

  defines: {
    onBeforeCardDraw: {
      description: 'Before drawing cards. Can block or modify draw count.',
      resolution: 'blocking',
    },
    onCardDrawn: {
      description: 'After cards are drawn from deck into hand.',
      resolution: 'merge',
    },
    onBeforeCardPlay: {
      description: 'Before a card is played from hand. Can block the play.',
      resolution: 'blocking',
    },
    onCardPlayed: {
      description: 'After a card is played from hand.',
      resolution: 'merge',
    },
    onCardDiscarded: {
      description: 'After cards are discarded.',
      resolution: 'merge',
    },
    onBeforeAddToHand: {
      description: 'Before cards are added to hand. Can block or filter cards.',
      resolution: 'blocking',
    },
    onAfterAddToHand: {
      description: 'After cards are added to hand.',
      resolution: 'merge',
    },
    onAfterRemoveFromHand: {
      description: 'After cards are removed from hand.',
      resolution: 'merge',
    },
    filterPlayableCards: {
      description: 'Filter which cards from hand are playable for play_card. Returns filtered Card[].',
      resolution: 'first',
    },
  },

  getHighlight(config: unknown): { label: string; value: string }[] | null {
    if (!config || typeof config !== 'object') return null;
    const cfg = config as Record<string, unknown>;
    const deck = cfg.deck;
    if (!Array.isArray(deck)) return null;
    const total = deck.reduce((sum: number, c: Record<string, unknown>) => sum + ((c.count as number) ?? 0), 0);
    if (total <= 0) return null;
    return [{ label: 'Cards', value: String(total) }];
  },

  /**
   * Initialize shared state: build deck, shuffle, deal starting hands, create discard pile.
   * This moves all card setup logic from game.ts into the cards mechanic.
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const { config, playerIds } = ctx;

    // Get cards config (unified format: engine_mechanics.cards.deck)
    const cardsConfig = config.engine_mechanics?.cards as { deck?: DeckConfig[]; starting_hand?: number } | undefined;
    const deckConfig = cardsConfig?.deck ?? (config as { deck?: DeckConfig[] }).deck;  // Fall back to legacy top-level

    // No deck configured - nothing to initialize
    if (!deckConfig) return null;

    // Build and shuffle deck
    const deck = shuffleDeck(buildDeck(deckConfig));

    // Get starting hand size
    const startingCards = cardsConfig?.starting_hand ?? (config as { starting_cards?: number }).starting_cards ?? 0;

    // Pre-deal hands (stored temporarily for initPlayerState)
    const _startingHands: Record<string, Card[]> = {};
    for (const playerId of playerIds) {
      if (startingCards > 0 && deck.length >= startingCards) {
        _startingHands[playerId] = deck.splice(0, startingCards);
      } else {
        _startingHands[playerId] = [];
      }
    }

    // Create discard pile (flip top card if we have cards and dealt hands)
    const discardPile: Card[] = [];
    let topCard: Card | undefined;
    if (deck.length > 0 && startingCards > 0) {
      topCard = deck.shift()!;
      discardPile.push(topCard);
    }

    return { deck, discardPile, topCard, _startingHands };
  },

  /**
   * Initialize player state: set hand from pre-dealt cards.
   */
  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const startingHands = ctx.shared?._startingHands as Record<string, Card[]> | undefined;
    if (!startingHands) return null;

    const hand = startingHands[ctx.playerId] ?? [];
    return { hand };
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type === 'play_card') {
      return {
        required: ['card'],
        optional: ['declaredColor', 'target'],
        fields: {
          card: { type: 'string' },
          declaredColor: { type: 'string' },
          target: { type: 'string' },
        },
      };
    }
    if (action.type === 'draw') {
      return {
        optional: ['count'],
        fields: {
          count: { type: 'number', minimum: 1 },
        },
      };
    }
    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const { state, playerId } = ctx;
    const cardsState = getCardsState(state);
    const actions: AvailableAction[] = [];

    // === DRAW action (if game has a deck) ===
    if (cardsState.deck || cardsState.discardPile) {
      actions.push({
        action: { type: 'draw' } as GameAction,
        priority: 50,
        category: 'cards',
      });
    }

    // === PLAY_CARD action (for regular cards in hand) ===
    const hand = getPlayerHand(state, playerId);
    // Filter out placeable/location cards (handled by place-card mechanic)
    const basePlayable = hand.filter(c => !c.placeable && c.type !== 'location');
    if (basePlayable.length > 0) {
      const playableNames = basePlayable.map(c => c.name);
      const opponents = state.turnOrder.filter(pid => pid !== playerId);

      // Identify cards that need a target (interference/take-that cards)
      const targetingCards = basePlayable.filter(c =>
        c.type === 'interference' || c.effect?.type === 'block_turn' || c.effect?.type === 'skip'
      ).map(c => c.name);

      // Build optional fields
      const optional: Record<string, string> = { reasoning: 'Explanation of your play' };
      if (targetingCards.length > 0 && opponents.length > 1) {
        optional.target = `Target player for attack cards (${targetingCards.join(', ')}). Options: ${opponents.join(', ')}`;
      }
      if (hand.some(c => c.effect?.type === 'wild' || c.type === 'wild')) {
        optional.declaredColor = 'For wild cards: Red, Blue, Green, or Yellow';
      }

      // Build examples
      const examples = playableNames.slice(0, 2).map(card => {
        const isTargeting = targetingCards.includes(card);
        const example: Record<string, unknown> = { type: 'play_card', card };
        if (isTargeting && opponents.length > 0) {
          example.target = opponents[0];
        }
        return example as unknown as GameAction;
      });

      actions.push({
        action: { type: 'play_card', card: playableNames[0] } as unknown as GameAction,
        priority: 60,
        category: 'cards',
        description: 'Play a card from your hand to apply its effect',
        required: { card: 'The exact name of the card to play' },
        optional,
        examples,
        cards: playableNames,
      });
    }

    return actions;
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type === 'draw') {
      const cardsState = getCardsState(ctx.state);
      if (cardsState.deck.length === 0 && cardsState.discardPile.length <= 1) {
        return { valid: false, error: 'Draw pile is empty and cannot be reshuffled' };
      }
      return { valid: true };
    }

    if (action.type === 'play_card') {
      const playAction = action as PlayCardAction;
      const hand = getPlayerHand(ctx.state, ctx.playerId);
      const cardIndex = hand.findIndex(c => c.name === playAction.card);
      if (cardIndex === -1) {
        return { valid: false, error: `Card "${playAction.card}" not in your hand. Your cards: ${hand.map(c => c.name).join(', ')}` };
      }
      return { valid: true };
    }

    return null;
  },

  /**
   * Reverse play_card: move card from discard back to hand, restore topCard/currentColor.
   * Engine handles reverseTurn/saveState.
   */
  reverseAction(ctx: HookContext, action: GameAction): boolean | null {
    if (action.type !== 'play_card') return null;

    const { state, playerId } = ctx;
    const player = state.players[playerId];
    if (!player) return null;

    const playAction = action as PlayCardAction;
    const cardsState = getCardsState(state);

    const discardIndex = cardsState.discardPile.findIndex((c: Card) => c.name === playAction.card);
    if (discardIndex !== -1) {
      const [card] = cardsState.discardPile.splice(discardIndex, 1);
      if (!player.hand) player.hand = [];
      player.hand.push(card);

      // Restore previous top card
      if (cardsState.discardPile.length > 0) {
        cardsState.topCard = cardsState.discardPile[cardsState.discardPile.length - 1];
        // Restore currentColor only if card-matching previously set it
        if (state.shared.currentColor !== undefined) {
          state.shared.currentColor = (cardsState.topCard as Card).effect?.color ?? null;
        }
      }
    }

    return true;
  },

  /**
   * Contribute hand card names to the player view.
   * Engine merges this via Object.assign into the AvailableActionsResult.
   */
  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    const hand = getPlayerHand(ctx.state, ctx.playerId);
    if (hand.length === 0 && !ctx.state.shared.deck) return null;
    return {
      hand: hand.map(c => c.name),
    };
  },

  /**
   * Handle play_card and draw actions.
   * - play_card: remove from hand, discard, fire onCardPlayed
   * - draw: draw from deck, add to hand
   */
  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type === 'draw') {
      return executeDrawAction(ctx);
    }
    if (ctx.action.type !== 'play_card') return null;

    const { state, playerId } = ctx;
    const playAction = ctx.action as PlayCardAction;

    // Build play context (carries action metadata to onCardPlayed handlers)
    const playContext: Record<string, unknown> = {};
    if (playAction.declaredColor) playContext.declaredColor = playAction.declaredColor;
    if (playAction.target) playContext.actionTarget = playAction.target;

    // Core play: remove from hand, add to discard, fire onCardPlayed
    const result = playCard(state, playerId, playAction.card, playContext);
    if (!result.card) {
      return {
        handled: true,
        advanceTurn: false,
        checkWin: false,
        logMessage: 'play_card_failed',
        logData: { card: playAction.card, error: 'Card not in hand or failed to play' }
      };
    }

    const card = result.card;

    // Card effects are now handled by onCardPlayed responders:
    // - placed-card-effects: probability_boost, probability_penalty, force_discard
    // - take-that: block_turn, skip
    // - card-matching: currentColor
    // The generic applyEffect dispatch has been removed; each mechanic
    // reacts to the card play via the onCardPlayed hook fired by playCard().

    return {
      handled: true,
      advanceTurn: false,  // Let shouldAutoEndTurn / AP mechanic decide
      checkWin: true,
      logMessage: 'play_card',
      logData: {
        card: card.name,
        effect: card.effect,
        declaredColor: playAction.declaredColor,
        actionTarget: playAction.target,
        handSize: getPlayerHand(state, playerId).length,
        currentColor: state.shared.currentColor,
        newTopCard: (state.shared.topCard as Card)?.name
      }
    };
  },
};

/**
 * Execute draw action: draw cards from deck into hand.
 * advanceTurn is left undefined (auto-detect): advances in non-AP, saves in AP.
 */
function executeDrawAction(ctx: ActionExecutionContext): ActionExecutionResult {
  const { state, playerId } = ctx;
  const drawAction = ctx.action as DrawAction;
  const count = drawAction.count || 1;

  const { cards: drawn, blocked } = drawFromDeck(state, count, playerId);
  if (!blocked && drawn.length > 0) {
    addToHand(state, playerId, drawn);
  }

  return {
    handled: true,
    // advanceTurn intentionally omitted (undefined):
    // Non-AP games auto-advance; AP games let shouldAutoEndTurn handle it
    checkWin: false,
    logMessage: 'draw',
    logData: { count: drawn.length, handSize: getPlayerHand(state, playerId).length }
  };
}

/**
 * Draw cards from deck into a player's hand.
 * Standalone utility for CLI/external callers (mechanic execution uses executeDrawAction).
 */
export function drawCards(state: GameState, playerId: string, count: number): Card[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }
  const { cards: drawn, blocked } = drawFromDeck(state, count, playerId);
  if (!blocked && drawn.length > 0) {
    addToHand(state, playerId, drawn);
  }
  return drawn;
}
