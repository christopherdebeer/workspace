/**
 * Set Collection Mechanic
 *
 * Collect matching sets of cards for points/effects.
 *
 * Hooks used:
 * - preValidateAction: Validate collect_set action
 * - onExecuteAction: Handle set collection execution
 * - getAvailableActions: Expose collect_set action
 * - describeAction: Describe collect_set action
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  PlayerInitContext,
  PlayerInitResult,
  ActionSchema,
  isMechanicEnabled
} from './types';
import { GameAction, Card, SetDefinition, CollectSetAction, PlayerState } from '../types/game';
import { removeCardsFromHand } from './core/hand';
import { addToDiscard } from './core/card-piles';

interface SetCollectionConfig {
  sets: SetDefinition[];
  points_per_set?: number;
}

/**
 * Validate that cards form a valid set matching the definition
 */
function validateSet(cards: Card[], setDef: SetDefinition): boolean {
  if (cards.length !== setDef.size) return false;

  // Get the field value from a card using dot notation (e.g., "effect.color")
  const getFieldValue = (card: Card, field: string): unknown => {
    const parts = field.split('.');
    let value: unknown = card;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return value;
  };

  const values = cards.map(c => getFieldValue(c, setDef.match_field));

  // All values must be the same for a matching set
  const firstValue = values[0];
  const allMatch = values.every(v => v === firstValue);

  // If unique is required, all cards must be different
  if (setDef.unique) {
    const cardNames = cards.map(c => c.name);
    const uniqueNames = new Set(cardNames);
    if (uniqueNames.size !== cards.length) return false;
  }

  return allMatch;
}

export const setCollectionMechanic: MechanicHooks = {
  slug: 'set-collection',
  name: 'Set Collection',
  requires: ['cards'],

  configSchema: {
    type: 'object',
    description: 'Collect matching sets of cards for points/effects',
    properties: {
      sets: {
        type: 'array',
        description: 'Set definitions with size, match_field, and point values',
        required: true
      },
      points_per_set: {
        type: 'number',
        description: 'Default points awarded per completed set'
      }
    },
    required: ['sets']
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type !== 'collect_set') return null;
    return {
      required: ['cards', 'setType'],
      fields: {
        cards: { type: 'array' },
        setType: { type: 'string' },
      },
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    if (!isMechanicEnabled(ctx.config, 'set-collection')) return null;
    return { collectedSets: [] };
  },

  getPlayerView(ctx: HookContext): Record<string, unknown> | null {
    if (!isMechanicEnabled(ctx.config, 'set-collection')) return null;
    const collectedSets = ctx.player.collectedSets || [];
    if (collectedSets.length === 0) return null;
    return { collectedSets };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'collect_set') return null;

    const setConfig = ctx.config.engine_mechanics?.set_collection as SetCollectionConfig | undefined;
    if (!setConfig) {
      return { valid: false, error: 'Set collection is not enabled for this game.' };
    }

    const collectAction = action as CollectSetAction;
    const setDef = setConfig.sets.find(s => s.name === collectAction.setType);

    if (!setDef) {
      return {
        valid: false,
        error: `Unknown set type "${collectAction.setType}". Available: ${setConfig.sets.map(s => s.name).join(', ')}`
      };
    }

    // Verify player has all the cards
    const playerHand = ctx.player.hand ?? [];
    for (const cardName of collectAction.cards) {
      if (!playerHand.find(c => c.name === cardName)) {
        return { valid: false, error: `Card "${cardName}" not in your hand.` };
      }
    }

    // Verify set size matches
    if (collectAction.cards.length !== setDef.size) {
      return {
        valid: false,
        error: `Set "${collectAction.setType}" requires exactly ${setDef.size} cards, you provided ${collectAction.cards.length}.`
      };
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, player, playerId, state } = ctx;

    if (action.type !== 'collect_set') return null;

    const setConfig = ctx.config.engine_mechanics?.set_collection as SetCollectionConfig | undefined;
    if (!setConfig) return null;

    const collectAction = action as CollectSetAction;
    const setDef = setConfig.sets.find(s => s.name === collectAction.setType);
    if (!setDef) return null;

    // Remove cards from hand using core service
    const collectedCards = removeCardsFromHand(state, playerId, collectAction.cards);

    // Validate the set matches the definition
    if (!validateSet(collectedCards, setDef)) {
      // Put cards back (this shouldn't happen if preValidateAction worked correctly)
      (player.hand ?? []).push(...collectedCards);
      return {
        handled: true,
        stateChanges: {},
        advanceTurn: false,
        checkWin: false,
        logMessage: 'set_collection_invalid',
        logData: { setType: collectAction.setType, error: 'Cards do not form a valid set' }
      };
    }

    // Track collected sets
    const collectedSets = [...(player.collectedSets || []), collectAction.setType];

    // Award points if configured (match game.ts conditional behavior)
    const playerChanges: Partial<PlayerState> = { collectedSets };
    if (setConfig.points_per_set) {
      playerChanges.score = (player.score ?? 0) + setConfig.points_per_set;
    }

    // Add cards to discard using core service
    addToDiscard(state, collectedCards, playerId);

    return {
      handled: true,
      stateChanges: {
        playerStateChanges: {
          [playerId]: playerChanges
        }
      },
      advanceTurn: false,
      checkWin: true,
      logMessage: 'set_collected',
      logData: {
        setType: collectAction.setType,
        cards: collectAction.cards,
        points: setConfig.points_per_set,
        totalSets: collectedSets.length
      }
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const setConfig = ctx.config.engine_mechanics?.set_collection as SetCollectionConfig | undefined;
    if (!setConfig?.sets?.length) return [];

    const hand = ctx.player.hand || [];
    const handCards = hand.map(c => c.name);
    const minSetSize = Math.min(...setConfig.sets.map(s => s.size));

    // Only show action if player has enough cards for smallest set
    if (handCards.length < minSetSize) return [];

    // Generate example actions for each set type
    const actions: AvailableAction[] = [];

    for (const setDef of setConfig.sets) {
      if (handCards.length >= setDef.size) {
        actions.push({
          action: {
            type: 'collect_set',
            cards: handCards.slice(0, setDef.size),
            setType: setDef.name
          } as GameAction,
          priority: 40,
          category: 'set-collection'
        });
      }
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type !== 'collect_set') return null;

    return {
      type: 'collect_set',
      label: 'Collect Set',
      description: 'Claim a matching set of cards to earn points.',
      examples: ['collect_set cards:["Red 1","Red 2","Red 3"] setType:"Color Set"']
    };
  }
};
