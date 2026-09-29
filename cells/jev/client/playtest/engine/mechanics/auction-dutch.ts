/**
 * Dutch Auction Mechanic
 *
 * Descending price auction where the price starts high and decreases each round.
 * First player to accept the current price wins the item.
 *
 * Config:
 *   auction_dutch:
 *     starting_price: number        # Initial price
 *     decrement: number             # Price decrease per round
 *     min_price: number             # Floor price
 *     currency: string              # Resource used for payment
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, SharedStateInitContext, SharedStateInitResult } from './types';
import { GameAction, GameConfig } from '../types/game';

interface DutchAuctionConfig {
  starting_price?: number;
  decrement?: number;
  min_price?: number;
  currency?: string;
}

interface DutchAuctionState {
  active: boolean;
  currentPrice: number;
  item: string | null;
  round: number;
  passedPlayers: string[];
}

function getConfig(config: GameConfig): DutchAuctionConfig | undefined {
  return config.engine_mechanics?.auction_dutch as DutchAuctionConfig | undefined;
}

export const auctionDutchMechanic: MechanicHooks = {
  slug: 'auction-dutch',
  name: 'Dutch Auction',
  requires: ['auction', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Descending price auction',
    properties: {
      starting_price: {
        type: 'number',
        description: 'Initial auction price',
        default: 10
      },
      decrement: {
        type: 'number',
        description: 'Price decrease per round',
        default: 1
      },
      min_price: {
        type: 'number',
        description: 'Minimum price floor',
        default: 1
      },
      currency: {
        type: 'string',
        description: 'Resource used for payment',
        default: 'gold'
      }
    }
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const config = getConfig(ctx.config);
    if (!config) return null;

    const auctionState: DutchAuctionState = {
      active: false,
      currentPrice: config.starting_price ?? 10,
      item: null,
      round: 0,
      passedPlayers: []
    };

    return { dutchAuction: auctionState };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'dutch_bid' && action.type !== 'dutch_pass') return null;

    const config = getConfig(ctx.config);
    if (!config) return { valid: false, error: 'Dutch auction not enabled.' };

    const auctionState = ctx.state.shared.dutchAuction as DutchAuctionState | undefined;
    if (!auctionState || !auctionState.active) {
      return { valid: false, error: 'No active Dutch auction.' };
    }

    if (auctionState.passedPlayers.includes(ctx.playerId)) {
      return { valid: false, error: 'You have already passed on this auction.' };
    }

    if (action.type === 'dutch_bid') {
      const currency = config.currency ?? 'gold';
      const resources = (ctx.player.resources as Record<string, number>) ?? {};
      const available = resources[currency] ?? 0;

      if (available < auctionState.currentPrice) {
        return {
          valid: false,
          error: `Not enough ${currency}. Need ${auctionState.currentPrice}, have ${available}.`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    if (ctx.action.type !== 'dutch_bid' && ctx.action.type !== 'dutch_pass') return null;

    const config = getConfig(ctx.config);
    if (!config) return null;

    const auctionState = { ...(ctx.state.shared.dutchAuction as DutchAuctionState) };
    const currency = config.currency ?? 'gold';

    if (ctx.action.type === 'dutch_bid') {
      // Player accepts current price
      const resources = { ...((ctx.state.players[ctx.playerId]?.resources as Record<string, number>) ?? {}) };
      resources[currency] = (resources[currency] ?? 0) - auctionState.currentPrice;

      auctionState.active = false;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { dutchAuction: auctionState },
          playerStateChanges: {
            [ctx.playerId]: { resources }
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: `${ctx.playerId} won the Dutch auction for ${auctionState.item ?? 'the item'} at price ${auctionState.currentPrice} ${currency}.`
      };
    }

    if (ctx.action.type === 'dutch_pass') {
      auctionState.passedPlayers.push(ctx.playerId);

      // Check if all players passed
      const allPlayers = Object.keys(ctx.state.players);
      const allPassed = allPlayers.every(p => auctionState.passedPlayers.includes(p));

      if (allPassed) {
        // Decrease price and reset passes
        const decrement = config.decrement ?? 1;
        const minPrice = config.min_price ?? 1;
        auctionState.currentPrice = Math.max(minPrice, auctionState.currentPrice - decrement);
        auctionState.passedPlayers = [];
        auctionState.round++;

        // If at minimum price and all pass again, auction fails
        if (auctionState.currentPrice <= minPrice) {
          auctionState.active = false;
          return {
            handled: true,
            stateChanges: {
              sharedStateChanges: { dutchAuction: auctionState }
            },
            advanceTurn: true,
            checkWin: false,
            logMessage: `Dutch auction ended with no buyer. Price reached minimum of ${minPrice} ${currency}.`
          };
        }
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: { dutchAuction: auctionState }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: allPassed
          ? `All players passed. Price drops to ${auctionState.currentPrice} ${currency}.`
          : `${ctx.playerId} passed on the Dutch auction at ${auctionState.currentPrice} ${currency}.`
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = getConfig(ctx.config);
    if (!config) return [];

    const auctionState = ctx.state.shared.dutchAuction as DutchAuctionState | undefined;
    if (!auctionState || !auctionState.active) return [];
    if (auctionState.passedPlayers.includes(ctx.playerId)) return [];

    const actions: AvailableAction[] = [];

    const currency = config.currency ?? 'gold';
    const resources = (ctx.player.resources as Record<string, number>) ?? {};
    const available = resources[currency] ?? 0;

    if (available >= auctionState.currentPrice) {
      actions.push({
        action: {
          type: 'dutch_bid'
        } as unknown as GameAction,
        priority: 90,
        category: 'auction'
      });
    }

    actions.push({
      action: {
        type: 'dutch_pass'
      } as unknown as GameAction,
      priority: 85,
      category: 'auction'
    });

    return actions;
  },

  describeAction(action: GameAction): { type: string; label: string; description: string; examples?: string[] } | null {
    if (action.type === 'dutch_bid') {
      return {
        type: 'dutch_bid',
        label: 'Accept Dutch Auction Price',
        description: 'Accept the current descending price and win the auction item.',
        examples: ['dutch_bid']
      };
    }
    if (action.type === 'dutch_pass') {
      return {
        type: 'dutch_pass',
        label: 'Pass on Dutch Auction',
        description: 'Pass on the current price. Price will decrease when all players pass.',
        examples: ['dutch_pass']
      };
    }
    return null;
  }
};
