/**
 * Trick-Taking Mechanic
 *
 * Classic card game mechanic where players play cards in sequence,
 * following suit when possible, with highest card winning the trick.
 *
 * Flow:
 * 1. Lead player plays any card (sets the lead suit)
 * 2. Other players must follow suit if possible
 * 3. Highest card of lead suit (or trump) wins
 * 4. Winner collects trick and leads next
 *
 * Hooks used:
 * - initSharedState: Initialize trick tracking state (currentTrick, leadSuit, trickLeader)
 * - preValidateAction: Validate play_card follows trick rules
 * - onExecuteAction: Handle card play and trick resolution
 * - onTurnEnd: Check if trick is complete
 * - getAvailableActions: Expose valid cards to play
 * - describeAction: Describe trick-taking rules
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult
} from './types';
import { GameAction, Card, PlayCardAction } from '../types/game';
import { removeFromHandByName, getHand } from './core/hand';
import { mechanicRegistry, applyStateChanges } from './registry';

interface TrickTakingConfig {
  /** Trump suit (optional - if not set, no trump) */
  trump_suit?: string;
  /** Whether trump can be led when player has other suits */
  can_lead_trump?: boolean;
  /** Suit hierarchy for comparing cards (first is highest) */
  suit_order?: string[];
  /** Value hierarchy for comparing cards (first is highest) */
  value_order?: string[];
  /** Points per trick won (default 1) */
  points_per_trick?: number;
  /** Specific card values (e.g., { "Ace": 14, "King": 13 }) */
  card_values?: Record<string, number>;
}

interface TrickCard {
  playerId: string;
  card: Card;
}

function getCardSuit(card: Card): string {
  return card.suit || card.type || 'unknown';
}

function getCardValue(card: Card, config: TrickTakingConfig): number {
  // Check explicit card values first
  if (config.card_values && card.name in config.card_values) {
    return config.card_values[card.name];
  }
  if (config.card_values && card.value !== undefined && String(card.value) in config.card_values) {
    return config.card_values[String(card.value)];
  }

  // Use value_order if defined
  if (config.value_order && card.value !== undefined) {
    const idx = config.value_order.indexOf(String(card.value));
    if (idx !== -1) {
      return config.value_order.length - idx; // Higher index = lower value
    }
  }

  // Fall back to numeric value
  if (typeof card.value === 'number') {
    return card.value;
  }

  return 0;
}

function canFollowSuit(hand: Card[], leadSuit: string): boolean {
  return hand.some(c => getCardSuit(c) === leadSuit);
}

function getPlayableCards(hand: Card[], leadSuit: string | null, config: TrickTakingConfig): Card[] {
  // If leading, can play any card (unless trump restrictions)
  if (!leadSuit) {
    if (config.can_lead_trump === false && config.trump_suit) {
      const nonTrump = hand.filter(c => getCardSuit(c) !== config.trump_suit);
      return nonTrump.length > 0 ? nonTrump : hand; // Must play trump if only trump
    }
    return hand;
  }

  // Must follow suit if possible
  const suitCards = hand.filter(c => getCardSuit(c) === leadSuit);
  if (suitCards.length > 0) {
    return suitCards;
  }

  // Can't follow suit - can play any card
  return hand;
}

function determineTrickWinner(trick: TrickCard[], leadSuit: string, config: TrickTakingConfig): TrickCard {
  let winner = trick[0];
  let winnerValue = getCardValue(winner.card, config);
  let winnerIsTrump = config.trump_suit && getCardSuit(winner.card) === config.trump_suit;

  for (let i = 1; i < trick.length; i++) {
    const current = trick[i];
    const currentSuit = getCardSuit(current.card);
    const currentValue = getCardValue(current.card, config);
    const currentIsTrump = config.trump_suit && currentSuit === config.trump_suit;

    // Trump beats non-trump
    if (currentIsTrump && !winnerIsTrump) {
      winner = current;
      winnerValue = currentValue;
      winnerIsTrump = true;
      continue;
    }

    // Non-trump doesn't beat trump
    if (!currentIsTrump && winnerIsTrump) {
      continue;
    }

    // Both trump or both non-trump
    if (currentIsTrump && winnerIsTrump) {
      // Higher trump wins
      if (currentValue > winnerValue) {
        winner = current;
        winnerValue = currentValue;
      }
    } else {
      // Must be lead suit to win
      if (currentSuit === leadSuit && currentValue > winnerValue) {
        winner = current;
        winnerValue = currentValue;
      }
    }
  }

  return winner;
}

export const trickTakingMechanic: MechanicHooks = {
  slug: 'trick-taking',
  name: 'Trick-Taking',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Classic trick-taking card game mechanic',
    properties: {
      trump_suit: {
        type: 'string',
        description: 'Trump suit that beats other suits (optional)'
      },
      can_lead_trump: {
        type: 'boolean',
        description: 'Whether trump can be led when player has other suits',
        default: true
      },
      suit_order: {
        type: 'array',
        description: 'Suit hierarchy for tiebreaks (first is highest)'
      },
      value_order: {
        type: 'array',
        description: 'Value hierarchy (first is highest, e.g., ["A", "K", "Q", "J", "10"...])'
      },
      points_per_trick: {
        type: 'number',
        description: 'Points awarded per trick won',
        default: 1
      },
      card_values: {
        type: 'object',
        description: 'Explicit card values (e.g., { "Ace": 14, "King": 13 })'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const trickConfig = ctx.config.engine_mechanics?.trick_taking as TrickTakingConfig | undefined;
    if (!trickConfig) return null;

    return {
      currentTrick: [],
      trickLeader: null,
      leadSuit: null,
      lastTrickWinner: null,
      lastTrick: null,
      tricksPlayed: 0
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'play_card') return null;

    const trickConfig = ctx.config.engine_mechanics?.trick_taking as TrickTakingConfig | undefined;
    if (!trickConfig) return null; // Let other mechanics handle play_card

    const playAction = action as PlayCardAction;
    const hand = getHand(ctx.state, ctx.playerId);
    const currentTrick = (ctx.state.shared.currentTrick || []) as TrickCard[];

    // Find the card in hand
    const cardToPlay = hand.find(c => c.name === playAction.card);
    if (!cardToPlay) {
      return { valid: false, error: `Card "${playAction.card}" not in your hand.` };
    }

    // Get lead suit if trick has started
    const leadSuit = currentTrick.length > 0 ? getCardSuit(currentTrick[0].card) : null;

    // Check if this card is playable
    const playableCards = getPlayableCards(hand, leadSuit, trickConfig);
    if (!playableCards.find(c => c.name === playAction.card)) {
      const leadSuitName = leadSuit || 'any';
      return {
        valid: false,
        error: `Must follow suit (${leadSuitName}). Playable cards: ${playableCards.map(c => c.name).join(', ')}`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;

    if (action.type !== 'play_card') return null;

    const trickConfig = ctx.config.engine_mechanics?.trick_taking as TrickTakingConfig | undefined;
    if (!trickConfig) return null;

    const playAction = action as PlayCardAction;
    const hand = getHand(state, playerId);
    const cardIndex = hand.findIndex(c => c.name === playAction.card);

    if (cardIndex === -1) {
      return {
        handled: true,
        stateChanges: {},
        advanceTurn: false,
        checkWin: false,
        logMessage: 'play_card_failed',
        logData: { card: playAction.card, error: 'Card not in hand' }
      };
    }

    // Remove card from hand
    const playedCard = removeFromHandByName(state, playerId, playAction.card);
    if (!playedCard) {
      return {
        handled: true,
        stateChanges: {},
        advanceTurn: false,
        checkWin: false,
        logMessage: 'play_card_failed',
        logData: { card: playAction.card, error: 'Failed to remove from hand' }
      };
    }

    // Fire cards-defined onCardPlayed hook (trick-taking bypasses playCard(),
    // so we fire manually with target: 'trick')
    const cardPlayedChanges = mechanicRegistry.fire('cards', 'onCardPlayed', state, playerId, {
      card: playedCard, target: 'trick', playContext: {}
    });
    if (cardPlayedChanges) applyStateChanges(state, cardPlayedChanges);

    // Add to current trick
    const currentTrick = [...((state.shared.currentTrick || []) as TrickCard[])];
    currentTrick.push({ playerId, card: playedCard });

    const stateChanges: StateChanges = {
      sharedStateChanges: {
        currentTrick
      }
    };

    // Check if trick is complete (all players have played)
    const numPlayers = state.turnOrder.length;
    if (currentTrick.length >= numPlayers) {
      // Resolve trick
      const leadSuit = getCardSuit(currentTrick[0].card);
      const winner = determineTrickWinner(currentTrick, leadSuit, trickConfig);
      const pointsPerTrick = trickConfig.points_per_trick ?? 1;

      // Update winner's score and tricks won
      const winnerPlayer = state.players[winner.playerId];
      const newScore = (winnerPlayer.score || 0) + pointsPerTrick;
      const tricksWon = ((winnerPlayer.tricksWon as number) || 0) + 1;

      stateChanges.playerStateChanges = {
        [winner.playerId]: {
          score: newScore,
          tricksWon
        }
      };

      // Clear trick and set winner as next lead
      stateChanges.sharedStateChanges = {
        currentTrick: [],
        trickLeader: winner.playerId,
        lastTrickWinner: winner.playerId,
        lastTrick: currentTrick
      };

      return {
        handled: true,
        stateChanges,
        advanceTurn: true,
        checkWin: true,
        logMessage: 'trick_won',
        logData: {
          winner: winner.playerId,
          winningCard: winner.card.name,
          trick: currentTrick.map(t => ({ player: t.playerId, card: t.card.name })),
          points: pointsPerTrick
        }
      };
    }

    // Trick continues
    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: false,
      logMessage: 'card_played_to_trick',
      logData: {
        player: playerId,
        card: playedCard.name,
        suit: getCardSuit(playedCard),
        trickPosition: currentTrick.length,
        leadSuit: currentTrick.length === 1 ? getCardSuit(playedCard) : getCardSuit(currentTrick[0].card)
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const trickConfig = ctx.config.engine_mechanics?.trick_taking as TrickTakingConfig | undefined;
    if (!trickConfig) return [];

    const hand = getHand(ctx.state, ctx.playerId);
    if (hand.length === 0) return [];

    const currentTrick = (ctx.state.shared.currentTrick || []) as TrickCard[];
    const leadSuit = currentTrick.length > 0 ? getCardSuit(currentTrick[0].card) : null;

    // Get playable cards based on follow suit rules
    const playableCards = getPlayableCards(hand, leadSuit, trickConfig);

    return playableCards.map(card => ({
      action: {
        type: 'play_card',
        card: card.name
      } as GameAction,
      priority: 60,
      category: 'trick-taking'
    }));
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'play_card') return null;

    // Only describe if this looks like a trick-taking context
    return {
      type: 'play_card',
      label: 'Play Card to Trick',
      description: 'Play a card to the current trick. Must follow the lead suit if possible.',
      examples: ['play_card card:"Ace of Spades"']
    };
  }
};
