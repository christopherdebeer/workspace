/**
 * Card Piles Core Service
 *
 * Manages deck, discard pile, and card play operations.
 * This is a "trunk" mechanic that other mechanics depend on.
 *
 * Strangler fig pattern: Wraps existing game.ts logic, gradually
 * adding hooks for dependent mechanics to intercept.
 *
 * Hooks fired:
 * - onBeforeDraw / onBeforeCardDraw: Can modify draw count or block draw
 * - onAfterDraw / onCardDrawn: Notified after draw completes
 * - onDiscard / onCardDiscarded: Notified when cards are discarded
 * - onCardPlayed: Notified when a card is played from hand
 */

import { GameState, Card } from '../../types/game';
import { shuffleDeck } from '../../core/rules';
import { mechanicRegistry } from '../registry';
import { applyStateChanges } from '../registry';
import { removeFromHandByName } from './hand';
import { getCardsState, CardsSharedState } from './cards';

/**
 * Draw context for hooks (re-exported from types)
 */
export type { DrawContext } from '../types';

/**
 * Result of a draw operation
 */
export interface DrawResult {
  cards: Card[];
  reshuffled: boolean;
  /** True if draw was blocked by a hook */
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Internal draw implementation without hooks.
 * Used by drawFromDeck and for cases where hooks shouldn't fire.
 */
function drawFromDeckInternal(state: GameState, count: number): { cards: Card[]; reshuffled: boolean } {
  const cardsState = getCardsState(state);
  const drawn: Card[] = [];
  let reshuffled = false;

  for (let i = 0; i < count; i++) {
    if (cardsState.deck.length === 0) {
      // Reshuffle discard pile (keep top card if tracking)
      if (cardsState.discardPile.length === 0) {
        break; // No cards left anywhere
      }

      // If tracking top card, keep it in discard
      const topCard = cardsState.topCard;
      let cardsToShuffle = cardsState.discardPile;

      if (topCard) {
        // Keep top card, shuffle the rest
        cardsToShuffle = cardsState.discardPile.filter(c => c !== topCard);
        cardsState.discardPile = [topCard];
      } else {
        cardsState.discardPile = [];
      }

      if (cardsToShuffle.length > 0) {
        cardsState.deck = shuffleDeck(cardsToShuffle);
        reshuffled = true;
      } else {
        break; // Only top card left, can't draw
      }
    }

    const card = cardsState.deck.shift();
    if (card) {
      drawn.push(card);
    }
  }

  return { cards: drawn, reshuffled };
}

/**
 * Draw cards from deck, reshuffling discard if needed.
 * Does NOT add to hand - caller decides destination.
 * Fires cards-defined onBeforeCardDraw and onCardDrawn hooks.
 *
 * @param state - Game state
 * @param count - Number of cards to draw
 * @param playerId - Player drawing (for hook context). If not provided, hooks are skipped.
 */
export function drawFromDeck(state: GameState, count: number, playerId?: string): DrawResult {
  let actualCount = count;
  if (playerId) {
    // Fire cards-defined onBeforeCardDraw hook (blocking)
    const beforeResult = mechanicRegistry.fire('cards', 'onBeforeCardDraw', state, playerId, {
      requestedCount: actualCount
    });
    if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
      const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
      return { cards: [], reshuffled: false, blocked: true, blockReason };
    }
    if (beforeResult && typeof (beforeResult as Record<string, unknown>).count === 'number') {
      actualCount = (beforeResult as Record<string, unknown>).count as number;
    }
  }

  // Perform the draw
  const { cards: drawn, reshuffled } = drawFromDeckInternal(state, actualCount);

  // Fire cards-defined onCardDrawn hook (merge)
  if (playerId && drawn.length > 0) {
    const cardsChanges = mechanicRegistry.fire('cards', 'onCardDrawn', state, playerId, {
      cards: drawn, requestedCount: count, reshuffled
    });
    if (cardsChanges) applyStateChanges(state, cardsChanges);
  }

  return { cards: drawn, reshuffled };
}

/**
 * Add cards to discard pile, updating top card tracking.
 * Fires cards-defined onCardDiscarded hook.
 *
 * @param state - Game state
 * @param cards - Cards to discard
 * @param playerId - Optional player discarding (for hook context)
 */
export function addToDiscard(state: GameState, cards: Card[], playerId?: string): void {
  const cardsState = getCardsState(state);

  for (const card of cards) {
    cardsState.discardPile.push(card);

    // Update top card tracking (currentColor is set by card-matching's onCardPlayed)
    cardsState.topCard = card;
  }

  // Fire cards-defined onCardDiscarded hook (merge)
  if (cards.length > 0 && playerId) {
    const cardsChanges = mechanicRegistry.fire('cards', 'onCardDiscarded', state, playerId, { cards });
    if (cardsChanges) applyStateChanges(state, cardsChanges);
  }
}

/**
 * Result of a play card operation
 */
export interface PlayCardResult {
  /** The card that was played, or null if not found */
  card: Card | null;
}

/**
 * Play a card from hand to discard pile.
 * Removes from hand, adds to discard, fires onCardPlayed hook.
 *
 * @param state - Game state
 * @param playerId - Player playing the card
 * @param cardName - Name of the card to play
 * @param playContext - Additional context (e.g., declaredColor for wild cards)
 */
export function playCard(
  state: GameState,
  playerId: string,
  cardName: string,
  playContext?: Record<string, unknown>
): PlayCardResult {
  const card = removeFromHandByName(state, playerId, cardName);
  if (!card) {
    return { card: null };
  }

  addToDiscard(state, [card], playerId);

  // Fire cards-defined onCardPlayed hook (card-matching sets currentColor here)
  const cardPlayedChanges = mechanicRegistry.fire('cards', 'onCardPlayed', state, playerId, {
    card, target: 'discard', playContext: playContext ?? {}
  });
  if (cardPlayedChanges) applyStateChanges(state, cardPlayedChanges);

  return { card };
}

/**
 * Peek at top of discard pile without removing.
 */
export function peekDiscard(state: GameState): Card | undefined {
  const cardsState = getCardsState(state);
  if (cardsState.discardPile.length === 0) return undefined;
  return cardsState.discardPile[cardsState.discardPile.length - 1];
}

/**
 * Check if deck has cards available (including potential reshuffle).
 */
export function hasCardsAvailable(state: GameState): boolean {
  const cardsState = getCardsState(state);
  return cardsState.deck.length > 0 || cardsState.discardPile.length > 1;
}

/**
 * Get count of cards in deck.
 */
export function getDeckSize(state: GameState): number {
  return getCardsState(state).deck.length;
}

/**
 * Get count of cards in discard pile.
 */
export function getDiscardSize(state: GameState): number {
  return getCardsState(state).discardPile.length;
}
