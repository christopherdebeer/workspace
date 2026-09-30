/**
 * Place Location Mechanic
 *
 * Allows placing location cards onto the grid adjacent to existing locations.
 * Extends the playable grid dynamically. Each placed card becomes a tile on the tile map
 * (core/tile-map.ts) linked to the tile it was placed next to (at most four links a tile).
 * Placing does not end the turn — action points do — and each player's placements are
 * counted (player.placedLocations) for goals like "Place 5 location cards".
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
import { tilesOf, placeTile, positionOf, within, originId, openSlots } from './core/tile-map';

interface GridConfig {
  starting_tile?: string;
}

export const placeLocationMechanic: MechanicHooks = {
  slug: 'place-location',
  name: 'Place Location',

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'place_location') return null;
    const placeAction = action as PlaceLocationAction;
    const card = (ctx.player.hand ?? []).find((c) => c.name === placeAction.card);
    if (!card) return null; // core validation reports the missing card
    if (card.type !== 'location') {
      return { valid: false, error: `Card "${placeAction.card}" is not a location card. Only location cards can be placed on the grid.` };
    }
    if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) {
      return { valid: false, error: 'place_location action requires a game with grid mechanics defined.' };
    }
    const tiles = tilesOf(ctx.state, ctx.config);
    const target = tiles[placeAction.adjacentTo];
    if (!target) {
      return { valid: false, error: `Invalid adjacentTo target "${placeAction.adjacentTo}". Must be an existing location: ${Object.keys(tiles).join(', ')}` };
    }
    if (openSlots(target) <= 0) {
      return { valid: false, error: `${target.id} has no open side left (N/S/E/W all taken)` };
    }
    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state, config } = ctx;
    if (action.type !== 'place_location') return null;
    const placeAction = action as PlaceLocationAction;
    const playerHand = player.hand ?? [];
    const cardIndex = playerHand.findIndex((c) => c.name === placeAction.card);
    if (cardIndex === -1 || playerHand[cardIndex].type !== 'location') {
      return { handled: true, stateChanges: {}, advanceTurn: false, checkWin: false, logMessage: 'place_location_failed', logData: { card: placeAction.card, error: 'Card not in hand or not a location' } };
    }
    const [card] = playerHand.splice(cardIndex, 1);
    const tile = placeTile(state, config, card as Card, placeAction.adjacentTo, playerId);
    const placed = Number((player as unknown as { placedLocations?: number }).placedLocations ?? 0) + 1;
    (player as unknown as { placedLocations?: number }).placedLocations = placed;
    return {
      handled: true,
      stateChanges: { playerStateChanges: { [playerId]: { placedLocations: placed } as never } },
      advanceTurn: false, // action points end the turn ("place, then move to it" is 2 AP)
      checkWin: true,
      logMessage: 'location_placed',
      logData: { card: placeAction.card, tile: tile.id, adjacentTo: placeAction.adjacentTo, placedByYou: placed, totalLocations: Object.keys(tilesOf(state, config)).length - 1 }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    if (!(ctx.config.engine_mechanics?.grid as GridConfig | undefined)) return [];
    const locationNames = [...new Set((ctx.player.hand ?? []).filter((c: Card) => c.type === 'location').map((c) => c.name))];
    if (!locationNames.length) return [];
    // Any tile with an open side is legal; offer the ones near you (and the origin) so the
    // choice stays readable — the validator accepts any.
    const tiles = tilesOf(ctx.state, ctx.config);
    const here = positionOf(ctx.state, ctx.config, ctx.playerId);
    const near = [...new Set([here, ...within(ctx.state, ctx.config, here, 2), originId(ctx.config)])].filter((t) => tiles[t] && openSlots(tiles[t]) > 0);
    const examples: GameAction[] = [];
    for (const card of locationNames) for (const adjacentTo of near) examples.push({ type: 'place_location', card, adjacentTo } as GameAction);
    if (!examples.length) return [];
    return [{
      action: examples[0],
      priority: 35,
      category: 'placement',
      description: 'Place a location card next to a tile with an open side (then you can move onto it)',
      required: { card: 'Location card from your hand', adjacentTo: 'An existing tile with an open side' },
      examples,
    }];
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'place_location') return null;
    const placeAction = action as PlaceLocationAction;
    return {
      type: 'place_location',
      label: 'Place Location',
      description: `Place a location card onto the grid next to an existing tile with an open side.${placeAction.card ? ` Card: ${placeAction.card}` : ''}${placeAction.adjacentTo ? ` Adjacent to: ${placeAction.adjacentTo}` : ''}`,
      examples: ['place_location card:"Forest Clearing" adjacentTo:"origin"']
    };
  }
};
