/**
 * Place Location Mechanic
 *
 * Allows placing location cards onto the grid adjacent to existing locations.
 * Extends the playable grid dynamically.
 *
 * Hooks used:
 * - preValidateAction: Validate place_location action requirements
 * - onExecuteAction: Handle place_location execution
 * - getAvailableActions: Expose place_location actions
 * - describeAction: Describe place_location action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription
} from './types';
import { GameAction, PlaceLocationAction, Card } from '../types/game';

interface GridConfig {
  starting_tile?: string;
}

export const placeLocationMechanic: MechanicHooks = {
  slug: 'place-location',
  name: 'Place Location',

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    // Only validate place_location actions
    if (action.type !== 'place_location') return null;

    const placeAction = action as PlaceLocationAction;

    // Check if card exists in hand
    const card = (ctx.player.hand ?? []).find(c => c.name === placeAction.card);
    if (!card) {
      // Let core validation handle missing card
      return null;
    }

    // Check if card is a location type
    if (card.type !== 'location') {
      return {
        valid: false,
        error: `Card "${placeAction.card}" is not a location card. Only location cards can be placed on the grid.`
      };
    }

    // Check if grid config exists
    const gridConfig = ctx.config.engine_mechanics?.grid as GridConfig | undefined;
    if (!gridConfig) {
      return {
        valid: false,
        error: 'place_location action requires a game with grid mechanics defined.'
      };
    }

    // Check if adjacentTo is a valid existing location
    const placedLocations = (ctx.state.shared.placedLocations as string[]) || [];
    const startingTile = gridConfig.starting_tile || 'origin';
    const validLocations = [startingTile, ...placedLocations];

    if (!validLocations.includes(placeAction.adjacentTo)) {
      return {
        valid: false,
        error: `Invalid adjacentTo target "${placeAction.adjacentTo}". Must be an existing location: ${validLocations.join(', ')}`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'place_location') return null;

    const placeAction = action as PlaceLocationAction;

    // Find and remove card from hand
    const playerHand = player.hand ?? [];
    const cardIndex = playerHand.findIndex(c => c.name === placeAction.card);
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

    const card = playerHand[cardIndex];

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
    playerHand.splice(cardIndex, 1);

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
      advanceTurn: true,
      checkWin: false,
      logMessage: 'location_placed',
      logData: {
        card: placeAction.card,
        adjacentTo: placeAction.adjacentTo,
        totalLocations: placedLocations.length
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    // Check if grid config exists
    const gridConfig = ctx.config.engine_mechanics?.grid as GridConfig | undefined;
    if (!gridConfig) return [];

    // Get location cards from hand
    const locationCards = (ctx.player.hand ?? []).filter((c: Card) => c.type === 'location');
    if (locationCards.length === 0) return [];

    // Get valid adjacent targets
    const placedLocations = (ctx.state.shared.placedLocations as string[]) || [];
    const startingTile = gridConfig.starting_tile || 'origin';
    const validTargets = [startingTile, ...placedLocations];

    if (validTargets.length === 0) return [];

    // Generate one action per location card per valid target
    const actions: AvailableAction[] = [];

    for (const card of locationCards) {
      for (const adjacentTo of validTargets) {
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

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'place_location') return null;

    const placeAction = action as PlaceLocationAction;
    return {
      type: 'place_location',
      label: 'Place Location',
      description: `Place a location card onto the grid adjacent to an existing location. This extends the playable area.${placeAction.card ? ` Card: ${placeAction.card}` : ''}${placeAction.adjacentTo ? ` Adjacent to: ${placeAction.adjacentTo}` : ''}`,
      examples: ['place_location card:"Forest Clearing" adjacentTo:"origin"', 'place_location card:"Mountain Peak" adjacentTo:"Forest Clearing"']
    };
  }
};
