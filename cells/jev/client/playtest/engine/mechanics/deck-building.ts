/**
 * Deck/Bag/Pool Building Mechanic
 *
 * Players acquire cards/tokens during the game that get added to their
 * personal deck, bag, or pool. These cards are then drawn/used in future turns.
 *
 * Common in: Dominion, Star Realms, Clank!, Orléans (bag)
 *
 * Features:
 * - Personal deck separate from hand
 * - Acquire cards from supply
 * - Trash/remove cards from deck
 * - Track deck composition
 * - Shuffle discard into deck when empty
 *
 * Hooks used:
 * - initPlayerState: Set up personal deck
 * - onExecuteAction: Handle acquire/trash actions
 * - getAvailableActions: Expose acquirable cards
 * - postExecuteAction: Track deck changes
 * - onAfterDraw: Handle drawing from personal deck
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  PlayerInitContext,
  PlayerInitResult,
  ActionDescription,
  StateChanges,
  SharedStateInitContext,
  SharedStateInitResult,
  TurnStartContext,
  isMechanicEnabled
} from './types';
import { GameAction, Card } from '../types/game';

interface SupplyPile {
  /** Card template */
  card: Card;
  /** Number available in supply */
  count: number;
  /** Cost to acquire (in currency or resources) */
  cost?: number | Record<string, number>;
  /** Pile type (kingdom, basic, etc.) */
  type?: string;
}

interface DeckBuildingConfig {
  /** Starting deck cards (template names or card objects) */
  starting_deck?: (string | Card)[];
  /** Supply piles available for acquisition */
  supply?: SupplyPile[];
  /** Currency/resource used for buying */
  currency?: string;
  /** Whether to use separate discard pile */
  use_discard?: boolean;
  /** Cards drawn per turn */
  draw_count?: number;
  /** Whether acquired cards go to hand or discard */
  acquire_to?: 'hand' | 'discard' | 'deck_top';
  /** Enable trashing cards */
  allow_trash?: boolean;
  /** Trash pile name */
  trash_pile?: string;
}

function isDeckBuildingConfig(config: unknown): config is DeckBuildingConfig {
  return (
    typeof config === 'object' &&
    config !== null
  );
}

function getCardCost(pile: SupplyPile, currency: string = 'coins'): Record<string, number> {
  if (typeof pile.cost === 'number') {
    return { [currency]: pile.cost };
  }
  return pile.cost || { [currency]: 0 };
}

function canAfford(
  ctx: HookContext,
  cost: Record<string, number>,
  config: DeckBuildingConfig
): { affordable: boolean; reason?: string } {
  const resources = ctx.player.resources || {};
  const currency = config.currency || 'coins';

  for (const [resource, amount] of Object.entries(cost)) {
    const available = resources[resource] ?? (resource === currency ? ctx.player.coins ?? 0 : 0);
    if (available < amount) {
      return {
        affordable: false,
        reason: `Not enough ${resource}. Need ${amount}, have ${available}`
      };
    }
  }

  return { affordable: true };
}

function createCardFromTemplate(template: string | Card, uniqueId: string): Card {
  if (typeof template === 'string') {
    return {
      id: uniqueId,
      name: template,
      type: 'deck-card'
    };
  }
  return {
    ...template,
    id: uniqueId
  };
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export const deckBuildingMechanic: MechanicHooks = {
  slug: 'deck-building',
  name: 'Deck/Bag/Pool Building',
  requires: ['cards', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Acquire cards into personal deck (Dominion, Star Realms)',
    properties: {
      starting_deck: {
        type: 'array',
        description: 'Cards in starting deck'
      },
      supply: {
        type: 'array',
        description: 'Supply piles available for acquisition'
      },
      currency: {
        type: 'string',
        description: 'Resource used for buying',
        default: 'coins'
      },
      use_discard: {
        type: 'boolean',
        description: 'Use separate discard pile',
        default: true
      },
      draw_count: {
        type: 'number',
        description: 'Cards drawn per turn',
        default: 5
      },
      acquire_to: {
        type: 'string',
        description: 'Where acquired cards go',
        enum: ['hand', 'discard', 'deck_top'],
        default: 'discard'
      },
      allow_trash: {
        type: 'boolean',
        description: 'Enable trashing cards',
        default: true
      },
      trash_pile: {
        type: 'string',
        description: 'Trash pile name',
        default: 'trash'
      }
    }
  },

  /**
   * Initialize shared state with supply piles from config
   */
  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    if (!isMechanicEnabled(ctx.config, 'deck-building')) return null;

    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig)) return null;

    // Initialize supply from config
    const supply = dbConfig.supply ? [...dbConfig.supply] : [];

    // Initialize trash pile
    const trashPileName = dbConfig.trash_pile || 'trash';

    return {
      supply,
      [trashPileName]: []
    };
  },

  initPlayerState(ctx: PlayerInitContext): PlayerInitResult | null {
    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig)) return null;

    // Create starting deck
    const personalDeck: Card[] = [];
    const startingDeck = dbConfig.starting_deck || [];

    for (let i = 0; i < startingDeck.length; i++) {
      const template = startingDeck[i];
      const card = createCardFromTemplate(
        template,
        `${ctx.playerId}-deck-${i}-${Date.now()}`
      );
      personalDeck.push(card);
    }

    // Shuffle the starting deck
    const shuffledDeck = shuffleArray(personalDeck);

    return {
      personalDeck: shuffledDeck,
      personalDiscard: [],
      deckCardsAcquired: 0
    };
  },

  onTurnStart(ctx: TurnStartContext): StateChanges | null {
    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig) || !dbConfig.draw_count) return null;

    let personalDeck = [...((ctx.player.personalDeck as Card[]) || [])];
    let personalDiscard = [...((ctx.player.personalDiscard as Card[]) || [])];

    // Discard remaining hand cards to personal discard pile before drawing
    const currentHand = (ctx.player.hand || []) as Card[];
    if (currentHand.length > 0) {
      personalDiscard = [...personalDiscard, ...currentHand];
    }

    // If no cards in deck or discard, nothing to do
    if (personalDeck.length === 0 && personalDiscard.length === 0) return null;

    // Draw from personal deck
    const drawCount = dbConfig.draw_count;
    const hand: Card[] = [];

    for (let i = 0; i < drawCount; i++) {
      if (personalDeck.length === 0 && personalDiscard.length > 0) {
        personalDeck = shuffleArray(personalDiscard);
        personalDiscard = [];
      }
      if (personalDeck.length === 0) break;
      hand.push(personalDeck.shift()!);
    }

    return {
      playerStateChanges: {
        [ctx.playerId]: {
          hand,
          personalDeck,
          personalDiscard
        }
      }
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig)) return null;

    if (action.type === 'acquire' || action.type === 'buy') {
      const acquireAction = action as { card: string; pile?: string };

      // Find the supply pile
      const supply = (ctx.state.shared.supply as SupplyPile[] | undefined) || dbConfig.supply || [];
      const pile = supply.find(p =>
        p.card.name === acquireAction.card ||
        p.card.id === acquireAction.card
      );

      if (!pile) {
        return {
          valid: false,
          error: `Card "${acquireAction.card}" not found in supply`
        };
      }

      if (pile.count <= 0) {
        return {
          valid: false,
          error: `No more "${acquireAction.card}" cards in supply`
        };
      }

      // Check cost
      const cost = getCardCost(pile, dbConfig.currency);
      const affordCheck = canAfford(ctx, cost, dbConfig);
      if (!affordCheck.affordable) {
        return { valid: false, error: affordCheck.reason };
      }

      return { valid: true };
    }

    if (action.type === 'trash') {
      if (!dbConfig.allow_trash) {
        return { valid: false, error: 'Trashing is not enabled' };
      }

      const trashAction = action as { card: string };
      const hand = ctx.player.hand || [];
      const cardInHand = hand.find(c => c.name === trashAction.card || c.id === trashAction.card);

      if (!cardInHand) {
        return {
          valid: false,
          error: `Card "${trashAction.card}" not in hand`
        };
      }

      return { valid: true };
    }

    if (action.type === 'draw_deck') {
      const personalDeck = (ctx.player.personalDeck as Card[]) || [];
      const personalDiscard = (ctx.player.personalDiscard as Card[]) || [];

      if (personalDeck.length === 0 && personalDiscard.length === 0) {
        return {
          valid: false,
          error: 'No cards in personal deck or discard'
        };
      }

      return { valid: true };
    }

    return null;
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, player, state } = ctx;

    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig)) return null;

    if (action.type === 'acquire' || action.type === 'buy') {
      const acquireAction = action as { card: string };

      // Find and update supply
      const supply = [...((state.shared.supply as SupplyPile[]) || dbConfig.supply || [])];
      const pileIndex = supply.findIndex(p =>
        p.card.name === acquireAction.card ||
        p.card.id === acquireAction.card
      );

      const pile = supply[pileIndex];
      const cost = getCardCost(pile, dbConfig.currency);

      // Create the acquired card
      const cardsAcquired = ((player.deckCardsAcquired as number) || 0) + 1;
      const newCard = createCardFromTemplate(
        pile.card,
        `${playerId}-acquired-${cardsAcquired}-${Date.now()}`
      );

      // Update supply count
      supply[pileIndex] = { ...pile, count: pile.count - 1 };

      // Deduct cost
      const newResources = { ...(player.resources || {}) };
      for (const [resource, amount] of Object.entries(cost)) {
        const current = newResources[resource] ?? (resource === (dbConfig.currency || 'coins') ? player.coins ?? 0 : 0);
        newResources[resource] = current - amount;
      }

      // Determine where card goes
      const stateChanges: StateChanges = {
        playerStateChanges: {
          [playerId]: {
            resources: newResources,
            deckCardsAcquired: cardsAcquired
          }
        },
        sharedStateChanges: {
          supply
        }
      };

      const acquireTo = dbConfig.acquire_to || 'discard';

      if (acquireTo === 'hand') {
        const newHand = [...(player.hand || []), newCard];
        stateChanges.playerStateChanges![playerId].hand = newHand;
      } else if (acquireTo === 'deck_top') {
        const newDeck = [newCard, ...((player.personalDeck as Card[]) || [])];
        stateChanges.playerStateChanges![playerId].personalDeck = newDeck;
      } else {
        // discard (default)
        const newDiscard = [...((player.personalDiscard as Card[]) || []), newCard];
        stateChanges.playerStateChanges![playerId].personalDiscard = newDiscard;
      }

      return {
        handled: true,
        stateChanges,
        advanceTurn: false, // Typically can take multiple actions
        checkWin: false,
        logMessage: 'deck_acquire',
        logData: {
          card: newCard.name,
          cost,
          destination: acquireTo
        }
      };
    }

    if (action.type === 'trash') {
      const trashAction = action as { card: string };
      const hand = [...(player.hand || [])];
      const cardIndex = hand.findIndex(c =>
        c.name === trashAction.card || c.id === trashAction.card
      );

      const trashedCard = hand[cardIndex];
      hand.splice(cardIndex, 1);

      // Add to trash pile in shared state
      const trashPileName = dbConfig.trash_pile || 'trash';
      const trashPile = [...((state.shared[trashPileName] as Card[]) || []), trashedCard];

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [playerId]: {
              hand
            }
          },
          sharedStateChanges: {
            [trashPileName]: trashPile
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: 'deck_trash',
        logData: {
          card: trashedCard.name
        }
      };
    }

    if (action.type === 'draw_deck') {
      const drawAction = action as { count?: number };
      const count = drawAction.count ?? dbConfig.draw_count ?? 5;

      let personalDeck = [...((player.personalDeck as Card[]) || [])];
      let personalDiscard = [...((player.personalDiscard as Card[]) || [])];
      const hand = [...(player.hand || [])];

      const drawnCards: Card[] = [];

      for (let i = 0; i < count; i++) {
        // Reshuffle discard if deck empty
        if (personalDeck.length === 0 && personalDiscard.length > 0) {
          personalDeck = shuffleArray(personalDiscard);
          personalDiscard = [];
        }

        if (personalDeck.length === 0) break;

        const card = personalDeck.shift()!;
        drawnCards.push(card);
        hand.push(card);
      }

      return {
        handled: true,
        stateChanges: {
          playerStateChanges: {
            [playerId]: {
              hand,
              personalDeck,
              personalDiscard
            }
          }
        },
        advanceTurn: false,
        checkWin: false,
        logMessage: 'deck_draw',
        logData: {
          count: drawnCards.length,
          cards: drawnCards.map(c => c.name)
        }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const dbConfig = ctx.config.engine_mechanics?.deck_building;
    if (!isDeckBuildingConfig(dbConfig)) return [];

    const actions: AvailableAction[] = [];

    // Acquirable cards
    const supply = (ctx.state.shared.supply as SupplyPile[] | undefined) || dbConfig.supply || [];
    for (const pile of supply) {
      if (pile.count <= 0) continue;

      const cost = getCardCost(pile, dbConfig.currency);
      const affordCheck = canAfford(ctx, cost, dbConfig);
      if (!affordCheck.affordable) continue;

      actions.push({
        action: {
          type: 'acquire',
          card: pile.card.name
        } as unknown as GameAction,
        priority: 60,
        category: 'deck-building'
      });
    }

    // Trash cards from hand
    if (dbConfig.allow_trash) {
      const hand = ctx.player.hand || [];
      for (const card of hand) {
        actions.push({
          action: {
            type: 'trash',
            card: card.name
          } as unknown as GameAction,
          priority: 20,
          category: 'deck-building'
        });
      }
    }

    // Draw from personal deck
    const personalDeck = (ctx.player.personalDeck as Card[]) || [];
    const personalDiscard = (ctx.player.personalDiscard as Card[]) || [];
    if (personalDeck.length > 0 || personalDiscard.length > 0) {
      actions.push({
        action: {
          type: 'draw_deck',
          count: dbConfig.draw_count ?? 5
        } as unknown as GameAction,
        priority: 80,
        category: 'deck-building'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'acquire' || action.type === 'buy') {
      return {
        type: action.type,
        label: 'Acquire Card',
        description: 'Purchase a card from the supply to add to your deck.',
        examples: ['acquire card:"Village"', 'buy card:"Smithy"']
      };
    }

    if (action.type === 'trash') {
      return {
        type: 'trash',
        label: 'Trash Card',
        description: 'Remove a card from your hand permanently.',
        examples: ['trash card:"Copper"']
      };
    }

    if (action.type === 'draw_deck') {
      return {
        type: 'draw_deck',
        label: 'Draw from Deck',
        description: 'Draw cards from your personal deck into your hand.',
        examples: ['draw_deck', 'draw_deck count:3']
      };
    }

    return null;
  }
};
