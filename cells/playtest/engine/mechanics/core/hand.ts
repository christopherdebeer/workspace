/**
 * Hand Core Service
 *
 * Manages player hand operations.
 * This is a "trunk" mechanic that other mechanics depend on.
 *
 * Fires cards-defined hooks:
 * - onBeforeAddToHand: Can filter cards or block add (blocking)
 * - onAfterAddToHand: Notified after cards added (merge)
 * - onAfterRemoveFromHand: Notified after cards removed (merge)
 */

import { GameState, Card, PlayerState } from '../../types/game';
import { mechanicRegistry } from '../registry';
import { applyStateChanges } from '../registry';

/**
 * Get or initialize player's hand array.
 * Ensures hand exists for games that use cards.
 */
function ensureHand(player: PlayerState): Card[] {
  if (!player.hand) {
    player.hand = [];
  }
  return player.hand;
}

/**
 * Result from addToHand operation
 */
export interface AddToHandResult {
  /** Cards that were actually added */
  addedCards: Card[];
  /** True if add was blocked by a hook */
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Add cards to a player's hand.
 * Calls onBeforeAddToHand and onAfterAddToHand hooks.
 *
 * @returns Result indicating what was added or if blocked
 */
export function addToHand(state: GameState, playerId: string, cards: Card[]): AddToHandResult {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  // Fire cards-defined onBeforeAddToHand hook (blocking)
  const beforeResult = mechanicRegistry.fire('cards', 'onBeforeAddToHand', state, playerId, { cards });
  if (beforeResult && (beforeResult as Record<string, unknown>).blocked) {
    const blockReason = (beforeResult as Record<string, unknown>).blockReason as string | undefined;
    return { addedCards: [], blocked: true, blockReason };
  }

  const cardsToAdd = (beforeResult && (beforeResult as Record<string, unknown>).cards as Card[] | undefined) ?? cards;

  // Add cards to hand (ensure hand exists)
  const hand = ensureHand(player);
  hand.push(...cardsToAdd);

  // Fire cards-defined onAfterAddToHand hook (merge)
  if (cardsToAdd.length > 0) {
    const afterChanges = mechanicRegistry.fire('cards', 'onAfterAddToHand', state, playerId, { cards: cardsToAdd });
    if (afterChanges) applyStateChanges(state, afterChanges);
  }

  return { addedCards: cardsToAdd };
}

/**
 * Remove a card from player's hand by index.
 * Returns the removed card, or null if index invalid.
 * Calls onAfterRemoveFromHand hook.
 */
export function removeFromHandByIndex(state: GameState, playerId: string, cardIndex: number): Card | null {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const hand = ensureHand(player);
  if (cardIndex < 0 || cardIndex >= hand.length) {
    return null;
  }

  const [card] = hand.splice(cardIndex, 1);

  // Fire cards-defined onAfterRemoveFromHand hook
  const changes = mechanicRegistry.fire('cards', 'onAfterRemoveFromHand', state, playerId, { cards: [card] });
  if (changes) applyStateChanges(state, changes);

  return card;
}

/**
 * Remove a card from player's hand by name.
 * Returns the removed card, or null if not found.
 * Calls onAfterRemoveFromHand hook.
 */
export function removeFromHandByName(state: GameState, playerId: string, cardName: string): Card | null {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const hand = ensureHand(player);
  const cardIndex = hand.findIndex(c => c.name === cardName);
  if (cardIndex === -1) {
    return null;
  }

  const [card] = hand.splice(cardIndex, 1);

  // Fire cards-defined onAfterRemoveFromHand hook
  const changes = mechanicRegistry.fire('cards', 'onAfterRemoveFromHand', state, playerId, { cards: [card] });
  if (changes) applyStateChanges(state, changes);

  return card;
}

/**
 * Remove multiple cards from player's hand by names.
 * Returns array of removed cards (may be shorter if some not found).
 * Fires single batched onAfterRemoveFromHand hook.
 */
export function removeCardsFromHand(state: GameState, playerId: string, cardNames: string[]): Card[] {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Player ${playerId} not found`);
  }

  const hand = ensureHand(player);
  const removed: Card[] = [];

  for (const cardName of cardNames) {
    const cardIndex = hand.findIndex(c => c.name === cardName);
    if (cardIndex !== -1) {
      const [card] = hand.splice(cardIndex, 1);
      removed.push(card);
    }
  }

  // Fire cards-defined onAfterRemoveFromHand hook (batched)
  if (removed.length > 0) {
    const changes = mechanicRegistry.fire('cards', 'onAfterRemoveFromHand', state, playerId, { cards: removed });
    if (changes) applyStateChanges(state, changes);
  }

  return removed;
}

/**
 * Find a card in player's hand by name.
 * Returns the card (without removing) or undefined.
 */
export function findInHand(state: GameState, playerId: string, cardName: string): Card | undefined {
  const player = state.players[playerId];
  if (!player) return undefined;

  const hand = player.hand ?? [];
  return hand.find(c => c.name === cardName);
}

/**
 * Get player's current hand size.
 */
export function getHandSize(state: GameState, playerId: string): number {
  const player = state.players[playerId];
  if (!player) return 0;
  return (player.hand ?? []).length;
}

/**
 * Get all cards in player's hand.
 */
export function getHand(state: GameState, playerId: string): Card[] {
  const player = state.players[playerId];
  if (!player) return [];
  return [...(player.hand ?? [])]; // Return copy to prevent mutation
}
