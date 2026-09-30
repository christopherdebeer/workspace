/**
 * Auction (Once Around) Mechanic
 *
 * Each player gets exactly one chance to bid in turn order.
 * Once a player passes, they cannot bid again.
 *
 * Config:
 *   auction_once_around:
 *     currency: string          # Resource used for bidding
 *     min_increment: number     # Minimum bid increment (default: 1)
 *     starting_bid: number      # Minimum starting bid (default: 0)
 *
 * Hooks used:
 * - preValidateAction: Validate once-around bid/pass
 * - onExecuteAction: Handle bid submission and resolution
 * - getAvailableActions: Expose bid/pass actions
 */

import { MechanicHooks, HookContext, ValidationResult, ActionExecutionContext, ActionExecutionResult, AvailableAction, StateChanges } from './types';
import { GameAction, OnceAroundBidAction, OnceAroundPassAction, AuctionOnceAroundConfig } from '../types/game';
import { spendResource } from './core/resources';

interface OnceAroundAuction {
  id: string;
  item: unknown;
  currentBid: number;
  currentBidder: string | null;
  passedPlayers: string[];
  remainingBidders: string[];
  resolved: boolean;
  winner?: string;
  winningBid?: number;
}

export const auctionOnceAroundMechanic: MechanicHooks = {
  slug: 'auction-once-around',
  name: 'Auction (Once Around)',
  requires: ['auction', 'resources'],

  configSchema: {
    type: 'object',
    description: 'Once-around auctions where each player gets one bid opportunity',
    properties: {
      currency: {
        type: 'string',
        description: 'Resource used for bidding',
        required: true
      },
      min_increment: {
        type: 'number',
        description: 'Minimum bid increment over current bid',
        default: 1
      },
      starting_bid: {
        type: 'number',
        description: 'Minimum starting bid',
        default: 0
      }
    },
    required: ['currency']
  },

  preValidateAction(ctx: HookContext, action: GameAction): ValidationResult | null {
    if (action.type !== 'once_around_bid' && action.type !== 'once_around_pass') return null;

    const config = ctx.config.engine_mechanics?.auction_once_around;
    if (!config) {
      return { valid: false, error: 'Once-around auctions are not enabled for this game.' };
    }

    const activeAuction = ctx.state.shared.activeOnceAroundAuction as OnceAroundAuction | undefined;
    if (!activeAuction || activeAuction.resolved) {
      return { valid: false, error: 'No active once-around auction.' };
    }

    // Check if player can still bid
    if (activeAuction.passedPlayers.includes(ctx.playerId)) {
      return { valid: false, error: 'You have already passed and cannot bid.' };
    }

    if (!activeAuction.remainingBidders.includes(ctx.playerId)) {
      return { valid: false, error: 'You are not eligible to bid in this auction.' };
    }

    if (action.type === 'once_around_bid') {
      const bidAction = action as OnceAroundBidAction;
      const currency = config.currency;
      const available = ctx.player.resources?.[currency] ?? 0;

      // Validate bid amount
      const minBid = activeAuction.currentBid + (config.min_increment ?? 1);
      const startingBid = config.starting_bid ?? 0;
      const requiredMin = Math.max(minBid, startingBid);

      if (bidAction.amount < requiredMin) {
        return {
          valid: false,
          error: `Bid must be at least ${requiredMin}. Current bid is ${activeAuction.currentBid}.`
        };
      }

      if (bidAction.amount > available) {
        return {
          valid: false,
          error: `Not enough ${currency} to bid. You have ${available}, trying to bid ${bidAction.amount}.`
        };
      }
    }

    return { valid: true };
  },

  onExecuteAction(ctx: ActionExecutionContext): ActionExecutionResult | null {
    const { action, state, playerId } = ctx;

    if (action.type !== 'once_around_bid' && action.type !== 'once_around_pass') return null;

    const config = ctx.config.engine_mechanics?.auction_once_around;
    if (!config) return null;

    const activeAuction = state.shared.activeOnceAroundAuction as OnceAroundAuction;

    if (action.type === 'once_around_pass') {
      // Player passes - remove from remaining bidders
      activeAuction.passedPlayers.push(playerId);
      activeAuction.remainingBidders = activeAuction.remainingBidders.filter(p => p !== playerId);
    } else {
      // Player bids
      const bidAction = action as OnceAroundBidAction;
      activeAuction.currentBid = bidAction.amount;
      activeAuction.currentBidder = playerId;

      // Move to next bidder in order
      activeAuction.remainingBidders = activeAuction.remainingBidders.filter(p => p !== playerId);
      activeAuction.remainingBidders.push(playerId);
    }

    const stateChanges: StateChanges = {};
    let logMessage: string;

    // Check if auction is resolved
    if (activeAuction.remainingBidders.length <= 1 ||
        (activeAuction.currentBidder && activeAuction.remainingBidders.length === 1 &&
         activeAuction.remainingBidders[0] === activeAuction.currentBidder)) {
      // Auction resolved
      activeAuction.resolved = true;
      activeAuction.winner = activeAuction.currentBidder ?? undefined;
      activeAuction.winningBid = activeAuction.currentBid;

      // Deduct winning bid from winner via resource service (fires hooks)
      if (activeAuction.winner && activeAuction.winningBid > 0) {
        spendResource(state, activeAuction.winner, config.currency, activeAuction.winningBid);
      }

      logMessage = activeAuction.winner
        ? `Auction resolved: ${activeAuction.winner} wins with bid of ${activeAuction.winningBid}`
        : 'Auction resolved: No winner (all players passed)';

      stateChanges.sharedStateChanges = {
        activeOnceAroundAuction: activeAuction,
        lastOnceAroundResult: {
          winner: activeAuction.winner,
          winningBid: activeAuction.winningBid
        }
      };
    } else {
      logMessage = action.type === 'once_around_pass'
        ? `${playerId} passes on the auction`
        : `${playerId} bids ${(action as OnceAroundBidAction).amount}`;

      stateChanges.sharedStateChanges = {
        activeOnceAroundAuction: activeAuction
      };
    }

    return {
      handled: true,
      stateChanges,
      advanceTurn: true,
      checkWin: false,
      logMessage
    };
  },

  getAvailableActions(ctx: HookContext): AvailableAction[] {
    const config = ctx.config.engine_mechanics?.auction_once_around;
    if (!config) return [];

    const activeAuction = ctx.state.shared.activeOnceAroundAuction as OnceAroundAuction | undefined;
    if (!activeAuction || activeAuction.resolved) return [];

    // Check if player can bid
    if (activeAuction.passedPlayers.includes(ctx.playerId)) return [];
    if (!activeAuction.remainingBidders.includes(ctx.playerId)) return [];

    const available = ctx.player.resources?.[config.currency] ?? 0;
    const minBid = activeAuction.currentBid + (config.min_increment ?? 1);
    const startingBid = config.starting_bid ?? 0;
    const requiredMin = Math.max(minBid, startingBid);

    const actions: AvailableAction[] = [
      {
        action: {
          type: 'once_around_pass'
        } as OnceAroundPassAction,
        priority: 80,
        category: 'auction'
      }
    ];

    // Only offer bid if player can afford minimum
    if (available >= requiredMin) {
      actions.push({
        action: {
          type: 'once_around_bid',
          amount: requiredMin
        } as OnceAroundBidAction,
        priority: 90,
        category: 'auction'
      });
    }

    return actions;
  }
};
