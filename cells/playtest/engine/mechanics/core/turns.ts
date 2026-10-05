/**
 * Turns Core Service
 *
 * Manages turn and round operations.
 * This is a "trunk" mechanic that turn-based mechanics depend on.
 *
 * Uses existing hooks:
 * - onTurnStart: Called at start of player's turn
 * - onTurnEnd: Called at end of player's turn (before advancing)
 */

import { GameState } from '../../types/game';
import { mechanicRegistry, applyStateChanges } from '../registry';

/**
 * Get the current player's ID.
 */
export function getCurrentPlayer(state: GameState): string | null {
  return state.currentPlayer;
}

/**
 * Get the turn order array.
 */
export function getTurnOrder(state: GameState): string[] {
  return [...state.turnOrder];
}

/**
 * Check if it's a specific player's turn.
 */
export function isPlayersTurn(state: GameState, playerId: string): boolean {
  return state.currentPlayer === playerId;
}

/**
 * Get the current round number.
 */
export function getCurrentRound(state: GameState): number {
  return state.round;
}

/**
 * Get the current turn number (total turns taken).
 */
export function getTurnNumber(state: GameState): number {
  return state.turnNumber;
}

/**
 * Get the index of the current player in turn order.
 */
export function getCurrentPlayerIndex(state: GameState): number {
  if (!state.currentPlayer) return -1;
  return state.turnOrder.indexOf(state.currentPlayer);
}

/**
 * Get the next player in turn order.
 * Does not modify state - just returns who would be next.
 */
export function getNextPlayer(state: GameState): string | null {
  if (!state.currentPlayer) return null;
  const currentIndex = state.turnOrder.indexOf(state.currentPlayer);
  const nextIndex = (currentIndex + 1) % state.turnOrder.length;
  return state.turnOrder[nextIndex];
}

/**
 * Get the previous player in turn order.
 */
export function getPreviousPlayer(state: GameState): string | null {
  if (!state.currentPlayer) return null;
  const currentIndex = state.turnOrder.indexOf(state.currentPlayer);
  const prevIndex = (currentIndex - 1 + state.turnOrder.length) % state.turnOrder.length;
  return state.turnOrder[prevIndex];
}

/**
 * Check if the current turn is the last turn of the round.
 * (i.e., advancing would start a new round)
 */
export function isLastTurnOfRound(state: GameState): boolean {
  if (!state.currentPlayer) return false;
  const currentIndex = state.turnOrder.indexOf(state.currentPlayer);
  return currentIndex === state.turnOrder.length - 1;
}

/**
 * Get the number of players in the game.
 */
export function getPlayerCount(state: GameState): number {
  return state.turnOrder.length;
}

/**
 * Get all active player IDs (not eliminated).
 */
export function getActivePlayers(state: GameState): string[] {
  return state.turnOrder.filter(playerId => {
    const player = state.players[playerId];
    if (!player) return false;
    if (player.state === 'eliminated') return false;
    if (player.effects?.some(e => e.type === 'eliminated')) return false;
    return true;
  });
}

/**
 * Check if a player is active (not eliminated).
 */
export function isPlayerActive(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  if (!player) return false;
  if (player.state === 'eliminated') return false;
  if (player.effects?.some(e => e.type === 'eliminated')) return false;
  return true;
}

/**
 * Get opponent player IDs (all players except the specified one).
 */
export function getOpponents(state: GameState, playerId: string): string[] {
  return state.turnOrder.filter(pid => pid !== playerId);
}

/**
 * Get active opponent player IDs.
 */
export function getActiveOpponents(state: GameState, playerId: string): string[] {
  return getActivePlayers(state).filter(pid => pid !== playerId);
}

/**
 * Check if only one active player remains.
 */
export function isOnlyOnePlayerRemaining(state: GameState): boolean {
  return getActivePlayers(state).length === 1;
}

/**
 * Get the last remaining player (if only one active).
 * Returns null if more than one player is active.
 */
export function getLastRemainingPlayer(state: GameState): string | null {
  const active = getActivePlayers(state);
  return active.length === 1 ? active[0] : null;
}

/**
 * Advance to the next turn.
 * Handles round incrementing and fires turn hooks.
 *
 * Note: This is a high-level operation. The game.ts still handles
 * the full advanceTurn logic including effect decrement and saving.
 * This service provides helper functions and may be used for
 * turn-related queries.
 */
export function advanceTurn(state: GameState): void {
  const previousPlayer = state.currentPlayer!;
  const currentIndex = state.turnOrder.indexOf(previousPlayer);
  const nextIndex = (currentIndex + 1) % state.turnOrder.length;
  const isNewRound = nextIndex === 0;

  // Fire onTurnEnd hooks for the player whose turn is ending
  const nextPlayerId = state.turnOrder[nextIndex];
  const turnEndChanges = mechanicRegistry.onTurnEnd(state, previousPlayer, nextPlayerId, isNewRound);
  applyStateChanges(state, turnEndChanges);

  // Increment round if wrapping around
  if (isNewRound) {
    state.round++;
  }
  state.turnNumber++;

  // Set new current player
  state.currentPlayer = state.turnOrder[nextIndex];

  // Fire onTurnStart hooks for the new current player
  const turnStartChanges = mechanicRegistry.onTurnStart(state, state.currentPlayer, isNewRound);
  applyStateChanges(state, turnStartChanges);
}

/**
 * Force set the current player (for special game mechanics).
 * Does not fire turn hooks - use with caution.
 */
export function setCurrentPlayer(state: GameState, playerId: string): boolean {
  if (!state.turnOrder.includes(playerId)) {
    return false;
  }
  state.currentPlayer = playerId;
  return true;
}

/**
 * Skip a player's turn by advancing to the next player.
 * Fires turn hooks appropriately.
 */
export function skipTurn(state: GameState): void {
  advanceTurn(state);
}

/**
 * Get turn info as a summary object.
 */
export function getTurnInfo(state: GameState): {
  currentPlayer: string | null;
  round: number;
  turnNumber: number;
  playerIndex: number;
  totalPlayers: number;
  isLastTurnOfRound: boolean;
} {
  return {
    currentPlayer: state.currentPlayer,
    round: state.round,
    turnNumber: state.turnNumber,
    playerIndex: getCurrentPlayerIndex(state),
    totalPlayers: state.turnOrder.length,
    isLastTurnOfRound: isLastTurnOfRound(state)
  };
}

// ============ Dynamic Turn Order (Phase 3) ============

/**
 * Set a new turn order.
 * Does not change current player unless they're no longer in the order.
 */
export function setTurnOrder(state: GameState, newOrder: string[]): void {
  state.turnOrder = [...newOrder];

  // If current player is no longer in order, set to first player
  if (state.currentPlayer && !newOrder.includes(state.currentPlayer)) {
    state.currentPlayer = newOrder[0] || null;
  }
}

/**
 * Shuffle the turn order randomly.
 * Optionally keeps the current player in place.
 */
export function shuffleTurnOrder(
  state: GameState,
  keepCurrentPlayer: boolean = false
): void {
  const order = [...state.turnOrder];

  // Fisher-Yates shuffle
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  if (keepCurrentPlayer && state.currentPlayer) {
    // Move current player to front
    const currentIdx = order.indexOf(state.currentPlayer);
    if (currentIdx > 0) {
      order.splice(currentIdx, 1);
      order.unshift(state.currentPlayer);
    }
  }

  state.turnOrder = order;
}

/**
 * Reverse the turn order.
 */
export function reverseTurnOrder(state: GameState): void {
  state.turnOrder = state.turnOrder.reverse();
}

/**
 * Move a player to a specific position in turn order.
 * @param position - 0-indexed position (0 = first)
 */
export function movePlayerInOrder(
  state: GameState,
  playerId: string,
  position: number
): boolean {
  const currentIdx = state.turnOrder.indexOf(playerId);
  if (currentIdx === -1) return false;

  // Remove from current position
  state.turnOrder.splice(currentIdx, 1);

  // Insert at new position (clamped to valid range)
  const insertIdx = Math.max(0, Math.min(position, state.turnOrder.length));
  state.turnOrder.splice(insertIdx, 0, playerId);

  return true;
}

/**
 * Remove a player from turn order (but not from game).
 * Useful for pass-based turn order mechanics.
 */
export function removeFromTurnOrder(state: GameState, playerId: string): boolean {
  const idx = state.turnOrder.indexOf(playerId);
  if (idx === -1) return false;

  state.turnOrder.splice(idx, 1);

  // If removed player was current, advance to next
  if (state.currentPlayer === playerId) {
    state.currentPlayer = state.turnOrder[idx % state.turnOrder.length] || null;
  }

  return true;
}

/**
 * Add a player back to turn order (at the end by default).
 */
export function addToTurnOrder(
  state: GameState,
  playerId: string,
  position?: number
): void {
  if (state.turnOrder.includes(playerId)) return;

  if (position !== undefined) {
    state.turnOrder.splice(position, 0, playerId);
  } else {
    state.turnOrder.push(playerId);
  }
}

/**
 * Apply dynamic turn order if any mechanic provides one.
 * Called at round start to allow mechanics to reorder players.
 */
export function applyDynamicTurnOrder(
  state: GameState,
  reason: 'round_start' | 'mid_round' | 'claim' | 'pass' = 'round_start'
): boolean {
  const result = mechanicRegistry.onDetermineTurnOrder(state, reason);

  if (result?.order) {
    setTurnOrder(state, result.order);
    return true;
  }

  return false;
}

/**
 * Sort turn order by a player property (e.g., score, resources).
 * @param property - Player state property to sort by
 * @param descending - If true, highest first (default: true)
 */
export function sortTurnOrderByProperty(
  state: GameState,
  property: string,
  descending: boolean = true
): void {
  const order = [...state.turnOrder].sort((a, b) => {
    const playerA = state.players[a];
    const playerB = state.players[b];

    // Type-safe property access for common player properties
    let valueA = 0;
    let valueB = 0;

    if (property === 'score') {
      valueA = playerA?.score ?? 0;
      valueB = playerB?.score ?? 0;
    } else if (property === 'actionPoints') {
      valueA = playerA?.actionPoints ?? 0;
      valueB = playerB?.actionPoints ?? 0;
    } else if (property === 'movementPoints') {
      valueA = playerA?.movementPoints ?? 0;
      valueB = playerB?.movementPoints ?? 0;
    } else if (property === 'tricksWon') {
      valueA = playerA?.tricksWon ?? 0;
      valueB = playerB?.tricksWon ?? 0;
    } else if (playerA?.resources && property.startsWith('resources.')) {
      const resourceName = property.substring(10);
      valueA = playerA.resources[resourceName] ?? 0;
      valueB = playerB?.resources?.[resourceName] ?? 0;
    }

    return descending ? valueB - valueA : valueA - valueB;
  });

  state.turnOrder = order;
}

/**
 * Create snake draft order (1,2,3,3,2,1,1,2,3...).
 * Returns turn order for a specified number of rounds.
 */
export function createSnakeDraftOrder(
  players: string[],
  rounds: number = 1
): string[] {
  const order: string[] = [];

  for (let round = 0; round < rounds; round++) {
    if (round % 2 === 0) {
      order.push(...players);
    } else {
      order.push(...[...players].reverse());
    }
  }

  return order;
}
