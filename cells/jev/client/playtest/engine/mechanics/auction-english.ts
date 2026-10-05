/**
 * Auction (English) Mechanic
 *
 * English-style ascending bid auctions.
 *
 * Hooks used:
 * - initSharedState: Initialize auction session state (currentBid, highBidder)
 * - preValidateAction: Validate bid action (sufficient funds, min increment)
 * - onExecuteAction: Handle bid and auction_pass actions
 * - getAvailableActions: Expose bid and pass actions during auctions
 * - describeAction: Describe bid and auction_pass actions
 */

import {
  MechanicHooks,
  HookContext,
  ValidationResult,
  SharedStateInitContext,
  SharedStateInitResult,
  ActionExecutionContext,
  ActionExecutionResult,
  AvailableAction,
  ActionDescription,
  ActionSchema
} from './types';
import { GameAction, BidAction } from '../types/game';
import { spendResource } from './core/resources';

interface AuctionConfig {
  type: string;
  currency: string;
  min_increment?: number;
}

export const auctionEnglishMechanic: MechanicHooks = {
  slug: 'auction-english',
  name: 'Auction (English)',
  requires: ['auction', 'resources'],

  configSchema: {
    type: 'object',
    description: 'English-style ascending bid auctions',
    properties: {
      type: {
        type: 'string',
        description: 'Auction type (english)',
        default: 'english'
      },
      currency: {
        type: 'string',
        description: 'Resource used for bidding',
        required: true
      },
      min_increment: {
        type: 'number',
        description: 'Minimum bid increment over current high bid',
        default: 1
      },
      items: {
        type: 'array',
        description: 'Items available for auction'
      }
    },
    required: ['currency']
  },

  getActionSchema(action: GameAction): ActionSchema | null {
    if (action.type === 'bid') {
      return {
        required: ['amount'],
        fields: {
          amount: { type: 'number', minimum: 0 },
        },
      };
    }
    if (action.type === 'auction_pass') {
      return {};
    }
    return null;
  },

  initSharedState(ctx: SharedStateInitContext): SharedStateInitResult | null {
    const auctionConfig = ctx.config.engine_mechanics?.auction as AuctionConfig | undefined;
    if (!auctionConfig) return null;

    return {
      currentBid: 0,
      highBidder: null,
      auctionActive: false,
      auctionItem: null,
      auctionPassedPlayers: []
    };
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'bid') return null;

    const auctionConfig = ctx.config.engine_mechanics?.auction as AuctionConfig | undefined;
    if (!auctionConfig) {
      return { valid: false, error: 'Bidding is not enabled for this game.' };
    }

    const bidAction = action as BidAction;
    const currency = auctionConfig.currency;
    const available = ctx.player.resources?.[currency] ?? 0;

    if (bidAction.amount > available) {
      return {
        valid: false,
        error: `Not enough ${currency} to bid. You have ${available}, trying to bid ${bidAction.amount}.`
      };
    }

    // Check minimum increment for English auctions
    if (auctionConfig.type === 'english') {
      const currentHighBid = (ctx.state.shared.currentBid as number) ?? 0;
      if (bidAction.amount <= currentHighBid) {
        const minBid = currentHighBid + (auctionConfig.min_increment ?? 1);
        return {
          valid: false,
          error: `Bid too low. Current high bid is ${currentHighBid}. Minimum bid: ${minBid}.`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, playerId, state } = ctx;
    const auctionConfig = ctx.config.engine_mechanics?.auction as AuctionConfig | undefined;
    if (!auctionConfig) return null;

    if (action.type === 'bid') {
      const bidAction = action as BidAction;
      const currentBid = (state.shared.currentBid as number) ?? 0;

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            currentBid: bidAction.amount,
            highBidder: playerId,
            auctionActive: true,
            auctionPassedPlayers: []
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: 'bid_placed',
        logData: {
          player: playerId,
          amount: bidAction.amount,
          previousBid: currentBid
        }
      };
    }

    if (action.type === 'auction_pass') {
      const passedPlayers = [...((state.shared.auctionPassedPlayers as string[]) ?? [])];
      if (!passedPlayers.includes(playerId)) {
        passedPlayers.push(playerId);
      }

      // Check if all players except high bidder have passed
      const activePlayers = state.turnOrder.filter(p => p !== state.shared.highBidder);
      const allPassed = activePlayers.every(p => passedPlayers.includes(p));

      if (allPassed && state.shared.highBidder) {
        // Auction won - deduct currency from winner
        const winner = state.shared.highBidder as string;
        const winningBid = (state.shared.currentBid as number) ?? 0;
        const currency = auctionConfig.currency;
        spendResource(state, winner, currency, winningBid);

        return {
          handled: true,
          stateChanges: {
            sharedStateChanges: {
              auctionActive: false,
              auctionPassedPlayers: [],
              lastAuctionWinner: winner,
              lastAuctionBid: winningBid
            }
          },
          advanceTurn: true,
          checkWin: true,
          logMessage: 'auction_won',
          logData: {
            winner,
            amount: winningBid,
            item: state.shared.auctionItem
          }
        };
      }

      return {
        handled: true,
        stateChanges: {
          sharedStateChanges: {
            auctionPassedPlayers: passedPlayers
          }
        },
        advanceTurn: true,
        checkWin: false,
        logMessage: 'auction_pass',
        logData: { player: playerId, passedCount: passedPlayers.length }
      };
    }

    return null;
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const auctionConfig = ctx.config.engine_mechanics?.auction as AuctionConfig | undefined;
    if (!auctionConfig) return [];
    if (!ctx.state.shared.auctionActive) return [];

    const actions: AvailableAction[] = [];
    const currentBid = (ctx.state.shared.currentBid as number) ?? 0;
    const minIncrement = auctionConfig.min_increment ?? 1;
    const currency = auctionConfig.currency;
    const available = ctx.player.resources?.[currency] ?? 0;
    const minBid = currentBid + minIncrement;

    // Can bid if player has enough resources
    if (available >= minBid && ctx.playerId !== ctx.state.shared.highBidder) {
      actions.push({
        action: { type: 'bid', amount: minBid } as GameAction,
        priority: 70,
        category: 'auction'
      });
    }

    // Can always pass on auction
    if (ctx.playerId !== ctx.state.shared.highBidder) {
      actions.push({
        action: { type: 'auction_pass' } as GameAction,
        priority: 30,
        category: 'auction'
      });
    }

    return actions;
  },

  describeAction(action: GameAction): ActionDescription | null {
    if (action.type === 'bid') {
      return {
        type: 'bid',
        label: 'Place Bid',
        description: 'Place a bid in the current auction. Must exceed the current high bid by the minimum increment.',
        examples: ['bid amount:10']
      };
    }
    if (action.type === 'auction_pass') {
      return {
        type: 'auction_pass',
        label: 'Pass on Auction',
        description: 'Pass on the current auction. If all players pass, the high bidder wins.',
        examples: ['auction_pass']
      };
    }
    return null;
  }
};
