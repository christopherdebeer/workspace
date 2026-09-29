/**
 * Place Card Mechanic
 *
 * Allows placing cards with placeable flag onto board states (place_card)
 * and placing location cards onto a grid (place_location).
 * Used for traps, buffs, state-modifying effects, and tile-placement.
 *
 * Hooks used:
 * - preValidateAction: Validate place_card / place_location action requirements
 * - onExecuteAction: Handle place_card / place_location execution
 * - getAvailableActions: Expose place_card / place_location actions
 * - describeAction: Describe place_card / place_location actions
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
  ActionSchema,
  isMechanicEnabled
} from './types';
import { GameAction, PlaceCardAction, PlaceLocationAction, PlacedCard, Card } from '../types/game';
import { getBoardConfigFromConfig } from './core/board';

export const placeCardMechanic: MechanicHooks = {
  slug: 'place-card',
  name: 'Place Card',
  requires: ['cards'],

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type === 'place_card') {
      return {
        required: ['card', 'targetState'],
        fields: {
          card: { type: 'string' },
          targetState: { type: 'string' },
        },
      };
    }
    if (action.type === 'place_location') {
      return {
        required: ['card', 'adjacentTo'],
        fields: {
          card: { type: 'string' },
          adjacentTo: { type: 'string' },
        },
      };
    }
    return null;
  },

  initSharedState(_ctx: SharedStateInitContext): SharedStateInitResult | null {
    // Initialize placedCards array for tracking cards placed on board states
    // and placedLocations for grid-based location cards
    return { placedCards: [], placedLocations: [] };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // --- place_card validation ---
    if (action.type === 'place_card') {
      const placeAction = action as PlaceCardAction;
      const hand = ctx.player.hand || [];

      // Check if card exists in hand
      const card = hand.find(c => c.name === placeAction.card);
      if (!card) {
        // Let core validation handle missing card
        return null;
      }

      // Check if card is placeable
      if (!card.placeable) {
        return {
          valid: false,
          error: `Card "${placeAction.card}" cannot be placed on states. Only cards marked as placeable can be used with place_card action.`
        };
      }

      // Check if board config exists
      const boardConfig = getBoardConfigFromConfig(ctx.config);
      if (!boardConfig) {
        return {
          valid: false,
          error: 'place_card action requires a game with board states defined.'
        };
      }

      // Check if target state is valid
      const validStates = boardConfig.states || [];
      if (!validStates.includes(placeAction.targetState)) {
        return {
          valid: false,
          error: `Invalid target state "${placeAction.targetState}". Valid states: ${validStates.join(', ')}`
        };
      }

      return { valid: true };
    }

    // --- place_location validation ---
    if (action.type === 'place_location') {
      const placeAction = action as PlaceLocationAction;
      const hand = ctx.player.hand || [];

      // Check if card exists in hand
      const card = hand.find(c => c.name === placeAction.card);
      if (!card) {
        return null; // Let core validation handle missing card
      }

      // Check if card is a location type
      if (card.type !== 'location') {
        return {
          valid: false,
          error: `Card "${placeAction.card}" is not a location card.`
        };
      }

      // Check if grid config exists
      const gridConfig = ctx.config.engine_mechanics?.grid as
        { type?: string; starting_tile?: string; adjacency?: string } | undefined;
      if (!gridConfig) {
        return {
          valid: false,
          error: 'place_location action requires a game with grid configuration defined.'
        };
      }

      // Validate adjacentTo is a valid location
      const startingTile = gridConfig.starting_tile || 'origin';
      const placedLocations = (ctx.state.shared.placedLocations as string[]) || [];
      const validTargets = [startingTile, ...placedLocations];
      if (!validTargets.includes(placeAction.adjacentTo)) {
        return {
          valid: false,
          error: `Invalid adjacentTo "${placeAction.adjacentTo}". Must be adjacent to an existing location: ${validTargets.join(', ')}`
        };
      }

      return { valid: true };
    }

    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;
    const hand = player.hand || [];

    // --- place_card execution ---
    if (action.type === 'place_card') {
      const placeAction = action as PlaceCardAction;

      // Find and remove card from hand
      const cardIndex = hand.findIndex(c => c.name === placeAction.card);
      if (cardIndex === -1) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_card_failed',
          logData: { card: placeAction.card, error: 'Card not in hand' }
        };
      }

      const [card] = hand.splice(cardIndex, 1);

      // Verify card is placeable and has an effect
      if (!card.placeable || !card.effect) {
        // Put card back
        hand.push(card);
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_card_failed',
          logData: { card: placeAction.card, error: 'Card is not placeable' }
        };
      }

      // Create placed card entry
      const placedCard: PlacedCard = {
        cardName: card.name,
        placedBy: playerId,
        state: placeAction.targetState,
        effect: card.effect,
        targetMode: card.targetMode ?? 'opponents',
        triggersRemaining: card.effect.duration
      };

      // Add to placed cards list
      const placedCards = (state.shared.placedCards || []) as PlacedCard[];
      placedCards.push(placedCard);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            placedCards: placedCards
          }
        },
        advanceTurn: false, // Use maybeAdvanceTurn semantics (respects action points)
        checkWin: false,
        logMessage: 'card_placed',
        logData: {
          card: placedCard.cardName,
          targetState: placedCard.state,
          targetMode: placedCard.targetMode,
          effect: placedCard.effect
        }
      };
    }

    // --- place_location execution ---
    if (action.type === 'place_location') {
      const placeAction = action as PlaceLocationAction;

      // Find card in hand
      const cardIndex = hand.findIndex(c => c.name === placeAction.card);
      if (cardIndex === -1) {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_location_failed',
          logData: { card: placeAction.card, error: 'Card not in hand' }
        };
      }

      const card = hand[cardIndex];

      // Verify card is a location type
      if (card.type !== 'location') {
        return {
          handled: true,
          stateChanges: {},
          advanceTurn: false,
          checkWin: false,
          logMessage: 'place_location_failed',
          logData: { card: placeAction.card, error: 'Card is not a location card' }
        };
      }

      // Remove card from hand
      hand.splice(cardIndex, 1);

      // Add to placed locations
      const placedLocations = (state.shared.placedLocations as string[]) || [];
      placedLocations.push(placeAction.card);

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            placedLocations: placedLocations
          }
        },
        advanceTurn: false, // Use maybeAdvanceTurn semantics (respects action points)
        checkWin: false,
        logMessage: 'location_placed',
        logData: {
          card: placeAction.card,
          adjacentTo: placeAction.adjacentTo
        }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const hand = ctx.player.hand || [];
    const actions: AvailableAction[] = [];

    // === PLACE_CARD actions (for placeable cards on board games) ===
    const boardConfigForActions = getBoardConfigFromConfig(ctx.config);
    if (boardConfigForActions) {
      const boardStates = boardConfigForActions.states || [];
      if (boardStates.length > 0) {
        const placeableCards = hand.filter((c: Card) => c.placeable);

        for (const card of placeableCards) {
          for (const targetState of boardStates) {
            actions.push({
              action: {
                type: 'place_card',
                card: card.name,
                targetState
              } as GameAction,
              priority: 35,
              category: 'placement'
            });
          }
        }
      }
    }

    // === PLACE_LOCATION actions (for location cards on grid games) ===
    const gridConfig = ctx.config.engine_mechanics?.grid as
      { type?: string; starting_tile?: string; adjacency?: string } | undefined;
    if (gridConfig) {
      const locationCards = hand.filter((c: Card) => c.type === 'location');
      if (locationCards.length > 0) {
        const startingTile = gridConfig.starting_tile || 'origin';
        const placedLocations = (ctx.state.shared.placedLocations as string[]) || [];
        const validAdjacentTargets = [startingTile, ...placedLocations];

        for (const card of locationCards) {
          for (const adjacentTo of validAdjacentTargets) {
            actions.push({
              action: {
                type: 'place_location',
                card: card.name,
                adjacentTo
              } as GameAction,
              priority: 35,
              category: 'placement'
            });
          }
        }
      }
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'place_card') {
      const placeAction = action as PlaceCardAction;
      return {
        type: 'place_card',
        label: 'Place Card',
        description: `Place a card with an effect onto a board state. The effect will trigger when players move to that state.${placeAction.card ? ` Card: ${placeAction.card}` : ''}${placeAction.targetState ? ` Target: ${placeAction.targetState}` : ''}`,
        examples: ['place_card card:"Trap" targetState:"Forest"', 'place_card card:"Blessing" targetState:"Castle"']
      };
    }

    if (action.type === 'place_location') {
      const placeAction = action as PlaceLocationAction;
      return {
        type: 'place_location',
        label: 'Place Location',
        description: `Place a location card on the grid adjacent to an existing location.${placeAction.card ? ` Card: ${placeAction.card}` : ''}${placeAction.adjacentTo ? ` Adjacent to: ${placeAction.adjacentTo}` : ''}`,
        examples: ['place_location card:"Forest Clearing" adjacentTo:"origin"', 'place_location card:"Mountain Pass" adjacentTo:"Forest Clearing"']
      };
    }

    return null;
  }
};
